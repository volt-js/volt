import { Component, Prop, Signal, useContext } from '@voltdev/core';
import type { NavigationPropValue, NavigationProps } from '@voltdev/primitives';
import { BreadcrumbContext, said, type VBreadcrumb } from './breadcrumb.js';

/**
 * One crumb of a trail: a place above the current page, or the page itself.
 *
 * ```html
 * <v-breadcrumb-item href="/docs">Docs</v-breadcrumb-item>
 * ```
 *
 * It draws its own `<li>` where it is written, inside the trail's list, with
 * an `<a>` in it holding what was written inside the tag. Whatever a caller
 * writes on the tag lands on that `<a>` — the link a reader follows and a
 * screen reader announces — so a crumb is styled, named and marked like the
 * link it is. `data-volt-no-router` is one of those, and opts the link out of
 * a router; it lands on the link in the trail and not on its copy in the
 * overflow menu, so write `rel="external"` for a crumb both should leave to
 * the browser. `aria-label` is the exception, and reaches both copies.
 *
 * Which crumb is the current page is decided by position, not by a prop: the
 * last one is. It keeps its words and loses its `href`, and carries
 * `aria-current="page"` instead — the page a reader is on is somewhere to
 * be, not somewhere to go. That makes `aria-current` the trail's to write:
 * every crumb is the last one for a moment while the trail is being built,
 * one registering after another, so a value written on the tag is replaced
 * then and taken back after.
 *
 * Its words are the content of the tag, which is drawn twice when the crumb
 * collapses: once in the trail, hidden, where its width is still measured to
 * decide whether it comes back, and once as a link in the overflow menu.
 */
@Component({ selector: 'v-breadcrumb-item', templateUrl: './breadcrumb-item.html' })
export class VBreadcrumbItem {
  /**
   * Where the crumb goes. Dropped from the last crumb, which is the page the
   * reader is on; a crumb without one is a section with no page of its own,
   * and reads as text.
   */
  @Prop() href = new Signal.State<string | undefined>(undefined);
  /**
   * The link's relationship to the page, on the crumb in the trail and on its
   * copy in the overflow menu alike. `external` is the one a router reads: a
   * same-origin page the server owns, which a click must not take over.
   */
  @Prop() rel = new Signal.State<string | undefined>(undefined);
  /**
   * The crumb's name, for one whose words are not it — an icon, say.
   *
   * Declared rather than left to fall through to `:host` with everything else,
   * because what lands there reaches the link in the trail only, and a crumb
   * that folds is drawn a second time, as a link in the overflow menu. That
   * copy is the same place to go, and one place to go has one name, wherever
   * it is drawn.
   */
  @Prop({ alias: 'aria-label' }) ariaLabel = new Signal.State<string | undefined>(undefined);

  /** The `<li>` this draws, which is how the trail learns where the crumb is. */
  element: Element | null = null;
  /**
   * The overflow button, when this is the crumb it is drawn in front of. The
   * trail hands it to the primitive, which anchors the menu to it and does not
   * count a press on it as one outside the menu.
   */
  overflowTrigger = new Signal.State<Element | null>(null);

  /**
   * The trail this was written inside, read while the field initializes —
   * which is when a crumb is inside the trail's own render.
   */
  readonly breadcrumb: VBreadcrumb = (() => {
    const breadcrumb = useContext(BreadcrumbContext);
    if (!breadcrumb) {
      throw new Error(
        '[volt] <v-breadcrumb-item> has to be written inside <v-breadcrumb>: a crumb is an ' +
          'item of that trail’s list, and which crumb is the current page, and which ones ' +
          'collapse, is decided by its place among the others.',
      );
    }
    return breadcrumb;
  })();

  constructor() {
    this.breadcrumb.items.add(this);
  }

  /** Where this crumb is in the trail, which is everything the primitive keys by. */
  index(): number {
    return this.breadcrumb.indexOf(this);
  }

  /** Whether this is the page the reader is on — the last crumb. */
  current(): boolean {
    const index = this.index();
    return index >= 0 && this.breadcrumb.crumbs.isCurrent(index);
  }

  /** Whether the overflow button is drawn in front of this crumb. */
  leads(): boolean {
    return this.breadcrumb.leader() === this;
  }

  /** The `href` to write: none on the current page. */
  link(): string | undefined {
    return this.current() ? undefined : this.href.get();
  }

  /**
   * The link's attributes, with its name, less what the primitive has no
   * opinion about: this bag is spread over the element `:host` writes to.
   */
  linkProps(): Record<string, NavigationPropValue> {
    return said({
      ...this.breadcrumb.crumbs.linkProps(this.index()),
      'aria-label': this.ariaLabel.get(),
    });
  }

  /**
   * The copy in the overflow menu: an item of that menu, named as the crumb
   * is, and the current page still, when a trail that keeps no crumbs at its
   * end has collapsed it.
   */
  menuLinkProps(): NavigationProps {
    return {
      ...this.breadcrumb.crumbs.overflowLinkProps(this.index()),
      'aria-current': this.current() ? 'page' : undefined,
      'aria-label': this.ariaLabel.get(),
    };
  }
}
