/**
 * Form field — the wiring every input needs, in one place.
 *
 * A label, a description, an error message and a control are four elements
 * that have to agree about four ids, one `aria-invalid`, one `aria-required`,
 * a dirty flag, a touched flag, and when the browser's own validation gets to
 * speak. Every input in this library composes this, so the shape of it matters
 * more than the size of it.
 *
 * This is headless: it owns state and ARIA, and returns prop objects to spread
 * onto whatever markup the consumer writes. Nothing here renders.
 *
 *   class Email {
 *     control = new Signal.State<Element | null>(null);
 *     label = new Signal.State<Element | null>(null);
 *     hint = new Signal.State<Element | null>(null);
 *     error = new Signal.State<Element | null>(null);
 *     field = createFormField({
 *       control: () => this.control.get(),
 *       label: () => this.label.get(),
 *       description: () => this.hint.get(),
 *       errorMessage: () => this.error.get(),
 *       required: () => true,
 *     });
 *   }
 *
 *   <div :spread="field.fieldProps()">
 *     <label :ref="label" :spread="field.labelProps()">Email</label>
 *     <input type="email" :ref="control" :spread="field.controlProps()">
 *     <p :ref="hint" :spread="field.descriptionProps()">Only used to reply.</p>
 *     <p :if="field.isInvalid()" :ref="error" :spread="field.errorMessageProps()">
 *       {field.messages()[0]}
 *     </p>
 *   </div>
 *
 * Three decisions are worth stating outright.
 *
 * **References are only emitted for parts that are really there.** The label,
 * description and error arrive as element accessors, and `aria-labelledby` and
 * `aria-describedby` name the id each element actually carries. A reference to
 * an id nothing has is worse than no reference: both leave the control
 * unlabelled or undescribed, but the dangling one hides the mistake from every
 * audit that only checks the attribute is present.
 *
 * **Nothing is invalid until validation has run.** A required field is empty
 * the moment it renders, and a control that announces itself as invalid before
 * the user has typed a character is the single most common form bug there is.
 * So `state()` starts `valid`, and only a trigger — a submit by default —
 * moves it. `validateOn` and `revalidateOn` decide which.
 *
 * **Custom messages go through the platform.** Anything this field decides is
 * pushed into the control with `setCustomValidity`, so the browser blocks the
 * submit for exactly the same reasons the field shows a message. The
 * alternative — a field that looks invalid while the form happily submits — is
 * two sources of truth, and they diverge immediately.
 */

import { Signal, effect, onCleanup } from '@voltdev/core';
import { createId } from './id.js';

const { untrack } = Signal.subtle;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** `pending` is an async validator that has not answered yet. */
export type ValidationState = 'valid' | 'invalid' | 'pending';

/**
 * The constraints the platform can check, named as `ValidityState` names them.
 *
 * `customError` is deliberately absent: its message is the one that was handed
 * to `setCustomValidity`, so there is nothing left to override.
 */
export type ConstraintKey =
  | 'badInput'
  | 'patternMismatch'
  | 'rangeOverflow'
  | 'rangeUnderflow'
  | 'stepMismatch'
  | 'tooLong'
  | 'tooShort'
  | 'typeMismatch'
  | 'valueMissing';

/** In the order a person reads a form: is it there, is it the right shape, is it in range. */
const CONSTRAINT_KEYS: readonly ConstraintKey[] = [
  'valueMissing',
  'badInput',
  'typeMismatch',
  'patternMismatch',
  'tooShort',
  'tooLong',
  'rangeUnderflow',
  'rangeOverflow',
  'stepMismatch',
];

/**
 * Last-resort wording.
 *
 * A browser's own `validationMessage` is already in the user's language and is
 * preferred whenever it says anything, so these are reached only for a control
 * the platform does not validate — a custom widget — or an engine that leaves
 * the message empty.
 */
const DEFAULT_MESSAGES: Record<ConstraintKey, string> = {
  valueMissing: 'Fill in this field.',
  badInput: 'This value cannot be read.',
  typeMismatch: 'This value is not in the expected format.',
  patternMismatch: 'This value does not match the expected pattern.',
  tooShort: 'This value is too short.',
  tooLong: 'This value is too long.',
  rangeUnderflow: 'This value is too small.',
  rangeOverflow: 'This value is too large.',
  stepMismatch: 'This value is not one of the allowed steps.',
};

const DEFAULT_VALIDATION_FAILED = 'This value could not be checked.';

export interface FormFieldLabels extends Partial<Record<ConstraintKey, string>> {
  /**
   * Shown when an async validator rejects. A field that could not be checked
   * is reported as invalid rather than as valid, because the dangerous
   * outcome is the one that lets a bad value through.
   */
  validationFailed?: string;
}

export interface ValidationResult {
  readonly state: ValidationState;
  /** Empty unless the state is `invalid`. */
  readonly messages: readonly string[];
}

const VALID: ValidationResult = { state: 'valid', messages: [] };

/** What a validator may return: a message, several, or nothing for a pass. */
export type ValidationOutcome = string | readonly string[] | null | undefined;

/** When validation runs. `submit` covers both a real submit and `report()`. */
export type ValidationTrigger = 'submit' | 'blur' | 'input';

export interface FormFieldIds {
  readonly control: string;
  readonly label: string;
  readonly description: string;
  readonly errorMessage: string;
}

/**
 * A prop object to spread.
 *
 * Attributes only, never handlers: a prop object is re-applied whenever the
 * state it reads changes, and a listener in one would be added again on every
 * re-application. This field attaches its own listeners to the control it was
 * given, so there is nothing for the consumer to wire.
 */
export interface FormFieldProps {
  readonly [key: string]: string | boolean | undefined;
}

export interface FormFieldOptions {
  /**
   * The control the user operates.
   *
   * A native `<input>`, `<textarea>`, `<select>` or form-associated custom
   * element gets constraint validation, dirty tracking and submit handling for
   * free — they are found by asking the element for `setCustomValidity` rather
   * than by checking its tag, which is what makes custom elements work here.
   * Anything else still gets the ids, the ARIA and the state; it just has
   * nothing for the platform to validate.
   */
  control: () => Element | null | undefined;
  /** The visible label, if there is one. */
  label?: () => Element | null | undefined;
  /** Help text, shown whether or not the field is valid. */
  description?: () => Element | null | undefined;
  /** Where validation messages are rendered. */
  errorMessage?: () => Element | null | undefined;

  /**
   * Supply a signal to read the field's state from outside, or to seed it.
   * Without one the field owns its own, which is what most callers want.
   *
   * It is not a way to impose a verdict: the field writes it on every
   * validation, so an `invalid` set on it from outside lasts until the next
   * one. A server's answer to a value it has just rejected goes through
   * `setCustomValidity`, which also makes the platform refuse the submit.
   *
   * Dirty and touched take no signal on purpose: they are records of what the
   * user did, not settings, so they can be read and reset but not dictated.
   */
  validity?: Signal.State<ValidationResult>;

  /** Fixed id for the control, when something outside has to refer to it. */
  id?: string;

  /**
   * Written through to the control, so the platform validates and announces
   * it. Leave it unset to let a `required` attribute in your own markup govern
   * — the field then stays out of the way and does not claim to know.
   */
  required?: () => boolean;
  /** Written through to the control. A disabled control is never validated. */
  disabled?: () => boolean;
  /** Written through to the control. A readonly control is never validated. */
  readOnly?: () => boolean;

  /** Validation the platform cannot express. Return nothing for a pass. */
  validate?: (
    value: string | null,
    control: Element,
  ) => ValidationOutcome | Promise<ValidationOutcome>;

  /** When the field first validates. Default `submit`. */
  validateOn?: ValidationTrigger;
  /**
   * When it validates again, once it has validated at all. Default `input`,
   * so an error the user is in the middle of fixing disappears as they fix it.
   */
  revalidateOn?: ValidationTrigger;

  labels?: FormFieldLabels;

  onValidityChange?: (result: ValidationResult) => void;
}

export interface FormField {
  /** The generated ids, for anything this field does not wire itself. */
  ids(): FormFieldIds;

  state(): ValidationState;
  isValid(): boolean;
  isInvalid(): boolean;
  isPending(): boolean;
  /** Messages for the current state. Empty unless invalid. */
  messages(): readonly string[];

  /** The control's value as last read, or null for a control that has none. */
  value(): string | null;
  /** Whether the value differs from the one `form.reset()` would restore. */
  isDirty(): boolean;
  /** Whether the control has been left at least once. */
  isTouched(): boolean;
  isRequired(): boolean;
  isDisabled(): boolean;
  isReadOnly(): boolean;

  /** Run everything, including an async validator. */
  validate(): Promise<boolean>;
  /**
   * Validate and show the result now, returning what can be said
   * synchronously — `false` while an async validator is still running, since a
   * field nobody has finished checking cannot be called valid. An async
   * validator already asked about the value as it stands is not asked again
   * unless it rejected: its answer stands until the value changes, and
   * `validate()` asks anew.
   */
  report(): boolean;
  /**
   * A message the platform cannot derive, shown at once. An empty string
   * clears it, and on a field that has not been validated yet says nothing.
   */
  setCustomValidity(message: string): void;

  /** Record an edit for a control that fires no `input` event of its own. */
  markEdited(): void;
  /** Record a visit for a control that fires no `blur` event of its own. */
  markTouched(): void;
  /**
   * Clear what the field has recorded: validation, touched, and dirty. It does
   * not touch the control's value — `form.reset()` does that, and this field
   * follows it.
   */
  reset(): void;

  /** The wrapper, for CSS to select the field's state on. */
  fieldProps(): FormFieldProps;
  labelProps(): FormFieldProps;
  controlProps(): FormFieldProps;
  descriptionProps(): FormFieldProps;
  errorMessageProps(): FormFieldProps;
}

// ---------------------------------------------------------------------------
// Field
// ---------------------------------------------------------------------------

export function createFormField(options: FormFieldOptions): FormField {
  const controlId = options.id ?? createId('field-control');
  const labelId = createId('field-label');
  const descriptionId = createId('field-description');
  const errorMessageId = createId('field-error');

  const validity = options.validity ?? new Signal.State<ValidationResult>(VALID);
  const dirty = new Signal.State(false);
  const touched = new Signal.State(false);
  const value = new Signal.State<string | null>(null);

  const validateOn = options.validateOn ?? 'submit';
  const revalidateOn = options.revalidateOn ?? 'input';

  const required = () => options.required?.() ?? false;
  const disabled = () => options.disabled?.() ?? false;
  const readOnly = () => options.readOnly?.() ?? false;

  /** The value `form.reset()` would restore, which is what dirty is measured against. */
  let pristine: string | null = null;
  /** Whether validation has run yet, which decides which trigger applies. */
  let hasValidated = false;
  /** A message from `setCustomValidity`, cleared by the next edit. */
  let customMessage = '';
  /** The last answer from `options.validate`. */
  let validatorMessages: readonly string[] = [];
  /**
   * Whether that answer is a validator's failure to give one — it rejected —
   * rather than a verdict on the value. It is shown, since nobody has passed
   * the value, but it is not a reason the value is wrong.
   */
  let unanswered = false;
  /** Rising counter, so a slow async answer cannot overwrite a newer one. */
  let generation = 0;
  /**
   * Whether an async validator has been asked about the value as it stands.
   * Its answer is then on screen or on its way, and an edit, a reset, or its
   * failing to answer at all is what makes it worth asking again.
   */
  let askedAsync = false;
  /**
   * A submit refused only because that answer had not come back yet, to be
   * made again once it has and says yes — so a submit waits for the check
   * rather than failing for having asked.
   */
  let heldSubmit: { form: HTMLFormElement; submitter: HTMLElement | null } | null = null;

  const settle = (result: ValidationResult): void => {
    const previous = untrack(() => validity.get());
    if (previous.state === result.state && sameMessages(previous.messages, result.messages)) return;
    validity.set(result);
    options.onValidityChange?.(result);
  };

  /**
   * What the field is right now, without running an async validator.
   *
   * The platform's constraints are read first and the custom messages added to
   * them, and the control is left holding the custom message, so the platform
   * refuses a submit for the same reasons the field gives.
   */
  const evaluate = (): ValidationResult => {
    const control = options.control();

    // A control the platform would not validate is one this field does not
    // validate either. That is not a shortcut: a disabled field is not part of
    // the form, and a readonly one holds a value the user cannot correct, so
    // an error against either is an error nobody can act on.
    if (!control || disabled() || readOnly()) {
      applyCustomValidity(control, '');
      return VALID;
    }

    const custom = customMessage ? [customMessage, ...validatorMessages] : [...validatorMessages];

    // The platform's own wording is read with no custom message in place. It
    // has one message slot, and once a custom message is in it `validationMessage`
    // *is* that message, so its wording for every other constraint — already in
    // the user's language — would be out of reach.
    applyCustomValidity(control, '');
    const messages = constraintMessages(control, options.labels);

    // The platform takes one string; the rest stay in `messages()`. What
    // matters is that it takes *a* string, because that is what makes it
    // refuse the submit. A validator that rejected is not given one: failing
    // to answer is no verdict on the value, and the platform refuses before
    // the `submit` event, so the submit that would ask again would never be
    // heard — a moment's network trouble would leave the form unsubmittable
    // until the value changed.
    const refusal = customMessage || (unanswered ? '' : validatorMessages[0]);
    if (refusal) applyCustomValidity(control, refusal);
    // Appended rather than assumed present: a control the platform does not
    // validate reports no `customError`, so its custom messages arrive only
    // this way.
    for (const message of custom) if (!messages.includes(message)) messages.push(message);

    return messages.length > 0 ? { state: 'invalid', messages } : VALID;
  };

  const isValidNow = (): boolean => untrack(() => validity.get()).state === 'valid';
  const isPendingNow = (): boolean => untrack(() => validity.get()).state === 'pending';

  /** Ask the consumer's validator, if there is one and there is anything to ask about. */
  const runValidator = (): ValidationOutcome | Promise<ValidationOutcome> => {
    const control = options.control();
    if (!options.validate || !control || disabled() || readOnly()) return undefined;
    return options.validate(untrack(() => value.get()), control);
  };

  const finish = (messages: readonly string[], failed = false): boolean => {
    validatorMessages = messages;
    unanswered = failed;
    const result = evaluate();
    settle(result);
    return result.state === 'valid';
  };

  /**
   * Deliberately not an `async` function: awaiting a validator that answered
   * synchronously would still defer the result by a microtask, and `report`
   * depends on a synchronous answer being available synchronously.
   */
  const validate = (): Promise<boolean> => {
    hasValidated = true;
    const token = ++generation;
    const outcome = runValidator();
    askedAsync = isPromise(outcome);

    if (!isPromise(outcome)) return Promise.resolve(finish(toMessages(outcome)));

    // Kept, not cleared: the messages already on screen stay there while the
    // answer is in flight, so the field does not flicker back to looking fine
    // in the gap.
    settle({ state: 'pending', messages: untrack(() => validity.get()).messages });

    // A newer run has taken over, so this answer is about a value that is two
    // edits old and has nothing left to say.
    const conclude = (messages: readonly string[], failed = false) => {
      if (token !== generation) return isValidNow();
      // No answer is not an answer about this value, so the next submit asks
      // again rather than being refused on it.
      if (failed) askedAsync = false;
      const passed = finish(messages, failed);
      const held = heldSubmit;
      heldSubmit = null;
      if (passed && held) submitAgain(held);
      return passed;
    };

    return outcome.then(
      (resolved) => conclude(toMessages(resolved)),
      // A validator that threw has not said the value is good, and treating
      // silence as approval is how bad values get through.
      () => conclude([options.labels?.validationFailed ?? DEFAULT_VALIDATION_FAILED], true),
    );
  };

  const report = (): boolean => {
    // An async validator already asked about this value is not asked again.
    // Its answer is on screen or on its way, and a submit that restarted it
    // would find the field pending every time — so no submit would ever go.
    if (askedAsync) {
      if (!isPendingNow()) settle(evaluate());
      return isValidNow();
    }
    // A sync validator has settled by the time this returns; an async one
    // leaves the field pending, which is not valid.
    void validate();
    return isValidNow();
  };

  /**
   * Make a submit again, as the user made it.
   *
   * Through `requestSubmit`, so the platform validates the whole form again and
   * every `submit` listener hears it — a field that went quiet in the meantime
   * does not get waved through by one that has just said yes.
   */
  const submitAgain = ({ form, submitter }: NonNullable<typeof heldSubmit>): void => {
    if (!form.isConnected) return;
    // A button that has left the form can no longer be the one that submits it.
    const owner = (submitter as { form?: unknown } | null)?.form;
    form.requestSubmit(owner === form ? submitter : null);
  };

  const onTrigger = (trigger: ValidationTrigger): void => {
    if ((hasValidated ? revalidateOn : validateOn) !== trigger) return;
    void validate();
  };

  const markEdited = (): void => {
    const control = options.control();
    const current = control ? readValue(control) : null;
    value.set(current);
    dirty.set(current !== pristine);
    // An answer still on its way is about the old value as well, and so is a
    // submit that was waiting for it. Left to land, the answer would become
    // the verdict on a value nobody asked about — and, pushed into the
    // platform, refuse every submit before one could ask again.
    const edited = ++generation;
    askedAsync = false;
    heldSubmit = null;
    // Every verdict held is about a value that no longer exists. A custom
    // message left in place survives every correction the user makes, which
    // is the classic way a form becomes impossible to submit. And whatever
    // stays on screen until `revalidateOn` says otherwise, the platform lets go
    // now: left there, it refuses the next submit on the old value's account
    // before the field can re-check — a refusal nothing on screen explains, or
    // one that never ends when the re-check was waiting for that submit.
    if (customMessage || validatorMessages.length > 0) {
      customMessage = '';
      validatorMessages = [];
      applyCustomValidity(control, '');
    }
    onTrigger('input');
    // Unless the trigger asked again, nothing is being checked any more, and a
    // field left pending would be busy for ever. What it showed stays until
    // the trigger, as it does for any edit.
    if (generation === edited && isPendingNow()) {
      const { messages } = untrack(() => validity.get());
      settle(messages.length > 0 ? { state: 'invalid', messages } : VALID);
    }
  };

  /**
   * Forget everything the field has recorded.
   *
   * `restored` says the value is going back to the pristine one as well, which
   * is what a form reset does — and has not done yet when it says so.
   */
  const clear = (restored = false): void => {
    generation += 1;
    hasValidated = false;
    askedAsync = false;
    heldSubmit = null;
    customMessage = '';
    validatorMessages = [];
    touched.set(false);

    const control = options.control();
    applyCustomValidity(control, '');
    const current = restored ? pristine : control ? readValue(control) : null;
    value.set(current);
    dirty.set(current !== pristine);
    settle(VALID);
  };

  // The control's own events, in their own effect so the listeners are added
  // once per control rather than removed and re-added whenever an unrelated
  // option changes.
  effect(() => {
    const control = options.control();
    if (!control) return;

    untrack(() => {
      pristine = readPristine(control);
      value.set(readValue(control));
      dirty.set(false);
    });

    const onInput = () => markEdited();
    const onBlur = () => {
      touched.set(true);
      onTrigger('blur');
    };
    const onInvalid = (event: Event) => {
      // The platform has just refused a submit on this control's behalf.
      // Cancelling stops its own bubble appearing over markup the consumer
      // styled, which is the whole reason a library renders the message
      // itself; the messages are taken from the same validity that refused.
      event.preventDefault();
      hasValidated = true;
      settle(evaluate());
    };

    control.addEventListener('input', onInput);
    // `<select>` is the one that reports through `change` alone in some
    // engines; the handler is idempotent, so hearing both costs nothing.
    control.addEventListener('change', onInput);
    control.addEventListener('blur', onBlur);
    control.addEventListener('invalid', onInvalid);

    onCleanup(() => {
      control.removeEventListener('input', onInput);
      control.removeEventListener('change', onInput);
      control.removeEventListener('blur', onBlur);
      control.removeEventListener('invalid', onInvalid);
    });
  });

  // The owning form's events.
  effect(() => {
    const control = options.control();
    const form = control ? formOf(control) : null;
    if (!form) return;

    const onSubmit = (event: Event) => {
      if (report()) return;
      event.preventDefault();
      // Refused for want of an answer rather than for a bad one: made again
      // when the answer comes, unless an edit has made it an answer about some
      // other value first.
      if (isPendingNow()) {
        heldSubmit = { form, submitter: (event as SubmitEvent).submitter ?? null };
      }
    };
    const onReset = (event: Event) => {
      // `reset` is dispatched before the platform puts anything back, and there
      // is no later moment to read the value at: nothing is fired once it has,
      // and when a press on a reset button is what dispatched this, a microtask
      // queued here runs before it has as well. So the value is not read back.
      // It is going to the pristine one, which is already known — unless a
      // listener ahead of this one has called the reset off.
      if (!event.defaultPrevented) clear(true);
    };

    // Capture, so this runs before a handler that stopped propagation, and
    // before every listener that does not capture — one on the form itself
    // included, since at the target capturing listeners run first. Only one
    // that captures on an ancestor, or on the form ahead of this one, runs
    // earlier, and a consumer who submits by hand from there should check
    // `event.defaultPrevented`. The platform's own refusal, which needs no
    // listener at all, still happens first for any form without `novalidate`.
    form.addEventListener('submit', onSubmit, true);
    form.addEventListener('reset', onReset);

    onCleanup(() => {
      form.removeEventListener('submit', onSubmit, true);
      form.removeEventListener('reset', onReset);
    });
  });

  // Written as properties rather than returned from `controlProps`, because
  // only some controls have them: `required` on a `<div role="textbox">` is a
  // meaningless attribute that looks like it does something. Each is written
  // only when the matching option was supplied, so a `required` attribute in
  // the consumer's own markup is not quietly wiped by a field that was never
  // told about it.
  effect(() => {
    const control = options.control();
    if (!control) return;
    if (options.required) writeFlag(control, 'required', required());
    if (options.disabled) writeFlag(control, 'disabled', disabled());
    if (options.readOnly) writeFlag(control, 'readOnly', readOnly());
  });

  /**
   * The id an element actually carries, rather than the one it was handed.
   *
   * The two are the same unless the consumer skipped the spread or supplied an
   * id of their own, and in both of those cases pointing at what is really
   * there is right — and pointing at nothing, when the element is absent, is
   * better than pointing at an id no element has.
   */
  const referenceTo = (part: (() => Element | null | undefined) | undefined): string | undefined =>
    part?.()?.id || undefined;

  const describedBy = (): string | undefined => {
    // Description first: it is the standing explanation of the field, and the
    // error is the news. A screen reader reads them in this order.
    const ids = [referenceTo(options.description), referenceTo(options.errorMessage)].filter(
      (id): id is string => id !== undefined,
    );
    return ids.length > 0 ? ids.join(' ') : undefined;
  };

  return {
    ids: () => ({
      control: controlId,
      label: labelId,
      description: descriptionId,
      errorMessage: errorMessageId,
    }),

    state: () => validity.get().state,
    isValid: () => validity.get().state === 'valid',
    isInvalid: () => validity.get().state === 'invalid',
    isPending: () => validity.get().state === 'pending',
    messages: () => validity.get().messages,

    value: () => value.get(),
    isDirty: () => dirty.get(),
    isTouched: () => touched.get(),
    isRequired: required,
    isDisabled: disabled,
    isReadOnly: readOnly,

    validate,
    report,

    setCustomValidity(message: string) {
      customMessage = message;
      // Applied at once. Asking for a message is asking for it to be shown,
      // and waiting for a trigger would leave the caller wondering whether it
      // took. Taking one away is not a request to judge the rest, though: on
      // a field nobody has touched it would put a required field's message on
      // screen before anyone had typed, which is what this field is for
      // preventing. The platform is told either way.
      if (message) hasValidated = true;
      if (hasValidated) settle(evaluate());
      else applyCustomValidity(options.control(), '');
    },

    markEdited,
    markTouched() {
      touched.set(true);
      onTrigger('blur');
    },
    reset: () => clear(),

    fieldProps: () => {
      const result = validity.get();
      return {
        'data-state': result.state,
        'data-dirty': dirty.get() || undefined,
        'data-touched': touched.get() || undefined,
        'data-required': required() || undefined,
        'data-disabled': disabled() || undefined,
        'data-readonly': readOnly() || undefined,
      };
    },

    labelProps: () => ({
      id: labelId,
      // `for` is what makes a press on the words move focus to the control,
      // which no amount of ARIA does. It is inert on an element that is not a
      // `<label>`, which is the cost of not asking the consumer to declare
      // which one they rendered.
      for: controlId,
    }),

    controlProps: () => {
      const result = validity.get();
      return {
        id: controlId,
        'aria-labelledby': referenceTo(options.label),
        'aria-describedby': describedBy(),
        // Only once validation has actually failed. `aria-invalid` on a
        // required field nobody has touched is the most common form bug there
        // is: it announces every empty field as wrong before the user starts.
        'aria-invalid': result.state === 'invalid' ? 'true' : undefined,
        // Said in ARIA as well as through the `required` property, because a
        // control that is not a native one has no property to say it with, and
        // on one that is the two agree.
        'aria-required': required() ? 'true' : undefined,
        'aria-disabled': disabled() ? 'true' : undefined,
        'aria-readonly': readOnly() ? 'true' : undefined,
        // A field waiting on a server has not been judged yet, and busy is how
        // that is said.
        'aria-busy': result.state === 'pending' ? 'true' : undefined,
        'data-state': result.state,
        'data-dirty': dirty.get() || undefined,
        'data-touched': touched.get() || undefined,
      };
    },

    descriptionProps: () => ({ id: descriptionId }),

    errorMessageProps: () => ({
      id: errorMessageId,
      // Validation is reported on submit, and at that moment focus is on the
      // submit button rather than on the field — so without a live region the
      // user is told nothing at all. The cost is real and worth naming: the
      // message is announced when it appears, and again when the user reaches
      // the control that `aria-describedby` points at it from.
      role: 'alert',
      'data-state': validity.get().state,
    }),
  };
}

// ---------------------------------------------------------------------------
// The platform's half
// ---------------------------------------------------------------------------

/** The slice of the Constraint Validation API this needs. */
interface ValidatableElement extends Element {
  readonly validity: ValidityState;
  readonly validationMessage: string;
  readonly willValidate: boolean;
  setCustomValidity(message: string): void;
}

/**
 * Whether the platform validates this control, asked by capability.
 *
 * `instanceof HTMLInputElement` fails for an element adopted from another
 * document and throws where the constructor does not exist at all, and a tag
 * list would exclude form-associated custom elements, which implement exactly
 * this interface through `ElementInternals` and deserve to work.
 */
function isValidatable(el: Element | null | undefined): el is ValidatableElement {
  if (!el) return false;
  const candidate = el as { setCustomValidity?: unknown };
  return typeof candidate.setCustomValidity === 'function';
}

function applyCustomValidity(el: Element | null | undefined, message: string): void {
  if (isValidatable(el)) el.setCustomValidity(message);
}

/**
 * The messages for whatever the control is currently failing.
 *
 * Read from `validity` rather than by calling `checkValidity`, which would
 * dispatch `invalid` — and this is called from the `invalid` handler.
 */
function constraintMessages(el: Element, labels: FormFieldLabels | undefined): string[] {
  // `willValidate` is false for a disabled, readonly, hidden or button-typed
  // control. Its `validity` still reports failures, so without this check a
  // disabled required field is invalid forever.
  if (!isValidatable(el) || !el.willValidate || el.validity.valid) return [];

  const messages: string[] = [];
  const add = (message: string | undefined) => {
    if (message && !messages.includes(message)) messages.push(message);
  };

  // Read with no custom message in place — see `evaluate` — so this is the
  // platform's own wording, for whichever constraint it found failing first.
  const platform = el.validationMessage || undefined;

  // Constraints before rules: there is no point telling someone their address
  // is taken while it is not yet a valid address.
  for (const key of CONSTRAINT_KEYS) {
    if (!el.validity[key]) continue;
    add(labels?.[key] ?? platform ?? DEFAULT_MESSAGES[key]);
  }

  return messages;
}

/**
 * The form this control belongs to.
 *
 * The `form` property is the authority, because a control can be associated
 * with a form it is not inside through the `form` attribute; `closest` covers
 * anything that has no such property.
 */
function formOf(control: Element): HTMLFormElement | null {
  const owner = (control as { form?: unknown }).form;
  if (owner && typeof owner === 'object' && 'addEventListener' in owner) {
    return owner as HTMLFormElement;
  }
  return control.closest<HTMLFormElement>('form');
}

/** Write a boolean IDL attribute, if this control has one. */
function writeFlag(el: Element, property: 'required' | 'disabled' | 'readOnly', on: boolean): void {
  if (!(property in el)) return;
  (el as unknown as Record<string, boolean>)[property] = on;
}

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

interface CheckableElement extends Element {
  checked: boolean;
  defaultChecked: boolean;
}

/** A checkbox or radio: the thing that changes is its checkedness, not its value. */
function isCheckable(el: Element): el is CheckableElement {
  if (el.tagName !== 'INPUT') return false;
  const type = (el as { type?: string }).type ?? '';
  return type.toLowerCase() === 'checkbox' || type.toLowerCase() === 'radio';
}

function readValue(el: Element): string | null {
  if (isCheckable(el)) return String(el.checked);
  // `value` is a string on every form control, and a number on the handful of
  // elements that are not one — `<progress>`, `<li>` — which are not controls
  // but cost nothing to allow for.
  if ('value' in el) return String((el as { value: string | number }).value);
  // A custom widget with no value of its own. Dirty is then whatever
  // `markEdited` is told, which is the most the field can honestly know.
  return null;
}

/**
 * The value a reset would restore.
 *
 * Taken from `defaultValue` and `defaultChecked` where they exist, so that
 * "dirty" means exactly what the platform means by it, rather than "something
 * happened at some point".
 */
function readPristine(el: Element): string | null {
  if (isCheckable(el)) return String(el.defaultChecked);
  if ('defaultValue' in el) return (el as { defaultValue: string }).defaultValue;
  return readValue(el);
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function toMessages(outcome: ValidationOutcome): readonly string[] {
  if (!outcome) return [];
  return typeof outcome === 'string' ? [outcome] : outcome.filter(Boolean);
}

function isPromise(value: unknown): value is Promise<ValidationOutcome> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

function sameMessages(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((message, i) => message === b[i]);
}
