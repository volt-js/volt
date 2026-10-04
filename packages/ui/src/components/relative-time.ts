import { Component, Prop, Signal, effect } from '@voltdev/core';
import {
  createRelativeTime,
  getDateTimeFormat,
  useLocale,
  type Locale,
  type RelativeTime,
  type RelativeTimeOptions,
  type RelativeTimeProps,
} from '@voltdev/primitives';

/** See `@voltdev/core`'s own declaration: true while developing, false in production. */
declare const __VOLT_DEV__: boolean;

const { untrack } = Signal.subtle;

const WEEK = 7 * 24 * 60 * 60 * 1000;

/**
 * The date past the threshold, unless `format` says otherwise: the day and
 * not the hour, which the tooltip holds for a reader who wants it. A date and
 * time in the line itself is the tooltip said twice.
 */
const DATE_ONLY: Intl.DateTimeFormatOptions = { dateStyle: 'long' };

/**
 * The locale a caller named, refused when `Intl` cannot read it.
 *
 * Every `Intl` constructor throws on a tag that is not well formed — `en_GB`,
 * spelled the way POSIX and Java spell it — and it would do so inside the
 * binding that first reads the words, where the error is logged, the stamp is
 * left blank and the message names no tag. Refused here, while the prop is
 * still the thing that is wrong. A well-formed tag the engine has no data for
 * is not refused: `Intl` falls back to its default, and what it has data for
 * differs between a server and a browser.
 */
function localeOf(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  try {
    Intl.getCanonicalLocales(String(value));
  } catch {
    throw new Error(
      `[volt] \`locale\` on <v-relative-time> is a BCP 47 tag — 'fr', 'en-GB' — and ` +
        `\`${String(value)}\` is not one.`,
    );
  }
  return String(value);
}

/** `numeric`, refused on the same terms as `locale`. */
function numericOf(value: unknown): Intl.RelativeTimeFormatNumeric | undefined {
  if (value === undefined || value === null) return undefined;
  if (value === 'auto' || value === 'always') return value;
  throw new Error(
    `[volt] \`numeric\` on <v-relative-time> is 'auto' or 'always', and \`${String(value)}\` ` +
      'is neither.',
  );
}

/**
 * `style`, refused on the same terms — and named in the refusal for what it
 * is here, because the tag's `style` is the length of the words, as `Intl`
 * names it, and not the element's inline style. `style="color: gray"` is the
 * mistake that name invites, and it is better told than drawn in long words.
 */
function styleOf(value: unknown): Intl.RelativeTimeFormatStyle | undefined {
  if (value === undefined || value === null) return undefined;
  if (value === 'long' || value === 'short' || value === 'narrow') return value;
  throw new Error(
    `[volt] \`style\` on <v-relative-time> is how long the words are — 'long', 'short' or ` +
      `'narrow' — and \`${String(value)}\` is none of them.\n` +
      '  It is not the element’s inline style: give the tag a class for that.',
  );
}

/**
 * `format`, refused when it is not an object.
 *
 * A string is the binding written without its colon —
 * `format="{ dateStyle: 'medium' }"` — and `Intl.DateTimeFormat` reads a
 * string as options with nothing set, so the date would come out exactly as
 * before with nothing to say why.
 */
function formatOf(value: unknown): Intl.DateTimeFormatOptions | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object') {
    throw new Error(
      '[volt] `format` on <v-relative-time> is an `Intl.DateTimeFormat` options object, and ' +
        `\`${String(value)}\` is a ${typeof value}.\n  Bind it: :format="{ dateStyle: 'medium' }".`,
    );
  }
  return value as Intl.DateTimeFormatOptions;
}

/**
 * The threshold, as a tag is able to deliver one. Default a week.
 *
 * An attribute is a string, so `threshold="3600000"` arrives as `'3600000'`,
 * which is the number it spells. Anything else is refused rather than read:
 * no distance is at least `NaN`, so `threshold="1w"` would keep the words for
 * ever and say nothing, and a negative one is the date always, which is `0`.
 * `Infinity` is a number, and keeps the words for ever on purpose.
 *
 * Emptiness is judged after the trim, because `Number` reads blanks as zero:
 * `threshold=" "` would otherwise be the date always, quietly.
 */
function thresholdOf(value: number | string | null | undefined): number {
  if (value === undefined || value === null) return WEEK;
  const text = typeof value === 'number' ? value : value.trim();
  const parsed = text === '' ? Number.NaN : Number(text);
  if (Number.isNaN(parsed) || parsed < 0) {
    throw new Error(
      '[volt] `threshold` on <v-relative-time> is a distance in milliseconds, 0 or more, and ' +
        `\`${String(value)}\` is not one.\n  A day is :threshold="24 * 60 * 60 * 1000".`,
    );
  }
  return parsed;
}

/**
 * A timestamp that reads the way a person would say it, and stays true.
 *
 * ```html
 * Posted <v-relative-time :date="comment.postedAt"></v-relative-time>.
 * ```
 *
 * That is a `<time>` reading "3 minutes ago", with the exact moment in
 * `datetime` for a machine and in `title` for a reader who hovers — and it
 * keeps reading true. `createRelativeTime` owns that: every live stamp on the
 * page shares one ticker, paced by the shortest unit any of them is showing,
 * and stopped while the tab is hidden. A comment thread with two hundred
 * stamps holds one timer, not two hundred.
 *
 * Past `threshold` — a week, unless told otherwise — the words stop meaning
 * much ("last month" covers thirty days), so the stamp becomes the date
 * itself, written with `format`. That is the one thing here the primitive does
 * not do. The tooltip stays the primitive's exact moment whichever is showing,
 * so a stamp that reads "September 26, 2026" still has its hour a hover away;
 * it goes only when it would repeat the text on screen word for word, since an
 * underline promising a hover for what is already there promises nothing.
 *
 * ## On a server
 *
 * The text is written for the request's now — the shared clock is set as the
 * primitive is built, which on a server is while the request renders — and
 * the browser writes its own when the page attaches, since the page arrived
 * some time after the server read its clock. That rewrite is not a hydration
 * mismatch, and nothing reports one, by construction rather than by luck: the
 * hydration walk in `@voltdev/core` compares only the name of a block's first
 * node, and a binding writes its value rather than comparing it. So the words
 * are the whole content of the `<time>`, which the compiler makes a single
 * text binding with no marker and no hole of its own — the claim sees `TIME`
 * where it expected `TIME`, and the binding patches the server's text node in
 * place. The `<time>` a reader was already looking at is the one they keep.
 * Anything put beside the words — an `:if`, a second node — would give the
 * walk a structure to compare and a server and a browser a way to disagree
 * about it, which is why there is nothing there.
 *
 * The tooltip is a binding of its own, apart from the primitive's bag, for
 * the same moment. A spread takes back only what it wrote itself, and on a
 * page being claimed it wrote nothing yet: a `title` the server wrote and the
 * browser no longer wants — the stamp crossed its threshold in transit, and
 * now shows what the tooltip said — would stay, underline and all.
 * `:attr-title` writes absent as absent, the first time as every time.
 *
 * ## `:host`
 *
 * On the `<time>`, which is the only element there is: a caller's class, id,
 * `aria-*` and `data-*` land on it. `title`, `lang` and `data-unit` are
 * declared rather than left to fall through, because the stamp writes each of
 * them too, on the same element — the primitive's exact moment, the language
 * of `locale`, the unit the words count in — and two bindings writing one
 * attribute leave whichever ran last, or take the caller's away with their
 * own. Declared, the caller's own wins.
 *
 * Nothing here is a live region. A stamp quietly becoming "4 minutes ago" is
 * not news, and a page of them announcing themselves in turn would be
 * unusable; the primitive says so, and this does nothing to change it.
 */
@Component({ selector: 'v-relative-time', templateUrl: './relative-time.html' })
export class VRelativeTime {
  /**
   * The moment being described: a `Date`, a timestamp in milliseconds, or a
   * string `Date` can parse — write ISO 8601, with its zone, which every
   * engine reads alike. `null` draws an empty `<time>` with no `datetime`, for
   * a moment not known yet; so does a value that does not parse, since a
   * machine-readable moment that is wrong is worse than none.
   */
  @Prop({ required: true }) date = new Signal.State<Date | number | string | null | undefined>(
    undefined,
  );
  /**
   * BCP 47 tag for the words and the date — `fr`, `en-GB`. Default the locale
   * provider's, which a page that changes language changes for every stamp at
   * once. A stamp given one is marked with it in `lang` too, so that a screen
   * reader reads "il y a 3 minutes" in French rather than spelling it out in
   * the page's voice.
   *
   * A signal, like `numeric` and `style`, although the primitive is built with
   * all three while this field list initializes: it is handed getters rather
   * than values, and reads them inside its own formatters, so a page that
   * binds a language switcher to them moves the words, the date and the
   * tooltip together.
   */
  @Prop() locale = new Signal.State<string | null | undefined>(undefined);
  /** `auto`, the default, says "yesterday"; `always` says "1 day ago". */
  @Prop() numeric = new Signal.State<Intl.RelativeTimeFormatNumeric | null | undefined>(undefined);
  /**
   * How long the words are: `long`, the default, for "3 minutes ago"; `short`
   * for "3 min. ago"; `narrow` for the shortest the locale has. `Intl`'s name
   * for it, which makes it this tag's and not the element's inline style.
   */
  @Prop() style = new Signal.State<Intl.RelativeTimeFormatStyle | null | undefined>(undefined);
  /**
   * The language the stamp is read in, in place of `locale`. Declared rather
   * than left to fall through, for the reason `title` is: the stamp writes
   * `lang` itself when it has a `locale`, and two bindings writing one
   * attribute leave whichever ran last. What the caller writes wins.
   */
  @Prop() lang = new Signal.State<string | null | undefined>(undefined);
  /**
   * How far from now, in milliseconds, the words give way to the date itself.
   * Default a week. `:threshold="Infinity"` keeps the words for ever;
   * `threshold="0"` is always the date.
   */
  @Prop() threshold = new Signal.State<number | string | null | undefined>(undefined);
  /**
   * `Intl.DateTimeFormat` options for the date shown past `threshold`.
   * Default `{ dateStyle: 'long' }`. The tooltip is the exact moment whatever
   * this says. Bound, never written: an attribute is a string, and a string has
   * no options in it.
   */
  @Prop() format = new Signal.State<Intl.DateTimeFormatOptions | null | undefined>(undefined);
  /**
   * The tooltip, in place of the exact date and time the primitive writes.
   * `title=""` takes the tooltip away, and the underline that promised one
   * with it.
   */
  @Prop() title = new Signal.State<string | null | undefined>(undefined);
  /**
   * `data-unit`, in place of the unit the primitive writes there. Declared
   * rather than left to fall through with the rest of `data-*`, for the reason
   * `title` is: the primitive's bag carries one, and a spread writes over what
   * a caller put on the element when the date arrives and takes it away when
   * the date goes. What the caller writes wins.
   */
  @Prop({ alias: 'data-unit' }) dataUnit = new Signal.State<string | null | undefined>(undefined);

  /** The provider's locale, for the date past the threshold when `locale` is not given. */
  private readonly provided: Locale = useLocale();

  /**
   * The primitive, built from the props above — which is why props have to be
   * there while a field initializes.
   */
  readonly time: RelativeTime = createRelativeTime(this.options());

  /**
   * The formatter for the date past the threshold, from the primitives' shared
   * cache — so a page of stamps with one `format` builds one.
   *
   * Looked up again only when the language or `format` changes. Finding it
   * means working out its key from the options, and the shared ticker re-reads
   * every stamp on the page; the lookup is for a change of format to pay, not
   * for each stamp on each tick.
   */
  private readonly dateFormat = new Signal.Computed(() =>
    getDateTimeFormat(this.tag(), formatOf(this.format.get()) ?? DATE_ONLY),
  );

  constructor() {
    if (__VOLT_DEV__) effect(() => this.reportUnreadable());
  }

  /**
   * Whether the stamp is past its threshold, and so shows the date rather than
   * the words.
   *
   * Measured against the wall clock, since the primitive keeps its own to
   * itself; the two agree whenever the primitive ticks, which is the one
   * moment this is asked again. The unit is read for that, and for nothing
   * else: it is what subscribes whatever asks to the tick, so a stamp crosses
   * its threshold while it is on screen rather than when something else
   * happens to move.
   */
  isAbsolute(): boolean {
    const target = this.time.date();
    if (!target) return false;
    this.time.unit();
    return Math.abs(target.getTime() - Date.now()) >= thresholdOf(this.threshold.get());
  }

  /** What the `<time>` says: the words, or past the threshold the date. */
  text(): string {
    const target = this.time.date();
    if (!target) return '';
    return this.isAbsolute() ? this.dateFormat.get().format(target) : this.time.text();
  }

  /**
   * What `title` holds, or null for none.
   *
   * A caller's own wins, and one that is empty — or blanks, which a browser
   * shows as nothing — is a request for no tooltip. That is written as the
   * empty `title` it is, not left off: an element without one shows its
   * nearest titled ancestor's, so a stamp inside `<a title="Open">` would
   * hover with the link's words. Otherwise the primitive's exact moment,
   * unless that is what the stamp already says — and then nothing, since an
   * ancestor's advisory is as true of the stamp as of the rest of it.
   */
  tooltip(): string | null {
    const given = this.title.get();
    if (given !== undefined && given !== null) return given.trim() === '' ? '' : given;
    const exact = this.time.absolute();
    return exact === '' || exact === this.text() ? null : exact;
  }

  /**
   * The primitive's attributes, less the `title` that `tooltip` decides, and
   * with the caller's `data-unit` over the primitive's when they wrote one.
   */
  timeProps(): RelativeTimeProps {
    const { title: _, ...rest } = this.time.timeProps();
    const unit = this.dataUnit.get();
    return unit === undefined || unit === null ? rest : { ...rest, 'data-unit': unit };
  }

  /**
   * What `lang` holds, or null to inherit the page's: the caller's own, else
   * the locale the stamp was given. A stamp in the provider's language is in
   * the language of the page around it, and has nothing to add.
   */
  language(): string | null {
    const given = this.lang.get();
    if (given !== undefined && given !== null) return given;
    return localeOf(this.locale.get()) ?? null;
  }

  /** The language the date past the threshold is written in: the words' own. */
  private tag(): string {
    return localeOf(this.locale.get()) ?? this.provided.code();
  }

  /**
   * What the primitive is built with, refused before anything is built.
   *
   * The threshold and the format are not the primitive's, and are checked
   * here anyway: the primitive joins the shared ticker as it is built, and a
   * tag refused after that would leave it ticking for a stamp that never drew.
   * Checked once here, the error stops the page that wrote the tag; a value
   * bound later — a threshold, a format, a locale, `numeric` or `style` — is
   * refused by the binding that reads it, which can only log it.
   *
   * The format is checked by building its formatter, because options that
   * contradict each other — `dateStyle` beside `hour` — throw only then.
   */
  private options(): RelativeTimeOptions {
    thresholdOf(untrack(() => this.threshold.get()));
    const locale = localeOf(untrack(() => this.locale.get()));
    numericOf(untrack(() => this.numeric.get()));
    styleOf(untrack(() => this.style.get()));
    const format = formatOf(untrack(() => this.format.get()));
    if (format) {
      try {
        getDateTimeFormat(locale ?? untrack(() => this.provided.code()), format);
      } catch (error) {
        throw new Error(
          '[volt] `format` on <v-relative-time> is not something `Intl.DateTimeFormat` takes: ' +
            `${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    const options: RelativeTimeOptions = { date: () => this.date.get() };
    // Defined rather than written above, because the primitive reads these
    // inside its formatters each time they are asked for, and a getter is what
    // makes that a live read of the prop — one written in the object literal
    // would have the literal as its `this` rather than the component. Absent
    // reads as absent, so the primitive's own defaults still apply.
    Object.defineProperties(options, {
      locale: { get: () => localeOf(this.locale.get()), enumerable: true },
      numeric: { get: () => numericOf(this.numeric.get()), enumerable: true },
      style: { get: () => styleOf(this.style.get()), enumerable: true },
    });
    return options;
  }

  /**
   * A date that does not parse, said out loud.
   *
   * It draws the same empty `<time>` as `null`, which is right for a moment
   * not known yet and silent for one written wrong: `date="yesterday"`, or a
   * `03/04/2026` one engine reads as March and another refuses.
   */
  private reportUnreadable(): void {
    const given = this.date.get();
    if (given === undefined || given === null || given === '' || this.time.date()) return;
    if (typeof console === 'undefined') return;
    console.warn(
      `[volt] <v-relative-time> was given the date \`${String(given)}\`, which \`Date\` ` +
        'cannot read, so it draws nothing.\n' +
        "  Pass a `Date`, a timestamp in milliseconds, or ISO 8601: '2026-10-04T09:30:00Z'.",
    );
  }
}
