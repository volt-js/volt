/**
 * Tooltip, driven through a real mounted component.
 *
 * The interesting behaviour is all timing and reachability: that the delays
 * can be waited out and cancelled, that a keyboard user gets the same text a
 * mouse user gets, that the pointer can travel from the trigger onto the
 * tooltip without losing it, and that the shared skip window makes the second
 * tooltip in a row open at once.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compileTemplate } from '@voltdev/core/jit';
import { Component, Signal, createRoot, flushSync, mount } from '@voltdev/core';
import { createTooltip, resetTooltipDelayGroup, type TooltipOptions } from '../src/tooltip.ts';
import { createDismiss } from '../src/dismiss.ts';

type Overrides = Omit<Partial<TooltipOptions>, 'content' | 'trigger'>;

/** Read by the component's field initialiser, so each test can vary options. */
let overrides: Overrides = {};

let host: HTMLElement;
let mounted: { unmount(): void }[] = [];

function track<T extends { unmount(): void }>(handle: T): T {
  mounted.push(handle);
  return handle;
}

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div><div id="elsewhere">page</div>';
  host = document.querySelector('#app')!;
  overrides = {};
  // The skip window is module state shared by every tooltip on the page, so a
  // test that left one open would otherwise hand the next test a warm group.
  resetTooltipDelayGroup();
  vi.useFakeTimers();
});

afterEach(() => {
  for (const handle of mounted) handle.unmount();
  mounted = [];
  flushSync();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

@Component({
  selector: 'v-save',
  render: compileTemplate(`
    <div>
      <button :ref="trigger" :spread="tip.triggerProps()">save</button>
      <div :if="tip.isPresent()" :portal :ref="content" :spread="tip.contentProps()">
        Save the file
      </div>
    </div>
  `),
})
class Save {
  trigger = new Signal.State<Element | null>(null);
  content = new Signal.State<Element | null>(null);
  tip = createTooltip({
    trigger: () => this.trigger.get(),
    content: () => this.content.get(),
    ...overrides,
  });
}

function setup(options: Overrides = {}) {
  overrides = options;
  const handle = track(mount(Save, host));
  const instance = handle.instance as Save;
  return {
    handle,
    instance,
    tip: instance.tip,
    trigger: () => host.querySelector('button')!,
    content: () => document.querySelector('[role="tooltip"]'),
  };
}

/** Advance the clock and let the resulting DOM updates land. */
function advance(ms: number) {
  vi.advanceTimersByTime(ms);
  flushSync();
}

function enter(el: Element, from?: Element | null) {
  el.dispatchEvent(
    new PointerEvent('pointerenter', { pointerType: 'mouse', relatedTarget: from ?? null }),
  );
  flushSync();
}

function leave(el: Element, to?: Element | null) {
  el.dispatchEvent(
    new PointerEvent('pointerleave', { pointerType: 'mouse', relatedTarget: to ?? null }),
  );
  flushSync();
}

function press(el: Element) {
  el.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'mouse', bubbles: true }));
  flushSync();
}

function escape() {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  flushSync();
}

describe('opening on hover', () => {
  it('starts closed with nothing rendered', () => {
    const { content } = setup();
    expect(content()).toBeNull();
  });

  it('waits out the open delay before showing anything', () => {
    const { trigger, content } = setup();
    enter(trigger());

    advance(699);
    // A pointer crossing a toolbar must not leave a trail of tooltips behind.
    expect(content()).toBeNull();

    advance(1);
    expect(content()).not.toBeNull();
  });

  it('cancels a pending open when the pointer leaves first', () => {
    const { trigger, content } = setup();
    enter(trigger());
    advance(300);
    leave(trigger());

    advance(5000);
    expect(content()).toBeNull();
  });

  it('honours a custom open delay', () => {
    const { trigger, content } = setup({ openDelay: 50 });
    enter(trigger());
    advance(49);
    expect(content()).toBeNull();
    advance(1);
    expect(content()).not.toBeNull();
  });

  it('ignores the hover a touch device emulates', () => {
    const { trigger, content } = setup();
    trigger().dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'touch' }));
    flushSync();

    // The emulated hover arrives with the tap and never leaves, so the tooltip
    // would sit over whatever was just tapped.
    advance(5000);
    expect(content()).toBeNull();
  });
});

describe('closing on pointer leave', () => {
  it('lingers for the close delay rather than vanishing', () => {
    const { trigger, content } = setup();
    enter(trigger());
    advance(700);

    leave(trigger());
    advance(299);
    expect(content()).not.toBeNull();

    advance(1);
    expect(content()).toBeNull();
  });

  it('stays open when the pointer moves onto the content', () => {
    const { trigger, content, instance } = setup();
    enter(trigger());
    advance(700);

    const tip = content()!;
    leave(trigger(), tip);
    enter(tip, trigger());

    advance(5000);
    expect(instance.tip.isOpen()).toBe(true);
  });

  it('survives the crossing even with no close delay at all', () => {
    const { trigger, content, instance } = setup({ openDelay: 0, closeDelay: 0 });
    enter(trigger());
    flushSync();

    const tip = content()!;
    // With a zero delay there is no grace period to hide behind: the only
    // thing that keeps the tooltip alive is knowing where the pointer went.
    leave(trigger(), tip);
    expect(instance.tip.isOpen()).toBe(true);

    enter(tip, trigger());
    leave(tip, document.querySelector('#elsewhere'));
    expect(instance.tip.isOpen()).toBe(false);
  });

  it('cancels a pending close when the pointer arrives on the content', () => {
    const { trigger, content, instance } = setup();
    enter(trigger());
    advance(700);

    const tip = content()!;
    leave(trigger());
    advance(100);
    enter(tip);

    advance(5000);
    expect(instance.tip.isOpen()).toBe(true);
  });

  it('closes once the pointer leaves the content too', () => {
    const { trigger, content } = setup();
    enter(trigger());
    advance(700);

    const tip = content()!;
    leave(trigger(), tip);
    enter(tip, trigger());
    leave(tip);

    advance(300);
    expect(content()).toBeNull();
  });
});

describe('keyboard focus', () => {
  it('opens at once on focus, with no delay to wait out', () => {
    const { trigger, content } = setup();
    trigger().focus();
    flushSync();

    // A keyboard user cannot "hover a little longer" to prove they meant it.
    expect(content()).not.toBeNull();
  });

  it('closes on blur', () => {
    const { trigger, content } = setup();
    trigger().focus();
    flushSync();

    trigger().blur();
    flushSync();
    expect(content()).toBeNull();
  });

  it('stays open on blur while the pointer is still on the trigger', () => {
    const { trigger, content, instance } = setup();
    enter(trigger());
    advance(700);
    trigger().focus();
    flushSync();

    // Tab moves focus without moving the pointer, and the hover is its own
    // reason for the tooltip to be there.
    trigger().blur();
    flushSync();
    expect(instance.tip.isOpen()).toBe(true);
    expect(content()).not.toBeNull();
  });

  it('does not open when focus arrives from a press', () => {
    const { trigger, content } = setup();
    press(trigger());
    trigger().focus();
    flushSync();

    // Clicking a button focuses it; a tooltip that appeared on every click
    // would cover the thing the click just did.
    expect(content()).toBeNull();
  });

  it('closes when the trigger is pressed', () => {
    const { trigger, content } = setup();
    trigger().focus();
    flushSync();
    expect(content()).not.toBeNull();

    press(trigger());
    expect(content()).toBeNull();
  });

  it('opens again on the next keyboard focus after a press', () => {
    const { trigger, content } = setup();
    press(trigger());
    trigger().focus();
    flushSync();
    trigger().blur();
    flushSync();

    // The press is remembered for one focus event, not held for good.
    trigger().focus();
    flushSync();
    expect(content()).not.toBeNull();
  });

  it('forgets a press the pointer has moved away from', () => {
    const { trigger, content } = setup();
    // A press that never moved focus — a trigger the browser does not focus on
    // pointerdown, say — would otherwise leave the flag set for the next Tab.
    press(trigger());
    leave(trigger());

    trigger().focus();
    flushSync();
    expect(content()).not.toBeNull();
  });

  it('never moves focus into the tooltip', () => {
    const { trigger, content } = setup();
    trigger().focus();
    flushSync();

    // Nothing in a tooltip is interactive, so focus inside it would be a
    // dead end for whoever pressed Tab to get there.
    expect(document.activeElement).toBe(trigger());
    expect(content()!.hasAttribute('tabindex')).toBe(false);
  });
});

describe('dismissal', () => {
  it('closes on Escape', () => {
    const { trigger, content } = setup();
    trigger().focus();
    flushSync();

    escape();
    expect(content()).toBeNull();
  });

  it('closes on Escape when it was opened by hover', () => {
    const { trigger, content } = setup();
    enter(trigger());
    advance(700);

    escape();
    expect(content()).toBeNull();
  });

  it('keeps it open when Escape is turned off', () => {
    const { trigger, content } = setup({ closeOnEscape: false });
    trigger().focus();
    flushSync();

    escape();
    expect(content()).not.toBeNull();
  });

  it('lets Escape through to the layer beneath when Escape is turned off', () => {
    const beneath = vi.fn();
    const dispose = createRoot((dispose) => {
      createDismiss(() => document.querySelector('#elsewhere'), beneath);
      return dispose;
    });
    try {
      const { trigger, content } = setup({ closeOnEscape: false });
      trigger().focus();
      flushSync();

      // Not the tooltip's key, which is not the same as nobody's: a dialog the
      // tooltip is showing in still has to close.
      escape();
      expect(content()).not.toBeNull();
      expect(beneath).toHaveBeenCalledWith('escape');
    } finally {
      dispose();
    }
  });

  it('does not reopen after Escape while the pointer sits still', () => {
    const { trigger, content } = setup();
    enter(trigger());
    advance(700);
    escape();

    // Dismissal is final until the pointer leaves and comes back — otherwise
    // Escape would be undone by the hover that is still in progress.
    advance(5000);
    expect(content()).toBeNull();
  });

  it('closes on a press outside', () => {
    const { trigger, content } = setup();
    trigger().focus();
    flushSync();

    const elsewhere = document.querySelector('#elsewhere')!;
    elsewhere.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    elsewhere.dispatchEvent(new Event('pointerup', { bubbles: true }));
    flushSync();
    expect(content()).toBeNull();
  });
});

describe('what assistive technology is told', () => {
  it('describes the trigger only while the tooltip is there', () => {
    const { trigger, content } = setup();
    // A reference to an element that does not exist is worse than none: it
    // hides the fact that there is nothing to read.
    expect(trigger().hasAttribute('aria-describedby')).toBe(false);

    enter(trigger());
    advance(700);
    expect(trigger().getAttribute('aria-describedby')).toBe(content()!.id);

    escape();
    expect(trigger().hasAttribute('aria-describedby')).toBe(false);
  });

  it('marks the content as a tooltip and states its state', () => {
    const { trigger, content } = setup();
    enter(trigger());
    advance(700);

    expect(content()!.getAttribute('role')).toBe('tooltip');
    expect(content()!.getAttribute('data-state')).toBe('open');
  });

  it('names the trigger when the tooltip is its only name', () => {
    const { trigger } = setup({ label: 'Sauvegarder' });
    // Every string a user hears comes from the consumer, so it can be
    // translated with the rest of their application.
    expect(trigger().getAttribute('aria-label')).toBe('Sauvegarder');
  });

  it('leaves the trigger unnamed when no label was given', () => {
    const { trigger } = setup();
    expect(trigger().hasAttribute('aria-label')).toBe(false);
  });
});

describe('anchor positioning', () => {
  it('names the trigger as the anchor and points the content at it', () => {
    const { trigger, content, tip } = setup();
    enter(trigger());
    advance(700);

    const name = tip.anchorName();
    expect(name.startsWith('--')).toBe(true);
    expect((trigger() as HTMLElement).style.getPropertyValue('anchor-name')).toBe(name);
    expect((content() as HTMLElement).style.getPropertyValue('position-anchor')).toBe(name);
  });

  it('gives every tooltip its own anchor name', () => {
    const first = setup();
    const second = setup();
    // Two tooltips sharing a name would anchor to each other.
    expect(first.tip.anchorName()).not.toBe(second.tip.anchorName());
  });

  it('sits above the trigger by default', () => {
    const { tip, trigger, content } = setup();
    enter(trigger());
    advance(700);

    // Above, because it is the one side a pointer resting on the trigger
    // cannot cover.
    expect(tip.placement()).toBe('top');
    const el = content() as HTMLElement;
    expect(el.getAttribute('data-placement')).toBe('top');
    expect(el.style.getPropertyValue('position-area')).toBe('top center');
    expect(el.getAttribute('data-anchored')).toBe('true');
    // A `position-area` on a statically positioned element is inert, and a
    // tooltip that silently never moves is the most common way to get this
    // wrong.
    expect(el.style.getPropertyValue('position')).toBe('absolute');
  });

  it('offers the opposite side first when it would overflow', () => {
    const { trigger, content } = setup({ placement: 'top' });
    enter(trigger());
    advance(700);

    // A tooltip near the top of the window belongs below its trigger, not
    // shunted sideways over it.
    expect((content() as HTMLElement).style.getPropertyValue('position-try-fallbacks')).toBe(
      'flip-block, top span-right, top span-left',
    );
  });

  it('writes a gap as margins on all four sides', () => {
    const { trigger, content } = setup({ offset: 6 });
    enter(trigger());
    advance(700);

    // A margin rather than an inset, because it survives a flip: the fallbacks
    // swap the margins along with everything else.
    const style = (content() as HTMLElement).style;
    expect(Number.parseFloat(style.getPropertyValue('margin-bottom'))).toBe(6);
    expect(Number.parseFloat(style.getPropertyValue('margin-top'))).toBe(0);
    expect(Number.parseFloat(style.getPropertyValue('margin-left'))).toBe(0);
    expect(Number.parseFloat(style.getPropertyValue('margin-right'))).toBe(0);
  });

  it('mirrors the alignment under rtl, resolved against the trigger', () => {
    // An RTL region of an otherwise left-to-right page — a quoted message, a
    // comment field — which is the common case, not the exotic one.
    host.setAttribute('dir', 'rtl');

    const { trigger, content } = setup({ placement: 'top-start' });
    enter(trigger());
    advance(700);

    // The tooltip is portalled into an LTR body, so a logical `span-x-end`
    // left for the browser to resolve would be resolved against <body> and
    // align to the wrong edge of the trigger.
    expect(document.documentElement.getAttribute('dir')).toBeNull();
    expect((content() as HTMLElement).parentElement).toBe(document.body);
    expect((content() as HTMLElement).style.getPropertyValue('position-area')).toBe(
      'top span-left',
    );
  });

  it('says so where the browser cannot anchor, instead of measuring in script', () => {
    vi.stubGlobal('CSS', { supports: () => false });

    const { trigger, content } = setup();
    enter(trigger());
    advance(700);

    // The consumer's CSS can place it from `[data-anchored='false']`; what it
    // will not get is a scroll handler measuring rectangles on every frame.
    const el = content() as HTMLElement;
    expect(el.getAttribute('data-anchored')).toBe('false');
    expect(el.style.getPropertyValue('position-anchor')).toBe('');
    expect(el.style.getPropertyValue('position-area')).toBe('');
    expect((trigger() as HTMLElement).style.getPropertyValue('anchor-name')).toBe('');
  });
});

describe('the shared skip-delay window', () => {
  @Component({
    selector: 'v-toolbar',
    render: compileTemplate(`
      <div>
        <button id="one" :ref="triggerOne" :spread="one.triggerProps()">one</button>
        <button id="two" :ref="triggerTwo" :spread="two.triggerProps()">two</button>
        <div :if="one.isPresent()" :ref="contentOne" :spread="one.contentProps()">first</div>
        <div :if="two.isPresent()" :ref="contentTwo" :spread="two.contentProps()">second</div>
      </div>
    `),
  })
  class Toolbar {
    triggerOne = new Signal.State<Element | null>(null);
    contentOne = new Signal.State<Element | null>(null);
    triggerTwo = new Signal.State<Element | null>(null);
    contentTwo = new Signal.State<Element | null>(null);

    one = createTooltip({
      trigger: () => this.triggerOne.get(),
      content: () => this.contentOne.get(),
    });
    two = createTooltip({
      trigger: () => this.triggerTwo.get(),
      content: () => this.contentTwo.get(),
    });
  }

  function toolbar() {
    const handle = track(mount(Toolbar, host));
    const instance = handle.instance as Toolbar;
    return {
      instance,
      one: () => host.querySelector('#one')!,
      two: () => host.querySelector('#two')!,
    };
  }

  it('opens the second tooltip at once while the first is still open', () => {
    const { instance, one, two } = toolbar();
    enter(one());
    advance(700);

    enter(two());
    flushSync();
    // Waiting the full delay again for every button makes a toolbar unusable.
    expect(instance.two.isOpen()).toBe(true);
  });

  it('keeps skipping for a while after the first has closed', () => {
    const { instance, one, two } = toolbar();
    enter(one());
    advance(700);
    leave(one());
    advance(300);
    expect(instance.one.isOpen()).toBe(false);

    // The gap between two buttons must not drop the user back to square one.
    enter(two());
    flushSync();
    expect(instance.two.isOpen()).toBe(true);
  });

  it('goes back to the full delay once the window has expired', () => {
    const { instance, one, two } = toolbar();
    enter(one());
    advance(700);
    leave(one());
    advance(300);
    advance(400);

    enter(two());
    flushSync();
    expect(instance.two.isOpen()).toBe(false);
    advance(700);
    expect(instance.two.isOpen()).toBe(true);
  });

  it('still counts later tooltips after a reset that found one open', () => {
    const { instance, one, two } = toolbar();
    enter(one());
    advance(700);
    expect(instance.one.isOpen()).toBe(true);

    // Forgotten while open, then closed: it belongs to the group that was
    // forgotten, and must not take the new one's count below nothing.
    resetTooltipDelayGroup();
    leave(one());
    advance(300);
    expect(instance.one.isOpen()).toBe(false);

    // Nor warm the new group on its way out.
    enter(two());
    flushSync();
    expect(instance.two.isOpen()).toBe(false);
    advance(700);
    expect(instance.two.isOpen()).toBe(true);

    // With the second one open, the first skips its delay as it always would.
    enter(one());
    flushSync();
    expect(instance.one.isOpen()).toBe(true);
  });

  it('leaves the group when a tooltip is unmounted while open', () => {
    const first = setup();
    enter(first.trigger());
    advance(700);
    expect(first.tip.isOpen()).toBe(true);

    first.handle.unmount();
    flushSync();
    // Past the skip window the group has to be empty again; a tooltip that
    // never decremented on unmount would keep every later one instant.
    advance(1000);

    const second = setup();
    enter(second.trigger());
    flushSync();
    expect(second.tip.isOpen()).toBe(false);
    advance(700);
    expect(second.tip.isOpen()).toBe(true);
  });
});

describe('control and reporting', () => {
  it('follows a signal supplied from outside', () => {
    const open = new Signal.State(false);
    const { content } = setup({ open });

    open.set(true);
    flushSync();
    expect(content()).not.toBeNull();

    escape();
    expect(open.get()).toBe(false);
    expect(content()).toBeNull();
  });

  it('can start open', () => {
    const { content } = setup({ defaultOpen: true });
    flushSync();
    expect(content()).not.toBeNull();
  });

  it('reports both directions through onOpenChange', () => {
    const onOpenChange = vi.fn();
    const { trigger } = setup({ onOpenChange });

    enter(trigger());
    advance(700);
    expect(onOpenChange).toHaveBeenCalledWith(true);

    leave(trigger());
    advance(300);
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(onOpenChange).toHaveBeenCalledTimes(2);
  });

  it('opens and closes on demand, ignoring the delays', () => {
    const { tip, content } = setup();
    tip.open();
    flushSync();
    expect(content()).not.toBeNull();

    tip.close();
    flushSync();
    expect(content()).toBeNull();
  });

  it('drops a pending open when it is unmounted mid-delay', () => {
    const onOpenChange = vi.fn();
    const { trigger, handle } = setup({ onOpenChange });
    enter(trigger());
    advance(300);

    handle.unmount();
    flushSync();
    advance(5000);
    // A timer that outlived its component would set state on a dead scope.
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
