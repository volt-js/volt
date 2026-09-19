/**
 * Calendar — a month grid of dates, and the civil arithmetic under it.
 *
 * A date picker is two things bolted together and one of them is much harder
 * than it looks. The grid is the hard one: seven columns whose order comes from
 * the locale rather than from a constant, a keyboard map that has to move by
 * week and by month and by year, a focused date that is not the selected date,
 * and a month that changes underneath the user without anything on screen
 * saying so. All of that is here, once, so that the picker, a range picker and
 * a booking calendar are the same grid with different endpoints.
 *
 * This is headless: it owns state, keyboard and ARIA, and returns prop objects
 * to spread onto whatever markup the consumer writes. Nothing here renders.
 *
 *   class Booking {
 *     root = new Signal.State<Element | null>(null);
 *     cal = createCalendar({ calendar: () => this.root.get(), label: 'Arrival' });
 *   }
 *
 *   <div :ref="root" :spread="cal.calendarProps()"
 *        :keydown="onKey($event)" :click="cal.onDayClick($event)">
 *     <button :spread="cal.previousMonthProps()" :click="cal.previousMonth()">‹</button>
 *     <div :for="month in cal.months()" :key="month.index">
 *       <h2 :spread="cal.headingProps(month.index)">{ month.label }</h2>
 *       <table :spread="cal.gridProps(month.index)">
 *         <tr :spread="cal.rowProps()">
 *           <th :for="d in cal.weekdays()" :key="d.dayOfWeek"
 *               :spread="cal.weekdayProps(d)">{ d.short }</th>
 *         </tr>
 *         <tr :for="week in month.weeks" :key="week.key" :spread="cal.rowProps()">
 *           <td :for="day in week.days" :key="day.key" :spread="cal.dayProps(day)">
 *             { day.date.day }
 *           </td>
 *         </tr>
 *       </table>
 *     </div>
 *   </div>
 *
 * **The dates are plain records, and `Temporal.PlainDate` is one of them.**
 * `{ year, month, day }` is exactly the readable surface of a
 * `Temporal.PlainDate`, so a caller who has one passes it straight in, and
 * `Temporal.PlainDate.from(cal.selectedDate()!)` takes one back out. That is
 * the whole interop, and it is deliberate: `Temporal` is the answer to date
 * arithmetic and it is not on the platform yet — V8 ships it only behind
 * `--harmony-temporal`, and the build behind that flag still crashes the
 * process on a non-ISO calendar. So the arithmetic here is proleptic
 * Gregorian, written out below in about sixty lines, with no `Date` object
 * anywhere near it: `Date`'s month overflow, local-midnight drift and mutable
 * setters are precisely the foot-guns this has to avoid. When `Temporal`
 * lands, `toEpochDay`/`fromEpochDay` and the six functions over them are the
 * only things that change.
 *
 * **Everything the user reads comes from the locale.** The first day of the
 * week from the locale's week info, the weekday and month names from
 * `Intl.DateTimeFormat`, the digits from the locale's numbering system — none
 * of it is a constant or a prop. The few words said around the dates, "today"
 * and "selected" and the like, come from the locale's catalogue, and are
 * English only where the catalogue has nothing to say.
 *
 * **The calendar is Gregorian even where the locale's is not.** `ar-SA`
 * resolves to `islamic-umalqura`, and formatting a Gregorian month grid with a
 * Hijri formatter produces a grid whose heading says one month and whose cells
 * belong to another. So the formatters here pin `calendar: 'gregory'`, which
 * is the only honest label for the grid the arithmetic actually built. Real
 * non-Gregorian grids need `Temporal`'s calendar support and are not here.
 *
 * The keyboard map is the WAI-ARIA date grid:
 *
 *   ArrowRight, ArrowLeft      next, previous day — mirrored under RTL
 *   ArrowDown, ArrowUp         next, previous week
 *   Home, End                  first, last day of the focused week
 *   PageDown, PageUp           same day of the next, previous month
 *   Shift + PageDown/PageUp    same day of the next, previous year
 *   Enter, Space               select the focused date
 *
 * Arrow keys are mirrored under RTL because a grid in an RTL context is laid
 * out mirrored, and the APG defines these keys by where the cell *is*, not by
 * which way time runs: pressing the key towards the right edge has to move to
 * the cell at the right edge, which in Arabic is the earlier date.
 *
 * **The focused date is not the selected date.** A calendar showing an empty
 * field still has to put a tab stop somewhere, so exactly one cell is
 * focusable at a time — the selected date, else today, else the first date
 * that can be reached — and arrowing moves that cell rather than the
 * selection. It is the same single-tab-stop rule as a listbox, applied across
 * every visible month at once so that a two-month grid is one composite widget
 * and not two.
 *
 * **Moving the month is announced, moving within it is not.** A cell carries
 * the full date as its accessible name, so arrowing from March 31 into April
 * already says "April 1" out loud and a second announcement would talk over
 * it. Pressing the previous-month button does not: focus stays on the button,
 * the grid changes in silence, and that silence is what the shared announcer
 * exists for.
 */

import { Signal, effect, onCleanup } from '@voltdev/core';
import { announce } from './announcer.js';
import { createId } from './id.js';
import { getDateTimeFormat, resolveDirection, useLocale, type MessageValues } from './i18n.js';

const { untrack } = Signal.subtle;

/**
 * Marks a day cell and carries its ISO date.
 *
 * The date rather than an index, because a click has to say which day it was
 * and the grid is two-dimensional: an index would have to be decoded against
 * the month currently on screen, which is the thing the click may have just
 * changed. Cells are found by attribute rather than registered, so a day
 * rendered from `:for` inside markup the consumer wrote needs no wiring.
 */
export const CALENDAR_DAY_ATTRIBUTE = 'data-volt-calendar-day';

const MS_PER_DAY = 86_400_000;
const MS_PER_HOUR = 3_600_000;

/** Days in each month of a common year, January first. */
const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

/**
 * A date with no time and no zone: what a calendar actually selects.
 *
 * Structurally a `Temporal.PlainDate`, so one can be passed wherever this is
 * asked for. `month` is 1-12 and `day` is 1-31, matching `Temporal` and not
 * `Date`, whose zero-based month is the single most common date bug there is.
 */
export interface PlainDateValue {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

/**
 * A time of day with no date and no zone.
 *
 * Structurally a `Temporal.PlainTime`, which also carries sub-second fields a
 * picker has no way to enter and this deliberately does not model.
 */
export interface PlainTimeValue {
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

/** A closed interval. `start` is never after `end`. */
export interface DateRange {
  readonly start: PlainDateValue;
  readonly end: PlainDateValue;
}

// ---------------------------------------------------------------------------
// Civil arithmetic
// ---------------------------------------------------------------------------

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return MONTH_LENGTHS[month - 1] ?? 30;
}

/**
 * Days since 1970-01-01, by Howard Hinnant's `days_from_civil`.
 *
 * The whole point of routing through a day number is that every other
 * operation becomes integer addition: add a week, compare two dates, find the
 * weekday, walk a grid back to the Monday before the first of the month. It is
 * exact for any year JavaScript can hold as an integer, which is more range
 * than a calendar needs and considerably more than `Date` offers.
 */
export function toEpochDay(date: PlainDateValue): number {
  const month = date.month;
  // March-based years, so that the leap day lands at the end and the month
  // lengths fall into a repeating pattern the division below can express.
  const shifted = date.year - (month <= 2 ? 1 : 0);
  const era = Math.floor(shifted / 400);
  const yearOfEra = shifted - era * 400;
  const dayOfYear = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + date.day - 1;
  const dayOfEra =
    yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}

/** The inverse of `toEpochDay`. */
export function fromEpochDay(epochDay: number): PlainDateValue {
  const shifted = epochDay + 719468;
  const era = Math.floor(shifted / 146097);
  const dayOfEra = shifted - era * 146097;
  const yearOfEra = Math.floor(
    (dayOfEra -
      Math.floor(dayOfEra / 1460) +
      Math.floor(dayOfEra / 36524) -
      Math.floor(dayOfEra / 146096)) /
      365,
  );
  const dayOfYear =
    dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const monthOfYear = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * monthOfYear + 2) / 5) + 1;
  const month = monthOfYear + (monthOfYear < 10 ? 3 : -9);
  return { year: yearOfEra + era * 400 + (month <= 2 ? 1 : 0), month, day };
}

/**
 * ISO weekday: 1 is Monday and 7 is Sunday.
 *
 * ISO rather than `Date`'s Sunday-is-zero, because `Intl.Locale`'s week info
 * reports the locale's first day on the ISO scale and the two have to be
 * subtractable from one another.
 */
export function dayOfWeek(date: PlainDateValue): number {
  // Epoch day 0 is Thursday, which is 4 on the ISO scale.
  return (((toEpochDay(date) + 3) % 7) + 7) % 7 + 1;
}

export function addDays(date: PlainDateValue, days: number): PlainDateValue {
  return fromEpochDay(toEpochDay(date) + days);
}

/**
 * Add whole months, clamping the day to the shorter month.
 *
 * January 31 plus a month is February 28, which is what `Temporal`'s default
 * `constrain` overflow does and what a date grid needs: PageDown from the last
 * day of a long month must land inside the next month rather than skipping
 * over it into the one after, which is exactly what `Date#setMonth` does.
 */
export function addMonths(date: PlainDateValue, months: number): PlainDateValue {
  const total = date.year * 12 + (date.month - 1) + months;
  const year = Math.floor(total / 12);
  const month = total - year * 12 + 1;
  return { year, month, day: Math.min(date.day, daysInMonth(year, month)) };
}

export function addYears(date: PlainDateValue, years: number): PlainDateValue {
  return addMonths(date, years * 12);
}

/** Negative when `a` is earlier, zero when they are the same day. */
export function compareDates(a: PlainDateValue, b: PlainDateValue): number {
  return a.year - b.year || a.month - b.month || a.day - b.day;
}

export function isSameDate(a: PlainDateValue | null, b: PlainDateValue | null): boolean {
  return a !== null && b !== null && compareDates(a, b) === 0;
}

/** The date itself when it is already inside the bounds, otherwise the bound. */
export function clampDate(
  date: PlainDateValue,
  min?: PlainDateValue | null,
  max?: PlainDateValue | null,
): PlainDateValue {
  if (min && compareDates(date, min) < 0) return min;
  if (max && compareDates(date, max) > 0) return max;
  return date;
}

/**
 * `YYYY-MM-DD`, which is what the day cells carry and what a form posts.
 *
 * A year outside 0000–9999 is written `±YYYYYY`, a sign and six digits: four
 * digits cannot hold it, and the extended form is the one ISO 8601 and
 * `Temporal` read — "10000-01-01" and "-0001-12-31" are both refused.
 */
export function toIsoDate(date: PlainDateValue): string {
  const { year } = date;
  const yyyy =
    year >= 0 && year <= 9999
      ? String(year).padStart(4, '0')
      : `${year < 0 ? '-' : '+'}${String(Math.abs(year)).padStart(6, '0')}`;
  return `${yyyy}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
}

/**
 * Parse `YYYY-MM-DD`, or `±YYYYYY-MM-DD`, returning null for anything else.
 *
 * Null rather than a throw: this reads values that came from an attribute, a
 * query string or a server, and a page that stops rendering because a date
 * arrived malformed is a worse failure than a picker that starts empty.
 */
export function parseIsoDate(value: string): PlainDateValue | null {
  // `-000000` is excluded by ISO 8601 itself: year zero has no negative.
  const match = /^(\d{4}|(?!-000000)[+-]\d{6})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

/**
 * An instant at noon UTC on the given date.
 *
 * `Intl.DateTimeFormat` formats instants, not civil dates, so a calendar that
 * wants the locale's name for a month has to hand it a number. Noon rather
 * than midnight so that no rounding, and no historical zone offset a caller
 * passes in, can move it across a day boundary; every formatter here pins
 * `timeZone: 'UTC'` so the instant maps back to the day it came from.
 */
function epochMsOf(date: PlainDateValue): number {
  return toEpochDay(date) * MS_PER_DAY + MS_PER_DAY / 2;
}

/**
 * The locale's week info, under either spelling.
 *
 * The same split `i18n.ts` documents for text info: `getWeekInfo()` is what
 * the proposal settled on and `weekInfo` is what shipped first, and engines in
 * service right now disagree about which exists.
 */
function weekInfoOf(locale: Intl.Locale): { firstDay?: number } | undefined {
  const method = (locale as { getWeekInfo?: () => { firstDay?: number } }).getWeekInfo;
  if (typeof method === 'function') return method.call(locale);
  return (locale as { weekInfo?: { firstDay?: number } }).weekInfo;
}

/**
 * Cached because the answer is a property of the language and cannot change,
 * unlike the formatters in `i18n.ts` whose cache is bounded because their keys
 * come from data.
 */
const firstDays = new Map<string, number>();

/**
 * The day the locale's week starts on, as an ISO weekday.
 *
 * Monday in most of Europe, Sunday in the United States and Japan, Saturday
 * across much of the Arabic-speaking world. Guessing any one of them is wrong
 * for most of the planet, which is why this is read rather than configured —
 * the option to override it exists for the calendars that are contractually
 * ISO, not for the common case.
 */
export function firstDayOfWeek(locale: string): number {
  const hit = firstDays.get(locale);
  if (hit !== undefined) return hit;

  let first = 1;
  try {
    const declared = weekInfoOf(new Intl.Locale(locale))?.firstDay;
    if (typeof declared === 'number' && declared >= 1 && declared <= 7) first = declared;
  } catch {
    // An unparseable tag is already the ambient locale's problem to report;
    // here it just means the ISO default stands.
  }
  firstDays.set(locale, first);
  return first;
}

/**
 * Today, in the given time zone or the runtime's.
 *
 * `Date.now()` is a clock reading rather than date arithmetic, and it is the
 * only way to ask what day it is without `Temporal.Now`. Turning the instant
 * into a civil date goes through `Intl` rather than through `Date`'s local
 * getters, because those resolve against the *runtime's* zone with no way to
 * ask for another — the same reason `i18n.ts` gives for never calling
 * `toLocaleString` without a tag.
 */
export function today(timeZone?: string): PlainDateValue {
  return readClock(timeZone).date;
}

/**
 * The date on the clock, and how far into that date the clock has got.
 *
 * One `Intl` reading for both, because the second is what says when the
 * first will next change — see `watchClock`.
 */
function readClock(timeZone?: string): { date: PlainDateValue; msIntoDay: number } {
  const now = Date.now();
  const parts = getDateTimeFormat('en-US', {
    calendar: 'gregory',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hourCycle: 'h23',
    ...(timeZone ? { timeZone } : {}),
  }).formatToParts(now);

  let year = 1970;
  let month = 1;
  let day = 1;
  let hour = 0;
  let minute = 0;
  let second = 0;
  for (const part of parts) {
    const value = Number(part.value);
    if (part.type === 'year') year = value;
    else if (part.type === 'month') month = value;
    else if (part.type === 'day') day = value;
    else if (part.type === 'hour') hour = value;
    else if (part.type === 'minute') minute = value;
    else if (part.type === 'second') second = value;
  }
  return {
    date: { year, month, day },
    msIntoDay: ((hour * 60 + minute) * 60 + second) * 1000 + (now % 1000),
  };
}

/**
 * Today on the runtime's clock, shared by every calendar that was not told
 * what today is.
 *
 * One reading for all of them rather than one per cell: a grid re-runs every
 * cell's bindings on each arrow press, and asking `Intl` what day it is costs
 * more than a cell's own name does. And watched, so a calendar left open
 * across midnight moves its mark with the day rather than going on marking
 * yesterday until something else re-renders it. One timer does that for the
 * whole page, set for when the day turns over, and only while a calendar is
 * reading.
 */
const clockDay = new Signal.State<PlainDateValue>({ year: 1970, month: 1, day: 1 });
let clockReaders = 0;
let clockTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Read the clock, and wake again when the day next turns over or in an hour,
 * whichever is sooner. A day is not always twenty-four hours long, and the
 * hour a clock change takes away would otherwise leave the mark that late.
 */
function tickClock(): void {
  const { date, msIntoDay } = readClock();
  if (!isSameDate(date, untrack(() => clockDay.get()))) clockDay.set(date);
  clockTimer = setTimeout(tickClock, Math.min(MS_PER_HOUR, MS_PER_DAY - msIntoDay));
}

/** Today from the shared clock, for as long as the calling scope lives. */
function watchClock(): () => PlainDateValue {
  if (clockReaders++ === 0) tickClock();
  onCleanup(() => {
    if (--clockReaders > 0 || clockTimer === null) return;
    clearTimeout(clockTimer);
    clockTimer = null;
  });
  return () => clockDay.get();
}

// ---------------------------------------------------------------------------
// The grid
// ---------------------------------------------------------------------------

/**
 * A single cell of a month grid.
 *
 * Only the facts that are structural: which date it is, which visible month it
 * belongs to, and whether it is one of the neighbouring month's days filling
 * out the first or last row. Everything reactive — selected, focused, disabled,
 * today — is asked for separately, so that moving the highlight re-runs the
 * cells' prop bindings rather than rebuilding the whole grid.
 */
export interface CalendarDay {
  readonly date: PlainDateValue;
  /** Unique across every visible month, which the same date is not. */
  readonly key: string;
  /** Which of `months()` this cell was laid out in. */
  readonly monthIndex: number;
  /** A neighbouring month's day, padding the first or last row. */
  readonly outsideMonth: boolean;
}

/**
 * One row of the grid: always seven days, starting on the locale's first.
 *
 * An object around the row rather than a bare array, because a `:for` needs a
 * key it can write without indexing into the thing it is iterating, and
 * because a row is where a week number would go.
 */
export interface CalendarWeek {
  readonly key: string;
  readonly days: readonly CalendarDay[];
}

export interface CalendarMonth {
  /** Position among the visible months; 0 is the one `visibleMonth()` names. */
  readonly index: number;
  readonly year: number;
  readonly month: number;
  /** The locale's name for it, "March 2021" in English. */
  readonly label: string;
  readonly weeks: readonly CalendarWeek[];
}

export interface CalendarWeekday {
  /** ISO weekday, 1 for Monday. */
  readonly dayOfWeek: number;
  /** "M" — for the column head, where space is one character wide. */
  readonly narrow: string;
  /** "Mon" — the usual column head. */
  readonly short: string;
  /** "Monday" — the accessible name, which is never the abbreviation. */
  readonly long: string;
}

export type CalendarSelectionMode = 'single' | 'range';

/**
 * Every string the calendar says around the dates.
 *
 * Each falls back to the locale's catalogue under the key of the same name —
 * except the month buttons, which read `previous` and `next` — and then to
 * English. A catalogue sentence names its dates `{date}`, or `{start}` and
 * `{end}`. `monthChanged` alone has no key: what it says by default is the
 * month's own name, which is already the locale's.
 */
export interface CalendarLabels {
  /** Names the previous-month button. Defaults to the locale's `previous`. */
  previousMonth?: string;
  /** Names the next-month button. Defaults to the locale's `next`. */
  nextMonth?: string;
  /** Names the previous-year button. Default `Previous year`. */
  previousYear?: string;
  /** Names the next-year button. Default `Next year`. */
  nextYear?: string;
  /** Said when the grid moves to a month nothing else announces. */
  monthChanged?: (label: string) => string;
  /** Said when a single date is chosen. Default `{date} selected`. */
  dateSelected?: (date: string) => string;
  /** Said when the first end of a range is chosen and the grid now waits. */
  rangeStartSelected?: (date: string) => string;
  /** Said when a range closes. Default `{start} to {end} selected`. */
  rangeSelected?: (start: string, end: string) => string;
  /** Appended to a cell's name when the date cannot be chosen. */
  unavailable?: string;
  /** Appended to today's cell name. `aria-current` alone is read unevenly. */
  today?: string;
}

export interface CalendarOptions {
  /**
   * The element wrapping every visible month. Direction is resolved from it,
   * and day cells are found beneath it.
   */
  calendar: () => Element | null | undefined;

  /** Default `single`. `range` takes two presses and reports an interval. */
  mode?: CalendarSelectionMode;

  /** Supply a signal to control the selection from outside. Single mode. */
  value?: Signal.State<PlainDateValue | null>;
  defaultValue?: PlainDateValue | null;
  /** Supply a signal to control the interval from outside. Range mode. */
  range?: Signal.State<DateRange | null>;
  defaultRange?: DateRange | null;

  /** The date holding the grid's single tab stop. */
  focusedDate?: Signal.State<PlainDateValue>;
  defaultFocusedDate?: PlainDateValue;

  /**
   * What counts as today. Defaults to the runtime clock, and exists so that a
   * test, a server render and a page pinned to another zone all agree.
   */
  today?: () => PlainDateValue;

  min?: () => PlainDateValue | null | undefined;
  max?: () => PlainDateValue | null | undefined;
  /**
   * Dates inside the bounds that still cannot be chosen — a fully booked
   * night, a public holiday. They stay focusable and are announced as
   * unavailable, which is the only way a keyboard user can find out why. A
   * range cannot be drawn across one.
   */
  isDateDisabled?: (date: PlainDateValue) => boolean;

  /** How many months to lay out side by side. Default 1. */
  visibleMonths?: number;
  /**
   * Override the locale's first day, as an ISO weekday. Only for calendars
   * that are contractually ISO — a timesheet, a sprint board.
   */
  firstDayOfWeek?: number;
  /**
   * Always six rows, so the grid does not change height between months.
   * Default false, which renders the four to six rows the month needs.
   */
  fixedWeeks?: boolean;

  /** The whole calendar is unavailable: no navigation, no selection. */
  disabled?: () => boolean;

  /** Accessible name for the group of months. */
  label?: string;
  /** Id of the element that names it. */
  labelledBy?: string;
  labels?: CalendarLabels;

  onChange?: (value: PlainDateValue | null) => void;
  onRangeChange?: (range: DateRange | null) => void;
  onFocusedDateChange?: (date: PlainDateValue) => void;
  onVisibleMonthChange?: (month: { year: number; month: number }) => void;
}

export type CalendarPropValue = string | number | boolean | undefined;

export interface CalendarProps {
  readonly [key: string]: CalendarPropValue;
}

export interface Calendar {
  /** The visible months, laid out. */
  months(): readonly CalendarMonth[];
  /** The column heads, in the locale's order. */
  weekdays(): readonly CalendarWeekday[];
  /** The first visible month. */
  visibleMonth(): { year: number; month: number };

  selectedDate(): PlainDateValue | null;
  selectedRange(): DateRange | null;
  focusedDate(): PlainDateValue;
  /** The element holding the grid's tab stop, for whoever must focus it. */
  focusedCell(): HTMLElement | null;

  isSelected(date: PlainDateValue): boolean;
  isDisabled(date: PlainDateValue): boolean;
  isToday(date: PlainDateValue): boolean;
  isRangeStart(date: PlainDateValue): boolean;
  isRangeEnd(date: PlainDateValue): boolean;
  /** Inside the chosen interval, or inside the one being drawn. */
  isInRange(date: PlainDateValue): boolean;
  /** The locale's full name for a date, as a screen reader hears it. */
  dateLabel(date: PlainDateValue): string;

  select(date: PlainDateValue): void;
  clear(): void;
  /** Move the tab stop, scrolling the month into view and taking DOM focus. */
  focusDate(date: PlainDateValue): void;

  previousMonth(): void;
  nextMonth(): void;
  previousYear(): void;
  nextYear(): void;
  setVisibleMonth(year: number, month: number): void;

  /** Handle a keydown. Returns true when it was consumed. */
  onKeyDown(event: KeyboardEvent): boolean;
  onDayClick(event: MouseEvent): void;
  /** Draw the pending half of a range under the pointer. Range mode only. */
  onDayPointerOver(event: PointerEvent): void;
  onPointerLeave(): void;

  calendarProps(): CalendarProps;
  gridProps(monthIndex?: number): CalendarProps;
  headingProps(monthIndex?: number): CalendarProps;
  rowProps(): CalendarProps;
  weekdayProps(weekday: CalendarWeekday): CalendarProps;
  dayProps(day: CalendarDay): CalendarProps;
  previousMonthProps(): CalendarProps;
  nextMonthProps(): CalendarProps;
  previousYearProps(): CalendarProps;
  nextYearProps(): CalendarProps;
}

export function createCalendar(options: CalendarOptions): Calendar {
  const mode = options.mode ?? 'single';
  const visibleMonths = Math.max(1, Math.trunc(options.visibleMonths ?? 1));
  const locale = useLocale();
  const baseId = createId('calendar');
  const headingId = (index: number): string => `${baseId}-h${index}`;

  const now: () => PlainDateValue = options.today ?? watchClock();

  const value =
    options.value ?? new Signal.State<PlainDateValue | null>(options.defaultValue ?? null);
  const range = options.range ?? new Signal.State<DateRange | null>(options.defaultRange ?? null);

  const isCalendarDisabled = (): boolean => options.disabled?.() ?? false;

  /**
   * Whether a date can be chosen at all.
   *
   * Bounds and the predicate are one question here but two answers on screen:
   * a date outside `min`/`max` is never reached, because navigation clamps
   * before it moves, while a date the predicate refuses is reached, focused
   * and announced as unavailable. That is the difference between a month that
   * does not exist and a night that is booked.
   *
   * While a range waits for its second press, the far side of the nearest
   * refused date is refused too — see `reach`.
   */
  const dateDisabled = (date: PlainDateValue): boolean => {
    const min = options.min?.();
    if (min && compareDates(date, min) < 0) return true;
    const max = options.max?.();
    if (max && compareDates(date, max) > 0) return true;
    if (options.isDateDisabled?.(date)) return true;
    const limits = reach.get();
    if (limits === null) return false;
    const day = toEpochDay(date);
    return day <= limits.before || day >= limits.after;
  };

  /**
   * The first day `isDateDisabled` refuses on the way from `from` to `to`,
   * both epoch days and neither of them counted, or null when none is.
   */
  const firstRefused = (from: number, to: number): number | null => {
    const refuse = options.isDateDisabled;
    if (!refuse) return null;
    const direction = Math.sign(to - from);
    for (let day = from + direction; day !== to; day += direction) {
      if (refuse(fromEpochDay(day))) return day;
    }
    return null;
  };

  const bounded = (date: PlainDateValue): PlainDateValue =>
    clampDate(date, options.min?.(), options.max?.());

  /**
   * Where the tab stop starts: the answer already given, else today, else
   * whatever the bounds allow.
   *
   * Entering a calendar on the selected date is the same rule a listbox
   * follows for the selected option, and for the same reason — the first thing
   * a keyboard user does is arrow, and arrowing from January when the field
   * says September is not navigation.
   */
  const initialFocus = (): PlainDateValue => {
    const selected = untrack(() => value.get()) ?? untrack(() => range.get())?.start;
    return bounded(options.defaultFocusedDate ?? selected ?? now());
  };

  const focused = options.focusedDate ?? new Signal.State<PlainDateValue>(initialFocus());
  const start = untrack(() => focused.get());

  /**
   * The month the user last asked to look at, which is not always the month on
   * screen. What is on screen is derived from this and from the focused date
   * together, so that the span always contains the tab stop — see
   * `visibleMonth`.
   */
  const anchorMonth = new Signal.State({ year: start.year, month: start.month });

  /** Where a pending range started, before its second press closed it. */
  const anchor = new Signal.State<PlainDateValue | null>(null);
  /** The date under the pointer, which draws the other end of that range. */
  const hovered = new Signal.State<PlainDateValue | null>(null);

  const labels = options.labels ?? {};

  /**
   * A string the calendar says around the dates: the locale's catalogue first,
   * then English. Read when it is said rather than once here, so a catalogue
   * that is swapped later is heard from then on.
   */
  const said = (key: string, fallback: string, values?: MessageValues): string =>
    locale.has(key) ? locale.t(key, values) : fallback;

  const monthChangedLabel = labels.monthChanged ?? ((label: string) => label);
  const dateSelectedLabel = (date: string): string =>
    labels.dateSelected?.(date) ?? said('dateSelected', `${date} selected`, { date });
  const rangeStartLabel = (date: string): string =>
    labels.rangeStartSelected?.(date) ??
    said('rangeStartSelected', `${date} selected. Choose an end date.`, { date });
  const rangeSelectedLabel = (start: string, end: string): string =>
    labels.rangeSelected?.(start, end) ??
    said('rangeSelected', `${start} to ${end} selected`, { start, end });
  const unavailableLabel = (): string => labels.unavailable ?? said('unavailable', 'unavailable');
  const todayLabel = (): string => labels.today ?? said('today', 'today');

  // --- Locale --------------------------------------------------------------

  const firstDay = (): number => {
    const declared = options.firstDayOfWeek;
    if (declared !== undefined && declared >= 1 && declared <= 7) return Math.trunc(declared);
    return firstDayOfWeek(locale.code());
  };

  /**
   * Every formatter pins the Gregorian calendar and UTC. The first because the
   * grid is Gregorian and a Hijri label over a Gregorian row is a lie; the
   * second because the instant handed in is a civil date in disguise and any
   * other zone would shift some of them a day.
   */
  const dateFormat = (parts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat =>
    getDateTimeFormat(locale.code(), { calendar: 'gregory', timeZone: 'UTC', ...parts });

  const monthLabel = (month: { year: number; month: number }): string =>
    dateFormat({ year: 'numeric', month: 'long' }).format(
      epochMsOf({ year: month.year, month: month.month, day: 1 }),
    );

  const dateLabel = (date: PlainDateValue): string =>
    dateFormat({ weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }).format(
      epochMsOf(date),
    );

  const weekdays = (): readonly CalendarWeekday[] => {
    const first = firstDay();
    const narrow = dateFormat({ weekday: 'narrow' });
    const short = dateFormat({ weekday: 'short' });
    const long = dateFormat({ weekday: 'long' });

    return Array.from({ length: 7 }, (_unused, offset) => {
      const iso = ((first - 1 + offset) % 7) + 1;
      // Epoch day 3 is the Sunday before the Monday at 4, so day 3 + n lands
      // on ISO weekday n for the whole week without a lookup table.
      const ms = (3 + iso) * MS_PER_DAY + MS_PER_DAY / 2;
      return {
        dayOfWeek: iso,
        narrow: narrow.format(ms),
        short: short.format(ms),
        long: long.format(ms),
      };
    });
  };

  // --- Selection -----------------------------------------------------------

  const isToday = (date: PlainDateValue): boolean => isSameDate(date, now());

  const isRangeStart = (date: PlainDateValue): boolean => isSameDate(range.get()?.start ?? null, date);
  const isRangeEnd = (date: PlainDateValue): boolean => isSameDate(range.get()?.end ?? null, date);

  /**
   * The interval to paint: the one that was chosen, or the one being drawn
   * from the first press to wherever the pointer is now.
   */
  const paintedRange = (): DateRange | null => {
    const chosen = range.get();
    if (chosen) return chosen;
    const from = anchor.get();
    const to = hovered.get();
    if (!from || !to) return null;
    return compareDates(from, to) <= 0 ? { start: from, end: to } : { start: to, end: from };
  };

  const isInRange = (date: PlainDateValue): boolean => {
    const span = paintedRange();
    if (!span) return false;
    return compareDates(date, span.start) >= 0 && compareDates(date, span.end) <= 0;
  };

  const isSelected = (date: PlainDateValue): boolean => {
    if (mode === 'single') return isSameDate(value.get(), date);
    const chosen = range.get();
    if (!chosen) return isSameDate(anchor.get(), date);
    return compareDates(date, chosen.start) >= 0 && compareDates(date, chosen.end) <= 0;
  };

  const setValue = (next: PlainDateValue | null): void => {
    value.set(next);
    options.onChange?.(next);
  };

  const setRange = (next: DateRange | null): void => {
    range.set(next);
    options.onRangeChange?.(next);
  };

  const select = (date: PlainDateValue): void => {
    if (isCalendarDisabled() || dateDisabled(date)) return;

    if (mode === 'single') {
      setValue(date);
      announce(dateSelectedLabel(dateLabel(date)));
      return;
    }

    const from = untrack(() => anchor.get());
    if (from === null) {
      // The first press clears whatever was there. Leaving the old interval on
      // screen while a new one is being drawn shows two ranges at once, and
      // the user cannot tell which one the next press will keep.
      anchor.set(date);
      hovered.set(null);
      setRange(null);
      announce(rangeStartLabel(dateLabel(date)));
      return;
    }

    // In full, and not only as far as `reach` looks: a date chosen from code,
    // or arrowed to past the months on screen, can be anywhere.
    if (firstRefused(toEpochDay(from), toEpochDay(date)) !== null) return;

    const forwards = compareDates(from, date) <= 0;
    const span = forwards ? { start: from, end: date } : { start: date, end: from };
    anchor.set(null);
    hovered.set(null);
    setRange(span);
    announce(rangeSelectedLabel(dateLabel(span.start), dateLabel(span.end)));
  };

  const clear = (): void => {
    anchor.set(null);
    hovered.set(null);
    if (mode === 'single') setValue(null);
    else setRange(null);
  };

  // --- Focus and the visible month -----------------------------------------

  /**
   * The months actually on screen, which is the anchor pulled the smallest
   * distance needed to keep the focused date inside the span.
   *
   * Derived rather than assigned, so that the invariant holds however the
   * focused date moved — an arrow key, a click on a neighbouring month's
   * padding, or a `focusedDate` signal written by the picker wrapped around
   * this. A calendar that assigns the visible month has to remember to do it
   * at every one of those, and the failure is silent: the grid's only tab stop
   * ends up off screen, so Tab enters a month the user cannot see.
   */
  const visibleMonth = (): { year: number; month: number } => {
    const anchor = anchorMonth.get();
    const date = focused.get();
    const offset = (date.year - anchor.year) * 12 + (date.month - anchor.month);
    if (offset >= 0 && offset < visibleMonths) return anchor;

    const shift = offset < 0 ? offset : offset - (visibleMonths - 1);
    const shifted = addMonths({ year: anchor.year, month: anchor.month, day: 1 }, shift);
    return { year: shifted.year, month: shifted.month };
  };

  /**
   * The first month on screen, changing only when it is a different month.
   * `visibleMonth` follows the focused date, which every arrow press moves, and
   * what hangs off the month should not re-run for a press that stays in it.
   */
  const firstVisible = new Signal.Computed(visibleMonth, {
    equals: (a, b) => a.year === b.year && a.month === b.month,
  });

  /**
   * How far a pending range can reach from its first end: the nearest day
   * either side that `isDateDisabled` refuses, as epoch days.
   *
   * A stay drawn across a booked night is not a stay anyone can have, so
   * everything past that night is refused the way the night itself is —
   * reached, focused and announced as unavailable, rather than taking a press
   * that then comes to nothing. Worked out once per first press and visible
   * span rather than once per cell, and only as far as the span goes: no cell
   * can ask about anything beyond it, and `select` checks a press there in
   * full.
   */
  const reach = new Signal.Computed<{ before: number; after: number } | null>(() => {
    const from = anchor.get();
    if (from === null || !options.isDateDisabled) return null;

    const first = firstVisible.get();
    const last = addMonths({ year: first.year, month: first.month, day: 1 }, visibleMonths - 1);
    // Six days before the first month and fourteen after the last cover every
    // neighbouring day a grid pads its first and last rows with.
    const start = toEpochDay({ year: first.year, month: first.month, day: 1 }) - 6;
    const end = toEpochDay({ ...last, day: daysInMonth(last.year, last.month) }) + 14;
    const origin = toEpochDay(from);
    return {
      before: (start < origin ? firstRefused(origin, start - 1) : null) ?? -Infinity,
      after: (end > origin ? firstRefused(origin, end + 1) : null) ?? Infinity,
    };
  });

  /**
   * Report the month on screen, once, when it actually changes.
   *
   * An effect rather than a call inside every mover, because the visible month
   * is derived from two signals and there is no single place a change to it
   * passes through.
   */
  let reported: string | null = null;
  effect(() => {
    const month = visibleMonth();
    const key = `${month.year}-${month.month}`;
    if (reported === key) return;
    const first = reported === null;
    reported = key;
    if (!first) options.onVisibleMonthChange?.(month);
  });

  const setFocused = (date: PlainDateValue): void => {
    if (compareDates(untrack(() => focused.get()), date) === 0) return;
    focused.set(date);
    options.onFocusedDateChange?.(date);
  };

  const cellFor = (date: PlainDateValue): HTMLElement | null => {
    const root = options.calendar();
    if (!root) return null;
    // The ISO date is generated here in a known-safe form, so it needs no
    // escaping — and escaping it would pull in `CSS`, which a server lacks.
    const cells = root.querySelectorAll<HTMLElement>(
      `[${CALENDAR_DAY_ATTRIBUTE}="${toIsoDate(date)}"]`,
    );
    // With two months on screen the same date can be rendered twice, once as
    // its own month's day and once as a neighbour's padding. The real one is
    // the cell that holds the tab stop.
    for (const cell of cells) if (!cell.hasAttribute('data-outside-month')) return cell;
    return cells[0] ?? null;
  };

  /**
   * A cell that was asked for before its month was rendered.
   *
   * Arrowing off the end of March changes the visible month, and the April 1
   * cell does not exist until that change has been through a render. The ISO
   * date rather than a flag, so the request expires if something else moves
   * the focus first.
   */
  let pendingFocus: string | null = null;

  effect(() => {
    // Re-runs when the visible month changes, which is the event being waited
    // for; by the time a user effect runs the new grid is in the document.
    visibleMonth();
    const wanted = pendingFocus;
    if (wanted === null) return;
    const date = parseIsoDate(wanted);
    if (!date) {
      pendingFocus = null;
      return;
    }
    const cell = cellFor(date);
    if (!cell) return;
    pendingFocus = null;
    cell.focus();
  });

  const focusDate = (date: PlainDateValue): void => {
    const target = bounded(date);
    setFocused(target);
    const cell = cellFor(target);
    if (cell) {
      pendingFocus = null;
      cell.focus();
      return;
    }
    pendingFocus = toIsoDate(target);
  };

  /**
   * Move the month without moving DOM focus off whatever pressed the button.
   *
   * The focused date travels with the month, because leaving it behind strands
   * the grid's only tab stop off screen and a keyboard user tabbing in lands
   * on a month they cannot see.
   */
  const shiftMonths = (months: number): void => {
    if (isCalendarDisabled()) return;
    const current = untrack(() => visibleMonth());
    const shifted = addMonths({ year: current.year, month: current.month, day: 1 }, months);

    anchorMonth.set({ year: shifted.year, month: shifted.month });
    setFocused(bounded(addMonths(untrack(() => focused.get()), months)));
    announce(monthChangedLabel(monthLabel(untrack(() => visibleMonth()))));
  };

  const setVisibleMonth = (year: number, month: number): void => {
    anchorMonth.set({ year, month });
    // The focused date travels into the new span, keeping the tab stop where
    // the user is looking. Its day is clamped by the month's own length, which
    // is what `addMonths` does for the same reason.
    const current = untrack(() => focused.get());
    setFocused(
      bounded(
        addMonths(current, (year - current.year) * 12 + (month - current.month)),
      ),
    );
    announce(monthChangedLabel(monthLabel(untrack(() => visibleMonth()))));
  };

  /**
   * Whether paging by `months` would reach anything at all.
   *
   * A month entirely outside the bounds has no date the tab stop could sit on,
   * so the grid would refuse to move and the button would be a control that
   * visibly does nothing. Removing it from the tab order is the honest answer.
   */
  const monthReachable = (months: number): boolean => {
    const current = visibleMonth();
    const target = addMonths({ year: current.year, month: current.month, day: 1 }, months);
    const min = options.min?.();
    const max = options.max?.();
    if (max && compareDates(target, max) > 0) return false;
    const last = { ...target, day: daysInMonth(target.year, target.month) };
    if (min && compareDates(last, min) < 0) return false;
    return true;
  };

  // --- The grid ------------------------------------------------------------

  const months = (): readonly CalendarMonth[] => {
    const first = visibleMonth();
    const weekStart = firstDay();
    const fixed = options.fixedWeeks === true;
    const result: CalendarMonth[] = [];

    for (let index = 0; index < visibleMonths; index++) {
      const head = addMonths({ year: first.year, month: first.month, day: 1 }, index);
      const length = daysInMonth(head.year, head.month);
      // How far back the grid has to start so that the first row begins on the
      // locale's first day. Modulo 7 of a difference that can be negative, so
      // it is normalised into 0-6 rather than trusted.
      const lead = (((dayOfWeek(head) - weekStart) % 7) + 7) % 7;
      const rows = fixed ? 6 : Math.ceil((lead + length) / 7);
      const gridStart = addDays(head, -lead);

      const weeks: CalendarWeek[] = [];
      for (let row = 0; row < rows; row++) {
        const days: CalendarDay[] = [];
        for (let column = 0; column < 7; column++) {
          const date = addDays(gridStart, row * 7 + column);
          days.push({
            date,
            key: `${index}:${toIsoDate(date)}`,
            monthIndex: index,
            outsideMonth: date.month !== head.month || date.year !== head.year,
          });
        }
        weeks.push({ key: days[0]!.key, days });
      }

      result.push({
        index,
        year: head.year,
        month: head.month,
        label: monthLabel(head),
        weeks,
      });
    }

    return result;
  };

  /**
   * The cell that holds the grid's single tab stop.
   *
   * One across every visible month, not one per month: two months side by side
   * are one composite widget the arrow keys move through, and a tab stop each
   * would make Tab walk them instead. The in-month rendering of the date wins
   * over the padding copy, so the stop is never on a cell the consumer has
   * styled as belonging to a neighbour.
   */
  const tabStopKey = (): string => {
    const date = focused.get();
    const first = visibleMonth();
    const offset = (date.year - first.year) * 12 + (date.month - first.month);
    if (offset >= 0 && offset < visibleMonths) return `${offset}:${toIsoDate(date)}`;
    // Only reachable when the focused date was pushed outside the span by a
    // controlled signal. The first visible month keeps the stop reachable.
    return `0:${toIsoDate(date)}`;
  };

  // --- Keyboard and pointer ------------------------------------------------

  const dayFrom = (target: EventTarget | null): PlainDateValue | null => {
    if (!(target instanceof Element)) return null;
    const cell = target.closest<HTMLElement>(`[${CALENDAR_DAY_ATTRIBUTE}]`);
    const iso = cell?.getAttribute(CALENDAR_DAY_ATTRIBUTE);
    return iso ? parseIsoDate(iso) : null;
  };

  const onKeyDown = (event: KeyboardEvent): boolean => {
    if (isCalendarDisabled()) return false;
    // Alt and the platform modifier belong to whatever wraps this — Alt+Arrow
    // is browser history, and Ctrl+Arrow is a caret move a grid must not eat.
    if (event.altKey || event.ctrlKey || event.metaKey) return false;

    const rtl = resolveDirection(options.calendar()) === 'rtl';
    const current = untrack(() => focused.get());
    let target: PlainDateValue;

    switch (event.key) {
      case 'ArrowRight':
        target = addDays(current, rtl ? -1 : 1);
        break;
      case 'ArrowLeft':
        target = addDays(current, rtl ? 1 : -1);
        break;
      case 'ArrowDown':
        target = addDays(current, 7);
        break;
      case 'ArrowUp':
        target = addDays(current, -7);
        break;
      case 'Home':
        target = addDays(current, -((((dayOfWeek(current) - firstDay()) % 7) + 7) % 7));
        break;
      case 'End':
        target = addDays(current, 6 - ((((dayOfWeek(current) - firstDay()) % 7) + 7) % 7));
        break;
      case 'PageDown':
        target = addMonths(current, event.shiftKey ? 12 : 1);
        break;
      case 'PageUp':
        target = addMonths(current, event.shiftKey ? -12 : -1);
        break;
      case 'Enter':
      case ' ':
        // Consumed either way. A refused press must not fall through to the
        // page, where Space scrolls and Enter submits the form around it.
        select(current);
        return true;
      default:
        return false;
    }

    focusDate(target);
    return true;
  };

  const onDayClick = (event: MouseEvent): void => {
    if (isCalendarDisabled()) return;
    const date = dayFrom(event.target);
    if (!date) return;

    if (dateDisabled(date)) {
      // A disabled cell still swallows the press: it is visibly there, and an
      // `<a>` or `<button>` day would otherwise act on it.
      event.preventDefault();
      return;
    }

    focusDate(date);
    select(date);
  };

  const onDayPointerOver = (event: PointerEvent): void => {
    if (mode !== 'range' || untrack(() => anchor.get()) === null) return;
    const date = dayFrom(event.target);
    // The pending interval stops at the last date that could end it, rather
    // than being painted over one the second press would refuse.
    if (date && !untrack(() => dateDisabled(date))) hovered.set(date);
  };

  const onPointerLeave = (): void => {
    if (untrack(() => hovered.get()) !== null) hovered.set(null);
  };

  onCleanup(() => {
    pendingFocus = null;
  });

  // --- Props ---------------------------------------------------------------

  const navProps = (label: string, fallback: string, months: number): CalendarProps => ({
    type: 'button',
    // A navigation control is usually an arrow glyph, and a glyph is not a
    // name.
    'aria-label': label || fallback,
    // The real attribute rather than `aria-disabled`, which would leave it
    // pressable: unlike a date, a month button that cannot move is not a fact
    // anyone needs read to them, and taking it out of the tab order is one
    // fewer stop between the user and the grid.
    disabled: isCalendarDisabled() || !monthReachable(months) ? true : undefined,
  });

  return {
    months,
    weekdays,
    visibleMonth,

    selectedDate: () => value.get(),
    selectedRange: () => range.get(),
    focusedDate: () => focused.get(),
    focusedCell: () => cellFor(untrack(() => focused.get())),

    isSelected,
    isDisabled: dateDisabled,
    isToday,
    isRangeStart,
    isRangeEnd,
    isInRange,
    dateLabel,

    select,
    clear,
    focusDate,

    previousMonth: () => shiftMonths(-1),
    nextMonth: () => shiftMonths(1),
    previousYear: () => shiftMonths(-12),
    nextYear: () => shiftMonths(12),
    setVisibleMonth,

    onKeyDown,
    onDayClick,
    onDayPointerOver,
    onPointerLeave,

    calendarProps: () => ({
      id: baseId,
      // A group rather than a region or an application: the months inside are
      // each their own grid, and this only has to hold them together and carry
      // the name that says which date is being chosen.
      role: 'group',
      'aria-labelledby': options.labelledBy,
      'aria-label': options.labelledBy ? undefined : options.label,
      'aria-disabled': isCalendarDisabled() ? 'true' : undefined,
      'data-disabled': isCalendarDisabled() ? '' : undefined,
    }),

    gridProps: (monthIndex = 0) => ({
      role: 'grid',
      // Named by its own heading, which is how the reader is told the month
      // changed when the change came from somewhere other than a cell.
      'aria-labelledby': headingId(monthIndex),
      // A range grid has several dates selected at once, which is the fact
      // `aria-selected="false"` on the rest is only meaningful against.
      'aria-multiselectable': mode === 'range' ? 'true' : undefined,
      'aria-disabled': isCalendarDisabled() ? 'true' : undefined,
      'data-month': monthIndex,
    }),

    headingProps: (monthIndex = 0) => ({ id: headingId(monthIndex) }),

    rowProps: () => ({ role: 'row' }),

    weekdayProps: (weekday) => ({
      role: 'columnheader',
      // The visible text is an abbreviation, and "Mo" is not a word. `abbr` is
      // what a `<th>` carries for this; `aria-label` is what makes it work in
      // markup that is not a table at all, and the two agree.
      abbr: weekday.long,
      'aria-label': weekday.long,
      scope: 'col',
      'data-day-of-week': weekday.dayOfWeek,
    }),

    dayProps: (day) => {
      const date = day.date;
      const disabled = dateDisabled(date);
      const selected = isSelected(date);
      const current = isToday(date);
      const inRange = isInRange(date);

      // The name is the full localised date, plus whatever the cell's own
      // attributes cannot say out loud. `aria-disabled` is announced unevenly
      // across readers and `aria-current="date"` even less so, and both are
      // the difference between a date a user can book and one they cannot.
      const parts = [dateLabel(date)];
      if (current) parts.push(todayLabel());
      if (disabled) parts.push(unavailableLabel());

      return {
        [CALENDAR_DAY_ATTRIBUTE]: toIsoDate(date),
        role: 'gridcell',
        'aria-label': parts.join(', '),
        // In a single-date grid every other cell saying "not selected" is
        // thirty announcements of a fact already known; in a range grid it is
        // what tells the user the cell is part of the interval or not.
        'aria-selected': mode === 'range' ? String(selected) : selected ? 'true' : undefined,
        // Never the `disabled` attribute: an unavailable date stays in the
        // accessibility tree so it can be found and heard to be unavailable
        // rather than appear to have vanished from the month.
        'aria-disabled': disabled ? 'true' : undefined,
        'aria-current': current ? 'date' : undefined,
        tabindex: tabStopKey() === day.key ? '0' : '-1',
        'data-today': current ? '' : undefined,
        'data-selected': selected ? '' : undefined,
        'data-disabled': disabled ? '' : undefined,
        'data-outside-month': day.outsideMonth ? '' : undefined,
        'data-in-range': inRange ? '' : undefined,
        'data-range-start': isRangeStart(date) ? '' : undefined,
        'data-range-end': isRangeEnd(date) ? '' : undefined,
      };
    },

    previousMonthProps: () => navProps(labels.previousMonth ?? '', locale.t('previous'), -1),
    nextMonthProps: () => navProps(labels.nextMonth ?? '', locale.t('next'), 1),
    // Not the month buttons' `previous` and `next`: a calendar that renders all
    // four would have two buttons with one name that do different things.
    previousYearProps: () =>
      navProps(labels.previousYear ?? '', said('previousYear', 'Previous year'), -12),
    nextYearProps: () => navProps(labels.nextYear ?? '', said('nextYear', 'Next year'), 12),
  };
}
