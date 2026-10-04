import { Component, Prop, Signal, effect } from '@voltdev/core';
import { createRating, type InputProps, type Rating, type RatingLabels } from '@voltdev/primitives';

const { untrack } = Signal.subtle;

/** A wording for one number out of a range — an option's name, or the whole score. */
type Wording = (value: number, max: number) => string;

/**
 * A flag, as a tag is able to deliver one.
 *
 * Written bare it is on, and bound it is whatever it was bound to. Written as
 * an attribute it is a string, and every string is truthy — so `halves="false"`
 * would have offered halves to a caller who had said not to, and
 * `readOnly="false"` locked a rating they had just said was not locked. Every
 * string is on here but `"false"`, which nobody writes meaning on. Signals go
 * through it too: a signal prop is handed the same string a plain one is.
 */
function flag(value: boolean): boolean {
  // Typed as a flag and handed a string all the same: the type is what the
  // tag promises, and an attribute is what it delivers.
  const written: unknown = value;
  return written !== false && written !== 'false' && written !== null && written !== undefined;
}

/**
 * A number, however the caller wrote it.
 *
 * `defaultValue="3"` arrives as its spelling, and the primitive would keep the
 * string: `value()` would hand back text where it promises a number,
 * `isSelected(3)` would say no, and a form reset would report a change from
 * `"3"` to `3` that nobody made. A spelling that is not a number, or an
 * attribute written with nothing after it, is no number at all.
 */
function numeric(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isNaN(value) ? undefined : value;
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * How many stars, as an attribute is able to carry it.
 *
 * `max="10"` arrives as the string `'10'`, and the primitive counts up to
 * `max + 1e-9`, which for a string is concatenation: it counts to `"101e-9"`,
 * a tenth of a millionth, and draws no stars at all without a word. A
 * spelling that is a whole number is that number; anything else is refused
 * while the prop is still the thing that is wrong, since a row of stars is a
 * whole number of them.
 */
function count(value: number): number {
  const parsed = numeric(value);
  if (parsed === undefined || !Number.isInteger(parsed) || parsed < 1) {
    throw new Error(
      `[volt] \`max\` on <v-rating> takes a whole number of stars, and \`${String(value)}\` ` +
        'is not one.',
    );
  }
  return parsed;
}

/**
 * The caller's own signal, refused when it is not one.
 *
 * `value` is the single signal the page and the rating both hold, and markup
 * has no way to write a signal: `value="3"` hands over a string, which would
 * be asked for `.get()` while this class is still being built — a TypeError
 * about a method, naming nothing the caller wrote. Refused here instead, and
 * pointed at `defaultValue`, which is how starting at a score is spelled.
 */
function ownSignal(value: unknown): Signal.State<number | null> {
  const candidate = value as Partial<Signal.State<number | null>> | null | undefined;
  if (typeof candidate?.get === 'function' && typeof candidate.set === 'function') {
    return value as Signal.State<number | null>;
  }
  throw new Error(
    `[volt] \`value\` on <v-rating> takes a signal your component holds, and \`${String(value)}\` ` +
      'is not one.\n' +
      '  To have it start at a score, write `defaultValue`. To drive it, hold a ' +
      '`new Signal.State<number | null>(3)` and pass that: `:value="stars"`.',
  );
}

/** What a caller actually wrote, or nothing at all if it came to nothing. */
function said(value: string | undefined): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

/** The score as the tag speaks it: `null` for unrated, where the primitive says zero. */
function nullable(score: number): number | null {
  return score > 0 ? score : null;
}

/**
 * A star rating: a radio group wearing stars.
 *
 * ```html
 * <v-rating :value="stars" name="stars" label="Your rating"></v-rating>
 * ```
 *
 * The metaphor is `createRating`'s and it is exact. The arrows move and
 * choose in one press, Home and End jump to the ends, one star holds the tab
 * stop, and behind every value is a real `<input type="radio">` under the
 * group's `name`, which is what submits with the form and what a reset puts
 * back. What the primitive adds is a name per option — `3 of 5` rather than
 * `3`, because five bare numbers in a row tell a screen reader nothing — a
 * preview for the pointer, and halves.
 *
 * A read-only rating stops being a radio group at all. Five radios nobody can
 * change are five tab stops that do nothing, so the primitive makes the group
 * one `role="img"` whose name is the whole score, and hides the stars from
 * assistive technology. The hidden inputs stay: a read-only score is still
 * the field's answer, and a form has to be able to send it.
 *
 * The score is one signal both sides hold. Pass `value` and it is yours to
 * read and write, `null` meaning unrated; pass nothing and the rating owns
 * it. The primitive counts in numbers with zero for unrated, and the two
 * spellings are kept in step here rather than handed to the caller to
 * reconcile.
 *
 * The star in the template is the `icon` slot's fallback, which is more than
 * an offer to the caller: a fallback compiles as a block of its own. Written straight into the radio, the `<svg>` would
 * make the compiler parse the radio's whole row inside an `<svg>`, and the
 * radio would be created as an SVG element, which a browser does not draw
 * outside an `<svg>` at all.
 */
@Component({ selector: 'v-rating', templateUrl: './rating.html' })
export class VRating {
  /** Your own signal, when the score belongs to your component. `null` is unrated. */
  @Prop() value?: Signal.State<number | null>;

  /**
   * Everything from here to `name` is what the primitive is built with, read
   * once while this field list initializes — plain, because a signal would
   * promise a caller they can change it later and the primitive would never
   * hear it. `onValueChange` is plain for the other reason a prop may be: the
   * template never reads it.
   */
  /**
   * Where it starts when the score is the rating's own, and what a reset goes
   * back to. Default unrated.
   */
  @Prop() defaultValue?: number | null;
  /** How many stars. Default 5. `max="10"` means the number 10, as `:max="10"` does. */
  @Prop() max = 5;
  /**
   * Offer halves as well as wholes: every star becomes two radios, the half
   * before the whole. Written bare — `halves` — or bound.
   */
  @Prop() halves = false;
  /**
   * The group's id.
   *
   * Declared rather than left to `:host` so that the one id is the one the
   * primitive writes: on the tag alone it would land on the group, and the
   * primitive's bag, spread onto the same element, would write an id of its
   * own making over it.
   */
  @Prop() id?: string;
  /** What every radio submits under, and what makes them one group; without it nothing submits. */
  @Prop() name?: string;
  /**
   * Called with the score a user chose or a form reset put back, `null`
   * meaning unrated — which is what Delete and Backspace leave. Your signal
   * already holds it by then. Looked up each time it is called, so a
   * callback bound to something that changes is the one that hears.
   */
  @Prop() onValueChange?: (value: number | null) => void;

  /**
   * The group's name: the question the stars answer.
   *
   * A radio group takes no name from the radios inside it — the words belong
   * to each choice, not to the question — so without this, `aria-label` or
   * `aria-labelledby`, a screen reader hears five options and never what they
   * rate. A read-only rating is named by its score instead, and this is not
   * spoken.
   */
  @Prop() label = new Signal.State<string | undefined>(undefined);
  /**
   * Each option's name, given its value and the top of the range. Default
   * `3 of 5`, with the number written the way the page's language writes it.
   *
   * A signal, because the primitive asks for it every time it names a star:
   * a wording swapped for another reaches a rating already on screen.
   */
  @Prop() format = new Signal.State<Wording | undefined>(undefined);
  /**
   * The whole score as one sentence, given the score and the top of the
   * range: the name a read-only rating goes by. Default `Rated 3 of 5`.
   *
   * It is the only name a read-only rating has — its stars are hidden from
   * assistive technology, and neither `label` nor `format` is spoken there —
   * so a page in another language needs it as well as `format`. A signal for
   * the reason `format` is one.
   */
  @Prop() formatScore = new Signal.State<Wording | undefined>(undefined);

  /**
   * The group's name in the platform's own spelling. It wins over `label`.
   *
   * Declared rather than left to fall through to `:host`, which is the group
   * — the element the primitive's bag is spread onto as well. The bag names
   * `aria-label` itself, from `label` while the stars can be chosen and from
   * the score while they cannot, and a spread takes back what it stops
   * carrying: a name written on the tag would be overwritten by the first and
   * removed the first time read-only ended. A declared prop is never a host
   * attribute, so writing it down brings it here, where it is merged in.
   */
  @Prop({ alias: 'aria-label' }) ariaLabel = new Signal.State<string | undefined>(undefined);
  /**
   * Id of the element that names the group, when something on the page
   * already asks the question. It wins over `label` and `aria-label`, which
   * are left off while it is there. Dropped while read-only, as the primitive
   * drops its own: a reference outranks `aria-label`, and would leave the
   * score that is the read-only name unsaid.
   */
  @Prop({ alias: 'aria-labelledby' }) ariaLabelledBy = new Signal.State<string | undefined>(
    undefined,
  );

  /**
   * Refuses the press, the pointer and the keyboard, and is written through
   * to the hidden inputs so that a disabled rating submits nothing.
   *
   * A disabled radio group is the package's one exception to keeping a
   * disabled control in the tab order: it has no tab stop at all. Written
   * bare or bound; `disabled="false"` is off.
   */
  @Prop() disabled = new Signal.State(false);
  /**
   * Shows a score nobody can change.
   *
   * No radios, no tab stop, no preview: the group is an image named by the
   * whole score. The hidden inputs still carry it into the form, which is
   * what tells read-only apart from disabled. Written bare or bound;
   * `readOnly="false"` is off.
   */
  @Prop() readOnly = new Signal.State(false);

  /**
   * The group element.
   *
   * A signal rather than a plain field because the primitive watches it: the
   * radios are found by querying this element, and nothing can be found until
   * it is there.
   */
  group = new Signal.State<Element | null>(null);

  /** The caller's signal, checked once, while the tag is still what could be wrong. */
  private readonly own: Signal.State<number | null> | undefined =
    this.value === undefined ? undefined : ownSignal(this.value);

  /** How many stars, checked once, before the score that has to fit inside them. */
  private readonly top: number = count(this.max);

  /**
   * The score as the primitive holds it: a number, with zero for unrated.
   *
   * Its own signal even when the caller passed one, because the caller's says
   * `null` where this says zero and the primitive can hold only the second.
   * Private, so that every write to it goes through the primitive, which
   * reports each one — and that report is where the caller's signal is told.
   *
   * A `defaultValue` outside the stars starts at the nearest end. It is what
   * a reset goes back to, and the primitive's reset puts back the nearest
   * end: started anywhere else, a reset with nothing changed would move the
   * score and report a change nobody made. Seven of five was five full stars
   * with no radio checked, so a form sent nothing for a rating that looked
   * full. A caller's own signal is theirs, and is shown as it is.
   */
  private readonly score: Signal.State<number> = new Signal.State(
    this.own
      ? (untrack(() => this.own!.get()) ?? 0)
      : Math.min(Math.max(numeric(this.defaultValue) ?? 0, 0), this.top),
  );

  /**
   * The primitive, built from the props above — which is why props have to be
   * there while a field initializes.
   */
  readonly rating: Rating = createRating({
    group: () => this.group.get(),
    value: this.score,
    max: this.top,
    allowHalf: flag(this.halves),
    disabled: () => flag(this.disabled.get()),
    readOnly: () => flag(this.readOnly.get()),
    labels: this.labels(),
    ...(this.id !== undefined ? { id: this.id } : {}),
    ...(this.name !== undefined ? { name: this.name } : {}),
    // Always given, because this is the one place every change the primitive
    // makes is reported — a press, a key, Delete, a reset — and so where the
    // caller's signal catches up. Before their callback rather than after it,
    // so a callback that reads the signal reads the score it is being told
    // about.
    onValueChange: (score: number) => {
      const next = nullable(score);
      if (this.own && untrack(() => this.own!.get()) !== next) this.own.set(next);
      this.onValueChange?.(next);
    },
  });

  /** Every value a radio stands for, in order: wholes, or the half before each whole. */
  readonly values: readonly number[] = this.rating.values();

  /**
   * The stars, each with the values it offers: one, or the half and the whole.
   * Taken from the primitive's own list, so the two cannot disagree about
   * what a value is.
   */
  readonly stars: readonly { readonly at: number; readonly values: readonly number[] }[] = (() => {
    const stars = new Map<number, number[]>();
    for (const value of this.values) {
      const at = Math.ceil(value);
      stars.set(at, [...(stars.get(at) ?? []), value]);
    }
    return [...stars].map(([at, values]) => ({ at, values }));
  })();

  constructor() {
    // A preview is the pointer asking what a press would choose, and the
    // primitive stops starting one once nothing can be chosen — but one
    // already showing stays until the pointer moves. Locked under a resting
    // pointer, the stars would go on showing the preview beside a name that
    // says the score, so it is let go here the moment either state arrives.
    effect(() => {
      if (this.rating.isReadOnly() || flag(this.disabled.get())) {
        untrack(() => this.rating.preview(null));
      }
    });

    const own = this.own;
    if (!own) return;

    // The other direction: a score the caller writes into their own signal.
    // Not reported back to them, since they already know it. The read of the
    // primitive's side is untracked, because an effect that read both would
    // run itself.
    effect(() => {
      const next = own.get() ?? 0;
      if (untrack(() => this.score.get()) !== next) this.score.set(next);
    });
  }

  /**
   * What the group carries: the primitive's bag, and the reference that has
   * to follow a signal.
   *
   * Only while the rating can be changed. Read-only, the group is an image
   * whose one name is the score, and a reference left beside that name would
   * outrank it and never say the number — which is the primitive's own
   * decision, kept here.
   *
   * A reference and a name are never both written. An element carrying both
   * is named by the reference, and the ignored name drifts out of date where
   * nobody hears it.
   */
  groupProps(): InputProps {
    const props = this.rating.groupProps();
    if (this.rating.isReadOnly()) {
      // The primitive borrows the field's ARIA for the image as it does for
      // the group, and with it `aria-readonly` — a state only a control can
      // be in, and one `role="img"` does not allow. The name already says
      // the score is a fact.
      const { 'aria-readonly': _readOnly, ...image } = props;
      // Disabled as well, the hidden radios are, and the score is no longer
      // sent with the form. The primitive's image leaves `data-disabled` off,
      // which drew a score the form will not send exactly like one it will;
      // it is written here, where the sheet's out-of-use look selects on it.
      return flag(this.disabled.get()) ? { ...image, 'data-disabled': true } : image;
    }
    const from = said(this.ariaLabelledBy.get());
    if (from === undefined) return props;
    const referenced: Record<string, string | boolean | undefined> = {
      ...props,
      'aria-labelledby': from,
    };
    delete referenced['aria-label'];
    return referenced;
  }

  /**
   * What one radio carries: the primitive's bag, and whether it is lit by the
   * pointer alone.
   *
   * The primitive marks every star at or below the value it is showing as
   * filled, and the value it shows is the preview while there is one. Which
   * of those stars are the score and which the pointer's is a comparison of
   * numbers the sheet cannot make, so it is made here: a star beyond the
   * score is marked, and the sheet draws it lighter, so the score stays
   * visible under the preview.
   */
  itemProps(value: number): InputProps {
    const props: Record<string, string | boolean | undefined> = { ...this.rating.itemProps(value) };
    if (this.rating.value() < value && this.rating.displayValue() >= value) {
      props['data-preview'] = true;
    }
    if (this.strandedStop() === value) props['tabindex'] = '0';
    return props;
  }

  /**
   * The radio that holds the tab stop when no checked radio holds it, or
   * `undefined` while one does.
   *
   * The primitive gives the tab stop to the checked radio, or to the first
   * while there is no score. Both halves of that can leave the rating with
   * no stop at all, and a keyboard unable to reach it:
   *
   * - A score between the steps — an average, or `2.5` where the stars count
   *   in wholes, either of which a caller's signal or `defaultValue` can hold,
   *   or `7` out of five, which a caller's signal can — checks no radio and is
   *   not "no score", so the stop went to nothing. It goes to the last star
   *   the score fills, which is what the eye takes for the score.
   * - With no score, "the first" is looked up once, when the group appears,
   *   among the stars that are not disabled — so a rating that starts
   *   disabled, or read-only with no radios at all, or is cleared while
   *   read-only, finds none and keeps finding none once it is in use again.
   *   The first star is known without looking, and it is given here.
   *
   * Only where the stars can be chosen: disabled has no tab stop by design,
   * and read-only has no radios.
   */
  private strandedStop(): number | undefined {
    if (this.rating.isReadOnly() || flag(this.disabled.get())) return undefined;
    const score = this.rating.value();
    if (this.values.includes(score)) return undefined;
    return this.values.findLast((value) => value <= score) ?? this.values[0];
  }

  /**
   * The names, read through rather than handed over.
   *
   * The primitive reads `labels.group`, `labels.item` and `labels.value`
   * every time it builds a bag — that is how a catalogue swapped later
   * reaches a rating already on screen — so a getter is all it takes for a
   * signal to reach the group's name, every option's, and the score's. What
   * the caller wrote in ARIA wins over the prop that says the same thing: two
   * spellings of one name can only disagree by mistake, and the attribute is
   * the one they wrote on the tag.
   *
   * A method rather than an object literal in the field that uses it,
   * because a getter written there would read its own literal's `this`, not
   * this instance's.
   */
  private labels(): RatingLabels {
    const { ariaLabel, label, format, formatScore } = this;
    return {
      get group(): string | undefined {
        return said(ariaLabel.get()) ?? said(label.get());
      },
      get item(): Wording | undefined {
        return format.get();
      },
      get value(): Wording | undefined {
        return formatScore.get();
      },
    };
  }
}
