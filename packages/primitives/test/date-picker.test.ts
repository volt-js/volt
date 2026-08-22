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
import { toIsoDate, type PlainDateValue } from '../src/calendar.ts';
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
import { createLocaleProvider, resetLocaleCaches } from '../src/i18n.ts';

const TODAY: PlainDateValue = { year: 2026, month: 8, day: 12 };

let host: HTMLElement;
let mounted: { unmount(): void }[] = [];
let selectors = 0;
let localeTag: string;

beforeEach(() => {
  document.documentElement.removeAttribute('lang');
  document.body.innerHTML = '<div id="app"></div>';
  host = document.querySelector('#app')!;
  localeTag = 'en-US';
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
    <div class="field" :ref="field" :spread="f.fieldProps()" :keydown="onKey($event)">
      <span :for="seg in f.segments()" :key="seg.key" class="seg"
            :spread="f.segmentProps(seg)">{ seg.text }</span>
    </div>
    <input class="hidden" :spread="f.hiddenInputProps()">
  </div>
`;

interface FieldHarness {
  f: DateField;
  root: HTMLElement;
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
      messages: {},
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

    expect(hidden.getAttribute('type')).toBe('hidden');
    expect(hidden.getAttribute('name')).toBe('when');
    expect(hidden.getAttribute('value')).toBe(toIsoDate({ year: 2026, month: 8, day: 12 }));
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
      messages: {},
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
});

const PICKER_TEMPLATE = `
  <div class="provider" :ref="provider" :spread="locale.providerProps()">
    <div class="field" :ref="field" :spread="p.field.fieldProps()" :keydown="onKey($event)">
      <span :for="seg in p.field.segments()" :key="seg.key" class="seg"
            :spread="p.field.segmentProps(seg)">{ seg.text }</span>
    </div>
    <button class="trigger" :spread="p.triggerProps()" :click="p.open()">open</button>
    <div class="pop" :if="p.isOpen()" :ref="content" :spread="p.contentProps()">
      <div class="cal" :ref="cal" :spread="p.calendar.calendarProps()"
           :click="p.calendar.onDayClick($event)">
        <div :for="month in p.calendar.months()" :key="month.index">
          <table :spread="p.calendar.gridProps(month.index)">
            <tbody>
              <tr :for="week in month.weeks" :key="week.key" :spread="p.calendar.rowProps()">
                <td class="day" :for="day in week.days" :key="day.key"
                    :spread="p.calendar.dayProps(day)">{ day.label }</td>
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
      messages: {},
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

  it('reaches both halves from one value, so neither can drift from the other', () => {
    const picker = setupPicker();
    picker.p.setValue({ year: 2026, month: 8, day: 12 });
    flushSync();

    expect(picker.p.field.value()).toEqual({ year: 2026, month: 8, day: 12 });
    expect(picker.p.calendar.selectedDate()).toEqual({ year: 2026, month: 8, day: 12 });
    expect(picker.p.value()).toEqual({ year: 2026, month: 8, day: 12 });
  });

  it('carries a date typed in the field through to the grid', () => {
    const picker = setupPicker();
    picker.p.field.setValue({ year: 2026, month: 12, day: 25 });
    flushSync();
    expect(picker.p.calendar.selectedDate()).toEqual({ year: 2026, month: 12, day: 25 });
  });
});
