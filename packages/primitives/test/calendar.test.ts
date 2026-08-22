/**
 * Calendar, driven through a real mounted component.
 *
 * Three things here cannot be seen from the outside and cannot be retrofitted:
 * the arithmetic, which has to survive month ends and leap years without a
 * `Date` object to lean on; the single tab stop, which is what makes a grid of
 * forty cells one widget rather than forty; and what a screen reader is told,
 * which is the only channel a month change has when focus never left the
 * button that caused it.
 *
 * `today` is injected everywhere rather than read from the clock, so that a
 * suite run on the 29th of February asserts the same thing as one run in June.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compileTemplate } from '@voltdev/core/jit';
import { Component, Signal, flushSync, mount } from '@voltdev/core';
import {
  CALENDAR_DAY_ATTRIBUTE,
  addDays,
  addMonths,
  compareDates,
  createCalendar,
  dayOfWeek,
  daysInMonth,
  firstDayOfWeek,
  fromEpochDay,
  isLeapYear,
  parseIsoDate,
  toEpochDay,
  toIsoDate,
  type Calendar,
  type CalendarOptions,
  type PlainDateValue,
} from '../src/calendar.ts';
import { resetAnnouncer } from '../src/announcer.ts';
import {
  DEFAULT_MESSAGES,
  createLocaleProvider,
  resetLocaleCaches,
  type MessageCatalog,
} from '../src/i18n.ts';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

/** A Wednesday in a month that starts on a Saturday and has 31 days. */
const TODAY: PlainDateValue = { year: 2026, month: 8, day: 12 };

let host: HTMLElement;
let mounted: { unmount(): void }[] = [];
let selectors = 0;
let calOptions: Omit<CalendarOptions, 'calendar'>;
let localeTag: string;
let localeMessages: MessageCatalog;

beforeEach(() => {
  document.documentElement.removeAttribute('lang');
  document.documentElement.removeAttribute('dir');
  document.body.innerHTML = '<div id="app"></div>';
  host = document.querySelector('#app')!;
  calOptions = { today: () => TODAY };
  localeTag = 'en-US';
  localeMessages = {};
  resetLocaleCaches();
});

afterEach(() => {
  for (const handle of mounted) handle.unmount();
  mounted = [];
  flushSync();
  resetAnnouncer();
  vi.useRealTimers();
});

const TEMPLATE = `
  <div class="provider" :ref="provider" :spread="locale.providerProps()">
  <div class="cal" :ref="root" :spread="cal.calendarProps()"
       :keydown="onKey($event)"
       :click="cal.onDayClick($event)"
       :pointerover="cal.onDayPointerOver($event)"
       :pointerleave="cal.onPointerLeave()">
    <button class="prev" :spread="cal.previousMonthProps()" :click="cal.previousMonth()">p</button>
    <button class="next" :spread="cal.nextMonthProps()" :click="cal.nextMonth()">n</button>
    <button class="prev-year" :spread="cal.previousYearProps()" :click="cal.previousYear()">P</button>
    <button class="next-year" :spread="cal.nextYearProps()" :click="cal.nextYear()">N</button>
    <div class="month" :for="month in cal.months()" :key="month.index">
      <h2 class="heading" :spread="cal.headingProps(month.index)">{ month.label }</h2>
      <table class="grid" :spread="cal.gridProps(month.index)">
        <thead>
          <tr class="head-row" :spread="cal.rowProps()">
            <th class="weekday" :for="d in cal.weekdays()" :key="d.dayOfWeek"
                :spread="cal.weekdayProps(d)">{ d.short }</th>
          </tr>
        </thead>
        <tbody>
          <tr class="week" :for="week in month.weeks" :key="week.key" :spread="cal.rowProps()">
            <td class="day" :for="day in week.days" :key="day.key"
                :spread="cal.dayProps(day)">{ day.date.day }</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
  </div>
`;

interface Harness {
  cal: Calendar;
  root: HTMLElement;
  /** Every rendered day cell, in document order. */
  days(): HTMLElement[];
  /** The in-month cell for a date, which is the one that holds the tab stop. */
  cell(date: PlainDateValue): HTMLElement;
  /** The one cell in the tab order, as an ISO date. */
  tabStop(): string | null;
  handled(): boolean;
}

function setup(): Harness {
  @Component({ selector: `v-cal-${++selectors}`, render: compileTemplate(TEMPLATE) })
  class CalendarComponent {
    provider = new Signal.State<Element | null>(null);
    root = new Signal.State<Element | null>(null);
    handled = false;
    locale = createLocaleProvider({
      defaultLocale: localeTag,
      messages: localeMessages,
      element: () => this.provider.get(),
    });
    cal = createCalendar({ ...calOptions, calendar: () => this.root.get() });

    onKey(event: KeyboardEvent): void {
      this.handled = this.cal.onKeyDown(event);
      if (this.handled) event.preventDefault();
    }
  }

  const handle = mount(CalendarComponent, host);
  mounted.push(handle);
  const instance = handle.instance as unknown as { cal: Calendar; handled: boolean };

  const days = (): HTMLElement[] => [
    ...host.querySelectorAll<HTMLElement>(`[${CALENDAR_DAY_ATTRIBUTE}]`),
  ];

  return {
    cal: instance.cal,
    root: host.querySelector<HTMLElement>('.cal')!,
    days,
    cell: (date) =>
      days().find(
        (el) =>
          el.getAttribute(CALENDAR_DAY_ATTRIBUTE) === toIsoDate(date) &&
          !el.hasAttribute('data-outside-month'),
      )!,
    tabStop: () => {
      const stop = days().find((el) => el.getAttribute('tabindex') === '0');
      return stop?.getAttribute(CALENDAR_DAY_ATTRIBUTE) ?? null;
    },
    handled: () => instance.handled,
  };
}

function press(el: Element, key: string, modifiers: Partial<KeyboardEventInit> = {}): boolean {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers });
  el.dispatchEvent(event);
  flushSync();
  return event.defaultPrevented;
}

function click(el: Element): void {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  flushSync();
}

function hover(el: Element): void {
  el.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
  flushSync();
}

/** What the shared live region is holding, once it has had time to be read. */
function spoken(): string {
  const region = document.querySelector("[data-volt-announcer='polite']");
  return region?.textContent?.trim() ?? '';
}

const iso = (el: Element | null | undefined): string | null =>
  el?.getAttribute(CALENDAR_DAY_ATTRIBUTE) ?? null;

// ---------------------------------------------------------------------------

describe('civil arithmetic, with no Date anywhere near it', () => {
  it('round-trips every day across a leap year and a century boundary', () => {
    // 1899-12-31 through 1901-01-01, and 2024 in full: the two places a naive
    // implementation loses a day.
    for (const from of [{ year: 1899, month: 12, day: 25 }, { year: 2024, month: 2, day: 20 }]) {
      let epoch = toEpochDay(from);
      for (let step = 0; step < 400; step++) {
        const date = fromEpochDay(epoch);
        expect(toEpochDay(date)).toBe(epoch);
        epoch += 1;
      }
    }
  });

  it('agrees with the epoch on which day of the week it is', () => {
    // 1970-01-01 was a Thursday, which is 4 on the ISO scale.
    expect(dayOfWeek({ year: 1970, month: 1, day: 1 })).toBe(4);
    expect(toEpochDay({ year: 1970, month: 1, day: 1 })).toBe(0);
    // 2000-01-01 was a Saturday.
    expect(dayOfWeek({ year: 2000, month: 1, day: 1 })).toBe(6);
    // 2026-08-12 is a Wednesday, which is what the fixture claims.
    expect(dayOfWeek(TODAY)).toBe(3);
  });

  it('knows the leap rule at the centuries it is actually tested by', () => {
    expect(isLeapYear(1900)).toBe(false);
    expect(isLeapYear(2000)).toBe(true);
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(2026)).toBe(false);
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
  });

  it('clamps the day when the next month is shorter, rather than overflowing it', () => {
    // `Date#setMonth` gives March 3 here, which is the bug this exists to avoid.
    expect(addMonths({ year: 2026, month: 1, day: 31 }, 1)).toEqual({
      year: 2026,
      month: 2,
      day: 28,
    });
    expect(addMonths({ year: 2024, month: 1, day: 31 }, 1)).toEqual({
      year: 2024,
      month: 2,
      day: 29,
    });
    // And a leap day a year later is the 28th, not the 1st of March.
    expect(addMonths({ year: 2024, month: 2, day: 29 }, 12)).toEqual({
      year: 2025,
      month: 2,
      day: 28,
    });
  });

  it('crosses a year in both directions', () => {
    expect(addDays({ year: 2025, month: 12, day: 31 }, 1)).toEqual({
      year: 2026,
      month: 1,
      day: 1,
    });
    expect(addMonths({ year: 2026, month: 1, day: 15 }, -1)).toEqual({
      year: 2025,
      month: 12,
      day: 15,
    });
  });

  it('parses only what it printed, and refuses a day the month does not have', () => {
    expect(toIsoDate({ year: 2026, month: 8, day: 5 })).toBe('2026-08-05');
    expect(parseIsoDate('2026-08-05')).toEqual({ year: 2026, month: 8, day: 5 });
    expect(parseIsoDate('2026-02-30')).toBeNull();
    expect(parseIsoDate('2026-13-01')).toBeNull();
    expect(parseIsoDate('not a date')).toBeNull();
  });
});

describe('what comes from the locale rather than from an assumption', () => {
  it('starts the week where the locale starts it', () => {
    expect(firstDayOfWeek('en-US')).toBe(7);
    expect(firstDayOfWeek('fr-FR')).toBe(1);
    expect(firstDayOfWeek('ar-EG')).toBe(6);
  });

  it('lays the columns out in that order, and names them in that language', () => {
    localeTag = 'fr-FR';
    const { cal } = setup();
    const week = cal.weekdays();

    expect(week.map((d) => d.dayOfWeek)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(week[0]!.long).toBe('lundi');

    const heads = [...host.querySelectorAll<HTMLElement>('.weekday')];
    // The accessible name is the whole word even where the column shows two
    // letters, which is what `abbr` is for on a `<th>`.
    expect(heads[0]!.getAttribute('aria-label')).toBe('lundi');
    expect(heads[0]!.getAttribute('abbr')).toBe('lundi');
    expect(heads[0]!.getAttribute('role')).toBe('columnheader');
  });

  it('starts the American week on Sunday, so the first cell is not the 1st', () => {
    const { cal } = setup();
    expect(cal.weekdays().map((d) => d.dayOfWeek)).toEqual([7, 1, 2, 3, 4, 5, 6]);

    // August 2026 begins on a Saturday, so a Sunday-first grid leads with six
    // days of July.
    const first = cal.months()[0]!.weeks[0]!.days;
    expect(toIsoDate(first[0]!.date)).toBe('2026-07-26');
    expect(first.filter((d) => d.outsideMonth)).toHaveLength(6);
  });

  it('names the month in the locale, and pins Gregorian where the locale is not', () => {
    localeTag = 'ar-SA';
    const { cal } = setup();
    // `ar-SA` resolves to islamic-umalqura by default, which would label a
    // Gregorian grid with a Hijri month. The grid is Gregorian, so the label
    // has to be too — but the numbering system still comes from the locale.
    const label = cal.months()[0]!.label;
    expect(label).toContain('٢٠٢٦');
    expect(label).not.toContain('١٤٤٧');
  });

  it('renders four to six rows, or always six when asked', () => {
    const { cal } = setup();
    // August 2026: six days of lead plus 31 makes six rows.
    expect(cal.months()[0]!.weeks).toHaveLength(6);

    calOptions = { ...calOptions, today: () => ({ year: 2026, month: 2, day: 1 }) };
    const short = setup();
    // February 2026 starts on a Sunday and has 28 days: exactly four rows.
    expect(short.cal.months()[0]!.weeks).toHaveLength(4);

    calOptions = { ...calOptions, fixedWeeks: true };
    const fixed = setup();
    expect(fixed.cal.months()[0]!.weeks).toHaveLength(6);
  });

  it('overrides the locale only when a calendar is contractually ISO', () => {
    calOptions = { ...calOptions, firstDayOfWeek: 1 };
    const { cal } = setup();
    expect(cal.weekdays().map((d) => d.dayOfWeek)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});

describe('what assistive technology is told', () => {
  it('marks the group, the grid, the rows and the cells', () => {
    calOptions = { ...calOptions, label: 'Arrival' };
    const { root, cell } = setup();

    expect(root.getAttribute('role')).toBe('group');
    expect(root.getAttribute('aria-label')).toBe('Arrival');

    const grid = host.querySelector('.grid')!;
    expect(grid.getAttribute('role')).toBe('grid');
    // Named by its own heading, so that a month change has a name to change.
    const heading = host.querySelector('.heading')!;
    expect(grid.getAttribute('aria-labelledby')).toBe(heading.id);
    expect(heading.textContent).toBe('August 2026');
    // A single-date grid has one answer, so it is not multiselectable.
    expect(grid.hasAttribute('aria-multiselectable')).toBe(false);

    expect(host.querySelector('.week')!.getAttribute('role')).toBe('row');
    expect(cell(TODAY).getAttribute('role')).toBe('gridcell');
  });

  it('names every cell with the whole date, not with the number on it', () => {
    const { cell } = setup();
    expect(cell(TODAY).getAttribute('aria-label')).toBe('Wednesday, August 12, 2026, today');
    expect(cell({ year: 2026, month: 8, day: 13 }).getAttribute('aria-label')).toBe(
      'Thursday, August 13, 2026',
    );
  });

  it('marks today with aria-current, and says so in the name as well', () => {
    const { cell } = setup();
    expect(cell(TODAY).getAttribute('aria-current')).toBe('date');
    expect(cell({ year: 2026, month: 8, day: 13 }).hasAttribute('aria-current')).toBe(false);
    // `aria-current="date"` is announced unevenly, and "today" is the fact.
    expect(cell(TODAY).getAttribute('aria-label')).toContain('today');
  });

  it('states aria-selected only where "not selected" means something', () => {
    calOptions = { ...calOptions, defaultValue: TODAY };
    const { cell } = setup();
    expect(cell(TODAY).getAttribute('aria-selected')).toBe('true');
    // Every other cell in a single-date grid saying "false" is thirty
    // announcements of a fact the role already carries.
    expect(cell({ year: 2026, month: 8, day: 13 }).hasAttribute('aria-selected')).toBe(false);

    calOptions = { today: () => TODAY, mode: 'range' };
    const ranged = setup();
    expect(host.querySelector('.grid')!.getAttribute('aria-multiselectable')).toBe('true');
    expect(ranged.cell(TODAY).getAttribute('aria-selected')).toBe('false');
  });

  it('keeps an unavailable date in the tree and says why', () => {
    calOptions = {
      ...calOptions,
      isDateDisabled: (date) => date.day === 13,
    };
    const { cell } = setup();
    const thirteenth = cell({ year: 2026, month: 8, day: 13 });

    expect(thirteenth.getAttribute('aria-disabled')).toBe('true');
    // Never the `disabled` attribute: a date that vanishes from the month is
    // worse than one that is heard to be unavailable.
    expect(thirteenth.hasAttribute('disabled')).toBe(false);
    expect(thirteenth.getAttribute('aria-label')).toContain('unavailable');
  });

  it('names the navigation buttons out of the catalogue, not out of this file', () => {
    setup();
    // The English defaults, which are the ones a translator overrides rather
    // than the ones a calendar hard-codes.
    expect(host.querySelector('.prev')!.getAttribute('aria-label')).toBe(
      DEFAULT_MESSAGES.previous,
    );

    localeTag = 'fr-FR';
    localeMessages = { previous: 'Mois précédent', next: 'Mois suivant' };
    setup();
    const buttons = [...host.querySelectorAll('.prev')];
    expect(buttons.at(-1)!.getAttribute('aria-label')).toBe('Mois précédent');
  });
});

describe('the single tab stop', () => {
  it('starts on the selected date rather than on the first of the month', () => {
    calOptions = { ...calOptions, defaultValue: { year: 2026, month: 8, day: 20 } };
    const { tabStop } = setup();
    expect(tabStop()).toBe('2026-08-20');
  });

  it('falls back to today when nothing has been chosen', () => {
    const { tabStop } = setup();
    expect(tabStop()).toBe('2026-08-12');
  });

  it('is exactly one cell, across every visible month', () => {
    calOptions = { ...calOptions, visibleMonths: 2 };
    const { days, cal } = setup();

    expect(cal.months()).toHaveLength(2);
    expect(days().filter((el) => el.getAttribute('tabindex') === '0')).toHaveLength(1);
  });

  it('sits on the in-month cell, never on a neighbour month padding it', () => {
    calOptions = {
      ...calOptions,
      visibleMonths: 2,
      // The 1st of September is also rendered in August's trailing row.
      defaultFocusedDate: { year: 2026, month: 9, day: 1 },
    };
    const { days } = setup();

    const stops = days().filter((el) => el.getAttribute('tabindex') === '0');
    expect(stops).toHaveLength(1);
    expect(stops[0]!.hasAttribute('data-outside-month')).toBe(false);
    expect(iso(stops[0])).toBe('2026-09-01');
  });

  it('moves with the arrows and leaves nothing behind', () => {
    const { cell, tabStop } = setup();
    press(cell(TODAY), 'ArrowRight');
    expect(tabStop()).toBe('2026-08-13');

    press(cell({ year: 2026, month: 8, day: 13 }), 'ArrowDown');
    expect(tabStop()).toBe('2026-08-20');
  });
});

describe('the keyboard map', () => {
  it('moves by day and by week', () => {
    const { root, cal } = setup();
    press(root, 'ArrowRight');
    expect(cal.focusedDate()).toEqual({ year: 2026, month: 8, day: 13 });
    press(root, 'ArrowLeft');
    press(root, 'ArrowLeft');
    expect(cal.focusedDate()).toEqual({ year: 2026, month: 8, day: 11 });
    press(root, 'ArrowDown');
    expect(cal.focusedDate()).toEqual({ year: 2026, month: 8, day: 18 });
    press(root, 'ArrowUp');
    press(root, 'ArrowUp');
    expect(cal.focusedDate()).toEqual({ year: 2026, month: 8, day: 4 });
  });

  it('takes Home and End to the ends of the focused week, in the locale order', () => {
    const { root, cal } = setup();
    // Sunday-first: the week holding Wednesday the 12th runs from the 9th.
    press(root, 'Home');
    expect(cal.focusedDate()).toEqual({ year: 2026, month: 8, day: 9 });
    press(root, 'End');
    expect(cal.focusedDate()).toEqual({ year: 2026, month: 8, day: 15 });

    localeTag = 'fr-FR';
    const monday = setup();
    press(monday.root, 'Home');
    expect(monday.cal.focusedDate()).toEqual({ year: 2026, month: 8, day: 10 });
    press(monday.root, 'End');
    expect(monday.cal.focusedDate()).toEqual({ year: 2026, month: 8, day: 16 });
  });

  it('pages by month, and by year with Shift', () => {
    const { root, cal } = setup();
    press(root, 'PageDown');
    expect(cal.focusedDate()).toEqual({ year: 2026, month: 9, day: 12 });
    expect(cal.visibleMonth()).toEqual({ year: 2026, month: 9 });

    press(root, 'PageUp');
    press(root, 'PageUp');
    expect(cal.focusedDate()).toEqual({ year: 2026, month: 7, day: 12 });

    press(root, 'PageDown', { shiftKey: true });
    expect(cal.focusedDate()).toEqual({ year: 2027, month: 7, day: 12 });
    press(root, 'PageUp', { shiftKey: true });
    press(root, 'PageUp', { shiftKey: true });
    expect(cal.focusedDate()).toEqual({ year: 2025, month: 7, day: 12 });
  });

  it('clamps a month page onto a shorter month rather than skipping it', () => {
    calOptions = { ...calOptions, defaultFocusedDate: { year: 2026, month: 1, day: 31 } };
    const { root, cal } = setup();
    press(root, 'PageDown');
    expect(cal.focusedDate()).toEqual({ year: 2026, month: 2, day: 28 });
  });

  it('selects on Enter and on Space, and consumes both either way', () => {
    const { root, cal } = setup();
    expect(press(root, 'Enter')).toBe(true);
    expect(cal.selectedDate()).toEqual(TODAY);

    press(root, 'ArrowRight');
    expect(press(root, ' ')).toBe(true);
    expect(cal.selectedDate()).toEqual({ year: 2026, month: 8, day: 13 });
  });

  it('consumes Space on a date it refuses, so the page does not scroll under it', () => {
    calOptions = { ...calOptions, isDateDisabled: () => true };
    const { root, cal } = setup();
    expect(press(root, ' ')).toBe(true);
    expect(cal.selectedDate()).toBeNull();
  });

  it('leaves the platform modifiers alone', () => {
    const { root, cal, handled } = setup();
    press(root, 'ArrowRight', { altKey: true });
    expect(handled()).toBe(false);
    press(root, 'ArrowRight', { ctrlKey: true });
    expect(handled()).toBe(false);
    expect(cal.focusedDate()).toEqual(TODAY);
  });

  it('carries DOM focus onto the cell it moved to, even in a month not yet rendered', () => {
    const { cell, cal } = setup();
    const start = cell(TODAY);
    start.focus();

    press(start, 'ArrowUp');
    expect(iso(document.activeElement)).toBe('2026-08-05');

    // Off the end of the month: the April cell does not exist until the grid
    // has re-rendered, so this is the case the deferred focus exists for.
    press(document.activeElement!, 'PageDown');
    expect(cal.visibleMonth()).toEqual({ year: 2026, month: 9 });
    expect(iso(document.activeElement)).toBe('2026-09-05');
    expect(document.activeElement!.hasAttribute('data-outside-month')).toBe(false);
  });
});

describe('right to left', () => {
  it('mirrors the day arrows, because the grid itself is mirrored', () => {
    localeTag = 'ar-EG';
    const { root, cal } = setup();
    expect(root.closest('[dir]')?.getAttribute('dir')).toBe('rtl');

    // The cell towards the right edge of a mirrored grid is the earlier date.
    press(root, 'ArrowRight');
    expect(cal.focusedDate()).toEqual({ year: 2026, month: 8, day: 11 });
    press(root, 'ArrowLeft');
    press(root, 'ArrowLeft');
    expect(cal.focusedDate()).toEqual({ year: 2026, month: 8, day: 13 });
  });

  it('leaves the week arrows alone, since rows do not mirror', () => {
    localeTag = 'ar-EG';
    const { root, cal } = setup();
    press(root, 'ArrowDown');
    expect(cal.focusedDate()).toEqual({ year: 2026, month: 8, day: 19 });
  });

  it('starts the Arabic week on Saturday', () => {
    localeTag = 'ar-EG';
    const { cal } = setup();
    expect(cal.weekdays().map((d) => d.dayOfWeek)).toEqual([6, 7, 1, 2, 3, 4, 5]);
  });
});

describe('bounds and unavailable dates', () => {
  it('refuses to move past min or max', () => {
    calOptions = {
      ...calOptions,
      min: () => ({ year: 2026, month: 8, day: 10 }),
      max: () => ({ year: 2026, month: 8, day: 14 }),
    };
    const { root, cal } = setup();

    press(root, 'PageUp');
    expect(cal.focusedDate()).toEqual({ year: 2026, month: 8, day: 10 });
    press(root, 'ArrowLeft');
    expect(cal.focusedDate()).toEqual({ year: 2026, month: 8, day: 10 });

    press(root, 'PageDown');
    expect(cal.focusedDate()).toEqual({ year: 2026, month: 8, day: 14 });
    press(root, 'ArrowRight');
    expect(cal.focusedDate()).toEqual({ year: 2026, month: 8, day: 14 });
  });

  it('marks everything outside the bounds as unchoosable', () => {
    calOptions = { ...calOptions, min: () => ({ year: 2026, month: 8, day: 10 }) };
    const { cell, cal } = setup();
    expect(cal.isDisabled({ year: 2026, month: 8, day: 9 })).toBe(true);
    expect(cell({ year: 2026, month: 8, day: 9 }).getAttribute('aria-disabled')).toBe('true');
    expect(cell({ year: 2026, month: 8, day: 10 }).hasAttribute('aria-disabled')).toBe(false);
  });

  it('lets focus reach an unavailable date, and still refuses the press', () => {
    calOptions = {
      ...calOptions,
      isDateDisabled: (date) => date.day === 13,
    };
    const { root, cal, cell } = setup();

    press(root, 'ArrowRight');
    // Reached, so the user can hear why it cannot be booked. That is the whole
    // difference between an unavailable night and a month that does not exist.
    expect(cal.focusedDate()).toEqual({ year: 2026, month: 8, day: 13 });
    press(root, 'Enter');
    expect(cal.selectedDate()).toBeNull();

    click(cell({ year: 2026, month: 8, day: 13 }));
    expect(cal.selectedDate()).toBeNull();
  });

  it('does nothing at all while disabled', () => {
    const disabled = new Signal.State(true);
    calOptions = { ...calOptions, disabled: () => disabled.get() };
    const { root, cal, cell, handled } = setup();

    press(root, 'ArrowRight');
    expect(handled()).toBe(false);
    expect(cal.focusedDate()).toEqual(TODAY);
    click(cell(TODAY));
    expect(cal.selectedDate()).toBeNull();

    expect(host.querySelector('.prev')!.hasAttribute('disabled')).toBe(true);
    expect(root.getAttribute('aria-disabled')).toBe('true');
  });
});

describe('choosing a date', () => {
  it('reports the choice and marks the cell', () => {
    const changes: (PlainDateValue | null)[] = [];
    calOptions = { ...calOptions, onChange: (date) => changes.push(date) };
    const { cell, cal } = setup();

    click(cell({ year: 2026, month: 8, day: 20 }));
    expect(cal.selectedDate()).toEqual({ year: 2026, month: 8, day: 20 });
    expect(changes).toEqual([{ year: 2026, month: 8, day: 20 }]);
    expect(cell({ year: 2026, month: 8, day: 20 }).getAttribute('data-selected')).toBe('');
  });

  it('follows a value signal handed in from outside', () => {
    const value = new Signal.State<PlainDateValue | null>(null);
    calOptions = { ...calOptions, value };
    const { cal, cell } = setup();

    value.set({ year: 2026, month: 8, day: 3 });
    flushSync();
    expect(cal.isSelected({ year: 2026, month: 8, day: 3 })).toBe(true);
    expect(cell({ year: 2026, month: 8, day: 3 }).getAttribute('aria-selected')).toBe('true');
  });

  it('selects a day from a neighbouring month and moves the grid onto it', () => {
    const { cal, days } = setup();
    // The first row of a Sunday-first August 2026 is six days of July.
    const july = days().find((el) => iso(el) === '2026-07-28')!;
    click(july);

    expect(cal.selectedDate()).toEqual({ year: 2026, month: 7, day: 28 });
    expect(cal.visibleMonth()).toEqual({ year: 2026, month: 7 });
  });

  it('clears back to nothing', () => {
    calOptions = { ...calOptions, defaultValue: TODAY };
    const { cal } = setup();
    cal.clear();
    flushSync();
    expect(cal.selectedDate()).toBeNull();
  });
});

describe('range selection', () => {
  it('takes two presses, in either order', () => {
    calOptions = { ...calOptions, mode: 'range' };
    const { cal, cell } = setup();

    click(cell({ year: 2026, month: 8, day: 20 }));
    expect(cal.selectedRange()).toBeNull();

    click(cell({ year: 2026, month: 8, day: 10 }));
    expect(cal.selectedRange()).toEqual({
      start: { year: 2026, month: 8, day: 10 },
      end: { year: 2026, month: 8, day: 20 },
    });
  });

  it('paints every date between the ends, and marks the ends themselves', () => {
    calOptions = { ...calOptions, mode: 'range' };
    const { cal, cell } = setup();

    click(cell({ year: 2026, month: 8, day: 10 }));
    click(cell({ year: 2026, month: 8, day: 13 }));

    expect(cell({ year: 2026, month: 8, day: 10 }).getAttribute('data-range-start')).toBe('');
    expect(cell({ year: 2026, month: 8, day: 13 }).getAttribute('data-range-end')).toBe('');
    expect(cell({ year: 2026, month: 8, day: 11 }).getAttribute('data-in-range')).toBe('');
    expect(cell({ year: 2026, month: 8, day: 11 }).getAttribute('aria-selected')).toBe('true');
    expect(cell({ year: 2026, month: 8, day: 14 }).getAttribute('aria-selected')).toBe('false');
  });

  it('draws the pending half under the pointer, before the second press', () => {
    calOptions = { ...calOptions, mode: 'range' };
    const { cal, cell } = setup();

    // Nothing to preview until the first end is chosen.
    hover(cell({ year: 2026, month: 8, day: 15 }));
    expect(cal.isInRange({ year: 2026, month: 8, day: 13 })).toBe(false);

    click(cell({ year: 2026, month: 8, day: 10 }));
    hover(cell({ year: 2026, month: 8, day: 15 }));
    expect(cell({ year: 2026, month: 8, day: 13 }).getAttribute('data-in-range')).toBe('');

    cal.onPointerLeave();
    flushSync();
    expect(cell({ year: 2026, month: 8, day: 13 }).hasAttribute('data-in-range')).toBe(false);
  });

  it('drops the old interval on the first press of a new one', () => {
    calOptions = { ...calOptions, mode: 'range' };
    const { cal, cell } = setup();

    click(cell({ year: 2026, month: 8, day: 10 }));
    click(cell({ year: 2026, month: 8, day: 13 }));
    click(cell({ year: 2026, month: 8, day: 20 }));

    // Two intervals on screen at once, and the user cannot tell which the next
    // press keeps.
    expect(cal.selectedRange()).toBeNull();
    expect(cell({ year: 2026, month: 8, day: 11 }).hasAttribute('data-in-range')).toBe(false);
  });
});

describe('what the grid says out loud', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('announces the month when the button that changed it holds focus', () => {
    const { cal } = setup();
    click(host.querySelector('.next')!);
    vi.advanceTimersByTime(50);

    expect(cal.visibleMonth()).toEqual({ year: 2026, month: 9 });
    expect(spoken()).toBe('September 2026');
  });

  it('says nothing extra when a cell moved, because the cell already said it', () => {
    const { root } = setup();
    press(root, 'PageDown');
    vi.advanceTimersByTime(50);
    // The new cell carries "Saturday, September 12, 2026" as its own name.
    expect(spoken()).toBe('');
  });

  it('announces a chosen date, since aria-selected alone is not an event', () => {
    const { cell } = setup();
    click(cell({ year: 2026, month: 8, day: 20 }));
    vi.advanceTimersByTime(50);
    expect(spoken()).toBe('Thursday, August 20, 2026 selected');
  });

  it('announces both halves of a range, and that it is waiting between them', () => {
    calOptions = { ...calOptions, mode: 'range' };
    const { cell } = setup();

    click(cell({ year: 2026, month: 8, day: 10 }));
    vi.advanceTimersByTime(50);
    expect(spoken()).toBe('Monday, August 10, 2026 selected. Choose an end date.');

    click(cell({ year: 2026, month: 8, day: 13 }));
    vi.advanceTimersByTime(50);
    expect(spoken()).toBe('Monday, August 10, 2026 to Thursday, August 13, 2026 selected');
  });

  it('takes the sentence from the consumer when the consumer supplies one', () => {
    calOptions = {
      ...calOptions,
      labels: { monthChanged: (label) => `Showing ${label}` },
    };
    setup();
    click(host.querySelector('.next')!);
    vi.advanceTimersByTime(50);
    expect(spoken()).toBe('Showing September 2026');
  });
});

describe('paging the visible month', () => {
  it('carries the focused date along, so the tab stop stays on screen', () => {
    const { cal, tabStop } = setup();
    click(host.querySelector('.next')!);

    expect(cal.visibleMonth()).toEqual({ year: 2026, month: 9 });
    expect(cal.focusedDate()).toEqual({ year: 2026, month: 9, day: 12 });
    expect(tabStop()).toBe('2026-09-12');
  });

  it('leaves DOM focus on the button that was pressed', () => {
    setup();
    const next = host.querySelector<HTMLElement>('.next')!;
    next.focus();
    click(next);
    expect(document.activeElement).toBe(next);
  });

  it('moves by a year on the year buttons', () => {
    const { cal } = setup();
    click(host.querySelector('.next-year')!);
    expect(cal.visibleMonth()).toEqual({ year: 2027, month: 8 });
    click(host.querySelector('.prev-year')!);
    click(host.querySelector('.prev-year')!);
    expect(cal.visibleMonth()).toEqual({ year: 2025, month: 8 });
  });

  it('clamps the travelling focus to the bounds without dragging the month back', () => {
    calOptions = { ...calOptions, max: () => ({ year: 2026, month: 9, day: 5 }) };
    const { cal } = setup();
    click(host.querySelector('.next')!);

    expect(cal.visibleMonth()).toEqual({ year: 2026, month: 9 });
    expect(cal.focusedDate()).toEqual({ year: 2026, month: 9, day: 5 });
  });

  it('reports the month it moved to', () => {
    const seen: { year: number; month: number }[] = [];
    calOptions = { ...calOptions, onVisibleMonthChange: (m) => seen.push(m) };
    const { cal } = setup();
    cal.setVisibleMonth(2027, 3);
    flushSync();
    expect(seen).toEqual([{ year: 2027, month: 3 }]);
    expect(cal.visibleMonth()).toEqual({ year: 2027, month: 3 });
  });
});

describe('interop with Temporal, which is what this shape is for', () => {
  it('accepts anything with year, month and day, which is what a PlainDate is', () => {
    // Standing in for `Temporal.PlainDate`, which V8 ships only behind
    // `--harmony-temporal`: the point being asserted is the structural one,
    // that a value carrying the three fields needs no conversion at all.
    const plainDate = {
      year: 2026,
      month: 8,
      day: 20,
      dayOfWeek: 4,
      calendarId: 'iso8601',
      toString: () => '2026-08-20',
    };

    calOptions = { ...calOptions, defaultValue: plainDate };
    const { cal, tabStop } = setup();

    expect(cal.isSelected({ year: 2026, month: 8, day: 20 })).toBe(true);
    expect(tabStop()).toBe('2026-08-20');
    // And what comes back out is a `PlainDateLike`, so `PlainDate.from` takes
    // it without a shim.
    expect(compareDates(cal.selectedDate()!, plainDate)).toBe(0);
  });
});
