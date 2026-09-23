/**
 * `<v-spinner>`, driven the way a page drives it.
 *
 * The delay, the minimum and the announcement timing are `createSpinner`'s and
 * are tested where they live. What is worth asserting here is the shell: that
 * the region is on the page before there is anything to say, that what a
 * caller writes on the tag reaches it, that every state the sheet draws is
 * written onto the elements its rules select on, that the words land inside
 * the region rather than on it, and that every prop forwarded to the primitive
 * does something.
 *
 * Timers are faked throughout, so "waited half a second" is exact rather than
 * flaky, and `Date.now()` moves with them — which is what `minDuration` is
 * measured against.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Component, Signal, flushSync, mount } from '@voltdev/core';
import { compileTemplate } from '@voltdev/core/jit';
import { compileComponents } from './render.js';
import { VSpinner } from '../src/components/spinner.js';

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

function show<T>(component: new () => T): { instance: T; host: HTMLElement } {
  const host = document.createElement('div');
  document.body.append(host);
  const handle = mount(component, host);
  handles.push(handle);
  flushSync();
  return { instance: handle.instance as T, host };
}

/** Settle first — a timer nothing has started yet cannot fire — then run. */
function advance(ms: number): void {
  flushSync();
  vi.advanceTimersByTime(ms);
  flushSync();
}

const region = (host: HTMLElement): HTMLElement => host.querySelector('.volt-spinner')!;
const mark = (host: HTMLElement): HTMLElement => host.querySelector('.volt-spinner-indicator')!;
const words = (host: HTMLElement): HTMLElement | null =>
  host.querySelector('.volt-spinner-label');

describe('v-spinner', () => {
  it('is a live region that is on the page before there is anything to say', () => {
    @Component({
      selector: 'v-page',
      imports: [VSpinner],
      render: compileTemplate(`<v-spinner class="mine" id="save" data-test="row"></v-spinner>`),
    })
    class Page {}

    const { host } = show(Page);

    // `:host` is on the element carrying the role, so a class, an id and a
    // `data-*` written on the tag reach the region itself.
    expect([...region(host).classList].sort()).toEqual(['mine', 'volt-spinner']);
    expect(region(host).id).toBe('save');
    expect(region(host).dataset['test']).toBe('row');

    // Nothing is loading, and the region is here anyway: a region that arrives
    // holding its message announces nothing.
    expect(region(host).getAttribute('role')).toBe('status');
    expect(region(host).getAttribute('aria-live')).toBe('polite');
    expect(region(host).getAttribute('aria-atomic')).toBe('true');
    expect(region(host).getAttribute('data-state')).toBe('idle');
    expect(words(host)).toBeNull();

    // The ring is drawn and not read: it has no accessible name, and the words
    // are what carries the meaning.
    expect(mark(host).getAttribute('aria-hidden')).toBe('true');
    expect(mark(host).getAttribute('data-state')).toBe('idle');

    // A status region is not a control, and the primitive offers it no
    // keyboard: there is nothing here to focus and nothing to press.
    expect(region(host).hasAttribute('tabindex')).toBe(false);
    expect(mark(host).hasAttribute('tabindex')).toBe(false);
  });

  it('draws nothing, and says nothing, until the wait has outlasted the delay', () => {
    @Component({
      selector: 'v-page',
      imports: [VSpinner],
      render: compileTemplate(
        `<v-spinner :loading="busy" label="Loading results"></v-spinner>`,
      ),
    })
    class Page {
      busy = new Signal.State(false);
    }

    const { instance, host } = show(Page);
    const state = (): string | null => region(host).getAttribute('data-state');

    expect(state()).toBe('idle');

    // A prop bound to a signal follows it: the wait is the caller's to turn on.
    instance.busy.set(true);
    advance(499);

    // The delay, which is the whole component: the page is working and there
    // is nothing on screen to flash. Both elements carry the state, because
    // the sheet takes the ring away by its own.
    expect(state()).toBe('delayed');
    expect(mark(host).getAttribute('data-state')).toBe('delayed');
    expect(words(host)).toBeNull();

    advance(1);
    expect(state()).toBe('visible');
    expect(mark(host).getAttribute('data-state')).toBe('visible');
    // The words arrive in a region that has been on the page for half a
    // second, which is the mutation a screen reader announces.
    expect(words(host)?.textContent).toBe('Loading results');

    instance.busy.set(false);
    advance(0);
    expect(state()).toBe('idle');
    expect(mark(host).getAttribute('data-state')).toBe('idle');
    expect(words(host)).toBeNull();
  });

  it('takes the delay and the minimum from the tag, however they were written', () => {
    @Component({
      selector: 'v-page',
      imports: [VSpinner],
      render: compileTemplate(
        `<v-spinner :loading="busy" delay="0" :minDuration="600"></v-spinner>`,
      ),
    })
    class Page {
      busy = new Signal.State(false);
    }

    const { instance, host } = show(Page);
    const state = (): string | null => region(host).getAttribute('data-state');

    // `delay="0"` is the string `'0'` by the time the component has it, which
    // is why both of these are read as numbers rather than passed on.
    instance.busy.set(true);
    advance(0);
    expect(state()).toBe('visible');

    // The delay alone moves the flash rather than removing it. Up, the ring
    // stays up long enough to be read, whatever the response did.
    instance.busy.set(false);
    advance(599);
    expect(state()).toBe('visible');

    advance(1);
    expect(state()).toBe('idle');
  });

  it('refuses a delay that is not a number, while the prop is still what is wrong', () => {
    @Component({
      selector: 'v-page-nonsense',
      imports: [VSpinner],
      render: compileTemplate(`<v-spinner delay="half a second"></v-spinner>`),
    })
    class Nonsense {}

    @Component({
      selector: 'v-page-blank',
      imports: [VSpinner],
      render: compileTemplate(`<v-spinner minDuration=" "></v-spinner>`),
    })
    class Blank {}

    // Passed on, the first is a `NaN` timeout, which fires at once: a spinner
    // that flashes on every response. `Number(' ')` is zero, so the second is
    // the same failure by the spelling that reads like nothing at all.
    expect(() => show(Nonsense)).toThrow(/`delay` on <v-spinner>/);
    expect(() => show(Blank)).toThrow(/`minDuration` on <v-spinner>/);
  });

  it('starts the wait where the caller said it starts', () => {
    @Component({
      selector: 'v-page',
      imports: [VSpinner],
      render: compileTemplate(`<v-spinner :defaultLoading="true"></v-spinner>`),
    })
    class Page {}

    const { host } = show(Page);

    expect(region(host).getAttribute('data-state')).toBe('delayed');
    advance(500);
    expect(region(host).getAttribute('data-state')).toBe('visible');
  });

  it('names the wait, and follows a name bound to a signal', () => {
    @Component({
      selector: 'v-page',
      imports: [VSpinner],
      render: compileTemplate(`<v-spinner :defaultLoading="true" :label="what.get()"></v-spinner>`),
    })
    class Page {
      what = new Signal.State<string | undefined>(undefined);
    }

    const { instance, host } = show(Page);
    advance(500);

    // Unnamed, the primitive's own localised word stands.
    expect(words(host)?.textContent).toBe('Loading…');

    // The primitive reads its labels once, so the name is read here instead:
    // a page that says what it is doing can change what it says.
    instance.what.set('Loading results');
    flushSync();
    expect(words(host)?.textContent).toBe('Loading results');

    instance.what.set('Still loading results');
    flushSync();
    expect(words(host)?.textContent).toBe('Still loading results');
  });

  it('turns an `aria-label` on the tag into the words, rather than a name on the region', () => {
    @Component({
      selector: 'v-page',
      imports: [VSpinner],
      render: compileTemplate(
        `<v-spinner :defaultLoading="true" aria-label="Saving your draft" label="Loading"></v-spinner>`,
      ),
    })
    class Page {}

    const { host } = show(Page);
    advance(500);

    // A name on a live region is announced instead of its contents in some
    // screen readers, so the one spelling that would have silenced the message
    // is the one that writes it.
    expect(region(host).hasAttribute('aria-label')).toBe(false);
    expect(words(host)?.textContent).toBe('Saving your draft');
  });

  it('keeps the other spelling of a name off the region, and puts it on the words', () => {
    @Component({
      selector: 'v-page',
      imports: [VSpinner],
      render: compileTemplate(
        `<span id="what">Saving your draft</span>` +
          `<v-spinner :defaultLoading="true" :aria-labelledby="which.get()"></v-spinner>`,
      ),
    })
    class Page {
      which = new Signal.State<string | undefined>('what');
    }

    const { instance, host } = show(Page);
    advance(500);

    // `aria-labelledby` names a live region exactly as `aria-label` does, and
    // is announced instead of its contents in the same screen readers. Left to
    // fall through to `:host` it lands on the region and takes the whole
    // message with it — the same failure, through the spelling the first one
    // was intercepted to prevent.
    expect(region(host).hasAttribute('aria-labelledby')).toBe(false);
    expect(words(host)?.getAttribute('aria-labelledby')).toBe('what');

    // A signal, so a page that changes what names the wait is followed, and
    // the attribute goes when the name does rather than pointing at nothing.
    instance.which.set('other');
    flushSync();
    expect(words(host)?.getAttribute('aria-labelledby')).toBe('other');

    instance.which.set(undefined);
    flushSync();
    expect(words(host)?.hasAttribute('aria-labelledby')).toBe(false);
  });

  it('refuses a timing that is not a length of time, whatever it parses to', () => {
    @Component({
      selector: 'v-page-endless',
      imports: [VSpinner],
      render: compileTemplate(`<v-spinner delay="Infinity"></v-spinner>`),
    })
    class Endless {}

    @Component({
      selector: 'v-page-backwards',
      imports: [VSpinner],
      render: compileTemplate(`<v-spinner minDuration="-1"></v-spinner>`),
    })
    class Backwards {}

    // Both are numbers and neither is a duration. `setTimeout` takes a `long`,
    // which turns `Infinity` into zero and fires a negative one at once — so a
    // delay that reads as "never show it" and a minimum that reads as nothing
    // at all are both the flash this component exists to prevent, arriving
    // past a check that only asked whether `Number` said `NaN`.
    expect(() => show(Endless)).toThrow(/`delay` on <v-spinner>/);
    expect(() => show(Backwards)).toThrow(/`minDuration` on <v-spinner>/);
  });

  it('writes into a region that has been on the page, rather than one that just arrived', () => {
    @Component({
      selector: 'v-page',
      imports: [VSpinner],
      render: compileTemplate(
        `<v-spinner :defaultLoading="true" delay="0" label="Saving your draft"></v-spinner>`,
      ),
    })
    class Page {}

    const { host } = show(Page);

    // With the delay off, the ring is up in the same mutation that put the
    // region there — and the words are not, because a region and its message
    // arriving together announce nothing. That gate is the whole of what the
    // `region` option buys: without it the primitive has no element to watch,
    // opens at once, and this is green for a spinner that says nothing.
    expect(region(host).getAttribute('data-state')).toBe('visible');
    expect(words(host)).toBeNull();

    advance(49);
    expect(words(host)).toBeNull();

    advance(1);
    expect(words(host)?.textContent).toBe('Saving your draft');
  });

  it('sizes the ring from the tag, and takes the size off again when it goes', () => {
    @Component({
      selector: 'v-page',
      imports: [VSpinner],
      render: compileTemplate(`<v-spinner :size="how.get()"></v-spinner>`),
    })
    class Page {
      how = new Signal.State<'sm' | 'lg' | undefined>('sm');
    }

    const { instance, host } = show(Page);

    // On the ring, which is the thing being sized and the attribute the
    // sheet's rules select on. The region has nothing to do with it.
    expect(mark(host).getAttribute('data-size')).toBe('sm');
    expect(region(host).hasAttribute('data-size')).toBe(false);

    instance.how.set('lg');
    flushSync();
    expect(mark(host).getAttribute('data-size')).toBe('lg');

    instance.how.set(undefined);
    flushSync();
    expect(mark(host).hasAttribute('data-size')).toBe(false);
  });

  it('hands the primitive itself to whoever needs more than this offers', () => {
    @Component({
      selector: 'v-page',
      imports: [VSpinner],
      render: compileTemplate(
        `<v-spinner :ref="save" :onLoadingChange="record"></v-spinner>`,
      ),
    })
    class Page {
      save: VSpinner | null = null;
      changes: boolean[] = [];
      record = (loading: boolean): void => void this.changes.push(loading);
    }

    const { instance, host } = show(Page);
    expect(instance.save?.spinner.isLoading()).toBe(false);

    // With no signal of the caller's, this is the way in: the wait is the
    // spinner's own and `setLoading` is what moves it.
    instance.save!.spinner.setLoading(true);
    advance(500);
    expect(region(host).getAttribute('data-state')).toBe('visible');
    expect(instance.save!.spinner.isVisible()).toBe(true);
    expect(instance.changes).toEqual([true]);

    instance.save!.spinner.setLoading(false);
    advance(0);
    expect(region(host).getAttribute('data-state')).toBe('idle');
    expect(instance.changes).toEqual([true, false]);
  });
});
