/**
 * Date and time entry — the field you type into, and the picker around it.
 *
 * A calendar alone is not a date input. Someone entering a birth date does not
 * want to page back four hundred months, and someone who already knows the
 * date wants to type it; the grid is for choosing, and the field is for
 * saying. So there are three things here: a field made of segments, a time
 * field made the same way, and a picker that is a field with a calendar behind
 * a popover.
 *
 * **A segmented field, not a masked text input.** A text input holding
 * "03/04/2026" cannot say whether that is March or April, cannot be arrowed,
 * and announces the whole string every time one character changes. So each
 * part is its own `spinbutton` — the model `<input type="date">` itself uses —
 * and the parts, their order and the separators between them all come from
 * `Intl.DateTimeFormat.formatToParts`, which is the only thing that knows that
 * Japanese writes the year first and Arabic writes the day first with a
 * right-to-left mark in between.
 *
 *   class Booking {
 *     field = new Signal.State<Element | null>(null);
 *     date = createDateField({ field: () => this.field.get(), label: 'Arrival' });
 *   }
 *
 *   <div :ref="field" :spread="date.fieldProps()" :keydown="onKey($event)">
 *     <span :for="seg in date.segments()" :key="seg.key"
 *           :spread="date.segmentProps(seg)">{ seg.text }</span>
 *   </div>
 *
 * The keyboard map is what a native date input does:
 *
 *   ArrowUp, ArrowDown         one step on this segment, wrapping at its ends
 *   PageUp, PageDown           a larger step — a quarter hour, a week, a decade
 *   ArrowLeft, ArrowRight      the previous, next segment — mirrored under RTL
 *   Home, End                  this segment's smallest, largest value
 *   0-9                        type into the segment, moving on when it is full
 *   a, p                       morning or afternoon, where there is a period
 *   Backspace, Delete          empty this segment
 *
 * **Half a date is not a date.** The segments hold their own partial state, and
 * the value stays null until every one of them has been given something. That
 * is why the segments are the state here and the composed value is derived
 * from them rather than the other way round: a value cannot represent "the
 * user has typed the month and is still typing the day", and a field that
 * cannot represent that either eats the first keystroke of every entry.
 *
 * **The picker is one value with two editors.** `createDatePicker` hands the
 * same signal to the field and to the calendar, so typing moves the grid and
 * choosing in the grid fills the segments, and neither has to know about the
 * other. See `calendar.ts` for the grid itself, and for why the dates here are
 * plain `{ year, month, day }` records that a `Temporal.PlainDate` satisfies.
 */

import { Signal, effect, onCleanup } from '@voltdev/core';
import { VISUALLY_HIDDEN_INPUT_STYLE } from './form-controls.js';
import { createId } from './id.js';
import { getDateTimeFormat, getNumberFormat, resolveDirection, useLocale } from './i18n.js';
import {
  clampDate,
  compareDates,
  createCalendar,
  daysInMonth,
  toIsoDate,
  today as todayInZone,
  type Calendar,
  type CalendarLabels,
  type PlainDateValue,
  type PlainTimeValue,
} from './calendar.js';
import {
  createPopover,
  type Popover,
  type PopoverPlacement,
  type PopoverProps,
} from './popover.js';

const { untrack } = Signal.subtle;

/**
 * Marks an editable segment and names the field it edits.
 *
 * The field name rather than a position, because a pattern is rebuilt whenever
 * the locale changes and every position in it moves: Japanese writes the year
 * first, so the segment at index 0 is a different field in two languages while
 * "the year segment" is the same one in both.
 */
export const SEGMENT_ATTRIBUTE = 'data-volt-segment';

/** The fields a segmented field can be made of, plus the text between them. */
export type DateSegmentType =
  | 'year'
  | 'month'
  | 'day'
  | 'hour'
  | 'minute'
  | 'second'
  | 'dayPeriod'
  | 'literal';

/** The editable ones. A literal is a separator nobody can focus. */
type EditableSegmentType = Exclude<DateSegmentType, 'literal'>;

/**
 * How far one press of PageUp or PageDown moves each field.
 *
 * Chosen to be the unit a person actually thinks in — a quarter of an hour, a
 * week, a quarter of a year, a decade — rather than a round number of steps.
 * A distance in the field's own unit, which a stepped field rounds to whole
 * steps; see `pageUnits`.
 */
const PAGE_STEPS: Readonly<Record<EditableSegmentType, number>> = {
  year: 10,
  month: 3,
  day: 7,
  hour: 2,
  minute: 15,
  second: 15,
  dayPeriod: 1,
};

export interface DateSegment {
  readonly type: DateSegmentType;
  /** Stable across renders, for a `:for` key. */
  readonly key: string;
  /** Position in the pattern, counting literals. */
  readonly index: number;
  /** What to render: the formatted value, or the placeholder. */
  readonly text: string;
  readonly isEditable: boolean;
  /** Nothing has been entered here yet, so `text` is the placeholder. */
  readonly isPlaceholder: boolean;
  /** In display units, so a 12-hour clock reports 1-12 and not 13-23. */
  readonly value: number | null;
  readonly min: number;
  readonly max: number;
}

export interface SegmentedFieldLabels {
  /**
   * The visible stand-in for a segment nothing has been typed into. Defaults
   * to a run of dashes as wide as the segment.
   */
  placeholder?: (type: EditableSegmentType, width: number) => string;
  /**
   * The accessible name of a segment. Defaults to the locale's own name for
   * the field, from `Intl.DisplayNames`.
   */
  segment?: (type: EditableSegmentType) => string;
  /** What an empty segment reads as. Defaults to the locale's `empty`, then "Empty". */
  empty?: string;
}

export type SegmentedFieldPropValue =
  | string
  | number
  | boolean
  | undefined
  | Readonly<Record<string, string>>
  | ((event: KeyboardEvent) => void)
  | (() => void);

export interface SegmentedFieldProps {
  readonly [key: string]: SegmentedFieldPropValue;
}

/** The half of a segmented field that a date and a time have in common. */
export interface SegmentedField<T> {
  value(): T | null;
  segments(): readonly DateSegment[];
  isEmpty(): boolean;
  setValue(value: T | null): void;
  clear(): void;
  /** Put DOM focus on a segment — the first editable one by default. */
  focusSegment(type?: EditableSegmentType): void;
  /** Handle a keydown. Returns true when it was consumed. */
  onKeyDown(event: KeyboardEvent): boolean;
  fieldProps(): SegmentedFieldProps;
  segmentProps(segment: DateSegment): SegmentedFieldProps;
  /**
   * A visually hidden `<input>` carrying the ISO value, for a plain form post,
   * and the control the platform validates when the field is `required`.
   */
  hiddenInputProps(): SegmentedFieldProps;
}

// ---------------------------------------------------------------------------
// The segment engine
// ---------------------------------------------------------------------------

/** What one segment can hold, in display units. */
interface FieldRange {
  readonly min: number;
  readonly max: number;
  /** How many digits may be typed into it. */
  readonly digits: number;
  /** What an arrow press means when the segment is still empty. */
  readonly blank: number;
  /** How far one arrow press moves. One unless the field is stepped. */
  readonly step?: number;
}

type Parts = Readonly<Partial<Record<EditableSegmentType, number>>>;

interface SegmentedConfig<T> {
  /** Prefix for generated ids, and the id of the whole field. */
  kind: string;
  /** What to ask `Intl` for, which decides the fields and their order. */
  formatOptions: Intl.DateTimeFormatOptions;
  /** The range of a field, given whatever else has been entered so far. */
  rangeOf(type: EditableSegmentType, parts: Parts): FieldRange;
  /** A value, or null while any field is still empty. */
  compose(parts: Parts): T | null;
  decompose(value: T): Parts;
  same(a: T | null, b: T | null): boolean;
  /** What a plain form post would carry. */
  serialize(value: T): string;
}

/**
 * Names for the fields, in the locale's own language.
 *
 * Cached against the tag because the answer is a property of the language,
 * like the first day of the week in `calendar.ts` and unlike the formatters in
 * `i18n.ts`, whose cache is bounded because their keys come from data.
 */
const fieldNames = new Map<string, Intl.DisplayNames>();

function fieldNamesFor(locale: string): Intl.DisplayNames {
  let names = fieldNames.get(locale);
  if (!names) {
    names = new Intl.DisplayNames(locale, { type: 'dateTimeField' });
    fieldNames.set(locale, names);
  }
  return names;
}

const EDITABLE: ReadonlySet<string> = new Set<DateSegmentType>([
  'year',
  'month',
  'day',
  'hour',
  'minute',
  'second',
  'dayPeriod',
]);

interface PatternPart {
  readonly type: DateSegmentType;
  /** Literals only. */
  readonly text: string;
}

function createSegmentedField<T>(
  options: {
    field: () => Element | null | undefined;
    value?: Signal.State<T | null>;
    defaultValue?: T | null;
    disabled?: () => boolean;
    readOnly?: () => boolean;
    required?: () => boolean;
    name?: string;
    label?: string;
    labelledBy?: string;
    describedBy?: string;
    labels?: SegmentedFieldLabels;
    /** Whether the value the segments compose is one the caller refuses. */
    invalid?: (value: T | null) => boolean;
    onChange?: (value: T | null) => void;
  },
  config: SegmentedConfig<T>,
): SegmentedField<T> {
  const locale = useLocale();
  const baseId = createId(config.kind);
  const labels = options.labels ?? {};
  const emptyLabel = (): string =>
    labels.empty ?? (locale.has('empty') ? locale.t('empty') : 'Empty');

  const value = options.value ?? new Signal.State<T | null>(options.defaultValue ?? null);
  const parts = new Signal.State<Parts>(
    untrack(() => {
      const initial = value.get();
      return initial === null ? {} : config.decompose(initial);
    }),
  );

  const isDisabled = (): boolean => options.disabled?.() ?? false;
  const isReadOnly = (): boolean => options.readOnly?.() ?? false;
  // Read off the segments rather than off the value signal, so what is judged
  // is the date on screen. A field nobody refuses anything for composes
  // nothing at all: an optional call evaluates no argument.
  const isInvalid = (): boolean => options.invalid?.(config.compose(parts.get())) ?? false;

  /**
   * A value handed in from outside becomes segments.
   *
   * Guarded on the composed value rather than run unconditionally, because
   * this effect and `commit` write the two halves of the same fact: without
   * the guard, typing a digit writes the value, the value writes the segments
   * back, and a half-typed segment is erased under the user's hands.
   */
  effect(() => {
    const external = value.get();
    const composed = untrack(() => config.compose(parts.get()));
    if (config.same(external, composed)) return;
    parts.set(external === null ? {} : config.decompose(external));
  });

  const commit = (next: Parts): void => {
    parts.set(next);
    const composed = config.compose(next);
    if (config.same(composed, untrack(() => value.get()))) return;
    value.set(composed);
    options.onChange?.(composed);
  };

  // --- The pattern ---------------------------------------------------------

  /**
   * The fields and separators the locale writes, in the order it writes them.
   *
   * Read from `formatToParts` rather than from a pattern string, because the
   * separators are not always what they look like: Arabic puts a
   * right-to-left mark either side of its slashes, and dropping it reorders
   * the field on screen.
   */
  const pattern = (): readonly PatternPart[] =>
    getDateTimeFormat(locale.code(), config.formatOptions)
      // The epoch itself: any instant works, since only the shape is wanted.
      .formatToParts(0)
      .map((part) => ({
        type: EDITABLE.has(part.type) ? (part.type as DateSegmentType) : 'literal',
        text: part.value,
      }));

  const editableTypes = (): readonly EditableSegmentType[] =>
    pattern()
      .filter((part) => part.type !== 'literal')
      .map((part) => part.type as EditableSegmentType);

  // --- Formatting a segment ------------------------------------------------

  const digitsFor = (width: number): Intl.NumberFormat =>
    getNumberFormat(locale.code(), { minimumIntegerDigits: width, useGrouping: false });

  /**
   * The two period names, taken from the formatter rather than written down.
   *
   * A locale that has no `dayPeriod` in its pattern never reaches this, and a
   * locale that does may not call them AM and PM — Japanese says 午前 and 午後.
   */
  const periodNames = (): readonly [string, string] => {
    const format = getDateTimeFormat(locale.code(), {
      timeZone: 'UTC',
      hour: 'numeric',
      hour12: true,
    });
    const read = (ms: number): string =>
      format.formatToParts(ms).find((part) => part.type === 'dayPeriod')?.value ?? '';
    // 06:00 and 18:00 UTC, which are unambiguously either side of noon.
    return [read(6 * 3_600_000), read(18 * 3_600_000)];
  };

  const placeholderFor = (type: EditableSegmentType, width: number): string => {
    if (labels.placeholder) return labels.placeholder(type, width);
    return '-'.repeat(width);
  };

  const nameFor = (type: EditableSegmentType): string => {
    if (labels.segment) return labels.segment(type);
    return fieldNamesFor(locale.code()).of(type) ?? type;
  };

  const textFor = (type: EditableSegmentType, entered: number | undefined): string => {
    const range = config.rangeOf(type, untrack(() => parts.get()));
    if (type === 'dayPeriod') {
      const [am, pm] = periodNames();
      return entered === undefined ? placeholderFor(type, 2) : entered === 0 ? am : pm;
    }
    if (entered === undefined) return placeholderFor(type, range.digits);
    return digitsFor(range.digits).format(entered);
  };

  const segments = (): readonly DateSegment[] => {
    const current = parts.get();
    return pattern().map((part, index) => {
      if (part.type === 'literal') {
        return {
          type: 'literal' as const,
          key: `l${index}`,
          index,
          text: part.text,
          isEditable: false,
          isPlaceholder: false,
          value: null,
          min: 0,
          max: 0,
        };
      }

      const type = part.type as EditableSegmentType;
      const range = config.rangeOf(type, current);
      const entered = current[type];
      return {
        type,
        key: `${type}${index}`,
        index,
        text: textFor(type, entered),
        isEditable: true,
        isPlaceholder: entered === undefined,
        value: entered ?? null,
        min: range.min,
        max: range.max,
      };
    });
  };

  // --- Which segment the keyboard is on ------------------------------------

  const focusedType = new Signal.State<EditableSegmentType | null>(null);

  const elementFor = (type: EditableSegmentType): HTMLElement | null => {
    const root = options.field();
    if (!root) return null;
    // The attribute value is a field name this module owns, so it needs no
    // escaping — and escaping would pull in `CSS`, which a server lacks.
    return root.querySelector<HTMLElement>(`[${SEGMENT_ATTRIBUTE}="${type}"]`);
  };

  /**
   * DOM focus is what decides which segment is current, not the other way
   * round: a click lands on a `tabindex="-1"` segment without going through
   * any handler here, and a field whose own idea of "current" ignored that
   * would arrow away from whatever the user just clicked.
   */
  effect(() => {
    const root = options.field();
    if (!root) return;

    const onFocusIn = (event: Event): void => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const type = target
        .closest(`[${SEGMENT_ATTRIBUTE}]`)
        ?.getAttribute(SEGMENT_ATTRIBUTE) as EditableSegmentType | null | undefined;
      if (type) {
        typed = '';
        focusedType.set(type);
      }
    };

    root.addEventListener('focusin', onFocusIn);
    onCleanup(() => root.removeEventListener('focusin', onFocusIn));
  });

  /** The segment the keyboard acts on, falling back to the first one. */
  const currentType = (): EditableSegmentType | null => {
    const held = untrack(() => focusedType.get());
    const order = editableTypes();
    if (held && order.includes(held)) return held;
    return order[0] ?? null;
  };

  /** Which segment holds the field's single tab stop. */
  const tabStopType = (): EditableSegmentType | null => {
    const held = focusedType.get();
    const order = editableTypes();
    if (held && order.includes(held)) return held;
    return order[0] ?? null;
  };

  const focusSegment = (type?: EditableSegmentType): void => {
    const order = editableTypes();
    const wanted = type && order.includes(type) ? type : order[0];
    if (!wanted) return;
    focusedType.set(wanted);
    typed = '';
    elementFor(wanted)?.focus();
  };

  const moveSegment = (delta: number): void => {
    const order = editableTypes();
    const from = currentType();
    if (!from) return;
    const next = order[order.indexOf(from) + delta];
    if (next) focusSegment(next);
  };

  // --- Editing -------------------------------------------------------------

  /** Digits typed into the current segment since it was last entered. */
  let typed = '';

  const setField = (type: EditableSegmentType, entered: number | undefined): void => {
    const current = untrack(() => parts.get());
    const next: Record<string, number> = { ...current };
    if (entered === undefined) delete next[type];
    else next[type] = entered;

    // A day that no longer exists in the month just chosen — 31 with February
    // — is clamped rather than left to compose a date that is not a date.
    const day = next['day'];
    if (day !== undefined && (type === 'month' || type === 'year')) {
      const range = config.rangeOf('day', next);
      if (day > range.max) next['day'] = range.max;
    }
    commit(next);
  };

  /**
   * One press of an arrow or a page key.
   *
   * `unit` is how many of the field's own steps to move, so PageUp is the same
   * code path as ArrowUp with a bigger number. Wrapping is deliberate: a
   * minute field that stops at 59 makes 23:59 to 00:00 impossible without
   * reaching for the hour, and every native time input wraps.
   */
  const step = (type: EditableSegmentType, units: number): void => {
    const current = untrack(() => parts.get());
    const range = config.rangeOf(type, current);
    const entered = current[type];
    if (entered === undefined) {
      setField(type, range.blank);
      return;
    }
    const delta = units * (range.step ?? 1);
    const span = range.max - range.min + 1;
    setField(type, range.min + ((((entered + delta - range.min) % span) + span) % span));
  };

  /**
   * One page, counted in the field's own steps: the distance `PAGE_STEPS`
   * names, rounded to a whole number of steps and never fewer than one.
   * Counting the distance itself as steps would page fifteen `minuteStep`s at
   * a time — 45 minutes on with a step of 15, and all the way round the hour
   * to where it started with a step of 20.
   */
  const pageUnits = (type: EditableSegmentType): number => {
    const size = config.rangeOf(type, untrack(() => parts.get())).step ?? 1;
    return Math.max(1, Math.round(PAGE_STEPS[type] / size));
  };

  const typeDigit = (type: EditableSegmentType, digit: number): void => {
    const current = untrack(() => parts.get());
    const range = config.rangeOf(type, current);
    const buffer = typed + String(digit);
    let entered = Number(buffer);

    // Typing past the top of the range starts a fresh number rather than
    // refusing the key: 1 then 9 in a month is not September, it is the 9th.
    if (entered > range.max) {
      typed = String(digit);
      entered = digit;
    } else {
      typed = buffer;
    }

    // Below the minimum is not a value yet — a lone 0 in a month field — so
    // the segment waits for the next digit rather than showing something the
    // user did not type.
    if (entered >= range.min) setField(type, entered);

    if (typed.length >= range.digits || entered * 10 > range.max) {
      typed = '';
      moveSegment(1);
    }
  };

  const onKeyDown = (event: KeyboardEvent): boolean => {
    if (isDisabled()) return false;
    // Alt and the platform modifier belong to whatever wraps this: Alt+Down
    // opens the picker's calendar, and Ctrl+Arrow is a caret move.
    if (event.altKey || event.ctrlKey || event.metaKey) return false;

    const type = currentType();
    if (!type) return false;

    const rtl = resolveDirection(options.field()) === 'rtl';
    const editable = !isReadOnly();

    switch (event.key) {
      case 'ArrowRight':
        moveSegment(rtl ? -1 : 1);
        return true;
      case 'ArrowLeft':
        moveSegment(rtl ? 1 : -1);
        return true;
      case 'ArrowUp':
        if (editable) step(type, 1);
        return true;
      case 'ArrowDown':
        if (editable) step(type, -1);
        return true;
      case 'PageUp':
        if (editable) step(type, pageUnits(type));
        return true;
      case 'PageDown':
        if (editable) step(type, -pageUnits(type));
        return true;
      case 'Home':
        if (editable) setField(type, config.rangeOf(type, untrack(() => parts.get())).min);
        return true;
      case 'End':
        if (editable) setField(type, config.rangeOf(type, untrack(() => parts.get())).max);
        return true;
      case 'Backspace':
      case 'Delete':
        if (editable) {
          typed = '';
          setField(type, undefined);
        }
        return true;
      default:
        break;
    }

    if (!editable) return false;

    if (type === 'dayPeriod') {
      // The letters, not the digits: nobody types 0 for morning. A and P
      // always answer, and so does the first letter of the locale's own names
      // wherever a keyboard types it directly — ص and م in Arabic, π and μ in
      // Greek. A name written through an input method never gets here: the
      // key that sends is `Process`.
      const key = event.key.toLowerCase();
      const [am, pm] = periodNames();
      if (key === 'a' || am.toLowerCase().startsWith(key)) {
        setField(type, 0);
        return true;
      }
      if (key === 'p' || pm.toLowerCase().startsWith(key)) {
        setField(type, 1);
        return true;
      }
      return false;
    }

    // ASCII digits only. A locale that renders Arabic-Indic digits still has a
    // keyboard that sends the Latin ones, and `Number` parses both.
    if (event.key.length !== 1) return false;
    const digit = Number(event.key);
    if (!Number.isInteger(digit) || event.key === ' ') return false;
    typeDigit(type, digit);
    return true;
  };

  // --- Props ---------------------------------------------------------------

  return {
    value: () => config.compose(parts.get()),
    segments,
    isEmpty: () => Object.keys(parts.get()).length === 0,

    setValue: (next) => {
      commit(next === null ? {} : config.decompose(next));
    },
    clear: () => commit({}),

    focusSegment,
    onKeyDown,

    fieldProps: () => ({
      id: baseId,
      // A group, because the field is several controls that are one value.
      // `aria-label` on the group is what a reader announces before it reaches
      // the first segment, which is where "Arrival date" belongs.
      role: 'group',
      'aria-labelledby': options.labelledBy,
      'aria-label': options.labelledBy ? undefined : options.label,
      'aria-describedby': options.describedBy,
      'aria-disabled': isDisabled() ? 'true' : undefined,
      'data-disabled': isDisabled() ? '' : undefined,
      'data-readonly': isReadOnly() ? '' : undefined,
      'data-empty': Object.keys(parts.get()).length === 0 ? '' : undefined,
      // For a stylesheet. `aria-invalid` goes on the segments instead, for the
      // same reason `aria-required` does: a group carries neither.
      'data-invalid': isInvalid() ? '' : undefined,
    }),

    segmentProps: (segment) => {
      if (!segment.isEditable) {
        // A separator read out loud is "slash" between every part of a date.
        return { 'aria-hidden': 'true', 'data-segment': 'literal' };
      }

      const type = segment.type as EditableSegmentType;
      return {
        [SEGMENT_ATTRIBUTE]: type,
        // The role a native date input's parts carry: a value in a range that
        // the arrow keys move, which is exactly what this is.
        role: 'spinbutton',
        'aria-label': nameFor(type),
        'aria-valuemin': segment.min,
        'aria-valuemax': segment.max,
        'aria-valuenow': segment.value ?? undefined,
        // The text, not the number: "PM" rather than 1, and the locale's own
        // digits rather than the Latin ones a number would be read as.
        'aria-valuetext': segment.isPlaceholder ? emptyLabel() : segment.text,
        'aria-disabled': isDisabled() ? 'true' : undefined,
        'aria-readonly': isReadOnly() ? 'true' : undefined,
        // On every segment, because the group around them is where the name
        // goes and `aria-required` is not an attribute a group can carry.
        'aria-required': options.required?.() ? 'true' : undefined,
        // Beside it, and on the segments for the same reason: a spinbutton is
        // a widget and carries both, a group is neither and carries neither.
        'aria-invalid': isInvalid() ? 'true' : undefined,
        // Exactly one segment is in the tab order, so Tab enters and leaves the
        // whole field in a single press — the same rule as a listbox's options.
        tabindex: isDisabled() ? undefined : tabStopType() === type ? '0' : '-1',
        'data-segment': type,
        'data-placeholder': segment.isPlaceholder ? '' : undefined,
      };
    },

    hiddenInputProps: () => {
      const composed = config.compose(parts.get());
      const iso = composed === null ? '' : config.serialize(composed);
      const props: Record<string, SegmentedFieldPropValue> = {
        // A visually hidden text input rather than `type="hidden"`, which is
        // barred from constraint validation: `required` on one is a promise
        // the platform never keeps, and the form submits without the date.
        // This one is validated, and keeps a clipped pixel on the page for the
        // browser to point its message at.
        type: 'text',
        // The same string as the value and as the default. The value is what
        // the form posts once anything has written to the input — autofill, a
        // restored form, a stray keystroke — and without it the input would
        // never follow the segments again. The default is what a server
        // renders, since markup has no property to set, and the only thing
        // `form.reset()` puts back, so a reset leaves the input holding what
        // the segments still show.
        value: iso,
        defaultValue: iso,
        required: options.required?.() ? true : undefined,
        // Neither a field nobody can fill in nor one that is not part of the
        // form may hold the submit, and both attributes take the input out of
        // validation. Disabled also keeps it out of the submission, which is
        // what a disabled control means.
        readOnly: isReadOnly() ? true : undefined,
        disabled: isDisabled() ? true : undefined,
        // Reachable to the platform, invisible to assistive technology and to
        // Tab: the segments carry the semantics, and announcing both would
        // announce the field twice.
        tabindex: '-1',
        'aria-hidden': 'true',
        style: VISUALLY_HIDDEN_INPUT_STYLE,
        // The platform focuses the control it is holding the submit for, and
        // this one is a clipped pixel: the caret would be somewhere nobody can
        // see, and the digits typed there would go to the form rather than to
        // the segments. The first segment is where the date is entered, so
        // that is where the message sends the user.
        onfocus: () => focusSegment(),
      };
      // Omitted rather than set to undefined: `name` is a property on an
      // input, and assigning undefined to it submits the string "undefined".
      if (options.name !== undefined) props.name = options.name;
      return props;
    },
  };
}

// ---------------------------------------------------------------------------
// Date field
// ---------------------------------------------------------------------------

export interface DateFieldOptions {
  /** The element wrapping the segments. */
  field: () => Element | null | undefined;

  value?: Signal.State<PlainDateValue | null>;
  defaultValue?: PlainDateValue | null;
  /** What an arrow press on an empty year means. Defaults to the clock. */
  today?: () => PlainDateValue;

  /**
   * Bounds a typed date is reported against. A date outside them is still the
   * value — see `createDateField` — and every segment says it is invalid.
   */
  min?: () => PlainDateValue | null | undefined;
  max?: () => PlainDateValue | null | undefined;

  disabled?: () => boolean;
  readOnly?: () => boolean;
  required?: () => boolean;
  /** Names the hidden input a plain form post carries. */
  name?: string;

  label?: string;
  labelledBy?: string;
  describedBy?: string;
  labels?: SegmentedFieldLabels;

  onChange?: (value: PlainDateValue | null) => void;
}

export type DateField = SegmentedField<PlainDateValue>;

/**
 * A date typed rather than chosen.
 *
 * The year runs to 9999 rather than to some window around today, because a
 * field that refuses 1901 is useless for a birth date and one that refuses
 * 2087 is useless for a maturity date. `min` and `max` are reported rather
 * than enforced: a user typing 2026 passes through 2020 on the way, so a
 * field that refused the keystroke could not be typed into at all, and one
 * that rewrote the date under them would post something nobody entered.
 */
export function createDateField(options: DateFieldOptions): DateField {
  const now = (): PlainDateValue => options.today?.() ?? todayInZone();

  return createSegmentedField<PlainDateValue>(
    {
      ...options,
      invalid: (value) =>
        value !== null &&
        compareDates(clampDate(value, options.min?.(), options.max?.()), value) !== 0,
    },
    {
      kind: 'date-field',
      formatOptions: {
        calendar: 'gregory',
        timeZone: 'UTC',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      },

      rangeOf(type, parts) {
        if (type === 'year') return { min: 1, max: 9999, digits: 4, blank: now().year };
        if (type === 'month') return { min: 1, max: 12, digits: 2, blank: 1 };
        // A leap year when the year is not known yet, so the 29th stays
        // reachable while the user is still typing the rest.
        const year = parts.year ?? 2024;
        const month = parts.month ?? 1;
        return { min: 1, max: daysInMonth(year, month), digits: 2, blank: 1 };
      },

      compose(parts) {
        const { year, month, day } = parts;
        if (year === undefined || month === undefined || day === undefined) return null;
        return { year, month, day };
      },

      decompose: (value) => ({ year: value.year, month: value.month, day: value.day }),

      same: (a, b) =>
        a === b ||
        (a !== null && b !== null && a.year === b.year && a.month === b.month && a.day === b.day),

      serialize: toIsoDate,
    },
  );
}

// ---------------------------------------------------------------------------
// Time picker
// ---------------------------------------------------------------------------

export type HourCycle = 'h11' | 'h12' | 'h23' | 'h24';

export interface TimePickerOptions {
  /** The element wrapping the segments. */
  field: () => Element | null | undefined;

  value?: Signal.State<PlainTimeValue | null>;
  defaultValue?: PlainTimeValue | null;

  /** Show seconds as well. Default `minute`. */
  granularity?: 'minute' | 'second';
  /** What one arrow press moves the minutes by. Default 1. */
  minuteStep?: number;
  /**
   * Force a clock. Defaults to the locale's, which is the right answer far
   * more often than a prop is: American English is 12-hour, French is 24, and
   * a user who has said otherwise says it in their locale.
   */
  hourCycle?: HourCycle;

  disabled?: () => boolean;
  readOnly?: () => boolean;
  required?: () => boolean;
  name?: string;

  label?: string;
  labelledBy?: string;
  describedBy?: string;
  labels?: SegmentedFieldLabels;

  onChange?: (value: PlainTimeValue | null) => void;
}

export type TimePicker = SegmentedField<PlainTimeValue>;

/**
 * A time of day, entered the same way a date is.
 *
 * There is no popup list of times here, deliberately. A dropdown is a listbox
 * of generated options, which `createListbox` already is; wiring one to this
 * field is a composition a booking flow can make, and building a second,
 * weaker listbox inside a time picker is the duplication this package exists
 * to avoid. What is not available anywhere else is the segmented entry, and
 * that is what this is.
 */
export function createTimePicker(options: TimePickerOptions): TimePicker {
  const seconds = options.granularity === 'second';
  const minuteStep = Math.max(1, Math.trunc(options.minuteStep ?? 1));

  const formatOptions: Intl.DateTimeFormatOptions = {
    timeZone: 'UTC',
    hour: '2-digit',
    minute: '2-digit',
    ...(seconds ? { second: '2-digit' as const } : {}),
    ...(options.hourCycle ? { hourCycle: options.hourCycle } : {}),
  };

  /**
   * The clock actually in force, which is the locale's unless one was forced.
   *
   * Resolved from the formatter rather than guessed from the tag: `en-GB` is
   * 24-hour and `en-US` is not, and there is no rule connecting the two
   * beyond the data `Intl` already carries.
   */
  const cycleOf = (locale: string): HourCycle =>
    options.hourCycle ??
    ((getDateTimeFormat(locale, formatOptions).resolvedOptions().hourCycle as HourCycle) ?? 'h23');

  const localeRef = useLocale();
  const cycle = (): HourCycle => cycleOf(localeRef.code());

  /** 0-23 from what the segments show, which depends on the clock. */
  const toHour24 = (shown: number, period: number | undefined): number => {
    switch (cycle()) {
      case 'h12':
        return (shown % 12) + (period === 1 ? 12 : 0);
      case 'h11':
        return shown + (period === 1 ? 12 : 0);
      case 'h24':
        return shown % 24;
      default:
        return shown;
    }
  };

  const fromHour24 = (hour: number): { shown: number; period: number } => {
    const period = hour >= 12 ? 1 : 0;
    switch (cycle()) {
      case 'h12':
        return { shown: hour % 12 === 0 ? 12 : hour % 12, period };
      case 'h11':
        return { shown: hour % 12, period };
      case 'h24':
        return { shown: hour === 0 ? 24 : hour, period };
      default:
        return { shown: hour, period };
    }
  };

  return createSegmentedField<PlainTimeValue>(options, {
    kind: 'time-picker',
    formatOptions,

    rangeOf(type) {
      if (type === 'hour') {
        switch (cycle()) {
          case 'h12':
            return { min: 1, max: 12, digits: 2, blank: 12 };
          case 'h11':
            return { min: 0, max: 11, digits: 2, blank: 0 };
          case 'h24':
            return { min: 1, max: 24, digits: 2, blank: 24 };
          default:
            return { min: 0, max: 23, digits: 2, blank: 0 };
        }
      }
      if (type === 'dayPeriod') return { min: 0, max: 1, digits: 1, blank: 0 };
      // Only the minutes are stepped. Seconds entered in fives would be a
      // granularity the caller did not ask for.
      const step = type === 'minute' ? minuteStep : 1;
      return { min: 0, max: 59, digits: 2, blank: 0, step };
    },

    compose(parts) {
      const { hour, minute } = parts;
      if (hour === undefined || minute === undefined) return null;
      // A 12-hour clock cannot say which half of the day it is until the
      // period is given, so the value is not a time yet.
      const needsPeriod = cycle() === 'h11' || cycle() === 'h12';
      if (needsPeriod && parts.dayPeriod === undefined) return null;
      if (seconds && parts.second === undefined) return null;
      return {
        hour: toHour24(hour, parts.dayPeriod),
        minute,
        second: seconds ? (parts.second ?? 0) : 0,
      };
    },

    decompose(value) {
      const { shown, period } = fromHour24(value.hour);
      const twelve = cycle() === 'h11' || cycle() === 'h12';
      return {
        hour: shown,
        // Only where the pattern has a period segment. Carrying one on a
        // 24-hour clock leaves a field nothing can clear, so a cleared time
        // would still report itself as partly entered.
        ...(twelve ? { dayPeriod: period } : {}),
        minute: value.minute,
        ...(seconds ? { second: value.second } : {}),
      };
    },

    same: (a, b) =>
      a === b ||
      (a !== null &&
        b !== null &&
        a.hour === b.hour &&
        a.minute === b.minute &&
        a.second === b.second),

    serialize: (value) => {
      const pad = (n: number): string => String(n).padStart(2, '0');
      const base = `${pad(value.hour)}:${pad(value.minute)}`;
      return seconds ? `${base}:${pad(value.second)}` : base;
    },
  });
}

// ---------------------------------------------------------------------------
// Date picker
// ---------------------------------------------------------------------------

export interface DatePickerLabels extends SegmentedFieldLabels, CalendarLabels {
  /**
   * Names the button that opens the calendar. Defaults to the locale's
   * `chooseDate`, then "Choose date".
   */
  trigger?: string;
  /** Names the popover itself, for a reader entering it. */
  calendar?: string;
}

export interface DatePickerOptions {
  /** The segmented field. */
  field: () => Element | null | undefined;
  /** The button that opens the calendar. */
  trigger: () => Element | null | undefined;
  /** The popover the calendar lives in. */
  content: () => Element | null | undefined;
  /** The element wrapping the months inside that popover. */
  calendar: () => Element | null | undefined;

  value?: Signal.State<PlainDateValue | null>;
  defaultValue?: PlainDateValue | null;
  open?: Signal.State<boolean>;
  defaultOpen?: boolean;

  today?: () => PlainDateValue;
  min?: () => PlainDateValue | null | undefined;
  max?: () => PlainDateValue | null | undefined;
  isDateDisabled?: (date: PlainDateValue) => boolean;
  visibleMonths?: number;
  firstDayOfWeek?: number;
  fixedWeeks?: boolean;

  disabled?: () => boolean;
  readOnly?: () => boolean;
  required?: () => boolean;
  name?: string;

  label?: string;
  labelledBy?: string;
  describedBy?: string;
  labels?: DatePickerLabels;

  placement?: PopoverPlacement;
  /** Close the calendar as soon as a date is chosen. Default true. */
  closeOnSelect?: boolean;

  onChange?: (value: PlainDateValue | null) => void;
  onOpenChange?: (open: boolean) => void;
}

export interface DatePicker {
  /** The typed half. Its segments and props are rendered as usual. */
  readonly field: DateField;
  /** The chosen half. Its months and props are rendered inside the popover. */
  readonly calendar: Calendar;
  /** The popover, for anything the getters below do not cover. */
  readonly popover: Popover;

  value(): PlainDateValue | null;
  setValue(value: PlainDateValue | null): void;
  isOpen(): boolean;
  open(): void;
  close(): void;

  /** Handle a keydown anywhere in the field. Returns true when consumed. */
  onKeyDown(event: KeyboardEvent): boolean;

  triggerProps(): PopoverProps;
  contentProps(): PopoverProps;
}

/**
 * A date field with a calendar behind a button.
 *
 * One value signal reaches both halves, which is the whole composition: the
 * field decomposes it into segments, the calendar selects it in a grid, and
 * neither has a copy that can drift from the other. The popover, the
 * anchoring, the dismissal and the focus restore are `createPopover`'s, not
 * repeated here.
 *
 * Alt+ArrowDown opens the calendar from the field, which is what a native
 * date input does and the only keyboard route to the grid that does not
 * require finding the button first.
 */
export function createDatePicker(options: DatePickerOptions): DatePicker {
  const locale = useLocale();
  const labels = options.labels ?? {};
  const closeOnSelect = options.closeOnSelect !== false;

  const value =
    options.value ?? new Signal.State<PlainDateValue | null>(options.defaultValue ?? null);
  const open = options.open ?? new Signal.State(options.defaultOpen ?? false);

  const now = (): PlainDateValue => options.today?.() ?? todayInZone();

  /**
   * The date the grid opens on: the one the field holds, else today, and
   * inside the bounds either way. The field takes no bounds, so it can hold a
   * date outside them, and today can be before `min`; a tab stop on either
   * would sit on the one kind of cell the grid promises is never reached.
   */
  const openingDate = (): PlainDateValue =>
    clampDate(untrack(() => value.get()) ?? now(), options.min?.(), options.max?.());

  /**
   * The calendar's tab stop, owned here rather than by the calendar.
   *
   * The grid is built once and shown many times, and each time it has to open
   * on the date the field currently holds — which the calendar cannot know,
   * because it was constructed before any of those values existed.
   */
  const focusedDate = new Signal.State<PlainDateValue>(untrack(openingDate));

  const field = createDateField({
    field: options.field,
    value,
    today: options.today,
    // The same bounds the grid has. The field takes what is typed into it
    // either way, and says on every segment that a date outside them is not
    // one this picker accepts.
    min: options.min,
    max: options.max,
    disabled: options.disabled,
    readOnly: options.readOnly,
    required: options.required,
    name: options.name,
    label: options.label,
    labelledBy: options.labelledBy,
    describedBy: options.describedBy,
    labels,
    onChange: options.onChange,
  });

  const calendar = createCalendar({
    calendar: options.calendar,
    value,
    focusedDate,
    today: options.today,
    min: options.min,
    max: options.max,
    isDateDisabled: options.isDateDisabled,
    visibleMonths: options.visibleMonths,
    firstDayOfWeek: options.firstDayOfWeek,
    fixedWeeks: options.fixedWeeks,
    disabled: () => (options.disabled?.() ?? false) || (options.readOnly?.() ?? false),
    label: labels.calendar ?? options.label,
    labels,
    onChange: (next) => {
      options.onChange?.(next);
      if (next !== null && closeOnSelect) setOpen(false);
    },
  });

  const popover = createPopover({
    trigger: options.trigger,
    content: options.content,
    open,
    placement: options.placement ?? 'bottom-start',
    // The grid owns its own tab stop, so focus goes straight onto the date the
    // field holds rather than onto the popover or its first button.
    initialFocus: () => calendar.focusedCell(),
    restoreFocus: true,
    labels: { content: labels.calendar },
    onOpenChange: options.onOpenChange,
  });

  const setOpen = (next: boolean): void => {
    if (next) popover.open();
    else popover.close();
  };

  /**
   * Opening moves the grid onto whatever the field says.
   *
   * Writing the focused date rather than calling `focusDate` because the cells
   * do not exist yet: the calendar derives its visible month from this, and
   * `initialFocus` above takes DOM focus once the popover has rendered.
   */
  effect(() => {
    if (!open.get()) return;
    const opening = untrack(openingDate);
    if (compareDates(untrack(() => focusedDate.get()), opening) !== 0) focusedDate.set(opening);
  });

  const onKeyDown = (event: KeyboardEvent): boolean => {
    if (options.disabled?.()) return false;
    // The native date input's gesture, and the only one that does not make a
    // keyboard user hunt for the button. Not while read-only: the grid then
    // answers no keys and takes no presses, which is why the button is
    // disabled, and the gesture that stands in for the button is too.
    if (event.altKey && event.key === 'ArrowDown') {
      if (options.readOnly?.()) return false;
      setOpen(true);
      return true;
    }
    return field.onKeyDown(event);
  };

  return {
    field,
    calendar,
    popover,

    value: () => value.get(),
    setValue: (next) => field.setValue(next),
    isOpen: () => popover.isOpen(),
    open: () => setOpen(true),
    close: () => setOpen(false),

    onKeyDown,

    triggerProps: () => ({
      ...popover.triggerProps(),
      type: 'button',
      // The button is a glyph beside a field that already has a name, so it
      // needs one of its own or it announces as "button".
      'aria-label':
        labels.trigger ?? (locale.has('chooseDate') ? locale.t('chooseDate') : 'Choose date'),
      disabled: (options.disabled?.() ?? false) || (options.readOnly?.() ?? false) ? true : undefined,
    }),

    contentProps: () => popover.contentProps(),
  };
}
