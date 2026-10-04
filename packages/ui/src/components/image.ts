import { Component, Prop, Signal, effect } from '@voltdev/core';
import {
  createImage,
  useProvidedLocale,
  type Image,
  type ImageOptions,
  type ImageProps,
  type ImageStatus,
  type Locale,
} from '@voltdev/primitives';

declare const __VOLT_DEV__: boolean;

const { untrack } = Signal.subtle;

/** How the picture fills a box that is not its own shape. */
export type ImageFit = 'cover' | 'contain';

/** The entries of the primitive's bag that start a request when written. */
const SOURCES: ReadonlySet<string> = new Set(['src', 'srcset', 'sizes']);

/**
 * A number of CSS pixels, as an attribute is able to carry one.
 *
 * `width="1200"` arrives as the string `'1200'`, and the primitive takes a
 * number and drops anything else without a word — a string, a zero, a
 * negative, `Infinity` — which leaves the box with no shape and the `<img>`
 * with no size: the jump this component exists to prevent, back again. So
 * the string is read here, and a value that is not a positive number of
 * pixels is refused by name. `100%` is the usual one: a length in CSS belongs
 * on a class, and this is the picture's own size.
 *
 * Emptiness is judged after the trim, because `Number` reads whitespace as
 * zero.
 */
function pixels(value: number | string, prop: 'width' | 'height'): number {
  const text = typeof value === 'number' ? value : String(value).trim();
  const parsed = text === '' ? Number.NaN : Number(text);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(
      `[volt] \`${prop}\` on <v-image> is the picture's own ${prop} in CSS pixels — a number ` +
        `above zero — and \`${String(value)}\` is not one. A size in CSS goes on a class.`,
    );
  }
  return parsed;
}

/**
 * A shape, as CSS writes one.
 *
 * The primitive writes `aspect-ratio` as it is handed it, and a browser drops
 * a value it cannot read with nothing said: `16:9`, the spelling everywhere
 * outside CSS, would leave the box with no shape. So the value is read here —
 * one number, or two either side of a slash, none of them zero, which CSS
 * takes to mean no ratio at all — and anything else is refused by name.
 */
function shape(value: string): string {
  const text = String(value).trim();
  const parts = text.split('/').map((part) => part.trim());
  const numbers = parts.map((part) =>
    /^(?:\d+(?:\.\d+)?|\.\d+)$/.test(part) ? Number(part) : Number.NaN,
  );
  if (parts.length > 2 || !numbers.every((number) => number > 0)) {
    throw new Error(
      `[volt] \`ratio\` on <v-image> is a shape as CSS writes one — \`16 / 9\`, or \`1.5\` — ` +
        `and \`${String(value)}\` is not one.`,
    );
  }
  return text;
}

/**
 * A picture that reserves its space and knows how it went.
 *
 * ```html
 * <v-image src="/cover.jpg" alt="The first edition, in green cloth"
 *          width="1200" height="800"></v-image>
 * ```
 *
 * A box, the `<img>` inside it, and two things that stand in the box while
 * the picture is not there: the `placeholder` slot while it loads, and the
 * `error` slot when it does not. The box is the right shape before a byte
 * arrives — from `width` and `height`, or from `ratio` when the pixel size is
 * not known — so nothing below it moves when the picture lands.
 *
 * The `<img>` is on the page the whole time, never under `:if`, because it is
 * what the primitive watches: the load is heard on the rendered element
 * rather than on a detached `new Image()`, which is what makes `srcset` work
 * and keeps a second request off the wire. The placeholder and the message
 * come and go around it.
 *
 * `alt` is required, because it is the one decision about a picture that
 * cannot be deferred: either it says something the text around it does not,
 * or it is decoration and must be announced as nothing. `alt=""`, or `alt`
 * written bare, is the second, and the primitive is built decorative for it:
 * `alt=""` and `role="presentation"` on the picture, and `isDecorative()`
 * saying so. That is decided once, when the tag is built, because the
 * primitive decides it once.
 *
 * What a caller writes on the tag — a class, an id, a `data-*` — lands on the
 * box, which is the element their layout places and the one holding the
 * space. The box has no role, so the three attributes that name or describe
 * something are declared here and put on the `<img>`, which does.
 *
 * A server writes the status the primitive is built with, because the effect
 * that moves it on is one a server never runs. So it is built `loading` when
 * there is something to load, as a browser's first flush would have it: the
 * placeholder is in the server's markup, and a rule keyed on the status draws
 * that markup as it draws the client's.
 *
 * `:ref` reaches `image`, the primitive, for the status and everything else
 * this does not draw.
 */
@Component({ selector: 'v-image', templateUrl: './image.html' })
export class VImage {
  /** What to load. Empty, `null` or left off means there is nothing to fetch. */
  @Prop() src = new Signal.State<string | null | undefined>(undefined);
  /**
   * What the picture says. Required. `''` — or `alt` written bare, as on an
   * `<img>` — is a picture that says nothing: decoration beside text that
   * already says everything. That is decided when the tag is built: see
   * `reportLateWords`.
   */
  @Prop({ required: true }) alt = new Signal.State<string | null | undefined>(undefined);
  /** Candidate sources, and the widths that choose between them. A source on its own. */
  @Prop() srcset = new Signal.State<string | null | undefined>(undefined);
  /** How wide the picture will be drawn, for the browser choosing from `srcset`. */
  @Prop() sizes = new Signal.State<string | null | undefined>(undefined);
  /** `cover` crops to fill the box; `contain` letterboxes inside it. Default `cover`. */
  @Prop() fit = new Signal.State<ImageFit>('cover');

  // The five below are what the primitive is built with, and it reads each of
  // them once — plain, because a signal would promise a caller they can change
  // one later, and the primitive would not hear it.

  /** The picture's own width in CSS pixels. With `height`, what holds the space. */
  @Prop() width?: number | string;
  /** The picture's own height in CSS pixels. */
  @Prop() height?: number | string;
  /**
   * The box's shape as CSS writes it — `16 / 9` — for a picture whose pixel
   * size is not known. Wins over the shape `width` and `height` imply, which
   * are still written on the `<img>`.
   */
  @Prop() ratio?: string;
  /**
   * `lazy` or `eager`. Default `lazy`.
   *
   * The primitive's own default is the browser's eager loading, for the one
   * picture at the top of the page that must not wait. A tag is written far
   * more often down a page than at the top of it, so the default is turned
   * round here, and the one that must not wait says `loading="eager"`.
   */
  @Prop() loading: 'lazy' | 'eager' = 'lazy';
  /** `async`, `sync` or `auto`. Default `async`, so decoding never holds up the page. */
  @Prop() decoding?: 'async' | 'sync' | 'auto';

  /** Called when the picture has loaded — a cached one included. */
  @Prop() onLoad?: () => void;
  /** Called when the load fails. */
  @Prop() onError?: () => void;

  /**
   * What a reader hears in place of `alt`, where the two should differ.
   * Declared rather than left to fall through to `:host`, which is the box: a
   * name there sits on an element with no role, where it is thrown away.
   */
  @Prop({ alias: 'aria-label' }) ariaLabel = new Signal.State<string | undefined>(undefined);
  /** Id of the element that names the picture, where the page already says what it is. */
  @Prop({ alias: 'aria-labelledby' }) ariaLabelledBy = new Signal.State<string | undefined>(
    undefined,
  );
  /** Id of an element that says more — a caption, a credit. */
  @Prop({ alias: 'aria-describedby' }) describedBy = new Signal.State<string | undefined>(
    undefined,
  );

  /**
   * The picture, which the primitive watches for `load` and `error`. A
   * signal, because it does not exist while this class is being built.
   */
  img = new Signal.State<Element | null>(null);

  /**
   * The primitive, built from the props above — which is why props have to be
   * there while a field initializes. The sources and the words are accessors
   * over signals, so a picture swapped later is a new load rather than one
   * read once; the size, the hints and whether it is decoration are read here,
   * and once.
   */
  readonly image: Image = createImage(this.options());

  /** The provided locale, if any, for the one sentence the tag says itself. */
  private readonly locale: Locale | null = useProvidedLocale();

  /** Whether the late-words warning has been given, so it is given once. */
  #warned = false;

  constructor() {
    if (__VOLT_DEV__) {
      effect(() => this.reportNamesOnDecoration());
      effect(() => this.reportLateWords());
    }
  }

  /**
   * The `<img>`'s attributes: the primitive's, with the caller's name and
   * references beside them, and without the three that say where the picture
   * comes from, which `source` writes.
   *
   * None of the names goes on a picture the primitive made decoration. A
   * global ARIA attribute overrides `role="presentation"`, so a description
   * there would announce the picture again, nameless, and the primitive's
   * decision is the one to keep.
   */
  imageProps(): ImageProps {
    const props: Record<string, string | boolean | undefined> = {};
    for (const [name, value] of Object.entries(this.image.imageProps())) {
      if (!SOURCES.has(name)) props[name] = value;
    }
    return this.image.isDecorative() ? props : { ...props, ...this.names() };
  }

  /**
   * What the box says when the picture did not load, unless the `error` slot
   * says it instead: the provided locale's `imageFailed`, else English.
   *
   * Asked of the locale rather than written into the template, as every other
   * word the library speaks is — written there, a page in German said it in
   * English whatever its catalogue held, and the only way round was an
   * `error` slot on every tag.
   */
  failure(): string {
    return this.locale?.has('imageFailed')
      ? this.locale.t('imageFailed')
      : 'The picture did not load.';
  }

  /**
   * `src`, `srcset` or `sizes`, as the primitive writes it.
   *
   * Bound one at a time rather than spread with the rest, because a spread
   * writes every entry of its bag each time the bag is rebuilt, and the
   * primitive rebuilds its bag whenever the status moves. A browser takes a
   * source written again as the picture asked for again, unchanged or not:
   * one that had failed was fetched a second time the moment it failed, and
   * again for every name or word that changed after. A binding of its own is
   * written when its value changes and not otherwise.
   */
  source(name: 'src' | 'srcset' | 'sizes'): string | undefined {
    const value = this.image.imageProps()[name];
    return typeof value === 'string' ? value : undefined;
  }

  /**
   * What the primitive is built with.
   *
   * The status is handed in rather than left to the primitive, whose own
   * starts `idle` and is moved on by an effect: on a server that effect never
   * runs, and a page written there would carry a picture that is not loading
   * and no placeholder, where the same page in a browser carries both from
   * its first flush.
   */
  private options(): ImageOptions {
    const fetching = untrack(() => Boolean(this.src.get()?.trim() || this.srcset.get()?.trim()));
    const base = {
      image: () => this.img.get(),
      src: () => this.src.get(),
      srcset: () => this.srcset.get(),
      sizes: () => this.sizes.get(),
      width: this.width == null ? undefined : pixels(this.width, 'width'),
      height: this.height == null ? undefined : pixels(this.height, 'height'),
      aspectRatio: this.ratio == null ? undefined : shape(this.ratio),
      loading: this.loading,
      decoding: this.decoding,
      status: new Signal.State<ImageStatus>(fetching ? 'loading' : 'idle'),
      onStatusChange: (status: ImageStatus) => this.settled(status),
    };
    return untrack(() => this.silent())
      ? { ...base, decorative: true }
      : { ...base, alt: () => this.words()?.trim() ?? '' };
  }

  /**
   * `alt` as words.
   *
   * Written bare — `<v-image alt>`, the way `<img alt>` is written — it
   * arrives as `true`, which HTML reads as an empty `alt` and which is read
   * the same way here. Trimmed as it was, it threw inside the effect that
   * writes the picture, and left an `<img>` with no source and no `alt` at all.
   */
  private words(): string | null | undefined {
    const alt: unknown = this.alt.get();
    return alt === true ? '' : (alt as string | null | undefined);
  }

  /**
   * Whether `alt` is written and says nothing.
   *
   * Trimmed, because spaces are not a description. `null` and `undefined`
   * are not the word for decoration — a bound `alt` whose words are on their
   * way is `undefined` until they arrive — and the primitive still writes
   * `alt=""` for them, so nothing is read out as a URL meanwhile.
   */
  private silent(): boolean {
    const alt = this.words();
    return typeof alt === 'string' && alt.trim() === '';
  }

  /** Only what was written: an absent name is not an attribute. */
  private names(): ImageProps {
    const label = this.ariaLabel.get()?.trim();
    const labelledBy = this.ariaLabelledBy.get();
    const describedBy = this.describedBy.get();
    return {
      ...(label ? { 'aria-label': label } : {}),
      ...(labelledBy ? { 'aria-labelledby': labelledBy } : {}),
      ...(describedBy ? { 'aria-describedby': describedBy } : {}),
    };
  }

  /** The two callbacks, from the one the primitive has. */
  private settled(status: ImageStatus): void {
    if (status === 'loaded') this.onLoad?.();
    else if (status === 'error') this.onError?.();
  }

  /**
   * A name or a reference on a picture that says nothing goes nowhere, so say
   * so — it is dropped in `imageProps`, and a caller who wrote a caption's id
   * and hears nothing would otherwise never find out why.
   */
  private reportNamesOnDecoration(): void {
    if (!this.image.isDecorative() || typeof console === 'undefined') return;
    const written = [
      ['aria-label', this.ariaLabel.get()],
      ['aria-labelledby', this.ariaLabelledBy.get()],
      ['aria-describedby', this.describedBy.get()],
    ].filter((entry): entry is [string, string] => Boolean(entry[1]?.trim()));
    if (written.length === 0) return;

    const attributes = written.map(([attribute, value]) => `${attribute}="${value}"`).join(' and ');
    console.warn(
      `[volt] <v-image> was given ${attributes} and an empty \`alt\`, so it is decoration and ` +
        `${written.length === 1 ? 'that goes' : 'those go'} nowhere.\n` +
        '  Give it an `alt` that says what the picture is: a name or a description is for a ' +
        'picture that is announced, and an empty `alt` says this one is not.',
    );
  }

  /**
   * Words arriving for a picture built as decoration are never heard, so say
   * so.
   *
   * The primitive decides once whether a picture is announced, and this one
   * was built with an empty `alt`. The commonest way here is a bound `alt`
   * that is `''` while its data loads — `:alt="book.get()?.title ?? ''"` —
   * and the way out is to leave it `undefined` meanwhile, which is not
   * decoration.
   */
  private reportLateWords(): void {
    if (!this.image.isDecorative() || this.#warned) return;
    const alt = this.words()?.trim();
    if (!alt || typeof console === 'undefined') return;

    this.#warned = true;
    console.warn(
      `[volt] <v-image> was built with an empty \`alt\`, so it is decoration for good, and ` +
        `the "${alt}" it has been given since is never heard.\n` +
        '  Whether a picture is announced is decided once. While its words are on their way, ' +
        'leave `alt` undefined rather than empty — undefined is not decoration.',
    );
  }
}
