/**
 * `<v-popover>`, driven the way a page drives it.
 *
 * The behaviour is the primitive's, and it is tested there. What is worth
 * asserting here is the seam: that the trigger the component renders is the
 * element the primitive anchors and opens from, that `:host` lands on the
 * panel rather than on the button left behind, that every attribute the
 * sheet's rules select on is written by the markup this draws, and that a
 * caller who binds a prop keeps it live.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Component, Signal, flushSync, mount } from '@voltdev/core';
import { compileTemplate } from '@voltdev/core/jit';
import { compileComponents } from './render.js';
import { VPopover } from '../src/components/popover.js';

compileComponents();

let unmount: (() => void) | null = null;

afterEach(() => {
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

const trigger = (host: HTMLElement): HTMLButtonElement => host.querySelector('button')!;
const panel = (): HTMLElement | null => document.querySelector('.volt-popover-content');
const arrow = (): HTMLElement | null => document.querySelector('.volt-popover-arrow');

@Component({
  selector: 'v-page',
  imports: [VPopover],
  render: compileTemplate(`
    <v-popover :open="open" :title="heading.get()" description="Narrow the list."
               placement="bottom-start" variant="primary" size="sm" class="mine">
      <template :slot-trigger>Filters</template>
      <button class="apply">Apply</button>
    </v-popover>
  `),
})
class Page {
  open = new Signal.State(false);
  heading = new Signal.State<string | undefined>('Filters');
}

describe('the trigger', () => {
  it('is a button the sheet draws, holding what the slot was given', () => {
    const { host } = show(Page);
    const button = trigger(host);

    expect(button.className).toBe('volt-button');
    expect(button.dataset['variant']).toBe('primary');
    expect(button.dataset['size']).toBe('sm');
    expect(button.textContent?.trim()).toBe('Filters');
    // Defaulted rather than left to the platform, whose default submits the
    // form the popover was opened from.
    expect(button.type).toBe('button');
    expect(button.getAttribute('aria-haspopup')).toBe('dialog');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(panel()).toBe(null);
  });

  it('opens on a press, with no handler wired by the caller', () => {
    const { instance, host } = show(Page);
    trigger(host).click();
    flushSync();

    expect(instance.open.get()).toBe(true);
    expect(trigger(host).getAttribute('aria-expanded')).toBe('true');
    // Only while there is something to point at.
    expect(trigger(host).getAttribute('aria-controls')).toBe(panel()!.id);
  });

  it('opens and closes on the signal the page holds', () => {
    const { instance } = show(Page);
    instance.open.set(true);
    flushSync();
    expect(panel()).not.toBe(null);

    instance.open.set(false);
    flushSync();
    expect(panel()).toBe(null);
  });
});

describe('the panel', () => {
  it('is where what the caller wrote on the tag lands', () => {
    const { instance, host } = show(Page);
    instance.open.set(true);
    flushSync();

    // The panel portals, so the caller's class is on the content they meant
    // and not on the button that stayed behind.
    expect([...panel()!.classList].sort()).toEqual(['mine', 'volt-popover-content']);
    expect(trigger(host).classList.contains('mine')).toBe(false);
    expect(panel()!.parentElement).toBe(document.body);
  });

  it('carries the state and the placement the sheet selects on', () => {
    const { instance } = show(Page);
    instance.open.set(true);
    flushSync();

    expect(panel()!.getAttribute('data-state')).toBe('open');
    expect(panel()!.getAttribute('data-placement')).toBe('bottom-start');
    expect(panel()!.getAttribute('role')).toBe('dialog');
    // Non-modal: the page behind stays available, so nothing claims otherwise.
    expect(panel()!.getAttribute('aria-modal')).toBe(null);
    // Somewhere for focus to go in a panel with nothing focusable in it.
    expect(panel()!.getAttribute('tabindex')).toBe('-1');
  });

  it('is named by its title and described by its description', () => {
    const { instance } = show(Page);
    instance.open.set(true);
    flushSync();

    const title = panel()!.querySelector('.volt-popover-title')!;
    const description = panel()!.querySelector('.volt-popover-description')!;
    expect(title.tagName).toBe('H2');
    expect(title.textContent?.trim()).toBe('Filters');
    expect(description.textContent?.trim()).toBe('Narrow the list.');
    // The elements carrying the primitive's own ids, so nothing dangles.
    expect(panel()!.getAttribute('aria-labelledby')).toBe(title.id);
    expect(panel()!.getAttribute('aria-describedby')).toBe(description.id);
    expect(title.id).not.toBe('');

    expect(panel()!.querySelector('.apply')?.textContent).toBe('Apply');
  });

  it('follows a title bound to a signal, as every prop a template reads does', () => {
    const { instance } = show(Page);
    instance.open.set(true);
    flushSync();

    instance.heading.set('Filters (3)');
    flushSync();
    expect(panel()!.querySelector('.volt-popover-title')!.textContent?.trim()).toBe('Filters (3)');
  });

  it('falls back to the label a caller gave, for a panel with no title', () => {
    @Component({
      selector: 'v-page-unnamed',
      imports: [VPopover],
      render: compileTemplate(`
        <v-popover :open="open" label="Filters"><p>Body</p></v-popover>
      `),
    })
    class Unnamed {
      open = new Signal.State(true);
    }

    show(Unnamed);
    expect(panel()!.querySelector('.volt-popover-title')).toBe(null);
    expect(panel()!.getAttribute('aria-labelledby')).toBe(null);
    expect(panel()!.getAttribute('aria-label')).toBe('Filters');
  });

  it('keeps an aria-label the caller wrote on the tag', () => {
    @Component({
      selector: 'v-page-named-outside',
      imports: [VPopover],
      render: compileTemplate(`
        <v-popover :open="open" aria-label="Filters"><p>Body</p></v-popover>
      `),
    })
    class Named {
      open = new Signal.State(true);
    }

    show(Named);
    // The panel is the element `:host` lands on, so a caller naming it the
    // platform way names this. An entry the primitive's bag carries as
    // `undefined` removes an attribute rather than skipping it, and spread
    // over what the caller wrote that is their name gone.
    expect(panel()!.getAttribute('aria-label')).toBe('Filters');
  });
});

/**
 * `title` and `description` are signals, so the heading can arrive or leave
 * while the panel is on screen. The primitive asks the DOM whether one was
 * rendered once per open, which is why the panel's naming is the component's
 * to keep in step.
 */
describe('a title and a description that change while it is open', () => {
  @Component({
    selector: 'v-page-late',
    imports: [VPopover],
    render: compileTemplate(`
      <v-popover :open="open" :title="heading.get()" :description="note.get()" label="Fallback">
        <p>Body</p>
      </v-popover>
    `),
  })
  class Late {
    open = new Signal.State(false);
    heading = new Signal.State<string | undefined>(undefined);
    note = new Signal.State<string | undefined>(undefined);
  }

  it('names the panel when a title arrives, and unnames it when it goes', () => {
    const { instance } = show(Late);
    instance.open.set(true);
    flushSync();
    expect(panel()!.getAttribute('aria-labelledby')).toBe(null);
    expect(panel()!.getAttribute('aria-label')).toBe('Fallback');

    instance.heading.set('Filters');
    flushSync();
    const title = panel()!.querySelector('.volt-popover-title')!;
    expect(title.textContent?.trim()).toBe('Filters');
    expect(panel()!.getAttribute('aria-labelledby')).toBe(title.id);
    // A visible title names the panel for everyone, so the fallback stands down.
    expect(panel()!.getAttribute('aria-label')).toBe(null);

    instance.heading.set(undefined);
    flushSync();
    // A name pointing at a heading that has been removed is worse than no
    // name: the fallback cannot take over while it is still there.
    expect(panel()!.querySelector('.volt-popover-title')).toBe(null);
    expect(panel()!.getAttribute('aria-labelledby')).toBe(null);
    expect(panel()!.getAttribute('aria-label')).toBe('Fallback');
  });

  it('describes the panel when a description arrives, and stops when it goes', () => {
    const { instance } = show(Late);
    instance.open.set(true);
    flushSync();
    expect(panel()!.getAttribute('aria-describedby')).toBe(null);

    instance.note.set('Narrow the list.');
    flushSync();
    const description = panel()!.querySelector('.volt-popover-description')!;
    expect(panel()!.getAttribute('aria-describedby')).toBe(description.id);

    instance.note.set(undefined);
    flushSync();
    expect(panel()!.querySelector('.volt-popover-description')).toBe(null);
    expect(panel()!.getAttribute('aria-describedby')).toBe(null);
  });
});

/**
 * The options the primitive is handed once, while the component's fields
 * initialize. Nothing else in this file reaches them, and wiring nothing
 * reaches is wiring that can be deleted with the suite still green — so each
 * one is asserted through what it does rather than through the call.
 */
describe('the options the primitive is built with', () => {
  it('puts the gap on the side facing the trigger, however it was written', () => {
    @Component({
      selector: 'v-page-gaps',
      imports: [VPopover],
      render: compileTemplate(`
        <v-popover :open="bound" :offset="8"><p>a</p></v-popover>
        <v-popover :open="written" offset="8"><p>b</p></v-popover>
      `),
    })
    class Gaps {
      bound = new Signal.State(false);
      written = new Signal.State(false);
    }

    const { instance } = show(Gaps);
    // Both spellings of one prop, and an attribute is only ever a string: a
    // gap of `8` with no unit is dropped by the CSSOM and never happens.
    for (const which of ['bound', 'written'] as const) {
      instance[which].set(true);
      flushSync();

      // `bottom` is the default placement, so the trigger is above the panel.
      expect(panel()!.style.marginTop).toBe('8px');
      expect(panel()!.style.marginBottom).toBe('0px');
      // What an arrow is drawn as tall as.
      expect(panel()!.getAttribute('style')).toContain('--volt-anchor-offset: 8px');

      instance[which].set(false);
      flushSync();
    }
  });

  it('holds the placement when flip and shift are off', () => {
    @Component({
      selector: 'v-page-held',
      imports: [VPopover],
      render: compileTemplate(`
        <v-popover :open="held" :flip="false" :shift="false"><p>a</p></v-popover>
      `),
    })
    class Held {
      held = new Signal.State(true);
    }

    show(Held);
    // Nothing to try instead is what keeps the arrow over the trigger, and it
    // is the only way to tell from here: no engine reports the side it took.
    expect(panel()!.style.getPropertyValue('position-try-fallbacks')).toBe('');
    expect(panel()!.getAttribute('data-placement')).toBe('bottom');
  });

  it('traps focus when modal, and says so', () => {
    @Component({
      selector: 'v-page-modal',
      imports: [VPopover],
      render: compileTemplate(`
        <v-popover :open="open" :modal="true">
          <button class="first">One</button>
          <button class="last">Two</button>
        </v-popover>
      `),
    })
    class Modal {
      open = new Signal.State(true);
    }

    show(Modal);
    // Claimed only where focus is actually held inside.
    expect(panel()!.getAttribute('aria-modal')).toBe('true');

    const last = panel()!.querySelector<HTMLElement>('.last')!;
    last.focus();
    last.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
    );
    flushSync();

    // Non-modal, Tab past the last thing leaves the panel and closes it on
    // the way out. Trapped, there is nowhere for it to go: the scope watches
    // `focusin` rather than intercepting the key, so what is asserted is where
    // focus ended up, not which element the browser would have chosen next.
    expect(panel()).not.toBe(null);
    expect(panel()!.contains(document.activeElement)).toBe(true);
  });

  it('leaves Escape alone when told not to close on it', () => {
    @Component({
      selector: 'v-page-keeps-escape',
      imports: [VPopover],
      render: compileTemplate(`
        <v-popover :open="open" :closeOnEscape="false"><p>Body</p></v-popover>
      `),
    })
    class Keeps {
      open = new Signal.State(true);
    }

    const { instance } = show(Keeps);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    flushSync();

    expect(instance.open.get()).toBe(true);
    expect(panel()).not.toBe(null);
  });

  it('leaves a press outside alone when told not to close on it', () => {
    @Component({
      selector: 'v-page-keeps-press',
      imports: [VPopover],
      render: compileTemplate(`
        <v-popover :open="open" :closeOnOutsidePointer="false"><p>Body</p></v-popover>
      `),
    })
    class Keeps {
      open = new Signal.State(true);
    }

    const { instance } = show(Keeps);
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    document.body.dispatchEvent(new Event('pointerup', { bubbles: true }));
    flushSync();

    expect(instance.open.get()).toBe(true);
    expect(panel()).not.toBe(null);
  });

  it('refuses an `open` that is not a signal, and says what to write instead', () => {
    @Component({
      selector: 'v-page-bare-open',
      imports: [VPopover],
      render: compileTemplate(`<v-popover open title="Filters"><p>Body</p></v-popover>`),
    })
    class BareOpen {}

    // Markup has no way to write a signal, so this is a boolean the primitive
    // would have kept and called `.get()` on from inside an effect — a
    // TypeError that unmounts the page and names nothing on the tag.
    expect(() => show(BareOpen)).toThrow(/defaultOpen/);
  });
});

describe('the arrow', () => {
  it('points back at the trigger, and says nothing to a reader', () => {
    const { instance } = show(Page);
    instance.open.set(true);
    flushSync();

    expect(arrow()!.parentElement).toBe(panel());
    expect(arrow()!.getAttribute('aria-hidden')).toBe('true');
    expect(arrow()!.getAttribute('data-placement')).toBe('bottom-start');
    // The physical edge the panel is aligned to, which the sheet needs because
    // a portalled panel does not share the trigger's writing direction.
    expect(arrow()!.getAttribute('data-align')).toBe('left');
  });

  it('sits on the side the placement asked for, aligned to a physical edge', () => {
    @Component({
      selector: 'v-page-sides',
      imports: [VPopover],
      render: compileTemplate(`
        <v-popover :open="top" placement="top-end"><p>t</p></v-popover>
        <v-popover :open="right" placement="right-end"><p>r</p></v-popover>
        <v-popover :open="bottom" placement="bottom-start"><p>b</p></v-popover>
        <v-popover :open="left" placement="left"><p>l</p></v-popover>
      `),
    })
    class Sides {
      top = new Signal.State(false);
      right = new Signal.State(false);
      bottom = new Signal.State(false);
      left = new Signal.State(false);
    }

    // One side per rule the sheet has for the arrow, and `left` for the
    // centred case, which has no aligned edge at all.
    const sides = [
      ['top', 'top-end', 'right'],
      ['right', 'right-end', 'bottom'],
      ['bottom', 'bottom-start', 'left'],
      ['left', 'left', null],
    ] as const;

    const { instance } = show(Sides);
    // One at a time: a popover closes when focus lands outside it, and opening
    // the next one moves focus into that one.
    for (const [which, placement, align] of sides) {
      instance[which].set(true);
      flushSync();

      expect(panel()!.getAttribute('data-placement')).toBe(placement);
      expect(arrow()!.getAttribute('data-placement')).toBe(placement);
      expect(arrow()!.getAttribute('data-align')).toBe(align);

      instance[which].set(false);
      flushSync();
    }
  });
});

describe('the keyboard and the pointer', () => {
  it('closes on Escape', () => {
    const { instance } = show(Page);
    instance.open.set(true);
    flushSync();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    flushSync();
    expect(instance.open.get()).toBe(false);
    expect(panel()).toBe(null);
  });

  it('closes on a press outside, and not on one on its own trigger', () => {
    const { instance, host } = show(Page);
    instance.open.set(true);
    flushSync();

    const press = (el: Element): void => {
      el.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      el.dispatchEvent(new Event('pointerup', { bubbles: true }));
    };

    press(trigger(host));
    flushSync();
    // A trigger that counted as outside would close the popover here and open
    // it again on its own click.
    expect(instance.open.get()).toBe(true);

    press(document.body);
    flushSync();
    expect(instance.open.get()).toBe(false);
  });

  it('leaves on Tab beside the trigger, rather than beside the portal', () => {
    const { instance, host } = show(Page);
    // Past the trigger in the page's tab order, and nowhere near where the
    // portal puts the panel.
    const after = document.createElement('button');
    document.body.append(after);

    instance.open.set(true);
    flushSync();
    // Focus went into the panel on open, onto the one thing focusable there.
    const apply = panel()!.querySelector<HTMLElement>('.apply')!;
    expect(document.activeElement).toBe(apply);

    apply.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
    );
    flushSync();

    expect(instance.open.get()).toBe(false);
    expect(document.activeElement).toBe(after);
    expect(trigger(host).getAttribute('aria-expanded')).toBe('false');
  });
});

describe('the primitive', () => {
  it('is reachable through a ref on the tag, for everything this does not offer', () => {
    @Component({
      selector: 'v-page-ref',
      imports: [VPopover],
      render: compileTemplate(`
        <v-popover :ref="tip" placement="top"><p>Body</p></v-popover>
      `),
    })
    class WithRef {
      tip: VPopover | null = null;
    }

    const { instance } = show(WithRef);
    expect(instance.tip?.popover.isOpen()).toBe(false);
    expect(instance.tip?.popover.placement()).toBe('top');

    instance.tip!.popover.open();
    flushSync();
    expect(panel()).not.toBe(null);

    instance.tip!.popover.close();
    flushSync();
    expect(panel()).toBe(null);
  });

  it('tells the caller what it did, through the callback they passed', () => {
    const changes: boolean[] = [];

    @Component({
      selector: 'v-page-told',
      imports: [VPopover],
      render: compileTemplate(`
        <v-popover :onOpenChange="told"><p>Body</p></v-popover>
      `),
    })
    class Told {
      told = (open: boolean): void => void changes.push(open);
    }

    const { host } = show(Told);
    trigger(host).click();
    flushSync();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    flushSync();

    expect(changes).toEqual([true, false]);
  });
});
