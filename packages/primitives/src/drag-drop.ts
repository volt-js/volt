/**
 * Drag and drop — sorting within a collection, transfer between connected
 * collections, and a keyboard drag that is not an afterthought.
 *
 * This is headless: it owns the gesture, the drop target, the keyboard map and
 * the announcements, and returns prop objects to spread onto whatever markup
 * the consumer writes. Nothing here renders, nothing here moves an element, and
 * nothing here has an opinion about styling. `onDrop` reports where the item
 * landed; reordering the model is the consumer's business, because only they
 * know what their list is made of.
 *
 *   class Playlist {
 *     root = new Signal.State<Element | null>(null);
 *     tracks = new Signal.State(['Kite', 'Grace', 'Numb']);
 *     dnd = createDragDrop({
 *       root: () => this.root.get(),
 *       onDrop: ({ source, target }) => this.move(source.itemId, target.index),
 *     });
 *   }
 *
 *   <div :ref="root"
 *        :pointerdown="dnd.onPointerDown($event)"
 *        :keydown="dnd.onKeyDown($event)">
 *     <ul :spread="dnd.containerProps({ id: 'tracks' })">
 *       <li :for="track in tracks.get()" :key="track" tabindex="0"
 *           :spread="dnd.itemProps({ id: track })"
 *           :style="{ transform: dnd.transformFor(track) }">{ track }</li>
 *     </ul>
 *     <div class="sr-only" :spread="dnd.liveRegionProps()">{ dnd.announcement() }</div>
 *     <div class="sr-only" :spread="dnd.instructionsProps()">{ dnd.instructions() }</div>
 *   </div>
 *
 * Both of those last two are for screen readers alone, and both must be hidden
 * the visual way — clipped, not `hidden` and not `display: none`, which would
 * take the announcement out of the accessibility tree along with the pixels.
 *
 * Four decisions carry the rest:
 *
 *   - **Pointer Events, not the HTML5 drag-and-drop API.** The native API
 *     cannot be styled, cannot be driven from the keyboard, and on touch does
 *     not exist at all. Pointer Events cost a hit test we have to write
 *     ourselves, and buy every input device behaving the same way.
 *   - **The keyboard is a mode, not a shortcut.** Space lifts, the arrows move,
 *     Space drops, Escape cancels, and every step is announced through a live
 *     region. This is the reason this is a primitive: a component that grows
 *     pointer dragging first never gets the keyboard afterwards.
 *   - **Hit testing is geometry, not `elementFromPoint`.** Under the pointer is
 *     usually the thing being dragged, or a preview following it, so asking the
 *     document what is there returns the drag itself. Rects of the registered
 *     items are asked instead, which also lets a drop be resolved to
 *     before/after/on rather than merely to an element.
 *   - **Positions count every item, disabled ones included.** An index that
 *     skipped unavailable rows would not be an index into the consumer's array,
 *     and translating between the two is exactly the bug this avoids.
 *
 * The keyboard map, which is the WAI-ARIA drag-and-drop practice:
 *
 *   idle       Space                  lift the focused item
 *   dragging   ArrowUp / ArrowDown    (vertical) previous / next drop position
 *              ArrowLeft / ArrowRight (vertical) previous / next collection
 *              ArrowLeft / ArrowRight (horizontal) previous / next position
 *              ArrowUp / ArrowDown    (horizontal) previous / next collection
 *              Home / End             first / last position in the collection
 *              Space, Enter           drop
 *              Escape                 cancel, and put the item back
 *              Tab                    ignored — a drag is finished, not left
 *
 * Horizontal arrows are resolved against writing direction, so they swap under
 * `dir="rtl"`; vertical order is never mirrored.
 *
 * While a drag is live the keys are taken on `window` in the capture phase.
 * That is deliberate: dismissal listens on `document`, also capturing, so
 * without this an Escape meant to cancel a drag inside a dialog would close the
 * dialog instead and leave the drag running under it.
 *
 * What this deliberately does not cover is files dragged in from outside the
 * page. Those arrive only through the native drag-and-drop API — no pointer
 * ever enters the document — so a file drop zone is a different mechanism
 * wearing the same word: `dragover` with `preventDefault`, a `dataTransfer`,
 * and an `<input type="file">` beside it, because a drop zone on its own cannot
 * be used from a keyboard at all. Sorting the files afterwards is this.
 *
 * One thing the consumer must supply in CSS: `touch-action` on the handle.
 * `touch-action: none` makes a touch drag start immediately but takes away
 * scrolling by that finger; leaving it to the default keeps scrolling and
 * relies on `touchDelay` to tell a press-and-hold from a swipe. Neither is
 * right for every list, which is why this cannot be decided here.
 */

import { Signal, effect, onCleanup } from '@voltdev/core';
import { createCollection } from './collection.js';
import { createId } from './id.js';
import { useLocale, type MessageValues } from './i18n.js';

const { untrack } = Signal.subtle;

/** Marks a collection. Its value is the collection's id. */
export const DRAG_CONTAINER_ATTRIBUTE = 'data-volt-drag-container';
/** Marks a draggable item. Its value is the item's id. */
export const DRAG_ITEM_ATTRIBUTE = 'data-volt-drag-item';
/** Marks the part of an item that starts a drag. */
export const DRAG_HANDLE_ATTRIBUTE = 'data-volt-drag-handle';

const LABEL_ATTRIBUTE = 'data-volt-drag-label';
const ON_ATTRIBUTE = 'data-volt-drag-on';
const NO_DRAG_ATTRIBUTE = 'data-volt-drag-disabled';
const NO_DROP_ATTRIBUTE = 'data-volt-drop-disabled';

/** How a drag is being driven. */
export type DragMode = 'pointer' | 'keyboard';

/** Which way the collection runs, and so what before and after mean. */
export type DragOrientation = 'vertical' | 'horizontal';

/** Which way the dragged element is allowed to move. */
export type DragAxis = 'x' | 'y' | 'both';

/**
 * Where a drop lands relative to an item: between two of them, or onto one.
 * `on` is what re-parents a tree node; `before` and `after` are what an
 * insertion line means.
 */
export type DropPosition = 'before' | 'after' | 'on';

/** How a drag finished. */
export type DragEndReason = 'drop' | 'cancel';

/** Where focus goes once a drag is over. */
export type DragFocusTarget = 'item' | 'container' | 'none';

export interface DragPoint {
  readonly x: number;
  readonly y: number;
}

export interface DragSource {
  /** The id given to `itemProps`. */
  readonly itemId: string;
  /** The collection it was picked up from. */
  readonly containerId: string;
  /**
   * Its index there when the drag started, among the collection's items in
   * the DOM, displayed or not. That is an index into the consumer's array only
   * while every item is rendered: in a windowed list it counts the window.
   * `itemId` is what to resolve a move from there.
   */
  readonly index: number;
  /** What a screen reader calls it. */
  readonly label: string;
  /** The element itself. It may be gone by the time a drop is applied. */
  readonly element: HTMLElement;
}

export interface DropTarget {
  readonly containerId: string;
  /** The item the position is relative to; null when the collection is empty. */
  readonly itemId: string | null;
  readonly position: DropPosition;
  /**
   * The index the dragged item will occupy once the move is done — the source
   * already taken out. That makes `splice(from, 1)` then `splice(index, 0, …)`
   * correct with no adjustment, which is the off-by-one every sortable list
   * gets wrong. It is -1 for an `on` drop, which has no index: nothing was
   * inserted between two items.
   *
   * Counted as `DragSource.index` is, over the collection's items in the DOM,
   * so the same caveat holds: in a windowed list it is an index into the
   * window, and a move is resolved from `itemId` and `position` instead.
   */
  readonly index: number;
}

/** A drop target with the geometry to draw it, in viewport coordinates. */
export interface DropIndicator extends DropTarget {
  readonly x: number;
  readonly y: number;
  /** Zero along the collection's axis for an insertion line. */
  readonly width: number;
  readonly height: number;
}

export interface DropEvent {
  readonly source: DragSource;
  readonly target: DropTarget;
  readonly mode: DragMode;
}

/** Everything the announcement strings are given. */
export interface DragAnnouncement {
  readonly source: DragSource;
  readonly target: DropTarget | null;
  /** The dragged item's label. */
  readonly itemLabel: string;
  /** The label of the item the target is relative to, if there is one. */
  readonly targetLabel: string | null;
  /** The destination collection's label. */
  readonly containerLabel: string;
  /** 1-based place the item will take, or 0 for an `on` drop. */
  readonly position: number;
  /** How many items the destination will hold, the dragged one included. */
  readonly total: number;
}

/**
 * Every string this puts in front of a user.
 *
 * All of them are overridable because the library is localised later, and a
 * hard-coded English sentence is not something a consumer can work around.
 *
 * One left out is looked for in the locale's message catalogue, under the key
 * named beside it, before the English is used — so an application that
 * translates its catalogue translates the drag along with everything else. A
 * sentence in the catalogue is a template over `{item}`, `{target}`,
 * `{container}`, `{position}` and `{total}`.
 */
export interface DragDropLabels {
  /**
   * `aria-roledescription` for an item. Catalogue key `draggable`, default
   * `draggable`; '' leaves it off.
   */
  item?: string;
  /**
   * `aria-roledescription` for a handle. Catalogue key `dragHandle`, default
   * `drag handle`; '' leaves it off.
   */
  handle?: string;
  /**
   * What `instructions()` returns, for the element `instructionsProps` names.
   * Catalogue key `dragInstructions`.
   */
  instructions?: string;

  /** Catalogue key `dragLifted`. */
  lifted?: (drag: DragAnnouncement) => string;
  /**
   * Announced whenever the drop target changes. Catalogue key `dragMoved`, or
   * `dragMovedOn` when the target is an item rather than a gap.
   */
  moved?: (drag: DragAnnouncement) => string;
  /**
   * Announced when the pointer or the arrows reach somewhere nothing can go.
   * Catalogue key `dragInvalid`.
   */
  invalid?: (drag: DragAnnouncement) => string;
  /** Catalogue key `dragDropped`, or `dragDroppedOn` for a drop onto an item. */
  dropped?: (drag: DragAnnouncement) => string;
  /** Catalogue key `dragCancelled`. */
  cancelled?: (drag: DragAnnouncement) => string;
}

export interface DragContainerOptions {
  /** Addresses this collection in a `DropTarget`. Must be unique. */
  id: string;
  /** What a screen reader calls it. Falls back to `aria-label`, then the id. */
  label?: string;
  /** Items may be dragged out but nothing may be dropped in. */
  dropDisabled?: boolean;
}

export interface DragItemOptions {
  /** Addresses this item. Must be unique across all connected collections. */
  id: string;
  /** What a screen reader calls it. Falls back to the item's text. */
  label?: string;
  /** This item cannot be picked up. It is still a place others can be put. */
  disabled?: boolean;
  /**
   * A drop can land *on* this item rather than only between items — a tree
   * node that can take children, or a folder in a list.
   */
  dropsOn?: boolean;
}

export interface DragHandleOptions {
  /** What a screen reader calls the handle, if it has no text of its own. */
  label?: string;
}

export interface DragDropOptions {
  /**
   * The element containing every connected collection. Scanning from here
   * rather than from the document is what keeps two unrelated lists on the
   * same page from accepting each other's items.
   */
  root: () => Element | null | undefined;

  /**
   * Supply a signal to drive the drop target from outside — a tree that
   * redirects a drop onto a folder it has just auto-expanded, say. Without one
   * this owns it.
   *
   * The tradeoff: a target set from outside moves the indicator and decides the
   * drop, but is not announced, because only the caller knows whether the
   * change is worth interrupting a screen reader for.
   */
  target?: Signal.State<DropTarget | null>;

  /** Which way the collections run. Default vertical. */
  orientation?: DragOrientation;
  /** Constrains `offset()` to one axis. Default both. */
  axis?: DragAxis;
  /** Keeps `offset()` inside this element's box. */
  boundary?: () => Element | null | undefined;

  /** Pointer travel, in px, before a mouse or pen press becomes a drag. Default 4. */
  activationDistance?: number;
  /**
   * How long a touch must be held before it becomes a drag, in ms. Default 250.
   * Without a delay every attempt to scroll a list drags a row out of it.
   */
  touchDelay?: number;
  /** How far a touch may drift during that delay before it counts as a scroll. Default 5px. */
  touchTolerance?: number;

  /** Scroll the nearest scrollable ancestor near its edges. Default true. */
  autoScroll?: boolean;
  /** How close to an edge, in px, before scrolling starts. Default 48. */
  autoScrollThreshold?: number;
  /** Fastest scroll, in px per frame, right at the edge. Default 12. */
  autoScrollSpeed?: number;

  /**
   * The share of an item's length at each end that means before or after
   * rather than on, for items that accept an `on` drop. Default 0.25, so the
   * middle half of the item re-parents.
   */
  onZoneRatio?: number;

  /**
   * Where focus goes when a drag ends. Default the dragged item, found again
   * by id after the consumer's re-render, because the element it started on
   * may not have survived the move.
   *
   * Only applied when the drag began from the keyboard, or when focus was
   * inside the item when a pointer picked it up — moving focus after a mouse
   * drag would take it away from wherever the user actually is.
   */
  restoreFocus?: DragFocusTarget;

  labels?: DragDropLabels;

  /** Refuse to start a drag. `data-disabled` on the item does the same thing. */
  canDrag?: (source: DragSource, mode: DragMode) => boolean;
  /** Refuse a drop. Rejected targets are skipped by the arrows, not just ignored. */
  canDrop?: (target: DropTarget, source: DragSource) => boolean;

  onDragStart?: (source: DragSource, mode: DragMode) => void;
  /** The target changed. Null means there is currently nowhere to drop. */
  onDragOver?: (target: DropTarget | null, source: DragSource) => void;
  onDrop?: (event: DropEvent) => void;
  /** Always runs, after `onDrop` when there was one. */
  onDragEnd?: (reason: DragEndReason, source: DragSource) => void;
}

export interface DragDropProps {
  readonly [key: string]: string | boolean | undefined;
}

export interface DragDrop {
  isDragging(): boolean;
  /** How the live drag is being driven, or null. */
  mode(): DragMode | null;
  source(): DragSource | null;
  /** Where the drop would land right now, or null if nowhere can take it. */
  target(): DropTarget | null;
  /** Pointer travel since the drag began, after the axis lock and boundary. */
  offset(): DragPoint;
  /**
   * `translate()` for the item with this id, or undefined for every other item
   * — so it can be spread straight into `:style` without a conditional.
   */
  transformFor(itemId: string): string | undefined;
  /** Where to draw the insertion line or the highlight. */
  indicator(): DropIndicator | null;
  /** The current live-region message. */
  announcement(): string;
  /** The text for the element `instructionsProps` names. */
  instructions(): string;

  /** Start a keyboard drag. False when the item cannot be picked up. */
  lift(item: HTMLElement | string | null): boolean;
  /** Finish at the current target. False when there was nowhere to drop. */
  drop(): boolean;
  /** Abandon the drag and put the item back. */
  cancel(): void;

  /** Wire once, on an ancestor of every collection. */
  onPointerDown(event: PointerEvent): void;
  /** Wire alongside it. Returns true when the key was consumed. */
  onKeyDown(event: KeyboardEvent): boolean;

  containerProps(options: DragContainerOptions): DragDropProps;
  itemProps(options: DragItemOptions): DragDropProps;
  handleProps(options?: DragHandleOptions): DragDropProps;
  liveRegionProps(): DragDropProps;
  /**
   * The element every item's `aria-describedby` points at. The one getter here
   * that is more than a read: applying it is how instructions rendered behind
   * an `:if` are noticed, and tearing that render down is how they are noticed
   * gone. So spread it from the element's own render — merging a class onto it
   * is fine — rather than calling it once and keeping the result.
   */
  instructionsProps(): DragDropProps;
}

const ORIGIN: DragPoint = { x: 0, y: 0 };

/** A press that has not yet earned the right to be a drag. */
interface Pending {
  pointerId: number;
  touch: boolean;
  item: HTMLElement;
  grip: HTMLElement;
  origin: DragPoint;
  timer: ReturnType<typeof setTimeout> | null;
}

/** A live drag. */
interface Session {
  mode: DragMode;
  source: DragSource;
  pointerId: number | null;
  grip: HTMLElement | null;
  origin: DragPoint;
  /** The item's box when the drag began, for the boundary clamp. */
  sourceRect: DOMRect;
  point: DragPoint;
  frame: number | null;
  restoreSelection: (() => void) | null;
  /** Whether focus was ours to move when the drag started. */
  ownedFocus: boolean;
}

export function createDragDrop(options: DragDropOptions): DragDrop {
  const orientation = options.orientation ?? 'vertical';
  const axis = options.axis ?? 'both';
  const onZoneRatio = options.onZoneRatio ?? 0.25;
  const activationDistance = options.activationDistance ?? 4;
  const touchDelay = options.touchDelay ?? 250;
  const touchTolerance = options.touchTolerance ?? 5;
  const autoScroll = options.autoScroll !== false;
  const autoScrollThreshold = options.autoScrollThreshold ?? 48;
  const autoScrollSpeed = options.autoScrollSpeed ?? 12;
  const restoreFocus = options.restoreFocus ?? 'item';
  const labels = options.labels ?? {};
  const locale = useLocale();

  /**
   * A default string: the locale's catalogue first, then English. Read when it
   * is said rather than once here, so a catalogue that is swapped later is
   * heard from then on.
   */
  const said = (key: string, fallback: string, values?: MessageValues): string =>
    locale.has(key) ? locale.t(key, values) : fallback;

  const instructionsId = createId('drag-instructions');

  const targetSignal = options.target ?? new Signal.State<DropTarget | null>(null);
  const sourceSignal = new Signal.State<DragSource | null>(null);
  const modeSignal = new Signal.State<DragMode | null>(null);
  const offsetSignal = new Signal.State<DragPoint>(ORIGIN);
  const message = new Signal.State('');

  /**
   * Whether the instructions element was actually rendered. Read from the DOM
   * rather than declared, so the consumer cannot forget to render it and leave
   * every item pointing `aria-describedby` at nothing.
   */
  const hasInstructions = new Signal.State(false);

  /**
   * Counts `instructionsProps()` being applied and taken down again, which is
   * the instructions element being rendered and going. It is what tells the
   * check above to look again: an element behind an `:if` arrives long after
   * the root does, and nothing else here would notice it come or go.
   */
  const instructionRenders = new Signal.State(0);

  let pending: Pending | null = null;
  let session: Session | null = null;

  // Items in DOM order, which is the only place their order is actually true.
  // Disabled ones are kept: see the note on positions in the header.
  const collection = createCollection(() => options.root(), {
    attribute: DRAG_ITEM_ATTRIBUTE,
    skipDisabled: false,
  });

  effect(() => {
    const root = options.root();
    instructionRenders.get();
    // By id on the document, not within the root: a live region is often
    // portalled out to the end of the body.
    hasInstructions.set(Boolean(root?.ownerDocument?.getElementById(instructionsId)));
  });

  /**
   * Bumped through `untrack`, because this is reached from a props getter and
   * a consumer is free to merge a class onto those props inside a
   * `Signal.Computed`, which must stay pure and would otherwise throw on the
   * write. Nothing computing can be reading this count, since only the effect
   * below ever does.
   */
  const noteInstructionRender = (): void => {
    untrack(() => instructionRenders.set(instructionRenders.get() + 1));
  };

  // -------------------------------------------------------------------------
  // Reading the DOM
  // -------------------------------------------------------------------------

  const containers = (): HTMLElement[] => {
    const root = options.root();
    if (!root) return [];
    const found = [...root.querySelectorAll<HTMLElement>(`[${DRAG_CONTAINER_ATTRIBUTE}]`)];
    // The root may be the collection, which is the whole markup of a single
    // sortable list. Ancestor first keeps the list in document order.
    if (root.matches(`[${DRAG_CONTAINER_ATTRIBUTE}]`)) found.unshift(root as HTMLElement);
    return found;
  };

  const containerById = (id: string): HTMLElement | null =>
    containers().find((el) => el.getAttribute(DRAG_CONTAINER_ATTRIBUTE) === id) ?? null;

  /**
   * The items of one collection.
   *
   * Filtered by which collection each item's nearest ancestor is, because a
   * tree nests collections inside items: a plain descendant query would give
   * the root list every grandchild as well.
   */
  const itemsOf = (container: HTMLElement): HTMLElement[] =>
    collection
      .all()
      .filter((el) => el.closest(`[${DRAG_CONTAINER_ATTRIBUTE}]`) === container);

  const findItem = (id: string): HTMLElement | null =>
    // By iteration rather than an attribute selector: the id comes from the
    // consumer's data and would need escaping, and escaping it means `CSS`,
    // a browser global that does not exist when rendering on a server.
    collection.all().find((el) => el.getAttribute(DRAG_ITEM_ATTRIBUTE) === id) ?? null;

  const idOf = (el: HTMLElement): string => el.getAttribute(DRAG_ITEM_ATTRIBUTE) ?? '';

  const labelOf = (el: HTMLElement): string =>
    (el.getAttribute(LABEL_ATTRIBUTE) ?? el.textContent ?? '').trim();

  const containerLabelOf = (el: HTMLElement): string =>
    el.getAttribute(LABEL_ATTRIBUTE) ??
    el.getAttribute('aria-label') ??
    el.getAttribute(DRAG_CONTAINER_ATTRIBUTE) ??
    '';

  const containerOf = (el: Element): HTMLElement | null =>
    el.closest<HTMLElement>(`[${DRAG_CONTAINER_ATTRIBUTE}]`);

  /** The same two attributes a collection skips by, plus our own. */
  const canPickUp = (el: HTMLElement): boolean =>
    !el.hasAttribute(NO_DRAG_ATTRIBUTE) &&
    !el.hasAttribute('data-disabled') &&
    !el.hasAttribute('disabled');

  const acceptsOn = (el: HTMLElement): boolean => el.hasAttribute(ON_ATTRIBUTE);

  /**
   * The handle that starts a drag on this item, if it declares one.
   *
   * Filtered the same way as items: a tree node's own handle, never a handle
   * belonging to one of its children.
   */
  const handleOf = (item: HTMLElement): HTMLElement | null => {
    for (const handle of item.querySelectorAll<HTMLElement>(`[${DRAG_HANDLE_ATTRIBUTE}]`)) {
      if (handle.closest(`[${DRAG_ITEM_ATTRIBUTE}]`) === item) return handle;
    }
    return null;
  };

  const sourceFrom = (item: HTMLElement): DragSource | null => {
    const container = containerOf(item);
    if (!container) return null;
    return {
      itemId: idOf(item),
      containerId: container.getAttribute(DRAG_CONTAINER_ATTRIBUTE) ?? '',
      index: itemsOf(container).indexOf(item),
      label: labelOf(item),
      element: item,
    };
  };

  // -------------------------------------------------------------------------
  // Candidates and geometry
  // -------------------------------------------------------------------------

  /** Collections a drop may land in, given what is being dragged. */
  const openContainers = (source: DragSource): HTMLElement[] =>
    containers().filter(
      (el) =>
        !el.hasAttribute(NO_DROP_ATTRIBUTE) &&
        // A collection inside the dragged item is going with it. Dropping a
        // tree node into its own children is the classic way to lose a subtree.
        !source.element.contains(el),
    );

  /** Items a drop may be positioned against, in DOM order. */
  const openItems = (container: HTMLElement, source: DragSource): HTMLElement[] =>
    itemsOf(container).filter(
      (el) =>
        el !== source.element &&
        !source.element.contains(el) &&
        // `opacityProperty` is off: a half-faded row during a drag is still a
        // place items can go, and fading them is a common way to show that.
        el.checkVisibility({ contentVisibilityAuto: true, opacityProperty: false }),
    );

  /** Where the dragged item lands among `items`, which it is not one of. */
  const placeAmong = (
    items: readonly HTMLElement[],
    item: HTMLElement | null,
    position: DropPosition,
  ): number => {
    if (!item) return 0;
    const at = items.indexOf(item);
    if (at === -1) return items.length;
    return position === 'after' ? at + 1 : at;
  };

  /**
   * The index the dragged item will hold once it is put here — see the note on
   * `DropTarget.index`.
   *
   * Counted over every item of the collection, displayed or not, because that
   * is what `source.index` counts: the two are indices into the same array, or
   * `splice(from, 1)` then `splice(index, 0, …)` moves the item somewhere the
   * line was never drawn.
   */
  const indexFor = (
    container: HTMLElement,
    source: DragSource,
    item: HTMLElement | null,
    position: DropPosition,
  ): number => {
    if (position === 'on') return -1;
    return placeAmong(
      itemsOf(container).filter((el) => el !== source.element),
      item,
      position,
    );
  };

  const makeTarget = (
    container: HTMLElement,
    source: DragSource,
    item: HTMLElement | null,
    position: DropPosition,
  ): DropTarget => ({
    containerId: container.getAttribute(DRAG_CONTAINER_ATTRIBUTE) ?? '',
    itemId: item ? idOf(item) : null,
    position,
    index: indexFor(container, source, item, position),
  });

  const allows = (target: DropTarget, source: DragSource): boolean =>
    !options.canDrop || options.canDrop(target, source);

  /**
   * Every place a drop could land in one collection, in the order the arrows
   * walk them: before each item, onto the ones that take children, and after
   * the last.
   *
   * `after item[i]` and `before item[i+1]` are the same gap, so only the last
   * item contributes an `after` — otherwise every arrow press between two items
   * would need two presses to leave.
   */
  const placementsIn = (container: HTMLElement, source: DragSource): DropTarget[] => {
    const items = openItems(container, source);
    const out: DropTarget[] = [];

    if (items.length === 0) {
      out.push(makeTarget(container, source, null, 'before'));
    } else {
      for (const item of items) {
        out.push(makeTarget(container, source, item, 'before'));
        if (acceptsOn(item)) out.push(makeTarget(container, source, item, 'on'));
      }
      const last = items[items.length - 1];
      if (last) out.push(makeTarget(container, source, last, 'after'));
    }

    return out.filter((target) => allows(target, source));
  };

  const horizontal = orientation === 'horizontal';
  const along = (point: DragPoint): number => (horizontal ? point.x : point.y);
  const startOf = (rect: DOMRect): number => (horizontal ? rect.left : rect.top);
  const endOf = (rect: DOMRect): number => (horizontal ? rect.right : rect.bottom);

  /** Where in an item's box the pointer is, as before, after, or on it. */
  const zoneOf = (item: HTMLElement, point: DragPoint): DropPosition => {
    const rect = item.getBoundingClientRect();
    const length = endOf(rect) - startOf(rect);
    // A zero-height row cannot be divided; treat the pointer as being at its
    // start, which reads as "before".
    const ratio = length > 0 ? (along(point) - startOf(rect)) / length : 0;

    if (!acceptsOn(item)) return ratio < 0.5 ? 'before' : 'after';
    if (ratio < onZoneRatio) return 'before';
    if (ratio > 1 - onZoneRatio) return 'after';
    return 'on';
  };

  const hitTest = (source: DragSource, point: DragPoint): DropTarget | null => {
    let container: HTMLElement | null = null;
    for (const candidate of openContainers(source)) {
      if (!containsPoint(candidate.getBoundingClientRect(), point)) continue;
      // Innermost wins, so a nested tree level takes the drop rather than the
      // list it sits in.
      if (!container || container.contains(candidate)) container = candidate;
    }
    if (!container) return null;

    const items = openItems(container, source);
    if (items.length === 0) {
      const empty = makeTarget(container, source, null, 'before');
      return allows(empty, source) ? empty : null;
    }

    const chosen = itemUnder(items, point);
    if (!chosen) return null;

    const target = makeTarget(container, source, chosen, zoneOf(chosen, point));
    return allows(target, source) ? target : null;
  };

  /**
   * The item the pointer is over, or failing that the nearest one along the
   * collection's axis — the gaps between rows, and all the space past the last
   * one, still have to resolve to somewhere.
   */
  const itemUnder = (items: HTMLElement[], point: DragPoint): HTMLElement | null => {
    let nearest: HTMLElement | null = null;
    let distance = Number.POSITIVE_INFINITY;

    for (const item of items) {
      const rect = item.getBoundingClientRect();
      if (along(point) >= startOf(rect) && along(point) <= endOf(rect)) return item;

      const gap = Math.abs(along(point) - (startOf(rect) + endOf(rect)) / 2);
      if (gap < distance) {
        distance = gap;
        nearest = item;
      }
    }
    return nearest;
  };

  // -------------------------------------------------------------------------
  // Target and announcements
  // -------------------------------------------------------------------------

  const describe = (source: DragSource, target: DropTarget | null): DragAnnouncement => {
    const container = target ? containerById(target.containerId) : containerOf(source.element);
    const items = container ? openItems(container, source) : [];
    const targetItem = target?.itemId ? findItem(target.itemId) : null;

    return {
      source,
      target,
      itemLabel: source.label,
      targetLabel: targetItem ? labelOf(targetItem) : null,
      containerLabel: container ? containerLabelOf(container) : '',
      // Among what can be seen, like `total`, rather than `target.index`,
      // which counts hidden items too: "item 4 of 3" is what mixing the two
      // would say.
      position:
        target && target.position !== 'on' ? placeAmong(items, targetItem, target.position) + 1 : 0,
      total: items.length + 1,
    };
  };

  const announce = (kind: keyof typeof DEFAULT_ANNOUNCEMENTS, target: DropTarget | null): void => {
    const source = session?.source;
    if (!source) return;
    const drag = describe(source, target);
    const custom = labels[kind];
    if (custom) {
      message.set(custom(drag));
      return;
    }

    // A drop onto an item is another sentence, not the same one with a word
    // changed, so the two announcements that can be about one have a second
    // key for it.
    const onItem = target?.position === 'on' && (kind === 'moved' || kind === 'dropped');
    const key = ANNOUNCEMENT_KEYS[kind] + (onItem ? 'On' : '');
    message.set(
      said(key, DEFAULT_ANNOUNCEMENTS[kind](drag), {
        item: drag.itemLabel,
        target: drag.targetLabel ?? '',
        container: drag.containerLabel,
        position: drag.position,
        total: drag.total,
      }),
    );
  };

  /** The same gap or the same item, whatever index that comes to. */
  const samePlace = (a: DropTarget | null, b: DropTarget | null): boolean =>
    a === b ||
    (a !== null &&
      b !== null &&
      a.containerId === b.containerId &&
      a.itemId === b.itemId &&
      a.position === b.position);

  const sameTarget = (a: DropTarget | null, b: DropTarget | null): boolean =>
    samePlace(a, b) && a?.index === b?.index;

  const setTarget = (next: DropTarget | null, speak = true): void => {
    if (sameTarget(untrack(() => targetSignal.get()), next)) return;
    targetSignal.set(next);
    if (speak) announce(next ? 'moved' : 'invalid', next);
    if (session) options.onDragOver?.(next, session.source);
  };

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  const beginDrag = (source: DragSource, mode: DragMode, live: Partial<Session> = {}): boolean => {
    if (options.canDrag && !options.canDrag(source, mode)) return false;

    const focused = source.element.ownerDocument.activeElement;
    session = {
      mode,
      source,
      pointerId: null,
      grip: null,
      origin: ORIGIN,
      sourceRect: source.element.getBoundingClientRect(),
      point: ORIGIN,
      frame: null,
      restoreSelection: null,
      ownedFocus: mode === 'keyboard' || (focused instanceof Node && source.element.contains(focused)),
      ...live,
    };

    sourceSignal.set(source);
    modeSignal.set(mode);
    offsetSignal.set(ORIGIN);

    // Keys are taken on `window`, ahead of the `document` listeners dismissal
    // uses, so Escape cancels the drag instead of closing the layer around it.
    window.addEventListener('keydown', onDragKeyDown, true);
    // A keyboard drag has no pointer to let go of, so a press anywhere ends it.
    // Otherwise reaching for the mouse mid-drag leaves an item lifted with
    // nothing on screen still able to put it down.
    if (mode === 'keyboard') document.addEventListener('pointerdown', onOutsidePress, true);

    options.onDragStart?.(source, mode);

    const initial =
      mode === 'pointer' ? hitTest(source, session.point) : firstPlacement(source);
    targetSignal.set(initial);
    announce('lifted', initial);
    options.onDragOver?.(initial, source);

    return true;
  };

  /** Where a keyboard drag starts: the gap the item is already in. */
  const firstPlacement = (source: DragSource): DropTarget | null => {
    const container = containerOf(source.element);
    if (!container) return null;
    const placements = placementsIn(container, source);
    if (placements.length === 0) return null;
    // The place it already occupies, so the first arrow press moves it one
    // step rather than teleporting it to the top of the list. Where that gap is
    // refused — an open tree node is followed by its own children, and the gap
    // above the first of them is inside it — the next one that is allowed is
    // the same place in the data: past whatever the item takes with it.
    const gaps = placements.filter((placement) => placement.position !== 'on');
    return (
      gaps.find((placement) => placement.index >= source.index) ??
      gaps[gaps.length - 1] ??
      placements[0] ??
      null
    );
  };

  const finish = (reason: DragEndReason): void => {
    const live = session;
    if (!live) return;

    const target = untrack(() => targetSignal.get());
    const dropped = reason === 'drop' && target !== null;

    if (dropped) announce('dropped', target);
    else announce('cancelled', null);

    // Release the pointer and the page before any consumer code runs: an
    // `onDrop` that throws must not leave the selection locked and the pointer
    // captured for the rest of the session.
    releaseDrag(live);
    session = null;
    sourceSignal.set(null);
    modeSignal.set(null);
    offsetSignal.set(ORIGIN);
    targetSignal.set(null);

    if (dropped && target) options.onDrop?.({ source: live.source, target, mode: live.mode });
    options.onDragEnd?.(dropped ? 'drop' : 'cancel', live.source);

    if (live.ownedFocus) restoreFocusAfter(live.source);
  };

  const releaseDrag = (live: Session): void => {
    window.removeEventListener('keydown', onDragKeyDown, true);
    document.removeEventListener('pointerdown', onOutsidePress, true);
    detachPointer();

    if (live.pointerId !== null && live.grip?.hasPointerCapture(live.pointerId)) {
      live.grip.releasePointerCapture(live.pointerId);
    }
    if (live.frame !== null) cancelAnimationFrame(live.frame);
    live.restoreSelection?.();
  };

  /**
   * Put focus back on the item, after the consumer has re-rendered.
   *
   * The element the drag started on is often gone: reordering a keyed list
   * moves nodes, and a transfer between collections usually destroys and
   * recreates them. So the item is found again by id, in a microtask — after
   * the render effects the drop's own state change queued.
   */
  const restoreFocusAfter = (source: DragSource): void => {
    if (restoreFocus === 'none') return;
    queueMicrotask(() => {
      // An item that no longer exists falls back to its collection, because
      // leaving focus on `<body>` drops a keyboard user at the top of the
      // document with no way back to the list they were sorting.
      const item = restoreFocus === 'item' ? findItem(source.itemId) : null;
      const target = item ?? containerById(source.containerId);
      if (!target) return;

      // A collection is not focusable by default, and `focus()` on it would
      // quietly do nothing. `tabindex="-1"` makes it able to hold focus without
      // adding a stop to the tab order, which is the host's to decide.
      if (target !== item && !target.hasAttribute('tabindex')) {
        target.setAttribute('tabindex', '-1');
      }
      target.focus();
    });
  };

  // -------------------------------------------------------------------------
  // Pointer
  // -------------------------------------------------------------------------

  const attachPointer = (): void => {
    // Capture, so an application handler that stops propagation on the way up
    // cannot strand a drag with no way to finish it.
    document.addEventListener('pointermove', onPointerMove, true);
    document.addEventListener('pointerup', onPointerUp, true);
    document.addEventListener('pointercancel', onPointerCancel, true);
  };

  const detachPointer = (): void => {
    document.removeEventListener('pointermove', onPointerMove, true);
    document.removeEventListener('pointerup', onPointerUp, true);
    document.removeEventListener('pointercancel', onPointerCancel, true);
  };

  const clearPending = (): void => {
    if (pending?.timer != null) clearTimeout(pending.timer);
    pending = null;
    if (!session) detachPointer();
  };

  const activate = (from: Pending, point: DragPoint): void => {
    const source = sourceFrom(from.item);
    pending = null;
    if (from.timer !== null) clearTimeout(from.timer);
    if (!source) {
      detachPointer();
      return;
    }

    const started = beginDrag(source, 'pointer', {
      pointerId: from.pointerId,
      grip: from.grip,
      origin: from.origin,
      point,
    });

    // Nothing is locked or captured until the drag is real, because a refused
    // drag has no end to undo any of it at.
    if (!started || !session) {
      detachPointer();
      return;
    }

    // Text selection follows a dragging pointer right across the page. This is
    // the one thing here that touches style, and it is a behaviour rather than
    // a look — the same trade a scroll lock makes.
    session.restoreSelection = lockSelection(from.item.ownerDocument);
    // Capture keeps the moves coming when the pointer leaves the handle, over
    // another element or past the edge of the document.
    from.grip.setPointerCapture(from.pointerId);

    // The travel that proved this was a drag counts towards the offset. Without
    // it the item stays put until the next move and then jumps to catch up.
    offsetSignal.set(constrain(session, point));
    if (autoScroll) startAutoScroll(session);
  };

  function onPointerMove(event: Event): void {
    if (!(event instanceof PointerEvent)) return;
    const point = { x: event.clientX, y: event.clientY };

    if (pending) {
      if (event.pointerId !== pending.pointerId) return;
      const travel = Math.hypot(point.x - pending.origin.x, point.y - pending.origin.y);
      // A touch that moves before the hold has elapsed was a scroll, not a
      // drag. A mouse is the other way round: travel is what proves intent.
      if (pending.touch) {
        if (travel > touchTolerance) clearPending();
        return;
      }
      if (travel < activationDistance) return;
      activate(pending, point);
      return;
    }

    const live = session;
    if (!live || live.mode !== 'pointer' || event.pointerId !== live.pointerId) return;

    live.point = point;
    offsetSignal.set(constrain(live, point));
    setTarget(hitTest(live.source, point), true);
  }

  function onPointerUp(event: Event): void {
    if (!(event instanceof PointerEvent)) return;
    if (pending?.pointerId === event.pointerId) {
      clearPending();
      return;
    }
    const live = session;
    if (!live || live.mode !== 'pointer' || event.pointerId !== live.pointerId) return;
    // Releasing where nothing can take the item is a cancel, not a drop: the
    // item goes back, which is what the missing indicator was saying.
    finish(untrack(() => targetSignal.get()) ? 'drop' : 'cancel');
  }

  function onPointerCancel(event: Event): void {
    if (!(event instanceof PointerEvent)) return;
    if (pending?.pointerId === event.pointerId) {
      clearPending();
      return;
    }
    const live = session;
    if (!live || event.pointerId !== live.pointerId) return;
    // The platform took the gesture away — a system swipe, or the element
    // being removed underneath us. Nobody asked for a drop.
    finish('cancel');
  }

  /** Clamp the offset to the axis lock and the boundary box. */
  const constrain = (live: Session, point: DragPoint): DragPoint => {
    const raw = {
      x: axis === 'y' ? 0 : point.x - live.origin.x,
      y: axis === 'x' ? 0 : point.y - live.origin.y,
    };

    const box = options.boundary?.();
    if (!box) return raw;

    const bounds = box.getBoundingClientRect();
    const rect = live.sourceRect;
    return {
      x: clamp(raw.x, bounds.left - rect.left, bounds.right - rect.right),
      y: clamp(raw.y, bounds.top - rect.top, bounds.bottom - rect.bottom),
    };
  };

  // -------------------------------------------------------------------------
  // Auto-scroll
  // -------------------------------------------------------------------------

  const startAutoScroll = (started: Session): void => {
    const step = () => {
      const live = session;
      if (!live) return;
      live.frame = requestAnimationFrame(step);

      const container = containerAt(live.point) ?? containerOf(live.source.element);
      const scroller = nearestScrollable(container);
      if (!scroller) return;

      // The page's own scroller is the one element whose box is not what is on
      // screen: its box is the whole document, running far below the window,
      // and its edges are the window's. Its client box is the window less the
      // scrollbars, from the viewport's top-left corner.
      const page = scroller === scroller.ownerDocument.scrollingElement;
      const rect = page
        ? new DOMRect(0, 0, scroller.clientWidth, scroller.clientHeight)
        : scroller.getBoundingClientRect();
      const dx = edgeVelocity(live.point.x, rect.left, rect.right);
      const dy = edgeVelocity(live.point.y, rect.top, rect.bottom);
      if (dx === 0 && dy === 0) return;

      scroller.scrollLeft += dx;
      scroller.scrollTop += dy;
      // The pointer has not moved but what is under it has, so the target is
      // recomputed — otherwise the indicator sticks while the list slides past.
      setTarget(hitTest(live.source, live.point), true);
    };

    started.frame = requestAnimationFrame(step);
  };

  const containerAt = (point: DragPoint): HTMLElement | null => {
    let found: HTMLElement | null = null;
    for (const container of containers()) {
      if (!containsPoint(container.getBoundingClientRect(), point)) continue;
      if (!found || found.contains(container)) found = container;
    }
    return found;
  };

  const edgeVelocity = (value: number, min: number, max: number): number => {
    const threshold = autoScrollThreshold;
    // Speed rises as the pointer nears the edge, so a nudge into the zone
    // creeps and pressing right up against it runs.
    if (value - min < threshold) {
      return -autoScrollSpeed * Math.min(1, Math.max(0, threshold - (value - min)) / threshold);
    }
    if (max - value < threshold) {
      return autoScrollSpeed * Math.min(1, Math.max(0, threshold - (max - value)) / threshold);
    }
    return 0;
  };

  // -------------------------------------------------------------------------
  // Keyboard
  // -------------------------------------------------------------------------

  /**
   * The collection the arrows are working in: wherever the target is now, or
   * the one the item came from before anything has moved.
   */
  const activeContainer = (live: Session, current: DropTarget | null): HTMLElement | null =>
    (current ? containerById(current.containerId) : null) ?? containerOf(live.source.element);

  /**
   * Move the target, and bring it into view. Auto-scroll follows the pointer
   * and a keyboard drag has none, so without this the arrows walk the target
   * out of a list longer than its scroller and the item is dropped blind —
   * and in a windowed list, never reach a row the window has not rendered.
   * `nearest` is the smallest scroll that shows it, and none when it shows.
   */
  const stepTo = (next: DropTarget): void => {
    setTarget(next, true);
    const el = (next.itemId ? findItem(next.itemId) : null) ?? containerById(next.containerId);
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };

  const move = (delta: number): void => {
    const live = session;
    if (!live) return;

    const current = untrack(() => targetSignal.get());
    const container = activeContainer(live, current);
    if (!container) return;

    const placements = placementsIn(container, live.source);
    if (placements.length === 0) return;

    // Found by what it is placed against, not by index: in a windowed list the
    // indices count the window, and the window moves as the target is brought
    // into view.
    const at = placements.findIndex((placement) => samePlace(placement, current));
    // No wrapping. A drag that jumps from the end of a list back to its start
    // moves the item much further than one arrow press has any right to.
    const next = placements[clamp(at + delta, 0, placements.length - 1)];
    if (next) stepTo(next);
  };

  const moveToEdge = (end: boolean): void => {
    const live = session;
    if (!live) return;

    const current = untrack(() => targetSignal.get());
    const container = activeContainer(live, current);
    if (!container) return;

    const placements = placementsIn(container, live.source);
    const next = end ? placements[placements.length - 1] : placements[0];
    if (next) stepTo(next);
  };

  const moveToCollection = (delta: number): void => {
    const live = session;
    if (!live) return;

    const open = openContainers(live.source);
    const current = untrack(() => targetSignal.get());
    const container = activeContainer(live, current);
    if (!container) return;

    // Keep going past a collection that has nowhere valid to put this item,
    // rather than stopping the user on a wall they cannot see.
    for (let i = open.indexOf(container) + delta; i >= 0 && i < open.length; i += delta) {
      const candidate = open[i];
      if (!candidate) break;
      const placements = placementsIn(candidate, live.source);
      if (placements.length === 0) continue;
      // Enter at the same depth, clamped, so moving sideways along a row of
      // lists does not send the item back to the top of each one.
      const at = current
        ? clamp(current.index, 0, placements.length - 1)
        : 0;
      const next = placements[at];
      if (next) stepTo(next);
      return;
    }
  };

  /** The whole keyboard map for a live drag. Returns true when consumed. */
  const handleDragKey = (event: KeyboardEvent): boolean => {
    if (!session) return false;
    if (event.ctrlKey || event.metaKey || event.altKey) return false;

    const rtl = isRtl(event.target);
    const forward = rtl ? 'ArrowLeft' : 'ArrowRight';
    const back = rtl ? 'ArrowRight' : 'ArrowLeft';
    const pointerDriven = session.mode === 'pointer';

    switch (event.key) {
      case 'Escape':
        cancel();
        return true;
      case ' ':
      case 'Enter':
        // A pointer drag is finished by lifting the pointer; a key press
        // during one is a stray, not a drop.
        if (pointerDriven) return false;
        drop();
        return true;
      case 'Tab':
        // Swallowed rather than acted on. Tabbing away mid-drag would leave the
        // item lifted with nothing on screen still saying so; Escape is the way
        // out, and it is announced.
        return !pointerDriven;
      default:
        break;
    }

    // Arrows belong to the pointer while it is driving: two things moving one
    // target at once is worse than either.
    if (pointerDriven) return false;

    // The collection's own direction moves within it; the cross direction
    // moves between connected collections. Which is which is the whole of the
    // difference between a list and a row of lists.
    const onVertical = horizontal ? moveToCollection : move;
    const onHorizontal = horizontal ? move : moveToCollection;

    switch (event.key) {
      case 'ArrowDown':
        onVertical(1);
        return true;
      case 'ArrowUp':
        onVertical(-1);
        return true;
      case forward:
        onHorizontal(1);
        return true;
      case back:
        onHorizontal(-1);
        return true;
      case 'Home':
        moveToEdge(false);
        return true;
      case 'End':
        moveToEdge(true);
        return true;
      default:
        return false;
    }
  };

  function onOutsidePress(): void {
    if (session?.mode === 'keyboard') cancel();
  }

  function onDragKeyDown(event: Event): void {
    if (!(event instanceof KeyboardEvent)) return;
    if (!handleDragKey(event)) return;
    event.preventDefault();
    // Stopped here, at the top of the capture path, so nothing below —
    // dismissal, a roving focus group, the page's own shortcuts — sees a key
    // that belonged to the drag.
    event.stopPropagation();
  }

  const lift = (item: HTMLElement | string | null): boolean => {
    if (session || !item) return false;
    const el = typeof item === 'string' ? findItem(item) : item;
    if (!el || !canPickUp(el)) return false;
    const source = sourceFrom(el);
    if (!source) return false;
    return beginDrag(source, 'keyboard');
  };

  const drop = (): boolean => {
    if (!session) return false;
    const target = untrack(() => targetSignal.get());
    finish(target ? 'drop' : 'cancel');
    return target !== null;
  };

  const cancel = (): void => {
    clearPending();
    if (session) finish('cancel');
  };

  onCleanup(() => {
    clearPending();
    // A component unmounted mid-drag must not leave listeners on the window, a
    // captured pointer, or the page unselectable.
    if (session) {
      releaseDrag(session);
      session = null;
    }
  });

  // -------------------------------------------------------------------------
  // Public surface
  // -------------------------------------------------------------------------

  return {
    isDragging: () => sourceSignal.get() !== null,
    mode: () => modeSignal.get(),
    source: () => sourceSignal.get(),
    target: () => targetSignal.get(),
    offset: () => offsetSignal.get(),

    transformFor(itemId) {
      const source = sourceSignal.get();
      if (!source || source.itemId !== itemId) return undefined;
      const { x, y } = offsetSignal.get();
      return `translate(${x}px, ${y}px)`;
    },

    indicator() {
      const target = targetSignal.get();
      if (!target) return null;
      const container = containerById(target.containerId);
      if (!container) return null;

      const item = target.itemId ? findItem(target.itemId) : null;
      const rect = (item ?? container).getBoundingClientRect();

      // A highlight is the item's own box; an insertion line is one of its
      // edges, with no thickness of its own — the consumer draws it however
      // thick they like, either side of that line.
      if (target.position === 'on') {
        return { ...target, x: rect.left, y: rect.top, width: rect.width, height: rect.height };
      }
      const after = target.position === 'after';
      return horizontal
        ? { ...target, x: after ? rect.right : rect.left, y: rect.top, width: 0, height: rect.height }
        : { ...target, x: rect.left, y: after ? rect.bottom : rect.top, width: rect.width, height: 0 };
    },

    announcement: () => message.get(),
    instructions: () => labels.instructions ?? said('dragInstructions', DEFAULT_INSTRUCTIONS),

    lift,
    drop,
    cancel,

    onPointerDown(event) {
      // Secondary buttons open menus, and a second finger on a list is a
      // pinch: neither is a drag.
      if (!event.isPrimary || event.button !== 0) return;
      if (session || pending) return;
      if (!(event.target instanceof Element)) return;

      const item = event.target.closest<HTMLElement>(`[${DRAG_ITEM_ATTRIBUTE}]`);
      if (!item || !canPickUp(item)) return;

      const handle = handleOf(item);
      // Where an item declares a handle, only the handle drags. The rest of the
      // row stays available for selecting text, following a link, and pressing
      // the buttons in it.
      if (handle && !handle.contains(event.target)) return;

      const touch = event.pointerType === 'touch';
      const origin = { x: event.clientX, y: event.clientY };
      const press: Pending = {
        pointerId: event.pointerId,
        touch,
        item,
        grip: handle ?? item,
        origin,
        timer: null,
      };
      pending = press;

      if (touch) {
        press.timer = setTimeout(() => {
          if (pending === press) activate(press, press.origin);
        }, touchDelay);
      }

      attachPointer();
    },

    onKeyDown(event) {
      if (session) return handleDragKey(event);
      if (event.ctrlKey || event.metaKey || event.altKey) return false;
      // Space, not Enter: Enter usually already means "open this" on a tree
      // node, a row, or a tab, and taking it would break the component this is
      // composed into.
      if (event.key !== ' ') return false;
      if (!(event.target instanceof Element)) return false;

      const item = event.target.closest<HTMLElement>(`[${DRAG_ITEM_ATTRIBUTE}]`);
      if (!item || !lift(item)) return false;
      // Space scrolls the page, and would scroll the list out from under the
      // drag that just started.
      event.preventDefault();
      return true;
    },

    containerProps: (container) => {
      const target = targetSignal.get();
      return {
        [DRAG_CONTAINER_ATTRIBUTE]: container.id,
        [LABEL_ATTRIBUTE]: container.label,
        [NO_DROP_ATTRIBUTE]: container.dropDisabled ? '' : undefined,
        'data-drop-target': target?.containerId === container.id ? '' : undefined,
      };
    },

    itemProps: (item) => {
      const source = sourceSignal.get();
      const target = targetSignal.get();
      const role = labels.item ?? said('draggable', 'draggable');

      return {
        [DRAG_ITEM_ATTRIBUTE]: item.id,
        [LABEL_ATTRIBUTE]: item.label,
        [ON_ATTRIBUTE]: item.dropsOn ? '' : undefined,
        // Not `aria-disabled`: this item is not unavailable, it merely cannot
        // be picked up, and saying otherwise would misreport a row that is
        // still selectable, expandable and linked.
        [NO_DRAG_ATTRIBUTE]: item.disabled ? '' : undefined,
        // No `role` and no `tabindex`. The component this is composed into owns
        // both — a tree item, a grid row and a tab are all draggable and none
        // of them is a button — and its roving focus owns the tab stop.
        'aria-roledescription': role === '' ? undefined : role,
        'aria-describedby': hasInstructions.get() ? instructionsId : undefined,
        // The native drag would otherwise start on any image or link inside the
        // row and fight the pointer drag for the same gesture.
        draggable: 'false',
        'data-dragging': source?.itemId === item.id ? '' : undefined,
        'data-drop-position': target?.itemId === item.id ? target.position : undefined,
      };
    },

    handleProps: (handle = {}) => {
      const role = labels.handle ?? said('dragHandle', 'drag handle');
      return {
        [DRAG_HANDLE_ATTRIBUTE]: '',
        'aria-label': handle.label,
        'aria-roledescription': role === '' ? undefined : role,
        'aria-describedby': hasInstructions.get() ? instructionsId : undefined,
        draggable: 'false',
      };
    },

    liveRegionProps: () => ({
      role: 'status',
      // Assertive, unlike a toast: a polite queue would read where the item was
      // three arrow presses ago, and a position announced late is worse than
      // one not announced at all.
      'aria-live': 'assertive',
      'aria-atomic': 'true',
    }),

    instructionsProps: () => {
      // Applied by the render of the element these go on, and cleaned up with
      // that render — so both its arrival and its removal reach the check.
      noteInstructionRender();
      onCleanup(noteInstructionRender);
      return { id: instructionsId };
    },
  };
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_INSTRUCTIONS =
  'Press Space to lift this item, the arrow keys to move it, Space again to drop it, ' +
  'and Escape to cancel.';

const DEFAULT_ANNOUNCEMENTS = {
  lifted: (drag: DragAnnouncement) =>
    `Picked up ${drag.itemLabel}. Item ${drag.position} of ${drag.total} in ${drag.containerLabel}.`,
  moved: (drag: DragAnnouncement) =>
    drag.target?.position === 'on'
      ? `Drop ${drag.itemLabel} on ${drag.targetLabel}.`
      : `${drag.itemLabel} is now item ${drag.position} of ${drag.total} in ${drag.containerLabel}.`,
  invalid: (drag: DragAnnouncement) => `${drag.itemLabel} cannot be dropped here.`,
  dropped: (drag: DragAnnouncement) =>
    drag.target?.position === 'on'
      ? `Dropped ${drag.itemLabel} on ${drag.targetLabel}.`
      : `Dropped ${drag.itemLabel}. Item ${drag.position} of ${drag.total} in ${drag.containerLabel}.`,
  cancelled: (drag: DragAnnouncement) => `Cancelled. ${drag.itemLabel} is back where it started.`,
} satisfies Required<Pick<DragDropLabels, 'lifted' | 'moved' | 'invalid' | 'dropped' | 'cancelled'>>;

/** Where the catalogue keeps each of those; `moved` and `dropped` add `On`. */
const ANNOUNCEMENT_KEYS = {
  lifted: 'dragLifted',
  moved: 'dragMoved',
  invalid: 'dragInvalid',
  dropped: 'dragDropped',
  cancelled: 'dragCancelled',
} satisfies Record<keyof typeof DEFAULT_ANNOUNCEMENTS, string>;

// ---------------------------------------------------------------------------
// Geometry and the page
// ---------------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  // `min` can exceed `max` when the dragged item is larger than its boundary.
  // Pinning it to the boundary's start is the only honest answer there.
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function containsPoint(rect: DOMRect, point: DragPoint): boolean {
  return (
    point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom
  );
}

/**
 * The nearest ancestor that can actually scroll.
 *
 * Both halves matter: an element declared `overflow: auto` that has nothing to
 * scroll would swallow the auto-scroll, and one whose content overflows a
 * `visible` box scrolls its own ancestor instead.
 */
function nearestScrollable(from: Element | null): HTMLElement | null {
  for (let el = from; el instanceof HTMLElement; el = el.parentElement) {
    const view = el.ownerDocument?.defaultView;
    if (!view?.getComputedStyle) break;
    const styles = view.getComputedStyle(el);
    if (scrolls(styles.overflowY) && el.scrollHeight > el.clientHeight) return el;
    if (scrolls(styles.overflowX) && el.scrollWidth > el.clientWidth) return el;
  }
  // The page itself is the last scroller, and a drag towards the bottom of the
  // window is the commonest reason to need one.
  const root = from?.ownerDocument?.scrollingElement;
  return root instanceof HTMLElement && root.scrollHeight > root.clientHeight ? root : null;
}

function scrolls(overflow: string): boolean {
  return overflow === 'auto' || overflow === 'scroll' || overflow === 'overlay';
}

/**
 * Stop the page selecting text under a dragging pointer, and put it back
 * afterwards.
 */
function lockSelection(owner: Document): () => void {
  const body = owner.body;
  const previous = body.style.userSelect;
  body.style.userSelect = 'none';
  return () => {
    body.style.userSelect = previous;
  };
}

/**
 * Writing direction at `target`.
 *
 * The nearest `dir` attribute wins over computed style: an application that
 * marks up direction with `dir` is stating intent, and the attribute can be
 * read before styles resolve. Roving focus resolves arrows by the same rule,
 * and the two have to agree or the keys that move a selection and the keys that
 * move a drag would point opposite ways in the same list.
 */
function isRtl(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;

  const declared = target.closest('[dir]');
  if (declared) return declared.getAttribute('dir')?.toLowerCase() === 'rtl';

  const view = target.ownerDocument?.defaultView;
  return view?.getComputedStyle?.(target).direction === 'rtl';
}
