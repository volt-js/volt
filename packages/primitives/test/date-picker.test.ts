/**
 * The typed half of a date, and the two halves together.
 *
 * A segmented field is where a date control is usually got wrong, and the
 * mistakes are invisible from the outside: a field that is one tab stop rather
 * than three, segments that carry a range so the arrows mean something, a
 * value that stays null until every part has been entered rather than
 * reporting a half-typed date, and a hidden input so a plain form post carries
 * something a server can read.
 *
 * `today` is injected rather than read from the clock, so a suite run on the
 * 31st asserts the same thing as one run on the 1st.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { compileTemplate } from '@voltdev/core/jit';
import { Component, Signal, flushSync, mount } from '@voltdev/core';
import { CALENDAR_DAY_ATTRIBUTE, toIsoDate, type PlainDateValue } from '../src/calendar.ts';
import {
  SEGMENT_ATTRIBUTE,
  createDateField,
  createDatePicker,
  createTimePicker,
  type DateField,
  type DatePicker,
  type TimePicker,
} from '../src/date-picker.ts';
import { resetAnnouncer } from '../src/announcer.ts';
import { createLocaleProvider, resetLocaleCaches, type MessageCatalog } from '../src/i18n.ts';

const TODAY: PlainDateValue = { year: 2026, month: 8, day: 12 };

let host: HTMLElement;
let mounted: { unmount(): void }[] = [];
let selectors = 0;
let localeTag: string;
let localeMessages: MessageCatalog;

beforeEach(() => {
  document.documentElement.removeAttribute('lang');
  document.body.innerHTML = '<div id="app"></div>';
  host = document.querySelector('#app')!;
  localeTag = 'en-US';
  localeMessages = {};
  resetLocaleCaches();
});

afterEach(() => {
  for (const handle of mounted) handle.unmount();
  mounted = [];
  flushSync();
  resetAnnouncer();
  resetLocaleCaches();
});

const FIELD_TEMPLATE = `
  <div class="provider" :ref="provider" :spread="locale.providerProps()">
    <form class="form">
      <div class="field" :ref="field" :spread="f.fieldProps()" :keydown="onKey($event)">
        <span :for="seg in f.segments()" :key="seg.key" class="seg"
              :spread="f.segmentProps(seg)">{ seg.text }</span>
      </div>
      <input class="hidden" :spread="f.hiddenInputProps()">
    </form>
  </div>
`;

interface FieldHarness {
  f: DateField;
  root: HTMLElement;
  form(): HTMLFormElement;
  segments(): HTMLElement[];
  segment(type: string): HTMLElement;
  hidden(): HTMLInputElement;
  handled(): boolean;
}

function setupField(options: Record<string, unknown> = {}): FieldHarness {
  @Component({ selector: `v-field-${++selectors}`, render: compileTemplate(FIELD_TEMPLATE) })
  class FieldComponent {
    provider = new Signal.State<Element | null>(null);
    field = new Signal.State<Element | null>(null);
    handled = false;
    locale = createLocaleProvider({
      defaultLocale: localeTag,
      messages: localeMessages,
      element: () => this.provider.get(),
    });
    f = createDateField({
      today: () => TODAY,
      name: 'when',
      ...options,
      field: () => this.field.get(),
    } as Parameters<typeof createDateField>[0]);

    onKey(event: KeyboardEvent): void {
      this.handled = this.f.onKeyDown(event);
      if (this.handled) event.preventDefault();
    }
  }

  const handle = mount(FieldComponent, host);
  mounted.push(handle);
  const instance = handle.instance as unknown as { f: DateField; handled: boolean };

  const segments = (): HTMLElement[] => [
    ...host.querySelectorAll<HTMLElement>(`[${SEGMENT_ATTRIBUTE}]`),
  ];
  return {
    f: instance.f,
    root: host.querySelector<HTMLElement>('.field')!,
    form: () => host.querySelector<HTMLFormElement>('.form')!,
    segments,
    segment: (type) => segments().find((el) => el.dataset.segment === type)!,
    hidden: () => host.querySelector<HTMLInputElement>('.hidden')!,
    handled: () => instance.handled,
  };
}

function press(el: Element, key: string, modifiers: Partial<KeyboardEventInit> = {}): void {
  el.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers }),
  );
  flushSync();
}

function typeInto(el: Element, digits: string): void {
  for (const digit of digits) press(el, digit);
}

describe('the segments a date decomposes into', () => {
  it('takes its order from the locale rather than a constant', () => {
    const us = setupField().segments().map((el) => el.dataset.segment);
    expect(us).toEqual(['month', 'day', 'year']);

    localeTag = 'en-GB';
    resetLocaleCaches();
    const gb = setupField().segments().map((el) => el.dataset.segment);
    expect(gb).toEqual(['day', 'month', 'year']);
  });

  it('shows a placeholder until something is typed, and reads as empty', () => {
    const field = setupField();
    const month = field.segment('month');

    expect(month.getAttribute('aria-valuenow')).toBe(null);
    expect(month.getAttribute('aria-valuetext')).toBe('Empty');
    expect(field.f.isEmpty()).toBe(true);
    expect(field.f.value()).toBe(null);
  });

  it('says an empty segment is empty in the catalogue’s words', () => {
    localeTag = 'fr-FR';
    localeMessages = { empty: 'Vide' };
    const field = setupField();
    expect(field.segment('month').getAttribute('aria-valuetext')).toBe('Vide');
  });

  it('is one tab stop, so Tab enters and leaves the whole field once', () => {
    const field = setupField();
    const stops = field.segments().filter((el) => el.getAttribute('tabindex') === '0');
    expect(stops).toHaveLength(1);
    expect(stops[0]!.dataset.segment).toBe('month');
  });

  it('carries the range the arrows move within', () => {
    const field = setupField();
    const day = field.segment('day');
    expect(day.getAttribute('role')).toBe('spinbutton');
    expect(day.getAttribute('aria-valuemin')).toBe('1');
    expect(day.getAttribute('aria-valuemax')).toBe('31');
  });

  it('carries no inputmode, which a span that is not editable cannot act on', () => {
    // `inputmode` is a hint to the editing host, and a segment is a span
    // driven by `keydown`: a phone opens no keyboard for it however the
    // attribute is set, so writing one is bytes on every segment of every
    // field that buy nothing. Touch entry is a gap, and the page says so.
    const field = setupField();
    for (const segment of field.segments()) expect(segment.hasAttribute('inputmode')).toBe(false);
  });

  it('hides the separators, which would otherwise be read as "slash"', () => {
    const field = setupField();
    const literals = [...field.root.querySelectorAll('.seg')].filter(
      (el) => el.getAttribute('data-segment') === 'literal',
    );
    expect(literals.length).toBeGreaterThan(0);
    for (const literal of literals) expect(literal.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('typing a date', () => {
  it('fills a segment and moves to the next once it cannot take more', () => {
    const field = setupField();
    field.f.focusSegment('month');
    typeInto(field.root, '12');

    expect(field.segment('month').getAttribute('aria-valuenow')).toBe('12');
    // 12 cannot become a two-digit month prefix of anything else, so the
    // caret has already moved on rather than waiting for a separator.
    expect(field.segment('day').getAttribute('tabindex')).toBe('0');
  });

  it('reports no value until every part is there', () => {
    const field = setupField();
    field.f.focusSegment('month');
    typeInto(field.root, '12');
    expect(field.f.value()).toBe(null);

    typeInto(field.root, '25');
    expect(field.f.value()).toBe(null);

    typeInto(field.root, '2026');
    expect(field.f.value()).toEqual({ year: 2026, month: 12, day: 25 });
  });

  it('moves one segment with the arrows, and leaves the others alone', () => {
    const field = setupField({ defaultValue: { year: 2026, month: 8, day: 12 } });
    field.f.focusSegment('day');
    press(field.root, 'ArrowUp');

    expect(field.f.value()).toEqual({ year: 2026, month: 8, day: 13 });
    press(field.root, 'ArrowDown');
    press(field.root, 'ArrowDown');
    expect(field.f.value()).toEqual({ year: 2026, month: 8, day: 11 });
  });

  it('starts an empty year at this one, since no other guess is useful', () => {
    // A year has no natural minimum to start from the way a month has January,
    // so an arrow on an empty one begins at the clock. `today` is injected, so
    // this asserts the same thing whenever it is run.
    const field = setupField();
    field.f.focusSegment('year');
    press(field.root, 'ArrowUp');
    expect(field.segment('year').getAttribute('aria-valuenow')).toBe(String(TODAY.year));
  });

  it('starts an empty month at January, which is its own minimum', () => {
    const field = setupField();
    field.f.focusSegment('month');
    press(field.root, 'ArrowUp');
    expect(field.segment('month').getAttribute('aria-valuenow')).toBe('1');
  });

  it('empties on Delete, and says so', () => {
    const field = setupField({ defaultValue: { year: 2026, month: 8, day: 12 } });
    expect(field.f.isEmpty()).toBe(false);

    field.f.clear();
    flushSync();
    expect(field.f.value()).toBe(null);
    expect(field.f.isEmpty()).toBe(true);
    expect(field.segment('day').getAttribute('aria-valuetext')).toBe('Empty');
  });
});

describe('what a form post carries', () => {
  it('is an ISO date under the name given, not whatever the locale printed', () => {
    const field = setupField({ defaultValue: { year: 2026, month: 8, day: 12 } });
    const hidden = field.hidden();

    expect(hidden.getAttribute('name')).toBe('when');
    expect(hidden.getAttribute('value')).toBe(toIsoDate({ year: 2026, month: 8, day: 12 }));
    expect(new FormData(field.form()).get('when')).toBe('2026-08-12');
    // Out of sight, out of Tab and out of the accessibility tree: the segments
    // are the control, and announcing both would announce the field twice.
    expect(hidden.getAttribute('aria-hidden')).toBe('true');
    expect(hidden.getAttribute('tabindex')).toBe('-1');
  });

  it('is empty while the date is incomplete', () => {
    expect(setupField().hidden().getAttribute('value')).toBe('');
  });

  it('is left out of the submission entirely when the field is disabled', () => {
    const field = setupField({
      defaultValue: { year: 2026, month: 8, day: 12 },
      disabled: () => true,
    });
    expect(field.hidden().hasAttribute('disabled')).toBe(true);
  });

  it('carries no name when it was given none, rather than the name "undefined"', () => {
    // `name` is a property on an input, and the spread assigns properties:
    // an undefined written to it becomes the string, and the form posts the
    // date under a key nobody chose.
    const field = setupField({ name: undefined, defaultValue: { year: 2026, month: 8, day: 12 } });
    expect(field.hidden().hasAttribute('name')).toBe(false);
    expect([...new FormData(field.form()).keys()]).toEqual([]);
  });

  it('keeps a required form from submitting while the date is missing', () => {
    // An `<input type="hidden">` is barred from constraint validation, so a
    // `required` written to one is a promise the platform never keeps.
    const field = setupField({ required: () => true });
    expect(field.form().checkValidity()).toBe(false);

    field.f.setValue({ year: 2026, month: 8, day: 12 });
    flushSync();
    expect(field.form().checkValidity()).toBe(true);
    expect(new FormData(field.form()).get('when')).toBe('2026-08-12');
  });

  it('lets a form through when the missing date is not the user’s to enter', () => {
    // A read-only field cannot be filled in, and a disabled one is not part of
    // the form: holding the submit on either would be a trap.
    expect(setupField({ required: () => true, readOnly: () => true }).form().checkValidity()).toBe(
      true,
    );
    expect(setupField({ required: () => true, disabled: () => true }).form().checkValidity()).toBe(
      true,
    );
  });

  it('goes on following the segments after something has written to the input', () => {
    // Autofill, a restored back/forward form and a keystroke all write the
    // value property, and from then on the input holds what was written to it
    // rather than what its attribute says.
    const field = setupField({ defaultValue: { year: 2026, month: 8, day: 12 } });
    field.hidden().value = 'whatever the browser put here';

    field.f.setValue({ year: 2026, month: 9, day: 1 });
    flushSync();
    expect(field.hidden().value).toBe('2026-09-01');
    expect(new FormData(field.form()).get('when')).toBe('2026-09-01');
  });

  it('carries the date under the name a server writes it out as', () => {
    // The server writes every key in the bag as an attribute under its own
    // name, and HTML has no `defaultValue` attribute: a page rendered without
    // it posts an empty date, and holds a `required` form back over a field
    // the user can see is filled in.
    const field = setupField({ defaultValue: { year: 2026, month: 8, day: 12 } });
    expect(field.f.hiddenInputProps().value).toBe('2026-08-12');
  });

  it('sends focus the platform puts on the input to a segment', () => {
    // A blocked submit focuses the control it is holding, which here is a
    // clipped pixel: the caret would be invisible and the digits typed into it
    // would reach the form rather than the date.
    const field = setupField({ required: () => true });
    field.hidden().focus();
    flushSync();

    expect(document.activeElement).toBe(field.segments()[0]);
  });

  it('keeps the date through a form reset, as the segments do', () => {
    const field = setupField({ defaultValue: { year: 2026, month: 8, day: 12 } });
    field.f.setValue({ year: 2026, month: 9, day: 1 });
    flushSync();

    // A reset puts every text input back on its default, and nothing about
    // the segments' state changes to write it again.
    field.form().reset();
    flushSync();
    expect(field.f.value()).toEqual({ year: 2026, month: 9, day: 1 });
    expect(new FormData(field.form()).get('when')).toBe('2026-09-01');
  });
});

describe('a required date', () => {
  it('says so on every segment, since the group around them cannot', () => {
    const field = setupField({ required: () => true });
    const segments = field.segments();
    expect(segments.length).toBeGreaterThan(0);
    for (const segment of segments) expect(segment.getAttribute('aria-required')).toBe('true');

    const optional = setupField();
    expect(optional.segments().some((el) => el.hasAttribute('aria-required'))).toBe(false);
  });
});

const TIME_TEMPLATE = `
  <div class="provider" :ref="provider" :spread="locale.providerProps()">
    <div class="field" :ref="field" :spread="t.fieldProps()" :keydown="onKey($event)">
      <span :for="seg in t.segments()" :key="seg.key" class="seg"
            :spread="t.segmentProps(seg)">{ seg.text }</span>
    </div>
  </div>
`;

function setupTime(options: Record<string, unknown> = {}): { t: TimePicker; root: HTMLElement } {
  @Component({ selector: `v-time-${++selectors}`, render: compileTemplate(TIME_TEMPLATE) })
  class TimeComponent {
    provider = new Signal.State<Element | null>(null);
    field = new Signal.State<Element | null>(null);
    locale = createLocaleProvider({
      defaultLocale: localeTag,
      messages: localeMessages,
      element: () => this.provider.get(),
    });
    t = createTimePicker({ ...options, field: () => this.field.get() } as Parameters<
      typeof createTimePicker
    >[0]);

    onKey(event: KeyboardEvent): void {
      if (this.t.onKeyDown(event)) event.preventDefault();
    }
  }
  const handle = mount(TimeComponent, host);
  mounted.push(handle);
  return {
    t: (handle.instance as unknown as { t: TimePicker }).t,
    root: host.querySelector<HTMLElement>('.field')!,
  };
}

describe('a time', () => {
  it('takes its clock from the locale, so en-US gets a day period', () => {
    const us = setupTime();
    expect(us.root.querySelector(`[data-segment='dayPeriod']`)).not.toBe(null);

    localeTag = 'en-GB';
    resetLocaleCaches();
    const gb = setupTime();
    expect(gb.root.querySelector(`[data-segment='dayPeriod']`)).toBe(null);
  });

  it('reports the hour a reader sees rather than the one it stores', () => {
    const time = setupTime({ defaultValue: { hour: 13, minute: 5 } });
    const hour = time.root.querySelector(`[data-segment='hour']`)!;
    // A 12-hour clock shows 1, and the value underneath is still 13.
    expect(hour.getAttribute('aria-valuenow')).toBe('1');
    expect(time.t.value()).toEqual({ hour: 13, minute: 5, second: 0 });
  });

  it('wraps rather than stopping at the end of the range', () => {
    const time = setupTime({ defaultValue: { hour: 23, minute: 59 } });
    time.t.focusSegment('minute');
    press(time.root, 'ArrowUp');
    expect(time.t.value()?.minute).toBe(0);
  });

  it('pages the minutes by a quarter hour in whole steps, whatever the step is', () => {
    // A page is a quarter hour, and a step is `minuteStep`: fifteen steps of
    // fifteen minutes is 225, which lands 45 minutes on, and fifteen of twenty
    // goes all the way round the hour and changes nothing.
    const paged = (minuteStep: number, key: string): number | undefined => {
      const time = setupTime({ minuteStep, defaultValue: { hour: 9, minute: 0 } });
      time.t.focusSegment('minute');
      press(time.root, key);
      return time.t.value()?.minute;
    };

    expect(paged(1, 'PageUp')).toBe(15);
    expect(paged(5, 'PageUp')).toBe(15);
    expect(paged(15, 'PageUp')).toBe(15);
    expect(paged(15, 'PageDown')).toBe(45);
    // A step longer than a quarter hour pages by one step, never by none.
    expect(paged(20, 'PageUp')).toBe(20);
    expect(paged(20, 'PageDown')).toBe(40);
  });
});

const PICKER_TEMPLATE = `
  <div class="provider" :ref="provider" :spread="locale.providerProps()">
    <div class="field" :ref="field" :spread="p.field.fieldProps()" :keydown="onKey($event)">
      <span :for="seg in p.field.segments()" :key="seg.key" class="seg"
            :spread="p.field.segmentProps(seg)">{ seg.text }</span>
    </div>
    <button class="trigger" :spread="p.triggerProps()">open</button>
    <div class="pop" :if="p.isOpen()" :ref="content" :spread="p.contentProps()">
      <div class="cal" :ref="cal" :spread="p.calendar.calendarProps()"
           :click="p.calendar.onDayClick($event)">
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

function setupPicker(options: Record<string, unknown> = {}): { p: DatePicker; root: HTMLElement } {
  @Component({ selector: `v-picker-${++selectors}`, render: compileTemplate(PICKER_TEMPLATE) })
  class PickerComponent {
    provider = new Signal.State<Element | null>(null);
    field = new Signal.State<Element | null>(null);
    content = new Signal.State<Element | null>(null);
    cal = new Signal.State<Element | null>(null);
    locale = createLocaleProvider({
      defaultLocale: localeTag,
      messages: localeMessages,
      element: () => this.provider.get(),
    });
    p = createDatePicker({
      today: () => TODAY,
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
  return {
    p: (handle.instance as unknown as { p: DatePicker }).p,
    root: host.querySelector<HTMLElement>('.field')!,
  };
}

describe('the two halves together', () => {
  it('opens the grid with Alt and ArrowDown, which is what a native input does', () => {
    const picker = setupPicker();
    expect(picker.p.isOpen()).toBe(false);

    press(picker.root, 'ArrowDown', { altKey: true });
    expect(picker.p.isOpen()).toBe(true);
  });

  it('opens and closes from its button, whose handlers come in with its props', () => {
    const picker = setupPicker();
    const trigger = host.querySelector<HTMLElement>('.trigger')!;

    trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    flushSync();
    expect(picker.p.isOpen()).toBe(true);

    // The bag's click toggles. A `:click` of the consumer's own that opened as
    // well would reopen it on this same press, and the button could never
    // close the calendar it opened.
    trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    flushSync();
    expect(picker.p.isOpen()).toBe(false);
  });

  it('does not open a read-only picker from the keyboard, as its button does not', () => {
    const picker = setupPicker({
      readOnly: () => true,
      defaultValue: { year: 2026, month: 8, day: 12 },
    });
    expect(host.querySelector('.trigger')!.hasAttribute('disabled')).toBe(true);

    // The grid behind it answers no keys and takes no presses, so a popover
    // over it would be a calendar nobody can use.
    press(picker.root, 'ArrowDown', { altKey: true });
    expect(picker.p.isOpen()).toBe(false);

    // Every other key still reaches the field: read-only segments can be
    // moved between, and read.
    picker.p.field.focusSegment('month');
    press(picker.root, 'ArrowRight');
    const day = picker.root.querySelector(`[${SEGMENT_ATTRIBUTE}="day"]`)!;
    expect(day.getAttribute('tabindex')).toBe('0');
  });

  it('reaches both halves from one value, so neither can drift from the other', () => {
    const picker = setupPicker();
    picker.p.setValue({ year: 2026, month: 8, day: 12 });
    flushSync();

    expect(picker.p.field.value()).toEqual({ year: 2026, month: 8, day: 12 });
    expect(picker.p.calendar.selectedDate()).toEqual({ year: 2026, month: 8, day: 12 });
    expect(picker.p.value()).toEqual({ year: 2026, month: 8, day: 12 });
  });

  it('names its trigger, which is usually a glyph, out of the catalogue', () => {
    setupPicker();
    const trigger = () => [...host.querySelectorAll('.trigger')].at(-1)!;
    expect(trigger().getAttribute('aria-label')).toBe('Choose date');

    localeTag = 'fr-FR';
    localeMessages = { chooseDate: 'Choisir une date' };
    setupPicker();
    expect(trigger().getAttribute('aria-label')).toBe('Choisir une date');
  });

  it('opens the grid inside the bounds when today is outside them', () => {
    const picker = setupPicker({ min: () => ({ year: 2026, month: 9, day: 1 }) });
    picker.p.open();
    flushSync();

    // Nothing is chosen and today is in August, before `min`. A month of
    // unavailable cells with the tab stop on one of them is the one place the
    // grid promises a date outside the bounds is never reached.
    expect(picker.p.calendar.focusedDate()).toEqual({ year: 2026, month: 9, day: 1 });
    expect(picker.p.calendar.visibleMonth()).toEqual({ year: 2026, month: 9 });
    const stop = host.querySelector<HTMLElement>('.day[tabindex="0"]')!;
    expect(stop.getAttribute('aria-disabled')).toBeNull();
  });

  it('opens a typed date outside the bounds on the nearest date inside them', () => {
    const picker = setupPicker({ max: () => ({ year: 2026, month: 8, day: 20 }) });
    // The field takes no bounds, so this is a value it will hold.
    picker.p.setValue({ year: 2026, month: 12, day: 25 });
    flushSync();
    picker.p.open();
    flushSync();

    expect(picker.p.calendar.focusedDate()).toEqual({ year: 2026, month: 8, day: 20 });
    const stop = host.querySelector<HTMLElement>('.day[tabindex="0"]')!;
    expect(stop.getAttribute(CALENDAR_DAY_ATTRIBUTE)).toBe('2026-08-20');
    expect(stop.getAttribute('aria-disabled')).toBeNull();
  });

  it('marks a date typed outside the bounds invalid, since it still becomes the value', () => {
    const picker = setupPicker({ min: () => ({ year: 2026, month: 9, day: 1 }) });
    const invalidSegments = (): (string | null)[] =>
      [...picker.root.querySelectorAll(`[${SEGMENT_ATTRIBUTE}]`)].map((el) =>
        el.getAttribute('aria-invalid'),
      );

    picker.p.field.focusSegment('month');
    typeInto(picker.root, '01052020');
    expect(picker.p.value()).toEqual({ year: 2020, month: 1, day: 5 });

    // A field that refused the keystroke could not be typed into — every year
    // before 2026 is a prefix of one — and one that rewrote the date would
    // post something nobody entered. Saying it is wrong is what is left.
    expect(invalidSegments()).toEqual(['true', 'true', 'true']);
    expect(picker.root.hasAttribute('data-invalid')).toBe(true);

    picker.p.setValue({ year: 2026, month: 9, day: 2 });
    flushSync();
    expect(invalidSegments()).toEqual([null, null, null]);
    expect(picker.root.hasAttribute('data-invalid')).toBe(false);
  });

  it('carries a date typed in the field through to the grid', () => {
    const picker = setupPicker();
    picker.p.field.setValue({ year: 2026, month: 12, day: 25 });
    flushSync();
    expect(picker.p.calendar.selectedDate()).toEqual({ year: 2026, month: 12, day: 25 });
  });
});
