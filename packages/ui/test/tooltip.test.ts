/**
 * `<v-tooltip>`, driven the way a page drives it.
 *
 * The behaviour is `createTooltip`'s, so what is worth asserting here is the
 * seam: that the control the caller wrote in the slot is the one described and
 * the one whose focus opens the label, that the label carries the class the
 * sheet selects on and the state its rules distinguish, and that nothing the
 * component was handed is out of reach afterwards.
 */
import { compileComponents } from './render.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Component, Signal, flushSync, mount } from '@voltdev/core';
import { compileTemplate } from '@voltdev/core/jit';
import { resetTooltipDelayGroup } from '@voltdev/primitives';
import { VButton } from '../src/components/button.js';
import { VTooltip } from '../src/components/tooltip.js';

compileComponents();

let unmount: (() => void) | null = null;

beforeEach(() => {
  // The skip-delay window is module state shared by every tooltip on a page,
  // so a test that opened one would otherwise hand the next one no delay.
  resetTooltipDelayGroup();
});

afterEach(() => {
  // Only the skip-delay probe fakes them, and it does it mid-test so that the
  // group reset above still runs on the real clock.
  vi.useRealTimers();
  unmount?.();
  unmount = null;
  document.body.innerHTML = '';
});

function show<T>(component: new () => T): { instance: T; host: HTMLElement } {
  const host = document.createElement('div');
  document.body.append(host);
  const handle = mount(component, host);
  unmount = handle.unmount;
  flushSync();
  return { instance: handle.instance as T, host };
}

/** The floating label, wherever the portal put it. */
const label = (): HTMLElement | null => document.querySelector('.volt-tooltip-content');

/** Focus arriving by keyboard, which is the event the wrapper can hear. */
function focusIn(el: HTMLElement): void {
  el.focus();
  el.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
  flushSync();
}

function focusOut(el: HTMLElement): void {
  el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  flushSync();
}

describe('v-tooltip', () => {
  @Component({
    selector: 'v-page',
    imports: [VTooltip, VButton],
    render: compileTemplate(`
      <v-tooltip :ref="tip" text="Delete permanently" class="mine" :open="open">
        <button :slot-trigger class="volt-button" data-variant="danger">Delete</button>
      </v-tooltip>
    `),
  })
  class Page {
    tip: VTooltip | null = null;
    open = new Signal.State(false);
  }

  const trigger = (host: HTMLElement): HTMLElement => host.querySelector('button')!;

  it('shows the trigger and nothing else until it opens', () => {
    const { host } = show(Page);

    // The caller's own markup, untouched, inside the wrapper the component
    // draws so that the primitive has an element to anchor and dismiss against.
    const wrapper = host.querySelector('span')!;
    expect(wrapper.firstElementChild).toBe(trigger(host));
    expect(trigger(host).textContent).toBe('Delete');
    expect(label()).toBe(null);
  });

  it('opens on keyboard focus, which is the whole reason for the primitive', () => {
    const { instance, host } = show(Page);

    focusIn(trigger(host));
    expect(instance.open.get()).toBe(true);
    expect(label()?.textContent).toBe('Delete permanently');

    focusOut(trigger(host));
    expect(instance.open.get()).toBe(false);
    expect(label()).toBe(null);
  });

  it('closes on Escape, which is the primitive’s doing', () => {
    const { instance, host } = show(Page);
    focusIn(trigger(host));

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    flushSync();
    expect(instance.open.get()).toBe(false);
  });

  it('marks the label with the states the sheet’s rules distinguish', () => {
    const { instance, host } = show(Page);
    focusIn(trigger(host));

    expect(label()!.classList.contains('volt-tooltip-content')).toBe(true);
    expect(label()!.getAttribute('data-state')).toBe('open');
    expect(label()!.getAttribute('role')).toBe('tooltip');

    instance.open.set(false);
    flushSync();
    // The other state the sheet draws is the exit, which lasts exactly as long
    // as the animation it starts. There is no animation engine here, so the
    // node is released in the same flush and the state is only readable on the
    // primitive.
    expect(instance.tip!.tooltip.state()).toBe('closed');
    expect(label()).toBe(null);
  });

  it('describes the control, not the wrapper a reader never visits', () => {
    const { host } = show(Page);
    focusIn(trigger(host));

    const described = trigger(host).getAttribute('aria-describedby');
    expect(described).toBe(label()!.id);
    expect(described).not.toBe(null);
    expect(host.querySelector('span')!.hasAttribute('aria-describedby')).toBe(false);

    focusOut(trigger(host));
    // The label is gone, so the reference goes with it rather than pointing at
    // an id that is no longer in the document.
    expect(trigger(host).hasAttribute('aria-describedby')).toBe(false);
  });

  it('puts what the caller wrote on the tag on the label', () => {
    const { host } = show(Page);
    focusIn(trigger(host));
    expect([...label()!.classList].sort()).toEqual(['mine', 'volt-tooltip-content']);
  });

  it('opens and closes on the signal the page holds', () => {
    const { instance } = show(Page);
    expect(label()).toBe(null);

    instance.open.set(true);
    flushSync();
    expect(label()).not.toBe(null);

    instance.open.set(false);
    flushSync();
    expect(label()).toBe(null);
  });

  it('hands the primitive itself to whoever needs more than this offers', () => {
    const { instance } = show(Page);
    expect(instance.tip?.tooltip.isOpen()).toBe(false);

    instance.tip!.tooltip.open();
    flushSync();
    expect(instance.tip!.tooltip.isOpen()).toBe(true);
    expect(label()).not.toBe(null);
  });

  it('follows a text bound to a signal rather than reading it once', () => {
    @Component({
      selector: 'v-page-text',
      imports: [VTooltip],
      render: compileTemplate(`
        <v-tooltip :text="words.get()" :defaultOpen="true">
          <button :slot-trigger>Copy</button>
        </v-tooltip>
      `),
    })
    class TextPage {
      words = new Signal.State('Copy to clipboard');
    }

    const { instance } = show(TextPage);
    expect(label()?.textContent).toBe('Copy to clipboard');

    instance.words.set('Copied');
    flushSync();
    expect(label()?.textContent).toBe('Copied');
  });

  it('takes markup for the label, and names a trigger that has no words', () => {
    @Component({
      selector: 'v-page-icon',
      imports: [VTooltip],
      render: compileTemplate(`
        <v-tooltip label="Delete" :defaultOpen="true">
          <button :slot-trigger>✕</button>
          <b>Delete</b> permanently
        </v-tooltip>
      `),
    })
    class IconPage {}

    const { host } = show(IconPage);
    expect(label()!.querySelector('b')?.textContent).toBe('Delete');
    // An icon button that is described but not named is announced as "button",
    // and the name has to reach the control rather than the wrapper.
    expect(host.querySelector('button')!.getAttribute('aria-label')).toBe('Delete');
  });

  it('opens on hover and closes when the pointer leaves', () => {
    @Component({
      selector: 'v-page-hover',
      imports: [VTooltip],
      render: compileTemplate(`
        <v-tooltip text="Save" :openDelay="0" :closeDelay="0">
          <button :slot-trigger>Save</button>
        </v-tooltip>
      `),
    })
    class HoverPage {}

    const { host } = show(HoverPage);
    const wrapper = host.querySelector('span')!;

    wrapper.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
    flushSync();
    expect(label()?.textContent).toBe('Save');

    wrapper.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }));
    flushSync();
    expect(label()).toBe(null);
  });

  it('anchors the label to the wrapper, which is where the control is', () => {
    const { instance, host } = show(Page);
    focusIn(trigger(host));

    // Positioning is the anchor primitive's, declared in CSS: the wrapper is
    // named and the label points at that name, which is why nothing here
    // measures a rectangle or listens for scroll.
    const name = host.querySelector('span')!.style.getPropertyValue('anchor-name');
    expect(name).toBe(instance.tip!.tooltip.anchorName());
    expect(label()!.style.getPropertyValue('position-anchor')).toBe(name);
    expect(label()!.getAttribute('data-placement')).toBe('top');
  });

  it('adds to the ARIA the caller wrote on their own control', () => {
    @Component({
      selector: 'v-page-aria',
      imports: [VTooltip],
      render: compileTemplate(`
        <div>
          <v-tooltip text="Delete the selected row">
            <button
              :slot-trigger
              aria-label="Delete row"
              aria-describedby="help"
              aria-keyshortcuts="Delete"
            >✕</button>
          </v-tooltip>
          <p id="help">Deleted rows stay in the bin for thirty days.</p>
        </div>
      `),
    })
    class AriaPage {}

    const { host } = show(AriaPage);
    const control = host.querySelector('button')!;

    // Closed, this has nothing of its own to say about either attribute, and
    // what the caller wrote is still what a reader announces.
    expect(control.getAttribute('aria-label')).toBe('Delete row');
    expect(control.getAttribute('aria-describedby')).toBe('help');
    expect(control.getAttribute('aria-keyshortcuts')).toBe('Delete');

    focusIn(control);
    // Open, the label is one more description rather than a replacement for
    // the help text the caller pointed at.
    expect(control.getAttribute('aria-describedby')).toBe(`help ${label()!.id}`);
    expect(control.getAttribute('aria-label')).toBe('Delete row');

    focusOut(control);
    expect(control.getAttribute('aria-describedby')).toBe('help');
    expect(control.getAttribute('aria-label')).toBe('Delete row');
  });

  it('describes the control inside the trigger, not the group around it', () => {
    @Component({
      selector: 'v-page-group',
      imports: [VTooltip],
      render: compileTemplate(`
        <v-tooltip text="Remove" label="Remove" :defaultOpen="true">
          <span :slot-trigger class="grouping"><button id="real">✕</button></span>
        </v-tooltip>
      `),
    })
    class GroupPage {}

    const { host } = show(GroupPage);
    const control = host.querySelector('#real')!;
    const group = host.querySelector('.grouping')!;

    // The element that takes focus is the one a reader announces, however many
    // wrappers the caller put between it and the slot.
    expect(control.getAttribute('aria-describedby')).toBe(label()!.id);
    expect(control.getAttribute('aria-label')).toBe('Remove');
    expect(group.hasAttribute('aria-describedby')).toBe(false);
    expect(group.hasAttribute('aria-label')).toBe(false);
  });

  it('portals the label out of the row the trigger sits in', () => {
    const { host } = show(Page);
    focusIn(trigger(host));

    // Left in the row, the label is clipped by any toolbar with
    // `overflow: hidden` and trapped in whatever stacking context the row makes.
    expect(label()!.parentElement).toBe(document.body);
    expect(host.contains(label())).toBe(false);
  });

  it('stays open while the pointer travels from the trigger onto the label', () => {
    @Component({
      selector: 'v-page-travel',
      imports: [VTooltip],
      render: compileTemplate(`
        <v-tooltip :ref="tip" text="Save" :openDelay="0" :closeDelay="0">
          <button :slot-trigger>Save</button>
        </v-tooltip>
      `),
    })
    class TravelPage {
      tip: VTooltip | null = null;
    }

    const { instance, host } = show(TravelPage);
    const wrapper = host.querySelector('span')!;

    wrapper.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
    flushSync();
    // The primitive can only be asked whether the pointer went into the label
    // if it was handed the label.
    expect(instance.tip!.content.get()).toBe(label());

    wrapper.dispatchEvent(
      new PointerEvent('pointerleave', { pointerType: 'mouse', relatedTarget: label() }),
    );
    flushSync();
    // Reading a long description means putting the pointer on it, so crossing
    // the gap must not take it away.
    expect(label()).not.toBe(null);

    label()!.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
    flushSync();
    label()!.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }));
    flushSync();
    expect(label()).toBe(null);
  });

  it('leaves Escape to the layer beneath when the caller turns it off', () => {
    @Component({
      selector: 'v-page-escape',
      imports: [VTooltip],
      render: compileTemplate(`
        <v-tooltip :ref="tip" text="Save" :closeOnEscape="false" :defaultOpen="true">
          <button :slot-trigger>Save</button>
        </v-tooltip>
      `),
    })
    class EscapePage {
      tip: VTooltip | null = null;
    }

    const { instance } = show(EscapePage);
    expect(label()).not.toBe(null);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    flushSync();
    // A tooltip holds nothing, so the key was meant for the dialog it is
    // showing in.
    expect(instance.tip!.tooltip.isOpen()).toBe(true);
    expect(label()).not.toBe(null);
  });

  it('drops the opposite side from the fallbacks when flip is turned off', () => {
    @Component({
      selector: 'v-page-flip',
      imports: [VTooltip],
      render: compileTemplate(`
        <v-tooltip text="Save" :flip="false" :defaultOpen="true">
          <button :slot-trigger>Save</button>
        </v-tooltip>
      `),
    })
    class FlipPage {}

    show(FlipPage);
    const fallbacks = label()!.style.getPropertyValue('position-try-fallbacks');

    // The other alignment is still worth trying; the opposite side is the one
    // the caller said no to.
    expect(fallbacks).not.toBe('');
    expect(fallbacks.includes('flip-block')).toBe(false);
  });

  it('puts the gap it was given between the trigger and the label', () => {
    @Component({
      selector: 'v-page-offset',
      imports: [VTooltip],
      render: compileTemplate(`
        <v-tooltip text="Save" :offset="12" :defaultOpen="true">
          <button :slot-trigger>Save</button>
        </v-tooltip>
      `),
    })
    class OffsetPage {}

    show(OffsetPage);

    // Above the trigger, so the gap is a margin on the edge that faces it.
    expect(label()!.style.getPropertyValue('margin-bottom')).toBe('12px');
    expect(label()!.style.getPropertyValue('--volt-anchor-offset')).toBe('12px');
  });

  it('hands the next tooltip the full delay when skipDelay is zero', () => {
    @Component({
      selector: 'v-page-skip',
      imports: [VTooltip],
      render: compileTemplate(`
        <div>
          <v-tooltip text="Bold" :openDelay="0" :closeDelay="0" :skipDelay="0">
            <button :slot-trigger id="bold">B</button>
          </v-tooltip>
          <v-tooltip text="Italic">
            <button :slot-trigger id="italic">I</button>
          </v-tooltip>
        </div>
      `),
    })
    class SkipPage {}

    vi.useFakeTimers();
    const { host } = show(SkipPage);
    const wrapperOf = (id: string): HTMLElement => host.querySelector(id)!.parentElement!;

    wrapperOf('#bold').dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
    flushSync();
    expect(label()?.textContent).toBe('Bold');

    wrapperOf('#bold').dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }));
    flushSync();
    expect(label()).toBe(null);

    // Zero is the caller turning the shared window off: the next tooltip waits
    // the full delay again rather than opening as the pointer arrives.
    wrapperOf('#italic').dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
    flushSync();
    expect(label()).toBe(null);

    vi.advanceTimersByTime(700);
    flushSync();
    expect(label()?.textContent).toBe('Italic');
  });
});
