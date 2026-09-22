/**
 * `<v-toaster>`, driven the way a page drives it.
 *
 * The queue, the timers and the announcement are the primitive's, and they are
 * tested there. What is worth asserting here is the seam: that the region the
 * component draws is the one the primitive was given, that `toaster()` reaches
 * it from code with no component around it, that every attribute the sheet's
 * rules select on is written by this markup, and that a caller who binds a
 * prop keeps it live.
 *
 * Timers are faked throughout, so "waited two seconds" is exact rather than
 * flaky, and `Date.now()` moves with them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Component, Signal, flushSync, mount } from '@voltdev/core';
import { compileTemplate } from '@voltdev/core/jit';
import type { Toast, ToastDismissReason } from '@voltdev/primitives';
import { compileComponents } from './render.js';
import { VToaster, toaster, type ToastMessage } from '../src/components/toast.js';

compileComponents();

let handles: { unmount(): void }[] = [];

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  for (const handle of handles) handle.unmount();
  handles = [];
  flushSync();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

function show<T>(component: new () => T): T {
  const host = document.createElement('div');
  document.body.append(host);
  const handle = mount(component, host);
  handles.push(handle);
  flushSync();
  return handle.instance as T;
}

const regions = (): HTMLElement[] => [
  ...document.querySelectorAll<HTMLElement>('.volt-toast-region'),
];
const region = (): HTMLElement => regions()[0]!;
const toasts = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('.volt-toast')];
const titles = (): (string | null)[] =>
  [...document.querySelectorAll('.volt-toast-title')].map((el) => el.textContent);
const buttons = (toast: HTMLElement): HTMLButtonElement[] => [
  ...toast.querySelectorAll<HTMLButtonElement>('.volt-toast-actions button'),
];
const closeButton = (toast: HTMLElement): HTMLButtonElement => buttons(toast).at(-1)!;

/** Settle first — a timer nothing has started yet cannot fire — then run. */
function advance(ms: number): void {
  flushSync();
  vi.advanceTimersByTime(ms);
  flushSync();
}

function key(name: string): void {
  const target = document.activeElement ?? document;
  target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }));
  flushSync();
}

/**
 * Report an exit animation on a toast, the way a browser would: running once
 * the toast is marked closed, and not before. happy-dom has no animation
 * engine to ask, so presence is handed what one would answer.
 */
function pretendAnimating(el: Element): { finish(): Promise<void> } {
  let settle!: () => void;
  const finished = new Promise<void>((resolve) => {
    settle = resolve;
  });
  const animation = {
    playState: 'running',
    finished,
    effect: { getComputedTiming: () => ({ endTime: 200 }) },
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

@Component({
  selector: 'v-page',
  imports: [VToaster],
  render: compileTemplate(`
    <button class="elsewhere">Save</button>
    <v-toaster :ref="tag" :label="name.get()" class="mine" data-corner="end"></v-toaster>
  `),
})
class Page {
  tag: VToaster | null = null;
  name = new Signal.State<string | undefined>(undefined);
}

describe('the region', () => {
  it('is a live region under the body, carrying what the caller wrote on the tag', () => {
    show(Page);
    const el = region();

    // Portalled, because a modal dialog makes every other child of <body>
    // inert and an inert region is never announced.
    expect(el.parentElement).toBe(document.body);
    // `:host` is on the region, so the class joins the sheet's own.
    expect([...el.classList].sort()).toEqual(['mine', 'volt-toast-region']);
    expect(el.dataset['corner']).toBe('end');

    expect(el.getAttribute('role')).toBe('region');
    // Reachable by the hotkey, out of the tab order the rest of the time.
    expect(el.getAttribute('tabindex')).toBe('-1');
    // What a modal dialog looks for when deciding what to leave live.
    expect(el.hasAttribute('data-volt-toaster')).toBe(true);
  });

  it('stays up with nothing in it, so a toast can arrive under a resting pointer', () => {
    show(Page);
    expect(regions()).toHaveLength(1);
    expect(toasts()).toHaveLength(0);
  });

  it('is named by the primitive until the page names it', () => {
    const page = show(Page);
    expect(region().getAttribute('aria-label')).toBe('Notifications');

    // A prop the template reads is a signal, so binding one keeps it live.
    page.name.set('Uploads');
    flushSync();
    expect(region().getAttribute('aria-label')).toBe('Uploads');
  });

  it('keeps that name through a pause, which rewrites the whole bag', () => {
    const page = show(Page);
    page.name.set('Uploads');
    flushSync();

    region().dispatchEvent(new Event('pointerenter'));
    flushSync();

    // The pause attribute is what makes the bag change under a pointer. A name
    // written beside the spread rather than into it would go with it.
    expect(region().getAttribute('data-paused')).toBe('');
    expect(region().getAttribute('aria-label')).toBe('Uploads');
  });

  it('takes an aria-label written on the tag over the prop that says the same', () => {
    @Component({
      selector: 'v-page-named',
      imports: [VToaster],
      render: compileTemplate(`<v-toaster label="Uploads" aria-label="Alerts"></v-toaster>`),
    })
    class Named {}

    show(Named);
    expect(region().getAttribute('aria-label')).toBe('Alerts');

    // And keeps it through a pause. An `aria-label` left to fall through to
    // `:host` is written before the spread and overwritten by it, so a name
    // that is only right until the first pointer is the failure the declared
    // prop exists to prevent — and one an assertion on the first render alone
    // cannot tell from a name that is right.
    region().dispatchEvent(new Event('pointerenter'));
    flushSync();
    expect(region().getAttribute('data-paused')).toBe('');
    expect(region().getAttribute('aria-label')).toBe('Alerts');
  });

  it('is the element the caller’s own id names, with nothing left on a wrapper', () => {
    @Component({
      selector: 'v-page-identified',
      imports: [VToaster],
      render: compileTemplate(`<v-toaster id="notices" class="mine"></v-toaster>`),
    })
    class Identified {}

    show(Identified);
    const el = region();

    // `:host` is on the element carrying the role, so an id written on the tag
    // addresses the region itself — what a stylesheet of the caller's own
    // reaches for, and what a `aria-controls` elsewhere would point at.
    expect(el.id).toBe('notices');
    expect(document.getElementById('notices')).toBe(el);
    expect(el.getAttribute('role')).toBe('region');
    expect(el.classList.contains('mine')).toBe(true);
  });
});

describe('reaching the toaster', () => {
  it('refuses a raise with nothing mounted, and says what to write', () => {
    // A no-op would turn a `<v-toaster>` nobody wrote into a user reporting a
    // save that said nothing.
    expect(() => toaster()).toThrow(/<v-toaster>/);
  });

  it('is the primitive the tag holds, which `:ref` also reaches', () => {
    const page = show(Page);
    expect(toaster()).toBe(page.tag!.toaster);
  });

  it('raises from code with no component around it', () => {
    show(Page);
    toaster().add({ title: 'Project saved' });
    flushSync();

    expect(titles()).toEqual(['Project saved']);
  });

  it('answers with the one mounted last, and with the one before it when that goes', () => {
    const first = show(Page);
    const second = show(Page);
    expect(toaster()).toBe(second.tag!.toaster);

    toaster().add({ title: 'Saved' });
    flushSync();
    expect(regions()[1]!.querySelectorAll('.volt-toast')).toHaveLength(1);
    expect(regions()[0]!.querySelectorAll('.volt-toast')).toHaveLength(0);

    handles.pop()!.unmount();
    flushSync();
    expect(toaster()).toBe(first.tag!.toaster);
  });
});

describe('a toast', () => {
  @Component({
    selector: 'v-page-four',
    imports: [VToaster],
    render: compileTemplate(`<v-toaster :max="4"></v-toaster>`),
  })
  class Four {}

  it('carries the type and the state the sheet draws it by', () => {
    show(Four);
    for (const type of ['info', 'success', 'warning', 'error'] as const) {
      toaster().add({ title: type }, { type });
    }
    flushSync();

    expect(toasts().map((el) => el.getAttribute('data-type'))).toEqual([
      'info',
      'success',
      'warning',
      'error',
    ]);
    for (const el of toasts()) {
      expect(el.className).toBe('volt-toast');
      expect(el.getAttribute('data-state')).toBe('open');
      // What presence finds the element by, and what the animation waits on.
      expect(el.id).not.toBe('');
      expect(el.getAttribute('aria-atomic')).toBe('true');
    }
  });

  it('interrupts for an error and waits its turn for anything else', () => {
    show(Four);
    toaster().add({ title: 'Saved' });
    toaster().add({ title: 'Failed' }, { type: 'error' });
    flushSync();

    const [ordinary, error] = toasts();
    expect(ordinary!.getAttribute('role')).toBe('status');
    expect(ordinary!.getAttribute('aria-live')).toBe('polite');
    expect(error!.getAttribute('role')).toBe('alert');
    expect(error!.getAttribute('aria-live')).toBe('assertive');
  });

  it('draws the second line only where there is one', () => {
    show(Four);
    toaster().add({ title: 'Saved', description: 'Everything since Monday.' });
    toaster().add({ title: 'Saved' });
    flushSync();

    const [described, bare] = toasts();
    expect(described!.querySelector('.volt-toast-description')!.textContent).toBe(
      'Everything since Monday.',
    );
    expect(bare!.querySelector('.volt-toast-description')).toBe(null);
  });

  it('follows the words when the same toast is raised again', () => {
    show(Four);
    const id = toaster().add({ title: 'Uploading' });
    flushSync();
    expect(titles()).toEqual(['Uploading']);

    toaster().update(id, { title: 'Uploaded' }, { type: 'success' });
    flushSync();
    // One toast that became its own result, not a second one under the first.
    expect(titles()).toEqual(['Uploaded']);
    expect(toasts()[0]!.getAttribute('data-type')).toBe('success');
  });
});

describe('the buttons', () => {
  @Component({
    selector: 'v-page-close',
    imports: [VToaster],
    render: compileTemplate(`<v-toaster :closeLabel="word.get()"></v-toaster>`),
  })
  class Closing {
    word = new Signal.State<string | undefined>(undefined);
  }

  it('closes on a press, named by the primitive', () => {
    show(Closing);
    toaster().add({ title: 'Saved' });
    flushSync();

    const close = closeButton(toasts()[0]!);
    expect(close.className).toBe('volt-button');
    expect(close.dataset['variant']).toBe('ghost');
    expect(close.dataset['size']).toBe('sm');
    // The glyph is decoration; the name is the primitive's, and localised.
    expect(close.getAttribute('aria-label')).toBe('Close notification');
    // The glyph is hidden from the tree rather than merely unread: left in it,
    // a screen reader announces the multiplication sign as well as the name,
    // in the middle of the message the toast exists to deliver.
    expect(close.querySelector('[aria-hidden="true"]')?.textContent).toBe('×');
    expect(close.type).toBe('button');

    close.click();
    flushSync();
    expect(toasts()).toHaveLength(0);
  });

  it('follows a close label bound to a signal', () => {
    const page = show(Closing);
    toaster().add({ title: 'Saved' });
    flushSync();

    page.word.set('Dismiss');
    flushSync();
    expect(closeButton(toasts()[0]!).getAttribute('aria-label')).toBe('Dismiss');
  });

  it('draws an action only where the message carries one', () => {
    show(Closing);
    toaster().add({ title: 'Saved' });
    flushSync();
    expect(buttons(toasts()[0]!)).toHaveLength(1);
  });

  it('draws the action as one of the sheet’s own buttons, beside the close', () => {
    show(Closing);
    toaster().add({ title: 'Message deleted', action: { label: 'Undo', onPress: () => {} } });
    flushSync();

    const [action] = buttons(toasts()[0]!);
    // The same chrome as the close it sits beside: the sheet has no rule of
    // its own for either, so a class that drifts leaves an unstyled button in
    // the corner of the screen.
    expect(action!.className).toBe('volt-button');
    expect(action!.dataset['variant']).toBe('ghost');
    expect(action!.dataset['size']).toBe('sm');
    // A toast is portalled out of any form, but a button that does not say so
    // is one submit away from being a submit the day that stops being true.
    expect(action!.type).toBe('button');
  });

  it('leaves out an action whose label is blank, rather than drawing it unnamed', () => {
    show(Closing);
    toaster().add({ title: 'Saved', action: { label: '  ', onPress: () => {} } });
    flushSync();

    // An unnamed button inside a live region is a button a screen reader
    // reaches in the middle of the announcement and can say nothing about.
    // The gap where it should be is what tells the author what they wrote.
    expect(buttons(toasts()[0]!)).toHaveLength(1);
    expect(closeButton(toasts()[0]!).getAttribute('aria-label')).toBe('Close notification');
  });

  it('runs the action and takes the toast down with it', () => {
    show(Closing);
    let undone = 0;
    toaster().add({ title: 'Message deleted', action: { label: 'Undo', onPress: () => undone++ } });
    flushSync();

    const [action, close] = buttons(toasts()[0]!);
    expect(action!.textContent).toBe('Undo');
    expect(close!.getAttribute('aria-label')).toBe('Close notification');

    action!.click();
    flushSync();
    expect(undone).toBe(1);
    // A toast left up with a pressed undo invites a second undo.
    expect(toasts()).toHaveLength(0);
  });

  it('lets the action raise what replaces the toast it was on', () => {
    show(Closing);
    toaster().add(
      {
        title: 'Upload failed',
        action: {
          label: 'Retry',
          onPress: () => toaster().add({ title: 'Uploaded' }, { id: 'upload', type: 'success' }),
        },
      },
      { id: 'upload', type: 'error' },
    );
    flushSync();

    buttons(toasts()[0]!)[0]!.click();
    flushSync();

    // The dismissal runs before the action rather than after it, so the result
    // raised under the same id is not taken down by the press that asked for
    // it.
    expect(titles()).toEqual(['Uploaded']);
    expect(toasts()[0]!.getAttribute('data-type')).toBe('success');
    expect(toasts()[0]!.getAttribute('data-state')).toBe('open');
  });
});

describe('the keyboard the primitive provides', () => {
  it('moves focus to the region on F6 and puts it back on Escape', () => {
    show(Page);
    const elsewhere = document.querySelector<HTMLElement>('.elsewhere')!;
    elsewhere.focus();

    toaster().add({ title: 'Saved' });
    flushSync();

    key('F6');
    expect(document.activeElement).toBe(region());

    key('Escape');
    expect(document.activeElement).toBe(elsewhere);
  });

  it('puts focus back rather than on the body when the last toast is closed', () => {
    show(Page);
    const elsewhere = document.querySelector<HTMLElement>('.elsewhere')!;
    elsewhere.focus();

    toaster().add({ title: 'Saved' });
    flushSync();

    key('F6');
    const close = closeButton(toasts()[0]!);
    close.focus();
    close.click();
    flushSync();

    // The primitive finds the toast that is losing focus by the id on it, and
    // that id is this markup's to spread. Without it focus lands on <body>,
    // and a keyboard user is dropped at the top of the document.
    expect(toasts()).toHaveLength(0);
    expect(document.activeElement).toBe(elsewhere);
  });

  it('takes the key the page asked for instead', () => {
    @Component({
      selector: 'v-page-hotkey',
      imports: [VToaster],
      render: compileTemplate(`
        <button class="elsewhere">Save</button>
        <v-toaster hotkey="F8"></v-toaster>
      `),
    })
    class Hotkey {}

    show(Hotkey);
    document.querySelector<HTMLElement>('.elsewhere')!.focus();
    toaster().add({ title: 'Saved' });
    flushSync();

    key('F6');
    expect(document.activeElement).not.toBe(region());
    key('F8');
    expect(document.activeElement).toBe(region());
  });
});

/**
 * The options the primitive is handed once, while the component's fields
 * initialize. Wiring nothing reaches is wiring that can be deleted with the
 * suite still green, so each is asserted through what it does.
 */
describe('the options the primitive is built with', () => {
  it('shows what `max` allows and queues the rest', () => {
    @Component({
      selector: 'v-page-max',
      imports: [VToaster],
      render: compileTemplate(`<v-toaster max="1"></v-toaster>`),
    })
    class One {}

    show(One);
    toaster().add({ title: 'First' });
    toaster().add({ title: 'Second' });
    flushSync();

    // Written as an attribute, which is only ever a string: `1` compared as
    // text is a count nothing enforces.
    expect(titles()).toEqual(['First']);
    expect(toaster().queued()).toHaveLength(1);
  });

  it('takes a duration written on the tag down to the millisecond', () => {
    @Component({
      selector: 'v-page-duration',
      imports: [VToaster],
      render: compileTemplate(`<v-toaster duration="2000"></v-toaster>`),
    })
    class Brief {}

    show(Brief);
    toaster().add({ title: 'Saved' });
    advance(1999);
    // A string duration is not finite to `Number.isFinite`, which left every
    // toast written this way up for good.
    expect(toasts()).toHaveLength(1);

    advance(1);
    expect(toasts()).toHaveLength(0);
  });

  it('tells the page when a toast goes, and why', () => {
    const seen: [string, ToastDismissReason][] = [];

    @Component({
      selector: 'v-page-dismissed',
      imports: [VToaster],
      render: compileTemplate(`<v-toaster duration="1000" :onDismiss="record"></v-toaster>`),
    })
    class Watched {
      record = (toast: Toast<ToastMessage>, reason: ToastDismissReason): void => {
        seen.push([toast.data().title, reason]);
      };
    }

    show(Watched);
    toaster().add({ title: 'Waited' });
    advance(1000);
    expect(seen).toEqual([['Waited', 'timeout']]);

    toaster().add({ title: 'Pressed' });
    flushSync();
    closeButton(toasts()[0]!).click();
    flushSync();
    expect(seen).toEqual([
      ['Waited', 'timeout'],
      ['Pressed', 'api'],
    ]);
  });

  it('refuses a count that is not a number, while the prop is still what is wrong', () => {
    @Component({
      selector: 'v-page-nonsense',
      imports: [VToaster],
      render: compileTemplate(`<v-toaster max="three"></v-toaster>`),
    })
    class Nonsense {}

    // Passed through, it is a toaster that shows nothing and says why nowhere.
    expect(() => show(Nonsense)).toThrow(/`max` on <v-toaster>/);
  });

  it('refuses an attribute that is nothing but space, which reads as zero', () => {
    @Component({
      selector: 'v-page-blank-max',
      imports: [VToaster],
      render: compileTemplate(`<v-toaster max=" "></v-toaster>`),
    })
    class BlankMax {}

    @Component({
      selector: 'v-page-blank-duration',
      imports: [VToaster],
      render: compileTemplate(`<v-toaster duration="&#9;"></v-toaster>`),
    })
    class BlankDuration {}

    // `Number(' ')` is zero, so these were the two failures the refusal exists
    // to prevent arriving by the one spelling it let past: a toaster whose
    // every toast waits in the queue, and one whose toasts never leave.
    expect(() => show(BlankMax)).toThrow(/`max` on <v-toaster>/);
    expect(() => show(BlankDuration)).toThrow(/`duration` on <v-toaster>/);
  });
});

describe('the words a page draws itself', () => {
  it('replaces them through the slot and keeps the chrome', () => {
    @Component({
      selector: 'v-page-slotted',
      imports: [VToaster],
      render: compileTemplate(`
        <v-toaster>
          <template :slot-toast="{ toast }">
            <b class="ours">{ toast.data().title }!</b>
          </template>
        </v-toaster>
      `),
    })
    class Slotted {}

    show(Slotted);
    toaster().add({ title: 'Saved' }, { type: 'success' });
    flushSync();

    const toast = toasts()[0]!;
    expect(toast.querySelector('.ours')!.textContent).toBe('Saved!');
    expect(toast.querySelector('.volt-toast-title')).toBe(null);
    // The parts that have to be right are still the component's: the live
    // region's own attributes, and a way out of the toast.
    expect(toast.getAttribute('data-type')).toBe('success');
    expect(closeButton(toast).getAttribute('aria-label')).toBe('Close notification');
  });
});

describe('leaving', () => {
  it('stays mounted, marked closed, until the exit animation has finished', async () => {
    show(Page);
    toaster().add({ title: 'Saved' });
    flushSync();

    const exit = pretendAnimating(toasts()[0]!);
    closeButton(toasts()[0]!).click();
    flushSync();

    // Removed on the press, there would be no exit for the sheet to draw.
    expect(toasts()).toHaveLength(1);
    expect(toasts()[0]!.getAttribute('data-state')).toBe('closed');

    await exit.finish();
    expect(toasts()).toHaveLength(0);
  });

  it('takes the region with the tag, so a raise after it says so', () => {
    show(Page);
    handles.pop()!.unmount();
    flushSync();

    expect(regions()).toHaveLength(0);
    expect(() => toaster()).toThrow(/<v-toaster>/);
  });
});
