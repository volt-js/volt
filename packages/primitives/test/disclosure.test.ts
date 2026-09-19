/**
 * Disclosure — the collapsible and the accordion, driven through real
 * components.
 *
 * What is worth asserting is what a user actually meets: what a header tells a
 * screen reader, which key moves focus where, and that a panel closing with an
 * animation is still there to animate. happy-dom has no layout, so the
 * measured height is taken through a stubbed `scrollHeight` — the number is
 * arbitrary, but where it ends up is not.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compileTemplate } from '@voltdev/core/jit';
import { Component, Signal, createRoot, effect, flushSync, mount } from '@voltdev/core';
import {
  ACCORDION_TRIGGER_ATTRIBUTE,
  COLLAPSIBLE_HEIGHT_PROPERTY,
  createAccordion,
  createCollapsible,
  type AccordionOptions,
  type CollapsibleOptions,
} from '../src/disclosure.ts';

let host: HTMLElement;
let mounted: { unmount(): void }[] = [];
let restores: (() => void)[] = [];

function track<T extends { unmount(): void }>(handle: T): T {
  mounted.push(handle);
  return handle;
}

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  host = document.querySelector('#app')!;
});

afterEach(() => {
  // Newest first: a stub laid over a stub has to come off in the order it
  // went on, or the first one is put back over the second.
  for (let i = restores.length - 1; i >= 0; i--) restores[i]!();
  restores = [];
  for (const handle of mounted) handle.unmount();
  mounted = [];
  flushSync();
});

/** happy-dom lays nothing out, so every element reports a height of zero. */
function stubScrollHeight(px: number): void {
  const proto = Element.prototype;
  const original = Object.getOwnPropertyDescriptor(proto, 'scrollHeight');

  Object.defineProperty(proto, 'scrollHeight', { configurable: true, get: () => px });
  restores.push(() => {
    if (original) Object.defineProperty(proto, 'scrollHeight', original);
    else Reflect.deleteProperty(proto, 'scrollHeight');
  });
}

/**
 * Report an exit animation on one element, the way a browser would: running
 * once the element is marked closed, and not before. happy-dom has no
 * animation engine to ask, so presence is handed what one would answer.
 */
function pretendAnimating(el: Element): { finish(): Promise<void> } {
  let settle!: () => void;
  const finished = new Promise<void>((resolve) => {
    settle = resolve;
  });
  const animation = {
    playState: 'running',
    finished,
    effect: { getComputedTiming: () => ({ endTime: 150 }) },
  };

  Object.defineProperty(el, 'getAnimations', {
    configurable: true,
    value: () => (el.getAttribute('data-state') === 'closed' ? [animation] : []),
  });

  return {
    async finish() {
      settle();
      // Presence hears of it in a promise callback; let every queued one run.
      for (let i = 0; i < 10; i++) await Promise.resolve();
      flushSync();
    },
  };
}

function press(el: Element, key: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  el.dispatchEvent(event);
  flushSync();
  return event;
}

// ---------------------------------------------------------------------------
// Collapsible
// ---------------------------------------------------------------------------

const COLLAPSIBLE_TEMPLATE = `
  <div>
    <button :spread="c.triggerProps()" :click="c.toggle()">details</button>
    <div :if="c.isPresent()" class="panel" :ref="content" :spread="c.contentProps()">
      <p>body</p>
    </div>
  </div>
`;

function mountCollapsible(options: Omit<CollapsibleOptions, 'content'> = {}) {
  @Component({ selector: 'v-details', render: compileTemplate(COLLAPSIBLE_TEMPLATE) })
  class Details {
    content = new Signal.State<Element | null>(null);
    c = createCollapsible({ ...options, content: () => this.content.get() });
  }

  const handle = track(mount(Details, host));
  flushSync();

  return {
    collapsible: (handle.instance as Details).c,
    trigger: () => host.querySelector('button')!,
    panel: () => host.querySelector('.panel'),
  };
}

describe('collapsible', () => {
  it('starts closed, with nothing rendered and nothing to control', () => {
    const { trigger, panel } = mountCollapsible();

    expect(panel()).toBeNull();
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    // Pointing at an id that is not in the document is a dangling reference,
    // which reads as a control that leads nowhere.
    expect(trigger().hasAttribute('aria-controls')).toBe(false);
  });

  it('opens from the trigger and links the two together', () => {
    const { trigger, panel } = mountCollapsible();

    trigger().click();
    flushSync();

    expect(panel()).not.toBeNull();
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(trigger().getAttribute('aria-controls')).toBe(panel()!.id);
    expect(trigger().getAttribute('data-state')).toBe('open');
    expect(panel()!.getAttribute('data-state')).toBe('open');
  });

  it('drops the control reference again when the panel goes', () => {
    const { trigger, panel } = mountCollapsible();

    trigger().click();
    flushSync();
    trigger().click();
    flushSync();

    expect(panel()).toBeNull();
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(trigger().hasAttribute('aria-controls')).toBe(false);
  });

  it('renders open when it starts open', () => {
    const { trigger, panel } = mountCollapsible({ defaultOpen: true });

    expect(panel()).not.toBeNull();
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
  });

  it('follows a signal supplied from outside, in both directions', () => {
    const open = new Signal.State(false);
    const { trigger, panel } = mountCollapsible({ open });

    open.set(true);
    flushSync();
    expect(panel()).not.toBeNull();

    trigger().click();
    flushSync();
    // The trigger writes to the caller's signal rather than to a private copy.
    expect(open.get()).toBe(false);
    expect(panel()).toBeNull();
  });

  it('reports changes once, not on every set', () => {
    const onOpenChange = vi.fn();
    const { collapsible } = mountCollapsible({ onOpenChange });

    collapsible.open();
    collapsible.open();
    flushSync();
    expect(onOpenChange).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(true);

    collapsible.close();
    flushSync();
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it('labels the panel with its trigger', () => {
    const { trigger, panel } = mountCollapsible({ defaultOpen: true });

    expect(panel()!.getAttribute('aria-labelledby')).toBe(trigger().id);
    expect(panel()!.hasAttribute('aria-label')).toBe(false);
    // A lone disclosure is not a landmark unless the caller says so.
    expect(panel()!.hasAttribute('role')).toBe(false);
  });

  it('takes an overriding label, and drops the reference when it has one', () => {
    const { panel } = mountCollapsible({
      defaultOpen: true,
      region: true,
      labels: { content: 'Shipping options' },
    });

    expect(panel()!.getAttribute('role')).toBe('region');
    expect(panel()!.getAttribute('aria-label')).toBe('Shipping options');
    // Two labels would leave which one wins to the screen reader.
    expect(panel()!.hasAttribute('aria-labelledby')).toBe(false);
  });

  describe('when disabled', () => {
    it('says so, and refuses to toggle', () => {
      const { trigger, panel } = mountCollapsible({ disabled: () => true });

      expect(trigger().getAttribute('aria-disabled')).toBe('true');
      // Not the `disabled` attribute: a disabled header that cannot be focused
      // cannot be found by a keyboard user either.
      expect(trigger().hasAttribute('disabled')).toBe(false);
      expect(trigger().hasAttribute('data-disabled')).toBe(true);

      trigger().click();
      flushSync();
      expect(panel()).toBeNull();
    });

    it('still moves when the controlling signal is written directly', () => {
      const open = new Signal.State(false);
      const { panel } = mountCollapsible({ open, disabled: () => true });

      // The escape hatch: disabled blocks the trigger, not the caller.
      open.set(true);
      flushSync();
      expect(panel()).not.toBeNull();
    });
  });

  describe('height', () => {
    it('publishes the measured height as a custom property', () => {
      stubScrollHeight(120);
      const { trigger, panel } = mountCollapsible();

      trigger().click();
      flushSync();

      expect(panel()!.style.getPropertyValue(COLLAPSIBLE_HEIGHT_PROPERTY)).toBe('120px');
    });

    it('measures again each time the panel comes back', () => {
      stubScrollHeight(120);
      const { trigger, panel } = mountCollapsible();

      trigger().click();
      flushSync();
      expect(panel()!.style.getPropertyValue(COLLAPSIBLE_HEIGHT_PROPERTY)).toBe('120px');

      trigger().click();
      flushSync();

      // Content that changed while the panel was closed must not animate to
      // the height it had last time.
      stubScrollHeight(240);
      trigger().click();
      flushSync();
      expect(panel()!.style.getPropertyValue(COLLAPSIBLE_HEIGHT_PROPERTY)).toBe('240px');
    });

    it('keeps the last measurement through the exit, so it can animate to nothing', async () => {
      stubScrollHeight(120);
      const { trigger, panel } = mountCollapsible();

      trigger().click();
      flushSync();
      const exit = pretendAnimating(panel()!);

      trigger().click();
      flushSync();

      // Still mounted, marked closed, and still carrying the height the
      // collapse animation has to start from.
      expect(panel()).not.toBeNull();
      expect(panel()!.getAttribute('data-state')).toBe('closed');
      expect(panel()!.style.getPropertyValue(COLLAPSIBLE_HEIGHT_PROPERTY)).toBe('120px');

      await exit.finish();
      expect(panel()).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// Accordion
// ---------------------------------------------------------------------------

const ACCORDION_TEMPLATE = `
  <div :ref="root" :spread="a.rootProps()" :keydown="a.onTriggerKeyDown($event)">
    <div :for="item in items.get()" :key="item"
         class="item" :attr-data-item="item" :spread="a.itemProps(item)">
      <h3>
        <button :spread="a.triggerProps(item)" :click="a.toggle(item)">{ item }</button>
      </h3>
      <div :if="a.isPresent(item)" class="panel" :spread="a.contentProps(item)">
        <input :attr-data-field="item">
      </div>
    </div>
  </div>
`;

function mountAccordion(options: Omit<AccordionOptions, 'container'> = {}) {
  @Component({ selector: 'v-sections', render: compileTemplate(ACCORDION_TEMPLATE) })
  class Sections {
    root = new Signal.State<Element | null>(null);
    items = new Signal.State(['one', 'two', 'three']);
    a = createAccordion({ ...options, container: () => this.root.get() });
  }

  const handle = track(mount(Sections, host));
  const instance = handle.instance as Sections;
  flushSync();

  const item = (value: string) => host.querySelector(`[data-item="${value}"]`)!;

  return {
    accordion: instance.a,
    items: instance.items,
    item,
    trigger: (value: string) =>
      host.querySelector<HTMLElement>(`[${ACCORDION_TRIGGER_ATTRIBUTE}="${value}"]`)!,
    panel: (value: string) => item(value).querySelector('.panel'),
    field: (value: string) => host.querySelector<HTMLElement>(`[data-field="${value}"]`),
    triggers: () => [...host.querySelectorAll<HTMLElement>(`[${ACCORDION_TRIGGER_ATTRIBUTE}]`)],
  };
}

describe('accordion state', () => {
  it('opens one panel at a time by default', () => {
    const { trigger, panel } = mountAccordion();

    trigger('one').click();
    flushSync();
    expect(panel('one')).not.toBeNull();

    trigger('two').click();
    flushSync();
    expect(panel('one')).toBeNull();
    expect(panel('two')).not.toBeNull();
  });

  it('will not close the last open panel unless allowed to', () => {
    const { trigger, panel } = mountAccordion();

    trigger('one').click();
    flushSync();
    trigger('one').click();
    flushSync();

    // A single accordion keeps one panel open: the header is a switch between
    // panels, not a switch for the panel it sits on.
    expect(panel('one')).not.toBeNull();
    expect(trigger('one').getAttribute('aria-expanded')).toBe('true');
  });

  it('closes the last open panel when it is collapsible', () => {
    const { trigger, panel } = mountAccordion({ collapsible: true });

    trigger('one').click();
    flushSync();
    trigger('one').click();
    flushSync();

    expect(panel('one')).toBeNull();
    expect(trigger('one').getAttribute('aria-expanded')).toBe('false');
  });

  it('keeps several open when told to, and closes them one at a time', () => {
    const { accordion, trigger, panel } = mountAccordion({ type: 'multiple' });

    trigger('three').click();
    trigger('one').click();
    flushSync();

    expect(panel('one')).not.toBeNull();
    expect(panel('three')).not.toBeNull();
    expect(accordion.value()).toEqual(['three', 'one']);

    trigger('three').click();
    flushSync();
    expect(panel('one')).not.toBeNull();
    expect(panel('three')).toBeNull();
  });

  it('follows a signal supplied from outside', () => {
    const value = new Signal.State<string[]>([]);
    const onValueChange = vi.fn();
    const { trigger, panel } = mountAccordion({ value, onValueChange });

    value.set(['two']);
    flushSync();
    expect(panel('two')).not.toBeNull();
    // Changing the signal is not a change the accordion made.
    expect(onValueChange).not.toHaveBeenCalled();

    trigger('three').click();
    flushSync();
    expect(value.get()).toEqual(['three']);
    expect(onValueChange).toHaveBeenCalledWith(['three']);
  });

  it('keeps an open panel open across a change to the list', () => {
    const { items, trigger, panel } = mountAccordion();

    trigger('two').click();
    flushSync();

    items.set(['one', 'two', 'three', 'four']);
    flushSync();

    // The panels outlive the effects that render them; re-rendering the list
    // must not reset the one that is open.
    expect(panel('two')).not.toBeNull();
    expect(trigger('two').getAttribute('aria-expanded')).toBe('true');
    expect(trigger('four').getAttribute('aria-expanded')).toBe('false');
  });

  it('survives repeated opening and closing', () => {
    const { trigger, panel } = mountAccordion({ collapsible: true });

    for (let i = 0; i < 3; i++) {
      trigger('one').click();
      flushSync();
      expect(panel('one')).not.toBeNull();

      trigger('one').click();
      flushSync();
      expect(panel('one')).toBeNull();
    }
  });

  it('animates a panel out before removing it', async () => {
    const { trigger, panel } = mountAccordion();

    trigger('one').click();
    flushSync();
    const exit = pretendAnimating(panel('one')!);

    trigger('two').click();
    flushSync();

    // The panel being replaced is still there, marked closed.
    expect(panel('one')).not.toBeNull();
    expect(panel('one')!.getAttribute('data-state')).toBe('closed');
    expect(panel('two')).not.toBeNull();

    await exit.finish();
    expect(panel('one')).toBeNull();
  });
});

describe('what the accordion tells assistive technology', () => {
  it('wires each header to its own panel', () => {
    const { trigger, panel } = mountAccordion({ type: 'multiple' });

    trigger('one').click();
    trigger('two').click();
    flushSync();

    expect(trigger('one').getAttribute('aria-controls')).toBe(panel('one')!.id);
    expect(trigger('two').getAttribute('aria-controls')).toBe(panel('two')!.id);
    // Two panels on the same page must not share an id.
    expect(panel('one')!.id).not.toBe(panel('two')!.id);
    expect(trigger('one').id).not.toBe(trigger('two').id);
  });

  it('names each panel as a region, after the header that opens it', () => {
    const { trigger, panel } = mountAccordion();

    trigger('one').click();
    flushSync();

    expect(panel('one')!.getAttribute('role')).toBe('region');
    expect(panel('one')!.getAttribute('aria-labelledby')).toBe(trigger('one').id);
  });

  it('drops the landmark when asked, for an accordion long enough to crowd one out', () => {
    const { trigger, panel } = mountAccordion({ region: false });

    trigger('one').click();
    flushSync();

    expect(panel('one')!.hasAttribute('role')).toBe(false);
    // The panel is still named, landmark or not.
    expect(panel('one')!.getAttribute('aria-labelledby')).toBe(trigger('one').id);
  });

  it('reports a header whose panel cannot be collapsed', () => {
    const { trigger } = mountAccordion();

    trigger('one').click();
    flushSync();

    // Pressing it does nothing, and a control that says nothing about that is
    // a control that lies.
    expect(trigger('one').getAttribute('aria-disabled')).toBe('true');
    // It is not disabled in the CSS sense: it is the panel being read.
    expect(trigger('one').hasAttribute('data-disabled')).toBe(false);
    expect(trigger('two').hasAttribute('aria-disabled')).toBe(false);
  });

  it('says nothing of the sort when the panel can be collapsed', () => {
    const { trigger } = mountAccordion({ collapsible: true });

    trigger('one').click();
    flushSync();
    expect(trigger('one').hasAttribute('aria-disabled')).toBe(false);
  });

  it('keeps every header in the page tab sequence', () => {
    const { triggers } = mountAccordion();

    // An accordion is part of the document's reading order, not a single
    // composite widget: a roving tab stop would hide two of these three
    // headers from Tab entirely.
    for (const trigger of triggers()) expect(trigger.hasAttribute('tabindex')).toBe(false);
  });

  it('marks the item and the header with the state CSS needs', () => {
    const { trigger, item } = mountAccordion({ orientation: 'vertical' });

    expect(item('one').getAttribute('data-state')).toBe('closed');
    expect(item('one').getAttribute('data-orientation')).toBe('vertical');

    trigger('one').click();
    flushSync();
    expect(item('one').getAttribute('data-state')).toBe('open');
  });
});

describe('accordion keyboard', () => {
  it('moves between headers with the arrow keys', () => {
    const { trigger } = mountAccordion();

    trigger('one').focus();
    const event = press(trigger('one'), 'ArrowDown');

    expect(document.activeElement).toBe(trigger('two'));
    // Otherwise the page scrolls out from under the header that just moved.
    expect(event.defaultPrevented).toBe(true);
  });

  it('wraps at both ends', () => {
    const { trigger } = mountAccordion();

    trigger('three').focus();
    press(trigger('three'), 'ArrowDown');
    expect(document.activeElement).toBe(trigger('one'));

    press(trigger('one'), 'ArrowUp');
    expect(document.activeElement).toBe(trigger('three'));
  });

  it('stops at the ends when it does not loop', () => {
    const { trigger } = mountAccordion({ loop: false });

    trigger('three').focus();
    press(trigger('three'), 'ArrowDown');
    expect(document.activeElement).toBe(trigger('three'));
  });

  it('jumps to the first and last header with Home and End', () => {
    const { trigger } = mountAccordion();

    trigger('two').focus();
    press(trigger('two'), 'End');
    expect(document.activeElement).toBe(trigger('three'));

    press(trigger('three'), 'Home');
    expect(document.activeElement).toBe(trigger('one'));
  });

  it('starts from the header the key came from, not the last one moved to', () => {
    const { trigger } = mountAccordion();

    trigger('one').focus();
    press(trigger('one'), 'ArrowDown');

    // Tab, not an arrow key, put focus here — so nothing internal recorded it.
    trigger('three').focus();
    press(trigger('three'), 'ArrowUp');
    expect(document.activeElement).toBe(trigger('two'));
  });

  it('leaves the axis it does not own alone', () => {
    const { trigger } = mountAccordion();

    trigger('one').focus();
    const event = press(trigger('one'), 'ArrowRight');

    expect(document.activeElement).toBe(trigger('one'));
    // Unhandled keys keep their default, so a page-level shortcut still works.
    expect(event.defaultPrevented).toBe(false);
  });

  it('moves with the horizontal arrows when laid out horizontally', () => {
    const { trigger } = mountAccordion({ orientation: 'horizontal' });

    trigger('one').focus();
    press(trigger('one'), 'ArrowRight');
    expect(document.activeElement).toBe(trigger('two'));

    press(trigger('two'), 'ArrowDown');
    expect(document.activeElement).toBe(trigger('two'));
  });

  it('leaves Enter and Space to the button', () => {
    const { trigger, panel } = mountAccordion();

    trigger('one').focus();
    const enter = press(trigger('one'), 'Enter');
    const space = press(trigger('one'), ' ');

    // The browser turns both into a click on a button. Handling them here as
    // well would toggle the panel twice and land back where it started.
    expect(enter.defaultPrevented).toBe(false);
    expect(space.defaultPrevented).toBe(false);
    expect(panel('one')).toBeNull();
  });

  it('ignores keys pressed inside a panel', () => {
    const { trigger, field } = mountAccordion();

    trigger('one').click();
    flushSync();

    const input = field('one')!;
    input.focus();
    const event = press(input, 'ArrowDown');

    // An arrow key in a field inside a panel belongs to the field.
    expect(document.activeElement).toBe(input);
    expect(event.defaultPrevented).toBe(false);
  });
});

describe('an accordion inside another one’s panel', () => {
  function mountNested() {
    @Component({
      selector: 'v-nested-sections',
      render: compileTemplate(`
        <div :ref="outerRoot" :spread="outer.rootProps()" :keydown="outer.onTriggerKeyDown($event)">
          <div :for="o in ['o1', 'o2']" :key="o" :spread="outer.itemProps(o)">
            <h3><button :spread="outer.triggerProps(o)" :click="outer.toggle(o)">{ o }</button></h3>
            <div :if="outer.isPresent(o)" :spread="outer.contentProps(o)">
              <div :if="o === 'o1'" :ref="innerRoot" :spread="inner.rootProps()"
                   :keydown="inner.onTriggerKeyDown($event)">
                <div :for="i in ['i1', 'i2']" :key="i" :spread="inner.itemProps(i)">
                  <h4><button :spread="inner.triggerProps(i)" :click="inner.toggle(i)">{ i }</button></h4>
                </div>
              </div>
            </div>
          </div>
        </div>
      `),
    })
    class Nested {
      outerRoot = new Signal.State<Element | null>(null);
      innerRoot = new Signal.State<Element | null>(null);
      outer = createAccordion({ container: () => this.outerRoot.get(), defaultValue: ['o1'] });
      inner = createAccordion({ container: () => this.innerRoot.get() });
    }

    track(mount(Nested, host));
    flushSync();
    return (value: string) =>
      host.querySelector<HTMLElement>(`[${ACCORDION_TRIGGER_ATTRIBUTE}="${value}"]`)!;
  }

  it('moves the outer one past the inner one’s headers', () => {
    const header = mountNested();

    header('o1').focus();
    press(header('o1'), 'ArrowDown');
    // The inner headers sit between the outer two in the document, but they
    // are another accordion's to move between.
    expect(document.activeElement).toBe(header('o2'));
  });

  it('keeps a key pressed on an inner header to the inner one', () => {
    const header = mountNested();

    header('i1').focus();
    press(header('i1'), 'End');
    // Heard by both, since the inner one is inside the outer one's container:
    // the outer one must not take it as coming from a header of its own.
    expect(document.activeElement).toBe(header('i2'));
  });
});

describe('a disabled accordion item', () => {
  const options = { disabled: (value: string) => value === 'two' };

  it('says so and refuses to open', () => {
    const { trigger, panel, item } = mountAccordion(options);

    expect(trigger('two').getAttribute('aria-disabled')).toBe('true');
    expect(item('two').hasAttribute('data-disabled')).toBe(true);

    trigger('two').click();
    flushSync();
    expect(panel('two')).toBeNull();
  });

  it('can still be reached with the arrow keys', () => {
    const { trigger } = mountAccordion(options);

    trigger('one').focus();
    press(trigger('one'), 'ArrowDown');

    // A header that Tab can reach has to be one the arrows can reach too,
    // otherwise the two orders disagree about which headers exist.
    expect(document.activeElement).toBe(trigger('two'));
  });

  it('does not close a panel that is already open', () => {
    const value = new Signal.State(['two']);
    const { trigger, panel } = mountAccordion({ ...options, collapsible: true, value });

    trigger('two').click();
    flushSync();
    expect(panel('two')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Opened from a consumer's effect
// ---------------------------------------------------------------------------

describe('opened from an effect', () => {
  /** Run `fn` from an effect that re-runs whenever `want` changes. */
  function whenWanted(want: Signal.State<boolean>, fn: () => void): void {
    createRoot((dispose) => {
      restores.push(dispose);
      effect(() => {
        if (want.get()) fn();
      });
    });
  }

  it('does not make the effect depend on the collapsible it opened', () => {
    const { collapsible } = mountCollapsible();
    const want = new Signal.State(false);
    whenWanted(want, () => collapsible.open());

    want.set(true);
    flushSync();
    expect(collapsible.isOpen()).toBe(true);

    // Closed while `want` still holds. An effect that had subscribed to the
    // collapsible's state would run again here and open it straight back up.
    collapsible.close();
    flushSync();
    expect(collapsible.isOpen()).toBe(false);
  });

  it('does not make an effect that toggles it depend on it either', () => {
    const { collapsible } = mountCollapsible();
    const want = new Signal.State(false);
    whenWanted(want, () => collapsible.toggle());

    want.set(true);
    flushSync();
    expect(collapsible.isOpen()).toBe(true);

    collapsible.close();
    flushSync();
    expect(collapsible.isOpen()).toBe(false);
  });

  it('does not make the effect depend on what disables it', () => {
    const locked = new Signal.State(false);
    const { collapsible } = mountCollapsible({ disabled: () => locked.get() });
    const want = new Signal.State(false);
    whenWanted(want, () => collapsible.open());

    want.set(true);
    flushSync();
    collapsible.close();
    flushSync();

    // Locking and unlocking it is not a reason for the effect to open it again.
    locked.set(true);
    flushSync();
    locked.set(false);
    flushSync();
    expect(collapsible.isOpen()).toBe(false);
  });

  it('does not make the effect depend on the accordion it opened a panel of', () => {
    const { accordion } = mountAccordion({ collapsible: true });
    const want = new Signal.State(false);
    whenWanted(want, () => accordion.open('two'));

    want.set(true);
    flushSync();
    expect(accordion.value()).toEqual(['two']);

    accordion.close('two');
    flushSync();
    expect(accordion.value()).toEqual([]);
  });

  it('does not make an effect that closes a panel depend on the accordion', () => {
    const { accordion } = mountAccordion({ collapsible: true, defaultValue: ['two'] });
    const want = new Signal.State(false);
    whenWanted(want, () => accordion.close('two'));

    want.set(true);
    flushSync();
    expect(accordion.value()).toEqual([]);

    // Opened again by the user while `want` still holds.
    accordion.open('two');
    flushSync();
    expect(accordion.value()).toEqual(['two']);
  });

  it('does not make an effect that toggles a panel depend on the accordion either', () => {
    const { accordion } = mountAccordion({ collapsible: true });
    const want = new Signal.State(false);
    whenWanted(want, () => accordion.toggle('two'));

    want.set(true);
    flushSync();
    expect(accordion.value()).toEqual(['two']);

    accordion.close('two');
    flushSync();
    expect(accordion.value()).toEqual([]);
  });
});
