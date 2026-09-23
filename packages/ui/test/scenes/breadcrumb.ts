import { compileTemplate } from '@voltdev/core/jit';
import { Component, Signal } from '@voltdev/core';
import { createBreadcrumb, type NavigationProps } from '@voltdev/primitives';
import { show, step, type Scene } from '../scene.ts';

/**
 * Nothing kept at the end, so the page folds into the menu with the rest: the
 * one trail whose menu holds the page, which the sheet marks there as it does
 * in the trail. A trail that keeps the page at its end reaches no rule this
 * one does not, since the page is in the list either way, hidden or not.
 */
const AFTER = 0;

/** Crumbs always kept at the start, which is where the overflow button goes. */
const BEFORE = 1;

/**
 * A section with no page of its own sits in the middle, where it folds: the
 * sheet draws it as text in the trail and muted in the menu, and a trail of
 * links alone reaches neither.
 */
const TRAIL = [
  { index: 0, name: 'Home', href: '/' },
  { index: 1, name: 'Docs', href: '/docs' },
  { index: 2, name: 'Guides', href: undefined },
  { index: 3, name: 'Routing', href: '/routing' },
  { index: 4, name: 'Params', href: '/routing/params' },
];

@Component({
  selector: 'v-styled-breadcrumb',
  render: compileTemplate(`
    <div>
      <nav class="volt-breadcrumb" :spread="crumbs.navProps()">
        <ol :ref="list" class="volt-breadcrumb-list" :spread="crumbs.listProps()">
          <template :for="crumb in trail" :key="crumb.index">
            <li :if="crumb.index === before" class="volt-breadcrumb-item" :spread="crumbs.overflowProps()">
              <button :ref="trigger" type="button" class="volt-breadcrumb-trigger"
                      :spread="crumbs.overflowTriggerProps()">…</button>
              <span :if="followed()" class="volt-breadcrumb-separator"
                    :spread="crumbs.separatorProps()">/</span>
            </li>
            <li class="volt-breadcrumb-item" :spread="crumbs.itemProps(crumb.index)">
              <a class="volt-breadcrumb-link" :attr-href="link(crumb.index)"
                 :spread="crumbs.linkProps(crumb.index)">{ crumb.name }</a>
              <span :if="!crumbs.isCurrent(crumb.index)" class="volt-breadcrumb-separator"
                    :spread="crumbs.separatorProps()">/</span>
            </li>
          </template>
        </ol>
      </nav>

      <div :if="crumbs.menu.isPresent()" :portal :ref="content" class="volt-menu-content"
           :spread="crumbs.overflowContentProps()">
        <a :for="index in crumbs.collapsed()" :key="index" class="volt-menu-item volt-breadcrumb-menu-link"
           :attr-href="link(index)" :spread="menuLinkProps(index)">{ trail[index].name }</a>
      </div>
    </div>
  `),
})
class StyledBreadcrumb {
  trail = TRAIL;
  before = BEFORE;
  list = new Signal.State<Element | null>(null);
  trigger = new Signal.State<Element | null>(null);
  content = new Signal.State<Element | null>(null);
  crumbs = createBreadcrumb({
    list: () => this.list.get(),
    count: () => this.trail.length,
    overflowContent: () => this.content.get(),
    overflowTrigger: () => this.trigger.get(),
    itemsBefore: BEFORE,
    itemsAfter: AFTER,
  });

  // The three below are what `<v-breadcrumb-item>` adds to the primitive's
  // bags, so each crumb carries what a real one does: no `href` on the page the
  // reader is on, a separator after the button only while something follows
  // it, and the page still marked as the page once it is in the menu.

  link(index: number): string | undefined {
    return this.crumbs.isCurrent(index) ? undefined : this.trail[index]?.href;
  }

  followed(): boolean {
    return this.crumbs.itemProps(this.trail.length - 1)['hidden'] !== true;
  }

  menuLinkProps(index: number): NavigationProps {
    return {
      ...this.crumbs.overflowLinkProps(index),
      'aria-current': this.crumbs.isCurrent(index) ? 'page' : undefined,
    };
  }
}

/**
 * Give the list a width, and far too little of it for the trail.
 *
 * happy-dom lays nothing out, and a list with no width is one the primitive
 * declines to measure rather than fold everything into the menu on a reading
 * of zero. With a width of one and a trail that wants a thousand, it folds
 * every crumb it is allowed to.
 */
function crowd(list: Element): void {
  Object.defineProperty(list, 'clientWidth', { configurable: true, get: () => 1 });
  Object.defineProperty(list, 'scrollWidth', { configurable: true, get: () => 1000 });
}

export const scene: Scene = (look) => {
  const scene = show(StyledBreadcrumb);
  // Folded and open is the one moment that holds every crumb the sheet tells
  // apart. The whole trail, and the folded one with its menu shut, are only
  // links, text, separators and a button, which are all still in the list
  // here: the primitive hides a crumb it folds rather than removing it.
  step(() => {
    crowd(scene.list.get()!);
    scene.crumbs.measure();
  });
  step(() => scene.crumbs.menu.open());
  look();
};
