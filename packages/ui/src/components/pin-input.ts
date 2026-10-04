import { Component, Prop, Signal, effect, isWritableSignal } from '@voltdev/core';
import {
  createPinInput,
  type InputProps,
  type PinInput,
  type PinInputLabels,
} from '@voltdev/primitives';

const { untrack } = Signal.subtle;

/**
 * A flag, as a tag is able to deliver one.
 *
 * Written bare it is on, and bound it is whatever it was bound to. Written as
 * an attribute it is a string, and every string is truthy — so `mask="false"`
 * would have drawn dots over a code the caller had said was not a secret, and
 * `disabled="false"` taken the field out of the form. Every string is on here
 * but `"false"`, which nobody writes meaning on — for `mask`, and for the
 * `required` and `disabled` signals each time they are read.
 */
function flag(value: boolean): boolean {
  // Typed as a flag and handed a string all the same: the type is what the
  // tag promises, and an attribute is what it delivers.
  const written: unknown = value;
  return written !== false && written !== 'false' && written !== null && written !== undefined;
}

/**
 * How many boxes, as an attribute is able to carry it.
 *
 * `length="4"` arrives as the string `'4'`, which the primitive would keep
 * and compare the code's length against with `===` — so four characters would
 * never equal `'4'`, no code would ever be complete, and `onComplete` would
 * never be called, with nothing to say why. A string that is a number is that
 * number; anything that is not a whole number of boxes is refused while the
 * prop is still the thing that is wrong.
 */
function count(value: number): number {
  const written: unknown = value;
  // Bound to nothing is not written, as it is for a flag: a wrapper that
  // forwards a `length` its own caller left out hands over `undefined`, and
  // that is a call for the default rather than a mistake to stop the page on.
  if (written === undefined || written === null) return 6;
  // `Number` reads `' 4 '` as 4 and a blank string as 0, which is refused
  // below with everything else that is not a count.
  const parsed =
    typeof written === 'number' || typeof written === 'string' ? Number(written) : Number.NaN;
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(
      `[volt] \`length\` on <v-pin-input> takes a whole number of boxes, and ` +
        `\`${String(value)}\` is not one.`,
    );
  }
  return parsed;
}

/**
 * What a box takes, refused here rather than read loosely by the primitive.
 *
 * The primitive has a third kind, `any`, for everything but a space, and that
 * is what anything it does not recognise falls through to — so `type="number"`,
 * which is what a caller reaches for meaning digits, let letters into a numeric
 * code and named every box a character.
 */
function kind(value: 'numeric' | 'alphanumeric'): 'numeric' | 'alphanumeric' {
  const written: unknown = value;
  // Bound to nothing, the default, for the reason `count` gives.
  if (written === undefined || written === null) return 'numeric';
  if (value === 'numeric' || value === 'alphanumeric') return value;
  throw new Error(
    `[volt] \`type\` on <v-pin-input> is \`numeric\` or \`alphanumeric\`, and ` +
      `\`${String(value)}\` is neither.`,
  );
}

/**
 * The caller's own signal, or nothing.
 *
 * `value="2468"` arrives as the string, and the primitive would hold it as its
 * state and call `.get()` on it in an effect — a TypeError naming nothing the
 * caller wrote. Where the code starts is `defaultValue`.
 */
function own(value: Signal.State<string> | undefined): Signal.State<string> | undefined {
  if (value === undefined || value === null) return undefined;
  if (isWritableSignal(value)) return value;
  throw new Error(
    `[volt] \`value\` on <v-pin-input> takes a signal, and \`${String(value)}\` is not one. ` +
      `Bind \`:value\` to a Signal.State<string> to hold the code yourself, or write ` +
      `\`defaultValue\` for where it starts.`,
  );
}

/** What a caller actually wrote, or nothing at all if it came to nothing. */
function said(value: string | boolean | undefined): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

/**
 * A code, one box per character: the label, the row of boxes, a line of help
 * and the message.
 *
 * ```html
 * <v-pin-input :value="code" name="code" label="Verification code"
 *              description="Sent by text message." :onComplete="verify"></v-pin-input>
 * ```
 *
 * The boxes are a presentation of one value, and `createPinInput` makes them
 * act like one field: a paste into any box fills them all, Backspace in an
 * empty box goes back and deletes, and the group holds a single tab stop with
 * the arrows moving inside it — Tab steps over the whole code in one press
 * rather than six. There are no holes: focusing a box beyond the first empty
 * one lands on the first empty one, because a code with a gap in it is not a
 * code.
 *
 * What submits is a hidden `<input>` carrying the whole code under `name`.
 * It is the field's control — what `FormData` reads, what the platform
 * validates `required` against and what `form.reset()` restores — and the
 * boxes borrow its ARIA: the group is what a screen reader hears as the
 * field, and each box is "Digit 3 of 6". The label's `for` points at the
 * box where the next character goes rather than at the hidden input, so a
 * press on the words puts the caret where typing resumes, as Tab does.
 *
 * `:host` is on the group, which is the element carrying the role and the
 * one the row of boxes is: a class written on the tag lays the row out, and
 * an `aria-label` names the field. The three ARIA attributes the field has an
 * opinion about are declared as props below rather than left to fall through,
 * because the primitive's bag names two of them and a spread re-applied
 * beside a caller's own is a spread that wins or loses by accident.
 *
 * All four parts are drawn whether or not they have anything to say, and the
 * message is the reason: it is a live region, and a live region that arrives
 * already holding its message is one no screen reader was watching.
 */
@Component({ selector: 'v-pin-input', templateUrl: './pin-input.html' })
export class VPinInput {
  /** Your own signal, when the code belongs to your component. */
  @Prop() value?: Signal.State<string>;

  /**
   * Everything from here to `onComplete` is what the primitive is built with,
   * read once while this field list initializes — plain, because a signal
   * would promise a caller they can change it later and the primitive would
   * never hear it.
   */
  /**
   * Where the code starts when it is the field's own, and what a form reset
   * goes back to. With `value`, the signal's own starting code is both.
   */
  @Prop() defaultValue?: string;
  /**
   * How many boxes. Default 6. Written as an attribute or bound, either way a
   * whole number; bound to nothing, the default.
   */
  @Prop() length = 6;
  /**
   * What a box takes: digits, or letters and digits. Default `numeric`, which
   * also asks a phone for its number pad; `alphanumeric` refuses nothing a
   * keyboard has a letter for and names each box a character.
   */
  @Prop() type: 'numeric' | 'alphanumeric' = 'numeric';
  /**
   * Dots in place of the characters, for a code that is a secret. Default
   * off: a one-time code being copied off a text message is not one, and dots
   * over it hide the mistake the user is about to make. Written bare —
   * `mask` — or bound.
   */
  @Prop() mask = false;
  /** Submitted as `name=code`. Without a name the field submits nothing. */
  @Prop() name?: string;
  /**
   * What the platform may fill in, in its own vocabulary. Default
   * `one-time-code`, which is what makes a phone offer the code it has just
   * received. Given to the first box only, which is what autofill expects;
   * the rest of the code arrives through it.
   */
  @Prop() autoComplete = 'one-time-code';
  /**
   * Your wording: each box's name — `box(3, 6)` for the third of six, which
   * is otherwise `Digit 3 of 6` in English whatever the page's language — the
   * line an unfinished code is refused with, and what the platform found
   * wrong, in your users' language.
   */
  @Prop() labels?: PinInputLabels;
  /** Called with the code on every edit — a character typed, deleted or pasted. */
  @Prop() onValueChange?: (value: string) => void;
  /**
   * Called with the code once every box is filled, which is the moment to
   * send it. Once per completion: a paste that fills the row calls it once,
   * and a character deleted and retyped calls it again.
   */
  @Prop() onComplete?: (value: string) => void;

  /** The words above the boxes. Markup instead, in the `label` slot. */
  @Prop() label = new Signal.State('');
  /** The line under them, shown whether or not the code is valid. */
  @Prop() description = new Signal.State('');
  /**
   * Your own verdict on the code, shown under the boxes as the message and
   * pushed into the control, so a submit is refused for the reason on screen.
   *
   * Empty is no verdict. The field lets a verdict go on the next edit, as it
   * does any message — the user is fixing the code, and a message that
   * outlives its correction is how a form becomes impossible to submit — so
   * clear this in `onValueChange` and set it again after the next attempt: a
   * signal set to the string it already holds has not changed, and says
   * nothing.
   *
   * Bound as `:prop-error`: `error` is a DOM event's name as well, and
   * `:error` on a tag is read as that event. Written out — `error="…"` — it
   * is a prop like any other.
   */
  @Prop() error = new Signal.State('');

  /**
   * Written through to the hidden input, so the platform refuses a submit
   * over an empty code, and said on every box in ARIA, which is where a
   * reader is when it is heard.
   */
  @Prop() required = new Signal.State(false);
  /**
   * Written through to every box as the platform's own `disabled`, and to the
   * group in ARIA.
   *
   * Not `aria-disabled` alone, which is this package's rule where the visible
   * control is not a native one. Here every box is: a disabled field is not
   * part of the form, and only the attribute takes it out.
   */
  @Prop() disabled = new Signal.State(false);

  /**
   * Names the group, in the platform's own spelling.
   *
   * Declared rather than left to `:host` because landing it on the group is
   * not enough to make it the name. `aria-labelledby` outranks `aria-label`
   * in every accessible name there is, and the field points the first at its
   * own label — so a name written here would reach the group and name
   * nothing. Given one, the field stands its own reference down. The label's
   * `for` stays either way, so a press on the words still puts the caret
   * where typing resumes.
   */
  @Prop({ alias: 'aria-label' }) ariaLabel = new Signal.State<string | undefined>(undefined);
  /**
   * Names the group from somewhere else on the page, instead of the label.
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
   * references between them are written the moment each does. The group is
   * where the boxes are found, in the order they appear; the hidden input is
   * the control.
   */
  labelEl = new Signal.State<Element | null>(null);
  group = new Signal.State<Element | null>(null);
  hidden = new Signal.State<Element | null>(null);
  descriptionEl = new Signal.State<Element | null>(null);
  errorEl = new Signal.State<Element | null>(null);

  /**
   * The primitive, built from the props above — which is why props have to be
   * there while a field initializes.
   */
  readonly pin: PinInput = createPinInput({
    container: () => this.group.get(),
    hiddenInput: () => this.hidden.get(),
    label: () => this.labelEl.get(),
    description: () => this.descriptionEl.get(),
    errorMessage: () => this.errorEl.get(),
    length: count(this.length),
    type: kind(this.type),
    mask: flag(this.mask),
    autoComplete: this.autoComplete,
    required: () => flag(this.required.get()),
    disabled: () => flag(this.disabled.get()),
    ...(this.name !== undefined ? { name: this.name } : {}),
    ...(own(this.value) ? { value: this.value! } : {}),
    ...(this.defaultValue !== undefined ? { defaultValue: this.defaultValue } : {}),
    ...(this.labels ? { labels: this.labels } : {}),
    ...(this.onValueChange ? { onValueChange: this.onValueChange } : {}),
    ...(this.onComplete ? { onComplete: this.onComplete } : {}),
  });

  /**
   * One index per box, for the template to draw them from.
   *
   * A list rather than the count, because `:for` iterates a collection and
   * over a bare number renders nothing at all — and says nothing about it.
   */
  readonly boxes: readonly number[] = Array.from({ length: this.pin.length() }, (_, i) => i);

  /**
   * The code as it stands when the field is built, a character to a box:
   * what each box and the hidden input carry as their `value` attribute.
   *
   * The primitive writes the code into the boxes and the control as
   * properties, from effects that find them through their refs — and a server
   * sets no ref, so a page rendered there went out with every box empty under
   * a `data-filled` that said otherwise, and a hidden input that submitted
   * nothing until script attached. An attribute is what a server can write.
   *
   * Once, and not as the code changes: the attribute is the control's default,
   * which is what a reset goes back to, and the primitive already makes the
   * starting code the default on the client. This is the same value, there
   * from the start.
   */
  readonly start: readonly string[] = [...untrack(() => this.pin.value())].slice(
    0,
    this.pin.length(),
  );

  constructor() {
    // The caller's verdict, handed to the field once the control it is
    // measured against is on the page: a message given before the hidden
    // input renders is evaluated against nothing and comes back as valid.
    //
    // And held back while the field is out of use, for the same reason. A
    // disabled field validates as valid, so a verdict handed over then is
    // stored, judged to be no complaint, and never looked at again: the page
    // that takes the field out of use while it checks the code, hears back
    // and hands it back would find its "That code is wrong." nowhere — not on
    // screen, and not in the control, so the platform lets the next submit
    // through. It is handed over when the field is back instead.
    //
    // Only what has not been handed over yet: a verdict the field has already
    // let go of on an edit stays gone when the field comes back, rather than
    // being raised again by a change that is not the caller saying anything.
    let handed = '';
    effect(() => {
      const message = this.error.get();
      if (!this.hidden.get() || flag(this.disabled.get()) || message === handed) return;
      handed = message;
      untrack(() => this.pin.field.setCustomValidity(message));
    });
  }

  /**
   * What the group carries: the primitive's bag, with the three names merged
   * into it rather than written beside it.
   *
   * `:spread` rewrites the element whenever what it reads changes and takes
   * back the keys the new object does not carry, so an attribute applied next
   * to it — by a second spread, which is what `:host` is — is an attribute one
   * of the two silently wins. Merging here makes the outcome the same whatever
   * order they run in.
   *
   * The field's own references are worked out from the ids the template hands
   * its parts rather than read off the elements, which is how the primitive
   * answers. A server sets no ref, so its answer there is nothing: the group
   * went out with no name and no description, and the label's words named
   * nobody — its `for` is the first box, whose own `aria-label` outranks it.
   * All three parts are drawn whatever they hold, with exactly these ids, so
   * on the client the two answers are one.
   *
   * A name the caller gave wins over the field's own label, whichever way they
   * spelled it. `aria-labelledby` replaces the field's reference, and
   * `aria-label` stands it down, because a reference left beside it would
   * outrank the words they wrote. A description is added to the field's
   * instead, after them, which is the order a screen reader reads them in.
   * An id a caller has not chosen yet is an empty string, and one of those is
   * read as unsaid rather than as a reference to nothing.
   *
   * `aria-required` is left to the boxes: see `boxProps`.
   */
  groupProps(): InputProps {
    const { 'aria-required': _onTheBoxes, ...own } = this.pin.groupProps();
    const ids = this.pin.field.ids();
    const named = said(this.ariaLabel.get());
    const from = said(this.labelledBy.get());
    const described = [ids.description, ids.errorMessage, this.describedBy.get()]
      .map(said)
      .filter((id): id is string => id !== undefined)
      .join(' ');

    return {
      ...own,
      'aria-label': named,
      'aria-labelledby': from ?? (named ? undefined : ids.label),
      'aria-describedby': described || undefined,
    };
  }

  /**
   * What the label carries: the primitive's bag, with `for` on the box that
   * holds the group's tab stop.
   *
   * The primitive points `for` at the first box, which is where typing starts
   * — and only until something is typed. A press on the words of a half-typed
   * code put the caret on the first box with its character selected, so the
   * rest of the code typed from there replaced what was already entered:
   * 246, a look at the message, a press on the label and 810 came to "810".
   * The tab stop is on the box where the next character goes, which is where
   * Tab brings the user back to, and a press on the label now does the same.
   * Until anything is typed that is the first box, on a server as well.
   */
  labelProps(): InputProps {
    const own = this.pin.labelProps();
    for (const index of this.boxes) {
      const box = this.pin.boxProps(index);
      if (box['tabindex'] === '0') return { ...own, for: box['id'] as string };
    }
    return own;
  }

  /**
   * What a box carries: the primitive's bag, and `aria-required`.
   *
   * The primitive says `required` on the group, and a group cannot carry it:
   * `aria-required` belongs to the widgets a value is entered into, a group
   * is not one, and on one it is an attribute a screen reader does not
   * announce and a checker reports. A box is a textbox, so it is said there —
   * in ARIA only, since a native `required` on each box would have the
   * platform refuse a submit for boxes nobody fills one at a time. The hidden
   * input is what the platform holds to `required`.
   */
  boxProps(index: number): InputProps {
    const own = this.pin.boxProps(index);
    return this.pin.field.isRequired() ? { ...own, 'aria-required': 'true' } : own;
  }

  /**
   * The message on screen: the caller's verdict while it stands, and the
   * first of the field's own otherwise.
   *
   * One line rather than the list, because the platform takes one string too —
   * so the sentence a reader is given is the same sentence the browser refused
   * the submit over, rather than one of several they have to match up. That
   * string is the verdict whenever there is one, and the field lists the
   * platform's own complaints ahead of it: a page that empties a wrong code
   * and says why would otherwise show "Fill in this field." over a `required`
   * row, and keep the reason it gave to the control.
   */
  message(): string {
    const messages = this.pin.field.messages();
    const verdict = this.error.get();
    return verdict && messages.includes(verdict) ? verdict : (messages[0] ?? '');
  }
}
