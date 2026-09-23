import { Component, Prop, Signal, effect } from '@voltdev/core';
import {
  createPagination,
  useLocale,
  type Locale,
  type NavigationProps,
  type Pagination,
  type PaginationControl,
  type PaginationLabels,
  type PaginationOptions,
} from '@voltdev/primitives';

/** Replaced by the build; `true` where there is none, which is a test run. */
declare const __VOLT_DEV__: boolean;

const { untrack } = Signal.subtle;

/** What names each control and page, and what the live region says. */
export type PaginationWording = Omit<PaginationLabels, 'nav'>;

/**
 * The caller's own signal, refused when it is not one.
 *
 * `page` is the one signal the page and the pager both hold, and markup has no
 * way to write a signal: `page="3"` and `:page="current.get()"` hand over a
 * string or a number, which the primitive keeps and later calls `.get()` on.
 * That `TypeError` is raised inside an effect, where it is swallowed, and what
 * is left is a row of page numbers that never moves. Refused here instead,
 * while the prop is still the thing that is wrong, and pointed at
 * `defaultPage`, which is how starting on a page is spelled.
 */
function ownSignal(value: unknown): Signal.State<number> {
  const candidate = value as Partial<Signal.State<number>> | null | undefined;
  if (typeof candidate?.get === 'function' && typeof candidate.set === 'function') {
    return value as Signal.State<number>;
  }
  throw new Error(
    '[volt] `page` on <v-pagination> takes a signal your component holds, and ' +
      `\`${String(value)}\` is not one.\n` +
      '  To start on a page, write `defaultPage`. To hold the page yourself — in the URL, most ' +
      'often — hold a `new Signal.State(1)` and pass that: `:page="current"`.',
  );
}

/**
 * A number, as a tag is able to deliver one.
 *
 * An attribute is only ever a string, so `total="94"` arrives as `'94'`. The
 * primitive floors what it is handed, which reads `'94'` as 94 already; what it
 * cannot read is a string that is not a number, which it would carry through as
 * `NaN` into every page it draws. That falls back instead.
 */
function whole(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/**
 * A click the browser is taking somewhere other than this page.
 *
 * ⌘ or Ctrl opens the link in a new tab, Shift in a new window, Alt downloads
 * it, and any button but the first is the browser's own — the same clicks the
 * router refuses to intercept. Each asks for a second place to look at that
 * page, and the reader goes on reading this one: paging it as well would move
 * the list out from under them and write a URL they did not ask this tab to
 * go to. Only on a link, because on a button none of them means anything but
 * a press.
 */
function opensElsewhere(event: Event): boolean {
  const click = event as Partial<MouseEvent>;
  const modified =
    click.metaKey === true ||
    click.ctrlKey === true ||
    click.shiftKey === true ||
    click.altKey === true ||
    (click.button !== undefined && click.button !== 0);
  if (!modified) return false;
  const target = event.target as Partial<Element> | null;
  return typeof target?.closest === 'function' && target.closest('a[href]') !== null;
}

/**
 * Moving between the pages of a list.
 *
 * ```html
 * <v-pagination :page="page" :total="results.get().length" pageSize="20"></v-pagination>
 * ```
 *
 * Previous, next, and the page numbers the primitive chooses to show, with an
 * ellipsis where it leaves some out — `createPagination` decides which, and
 * owns the keyboard: the row is one tab stop, and the arrow keys move inside
 * it.
 *
 * Every control is a `<button>` unless `href` is given, and that is the right
 * way round. This cannot know what a page's URL is, and a link without a real
 * one — `href="#"` — is announced as a link, opens a copy of the same page on a
 * middle-click, and leaves a crawler nothing to follow: a promise the control
 * does not keep. A button promises only what it does. Give `href` a function
 * from a page to its URL and every control is an `<a href>` instead, with the
 * middle-click, the address bar and the crawler that come with one — and a
 * ⌘-click that opens the page in a new tab leaves this one where it is.
 *
 * The page is one signal both sides hold. Pass `page` and the page that
 * writes `current.set(4)` moves the pager, and a press on the pager is read
 * back out of the same signal. It is not clamped there: a page restored from
 * the URL before the total has arrived is kept, and shown the moment there is
 * a page of that number to show. Draw the rows from `pagination.range()`,
 * which is.
 */
@Component({ selector: 'v-pagination', templateUrl: './pagination.html' })
export class VPagination {
  /**
   * Your own signal, when the page belongs to your component — in the URL,
   * most often. Pages are numbered from 1.
   */
  @Prop() page?: Signal.State<number>;
  /**
   * The two below are read once, while this field list initializes, because
   * that is when the primitive is built with them. Plain, because a signal
   * would promise a caller they can change them later while the primitive went
   * on using what it was built with.
   */
  /** The page to start on, when the page is the pager's own. Default 1. */
  @Prop() defaultPage?: number;
  /**
   * The arrow keys wrap past the ends of the row. Default false: the ends of a
   * pager mean something, and wrapping from the last page to the first is a
   * jump nobody asked for. Written bare — `loop` — or bound; `loop="false"` is
   * a string, and a string is truthy.
   */
  @Prop() loop = false;

  /** How many items there are to page through. */
  @Prop() total = new Signal.State(0);
  /**
   * How many of them make a page. Default 10.
   *
   * A change keeps the reader's place: the page moves to the one holding the
   * item that was at the top, rather than staying at a number that now means
   * somewhere else. A change made together with one to your `page` — both
   * restored from the URL — is taken as written.
   */
  @Prop() pageSize = new Signal.State(10);
  /** Pages shown either side of the current one. Default 1. */
  @Prop() siblings = new Signal.State(1);
  /** Pages always shown at each end of the row. Default 1. */
  @Prop() boundaries = new Signal.State(1);

  /**
   * A page's URL. Given, every control is an `<a href>` built from it;
   * without it, every control is a `<button>`.
   *
   * A function rather than a pattern with a hole in it, because the URL is
   * rarely the page number and nothing else: it keeps the rest of the query
   * string, it leaves `?page=1` off the first page, or it comes from
   * `router.href` — and a function is the one shape all three fit.
   */
  @Prop() href = new Signal.State<((page: number) => string) | undefined>(undefined);

  /**
   * Draws first-page and last-page controls outside previous and next.
   *
   * Off by default, because the row already shows the first and last page
   * unless `boundaries` is 0 — and two controls that go where a number beside
   * them already goes are two more tab stops' worth of arrow presses.
   */
  @Prop() showFirstLast = new Signal.State(false);

  /** Names the navigation landmark. Default "Pagination". */
  @Prop() label = new Signal.State<string | undefined>(undefined);
  /** Id of the element that names it, when a heading on the page already does. */
  @Prop() labelledBy = new Signal.State<string | undefined>(undefined);

  /**
   * The same two in the platform's own spelling, declared rather than left to
   * fall through to `:host`.
   *
   * `:host` is on the `<nav>`, which is the element a name belongs on — so a
   * name written on the tag lands in the right place on its own. What it would
   * not survive is the bag beside it: the primitive's `navProps()` names
   * `aria-label` whatever it is told, and a spread re-applied with its default
   * there wipes what the caller wrote a moment after it landed. A declared prop
   * is never a host attribute, so writing these down brings the name here,
   * where `navProps()` is given it instead.
   */
  @Prop({ alias: 'aria-label' }) ariaLabel = new Signal.State<string | undefined>(undefined);
  @Prop({ alias: 'aria-labelledby' }) ariaLabelledBy = new Signal.State<string | undefined>(
    undefined,
  );

  /**
   * Your wording for everything else that is said: the name of each control
   * and page, and what the live region announces. Defaults are English —
   * "Previous page", "Page 3" — and the locale's `pageOf` for the
   * announcement.
   *
   * Say the words a control shows, and more: a control filled with "Précédent"
   * and still named "Previous page" is one a voice user cannot press by
   * saying what they see.
   */
  @Prop() labels = new Signal.State<PaginationWording | undefined>(undefined);

  /**
   * Called with the page the pager moved to — by a press, a key, or a change of
   * `pageSize` — and never with where it started, or with a page your own
   * signal was set to.
   */
  @Prop() onPageChange?: (page: number) => void;

  /** The list holding the controls, which is the element the primitive is given. */
  list = new Signal.State<Element | null>(null);

  /**
   * The page's language, for the digits.
   *
   * The live region formats its numbers through the locale, so a page number
   * drawn as `String(3)` would say `3` beside an announcement that says `٣`.
   */
  readonly locale: Locale = useLocale();

  /**
   * The caller's page signal, checked once, here, because the primitive is
   * built with it and keeps it.
   */
  private readonly held: Signal.State<number> | undefined =
    this.page !== undefined ? ownSignal(this.page) : undefined;

  /**
   * The size the primitive pages by, held here rather than inside it so that
   * a size can be written without moving the page — see the constructor.
   */
  private readonly size = new Signal.State(whole(untrack(() => this.pageSize.get()), 10));

  /**
   * The primitive, built from the props above — which is why props have to be
   * there while a field initializes.
   */
  readonly pagination: Pagination = createPagination(this.options());

  constructor() {
    if (__VOLT_DEV__) this.checkHref();

    // A size on its own goes through `setPageSize`, because that is the call
    // that keeps the reader's place: written straight, it would leave the page
    // at its old number, now showing other items, and a `page` the caller
    // holds saying one page while the pager showed another.
    //
    // A size that arrives together with a new page is written straight. That
    // is the back button restoring both from the URL, and the page is then
    // not the pager's to move: it is the one being restored, and moving it to
    // keep a place nobody is reading would write a URL nobody asked for over
    // it — and report it as a move.
    let seen = untrack(() => this.asked());
    effect(() => {
      const size = whole(this.pageSize.get(), 10);
      const page = this.asked();
      untrack(() => {
        if (page === seen) this.pagination.setPageSize(size);
        else this.size.set(size);
        seen = this.asked();
      });
    });
  }

  /** The page as it was last set: the caller's own number, or the pager's. */
  private asked(): number {
    return this.held ? this.held.get() : this.pagination.page();
  }

  /** What the primitive is built with. */
  private options(): PaginationOptions {
    const options: PaginationOptions = {
      list: () => this.list.get(),
      total: () => whole(this.total.get(), 0),
      pageSize: this.size,
      // Truthy rather than `true`, because the primitive asks `=== true` and an
      // attribute is a string: `loop="true"` would otherwise ask for wrapping
      // in the words that say so and get none.
      loop: Boolean(this.loop),
      labels: this.wording(),
      ...(this.held ? { page: this.held } : {}),
      ...(this.defaultPage !== undefined ? { defaultPage: whole(this.defaultPage, 1) } : {}),
      ...(this.onPageChange ? { onPageChange: this.onPageChange } : {}),
    };

    // Defined rather than written above, because the primitive reads these two
    // every time it lays the row out, and a getter is what makes that a live
    // read — one written in the object literal would have the literal as its
    // `this` rather than the component.
    Object.defineProperties(options, {
      siblings: { get: () => whole(this.siblings.get(), 1), enumerable: true },
      boundaries: { get: () => whole(this.boundaries.get(), 1), enumerable: true },
    });
    return options;
  }

  /**
   * The wording, read through rather than handed over.
   *
   * The primitive reads each label on every call, so a getter is all it takes
   * for a signal to reach the names and the announcement — a catalogue swapped
   * later reaches a pager already on screen. Handing over the object instead
   * would freeze every name at whatever it was when the pager was built.
   */
  private wording(): PaginationLabels {
    const labels = this.labels;
    const named = (): string | undefined => this.ariaLabel.get() ?? this.label.get();
    return {
      get nav() {
        return named();
      },
      get page() {
        return labels.get()?.page;
      },
      get first() {
        return labels.get()?.first;
      },
      get previous() {
        return labels.get()?.previous;
      },
      get next() {
        return labels.get()?.next;
      },
      get last() {
        return labels.get()?.last;
      },
      get status() {
        return labels.get()?.status;
      },
    };
  }

  /**
   * A string where the function belongs, said while it is still the tag's.
   *
   * `href="/results?page={page}"` reads like a pattern, and the markup does
   * not fill it in: the pager would call a string, inside a render, where the
   * error is swallowed and the controls are left drawing nothing.
   */
  private checkHref(): void {
    const href: unknown = untrack(() => this.href.get());
    if (href == null || typeof href === 'function') return;
    throw new Error(
      `[volt] \`href\` on <v-pagination> takes a function from a page to its URL, and ` +
        `\`${String(href)}\` is not one.\n` +
        '  Write `:href="(page) => \'/results?page=\' + page"` — or build it with ' +
        '`router.href` — so the rest of the URL stays yours.',
    );
  }

  /** Whether the controls are links. */
  linked(): boolean {
    return this.link() !== undefined;
  }

  /**
   * The function that makes a URL, when there is one.
   *
   * Asked of its type rather than of whether something was given, so that a
   * build without the development check still draws buttons for a string
   * rather than calling it.
   */
  private link(): ((page: number) => string) | undefined {
    const href = this.href.get();
    return typeof href === 'function' ? href : undefined;
  }

  /**
   * What the landmark carries: the primitive's bag, and whichever name the
   * caller gave it.
   *
   * A reference replaces the name this component would make up — the default,
   * or `label` — because an element with both is named by the reference, and
   * a label of ours beside it drifts out of date unnoticed. An `aria-label`
   * the caller wrote themselves is theirs, and stays beside the reference as
   * it would on a `<nav>` of their own, where it is what the platform falls
   * back on if the reference finds nothing. What the caller wrote in ARIA
   * wins over the prop that says the same thing: two spellings of one name
   * can only disagree by mistake, and the attribute is the one they wrote on
   * the tag.
   */
  navProps(): NavigationProps {
    const labelledBy = this.ariaLabelledBy.get() ?? this.labelledBy.get();
    const props = this.pagination.navProps();
    return labelledBy
      ? { ...props, 'aria-label': this.ariaLabel.get(), 'aria-labelledby': labelledBy }
      : props;
  }

  /**
   * The row's keyboard and pointer handling, which is the primitive's — less a
   * click that opens a link somewhere else, which is the browser's alone.
   *
   * The primitive pages on every click that lands on a control. On a link,
   * a ⌘-click is a new tab, and it is left to the browser whole: neither paged
   * here nor prevented.
   */
  listProps(): NavigationProps {
    const props = this.pagination.listProps();
    const onclick = props['onclick'] as (event: Event) => void;
    return {
      ...props,
      onclick: (event: Event) => {
        if (!opensElsewhere(event)) onclick(event);
      },
    };
  }

  /** A page number, as the primitive marks it and, given `href`, where it goes. */
  pageProps(page: number): NavigationProps {
    const props = this.pagination.pageProps(page);
    const href = this.link();
    return href ? { ...props, href: href(page) } : props;
  }

  /**
   * Previous, next, first or last, and where each goes.
   *
   * A control with nowhere to go keeps its place in the row and loses its
   * `href`. That is how a link says it is off: with an `href` it would still
   * open a tab on a middle-click, to a page numbered 0. `role="link"` keeps it
   * announced as what it is while it has none, and `aria-disabled` says why.
   */
  controlProps(control: PaginationControl): NavigationProps {
    const props = this.pagination.controlProps(control);
    const href = this.link();
    if (!href) return props;
    if (this.pagination.isDisabled(control)) return { ...props, role: 'link' };
    return { ...props, href: href(this.target(control)) };
  }

  /** The page a control goes to. */
  private target(control: PaginationControl): number {
    const page = this.pagination.page();
    switch (control) {
      case 'first':
        return 1;
      case 'previous':
        return page - 1;
      case 'next':
        return page + 1;
      case 'last':
        return this.pagination.pageCount();
    }
  }

  /** A page number in the page's own digits, as the announcement says it. */
  number(page: number): string {
    return this.locale.format.number(page);
  }
}
