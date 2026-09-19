/**
 * Drive a component the way a person does — with the event sequence the
 * platform actually produces, not the one event the handler happens to listen
 * for.
 *
 * Calling `element.click()` tests nothing about a widget that closes on
 * `pointerdown`, focuses on `mousedown`, or activates from the keyboard. Every
 * helper here dispatches the full sequence, in the order a browser dispatches
 * it, and flushes the scheduler between each one — a browser reaches a
 * microtask checkpoint after every event, so a component that reads a signal
 * written by `pointerdown` while handling `mouseup` must see the new value
 * here too.
 *
 * They are all synchronous: the DOM is settled by the time one returns. Work
 * that has to wait on a promise needs `await settle()`, and work that has to
 * wait on a timer needs the clock advanced.
 *
 * Two rules are worth knowing before reading the code:
 *
 *   - **`aria-disabled` is clicked.** The platform delivers every event to an
 *     `aria-disabled` element, because the attribute says nothing to the
 *     browser — it is the widget's own job to ignore the press. Refusing to
 *     dispatch would make every "a disabled item does nothing" test pass
 *     against a component that never checks, which is the bug those tests
 *     exist to catch. Volt's primitives disable with `aria-disabled` almost
 *     everywhere, precisely so a disabled control stays reachable by keyboard,
 *     so this is the common case rather than the exotic one.
 *   - **The `disabled` attribute is not.** There the platform really does drop
 *     the press — `mousedown`, `mouseup` and the click, and every key — so
 *     dispatching them would test a sequence no user can produce. The pointer
 *     events still arrive, and so does a hover, which is how a tooltip on a
 *     disabled button explains why it is disabled.
 *
 * `click()` does not imply `hover()`. A pointer arriving is a separate thing
 * from a press — keyboard and touch activation produce no hover at all — and a
 * tooltip that only opens on hover should have to be hovered.
 */

import { flushSync } from '@voltdev/core';
import { isListSelect, isTextField } from './aria.js';

const tagOf = (element: Element): string => element.tagName.toLowerCase();

/** Elements the `disabled` attribute actually applies to. */
const DISABLEABLE = new Set([
  'button',
  'fieldset',
  'input',
  'optgroup',
  'option',
  'select',
  'textarea',
]);

/**
 * Whether the platform treats a press here as a press on a disabled control.
 *
 * Checked up the chain: a press lands on the `<span>` inside a disabled
 * button. A `<fieldset disabled>` disables the form controls it contains and
 * nothing else — a link or a `<div role="button">` inside one is as live as it
 * is anywhere — and leaves alone the controls in its own first `<legend>`,
 * which is where the checkbox that enables the rest of it goes.
 */
function isNativelyDisabled(element: Element): boolean {
  // Whether the walk has passed a form control yet, which is what a fieldset
  // further up would disable.
  let control = false;
  let child: Element | null = null;

  for (let node: Element | null = element; node; child = node, node = node.parentElement) {
    const tag = tagOf(node);
    if (!DISABLEABLE.has(tag)) continue;

    if (tag !== 'fieldset' || node === element) {
      if (node.hasAttribute('disabled')) return true;
      control = true;
    } else if (control && node.hasAttribute('disabled')) {
      const legend = [...node.children].find((el) => tagOf(el) === 'legend');
      if (child !== legend) return true;
    }
  }
  return false;
}

const FOCUSABLE =
  'a[href], area[href], button, input, select, textarea, summary, iframe, ' +
  '[contenteditable=""], [contenteditable="true"], [tabindex]';

/**
 * What a press focuses: the nearest focusable ancestor-or-self, or nothing.
 *
 * `tabindex="-1"` counts. It takes an element out of the Tab order, not out of
 * reach of the pointer, and that is the whole basis of roving focus — the
 * options in a listbox are all `-1` but a click still focuses the one pressed.
 */
function focusTarget(element: Element): HTMLElement | null {
  for (let node: Element | null = element; node; node = node.parentElement) {
    if (node.matches(FOCUSABLE) && !isNativelyDisabled(node)) return node as HTMLElement;
  }
  return null;
}

function fire(element: Element, event: Event): boolean {
  const notCancelled = element.dispatchEvent(event);
  flushSync();
  return notCancelled;
}

const pointer = (type: string, init: PointerEventInit): PointerEvent =>
  new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true,
    ...init,
  });

const mouse = (type: string, init: MouseEventInit): MouseEvent =>
  new MouseEvent(type, { bubbles: true, cancelable: true, detail: 1, ...init });

/**
 * The `buttons` bit each `button` holds down: primary, auxiliary, secondary,
 * back, forward.
 */
const BUTTONS = [1, 4, 2, 8, 16];

/** Per list, the option a Shift-press chooses the run from: the last one pressed without it. */
const anchors = new WeakMap<HTMLSelectElement, HTMLOptionElement>();

/**
 * A press on an option of a `<select>` drawn as a list, which a browser
 * answers itself: the selection changes as the button goes down, and is
 * announced with `input` and `change` as it comes up. A press alone chooses
 * that option and no other. In a multiple select, Ctrl or Cmd adds or removes
 * it, and Shift chooses the run from the option last pressed.
 *
 * A select drawn as a drop-down keeps its options in a popup of the browser's
 * own, which no press on the page reaches, so its options are left alone.
 *
 * Returns what to do as the button comes up, or null when the press was not
 * on such an option.
 */
function pressOption(element: Element, init: MouseEventInit): (() => void) | null {
  const option = element.closest('option');
  const select = option?.closest('select');
  if (!option || !select || !isListSelect(select)) return null;

  const options = [...select.options];
  const selection = (): string => [...select.options].map((el) => Number(el.selected)).join('');
  const before = selection();

  if (select.multiple && (init.ctrlKey || init.metaKey)) {
    option.selected = !option.selected;
  } else if (select.multiple && init.shiftKey) {
    const at = options.indexOf(option);
    const anchor = options.indexOf(anchors.get(select) ?? option);
    const [from, to] = anchor < 0 ? [at, at] : [Math.min(at, anchor), Math.max(at, anchor)];
    options.forEach((el, i) => {
      el.selected = i >= from && i <= to && !isNativelyDisabled(el);
    });
  } else {
    for (const el of options) el.selected = el === option;
  }
  if (!init.shiftKey) anchors.set(select, option);

  return () => {
    if (selection() === before) return;
    fire(select, new Event('input', { bubbles: true, composed: true }));
    fire(select, new Event('change', { bubbles: true }));
  };
}

/**
 * A full mouse press: down, focus, up, click.
 *
 * Focus moves on `mousedown` and only if nothing cancelled it, which is how a
 * menu keeps focus on its trigger while its items are pressed — the handler
 * calls `preventDefault()` on the down, and the browser leaves focus alone.
 *
 * Cancelling `pointerdown` goes further: the mouse events of that press are
 * compatibility events, and a browser stops sending them, so there is no
 * `mousedown` to move focus and no `mouseup`. The click is not one of them and
 * arrives regardless.
 *
 * `init.button` chooses the button, and the sequence follows it: only the
 * primary button's release is a `click`. Any other is an `auxclick`, and the
 * secondary one asks for the context menu as it goes down — which is when
 * macOS and Linux ask; Windows waits for the release.
 *
 * A primary press on an option of a `<select>` drawn as a list chooses it, as
 * a browser does between the button going down and the click.
 *
 * A disabled control is sent the pointer events and nothing else. What a
 * browser withholds from one is `mousedown`, `mouseup` and the click; the
 * press still happens, and still takes focus to whatever around the control
 * can hold it, or off everything.
 */
export function click(element: Element, init: PointerEventInit = {}): void {
  const disabled = isNativelyDisabled(element);
  const button = init.button ?? 0;
  const down = { button, buttons: BUTTONS[button] ?? 0, ...init };
  const up = { button, buttons: 0, ...init };

  const pressed = fire(element, pointer('pointerdown', down));
  const mouseEvents = pressed && !disabled;
  let released: (() => void) | null = null;

  if (pressed && (disabled || fire(element, mouse('mousedown', down)))) {
    const target = focusTarget(element);
    if (target) target.focus();
    // A press on nothing focusable takes focus off whatever had it, rather
    // than leaving a stale ring behind — this is how clicking the page
    // background dismisses a focus-driven popover.
    else (element.ownerDocument.activeElement as HTMLElement | null)?.blur();
    if (!disabled && button === 0) released = pressOption(element, init);
    flushSync();
  }
  if (button === 2 && !disabled) fire(element, mouse('contextmenu', down));

  fire(element, pointer('pointerup', up));
  if (disabled) return;

  if (mouseEvents) fire(element, mouse('mouseup', up));
  released?.();
  fire(element, mouse(button === 0 ? 'click' : 'auxclick', up));
}

/**
 * What the pointer is over: the element it last arrived at and everything
 * that element was inside, innermost first, or nothing while it is off the
 * page.
 *
 * There is one pointer, so arriving over one element is leaving the last. The
 * chain is kept rather than walked again when the pointer moves on, because
 * the element may have been removed in between, and the ancestors it left
 * behind are still under the pointer.
 */
let under: Element[] = [];

/** The element and each of its ancestors, innermost first. */
function chain(element: Element): Element[] {
  const nodes: Element[] = [];
  for (let node: Element | null = element; node; node = node.parentElement) nodes.push(node);
  return nodes;
}

/** The boundary events of one move, as pointer events and then as mouse events. */
const BOUNDARIES = [
  {
    out: 'pointerout',
    leave: 'pointerleave',
    over: 'pointerover',
    enter: 'pointerenter',
    make: pointer,
  },
  { out: 'mouseout', leave: 'mouseleave', over: 'mouseover', enter: 'mouseenter', make: mouse },
] as const;

/**
 * Move the pointer from where it is to `element`, or off the page for null.
 *
 * `out` goes to the element left and `over` to the element arrived at, and
 * both bubble. `leave` and `enter` do not: each element crossed is sent its
 * own — a `leave` to everything the pointer is no longer inside, innermost
 * first, and an `enter` to everything it has come into, outermost first — so
 * a wrapper around the element hears the pointer arrive, and an ancestor the
 * pointer never left hears nothing.
 *
 * Each names the other end of the move as its `relatedTarget`: `out` and
 * `leave` where the pointer went, `over` and `enter` where it came from, and
 * null for the page itself. That is how a tooltip tells the pointer crossing
 * from its trigger onto it apart from the pointer going away.
 */
function moveTo(element: Element | null, init: PointerEventInit): void {
  if (element !== null && under[0] === element) return;

  const from = under[0]?.isConnected ? under[0] : null;
  const to = element === null ? [] : chain(element);
  const left = under.filter((node) => node.isConnected && !to.includes(node));
  const entered = to.filter((node) => !under.includes(node)).reverse();
  under = to;

  const going = { relatedTarget: element, ...init };
  const coming = { relatedTarget: from, ...init };
  for (const { out, leave, over, enter, make } of BOUNDARIES) {
    if (from) fire(from, make(out, going));
    for (const node of left) fire(node, make(leave, { ...going, bubbles: false }));
    if (element) fire(element, make(over, coming));
    for (const node of entered) fire(node, make(enter, { ...coming, bubbles: false }));
  }
}

/**
 * The pointer arriving over an element, from wherever it was: the boundary
 * events of the move, then the move itself.
 */
export function hover(element: Element, init: PointerEventInit = {}): void {
  moveTo(element, init);
  fire(element, pointer('pointermove', init));
  fire(element, mouse('mousemove', init));
}

/**
 * The pointer leaving the page from over an element, and with it everything
 * the element is inside. Where it was over something within the element, it
 * leaves from there.
 */
export function unhover(element: Element, init: PointerEventInit = {}): void {
  if (!under.includes(element)) under = chain(element);
  moveTo(null, init);
}

/**
 * Move focus, through the platform rather than by dispatching a `focus` event.
 *
 * `dispatchEvent(new FocusEvent('focus'))` notifies the listeners and leaves
 * `document.activeElement` pointing somewhere else, so every subsequent
 * assertion about focus is a lie. `.focus()` is what a browser does.
 */
export function focus(element: Element): void {
  (element as HTMLElement).focus();
  flushSync();
}

export function blur(element: Element): void {
  (element as HTMLElement).blur();
  flushSync();
}

/**
 * Whether the browser itself would raise a click from this key.
 *
 * Only the host language's own activation is listed. A `<div role="button">`
 * is not here, because no browser synthesizes a click for one — a widget built
 * out of `<div>`s has to handle the key itself, and a helper that clicked on
 * its behalf would hide exactly the omission that leaves keyboard users stuck.
 */
function nativeActivation(element: Element, key: string): boolean {
  const activation = key === 'Enter' || key === ' ';
  switch (tagOf(element)) {
    case 'button':
    case 'summary':
      return activation;
    case 'a':
    case 'area':
      // Space scrolls the page on a link; only Enter follows it.
      return key === 'Enter' && element.hasAttribute('href');
    case 'input': {
      const type = (element.getAttribute('type') ?? 'text').toLowerCase();
      if (type === 'checkbox' || type === 'radio') return key === ' ';
      return (type === 'button' || type === 'submit' || type === 'reset') && activation;
    }
    default:
      return false;
  }
}

/** Whether this control submits its form when it is activated. */
function isSubmitButton(element: Element): boolean {
  const tag = tagOf(element);
  if (tag === 'button') return (element as HTMLButtonElement).type === 'submit';
  if (tag !== 'input') return false;
  const type = (element as HTMLInputElement).type;
  return type === 'submit' || type === 'image';
}

/**
 * Implicit submission: what a browser does with Enter in a form's text field.
 *
 * The form's default button — its first submit button — is clicked, so a
 * handler on that button runs as it does for a user who never touched it. A
 * disabled default button blocks the submission rather than being passed over.
 * A form with no submit button is submitted directly, unless it holds more
 * than one text field, where Enter in one of them is not taken to mean the
 * form is finished.
 */
function submitImplicitly(field: HTMLInputElement): void {
  const form = field.form;
  if (!form) return;

  const controls = [...form.elements];
  const button = controls.find(isSubmitButton);
  if (button) {
    if (!isNativelyDisabled(button)) fire(button, mouse('click', { detail: 0 }));
    return;
  }

  const fields = controls.filter((el) => tagOf(el) === 'input' && isTextField(el));
  if (fields.length > 1) return;
  form.requestSubmit();
  flushSync();
}

/**
 * Press and release a key.
 *
 * The click a browser raises from Enter or Space is raised here too, and at
 * the point the browser raises it: Enter activates on the way down, Space on
 * the way up. That difference is not pedantry — a component cancelling Space
 * on `keydown` to stop the page scrolling is also, on a `<button>`, cancelling
 * the click that would otherwise arrive on `keyup` and toggle it a second
 * time. Getting the order wrong here would make that double-toggle invisible.
 */
export function press(element: Element, key: string, init: KeyboardEventInit = {}): void {
  if (isNativelyDisabled(element)) return;

  const alive = fire(
    element,
    new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init, key }),
  );

  if (alive && key === 'Enter') {
    if (nativeActivation(element, key)) fire(element, mouse('click', { detail: 0 }));
    else if (tagOf(element) === 'input' && isTextField(element)) {
      // Enter in a single-line field commits what was typed, with or without
      // a form around it, and then submits the form if there is one.
      if (editing?.field === element) commit();
      submitImplicitly(element as HTMLInputElement);
    }
  }

  fire(element, new KeyboardEvent('keyup', { bubbles: true, cancelable: true, ...init, key }));

  if (alive && key === ' ' && nativeActivation(element, key)) {
    fire(element, mouse('click', { detail: 0 }));
  }
}

/**
 * The field being edited, from the first character typed into it until it
 * commits.
 *
 * A browser keeps two things about a field in use that its `value` does not
 * hold. One is the value it had when the editing began, which is what decides
 * whether leaving it is a `change`. The other is the text as typed: a number
 * field holding "-" reports an empty value, and the "3" typed next still makes
 * "-3". Only one field is edited at a time, so one record is enough.
 */
interface Editing {
  field: TextField;
  initial: string;
  typed: string;
  /** `value` as the last write left it, to notice a handler rewriting it. */
  written: string;
}

let editing: Editing | null = null;

function edit(field: TextField): Editing {
  if (editing?.field !== field) {
    commit();
    editing = { field, initial: field.value, typed: field.value, written: field.value };
    // Leaving the field commits it, however focus leaves: a helper, a handler
    // that moves it, or a test calling `.blur()` itself. Heard on the document
    // in the capture phase, ahead of every listener on the field, so the
    // `change` goes out before anything hears the `blur` — the browser's order.
    field.ownerDocument.addEventListener('blur', left, true);
  } else if (field.value !== editing.written) {
    // A handler rewrote the value — a mask, or a tags input taking what was
    // typed — so that is the text the next character joins.
    editing.typed = editing.written = field.value;
  }
  return editing;
}

function left(event: Event): void {
  if (event.target === editing?.field) commit();
}

/**
 * End the editing, with the `change` a browser sends when a field is left, or
 * Enter is pressed in it, holding something other than what it began with.
 */
function commit(): void {
  const done = editing;
  if (done === null) return;
  editing = null;
  done.field.ownerDocument.removeEventListener('blur', left, true);
  if (done.field.isConnected && done.field.value !== done.initial) {
    fire(done.field, new Event('change', { bubbles: true }));
  }
}

/**
 * Type into a text field, one character at a time.
 *
 * Per character, because that is what the field's own handler sees: a search
 * box that debounces, a tags input that splits on a comma, and a masked date
 * field all behave differently for "0102" arriving as four events than as one
 * assignment to `value`.
 *
 * Text is appended. There is no caret model here — `clear()` covers replacing
 * what is there, and anything finer belongs in an end-to-end test with a real
 * browser behind it.
 */
export function typeText(element: Element, text: string): void {
  const field = writableField(element, 'typeText');
  if (!field) return;

  focus(field);

  // Iterating the string rather than indexing it: an emoji or an accented
  // character built from a surrogate pair is one keystroke, not two.
  for (const char of text) {
    if (fire(field, new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: char }))) {
      insert(field, char, 'insertText', edit(field).typed + char);
    }
    // Released whatever happened above: cancelling a keydown suppresses the
    // character, never the key coming back up.
    fire(field, new KeyboardEvent('keyup', { bubbles: true, cancelable: true, key: char }));
  }
}

/**
 * Empty a text field the way selecting all and deleting does — one
 * `deleteContentBackward`, not one per character.
 */
export function clear(element: Element): void {
  const field = writableField(element, 'clear');
  if (!field || field.value === '') return;

  focus(field);
  edit(field);
  insert(field, null, 'deleteContentBackward', '');
}

type TextField = HTMLInputElement | HTMLTextAreaElement;

/** The fields `maxlength` limits. A number, date or time field ignores it. */
const LENGTH_LIMITED = new Set(['textarea', 'text', 'search', 'url', 'tel', 'email', 'password']);

/**
 * The field, or null when the platform would ignore the input anyway.
 *
 * A wrong element is a mistake in the test and throws; a `readonly` or
 * disabled field is a legitimate state to drive at, and typing into one
 * quietly doing nothing is exactly what a browser does.
 */
function writableField(element: Element, helper: string): TextField | null {
  if (!isTextField(element)) {
    throw new Error(
      `[volt] ${helper}() needs a text field, but was given <${tagOf(element)}>. ` +
        'For a contenteditable or a custom editor, dispatch the input events the ' +
        'component listens for directly.',
    );
  }
  if (isNativelyDisabled(element) || element.hasAttribute('readonly')) return null;
  return element as TextField;
}

/**
 * `beforeinput`, the write, then `input` — cancelling the first skips both,
 * and so does a field already at its `maxlength`, which offers the character
 * and then declines it. The limit is on what a user types and not on what a
 * script assigns, so it has to be kept here.
 */
function insert(field: TextField, data: string | null, inputType: string, next: string): void {
  const before = new InputEvent('beforeinput', {
    bubbles: true,
    cancelable: true,
    inputType,
    data,
  });
  if (!fire(field, before)) return;

  // `maxLength` is -1 where the attribute is absent, and reflects it on every
  // type, so whether it applies is asked of the type.
  const limit = LENGTH_LIMITED.has(field.type) ? field.maxLength : -1;
  if (limit >= 0 && next.length > Math.max(limit, field.value.length)) return;

  field.value = next;
  if (editing?.field === field) {
    editing.typed = next;
    editing.written = field.value;
  }
  fire(field, new InputEvent('input', { bubbles: true, inputType, data }));
}
