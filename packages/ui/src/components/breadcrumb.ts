import { Component, Prop, Signal, createContext, provideContext } from '@voltdev/core';
import {
  createBreadcrumb,
  ITEM_ATTRIBUTE,
  type Breadcrumb,
  type NavigationPropValue,
  type NavigationProps,
} from '@voltdev/primitives';
import { TagChildren } from './children.js';
import type { VBreadcrumbItem } from './breadcrumb-item.js';

/**
 * How a crumb finds the trail it was written inside.
 *
 * The content of a tag is built while the tag it sits in renders, so a crumb's
 * scope descends from this one. A crumb written anywhere else finds nothing
 * and says so.
 */
export const BreadcrumbContext = createContext<VBreadcrumb | null>(null);

/**
 * The bag, less the entries it carries as `undefined`.
 *
 * A crumb's link bag is spread over the element `:host` writes to, and there
 * an entry carried as `undefined` is not an attribute skipped but an attribute
 * removed, on every render that applies the bag. The primitive's carries
 * `aria-current` that way on every crumb but the last. A key the bag stops
 * carrying is still taken back, because the spread remembers what it wrote.
 */
export function said(props: NavigationProps): Record<string, NavigationPropValue> {
  return Object.fromEntries(Object.entries(props).filter(([, value]) => value !== undefined));
}

/**
 * A count of crumbs, however it was written.
 *
 * `itemsBefore="2"` arrives as the string `'2'`. The primitive happens to read
 * that as the number it looks like, and reads `'two'` the same way, as `NaN`
 * — and a trail that keeps `NaN` crumbs at its start never collapses, and
 * never says why. So the number is read here, and what is not a whole number
 * of crumbs is refused rather than guessed at.
 *
 * Taken as `unknown` because the type is not what arrives: `itemsBefore`
 * written bare comes as `true`, and `:itemsBefore="count"` as whatever
 * `count` holds. Only a number, or a string that reads as one, is a count;
 * anything else is refused in the same words, rather than failing inside the
 * parse with an error that names neither the tag nor the prop.
 */
function whole(value: unknown, prop: string): number {
  const text = typeof value === 'string' ? value.trim() : value;
  const parsed =
    typeof text === 'number'
      ? text
      : typeof text === 'string' && text !== ''
        ? Number(text)
        : Number.NaN;
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(
      `[volt] \`${prop}\` on <v-breadcrumb> takes a whole number of crumbs, and ` +
        `\`${String(value)}\` is not one.`,
    );
  }
  return parsed;
}

/**
 * Where the current page sits in the hierarchy above it.
 *
 * ```html
 * <v-breadcrumb>
 *   <v-breadcrumb-item href="/">Home</v-breadcrumb-item>
 *   <v-breadcrumb-item href="/docs">Docs</v-breadcrumb-item>
 *   <v-breadcrumb-item href="/docs/routing">Routing</v-breadcrumb-item>
 * </v-breadcrumb>
 * ```
 *
 * A navigation landmark holding an ordered list, one crumb per tag, the root
 * first. The last crumb is the page the reader is on: it is marked
 * `aria-current="page"` and loses its `href`, because a link to where you
 * already are is a way to go nowhere. The separators between crumbs are
 * `aria-hidden` — a screen reader already hears a list, and "slash" between
 * every pair of names is noise.
 *
 * Each crumb draws its own `<li>` where it is written, inside the list, and
 * registers here; its position among the others is its index, which is what
 * the primitive keys everything by. When the trail is wider than the list, the
 * primitive hides the fewest crumbs from the middle that make the rest fit and
 * this draws them again in a menu, behind a button that takes their place.
 *
 * That button is drawn by the crumb it stands in front of — the first one the
 * primitive may collapse — rather than here. The list's order is the reading
 * order and the tab order, and a slot drawn after the crumbs and moved into
 * place with CSS `order` would be seen second and reached last. The crumbs are
 * the caller's markup, so only a crumb can put something between two of them.
 *
 * Links are ordinary `<a href>`, in the trail and in the menu both, and a
 * press on one is left alone. A router listening on the document therefore
 * takes a click on a crumb the way it takes any other: a plain primary click
 * on a same-origin `href` becomes a navigation, and a modified click, a
 * middle click, or a crumb marked `rel="external"` stays the browser's.
 */
@Component({ selector: 'v-breadcrumb', templateUrl: './breadcrumb.html' })
export class VBreadcrumb {
  /**
   * The landmark's name. Default "Breadcrumb", the primitive's, which is in
   * this package's language rather than the page's — so a page in another one
   * says it here.
   */
  @Prop() label = new Signal.State<string | undefined>(undefined);
  /**
   * The same name in the platform's own spelling, declared rather than left
   * to fall through to `:host`.
   *
   * `:host` is on the `<nav>`, which is the element a name belongs on — but
   * the primitive's bag beside it names the landmark too, and whichever of the
   * two was applied last would win. A declared prop is never a host attribute,
   * so writing this down brings the name here, where `navProps()` merges it
   * in. What the caller wrote in ARIA wins over `label`: two spellings of one
   * name can only disagree by mistake.
   */
  @Prop({ alias: 'aria-label' }) ariaLabel = new Signal.State<string | undefined>(undefined);
  /**
   * The name of the button standing for the collapsed crumbs, whose visible
   * text is an ellipsis — read out as "dot dot dot", or not at all. Default
   * "Show the rest of the path". The menu it opens is named by it too.
   */
  @Prop() overflowLabel = new Signal.State<string | undefined>(undefined);

  /**
   * The three below are what the primitive is built with, read once while
   * this field list initializes — plain, because a signal would promise a
   * caller they can change them later and the primitive would not hear it.
   */
  /** Crumbs always shown at the start. Default 1 — the root. */
  @Prop() itemsBefore: number | string = 1;
  /** Crumbs always shown at the end. Default 1 — the current page. */
  @Prop() itemsAfter: number | string = 1;
  /**
   * Collapse the middle of the trail when it does not fit. Turn it off for a
   * trail that is short by construction, and nothing is measured.
   */
  @Prop() collapse = true;

  /** Called with the indices now in the overflow menu, in trail order. */
  @Prop() onCollapseChange?: (collapsed: readonly number[]) => void;

  /** The `<ol>`, which the primitive measures and the crumbs are placed in. */
  list = new Signal.State<Element | null>(null);
  /** The overflow menu, once it is open. */
  content = new Signal.State<Element | null>(null);

  /**
   * The crumbs, in the order their `<li>`s are in the list.
   *
   * The order is the whole of what a crumb is to the primitive — the root is
   * the first, the page is the last, and the middle is what collapses — and a
   * `:for` that grows registers its new crumbs after ones written below it.
   * So the order comes back from the DOM, which is the side that decided it.
   */
  readonly items = new TagChildren<VBreadcrumbItem>(
    () => this.list.get(),
    (item) => item.element,
  );

  /** Where the collapse starts, and so which crumb draws the overflow button. */
  readonly before: number = whole(this.itemsBefore, 'itemsBefore');

  /**
   * Whether the primitive was built to collapse, which is what the button
   * follows — never `collapse` itself.
   *
   * A plain prop bound to an expression is written again whenever the
   * expression changes, and the primitive, which read it once, does not hear
   * it. A button that read the prop would disappear the next time the crumbs
   * were drawn while the primitive went on folding them away, and nothing on
   * screen would reach them. Read the way the primitive reads it, too: only
   * `false` turns it off.
   */
  readonly collapses: boolean = this.collapse !== false;

  /**
   * The primitive, built from the props above — which is why props have to be
   * there while a field initializes.
   */
  readonly crumbs: Breadcrumb = createBreadcrumb({
    list: () => this.list.get(),
    // The list itself rather than its length, so a trail replaced by another
    // of the same length — the next page's — is measured again: widths change
    // with the words, and a count that did not would not say so.
    count: () => this.items.all.get().length,
    overflowContent: () => this.content.get(),
    overflowTrigger: () => this.leader()?.overflowTrigger.get() ?? null,
    itemsBefore: this.before,
    itemsAfter: whole(this.itemsAfter, 'itemsAfter'),
    collapse: this.collapses,
    ...(this.onCollapseChange ? { onCollapseChange: this.onCollapseChange } : {}),
  });

  constructor() {
    provideContext(BreadcrumbContext, this);
  }

  /** Where a crumb is in the trail, or -1 while it is not in it. */
  indexOf(item: VBreadcrumbItem): number {
    return this.items.all.get().indexOf(item);
  }

  /** The crumb that draws the overflow button in front of itself. */
  leader(): VBreadcrumbItem | undefined {
    return this.collapses ? this.items.all.get()[this.before] : undefined;
  }

  /**
   * Whether anything is drawn after the overflow button, and so whether a
   * separator belongs after it: the last crumb, unless a trail that keeps
   * nothing at its end has folded that one too.
   *
   * Read from the crumb's own `hidden` rather than from `isCollapsed`, so that
   * while the trail is laid out in full to be measured the separator is there
   * with it, and the button is measured as wide as it will be beside a crumb.
   */
  followed(): boolean {
    const last = this.items.all.get().length - 1;
    return last >= 0 && this.crumbs.itemProps(last)['hidden'] !== true;
  }

  /** The crumbs now in the overflow menu, in trail order. */
  collapsed(): VBreadcrumbItem[] {
    const all = this.items.all.get();
    return this.crumbs
      .collapsed()
      .map((index) => all[index])
      .filter((item): item is VBreadcrumbItem => item !== undefined);
  }

  /**
   * The landmark's attributes: the primitive's bag, with the name in it.
   *
   * One bag rather than a spread with a name written beside it, which the
   * spread would rewrite. Read here rather than handed to the primitive, which
   * reads its labels once, so a name bound to a signal follows it.
   */
  navProps(): Record<string, NavigationPropValue> {
    const name = this.ariaLabel.get() ?? this.label.get();
    const props = this.crumbs.navProps();
    return said(name === undefined ? props : { ...props, 'aria-label': name });
  }

  /**
   * Enter on a crumb in the menu that goes nowhere: a section with no page of
   * its own, or the page itself, folded in by a trail that keeps nothing at
   * its end.
   *
   * The primitive leaves Enter in this menu to the browser, because its items
   * are links, and a link's Enter follows it and fires the click that closes
   * the menu. An `<a>` with no `href` follows nothing and fires no click, so
   * the key would do nothing at all over one — while a press on the same item
   * closes the menu. It is chosen here instead, the way that press chooses it:
   * the menu closes and focus goes back to the button. A modified Enter is a
   * shortcut, not a choice, and is left alone.
   */
  settle(event: KeyboardEvent): void {
    if (event.key !== 'Enter') return;
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    const item =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>(`[${ITEM_ATTRIBUTE}]`)
        : null;
    if (!item || item.hasAttribute('href')) return;
    event.preventDefault();
    this.crumbs.menu.select(item);
  }

  /**
   * The overflow button's attributes, with its name read on every render for
   * the same reason. Not filtered: that button is the component's from end to
   * end, and an `aria-controls` the menu closing takes away has to come off.
   */
  triggerProps(): NavigationProps {
    const name = this.overflowLabel.get();
    const props = this.crumbs.overflowTriggerProps();
    return name === undefined ? props : { ...props, 'aria-label': name };
  }
}
