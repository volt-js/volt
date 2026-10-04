import { Component, Prop, Signal, effect } from '@voltdev/core';
import {
  createTagsInput,
  type InputProps,
  type TagsInput,
  type TagsInputLabels,
} from '@voltdev/primitives';

const { untrack } = Signal.subtle;

/**
 * A flag, as a tag is able to deliver one.
 *
 * Written bare it is on, and bound it is whatever it was bound to. Written as
 * an attribute it is a string, and every string is truthy — so
 * `allowDuplicates="false"` would have kept the second `ada` the caller had
 * said to refuse, and `disabled="false"` would have taken the field out of
 * use. Every string is on here but `"false"`, which nobody writes meaning on.
 * Read through this wherever a flag is read, the signals' as much as the
 * plain one's: a signal set from an attribute holds the string too.
 */
function flag(value: boolean): boolean {
  // Typed as a flag and handed a string all the same: the type is what the
  // tag promises, and an attribute is what it delivers.
  const written: unknown = value;
  return written !== false && written !== 'false' && written !== null && written !== undefined;
}

/**
 * The most tags the row holds, as an attribute is able to carry it.
 *
 * `max="5"` arrives as the string `'5'`. Anything that is not a whole number
 * of tags is refused while the prop is still the thing that is wrong: read
 * as no limit it would let through every tag the caller meant to stop, and
 * nothing would say why.
 */
function limit(value: number): number {
  const written: unknown = value;
  const text = typeof written === 'string' ? written.trim() : written;
  const counted = typeof text === 'number' || (typeof text === 'string' && text !== '');
  const parsed = counted ? Number(text) : Number.NaN;
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(
      `[volt] \`max\` on <v-tags-input> takes a whole number of tags, and ` +
        `\`${String(value)}\` is not one.`,
    );
  }
  return parsed;
}

/**
 * The separators, as a list of characters however they were written.
 *
 * Bound, they are the list the caller gave. Written as an attribute they are
 * one string, and each character of it is a separator — `separators=";,"`
 * ends a tag on either — since a separator is a key press, and the key a
 * press reports for a character is that one character.
 */
function characters(value: string | readonly string[]): readonly string[] {
  return typeof value === 'string' ? [...value] : value;
}

/**
 * Starting tags, however the caller wrote them.
 *
 * Bound, they are the list the caller gave. Written as an attribute they are
 * one string, which the primitive would spread into its characters — so it
 * is split the way a paste is, on the separators and on line breaks, with
 * the blanks dropped.
 */
function tagList(value: string | readonly string[], separators: readonly string[]): readonly string[] {
  if (typeof value !== 'string') return value;
  const ends = new Set([...separators, '\n', '\r']);
  const tags: string[] = [];
  let current = '';
  for (const character of value) {
    if (!ends.has(character)) {
      current += character;
      continue;
    }
    tags.push(current);
    current = '';
  }
  tags.push(current);
  return tags.map((tag) => tag.trim()).filter((tag) => tag !== '');
}

/** What a caller actually wrote, or nothing at all if it came to nothing. */
function said(value: string | boolean | undefined): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

/** A list of tags, and the key each one is rendered under. */
interface Keyed {
  readonly tags: readonly string[];
  readonly keys: readonly number[];
}

/**
 * The keys for `after`, kept from `before` for every tag that lines up with
 * one there and new for the rest.
 *
 * What the two lists share at the start and at the end lines up as it
 * stands, which settles one tag added or taken away on its own. The rest is
 * lined up by the longest run of tags the two have in common, in order — so
 * where `yes, no, yes` became `no, yes`, the `yes` that is left is the second
 * one, the only one that can follow `no`.
 */
function lineUp(before: Keyed, after: readonly string[], mint: () => number): number[] {
  const old = before.tags;
  const keys = new Array<number>(after.length);

  let start = 0;
  while (start < old.length && start < after.length && old[start] === after[start]) {
    keys[start] = before.keys[start]!;
    start += 1;
  }
  let oldEnd = old.length;
  let newEnd = after.length;
  while (oldEnd > start && newEnd > start && old[oldEnd - 1] === after[newEnd - 1]) {
    oldEnd -= 1;
    newEnd -= 1;
    keys[newEnd] = before.keys[oldEnd]!;
  }

  // What is left between: `longest[i][j]` is how many of `old[i..oldEnd]`
  // and `after[j..newEnd]` line up, in order.
  const rows = oldEnd - start;
  const columns = newEnd - start;
  const longest = Array.from({ length: rows + 1 }, () => new Array<number>(columns + 1).fill(0));
  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = columns - 1; j >= 0; j -= 1) {
      longest[i]![j] =
        old[start + i] === after[start + j]
          ? longest[i + 1]![j + 1]! + 1
          : Math.max(longest[i + 1]![j]!, longest[i]![j + 1]!);
    }
  }
  let i = 0;
  let j = 0;
  while (j < columns) {
    if (i < rows && old[start + i] === after[start + j]) {
      keys[start + j] = before.keys[start + i]!;
      i += 1;
      j += 1;
    } else if (i < rows && longest[i + 1]![j]! >= longest[i]![j + 1]!) {
      i += 1;
    } else {
      keys[start + j] = mint();
      j += 1;
    }
  }
  return keys;
}

/**
 * A list of tags with a text input at the end of it: the label, the box the
 * two share, a line of help and the message.
 *
 * ```html
 * <v-tags-input :value="topics" label="Topics" name="topic" max="5"
 *               description="Up to five. Enter or a comma adds one."></v-tags-input>
 * ```
 *
 * The tags are one tab stop and the text input is another, so a field
 * holding twenty tags costs two Tab presses rather than twenty-one: the
 * arrows move along the row, Delete and Backspace take away the tag under
 * them, the back arrow in an empty text input steps into the row and the
 * forward arrow off the last tag steps back out. Enter or a separator adds
 * what is typed; Backspace in an empty text input takes the last tag away; a
 * paste with separators or line breaks in it becomes several tags at once;
 * and what is half-typed when the field is left is added rather than lost.
 * All of that is `createTagsInput`'s, along with where focus goes when the
 * tag holding it is taken away — the tag that took its place, the last tag,
 * the text input, the row, the box, and never `<body>`.
 *
 * Adding and removing a tag changes the page without moving focus, which is
 * silence to a screen reader, so a live region under the field says what was
 * added, what was removed, and which tag a refused duplicate collided with.
 * That tag is marked in the row at the same moment, which the sheet's own
 * entry draws because neither the chip's nor the field's can see it — and
 * which is the only sign a sighted user has that Enter was refused rather
 * than ignored.
 *
 * Each tag is drawn as a `<v-chip>` is, on the chip sheet's classes, with a
 * button after it that a pointer or a screen reader can press. The button is
 * never a tab stop — the tag is one, and Backspace on it does the same job —
 * and it is not drawn at all while the field is disabled or read-only, since
 * a button that does nothing is a lie to whoever finds it. The tags are not
 * `<v-chip>`s themselves: the field owns focus across the whole row, and a
 * chip deciding where focus goes one tag at a time would fight it.
 *
 * What submits is one hidden `<input>` per tag under `name`, so the server
 * reads a list, and `form.reset()` puts the row back to where it started.
 * While the field is disabled those are disabled with it, and it submits
 * nothing, as any disabled control does.
 * The text input is the field's control — what the label's `for` points at,
 * and what the platform refuses the submit over — but `required` is checked
 * against the tags rather than written to it, because an empty text input
 * beside five tags is a filled-in field.
 *
 * What a caller writes on the tag lands on the box: it is the element
 * carrying the role, `group`, and the one a class lays out and a `data-*`
 * says anything about. The three ARIA attributes the field has an opinion
 * about are declared as props below rather than left to fall through,
 * because the primitive names the box and the text input after the label,
 * and a caller's own written beside that would be written over — or, in
 * `aria-label`'s case, left on the element and outranked by the reference.
 */
@Component({ selector: 'v-tags-input', templateUrl: './tags-input.html' })
export class VTagsInput {
  /** Your own signal, when the tags belong to your component. */
  @Prop() value?: Signal.State<readonly string[]>;

  /**
   * Everything from here to `labels` is what the primitive is built with,
   * read once while this field list initializes — plain, because a signal
   * would promise a caller they can change it later and the primitive would
   * never hear it.
   */
  /**
   * Where the row starts when the tags are the field's own, and what a reset
   * goes back to. Bound as a list, or written as an attribute that is split
   * on the separators: `defaultValue="design, rust"`.
   */
  @Prop() defaultValue?: string | readonly string[];
  /**
   * The text input's id, and so the `for` of the label above it.
   *
   * Declared rather than left to `:host` so that the one id is the one both
   * halves use — and because `:host` is the box, while a press on the label
   * has to land in the text input.
   */
  @Prop() id?: string;
  /** Each tag submits as `name=tag`, from a hidden input apiece. Without a name the field submits nothing. */
  @Prop() name?: string;
  /** Shown in the empty text input. Not a label: it is gone the moment anyone types. */
  @Prop() placeholder?: string;
  /**
   * Most tags the row will hold, as a whole number. At the limit the box and
   * the text input are marked `data-full`, and the next tag is refused
   * without a word — so say the limit in `description`, where it is read
   * before anyone reaches it.
   */
  @Prop() max?: number;
  /**
   * Keep a tag that is already there. Off by default: `Ada` and `ada` are
   * one tag, compared through the locale's collator, and the second is
   * refused with the first pointed at. Written bare — `allowDuplicates` — or
   * bound; `allowDuplicates="false"` is the false it says.
   */
  @Prop() allowDuplicates = false;
  /**
   * The characters that end a tag as they are typed, and split a paste.
   * Default a comma. A line break in a paste always splits. Bound as a list,
   * or written as an attribute whose every character is one.
   */
  @Prop() separators: string | readonly string[] = [','];
  /**
   * Your wording: the list's name, the remove buttons' names, what the live
   * region says, and the sentence `required` refuses an empty row with.
   */
  @Prop() labels?: TagsInputLabels;

  /**
   * Your rule for one tag. Return a message to refuse it: the message is
   * shown under the field and pushed into the text input, the text stays
   * there to be fixed — a refused piece of a paste is left out — and the
   * next edit takes the message away. Nothing back is a pass. Asked when a
   * tag is on its way in, so a rule the page rebinds is the one asked.
   */
  @Prop() validate?: (tag: string) => string | null | undefined;
  /** Called with the tags whenever one is added or removed, and when a reset puts them back. */
  @Prop() onValueChange?: (tags: readonly string[]) => void;

  /** The words above the box. Markup instead, in the `label` slot. */
  @Prop() label = new Signal.State('');
  /** The line under it, shown whether or not the field is valid. */
  @Prop() description = new Signal.State('');
  /**
   * Your own verdict on the row, when it is wrong for a reason the field
   * cannot see — shown under the box as the message, and pushed into the
   * text input, so a submit is refused for the reason on screen.
   *
   * Empty is no verdict. The field lets a verdict go on the next edit, as it
   * does any message, so clear this in `onValueChange` and set it again
   * after the next attempt: a signal set to the string it already holds has
   * not changed, and says nothing.
   *
   * Bound as `:prop-error`: `error` is a DOM event's name as well, and
   * `:error` on a tag is read as that event. Written out — `error="…"` — it
   * is a prop like any other.
   */
  @Prop() error = new Signal.State('');

  /**
   * Refuses a submit while the row is empty, with the field's own sentence
   * for it. Checked against the tags rather than written to the text input,
   * because an empty text input beside five tags is a filled-in field.
   *
   * This and the next two are written bare or bound, and `="false"` is the
   * false it says, as it is for `allowDuplicates`.
   */
  @Prop() required = new Signal.State(false);
  /**
   * Written through to the text input as the platform's own `disabled`, and
   * to the box in ARIA. The remove buttons go with it, and the tags' hidden
   * inputs take it too, so a disabled field submits nothing.
   */
  @Prop() disabled = new Signal.State(false);
  /**
   * Written through to the text input as the platform's own `readOnly`.
   * Refuses adding and removing, keeps both tab stops so the tags can still
   * be read and copied, and is never validated. The remove buttons go with
   * it here too. The box says it as `data-readonly` rather than in ARIA — see
   * `boxProps`.
   */
  @Prop() readOnly = new Signal.State(false);

  /**
   * Names the field, in the platform's own spelling.
   *
   * Declared rather than left to `:host` because landing it on the box is
   * not enough to make it the name. `aria-labelledby` outranks `aria-label`
   * in every accessible name there is, and the field points the first at its
   * own label — so a name written here would reach the box and name nothing.
   * Given one, the field stands its own reference down, on the box and on
   * the text input both, since the two are one field to whoever hears them.
   * The label's `for` stays either way, so a press on the words still puts
   * the caret in the text input.
   */
  @Prop({ alias: 'aria-label' }) ariaLabel = new Signal.State<string | undefined>(undefined);
  /**
   * Names the field from somewhere else on the page, instead of the label.
   *
   * The field points `aria-labelledby` at its own label, so this and the next
   * are declared rather than left to `:host`: two bags writing one attribute
   * on one element is the caller's losing, whichever order they land in.
   */
  @Prop({ alias: 'aria-labelledby' }) labelledBy = new Signal.State<string | undefined>(undefined);
  /** Ids of anything else that describes it. Added to the field's own two, not instead of them. */
  @Prop({ alias: 'aria-describedby' }) describedBy = new Signal.State<string | undefined>(
    undefined,
  );

  /**
   * The parts, as elements.
   *
   * Signals rather than plain fields because the primitive watches them: none
   * of them exists while this class is being built, and the ids and the
   * references between them are written the moment each does. The row is
   * where the tags are found, in the order they appear, and the box is the
   * last place focus can fall to when a removal takes the tag holding it.
   */
  labelEl = new Signal.State<Element | null>(null);
  box = new Signal.State<Element | null>(null);
  row = new Signal.State<Element | null>(null);
  control = new Signal.State<Element | null>(null);
  descriptionEl = new Signal.State<Element | null>(null);
  errorEl = new Signal.State<Element | null>(null);

  /** The separators, read once and as characters, since a written default is split on them too. */
  private readonly ends = characters(this.separators);

  /** The tags the row's keys were last worked out for, and those keys. See `keyOf`. */
  private keyed: Keyed = { tags: [], keys: [] };
  private lastKey = 0;

  /**
   * The primitive, built from the props above — which is why props have to be
   * there while a field initializes.
   */
  readonly tags: TagsInput = createTagsInput({
    input: () => this.control.get(),
    list: () => this.row.get(),
    root: () => this.box.get(),
    label: () => this.labelEl.get(),
    description: () => this.descriptionEl.get(),
    errorMessage: () => this.errorEl.get(),
    required: () => flag(this.required.get()),
    disabled: () => this.isDisabled(),
    readOnly: () => this.isReadOnly(),
    allowDuplicates: flag(this.allowDuplicates),
    delimiters: this.ends,
    validateTag: (tag) => this.accept(tag),
    // Read when it is called, so a callback the page rebinds is the one heard.
    onValueChange: (tags) => this.onValueChange?.(tags),
    ...(this.value ? { value: this.value } : {}),
    ...(this.defaultValue !== undefined
      ? { defaultValue: tagList(this.defaultValue, this.ends) }
      : {}),
    ...(this.id !== undefined ? { id: this.id } : {}),
    ...(this.name !== undefined ? { name: this.name } : {}),
    ...(this.placeholder !== undefined ? { placeholder: this.placeholder } : {}),
    ...(this.max !== undefined ? { max: limit(this.max) } : {}),
    ...(this.labels ? { labels: this.labels } : {}),
  });

  constructor() {
    // The caller's verdict, handed to the field once the control it is
    // measured against is on the page: a message given before the text input
    // renders is evaluated against nothing and comes back as valid.
    // Untracked, because settling the field reads its own signals, and this
    // must follow the caller's message and nothing else.
    effect(() => {
      const message = this.error.get();
      if (!this.control.get()) return;
      untrack(() => this.tags.field.setCustomValidity(message));
    });
  }

  /** Whether the row is the user's to change, which is when the remove buttons are drawn. */
  editable(): boolean {
    return !this.isDisabled() && !this.isReadOnly();
  }

  /** `disabled`, as a flag however it was written. */
  isDisabled(): boolean {
    return flag(this.disabled.get());
  }

  /** `readOnly`, as a flag however it was written. */
  isReadOnly(): boolean {
    return flag(this.readOnly.get());
  }

  /**
   * What the box carries: the primitive's bag, with the caller's three names
   * merged into it — see `named` — and read-only said in a way a group may.
   *
   * The primitive borrows the field's ARIA for the box, and with it
   * `aria-readonly`, which ARIA allows on a textbox, a listbox, a grid and a
   * handful of other controls but not on `group`: a checker reports it, and a
   * screen reader is free to drop it. The text input inside is the control,
   * and it says read-only itself, so nothing a screen reader hears is lost.
   * What the field's sheet drew from it — the sunken surface that says the
   * row is not yours to change — is drawn from `data-readonly` instead, by
   * this component's own entry.
   */
  boxProps(): InputProps {
    const { 'aria-readonly': readOnly, ...own } = this.tags.rootProps();
    return { ...this.named(own), 'data-readonly': readOnly === 'true' || undefined };
  }

  /** What the text input carries, named the same way, since it is the same field. */
  inputProps(): InputProps {
    return this.named(this.tags.inputProps());
  }

  /**
   * What one tag submits as: the primitive's hidden input, out of the form
   * while the field is.
   *
   * The tags submit from these and not from the text input, which has no
   * name. So the platform's `disabled` on the text input takes nothing out of
   * the request by itself, and a disabled field would go on sending every tag
   * it holds — which is not what a disabled control does. Read-only is left
   * alone: a read-only control submits.
   */
  hiddenProps(index: number): InputProps {
    const own = this.tags.hiddenInputProps(index);
    return this.isDisabled() ? { ...own, disabled: true } : own;
  }

  /**
   * What the row is keyed by: an identity for each tag that follows the tag,
   * rather than its words.
   *
   * Keyed by its words, two copies of one tag are one key, and the list pairs
   * equal keys up in order. So taking away the first `yes` of `yes, no, yes`
   * kept the first element — the one being taken away, and the one holding
   * focus — moved it after `no` to stand for the second `yes`, and threw the
   * element that really was the second away. Moving a focused element blurs
   * it, and since the element focus had been on was still on the page, the
   * primitive saw nothing to rescue: focus fell to `<body>`.
   *
   * So each new list of tags is lined up against the last one, and a tag that
   * lines up keeps its key while one that does not is given a new one. One
   * tag added or taken away, which is nearly every change, is told apart by
   * the run the two lists share at either end; whatever is left between is
   * lined up by the longest run of tags the two have in common, in order,
   * which is the same answer for a single change and a sound one for a write
   * that made several. Worked out once per list, since the row and the hidden
   * inputs ask about the same one.
   */
  keyOf(index: number): number {
    const tags = this.tags.tags();
    if (tags !== this.keyed.tags) {
      this.keyed = { tags, keys: lineUp(this.keyed, tags, () => (this.lastKey += 1)) };
    }
    return this.keyed.keys[index] ?? -1 - index;
  }

  /**
   * The message on screen: the first of them.
   *
   * One line rather than the list, because the platform takes one string too —
   * so the sentence a reader is given is the same sentence the browser refused
   * the submit over, rather than one of several they have to match up.
   */
  message(): string {
    return this.tags.field.messages()[0] ?? '';
  }

  /**
   * A press on the box itself puts the caret in the text input.
   *
   * The box is drawn as one control, and a user who clicks in the space
   * around the tags means to type there. A press on a tag, its button or the
   * text input is somewhere already, and is left alone.
   */
  focusInput(event: Event): void {
    if (!this.beside(event)) return;
    // The `<input>` this template draws, so not narrowed with `instanceof`:
    // one rendered into another document's frame is not an instance of this
    // window's `HTMLElement`, and would never be given the caret.
    const control = this.control.get() as HTMLElement | null;
    control?.focus();
  }

  /**
   * A press on the box itself leaves focus where it was, for the click that
   * follows to put it in the text input.
   *
   * The box and the row each carry a `tabindex` — they are where focus falls
   * when a removal leaves nowhere better — so a press on either would move
   * focus onto it first, as the press's own default. Moving it out of a text
   * input someone is typing in is a blur, and the blur adds whatever is
   * half-typed as a tag: a press that means "type here" would have ended the
   * very tag being typed. Refusing the default keeps the caret where it is.
   * A press on a tag or its button is left alone, as the click is.
   */
  stay(event: MouseEvent): void {
    if (this.beside(event)) event.preventDefault();
  }

  /** Whether a press landed on the box or the row, rather than on anything in them. */
  private beside(event: Event): boolean {
    const target = event.target;
    return target === this.box.get() || target === this.row.get();
  }

  /**
   * The caller's rule, asked about a tag on its way in.
   *
   * A message refuses the tag and is shown where the field shows what is
   * wrong, through the same custom validity the caller's `error` takes, so
   * the browser refuses the submit over the sentence on screen — and the
   * field lets it go on the next edit, as it does any message, since the
   * text is still in the text input being fixed.
   */
  private accept(tag: string): boolean {
    const message = this.validate?.(tag);
    if (!message) return true;
    this.tags.field.setCustomValidity(message);
    return false;
  }

  /**
   * The primitive's bag with the three names merged into it rather than
   * written beside it.
   *
   * `:spread` rewrites the element whenever what it reads changes and takes
   * back the keys the new object does not carry, so an attribute applied next
   * to it — by a second spread, which is what `:host` is — is an attribute one
   * of the two silently wins. Merging here makes the outcome the same whatever
   * order they run in.
   *
   * A name the caller gave wins over the field's own label, whichever way they
   * spelled it. `aria-labelledby` replaces the field's reference, and
   * `aria-label` stands it down, because a reference left beside it would
   * outrank the words they wrote. A description is added to the field's
   * instead, after them, which is the order a screen reader reads them in.
   * An id a caller has not chosen yet is an empty string, and one of those is
   * read as unsaid rather than as a reference to nothing.
   */
  private named(own: InputProps): InputProps {
    const named = said(this.ariaLabel.get());
    const from = said(this.labelledBy.get());
    const described = [own['aria-describedby'], this.describedBy.get()]
      .map(said)
      .filter((id): id is string => id !== undefined)
      .join(' ');

    return {
      ...own,
      'aria-label': named,
      'aria-labelledby': from ?? (named ? undefined : own['aria-labelledby']),
      'aria-describedby': described || undefined,
    };
  }
}
