/**
 * Checkbox, switch and radio group, driven through real mounted components.
 *
 * Rendering is the least interesting thing these do, so it is barely asserted.
 * What is asserted is what a screen reader is told, what the form actually
 * submits, and which key does what — including the keys that must be left
 * alone. The cases here that usually go wrong: the mixed state, a wrapping
 * `<label>` toggling twice because it forwards the press to the hidden input,
 * Enter stealing the form's submit, a disabled option that arrow keys land on
 * anyway, and a radio group with nothing selected that Tab cannot reach.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { compileTemplate } from '@voltdev/core/jit';
import { Component, Signal, flushSync, mount } from '@voltdev/core';
import {
  createCheckbox,
  createRadioGroup,
  createSwitch,
  type CheckedState,
} from '../src/form-controls.ts';

let host: HTMLElement;
let mounted: { unmount(): void }[] = [];

function track<T extends { unmount(): void }>(handle: T): T {
  mounted.push(handle);
  return handle;
}

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  host = document.querySelector('#app')!;
});

afterEach(() => {
  for (const handle of mounted) handle.unmount();
  mounted = [];
  flushSync();
});

/** A keydown as the user would send it: bubbling, and cancellable. */
function press(target: Element, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  flushSync();
  return event;
}

function click(target: HTMLElement): void {
  target.click();
  flushSync();
}

function submitted(form: HTMLFormElement): [string, FormDataEntryValue][] {
  return [...new FormData(form).entries()];
}

/**
 * Reset the form in the order a browser does, which this environment's own
 * `reset()` does not: the event first, then every microtask its listeners
 * queued — a press on a reset button runs them as each listener returns, with
 * nothing else on the stack to wait for — and only then the controls put back.
 */
async function reset(form: HTMLFormElement): Promise<void> {
  const event = new Event('reset', { bubbles: true, cancelable: true });
  if (!form.dispatchEvent(event)) return;
  await Promise.resolve();
  flushSync();

  // The environment's `reset()` puts the controls back and then dispatches an
  // event of its own, which is the one that has just been heard.
  const dispatch = form.dispatchEvent;
  form.dispatchEvent = () => true;
  try {
    form.reset();
  } finally {
    form.dispatchEvent = dispatch;
  }
  await Promise.resolve();
  flushSync();
}

// ---------------------------------------------------------------------------
// Checkbox
// ---------------------------------------------------------------------------

@Component({
  selector: 'v-terms',
  render: compileTemplate(`
    <form>
      <label :click="box.toggle()" :keydown="box.onKeyDown($event)">
        <input :ref="input" :spread="box.inputProps()">
        <span :spread="box.controlProps()">I accept the terms</span>
      </label>
    </form>
  `),
})
class Terms {
  input = new Signal.State<Element | null>(null);
  checked = new Signal.State<CheckedState>(false);
  disabled = new Signal.State(false);
  required = new Signal.State(false);
  changes: CheckedState[] = [];
  box = createCheckbox({
    input: () => this.input.get(),
    checked: this.checked,
    name: 'terms',
    value: 'yes',
    disabled: () => this.disabled.get(),
    required: () => this.required.get(),
    onCheckedChange: (state) => this.changes.push(state),
  });
}

function checkbox() {
  const handle = track(mount(Terms, host));
  flushSync();
  return {
    instance: handle.instance as Terms,
    control: () => host.querySelector('[role="checkbox"]') as HTMLElement,
    input: () => host.querySelector('input') as HTMLInputElement,
    label: () => host.querySelector('label') as HTMLElement,
    form: () => host.querySelector('form') as HTMLFormElement,
  };
}

describe('checkbox', () => {
  it('starts unchecked, and says so in both places', () => {
    const { control, input } = checkbox();
    expect(control().getAttribute('role')).toBe('checkbox');
    expect(control().getAttribute('aria-checked')).toBe('false');
    expect(control().getAttribute('data-state')).toBe('unchecked');
    expect(input().checked).toBe(false);
  });

  it('toggles on a press, and the hidden input follows', () => {
    const { label, control, input } = checkbox();
    click(label());

    expect(control().getAttribute('aria-checked')).toBe('true');
    expect(control().getAttribute('data-state')).toBe('checked');
    expect(input().checked).toBe(true);
  });

  it('toggles exactly once when the press lands on the label', () => {
    const { instance, label, input } = checkbox();
    // A label forwards presses to the control it labels — the hidden input —
    // so an unguarded control toggles twice for one press and appears dead.
    click(label());
    expect(instance.changes).toEqual([true]);
    expect(input().checked).toBe(true);
  });

  it('toggles exactly once when the press lands on the box inside the label', () => {
    const { instance, control } = checkbox();
    click(control());
    expect(instance.changes).toEqual([true]);
  });

  it('toggles on Space, and cancels the key', () => {
    const { control, input } = checkbox();
    const event = press(control(), ' ');

    expect(input().checked).toBe(true);
    // Uncancelled, Space scrolls the page — and on a <button> it raises a
    // second activation on the way up.
    expect(event.defaultPrevented).toBe(true);
  });

  it('leaves Enter to the form', () => {
    const { control, input } = checkbox();
    const event = press(control(), 'Enter');

    expect(input().checked).toBe(false);
    expect(event.defaultPrevented).toBe(false);
  });

  it('ignores Space held with a modifier', () => {
    const { control, input } = checkbox();
    const event = press(control(), ' ', { ctrlKey: true });

    expect(input().checked).toBe(false);
    expect(event.defaultPrevented).toBe(false);
  });

  describe('the mixed state', () => {
    it('is announced as mixed and set as a property on the input', () => {
      const { instance, control, input } = checkbox();
      instance.checked.set('indeterminate');
      flushSync();

      expect(control().getAttribute('aria-checked')).toBe('mixed');
      expect(control().getAttribute('data-state')).toBe('indeterminate');
      // There is no `indeterminate` attribute; only the property exists.
      expect(input().indeterminate).toBe(true);
      expect(input().hasAttribute('indeterminate')).toBe(false);
    });

    it('does not submit, because only checkedness decides that', () => {
      const { instance, input, form } = checkbox();
      instance.checked.set('indeterminate');
      flushSync();

      expect(input().checked).toBe(false);
      expect(submitted(form())).toEqual([]);
    });

    it('becomes checked when toggled, as a native checkbox does', () => {
      const { instance, label, input } = checkbox();
      instance.checked.set('indeterminate');
      flushSync();

      click(label());
      expect(instance.checked.get()).toBe(true);
      expect(input().indeterminate).toBe(false);
      expect(input().checked).toBe(true);
    });
  });

  describe('the form', () => {
    it('submits its name and value only while checked', () => {
      const { label, form } = checkbox();
      expect(submitted(form())).toEqual([]);

      click(label());
      expect(submitted(form())).toEqual([['terms', 'yes']]);

      click(label());
      expect(submitted(form())).toEqual([]);
    });

    it('submits nothing while disabled', () => {
      const { instance, label, input, form } = checkbox();
      click(label());
      instance.disabled.set(true);
      flushSync();

      expect(input().disabled).toBe(true);
      expect(submitted(form())).toEqual([]);
    });

    it('is missing its value while required and unchecked', () => {
      const { instance, control, label, input, form } = checkbox();
      instance.required.set(true);
      flushSync();

      expect(control().getAttribute('aria-required')).toBe('true');
      expect(input().required).toBe(true);
      expect(input().validity.valueMissing).toBe(true);
      expect(form().checkValidity()).toBe(false);

      click(label());
      expect(form().checkValidity()).toBe(true);
    });

    it('keeps the input reachable for the validation message', () => {
      const { input } = checkbox();
      // `display: none` would be simpler and would break this: the browser
      // refuses to submit an invalid control it cannot focus, and then has
      // nowhere to say why.
      expect(input().getAttribute('style')).not.toContain('display: none');
      expect(input().getAttribute('tabindex')).toBe('-1');
      expect(input().getAttribute('aria-hidden')).toBe('true');
    });

    it('goes back to how it started on a reset, the input with it', async () => {
      const { instance, label, control, input, form } = checkbox();
      click(label());
      expect(submitted(form())).toEqual([['terms', 'yes']]);

      await reset(form());

      // The box on screen and the input behind it agree, and agree with what
      // a reset means: the state the checkbox was created in.
      expect(control().getAttribute('aria-checked')).toBe('false');
      expect(input().checked).toBe(false);
      expect(submitted(form())).toEqual([]);
      expect(instance.changes).toEqual([true, false]);
    });

    it('stays as it is when the reset is called off', async () => {
      const { instance, label, control, form } = checkbox();
      click(label());
      form().addEventListener('reset', (event) => event.preventDefault(), true);

      await reset(form());

      // "Discard your changes?" answered no: nothing in the form went back, so
      // the box must not either.
      expect(control().getAttribute('aria-checked')).toBe('true');
      expect(submitted(form())).toEqual([['terms', 'yes']]);
      expect(instance.changes).toEqual([true]);
    });

    it('stays checked through a reset when it started checked, and still submits', async () => {
      @Component({
        selector: 'v-newsletter',
        render: compileTemplate(`
          <form>
            <label :click="box.toggle()">
              <input :ref="input" :spread="box.inputProps()">
              <span :spread="box.controlProps()">Send me the newsletter</span>
            </label>
          </form>
        `),
      })
      class Newsletter {
        input = new Signal.State<Element | null>(null);
        box = createCheckbox({ input: () => this.input.get(), name: 'news', defaultChecked: true });
      }

      track(mount(Newsletter, host));
      flushSync();
      const form = host.querySelector('form') as HTMLFormElement;

      // Nobody has touched it. A reset that unchecked the input would make a
      // form that submits nothing for a box that is plainly ticked.
      await reset(form);

      expect(host.querySelector('[role="checkbox"]')!.getAttribute('aria-checked')).toBe('true');
      expect(submitted(form)).toEqual([['news', 'on']]);
    });
  });

  describe('while disabled', () => {
    it('says so and refuses to change', () => {
      const { instance, control, label, input } = checkbox();
      instance.disabled.set(true);
      flushSync();

      expect(control().getAttribute('aria-disabled')).toBe('true');
      expect(control().hasAttribute('data-disabled')).toBe(true);

      click(label());
      press(control(), ' ');
      expect(input().checked).toBe(false);
      expect(instance.changes).toEqual([]);
    });

    it('stays in the tab order so it can still be found', () => {
      const { instance, control } = checkbox();
      instance.disabled.set(true);
      flushSync();
      expect(control().getAttribute('tabindex')).toBe('0');
    });

    it('can still be set by the application through the signal it owns', () => {
      const { instance, control } = checkbox();
      instance.disabled.set(true);
      instance.checked.set(true);
      flushSync();
      expect(control().getAttribute('aria-checked')).toBe('true');
    });
  });

  it('reports every change once, and no change twice', () => {
    const { instance, label } = checkbox();
    click(label());
    click(label());
    instance.box.setChecked(false);
    flushSync();

    expect(instance.changes).toEqual([true, false]);
  });

  it('owns its state when it is given no signal to follow', () => {
    @Component({
      selector: 'v-loose-checkbox',
      render: compileTemplate('<span :spread="box.controlProps()" :click="box.toggle()">Wrap</span>'),
    })
    class Loose {
      box = createCheckbox({ defaultChecked: true });
    }

    track(mount(Loose, host));
    flushSync();

    const control = host.querySelector('[role="checkbox"]') as HTMLElement;
    expect(control.getAttribute('aria-checked')).toBe('true');
    click(control);
    expect(control.getAttribute('aria-checked')).toBe('false');
  });

  it('takes its accessible name from an option when it has no text', () => {
    @Component({
      selector: 'v-bare-checkbox',
      render: compileTemplate('<span :spread="box.controlProps()"></span>'),
    })
    class Bare {
      box = createCheckbox({ label: 'Ich stimme zu', defaultChecked: true });
    }

    track(mount(Bare, host));
    flushSync();

    // Every string the library puts in the accessibility tree comes from the
    // consumer, so it can be translated.
    const control = host.querySelector('[role="checkbox"]')!;
    expect(control.getAttribute('aria-label')).toBe('Ich stimme zu');
    expect(control.getAttribute('aria-checked')).toBe('true');
  });
});

// ---------------------------------------------------------------------------
// Switch
// ---------------------------------------------------------------------------

@Component({
  selector: 'v-notify',
  render: compileTemplate(`
    <form>
      <label :click="toggle.toggle()" :keydown="toggle.onKeyDown($event)">
        <input :ref="input" :spread="toggle.inputProps()">
        <span :spread="toggle.controlProps()">Email me</span>
      </label>
    </form>
  `),
})
class Notify {
  input = new Signal.State<Element | null>(null);
  on = new Signal.State(false);
  disabled = new Signal.State(false);
  toggle = createSwitch({
    input: () => this.input.get(),
    checked: this.on,
    name: 'notify',
    value: 'email',
    disabled: () => this.disabled.get(),
  });
}

function switchControl() {
  const handle = track(mount(Notify, host));
  flushSync();
  return {
    instance: handle.instance as Notify,
    control: () => host.querySelector('[role="switch"]') as HTMLElement,
    input: () => host.querySelector('input') as HTMLInputElement,
    label: () => host.querySelector('label') as HTMLElement,
    form: () => host.querySelector('form') as HTMLFormElement,
  };
}

describe('switch', () => {
  it('is a switch, not a checkbox, and reports its setting', () => {
    const { control, label } = switchControl();
    expect(control().getAttribute('role')).toBe('switch');
    expect(control().getAttribute('aria-checked')).toBe('false');

    click(label());
    expect(control().getAttribute('aria-checked')).toBe('true');
    expect(control().getAttribute('data-state')).toBe('checked');
  });

  it('toggles on Space', () => {
    const { control, instance } = switchControl();
    const event = press(control(), ' ');
    expect(instance.on.get()).toBe(true);
    expect(event.defaultPrevented).toBe(true);
  });

  it('does not toggle on Enter, which is the platform behaviour', () => {
    const { control, instance } = switchControl();
    const event = press(control(), 'Enter');

    // A switch inside a form must leave Enter alone: that is how a form is
    // submitted from the keyboard.
    expect(instance.on.get()).toBe(false);
    expect(event.defaultPrevented).toBe(false);
  });

  it('submits through a hidden native input', () => {
    const { label, form, input } = switchControl();
    expect(submitted(form())).toEqual([]);

    click(label());
    expect(input().checked).toBe(true);
    expect(submitted(form())).toEqual([['notify', 'email']]);
  });

  it('toggles once for a press on the label', () => {
    const { label, instance } = switchControl();
    click(label());
    click(label());
    expect(instance.on.get()).toBe(false);
  });

  it('refuses to change while disabled', () => {
    const { instance, control, label } = switchControl();
    instance.disabled.set(true);
    flushSync();

    click(label());
    press(control(), ' ');
    expect(instance.on.get()).toBe(false);
    expect(control().getAttribute('aria-disabled')).toBe('true');
  });

  it('goes back to its starting setting on a reset, the input with it', async () => {
    const { instance, label, control, input, form } = switchControl();
    click(label());

    await reset(form());

    expect(instance.on.get()).toBe(false);
    expect(control().getAttribute('aria-checked')).toBe('false');
    expect(input().checked).toBe(false);
    expect(submitted(form())).toEqual([]);
  });

  it('stays on through a reset when it started on, and still submits', async () => {
    const { instance, form } = (() => {
      @Component({
        selector: 'v-always-on',
        render: compileTemplate(`
          <form>
            <label :click="toggle.toggle()">
              <input :ref="input" :spread="toggle.inputProps()">
              <span :spread="toggle.controlProps()">Email me</span>
            </label>
          </form>
        `),
      })
      class AlwaysOn {
        input = new Signal.State<Element | null>(null);
        toggle = createSwitch({ input: () => this.input.get(), name: 'notify', defaultChecked: true });
      }
      const handle = track(mount(AlwaysOn, host));
      flushSync();
      return { instance: handle.instance as AlwaysOn, form: host.querySelector('form') as HTMLFormElement };
    })();

    await reset(form);

    expect(instance.toggle.checked()).toBe(true);
    expect(submitted(form)).toEqual([['notify', 'on']]);
  });
});

// ---------------------------------------------------------------------------
// Radio group
// ---------------------------------------------------------------------------

@Component({
  selector: 'v-plan',
  render: compileTemplate(`
    <form>
      <div :ref="group" :spread="plans.groupProps()" :keydown="plans.onKeyDown($event)">
        <label :for="option in options" :key="option.value" :click="plans.select(option.value)">
          <input :spread="plans.inputProps(option.value, option.disabled)">
          <span :spread="plans.itemProps(option.value, option.disabled)">{ option.label }</span>
        </label>
      </div>
    </form>
  `),
})
class Plan {
  group = new Signal.State<Element | null>(null);
  value = new Signal.State<string | null>(null);
  disabled = new Signal.State(false);
  required = new Signal.State(false);
  changes: (string | null)[] = [];
  options = [
    { value: 'free', label: 'Free', disabled: false },
    { value: 'team', label: 'Team', disabled: true },
    { value: 'pro', label: 'Pro', disabled: false },
  ];
  plans = createRadioGroup({
    group: () => this.group.get(),
    value: this.value,
    name: 'plan',
    label: 'Billing plan',
    disabled: () => this.disabled.get(),
    required: () => this.required.get(),
    onValueChange: (value) => this.changes.push(value),
  });
}

function radioGroup() {
  const handle = track(mount(Plan, host));
  flushSync();

  const items = () => [...host.querySelectorAll<HTMLElement>('[role="radio"]')];
  const item = (value: string) =>
    items().find((el) => el.getAttribute('data-value') === value) as HTMLElement;

  return {
    instance: handle.instance as Plan,
    group: () => host.querySelector('[role="radiogroup"]') as HTMLElement,
    items,
    item,
    label: (value: string) => item(value).closest('label') as HTMLElement,
    inputs: () => [...host.querySelectorAll<HTMLInputElement>('input')],
    form: () => host.querySelector('form') as HTMLFormElement,
    tabStops: () => items().map((el) => el.getAttribute('tabindex')),
    checked: () => items().map((el) => el.getAttribute('aria-checked')),
  };
}

describe('radio group', () => {
  it('is one named group of radios', () => {
    const { group, items } = radioGroup();
    expect(group().getAttribute('role')).toBe('radiogroup');
    // A radiogroup takes no name from its contents, so it must be given one.
    expect(group().getAttribute('aria-label')).toBe('Billing plan');
    expect(items()).toHaveLength(3);
    expect(items().map((el) => el.getAttribute('role'))).toEqual(['radio', 'radio', 'radio']);
  });

  it('puts the first radio in the tab order when nothing is selected', () => {
    const { tabStops } = radioGroup();
    // Otherwise Tab has nothing to land on and the group cannot be reached.
    expect(tabStops()).toEqual(['0', '-1', '-1']);
  });

  it('moves the single tab stop to the selected radio', () => {
    const { label, tabStops, checked } = radioGroup();
    click(label('pro'));

    // Exactly one tab stop, so Tab steps over the group in one press.
    expect(tabStops()).toEqual(['-1', '-1', '0']);
    expect(checked()).toEqual(['false', 'false', 'true']);
  });

  it('gives the tab stop back to the first radio when the selection is cleared', () => {
    const { instance, label, tabStops } = radioGroup();
    click(label('pro'));
    instance.value.set(null);
    flushSync();

    expect(tabStops()).toEqual(['0', '-1', '-1']);
  });

  it('never puts a disabled radio in the tab order', () => {
    const { item } = radioGroup();
    expect(item('team').getAttribute('tabindex')).toBe('-1');
    expect(item('team').getAttribute('aria-disabled')).toBe('true');
  });

  describe('arrow keys', () => {
    it('move focus and select in the same press', () => {
      const { item, checked } = radioGroup();
      item('free').focus();
      const event = press(item('free'), 'ArrowDown');

      // Down skips the disabled option entirely, and choosing is not a second
      // keystroke — this is what native radios do.
      expect(document.activeElement).toBe(item('pro'));
      expect(checked()).toEqual(['false', 'false', 'true']);
      expect(event.defaultPrevented).toBe(true);
    });

    it('wrap at both ends', () => {
      const { instance, item } = radioGroup();
      item('free').focus();
      press(item('free'), 'ArrowDown');
      press(item('pro'), 'ArrowDown');
      expect(instance.value.get()).toBe('free');

      press(item('free'), 'ArrowUp');
      expect(instance.value.get()).toBe('pro');
    });

    it('answer to both axes, whatever the group looks like', () => {
      const { instance, item } = radioGroup();
      item('free').focus();
      press(item('free'), 'ArrowRight');
      expect(instance.value.get()).toBe('pro');

      press(item('pro'), 'ArrowLeft');
      expect(instance.value.get()).toBe('free');
    });

    it('swap left and right under dir="rtl"', () => {
      const { instance, group, item } = radioGroup();
      group().setAttribute('dir', 'rtl');

      // In right-to-left, "next" is to the left.
      press(item('free'), 'ArrowLeft');
      expect(instance.value.get()).toBe('pro');
      press(item('pro'), 'ArrowRight');
      expect(instance.value.get()).toBe('free');
    });

    it('go to the ends with Home and End', () => {
      const { instance, item } = radioGroup();
      press(item('free'), 'End');
      expect(instance.value.get()).toBe('pro');

      press(item('pro'), 'Home');
      expect(instance.value.get()).toBe('free');
    });

    it('move on from the focused radio, not from the selected one', () => {
      const { instance, item } = radioGroup();
      // Nothing is selected and Tab has landed on the first radio: Down has
      // to go on to the next one rather than choose the one already focused.
      item('free').focus();
      press(item('free'), 'ArrowDown');
      expect(instance.value.get()).toBe('pro');
    });

    it('enter at the appropriate end when the press comes from no radio', () => {
      const { instance, group } = radioGroup();
      press(group(), 'ArrowUp');
      expect(instance.value.get()).toBe('pro');

      instance.value.set(null);
      flushSync();
      press(group(), 'ArrowDown');
      expect(instance.value.get()).toBe('free');
    });
  });

  describe('other keys', () => {
    it('select the focused radio on Space, which is how a group is first answered', () => {
      const { instance, item } = radioGroup();
      // Tab lands on the first radio while nothing is selected; there, and
      // only there, focus is on a radio that is not the selected one.
      item('free').focus();
      const event = press(item('free'), ' ');

      expect(instance.value.get()).toBe('free');
      expect(event.defaultPrevented).toBe(true);
    });

    it('leave Enter to the form', () => {
      const { instance, item } = radioGroup();
      const event = press(item('free'), 'Enter');

      expect(instance.value.get()).toBeNull();
      expect(event.defaultPrevented).toBe(false);
    });

    it('do not typeahead, because moving here is choosing', () => {
      const { instance, item } = radioGroup();
      const event = press(item('free'), 'p');

      // Typing "p" for Pro would silently change the answer.
      expect(instance.value.get()).toBeNull();
      expect(event.defaultPrevented).toBe(false);
    });
  });

  describe('disabled options', () => {
    it('cannot be selected by a press', () => {
      const { instance, label, checked } = radioGroup();
      click(label('team'));

      expect(instance.value.get()).toBeNull();
      expect(checked()).toEqual(['false', 'false', 'false']);
    });

    it('are stepped over rather than landed on and refused', () => {
      const { instance, item } = radioGroup();
      press(item('free'), 'ArrowDown');
      press(item('pro'), 'ArrowDown');
      press(item('free'), 'ArrowDown');

      // Team sits between the other two and is never selected on the way past.
      expect(instance.changes).toEqual(['pro', 'free', 'pro']);
      expect(item('team').getAttribute('aria-checked')).toBe('false');
    });
  });

  describe('a disabled group', () => {
    it('says so on the group and on every radio', () => {
      const { instance, group, items } = radioGroup();
      instance.disabled.set(true);
      flushSync();

      expect(group().getAttribute('aria-disabled')).toBe('true');
      expect(items().every((el) => el.getAttribute('aria-disabled') === 'true')).toBe(true);
      expect(items().every((el) => el.getAttribute('tabindex') === '-1')).toBe(true);
    });

    it('answers to nothing', () => {
      const { instance, item, label } = radioGroup();
      instance.disabled.set(true);
      flushSync();

      click(label('pro'));
      press(item('free'), 'ArrowDown');
      press(item('free'), ' ');
      expect(instance.value.get()).toBeNull();
    });
  });

  describe('the form', () => {
    it('submits one value under the shared name', () => {
      const { label, form } = radioGroup();
      expect(submitted(form())).toEqual([]);

      click(label('pro'));
      expect(submitted(form())).toEqual([['plan', 'pro']]);

      click(label('free'));
      expect(submitted(form())).toEqual([['plan', 'free']]);
    });

    it('keeps exactly one hidden input checked', () => {
      const { label, inputs } = radioGroup();
      click(label('pro'));
      click(label('free'));

      expect(inputs().map((el) => el.checked)).toEqual([true, false, false]);
      expect(inputs().every((el) => el.name === 'plan')).toBe(true);
    });

    it('is missing its value while required and unanswered', () => {
      const { instance, group, label, inputs, form } = radioGroup();
      instance.required.set(true);
      flushSync();

      expect(group().getAttribute('aria-required')).toBe('true');
      // The constraint belongs to the group, so every radio carries it and
      // any one of them satisfies it.
      expect(inputs().every((el) => el.required)).toBe(true);
      expect(form().checkValidity()).toBe(false);

      click(label('free'));
      expect(form().checkValidity()).toBe(true);
    });

    it('selects once for a press on a label, not twice', () => {
      const { instance, label, inputs } = radioGroup();
      // The label forwards the press to the hidden radio it labels. Left
      // alone, that press would check the mirror directly and the group's own
      // state would no longer be the only thing deciding what is submitted.
      click(label('pro'));

      expect(instance.changes).toEqual(['pro']);
      expect(inputs().map((el) => el.checked)).toEqual([false, false, true]);
    });

    it('goes back to having nothing chosen on a reset, the inputs with it', async () => {
      const { instance, label, checked, inputs, form } = radioGroup();
      click(label('pro'));

      await reset(form());

      expect(instance.value.get()).toBeNull();
      expect(checked()).toEqual(['false', 'false', 'false']);
      expect(inputs().map((el) => el.checked)).toEqual([false, false, false]);
      expect(submitted(form())).toEqual([]);
      expect(instance.changes).toEqual(['pro', null]);
    });

    it('keeps the answer it started with through a reset, and still submits it', async () => {
      @Component({
        selector: 'v-preset-plan',
        render: compileTemplate(`
          <form>
            <div :ref="group" :spread="plans.groupProps()">
              <label :for="value in values" :key="value" :click="plans.select(value)">
                <input :spread="plans.inputProps(value)">
                <span :spread="plans.itemProps(value)">{ value }</span>
              </label>
            </div>
          </form>
        `),
      })
      class PresetPlan {
        group = new Signal.State<Element | null>(null);
        values = ['free', 'pro'];
        plans = createRadioGroup({
          group: () => this.group.get(),
          name: 'plan',
          label: 'Plan',
          defaultValue: 'pro',
        });
      }

      const handle = track(mount(PresetPlan, host));
      flushSync();
      const form = host.querySelector('form') as HTMLFormElement;

      // Untouched first: nothing changes the state, so nothing would put the
      // mirror back if the reset were allowed to uncheck it.
      await reset(form);
      expect(submitted(form)).toEqual([['plan', 'pro']]);

      click(host.querySelector('label') as HTMLElement);
      expect(submitted(form)).toEqual([['plan', 'free']]);

      await reset(form);

      expect((handle.instance as PresetPlan).plans.value()).toBe('pro');
      expect(submitted(form)).toEqual([['plan', 'pro']]);
    });
  });

  it('owns its selection when it is given no signal to follow', () => {
    @Component({
      selector: 'v-loose-group',
      render: compileTemplate(`
        <div :ref="group" :spread="letters.groupProps()" :keydown="letters.onKeyDown($event)">
          <span :spread="letters.itemProps('a')" :click="letters.select('a')">A</span>
          <span :spread="letters.itemProps('b')" :click="letters.select('b')">B</span>
        </div>
      `),
    })
    class Loose {
      group = new Signal.State<Element | null>(null);
      letters = createRadioGroup({
        group: () => this.group.get(),
        defaultValue: 'b',
        label: 'Letters',
      });
    }

    const handle = track(mount(Loose, host));
    flushSync();
    const items = [...host.querySelectorAll<HTMLElement>('[role="radio"]')];

    expect(items.map((el) => el.getAttribute('data-state'))).toEqual(['unchecked', 'checked']);
    expect(items.map((el) => el.getAttribute('tabindex'))).toEqual(['-1', '0']);

    click(items[0]!);
    expect((handle.instance as Loose).letters.value()).toBe('a');
    expect(items.map((el) => el.getAttribute('data-state'))).toEqual(['checked', 'unchecked']);
  });

  it('reports the orientation it was told, and nothing when it was told none', () => {
    const { group } = radioGroup();
    expect(group().hasAttribute('aria-orientation')).toBe(false);

    @Component({
      selector: 'v-row',
      render: compileTemplate(
        '<div :ref="group" :spread="plans.groupProps()"><span :spread="plans.itemProps(\'a\')"></span></div>',
      ),
    })
    class Row {
      group = new Signal.State<Element | null>(null);
      plans = createRadioGroup({
        group: () => this.group.get(),
        orientation: 'horizontal',
        label: 'Row',
      });
    }

    track(mount(Row, host));
    flushSync();
    const rows = host.querySelectorAll('[role="radiogroup"]');
    expect(rows[rows.length - 1]!.getAttribute('aria-orientation')).toBe('horizontal');
  });
});
