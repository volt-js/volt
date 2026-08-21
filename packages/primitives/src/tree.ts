/**
 * Tree — a hierarchy that can be walked, searched, chosen from and rearranged.
 *
 * This is headless: it owns the model, the keyboard, the ARIA and the drop
 * arithmetic, and returns prop objects to spread onto whatever markup the
 * consumer writes. Nothing here renders, nothing here moves a node, and
 * nothing here has an opinion about styling. `onDrop` reports where a node
 * landed; changing the data is the consumer's business, because only they know
 * what their tree is made of.
 *
 *   class Files {
 *     tree = new Signal.State<Element | null>(null);
 *     nodes = new Signal.State<TreeNode[]>([…]);
 *     files = createTree({
 *       tree: () => this.tree.get(),
 *       nodes: () => this.nodes.get(),
 *       selectionMode: 'single',
 *     });
 *   }
 *
 *   <div :ref="tree" :spread="files.treeProps()"
 *        :keydown="files.onKeyDown($event)"
 *        :click="files.onItemClick($event)"
 *        :focusin="files.onFocusIn($event)">
 *     <div :for="row in files.rendered()" :key="row.id"
 *          :spread="files.itemProps(row)"
 *          :style="{ 'padding-inline-start': row.level + 'rem' }">
 *       <span :spread="files.toggleProps()">▸</span>{ row.label }
 *     </div>
 *   </div>
 *
 * **One flat list, not a nest of lists.** Every visible node is flattened into
 * a linear model, and that model is what the arrow keys walk, what typeahead
 * searches, and what the virtualizer windows. A nested rendering would give
 * each of those three a different structure to agree about, and they would not.
 * The cost is that indentation is the consumer's job — `row.level` is the
 * number, and CSS is the place for it.
 *
 * **The counted attributes are computed, never read back.** `aria-level`,
 * `aria-setsize`, `aria-posinset` and `aria-expanded` are the only things
 * telling a screen reader what shape the tree is, and every one of them breaks
 * by construction the moment virtualization windows it: the DOM then holds a
 * arbitrary slice of one level's siblings, so counting the elements gives "3 of
 * 12" for a level with four hundred. They are taken from the flat model, where
 * the numbers are true whatever is on screen.
 *
 * The keyboard map, which is the WAI-ARIA tree view pattern:
 *
 *   ArrowDown / ArrowUp      next / previous visible node
 *   ArrowRight               expand a closed node, then move into it
 *   ArrowLeft                collapse an open node, then move out to its parent
 *   Home / End               first / last visible node
 *   *                        expand every sibling of the focused node
 *   Enter                    activate — and select, where selecting is a thing
 *   Space                    select, or toggle the checkbox
 *   printable characters     typeahead, accumulating for 500ms
 *   Shift + Down / Up        move and toggle selection (multi-select)
 *   Shift + Space            select from the last chosen node to this one
 *   Ctrl + Shift + Home/End  extend the selection to the first / last node
 *   Shift + Home / End       the same, without the Ctrl the practice asks for
 *   Ctrl + A                 select everything (multi-select)
 *
 * The tree pattern spells the range chords `Ctrl + Shift + Home / End`, where
 * the multi-select listbox spells them without the Ctrl. Both are accepted:
 * the practice's own chord has to work, and a reader arriving from a list with
 * the shorter one in their fingers finds it does what they meant rather than
 * nothing at all.
 *
 * Left and Right are resolved against writing direction, so they swap under
 * `dir="rtl"`; Up and Down never swap, because vertical order is not mirrored.
 *
 * **Disabled nodes stay focusable.** They carry `aria-disabled` rather than
 * being skipped, for the reason a disabled checkbox stays in the tab order: a
 * node a keyboard user cannot reach is a node they cannot discover is there.
 * They refuse selection, activation and being picked up.
 *
 * **Keyboard dragging needs a door.** Space lifts a node only when there is no
 * selection to make with it; a selectable tree has to open the drag some other
 * way, and `lift()` is that way — wire it to a "Move" item in the row's context
 * menu, which is both unambiguous and more discoverable than an undocumented
 * chord. Once lifted, the whole drag keyboard map belongs to `createDragDrop`.
 */

import { Signal, effect, onCleanup } from '@voltdev/core';
import { createCollection } from './collection.js';
import { createRovingFocus } from './roving-focus.js';
import { createId } from './id.js';
import {
  createVirtualizer,
  type VirtualOverscan,
  type Virtualizer,
} from './virtualizer.js';
import {
  createDragDrop,
  type DragDrop,
  type DragDropLabels,
  type DragMode,
  type DropIndicator,
  type DropPosition,
  type DropTarget,
} from './drag-drop.js';
import { createResource } from './async.js';
import { resolveDirection, useLocale } from './i18n.js';
import type { CheckedState } from './form-controls.js';

// The proposal's own name for reading without subscribing; Volt adds no second
// spelling for it.
const { untrack } = Signal.subtle;

/** Marks a rendered node, carrying its id. */
export const TREE_ITEM_ATTRIBUTE = 'data-volt-tree-item';

/** Marks the twisty inside a node: a press on it expands rather than selects. */
export const TREE_TOGGLE_ATTRIBUTE = 'data-volt-tree-toggle';

/** Marks the checkbox inside a node: a press on it checks rather than selects. */
export const TREE_CHECKBOX_ATTRIBUTE = 'data-volt-tree-checkbox';

/**
 * How choosing works.
 *
 * `checkbox` is a different model from `multiple`, not a decoration on it: it
 * says so with `aria-checked`, it has a third state, and its state cascades.
 */
export type TreeSelectionMode = 'none' | 'single' | 'multiple' | 'checkbox';

/**
 * One node of the consumer's hierarchy.
 *
 * Generic in the payload rather than in the node, because every method here
 * would otherwise have to be generic in a type that refers to itself. Put
 * whatever the row renders from in `data`; nothing in this file reads it.
 */
export interface TreeNode<T = unknown> {
  /** Addresses this node. Must be unique across the whole tree. */
  readonly id: string;
  /** What typeahead matches and the filter searches. Falls back to the id. */
  readonly label?: string;
  /** Loaded children. Absent with `hasChildren` means "not fetched yet". */
  readonly children?: readonly TreeNode<T>[];
  /** There are children, and `loadChildren` will produce them on expansion. */
  readonly hasChildren?: boolean;
  /** Announced as unavailable. Still reachable, still a place to drop. */
  readonly disabled?: boolean;
  /** A drop may land *on* this node. Defaults to whether it can have children. */
  readonly dropsOn?: boolean;
  /** Whatever the consumer's row needs. Never read here. */
  readonly data?: T;
}

/**
 * One visible node, flattened.
 *
 * `posinset` and `setsize` count the siblings that survive the filter, because
 * that is the set the reader is actually in.
 */
export interface TreeRow<T = unknown> {
  readonly node: TreeNode<T>;
  readonly id: string;
  readonly label: string;
  /** 1-based, as `aria-level` counts. */
  readonly level: number;
  /** 1-based place among its visible siblings. */
  readonly posinset: number;
  /** How many visible siblings it has, itself included. */
  readonly setsize: number;
  readonly parentId: string | null;
  /** Its place in the flat model — the index the virtualizer windows by. */
  readonly index: number;
  readonly expandable: boolean;
  /** False for a node that cannot expand, whatever the expansion set says. */
  readonly expanded: boolean;
  readonly disabled: boolean;
  /** It matched the filter itself, rather than being kept for its relatives. */
  readonly matched: boolean;
}

/** Where a node will land, in terms of the consumer's own data. */
export interface TreeDrop {
  readonly sourceId: string;
  /** The node the drop was resolved against, or null for the empty root. */
  readonly targetId: string | null;
  readonly position: DropPosition;
  /** The parent it ends up under. Null is the root. */
  readonly parentId: string | null;
  /**
   * Its index among that parent's children, with the dragged node already
   * taken out — so `remove` then `splice(index, 0, node)` is correct with no
   * adjustment, which is the off-by-one every sortable tree gets wrong.
   */
  readonly index: number;
}

/**
 * Every string this puts in front of a user.
 *
 * All of them are overridable because the library is localised later, and a
 * hard-coded English sentence is not something a consumer can work around. The
 * defaults come from the message catalogue, so an application that has already
 * translated `loading` does not translate it twice.
 */
export interface TreeLabels {
  /**
   * Names the tree. No default: a tree is nearly always named by a heading
   * beside it, and `aria-labelledby` pointing at that heading is better than
   * any word this could invent.
   */
  tree?: string;
  /** On a node whose children are being fetched. Default the catalogue's `loading`. */
  loading?: string;
  /** When the filter matches nothing. Default the catalogue's `noResults`. */
  empty?: string;
  /** On a node whose children failed to arrive. Default `Could not load`. */
  error?: string;
  /** Passed straight through to the drag primitive. */
  drag?: DragDropLabels;
}

/** Windowing. Supplying this is what turns virtualization on. */
export interface TreeVirtualOptions {
  /** The element that scrolls — the same one `treeProps()` goes on. */
  scroller: () => Element | null | undefined;
  /** The element `contentProps()` goes on, holding the rendered window. */
  container?: () => Element | null | undefined;
  /** A number promises every row is this tall; a function is an estimate. */
  itemSize: number | ((index: number) => number);
  /** Measure rendered rows and correct the estimate. */
  measure?: boolean;
  /** Space between rows, in px. */
  gap?: number;
  /** Rows rendered outside the viewport. Default 2 each way. */
  overscan?: number | Partial<VirtualOverscan>;
}

export type TreePropValue =
  | string
  | number
  | boolean
  | undefined
  | Readonly<Record<string, string>>;

export interface TreeProps {
  readonly [key: string]: TreePropValue;
}

/** How a selection was asked for, which is what a modifier key means. */
export interface TreeSelectOptions {
  /** Add to the selection rather than replacing it — Ctrl or Cmd. */
  additive?: boolean;
  /** Extend from the anchor to here — Shift. */
  range?: boolean;
}

export interface TreeOptions<T = unknown> {
  /** The element carrying `role="tree"`, once rendered. */
  tree: () => Element | null | undefined;
  /** The roots of the hierarchy. */
  nodes: () => readonly TreeNode<T>[];

  /**
   * Supply a signal to control expansion from outside — a router that opens
   * the path to the current page. Without one the tree owns it.
   */
  expanded?: Signal.State<ReadonlySet<string>>;
  defaultExpanded?: Iterable<string>;

  /** Likewise for the selection. */
  selected?: Signal.State<ReadonlySet<string>>;
  defaultSelected?: Iterable<string>;

  /** And for the search box's text. */
  filter?: Signal.State<string>;
  defaultFilter?: string;

  /** Default `none`. */
  selectionMode?: TreeSelectionMode;
  /**
   * Checking a node checks its subtree, and a part-checked node reports
   * `mixed`. Default true.
   *
   * Turn it off for the strict model, where every node's checkbox is its own
   * fact — which is what a tree of independent permissions wants, and what a
   * tree of nested folders does not.
   */
  cascade?: boolean;

  /** Typing letters jumps to a matching node. Default true. */
  typeahead?: boolean;
  /** How long typed characters accumulate, in ms. Default 500. */
  typeaheadTimeout?: number;

  /**
   * Whether a node survives the filter. Default: its label contains the query,
   * case-folded for the locale — which is not the same as `toLowerCase()` in
   * Turkish, and this is the one place that shows.
   */
  match?: (node: TreeNode<T>, query: string) => boolean;

  /**
   * Fetch a node's children the first time it is expanded. A node opts in with
   * `hasChildren: true` and no `children`.
   *
   * One request at a time, in the order the nodes were opened: a tree whose
   * user expands ten folders in a second should not open ten connections. The
   * cost is that the tenth waits for the first nine; collapsing a node that is
   * still waiting takes it out of the queue and aborts it if it is in flight.
   */
  loadChildren?: (
    node: TreeNode<T>,
    signal: AbortSignal,
  ) => readonly TreeNode<T>[] | Promise<readonly TreeNode<T>[]>;

  /** Windowing. Leave it out and every visible row is rendered. */
  virtual?: TreeVirtualOptions;

  /**
   * How long a collapsed node must be hovered during a drag before it opens,
   * in ms. Default 600 — long enough that passing over a folder on the way
   * somewhere else does not open it.
   */
  autoExpandDelay?: number;

  labels?: TreeLabels;

  onExpandedChange?: (expanded: ReadonlySet<string>) => void;
  onSelectionChange?: (selected: ReadonlySet<string>) => void;
  /** Enter, or a double-press: open the file, follow the link. */
  onActivate?: (row: TreeRow<T>) => void;
  /**
   * Where a dragged node landed. Supplying it is what turns dragging on: a
   * tree with nowhere to report a move has no business starting one.
   */
  onDrop?: (drop: TreeDrop, mode: DragMode) => void;
}

export interface Tree<T = unknown> {
  /** Every visible node, flattened, in the order the arrows walk them. */
  rows(): readonly TreeRow<T>[];
  /** The rows to render: the window when virtualized, otherwise all of them. */
  rendered(): readonly TreeRow<T>[];
  rowOf(id: string): TreeRow<T> | null;
  /** How many visible nodes there are. */
  count(): number;

  activeId(): string | null;
  activeRow(): TreeRow<T> | null;
  /** Move focus to a node, scrolling it into view first if it is windowed. */
  focusNode(id: string): void;

  expanded(): ReadonlySet<string>;
  isExpanded(id: string): boolean;
  expand(id: string): void;
  collapse(id: string): void;
  toggleExpanded(id: string): void;
  /** Every node whose children are known. Lazy ones load as they appear. */
  expandAll(): void;
  collapseAll(): void;
  /** What `*` does: open every sibling of this node, itself included. */
  expandSiblings(id: string): void;

  selection(): ReadonlySet<string>;
  isSelected(id: string): boolean;
  /** `true`, `false`, or `indeterminate` for a part-checked subtree. */
  checkedState(id: string): CheckedState;
  select(id: string, options?: TreeSelectOptions): void;
  toggleSelected(id: string): void;
  setChecked(id: string, checked: boolean): void;
  selectAll(): void;
  clearSelection(): void;

  filter(): string;
  setFilter(query: string): void;

  /** Whether this node's children are being fetched right now. */
  isLoading(id: string): boolean;
  /** Why this node's children never arrived, or undefined. */
  loadError(id: string): unknown;
  /** Forget a node's children — loaded or failed — and ask again. */
  reload(id: string): void;
  /** The loading or error string for a node, or '' when it has neither. */
  nodeStatus(id: string): string;

  /** The drag primitive, for `isDragging`, `announcement` and the rest. */
  readonly drag: DragDrop | null;
  /** The virtualizer, for `scrollToIndex` and the geometry. */
  readonly virtualizer: Virtualizer | null;
  /** Where the live drag would land, in terms of the consumer's data. */
  dropTarget(): TreeDrop | null;
  /** Where to draw the insertion line or the highlight. */
  indicator(): DropIndicator | null;
  /** Start a keyboard drag on a node. False when it cannot be picked up. */
  lift(id: string): boolean;

  onKeyDown(event: KeyboardEvent): void;
  onItemClick(event: MouseEvent): void;
  /** Wire alongside the click handler to start pointer drags. */
  onPointerDown(event: PointerEvent): void;
  /** Keeps the roving tab stop with whatever the browser focused. */
  onFocusIn(event: FocusEvent): void;

  treeProps(): TreeProps;
  /** The empty element sized to the whole collection. Virtualized trees only. */
  sizerProps(): TreeProps;
  /** The element holding the rendered window. Virtualized trees only. */
  contentProps(): TreeProps;
  itemProps(row: TreeRow<T>): TreeProps;
  toggleProps(): TreeProps;
  checkboxProps(row: TreeRow<T>): TreeProps;
  /** Text for an optional live region. See `statusProps`. */
  status(): string;
  statusProps(): TreeProps;
}

/** Everything the whole hierarchy knows, whether or not it is on screen. */
interface Structure<T> {
  readonly nodes: ReadonlyMap<string, TreeNode<T>>;
  readonly parents: ReadonlyMap<string, string | null>;
}

/** What a filter decided about every node it looked at. */
interface FilterPass {
  /** Nodes that stay in the model. */
  readonly keep: ReadonlySet<string>;
  /** Nodes that must be open for a match to be reachable. */
  readonly reveal: ReadonlySet<string>;
  /** Nodes that matched in their own right. */
  readonly matched: ReadonlySet<string>;
}

interface Model<T> {
  readonly rows: readonly TreeRow<T>[];
  readonly byId: ReadonlyMap<string, TreeRow<T>>;
}

/** One answered lazy load. The id travels with it, since `onSuccess` has none. */
interface LoadedChildren<T> {
  readonly id: string;
  readonly children: readonly TreeNode<T>[];
}

const DEFAULT_AUTO_EXPAND_DELAY = 600;
const DEFAULT_TYPEAHEAD_TIMEOUT = 500;

export function createTree<T = unknown>(options: TreeOptions<T>): Tree<T> {
  const locale = useLocale();
  const labels = options.labels ?? {};
  const mode = options.selectionMode ?? 'none';
  const cascade = options.cascade !== false;
  const autoExpandDelay = options.autoExpandDelay ?? DEFAULT_AUTO_EXPAND_DELAY;
  const typeaheadTimeout = options.typeaheadTimeout ?? DEFAULT_TYPEAHEAD_TIMEOUT;

  const containerId = createId('tree');

  const expandedState =
    options.expanded ?? new Signal.State<ReadonlySet<string>>(new Set(options.defaultExpanded ?? []));
  const selectedState =
    options.selected ?? new Signal.State<ReadonlySet<string>>(new Set(options.defaultSelected ?? []));
  const queryState = options.filter ?? new Signal.State(options.defaultFilter ?? '');

  const activeState = new Signal.State<string | null>(null);
  const loadedState = new Signal.State<ReadonlyMap<string, readonly TreeNode<T>[]>>(new Map());
  const failedState = new Signal.State<ReadonlyMap<string, unknown>>(new Map());

  /**
   * Nodes the user closed while a filter was auto-opening them.
   *
   * The filter's expansion has to be reversible — clearing the search must not
   * leave the whole tree standing open — so it is derived rather than written
   * into the expansion set. That leaves nowhere to record "I closed this one",
   * which is what this is.
   */
  const suppressed = new Signal.State<ReadonlySet<string>>(new Set());

  /** The drop target, owned here so that auto-expansion can watch it. */
  const dropSignal = new Signal.State<DropTarget | null>(null);

  /** Where a range selection is measured from. */
  let anchorId: string | null = null;

  // ---------------------------------------------------------------------------
  // Reading the model
  // ---------------------------------------------------------------------------

  const labelOf = (node: TreeNode<T>): string => node.label ?? node.id;

  /** Case folded for the locale — `İ` and `i` are not the same letter in Turkish. */
  const fold = (value: string): string => value.toLocaleLowerCase(locale.code());

  const childrenOf = (node: TreeNode<T>): readonly TreeNode<T>[] | undefined =>
    node.children ?? loadedState.get().get(node.id);

  const isExpandable = (node: TreeNode<T>): boolean => {
    const children = childrenOf(node);
    // Once children have arrived, they are the answer — a folder that turned
    // out to be empty is a leaf, whatever it claimed before it was opened.
    if (children) return children.length > 0;
    return node.hasChildren === true;
  };

  const structure = new Signal.Computed<Structure<T>>(() => {
    const nodes = new Map<string, TreeNode<T>>();
    const parents = new Map<string, string | null>();

    const walk = (list: readonly TreeNode<T>[], parentId: string | null): void => {
      for (const node of list) {
        // A repeated id is a bug in the caller's data. Taking the first and
        // moving on is a wrong tree; recursing into a cycle is a hung tab.
        if (nodes.has(node.id)) continue;
        nodes.set(node.id, node);
        parents.set(node.id, parentId);
        const children = childrenOf(node);
        if (children) walk(children, node.id);
      }
    };

    walk(options.nodes(), null);
    return { nodes, parents };
  });

  const nodeById = (id: string): TreeNode<T> | undefined => structure.get().nodes.get(id);

  const matches = (node: TreeNode<T>, query: string): boolean =>
    options.match ? options.match(node, query) : fold(labelOf(node)).includes(fold(query));

  /**
   * Which nodes a filter keeps, and which must be opened to reach them.
   *
   * A match keeps itself, every ancestor above it, and everything below it. The
   * subtree is the arguable half: finding a folder and then finding it empty is
   * worse than the alternative, which is that a search for a common word can
   * still hold a large branch. It stays closed until asked for — only the
   * ancestors of a match are opened — so the branch costs nothing until then.
   */
  const filterPass = new Signal.Computed<FilterPass | null>(() => {
    const query = queryState.get().trim();
    if (query === '') return null;

    const keep = new Set<string>();
    const reveal = new Set<string>();
    const matched = new Set<string>();
    const trail: TreeNode<T>[] = [];

    const walk = (list: readonly TreeNode<T>[], inside: boolean): void => {
      for (const node of list) {
        const hit = matches(node, query);
        if (hit) {
          keep.add(node.id);
          matched.add(node.id);
          for (const ancestor of trail) {
            keep.add(ancestor.id);
            reveal.add(ancestor.id);
          }
        } else if (inside) {
          keep.add(node.id);
        }

        const children = childrenOf(node);
        if (!children) continue;
        trail.push(node);
        walk(children, inside || hit);
        trail.pop();
      }
    };

    walk(options.nodes(), false);
    return { keep, reveal, matched };
  });

  /** Whether a node is open, counting the filter's own reveals. */
  const shown = (id: string): boolean => {
    if (suppressed.get().has(id)) return false;
    if (expandedState.get().has(id)) return true;
    return filterPass.get()?.reveal.has(id) ?? false;
  };

  const model = new Signal.Computed<Model<T>>(() => {
    const pass = filterPass.get();
    const rows: TreeRow<T>[] = [];
    const byId = new Map<string, TreeRow<T>>();

    const walk = (list: readonly TreeNode<T>[], level: number, parentId: string | null): void => {
      const siblings = pass ? list.filter((node) => pass.keep.has(node.id)) : list;

      for (const [position, node] of siblings.entries()) {
        const expandable = isExpandable(node);
        const open = expandable && shown(node.id);

        const row: TreeRow<T> = {
          node,
          id: node.id,
          label: labelOf(node),
          level,
          posinset: position + 1,
          setsize: siblings.length,
          parentId,
          index: rows.length,
          expandable,
          expanded: open,
          disabled: node.disabled === true,
          matched: pass ? pass.matched.has(node.id) : false,
        };

        rows.push(row);
        byId.set(node.id, row);

        if (!open) continue;
        const children = childrenOf(node);
        if (children) walk(children, level + 1, node.id);
      }
    };

    walk(options.nodes(), 1, null);
    return { rows, byId };
  });

  const rows = (): readonly TreeRow<T>[] => model.get().rows;
  const rowOf = (id: string): TreeRow<T> | null => model.get().byId.get(id) ?? null;

  /** A node's children by id, whatever the visible model is doing. */
  const siblingIdsOf = (parentId: string | null, exclude: string): string[] => {
    const list =
      parentId === null
        ? options.nodes()
        : ((): readonly TreeNode<T>[] => {
            const parent = nodeById(parentId);
            return (parent ? childrenOf(parent) : undefined) ?? [];
          })();
    return list.map((node) => node.id).filter((id) => id !== exclude);
  };

  const isDescendant = (id: string, ancestorId: string): boolean => {
    const { parents } = structure.get();
    let walker = parents.get(id) ?? null;
    while (walker !== null) {
      if (walker === ancestorId) return true;
      walker = parents.get(walker) ?? null;
    }
    return false;
  };

  // ---------------------------------------------------------------------------
  // Expansion
  // ---------------------------------------------------------------------------

  const setExpanded = (next: ReadonlySet<string>): void => {
    expandedState.set(next);
    options.onExpandedChange?.(next);
  };

  const unsuppress = (id: string): void => {
    const off = untrack(() => suppressed.get());
    if (!off.has(id)) return;
    const next = new Set(off);
    next.delete(id);
    suppressed.set(next);
  };

  const expand = (id: string): void => {
    unsuppress(id);
    const current = untrack(() => expandedState.get());
    if (current.has(id)) return;
    const next = new Set(current);
    next.add(id);
    setExpanded(next);
  };

  const collapse = (id: string): void => {
    const current = untrack(() => expandedState.get());
    if (current.has(id)) {
      const next = new Set(current);
      next.delete(id);
      setExpanded(next);
    }

    // It may also be open because it is an ancestor of a match, and the user
    // has just said otherwise.
    const pass = untrack(() => filterPass.get());
    if (!pass?.reveal.has(id)) return;
    const off = untrack(() => suppressed.get());
    if (off.has(id)) return;
    const next = new Set(off);
    next.add(id);
    suppressed.set(next);
  };

  const isExpanded = (id: string): boolean => shown(id);

  const toggleExpanded = (id: string): void => {
    if (untrack(() => shown(id))) collapse(id);
    else expand(id);
  };

  const expandAll = (): void => {
    const next = untrack(() => {
      const open = new Set(expandedState.get());
      for (const node of structure.get().nodes.values()) {
        if (isExpandable(node)) open.add(node.id);
      }
      return open;
    });
    suppressed.set(new Set());
    setExpanded(next);
  };

  const collapseAll = (): void => {
    // Under a filter, closing everything has to close the reveals too, or the
    // tree springs straight back open.
    const pass = untrack(() => filterPass.get());
    suppressed.set(pass ? new Set(pass.reveal) : new Set());
    setExpanded(new Set());
  };

  const expandSiblings = (id: string): void => {
    const row = untrack(() => rowOf(id));
    if (!row) return;
    const next = new Set(untrack(() => expandedState.get()));
    const off = new Set(untrack(() => suppressed.get()));

    for (const sibling of untrack(rows)) {
      if (sibling.parentId !== row.parentId || !sibling.expandable) continue;
      next.add(sibling.id);
      off.delete(sibling.id);
    }

    suppressed.set(off);
    setExpanded(next);
  };

  // A new search is a fresh view: what was closed under the last one has
  // nothing to say about this one.
  effect(() => {
    queryState.get();
    untrack(() => {
      if (suppressed.get().size > 0) suppressed.set(new Set());
    });
  });

  // ---------------------------------------------------------------------------
  // Lazy children
  // ---------------------------------------------------------------------------

  /**
   * The nodes waiting for their children, oldest request first.
   *
   * A queue of one at a time: the head stays the head until its children land,
   * it fails, or it is collapsed — and only then does the source change, which
   * is what makes the requests sequential rather than simultaneous.
   *
   * Held as history in a signal rather than derived from the model, because
   * model order is not the order the nodes were opened. Deriving it meant that
   * opening a second folder which happened to sit *above* one already on the
   * wire took the head out from under it: the source changed, the resource
   * aborted a request that was nearly answered, and the folder the user opened
   * first was the last one to fill in.
   */
  const queueState = new Signal.State<readonly string[]>([]);

  if (options.loadChildren) {
    effect(() => {
      const loaded = loadedState.get();
      const failed = failedState.get();

      const waiting = new Set<string>();
      for (const row of rows()) {
        const node = row.node;
        if (!row.expanded || node.hasChildren !== true) continue;
        if (node.children !== undefined) continue;
        if (loaded.has(node.id) || failed.has(node.id)) continue;
        waiting.add(node.id);
      }

      untrack(() => {
        const current = queueState.get();
        // Answered, failed and collapsed nodes leave; newly opened ones join
        // the back. Nothing ever moves forward. Several opened in one flush
        // have no order between them, so they take the model's.
        const next = current.filter((id) => waiting.has(id));
        for (const id of waiting) if (!next.includes(id)) next.push(id);
        if (next.length === current.length && next.every((id, i) => id === current[i])) return;
        queueState.set(next);
      });
    });
  }

  // A signal read rather than a walk of the model, because `itemProps` asks
  // whether each rendered row is loading, and walking once per row is the one
  // O(n²) this must not have.
  const pendingId = (): string | null => queueState.get()[0] ?? null;

  const load = options.loadChildren;

  /** The id the request in flight is for, since `onError` is not told. */
  let requestedId: string | null = null;

  const children = load
    ? createResource<LoadedChildren<T>, string>(
        async ({ source, signal }) => {
          const node = untrack(() => nodeById(source));
          requestedId = source;
          // The node can only have gone while the request was being set up, in
          // which case an empty answer retires it without an error anyone can act on.
          if (!node) return { id: source, children: [] };
          return { id: source, children: await load(node, signal) };
        },
        {
          // The empty string is never fetched: `enabled` is what gates it, and
          // a nullable source would put a null check in the fetcher instead.
          source: () => pendingId() ?? '',
          enabled: () => pendingId() !== null,
          onSuccess: ({ id, children: list }) => {
            const next = new Map(untrack(() => loadedState.get()));
            next.set(id, list);
            loadedState.set(next);
          },
          onError: (error) => {
            const id = requestedId;
            if (id === null) return;
            const next = new Map(untrack(() => failedState.get()));
            next.set(id, error);
            failedState.set(next);
          },
        },
      )
    : null;

  const isLoading = (id: string): boolean =>
    children !== null && children.isLoading() && pendingId() === id;

  const loadError = (id: string): unknown => failedState.get().get(id);

  const reload = (id: string): void => {
    const loaded = new Map(untrack(() => loadedState.get()));
    const failed = new Map(untrack(() => failedState.get()));
    if (loaded.delete(id)) loadedState.set(loaded);
    if (failed.delete(id)) failedState.set(failed);
  };

  const nodeStatus = (id: string): string => {
    if (isLoading(id)) return labels.loading ?? locale.t('loading');
    if (loadError(id) !== undefined) return labels.error ?? 'Could not load';
    return '';
  };

  // ---------------------------------------------------------------------------
  // Selection
  // ---------------------------------------------------------------------------

  const setSelection = (next: ReadonlySet<string>): void => {
    selectedState.set(next);
    options.onSelectionChange?.(next);
  };

  /**
   * Nodes checked before their children existed.
   *
   * A cascade can only reach what is loaded, so a folder checked while it was
   * still closed has to finish the job when its children turn up. Remembered
   * here rather than re-derived, because "this parent is checked" and "the user
   * has since unchecked one of its children" look identical from the set alone
   * — and re-cascading the second one would undo the user's work.
   */
  const pendingCascade = new Set<string>();

  /**
   * The checked state of every node, in one post-order pass.
   *
   * Derived rather than stored, because a stored parent state disagrees with
   * its children the moment one of them changes. Computed for the whole tree at
   * once, because asking per node would walk each subtree once per rendered
   * row.
   */
  const checkedStates = new Signal.Computed<ReadonlyMap<string, CheckedState>>(() => {
    const states = new Map<string, CheckedState>();
    if (mode !== 'checkbox' || !cascade) return states;
    const set = selectedState.get();

    /** Its state, and whether the cascade can write anywhere inside it. */
    interface Aggregate {
      readonly state: CheckedState;
      readonly writable: boolean;
    }

    const visit = (node: TreeNode<T>): Aggregate => {
      const own = node.disabled !== true;
      const list = childrenOf(node);
      if (!list || list.length === 0) {
        const checked = set.has(node.id);
        states.set(node.id, checked);
        return { state: checked, writable: own };
      }

      let all = true;
      let none = true;
      let writable = false;
      for (const child of list) {
        const below = visit(child);
        writable ||= below.writable;
        if (below.state === 'indeterminate') {
          all = false;
          none = false;
        } else if (below.state) {
          none = false;
        } else {
          all = false;
        }
      }

      // A folder holding nothing the cascade may write is a leaf as far as
      // checking goes, and its own membership is the only state a press can
      // move it to. Aggregating descendants that refuse every press instead —
      // whichever way a consumer set them — gives it a state no press can
      // change, so its box stands still while the selection flips underneath
      // it and `selection()` and `isSelected()` come apart.
      const aggregate: CheckedState = all ? true : none ? false : 'indeterminate';
      const state = writable ? aggregate : set.has(node.id);
      states.set(node.id, state);
      return { state, writable: writable || own };
    };

    for (const node of options.nodes()) visit(node);
    return states;
  });

  const checkedState = (id: string): CheckedState => {
    if (mode !== 'checkbox') return selectedState.get().has(id);
    if (!cascade) return selectedState.get().has(id);
    return checkedStates.get().get(id) ?? false;
  };

  /**
   * Write a checked state onto a node and everything under it.
   *
   * One recursion, shared by the immediate cascade and the one that finishes
   * when lazy children arrive. Two of them is how the deferred half came to
   * disagree with this one: it added descendants without noticing that some of
   * them were themselves unloaded, so a check on a folder two lazy levels deep
   * silently evaporated as the second level landed.
   */
  const cascadeInto = (target: TreeNode<T>, checked: boolean, next: Set<string>): void => {
    // A disabled node's state is not the user's to change, in either
    // direction — the refusal `select`, `toggleSelected` and `selectAll` all
    // make. The cascade still passes through it, because a node is not
    // disabled by having a disabled parent.
    if (target.disabled !== true) {
      if (checked) next.add(target.id);
      else next.delete(target.id);
    }
    if (!cascade) return;

    const list = untrack(() => childrenOf(target));
    if (list) {
      for (const child of list) cascadeInto(child, checked, next);
      return;
    }
    // Children that have not arrived cannot be cascaded onto now, so the node
    // is remembered until they do.
    if (target.hasChildren === true && checked) pendingCascade.add(target.id);
    else pendingCascade.delete(target.id);
  };

  const setChecked = (id: string, checked: boolean): void => {
    const node = untrack(() => nodeById(id));
    if (!node) return;

    const next = new Set(untrack(() => selectedState.get()));
    cascadeInto(node, checked, next);
    setSelection(next);
  };

  /**
   * Which way a press on a node's checkbox goes.
   *
   * Not `checkedState(id) !== true`. A subtree holding a disabled node in the
   * other state can never report anything but `indeterminate`, because the
   * cascade will not touch that node — so that rule asks for the same check on
   * every press, and the control never turns off. What a press really asks is
   * whether there is anything here left for it to check.
   *
   * A box already reading `checked` is the exception, because a folder whose
   * children were checked one by one reads that way without its own id being
   * in the set: asking what is left to check finds the folder itself and
   * swallows a press that changes nothing anybody can see.
   */
  const wouldCheck = (id: string): boolean =>
    untrack(() => {
      const node = nodeById(id);
      if (!node) return false;
      if (checkedState(id) === true) return false;
      const set = selectedState.get();

      const unchecked = (target: TreeNode<T>): boolean => {
        if (target.disabled !== true && !set.has(target.id)) return true;
        if (!cascade) return false;
        return childrenOf(target)?.some(unchecked) ?? false;
      };

      return unchecked(node);
    });

  if (mode === 'checkbox' && cascade) {
    effect(() => {
      // The structure is the dependency: it changes exactly when children
      // arrive, which is the only thing this has to react to.
      const { nodes } = structure.get();
      if (pendingCascade.size === 0) return;

      untrack(() => {
        const next = new Set(selectedState.get());
        const before = next.size;

        // A copy, because cascading into a subtree whose own children are
        // still unloaded puts those nodes straight back into the set.
        for (const id of [...pendingCascade]) {
          const node = nodes.get(id);
          const list = node ? childrenOf(node) : undefined;
          if (!node || !list) continue;
          pendingCascade.delete(id);
          for (const child of list) cascadeInto(child, true, next);
        }

        // The deferred cascade only ever checks, so a set that did not grow
        // changed nothing — and publishing it would report a selection change
        // that never happened.
        if (next.size !== before) setSelection(next);
      });
    });
  }

  const isSelected = (id: string): boolean =>
    mode === 'checkbox' ? checkedState(id) === true : selectedState.get().has(id);

  const selectRange = (fromId: string | null, toId: string): ReadonlySet<string> => {
    const list = untrack(rows);
    const to = list.findIndex((row) => row.id === toId);
    const from = fromId === null ? to : list.findIndex((row) => row.id === fromId);
    if (to === -1) return untrack(() => selectedState.get());

    const start = Math.min(from === -1 ? to : from, to);
    const end = Math.max(from === -1 ? to : from, to);
    const next = new Set<string>();
    for (let i = start; i <= end; i++) {
      const row = list[i];
      if (row && !row.disabled) next.add(row.id);
    }
    return next;
  };

  const select = (id: string, selectOptions: TreeSelectOptions = {}): void => {
    if (mode === 'none') return;
    const row = untrack(() => rowOf(id));
    if (row?.disabled) return;

    if (mode === 'checkbox') {
      setChecked(id, wouldCheck(id));
      anchorId = id;
      return;
    }

    if (mode === 'single') {
      setSelection(new Set([id]));
      anchorId = id;
      return;
    }

    if (selectOptions.range) {
      setSelection(selectRange(anchorId, id));
      return;
    }

    const current = untrack(() => selectedState.get());
    if (selectOptions.additive) {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      setSelection(next);
    } else {
      setSelection(new Set([id]));
    }
    anchorId = id;
  };

  const toggleSelected = (id: string): void => {
    if (mode === 'none') return;
    const row = untrack(() => rowOf(id));
    if (row?.disabled) return;

    if (mode === 'checkbox') {
      setChecked(id, wouldCheck(id));
      anchorId = id;
      return;
    }

    // Single selection does not toggle off: Space on the chosen node is a
    // reader confirming where they are, not asking to have nothing chosen.
    if (mode === 'single') {
      setSelection(new Set([id]));
      anchorId = id;
      return;
    }

    select(id, { additive: true });
  };

  const selectAll = (): void => {
    if (mode === 'none' || mode === 'single') return;

    if (mode === 'checkbox') {
      // Everything, not merely what is on screen: a half-checked tree after
      // "select all" is not what anybody meant.
      const next = new Set<string>();
      for (const node of untrack(() => structure.get()).nodes.values()) {
        if (node.disabled !== true) next.add(node.id);
      }
      pendingCascade.clear();
      setSelection(next);
      return;
    }

    const next = new Set<string>();
    for (const row of untrack(rows)) if (!row.disabled) next.add(row.id);
    setSelection(next);
  };

  const clearSelection = (): void => {
    pendingCascade.clear();
    setSelection(new Set());
  };

  // ---------------------------------------------------------------------------
  // Focus
  // ---------------------------------------------------------------------------

  // Items in DOM order. Only the rendered ones are here, which is precisely why
  // movement is decided on the model and only resolved to an element at the end.
  const collection = createCollection(() => options.tree(), {
    attribute: TREE_ITEM_ATTRIBUTE,
    skipDisabled: false,
  });

  const idOf = (el: Element): string | null => el.getAttribute(TREE_ITEM_ATTRIBUTE);

  const elementOf = (id: string | null): HTMLElement | null => {
    if (id === null) return null;
    // By iteration rather than an attribute selector: the id comes from the
    // consumer's data and would need escaping, and escaping it means `CSS`, a
    // browser global that does not exist when rendering on a server.
    return collection.all().find((el) => idOf(el) === id) ?? null;
  };

  const roving = createRovingFocus(
    collection,
    () => elementOf(activeState.get()),
    (el) => activeState.set(el ? idOf(el) : null),
    {
      // Movement, Home, End and typeahead are all handled here instead: each of
      // them has to reach a row that virtualization has not rendered, and this
      // collection only knows about the ones that are in the DOM.
      typeahead: false,
    },
  );

  /** Whether DOM focus is inside the tree at this moment. */
  const holdsFocus = (): boolean => {
    const root = options.tree();
    if (!root) return false;
    const active = root.ownerDocument.activeElement;
    return active !== null && root.contains(active);
  };

  /** Whether something outside the tree holds focus, as opposed to nobody. */
  const focusTakenElsewhere = (): boolean => {
    const root = options.tree();
    if (!root) return false;
    const doc = root.ownerDocument;
    const active = doc.activeElement;
    // `<body>` is where a browser leaves focus when the focused element is
    // removed: nobody holding it rather than somebody else holding it.
    if (active === null || active === doc.body) return false;
    return !root.contains(active);
  };

  /**
   * The row element focus was last put on, kept once it has left the document.
   *
   * After the fact `document.activeElement` cannot tell a row that was removed
   * from under the reader from focus that was never in the tree at all: the
   * browser answers `<body>` to both. This element can — it is disconnected in
   * the first case and connected in the second — and it is the only evidence
   * of the removal that survives it.
   */
  let focusedEl: HTMLElement | null = null;

  const takeFocus = (el: HTMLElement): void => {
    focusedEl = el;
    roving.focus(el);
  };

  /** Whether focus went to `<body>` because the row holding it was removed. */
  const lostFocusWithRow = (): boolean =>
    focusedEl !== null && !focusedEl.isConnected && !focusTakenElsewhere();

  /**
   * Put focus on the tree itself, for when no row is left to hold it.
   *
   * An empty tree is its own tab stop, so it is somewhere the reader can stay
   * and keep arrowing — where `<body>` is the top of the document and no way
   * back to what they were reading.
   */
  const focusTree = (): void => {
    const root = options.tree();
    if (!(root instanceof HTMLElement)) return;
    // The stop `treeProps` gives an empty tree is applied by a render that has
    // not happened yet, and `focus()` on an element that cannot hold it does
    // nothing at all. That render overwrites this attribute a moment later.
    if (!root.hasAttribute('tabindex')) root.setAttribute('tabindex', '-1');
    root.focus();
    // Focus is on no row now, so there is no removal left to read off one.
    focusedEl = null;
  };

  /**
   * A row that was asked for before it was rendered, and is still wanted.
   *
   * The id rather than a flag, so the request expires: it is honoured only
   * while it is still the active row and nothing outside the tree has taken
   * focus in the meantime. A bare flag survived until the next render of any
   * kind, whenever that happened, and pulled focus out of whatever the reader
   * had moved on to. Expiring it after one flush instead would be simpler and
   * wrong — a scroll that has not landed yet is precisely what this is for.
   */
  let pendingFocusId: string | null = null;

  const activeIndex = (): number => {
    const id = activeState.get();
    if (id === null) return -1;
    return rowOf(id)?.index ?? -1;
  };

  const focusRow = (row: TreeRow<T> | null): void => {
    if (!row) return;
    activeState.set(row.id);
    // Scrolled first: the element cannot be focused before it is rendered, and
    // it is not rendered until the window moves.
    virtualizer?.scrollToIndex(row.index);

    const el = elementOf(row.id);
    if (el) {
      pendingFocusId = null;
      takeFocus(el);
      return;
    }
    pendingFocusId = row.id;
  };

  const activeRow = (): TreeRow<T> | null => {
    const id = activeState.get();
    return id === null ? null : rowOf(id);
  };

  /**
   * The one node in the tab order, or null when no node can hold it.
   *
   * Taken from the rows that are actually rendered rather than from the whole
   * model: the active row of a windowed tree may have been scrolled out of the
   * DOM, and naming it leaves the tab order pointing at an element that does
   * not exist — a tree a keyboard user tabs straight past with no way back
   * into. The first row on screen takes the stop instead, which is where a
   * reader tabbing in expects to land anyway.
   *
   * Not resolved through `createRovingFocus`, which reads the DOM: on the
   * first render no element exists yet, and the group would have no tab stop.
   */
  const tabStop = new Signal.Computed<string | null>(() => {
    const list = rendered();
    if (list.length === 0) return null;
    const active = activeState.get();
    if (active !== null && list.some((row) => row.id === active)) return active;
    return list[0]?.id ?? null;
  });

  const tabStopId = (): string | null => tabStop.get();

  /**
   * Keep the active node in the model when the tree closes underneath it.
   *
   * `activeId()` naming a node the model no longer holds leaves the tab stop
   * on a row that is not there, and the browser has meanwhile dropped focus on
   * `<body>` — the reader returned to the top of the page with no way back to
   * where they were.
   *
   * The nearest ancestor still in the model is where the branch went, so that
   * is where the tab stop and, when the tree had focus, focus follow it to. A
   * filter takes the ancestors as well, and then the first surviving row is
   * where a reader tabbing in would land anyway.
   */
  const keepActiveInModel = (): void => {
    const id = activeState.get();
    if (id === null) return;
    const { rows: list, byId } = model.get();
    if (byId.has(id)) return;

    const { parents } = structure.get();
    let ancestorId = parents.get(id) ?? null;
    while (ancestorId !== null && !byId.has(ancestorId)) {
      ancestorId = parents.get(ancestorId) ?? null;
    }

    const row = (ancestorId === null ? undefined : byId.get(ancestorId)) ?? list[0];
    if (!row) {
      // Nothing survived at all — the search box's "no results". Naming no
      // node is the honest answer; naming a gone one is what this is here for.
      // The reader is still owed somewhere to be, though: the row under them
      // is going, and the browser answers that with `<body>`.
      activeState.set(null);
      if (holdsFocus() || lostFocusWithRow()) focusTree();
      return;
    }

    // A router closing a branch while the reader is typing in a search box
    // must move the tab stop and nothing else. Taking focus off what they are
    // using would be a worse bug than the one this fixes.
    if (!holdsFocus() && !lostFocusWithRow()) {
      activeState.set(row.id);
      return;
    }
    focusRow(row);
  };

  // The model is the dependency, rather than the calls that happen to close a
  // branch: the active row leaves by every route the model has — the signal a
  // router owns, a filter, the consumer's own nodes changing — and those are
  // exactly the routes no call site could cover.
  effect(() => {
    model.get();
    untrack(keepActiveInModel);
  });

  // ---------------------------------------------------------------------------
  // Typeahead
  // ---------------------------------------------------------------------------

  let search = '';
  let searchTimer: ReturnType<typeof setTimeout> | null = null;

  onCleanup(() => {
    if (searchTimer !== null) clearTimeout(searchTimer);
  });

  const typeahead = (character: string): TreeRow<T> | null => {
    search += character;
    if (searchTimer !== null) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      search = '';
      searchTimer = null;
    }, typeaheadTimeout);

    // Repeating one character walks through the nodes starting with it, rather
    // than searching for "aaa" — the behaviour every native list has.
    const repeated = search.length > 1 && [...search].every((c) => c === search.charAt(0));
    const needle = fold(repeated ? search.charAt(0) : search);

    const list = untrack(rows);
    if (list.length === 0) return null;
    const from = untrack(activeIndex);

    // Start just after the current row and wrap all the way round, so the
    // current one is considered last rather than not at all.
    for (let i = 1; i <= list.length; i++) {
      const row = list[(from + i + list.length) % list.length];
      if (row && fold(row.label).startsWith(needle)) return row;
    }
    return null;
  };

  // ---------------------------------------------------------------------------
  // Virtualization
  // ---------------------------------------------------------------------------

  const virtualizer = options.virtual
    ? createVirtualizer({
        scroller: options.virtual.scroller,
        container: options.virtual.container,
        count: () => rows().length,
        itemSize: options.virtual.itemSize,
        measure: options.virtual.measure,
        gap: options.virtual.gap,
        overscan: options.virtual.overscan,
        // The tree counts its own positions. A treeitem's set is its siblings,
        // and the virtualizer has no idea where one level stops.
        counting: 'none',
        getItemKey: (index) => untrack(rows)[index]?.id ?? index,
      })
    : null;

  function rendered(): readonly TreeRow<T>[] {
    const list = rows();
    if (!virtualizer) return list;

    const window: TreeRow<T>[] = [];
    for (const item of virtualizer.items()) {
      const row = list[item.index];
      if (row) window.push(row);
    }
    return window;
  }

  // Focus follows the window: a row that was scrolled to is focused once it
  // has actually been rendered, which is a frame later than it was asked for.
  effect(() => {
    rendered();
    const id = pendingFocusId;
    if (id === null) return;

    // The reader moved on while the row was on its way. Taking focus back now
    // would be a steal, not a delivery.
    if (focusTakenElsewhere() || untrack(() => activeState.get()) !== id) {
      pendingFocusId = null;
      return;
    }

    const el = elementOf(id);
    if (!el) return;
    pendingFocusId = null;
    takeFocus(el);
  });

  // ---------------------------------------------------------------------------
  // Dragging
  // ---------------------------------------------------------------------------

  /**
   * A flat drop position, in terms of parents and child indices.
   *
   * The drag primitive's own index counts the flat list, which is an index into
   * nothing the consumer has: rows at four different levels sit between two
   * siblings. So the target is re-resolved here, against the hierarchy.
   */
  const resolveDrop = (sourceId: string, target: DropTarget): TreeDrop => {
    const targetRow = target.itemId === null ? null : rowOf(target.itemId);

    if (!targetRow) {
      return {
        sourceId,
        targetId: null,
        position: target.position,
        parentId: null,
        index: siblingIdsOf(null, sourceId).length,
      };
    }

    if (target.position === 'on') {
      return {
        sourceId,
        targetId: targetRow.id,
        position: 'on',
        parentId: targetRow.id,
        index: siblingIdsOf(targetRow.id, sourceId).length,
      };
    }

    // The row under an open folder is its first child, so an insertion line
    // there means the top of the folder — not below everything it contains,
    // which is what treating it as a sibling would silently do.
    if (target.position === 'after' && targetRow.expanded) {
      return {
        sourceId,
        targetId: targetRow.id,
        position: 'after',
        parentId: targetRow.id,
        index: 0,
      };
    }

    const siblings = siblingIdsOf(targetRow.parentId, sourceId);
    const at = siblings.indexOf(targetRow.id);
    const index =
      at === -1 ? siblings.length : target.position === 'after' ? at + 1 : at;

    return {
      sourceId,
      targetId: targetRow.id,
      position: target.position,
      parentId: targetRow.parentId,
      index,
    };
  };

  const onDrop = options.onDrop;

  const drag = onDrop
    ? createDragDrop({
        root: () => options.tree(),
        target: dropSignal,
        labels: labels.drag,
        canDrop: (target, source) => {
          if (target.itemId === null) return true;
          // Dropping a node into its own subtree is the classic way to lose it.
          if (target.itemId === source.itemId) return false;
          return !isDescendant(target.itemId, source.itemId);
        },
        onDrop: ({ source, target, mode: dragMode }) => {
          onDrop(resolveDrop(source.itemId, target), dragMode);
        },
      })
    : null;

  if (drag) {
    effect(() => {
      const target = dropSignal.get();
      if (!target || target.position !== 'on' || target.itemId === null) return;

      const id = target.itemId;
      const row = untrack(() => rowOf(id));
      if (!row || !row.expandable || row.expanded) return;

      // Hovering a closed folder opens it, so a node can be carried into a
      // branch that was not on screen when the drag began. The delay is what
      // keeps merely passing over a folder from opening it.
      const timer = setTimeout(() => expand(id), autoExpandDelay);
      onCleanup(() => clearTimeout(timer));
    });
  }

  const dropTarget = (): TreeDrop | null => {
    const source = drag?.source();
    const target = dropSignal.get();
    if (!source || !target) return null;
    return resolveDrop(source.itemId, target);
  };

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------

  const itemFrom = (target: EventTarget | null): HTMLElement | null =>
    target instanceof Element ? target.closest<HTMLElement>(`[${TREE_ITEM_ATTRIBUTE}]`) : null;

  const rowFrom = (target: EventTarget | null): TreeRow<T> | null => {
    const el = itemFrom(target);
    const id = el ? idOf(el) : null;
    return id === null ? null : rowOf(id);
  };

  const isMulti = mode === 'multiple' || mode === 'checkbox';

  /** Move, and in a multi-select tree take the selection with it. */
  const moveBy = (delta: number, extend: boolean): void => {
    const list = untrack(rows);
    if (list.length === 0) return;
    const from = untrack(activeIndex);
    const to = Math.min(Math.max((from === -1 ? (delta > 0 ? -1 : list.length) : from) + delta, 0), list.length - 1);
    const row = list[to];
    if (!row) return;

    focusRow(row);
    // The practice's wording is "moves focus to and toggles the selection state
    // of" the next node, so this toggles rather than only adding.
    if (extend && isMulti) toggleSelected(row.id);
  };

  const moveToEdge = (last: boolean, extend: boolean): void => {
    const list = untrack(rows);
    if (list.length === 0) return;
    const row = last ? list[list.length - 1] : list[0];
    if (!row) return;

    if (extend && isMulti && mode !== 'checkbox') {
      setSelection(selectRange(untrack(() => activeState.get()), row.id));
    }
    focusRow(row);
  };

  const onExpandKey = (row: TreeRow<T>): void => {
    if (row.expandable && !row.expanded) {
      expand(row.id);
      return;
    }
    if (!row.expanded) return;

    // Already open: the first child is the row straight after it, by
    // construction of the flat model — but only once there is one. A node
    // whose children are still being fetched is followed by its next sibling,
    // and moving there throws the reader out of the branch they just opened.
    const next = untrack(rows)[row.index + 1];
    if (next?.parentId === row.id) focusRow(next);
  };

  const onCollapseKey = (row: TreeRow<T>): void => {
    if (row.expanded) {
      collapse(row.id);
      return;
    }
    const parentId = row.parentId;
    if (parentId === null) return;
    focusRow(untrack(() => rowOf(parentId)));
  };

  const activate = (row: TreeRow<T>): void => {
    if (row.disabled) return;
    // Selecting as well as activating, because Enter on a single-select tree is
    // how a keyboard user says "this one" — and doing only one of the two makes
    // the pressed node and the chosen node disagree.
    if (mode === 'single' || mode === 'multiple') select(row.id);
    options.onActivate?.(row);
  };

  const lift = (id: string): boolean => drag?.lift(id) ?? false;

  // ---------------------------------------------------------------------------
  // Public surface
  // ---------------------------------------------------------------------------

  return {
    rows,
    rendered,
    rowOf,
    count: () => rows().length,

    activeId: () => activeState.get(),
    activeRow,
    focusNode: (id) => focusRow(untrack(() => rowOf(id))),

    expanded: () => expandedState.get(),
    isExpanded,
    expand,
    collapse,
    toggleExpanded,
    expandAll,
    collapseAll,
    expandSiblings,

    selection: () => selectedState.get(),
    isSelected,
    checkedState,
    select,
    toggleSelected,
    setChecked,
    selectAll,
    clearSelection,

    filter: () => queryState.get(),
    setFilter: (query) => queryState.set(query),

    isLoading,
    loadError,
    reload,
    nodeStatus,

    drag,
    virtualizer,
    dropTarget,
    indicator: () => drag?.indicator() ?? null,
    lift,

    onKeyDown(event) {
      const list = untrack(rows);
      if (list.length === 0) return;

      const current = untrack(activeRow) ?? list[0];
      if (!current) return;

      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'a') {
        if (!isMulti) return;
        selectAll();
        // Otherwise the browser selects every word on the page instead.
        event.preventDefault();
        return;
      }

      // The practice's own range chords. They have to be taken before the
      // guard below, which would otherwise throw away every combination that
      // is not Ctrl+A — and did, leaving the pattern's two documented chords
      // doing nothing at all.
      if (
        (event.ctrlKey || event.metaKey) &&
        event.shiftKey &&
        !event.altKey &&
        (event.key === 'Home' || event.key === 'End')
      ) {
        if (!isMulti) return;
        moveToEdge(event.key === 'End', true);
        event.preventDefault();
        return;
      }

      // Anything else with a modifier is a shortcut, not navigation. Shift is
      // not one of them: it is how the selection is extended, and how `*` is
      // typed on most keyboards.
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      // Physical arrows against writing direction. Only the horizontal pair
      // mirrors — a tree is not upside down in Arabic. Read from the DOM, which
      // is where a locale provider writes `dir`.
      const rtl = resolveDirection(options.tree()) === 'rtl';
      const expandKey = rtl ? 'ArrowLeft' : 'ArrowRight';
      const collapseKey = rtl ? 'ArrowRight' : 'ArrowLeft';

      switch (event.key) {
        case 'ArrowDown':
          moveBy(1, event.shiftKey);
          break;
        case 'ArrowUp':
          moveBy(-1, event.shiftKey);
          break;
        case expandKey:
          onExpandKey(current);
          break;
        case collapseKey:
          onCollapseKey(current);
          break;
        case 'Home':
          moveToEdge(false, event.shiftKey);
          break;
        case 'End':
          moveToEdge(true, event.shiftKey);
          break;
        case '*':
          expandSiblings(current.id);
          break;
        case 'Enter':
          activate(current);
          break;
        case ' ':
          if (mode === 'none') {
            // Nothing to select, so the key is free for the one other thing it
            // means in this pattern.
            if (drag?.onKeyDown(event)) return;
            break;
          }
          // Shift+Space selects from the most recently chosen node to this
          // one: the keyboard's only door to the range the pointer reaches
          // with a shift-click. A checkbox tree has no range to draw — every
          // node's state is a fact about its own subtree — so there it stays a
          // toggle.
          if (event.shiftKey && mode === 'multiple') select(current.id, { range: true });
          else toggleSelected(current.id);
          break;
        default: {
          if (options.typeahead === false) return;
          // Single printable characters only: anything longer is a named key.
          if (event.key.length !== 1) return;
          const match = typeahead(event.key);
          if (!match) return;
          focusRow(match);
          event.preventDefault();
          return;
        }
      }

      // Arrows and Home/End scroll the page, Space scrolls it too, and Enter
      // re-fires as a click on a focused button row — which would act twice.
      event.preventDefault();
    },

    onItemClick(event) {
      const row = rowFrom(event.target);
      if (!row || !(event.target instanceof Element)) return;

      // The twisty and the checkbox are inside the node, and mean something
      // narrower than pressing the node does.
      if (event.target.closest(`[${TREE_TOGGLE_ATTRIBUTE}]`)) {
        toggleExpanded(row.id);
        return;
      }
      if (event.target.closest(`[${TREE_CHECKBOX_ATTRIBUTE}]`)) {
        if (!row.disabled) setChecked(row.id, wouldCheck(row.id));
        return;
      }

      focusRow(row);
      if (row.disabled) return;

      switch (mode) {
        case 'none':
          // With nothing to choose, a press on a folder can only mean open it.
          if (row.expandable) toggleExpanded(row.id);
          return;
        case 'single':
          select(row.id);
          return;
        case 'multiple':
          select(row.id, {
            additive: event.ctrlKey || event.metaKey,
            range: event.shiftKey,
          });
          return;
        case 'checkbox':
          setChecked(row.id, wouldCheck(row.id));
          return;
        default:
          return;
      }
    },

    onPointerDown(event) {
      drag?.onPointerDown(event);
    },

    onFocusIn(event) {
      const el = itemFrom(event.target);
      if (el === null) return;
      const id = idOf(el);
      if (id === null) return;

      // Recorded even when the active node is already this one: what the
      // browser focused is the evidence a removal is read from later.
      focusedEl = el;
      if (untrack(() => activeState.get()) === id) return;
      activeState.set(id);
    },

    treeProps: () => ({
      ...(drag ? drag.containerProps({ id: containerId, label: labels.tree }) : {}),
      ...(virtualizer ? virtualizer.scrollerProps() : {}),
      role: 'tree',
      'aria-label': labels.tree,
      // Only where selection is what `aria-selected` reports. A checkbox tree
      // says what it means with `aria-checked`, and claiming both would
      // describe a selection model it does not have.
      'aria-multiselectable': mode === 'multiple' ? 'true' : undefined,
      'aria-busy': children?.isLoading() ? 'true' : undefined,
      // A tree with no rendered row has no roving tab stop, and would drop out
      // of the tab order altogether — the search box's "no results" case, and
      // a windowed tree whose scroller has not been measured yet.
      tabindex: tabStopId() === null ? '0' : undefined,
    }),

    // Both wrappers exist for geometry alone. A `tree` owns `treeitem`
    // children, and a plain div between the two breaks that relationship
    // wherever the accessibility tree is built from the DOM.
    sizerProps: () => ({
      ...(virtualizer ? virtualizer.sizerProps() : {}),
      role: 'none',
    }),

    contentProps: () => ({
      ...(virtualizer ? virtualizer.containerProps() : {}),
      role: 'none',
    }),

    itemProps(row) {
      const checked = mode === 'checkbox' ? checkedState(row.id) : false;
      const selected = mode === 'single' || mode === 'multiple' ? isSelected(row.id) : false;

      return {
        ...(drag
          ? drag.itemProps({
              id: row.id,
              label: row.label,
              disabled: row.disabled,
              dropsOn: row.node.dropsOn ?? row.expandable,
            })
          : {}),
        ...(virtualizer ? virtualizer.itemProps(row.index) : {}),

        [TREE_ITEM_ATTRIBUTE]: row.id,
        role: 'treeitem',
        'aria-level': String(row.level),
        'aria-setsize': String(row.setsize),
        'aria-posinset': String(row.posinset),
        // Only a node that can have children has a state to report. On a leaf
        // the attribute announces a closed branch that is never going to open.
        'aria-expanded': row.expandable ? String(row.expanded) : undefined,
        'aria-checked':
          mode === 'checkbox' ? (checked === 'indeterminate' ? 'mixed' : String(checked)) : undefined,
        // In a single-select tree only the chosen node says so. Marking the
        // other nine hundred `false` is nine hundred needless announcements of
        // a fact the reader can infer.
        'aria-selected':
          mode === 'multiple' ? String(selected) : mode === 'single' && selected ? 'true' : undefined,
        // `aria-disabled`, never the `disabled` attribute: the node stays in the
        // accessibility tree, so it can be found and heard to be unavailable
        // rather than appear to have vanished.
        'aria-disabled': row.disabled ? 'true' : undefined,
        'aria-busy': isLoading(row.id) ? 'true' : undefined,
        // What typeahead would match, so the same word is on the element as in
        // the model — useful to anyone reading the DOM, including a test.
        'data-label': row.label,
        'data-level': String(row.level),
        'data-state': row.expandable ? (row.expanded ? 'expanded' : 'collapsed') : undefined,
        'data-selected': selected || checked === true ? '' : undefined,
        'data-disabled': row.disabled ? '' : undefined,
        'data-match': row.matched ? '' : undefined,
        tabindex: row.id === tabStopId() ? '0' : '-1',
      };
    },

    // Hidden from assistive technology, because the node it sits in already
    // carries `aria-expanded`, and a second control saying the same thing is
    // one more thing to hear and one more tab stop to step over.
    toggleProps: () => ({
      [TREE_TOGGLE_ATTRIBUTE]: '',
      'aria-hidden': 'true',
    }),

    checkboxProps: (row) => {
      const state = checkedState(row.id);
      return {
        [TREE_CHECKBOX_ATTRIBUTE]: '',
        'aria-hidden': 'true',
        'data-state':
          state === 'indeterminate' ? 'indeterminate' : state ? 'checked' : 'unchecked',
      };
    },

    status() {
      if (children?.isLoading()) return labels.loading ?? locale.t('loading');
      if (rows().length === 0 && queryState.get().trim() !== '') {
        return labels.empty ?? locale.t('noResults');
      }
      return '';
    },

    /**
     * A live region is offered rather than assumed, and nothing renders it for
     * you. Worth carrying where the tree is filtered as the user types, and
     * noise on a tree that only ever changes when it is pressed.
     */
    statusProps: () => ({ role: 'status' }),
  };
}
