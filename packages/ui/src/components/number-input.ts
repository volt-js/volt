import { Component, Prop, Signal, effect, onCleanup } from '@voltdev/core';
import {
  createNumberInput,
  type FormFieldOptions,
  type InputProps,
  type NumberInput,
  type NumberInputLabels,
  type ValidationTrigger,
} from '@voltdev/primitives';

const { untrack } = Signal.subtle;

/**
 * A number field in the reader's language: the label, the box, a button each
 * way, a line of help, and the message.
 *
 * ```html
 * <v-number-input :value="quantity" label="Quantity" name="quantity" :min="1" :max="99"
 *                 description="Up to 99 per order." :prop-error="refused.get()"></v-number-input>
 * ```
 *
 * The box is `type="text"` with `role="spinbutton"`, and the reason is
 * locales: much of the world writes 1234.56 as "1.234,56", and a native number
 * input hands back an empty string for it. So the primitive parses and formats
 * through `Intl`, in the locale the page provides or the one written here,
 * and a hidden input beside the box carries the canonical spelling into the
 * form — what a server reads is "1234.56" whatever the box says. The range
 * and the step, which the platform would have checked for `type="number"`,
 * are checked by the primitive instead and said through the field's own
 * message, so the browser refuses the submit for the reason on screen.
 *
 * It is `<v-input>`'s field with a spinbutton in the middle, and the same
 * field on purpose: an input, a textarea, a number field and a password field
 * are one design with different contents, so the label, the box, the help and
 * the message wear the sheet's `field` entry. What is this component's own is
 * the row the box sits in and the two spin buttons at its inline end, which
 * the primitive names, steps and switches off at the ends of the range.
 *
 * All four parts are drawn whether or not they have anything to say, and the
 * error is the reason. It is a live region, and a live region that arrives
 * already holding its message is one no screen reader was watching — while
 * validation is reported at submit, when focus is on the button and not on the
 * field, so an unannounced message is no message at all. The empty line it
 * holds is also the line the message will take, so a form that fails does not
 * push itself down the page.
 *
 * What a caller writes on the tag reaches the box. It is the control, the
 * element carrying the role, and the only one a name or a `data-*` says
 * anything about; the row and the field around it are layout. The ARIA
 * attributes a caller might write that the primitive also has an opinion
 * about — the field's three names and the spinbutton's `aria-valuetext` — are
 * declared as props below rather than left to fall through, because a
 * caller's own would otherwise be written over by the primitive's a moment
 * later — or, in `aria-label`'s case, left on the element and outranked by the
 * reference the field points at its own label, which is the same loss said
 * more quietly.
 */
@Component({ selector: 'v-number-input', templateUrl: './number-input.html' })
export class VNumberInput {
  /** Your own signal, when the number belongs to your component. `null` is empty. */
  @Prop() value?: Signal.State<number | null>;

  /**
   * Everything from here to `onValueChange` is what the primitive is built
   * with, read once while this field list initializes — plain, because a
   * signal would promise a caller they can change it later and the primitive
   * would never hear it.
   *
   * The numbers among them are read as numbers whichever way they were
   * written. An attribute arrives as its spelling, and a step that is the
   * string "1" would add itself to the value as text. The two flags are read
   * as flags the same way, so `clampOnBlur="false"` is off rather than the
   * truthy string it arrives as; and a locale or an id that came to nothing
   * is not said at all, since `Intl` throws on an empty locale and an empty id
   * points the label at no element.
   */
  /** Where it starts when the value is the field's own, and what a reset goes back to. */
  @Prop() defaultValue?: number | null;
  /**
   * The control's id, and so the `for` of the label above it.
   *
   * Declared rather than left to `:host` so that the one id is the one both
   * halves use: written on the tag alone it would land on the box after the
   * field had already pointed the label at an id of its own making.
   */
  @Prop() id?: string;
  /** Submitted as `name=value`, from the hidden input. Without a name the field submits nothing. */
  @Prop() name?: string;
  /** Shown in an empty box. Not a label: it is gone the moment anyone types. */
  @Prop() placeholder?: string;
  /** The smallest value. Below it the arrows stop, and a typed value is pulled back or reported. */
  @Prop() min?: number;
  /** The largest value, on the same terms. */
  @Prop() max?: number;
  /** How far one arrow press moves. Default 1. A constraint only with `enforceStep`. */
  @Prop() step?: number;
  /** How far PageUp and PageDown move. Default ten steps. */
  @Prop() largeStep?: number;
  /** Report a value off the step's grid as invalid, rather than only moving by it. */
  @Prop() enforceStep = false;
  /** Pull a value outside the range back into it when the field is left. `:clampOnBlur="false"` reports it instead. */
  @Prop() clampOnBlur = true;
  /** The locale to read and write in, for a field that is deliberately not the page's. */
  @Prop() locale?: string;
  /**
   * How the number is written: `Intl.NumberFormat` options, for a currency
   * or a fixed precision. What it writes is read back whenever the field is
   * left, so it has to be a spelling the primitive's parser reads — a
   * precision, or a currency whose symbol comes first. Text after the number,
   * `1.5 kg` or `1.234,50 €`, is misread as a larger number today, and so is
   * a `percent`, whose "25%" comes back as 25.
   */
  @Prop() format?: Intl.NumberFormatOptions;
  /**
   * Validation the primitive cannot express. Return nothing for a pass.
   *
   * Handed the box's text as typed — "1.234,5" on a German page — not the
   * number, because it is the field's validator and the field validates what
   * is in the control. `Number()` on that text is wrong in most of the world;
   * `parseLocaleNumber` reads it the way the field does.
   */
  @Prop() validate?: FormFieldOptions['validate'];
  /** When the field first validates. Default `submit`. */
  @Prop() validateOn?: ValidationTrigger;
  /** When it validates again, once it has validated at all. Default `input`. */
  @Prop() revalidateOn?: ValidationTrigger;
  /** Your wording: the two buttons' names, and what is wrong with a value, in your users' language. */
  @Prop() labels?: NumberInputLabels;
  /** Called with the number, or `null` for an empty or unreadable box, on every change. */
  @Prop() onValueChange?: (value: number | null) => void;

  /** The words above the box. Markup instead, in the `label` slot. */
  @Prop() label = new Signal.State('');
  /** The line under it, shown whether or not the field is valid. */
  @Prop() description = new Signal.State('');
  /**
   * A message of your own — a server's refusal, usually — shown at once and
   * pushed into the control, so the platform refuses the submit for it too.
   *
   * It is a verdict on the value as it stands, and the next change to the box
   * lets go of it, whether typed, stepped by an arrow or a button, or written
   * from your own signal: the platform at once, so the next submit is not
   * refused on the old value's account, and this prop with it, so the two
   * agree. A message that survived every correction would be a form nobody
   * could submit. A form reset lets go of it as well. What is bound here is
   * written in whenever it changes, so the same words a second time are a
   * change only if your own value was cleared in between.
   *
   * A message handed over while the field is disabled or read-only is held,
   * since nothing is judged while it is out of use, and said the moment it is
   * back.
   *
   * Bound as `:prop-error`: `error` is a DOM event's name as well, and
   * `:error` on any tag is read as a listener for it. Written out —
   * `error="…"` — it is a prop like any other.
   */
  @Prop() error = new Signal.State('');

  /** Written through to the box, so the platform enforces it on submit. */
  @Prop() required = new Signal.State(false);
  /**
   * Written through to the box as the platform's own `disabled`.
   *
   * Not `aria-disabled` alone, which is this package's rule where the visible
   * control is not a native one. Here it is: a disabled field is not part of
   * the form, and only the attribute takes it out — on the hidden input that
   * carries the number as well as on the box, since that is what submits.
   * Both spin buttons go dead with it.
   */
  @Prop() disabled = new Signal.State(false);
  /** Refuses edits and the arrows, keeps the tab stop, and is never validated. */
  @Prop() readOnly = new Signal.State(false);

  /**
   * Names the box, in the platform's own spelling.
   *
   * Declared rather than left to `:host` because landing it on the element is
   * not enough to make it the name. `aria-labelledby` outranks `aria-label` in
   * every accessible name there is, and the field points the first at its own
   * label — so a name written here would reach the box and name nothing. Given
   * one, the field stands its own reference down, which is what a plain
   * `<input>` beside a `<label for>` does as well: there the label is the
   * weaker of the two, and it should not become the stronger for being this
   * component's. The `for` stays either way, so a press on the words still
   * puts the caret in the box.
   */
  @Prop({ alias: 'aria-label' }) ariaLabel = new Signal.State<string | undefined>(undefined);
  /**
   * Names the control from somewhere else on the page, instead of the label.
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
   * How the value is read out — "5 guests", "two and a half hours" — when the
   * number alone does not say it.
   *
   * The spinbutton's own attribute, and the one ARIA expects an author to
   * write. Declared rather than left to `:host` because the primitive writes
   * it too, whenever the formatted text differs from the bare number, and
   * takes it away again when it does not: left to fall through, a caller's
   * words would be written over at "1,234" and removed at 6. Given here, they
   * win; unsaid, the field's own spelling is read out as before.
   */
  @Prop({ alias: 'aria-valuetext' }) valueText = new Signal.State<string | undefined>(undefined);

  /**
   * The four parts, as elements.
   *
   * Signals rather than plain fields because the primitive watches them: none
   * of the four exists while this class is being built, and the ids and the
   * references between them are written the moment each does.
   */
  labelEl = new Signal.State<Element | null>(null);
  control = new Signal.State<Element | null>(null);
  descriptionEl = new Signal.State<Element | null>(null);
  errorEl = new Signal.State<Element | null>(null);

  /**
   * The primitive, built from the props above — which is why props have to be
   * there while a field initializes.
   */
  readonly number: NumberInput = createNumberInput({
    input: () => this.control.get(),
    label: () => this.labelEl.get(),
    description: () => this.descriptionEl.get(),
    errorMessage: () => this.errorEl.get(),
    required: () => this.required.get(),
    disabled: () => this.disabled.get(),
    readOnly: () => this.readOnly.get(),
    enforceStep: flag(this.enforceStep, false),
    clampOnBlur: flag(this.clampOnBlur, true),
    ...(this.value ? { value: this.value } : {}),
    ...(this.defaultValue !== undefined ? { defaultValue: numeric(this.defaultValue) ?? null } : {}),
    ...(said(this.id) !== undefined ? { id: said(this.id) } : {}),
    ...(this.name !== undefined ? { name: this.name } : {}),
    ...(this.placeholder !== undefined ? { placeholder: this.placeholder } : {}),
    ...(numeric(this.min) !== undefined ? { min: numeric(this.min) } : {}),
    ...(numeric(this.max) !== undefined ? { max: numeric(this.max) } : {}),
    ...(numeric(this.step) !== undefined ? { step: numeric(this.step) } : {}),
    ...(numeric(this.largeStep) !== undefined ? { largeStep: numeric(this.largeStep) } : {}),
    ...(said(this.locale) !== undefined ? { locale: said(this.locale) } : {}),
    ...(this.format ? { formatOptions: this.format } : {}),
    ...(this.validate ? { validate: this.validate } : {}),
    ...(this.validateOn ? { validateOn: this.validateOn } : {}),
    ...(this.revalidateOn ? { revalidateOn: this.revalidateOn } : {}),
    ...(this.labels ? { labels: this.labels } : {}),
    ...(this.onValueChange ? { onValueChange: this.onValueChange } : {}),
  });

  /**
   * Whether the last change to `error` was the box letting go of it.
   *
   * The field drops a custom message on the next edit and leaves the rest of
   * the verdict on screen until `revalidateOn` says otherwise. Telling it the
   * message is gone would have it judge the value again now, ahead of that —
   * so a clearing that came from the edit is not passed on.
   */
  private letGo = false;

  constructor() {
    // A user effect's first run waits for the tree to settle, so the box is
    // there to be told by then and a message written on the tag is on screen
    // from the first frame.
    effect(() => {
      const message = this.error.get();
      const fromEdit = this.letGo;
      this.letGo = false;
      if (message === '' && fromEdit) return;
      // Untracked, because settling the field reads its own signals, and this
      // has to follow the caller's message and nothing else.
      untrack(() => this.number.field.setCustomValidity(message));
    });

    // The text rather than the `input` event, because a number field changes
    // in more ways than typing: an arrow, a button, a blur that reformats, a
    // write to the caller's signal. Each of those reaches the field as an
    // edit, and the field lets go of the message on every one — so the prop
    // follows the text, which is the one thing they all move. The first run
    // only notes where the text starts, since what the box held when it
    // first appeared is nobody's edit.
    //
    // It is also where a verdict on a keystroke is made current. The field
    // hears the box's `input` before the primitive has read the box, so the
    // number's own check, run on that edit, judges the text from before the
    // keystroke — and pushes its verdict into the platform, which refuses the
    // submit before any listener could ask again. Backspace "x" to nothing, or
    // type "5" over "abc", and "Enter a number." would stay on a box that is
    // fine, with every submit refused for it until another keystroke. By the
    // time this runs the text is current, so a field that edit left invalid
    // is judged again — only one whose verdict follows every edit, since
    // under any other `revalidateOn` the edit asked nothing and the platform
    // has already let go. An invalid verdict was settled where it was given,
    // with nothing in flight, so asking again asks no server twice.
    let shown: string | undefined;
    effect(() => {
      const text = this.number.text();
      const before = shown;
      shown = text;
      if (before === undefined) return;
      untrack(() => {
        this.edited();
        const field = this.number.field;
        if ((this.revalidateOn ?? 'input') === 'input' && field.isInvalid()) void field.validate();
      });
    });

    // A reset forgets every message the field held, whether or not it moved
    // the text — a box already at its default moves nothing, and the effect
    // above hears nothing. The prop follows here instead, or it would go on
    // holding a message the field had put down, and the effect below would
    // bring it back the next time the field came back into use.
    effect(() => {
      const control = this.control.get();
      const form = control ? formOf(control) : null;
      if (!form) return;
      const reset = (event: Event): void => {
        // A reset a listener called off put nothing back, and the field kept
        // what it held.
        if (event.defaultPrevented) return;
        this.edited();
      };
      form.addEventListener('reset', reset);
      onCleanup(() => form.removeEventListener('reset', reset));
    });

    // The field judges nothing while it is disabled or read-only, so a
    // message handed to it then is held and not shown — and when it comes
    // back into use, nothing in the field asks again. A page that takes the
    // field out of use while it asks a server, and hears back before handing
    // it over, would otherwise have its refusal wait for a submit the user
    // has no reason to make. So a message still standing is said again; one
    // an edit or a reset let go of is gone from the prop, and stays gone.
    let inUse: boolean | undefined;
    effect(() => {
      const now = !this.disabled.get() && !this.readOnly.get();
      const before = inUse;
      inUse = now;
      if (!now || before !== false) return;
      const message = untrack(() => this.error.get());
      if (message !== '') untrack(() => this.number.field.setCustomValidity(message));
    });
  }

  /**
   * What the box carries: the primitive's bag, with the three names and the
   * caller's `aria-valuetext` merged into it rather than written beside it.
   *
   * `:spread` rewrites the element whenever what it reads changes and takes
   * back the keys the new object does not carry, so an attribute applied next
   * to it — by a second spread, which is what `:host` is — is an attribute one
   * of the two silently wins. Merging here makes the outcome the same whatever
   * order they run in.
   *
   * A name the caller gave wins over the field's own label, whichever way they
   * spelled it: naming the control is the only reason to write either.
   * `aria-labelledby` replaces the field's reference, and `aria-label` stands
   * it down, because a reference left beside it would outrank the words they
   * wrote. A description is added to the field's instead: the help and the
   * message under the box describe this control whatever else on the page also
   * does, and they come first because a screen reader reads them in the order
   * they are named. A spoken value the caller gave replaces the field's own
   * spelling, since saying the value is the only reason to write one.
   *
   * Nothing is not a name. An id a caller has not chosen yet is an empty
   * string, and treating one as a reference points the box at no id at all,
   * which cuts it loose from the very label this prop exists to replace. So
   * each is trimmed and an empty one is read as unsaid.
   */
  inputProps(): InputProps {
    const own = this.number.inputProps();
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
      'aria-valuetext': said(this.valueText.get()) ?? own['aria-valuetext'],
    };
  }

  /**
   * What the hidden input carries: the primitive's, out of the form while the
   * field is.
   *
   * The number submits from here and not from the box, which has no name. So
   * the platform's `disabled` on the box takes nothing out of the request by
   * itself, and a disabled field would go on sending its number — which is
   * not what a disabled control does, and not what `disabled` above says it
   * does. Read-only is left alone: a read-only control submits.
   */
  hiddenProps(): InputProps {
    const own = this.number.hiddenInputProps();
    return this.disabled.get() ? { ...own, disabled: true } : own;
  }

  /**
   * The message on screen: the first of them.
   *
   * One line rather than the list, because the platform takes one string too —
   * so the sentence a reader is given is the same sentence the browser refused
   * the submit over, rather than one of several they have to match up.
   */
  message(): string {
    return this.number.field.messages()[0] ?? '';
  }

  /**
   * A key for the spinbutton, unless an input method is using it.
   *
   * Mid-word — a Japanese or Chinese keyboard composing full-width digits —
   * the arrows choose among the candidates and Enter commits one. Handed to
   * the primitive, an arrow would move the value under a word still being
   * written and Enter would rewrite the box before the word was in it. The
   * keys are the field's again once the word is composed.
   */
  keydown(event: KeyboardEvent): void {
    if (event.isComposing) return;
    this.number.onKeyDown(event);
  }

  /**
   * A press on a spin button leaves focus where it was.
   *
   * The buttons are out of the tab order and hidden from assistive
   * technology, because the spinbutton's own arrow keys do their job. A mouse
   * press focuses a button all the same, which would put focus on an element
   * a screen reader is told is not there, and take the arrow keys away from
   * the box until it is clicked again. Focus moving is the press's default,
   * so refusing it keeps focus in the box; the click still comes.
   */
  stay(event: MouseEvent): void {
    event.preventDefault();
  }

  /** An edit: the field has let go of the caller's message, so the prop follows. */
  private edited(): void {
    if (this.error.get() === '') return;
    this.letGo = true;
    this.error.set('');
  }
}

/** What a caller actually wrote, or nothing at all if it came to nothing. */
function said(value: string | boolean | undefined): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

/** The form the box submits with: its own `form`, or the nearest around it. */
function formOf(control: Element): HTMLFormElement | null {
  return (control as HTMLInputElement).form ?? control.closest('form');
}

/**
 * A flag, as a tag is able to deliver one.
 *
 * Written bare it is on, and bound it is whatever it was bound to. Written as
 * an attribute it is a string, and every string is truthy — so
 * `clampOnBlur="false"`, the only reason to write that one at all, would have
 * clamped, and `enforceStep="false"` would have enforced. Every string is on
 * here but `"false"`, which nobody writes meaning on; nothing at all is the
 * default.
 */
function flag(value: boolean, fallback: boolean): boolean {
  // Typed as a flag and handed a string all the same: the type is what the
  // tag promises, and an attribute is what it delivers.
  const written: unknown = value;
  if (written === undefined || written === null) return fallback;
  return written !== false && written !== 'false';
}

/**
 * A number, however the caller wrote it.
 *
 * `:min="1"` arrives as a number and `min="1"` as its spelling, and the
 * primitive does arithmetic on both. A spelling that is not a number, or an
 * attribute written with nothing after it, is no number at all.
 */
function numeric(value: number | string | boolean | null | undefined): number | undefined {
  if (typeof value === 'number') return Number.isNaN(value) ? undefined : value;
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}
