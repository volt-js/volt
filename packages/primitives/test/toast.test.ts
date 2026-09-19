/**
 * Toast, driven through a real mounted component.
 *
 * What is worth asserting is what a screen reader is told, where focus is and
 * is not moved, and when the clock is allowed to run — a toast that expires
 * while nobody could read it is the failure this primitive exists to avoid.
 *
 * Timers are faked throughout, so "waited five seconds" is exact rather than
 * flaky, and `Date.now()` moves with them — which is what the pause arithmetic
 * is measured against.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compileTemplate } from '@voltdev/core/jit';
import { Component, Signal, flushSync, mount } from '@voltdev/core';
import { createToaster, type Toast, type ToasterOptions } from '../src/toast.ts';
import { createLocaleProvider } from '../src/i18n.ts';

interface Message {
  title: string;
}

let host: HTMLElement;
let mounted: { unmount(): void }[] = [];
/** Read by the component's field initialiser, so each test can vary it. */
let toasterOptions: Omit<ToasterOptions<Message>, 'region'> = {};

@Component({
  selector: 'v-toasts',
  render: compileTemplate(`
    <div>
      <button class="raise" :click="raise()">raise</button>
      <div class="region" :ref="region" :spread="toaster.regionProps()">
        <div class="toast" :for="toast in toaster.visible()" :key="toast.id"
             :spread="toaster.toastProps(toast)">
          <span class="title">{ toast.data().title }</span>
          <button class="close" :spread="toaster.closeProps()" :click="toast.dismiss()">close</button>
        </div>
      </div>
      <span class="queued">{ toaster.queued().length }</span>
    </div>
  `),
})
class Toasts {
  region = new Signal.State<Element | null>(null);
  toaster = createToaster<Message>({
    region: () => this.region.get(),
    ...toasterOptions,
  });

  raise() {
    this.toaster.add({ title: 'Saved' });
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '<div id="app"></div>';
  host = document.querySelector('#app')!;
  toasterOptions = {};
});

afterEach(() => {
  for (const handle of mounted) handle.unmount();
  mounted = [];
  flushSync();
  vi.useRealTimers();
  Object.defineProperty(document, 'hidden', { value: false, configurable: true });
});

function setup(options: Omit<ToasterOptions<Message>, 'region'> = {}) {
  toasterOptions = options;
  const handle = mount(Toasts, host);
  mounted.push(handle);
  const instance = handle.instance as Toasts;

  return {
    handle,
    toaster: instance.toaster,
    region: () => host.querySelector('.region')!,
    toasts: () => [...host.querySelectorAll('.toast')] as HTMLElement[],
    titles: () => [...host.querySelectorAll('.title')].map((el) => el.textContent),
    queued: () => host.querySelector('.queued')!.textContent,
    closeButtons: () => [...host.querySelectorAll('.close')] as HTMLElement[],
    raiseButton: () => host.querySelector('.raise') as HTMLElement,
  };
}

/** Settle first — a timer nothing has started yet cannot fire — then run. */
function advance(ms: number) {
  flushSync();
  vi.advanceTimersByTime(ms);
  flushSync();
}

function key(k: string, init: KeyboardEventInit = {}) {
  const target = document.activeElement ?? document;
  target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...init }));
  flushSync();
}

function pointer(el: Element, type: 'pointerenter' | 'pointerleave') {
  el.dispatchEvent(new Event(type));
  flushSync();
}

function setDocumentHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { value: hidden, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
  flushSync();
}

/**
 * Report an exit animation on one toast, the way a browser would: running once
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

describe('the region', () => {
  it('is a labelled region that stays out of the tab order', () => {
    const { region } = setup();
    const el = region();

    expect(el.getAttribute('role')).toBe('region');
    expect(el.getAttribute('aria-label')).toBe('Notifications');
    // Toasts come and go; a tab stop that came and went with them would move
    // every other stop on the page.
    expect(el.getAttribute('tabindex')).toBe('-1');
  });

  it('takes its label from the options, because it will be localised', () => {
    const { region } = setup({ labels: { region: 'Meldungen' } });
    expect(region().getAttribute('aria-label')).toBe('Meldungen');
  });

  it('renders nothing until something is raised', () => {
    const { toasts } = setup();
    expect(toasts()).toHaveLength(0);
  });
});

describe('what a screen reader is told', () => {
  it('announces an ordinary toast politely', () => {
    const { toaster, toasts } = setup();
    toaster.add({ title: 'Saved' });
    flushSync();

    const el = toasts()[0]!;
    expect(el.getAttribute('role')).toBe('status');
    expect(el.getAttribute('aria-live')).toBe('polite');
    // The whole toast is read on every change; half a sentence is worse than
    // a repeat.
    expect(el.getAttribute('aria-atomic')).toBe('true');
    expect(el.getAttribute('data-type')).toBe('info');
  });

  it('interrupts for an error', () => {
    const { toaster, toasts } = setup();
    toaster.add({ title: 'Upload failed' }, { type: 'error' });
    flushSync();

    const el = toasts()[0]!;
    expect(el.getAttribute('role')).toBe('alert');
    expect(el.getAttribute('aria-live')).toBe('assertive');
  });

  it('lets an explicit priority beat the one the type implies', () => {
    const { toaster, toasts } = setup();
    toaster.add({ title: 'Failed quietly' }, { type: 'error', priority: 'polite' });
    toaster.add({ title: 'Look now' }, { type: 'info', priority: 'assertive' });
    flushSync();

    expect(toasts()[0]!.getAttribute('role')).toBe('status');
    expect(toasts()[1]!.getAttribute('role')).toBe('alert');
  });

  it('gives the toast no name of its own', () => {
    const { toaster, toasts } = setup();
    toaster.add({ title: 'Saved' });
    flushSync();

    // A name on a live region is announced *instead of* its contents in some
    // screen readers, which for a toast is the whole message lost.
    const el = toasts()[0]!;
    expect(el.hasAttribute('aria-labelledby')).toBe(false);
    expect(el.hasAttribute('aria-describedby')).toBe(false);
  });

  it('names the close control', () => {
    const { toaster, closeButtons } = setup();
    toaster.add({ title: 'Saved' });
    flushSync();
    expect(closeButtons()[0]!.getAttribute('aria-label')).toBe('Close notification');
  });

  it('lets that name be replaced, because it will be localised', () => {
    const { toaster, closeButtons } = setup({ labels: { close: 'Schließen' } });
    toaster.add({ title: 'Saved' });
    flushSync();
    expect(closeButtons()[0]!.getAttribute('aria-label')).toBe('Schließen');
  });

  it('never moves focus to announce', () => {
    const { toaster, raiseButton } = setup();
    raiseButton().focus();

    toaster.add({ title: 'Saved' }, { type: 'error' });
    flushSync();

    // Announcing by taking focus would interrupt whatever the user was doing.
    expect(document.activeElement).toBe(raiseButton());
  });

  it('names the region and the close control in the language the locale provider speaks', () => {
    @Component({
      selector: 'v-toasts-de',
      render: compileTemplate(`
        <div class="region" :ref="region" :spread="toaster.regionProps()">
          <div class="toast" :for="toast in toaster.visible()" :key="toast.id"
               :spread="toaster.toastProps(toast)">
            <button class="close" :spread="toaster.closeProps()">x</button>
          </div>
        </div>
      `),
    })
    class German {
      locale = createLocaleProvider({
        defaultLocale: 'de-DE',
        messages: { notifications: 'Meldungen', closeNotification: 'Meldung schließen' },
      });
      region = new Signal.State<Element | null>(null);
      toaster = createToaster<Message>({ region: () => this.region.get(), duration: 0 });
    }

    const handle = mount(German, host);
    mounted.push(handle);
    const page = handle.instance as German;
    page.toaster.add({ title: 'Gespeichert' });
    flushSync();

    const region = host.querySelector('.region')!;
    const close = host.querySelector('.close')!;
    expect(region.getAttribute('aria-label')).toBe('Meldungen');
    expect(close.getAttribute('aria-label')).toBe('Meldung schließen');

    page.locale.setMessages({ notifications: 'Hinweise', closeNotification: 'Hinweis schließen' });
    flushSync();
    expect(region.getAttribute('aria-label')).toBe('Hinweise');
    expect(close.getAttribute('aria-label')).toBe('Hinweis schließen');
  });

  it('keeps its own English under a provider with no word for it, and a label over both', () => {
    // Neither key is among the catalogue's defaults, and `t` answers a key it
    // cannot find with the key itself.
    @Component({
      selector: 'v-toasts-de-bare',
      render: compileTemplate(`
        <div class="region" :ref="region" :spread="toaster.regionProps()">
          <div class="toast" :for="toast in toaster.visible()" :key="toast.id"
               :spread="toaster.toastProps(toast)">
            <button class="close" :spread="toaster.closeProps()">x</button>
          </div>
        </div>
      `),
    })
    class Bare {
      locale = createLocaleProvider({
        defaultLocale: 'de-DE',
        messages: { notifications: 'Meldungen', closeNotification: 'Meldung schließen' },
      });
      region = new Signal.State<Element | null>(null);
      toaster = createToaster<Message>({
        region: () => this.region.get(),
        duration: 0,
        labels: { region: 'Hinweise' },
      });
    }

    const handle = mount(Bare, host);
    mounted.push(handle);
    const page = handle.instance as Bare;
    page.toaster.add({ title: 'Gespeichert' });
    flushSync();

    const region = host.querySelector('.region')!;
    const close = host.querySelector('.close')!;
    expect(region.getAttribute('aria-label')).toBe('Hinweise');
    expect(close.getAttribute('aria-label')).toBe('Meldung schließen');

    page.locale.setMessages({});
    flushSync();
    expect(region.getAttribute('aria-label')).toBe('Hinweise');
    expect(close.getAttribute('aria-label')).toBe('Close notification');
  });
});

describe('the queue', () => {
  it('shows up to the maximum and holds the rest back', () => {
    const { toaster, titles, queued } = setup({ max: 2, duration: 0 });
    for (const title of ['one', 'two', 'three', 'four']) toaster.add({ title });
    flushSync();

    // Oldest first, and the newest wait: dropping the oldest to make room
    // would flash messages nobody got to read.
    expect(titles()).toEqual(['one', 'two']);
    expect(queued()).toBe('2');
  });

  it('promotes the next toast when a visible one goes', () => {
    const { toaster, titles } = setup({ max: 2, duration: 0 });
    const first = toaster.add({ title: 'one' });
    toaster.add({ title: 'two' });
    toaster.add({ title: 'three' });
    flushSync();

    toaster.dismiss(first);
    flushSync();
    expect(titles()).toEqual(['two', 'three']);
  });

  it('reports everything live, on screen and waiting alike', () => {
    const { toaster } = setup({ max: 2, duration: 0 });
    for (const title of ['one', 'two', 'three']) toaster.add({ title });
    flushSync();

    expect(toaster.toasts()).toHaveLength(3);
    expect(toaster.visible().map((toast) => toast.data().title)).toEqual(['one', 'two']);
    expect(toaster.queued().map((toast) => toast.data().title)).toEqual(['three']);
  });

  it('does not count down while queued', () => {
    const { toaster, titles } = setup({ max: 1, duration: 1000 });
    toaster.add({ title: 'one' });
    toaster.add({ title: 'two' });
    flushSync();

    advance(999);
    expect(titles()).toEqual(['one']);

    advance(2);
    // The second toast starts its life now, not a second ago.
    expect(titles()).toEqual(['two']);

    advance(999);
    expect(titles()).toEqual(['two']);
    advance(2);
    expect(titles()).toEqual([]);
  });
});

describe('the clock', () => {
  it('dismisses a toast after its duration', () => {
    const { toaster, toasts } = setup({ duration: 4000 });
    toaster.add({ title: 'Saved' });
    flushSync();

    advance(3999);
    expect(toasts()).toHaveLength(1);
    advance(2);
    expect(toasts()).toHaveLength(0);
  });

  it('honours a per-toast duration', () => {
    const { toaster, titles } = setup({ duration: 4000 });
    toaster.add({ title: 'brief' }, { duration: 1000 });
    toaster.add({ title: 'long' });
    flushSync();

    advance(1001);
    expect(titles()).toEqual(['long']);
  });

  it('stays up for ever when the duration is zero', () => {
    const { toaster, toasts } = setup();
    toaster.add({ title: 'Undo?' }, { duration: 0 });
    flushSync();

    // A toast carrying an action cannot time out mid-reach.
    advance(60_000);
    expect(toasts()).toHaveLength(1);
  });

  it('stays up for ever when the duration is infinite', () => {
    const { toaster, toasts } = setup();
    toaster.add({ title: 'Uploading…' }, { duration: Infinity });
    flushSync();

    advance(60_000);
    expect(toasts()).toHaveLength(1);
  });

  it('says why a toast went', () => {
    const onDismiss = vi.fn();
    const { toaster } = setup({ duration: 1000, onDismiss });

    const byClock = toaster.add({ title: 'one' });
    advance(1001);
    expect(onDismiss).toHaveBeenLastCalledWith(expect.objectContaining({ id: byClock }), 'timeout');

    const byHand = toaster.add({ title: 'two' });
    flushSync();
    toaster.dismiss(byHand);
    flushSync();
    expect(onDismiss).toHaveBeenLastCalledWith(expect.objectContaining({ id: byHand }), 'api');
  });

  it('reports a dismissal once, however often it is asked for', () => {
    const onDismiss = vi.fn();
    const { toaster } = setup({ duration: 0, onDismiss });
    const id = toaster.add({ title: 'Saved' });
    flushSync();

    toaster.dismiss(id);
    toaster.dismiss(id);
    flushSync();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

describe('pausing', () => {
  it('holds the clock while the pointer is over the region, and keeps what is left', () => {
    const { toaster, toasts, region } = setup({ duration: 5000 });
    toaster.add({ title: 'Saved' });
    flushSync();

    advance(3000);
    pointer(region(), 'pointerenter');

    advance(60_000);
    expect(toasts()).toHaveLength(1);
    expect(toaster.isPaused()).toBe(true);

    pointer(region(), 'pointerleave');
    // Two seconds were left when the pointer arrived, and two seconds are
    // left now — the clock was held, not restarted.
    advance(1900);
    expect(toasts()).toHaveLength(1);
    advance(200);
    expect(toasts()).toHaveLength(0);
  });

  it('holds the clock while the region contains focus', () => {
    const { toaster, toasts, closeButtons, raiseButton } = setup({ duration: 2000 });
    toaster.add({ title: 'Saved' });
    flushSync();

    closeButtons()[0]!.focus();
    advance(60_000);
    expect(toasts()).toHaveLength(1);

    raiseButton().focus();
    advance(2001);
    expect(toasts()).toHaveLength(0);
  });

  it('does not restart the clock when focus moves between toasts', () => {
    const { toaster, toasts, closeButtons } = setup({ duration: 2000 });
    toaster.add({ title: 'one' });
    toaster.add({ title: 'two' });
    flushSync();

    closeButtons()[0]!.focus();
    advance(1500);

    closeButtons()[1]!.focus();
    // Focus never left the region, so nothing resumed in between.
    advance(60_000);
    expect(toasts()).toHaveLength(2);
  });

  it('holds the clock while the document is hidden', () => {
    const { toaster, toasts } = setup({ duration: 2000 });
    toaster.add({ title: 'Saved' });
    flushSync();

    setDocumentHidden(true);
    // A toast that expires in a background tab was never seen.
    advance(60_000);
    expect(toasts()).toHaveLength(1);

    setDocumentHidden(false);
    advance(2001);
    expect(toasts()).toHaveLength(0);
  });

  it('starts paused when the document is already hidden', () => {
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    const { toaster, toasts } = setup({ duration: 1000 });
    toaster.add({ title: 'Saved' });
    flushSync();

    advance(60_000);
    expect(toasts()).toHaveLength(1);
    expect(toaster.isPaused()).toBe(true);
  });

  it('marks the region while it is paused, so CSS can hold a progress bar', () => {
    const { toaster, region } = setup({ duration: 5000 });
    toaster.add({ title: 'Saved' });
    flushSync();
    expect(region().hasAttribute('data-paused')).toBe(false);

    pointer(region(), 'pointerenter');
    expect(region().hasAttribute('data-paused')).toBe(true);

    pointer(region(), 'pointerleave');
    expect(region().hasAttribute('data-paused')).toBe(false);
  });

  it('holds a toast that arrives under a pointer already resting there', () => {
    const { toaster, toasts, region } = setup({ duration: 1000 });
    pointer(region(), 'pointerenter');

    toaster.add({ title: 'Saved' });
    advance(60_000);
    expect(toasts()).toHaveLength(1);
  });

  it('lets go of a focus pause when the toast holding it is dismissed', () => {
    const { toaster, toasts, closeButtons } = setup({ duration: 1000 });
    toaster.add({ title: 'one' });
    flushSync();

    closeButtons()[0]!.focus();
    closeButtons()[0]!.click();
    flushSync();

    // A node removed while focused does not reliably report `focusout`, and a
    // pause stranded that way would hold every later toast open for ever.
    expect(toaster.isPaused()).toBe(false);
    toaster.add({ title: 'two' });
    advance(1001);
    expect(toasts()).toHaveLength(0);
  });
});

describe('addressing a toast by id', () => {
  it('replaces the message and gives the new one its own time', () => {
    const { toaster, titles } = setup({ duration: 2000 });
    const id = toaster.add({ title: 'Saving…' });
    flushSync();

    advance(1500);
    expect(toaster.update(id, { title: 'Saved' })).toBe(true);
    flushSync();
    expect(titles()).toEqual(['Saved']);

    // The countdown starts again: new words need their own reading time.
    advance(1900);
    expect(titles()).toEqual(['Saved']);
    advance(200);
    expect(titles()).toEqual([]);
  });

  it('starts the clock when an update gives a waiting toast a duration', () => {
    const { toaster, titles } = setup();
    // The promise pattern: a toast with no end, which becomes its result.
    const id = toaster.add({ title: 'Uploading…' }, { duration: Infinity });
    advance(60_000);
    expect(titles()).toEqual(['Uploading…']);

    toaster.update(id, { title: 'Uploaded' }, { duration: 4000 });
    advance(3999);
    expect(titles()).toEqual(['Uploaded']);
    advance(2);
    expect(titles()).toEqual([]);
  });

  it('starts the clock for a toast that waited with a zero duration too', () => {
    const { toaster, titles } = setup();
    const id = toaster.add({ title: 'Undo?' }, { duration: 0 });
    advance(60_000);

    toaster.update(id, { title: 'Undone' }, { duration: 1000 });
    advance(1001);
    expect(titles()).toEqual([]);
  });

  it('holds a toast still when an update takes its duration away', () => {
    const { toaster, titles } = setup({ duration: 1000 });
    const id = toaster.add({ title: 'Saving…' });
    advance(500);

    toaster.update(id, { title: 'Undo?' }, { duration: 0 });
    advance(60_000);
    expect(titles()).toEqual(['Undo?']);
  });

  it('does not start the clock of a paused toast that an update gives a duration', () => {
    const { toaster, titles, region } = setup();
    const id = toaster.add({ title: 'Uploading…' }, { duration: Infinity });
    flushSync();
    pointer(region(), 'pointerenter');

    toaster.update(id, { title: 'Uploaded' }, { duration: 1000 });
    advance(60_000);
    expect(titles()).toEqual(['Uploaded']);

    pointer(region(), 'pointerleave');
    advance(1001);
    expect(titles()).toEqual([]);
  });

  it('changes how a toast is announced', () => {
    const { toaster, toasts } = setup({ duration: 0 });
    const id = toaster.add({ title: 'Saving…' });
    flushSync();

    toaster.update(id, { title: 'Failed' }, { type: 'error' });
    flushSync();
    expect(toasts()[0]!.getAttribute('role')).toBe('alert');
    expect(toasts()[0]!.getAttribute('aria-live')).toBe('assertive');
  });

  it('reports an update to a toast that has already gone', () => {
    const { toaster } = setup({ duration: 1000 });
    const id = toaster.add({ title: 'Saving…' });
    advance(1001);

    // The promise behind a toast can settle after the user dismissed it; that
    // is not an error the caller should have to guard.
    expect(toaster.update(id, { title: 'Saved' })).toBe(false);
  });

  it('updates rather than duplicating when the id is already up', () => {
    const { toaster, titles } = setup({ duration: 0 });
    toaster.add({ title: 'Saving…' }, { id: 'save' });
    toaster.add({ title: 'Saved' }, { id: 'save' });
    flushSync();

    expect(titles()).toEqual(['Saved']);
  });

  it('dismisses one, and dismisses all', () => {
    const { toaster, titles } = setup({ duration: 0, max: 5 });
    const first = toaster.add({ title: 'one' });
    toaster.add({ title: 'two' });
    toaster.add({ title: 'three' });
    flushSync();

    toaster.dismiss(first);
    flushSync();
    expect(titles()).toEqual(['two', 'three']);

    toaster.dismissAll();
    flushSync();
    expect(titles()).toEqual([]);
  });

  it('dismisses a toast that is still queued', () => {
    const { toaster, titles } = setup({ max: 1, duration: 0 });
    toaster.add({ title: 'one' });
    const waiting = toaster.add({ title: 'two' });
    flushSync();

    toaster.dismiss(waiting);
    toaster.dismissAll();
    flushSync();
    expect(titles()).toEqual([]);
  });
});

describe('the keyboard', () => {
  it('moves focus to the region on F6 and puts it back on Escape', () => {
    const { toaster, region, raiseButton } = setup({ duration: 0 });
    toaster.add({ title: 'Saved' });
    flushSync();

    raiseButton().focus();
    key('F6');
    // Nothing else on the page links to a toast, so this is the only way in.
    expect(document.activeElement).toBe(region());

    key('Escape');
    expect(document.activeElement).toBe(raiseButton());
  });

  it('holds the clock once the region has focus', () => {
    const { toaster, toasts, raiseButton } = setup({ duration: 2000 });
    toaster.add({ title: 'Saved' });
    flushSync();

    raiseButton().focus();
    key('F6');
    advance(60_000);
    expect(toasts()).toHaveLength(1);
  });

  it('ignores the hotkey when there is nothing to reach', () => {
    const { region, raiseButton } = setup();
    raiseButton().focus();

    key('F6');
    expect(document.activeElement).toBe(raiseButton());
    expect(document.activeElement).not.toBe(region());
  });

  it('leaves a modified hotkey to the browser', () => {
    const { toaster, raiseButton } = setup({ duration: 0 });
    toaster.add({ title: 'Saved' });
    flushSync();

    raiseButton().focus();
    key('F6', { ctrlKey: true });
    expect(document.activeElement).toBe(raiseButton());
  });

  it('takes a hotkey the consumer chose', () => {
    const { toaster, region, raiseButton } = setup({
      duration: 0,
      hotkey: (event) => event.key === 't' && event.altKey,
    });
    toaster.add({ title: 'Saved' });
    flushSync();

    raiseButton().focus();
    key('F6');
    expect(document.activeElement).toBe(raiseButton());

    key('t', { altKey: true });
    expect(document.activeElement).toBe(region());
  });

  it('cannot be shut out by an application key handler', () => {
    const { toaster, region, raiseButton } = setup({ duration: 0 });
    toaster.add({ title: 'Saved' });
    flushSync();

    // Listening in the capture phase is what makes this hold: the only
    // keyboard route to a toast cannot be at the mercy of the page.
    host.addEventListener('keydown', (event) => event.stopPropagation());
    raiseButton().focus();
    key('F6');

    expect(document.activeElement).toBe(region());
  });

  it('moves focus to the region on demand, for a consumer with a button of their own', () => {
    const { toaster, region } = setup({ duration: 0 });
    toaster.add({ title: 'Saved' });
    flushSync();

    toaster.focusRegion();
    flushSync();
    expect(document.activeElement).toBe(region());
    expect(toaster.isPaused()).toBe(true);
  });

  it('leaves Escape alone when focus is outside the region', () => {
    const { toaster, toasts, raiseButton } = setup({ duration: 0 });
    toaster.add({ title: 'Saved' });
    flushSync();

    raiseButton().focus();
    key('Escape');
    // Escape belongs to whatever layer is topmost; a toast region that is not
    // holding focus is not it.
    expect(document.activeElement).toBe(raiseButton());
    expect(toasts()).toHaveLength(1);
  });
});

describe('focus that a leaving toast was holding', () => {
  it('goes to the region while other toasts remain', () => {
    const { toaster, closeButtons, region } = setup({ duration: 0, max: 3 });
    toaster.add({ title: 'one' });
    toaster.add({ title: 'two' });
    flushSync();

    closeButtons()[0]!.focus();
    closeButtons()[0]!.click();
    flushSync();

    // Without this, focus falls to <body> and a keyboard user is dropped at
    // the top of the document.
    expect(document.activeElement).toBe(region());
  });

  it('goes back where the hotkey found it when the last toast goes', () => {
    const { toaster, closeButtons, raiseButton } = setup({ duration: 0 });
    toaster.add({ title: 'one' });
    flushSync();

    raiseButton().focus();
    key('F6');
    closeButtons()[0]!.focus();
    closeButtons()[0]!.click();
    flushSync();

    expect(document.activeElement).toBe(raiseButton());
  });

  it('is left alone when the toast that went was not holding it', () => {
    const { toaster, raiseButton } = setup({ duration: 1000 });
    toaster.add({ title: 'one' });
    flushSync();

    raiseButton().focus();
    advance(1001);
    expect(document.activeElement).toBe(raiseButton());
  });
});

describe('leaving', () => {
  it('keeps a dismissed toast mounted until its animation ends', async () => {
    const { toaster, toasts } = setup({ duration: 0, max: 1 });
    const id = toaster.add({ title: 'one' });
    flushSync();

    const el = toasts()[0]!;
    const exit = pretendAnimating(el);
    toaster.add({ title: 'two' });
    toaster.dismiss(id);
    flushSync();

    // The slot is still taken: a queued toast appearing on top of one that is
    // still on screen is worse than waiting for it to finish.
    expect(toasts()).toEqual([el]);
    expect(el.getAttribute('data-state')).toBe('closed');

    await exit.finish();
    expect(toasts()).toHaveLength(1);
    expect(toasts()[0]!.querySelector('.title')!.textContent).toBe('two');
  });

  it('leaves at once when nothing is animating', () => {
    const { toaster, toasts } = setup({ duration: 0 });
    const id = toaster.add({ title: 'one' });
    flushSync();
    expect(toasts()[0]!.getAttribute('data-state')).toBe('open');

    toaster.dismiss(id);
    flushSync();
    // No waiting for a frame or a timer that would never fire.
    expect(toasts()).toHaveLength(0);
  });

  it('finds its own toast when another element on the page carries that id', async () => {
    // A custom id is the consumer's text, and nothing stops the page using it
    // elsewhere. Looked for by id alone, the element found is the other one,
    // and the toast loses the exit animation it is in the middle of.
    document.body.insertAdjacentHTML('afterbegin', '<div id="upload"></div>');
    const { toaster, toasts } = setup({ duration: 0, max: 1 });
    toaster.add({ title: 'Uploading…' }, { id: 'upload' });
    flushSync();

    const el = toasts()[0]!;
    const exit = pretendAnimating(el);
    toaster.dismiss('upload');
    flushSync();

    expect(toasts()).toEqual([el]);
    expect(el.getAttribute('data-state')).toBe('closed');

    await exit.finish();
    expect(toasts()).toHaveLength(0);
  });

  it('finds its own toast whatever its id holds', async () => {
    // A custom id is the consumer's text and may hold anything: here a line
    // break, which a quoted selector cannot carry even escaped the way a quote
    // is, and quotes as well. Finding the toast must not depend on what the id
    // says, or it would lose its exit animation — or throw — on the way out.
    const id = 'upload\n"Q3 report"';
    const { toaster, toasts } = setup({ duration: 0, max: 1 });
    toaster.add({ title: 'Uploading…' }, { id });
    flushSync();

    const el = toasts()[0]!;
    const exit = pretendAnimating(el);
    toaster.dismiss(id);
    flushSync();

    expect(toasts()).toEqual([el]);
    expect(el.getAttribute('data-state')).toBe('closed');

    await exit.finish();
    expect(toasts()).toHaveLength(0);
  });

  it('brings a toast back when an update lands during its exit', () => {
    const { toaster, toasts, titles } = setup({ duration: 0 });
    const id = toaster.add({ title: 'Saving…' });
    flushSync();

    pretendAnimating(toasts()[0]!);
    toaster.dismiss(id);
    flushSync();

    expect(toaster.update(id, { title: 'Saved' })).toBe(true);
    flushSync();
    expect(titles()).toEqual(['Saved']);
    expect(toasts()[0]!.getAttribute('data-state')).toBe('open');
  });
});

describe('a queue owned from outside', () => {
  it('writes through the supplied signal', () => {
    const queue = new Signal.State<Toast<Message>[]>([]);
    const { toaster, titles } = setup({ toasts: queue, duration: 0 });

    toaster.add({ title: 'one' });
    flushSync();
    expect(queue.get()).toHaveLength(1);
    expect(queue.get()[0]!.data()).toEqual({ title: 'one' });
    expect(titles()).toEqual(['one']);
  });

  it('releases a toast taken out of it by hand', () => {
    const onDismiss = vi.fn();
    const queue = new Signal.State<Toast<Message>[]>([]);
    const { toaster, toasts } = setup({ toasts: queue, duration: 1000, onDismiss });

    toaster.add({ title: 'one' });
    flushSync();

    queue.set([]);
    flushSync();
    expect(toasts()).toHaveLength(0);

    // Its timer went with it, rather than firing into a toast that is gone.
    advance(60_000);
    expect(onDismiss).not.toHaveBeenCalled();
  });
});

describe('teardown', () => {
  it('takes its timers with it', () => {
    const onDismiss = vi.fn();
    const { toaster, handle } = setup({ duration: 1000, onDismiss });
    toaster.add({ title: 'one' });
    flushSync();

    handle.unmount();
    flushSync();

    advance(60_000);
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
