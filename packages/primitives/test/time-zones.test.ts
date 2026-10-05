/**
 * Time zones: what an instant reads as in one, what a wall time in one is as
 * an instant, and what the pickers post once they are told a zone.
 *
 * Every instant here is fixed, and every expected reading was taken from
 * `Temporal` — run in V8 behind `--harmony-temporal` — rather than worked out
 * by hand, so a failure here is a disagreement with the platform's own answer.
 * The zones are the ones naive code breaks on: New York and London each have a
 * gap and an overlap a year, Kolkata is half an hour off the hour, and Chatham
 * is three quarters of an hour off it, across the date line, with a daylight
 * saving time of its own.
 *
 * The suite at the end compares against the real `Temporal` wherever the
 * runtime has it, and is skipped where it does not:
 * `pnpm exec vitest run packages/primitives/test/time-zones.test.ts --execArgv=--harmony-temporal`
 * runs it on a Node that ships it behind the flag.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compileTemplate } from '@voltdev/core/jit';
import { Component, Signal, createRoot, flushSync, mount } from '@voltdev/core';
import {
  CALENDAR_DAY_ATTRIBUTE,
  createCalendar,
  fromEpochDay,
  instantToZoned,
  toEpochDay,
  toIsoDate,
  today,
  zonedToInstant,
  type Calendar,
  type PlainDateValue,
  type WallTime,
} from '../src/calendar.ts';
import {
  SEGMENT_ATTRIBUTE,
  createDateField,
  createDatePicker,
  createTimePicker,
  type DatePicker,
  type TimePicker,
} from '../src/date-picker.ts';
import { resetAnnouncer } from '../src/announcer.ts';
import { createLocaleProvider, resetLocaleCaches } from '../src/i18n.ts';

const MS_PER_DAY = 86_400_000;
const MS_PER_HOUR = 3_600_000;

let host: HTMLElement;
let mounted: { unmount(): void }[] = [];
let selectors = 0;

beforeEach(() => {
  document.documentElement.removeAttribute('lang');
  document.body.innerHTML = '<div id="app"></div>';
  host = document.querySelector('#app')!;
  resetLocaleCaches();
});

afterEach(() => {
  for (const handle of mounted) handle.unmount();
  mounted = [];
  flushSync();
  resetAnnouncer();
  resetLocaleCaches();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function press(el: Element, key: string, modifiers: Partial<KeyboardEventInit> = {}): void {
  el.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers }),
  );
  flushSync();
}

// ---------------------------------------------------------------------------

describe('an instant, read in a zone', () => {
  it('reads New York an hour closer to UTC in summer than in winter', () => {
    expect(instantToZoned(Date.UTC(2026, 0, 15, 14, 30), 'America/New_York')).toEqual({
      date: { year: 2026, month: 1, day: 15 },
      time: { hour: 9, minute: 30, second: 0 },
      offset: '-05:00',
    });
    expect(instantToZoned(Date.UTC(2026, 6, 4, 16, 0), 'America/New_York')).toEqual({
      date: { year: 2026, month: 7, day: 4 },
      time: { hour: 12, minute: 0, second: 0 },
      offset: '-04:00',
    });
  });

  it('writes a London winter as an offset of zero, not as Z', () => {
    // `Z` says the reading is UTC's own. `+00:00` says it is London's, which
    // happens to agree with UTC for half the year — what `Temporal` writes.
    expect(instantToZoned(Date.UTC(2026, 0, 15, 12, 0), 'Europe/London')).toEqual({
      date: { year: 2026, month: 1, day: 15 },
      time: { hour: 12, minute: 0, second: 0 },
      offset: '+00:00',
    });
    expect(instantToZoned(Date.UTC(2026, 6, 15, 12, 0), 'Europe/London')).toEqual({
      date: { year: 2026, month: 7, day: 15 },
      time: { hour: 13, minute: 0, second: 0 },
      offset: '+01:00',
    });
  });

  it('turns the Kolkata date at half past six UTC, half an hour off the hour', () => {
    expect(instantToZoned(Date.UTC(2026, 7, 11, 18, 29, 59), 'Asia/Kolkata')).toEqual({
      date: { year: 2026, month: 8, day: 11 },
      time: { hour: 23, minute: 59, second: 59 },
      offset: '+05:30',
    });
    expect(instantToZoned(Date.UTC(2026, 7, 11, 18, 30), 'Asia/Kolkata')).toEqual({
      date: { year: 2026, month: 8, day: 12 },
      time: { hour: 0, minute: 0, second: 0 },
      offset: '+05:30',
    });
  });

  it('is already tomorrow in Chatham, three quarters of an hour off and over the date line', () => {
    // 11:15 UTC on the 11th of August is midnight on the 12th there, in its
    // winter; on New Year's Day, in its summer, it is an hour further ahead.
    expect(instantToZoned(Date.UTC(2026, 7, 11, 11, 15), 'Pacific/Chatham')).toEqual({
      date: { year: 2026, month: 8, day: 12 },
      time: { hour: 0, minute: 0, second: 0 },
      offset: '+12:45',
    });
    expect(instantToZoned(Date.UTC(2026, 0, 1), 'Pacific/Chatham')).toEqual({
      date: { year: 2026, month: 1, day: 1 },
      time: { hour: 13, minute: 45, second: 0 },
      offset: '+13:45',
    });
  });

  it('reads both halves of an overlap as one wall time with two offsets', () => {
    // At 02:00 on 1 November 2026 New York's clocks go back to 01:00, so the
    // hour from 01:00 is lived twice: 05:30 and 06:30 UTC are both 01:30.
    const first = instantToZoned(Date.UTC(2026, 10, 1, 5, 30), 'America/New_York');
    const second = instantToZoned(Date.UTC(2026, 10, 1, 6, 30), 'America/New_York');
    expect(first.time).toEqual({ hour: 1, minute: 30, second: 0 });
    expect(second.time).toEqual({ hour: 1, minute: 30, second: 0 });
    expect([first.offset, second.offset]).toEqual(['-04:00', '-05:00']);
  });

  it('drops the milliseconds, flooring them on either side of 1970', () => {
    expect(instantToZoned(Date.UTC(2026, 0, 15, 14, 30, 5) + 999, 'UTC').time).toEqual({
      hour: 14,
      minute: 30,
      second: 5,
    });
    expect(instantToZoned(-1, 'UTC')).toEqual({
      date: { year: 1969, month: 12, day: 31 },
      time: { hour: 23, minute: 59, second: 59 },
      offset: '+00:00',
    });
  });

  it('writes the seconds of an offset that had them, before standard time', () => {
    // Local mean time: New York kept −4:56:02 until November 1883, and
    // Kolkata +5:21:10 in 1900. Rounding either to the minute would name a
    // different instant from the one that was read.
    expect(instantToZoned(Date.UTC(1883, 0, 1), 'America/New_York')).toEqual({
      date: { year: 1882, month: 12, day: 31 },
      time: { hour: 19, minute: 3, second: 58 },
      offset: '-04:56:02',
    });
    expect(instantToZoned(Date.UTC(1900, 0, 1), 'Asia/Kolkata').offset).toBe('+05:21:10');
  });

  it('counts the years before the first as ISO 8601 and Temporal do, through a year zero', () => {
    // `Intl` names them by era — 1 BC, 2 BC — and an era's year runs the
    // other way, which is not a number the arithmetic beside this can use.
    expect(instantToZoned(toEpochDay({ year: 0, month: 1, day: 1 }) * MS_PER_DAY, 'UTC').date).toEqual(
      { year: 0, month: 1, day: 1 },
    );
    expect(
      instantToZoned(toEpochDay({ year: -1, month: 12, day: 31 }) * MS_PER_DAY, 'UTC').date,
    ).toEqual({ year: -1, month: 12, day: 31 });
    // The first instant `Date` can hold, which is also the first `Temporal` can.
    expect(instantToZoned(-8.64e15, 'UTC').date).toEqual({ year: -271821, month: 4, day: 20 });
  });

  it('takes a fixed offset as a zone, as Intl and Temporal both do', () => {
    expect(instantToZoned(0, '+05:30')).toEqual({
      date: { year: 1970, month: 1, day: 1 },
      time: { hour: 5, minute: 30, second: 0 },
      offset: '+05:30',
    });
  });

  it('refuses a zone Intl does not know, and an instant Date cannot hold', () => {
    expect(() => instantToZoned(0, 'Mars/Olympus_Mons')).toThrow(RangeError);
    // An empty name is not the runtime's zone by another spelling: a page that
    // lost its zone somewhere would otherwise read every instant in the wrong
    // one without a word.
    expect(() => instantToZoned(0, '')).toThrow(RangeError);
    expect(() => instantToZoned(Number.NaN, 'UTC')).toThrow(RangeError);
    expect(() => instantToZoned(8.64e15 + 1, 'UTC')).toThrow(RangeError);
  });
});

describe('today, in a zone', () => {
  it('reads the date the zone has reached, not the one the runtime has', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // Noon UTC on New Year's Eve: already 2027 in Chatham, still 2026 in New York.
    vi.setSystemTime(Date.UTC(2026, 11, 31, 12, 0));
    expect(today('Pacific/Chatham')).toEqual({ year: 2027, month: 1, day: 1 });
    expect(today('America/New_York')).toEqual({ year: 2026, month: 12, day: 31 });
  });

  it('refuses an empty zone name, rather than taking it for the runtime’s', () => {
    expect(() => today('')).toThrow(RangeError);
  });
});

describe('a wall time in a zone, as an instant', () => {
  it('gives back the instant each reading came from', () => {
    const readings: [number, string][] = [
      [Date.UTC(2026, 0, 15, 14, 30), 'America/New_York'],
      [Date.UTC(2026, 6, 4, 16, 0), 'America/New_York'],
      [Date.UTC(2026, 0, 15, 12, 0), 'Europe/London'],
      [Date.UTC(2026, 6, 15, 12, 0), 'Europe/London'],
      [Date.UTC(2026, 7, 11, 18, 30), 'Asia/Kolkata'],
      [Date.UTC(2026, 7, 11, 11, 15), 'Pacific/Chatham'],
      [Date.UTC(2026, 0, 1), 'Pacific/Chatham'],
      [Date.UTC(1883, 0, 1), 'America/New_York'],
    ];
    for (const [instant, zone] of readings) {
      const { date, time } = instantToZoned(instant, zone);
      expect(zonedToInstant(date, time, zone)).toBe(instant);
    }
  });

  it('takes a time without seconds as one on the minute', () => {
    expect(zonedToInstant({ year: 2026, month: 8, day: 12 }, { hour: 9, minute: 30 }, 'Asia/Kolkata')).toBe(
      Date.UTC(2026, 7, 12, 4, 0),
    );
  });

  it('moves a time the clocks skip by the length of the gap, as Temporal’s compatible does', () => {
    // At 02:00 on 8 March 2026 New York's clocks go to 03:00, so 02:30 never
    // happens there. The later reading is the one the wall time names under
    // the offset in force before the change: 03:30 by the clock after it.
    expect(zonedToInstant({ year: 2026, month: 3, day: 8 }, { hour: 2, minute: 30 }, 'America/New_York')).toBe(
      Date.UTC(2026, 2, 8, 7, 30),
    );
    // London skips 01:00 to 02:00 on 29 March 2026.
    expect(zonedToInstant({ year: 2026, month: 3, day: 29 }, { hour: 1, minute: 30 }, 'Europe/London')).toBe(
      Date.UTC(2026, 2, 29, 1, 30),
    );
    // Chatham skips 02:45 to 03:45 on 27 September 2026, so 03:00 is 04:00
    // at +13:45.
    expect(zonedToInstant({ year: 2026, month: 9, day: 27 }, { hour: 3, minute: 0 }, 'Pacific/Chatham')).toBe(
      Date.UTC(2026, 8, 26, 14, 15),
    );
    // Lord Howe moves its clocks by half an hour, 02:00 to 02:30 on 4 October
    // 2026, so the gap is thirty minutes long and 02:15 becomes 02:45.
    expect(zonedToInstant({ year: 2026, month: 10, day: 4 }, { hour: 2, minute: 15 }, 'Australia/Lord_Howe')).toBe(
      Date.UTC(2026, 9, 3, 15, 45),
    );
  });

  it('moves a time on a day the zone skipped altogether to the same time the day after', () => {
    // Samoa crossed the date line at the end of 29 December 2011 and went
    // from −10:00 to +14:00: the 30th never happened there, and its noon is
    // the noon of the 31st.
    expect(zonedToInstant({ year: 2011, month: 12, day: 30 }, { hour: 12, minute: 0 }, 'Pacific/Apia')).toBe(
      Date.UTC(2011, 11, 30, 22, 0),
    );
  });

  it('takes the earlier of a time the clocks go through twice, as Temporal does', () => {
    expect(zonedToInstant({ year: 2026, month: 11, day: 1 }, { hour: 1, minute: 30 }, 'America/New_York')).toBe(
      Date.UTC(2026, 10, 1, 5, 30),
    );
    // London goes back from 02:00 to 01:00 on 25 October 2026.
    expect(zonedToInstant({ year: 2026, month: 10, day: 25 }, { hour: 1, minute: 30 }, 'Europe/London')).toBe(
      Date.UTC(2026, 9, 25, 0, 30),
    );
    // Chatham goes back from 03:45 to 02:45 on 5 April 2026: 03:00 at +13:45.
    expect(zonedToInstant({ year: 2026, month: 4, day: 5 }, { hour: 3, minute: 0 }, 'Pacific/Chatham')).toBe(
      Date.UTC(2026, 3, 4, 13, 15),
    );
    // Lord Howe goes back from 02:00 to 01:30 on 5 April 2026: half an hour
    // lived twice, and 01:45 at +11:00 is the first time round.
    expect(zonedToInstant({ year: 2026, month: 4, day: 5 }, { hour: 1, minute: 45 }, 'Australia/Lord_Howe')).toBe(
      Date.UTC(2026, 3, 4, 14, 45),
    );
  });

  it('cannot give back the second of the two, since a wall time does not say which it was', () => {
    const second = Date.UTC(2026, 10, 1, 6, 30);
    const { date, time } = instantToZoned(second, 'America/New_York');
    expect(zonedToInstant(date, time, 'America/New_York')).toBe(second - MS_PER_HOUR);
  });

  it('refuses a date or a time that is not one, rather than rolling it over', () => {
    const at = (date: PlainDateValue, time: WallTime) => () => zonedToInstant(date, time, 'UTC');
    // `Date.UTC` would take each of these and quietly name another instant.
    expect(at({ year: 2026, month: 2, day: 30 }, { hour: 9, minute: 0 })).toThrow(RangeError);
    expect(at({ year: 2026, month: 13, day: 1 }, { hour: 9, minute: 0 })).toThrow(RangeError);
    expect(at({ year: 2026, month: 2, day: 1 }, { hour: 24, minute: 0 })).toThrow(RangeError);
    expect(at({ year: 2026, month: 2, day: 1 }, { hour: 9, minute: 60 })).toThrow(RangeError);
    expect(at({ year: 2026, month: 2, day: 1 }, { hour: 9, minute: 0, second: 60 })).toThrow(RangeError);
    expect(at({ year: 2026, month: 2, day: 1 }, { hour: 9.5, minute: 0 })).toThrow(RangeError);
    expect(() =>
      zonedToInstant({ year: 2026, month: 2, day: 1 }, { hour: 9, minute: 0 }, 'Mars/Olympus_Mons'),
    ).toThrow(RangeError);
    expect(() =>
      zonedToInstant({ year: 2026, month: 2, day: 1 }, { hour: 9, minute: 0 }, ''),
    ).toThrow(RangeError);
  });

  it('asks Intl at most three times for a wall time nowhere near a change', () => {
    const reads = vi.spyOn(Intl.DateTimeFormat.prototype, 'formatToParts');
    zonedToInstant({ year: 2026, month: 8, day: 12 }, { hour: 9, minute: 30 }, 'Pacific/Chatham');
    expect(reads.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it('never reads or writes a Date in the runtime’s own zone', () => {
    const local = [
      'getFullYear',
      'getMonth',
      'getDate',
      'getDay',
      'getHours',
      'getMinutes',
      'getSeconds',
      'getTimezoneOffset',
      'setFullYear',
      'setMonth',
      'setDate',
      'setHours',
      'setMinutes',
      'setSeconds',
      'toLocaleString',
      'toLocaleDateString',
      'toLocaleTimeString',
    ] as const;
    const spies = local.map((name) => vi.spyOn(Date.prototype, name));

    const instant = Date.UTC(2026, 10, 1, 6, 30);
    const { date, time } = instantToZoned(instant, 'America/New_York');
    zonedToInstant(date, time, 'America/New_York');
    zonedToInstant({ year: 2026, month: 3, day: 8 }, { hour: 2, minute: 30 }, 'America/New_York');

    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// The pickers
// ---------------------------------------------------------------------------

const TIME_TEMPLATE = `
  <div class="provider" :ref="provider" :spread="locale.providerProps()">
    <form class="form">
      <div class="field" :ref="field" :spread="t.fieldProps()" :keydown="onKey($event)">
        <span :for="seg in t.segments()" :key="seg.key" class="seg"
              :spread="t.segmentProps(seg)">{ seg.text }</span>
      </div>
      <input class="hidden" :spread="t.hiddenInputProps()">
    </form>
  </div>
`;

interface TimeHarness {
  t: TimePicker;
  root: HTMLElement;
  form(): HTMLFormElement;
  hidden(): HTMLInputElement;
}

function setupTime(options: Record<string, unknown> = {}): TimeHarness {
  @Component({ selector: `v-zoned-time-${++selectors}`, render: compileTemplate(TIME_TEMPLATE) })
  class TimeComponent {
    provider = new Signal.State<Element | null>(null);
    field = new Signal.State<Element | null>(null);
    locale = createLocaleProvider({ defaultLocale: 'en-US', element: () => this.provider.get() });
    t = createTimePicker({ name: 'at', ...options, field: () => this.field.get() } as Parameters<
      typeof createTimePicker
    >[0]);

    onKey(event: KeyboardEvent): void {
      if (this.t.onKeyDown(event)) event.preventDefault();
    }
  }
  const handle = mount(TimeComponent, host);
  mounted.push(handle);
  const box = host.lastElementChild!;
  return {
    t: (handle.instance as unknown as { t: TimePicker }).t,
    root: box.querySelector<HTMLElement>('.field')!,
    form: () => box.querySelector<HTMLFormElement>('.form')!,
    hidden: () => box.querySelector<HTMLInputElement>('.hidden')!,
  };
}

describe('a time picker told a zone', () => {
  it('keeps its value a time of day, and posts the instant it is on the date given', () => {
    const date = new Signal.State<PlainDateValue | null>({ year: 2026, month: 1, day: 15 });
    const time = setupTime({
      timeZone: 'America/New_York',
      date: () => date.get(),
      defaultValue: { hour: 9, minute: 30, second: 0 },
    });

    expect(time.t.value()).toEqual({ hour: 9, minute: 30, second: 0 });
    expect(time.hidden().value).toBe('2026-01-15T09:30:00-05:00');
    expect(new FormData(time.form()).get('at')).toBe('2026-01-15T09:30:00-05:00');

    // The same wall time in July is an hour nearer UTC. The offset belongs to
    // the date, not to the time, which is why the picker has to be given one.
    date.set({ year: 2026, month: 7, day: 15 });
    flushSync();
    expect(time.hidden().value).toBe('2026-07-15T09:30:00-04:00');
    expect(time.t.value()).toEqual({ hour: 9, minute: 30, second: 0 });
  });

  it('writes the offsets of Kolkata and Chatham as they are, not rounded to an hour', () => {
    const on = { year: 2026, month: 8, day: 12 };
    const at = { hour: 9, minute: 30, second: 0 };
    expect(
      setupTime({ timeZone: 'Asia/Kolkata', date: () => on, defaultValue: at }).hidden().value,
    ).toBe('2026-08-12T09:30:00+05:30');
    expect(
      setupTime({ timeZone: 'Pacific/Chatham', date: () => on, defaultValue: at }).hidden().value,
    ).toBe('2026-08-12T09:30:00+12:45');
    expect(
      setupTime({
        timeZone: 'Pacific/Chatham',
        date: () => ({ year: 2026, month: 1, day: 15 }),
        defaultValue: at,
      }).hidden().value,
    ).toBe('2026-01-15T09:30:00+13:45');
  });

  it('posts a time the clocks skip as the instant after the gap, as the clock there reads it', () => {
    const time = setupTime({
      timeZone: 'America/New_York',
      date: () => ({ year: 2026, month: 3, day: 8 }),
      defaultValue: { hour: 2, minute: 30, second: 0 },
    });
    // The value is what was entered. The post is the instant `Temporal`
    // would make of it, written the way a clock in New York showed it.
    expect(time.t.value()).toEqual({ hour: 2, minute: 30, second: 0 });
    expect(time.hidden().value).toBe('2026-03-08T03:30:00-04:00');
  });

  it('posts the first of a time the clocks go through twice', () => {
    const time = setupTime({
      timeZone: 'America/New_York',
      date: () => ({ year: 2026, month: 11, day: 1 }),
      defaultValue: { hour: 1, minute: 30, second: 0 },
    });
    expect(time.hidden().value).toBe('2026-11-01T01:30:00-04:00');
  });

  it('posts nothing while the date is missing, and holds a required form until it is there', () => {
    const date = new Signal.State<PlainDateValue | null>(null);
    const time = setupTime({
      timeZone: 'Europe/London',
      date: () => date.get(),
      required: () => true,
      defaultValue: { hour: 9, minute: 30, second: 0 },
    });
    expect(time.hidden().value).toBe('');
    expect(time.form().checkValidity()).toBe(false);

    date.set({ year: 2026, month: 7, day: 15 });
    flushSync();
    expect(time.hidden().value).toBe('2026-07-15T09:30:00+01:00');
    expect(time.form().checkValidity()).toBe(true);
  });

  it('writes the seconds it shows, and always writes seconds, as RFC 3339 needs', () => {
    const on = () => ({ year: 2026, month: 1, day: 15 });
    expect(
      setupTime({
        timeZone: 'America/New_York',
        date: on,
        granularity: 'second',
        defaultValue: { hour: 9, minute: 30, second: 15 },
      }).hidden().value,
    ).toBe('2026-01-15T09:30:15-05:00');
  });

  it('follows the segments as they are typed', () => {
    const time = setupTime({
      timeZone: 'Asia/Kolkata',
      date: () => ({ year: 2026, month: 8, day: 12 }),
      hourCycle: 'h23',
    });
    time.t.focusSegment('hour');
    for (const digit of '0745') press(time.root, digit);
    expect(time.t.value()).toEqual({ hour: 7, minute: 45, second: 0 });
    expect(time.hidden().value).toBe('2026-08-12T07:45:00+05:30');
  });

  it('posts nothing for a date that is not one, rather than failing to render', () => {
    // The date often comes from outside — a query string, a server — and a
    // page that stops rendering because one arrived malformed is a worse
    // failure than an empty post, which `required` still holds back.
    const time = setupTime({
      timeZone: 'Europe/London',
      date: () => ({ year: 2026, month: 2, day: 30 }),
      required: () => true,
      defaultValue: { hour: 9, minute: 30, second: 0 },
    });
    expect(time.hidden().value).toBe('');
    expect(time.form().checkValidity()).toBe(false);
  });

  it('posts the bare time without a zone, whatever date it is handed', () => {
    const time = setupTime({
      date: () => ({ year: 2026, month: 1, day: 15 }),
      defaultValue: { hour: 9, minute: 30, second: 0 },
    });
    expect(time.hidden().value).toBe('09:30');
  });

  it('refuses a zone without the date the time is on, rather than guessing today', () => {
    expect(() =>
      createTimePicker({ field: () => null, timeZone: 'America/New_York' }),
    ).toThrow(TypeError);
  });

  it('refuses a zone Intl does not know when it is made, not when a time is typed', () => {
    expect(() =>
      createTimePicker({ field: () => null, timeZone: 'Mars/Olympus_Mons', date: () => null }),
    ).toThrow(RangeError);
  });
});

const PICKER_TEMPLATE = `
  <div class="provider" :ref="provider" :spread="locale.providerProps()">
    <form class="form">
      <div class="field" :ref="field" :spread="p.field.fieldProps()" :keydown="onKey($event)">
        <span :for="seg in p.field.segments()" :key="seg.key" class="seg"
              :spread="p.field.segmentProps(seg)">{ seg.text }</span>
      </div>
      <input class="hidden" :spread="p.field.hiddenInputProps()">
    </form>
    <button class="trigger" :spread="p.triggerProps()">open</button>
    <div class="pop" :if="p.isOpen()" :ref="content" :spread="p.contentProps()">
      <div class="cal" :ref="cal" :spread="p.calendar.calendarProps()">
        <div :for="month in p.calendar.months()" :key="month.index">
          <table :spread="p.calendar.gridProps(month.index)">
            <tbody>
              <tr :for="week in month.weeks" :key="week.key" :spread="p.calendar.rowProps()">
                <td class="day" :for="day in week.days" :key="day.key"
                    :spread="p.calendar.dayProps(day)">{ day.date.day }</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
`;

interface PickerHarness {
  p: DatePicker;
  root: HTMLElement;
  hidden(): HTMLInputElement;
}

function setupPicker(options: Record<string, unknown> = {}): PickerHarness {
  @Component({ selector: `v-zoned-picker-${++selectors}`, render: compileTemplate(PICKER_TEMPLATE) })
  class PickerComponent {
    provider = new Signal.State<Element | null>(null);
    field = new Signal.State<Element | null>(null);
    content = new Signal.State<Element | null>(null);
    cal = new Signal.State<Element | null>(null);
    locale = createLocaleProvider({ defaultLocale: 'en-US', element: () => this.provider.get() });
    p = createDatePicker({
      name: 'on',
      ...options,
      field: () => this.field.get(),
      calendar: () => this.cal.get(),
      content: () => this.content.get(),
      trigger: () => host.querySelector('.trigger'),
    } as Parameters<typeof createDatePicker>[0]);

    onKey(event: KeyboardEvent): void {
      if (this.p.onKeyDown(event)) event.preventDefault();
    }
  }
  const handle = mount(PickerComponent, host);
  mounted.push(handle);
  const box = host.lastElementChild!;
  return {
    p: (handle.instance as unknown as { p: DatePicker }).p,
    root: box.querySelector<HTMLElement>('.field')!,
    hidden: () => box.querySelector<HTMLInputElement>('.hidden')!,
  };
}

describe('a date picker told a zone', () => {
  it('keeps its value a date, and posts the instant the day starts at there', () => {
    const picker = setupPicker({
      timeZone: 'Asia/Kolkata',
      defaultValue: { year: 2026, month: 8, day: 12 },
    });
    expect(picker.p.value()).toEqual({ year: 2026, month: 8, day: 12 });
    expect(picker.hidden().value).toBe('2026-08-12T00:00:00+05:30');

    picker.p.setValue({ year: 2026, month: 8, day: 13 });
    flushSync();
    expect(picker.p.value()).toEqual({ year: 2026, month: 8, day: 13 });
    expect(picker.hidden().value).toBe('2026-08-13T00:00:00+05:30');
  });

  it('writes the offset the zone has on that day', () => {
    expect(
      setupPicker({ timeZone: 'Pacific/Chatham', defaultValue: { year: 2026, month: 8, day: 12 } })
        .hidden().value,
    ).toBe('2026-08-12T00:00:00+12:45');
    expect(
      setupPicker({ timeZone: 'Pacific/Chatham', defaultValue: { year: 2026, month: 1, day: 15 } })
        .hidden().value,
    ).toBe('2026-01-15T00:00:00+13:45');
    expect(
      setupPicker({ timeZone: 'America/New_York', defaultValue: { year: 2026, month: 3, day: 8 } })
        .hidden().value,
    ).toBe('2026-03-08T00:00:00-05:00');
  });

  it('starts a day whose midnight the clocks skip at the moment they skip to', () => {
    // Havana's clocks go from 00:00 to 01:00 on 8 March 2026, so that day
    // has no midnight and begins at one o'clock.
    expect(
      setupPicker({ timeZone: 'America/Havana', defaultValue: { year: 2026, month: 3, day: 8 } })
        .hidden().value,
    ).toBe('2026-03-08T01:00:00-04:00');
  });

  it('posts the plain date without a zone, as it always has', () => {
    expect(setupPicker({ defaultValue: { year: 2026, month: 8, day: 12 } }).hidden().value).toBe(
      '2026-08-12',
    );
  });

  it('opens on the day it is there, rather than the day it is where the page runs', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    // Noon UTC on New Year's Eve is already New Year's Day in Chatham, and
    // still the 31st in every zone from London westward.
    vi.setSystemTime(Date.UTC(2026, 11, 31, 12, 0));
    const picker = setupPicker({ timeZone: 'Pacific/Chatham' });

    picker.p.open();
    flushSync();
    expect(picker.p.calendar.focusedDate()).toEqual({ year: 2027, month: 1, day: 1 });
    const marked = host.querySelector<HTMLElement>('.day[aria-current="date"]')!;
    expect(marked.getAttribute(CALENDAR_DAY_ATTRIBUTE)).toBe('2027-01-01');
  });

  it('starts an empty year at the year it is there', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(Date.UTC(2026, 11, 31, 12, 0));
    const picker = setupPicker({ timeZone: 'Pacific/Chatham' });
    picker.p.field.focusSegment('year');
    press(picker.root, 'ArrowUp');
    expect(picker.root.querySelector(`[${SEGMENT_ATTRIBUTE}="year"]`)!.getAttribute('aria-valuenow')).toBe(
      '2027',
    );
  });

  it('lets an explicit today stand over the zone’s', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(Date.UTC(2026, 11, 31, 12, 0));
    const picker = setupPicker({
      timeZone: 'Pacific/Chatham',
      today: () => ({ year: 2026, month: 6, day: 1 }),
    });
    picker.p.open();
    flushSync();
    expect(picker.p.calendar.focusedDate()).toEqual({ year: 2026, month: 6, day: 1 });
  });

  it('refuses a zone Intl does not know when it is made', () => {
    expect(() =>
      createDateField({ field: () => null, timeZone: 'Mars/Olympus_Mons' }),
    ).toThrow(RangeError);
  });
});

describe('a date field told a zone', () => {
  it('posts the instant the day starts at there, as the picker around it does', () => {
    @Component({
      selector: `v-zoned-field-${++selectors}`,
      render: compileTemplate(`
        <div :ref="provider" :spread="locale.providerProps()">
          <div :ref="field" :spread="f.fieldProps()"></div>
          <input class="hidden" :spread="f.hiddenInputProps()">
        </div>
      `),
    })
    class FieldComponent {
      provider = new Signal.State<Element | null>(null);
      field = new Signal.State<Element | null>(null);
      locale = createLocaleProvider({ defaultLocale: 'en-US', element: () => this.provider.get() });
      f = createDateField({
        field: () => this.field.get(),
        timeZone: 'Europe/London',
        defaultValue: { year: 2026, month: 7, day: 15 },
      });
    }
    mounted.push(mount(FieldComponent, host));
    expect(host.querySelector<HTMLInputElement>('.hidden')!.value).toBe('2026-07-15T00:00:00+01:00');
  });
});

const CALENDAR_TEMPLATE = `
  <div :ref="provider" :spread="locale.providerProps()">
    <div class="cal" :ref="root" :spread="cal.calendarProps()" :keydown="onKey($event)">
      <div :for="month in cal.months()" :key="month.index">
        <table :spread="cal.gridProps(month.index)">
          <tbody>
            <tr :for="week in month.weeks" :key="week.key" :spread="cal.rowProps()">
              <td class="day" :for="day in week.days" :key="day.key"
                  :spread="cal.dayProps(day)">{ day.date.day }</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
`;

function setupCalendar(timeZone: string): { cal: Calendar; root: HTMLElement; marked(): string | null } {
  @Component({ selector: `v-zoned-cal-${++selectors}`, render: compileTemplate(CALENDAR_TEMPLATE) })
  class CalendarComponent {
    provider = new Signal.State<Element | null>(null);
    root = new Signal.State<Element | null>(null);
    locale = createLocaleProvider({ defaultLocale: 'en-US', element: () => this.provider.get() });
    cal = createCalendar({ calendar: () => this.root.get(), timeZone });

    onKey(event: KeyboardEvent): void {
      if (this.cal.onKeyDown(event)) event.preventDefault();
    }
  }
  const handle = mount(CalendarComponent, host);
  mounted.push(handle);
  const box = host.lastElementChild!;
  return {
    cal: (handle.instance as unknown as { cal: Calendar }).cal,
    root: box.querySelector<HTMLElement>('.cal')!,
    marked: () =>
      box.querySelector('.day[aria-current="date"]')?.getAttribute(CALENDAR_DAY_ATTRIBUTE) ?? null,
  };
}

describe('a calendar told a zone', () => {
  it('marks today as the zone has it, and moves the mark at the zone’s midnight', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    // Thirty seconds to midnight in Chatham, which is mid-morning in UTC and
    // the afternoon of the 11th across most of Asia.
    vi.setSystemTime(Date.UTC(2026, 7, 11, 11, 14, 30));
    const { marked } = setupCalendar('Pacific/Chatham');
    expect(marked()).toBe('2026-08-11');

    vi.advanceTimersByTime(60_000);
    flushSync();
    expect(marked()).toBe('2026-08-12');
  });

  it('reads the zone’s clock once for the grid, not once for every cell', () => {
    const { root } = setupCalendar('Asia/Kolkata');
    const reads = vi.spyOn(Intl.DateTimeFormat.prototype, 'formatToParts');
    // An arrow press re-runs every cell's bindings; each of them asking the
    // zone what day it is would be forty-odd readings per keystroke.
    press(root, 'ArrowRight');
    expect(reads).not.toHaveBeenCalled();
  });

  it('refuses a zone Intl does not know when it is made, every time it is given one', () => {
    // The second is the one that could slip through: the clock for a zone is
    // shared, and one left half started by the first refusal would hand the
    // second calendar a today nobody read.
    expect(() => createCalendar({ calendar: () => null, timeZone: 'Mars/Olympus_Mons' })).toThrow(
      RangeError,
    );
    expect(() => createCalendar({ calendar: () => null, timeZone: 'Mars/Olympus_Mons' })).toThrow(
      RangeError,
    );
  });
});

// ---------------------------------------------------------------------------
// Agreement with Temporal itself
// ---------------------------------------------------------------------------

interface TemporalLike {
  Instant: {
    fromEpochMilliseconds(ms: number): {
      toZonedDateTimeISO(zone: string): {
        year: number;
        month: number;
        day: number;
        hour: number;
        minute: number;
        second: number;
        offset: string;
      };
    };
  };
  ZonedDateTime: {
    from(fields: Record<string, unknown>): { epochMilliseconds: number };
  };
}

const temporal = (globalThis as { Temporal?: TemporalLike }).Temporal;

describe.runIf(temporal !== undefined)('agreement with Temporal, where the runtime has it', () => {
  // Two more beside the four above: Lord Howe moves its clocks by half an
  // hour, and Santiago and Beirut move theirs at midnight.
  const zones = [
    'America/New_York',
    'Europe/London',
    'Asia/Kolkata',
    'Pacific/Chatham',
    'America/Havana',
    'Australia/Lord_Howe',
    'America/Santiago',
    'Asia/Beirut',
  ];
  const firstDay = toEpochDay({ year: 2026, month: 1, day: 1 });
  const lastDay = toEpochDay({ year: 2027, month: 1, day: 1 });
  const QUARTER = MS_PER_HOUR / 4;

  const theirOffset = (instant: number, zone: string): string =>
    temporal!.Instant.fromEpochMilliseconds(instant).toZonedDateTimeISO(zone).offset;

  /**
   * The days either side of each change of offset in 2026, as epoch days.
   * `Temporal` behind the flag takes a millisecond a reading, which puts every
   * quarter hour of a year out of a test's reach, and the days the clocks
   * change are the days there is anything to get wrong.
   */
  const changeDays = (zone: string): number[] => {
    const days: number[] = [];
    let previous = theirOffset(firstDay * MS_PER_DAY - MS_PER_DAY / 2, zone);
    for (let day = firstDay; day < lastDay; day++) {
      const offset = theirOffset(day * MS_PER_DAY + MS_PER_DAY / 2, zone);
      if (offset !== previous) days.push(day - 1, day, day + 1);
      previous = offset;
    }
    return days;
  };

  /** Noon UTC on every day, and every quarter hour of the days around a change. */
  const instantsToCheck = (zone: string): number[] => {
    const instants: number[] = [];
    for (let day = firstDay; day < lastDay; day++) instants.push(day * MS_PER_DAY + MS_PER_DAY / 2);
    for (const day of changeDays(zone)) {
      for (let quarter = 0; quarter < 96; quarter++) instants.push(day * MS_PER_DAY + quarter * QUARTER);
    }
    return instants;
  };

  // Disagreements are collected and compared once: an assertion per reading
  // costs more than the reading does.
  it('reads the instants around every change in 2026 as Temporal does', { timeout: 120_000 }, () => {
    const disagreements: string[] = [];
    for (const zone of zones) {
      for (const instant of instantsToCheck(zone)) {
        const ours = instantToZoned(instant, zone);
        const theirs = temporal!.Instant.fromEpochMilliseconds(instant).toZonedDateTimeISO(zone);
        const expected = {
          date: { year: theirs.year, month: theirs.month, day: theirs.day },
          time: { hour: theirs.hour, minute: theirs.minute, second: theirs.second },
          offset: theirs.offset,
        };
        if (JSON.stringify(ours) !== JSON.stringify(expected)) {
          disagreements.push(`${zone} ${instant}: ${JSON.stringify(ours)}`);
        }
      }
    }
    expect(disagreements).toEqual([]);
  });

  it('turns every quarter hour around each change in 2026 into the instant Temporal does', { timeout: 120_000 }, () => {
    // `Temporal.ZonedDateTime.from` over the records spread together is the
    // whole interop, gaps and overlaps included.
    const disagreements: string[] = [];
    for (const zone of zones) {
      for (const day of changeDays(zone)) {
        const date = fromEpochDay(day);
        for (let quarter = 0; quarter < 96; quarter++) {
          const time = { hour: Math.floor(quarter / 4), minute: (quarter % 4) * 15, second: 0 };
          const ours = zonedToInstant(date, time, zone);
          const theirs = temporal!.ZonedDateTime.from({ ...date, ...time, timeZone: zone }).epochMilliseconds;
          if (ours !== theirs) disagreements.push(`${zone} ${toIsoDate(date)} ${time.hour}:${time.minute}: ${ours}`);
        }
      }
    }
    expect(disagreements).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The ends of the range, and posts every parser reads
// ---------------------------------------------------------------------------

/** The instants past which neither `Date` nor `Temporal` holds anything. */
const FIRST_INSTANT = -8.64e15;
const LAST_INSTANT = 8.64e15;

/** RFC 3339's own grammar: an offset in hours and minutes, or `Z`. */
const RFC_3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/;

describe('an instant with a fraction of a millisecond', () => {
  it('is floored before 1970 as after it, so the offset stays the zone’s', () => {
    // `Intl` cuts a fraction towards zero, and before 1970 that is towards
    // the later second: half a millisecond before the epoch read as the epoch
    // itself, a second away from the floored milliseconds beside it, and the
    // offset made of the two came out a second ahead of UTC.
    expect(instantToZoned(-0.5, 'UTC')).toEqual({
      date: { year: 1969, month: 12, day: 31 },
      time: { hour: 23, minute: 59, second: 59 },
      offset: '+00:00',
    });
    expect(instantToZoned(-1000.5, 'Asia/Kolkata')).toEqual({
      date: { year: 1970, month: 1, day: 1 },
      time: { hour: 5, minute: 29, second: 58 },
      offset: '+05:30',
    });
    expect(instantToZoned(1.5, 'UTC').time).toEqual({ hour: 0, minute: 0, second: 0 });
  });
});

describe('the first and the last instant there is', () => {
  it('come back from the wall times they read as, in any zone, as they do from Temporal', () => {
    // The day either side that the offsets are read from is not there at
    // either end, and asking `Intl` about it threw where `Temporal` answers.
    for (const zone of ['UTC', 'America/New_York', 'Asia/Kolkata', 'Pacific/Chatham']) {
      for (const instant of [FIRST_INSTANT, LAST_INSTANT]) {
        const { date, time } = instantToZoned(instant, zone);
        expect(zonedToInstant(date, time, zone)).toBe(instant);
      }
    }
    // An hour inside the end, in a zone four hours behind UTC there.
    expect(
      zonedToInstant({ year: 275760, month: 9, day: 12 }, { hour: 19, minute: 0 }, 'America/New_York'),
    ).toBe(LAST_INSTANT - MS_PER_HOUR);
  });

  it('bound the wall times there are: one whose instant is past either is refused', () => {
    expect(() =>
      zonedToInstant({ year: -271821, month: 4, day: 19 }, { hour: 23, minute: 59, second: 59 }, 'UTC'),
    ).toThrow(RangeError);
    expect(() =>
      zonedToInstant({ year: 275760, month: 9, day: 13 }, { hour: 0, minute: 0, second: 1 }, 'UTC'),
    ).toThrow(RangeError);
    // The last instant is 20:00 on the 12th in New York, so a second later
    // there is past it too, though the date is a day short of UTC's last.
    expect(() =>
      zonedToInstant(
        { year: 275760, month: 9, day: 12 },
        { hour: 20, minute: 0, second: 1 },
        'America/New_York',
      ),
    ).toThrow(RangeError);
    expect(() =>
      zonedToInstant({ year: 300_000, month: 1, day: 1 }, { hour: 0, minute: 0 }, 'Asia/Kolkata'),
    ).toThrow(RangeError);
  });
});

describe('a post from before a zone kept standard time', () => {
  it('names the instant in UTC, since RFC 3339 has no seconds in an offset', () => {
    // New York kept local mean time, 4:56:02 behind UTC, until November
    // 1883. A post written with that offset is one `Date.parse` and most
    // servers refuse, and one with the seconds dropped names another
    // instant; in UTC it is the same instant, in a form every parser reads.
    const day = { year: 1880, month: 5, day: 1 };
    const post = setupPicker({ timeZone: 'America/New_York', defaultValue: day }).hidden().value;
    expect(post).toBe('1880-05-01T04:56:02Z');
    expect(Date.parse(post)).toBe(zonedToInstant(day, { hour: 0, minute: 0 }, 'America/New_York'));
  });

  it('does the same for a time, ahead of UTC as well as behind it', () => {
    // Kolkata kept Madras time, 5:21:10 ahead of UTC, until 1906.
    const post = setupTime({
      timeZone: 'Asia/Kolkata',
      date: () => ({ year: 1900, month: 3, day: 1 }),
      defaultValue: { hour: 9, minute: 30, second: 0 },
    }).hidden().value;
    expect(post).toBe('1900-03-01T04:08:50Z');
    expect(post).toMatch(RFC_3339);
  });

  it('keeps the zone’s own offset wherever it is whole minutes, in the same years', () => {
    // London's mean time was Greenwich's, so its 1880 is already RFC 3339.
    const post = setupPicker({
      timeZone: 'Europe/London',
      defaultValue: { year: 1880, month: 5, day: 1 },
    }).hidden().value;
    expect(post).toBe('1880-05-01T00:00:00+00:00');
  });
});

describe('a calendar given both a today and a zone', () => {
  it('refuses a zone Intl does not know, though its own today stands in for the zone’s', () => {
    // A today of its own is what a test hands a calendar, so a zone that was
    // only checked without one would be a typo every test passes.
    expect(() =>
      createRoot(() =>
        createCalendar({
          calendar: () => null,
          timeZone: 'Mars/Olympus_Mons',
          today: () => ({ year: 2026, month: 1, day: 1 }),
        }),
      ),
    ).toThrow(RangeError);
  });
});

describe('a wall time that is not one, at the low end of each field', () => {
  it('is refused rather than rolled back into the day, the month or the year before', () => {
    // The day before the first, the hour before midnight: `Date.UTC` takes
    // each of these and names the instant before, and so would the
    // arithmetic here without the floor on every field.
    const at = (date: PlainDateValue, time: WallTime) => () =>
      zonedToInstant(date, time, 'Asia/Kolkata');
    expect(at({ year: 2026, month: 0, day: 1 }, { hour: 9, minute: 0 })).toThrow(RangeError);
    expect(at({ year: 2026, month: 3, day: 0 }, { hour: 9, minute: 0 })).toThrow(RangeError);
    expect(at({ year: 2026, month: 3, day: 1 }, { hour: -1, minute: 0 })).toThrow(RangeError);
    expect(at({ year: 2026, month: 3, day: 1 }, { hour: 9, minute: -1 })).toThrow(RangeError);
    expect(at({ year: 2026, month: 3, day: 1 }, { hour: 9, minute: 0, second: -1 })).toThrow(
      RangeError,
    );
  });

  it('is refused for a fraction in any field, not only the hour', () => {
    const at = (date: PlainDateValue, time: WallTime) => () =>
      zonedToInstant(date, time, 'Asia/Kolkata');
    expect(at({ year: 2026.5, month: 3, day: 1 }, { hour: 9, minute: 0 })).toThrow(RangeError);
    expect(at({ year: 2026, month: 3, day: 1 }, { hour: 9, minute: 0.5 })).toThrow(RangeError);
    expect(at({ year: 2026, month: 3, day: 1 }, { hour: 9, minute: 0, second: 0.5 })).toThrow(
      RangeError,
    );
  });
});

describe('a zone’s clock on a day the clocks change', () => {
  it('moves the mark at midnight after a day an hour short, not an hour after it', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    // 01:00 in New York on 8 March 2026, an hour before its clocks skip
    // from 02:00 to 03:00. The next midnight is twenty-two hours away, not
    // the twenty-three the clock face says, so a timer set from the face
    // alone would wake at one in the morning and mark the 8th an hour too
    // long.
    vi.setSystemTime(Date.UTC(2026, 2, 8, 6, 0));
    const { marked } = setupCalendar('America/New_York');
    expect(marked()).toBe('2026-03-08');

    vi.advanceTimersByTime(22 * MS_PER_HOUR + 30_000);
    flushSync();
    expect(marked()).toBe('2026-03-09');
  });
});
