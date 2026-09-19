/**
 * Locale — language, writing direction, and every string the library speaks.
 *
 * A component that reaches for `Intl` itself gets three things wrong. It uses
 * the runtime's locale rather than the application's, so a page set to German
 * still groups numbers the American way. It constructs a formatter per render,
 * which is the single most expensive thing in `Intl` and the reason a table of
 * a thousand dates janks. And it hard-codes English, because there is nowhere
 * else for "No results" to live.
 *
 * So locale is a system, not a call site: one provider flowing down the
 * reactive scope, carrying the tag, the resolved direction, the catalogue of
 * everything the library says out loud, and formatters bound to all of it.
 *
 *   @Component({
 *     selector: 'v-app',
 *     render: compileTemplate(`
 *       <div :ref="root" :spread="locale.providerProps()">
 *         <button :aria-label="locale.t('close')">×</button>
 *         <p>{ locale.t('pageOf', { n: 3, m: 12 }) }</p>
 *         <p>{ locale.format.bytes(1536) }</p>
 *       </div>
 *     `),
 *   })
 *   class App {
 *     root = new Signal.State<Element | null>(null);
 *     locale = createLocaleProvider({
 *       defaultLocale: 'de-DE',
 *       element: () => this.root.get(),
 *       messages: { close: 'Schließen' },
 *     });
 *   }
 *
 * and anywhere below it, in any component:
 *
 *   locale = useLocale();
 *
 * Everything a component reads here is a signal read, so changing the locale
 * re-renders the strings, the numbers and the direction together — which is
 * the point of them being one object rather than three.
 *
 * A nested provider does not inherit its parent's tag: give it one. Inheriting
 * only the initial value would be a lie the first time the parent changed, and
 * inheriting it live means a provider that cannot say what locale it is
 * without walking the scope on every read.
 */

import {
  Signal,
  clearRequestState,
  createContext,
  effect,
  isWritableSignal,
  onCleanup,
  provideContext,
  requestState,
  useContext,
} from '@voltdev/core';

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export type Direction = 'ltr' | 'rtl';

export type PluralCategory = Intl.LDMLPluralRule;

/**
 * A string that inflects with a count.
 *
 * Only `other` is required, because it is the one category every locale has
 * and the fallback for the ones a catalogue leaves out. English needs two
 * forms, Polish four, Arabic six — which is why a count string is a record
 * rather than a pair of singular and plural.
 */
export interface PluralMessage {
  zero?: string;
  one?: string;
  two?: string;
  few?: string;
  many?: string;
  other: string;
}

export type Message = string | PluralMessage;

/** Values substituted into `{name}` placeholders. Numbers are localised. */
export type MessageValues = Readonly<Record<string, string | number>>;

/**
 * Every string the library itself emits.
 *
 * A type alias rather than an interface, deliberately: TypeScript only gives
 * an implicit index signature to the former, and a catalogue has to be
 * readable as a plain record to look a key up in it.
 */
export type LibraryMessages = {
  close: Message;
  previous: Message;
  next: Message;
  noResults: Message;
  /** Pagination, where `n` is the current page and `m` the total. */
  pageOf: Message;
  sortedAscending: Message;
  /**
   * A sortable column announces its state, and every one of them toggles, so
   * shipping only the ascending half would leave the other press silent.
   */
  sortedDescending: Message;
  /** A count string: `n` is how many. */
  selected: Message;
  remove: Message;
  loading: Message;
  required: Message;
  clear: Message;
};

/** A known key, with anything else still allowed for a consumer's own strings. */
export type MessageKey = keyof LibraryMessages | (string & {});

export type MessageCatalog = Partial<LibraryMessages> & {
  readonly [key: string]: Message | undefined;
};

/**
 * The English catalogue, used for any key a translation leaves out.
 *
 * `selected` is a plural record even though English does not inflect it, so
 * that a Polish catalogue has the four slots it needs to override. The shape
 * of the default is what a translator copies.
 */
export const DEFAULT_MESSAGES: LibraryMessages = {
  close: 'Close',
  previous: 'Previous',
  next: 'Next',
  noResults: 'No results',
  pageOf: 'Page {n} of {m}',
  sortedAscending: 'Sorted ascending',
  sortedDescending: 'Sorted descending',
  selected: { one: '{n} selected', other: '{n} selected' },
  remove: 'Remove',
  loading: 'Loading…',
  required: 'Required',
  clear: 'Clear',
};

/**
 * The message a catalogue itself declares for a key.
 *
 * Own properties only. A catalogue is a plain object and a key is any string,
 * so a plain read of `constructor` or `toString` finds the function every
 * object inherits — which `has` would call a message, and `t` would try to
 * pluralise.
 */
function ownMessage(catalog: object, key: string): Message | undefined {
  return Object.hasOwn(catalog, key)
    ? (catalog as Readonly<Record<string, Message | undefined>>)[key]
    : undefined;
}

/** The placeholder whose value picks the plural category. */
const COUNT = 'n';

const PLACEHOLDER = /\{\s*(\w+)\s*\}/g;

/**
 * Substitute `{name}` placeholders.
 *
 * A number is formatted for the locale, because "1,234" and "1.234" are the
 * same page in different countries and a raw `String(value)` is neither. Pass
 * a string when the number is an identifier rather than a quantity — an
 * invoice number should not acquire a thousands separator.
 *
 * An unknown placeholder is left standing rather than replaced with nothing.
 * A visible `{n}` is a bug report; an empty gap is a mystery.
 */
function interpolate(template: string, values: MessageValues | undefined, locale: string): string {
  if (!values || !template.includes('{')) return template;
  return template.replace(PLACEHOLDER, (whole: string, name: string) => {
    const value = values[name];
    if (value === undefined) return whole;
    return typeof value === 'number' ? getNumberFormat(locale).format(value) : value;
  });
}

function selectPlural(
  message: PluralMessage,
  values: MessageValues | undefined,
  locale: string,
): string {
  const count = values?.[COUNT];
  // No count means no category to select: `other` is the entry that always
  // exists, and it is what a caller who forgot the value should see.
  if (typeof count !== 'number') return message.other;
  return message[getPluralRules(locale).select(count)] ?? message.other;
}

// ---------------------------------------------------------------------------
// Cached Intl instances
// ---------------------------------------------------------------------------

/**
 * Constructing an `Intl` formatter is expensive — it resolves locale data,
 * builds a pattern and allocates an ICU object — and formatting with it is
 * cheap. Written naively, a component builds one per render and throws it
 * away, which is most of the cost of rendering a table of numbers.
 *
 * Entries are keyed by kind, tag and options, so identical requests from
 * anywhere in the application share one instance.
 */
const instances = new Map<string, unknown>();

/**
 * Options can come from data — a currency per row, a unit per cell — so the
 * cache is bounded rather than left to grow for the life of the page. A Map
 * iterates in insertion order, so the oldest key is the first one out.
 */
const MAX_INSTANCES = 256;

function cached<T>(kind: string, locale: string, options: object | undefined, make: () => T): T {
  // An array replacer both selects and orders keys, so two option objects that
  // differ only in the order they were written share one entry instead of
  // building the same formatter twice.
  const key = options
    ? `${kind}|${locale}|${JSON.stringify(options, Object.keys(options).sort())}`
    : `${kind}|${locale}`;

  const hit = instances.get(key);
  // The cast is the price of one heterogeneous map; `kind` is what keeps the
  // kinds apart, and it is part of the key.
  if (hit !== undefined) return hit as T;

  const made = make();
  if (instances.size >= MAX_INSTANCES) {
    const oldest = instances.keys().next().value;
    if (oldest !== undefined) instances.delete(oldest);
  }
  instances.set(key, made);
  return made;
}

export function getNumberFormat(
  locale: string,
  options?: Intl.NumberFormatOptions,
): Intl.NumberFormat {
  return cached('number', locale, options, () => new Intl.NumberFormat(locale, options));
}

export function getDateTimeFormat(
  locale: string,
  options?: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  return cached('date', locale, options, () => new Intl.DateTimeFormat(locale, options));
}

export function getCollator(locale: string, options?: Intl.CollatorOptions): Intl.Collator {
  return cached('collator', locale, options, () => new Intl.Collator(locale, options));
}

export function getPluralRules(
  locale: string,
  options?: Intl.PluralRulesOptions,
): Intl.PluralRules {
  return cached('plural', locale, options, () => new Intl.PluralRules(locale, options));
}

export function getListFormat(locale: string, options?: Intl.ListFormatOptions): Intl.ListFormat {
  return cached('list', locale, options, () => new Intl.ListFormat(locale, options));
}

export function getRelativeTimeFormat(
  locale: string,
  options?: Intl.RelativeTimeFormatOptions,
): Intl.RelativeTimeFormat {
  return cached('relative', locale, options, () => new Intl.RelativeTimeFormat(locale, options));
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export type DateInput = Date | number | string;

/**
 * Named for the `Intl` type it extends, rather than `RelativeTimeOptions`,
 * which `createRelativeTime` in display-extras already owns — both are
 * re-exported from the package root, and `export *` drops a name exported
 * twice.
 */
export interface RelativeTimeFormatOptions extends Intl.RelativeTimeFormatOptions {
  /** What the value is measured against. Default: the current time. */
  now?: DateInput;
  /** Force a unit instead of choosing the largest one that fits. */
  unit?: Intl.RelativeTimeFormatUnit;
}

export interface BytesOptions {
  /** 1024-based units (KiB) rather than the SI 1000-based ones (kB). */
  binary?: boolean;
  /** Digits after the point once the value is scaled. Default 1. */
  maximumFractionDigits?: number;
  /** Default: `long` for plain bytes, `short` once scaled. */
  unitDisplay?: 'short' | 'long' | 'narrow';
}

export interface Formatters {
  number(value: number, options?: Intl.NumberFormatOptions): string;
  /** `currency` is an ISO 4217 code — 'GBP', 'EUR', 'JPY'. */
  currency(value: number, currency: string, options?: Intl.NumberFormatOptions): string;
  /** Takes a fraction: 0.42 formats as 42%. */
  percent(fraction: number, options?: Intl.NumberFormatOptions): string;
  date(value: DateInput, options?: Intl.DateTimeFormatOptions): string;
  relativeTime(value: DateInput, options?: RelativeTimeFormatOptions): string;
  list(items: Iterable<string>, options?: Intl.ListFormatOptions): string;
  bytes(value: number, options?: BytesOptions): string;
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const MS_PER_UNIT: Readonly<Record<string, number>> = {
  second: SECOND,
  minute: MINUTE,
  hour: HOUR,
  day: DAY,
  week: 7 * DAY,
};

/** Byte units `Intl` knows by name, smallest first. */
const BYTE_UNITS = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte', 'petabyte'] as const;
const BINARY_SUFFIXES = ['', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'] as const;

function toDate(value: DateInput): Date {
  return value instanceof Date ? value : new Date(value);
}

function isValidDate(date: Date): boolean {
  return !Number.isNaN(date.getTime());
}

/**
 * Whole days between two instants, counted by the calendar rather than by
 * elapsed time.
 *
 * 23:00 and 01:00 are two hours apart and on different days; "yesterday" is
 * about the second fact. Rounding also absorbs the 23- and 25-hour days that
 * daylight saving produces.
 */
function calendarDays(target: Date, base: Date): number {
  const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((midnight(target) - midnight(base)) / DAY);
}

function calendarMonths(target: Date, base: Date): number {
  return (
    (target.getFullYear() - base.getFullYear()) * 12 + (target.getMonth() - base.getMonth())
  );
}

/**
 * Whole months gone by, rather than month boundaries crossed.
 *
 * The day of the month has to have come round as well, or the 31st of one
 * month and the 8th of the next — eight days apart — would be a month.
 */
function wholeMonths(target: Date, base: Date): number {
  const months = calendarMonths(target, base);
  if (months > 0 && target.getDate() < base.getDate()) return months - 1;
  if (months < 0 && target.getDate() > base.getDate()) return months + 1;
  return months;
}

/**
 * The largest unit that still describes the gap honestly.
 *
 * Sub-day units are measured by elapsed time, which is what "in 3 hours"
 * means. Days and above are counted by the calendar, because "last month" is
 * a position in the calendar and not thirty times 86,400 seconds — and so is
 * "last year", which is why years are not twelve-month spans.
 *
 * Which unit is a question of size, though, not of boundaries: under a whole
 * month the answer is in weeks, so something eight days old is "last week"
 * whether or not the 1st fell in between, and from there it is in whole months
 * until there are twelve of them.
 *
 * Exported for whatever has to say the same thing without being a formatter —
 * a timestamp that keeps itself current paces its clock by the unit, and two
 * answers for one moment are what a second copy of this arithmetic produces.
 */
export function relativeTimeParts(
  target: Date,
  base: Date,
): [number, 'second' | 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year'] {
  const ms = target.getTime() - base.getTime();
  const abs = Math.abs(ms);

  if (abs < MINUTE) return [Math.round(ms / SECOND), 'second'];
  if (abs < HOUR) return [Math.round(ms / MINUTE), 'minute'];
  if (abs < DAY) return [Math.round(ms / HOUR), 'hour'];

  const days = calendarDays(target, base);
  if (Math.abs(days) < 7) return [days, 'day'];

  // The count that chose the unit is the count reported. Boundaries crossed
  // would put the 31st of January, seen on the 1st of March, at "2 months ago"
  // — a day after the 28th of February had it at "4 weeks ago".
  const months = wholeMonths(target, base);
  if (months === 0) return [Math.trunc(days / 7), 'week'];
  if (Math.abs(months) < 12) return [months, 'month'];
  return [target.getFullYear() - base.getFullYear(), 'year'];
}

/** How many of `unit` separate the two instants, for a caller that named one. */
function amountIn(unit: Intl.RelativeTimeFormatUnit, target: Date, base: Date): number {
  // `Intl` accepts 'day' and 'days' alike, so both have to resolve here.
  const singular = unit.endsWith('s') ? unit.slice(0, -1) : unit;

  switch (singular) {
    case 'year':
      return target.getFullYear() - base.getFullYear();
    case 'quarter':
      return (
        (target.getFullYear() - base.getFullYear()) * 4 +
        (Math.floor(target.getMonth() / 3) - Math.floor(base.getMonth() / 3))
      );
    case 'month':
      return calendarMonths(target, base);
    case 'week':
      return Math.trunc(calendarDays(target, base) / 7);
    case 'day':
      return calendarDays(target, base);
    default:
      return Math.round((target.getTime() - base.getTime()) / (MS_PER_UNIT[singular] ?? SECOND));
  }
}

/**
 * Formatters bound to a locale accessor.
 *
 * The accessor is read on every call rather than captured, so these stay
 * correct — and reactive — when the locale changes underneath them.
 */
export function createFormatters(locale: () => string): Formatters {
  return {
    number: (value, options) => getNumberFormat(locale(), options).format(value),

    currency: (value, currency, options) =>
      getNumberFormat(locale(), { ...options, style: 'currency', currency }).format(value),

    // `Intl` multiplies by 100 for the percent style, so the input is a
    // fraction. Taking 42 and printing 42% would mean formatting the number
    // and appending a sign, which is wrong in every locale that puts the sign
    // first or spaces it differently.
    percent: (fraction, options) =>
      getNumberFormat(locale(), { ...options, style: 'percent' }).format(fraction),

    date(value, options) {
      const date = toDate(value);
      // An unparseable date is bad data arriving from an API, and `Intl` throws
      // RangeError on it. An empty cell is recoverable; an exception thrown
      // mid-render takes the page with it. The cost is that the bad value is
      // now invisible.
      if (!isValidDate(date)) return '';
      return getDateTimeFormat(locale(), options).format(date);
    },

    relativeTime(value, options = {}) {
      const { now, unit, ...rest } = options;
      const target = toDate(value);
      const base = now === undefined ? new Date() : toDate(now);
      if (!isValidDate(target) || !isValidDate(base)) return '';

      const [amount, resolved]: [number, Intl.RelativeTimeFormatUnit] = unit
        ? [amountIn(unit, target, base), unit]
        : relativeTimeParts(target, base);
      // 'auto' is what produces "yesterday" rather than "1 day ago". Pass
      // numeric: 'always' for a live countdown, where a word that does not
      // change every second reads as a frozen clock.
      return getRelativeTimeFormat(locale(), { numeric: 'auto', ...rest }).format(amount, resolved);
    },

    list: (items, options) => getListFormat(locale(), options).format(items),

    bytes(value, options = {}) {
      const base = options.binary ? 1024 : 1000;
      const digits = options.maximumFractionDigits ?? 1;
      if (!Number.isFinite(value)) return getNumberFormat(locale()).format(value);

      const magnitude = Math.abs(value);
      let index =
        magnitude < base
          ? 0
          : Math.min(Math.floor(Math.log(magnitude) / Math.log(base)), BYTE_UNITS.length - 1);
      let scaled = value / base ** index;

      // 999,999 bytes is 999.999 kB, which rounds to "1,000 kB" — a number the
      // unit next to it contradicts. Carry it up instead.
      if (index < BYTE_UNITS.length - 1 && Math.abs(Number(scaled.toFixed(digits))) >= base) {
        index += 1;
        scaled = value / base ** index;
      }

      if (options.binary && index > 0) {
        // `Intl` has no binary units, so only the number is localised and the
        // IEC symbol is appended. That is a real gap rather than a choice, and
        // it is survivable because "KiB" is not translated in practice.
        const number = getNumberFormat(locale(), { maximumFractionDigits: digits }).format(scaled);
        return `${number} ${BINARY_SUFFIXES[index]}`;
      }

      return getNumberFormat(locale(), {
        style: 'unit',
        unit: BYTE_UNITS[index] ?? 'byte',
        // The short form of "byte" is "byte", which reads as a typo at any
        // count but one. The scaled units have real symbols, so they are short.
        unitDisplay: options.unitDisplay ?? (index === 0 ? 'long' : 'short'),
        maximumFractionDigits: digits,
      }).format(scaled);
    },
  };
}

// ---------------------------------------------------------------------------
// Direction
// ---------------------------------------------------------------------------

/**
 * The direction declared at `el`, or null when nothing declares one.
 *
 * The nearest `dir` attribute wins over computed style, as in `roving-focus`:
 * an application that marks direction up with `dir` is stating intent, and the
 * attribute is also readable before styles resolve — during construction, and
 * in test environments that do not implement `direction` at all.
 *
 * A computed `ltr` is not treated as an answer. It is the initial value of
 * every element on every page, so it says only that nobody has said anything;
 * a computed `rtl` had to come from a stylesheet or an ancestor and is a real
 * statement. `dir="auto"` falls through for the same reason: it delegates the
 * decision to the text itself, per paragraph, which is not a question this can
 * answer.
 */
function declaredDirection(el: Element): Direction | null {
  const declared = el.closest('[dir]');
  if (declared) {
    const value = declared.getAttribute('dir')?.toLowerCase();
    if (value === 'rtl' || value === 'ltr') return value;
  }

  const view = el.ownerDocument?.defaultView;
  return view?.getComputedStyle?.(el).direction === 'rtl' ? 'rtl' : null;
}

/** Writing direction at an element, defaulting to `ltr` when nothing says. */
export function resolveDirection(el: Element | null | undefined): Direction {
  return (el ? declaredDirection(el) : null) ?? 'ltr';
}

/**
 * Marks a `dir` that a locale worked out for itself, from the DOM above it or
 * from its language, as opposed to one somebody chose.
 *
 * Written beside the `dir` it describes, by `providerProps`, because that is
 * the only place that knows: a locale with nothing above it has no reason to
 * be told its element, and its `dir` still has to be told apart from an
 * author's. A direction forced through the `direction` option is a choice, so
 * it goes unmarked and reads below exactly as a hand-written `dir` would.
 */
const RESOLVED_DIR_ATTRIBUTE = 'data-volt-dir';

/**
 * The direction a locale's element inherits from the DOM, not counting what
 * another locale worked out for itself.
 *
 * A locale always writes an explicit `dir` on its element — `ltr` or `rtl`,
 * never nothing — so to a locale nested inside it that attribute would read as
 * an author's statement, and an Arabic section in an English page would come
 * out left to right. So an enclosing locale's resolved `dir` is stepped over,
 * and the walk goes on to whatever somebody stated above it. Computed style is
 * not asked once one has been: below a locale's element it is that locale's
 * `dir` again, which is the answer being set aside.
 */
function inheritedDirection(el: Element): Direction | null {
  const from = el.parentElement ?? el;
  let declared = from.closest('[dir]');
  if (declared === null || !declared.hasAttribute(RESOLVED_DIR_ATTRIBUTE)) {
    return declaredDirection(from);
  }

  while (declared !== null && declared.hasAttribute(RESOLVED_DIR_ATTRIBUTE)) {
    declared = declared.parentElement?.closest('[dir]') ?? null;
  }
  const value = declared?.getAttribute('dir')?.toLowerCase();
  return value === 'rtl' || value === 'ltr' ? value : null;
}

/**
 * A locale's text info, under either spelling.
 *
 * `getTextInfo()` is what the proposal settled on and `textInfo` is what
 * shipped first, and engines in service right now are split between them —
 * Node 22 has only the property, Node 24 has both. Reaching for one and
 * catching the failure means Arabic and Hebrew silently come back `ltr`, which
 * is a worse outcome than asking for both.
 */
function textInfoOf(locale: Intl.Locale): { direction?: string } | undefined {
  const method = (locale as { getTextInfo?: () => { direction?: string } }).getTextInfo;
  if (typeof method === 'function') return method.call(locale);
  return (locale as { textInfo?: { direction?: string } }).textInfo;
}

const scriptDirections = new Map<string, Direction | null>();

/**
 * The direction the language itself is written in.
 *
 * This is what makes setting the locale to Arabic enough. Nothing in the DOM
 * has to be touched for the page to become right-to-left, which matters
 * because the alternative is every application remembering to do it.
 */
function scriptDirection(locale: string): Direction | null {
  const hit = scriptDirections.get(locale);
  if (hit !== undefined) return hit;

  let direction: Direction | null = null;
  try {
    const info = textInfoOf(new Intl.Locale(locale));
    // No text info at all is no answer rather than a left-to-right one. The
    // DOM has been asked before this step, so the result is `ltr` either way —
    // from `direction()`'s own last resort rather than from a claim made here
    // about a language this engine could not describe.
    direction = info ? (info.direction === 'rtl' ? 'rtl' : 'ltr') : null;
  } catch {
    // A malformed tag. The locale is unusable, but direction is not the place
    // to raise that — the first format call will.
    direction = null;
  }

  scriptDirections.set(locale, direction);
  return direction;
}

// ---------------------------------------------------------------------------
// Locale
// ---------------------------------------------------------------------------

export interface LocaleProps {
  readonly [key: string]: string | boolean | undefined;
}

/**
 * Numeric collation is on by default, which `Intl` itself does not do: a list
 * showing "Item 10" above "Item 9" is a bug report every time. Pass
 * `{ numeric: false }` to get the pure alphabetical order back.
 */
export const DEFAULT_COLLATOR_OPTIONS: Intl.CollatorOptions = { numeric: true };

export interface LocaleOptions {
  /**
   * Supply a signal to control the locale from outside. Without one the
   * provider owns it, which is what most callers want.
   */
  locale?: Signal.State<string>;
  /** Initial tag when uncontrolled. Defaults to the document's, then the browser's. */
  defaultLocale?: string;

  /**
   * Force a direction. `auto`, the default, resolves it from the DOM and then
   * from the language. A forced direction is a statement about the region, so
   * a locale nested inside answers to it as it would to a `dir` written by
   * hand; one resolved under `auto` is this locale's alone.
   */
  direction?: Signal.State<Direction | 'auto'>;
  defaultDirection?: Direction | 'auto';

  /**
   * The element this locale governs, used to resolve direction from the DOM.
   * Its own `dir` attribute is not consulted — see `providerProps` — and nor
   * is one an enclosing locale resolved for itself, so a nested locale's
   * direction is its own language's unless somebody said otherwise: an author
   * with a `dir`, or an enclosing locale with a forced direction.
   *
   * A locale given one watches the document for `dir` changes, so it belongs
   * to a reactive scope that can eventually stop it.
   */
  element?: () => Element | null | undefined;

  /**
   * Translations, overriding the English defaults key by key. Pass a signal to
   * swap catalogues later, which is what a lazily loaded bundle needs; pass a
   * plain object when they are known up front.
   */
  messages?: MessageCatalog | Signal.State<MessageCatalog>;

  /** Defaults for `compare` and `collator`, merged over the numeric default. */
  collator?: Intl.CollatorOptions;

  onLocaleChange?: (locale: string) => void;
}

export interface Locale {
  /** The BCP 47 tag. Extensions ride along: `de-DE-u-co-phonebk` collates that way. */
  code(): string;
  /** The resolved writing direction. */
  direction(): Direction;

  /**
   * A string from the catalogue, pluralised and interpolated.
   *
   * Deliberately one letter: it appears in every template that says anything,
   * and `locale.translate('close')` is not clearer for the length. The count
   * that selects a plural form is the value named `n`, matching the `{n}` the
   * catalogue's own strings are written with.
   *
   * An unknown key returns the key. It is not a string anyone wants on screen,
   * which is exactly why it is better than an empty space.
   */
  t(key: MessageKey, values?: MessageValues): string;
  /** Whether a key resolves at all — for a consumer's own optional strings. */
  has(key: MessageKey): boolean;
  /** The plural category for a count, for a consumer branching by hand. */
  plural(count: number, options?: Intl.PluralRulesOptions): PluralCategory;

  /**
   * The default comparator for sorting anything a person reads.
   *
   * `String#localeCompare` with no argument uses the *runtime's* locale, not
   * the application's, so a page set to Swedish sorts ö next to o instead of
   * after z, German ignores the ae-equivalence a phonebook wants, and Turkish
   * runs ı and i together when they are separate letters. Passing the tag is
   * the whole fix, and a cached collator makes it cheaper than the method it
   * replaces.
   */
  compare(a: string, b: string): number;
  /** The collator behind `compare`, for `Array#sort` and for one-off options. */
  collator(options?: Intl.CollatorOptions): Intl.Collator;

  /** Number, currency, percent, date, relative time, list and byte formatting. */
  readonly format: Formatters;
}

export interface LocaleProvider extends Locale {
  setLocale(locale: string): void;
  setDirection(direction: Direction | 'auto'): void;
  setMessages(messages: MessageCatalog): void;

  /**
   * `lang` and `dir` for the element this locale governs, and a mark on a
   * `dir` that was resolved rather than forced — which is how a locale nested
   * inside tells this one's answer from an author's, whether or not this one
   * was given its `element`.
   *
   * The provider writes `dir` here, which is why it does not read `dir` back
   * off that same element: it would resolve to whatever it last wrote and stop
   * following the locale. It reads what the element *inherits* instead. The
   * cost is that a `dir` attribute written by hand on the provider's own
   * element is ignored — use the `direction` option, which is the one way to
   * say it.
   */
  providerProps(): LocaleProps;
}

/**
 * A catalogue arrives either as a plain object or as a signal to swap later.
 *
 * Both casts state the same fact: `isWritableSignal` narrows to
 * `Signal.State<unknown>`, and a state signal is invariant in its value type,
 * so neither branch is narrowed to the member of the union it plainly is.
 */
function messageState(
  given: MessageCatalog | Signal.State<MessageCatalog> | undefined,
): Signal.State<MessageCatalog> {
  if (isWritableSignal(given)) return given as Signal.State<MessageCatalog>;
  return new Signal.State<MessageCatalog>((given ?? {}) as MessageCatalog);
}

/**
 * A locale, with nothing provided to the scope.
 *
 * `createLocaleProvider` is what a component wants. This is for the cases
 * where there is no scope to provide into: a server render, a worker, a
 * one-off formatter in a utility.
 */
export function createLocale(options: LocaleOptions = {}): LocaleProvider {
  const code = options.locale ?? new Signal.State(options.defaultLocale ?? ambientLocaleCode());
  const dir =
    options.direction ??
    new Signal.State<Direction | 'auto'>(options.defaultDirection ?? 'auto');

  const messages = messageState(options.messages);

  /**
   * What the governed element inherits from the DOM, or null when nothing
   * declares anything.
   *
   * Its own `dir` is skipped: `providerProps` writes that attribute, and an
   * element that reads back what it wrote can never change its mind again.
   * What it inherits is the question actually being asked.
   */
  const readInherited = (): Direction | null => {
    const el = options.element?.();
    return el ? inheritedDirection(el) : null;
  };

  /**
   * The DOM's answer, held in a signal because the DOM is not reactive and
   * cannot be read for it at the only moment a template would: during its own
   * evaluation the element is still detached, with no ancestor to inherit
   * from.
   */
  const domDirection = new Signal.State<Direction | null>(null);

  if (options.element) {
    // A user effect, so it runs after the tree it measures has been inserted,
    // and again whenever the ref changes.
    effect(() => domDirection.set(readInherited()));

    if (typeof document !== 'undefined') {
      const observer = new MutationObserver(() => {
        // Writing the same value is a no-op, which is what keeps the
        // provider's own `dir` write from waking the effect that wrote it —
        // that pair is a microtask loop which never yields to anything.
        // Untracked because a mutation callback can land inside any
        // computation, and must not become a dependency of it.
        domDirection.set(Signal.subtle.untrack(readInherited));
      });

      // Subtree, from the root: every ancestor of every candidate element is
      // covered by one observer, and the filter means it only wakes for `dir`
      // — and for the mark, since an enclosing locale going from `auto` to a
      // forced direction of the same value changes that and nothing else.
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['dir', RESOLVED_DIR_ATTRIBUTE],
        subtree: true,
      });
      onCleanup(() => observer.disconnect());
    }
  }

  const direction = (): Direction => {
    const forced = dir.get();
    if (forced !== 'auto') return forced;
    return domDirection.get() ?? scriptDirection(code.get()) ?? 'ltr';
  };

  const lookup = (key: string): Message | undefined =>
    ownMessage(messages.get(), key) ?? ownMessage(DEFAULT_MESSAGES, key);

  const collator = (extra?: Intl.CollatorOptions): Intl.Collator =>
    getCollator(code.get(), { ...DEFAULT_COLLATOR_OPTIONS, ...options.collator, ...extra });

  const setLocale = (next: string): void => {
    if (code.get() === next) return;
    code.set(next);
    options.onLocaleChange?.(next);
  };

  return {
    code: () => code.get(),
    direction,

    t(key, values) {
      const message = lookup(key);
      if (message === undefined) return key;
      const template =
        typeof message === 'string' ? message : selectPlural(message, values, code.get());
      return interpolate(template, values, code.get());
    },

    has: (key) => lookup(key) !== undefined,
    plural: (count, pluralOptions) => getPluralRules(code.get(), pluralOptions).select(count),

    compare: (a, b) => collator().compare(a, b),
    collator,

    format: createFormatters(() => code.get()),

    setLocale,
    setDirection: (next) => dir.set(next),
    setMessages: (next) => messages.set(next),

    providerProps: () => ({
      lang: code.get(),
      dir: direction(),
      [RESOLVED_DIR_ATTRIBUTE]: dir.get() === 'auto' ? 'auto' : undefined,
    }),
  };
}

const LocaleContext = createContext<Locale | null>(null, 'volt.locale');

/**
 * Create a locale and provide it to everything below in the reactive scope.
 *
 * Scope rather than DOM: content rendered through a `:portal` still sees the
 * provider that declared it, which is the case an ancestor lookup gets wrong.
 */
export function createLocaleProvider(options: LocaleOptions = {}): LocaleProvider {
  const locale = createLocale(options);
  provideContext(LocaleContext, locale);
  return locale;
}

/**
 * The nearest provided locale.
 *
 * With no provider anywhere, the document's own `lang` — then the browser's —
 * stands in, so a component is never without one and an application that only
 * ever speaks one language needs no provider at all.
 */
export function useLocale(): Locale {
  return useContext(LocaleContext) ?? requestState(AMBIENT, () => createLocale());
}

/**
 * The fallback locale is per request, not per process.
 *
 * It is also the path taken whenever nothing provides a locale, which makes it
 * the likeliest thing on a server to be wrong: the first request to ask would
 * otherwise decide what language every request after it is formatted in.
 */
const AMBIENT = Symbol('volt.locale');

/**
 * The tag to fall back on: what the document says, then what the browser does.
 *
 * `<html lang>` is validated because `lang="english"` is common in the wild and
 * every `Intl` constructor throws RangeError on it — which would turn a typo in
 * someone's markup into a page that does not render.
 */
function ambientLocaleCode(): string {
  if (typeof document !== 'undefined') {
    const lang = document.documentElement.getAttribute('lang');
    if (lang) {
      try {
        Intl.getCanonicalLocales(lang);
        return lang;
      } catch {
        // Fall through to the browser's own.
      }
    }
  }
  if (typeof navigator !== 'undefined' && navigator.language) return navigator.language;
  return 'en';
}

/** Test seam: forget the ambient locale and every cached Intl instance. */
export function resetLocaleCaches(): void {
  clearRequestState(AMBIENT);
  instances.clear();
  scriptDirections.clear();
}
