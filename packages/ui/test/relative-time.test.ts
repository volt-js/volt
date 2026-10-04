/**
 * `<v-relative-time>`, driven the way a page drives it.
 *
 * The words, the units and the shared ticker are `createRelativeTime`'s and
 * are tested where it lives. What is left here is what the tag adds — the
 * threshold past which the date replaces the words, the tooltip it keeps or
 * drops, the props it hands the primitive and the ones it refuses — and what
 * it must not lose on the way: the ticker keeping the words true, what a
 * caller writes landing on the `<time>`, the primitive left reachable, and a
 * page a server wrote being claimed rather than redrawn.
 */
import { compileComponents } from './render.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Component, Signal, flushSync, hydrate, mount, type RenderFn } from '@voltdev/core';
import { compile, compileTemplate } from '@voltdev/core/jit';
import * as runtime from '@voltdev/core/runtime';
import * as server from '@voltdev/core/server';
import { renderToStaticMarkup } from '@voltdev/core/server';
import { createLocaleProvider, relativeTimeTickerSize } from '@voltdev/primitives';
import { Window } from 'happy-dom';
import { VRelativeTime } from '../src/components/relative-time.js';
import template from '../src/components/relative-time.html?raw';
import { relativeTimeClasses, relativeTimeStyles } from '../src/sheet/relative-time.js';
import { componentCss } from '../src/stylesheet.js';
import { tokensCss } from '../src/tokens.js';

compileComponents();

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Ten in the morning on a Sunday, UTC: the page's now, unless a test moves it. */
const NOW = Date.UTC(2026, 9, 4, 10, 0, 0);

/** What the primitive writes in `title`, in the reader's own zone. */
const exact = (at: number, locale = 'en'): string =>
  new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeStyle: 'short' }).format(new Date(at));

/** What the stamp says past its threshold: by default the day, without the hour. */
const dated = (at: number, locale = 'en', options: Intl.DateTimeFormatOptions = { dateStyle: 'long' }): string =>
  new Intl.DateTimeFormat(locale, options).format(new Date(at));

/** What `Intl` says for an amount, which differs between engines' data. */
const said = (
  value: number,
  unit: Intl.RelativeTimeFormatUnit,
  options: Intl.RelativeTimeFormatOptions = {},
  locale = 'en',
): string => new Intl.RelativeTimeFormat(locale, { numeric: 'auto', ...options }).format(value, unit);

let unmount: (() => void) | null = null;
let restores: (() => void)[] = [];

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
});

afterEach(() => {
  unmount?.();
  unmount = null;
  flushSync();
  for (let i = restores.length - 1; i >= 0; i--) restores[i]!();
  restores = [];
  vi.restoreAllMocks();
  vi.useRealTimers();
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

/** Let the shared ticker run for a while, and everything it moved settle. */
function wait(ms: number): void {
  vi.advanceTimersByTime(ms);
  flushSync();
}

const stamp = (host: ParentNode): HTMLTimeElement => host.querySelector('time')!;

@Component({
  selector: 'v-page',
  imports: [VRelativeTime],
  render: compileTemplate(`
    <p>Posted
      <v-relative-time
        :ref="stamp"
        :date="at.get()"
        :threshold="threshold.get()"
        :title="title.get()"
        locale="en"
        class="mine"
        id="posted"
        data-kind="comment"
        lang="en"
        aria-label="Posted at"
        aria-describedby="by"
      ></v-relative-time>.
    </p>
    <p id="by">By Ada.</p>
  `),
})
class Page {
  at = new Signal.State<Date | number | string | null | undefined>(new Date(NOW - 3 * MINUTE));
  threshold = new Signal.State<number | string | undefined>(undefined);
  title = new Signal.State<string | null | undefined>(undefined);
  stamp: VRelativeTime | null = null;
}

describe('v-relative-time', () => {
  it('is a <time> reading the words, with the moment in `datetime` and in `title`', () => {
    const { host } = show(Page);
    const time = stamp(host);

    expect(time.tagName).toBe('TIME');
    expect(time.textContent).toBe('3 minutes ago');
    expect(time.getAttribute('datetime')).toBe(new Date(NOW - 3 * MINUTE).toISOString());
    expect(time.getAttribute('title')).toBe(exact(NOW - 3 * MINUTE));
    // The primitive's own, which says what unit the words are counting in.
    expect(time.dataset['unit']).toBe('minute');
  });

  it('keeps the words true on the one shared ticker', () => {
    @Component({
      selector: 'v-thread',
      imports: [VRelativeTime],
      render: compileTemplate(`
        <v-relative-time :date="first" locale="en"></v-relative-time>
        <v-relative-time :date="second" locale="en"></v-relative-time>
      `),
    })
    class Thread {
      first = new Date(NOW - 10 * SECOND);
      second = new Date(NOW - 3 * MINUTE);
    }

    const { host } = show(Thread);
    const [seconds, minutes] = [...host.querySelectorAll('time')];
    expect(seconds!.textContent).toBe(said(-10, 'second'));
    expect(minutes!.textContent).toBe('3 minutes ago');

    // Two stamps, one timer: paced by the stamp counting seconds.
    expect(relativeTimeTickerSize()).toBe(2);
    expect(vi.getTimerCount()).toBe(1);

    wait(SECOND);
    expect(seconds!.textContent).toBe(said(-11, 'second'));

    wait(2 * MINUTE);
    expect(seconds!.textContent).toBe('2 minutes ago');
    expect(minutes!.textContent).toBe('5 minutes ago');
    expect(seconds!.dataset['unit']).toBe('minute');

    // And nothing left running once they are gone.
    unmount?.();
    unmount = null;
    flushSync();
    expect(relativeTimeTickerSize()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops while the tab is hidden, and catches up the moment it is back', () => {
    const { host } = show(Page);
    const visibility = vi.spyOn(document, 'visibilityState', 'get');

    visibility.mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(vi.getTimerCount()).toBe(0);

    // Ten minutes in the background, and nothing woke to count them.
    wait(10 * MINUTE);
    expect(stamp(host).textContent).toBe('3 minutes ago');

    visibility.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    flushSync();
    expect(stamp(host).textContent).toBe('13 minutes ago');
    expect(vi.getTimerCount()).toBe(1);
  });

  it('shows the date past a week, with its hour still a hover away', () => {
    const { instance, host } = show(Page);
    const at = NOW - 8 * DAY;

    instance.at.set(new Date(at));
    flushSync();
    expect(stamp(host).textContent).toBe(dated(at));
    expect(stamp(host).getAttribute('title')).toBe(exact(at));
    expect(stamp(host).getAttribute('title')).not.toBe(stamp(host).textContent);
    // Still a moment a machine can read.
    expect(stamp(host).getAttribute('datetime')).toBe(new Date(at).toISOString());

    // A moment ahead is measured the same way.
    instance.at.set(new Date(NOW + 8 * DAY));
    flushSync();
    expect(stamp(host).textContent).toBe(dated(NOW + 8 * DAY));

    // Inside the week, the words again.
    instance.at.set(new Date(NOW - 6 * DAY));
    flushSync();
    expect(stamp(host).textContent).toBe(said(-6, 'day'));
    expect(stamp(host).getAttribute('title')).toBe(exact(NOW - 6 * DAY));
  });

  it('crosses its threshold on the tick, while it is on screen', () => {
    const { instance, host } = show(Page);
    instance.threshold.set(HOUR);
    instance.at.set(new Date(NOW - 59 * MINUTE));
    flushSync();
    expect(stamp(host).textContent).toBe('59 minutes ago');

    // Nothing but the clock moves.
    wait(2 * MINUTE);
    expect(stamp(host).textContent).toBe(dated(NOW - 59 * MINUTE));
    expect(stamp(host).getAttribute('title')).toBe(exact(NOW - 59 * MINUTE));
  });

  it('crosses back on the tick, for a moment ahead that comes inside the threshold', () => {
    // Showing the date reads nothing the clock moves — no words, no unit — so
    // only the threshold's own read of the tick brings the words back.
    const { instance, host } = show(Page);
    const ahead = NOW + 7 * DAY + MINUTE;
    instance.at.set(new Date(ahead));
    flushSync();
    expect(stamp(host).textContent).toBe(dated(ahead));

    wait(10 * MINUTE);
    expect(instance.stamp!.isAbsolute()).toBe(false);
    expect(stamp(host).textContent).toBe(instance.stamp!.time.text());
    expect(stamp(host).textContent).not.toBe(dated(ahead));
  });

  it('follows a threshold bound to a signal, and reads one written as an attribute', () => {
    const { instance, host } = show(Page);
    const old = NOW - 400 * DAY;
    instance.at.set(new Date(old));

    instance.threshold.set(Number.POSITIVE_INFINITY);
    flushSync();
    expect(stamp(host).textContent).toBe(said(-1, 'year'));

    instance.at.set(new Date(NOW - 3 * MINUTE));
    instance.threshold.set(0);
    flushSync();
    expect(stamp(host).textContent).toBe(dated(NOW - 3 * MINUTE));
    // Always, which is this very moment too.
    instance.at.set(new Date(NOW));
    flushSync();
    expect(stamp(host).textContent).toBe(dated(NOW));

    @Component({
      selector: 'v-hourly',
      imports: [VRelativeTime],
      render: compileTemplate(`<v-relative-time :date="at" threshold="3600000" locale="en"></v-relative-time>`),
    })
    class Hourly {
      at = new Date(NOW - 2 * HOUR);
    }
    unmount?.();
    expect(stamp(show(Hourly).host).textContent).toBe(dated(NOW - 2 * HOUR));
  });

  it('refuses a threshold that is not a distance, rather than keeping the words for ever', () => {
    for (const written of ['1w', '-1', ' ']) {
      @Component({
        selector: 'v-weekly',
        imports: [VRelativeTime],
        render: compileTemplate(
          `<v-relative-time :date="at" threshold="${written}"></v-relative-time>`,
        ),
      })
      class Weekly {
        at = new Date(NOW - 3 * MINUTE);
      }
      expect(() => show(Weekly), written).toThrow(/`threshold` on <v-relative-time> is a distance/);
      unmount?.();
      unmount = null;
    }
  });

  it('takes a caller’s title in place of the moment, and an empty one as none', () => {
    const { instance, host } = show(Page);

    instance.title.set('Edited twice since');
    flushSync();
    expect(stamp(host).getAttribute('title')).toBe('Edited twice since');

    // Theirs whichever the text is, past the threshold too.
    instance.at.set(new Date(NOW - 30 * DAY));
    flushSync();
    expect(stamp(host).getAttribute('title')).toBe('Edited twice since');

    // Empty, or blanks a browser would show as nothing: no tooltip, written as
    // the empty `title` that says so — an absent one would let an ancestor's
    // stand in for it.
    instance.at.set(new Date(NOW - 3 * MINUTE));
    instance.title.set('');
    flushSync();
    expect(stamp(host).getAttribute('title')).toBe('');
    instance.title.set('  ');
    flushSync();
    expect(stamp(host).getAttribute('title')).toBe('');

    // And back to the primitive's when they take theirs away.
    instance.title.set(undefined);
    flushSync();
    expect(stamp(host).getAttribute('title')).toBe(exact(NOW - 3 * MINUTE));
  });

  it('lends a titled link around it none of its tooltip once the caller asks for none', () => {
    // An element with no `title` shows its nearest titled ancestor's, so a
    // stamp inside `<a title="…">` that dropped the attribute would hover with
    // the link's words — a tooltip, which is what `title=""` asked away.
    @Component({
      selector: 'v-linked',
      imports: [VRelativeTime],
      render: compileTemplate(`
        <a href="#c1" title="Open the comment"
          ><v-relative-time :date="at" locale="en" :title="title.get()"></v-relative-time
        ></a>
      `),
    })
    class Linked {
      at = new Date(NOW - 3 * MINUTE);
      title = new Signal.State<string | undefined>('');
    }

    const { instance, host } = show(Linked);
    expect(stamp(host).getAttribute('title')).toBe('');
    instance.title.set('  ');
    flushSync();
    expect(stamp(host).getAttribute('title')).toBe('');
    instance.title.set(undefined);
    flushSync();
    expect(stamp(host).getAttribute('title')).toBe(exact(NOW - 3 * MINUTE));
  });

  it('keeps a `data-unit` the caller wrote, whatever unit the words count in', () => {
    // The primitive writes `data-unit` too. Left to the spread, the caller's
    // would be written over on the first date and taken away with the last.
    @Component({
      selector: 'v-own-unit',
      imports: [VRelativeTime],
      render: compileTemplate(`
        <v-relative-time :date="at.get()" locale="en" data-unit="pinned"></v-relative-time>
        <v-relative-time :date="at.get()" locale="en" :data-unit="unit.get()"></v-relative-time>
      `),
    })
    class OwnUnit {
      at = new Signal.State<Date | null>(new Date(NOW - 3 * MINUTE));
      unit = new Signal.State<string | undefined>('bound');
    }

    const { instance, host } = show(OwnUnit);
    const [written, bound] = [...host.querySelectorAll('time')];
    expect(written!.dataset['unit']).toBe('pinned');
    expect(bound!.dataset['unit']).toBe('bound');
    // The rest of the primitive's attributes still land.
    expect(written!.getAttribute('datetime')).toBe(new Date(NOW - 3 * MINUTE).toISOString());

    wait(2 * HOUR);
    expect(written!.textContent).toBe('2 hours ago');
    expect(written!.dataset['unit']).toBe('pinned');

    // Bound, it follows; taken away, the primitive's unit is back.
    instance.unit.set(undefined);
    flushSync();
    expect(bound!.dataset['unit']).toBe('hour');
    instance.unit.set('again');
    flushSync();
    expect(bound!.dataset['unit']).toBe('again');

    instance.at.set(null);
    flushSync();
    expect(written!.dataset['unit']).toBe('pinned');
    expect(bound!.dataset['unit']).toBe('again');
  });

  it('lands what the caller wrote on the <time>, and keeps it there as the clock moves', () => {
    const { host } = show(Page);
    const time = stamp(host);

    const check = (): void => {
      expect([...time.classList].sort()).toEqual(['mine', 'volt-relative-time']);
      expect(time.id).toBe('posted');
      expect(time.dataset['kind']).toBe('comment');
      expect(time.lang).toBe('en');
      expect(time.getAttribute('aria-label')).toBe('Posted at');
      expect(time.getAttribute('aria-describedby')).toBe('by');
      // On the <time> and nowhere else: there is no wrapper for them to miss.
      expect(host.querySelectorAll('[aria-label], [id="posted"], .mine')).toHaveLength(1);
    };
    check();
    wait(5 * MINUTE);
    expect(time.textContent).toBe('8 minutes ago');
    check();
  });

  it('follows a date bound to a signal, in any of the three shapes it takes', () => {
    const { instance, host } = show(Page);

    instance.at.set(NOW - 2 * HOUR);
    flushSync();
    expect(stamp(host).textContent).toBe('2 hours ago');
    expect(stamp(host).dataset['unit']).toBe('hour');

    instance.at.set(new Date(NOW + 3 * HOUR).toISOString());
    flushSync();
    expect(stamp(host).textContent).toBe('in 3 hours');
    expect(stamp(host).getAttribute('datetime')).toBe(new Date(NOW + 3 * HOUR).toISOString());

    // Not known yet: an empty <time>, claiming no moment and no tooltip.
    instance.at.set(null);
    flushSync();
    expect(stamp(host).textContent).toBe('');
    expect(stamp(host).hasAttribute('datetime')).toBe(false);
    expect(stamp(host).hasAttribute('title')).toBe(false);
    expect(stamp(host).hasAttribute('data-unit')).toBe(false);
    // What the caller wrote stays.
    expect(stamp(host).id).toBe('posted');
  });

  it('says so when a date does not parse, and draws nothing for it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { instance, host } = show(Page);
    expect(warn).not.toHaveBeenCalled();

    instance.at.set('yesterday');
    flushSync();
    expect(stamp(host).textContent).toBe('');
    expect(stamp(host).hasAttribute('datetime')).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toMatch(/given the date `yesterday`, which `Date` cannot read/);

    // A moment not known yet is not a mistake.
    instance.at.set(null);
    flushSync();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('hands the primitive its locale, and writes the date past the threshold in it too', () => {
    @Component({
      selector: 'v-french',
      imports: [VRelativeTime],
      render: compileTemplate(`
        <v-relative-time :date="recent" locale="fr"></v-relative-time>
        <v-relative-time :date="old" locale="fr"></v-relative-time>
      `),
    })
    class French {
      recent = new Date(NOW - 3 * MINUTE);
      old = new Date(NOW - 30 * DAY);
    }

    const [recent, old] = [...show(French).host.querySelectorAll('time')];
    expect(recent!.textContent).toBe(said(-3, 'minute', {}, 'fr'));
    expect(recent!.textContent).not.toBe('3 minutes ago');
    expect(recent!.getAttribute('title')).toBe(exact(NOW - 3 * MINUTE, 'fr'));
    expect(old!.textContent).toBe(dated(NOW - 30 * DAY, 'fr'));
    expect(old!.textContent).not.toBe(dated(NOW - 30 * DAY));
  });

  it('follows a locale bound to a signal, in the words, the date and the tooltip alike', () => {
    @Component({
      selector: 'v-switching',
      imports: [VRelativeTime],
      render: compileTemplate(`
        <v-relative-time :date="recent" :locale="language.get()"></v-relative-time>
        <v-relative-time :date="old" :locale="language.get()"></v-relative-time>
      `),
    })
    class Switching {
      recent = new Date(NOW - 3 * MINUTE);
      old = new Date(NOW - 30 * DAY);
      language = new Signal.State('en');
    }

    const { instance, host } = show(Switching);
    const [recent, old] = [...host.querySelectorAll('time')];
    expect(recent!.textContent).toBe('3 minutes ago');
    expect(old!.textContent).toBe(dated(NOW - 30 * DAY));

    instance.language.set('fr');
    flushSync();
    expect(recent!.textContent).toBe(said(-3, 'minute', {}, 'fr'));
    expect(recent!.getAttribute('title')).toBe(exact(NOW - 3 * MINUTE, 'fr'));
    expect(old!.textContent).toBe(dated(NOW - 30 * DAY, 'fr'));
    expect(old!.getAttribute('title')).toBe(exact(NOW - 30 * DAY, 'fr'));

    // Taken away, the stamp is the provider's again — here the page's.
    instance.language.set('');
    flushSync();
    expect(recent!.textContent).toBe('3 minutes ago');
    expect(old!.textContent).toBe(dated(NOW - 30 * DAY));
  });

  it('follows the provider’s locale where it names none of its own', () => {
    @Component({
      selector: 'v-provided',
      imports: [VRelativeTime],
      render: compileTemplate(`
        <v-relative-time :date="recent"></v-relative-time>
        <v-relative-time :date="old"></v-relative-time>
        <v-relative-time :date="old" locale="fr"></v-relative-time>
      `),
    })
    class Provided {
      locale = createLocaleProvider({ defaultLocale: 'en' });
      recent = new Date(NOW - 3 * MINUTE);
      old = new Date(NOW - 30 * DAY);
    }

    const { instance, host } = show(Provided);
    const [recent, old, own] = [...host.querySelectorAll('time')];
    expect(recent!.textContent).toBe('3 minutes ago');
    expect(old!.textContent).toBe(dated(NOW - 30 * DAY));

    instance.locale.setLocale('de');
    flushSync();
    expect(recent!.textContent).toBe(said(-3, 'minute', {}, 'de'));
    expect(old!.textContent).toBe(dated(NOW - 30 * DAY, 'de'));
    // A stamp with a locale of its own keeps it.
    expect(own!.textContent).toBe(dated(NOW - 30 * DAY, 'fr'));
  });

  it('marks the words with the language they are in, unless the caller says otherwise', () => {
    @Component({
      selector: 'v-languages',
      imports: [VRelativeTime],
      render: compileTemplate(`
        <v-relative-time :date="at"></v-relative-time>
        <v-relative-time :date="at" :locale="language.get()"></v-relative-time>
        <v-relative-time :date="at" locale="fr" lang="fr-CA"></v-relative-time>
      `),
    })
    class Languages {
      at = new Date(NOW - 3 * MINUTE);
      language = new Signal.State('fr');
    }

    const { instance, host } = show(Languages);
    const [page, own, theirs] = [...host.querySelectorAll('time')];
    // The page's language, which the stamp inherits: nothing to say.
    expect(page!.hasAttribute('lang')).toBe(false);
    // French words, read in a French voice rather than spelled out in English.
    expect(own!.getAttribute('lang')).toBe('fr');
    // What the caller wrote wins.
    expect(theirs!.getAttribute('lang')).toBe('fr-CA');

    instance.language.set('de');
    flushSync();
    expect(own!.getAttribute('lang')).toBe('de');
    instance.language.set('');
    flushSync();
    expect(own!.hasAttribute('lang')).toBe(false);
  });

  it('hands the primitive `numeric`: yesterday, or one day ago', () => {
    @Component({
      selector: 'v-numeric',
      imports: [VRelativeTime],
      render: compileTemplate(`
        <v-relative-time :date="at" locale="en"></v-relative-time>
        <v-relative-time :date="at" locale="en" numeric="auto"></v-relative-time>
        <v-relative-time :date="at" locale="en" numeric="always"></v-relative-time>
      `),
    })
    class Numeric {
      at = new Date(NOW - DAY);
    }

    const [plain, auto, always] = [...show(Numeric).host.querySelectorAll('time')];
    expect(plain!.textContent).toBe('yesterday');
    expect(auto!.textContent).toBe('yesterday');
    expect(always!.textContent).toBe(said(-1, 'day', { numeric: 'always' }));
    expect(always!.textContent).not.toBe('yesterday');
  });

  it('follows `numeric` bound to a signal', () => {
    @Component({
      selector: 'v-renumbered',
      imports: [VRelativeTime],
      render: compileTemplate(`<v-relative-time :date="at" locale="en" :numeric="numeric.get()"></v-relative-time>`),
    })
    class Renumbered {
      at = new Date(NOW - DAY);
      numeric = new Signal.State<Intl.RelativeTimeFormatNumeric | undefined>('auto');
    }

    const { instance, host } = show(Renumbered);
    expect(stamp(host).textContent).toBe('yesterday');
    instance.numeric.set('always');
    flushSync();
    expect(stamp(host).textContent).toBe(said(-1, 'day', { numeric: 'always' }));
    instance.numeric.set(undefined);
    flushSync();
    expect(stamp(host).textContent).toBe('yesterday');
  });

  it('hands the primitive `style`, the length of the words', () => {
    @Component({
      selector: 'v-lengths',
      imports: [VRelativeTime],
      render: compileTemplate(`
        <v-relative-time :date="at" locale="en" style="long"></v-relative-time>
        <v-relative-time :date="at" locale="en" style="short"></v-relative-time>
        <v-relative-time :date="at" locale="en" style="narrow"></v-relative-time>
        <v-relative-time :date="at" locale="en" :style="compact"></v-relative-time>
      `),
    })
    class Lengths {
      at = new Date(NOW - 3 * MINUTE);
      compact: Intl.RelativeTimeFormatStyle = 'short';
    }

    const [long, short, narrow, bound] = [...show(Lengths).host.querySelectorAll('time')];
    expect(long!.textContent).toBe('3 minutes ago');
    expect(short!.textContent).toBe(said(-3, 'minute', { style: 'short' }));
    expect(short!.textContent).not.toBe('3 minutes ago');
    expect(narrow!.textContent).toBe(said(-3, 'minute', { style: 'narrow' }));
    // Bound, it is the same prop, and not the element's inline style.
    expect(bound!.textContent).toBe(said(-3, 'minute', { style: 'short' }));
    for (const time of [long, short, narrow, bound]) expect(time!.hasAttribute('style')).toBe(false);
  });

  it('follows `style` bound to a signal', () => {
    @Component({
      selector: 'v-relengthened',
      imports: [VRelativeTime],
      render: compileTemplate(`<v-relative-time :date="at" locale="en" :style="length.get()"></v-relative-time>`),
    })
    class Relengthened {
      at = new Date(NOW - 3 * MINUTE);
      length = new Signal.State<Intl.RelativeTimeFormatStyle | undefined>('long');
    }

    const { instance, host } = show(Relengthened);
    expect(stamp(host).textContent).toBe('3 minutes ago');
    instance.length.set('narrow');
    flushSync();
    expect(stamp(host).textContent).toBe(said(-3, 'minute', { style: 'narrow' }));
    instance.length.set(undefined);
    flushSync();
    expect(stamp(host).textContent).toBe('3 minutes ago');
  });

  it('refuses a locale, `numeric` or `style` bound later that it cannot use, and says which', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    @Component({
      selector: 'v-rebound',
      imports: [VRelativeTime],
      render: compileTemplate(`
        <v-relative-time :date="at" :locale="locale.get()" :numeric="numeric.get()" :style="length.get()"></v-relative-time>
      `),
    })
    class Rebound {
      at = new Date(NOW - 3 * MINUTE);
      locale = new Signal.State('en');
      numeric = new Signal.State('auto');
      length = new Signal.State('long');
    }

    const { instance } = show(Rebound);
    const logged = (): string => errors.mock.calls.flat().map(String).join('\n');

    instance.locale.set('en_GB');
    flushSync();
    expect(logged()).toMatch(/`locale` on <v-relative-time> is a BCP 47 tag/);
    instance.locale.set('en');
    instance.numeric.set('sometimes');
    flushSync();
    expect(logged()).toMatch(/`numeric` on <v-relative-time> is 'auto' or 'always'/);
    instance.numeric.set('auto');
    instance.length.set('tiny');
    flushSync();
    expect(logged()).toMatch(/`style` on <v-relative-time> is how long the words are/);
  });

  it('writes the date past the threshold with `format`, and leaves the tooltip the exact moment', () => {
    @Component({
      selector: 'v-formatted',
      imports: [VRelativeTime],
      render: compileTemplate(`
        <v-relative-time :date="recent" locale="en" :format="medium"></v-relative-time>
        <v-relative-time :date="old" locale="en" :format="medium"></v-relative-time>
      `),
    })
    class Formatted {
      recent = new Date(NOW - 3 * MINUTE);
      old = new Date(NOW - 30 * DAY);
      medium: Intl.DateTimeFormatOptions = { dateStyle: 'medium' };
    }

    const [recent, old] = [...show(Formatted).host.querySelectorAll('time')];
    const medium = { dateStyle: 'medium' } as const;
    expect(old!.textContent).toBe(dated(NOW - 30 * DAY, 'en', medium));
    expect(old!.textContent).not.toBe(dated(NOW - 30 * DAY));
    // A format without the hour takes nothing from the tooltip, on either side
    // of the threshold.
    expect(old!.getAttribute('title')).toBe(exact(NOW - 30 * DAY));
    expect(recent!.getAttribute('title')).toBe(exact(NOW - 3 * MINUTE));
  });

  it('follows a format bound to a signal, and drops a tooltip that would repeat the date', () => {
    @Component({
      selector: 'v-reformatted',
      imports: [VRelativeTime],
      render: compileTemplate(
        `<v-relative-time :date="old" locale="en" :format="shape.get()"></v-relative-time>`,
      ),
    })
    class Reformatted {
      old = new Date(NOW - 30 * DAY);
      shape = new Signal.State<Intl.DateTimeFormatOptions | undefined>(undefined);
    }

    const { instance, host } = show(Reformatted);
    expect(stamp(host).textContent).toBe(dated(NOW - 30 * DAY));
    expect(stamp(host).getAttribute('title')).toBe(exact(NOW - 30 * DAY));

    instance.shape.set({ month: 'numeric', day: 'numeric' });
    flushSync();
    expect(stamp(host).textContent).toBe(dated(NOW - 30 * DAY, 'en', { month: 'numeric', day: 'numeric' }));

    // The date and the hour, which is what the tooltip says already: a hover
    // for it would be a hover for nothing, and the underline goes with it.
    instance.shape.set({ dateStyle: 'long', timeStyle: 'short' });
    flushSync();
    expect(stamp(host).textContent).toBe(exact(NOW - 30 * DAY));
    expect(stamp(host).hasAttribute('title')).toBe(false);

    instance.shape.set(undefined);
    flushSync();
    expect(stamp(host).textContent).toBe(dated(NOW - 30 * DAY));
    expect(stamp(host).getAttribute('title')).toBe(exact(NOW - 30 * DAY));
  });

  it('refuses what the primitive could not use, naming the tag and the prop', () => {
    const cases: [string, RegExp][] = [
      [`numeric="sometimes"`, /`numeric` on <v-relative-time> is 'auto' or 'always'/],
      [`style="color: gray"`, /`style` on <v-relative-time> is how long the words are[\s\S]*not the element’s inline style/],
      [`locale="en_GB"`, /`locale` on <v-relative-time> is a BCP 47 tag/],
      [`format="{ dateStyle: 'medium' }"`, /`format` on <v-relative-time> is an `Intl.DateTimeFormat` options object[\s\S]*Bind it/],
      [`:format="{ dateStyle: 'medium', hour: 'numeric' }"`, /`format` on <v-relative-time> is not something `Intl.DateTimeFormat` takes/],
    ];

    for (const [written, refusal] of cases) {
      @Component({
        selector: 'v-refused',
        imports: [VRelativeTime],
        render: compileTemplate(`<v-relative-time :date="at" ${written}></v-relative-time>`),
      })
      class Refused {
        at = new Date(NOW);
      }
      expect(() => show(Refused), written).toThrow(refusal);
      unmount?.();
      unmount = null;
    }
  });

  it('refuses a `datetime` written on the tag, which is the primitive’s to write from `date`', () => {
    // Refused by Volt only once the stamp is built and on the ticker, so it is
    // built inside a branch: a mount that throws is never handed back, and
    // nothing could take that stamp off the ticker again.
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    @Component({
      selector: 'v-redated',
      imports: [VRelativeTime],
      render: compileTemplate(`
        <template :if="shown.get()">
          <v-relative-time :date="at" datetime="2026-10-04"></v-relative-time>
        </template>
      `),
    })
    class Redated {
      at = new Date(NOW);
      shown = new Signal.State(false);
    }

    const { instance, host } = show(Redated);
    instance.shown.set(true);
    flushSync();
    expect(host.querySelector('time')).toBeNull();
    expect(errors.mock.calls.flat().map(String).join('\n')).toMatch(
      /<v-relative-time> has no prop "datetime"/,
    );

    unmount?.();
    unmount = null;
    flushSync();
    expect(relativeTimeTickerSize()).toBe(0);
  });

  it('hands the primitive itself to whoever needs more than this offers', () => {
    const { instance, host } = show(Page);
    const time = instance.stamp!;

    expect(time).toBeInstanceOf(VRelativeTime);
    expect(time.time.unit()).toBe('minute');
    expect(time.time.value()).toBe(-3);
    expect(time.time.text()).toBe('3 minutes ago');
    expect(time.time.absolute()).toBe(exact(NOW - 3 * MINUTE));
    expect(time.time.date()!.getTime()).toBe(NOW - 3 * MINUTE);
    expect(stamp(host).textContent).toBe(time.time.text());
    expect(time.isAbsolute()).toBe(false);

    // The primitive's words go on past the threshold; the component's switch
    // to the date is its own, and says which it is showing.
    instance.at.set(new Date(NOW - 30 * DAY));
    flushSync();
    expect(time.isAbsolute()).toBe(true);
    expect(time.time.text()).toBe('last month');
    expect(time.text()).toBe(dated(NOW - 30 * DAY));
    expect(stamp(host).textContent).toBe(time.text());
    expect(stamp(host).getAttribute('title')).toBe(time.time.absolute());

    // A moment not known yet is neither: there is no date to show.
    instance.at.set(null);
    flushSync();
    expect(time.isAbsolute()).toBe(false);
  });

  it('takes no focus and answers no key, which a timestamp has no use for', () => {
    const { host } = show(Page);
    const time = stamp(host);

    expect(time.hasAttribute('tabindex')).toBe(false);
    expect(time.tabIndex).toBe(-1);
    expect(time.hasAttribute('role')).toBe(false);
    // Not a live region: a stamp becoming "4 minutes ago" is not news.
    expect(time.hasAttribute('aria-live')).toBe(false);

    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    time.dispatchEvent(event);
    flushSync();
    expect(event.defaultPrevented).toBe(false);
  });
});

describe('v-relative-time and the sheet', () => {
  /** The sheet's own rules in a document, for what has to be measured. */
  function withSheet(into: Document = document): void {
    const style = into.createElement('style');
    style.textContent = `${tokensCss()}\n\n${componentCss(relativeTimeStyles)}`;
    into.head.append(style);
    restores.push(() => style.remove());
  }

  it('writes only classes the sheet declares', () => {
    const { host } = show(Page);
    const declared = new Set<string>(Object.values(relativeTimeClasses));
    const written = [...host.querySelectorAll('*')].flatMap((element) =>
      [...element.classList].filter((name) => name.startsWith('volt-')),
    );
    expect(written).toEqual(['volt-relative-time']);
    for (const name of written) expect(declared, name).toContain(name);
  });

  it('gives every rule something the component draws', () => {
    const selectors = [...relativeTimeStyles.rules, ...relativeTimeStyles.forcedColors].flatMap(
      (rule) => rule.selector.split(',').map((selector) => selector.trim()),
    );
    const unmatched = new Set(selectors);
    const look = (): void => {
      for (const selector of unmatched) if (document.querySelector(selector)) unmatched.delete(selector);
    };

    const { instance } = show(Page);
    look();
    instance.at.set(new Date(NOW - 30 * DAY));
    flushSync();
    look();
    instance.at.set(null);
    flushSync();
    look();

    expect([...unmatched]).toEqual([]);
  });

  it('underlines a stamp with a tooltip in dots, and one without not at all', () => {
    withSheet();
    const { instance, host } = show(Page);
    const decoration = (): [string, string] => {
      const style = getComputedStyle(stamp(host));
      return [
        style.getPropertyValue('text-decoration-line'),
        style.getPropertyValue('text-decoration-style'),
      ];
    };

    expect(decoration()).toEqual(['underline', 'dotted']);
    // Clear of the letters, at whatever size the line around it is.
    expect(getComputedStyle(stamp(host)).getPropertyValue('text-underline-offset')).toBe('0.2em');

    // Past the threshold: the date, with its hour still behind it.
    instance.at.set(new Date(NOW - 30 * DAY));
    flushSync();
    expect(decoration()).toEqual(['underline', 'dotted']);

    // A tooltip asked away is not promised — though the empty `title` that
    // asks it away is there.
    instance.title.set('');
    flushSync();
    expect(stamp(host).getAttribute('title')).toBe('');
    expect(decoration()[0]).not.toBe('underline');

    // A caller's own is promised the same way as the primitive's.
    instance.title.set('Edited twice since');
    flushSync();
    expect(decoration()).toEqual(['underline', 'dotted']);

    // And a stamp with no date has nothing to hover for.
    instance.title.set(undefined);
    instance.at.set(null);
    flushSync();
    expect(decoration()[0]).not.toBe('underline');
  });

  it('keeps the underline once the palette is the user’s', async () => {
    const window = new Window({ settings: { device: { forcedColors: 'active' } } });
    try {
      const forced = window.document as unknown as Document;
      expect(window.matchMedia('(forced-colors: active)').matches).toBe(true);
      withSheet(forced);
      const element = forced.createElement('time');
      element.className = 'volt-relative-time';
      element.setAttribute('title', exact(NOW));
      forced.body.append(element);

      const style = window.getComputedStyle(element as never);
      expect(style.getPropertyValue('text-decoration-line')).toBe('underline');
      expect(style.getPropertyValue('text-decoration-style')).toBe('dotted');
      expect(style.getPropertyValue('text-decoration-color').toLowerCase()).toBe('currentcolor');
    } finally {
      await window.happyDOM.close();
    }
  });
});

/**
 * One source, compiled for both sides, picking at call time.
 *
 * A real build picks one and ships it. A round trip has to run both against
 * the same components, and the only thing that changes between them is which
 * emit the render came from — the server's, which writes bytes, or the
 * hydrating client's, which claims them.
 */
function both(source: string, filename: string): RenderFn {
  const forServer = compile(source, { filename, runtime: '_rt', target: 'server' }).body;
  const forHydrate = compile(source, { filename, runtime: '_rt', target: 'hydrate' }).body;
  const write = (new Function('_rt', forServer) as (rt: unknown) => RenderFn)(server);
  const claim = (new Function('_rt', forHydrate) as (rt: unknown) => RenderFn)(runtime);
  return (ctx, out) =>
    (globalThis as { __VOLT_SERVER__?: boolean }).__VOLT_SERVER__ === true
      ? write(ctx, out)
      : claim(ctx, out);
}

/** The build flag, which the test config compiles to a live read of this global. */
function serverBuild(on: boolean): void {
  (globalThis as { __VOLT_SERVER__?: boolean }).__VOLT_SERVER__ = on;
}

/** The tag as both sides build it, inheriting every prop. */
@Component({ selector: 'v-relative-time', render: both(template, 'v-relative-time'), host: true })
class RoundTripTime extends VRelativeTime {}

@Component({
  selector: 'v-served',
  imports: [RoundTripTime],
  render: both(
    `<p>Posted <v-relative-time :date="at" locale="en" class="mine" id="posted"></v-relative-time>.</p>`,
    'v-served',
  ),
})
class Served {
  at = new Date(NOW - 3 * MINUTE);
}

/**
 * A stamp that becomes the date a minute out, written to the minute — which is
 * what its tooltip says, so it has a tooltip on one side of the threshold and
 * none on the other.
 */
@Component({
  selector: 'v-served-briefly',
  imports: [RoundTripTime],
  render: both(
    `<p>Posted <v-relative-time :date="at" locale="en" threshold="60000" :format="exactly"></v-relative-time>.</p>`,
    'v-served-briefly',
  ),
})
class ServedBriefly {
  at = new Date(NOW - 50 * SECOND);
  exactly: Intl.DateTimeFormatOptions = { dateStyle: 'long', timeStyle: 'short' };
}

/** The bytes a server sends, rendered at the page's now. */
async function printed(page: new () => unknown): Promise<string> {
  serverBuild(true);
  try {
    return (await renderToStaticMarkup(page)).html;
  } finally {
    serverBuild(false);
  }
}

describe('v-relative-time, written by a server and claimed by a browser', () => {
  it('writes the words for the request’s now, on the element a caller’s attributes land on', async () => {
    const html = await printed(Served);
    const [time] = [...html.matchAll(/<time[^>]*>[^<]*<\/time>/g)].map((match) => match[0]);

    expect(time).toContain('class="volt-relative-time mine"');
    expect(time).toContain('id="posted"');
    expect(time).toContain(`datetime="${new Date(NOW - 3 * MINUTE).toISOString()}"`);
    expect(time).toContain('data-unit="minute"');
    expect(time).toContain(`title="${exact(NOW - 3 * MINUTE)}"`);
    // The language of the words it was given, written with them.
    expect(time).toContain('lang="en"');
    expect(time).toMatch(/>3 minutes ago<\/time>$/);
    // Nothing left running on the server once the request is done with it.
    expect(relativeTimeTickerSize()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rewrites the words for the browser’s now, in the nodes the server wrote, and reports nothing', async () => {
    const host = document.createElement('div');
    host.innerHTML = await printed(Served);
    document.body.append(host);
    const time = stamp(host);
    const words = time.firstChild;
    expect(time.textContent).toBe('3 minutes ago');

    // The page arrives, and attaches, two minutes after the server read its clock.
    vi.setSystemTime(NOW + 2 * MINUTE);
    const mismatches: unknown[] = [];
    const stop = runtime.onHydrationMismatch((mismatch) => mismatches.push(mismatch));
    try {
      unmount = hydrate(Served, host).unmount;
      flushSync();
    } finally {
      stop();
    }

    expect(mismatches).toEqual([]);
    // Claimed, not rebuilt: the same element and the same text node, patched.
    expect(stamp(host)).toBe(time);
    expect(time.firstChild).toBe(words);
    expect(time.textContent).toBe('5 minutes ago');
    expect(time.getAttribute('class')).toBe('volt-relative-time mine');
    expect(time.id).toBe('posted');

    // And live from there on, on the browser's ticker.
    wait(MINUTE);
    expect(time.textContent).toBe('6 minutes ago');
  });

  it('takes away a tooltip the server wrote for a stamp that crossed its threshold in transit', async () => {
    const host = document.createElement('div');
    host.innerHTML = await printed(ServedBriefly);
    document.body.append(host);
    const time = stamp(host);
    expect(time.textContent).toBe(said(-50, 'second'));
    expect(time.hasAttribute('title')).toBe(true);

    vi.setSystemTime(NOW + 20 * SECOND);
    const mismatches: unknown[] = [];
    const stop = runtime.onHydrationMismatch((mismatch) => mismatches.push(mismatch));
    try {
      unmount = hydrate(ServedBriefly, host).unmount;
      flushSync();
    } finally {
      stop();
    }

    expect(mismatches).toEqual([]);
    expect(stamp(host)).toBe(time);
    expect(time.textContent).toBe(exact(NOW - 50 * SECOND));
    expect(time.hasAttribute('title')).toBe(false);
  });

  it('writes a caller’s empty `title` and their `data-unit`, and the browser keeps both', async () => {
    @Component({
      selector: 'v-served-plainly',
      imports: [RoundTripTime],
      render: both(
        `<p>Posted <v-relative-time :date="at" locale="en" title="" data-unit="pinned"></v-relative-time>.</p>`,
        'v-served-plainly',
      ),
    })
    class ServedPlainly {
      at = new Date(NOW - 3 * MINUTE);
    }

    const html = await printed(ServedPlainly);
    const [written] = [...html.matchAll(/<time[^>]*>/g)].map((match) => match[0]);
    expect(written).toContain('title=""');
    expect(written).toContain('data-unit="pinned"');
    expect(written).not.toContain('data-unit="minute"');

    const host = document.createElement('div');
    host.innerHTML = html;
    document.body.append(host);
    const time = stamp(host);
    vi.setSystemTime(NOW + 2 * HOUR);
    unmount = hydrate(ServedPlainly, host).unmount;
    flushSync();

    expect(stamp(host)).toBe(time);
    expect(time.textContent).toBe(said(-2, 'hour'));
    expect(time.getAttribute('title')).toBe('');
    expect(time.dataset['unit']).toBe('pinned');
  });
});
