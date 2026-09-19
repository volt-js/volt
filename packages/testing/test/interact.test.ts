/**
 * Interactions, against a real primitive wherever the answer depends on one.
 *
 * The checkbox from `@voltdev/primitives` is used rather than a hand-written
 * `<div role="checkbox">` on purpose: it disables with `aria-disabled` and
 * keeps a visually hidden native `<input type="checkbox">` beside the control
 * for form submission, which is exactly the shape that catches a query written
 * against markup — two checkboxes in the DOM, one in the accessibility tree.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Component, Signal, flushSync } from '@voltdev/core';
import { compileTemplate } from '@voltdev/core/jit';
import { createCheckbox, createTooltip } from '@voltdev/primitives';
import { getByRole, queryAllByRole } from '../src/queries.ts';
import { cleanup, render } from '../src/render.ts';
import { blur, clear, click, focus, hover, press, typeText, unhover } from '../src/interact.ts';

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

/** Whether the checkbox the next render builds is disabled. */
let disabled = new Signal.State(false);

beforeEach(() => {
  disabled = new Signal.State(false);
});

const markup = (html: string): HTMLElement => {
  document.body.innerHTML = html;
  return document.body;
};

/** Every event a listener saw, in the order it arrived. */
function record(element: Element, types: readonly string[]): string[] {
  const seen: string[] = [];
  for (const type of types) element.addEventListener(type, (event) => seen.push(event.type));
  return seen;
}

const POINTER_SEQUENCE = [
  'pointerdown',
  'mousedown',
  'pointerup',
  'mouseup',
  'click',
] as const;

// ---------------------------------------------------------------------------
// A real checkbox
// ---------------------------------------------------------------------------

@Component({
  selector: 'v-check',
  render: compileTemplate(`
    <div>
      <div :spread="cb.controlProps()"
           :click="cb.toggle()"
           :keydown="cb.onKeyDown($event)">Ship it</div>
      <input :ref="input" :spread="cb.inputProps()">
    </div>
  `),
})
class CheckboxComponent {
  input = new Signal.State<Element | null>(null);
  cb = createCheckbox({
    disabled: () => disabled.get(),
    input: () => this.input.get(),
  });
}

describe('finding a primitive through its accessibility surface', () => {
  it('finds the control and not the hidden input that submits it', () => {
    const view = render(CheckboxComponent);

    // Two elements in the DOM expose a checkbox role; one of them is
    // `aria-hidden`, so a user — and this query — sees one.
    expect(view.container.querySelectorAll('input[type="checkbox"]')).toHaveLength(1);
    expect(queryAllByRole(view.container, 'checkbox', { hidden: true })).toHaveLength(2);

    // Unnarrowed on purpose. Asking by name would pick the control whether or
    // not the query consulted the accessibility tree, since the mirror carries
    // no name; asking for "the checkbox" is only unambiguous because the
    // mirror is not in the tree at all. This is the assertion that goes red if
    // the hidden filter is dropped — it starts throwing on two matches.
    const control = view.getByRole('checkbox');
    expect(control).toBe(view.getByRole('checkbox', { name: 'Ship it' }));
    expect(control.tagName.toLowerCase()).toBe('div');
    expect(control.getAttribute('aria-checked')).toBe('false');
  });

  it('narrows by the state the primitive publishes', () => {
    const view = render(CheckboxComponent);
    view.instance.cb.setChecked(true);
    flushSync();

    expect(view.getByRole('checkbox', { checked: true, name: 'Ship it' })).toBeTruthy();
    expect(view.queryByRole('checkbox', { checked: false })).toBeNull();
  });
});

describe('click', () => {
  it('dispatches the sequence a browser dispatches, in order', () => {
    const root = markup('<button>Save</button>');
    const button = getByRole(root, 'button');
    const seen = record(button, POINTER_SEQUENCE);

    click(button);

    expect(seen).toEqual([...POINTER_SEQUENCE]);
  });

  it('drives a primitive that only listens for one of them', () => {
    const view = render(CheckboxComponent);
    const control = view.getByRole('checkbox', { name: 'Ship it' });

    click(control);
    expect(view.instance.cb.isChecked()).toBe(true);
    expect(control.getAttribute('aria-checked')).toBe('true');

    click(control);
    expect(view.instance.cb.isChecked()).toBe(false);
  });

  it('keeps the hidden input in step, so the form would submit what is on screen', () => {
    const view = render(CheckboxComponent);
    click(view.getByRole('checkbox', { name: 'Ship it' }));

    expect(view.container.querySelector<HTMLInputElement>('input')!.checked).toBe(true);
  });

  it('moves focus on mousedown, to the nearest focusable ancestor', () => {
    const root = markup('<button><span id="label">Save</span></button>');
    click(document.querySelector('#label')!);

    expect(document.activeElement).toBe(root.querySelector('button'));
  });

  it('leaves focus alone when mousedown is cancelled', () => {
    const root = markup('<input id="field"><button>Save</button>');
    const field = root.querySelector<HTMLInputElement>('#field')!;
    field.focus();

    const button = root.querySelector('button')!;
    // What a menu trigger does to keep focus where it is while its items are
    // pressed.
    button.addEventListener('mousedown', (event) => event.preventDefault());
    click(button);

    expect(document.activeElement).toBe(field);
  });

  it('sends no mouse events and moves no focus when pointerdown is cancelled', () => {
    const root = markup('<input id="field"><button>Save</button>');
    const field = root.querySelector<HTMLInputElement>('#field')!;
    field.focus();

    const button = root.querySelector('button')!;
    button.addEventListener('pointerdown', (event) => event.preventDefault());
    const seen = record(button, POINTER_SEQUENCE);
    click(button);

    // Cancelling `pointerdown` takes the compatibility mouse events of that
    // press away, and the focus move with them, since it is `mousedown` that
    // moves focus. The click is not one of them and still arrives. A widget
    // that cancels `pointerdown` and listens for `mousedown` is broken in a
    // browser, and has to be broken here.
    expect(seen).toEqual(['pointerdown', 'pointerup', 'click']);
    expect(document.activeElement).toBe(field);
  });

  it('sends auxclick and not click for any button but the primary one', () => {
    const root = markup('<button>Save</button>');
    const button = root.querySelector('button')!;
    const seen: string[] = [];
    for (const type of [...POINTER_SEQUENCE, 'auxclick', 'contextmenu']) {
      button.addEventListener(type, (event) =>
        seen.push(`${event.type} ${(event as MouseEvent).button}/${(event as MouseEvent).buttons}`),
      );
    }

    click(button, { button: 2 });
    expect(seen).toEqual([
      'pointerdown 2/2',
      'mousedown 2/2',
      'contextmenu 2/2',
      'pointerup 2/0',
      'mouseup 2/0',
      'auxclick 2/0',
    ]);
    // Any button's press moves focus; only the primary one's release clicks.
    expect(document.activeElement).toBe(button);

    seen.length = 0;
    click(button, { button: 1 });
    expect(seen).toEqual(['pointerdown 1/4', 'mousedown 1/4', 'pointerup 1/0', 'mouseup 1/0', 'auxclick 1/0']);

    // The back and forward buttons hold bits of their own, which a handler
    // for mouse navigation reads from `buttons`.
    seen.length = 0;
    click(button, { button: 3 });
    click(button, { button: 4 });
    expect(seen.filter((entry) => entry.startsWith('pointerdown'))).toEqual([
      'pointerdown 3/8',
      'pointerdown 4/16',
    ]);
  });

  it('chooses an option of a select drawn as a list, and announces it as the button comes up', () => {
    const root = markup(
      '<select multiple aria-label="Colours"><option>Red</option><option>Green</option>' +
        '<option>Blue</option><option disabled>Grey</option><option>Pink</option></select>',
    );
    const select = getByRole(root, 'listbox', { name: 'Colours' }) as HTMLSelectElement;
    const option = (name: string): HTMLElement => getByRole(select, 'option', { name });
    const chosen = (): string[] => [...select.options].filter((el) => el.selected).map((el) => el.text);
    const seen = record(select, ['mousedown', 'input', 'change', 'mouseup', 'click']);

    click(option('Green'));
    expect(chosen()).toEqual(['Green']);
    expect(seen).toEqual(['mousedown', 'mouseup', 'input', 'change', 'click']);
    expect(document.activeElement).toBe(select);

    // Ctrl adds to the selection; Shift chooses the run from the option last
    // pressed without it, passing over one that cannot be chosen; a press
    // alone starts again.
    click(option('Red'), { ctrlKey: true });
    expect(chosen()).toEqual(['Red', 'Green']);
    click(option('Pink'), { shiftKey: true });
    expect(chosen()).toEqual(['Red', 'Green', 'Blue', 'Pink']);
    click(option('Blue'));
    expect(chosen()).toEqual(['Blue']);

    // Pressing the whole selection again changes nothing, and says nothing.
    seen.length = 0;
    click(option('Blue'));
    expect(seen).toEqual(['mousedown', 'mouseup', 'click']);
  });

  it('leaves the options of a drop-down select alone, which the page cannot press', () => {
    const root = markup(
      '<select aria-label="Size"><option>S</option><option>M</option></select>' +
        '<select aria-label="Fit" size="wide"><option>Slim</option><option>Loose</option></select>',
    );
    const select = getByRole(root, 'combobox', { name: 'Size' }) as HTMLSelectElement;

    click(getByRole(select, 'option', { name: 'M' }));
    expect(select.value).toBe('S');

    // A `size` that is not a number above one draws a drop-down all the same,
    // and it is the role that says so: what a query calls a combobox, a press
    // treats as one.
    const fit = getByRole(root, 'combobox', { name: 'Fit' }) as HTMLSelectElement;
    click(getByRole(fit, 'option', { name: 'Loose' }));
    expect(fit.value).toBe('Slim');
  });

  it('takes focus off everything when nothing focusable was pressed', () => {
    const root = markup('<input id="field"><div id="page">background</div>');
    root.querySelector<HTMLInputElement>('#field')!.focus();

    click(root.querySelector('#page')!);

    expect(document.activeElement).not.toBe(root.querySelector('#field'));
  });

  it('focuses an element that is out of the Tab order but not out of reach', () => {
    const root = markup('<div role="option" tabindex="-1">Apple</div>');
    const option = getByRole(root, 'option');

    click(option);

    expect(document.activeElement).toBe(option);
  });
});

describe('a disabled control', () => {
  it('is sent the pointer events of a press, and none of the mouse events or the click', () => {
    const root = markup(
      '<input id="field"><button disabled><span id="label">Save</span></button>',
    );
    root.querySelector<HTMLInputElement>('#field')!.focus();
    const seen = record(root, POINTER_SEQUENCE);

    click(root.querySelector('#label')!);

    // What a browser withholds from a disabled control is `mousedown`,
    // `mouseup` and `click`. The pointer events still arrive, and the press
    // still takes focus off whatever had it, as a press on anything that
    // cannot be focused does.
    expect(seen).toEqual(['pointerdown', 'pointerup']);
    expect(document.activeElement).toBe(document.body);
  });

  it('can be hovered, which is how a tooltip explains why it is disabled', () => {
    const root = markup('<button disabled>Save</button>');
    const button = root.querySelector('button')!;
    const seen = record(button, ['pointerenter', 'mouseenter', 'pointerleave', 'mouseleave']);

    hover(button);
    unhover(button);

    expect(seen).toEqual(['pointerenter', 'mouseenter', 'pointerleave', 'mouseleave']);
  });

  it('is disabled by a fieldset only if it is a form control, and not in its legend', () => {
    const root = markup(
      `<fieldset disabled>
         <legend><button id="legend">Expand</button></legend>
         <div id="div" role="button" tabindex="0">Pick</div>
         <a id="link" href="#x">More</a>
         <button id="button"><span id="inner">Save</span></button>
         <fieldset><legend><button id="nested">Nested</button></legend></fieldset>
       </fieldset>`,
    );
    const clicked: string[] = [];
    // On the fieldset rather than on `root`, which is the body every later
    // test in the file shares.
    root.querySelector('fieldset')!.addEventListener('click', (event) => {
      event.preventDefault();
      clicked.push((event.target as Element).id);
    });

    // A disabled fieldset disables the form controls inside it. A link, or a
    // widget built out of `<div>`s, is as live there as anywhere, and so are
    // the controls in the fieldset's own legend — but not those in the legend
    // of a fieldset nested inside it, which the outer one still disables.
    for (const id of ['legend', 'div', 'link', 'inner', 'nested']) {
      click(root.querySelector(`#${id}`)!);
    }
    expect(clicked).toEqual(['legend', 'div', 'link']);

    const field = markup('<fieldset disabled><input id="a"></fieldset>').querySelector('#a')!;
    typeText(field, 'x');
    expect((field as HTMLInputElement).value).toBe('');
  });

  it('receives every event when it is only aria-disabled, and ignores them', () => {
    disabled.set(true);
    const view = render(CheckboxComponent);
    const control = view.getByRole('checkbox', { name: 'Ship it' });
    expect(control.getAttribute('aria-disabled')).toBe('true');

    const seen = record(control, POINTER_SEQUENCE);
    click(control);

    // The events land — `aria-disabled` says nothing to the browser, and
    // refusing to dispatch would make this test pass against a component that
    // never checks. It is the primitive that declines to change.
    expect(seen).toEqual([...POINTER_SEQUENCE]);
    expect(view.instance.cb.isChecked()).toBe(false);
    expect(control.getAttribute('aria-checked')).toBe('false');
  });

  it('starts working again when it is enabled', () => {
    disabled.set(true);
    const view = render(CheckboxComponent);
    const control = view.getByRole('checkbox', { name: 'Ship it' });

    click(control);
    expect(view.instance.cb.isChecked()).toBe(false);

    disabled.set(false);
    flushSync();
    click(control);
    expect(view.instance.cb.isChecked()).toBe(true);
  });

  it('is not typed into when it is readonly', () => {
    const root = markup('<input id="a" readonly value="fixed"><input id="b" disabled>');
    typeText(root.querySelector('#a')!, 'x');
    typeText(root.querySelector('#b')!, 'x');

    expect(root.querySelector<HTMLInputElement>('#a')!.value).toBe('fixed');
    expect(root.querySelector<HTMLInputElement>('#b')!.value).toBe('');
  });
});

describe('press', () => {
  it('raises the click a browser raises from Enter, before the key comes up', () => {
    const root = markup('<button>Save</button>');
    const button = root.querySelector('button')!;
    const seen = record(button, ['keydown', 'click', 'keyup']);

    press(button, 'Enter');

    expect(seen).toEqual(['keydown', 'click', 'keyup']);
  });

  it('raises it from Space after the key comes up', () => {
    const root = markup('<button>Save</button>');
    const button = root.querySelector('button')!;
    const seen = record(button, ['keydown', 'click', 'keyup']);

    press(button, ' ');

    // The order is the reason a component cancels Space on keydown: the click
    // it is suppressing has not happened yet.
    expect(seen).toEqual(['keydown', 'keyup', 'click']);
  });

  it('suppresses that click when the keydown was cancelled', () => {
    const root = markup('<button>Save</button>');
    const button = root.querySelector('button')!;
    const clicks = vi.fn();
    button.addEventListener('click', clicks);
    button.addEventListener('keydown', (event) => event.preventDefault());

    press(button, ' ');
    press(button, 'Enter');

    expect(clicks).not.toHaveBeenCalled();
  });

  it('toggles a checkbox once on Space, not twice', () => {
    @Component({
      selector: 'v-check-button',
      render: compileTemplate(`
        <button :spread="cb.controlProps()"
                :click="cb.toggle()"
                :keydown="cb.onKeyDown($event)">Ship it</button>
      `),
    })
    class CheckboxButton {
      cb = createCheckbox();
    }

    const view = render(CheckboxButton);
    press(view.getByRole('checkbox', { name: 'Ship it' }), ' ');

    // The primitive toggles from its own keydown handler and cancels the
    // event; the click the browser would otherwise raise on keyup — and would
    // toggle straight back — never arrives.
    expect(view.instance.cb.isChecked()).toBe(true);
  });

  it('raises no click for a widget built out of divs', () => {
    const root = markup('<div role="button" tabindex="0">Save</div>');
    const control = getByRole(root, 'button');
    const clicks = vi.fn();
    control.addEventListener('click', clicks);

    press(control, 'Enter');
    press(control, ' ');

    // No browser synthesizes a click for `role="button"`. A helper that did
    // would make a widget with no keydown handler look reachable by keyboard
    // when it is not.
    expect(clicks).not.toHaveBeenCalled();
  });

  it('follows a link on Enter but not on Space', () => {
    const root = markup('<a href="/x">Go</a><a id="nohref">Go</a>');
    const link = root.querySelector('a')!;
    const clicks = vi.fn();
    link.addEventListener('click', clicks);
    root.querySelector('#nohref')!.addEventListener('click', clicks);

    press(link, ' ');
    expect(clicks).not.toHaveBeenCalled();

    press(link, 'Enter');
    expect(clicks).toHaveBeenCalledTimes(1);

    press(root.querySelector('#nohref')!, 'Enter');
    expect(clicks).toHaveBeenCalledTimes(1);
  });

  it('carries modifiers and reaches a delegated handler', () => {
    @Component({
      selector: 'v-keys',
      render: compileTemplate(`
        <div :keydown="log($event)" tabindex="0" role="grid">
          <span>{ last.get() }</span>
        </div>
      `),
    })
    class Keys {
      last = new Signal.State('');
      log(event: KeyboardEvent): void {
        this.last.set(`${event.shiftKey ? 'Shift+' : ''}${event.key}`);
      }
    }

    const view = render(Keys);
    press(view.getByRole('grid'), 'ArrowDown', { shiftKey: true });

    expect(view.getByRole('grid').textContent).toBe('Shift+ArrowDown');
  });

  it('submits the form from Enter in a field, through its default button', () => {
    const view = render(SignIn);
    const name = view.getByRole('textbox', { name: 'Name' });
    const seen: string[] = [];
    for (const type of ['keydown', 'change', 'click', 'submit', 'keyup']) {
      view.container.addEventListener(type, (event) =>
        seen.push(`${event.type} ${(event.target as Element).tagName.toLowerCase()}`),
      );
    }

    typeText(name, 'Ada');
    seen.length = 0;
    press(name, 'Enter');

    // Implicit submission: the field commits what was typed, and the browser
    // clicks the form's first submit button on the user's behalf — so a
    // handler on that button runs, as it does for a user who never touched it.
    expect(seen).toEqual(['keydown input', 'change input', 'click button', 'submit form', 'keyup input']);
    expect(view.instance.submitted).toEqual(['Ada']);
  });

  it('submits a form with one field and no button, and not one with two', () => {
    // Inside a wrapper of its own, so the listener that cancels every
    // submission goes when the markup does rather than staying on the body.
    const root = markup(
      '<div id="forms">' +
        '<form id="one"><input aria-label="Query"></form>' +
        '<form id="two"><input aria-label="First"><input aria-label="Last"></form>' +
        '<form id="off"><input aria-label="Code"><button disabled>Go</button></form>' +
        '<form id="area"><textarea aria-label="Notes"></textarea></form>' +
        '</div>',
    ).querySelector('#forms')!;
    const submitted: string[] = [];
    root.addEventListener('submit', (event) => {
      event.preventDefault();
      submitted.push((event.target as Element).id);
    });

    for (const name of ['Query', 'First', 'Code', 'Notes']) {
      press(getByRole(root, 'textbox', { name }), 'Enter');
    }

    // Two fields and no button is the one a browser will not submit; a
    // disabled default button blocks the submission rather than being passed
    // over; and Enter in a text area is a new line.
    expect(submitted).toEqual(['one']);
  });

  it('submits nothing when the keydown was cancelled', () => {
    const root = markup('<form><input aria-label="Query"></form>');
    const submitted = record(root, ['submit']);
    const field = getByRole(root, 'textbox', { name: 'Query' });
    field.addEventListener('keydown', (event) => event.preventDefault());

    press(field, 'Enter');

    expect(submitted).toEqual([]);
  });

  it('does nothing to a natively disabled control', () => {
    const root = markup('<button disabled>Save</button>');
    const seen = record(root, ['keydown', 'keyup', 'click']);

    press(root.querySelector('button')!, 'Enter');

    expect(seen).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Typing
// ---------------------------------------------------------------------------

@Component({
  selector: 'v-sign-in',
  render: compileTemplate(`
    <form :submit.prevent="submit()">
      <input aria-label="Name" :model.lazy="name">
      <input aria-label="Team" maxlength="3" :change="changes.push($event.target.value)">
      <button>Sign in</button>
    </form>
  `),
})
class SignIn {
  name = new Signal.State('');
  changes: string[] = [];
  submitted: string[] = [];

  submit(): void {
    this.submitted.push(this.name.get());
  }
}

@Component({
  selector: 'v-search',
  render: compileTemplate(`
    <div>
      <input aria-label="Search"
             :value="text.get()"
             :input="text.set($event.target.value)">
      <p role="status">{ text.get() }</p>
    </div>
  `),
})
class Search {
  text = new Signal.State('');
}

describe('typing', () => {
  it('sends one event per character', () => {
    const view = render(Search);
    const field = view.getByRole('textbox', { name: 'Search' });
    const inputs: string[] = [];
    field.addEventListener('input', (event) => inputs.push(String((event as InputEvent).data)));

    typeText(field, 'cat');

    // A search box that debounces, or a tags input that splits on a comma,
    // behaves differently for three events than for one assignment to `value`.
    expect(inputs).toEqual(['c', 'a', 't']);
    expect(view.instance.text.get()).toBe('cat');
    expect(view.getByRole('status').textContent).toBe('cat');
  });

  it('settles the DOM between characters', () => {
    const view = render(Search);
    const field = view.getByRole('textbox', { name: 'Search' });
    const rendered: string[] = [];
    field.addEventListener('keydown', () => rendered.push(view.getByRole('status').textContent!));

    typeText(field, 'cat');

    // What the page showed as each key went down: the character before it is
    // already painted. Volt coalesces onto a microtask, so this is the
    // assertion that the helper flushes rather than leaving three keystrokes
    // to land at once — which is the difference between a debounce test that
    // means something and one that does not.
    expect(rendered).toEqual(['', 'c', 'ca']);
  });

  it('focuses the field first, the way typing into one requires', () => {
    const view = render(Search);
    const field = view.getByRole('textbox', { name: 'Search' });

    typeText(field, 'a');

    expect(document.activeElement).toBe(field);
  });

  it('counts a character built from a surrogate pair as one keystroke', () => {
    const view = render(Search);
    const field = view.getByRole('textbox', { name: 'Search' });
    const keys: string[] = [];
    field.addEventListener('keydown', (event) => keys.push((event as KeyboardEvent).key));

    typeText(field, 'a🎉');

    expect(keys).toEqual(['a', '🎉']);
    expect(view.instance.text.get()).toBe('a🎉');
  });

  it('writes nothing when beforeinput is cancelled', () => {
    const view = render(Search);
    const field = view.getByRole('textbox', { name: 'Search' });
    field.addEventListener('beforeinput', (event) => event.preventDefault());
    const keys: string[] = [];
    field.addEventListener('keyup', (event) => keys.push((event as KeyboardEvent).key));

    typeText(field, 'ab');

    expect(view.instance.text.get()).toBe('');
    // The character is suppressed; the key still comes back up.
    expect(keys).toEqual(['a', 'b']);
  });

  it('empties a field with one deletion rather than one per character', () => {
    const view = render(Search);
    const field = view.getByRole('textbox', { name: 'Search' });
    typeText(field, 'cat');

    const types: string[] = [];
    field.addEventListener('input', (event) => types.push((event as InputEvent).inputType));
    clear(field);

    expect(types).toEqual(['deleteContentBackward']);
    expect(view.instance.text.get()).toBe('');
  });

  it('stops at maxlength, as a field does for a user and not for a script', () => {
    const view = render(SignIn);
    const team = view.getByRole('textbox', { name: 'Team' }) as HTMLInputElement;
    const seen = record(team, ['keydown', 'beforeinput', 'input', 'keyup']);

    typeText(team, 'abcd');

    expect(team.value).toBe('abc');
    // The fourth key goes down, offers its character, and comes back up; the
    // field refuses the insertion, so there is no `input` to hear.
    expect(seen.slice(-3)).toEqual(['keydown', 'beforeinput', 'keyup']);
    expect(seen.filter((type) => type === 'input')).toHaveLength(3);
  });

  it('keeps maxlength to the fields it applies to, and a text area is one', () => {
    const root = markup(
      '<textarea aria-label="Bio" maxlength="2"></textarea>' +
        '<input type="number" aria-label="Count" maxlength="1">',
    );
    const bio = getByRole(root, 'textbox', { name: 'Bio' }) as HTMLTextAreaElement;
    const count = getByRole(root, 'spinbutton', { name: 'Count' }) as HTMLInputElement;

    typeText(bio, 'abc');
    typeText(count, '12');

    // The property reflects the attribute on every type, and a number field
    // ignores it all the same.
    expect(bio.value).toBe('ab');
    expect(count.value).toBe('12');
  });

  it('commits with change when focus leaves, before the blur', () => {
    const view = render(SignIn);
    const name = view.getByRole('textbox', { name: 'Name' });
    const seen = record(name, ['change', 'blur']);

    typeText(name, 'Ada');
    // A lazy model syncs on `change`, and typing alone is not one.
    expect(view.instance.name.get()).toBe('');

    blur(name);
    expect(seen).toEqual(['change', 'blur']);
    expect(view.instance.name.get()).toBe('Ada');
  });

  it('commits when a press or a focus move takes focus elsewhere', () => {
    const view = render(SignIn);
    const name = view.getByRole('textbox', { name: 'Name' });
    const team = view.getByRole('textbox', { name: 'Team' });

    typeText(name, 'Ada');
    typeText(team, 'ops');
    expect(view.instance.name.get()).toBe('Ada');
    expect(view.instance.changes).toEqual([]);

    click(view.getByRole('button', { name: 'Sign in' }));
    expect(view.instance.changes).toEqual(['ops']);
    expect(view.instance.submitted).toEqual(['Ada']);
  });

  it('commits when a handler moves focus on, not only when a helper does', () => {
    const root = markup('<input aria-label="Code" maxlength="3"><input aria-label="Next">');
    const code = getByRole(root, 'textbox', { name: 'Code' }) as HTMLInputElement;
    const next = getByRole(root, 'textbox', { name: 'Next' });
    const seen: string[] = [];
    code.addEventListener('change', () => seen.push(`change ${code.value}`));
    code.addEventListener('blur', () => seen.push('blur'));
    // A code field that moves on by itself once it is full.
    code.addEventListener('input', () => {
      if (code.value.length === 3) next.focus();
    });

    typeText(code, '123');

    expect(seen).toEqual(['change 123', 'blur']);
    expect(document.activeElement).toBe(next);
  });

  it('sends no change for a value that ended where it began', () => {
    const view = render(SignIn);
    const team = view.getByRole('textbox', { name: 'Team' });

    typeText(team, 'ab');
    blur(team);
    typeText(team, 'c');
    clear(team);
    typeText(team, 'ab');
    blur(team);
    focus(team);
    blur(team);

    expect(view.instance.changes).toEqual(['ab']);
  });

  it('types a value that is only valid once it is finished', () => {
    const root = markup('<input type="number" aria-label="Offset">');
    const field = getByRole(root, 'spinbutton', { name: 'Offset' }) as HTMLInputElement;
    const values: string[] = [];
    field.addEventListener('input', () => values.push(field.value));

    typeText(field, '-3');

    // A number field holding "-" has no value to report yet, and a browser
    // keeps the sign all the same: what is typed next joins it. Appending to
    // `value` instead would lose it and type 3.
    expect(values).toEqual(['', '-3']);
    expect(field.value).toBe('-3');

    // A date has no valid value until the last digit is in, and arrives whole.
    const date = document.createElement('input');
    date.type = 'date';
    root.append(date);
    typeText(date, '2024-01-15');
    expect(date.value).toBe('2024-01-15');
  });

  it('carries on from what a handler left in the field', () => {
    const root = markup('<input aria-label="Tags">');
    const field = getByRole(root, 'textbox', { name: 'Tags' }) as HTMLInputElement;
    const tags: string[] = [];
    // A tags input: a comma takes what was typed and empties the field.
    field.addEventListener('input', () => {
      if (!field.value.endsWith(',')) return;
      tags.push(field.value.slice(0, -1));
      field.value = '';
    });

    typeText(field, 'a,bc');

    expect(tags).toEqual(['a']);
    expect(field.value).toBe('bc');
  });

  it('types into an input of a type the browser does not know, which is a text field', () => {
    const root = markup('<form><input type="postcode" aria-label="Postcode"></form>');
    const field = getByRole(root, 'textbox', { name: 'Postcode' }) as HTMLInputElement;
    let submitted = 0;
    root.querySelector('form')!.addEventListener('submit', (event) => {
      event.preventDefault();
      submitted++;
    });

    typeText(field, 'N1');
    press(field, 'Enter');

    expect(field.value).toBe('N1');
    expect(submitted).toBe(1);
  });

  it('says what to do instead when given something that is not a field', () => {
    const root = markup('<div role="textbox">rich</div>');
    expect(() => typeText(getByRole(root, 'textbox'), 'x')).toThrow(/needs a text field/);
    expect(() => clear(getByRole(root, 'textbox'))).toThrow(/needs a text field/);
  });
});

// ---------------------------------------------------------------------------
// Pointer arrival, focus
// ---------------------------------------------------------------------------

@Component({
  selector: 'v-tip',
  render: compileTemplate(`
    <div>
      <button :ref="trigger" :spread="tip.triggerProps()">Save</button>
      <div :if="tip.isPresent()" :ref="content" :spread="tip.contentProps()">Saves the file</div>
    </div>
  `),
})
class Tip {
  trigger = new Signal.State<Element | null>(null);
  content = new Signal.State<Element | null>(null);
  tip = createTooltip({
    trigger: () => this.trigger.get(),
    content: () => this.content.get(),
    openDelay: 0,
    closeDelay: 0,
  });
}

describe('hover', () => {
  it('sends the arrival sequence, with enter events not bubbling', () => {
    const root = markup('<div id="outer"><button>Save</button></div>');
    const button = root.querySelector('button')!;
    const types = [
      'pointerover',
      'pointerenter',
      'mouseover',
      'mouseenter',
      'pointermove',
      'mousemove',
    ];
    const onButton = record(button, types);
    const onOuter = record(root.querySelector('#outer')!, types);

    hover(button);

    expect(onButton).toEqual(types);
    // `enter` does not bubble, and the wrapper hears one all the same: the
    // pointer entered it on the way to the button, and each element entered
    // is sent its own. A hover card that listens on its wrapper depends on it.
    expect(onOuter).toEqual(types);
  });

  it('sends the departure sequence', () => {
    const root = markup('<div id="outer"><button>Save</button></div>');
    const button = root.querySelector('button')!;
    const types = ['pointerout', 'pointerleave', 'mouseout', 'mouseleave'];
    const onButton = record(button, types);
    const onOuter = record(root.querySelector('#outer')!, types);

    unhover(button);

    expect(onButton).toEqual(types);
    // The pointer has left the page, so everything it was inside was left.
    expect(onOuter).toEqual(types);
  });

  it('leaves where the pointer was, and enters only what it was not already in', () => {
    const root = markup(
      '<div id="menu"><div id="a"><span id="x">Cut</span></div><div id="b"><span id="y">Copy</span></div></div>',
    );
    const seen: string[] = [];
    const types = ['pointerout', 'pointerleave', 'pointerover', 'pointerenter', 'mouseleave', 'mouseenter'];
    for (const element of root.querySelectorAll('[id]')) {
      for (const type of types) {
        element.addEventListener(type, (event) => {
          const related = (event as MouseEvent).relatedTarget as Element | null;
          if (event.target === element) seen.push(`${type} ${element.id} (${related?.id ?? 'page'})`);
        });
      }
    }

    hover(root.querySelector('#x')!);
    seen.length = 0;
    hover(root.querySelector('#y')!);

    // One pointer, so arriving over "Copy" is leaving "Cut": innermost first on
    // the way out, outermost first on the way in, and nothing at all for the
    // menu, which the pointer never left. In brackets, the `relatedTarget`:
    // where the pointer went, for what it left, and where it came from, for
    // what it entered.
    expect(seen).toEqual([
      'pointerout x (y)',
      'pointerleave x (y)',
      'pointerleave a (y)',
      'pointerover y (x)',
      'pointerenter b (x)',
      'pointerenter y (x)',
      'mouseleave x (y)',
      'mouseleave a (y)',
      'mouseenter b (x)',
      'mouseenter y (x)',
    ]);

    seen.length = 0;
    unhover(root.querySelector('#y')!);
    expect(seen).toEqual([
      'pointerout y (page)',
      'pointerleave y (page)',
      'pointerleave b (page)',
      'pointerleave menu (page)',
      'mouseleave y (page)',
      'mouseleave b (page)',
      'mouseleave menu (page)',
    ]);
  });

  it('lets a tooltip see the pointer cross from its trigger onto it', () => {
    const view = render(Tip);
    const tip = view.instance.tip;

    hover(view.getByRole('button', { name: 'Save' }));
    expect(tip.isOpen()).toBe(true);

    // With no close delay to cover the gap, the tooltip survives the move only
    // because the trigger's `pointerleave` says where the pointer went.
    hover(view.getByRole('tooltip'));
    expect(tip.isOpen()).toBe(true);

    unhover(view.getByRole('tooltip'));
    expect(tip.isOpen()).toBe(false);
  });

  it('keeps the pointer inside what is left when the element under it is removed', () => {
    const root = markup('<div id="list"><span id="a">One</span><span id="b">Two</span></div>');
    const list = root.querySelector('#list')!;
    const seen: string[] = [];
    for (const type of ['pointerenter', 'pointerleave', 'mouseenter', 'mouseleave']) {
      list.addEventListener(type, (event) => {
        if (event.target === list) seen.push(type);
      });
    }

    hover(root.querySelector('#a')!);
    expect(seen).toEqual(['pointerenter', 'mouseenter']);

    // The row under the pointer goes, and the pointer moves on to the next
    // one. It never left the list, so the list hears nothing more.
    root.querySelector('#a')!.remove();
    hover(root.querySelector('#b')!);
    expect(seen).toEqual(['pointerenter', 'mouseenter']);
  });

  it('is separate from a press, because touch and keyboard produce no hover', () => {
    const root = markup('<button>Save</button>');
    const button = root.querySelector('button')!;
    const seen = record(button, ['pointerover', 'mouseover']);

    click(button);

    expect(seen).toEqual([]);
  });
});

describe('focus', () => {
  it('moves what the platform considers focused, not just the listeners', () => {
    const root = markup('<button id="a">A</button><button id="b">B</button>');
    const a = root.querySelector<HTMLElement>('#a')!;
    const seen = record(a, ['focus', 'blur']);

    focus(a);
    expect(document.activeElement).toBe(a);

    blur(a);
    expect(document.activeElement).not.toBe(a);
    expect(seen).toEqual(['focus', 'blur']);
  });
});
