import { Component, Prop, Signal } from '@voltdev/core';
import {
  createTextarea,
  type FormFieldLabels,
  type FormFieldOptions,
  type InputProps,
  type Textarea,
  type ValidationTrigger,
} from '@voltdev/primitives';

/**
 * A text field over several lines: the label, the box, a line of help, and the
 * message.
 *
 * ```html
 * <v-textarea :value="bio" label="About you" name="bio" rows="4"
 *             description="A sentence or two."></v-textarea>
 * ```
 *
 * It is `<v-input>`'s field with a `<textarea>` in the middle, and it is the
 * same field on purpose: an input, a textarea, a number field and a password
 * field are one design with different contents, so they share the sheet's
 * `field` entry rather than each carrying a copy of the look. A look written
 * four times is a look that drifts three times.
 *
 * What is this control's own is the shape of the box. `rows` is how tall it
 * opens, and it grows from there with what is typed into it — a declaration
 * the browser obeys where it has one, so the box keeps up with the edits no
 * listener sees: autofill, undo, an IME commit, dropped text. It is the one
 * thing about this field the sheet does not draw, because "as tall as its
 * content" cannot be said in a stylesheet without measuring the same thing;
 * `:autoSize="false"` and nothing is written.
 *
 * All four parts are drawn whether or not they have anything to say, and the
 * error is the reason. It is a live region, and a live region that arrives
 * already holding its message is one no screen reader was watching — while
 * validation is reported at submit, when focus is on the button and not on the
 * field, so an unannounced message is no message at all. The empty line it
 * holds is also the line the message will take, so a form that fails does not
 * push itself down the page.
 *
 * What a caller writes on the tag reaches the `<textarea>`. It is the control,
 * the element carrying the role, and the only one a name or a `data-*` says
 * anything about; the `<div>` around it is layout. The three ARIA attributes
 * the field has an opinion about are declared as props below rather than left
 * to fall through, because a caller's own would otherwise be written over by
 * the field's a moment later — or, in `aria-label`'s case, left on the element
 * and outranked by the reference the field points at its own label, which is
 * the same loss said more quietly.
 */
@Component({ selector: 'v-textarea', templateUrl: './textarea.html' })
export class VTextarea {
  /** Your own signal, when the text belongs to your component. */
  @Prop() value?: Signal.State<string>;

  /**
   * Everything from here to `onValueChange` is what the primitive is built
   * with, read once while this field list initializes — plain, because a
   * signal would promise a caller they can change it later and the primitive
   * would never hear it.
   */
  /** Where it starts when the value is the textarea's own, and what a reset goes back to. */
  @Prop() defaultValue?: string;
  /**
   * The control's id, and so the `for` of the label above it.
   *
   * Declared rather than left to `:host` so that the one id is the one both
   * halves use: written on the tag alone it would land on the box after the
   * field had already pointed the label at an id of its own making.
   */
  @Prop() id?: string;
  /** Submitted as `name=value`. Without a name the field submits nothing. */
  @Prop() name?: string;
  /** How many lines the box opens at. Default 2, and it grows from there. */
  @Prop() rows?: number;
  /** The line it stops growing at, after which it scrolls. Without one it grows for ever. */
  @Prop() maxRows?: number;
  /** Grow with the content. `:autoSize="false"` for a box that stays the height it opened. */
  @Prop() autoSize = true;
  /** Shown in an empty box. Not a label: it is gone the moment anyone types. */
  @Prop() placeholder?: string;
  /** What the browser may fill in, in the platform's own vocabulary. */
  @Prop() autoComplete?: string;
  /** Enforced by the platform, and reported as the platform words it. */
  @Prop() minLength?: number;
  /** Enforced by the platform. `textarea.remaining()` is what is left of it. */
  @Prop() maxLength?: number;
  /** Validation the platform cannot express. Return nothing for a pass. */
  @Prop() validate?: FormFieldOptions['validate'];
  /** When the field first validates. Default `submit`. */
  @Prop() validateOn?: ValidationTrigger;
  /** When it validates again, once it has validated at all. Default `input`. */
  @Prop() revalidateOn?: ValidationTrigger;
  /** Your wording for what the platform found wrong, in your users' language. */
  @Prop() labels?: FormFieldLabels;
  /** Called with the text, on every edit. */
  @Prop() onValueChange?: (value: string) => void;

  /** The words above the box. Markup instead, in the `label` slot. */
  @Prop() label = new Signal.State('');
  /** The line under it, shown whether or not the field is valid. */
  @Prop() description = new Signal.State('');

  /** Written through to the box, so the platform enforces it on submit. */
  @Prop() required = new Signal.State(false);
  /**
   * Written through to the box as the platform's own `disabled`.
   *
   * Not `aria-disabled` alone, which is this package's rule where the visible
   * control is not a native one. Here it is: a disabled field is not part of
   * the form, and only the attribute takes it out.
   */
  @Prop() disabled = new Signal.State(false);
  /** Refuses edits, keeps the tab stop, and is never validated. */
  @Prop() readOnly = new Signal.State(false);

  /**
   * Names the box, in the platform's own spelling.
   *
   * Declared rather than left to `:host` because landing it on the element is
   * not enough to make it the name. `aria-labelledby` outranks `aria-label` in
   * every accessible name there is, and the field points the first at its own
   * label — so a name written here would reach the box and name nothing. Given
   * one, the field stands its own reference down, which is what a plain
   * `<textarea>` beside a `<label for>` does as well: there the label is the
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
   * The four parts, as elements.
   *
   * Signals rather than plain fields because the primitive watches them: none
   * of the four exists while this class is being built, and the ids, the
   * references between them and the height of the box are written the moment
   * each does.
   */
  labelEl = new Signal.State<Element | null>(null);
  control = new Signal.State<Element | null>(null);
  descriptionEl = new Signal.State<Element | null>(null);
  errorEl = new Signal.State<Element | null>(null);

  /**
   * The primitive, built from the props above — which is why props have to be
   * there while a field initializes.
   */
  readonly textarea: Textarea = createTextarea({
    input: () => this.control.get(),
    label: () => this.labelEl.get(),
    description: () => this.descriptionEl.get(),
    errorMessage: () => this.errorEl.get(),
    autoSize: this.autoSize,
    required: () => this.required.get(),
    disabled: () => this.disabled.get(),
    readOnly: () => this.readOnly.get(),
    ...(this.value ? { value: this.value } : {}),
    ...(this.defaultValue !== undefined ? { defaultValue: this.defaultValue } : {}),
    ...(this.id !== undefined ? { id: this.id } : {}),
    ...(this.name !== undefined ? { name: this.name } : {}),
    ...(this.rows !== undefined ? { rows: this.rows } : {}),
    ...(this.maxRows !== undefined ? { maxRows: this.maxRows } : {}),
    ...(this.placeholder !== undefined ? { placeholder: this.placeholder } : {}),
    ...(this.autoComplete !== undefined ? { autoComplete: this.autoComplete } : {}),
    ...(this.minLength !== undefined ? { minLength: this.minLength } : {}),
    ...(this.maxLength !== undefined ? { maxLength: this.maxLength } : {}),
    ...(this.validate ? { validate: this.validate } : {}),
    ...(this.validateOn ? { validateOn: this.validateOn } : {}),
    ...(this.revalidateOn ? { revalidateOn: this.revalidateOn } : {}),
    ...(this.labels ? { labels: this.labels } : {}),
    ...(this.onValueChange ? { onValueChange: this.onValueChange } : {}),
  });

  /**
   * What the box carries: the primitive's bag, with the three names merged
   * into it rather than written beside it.
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
   * they are named.
   *
   * Nothing is not a name. An id a caller has not chosen yet is an empty
   * string — `ids.join(' ')` over nothing, a signal before its element
   * exists — and treating one as a reference points the box at no id at all,
   * which cuts it loose from the very label this prop exists to replace. So
   * each is trimmed and an empty one is read as unsaid.
   */
  textareaProps(): InputProps {
    const own = this.textarea.textareaProps();
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
   * The message on screen: the first of them.
   *
   * One line rather than the list, because the platform takes one string too —
   * so the sentence a reader is given is the same sentence the browser refused
   * the submit over, rather than one of several they have to match up.
   */
  message(): string {
    return this.textarea.field.messages()[0] ?? '';
  }
}

/** What a caller actually wrote, or nothing at all if it came to nothing. */
function said(value: string | boolean | undefined): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}
