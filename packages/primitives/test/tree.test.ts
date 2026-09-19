/**
 * Tree, driven through a real mounted component.
 *
 * A tree is three things a consumer cannot retrofit: the counted attributes
 * that tell a screen reader what shape the hierarchy is, the WAI-ARIA keyboard
 * map, and a selection model with a third state that cascades. All three are
 * asserted here through the DOM a component actually renders, because all
 * three are computed from a flat model that the markup only reflects — and a
 * model that agrees with itself while disagreeing with the page is the failure
 * mode worth catching.
 *
 * The counted attributes are checked on a *nested* node rather than a root,
 * since `aria-level`, `aria-setsize` and `aria-posinset` are exactly what
 * breaks once a level is windowed or filtered and the DOM holds a slice of it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compileTemplate } from '@voltdev/core/jit';
import { Component, Signal, flushSync, mount } from '@voltdev/core';
import {
  TREE_ITEM_ATTRIBUTE,
  createTree,
  type Tree,
  type TreeDrop,
  type TreeNode,
  type TreeOptions,
} from '../src/tree.ts';
import type { DragMode } from '../src/drag-drop.ts';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

/**
 * Three roots, one of them three levels deep.
 *
 * `Util` is disabled, so every navigation test has a node it must reach rather
 * than step over. `Install` and `Index` share a prefix, which is what makes
 * accumulated typeahead observable.
 */
const NODES: readonly TreeNode[] = [
  {
    id: 'docs',
    label: 'Docs',
    children: [
      { id: 'readme', label: 'Readme' },
      {
        id: 'guide',
        label: 'Guide',
        children: [
          { id: 'install', label: 'Install' },
          { id: 'usage', label: 'Usage' },
          { id: 'faq', label: 'FAQ' },
        ],
      },
      { id: 'changelog', label: 'Changelog' },
    ],
  },
  {
    id: 'src',
    label: 'Src',
    children: [
      { id: 'index', label: 'Index' },
      { id: 'util', label: 'Util', disabled: true },
    ],
  },
  { id: 'notes', label: 'Notes' },
];

/** Two folders that only say they have children; the rest arrives on demand. */
const LAZY: readonly TreeNode[] = [
  { id: 'alpha', label: 'Alpha', hasChildren: true },
  { id: 'beta', label: 'Beta', hasChildren: true },
  { id: 'plain', label: 'Plain' },
];

interface Load {
  readonly signal: AbortSignal;
  resolve(children: readonly TreeNode[]): void;
  reject(error: unknown): void;
}

let host: HTMLElement;
let mounted: { unmount(): void }[] = [];
let selectors = 0;

let nodes: Signal.State<readonly TreeNode[]>;
let treeOptions: Omit<TreeOptions, 'tree' | 'nodes'>;
/** Every lazy request that has been made, by node id, still unanswered. */
let loads: Map<string, Load>;
/** The order the loader was called in, which is the queue under test. */
let loadCalls: string[];

/** Restores whatever a test replaced on the window, newest first. */
let restores: (() => void)[] = [];

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  host = document.querySelector('#app')!;
  nodes = new Signal.State<readonly TreeNode[]>(NODES);
  treeOptions = {};
  loads = new Map();
  loadCalls = [];

  // Only a windowed tree ever constructs one, so this is inert everywhere else.
  FakeResizeObserver.live = [];
  const view = window as unknown as { ResizeObserver: unknown };
  const original = view.ResizeObserver;
  view.ResizeObserver = FakeResizeObserver;
  restores.push(() => {
    view.ResizeObserver = original;
  });
});

afterEach(() => {
  // Every mount is torn down: the lazy loader holds an abort signal per tree,
  // and a resource left in flight writes into the next test's scope.
  for (const handle of mounted) handle.unmount();
  mounted = [];
  flushSync();
  for (let i = restores.length - 1; i >= 0; i--) restores[i]!();
  restores = [];
  vi.useRealTimers();
});

const TEMPLATE = `
  <div class="tree" :ref="root" :spread="tree.treeProps()"
       :keydown="tree.onKeyDown($event)"
       :click="tree.onItemClick($event)"
       :pointerdown="tree.onPointerDown($event)"
       :focusin="tree.onFocusIn($event)">
    <div class="row" :for="row in tree.rendered()" :key="row.id" :spread="tree.itemProps(row)">
      <span class="twisty" :spread="tree.toggleProps()">t</span>
      <span class="box" :spread="tree.checkboxProps(row)">b</span>
      <span class="label">{ row.label }</span>
      <span class="status">{ tree.nodeStatus(row.id) }</span>
    </div>
  </div>
`;

interface Harness {
  tree: Tree;
  root: HTMLElement;
}

function setup(): Harness {
  @Component({ selector: `v-tree-${++selectors}`, render: compileTemplate(TEMPLATE) })
  class TreeComponent {
    root = new Signal.State<Element | null>(null);
    tree = createTree({
      ...treeOptions,
      tree: () => this.root.get(),
      nodes: () => nodes.get(),
    });
  }

  const handle = mount(TreeComponent, host);
  mounted.push(handle);
  flushSync();

  return {
    tree: (handle.instance as TreeComponent).tree,
    root: host.querySelector<HTMLElement>('.tree')!,
  };
}

/** A rendered node by id, or null when the model does not hold it. */
function rowEl(id: string): HTMLElement {
  return host.querySelector<HTMLElement>(`[${TREE_ITEM_ATTRIBUTE}="${id}"]`)!;
}

/** Every rendered node, in DOM order — the flat model as a user sees it. */
function visible(): string[] {
  return [...host.querySelectorAll<HTMLElement>('.row')].map(
    (el) => el.getAttribute(TREE_ITEM_ATTRIBUTE)!,
  );
}

function attrs(name: string): (string | null)[] {
  return [...host.querySelectorAll<HTMLElement>('.row')].map((el) => el.getAttribute(name));
}

function press(el: HTMLElement, key: string, modifiers: Partial<KeyboardEventInit> = {}): boolean {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers });
  el.dispatchEvent(event);
  flushSync();
  return event.defaultPrevented;
}

function click(el: HTMLElement, modifiers: Partial<MouseEventInit> = {}): void {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...modifiers }));
  flushSync();
}

function chosen(tree: Tree): string[] {
  return [...tree.selection()].sort();
}

/** A promise resolved by hand, so a lazy branch can be held open. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * Let the promise chain and the scheduler catch up.
 *
 * The write path is `await loadChildren` → signal writes → effect flush → a
 * recomputed model that may start the next request, so one microtask is never
 * enough.
 */
async function settle(turns = 8): Promise<void> {
  for (let i = 0; i < turns; i++) {
    await Promise.resolve();
    flushSync();
  }
}

/** A loader that answers nothing until the test says so. */
function lazyLoader(): NonNullable<TreeOptions['loadChildren']> {
  return (node, signal) => {
    loadCalls.push(node.id);
    const gate = deferred<readonly TreeNode[]>();
    loads.set(node.id, { signal, resolve: gate.resolve, reject: gate.reject });
    return gate.promise;
  };
}

// ---------------------------------------------------------------------------
// A windowed tree
// ---------------------------------------------------------------------------

/**
 * A ResizeObserver that reports only what a test hands it.
 *
 * happy-dom lays nothing out, so a windowed tree whose scroller is never
 * measured has a zero-high viewport. The measurement has to arrive the way it
 * does in a browser — through the observer, after layout — because that is the
 * only path the virtualizer reads a viewport on.
 */
class FakeResizeObserver {
  static live: FakeResizeObserver[] = [];

  constructor(private readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.live.push(this);
  }

  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}

  deliver(target: Element, block: number, inline: number): void {
    const box: ResizeObserverSize = { blockSize: block, inlineSize: inline };
    this.callback(
      [
        {
          target,
          borderBoxSize: [box],
          contentBoxSize: [box],
          devicePixelContentBoxSize: [box],
        } as unknown as ResizeObserverEntry,
      ],
      this as unknown as ResizeObserver,
    );
    flushSync();
  }
}

const VIRTUAL_TEMPLATE = `
  <div class="tree" :ref="root" :spread="tree.treeProps()"
       :keydown="tree.onKeyDown($event)"
       :click="tree.onItemClick($event)"
       :focusin="tree.onFocusIn($event)">
    <div class="sizer" :spread="tree.sizerProps()">
      <div class="box" :ref="box" :spread="tree.contentProps()">
        <div class="row" :for="row in tree.rendered()" :key="row.id" :spread="tree.itemProps(row)">
          <span class="label">{ row.label }</span>
        </div>
      </div>
    </div>
  </div>
`;

/** Flat nodes, enough of them that the window holds a slice of one level. */
function manyNodes(count: number): TreeNode[] {
  return Array.from({ length: count }, (_, i) => ({ id: `n${i}`, label: `Node ${i}` }));
}

/** The same tree, windowed: only a handful of its rows are ever in the DOM. */
function setupVirtual({ height = 120, itemSize = 24, measure = false } = {}): Harness {
  @Component({ selector: `v-tree-${++selectors}`, render: compileTemplate(VIRTUAL_TEMPLATE) })
  class VirtualTreeComponent {
    root = new Signal.State<Element | null>(null);
    box = new Signal.State<Element | null>(null);
    tree = createTree({
      ...treeOptions,
      tree: () => this.root.get(),
      nodes: () => nodes.get(),
      virtual: {
        scroller: () => this.root.get(),
        container: () => this.box.get(),
        itemSize,
        measure,
      },
    });
  }

  const handle = mount(VirtualTreeComponent, host);
  mounted.push(handle);

  const root = host.querySelector<HTMLElement>('.tree')!;
  Object.defineProperty(root, 'clientHeight', { value: height, configurable: true });
  Object.defineProperty(root, 'clientWidth', { value: 300, configurable: true });
  FakeResizeObserver.live.at(-1)!.deliver(root, height, 300);

  return { tree: (handle.instance as VirtualTreeComponent).tree, root };
}

/** The nodes carrying `tabindex="0"` — everything Tab can land on. */
function tabStops(): string[] {
  return [...host.querySelectorAll<HTMLElement>('.row[tabindex="0"]')].map(
    (el) => el.getAttribute(TREE_ITEM_ATTRIBUTE)!,
  );
}

/** A scroll the reader performed. happy-dom fires no event of its own. */
function userScroll(el: HTMLElement, offset: number): void {
  el.scrollTop = offset;
  el.dispatchEvent(new Event('scroll'));
  flushSync();
}

// ---------------------------------------------------------------------------
// What assistive technology is told
// ---------------------------------------------------------------------------

describe('what assistive technology is told', () => {
  it('marks the tree and every node in it', () => {
    treeOptions = { labels: { tree: 'Files' } };
    const { root } = setup();

    expect(root.getAttribute('role')).toBe('tree');
    expect(root.getAttribute('aria-label')).toBe('Files');
    expect(rowEl('docs').getAttribute('role')).toBe('treeitem');
    // Single selection is not what `aria-multiselectable` reports.
    expect(root.hasAttribute('aria-multiselectable')).toBe(false);
  });

  it('points at no element it has not rendered', () => {
    const { root } = setup();

    // A dangling `aria-labelledby` or `aria-activedescendant` announces the
    // same nothing as an absent one, while hiding the mistake. This tree names
    // itself with a label or not at all, and moves real focus rather than a
    // virtual cursor.
    for (const name of ['aria-labelledby', 'aria-activedescendant', 'aria-controls', 'aria-owns']) {
      expect(root.hasAttribute(name)).toBe(false);
    }
    expect(root.hasAttribute('aria-label')).toBe(false);
  });

  it('counts a nested node against its own siblings, not against the DOM', () => {
    treeOptions = { defaultExpanded: ['docs', 'guide'] };
    setup();

    // Guide is the second of Docs's three children, and holds three of its own.
    const guide = rowEl('guide');
    expect(guide.getAttribute('aria-level')).toBe('2');
    expect(guide.getAttribute('aria-posinset')).toBe('2');
    expect(guide.getAttribute('aria-setsize')).toBe('3');
    expect(guide.getAttribute('aria-expanded')).toBe('true');

    // Install sits at level three among three siblings, though nine nodes are
    // rendered and counting the elements would say "1 of 9".
    const install = rowEl('install');
    expect(install.getAttribute('aria-level')).toBe('3');
    expect(install.getAttribute('aria-posinset')).toBe('1');
    expect(install.getAttribute('aria-setsize')).toBe('3');

    // And the level below it starts counting again.
    expect(rowEl('changelog').getAttribute('aria-posinset')).toBe('3');
    expect(rowEl('src').getAttribute('aria-level')).toBe('1');
    expect(rowEl('src').getAttribute('aria-posinset')).toBe('2');
  });

  it('says nothing about expansion on a leaf', () => {
    treeOptions = { defaultExpanded: ['docs'] };
    setup();

    // On a leaf the attribute announces a closed branch that will never open.
    expect(rowEl('readme').hasAttribute('aria-expanded')).toBe(false);
    expect(rowEl('readme').hasAttribute('data-state')).toBe(false);
    expect(rowEl('docs').getAttribute('aria-expanded')).toBe('true');
    expect(rowEl('src').getAttribute('aria-expanded')).toBe('false');
    expect(rowEl('src').getAttribute('data-state')).toBe('collapsed');
  });

  it('announces a folder whose children have never been fetched as expandable', () => {
    nodes.set(LAZY);
    treeOptions = { loadChildren: lazyLoader() };
    setup();

    // `hasChildren` is the only thing that can say so before a request is made.
    expect(rowEl('alpha').getAttribute('aria-expanded')).toBe('false');
    expect(rowEl('plain').hasAttribute('aria-expanded')).toBe(false);
  });

  it('leaves a disabled node in the accessibility tree and reachable', () => {
    treeOptions = { defaultExpanded: ['src'] };
    const { tree, root } = setup();

    const util = rowEl('util');
    expect(util.getAttribute('aria-disabled')).toBe('true');
    expect(util.hasAttribute('disabled')).toBe(false);

    // A node a keyboard user cannot reach is a node they cannot discover is
    // there, so it is announced as unavailable rather than skipped.
    press(root, 'End');
    press(root, 'ArrowUp');
    expect(tree.activeId()).toBe('util');
  });

  it('hides the twisty and the checkbox, which repeat what the node already says', () => {
    treeOptions = { selectionMode: 'checkbox' };
    setup();

    const twisty = rowEl('docs').querySelector('.twisty')!;
    const box = rowEl('docs').querySelector('.box')!;
    expect(twisty.getAttribute('aria-hidden')).toBe('true');
    expect(box.getAttribute('aria-hidden')).toBe('true');
    // The node carries the state; a second control saying it is one more thing
    // to hear and one more tab stop to step over.
    expect(rowEl('docs').getAttribute('aria-expanded')).toBe('false');
    expect(rowEl('docs').getAttribute('aria-checked')).toBe('false');
  });
});

// ---------------------------------------------------------------------------
// The tab stop
// ---------------------------------------------------------------------------

describe('the tab stop', () => {
  it('puts exactly one node in the tab order and moves it with the active node', () => {
    const { root } = setup();
    expect(attrs('tabindex')).toEqual(['0', '-1', '-1']);

    press(root, 'ArrowDown');
    press(root, 'ArrowDown');
    expect(attrs('tabindex')).toEqual(['-1', '0', '-1']);
    expect(document.activeElement).toBe(rowEl('src'));
  });

  it('keeps a tab stop when the filter empties the tree', () => {
    const { tree, root } = setup();
    expect(root.hasAttribute('tabindex')).toBe(false);

    tree.setFilter('zzz');
    flushSync();
    // With no nodes there is no roving tab stop, so the tree would drop out of
    // the tab order altogether — including its own "no results" case.
    expect(visible()).toEqual([]);
    expect(root.getAttribute('tabindex')).toBe('0');
    expect(tree.status()).toBe('No results');

    tree.setFilter('');
    flushSync();
    expect(root.hasAttribute('tabindex')).toBe(false);
  });

  it('leaves the stop on a rendered node when the active one is windowed out', () => {
    nodes.set(manyNodes(200));
    const { tree, root } = setupVirtual();

    tree.focusNode('n150');
    flushSync();
    expect(visible()).toContain('n150');
    expect(document.activeElement).toBe(rowEl('n150'));
    expect(tabStops()).toEqual(['n150']);

    // The reader scrolls back to the top with the wheel. The active node is
    // still n150, but it renders no element to hold a tab stop.
    userScroll(root, 0);
    expect(visible()).not.toContain('n150');
    expect(tree.activeId()).toBe('n150');

    // Naming it anyway takes the whole tree out of the tab order: a keyboard
    // user tabs straight past it, with no way back in. The first row on screen
    // takes the stop instead — which is where tabbing in should land anyway.
    expect(tabStops()).toEqual([visible()[0]]);
    expect(root.hasAttribute('tabindex')).toBe(false);

    // And it goes back to the active node once that is on screen again.
    userScroll(root, 150 * 24);
    expect(tabStops()).toEqual(['n150']);
  });
});

// ---------------------------------------------------------------------------
// Rows whose heights are measured
// ---------------------------------------------------------------------------

describe('a windowed tree whose rows are measured', () => {
  it('keeps every row its own height when a drop reorders them', () => {
    nodes.set(manyNodes(5));
    const { tree } = setupVirtual({ measure: true });
    FakeResizeObserver.live.at(-1)!.deliver(rowEl('n0'), 50, 300);
    expect(tree.virtualizer!.sizeOf(0)).toBe(50);

    // The consumer applies a drop: the same five nodes, the first moved last.
    // The row count has not changed, and nothing is measured again.
    const [first, ...rest] = manyNodes(5);
    nodes.set([...rest, first!]);
    flushSync();

    expect(tree.rows().map((row) => row.id)).toEqual(['n1', 'n2', 'n3', 'n4', 'n0']);
    expect(tree.virtualizer!.sizeOf(0)).toBe(24);
    expect(tree.virtualizer!.sizeOf(4)).toBe(50);
    expect(tree.virtualizer!.totalSize()).toBe(4 * 24 + 50);
  });
});

// ---------------------------------------------------------------------------
// A row asked for before it exists
// ---------------------------------------------------------------------------

describe('a row asked for before it exists', () => {
  it('delivers focus once the window has rendered it', () => {
    nodes.set(manyNodes(200));
    const { tree } = setupVirtual();

    // Nowhere near the window: the scroll is asked for now and the row is only
    // rendered afterwards, which is the whole reason the request is held.
    expect(visible()).not.toContain('n150');
    tree.focusNode('n150');
    flushSync();
    expect(document.activeElement).toBe(rowEl('n150'));
  });

  it('drops the request when the reader has moved on', () => {
    const { tree } = setup();
    const button = document.createElement('button');
    document.body.append(button);

    // Rows out of the document: what a windowed row looks like between the
    // scroll and the render, and what `focusNode` sees when it is called to
    // preselect a node before the first paint.
    for (const el of [...host.querySelectorAll('.row')]) el.remove();
    tree.focusNode('notes');
    flushSync();

    button.focus();
    expect(document.activeElement).toBe(button);

    // Any later render is enough to deliver a request that never expires —
    // however long ago it was made, and wherever the reader has gone since.
    nodes.set([...NODES, { id: 'extra', label: 'Extra' }]);
    flushSync();

    expect(visible()).toEqual(['docs', 'src', 'notes', 'extra']);
    expect(document.activeElement).toBe(button);
    // Dropping the focus request is not forgetting the node: the tab stop is
    // still there for the reader to come back to.
    expect(tree.activeId()).toBe('notes');
    expect(rowEl('notes').getAttribute('tabindex')).toBe('0');
  });
});

// ---------------------------------------------------------------------------
// Moving
// ---------------------------------------------------------------------------

describe('moving', () => {
  it('walks the visible nodes only, and stops at the ends', () => {
    const { tree, root } = setup();

    press(root, 'ArrowDown');
    expect(tree.activeId()).toBe('docs');
    // Docs is closed, so its four descendants are not walked through.
    press(root, 'ArrowDown');
    expect(tree.activeId()).toBe('src');
    press(root, 'ArrowDown');
    expect(tree.activeId()).toBe('notes');

    // A tree is a place being explored; wrapping hides that the end was
    // reached. The key is still consumed, or the page scrolls underneath.
    expect(press(root, 'ArrowDown')).toBe(true);
    expect(tree.activeId()).toBe('notes');
    press(root, 'ArrowUp');
    expect(tree.activeId()).toBe('src');
  });

  it('enters from either end when nothing is active yet', () => {
    const { tree, root } = setup();
    press(root, 'ArrowUp');
    expect(tree.activeId()).toBe('notes');
  });

  it('walks into a branch once it is open', () => {
    treeOptions = { defaultExpanded: ['docs', 'guide'] };
    const { tree, root } = setup();

    press(root, 'ArrowDown');
    press(root, 'ArrowDown');
    press(root, 'ArrowDown');
    press(root, 'ArrowDown');
    expect(tree.activeId()).toBe('install');
    expect(document.activeElement).toBe(rowEl('install'));
  });

  it('opens with Right, then steps into the branch on the next press', () => {
    const { tree, root } = setup();
    press(root, 'ArrowDown');

    press(root, 'ArrowRight');
    expect(tree.isExpanded('docs')).toBe(true);
    // Opening is not moving: the reader is told what appeared before being
    // taken into it.
    expect(tree.activeId()).toBe('docs');
    expect(rowEl('docs').getAttribute('aria-expanded')).toBe('true');

    press(root, 'ArrowRight');
    expect(tree.activeId()).toBe('readme');
    expect(document.activeElement).toBe(rowEl('readme'));
  });

  it('does nothing with Right on a leaf', () => {
    const { tree, root } = setup();
    press(root, 'End');
    expect(tree.activeId()).toBe('notes');
    press(root, 'ArrowRight');
    expect(tree.activeId()).toBe('notes');
    expect(visible()).toEqual(['docs', 'src', 'notes']);
  });

  it('climbs to the parent with Left, then closes it with the next press', () => {
    treeOptions = { defaultExpanded: ['docs', 'guide'] };
    const { tree, root } = setup();
    tree.focusNode('install');
    flushSync();

    // A leaf has nothing to close, so Left is the way out of the branch.
    press(root, 'ArrowLeft');
    expect(tree.activeId()).toBe('guide');
    expect(document.activeElement).toBe(rowEl('guide'));

    press(root, 'ArrowLeft');
    expect(tree.isExpanded('guide')).toBe(false);
    expect(tree.activeId()).toBe('guide');

    press(root, 'ArrowLeft');
    expect(tree.activeId()).toBe('docs');
  });

  it('consumes Left at a closed root, where there is nowhere to go', () => {
    const { tree, root } = setup();
    press(root, 'End');
    // Still consumed: letting it through scrolls the page sideways instead.
    expect(press(root, 'ArrowLeft')).toBe(true);
    expect(tree.activeId()).toBe('notes');
  });

  it('goes to the first and last visible node with Home and End', () => {
    treeOptions = { defaultExpanded: ['docs', 'guide'] };
    const { tree, root } = setup();

    press(root, 'End');
    expect(tree.activeId()).toBe('notes');
    press(root, 'Home');
    expect(tree.activeId()).toBe('docs');
    expect(document.activeElement).toBe(rowEl('docs'));
  });

  it('opens every sibling at the focused level with a star', () => {
    const { tree, root } = setup();

    press(root, '*');
    expect(tree.isExpanded('docs')).toBe(true);
    expect(tree.isExpanded('src')).toBe(true);
    // Notes is a leaf, so it has no state to change.
    expect(visible()).toEqual([
      'docs',
      'readme',
      'guide',
      'changelog',
      'src',
      'index',
      'util',
      'notes',
    ]);
  });

  it('leaves the levels above and below alone when a star opens one level', () => {
    treeOptions = { defaultExpanded: ['docs'] };
    const { tree, root } = setup();
    tree.focusNode('readme');
    flushSync();

    press(root, '*');
    // Guide is Readme's only expandable sibling. Src is a level up and is not
    // a sibling of anything here.
    expect(tree.isExpanded('guide')).toBe(true);
    expect(tree.isExpanded('src')).toBe(false);
  });

  it('mirrors the horizontal arrows under dir="rtl"', () => {
    host.setAttribute('dir', 'rtl');
    const { tree, root } = setup();
    press(root, 'ArrowDown');

    press(root, 'ArrowLeft');
    expect(tree.isExpanded('docs')).toBe(true);
    press(root, 'ArrowRight');
    expect(tree.isExpanded('docs')).toBe(false);

    // Vertical order is not mirrored: a tree is not upside down in Arabic.
    press(root, 'ArrowDown');
    expect(tree.activeId()).toBe('src');
  });

  it('leaves a modified arrow to whatever wraps the tree', () => {
    const { tree, root } = setup();
    // Alt+Arrow belongs to the browser and to any combobox around this.
    expect(press(root, 'ArrowDown', { altKey: true })).toBe(false);
    expect(tree.activeId()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Typeahead
// ---------------------------------------------------------------------------

describe('typeahead', () => {
  it('jumps to a node a letter starts, searching the visible nodes only', () => {
    treeOptions = { defaultExpanded: ['docs', 'guide'] };
    const { tree, root } = setup();

    press(root, 'u');
    // Usage, not Util: Util is under a closed Src and cannot be jumped to.
    expect(tree.activeId()).toBe('usage');
    expect(document.activeElement).toBe(rowEl('usage'));
  });

  it('accumulates characters, then starts over', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    treeOptions = { defaultExpanded: ['docs', 'guide'] };
    const { tree, root } = setup();

    press(root, 'u');
    expect(tree.activeId()).toBe('usage');
    // "us" is still Usage; without accumulation the "s" would find Src.
    press(root, 's');
    expect(tree.activeId()).toBe('usage');

    vi.advanceTimersByTime(600);
    press(root, 's');
    expect(tree.activeId()).toBe('src');
  });

  it('walks through the nodes a repeated character starts', () => {
    treeOptions = { defaultExpanded: ['docs', 'guide', 'src'] };
    const { tree, root } = setup();

    press(root, 'i');
    expect(tree.activeId()).toBe('install');
    press(root, 'i');
    expect(tree.activeId()).toBe('index');
    press(root, 'i');
    expect(tree.activeId()).toBe('install');
  });

  it('can be turned off', () => {
    treeOptions = { typeahead: false };
    const { tree, root } = setup();
    expect(press(root, 'n')).toBe(false);
    expect(tree.activeId()).toBeNull();
  });

  it('does not fire for a shortcut', () => {
    const { tree, root } = setup();
    // Ctrl+N opens a window; a tree that swallowed it would be jumping to
    // Notes instead.
    expect(press(root, 'n', { ctrlKey: true })).toBe(false);
    expect(tree.activeId()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Expansion
// ---------------------------------------------------------------------------

describe('expansion', () => {
  it('owns its own state when nobody else does, and reports every change', () => {
    const onExpandedChange = vi.fn();
    treeOptions = { defaultExpanded: ['docs'], onExpandedChange };
    const { tree, root } = setup();

    expect(visible()).toEqual(['docs', 'readme', 'guide', 'changelog', 'src', 'notes']);

    click(rowEl('docs').querySelector<HTMLElement>('.twisty')!);
    expect(tree.isExpanded('docs')).toBe(false);
    expect(visible()).toEqual(['docs', 'src', 'notes']);
    expect([...onExpandedChange.mock.calls[0]![0]]).toEqual([]);

    press(root, 'ArrowDown');
    press(root, 'ArrowRight');
    expect([...tree.expanded()]).toEqual(['docs']);
  });

  it('can be driven from outside, as a router opening the path to a page', () => {
    const expanded = new Signal.State<ReadonlySet<string>>(new Set());
    treeOptions = { expanded };
    const { tree } = setup();

    expanded.set(new Set(['docs', 'guide']));
    flushSync();
    expect(visible()).toEqual([
      'docs',
      'readme',
      'guide',
      'install',
      'usage',
      'faq',
      'changelog',
      'src',
      'notes',
    ]);

    // And the tree writes back into the same signal rather than shadowing it.
    tree.collapse('guide');
    flushSync();
    expect([...expanded.get()]).toEqual(['docs']);
  });

  it('opens and closes the whole tree', () => {
    const { tree } = setup();

    tree.expandAll();
    flushSync();
    expect(visible()).toHaveLength(11);

    tree.collapseAll();
    flushSync();
    expect(visible()).toEqual(['docs', 'src', 'notes']);
  });

  it('presses the twisty without choosing the node it is in', () => {
    treeOptions = { selectionMode: 'single' };
    const { tree } = setup();

    click(rowEl('docs').querySelector<HTMLElement>('.twisty')!);
    expect(tree.isExpanded('docs')).toBe(true);
    // The twisty means something narrower than pressing the node does.
    expect(chosen(tree)).toEqual([]);
  });

  it('keeps the focused node reachable when an ancestor of it closes', () => {
    treeOptions = { defaultExpanded: ['docs', 'guide'] };
    const { tree } = setup();
    tree.focusNode('install');
    flushSync();
    expect(document.activeElement).toBe(rowEl('install'));

    // Collapsing from the twisty, or from a router, takes the focused node out
    // of the document underneath the user. Focus has to land somewhere it can
    // be seen from — the node that swallowed it — or the reader is returned to
    // the top of the page with no way back to where they were.
    tree.collapse('docs');
    flushSync();

    expect(document.activeElement).toBe(rowEl('docs'));
    expect(tree.activeId()).toBe('docs');
  });

  it('moves the tab stop but not focus when the tree is not the thing focused', () => {
    const expanded = new Signal.State<ReadonlySet<string>>(new Set(['docs', 'guide']));
    treeOptions = { expanded };
    const { tree } = setup();
    tree.focusNode('install');
    flushSync();

    const search = document.createElement('input');
    document.body.append(search);
    search.focus();

    // A router closing the branch while the reader types in a search box must
    // not pull them out of it — and a router closes it by writing the signal
    // it was given, not by calling the tree. The tab stop still has to leave
    // with the rows, or it names an element that is no longer in the document.
    expanded.set(new Set());
    flushSync();

    expect(document.activeElement).toBe(search);
    expect(tree.activeId()).toBe('docs');
    expect(rowEl('docs').getAttribute('tabindex')).toBe('0');
  });

  it('does the same when the router writes the signal instead of calling it', () => {
    const expanded = new Signal.State<ReadonlySet<string>>(new Set(['docs', 'guide']));
    treeOptions = { expanded };
    const { tree } = setup();
    tree.focusNode('install');
    flushSync();
    expect(document.activeElement).toBe(rowEl('install'));

    // The signal is the documented way a router drives expansion, and closing
    // the branch through it calls no method of the tree at all. The focused
    // row still leaves the document, and the browser still drops focus on
    // <body> when it does.
    expanded.set(new Set());
    flushSync();

    expect(document.activeElement).toBe(rowEl('docs'));
    expect(tree.activeId()).toBe('docs');
    expect(tree.rowOf('docs')).not.toBeNull();
    expect(tabStops()).toEqual(['docs']);
  });

  it('leaves with the branch when the consumer takes it out of the data', () => {
    treeOptions = { defaultExpanded: ['docs', 'guide'] };
    const { tree } = setup();
    tree.focusNode('install');
    flushSync();

    // Nothing about expansion changed: the node the reader was on is simply
    // not in the hierarchy any more, ancestors and all.
    nodes.set(NODES.filter((node) => node.id !== 'docs'));
    flushSync();

    expect(tree.activeId()).toBe('src');
    expect(document.activeElement).toBe(rowEl('src'));
    expect(tabStops()).toEqual(['src']);
  });

  it('takes the whole tree down without stranding the focused node', () => {
    treeOptions = { defaultExpanded: ['docs', 'guide'] };
    const { tree } = setup();
    tree.focusNode('faq');
    flushSync();

    tree.collapseAll();
    flushSync();

    // Every ancestor closed at once, so the surviving one is the root.
    expect(visible()).toEqual(['docs', 'src', 'notes']);
    expect(tree.activeId()).toBe('docs');
    expect(document.activeElement).toBe(rowEl('docs'));
  });
});

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

describe('choosing one node', () => {
  beforeEach(() => {
    treeOptions = { selectionMode: 'single', defaultExpanded: ['docs'] };
  });

  it('states selection on the chosen node alone', () => {
    const { tree } = setup();
    click(rowEl('readme'));

    // In a single-select tree every node is selectable by definition, so
    // "false" on the other five is five announcements of something known.
    expect(attrs('aria-selected')).toEqual([null, 'true', null, null, null, null]);
    expect(chosen(tree)).toEqual(['readme']);

    click(rowEl('changelog'));
    expect(chosen(tree)).toEqual(['changelog']);
  });

  it('activates and selects with Enter, so the two never disagree', () => {
    const onActivate = vi.fn();
    treeOptions = { ...treeOptions, onActivate };
    const { tree, root } = setup();

    press(root, 'ArrowDown');
    press(root, 'ArrowDown');
    expect(press(root, 'Enter')).toBe(true);

    expect(chosen(tree)).toEqual(['readme']);
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(onActivate.mock.calls[0]![0].id).toBe('readme');
  });

  it('activates on a double press as well as on Enter', () => {
    const onActivate = vi.fn();
    treeOptions = { ...treeOptions, onActivate };
    const { tree } = setup();

    // A double click is two clicks, the second carrying a detail of two, and
    // the first of them is an ordinary press.
    click(rowEl('readme'), { detail: 1 });
    expect(onActivate).not.toHaveBeenCalled();
    click(rowEl('readme'), { detail: 2 });

    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(onActivate.mock.calls[0]![0].id).toBe('readme');
    expect(chosen(tree)).toEqual(['readme']);
  });

  it('does not activate from the twisty, or on a node that is disabled', () => {
    const onActivate = vi.fn();
    treeOptions = { ...treeOptions, onActivate, defaultExpanded: ['docs', 'src'] };
    setup();

    // The twisty means open or close, which is narrower than the node.
    click(rowEl('guide').querySelector<HTMLElement>('.twisty')!, { detail: 2 });
    click(rowEl('util'), { detail: 2 });
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('does not let Space leave nothing chosen', () => {
    const { tree, root } = setup();
    press(root, 'ArrowDown');
    press(root, ' ');
    expect(chosen(tree)).toEqual(['docs']);

    // Space on the chosen node is a reader confirming where they are, not
    // asking to have nothing chosen.
    press(root, ' ');
    expect(chosen(tree)).toEqual(['docs']);
  });

  it('refuses a disabled node from either the pointer or the keyboard', () => {
    treeOptions = { selectionMode: 'single', defaultExpanded: ['src'] };
    const { tree, root } = setup();

    click(rowEl('util'));
    expect(chosen(tree)).toEqual([]);
    press(root, 'End');
    press(root, 'ArrowUp');
    press(root, ' ');
    expect(tree.activeId()).toBe('util');
    expect(chosen(tree)).toEqual([]);
  });

  it('can be driven from outside', () => {
    const selected = new Signal.State<ReadonlySet<string>>(new Set());
    const onSelectionChange = vi.fn();
    treeOptions = { ...treeOptions, selected, onSelectionChange };
    setup();

    selected.set(new Set(['guide']));
    flushSync();
    expect(rowEl('guide').getAttribute('aria-selected')).toBe('true');

    click(rowEl('readme'));
    expect([...selected.get()]).toEqual(['readme']);
    expect([...onSelectionChange.mock.calls[0]![0]]).toEqual(['readme']);
  });

  it('leaves Ctrl+A to the browser where only one may be chosen', () => {
    const { tree, root } = setup();
    expect(press(root, 'a', { ctrlKey: true })).toBe(false);
    expect(chosen(tree)).toEqual([]);
  });
});

describe('choosing several nodes', () => {
  beforeEach(() => {
    treeOptions = { selectionMode: 'multiple', defaultExpanded: ['docs'] };
  });

  it('states selection on every node, and says the tree takes several', () => {
    const { root } = setup();
    expect(root.getAttribute('aria-multiselectable')).toBe('true');

    click(rowEl('readme'));
    // Here "false" is what tells the reader the node can be added.
    expect(attrs('aria-selected')).toEqual(['false', 'true', 'false', 'false', 'false', 'false']);
  });

  it('adds under Ctrl and replaces without it', () => {
    const { tree } = setup();

    click(rowEl('readme'));
    click(rowEl('changelog'), { ctrlKey: true });
    expect(chosen(tree)).toEqual(['changelog', 'readme']);

    click(rowEl('changelog'), { ctrlKey: true });
    expect(chosen(tree)).toEqual(['readme']);

    click(rowEl('src'));
    expect(chosen(tree)).toEqual(['src']);
  });

  it('takes a range across levels with Shift, skipping what cannot be chosen', () => {
    treeOptions = { selectionMode: 'multiple', defaultExpanded: ['docs', 'src'] };
    const { tree } = setup();

    click(rowEl('guide'));
    click(rowEl('notes'), { shiftKey: true });
    // Guide → Changelog → Src → Index → Util → Notes, at three different
    // levels; the disabled one inside the range is not selectable however the
    // range was drawn.
    expect(chosen(tree)).toEqual(['changelog', 'guide', 'index', 'notes', 'src']);
  });

  it('moves and toggles one node at a time with Shift and an arrow', () => {
    const { tree, root } = setup();

    press(root, 'ArrowDown');
    press(root, 'ArrowDown', { shiftKey: true });
    press(root, 'ArrowDown', { shiftKey: true });
    // The practice's wording is "moves focus to and toggles the selection state
    // of" the next node, so Docs, which was only ever focused, is not chosen.
    expect(chosen(tree)).toEqual(['guide', 'readme']);
  });

  it('extends to the end of the tree with Shift and End', () => {
    const { tree, root } = setup();
    press(root, 'ArrowDown');
    press(root, 'End', { shiftKey: true });
    expect(chosen(tree)).toEqual(['changelog', 'docs', 'guide', 'notes', 'readme', 'src']);
  });

  it('selects every visible node with Ctrl+A', () => {
    const { tree, root } = setup();
    expect(press(root, 'a', { ctrlKey: true })).toBe(true);
    // What is closed is not on screen and was never offered.
    expect(chosen(tree)).toEqual(['changelog', 'docs', 'guide', 'notes', 'readme', 'src']);
  });

  it('takes a range from the last chosen node with Shift and Space', () => {
    const { tree, root } = setup();

    click(rowEl('readme'));
    press(root, 'ArrowDown');
    press(root, 'ArrowDown');
    expect(tree.activeId()).toBe('changelog');
    expect(chosen(tree)).toEqual(['readme']);

    // "Selects contiguous nodes from the most recently selected node to the
    // focused node" — the pointer reaches this with a shift-click, and without
    // the chord the keyboard cannot reach it at all.
    expect(press(root, ' ', { shiftKey: true })).toBe(true);
    expect(chosen(tree)).toEqual(['changelog', 'guide', 'readme']);
    // Extending is not moving: the reader is still where they were.
    expect(tree.activeId()).toBe('changelog');
  });

  it('extends to either end with the chords the tree pattern spells', () => {
    const { tree, root } = setup();
    press(root, 'ArrowDown');
    press(root, 'ArrowDown');
    press(root, 'ArrowDown');
    expect(tree.activeId()).toBe('guide');

    expect(press(root, 'Home', { ctrlKey: true, shiftKey: true })).toBe(true);
    expect(chosen(tree)).toEqual(['docs', 'guide', 'readme']);
    expect(tree.activeId()).toBe('docs');

    expect(press(root, 'End', { ctrlKey: true, shiftKey: true })).toBe(true);
    expect(chosen(tree)).toEqual(['changelog', 'docs', 'guide', 'notes', 'readme', 'src']);
    expect(tree.activeId()).toBe('notes');
  });
});

describe('the tri-state checkbox', () => {
  beforeEach(() => {
    treeOptions = { selectionMode: 'checkbox', defaultExpanded: ['docs', 'guide'] };
  });

  it('reports checked state rather than selection', () => {
    const { root } = setup();

    // A checkbox tree is a different model, not a decoration on multi-select:
    // it says so with `aria-checked`, and claiming `aria-multiselectable` as
    // well would describe a selection model it does not have.
    expect(root.hasAttribute('aria-multiselectable')).toBe(false);
    expect(rowEl('docs').hasAttribute('aria-selected')).toBe(false);
    expect(rowEl('docs').getAttribute('aria-checked')).toBe('false');
  });

  it('cascades down into the subtree and up into the ancestors', () => {
    const { tree } = setup();

    tree.setChecked('guide', true);
    flushSync();
    expect(rowEl('install').getAttribute('aria-checked')).toBe('true');
    expect(rowEl('faq').getAttribute('aria-checked')).toBe('true');
    // Docs holds two unchecked children besides Guide, so it is part-checked.
    expect(tree.checkedState('docs')).toBe('indeterminate');
    expect(rowEl('docs').getAttribute('aria-checked')).toBe('mixed');
    expect(rowEl('docs').querySelector('.box')!.getAttribute('data-state')).toBe('indeterminate');

    tree.setChecked('readme', true);
    tree.setChecked('changelog', true);
    flushSync();
    // Docs was never pressed; every one of its children was.
    expect(rowEl('docs').getAttribute('aria-checked')).toBe('true');
    expect(tree.isSelected('docs')).toBe(true);
    expect(rowEl('docs').hasAttribute('data-selected')).toBe(true);
  });

  it('drops a parent back to part-checked when one child is unchecked', () => {
    const { tree } = setup();
    tree.setChecked('docs', true);
    flushSync();
    expect(rowEl('usage').getAttribute('aria-checked')).toBe('true');

    click(rowEl('usage').querySelector<HTMLElement>('.box')!);
    expect(rowEl('guide').getAttribute('aria-checked')).toBe('mixed');
    expect(rowEl('docs').getAttribute('aria-checked')).toBe('mixed');
    expect(tree.checkedState('install')).toBe(true);
  });

  it('toggles with Space and with a press on the node itself', () => {
    const { tree, root } = setup();

    press(root, 'ArrowDown');
    press(root, ' ');
    expect(tree.checkedState('docs')).toBe(true);

    click(rowEl('readme'));
    expect(tree.checkedState('readme')).toBe(false);
    expect(rowEl('docs').getAttribute('aria-checked')).toBe('mixed');
  });

  it('checks everything there is, not merely what is on screen', () => {
    treeOptions = { selectionMode: 'checkbox' };
    const { tree, root } = setup();

    press(root, 'a', { ctrlKey: true });
    // A half-checked tree after "select all" is not what anybody meant, and
    // the disabled node is not something a user could have checked by hand.
    expect(tree.checkedState('install')).toBe(true);
    expect(tree.checkedState('util')).toBe(false);
    expect(tree.checkedState('src')).toBe('indeterminate');

    tree.clearSelection();
    flushSync();
    expect(tree.checkedState('docs')).toBe(false);
  });

  it('refuses a disabled node in a cascade, as select all does', () => {
    treeOptions = { selectionMode: 'checkbox', defaultExpanded: ['src'] };
    const { tree } = setup();

    tree.setChecked('src', true);
    flushSync();

    // Pressing a folder's checkbox is the ordinary way to check a subtree, so
    // it has to agree with `selectAll` about the node that refuses selection —
    // and the parent is honestly part-checked afterwards, for the same reason.
    expect(chosen(tree)).toEqual(['index', 'src']);
    expect(tree.checkedState('util')).toBe(false);
    expect(rowEl('util').getAttribute('aria-checked')).toBe('false');
    expect(rowEl('src').getAttribute('aria-checked')).toBe('mixed');
  });

  it('refuses a disabled node on the way back down too', () => {
    treeOptions = {
      selectionMode: 'checkbox',
      defaultExpanded: ['src'],
      defaultSelected: ['src', 'index', 'util'],
    };
    const { tree } = setup();

    tree.setChecked('src', false);
    flushSync();

    // A node whose state the user could not set is not one an unrelated press
    // may clear: a consumer that checked it meant it to stay checked.
    expect(chosen(tree)).toEqual(['util']);
    expect(tree.checkedState('util')).toBe(true);
  });

  it('turns a folder off again when a disabled child holds it part-checked', () => {
    treeOptions = { selectionMode: 'checkbox', defaultExpanded: ['src'] };
    const { tree, root } = setup();
    tree.focusNode('src');
    flushSync();

    // Src can never report `true`, because Util refuses the cascade. A press
    // that asks to be checked until it is fully checked therefore asks for the
    // same thing for ever, and the folder's own control is inert after the
    // first press — with `clearSelection` the only way out of it.
    press(root, ' ');
    expect(chosen(tree)).toEqual(['index', 'src']);
    expect(tree.checkedState('src')).toBe('indeterminate');

    press(root, ' ');
    expect(chosen(tree)).toEqual([]);
    expect(tree.checkedState('src')).toBe(false);

    press(root, ' ');
    expect(chosen(tree)).toEqual(['index', 'src']);
    press(root, ' ');
    expect(chosen(tree)).toEqual([]);
  });

  it('does the same from the checkbox, the row and the API, an ancestor up', () => {
    nodes.set([
      {
        id: 'top',
        label: 'Top',
        children: [
          {
            id: 'src',
            label: 'Src',
            children: [
              { id: 'index', label: 'Index' },
              { id: 'util', label: 'Util', disabled: true },
            ],
          },
        ],
      },
    ]);
    treeOptions = { selectionMode: 'checkbox', defaultExpanded: ['top', 'src'] };
    const { tree } = setup();
    const box = (): HTMLElement => rowEl('top').querySelector<HTMLElement>('.box')!;

    // The part-checked state travels up, so an ancestor of the folder is stuck
    // for exactly the same reason — by whichever of the four doors it is
    // pressed through.
    click(box());
    expect(chosen(tree)).toEqual(['index', 'src', 'top']);
    click(box());
    expect(chosen(tree)).toEqual([]);

    click(rowEl('top'));
    expect(chosen(tree)).toEqual(['index', 'src', 'top']);
    click(rowEl('top'));
    expect(chosen(tree)).toEqual([]);

    tree.select('top');
    flushSync();
    expect(chosen(tree)).toEqual(['index', 'src', 'top']);
    tree.select('top');
    flushSync();
    expect(chosen(tree)).toEqual([]);
  });

  it('turns a folder off at the first press when it was filled child by child', () => {
    treeOptions = { selectionMode: 'checkbox', defaultExpanded: ['docs'] };
    const { tree } = setup();
    const box = (id: string): HTMLElement => rowEl(id).querySelector<HTMLElement>('.box')!;

    click(box('readme'));
    click(box('guide'));
    click(box('changelog'));

    // Docs reads `checked` off its children without its own id ever being put
    // in the set, so asking what is left to check finds Docs itself — and the
    // press goes on putting it there, where the reader sees nothing happen.
    expect(tree.checkedState('docs')).toBe(true);
    expect(tree.selection().has('docs')).toBe(false);

    click(box('docs'));
    expect(chosen(tree)).toEqual([]);
    expect(rowEl('docs').getAttribute('aria-checked')).toBe('false');
    expect(box('docs').getAttribute('data-state')).toBe('unchecked');
  });

  it('gives a folder its own box when nothing under it takes the cascade', () => {
    nodes.set([
      { id: 'src', label: 'Src', children: [{ id: 'util', label: 'Util', disabled: true }] },
    ]);
    treeOptions = { selectionMode: 'checkbox', defaultExpanded: ['src'] };
    const { tree, root } = setup();
    tree.focusNode('src');
    flushSync();

    // Every descendant refuses the cascade, so a state aggregated from them
    // can only ever be `false` — and the folder is then checked in the
    // selection, unchecked on screen, and inert however often it is pressed.
    press(root, ' ');
    expect(chosen(tree)).toEqual(['src']);
    expect(tree.checkedState('src')).toBe(true);
    expect(tree.isSelected('src')).toBe(true);
    expect(rowEl('src').getAttribute('aria-checked')).toBe('true');
    expect(rowEl('src').querySelector('.box')!.getAttribute('data-state')).toBe('checked');
    // The node that refuses it is still not one a press may set.
    expect(tree.checkedState('util')).toBe(false);

    click(rowEl('src').querySelector<HTMLElement>('.box')!);
    expect(chosen(tree)).toEqual([]);
    expect(rowEl('src').getAttribute('aria-checked')).toBe('false');
  });

  it('moves that box even when the whole subtree is disabled and checked', () => {
    nodes.set([
      {
        id: 'top',
        label: 'Top',
        children: [
          {
            id: 'perms',
            label: 'Perms',
            children: [
              { id: 'read', label: 'Read', disabled: true },
              { id: 'write', label: 'Write', disabled: true },
            ],
          },
        ],
      },
    ]);
    treeOptions = {
      selectionMode: 'checkbox',
      defaultExpanded: ['top', 'perms'],
      defaultSelected: ['read', 'write'],
    };
    const { tree, root } = setup();
    tree.focusNode('perms');
    flushSync();

    // Reading Read and Write instead leaves Perms at `checked` before it has
    // been pressed at all, and there for ever after: the selection flips under
    // a box that never moves, and `selection()` and `isSelected()` disagree
    // about the folder from the first press on.
    expect(tree.checkedState('perms')).toBe(false);
    expect(tree.isSelected('perms')).toBe(false);

    press(root, ' ');
    expect(chosen(tree)).toEqual(['perms', 'read', 'write']);
    expect(tree.checkedState('perms')).toBe(true);
    expect(tree.isSelected('perms')).toBe(true);
    expect(rowEl('perms').getAttribute('aria-checked')).toBe('true');
    expect(rowEl('perms').querySelector('.box')!.getAttribute('data-state')).toBe('checked');

    press(root, ' ');
    expect(chosen(tree)).toEqual(['read', 'write']);
    expect(tree.checkedState('perms')).toBe(false);
    expect(tree.isSelected('perms')).toBe(false);
    expect(rowEl('perms').getAttribute('aria-checked')).toBe('false');
    expect(rowEl('perms').querySelector('.box')!.getAttribute('data-state')).toBe('unchecked');
    // What the consumer checked is still not a press's to clear.
    expect(tree.checkedState('read')).toBe(true);
  });

  it('does the same for the part-checked half of it, by every door', () => {
    nodes.set([
      {
        id: 'top',
        label: 'Top',
        children: [
          {
            id: 'perms',
            label: 'Perms',
            children: [
              { id: 'read', label: 'Read', disabled: true },
              { id: 'write', label: 'Write', disabled: true },
            ],
          },
        ],
      },
    ]);
    treeOptions = {
      selectionMode: 'checkbox',
      defaultExpanded: ['top', 'perms'],
      defaultSelected: ['read'],
    };
    const { tree, root } = setup();
    const box = (id: string): HTMLElement => rowEl(id).querySelector<HTMLElement>('.box')!;
    tree.focusNode('perms');
    flushSync();

    // Half of a subtree that refuses every press is still an answer no press
    // can change, so aggregating it holds Perms at `mixed` through all four
    // doors at once — the state the folder can be pressed to is its own.
    press(root, ' ');
    expect(rowEl('perms').getAttribute('aria-checked')).toBe('true');
    press(root, ' ');
    expect(rowEl('perms').getAttribute('aria-checked')).toBe('false');

    click(box('perms'));
    expect(chosen(tree)).toEqual(['perms', 'read']);
    expect(box('perms').getAttribute('data-state')).toBe('checked');
    click(box('perms'));
    expect(chosen(tree)).toEqual(['read']);
    expect(box('perms').getAttribute('data-state')).toBe('unchecked');

    click(rowEl('perms'));
    expect(tree.checkedState('perms')).toBe(true);
    tree.select('perms');
    flushSync();
    expect(tree.checkedState('perms')).toBe(false);
    tree.toggleSelected('perms');
    flushSync();
    expect(tree.checkedState('perms')).toBe(true);

    // The ancestor reads the folder's box rather than the frozen nodes under
    // it, so it is not stuck in the state the folder was rescued from.
    expect(tree.checkedState('top')).toBe(true);
    expect(rowEl('top').getAttribute('aria-checked')).toBe('true');
    click(box('top'));
    expect(chosen(tree)).toEqual(['read']);
    expect(rowEl('top').getAttribute('aria-checked')).toBe('false');
    // Read keeps the state a consumer gave it through all of that.
    expect(tree.checkedState('read')).toBe(true);
  });

  it('leaves every node its own fact in the strict model', () => {
    treeOptions = { ...treeOptions, cascade: false };
    const { tree } = setup();

    tree.setChecked('guide', true);
    flushSync();
    // What a tree of independent permissions wants, and what a tree of nested
    // folders does not.
    expect(chosen(tree)).toEqual(['guide']);
    expect(rowEl('install').getAttribute('aria-checked')).toBe('false');
    expect(rowEl('docs').getAttribute('aria-checked')).toBe('false');
    expect(tree.checkedState('docs')).toBe(false);

    tree.setChecked('install', true);
    flushSync();
    expect(rowEl('guide').getAttribute('aria-checked')).toBe('true');
  });
});

// ---------------------------------------------------------------------------
// Children that arrive later
// ---------------------------------------------------------------------------

describe('children that arrive later', () => {
  beforeEach(() => {
    nodes.set(LAZY);
    treeOptions = { loadChildren: lazyLoader() };
  });

  it('marks the one node being fetched, and no others', async () => {
    const { tree, root } = setup();
    tree.expand('alpha');
    await settle();

    expect(loadCalls).toEqual(['alpha']);
    expect(tree.isLoading('alpha')).toBe(true);
    expect(tree.isLoading('beta')).toBe(false);
    expect(rowEl('alpha').getAttribute('aria-busy')).toBe('true');
    expect(rowEl('beta').hasAttribute('aria-busy')).toBe(false);
    expect(rowEl('alpha').querySelector('.status')!.textContent).toBe('Loading…');
    expect(root.getAttribute('aria-busy')).toBe('true');

    loads.get('alpha')!.resolve([
      { id: 'a1', label: 'One' },
      { id: 'a2', label: 'Two' },
    ]);
    await settle();

    expect(visible()).toEqual(['alpha', 'a1', 'a2', 'beta', 'plain']);
    expect(rowEl('a1').getAttribute('aria-level')).toBe('2');
    expect(rowEl('a1').getAttribute('aria-setsize')).toBe('2');
    expect(rowEl('alpha').hasAttribute('aria-busy')).toBe(false);
    expect(root.hasAttribute('aria-busy')).toBe(false);
    expect(tree.nodeStatus('alpha')).toBe('');
  });

  it('turns out to be a leaf when the children arrive empty', async () => {
    const { tree } = setup();
    tree.expand('alpha');
    await settle();

    loads.get('alpha')!.resolve([]);
    await settle();

    // Once children have arrived they are the answer, whatever the node
    // claimed before it was opened.
    expect(rowEl('alpha').hasAttribute('aria-expanded')).toBe(false);
    expect(tree.rowOf('alpha')!.expandable).toBe(false);
  });

  it('asks for one branch at a time', async () => {
    const { tree } = setup();
    tree.expand('alpha');
    tree.expand('beta');
    await settle();

    // A user who opens ten folders in a second should not open ten connections.
    expect(loadCalls).toEqual(['alpha']);

    loads.get('alpha')!.resolve([{ id: 'a1', label: 'One' }]);
    await settle();
    expect(loadCalls).toEqual(['alpha', 'beta']);
  });

  it('takes a collapsed node out of the queue and aborts it', async () => {
    const { tree } = setup();
    tree.expand('alpha');
    tree.expand('beta');
    await settle();

    tree.collapse('alpha');
    await settle();

    expect(loads.get('alpha')!.signal.aborted).toBe(true);
    expect(loadCalls).toEqual(['alpha', 'beta']);
    expect(tree.isLoading('alpha')).toBe(false);
  });

  it('keeps the queue in the order the nodes were opened', async () => {
    const { tree } = setup();
    tree.expand('beta');
    await settle();
    const first = loads.get('beta')!;
    expect(loadCalls).toEqual(['beta']);

    tree.expand('alpha');
    await settle();

    // Beta was asked for first and is already on the wire. Taking the head of
    // the queue from the model's order rather than the order the nodes were
    // opened throws that request away and asks for it a second time, so the
    // folder the user opened first is the last one to fill in.
    expect(first.signal.aborted).toBe(false);
    expect(loadCalls).toEqual(['beta']);

    loads.get('beta')!.resolve([{ id: 'b1', label: 'One' }]);
    await settle();
    expect(loadCalls).toEqual(['beta', 'alpha']);
  });

  it('reports a failure on the node it belongs to, and asks again on demand', async () => {
    const { tree } = setup();
    tree.expand('alpha');
    await settle();

    loads.get('alpha')!.reject(new Error('offline'));
    await settle();

    expect((tree.loadError('alpha') as Error).message).toBe('offline');
    expect(tree.nodeStatus('alpha')).toBe('Could not load');
    expect(rowEl('alpha').querySelector('.status')!.textContent).toBe('Could not load');
    // The failure retires the request rather than spinning for ever.
    expect(tree.isLoading('alpha')).toBe(false);
    expect(rowEl('alpha').hasAttribute('aria-busy')).toBe(false);

    tree.reload('alpha');
    await settle();
    expect(loadCalls).toEqual(['alpha', 'alpha']);
    expect(tree.loadError('alpha')).toBeUndefined();
  });

  it('stops the request when the tree unmounts mid-fetch', async () => {
    const { tree } = setup();
    tree.expand('alpha');
    await settle();

    for (const handle of mounted) handle.unmount();
    mounted = [];
    flushSync();

    // A response landing in a torn-down scope is the leak this prevents.
    expect(loads.get('alpha')!.signal.aborted).toBe(true);
  });

  it('finishes a cascade onto children that did not exist when it started', async () => {
    treeOptions = { ...treeOptions, selectionMode: 'checkbox' };
    const { tree } = setup();

    // Checked while closed: the cascade has nothing to reach yet.
    tree.setChecked('alpha', true);
    flushSync();
    expect(chosen(tree)).toEqual(['alpha']);

    tree.expand('alpha');
    await settle();
    loads.get('alpha')!.resolve([
      { id: 'a1', label: 'One' },
      { id: 'a2', label: 'Two' },
    ]);
    await settle();

    expect(chosen(tree)).toEqual(['a1', 'a2', 'alpha']);
    expect(rowEl('a1').getAttribute('aria-checked')).toBe('true');
    expect(tree.checkedState('alpha')).toBe(true);
  });

  it('finishes a cascade through a level that was itself unfetched', async () => {
    nodes.set([{ id: 'a', label: 'A', hasChildren: true }]);
    treeOptions = { loadChildren: lazyLoader(), selectionMode: 'checkbox' };
    const { tree } = setup();

    tree.setChecked('a', true);
    flushSync();

    tree.expand('a');
    await settle();
    loads.get('a')!.resolve([{ id: 'b', label: 'B', hasChildren: true }]);
    await settle();
    expect(chosen(tree)).toEqual(['a', 'b']);

    tree.expand('b');
    await settle();
    loads.get('b')!.resolve([{ id: 'c', label: 'C' }]);
    await settle();

    // B arrived unfetched itself, so it has to be remembered in its turn.
    // Otherwise the post-order pass reads C as unchecked, and the user's check
    // on the whole subtree evaporates with no interaction at all.
    expect(chosen(tree)).toEqual(['a', 'b', 'c']);
    expect(tree.checkedState('a')).toBe(true);
    expect(rowEl('c').getAttribute('aria-checked')).toBe('true');
  });

  it('turns a lazy folder off again when what arrived holds it part-checked', async () => {
    treeOptions = { ...treeOptions, selectionMode: 'checkbox' };
    const { tree, root } = setup();
    tree.focusNode('alpha');
    flushSync();

    // Checked while it is still closed, so the cascade lands only when the
    // children do — and one of them refuses it, exactly as a disabled child
    // written into the data does.
    press(root, ' ');
    tree.expand('alpha');
    await settle();
    loads.get('alpha')!.resolve([
      { id: 'a1', label: 'One' },
      { id: 'a2', label: 'Two', disabled: true },
    ]);
    await settle();

    expect(chosen(tree)).toEqual(['a1', 'alpha']);
    expect(tree.checkedState('alpha')).toBe('indeterminate');

    // Which way the next press goes has to be asked of what is left to check,
    // not of the aggregate: A2 holds the folder at `mixed` for ever, so a rule
    // reading the state asks for the same check again and the box never
    // turns off.
    press(root, ' ');
    expect(chosen(tree)).toEqual([]);
    expect(tree.checkedState('alpha')).toBe(false);
    expect(rowEl('alpha').getAttribute('aria-checked')).toBe('false');
  });

  it('keeps focus on a node whose children have not arrived', async () => {
    const { tree, root } = setup();
    press(root, 'ArrowDown');
    press(root, 'ArrowRight');
    await settle();
    expect(tree.isExpanded('alpha')).toBe(true);
    expect(tree.isLoading('alpha')).toBe(true);

    press(root, 'ArrowRight');
    // There is no first child to move into yet. The row after an open-but-empty
    // node is its next sibling, so taking it throws the reader out of the
    // branch they just opened.
    expect(tree.activeId()).toBe('alpha');
  });

  it('carries the reader out of a branch a reload takes away', async () => {
    const { tree } = setup();
    tree.expand('alpha');
    await settle();
    loads.get('alpha')!.resolve([{ id: 'a1', label: 'One' }]);
    await settle();

    tree.focusNode('a1');
    flushSync();
    expect(document.activeElement).toBe(rowEl('a1'));

    // Forgetting a node's children takes the row under the reader out of the
    // model without touching expansion, the selection or the data: a route
    // through none of the calls a fix could be hung off.
    tree.reload('alpha');
    flushSync();

    expect(tree.activeId()).toBe('alpha');
    expect(document.activeElement).toBe(rowEl('alpha'));
    expect(tabStops()).toEqual(['alpha']);
  });
});

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

describe('filtering', () => {
  it('keeps the ancestors of a match and opens the way to it', () => {
    const { tree } = setup();
    tree.setFilter('in');
    flushSync();

    // Install and Index match; Docs, Guide and Src are kept because a match is
    // underneath them, and opened because it is unreachable otherwise.
    expect(visible()).toEqual(['docs', 'guide', 'install', 'src', 'index']);
    expect(rowEl('install').hasAttribute('data-match')).toBe(true);
    expect(rowEl('guide').hasAttribute('data-match')).toBe(false);
    expect(rowEl('guide').getAttribute('aria-expanded')).toBe('true');

    // The counts follow the survivors, because that is the set the reader is
    // actually in: two roots, not three, and one child of Docs, not three.
    expect(rowEl('docs').getAttribute('aria-setsize')).toBe('2');
    expect(rowEl('src').getAttribute('aria-posinset')).toBe('2');
    expect(rowEl('guide').getAttribute('aria-setsize')).toBe('1');

    // Nothing was written into the expansion set, so clearing the search does
    // not leave the tree standing open.
    expect([...tree.expanded()]).toEqual([]);
    tree.setFilter('');
    flushSync();
    expect(visible()).toEqual(['docs', 'src', 'notes']);
  });

  it('keeps what is under a match without opening it', () => {
    const { tree } = setup();
    tree.setFilter('guide');
    flushSync();

    // Finding a folder and then finding it empty is worse than the branch
    // staying closed until it is asked for.
    expect(visible()).toEqual(['docs', 'guide']);
    expect(rowEl('guide').getAttribute('aria-expanded')).toBe('false');

    tree.expand('guide');
    flushSync();
    expect(visible()).toEqual(['docs', 'guide', 'install', 'usage', 'faq']);
  });

  it('lets the reader close a branch the filter opened, until the search changes', () => {
    const { tree } = setup();
    tree.setFilter('in');
    flushSync();

    tree.collapse('guide');
    flushSync();
    expect(tree.isExpanded('guide')).toBe(false);
    expect(visible()).toEqual(['docs', 'guide', 'src', 'index']);

    // A new search is a fresh view: what was closed under the last one has
    // nothing to say about this one.
    tree.setFilter('ins');
    flushSync();
    expect(visible()).toEqual(['docs', 'guide', 'install']);
  });

  it('can be driven from outside, as a search box owns its own text', () => {
    const filter = new Signal.State('');
    treeOptions = { filter };
    const { tree } = setup();

    filter.set('notes');
    flushSync();
    expect(visible()).toEqual(['notes']);
    expect(tree.filter()).toBe('notes');
  });

  it('carries the reader out of a branch it has taken away', () => {
    treeOptions = { defaultExpanded: ['docs', 'guide'] };
    const { tree } = setup();
    tree.focusNode('install');
    flushSync();
    expect(document.activeElement).toBe(rowEl('install'));

    // The filter takes the ancestors of the focused node with it, so there is
    // nothing above it to fall back to. The first surviving row is where a
    // reader tabbing in would land, and it is where the one already inside the
    // tree goes rather than to <body>.
    tree.setFilter('src');
    flushSync();

    expect(visible()).toEqual(['src']);
    expect(tree.activeId()).toBe('src');
    expect(document.activeElement).toBe(rowEl('src'));
    expect(tabStops()).toEqual(['src']);
  });

  it('carries them out of it when the search box owns the query too', () => {
    const filter = new Signal.State('');
    treeOptions = { defaultExpanded: ['docs', 'guide'], filter };
    const { tree } = setup();
    tree.focusNode('install');
    flushSync();

    // The signal is how a search box drives the tree, and writing it calls no
    // method of the tree at all — the same route the router takes through
    // `expanded`, and the one a fix hung off `setFilter` would miss.
    filter.set('src');
    flushSync();

    expect(tree.activeId()).toBe('src');
    expect(document.activeElement).toBe(rowEl('src'));
    expect(tabStops()).toEqual(['src']);
  });

  it('names no node at all while it matches none', () => {
    const { tree } = setup();
    tree.focusNode('notes');
    flushSync();

    tree.setFilter('zzz');
    flushSync();
    // A name the model cannot resolve is worse than no name: the tab stop
    // follows the name, and there is no row left for it to sit on.
    expect(tree.activeId()).toBeNull();

    tree.setFilter('notes');
    flushSync();
    expect(tabStops()).toEqual(['notes']);
  });

  it('keeps a reader who is standing in the tree on it when a query empties it', () => {
    const filter = new Signal.State('');
    treeOptions = { filter };
    const { tree, root } = setup();
    tree.focusNode('notes');
    flushSync();
    expect(document.activeElement).toBe(rowEl('notes'));

    filter.set('zzz');
    flushSync();

    // Every row goes, the one under the reader with them, and a browser
    // answers a removed focus with <body> — the top of the document, nowhere
    // near what they were reading. An empty tree holds the tab stop itself, so
    // that is where they stay.
    expect(visible()).toEqual([]);
    expect(tree.activeId()).toBeNull();
    expect(root.getAttribute('tabindex')).toBe('0');
    expect(document.activeElement).toBe(root);

    // And from there straight back into the rows the next query returns.
    filter.set('');
    flushSync();
    press(root, 'ArrowDown');
    expect(document.activeElement).toBe(rowEl('docs'));
  });

  it('leaves a reader who is typing in the search box in it instead', () => {
    const filter = new Signal.State('');
    treeOptions = { filter };
    const { tree, root } = setup();
    tree.focusNode('notes');
    flushSync();

    const search = document.createElement('input');
    document.body.append(search);
    search.focus();

    filter.set('zzz');
    flushSync();

    // The row the reader was on is going, which is what an empty tree reads as
    // focus lost to <body> — but the query that emptied it was typed
    // somewhere, and taking that box away mid-word is the worse bug.
    expect(visible()).toEqual([]);
    expect(tree.activeId()).toBeNull();
    expect(document.activeElement).toBe(search);
    // The tree is still a stop for when they tab back into it.
    expect(root.getAttribute('tabindex')).toBe('0');
  });

  it('takes a match function of the consumer’s own', () => {
    treeOptions = { match: (node, query) => node.id === query };
    const { tree } = setup();

    tree.setFilter('faq');
    flushSync();
    expect(visible()).toEqual(['docs', 'guide', 'faq']);
  });
});

// ---------------------------------------------------------------------------
// Dragging nodes
// ---------------------------------------------------------------------------

/**
 * Apply a drop to the data the way a consumer would: take the node out, then
 * splice it in at the index it was given, with no adjustment.
 */
function moveNode(list: readonly TreeNode[], drop: TreeDrop): TreeNode[] {
  let moved: TreeNode | undefined;
  const without = (items: readonly TreeNode[]): TreeNode[] =>
    items.flatMap((node) => {
      if (node.id === drop.sourceId) {
        moved = node;
        return [];
      }
      return [node.children ? { ...node, children: without(node.children) } : node];
    });
  const spliced = (items: readonly TreeNode[]): TreeNode[] => {
    const next = [...items];
    next.splice(drop.index, 0, moved!);
    return next;
  };
  const into = (items: readonly TreeNode[]): TreeNode[] =>
    items.map((node) => {
      if (node.id === drop.parentId) return { ...node, children: spliced(node.children ?? []) };
      return node.children ? { ...node, children: into(node.children) } : node;
    });

  const rest = without(list);
  return drop.parentId === null ? spliced(rest) : into(rest);
}

function pointer(
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  el: Element,
  x: number,
  y: number,
): void {
  el.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      isPrimary: true,
      button: 0,
      pointerId: 1,
      pointerType: 'mouse',
      clientX: x,
      clientY: y,
    }),
  );
  flushSync();
}

/** Every rendered row twenty pixels tall, one under the other. */
function layoutRows(root: HTMLElement): void {
  const rows = [...root.querySelectorAll<HTMLElement>('.row')];
  root.getBoundingClientRect = () => new DOMRect(0, 0, 200, rows.length * 20);
  rows.forEach((row, index) => {
    row.getBoundingClientRect = () => new DOMRect(0, index * 20, 200, 20);
  });
}

describe('dragging nodes', () => {
  let drops: [TreeDrop, DragMode][];

  beforeEach(() => {
    drops = [];
    treeOptions = {
      defaultExpanded: ['docs'],
      onDrop: (drop, mode) => {
        drops.push([drop, mode]);
        nodes.set(moveNode(nodes.get(), drop));
      },
    };
  });

  it('turns a place in the flat list into a parent and an index among its children', () => {
    const { tree, root } = setup();
    // docs, readme, guide, changelog, src, notes — docs open, guide closed.
    expect(tree.lift('readme')).toBe(true);
    flushSync();

    // A lift starts in the gap the node is already in, so a drop straight
    // away puts it back where it was.
    expect(tree.dropTarget()).toEqual({
      sourceId: 'readme',
      targetId: 'guide',
      position: 'before',
      parentId: 'docs',
      index: 0,
    });

    press(root, 'ArrowDown');
    // On a folder is last among its children: guide holds three.
    expect(tree.dropTarget()).toMatchObject({
      targetId: 'guide',
      position: 'on',
      parentId: 'guide',
      index: 3,
    });

    press(root, 'ArrowDown');
    // Counted with readme already out of docs, so guide is 0 and this is 1.
    expect(tree.dropTarget()).toMatchObject({
      targetId: 'changelog',
      position: 'before',
      parentId: 'docs',
      index: 1,
    });

    press(root, ' ');
    expect(drops).toHaveLength(1);
    expect(drops[0]![1]).toBe('keyboard');
    // Out, then spliced in at the index as given: between guide and changelog.
    expect(visible()).toEqual(['docs', 'guide', 'readme', 'changelog', 'src', 'notes']);
  });

  it('puts a node dropped on a folder last among that folder’s children', () => {
    const { tree, root } = setup();
    tree.lift('notes');
    flushSync();

    press(root, 'ArrowUp');
    expect(tree.dropTarget()).toMatchObject({
      targetId: 'src',
      position: 'on',
      parentId: 'src',
      index: 2,
    });
    press(root, ' ');

    tree.expand('src');
    flushSync();
    expect(visible()).toEqual([
      'docs',
      'readme',
      'guide',
      'changelog',
      'src',
      'index',
      'util',
      'notes',
    ]);
  });

  it('reads a line drawn under an open folder as the top of that folder', () => {
    const { tree, root } = setup();
    layoutRows(root);
    const notes = rowEl('notes');

    pointer('pointerdown', notes, 50, 105);
    pointer('pointermove', notes, 50, 115);
    expect(tree.drag!.isDragging()).toBe(true);

    // The foot of docs. Docs is open, so the row under that line is readme,
    // its first child: a sibling after everything docs contains is not what
    // the line shows.
    pointer('pointermove', notes, 50, 18);
    expect(tree.dropTarget()).toEqual({
      sourceId: 'notes',
      targetId: 'docs',
      position: 'after',
      parentId: 'docs',
      index: 0,
    });
    expect(tree.indicator()).toMatchObject({ position: 'after', y: 20, height: 0 });

    pointer('pointerup', notes, 50, 18);
    expect(drops[0]![1]).toBe('pointer');
    expect(visible()).toEqual(['docs', 'notes', 'readme', 'guide', 'changelog', 'src']);
  });

  it('will not carry a node into its own subtree', () => {
    const { tree, root } = setup();
    tree.lift('docs');
    flushSync();

    const reached: (string | null)[] = [];
    for (let i = 0; i < 12; i++) {
      const target = tree.dropTarget();
      reached.push(target?.parentId ?? null, target?.targetId ?? null);
      press(root, 'ArrowDown');
    }

    // Nothing inside docs, as a place to go or as the parent it would go under.
    for (const inside of ['docs', 'readme', 'guide', 'changelog', 'install', 'usage', 'faq']) {
      expect(reached).not.toContain(inside);
    }
    expect(reached).toContain('src');
  });

  it('starts an open node’s drag where the node is, past its own subtree', () => {
    treeOptions = { ...treeOptions, defaultExpanded: ['src'] };
    const { tree, root } = setup();
    // docs, src, index, util, notes. The gap just under src is inside it, and
    // refused; the one where src already sits is the one past its children.
    tree.lift('src');
    flushSync();
    expect(tree.dropTarget()).toEqual({
      sourceId: 'src',
      targetId: 'notes',
      position: 'before',
      parentId: null,
      index: 1,
    });

    press(root, ' ');
    expect(visible()).toEqual(['docs', 'src', 'index', 'util', 'notes']);
  });

  it('lifts with Space only where Space has nothing to select', () => {
    const plain = setup();
    plain.tree.focusNode('readme');
    flushSync();
    // On the node holding focus, which is where a key lands: the node to lift
    // is the one the press came from.
    press(rowEl('readme'), ' ');
    expect(plain.tree.drag!.isDragging()).toBe(true);
    expect(plain.tree.drag!.source()?.itemId).toBe('readme');
    press(rowEl('readme'), 'Escape');
    expect(plain.tree.drag!.isDragging()).toBe(false);

    host.innerHTML = '';
    treeOptions = { ...treeOptions, selectionMode: 'single' };
    const choosing = setup();
    choosing.tree.focusNode('readme');
    flushSync();
    press(rowEl('readme'), ' ');
    expect(choosing.tree.drag!.isDragging()).toBe(false);
    expect(chosen(choosing.tree)).toEqual(['readme']);

    // The door a selectable tree has to open some other way.
    expect(choosing.tree.lift('readme')).toBe(true);
  });

  it('carries a keyboard drag past the rows the window held when it began', () => {
    nodes.set(manyNodes(40));
    const { tree, root } = setupVirtual();
    expect(visible()).toEqual(['n0', 'n1', 'n2', 'n3', 'n4', 'n5', 'n6']);

    // happy-dom lays nothing out, so bringing a row into view is done by hand:
    // the smallest scroll that puts the whole row inside the 120px viewport.
    const reveal = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
    reveal.mockImplementation(function (this: HTMLElement) {
      const row = tree.rowOf(this.getAttribute(TREE_ITEM_ATTRIBUTE) ?? '');
      if (!row) return;
      const top = row.index * 24;
      if (top < root.scrollTop) userScroll(root, top);
      else if (top + 24 > root.scrollTop + 120) userScroll(root, top + 24 - 120);
    });

    try {
      tree.lift('n0');
      flushSync();
      for (let i = 0; i < 20; i++) press(root, 'ArrowDown');

      // Twenty gaps down, which is far below anything rendered at the lift.
      expect(tree.dropTarget()).toEqual({
        sourceId: 'n0',
        targetId: 'n21',
        position: 'before',
        parentId: null,
        index: 20,
      });
      expect(visible()).toContain('n21');

      press(root, ' ');
      expect(drops[0]![0]).toMatchObject({ sourceId: 'n0', targetId: 'n21', index: 20 });
    } finally {
      reveal.mockRestore();
    }
  });

  it('will not pick up a disabled node', () => {
    treeOptions = { ...treeOptions, defaultExpanded: ['src'] };
    const { tree } = setup();
    expect(tree.lift('util')).toBe(false);
    expect(tree.drag!.isDragging()).toBe(false);
  });

  it('opens a closed folder that a drag rests on, and not one it passes over', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { tree, root } = setup();
    tree.lift('notes');
    flushSync();

    // On src, and away again before the delay is up.
    press(root, 'ArrowUp');
    vi.advanceTimersByTime(300);
    press(root, 'ArrowUp');
    vi.advanceTimersByTime(600);
    flushSync();
    expect(tree.isExpanded('src')).toBe(false);

    // On src, and staying there.
    press(root, 'ArrowDown');
    expect(tree.dropTarget()).toMatchObject({ targetId: 'src', position: 'on' });
    vi.advanceTimersByTime(599);
    flushSync();
    expect(tree.isExpanded('src')).toBe(false);
    vi.advanceTimersByTime(1);
    flushSync();
    expect(tree.isExpanded('src')).toBe(true);
    // Its children are places the drag can go now.
    expect(visible()).toEqual([
      'docs',
      'readme',
      'guide',
      'changelog',
      'src',
      'index',
      'util',
      'notes',
    ]);
  });
});
