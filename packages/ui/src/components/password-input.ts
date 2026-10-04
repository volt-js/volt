import { Component, Prop, Signal, effect, onCleanup } from '@voltdev/core';
import {
  createPasswordInput,
  type FormFieldOptions,
  type InputProps,
  type PasswordInput,
  type PasswordInputLabels,
  type ValidationTrigger,
} from '@voltdev/primitives';

const { untrack } = Signal.subtle;

/** What the browser may fill in: the password it holds, or a place for a new one. */
export type PasswordAutocomplete = 'current-password' | 'new-password';

/**
 * A password field: the label, the box, a toggle that shows what is in it, a
 * line of help, and the message.
 *
 * ```html
 * <v-password-input :value="password" label="Password" name="password" required
 *                   :prop-error="refused.get()"></v-password-input>
 * ```
 *
 * It is `<v-input>`'s field with `createPasswordInput` behind it: the same
 * four parts tied together by `createFormField`'s ids, the same moment
 * validation is first allowed to speak, the same real `<input>` that submits,
 * that `FormData` reads and that the platform validates. What the primitive
 * adds is the toggle, and the two things it says about it. The toggle's name
 * moves between `Show password` and `Hide password`, which is what a screen
 * reader reads next time it lands there — and a live region says `Password
 * shown` as well, because a name that changes as a result of pressing the
 * thing it names is not reliably announced at the moment it changes. The
 * region is drawn whether or not anything has been pressed, since one that
 * arrives together with its message announces nothing.
 *
 * The toggle is a `<button type="button">`, so it never submits the form
 * around it and Enter and Space on it are the platform's own. It goes out of
 * use with the field's `disabled` and never with `readOnly`: a value that
 * cannot be edited can still be looked at, and reading it back is the whole
 * reason a read-only password field would exist.
 *
 * What a caller writes on the tag reaches the `<input>`, the element carrying
 * the role. The three ARIA attributes the field has an opinion about are
 * declared as props, for the reasons `<v-input>` gives.
 */
@Component({ selector: 'v-password-input', templateUrl: './password-input.html' })
export class VPasswordInput {
  /** Your own signal, when the text belongs to your component. */
  @Prop() value?: Signal.State<string>;
  /** Your own signal for whether the password is on the screen, when you need to drive it. */
  @Prop() revealed?: Signal.State<boolean>;

  /**
   * Everything from here to `onRevealedChange` is what the primitive is built
   * with, read once while this field list initializes — plain, because a
   * signal would promise a caller they can change it later and the primitive
   * would never hear it.
   */
  /** Start with the password on the screen, when the state is the field's own. */
  @Prop() defaultRevealed = false;
  /** Where it starts when the value is the field's own, and what a reset goes back to. */
  @Prop() defaultValue?: string;
  /**
   * The control's id, and so the `for` of the label above it and the
   * `aria-controls` of the toggle beside it.
   *
   * Declared rather than left to `:host` so that the one id is the one every
   * part uses: written on the tag alone it would land on the box after the
   * field had already pointed the others at an id of its own making.
   */
  @Prop() id?: string;
  /** Submitted as `name=value`. Without a name the field submits nothing. */
  @Prop() name?: string;
  /**
   * `current-password` for signing in, `new-password` for choosing one.
   *
   * The second is what stops a manager filling in the password it already
   * holds, and what lets it offer a generated one instead. Default
   * `current-password`, since that is the field most pages have.
   */
  @Prop() autoComplete: PasswordAutocomplete = 'current-password';
  /** Shown in an empty box. Not a label: it is gone the moment anyone types. */
  @Prop() placeholder?: string;
  /** Enforced by the platform, and reported as the platform words it. */
  @Prop() minLength?: number;
  /** Enforced by the platform. `password.remaining()` is what is left of it. */
  @Prop() maxLength?: number;
  /** A regular expression the whole value has to match. */
  @Prop() pattern?: string;
  /** Validation the platform cannot express. Return nothing for a pass. */
  @Prop() validate?: FormFieldOptions['validate'];
  /** When the field first validates. Default `submit`. */
  @Prop() validateOn?: ValidationTrigger;
  /** When it validates again, once it has validated at all. Default `input`. */
  @Prop() revalidateOn?: ValidationTrigger;
  /**
   * Your wording: the toggle's two names, the two announcements, and what the
   * platform found wrong, in your users' language.
   */
  @Prop() labels?: PasswordInputLabels;
  /** Called with the text, on every edit. */
  @Prop() onValueChange?: (value: string) => void;
  /**
   * Called with the new state when a press of the toggle changes it, or a call
   * on the primitive does — not when your own `revealed` signal is set.
   */
  @Prop() onRevealedChange?: (revealed: boolean) => void;

  /** The words above the box. Markup instead, in the `label` slot. */
  @Prop() label = new Signal.State('');
  /** The line under it, shown whether or not the field is valid. */
  @Prop() description = new Signal.State('');
  /**
   * A verdict of your own — a server saying this is not the password for the
   * account — shown at once as the message and pushed into the control, so
   * the platform refuses the submit for the reason on screen.
   *
   * Empty is no verdict. The field lets go of one on the next edit, as it does
   * any message: the platform at once, so the next submit is not refused on
   * the old value's account, and the screen when `revalidateOn` says so. A
   * message that outlived its correction would be a form nobody could submit.
   * One handed over while the field is out of use is said once it is back,
   * unless an edit has let go of it first.
   *
   * What is bound here is handed over whenever it changes, and a signal set to
   * the string it already holds has not changed — so clear yours as an
   * attempt starts, and the same words after it are said again.
   *
   * Bound as `:prop-error`: `error` is a DOM event's name as well, and
   * `:error` on any tag is read as a listener for it. Written out —
   * `error="…"` — it is a prop like any other.
   */
  @Prop() error = new Signal.State('');

  /** Written through to the box, so the platform enforces it on submit. */
  @Prop() required = new Signal.State(false);
  /**
   * Written through to the box as the platform's own `disabled`, and to the
   * toggle as the same.
   *
   * Not `aria-disabled` alone, which is this package's rule where the visible
   * control is not a native one. Here both are: a disabled field is not part
   * of the form, and only the attribute takes it out — and a toggle a
   * keyboard can reach beside a box it cannot would show a password nobody
   * can edit.
   */
  @Prop() disabled = new Signal.State(false);
  /** Refuses edits, keeps the tab stop, and is never validated. The toggle stays live. */
  @Prop() readOnly = new Signal.State(false);

  /**
   * Names the box, in the platform's own spelling.
   *
   * Declared rather than left to `:host` because landing it on the element is
   * not enough to make it the name: `aria-labelledby` outranks `aria-label`
   * wherever an accessible name is computed, and the field points the first
   * at its own label. Given one, the field stands its own reference down. The
   * `for` stays either way.
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
   * The parts the primitive watches, as elements.
   *
   * Signals rather than plain fields because none of the four exists while
   * this class is being built, and the ids and the references between them
   * are written the moment each does.
   */
  labelEl = new Signal.State<Element | null>(null);
  control = new Signal.State<Element | null>(null);
  descriptionEl = new Signal.State<Element | null>(null);
  errorEl = new Signal.State<Element | null>(null);

  /**
   * The primitive, built from the props above — which is why props have to be
   * there while a field initializes.
   */
  readonly password: PasswordInput = createPasswordInput({
    input: () => this.control.get(),
    label: () => this.labelEl.get(),
    description: () => this.descriptionEl.get(),
    errorMessage: () => this.errorEl.get(),
    autoComplete: this.autoComplete,
    defaultRevealed: flag(this.defaultRevealed),
    required: () => this.required.get(),
    disabled: () => this.disabled.get(),
    readOnly: () => this.readOnly.get(),
    ...(this.value ? { value: this.value } : {}),
    ...(this.revealed ? { revealed: this.revealed } : {}),
    ...(this.defaultValue !== undefined ? { defaultValue: this.defaultValue } : {}),
    ...(this.id !== undefined ? { id: this.id } : {}),
    ...(this.name !== undefined ? { name: this.name } : {}),
    ...(this.placeholder !== undefined ? { placeholder: this.placeholder } : {}),
    ...(this.minLength !== undefined ? { minLength: this.minLength } : {}),
    ...(this.maxLength !== undefined ? { maxLength: this.maxLength } : {}),
    ...(this.pattern !== undefined ? { pattern: this.pattern } : {}),
    ...(this.validate ? { validate: this.validate } : {}),
    ...(this.validateOn ? { validateOn: this.validateOn } : {}),
    ...(this.revalidateOn ? { revalidateOn: this.revalidateOn } : {}),
    ...(this.labels ? { labels: this.labels } : {}),
    ...(this.onValueChange ? { onValueChange: this.onValueChange } : {}),
    ...(this.onRevealedChange ? { onRevealedChange: this.onRevealedChange } : {}),
  });

  /**
   * Whether the caller's message still stands: handed over, and not let go of
   * by an edit or a reset since.
   *
   * The field judges nothing while it is out of use, so a message handed to a
   * disabled or read-only field is held and not shown — and when it comes
   * back, nothing in the field asks again. A page that takes the field out of
   * use while it asks a server, and hears back before handing it over, would
   * otherwise have its refusal swallowed.
   */
  private standing = false;

  constructor() {
    // A write from the caller's own signal is an edit the field is told of
    // directly, with no event, and it moves the text — so a move is a letting
    // go. Declared ahead of the effect below, which runs after it in the same
    // flush: a refusal that arrives with the box emptied still stands.
    let text: string | undefined;
    effect(() => {
      const now = this.password.value();
      if (text !== undefined && now !== text) this.standing = false;
      text = now;
    });

    // The field lets go on the event, not on the text: an `input` or `change`
    // drops the message whether or not anything moved — the `change` a blur
    // commits, a password manager filling in the same password again — and a
    // reset forgets everything it held. Heard here too, or the effect at the
    // end would bring back a message the field had already put down.
    effect(() => {
      const control = this.control.get();
      if (!control) return;
      const form = formOf(control);
      const letGo = (event: Event): void => {
        // A reset a listener called off put nothing back, and the field
        // kept what it held.
        if (event.type === 'reset' && event.defaultPrevented) return;
        this.standing = false;
      };
      control.addEventListener('input', letGo);
      control.addEventListener('change', letGo);
      form?.addEventListener('reset', letGo);
      onCleanup(() => {
        control.removeEventListener('input', letGo);
        control.removeEventListener('change', letGo);
        form?.removeEventListener('reset', letGo);
      });
    });

    // The caller's verdict, handed to the field once the control it is
    // measured against is on the page: a message given before the box renders
    // is evaluated against nothing and comes back as valid. Untracked, because
    // settling the field reads `disabled` and `readOnly`, and a change to
    // either is not the caller saying anything new.
    effect(() => {
      const message = this.error.get();
      if (!this.control.get()) return;
      this.standing = message !== '';
      untrack(() => this.password.field.setCustomValidity(message));
    });

    // Back in use, a message that still stands is said again, since the field
    // set it aside rather than judging it. One an edit let go of stays gone.
    let inUse: boolean | undefined;
    effect(() => {
      const now = !this.disabled.get() && !this.readOnly.get();
      const before = inUse;
      inUse = now;
      if (!now || before !== false || !this.standing) return;
      untrack(() => this.password.field.setCustomValidity(this.error.get()));
    });
  }

  /**
   * What the box carries: the primitive's bag, with the three names merged
   * into it rather than written beside it — for the reasons `<v-input>`
   * gives, which are the same box under the same field.
   */
  inputProps(): InputProps {
    const own = this.password.inputProps();
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

  /**
   * The words in the toggle when the slot is empty: its name.
   *
   * The name rather than a shorter word beside it, so the words a sighted
   * user reads are the words a screen reader hears, in whatever language the
   * name is in — `labels`, the locale catalogue, or the default.
   */
  words(): string {
    const name = this.password.toggleProps()['aria-label'];
    return typeof name === 'string' ? name : '';
  }

  /**
   * The message on screen: the first of them.
   *
   * One line rather than the list, because the platform takes one string too.
   */
  message(): string {
    return this.password.field.messages()[0] ?? '';
  }
}

/** The form the box belongs to, found the way the field finds it. */
function formOf(control: Element): HTMLFormElement | null {
  return (control as HTMLInputElement).form ?? control.closest('form');
}

/** What a caller actually wrote, or nothing at all if it came to nothing. */
function said(value: string | boolean | undefined): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

/**
 * A flag, as a tag is able to deliver one.
 *
 * Written bare it is on, and bound it is whatever it was bound to. Written as
 * an attribute it is a string, and every string is truthy — so
 * `defaultRevealed="false"` would have put a password on the screen that the
 * caller had said to keep off it. Every string is on here but `"false"`,
 * which nobody writes meaning on.
 */
function flag(value: boolean): boolean {
  // Typed as a flag and handed a string all the same: the type is what the
  // tag promises, and an attribute is what it delivers.
  const written: unknown = value;
  return written !== false && written !== 'false' && written !== null && written !== undefined;
}
