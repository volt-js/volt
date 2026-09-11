/**
 * The DOM runtime that compiled templates call into.
 *
 * Every export here is addressed as `_rt.<name>` from generated code. Nothing
 * in this file walks a tree looking for changes: each binding is its own
 * effect, wired directly to the node it owns.
 */

import {
  Signal,
  batch,
  createRoot,
  createScope,
  effect,
  getScope,
  isSignal,
  isWritableSignal,
  onCleanup,
  onError,
  renderEffect,
  runWithScope,
  type Scope,
} from '@voltdev/reactivity';
// The lowered spelling of the namespace, which is the whole point of it: the
// DOM runtime is in every bundle, so reaching `Signal.subtle.untrack` here
// would hold the namespace object — and everything else it carries — alive in
// every app, whatever the app itself was compiled to.
import {
  State as StateSignal,
  Computed as ComputedSignal,
  untrack,
} from '@voltdev/reactivity/signals';
import { createReuseMarks } from './reuse-marks.js';
import { declareTarget } from '@voltdev/reactivity';
import { voltError } from './diagnostics.js';

/**
 * Bindings being collected for a shared effect, or null when each makes its own.
 *
 * Only ever set for the synchronous span of a `group()` call, so nothing
 * asynchronous can observe it and no stack is needed.
 */
let collecting: (() => void)[] | null = null;

/**
 * Create an effect that builds content of its own.
 *
 * Anything nested inside belongs to this effect, not to whatever group is
 * being collected further out — a row's own bindings must not outlive the row.
 * Clearing the collector for the span of the creation (which includes the
 * first synchronous run) is enough, because later runs happen long after
 * `group` has returned.
 */
function buildEffect(fn: () => void): void {
  if (collecting === null) {
    renderEffect(fn);
    return;
  }
  const previous = collecting;
  collecting = null;
  try {
    renderEffect(fn);
  } finally {
    collecting = previous;
  }
}

export type Accessor<T> = () => T;
export type MaybeAccessor<T> = T | Accessor<T>;
/** Anything a compiled block may produce. */
export type BlockResult = Node | Node[] | string | number | boolean | null | undefined;

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

/**
 * Compile a static markup string into a cloner. The markup is parsed exactly
 * once per template, no matter how many instances are created.
 */
export function template(html: string, rootCount = 1, isSvg = false): () => Node {
  let cached: Node | undefined;

  const create = (): Node => {
    const el = document.createElement('template');
    el.innerHTML = isSvg ? `<svg>${html}</svg>` : html;

    if (isSvg) {
      const svg = el.content.firstChild as Element;
      if (rootCount === 1) return svg.firstChild!;
      const fragment = document.createDocumentFragment();
      while (svg.firstChild) fragment.appendChild(svg.firstChild);
      return fragment;
    }

    return rootCount === 1 ? el.content.firstChild! : el.content;
  };

  return () => (cached ??= create()).cloneNode(true);
}

/** Snapshot a fragment's top-level nodes before insertion moves them out. */
export function childNodes(node: Node): Node[] {
  return Array.from(node.childNodes);
}

export function omit(source: unknown, keys: string[]): Record<string, unknown> {
  if (!source || typeof source !== 'object') return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(source as Record<string, unknown>)) {
    if (!keys.includes(k)) out[k] = v;
  }
  return out;
}

export function withDefault<T>(value: T | undefined, fallback: () => T): T {
  return value === undefined ? fallback() : value;
}

// ---------------------------------------------------------------------------
// Insertion
// ---------------------------------------------------------------------------

export function insert(parent: Node, accessor: unknown, marker: Node | null = null): void {
  if (typeof accessor !== 'function') {
    insertExpression(parent, accessor, marker, null);
    return;
  }
  // The previously inserted content is held in a closure rather than threaded
  // through the effect's return value, which is reserved for cleanup.
  let current: Current = null;
  buildEffect(() => {
    current = insertExpression(parent, (accessor as Accessor<unknown>)(), marker, current);
  });
}

type Current = Node | Node[] | null;

function insertExpression(
  parent: Node,
  value: unknown,
  marker: Node | null,
  current: unknown,
): Current {
  let resolved = value;
  while (typeof resolved === 'function') resolved = (resolved as Accessor<unknown>)();

  const previous = current as Current;
  if (resolved === previous) return previous;

  const type = typeof resolved;

  // Only null and undefined render as nothing. Everything else stringifies,
  // matching `toDisplayString` — the text-only compile path uses that, and an
  // optimisation must not change what a template displays.
  if (resolved === null || resolved === undefined) {
    return replaceContent(parent, previous, marker, null);
  }

  if (type === 'string' || type === 'number' || type === 'bigint' || type === 'boolean') {
    const text = String(resolved);
    // Reuse the existing text node so a changing value never re-creates DOM.
    if (previous instanceof Text) {
      if (previous.data !== text) previous.data = text;
      return previous;
    }
    return replaceContent(parent, previous, marker, document.createTextNode(text));
  }

  if (resolved instanceof Node) {
    return replaceContent(parent, previous, marker, resolved);
  }

  if (Array.isArray(resolved)) {
    const nodes = flattenToNodes(resolved);
    if (nodes.length === 0) return replaceContent(parent, previous, marker, null);
    if (Array.isArray(previous) && previous.length > 0 && previous[0]!.parentNode === parent) {
      reconcileArrays(parent, previous, nodes, marker);
      return nodes;
    }
    return replaceContent(parent, previous, marker, nodes);
  }

  return replaceContent(parent, previous, marker, document.createTextNode(String(resolved)));
}

function replaceContent(
  parent: Node,
  current: Current,
  marker: Node | null,
  replacement: Node | Node[] | null,
): Current {
  if (marker === null) {
    // Without a marker this binding owns the entire parent.
    (parent as Element).textContent = '';
    if (replacement) appendAll(parent, replacement, null);
    return replacement ?? null;
  }

  removeNodes(current);
  if (replacement) appendAll(parent, replacement, marker);
  return replacement ?? null;
}

function appendAll(parent: Node, value: Node | Node[], before: Node | null): void {
  if (Array.isArray(value)) {
    for (const node of value) parent.insertBefore(node, before);
  } else {
    parent.insertBefore(value, before);
  }
}

function removeNodes(current: Current): void {
  if (current === null || current === undefined) return;
  if (Array.isArray(current)) {
    for (const node of current) (node as ChildNode).remove();
  } else {
    (current as ChildNode).remove();
  }
}

function flattenToNodes(value: unknown[], out: Node[] = []): Node[] {
  for (const entry of value) {
    let item = entry;
    while (typeof item === 'function') item = (item as Accessor<unknown>)();
    if (item === null || item === undefined) continue;
    if (item instanceof Node) out.push(item);
    else if (Array.isArray(item)) flattenToNodes(item, out);
    else out.push(document.createTextNode(String(item)));
  }
  return out;
}

/**
 * Keyed list reconciliation. Trims the common prefix and suffix first, then
 * falls back to an index map for the genuinely reordered middle, so the common
 * cases (append, prepend, remove, swap) touch the minimum number of nodes.
 */
function reconcileArrays(parent: Node, a: Node[], b: Node[], marker: Node | null): void {
  const bLength = b.length;
  let aEnd = a.length;
  let bEnd = bLength;
  let aStart = 0;
  let bStart = 0;
  const after = aEnd > 0 ? a[aEnd - 1]!.nextSibling : marker;
  let map: Map<Node, number> | null = null;

  while (aStart < aEnd || bStart < bEnd) {
    if (a[aStart] === b[bStart]) {
      aStart++;
      bStart++;
      continue;
    }

    while (aEnd > aStart && bEnd > bStart && a[aEnd - 1] === b[bEnd - 1]) {
      aEnd--;
      bEnd--;
    }

    if (aEnd === aStart) {
      const node =
        bEnd < bLength ? (bStart > 0 ? b[bStart - 1]!.nextSibling : (b[bEnd] ?? null)) : after;
      while (bStart < bEnd) parent.insertBefore(b[bStart++]!, node);
    } else if (bEnd === bStart) {
      while (aStart < aEnd) {
        const node = a[aStart]!;
        if (!map?.has(node)) (node as ChildNode).remove();
        aStart++;
      }
    } else if (a[aStart] === b[bEnd - 1] && b[bStart] === a[aEnd - 1]) {
      // A straight swap of the two ends.
      const node = a[--aEnd]!.nextSibling;
      parent.insertBefore(b[bStart++]!, a[aStart++]!.nextSibling);
      parent.insertBefore(b[--bEnd]!, node);
      a[aEnd] = b[bEnd]!;
    } else {
      if (!map) {
        map = new Map();
        for (let i = bStart; i < bEnd; i++) map.set(b[i]!, i);
      }

      const index = map.get(a[aStart]!);
      if (index !== undefined) {
        if (bStart < index && index < bEnd) {
          let i = aStart;
          let sequence = 1;
          while (++i < aEnd && i < bEnd) {
            const t = map.get(a[i]!);
            if (t === undefined || t !== index + sequence) break;
            sequence++;
          }
          if (sequence > index - bStart) {
            const node = a[aStart]!;
            while (bStart < index) parent.insertBefore(b[bStart++]!, node);
          } else {
            parent.replaceChild(b[bStart++]!, a[aStart++]!);
          }
        } else {
          aStart++;
        }
      } else {
        const node = a[aStart++]!;
        (node as ChildNode).remove();
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Hydration
// ---------------------------------------------------------------------------

/** `<!--[-->` and `<!--]-->`, which is what a server writes for a `<!>`. */
const HOLE_OPEN = '[';
const HOLE_CLOSE = ']';

function isDelimiter(node: Node, data: string): boolean {
  return node.nodeType === 8 && (node as Comment).data === data;
}

/** One hole's nodes, and how much of them a block has taken. */
interface Claim {
  /** The element the range lives in; only a mismatch report reads it. */
  parent: Node;
  /** The server's nodes for this hole, in document order. */
  nodes: Node[];
  index: number;
  /**
   * Set once a claim in this range has found the wrong thing.
   *
   * After that the range is abandoned rather than offered to whatever comes
   * next: once one block is standing in the wrong place so is every block that
   * would count from it, and a list of a thousand rows would otherwise report
   * a thousand times about one disagreement.
   */
  stalled: boolean;
}

/**
 * Where a claim is up to, or null when nothing is being claimed.
 *
 * One cursor rather than a stack, saved and restored around each `hInsert`,
 * because a hole's nodes are claimed inside that call and nowhere else. It is
 * module state for the same reason `collecting` is: the block that claims is
 * an expression several frames below the call that knows which nodes it owns,
 * and threading a parameter through `branch`, `each` and `createComponent`
 * would put a hydration argument on every one of them forever.
 *
 * Null once a page is hydrated, which is what makes the same emit serve a
 * branch that turns true an hour later: `hClaim` clones, and `hClose` and
 * `hInsert` degrade to the marker and the insert a client build would have
 * emitted.
 */
let claiming: Claim | null = null;

/** What was found where the compiler said something else would be. */
export interface HydrationMismatch {
  /** The element the claim was being made in. */
  parent: Node;
  /** `nodeName` the compiler recorded for the block's first node. */
  expected: string;
  /** What was actually there, or null where the server wrote nothing at all. */
  found: Node | null;
}

let reportMismatch: ((mismatch: HydrationMismatch) => void) | null = null;

/**
 * Be told when hydration found something other than what it printed.
 *
 * There is nothing to recover here — the claim has already fallen back to
 * cloning and the wrongly-placed nodes are already on their way out — so this
 * is a report rather than a hook. It exists because the damage is otherwise
 * invisible: the page ends up correct, having thrown away the server's work
 * for that hole, and the only symptom is that server rendering quietly stopped
 * being worth anything there.
 *
 * Returns a function putting back whatever was registered before, so a test or
 * a devtools panel can listen for a while without owning the channel.
 */
export function onHydrationMismatch(
  report: (mismatch: HydrationMismatch) => void,
): () => void {
  const previous = reportMismatch;
  reportMismatch = report;
  return () => {
    reportMismatch = previous;
  };
}

/**
 * Take the block's roots from the page, or clone them when they are not there.
 *
 * `first` is the `nodeName` the compiler recorded for the markup's first node
 * and `rootCount` how many top-level nodes it produces — a number the compiler
 * only passes when it is a count of nodes rather than of markup slots, so a
 * block that can widen at its root never reaches here at all.
 *
 * The name is the only thing compared, and one comparison is all there is to
 * make: bindings write rather than compare, so a value cannot mismatch, and a
 * structural difference is undetectable by construction. What this buys is not
 * detection but containment — the damage stops at this block, and somebody is
 * told.
 */
export function hClaim(create: () => Node, first: string, rootCount = 1): Node | Node[] {
  const claim = claiming;
  if (claim !== null && !claim.stalled) {
    const start = claim.nodes[claim.index] ?? null;
    if (
      start !== null &&
      claim.index + rootCount <= claim.nodes.length &&
      start.nodeName.toUpperCase() === first
    ) {
      const claimed = claim.nodes.slice(claim.index, claim.index + rootCount);
      claim.index += rootCount;
      return rootCount === 1 ? claimed[0]! : claimed;
    }
    reportMismatch?.({ parent: claim.parent, expected: first, found: start });
    claim.stalled = true;
  }
  const built = create();
  return rootCount === 1 ? built : childNodes(built);
}

/**
 * The far end of a hole: the `<!--]-->` closing what `open` opened.
 *
 * Given anything else — the `<!>` a clone carries, because this block was
 * cloned or because the page was never server-rendered — it is the marker
 * itself, which is exactly what a client build steps from. That is what keeps
 * one emit serving both, and it is why the depth count below is over the
 * delimiters rather than over a nesting the caller has to track: a hole whose
 * content is a fragment can hold further holes as its own siblings.
 */
export function hClose(open: Node): Node {
  if (!isDelimiter(open, HOLE_OPEN)) return open;
  let depth = 1;
  let node = open.nextSibling;
  while (node !== null) {
    if (isDelimiter(node, HOLE_OPEN)) depth++;
    else if (isDelimiter(node, HOLE_CLOSE) && --depth === 0) return node;
    node = node.nextSibling;
  }
  // Unreachable against markup this compiler printed; falling back to the open
  // marker makes a truncated response render rather than throw.
  return open;
}

/**
 * Fill a hole with the server's nodes already in it.
 *
 * Three things happen here that `insert` does not do, and each of them is a
 * bug without the others. The claimed range is handed to the block being built
 * so it can take those nodes instead of making new ones. `current` is seeded
 * with the same range, so the first run compares against what is on screen
 * rather than against nothing — without it the markerless path clears the
 * parent outright and the server's rows are gone before the client's arrive.
 * And the block is built from a thunk, because `insert(p, branch([...]), m)`
 * runs `branch` while it is evaluating its arguments, which is before any of
 * this could have been set up.
 *
 * `open` and `close` are null for a hole with no marker, where the binding
 * owns everything between an element's tags and the claimed range is simply
 * its children. They are the same node for a cloned `<!>`, where nothing was
 * claimed and this is `insert` with one extra call.
 */
export function hInsert(
  parent: Node,
  open: Node | null,
  close: Node | null,
  build: () => unknown,
): void {
  const claimed = open !== null && open === close ? [] : claimedRange(parent, open, close);
  // A single node is seeded as itself rather than as a list of one, so that a
  // block returning exactly the node it claimed short-circuits on identity and
  // touches no DOM at all.
  let current: Current =
    claimed.length === 0 ? null : claimed.length === 1 ? claimed[0]! : claimed;

  const previous = claiming;
  claiming = claimed.length === 0 ? null : { parent, nodes: claimed, index: 0, stalled: false };
  let accessor: unknown;
  try {
    accessor = build();
  } finally {
    claiming = previous;
  }

  if (typeof accessor !== 'function') {
    insertExpression(parent, accessor, close, current);
    return;
  }
  buildEffect(() => {
    current = insertExpression(parent, (accessor as Accessor<unknown>)(), close, current);
  });
}

/** The server's nodes between two delimiters, or all of a parent's children. */
function claimedRange(parent: Node, open: Node | null, close: Node | null): Node[] {
  const nodes: Node[] = [];
  let node = open === null ? parent.firstChild : open.nextSibling;
  while (node !== null && node !== close) {
    nodes.push(node);
    node = node.nextSibling;
  }
  return nodes;
}

/**
 * Attach a compiled render to markup a server already printed.
 *
 * The same shape as the hole above it, because that is what the root of a page
 * is: a container whose children are the block's, with no marker in front of
 * them. Everything that makes hydration different from mounting is in
 * `hInsert` — the claim, the seeded range, the thunk — so this is the entry
 * that names it rather than a second implementation of it.
 */
export function hydrate(host: Node, build: () => unknown): void {
  // Before a single node is claimed, because a streamed response's late
  // regions are still sitting in inert `<template>`s when the runtime loads,
  // and their placeholders are still holding the fallback. Claiming first
  // would bind this render to markup the drain is about to replace. Draining
  // first also swaps the queue for a live sink, so the records that have not
  // arrived yet apply as they land rather than piling up behind a page that
  // has already booted.
  drainStream();
  hInsert(host, null, null, build);
}

// ---------------------------------------------------------------------------
// Streamed chunks
// ---------------------------------------------------------------------------

/**
 * The global a streaming render appends its records to; see `stream.ts`.
 *
 * `self` there and `globalThis` here are the same object in a page and in a
 * worker, and the name is written out in both places rather than shared,
 * because the two halves are compiled into different bundles and a server
 * build's constant cannot reach a browser.
 */
const QUEUE = '__VOLT__';

/** The attribute a late chunk's `<template>` carries its boundary id on. */
const BOUNDARY_ATTRIBUTE = 'data-volt-b';

/** The attribute a relocatable portal's `<template>` carries its target on. */
const PORTAL_ATTRIBUTE = 'data-volt-portal';

/**
 * One instruction: `["b"|"e", id]`, `["p", selector]`, or `["s", state]`.
 *
 * Written by a server and read here, so it is only ever what the response
 * happened to contain — which is why every field is narrowed rather than
 * trusted, and why an op this build does not know is dropped instead of
 * throwing. A record from a newer server must not take the page down.
 */
type StreamRecord = readonly unknown[];

/** What the array is swapped for: a queue that applies rather than collects. */
interface Sink {
  push(...records: StreamRecord[]): void;
}

interface QueueHost {
  [QUEUE]?: StreamRecord[] | Sink;
}

/**
 * The sink this document installed, or null before anything has drained.
 *
 * Held only to answer "is the queue already live", which is what makes
 * `drainStream` idempotent — the design's requirement, and a practical one:
 * the call sits wherever a page boots, and a page can boot twice.
 */
let installed: Sink | null = null;

/**
 * Take over the record queue and apply everything in it.
 *
 * The array-then-swap of §3.5. A boundary can settle before any script has
 * run, so the server writes `self.__VOLT__=self.__VOLT__||[]` ahead of its
 * first record and pushes into whatever that found; this replaces the array
 * with an object whose `push` applies immediately, having first applied
 * whatever the array collected. Both orders therefore work, and the one that
 * matters is the one an ordinary page has: records arriving for minutes after
 * the runtime loaded.
 *
 * Idempotent, and safe to call before the first record exists — a page that
 * boots early installs the sink and the server's own boot line, finding
 * something already there, leaves it alone.
 */
export function drainStream(): void {
  const host = globalThis as QueueHost;
  const queued = host[QUEUE];
  if (installed !== null && queued === installed) return;

  // A fresh queue per install rather than one per module: what is parked
  // below belongs to the document it was parked against, and a second
  // document — a test, a page a router replaced wholesale — must not inherit
  // instructions naming nodes that no longer exist.
  const parked: StreamRecord[] = [];
  const accept = (record: unknown): void => {
    if (!Array.isArray(record)) return;
    if (!apply(record as StreamRecord)) {
      parked.push(record as StreamRecord);
      return;
    }
    // Relocating one region can put another region's markers on the page, so
    // anything that missed is offered the document again. Repeated until a
    // pass changes nothing, because the nesting can be any depth.
    for (let moved = true; moved && parked.length > 0; ) {
      moved = false;
      for (let i = parked.length - 1; i >= 0; i--) {
        if (!apply(parked[i]!)) continue;
        parked.splice(i, 1);
        moved = true;
      }
    }
  };

  const sink: Sink = {
    push: (...records: StreamRecord[]): void => {
      for (const record of records) accept(record);
    },
  };
  installed = sink;
  host[QUEUE] = sink;
  if (Array.isArray(queued)) for (const record of queued) accept(record);
}

/** False when the page does not hold what this record names — see `accept`. */
function apply(record: StreamRecord): boolean {
  const op = record[0];
  if (op === 'b' || op === 'e') return relocateBoundary(String(record[1]), op === 'e');
  if (op === 'p') return relocatePortal(String(record[1]));
  // Everything else, `["s", state]` included. State that moved after the shell
  // was written is not applied here and this is where that ends: the client
  // half of `hydratable` reads the JSON payload once, at the moment a signal
  // is created, and keeps no registry of live signals by key for a late value
  // to be written into. Dropping the record is the honest answer until there
  // is one — parking it would be a queue that grows and never drains.
  return true;
}

/**
 * Move a settled boundary's content into the placeholder the shell wrote.
 *
 * The shell has `<!--v3-->` fallback `<!--/v3-->` where the answer goes, and
 * the chunk has `<template data-volt-b="3">` holding it. Both ends are found
 * by that id rather than by position, because settle order is what decides
 * where a chunk lands in the response and the id is the only thing tying the
 * two halves of a boundary together once the two orders have come apart.
 *
 * Returning false parks the record: the markers are missing because they are
 * inside a `<template>` that has not been relocated yet, which is what a
 * boundary nested inside another boundary looks like from here.
 */
function relocateBoundary(id: string, failed: boolean): boolean {
  const open = findComment(`v${id}`);
  if (open === null) return false;
  const template = findTemplate(BOUNDARY_ATTRIBUTE, id);
  // Nothing to move. Either this record has already been applied — a stream
  // read twice, a page booted twice — or the response was cut off between the
  // record and the content it names. Both leave the fallback standing, and
  // neither is worth parking a record forever over.
  if (template === null) return true;

  let close: Node | null = open.nextSibling;
  while (close !== null && !isDelimiter(close, `/v${id}`)) close = close.nextSibling;
  // Truncated mid-region: without the far end there is no telling how much of
  // what follows was the fallback, and removing the rest of the parent is a
  // worse answer than leaving the page as it arrived.
  if (close === null) return true;

  const content = template.content;
  // A failure whose own `failed` writer wrote nothing — or threw — sends an
  // empty template, and `stream.ts` says what that means: the boundary has
  // nothing to show and the shell's fallback is what the reader is left with.
  // A `done` boundary that resolved to nothing is a different thing, and does
  // clear the fallback.
  if (failed && content.firstChild === null) {
    template.remove();
    return true;
  }

  let node = open.nextSibling;
  while (node !== null && node !== close) {
    const next = node.nextSibling;
    (node as ChildNode).remove();
    node = next;
  }
  // The fragment empties itself into the page, so the whole chunk moves in one
  // call and the nodes are the server's own rather than copies of them.
  open.parentNode!.insertBefore(content, close);
  template.remove();
  return true;
}

/**
 * Move portalled content into the element it named.
 *
 * Only a selector target is ever relocated; content portalled to the body was
 * written at the end of the response, where appending it is what the client's
 * own `portal` would have done anyway. Parked when the target is not on the
 * page yet, since a portal's container can itself be inside a boundary that
 * has not landed.
 *
 * Both halves of a server-rendered portal end up here, and which one arrives
 * first is decided by the network: the record can be in the boot array before
 * the runtime loads, or it can land minutes later on a page that has long
 * since hydrated. Either way exactly one copy of the content is on the page —
 * the nodes are left for the client's `portal` to adopt, or the client has
 * already built them and the server's `<template>` is dropped unopened.
 */
function relocatePortal(selector: string): boolean {
  const template = findTemplate(PORTAL_ATTRIBUTE, selector);
  if (template === null) return true;
  const target = document.querySelector(selector);
  if (target === null) return false;

  const handoff = portalHandoff(target);
  if (handoff.owed > 0) {
    // The client's own portal ran before this record arrived and built the
    // content itself. Appending the server's copy behind it is the
    // duplication this exists to prevent.
    handoff.owed--;
  } else {
    // The fragment empties itself into the target, so what lands there are the
    // server's own nodes; they are remembered so the `portal` call that is
    // about to build the same content takes them over rather than adding a
    // second copy of it.
    const moved = childNodes(template.content);
    target.appendChild(template.content);
    if (moved.length > 0) handoff.ranges.push(moved);
  }

  template.remove();
  return true;
}

/**
 * What the two halves of a server-rendered portal leave each other, per
 * container.
 *
 * A count in one direction and a queue in the other, because a container can
 * hold several portals and both sides declare them in the same order: the
 * server records its segments as they are opened, and a page hydrates in the
 * order it was written.
 */
interface PortalHandoff {
  /** Relocated ranges no client portal has taken over yet, in order. */
  ranges: Node[][];
  /**
   * Client portals that were built before their server nodes arrived.
   *
   * A count rather than a queue, and it does not need to be more than that: a
   * record only ever names a portal the server rendered, and the page that
   * hydrates builds those same portals before anything a reader does can add
   * one of its own.
   */
  owed: number;
}

const portalHandoffs = new WeakMap<Element, PortalHandoff>();

function portalHandoff(container: Element): PortalHandoff {
  let entry = portalHandoffs.get(container);
  if (entry === undefined) portalHandoffs.set(container, (entry = { ranges: [], owed: 0 }));
  return entry;
}

/**
 * The `<template>` an attribute names, or null.
 *
 * `JSON.stringify` for the quoting: a selector target is author text and can
 * hold a quote or a backslash, and both are escaped the same way in a CSS
 * string as in a JSON one.
 */
function findTemplate(attribute: string, value: string): HTMLTemplateElement | null {
  return document.querySelector(`template[${attribute}=${JSON.stringify(value)}]`);
}

/**
 * The first comment in the document carrying exactly this text.
 *
 * A walk per record rather than an index, because the thing an index would
 * have to be invalidated by is the relocation itself — every move can reveal
 * markers that were inside a template a moment ago. Pages have a handful of
 * boundaries and one walk each is cheaper than the bookkeeping, and this runs
 * once per chunk rather than once per frame.
 *
 * A `<template>`'s content is not part of the document, which is exactly the
 * property being relied on: a nested boundary's markers stay invisible here
 * until the boundary around them has been moved into the page.
 */
function findComment(data: string): Comment | null {
  // 128 is `NodeFilter.SHOW_COMMENT`, spelled as the number because reaching
  // the constant would put the whole `NodeFilter` object in every bundle for
  // one integer.
  const walker = document.createTreeWalker(document, 128);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if ((node as Comment).data === data) return node as Comment;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Control flow
// ---------------------------------------------------------------------------

export type BranchEntry = [Accessor<unknown> | null, () => unknown];

/**
 * `:if` / `:else-if` / `:else`. Conditions are tested in order; only the
 * winning branch is built, and switching branches disposes the previous
 * branch's effects along with its DOM.
 */
export function branch(branches: BranchEntry[]): Accessor<unknown> {
  // The winning index is its own computed, so re-testing conditions does not
  // rebuild the branch unless the winner actually changes.
  const active = new ComputedSignal(() => {
    for (let i = 0; i < branches.length; i++) {
      const condition = branches[i]![0];
      if (condition === null || condition()) return i;
    }
    return -1;
  });

  const result = new StateSignal<unknown>(null);

  // A render effect, not a computed: building a branch creates effects, and
  // re-running this disposes the previous branch's scope along with them.
  buildEffect(() => {
    const index = active.get();
    result.set(index === -1 ? null : untrack(() => branches[index]![1]()));
  });

  return () => result.get();
}

export interface BoundaryOptions {
  /**
   * What to show once the subtree has failed, given the error and a way to
   * build the subtree again from its inputs. Without one the boundary
   * swallows: nothing is replaced, and whatever the failed run had already
   * written stays on screen.
   */
  fallback?: (error: unknown, retry: () => void) => unknown;
  /**
   * Told about the error and the scope that produced it, before anything is
   * replaced. Throwing from here sends the error on to the boundary above,
   * which is how a boundary declines a failure it does not know what to do
   * with.
   */
  onError?: (error: unknown, scope: Scope) => void;
}

/**
 * A boundary around a piece of the tree: anything thrown below it arrives
 * here instead of at the console.
 *
 * The recovery is the same one `:if` performs when it switches branches, and
 * deliberately so — replacing the subtree disposes it first, so its cleanups
 * run and its listeners detach, and the fallback is built in the fresh scope
 * the next run opens. `retry` does the same thing in the other direction: the
 * subtree is built again from its inputs, which is only correct because a
 * component is constructed once and holds no render state.
 */
export function errorBoundary(
  children: () => unknown,
  options: BoundaryOptions = {},
): Accessor<unknown> {
  // A scope of its own, above the effect that builds the subtree and outside
  // everything that effect disposes. Declaring the boundary on whatever scope
  // happened to be current would put two boundaries in one template on the
  // same scope, where the second would silently replace the first.
  const owner = createScope();
  const result = new StateSignal<unknown>(null);
  // What is showing is a plain variable rather than part of the signal,
  // because the handler reads it from inside the catch of an effect that is
  // mid-run: a tracked read there would make that effect depend on it.
  let showing = false;
  let caught: unknown = null;
  let building = false;
  let generation = 0;
  const attempt = new StateSignal(0);

  const retry = () => {
    showing = false;
    caught = null;
    attempt.set(++generation);
  };

  runWithScope(owner, () => {
    onError((error, scope) => {
      // A failure with the fallback already up is either the fallback's own or
      // came from something that outlived the subtree. Replacing the fallback
      // with itself would loop, so it goes to the boundary above instead.
      if (showing) throw error;
      options.onError?.(error, scope);
      if (!options.fallback) return;
      showing = true;
      caught = error;
      // A failure while the subtree is being built is seen by the run that is
      // still on the stack, which swaps before it returns. Waking the effect
      // from inside its own run would achieve nothing anyway: a run ends by
      // marking itself clean, which would discard the very notification this
      // write is trying to send.
      if (!building) attempt.set(++generation);
    });

    // A render effect, not a computed, for the reason `branch` is one: what it
    // builds creates effects, and re-running it disposes the previous scope
    // along with them — cleanups run and listeners detach before anything
    // replaces them.
    buildEffect(() => {
      // Read before anything can throw, so that the run which fails still
      // depends on it and a later failure can wake this effect.
      attempt.get();
      const parent = getScope();
      let content: unknown = null;

      building = true;
      try {
        if (!showing) {
          // Each attempt is a root of its own under this effect, so the one
          // that fails can be torn down without waiting for the next run.
          const built = createRoot((dispose) => ({ dispose, content: children() }), parent);
          content = built.content;
          if (showing) built.dispose();
        }
        // Read again: `children()` may have failed while it was building, and
        // the handler will have run before this point.
        if (showing) content = createRoot(() => options.fallback!(caught, retry), parent);
      } finally {
        building = false;
      }

      result.set(content);
    });
  });

  return () => result.get();
}

/**
 * A row's DOM is read through `nodes()` rather than cached, because a row
 * whose own content is conditional can change which nodes it occupies without
 * the list itself ever changing.
 */
interface MountedBlock {
  nodes(): Node[];
}

interface Row {
  block: MountedBlock;
  dispose: () => void;
  item: StateSignal<unknown>;
  /** Record a new position, waking the index signal only if one was made. */
  setIndex(index: number): void;
}

/**
 * `:for`. Rows are keyed, and a row that survives a change is never rebuilt —
 * its item and index signals are updated in place, so only the bindings that
 * actually read them re-run.
 *
 * With no `:key`, rows are keyed by **item identity**. That makes reordering
 * correct by default: the elements move and whatever is attached to them —
 * focus, input values, a running transition — moves too. Keying by position
 * instead would leave that state stranded on the wrong row, which is the
 * failure every framework with an index default shares.
 *
 * The trade-off is that replacing an item with an equal-but-new object counts
 * as a different row. `:key="item.id"` is the answer when data is refetched;
 * `:key="$index"` opts back into positional keying.
 */
export function each(
  list: Accessor<unknown>,
  rowFn: (item: Accessor<unknown>, index: Accessor<number>) => unknown,
  keyFn: ((item: unknown, index: number) => unknown) | null,
): Accessor<Node[]> {
  const scope = getScope();

  // The bookkeeping belongs to the list, not to the pass. Every buffer here is
  // written in place and handed back and forth between passes, so a reconcile
  // allocates no keys, no rows, no node list and no per-row reuse marks. The
  // one thing left that a pass allocated was the `available` map below — 92 B
  // per row, against 323 B before any of this — and a pass whose keys did not
  // move no longer builds it either: that is the positional scan in the
  // reconcile, which is the shape an edit to one cell of a table has.
  let prevKeys: unknown[] = [];
  let prevRows: (Row | undefined)[] = [];
  let keys: unknown[] = [];
  let rows: (Row | undefined)[] = [];
  let nodes: Node[] = [];
  const marks = createReuseMarks();

  onCleanup(() => {
    for (const row of prevRows) row?.dispose();
    prevKeys = [];
    prevRows = [];
    keys = [];
    rows = [];
    nodes = [];
  });

  // The node list is the same array on every pass, so the signal is told not
  // to compare: what changes is its contents. Every reader copies what it
  // reads — `insert` flattens into an array of its own — so nothing is left
  // holding a buffer that moves underneath it.
  const result = new StateSignal<Node[]>([], { equals: () => false });

  // A render effect rather than a computed, because reconciling writes the
  // per-row item and index signals — something a pure computed may not do.
  buildEffect(() => {
    const raw = list();
    const items: unknown[] = Array.isArray(raw)
      ? raw
      : raw === null || raw === undefined
        ? []
        : Array.from(raw as Iterable<unknown>);

    const count = items.length;
    // No key function means key by the item itself. Duplicates are fine: the
    // reconciler pairs equal keys up in order.
    for (let i = 0; i < count; i++) keys[i] = keyFn ? keyFn(items[i], i) : items[i];

    const prevCount = prevRows.length;

    untrack(() => {
      // The overwhelmingly common update to a long list is one row's contents
      // changing: same length, same keys, same order. That is decidable in one
      // positional scan of pointer comparisons, and deciding it here skips the
      // map below entirely — which is the only thing a no-op pass still
      // allocates, at 92 B per row.
      //
      // The scan comes first and writes nothing, because falling back after
      // half a pass of `item.set` would have refreshed rows the full algorithm
      // is about to pair up differently, and a row holding another row's item
      // is a corrupted list rather than a slow one.
      if (count === prevCount && sameKeysInOrder(keys, prevKeys, count)) {
        for (let i = 0; i < count; i++) {
          // Position and key are both unchanged, so the index signal would be
          // written the value it already holds and the row's DOM does not
          // move. The item still has to be refreshed: with a `:key` the key
          // can repeat an object the list no longer holds.
          prevRows[i]!.item.set(items[i]);
        }
      } else {
        // Where a previous key's rows are. A key almost always names one row, so
        // its index is stored bare and only a key that genuinely repeats grows a
        // bucket — which is what spares a unique-keyed list an array per row. A
        // bucket's first slot counts how many of that key's rows have been
        // claimed; consuming with `shift` instead would be quadratic on a list
        // where one key repeats thousands of times.
        const available = new Map<unknown, number | number[]>();
        for (let i = 0; i < prevCount; i++) {
          const key = prevKeys[i];
          const found = available.get(key);
          if (found === undefined) available.set(key, i);
          else if (typeof found === 'number') available.set(key, [0, found, i]);
          else found.push(i);
        }

        marks.begin(prevCount);

        for (let i = 0; i < count; i++) {
          const key = keys[i];
          const found = available.get(key);
          let oldIndex = -1;

          if (typeof found === 'number') {
            // Overwritten with -1 rather than deleted: deleting enough of a Map
            // makes it compact its table, which is the per-pass allocation back.
            if (found >= 0) {
              oldIndex = found;
              available.set(key, -1);
            }
          } else if (found !== undefined) {
            const taken = found[0]! + 1;
            if (taken < found.length) {
              oldIndex = found[taken]!;
              found[0] = taken;
            }
          }

          if (oldIndex >= 0) {
            const row = prevRows[oldIndex]!;
            marks.claim(oldIndex);
            rows[i] = row;
            // Refresh in place; the row's DOM stays exactly where it is.
            row.item.set(items[i]);
            row.setIndex(i);
            continue;
          }

          rows[i] = createRow(scope, rowFn, items[i], i);
        }

        // Emptied as it is walked: these two become the next pass's scratch, and
        // until that pass overwrites them they would go on holding a disposed
        // row's DOM. Clearing here rather than while the map is built also means
        // a row body that throws leaves the previous state whole to reconcile
        // against next time.
        for (let i = 0; i < prevCount; i++) {
          if (!marks.claimed(i)) prevRows[i]!.dispose();
          prevKeys[i] = undefined;
          prevRows[i] = undefined;
        }

        // The buffers swap rather than being copied, and both pairs are trimmed
        // to the live count — a list that spikes to 100k and settles at 50 hands
        // the space back on the pass that shrinks it, rather than keeping the
        // large arrays for as long as the list is on screen.
        const spentKeys = prevKeys;
        const spentRows = prevRows;
        prevKeys = keys;
        prevRows = rows;
        keys = spentKeys;
        rows = spentRows;
        if (prevKeys.length > count) prevKeys.length = count;
        if (prevRows.length > count) prevRows.length = count;
        if (keys.length > count) keys.length = count;
        if (rows.length > count) rows.length = count;
      }

      // Both paths end here, and both end with `prevRows` holding the rows
      // this pass decided on: the node buffer is written in place from them.
      let written = 0;
      for (let i = 0; i < count; i++) {
        const rowNodes = prevRows[i]!.block.nodes();
        for (let j = 0; j < rowNodes.length; j++) nodes[written++] = rowNodes[j]!;
      }
      if (nodes.length > written) nodes.length = written;
    });

    result.set(nodes);
  });

  return () => result.get();
}

/**
 * Are the first `count` keys of two buffers pairwise identical?
 *
 * The scan behind the fast path above, and the whole of its cost: one pointer
 * comparison per row, no map, no closure, nothing allocated. A module function
 * rather than an inner one for that last reason — an arrow declared inside the
 * reconcile would be an allocation per pass, which is exactly what this is
 * here to avoid.
 *
 * `===` rather than the `SameValueZero` a `Map` compares keys with. The two
 * differ on `NaN` alone, and only in the safe direction: a pair this rejects
 * is handed to the full algorithm, which pairs them up the way it always did.
 */
function sameKeysInOrder(next: unknown[], previous: unknown[], count: number): boolean {
  for (let i = 0; i < count; i++) {
    if (next[i] !== previous[i]) return false;
  }
  return true;
}

function createRow(
  scope: Scope | null,
  rowFn: (item: Accessor<unknown>, index: Accessor<number>) => unknown,
  item: unknown,
  index: number,
): Row {
  const itemSignal = new StateSignal<unknown>(item);

  // The index signal is created only if the row body actually reads `$index`,
  // which most templates never do. Otherwise every row in every list pays for
  // a signal at creation and a write on every reconcile that nothing observes.
  let indexSignal: StateSignal<number> | null = null;
  let indexValue = index;

  let block: MountedBlock = { nodes: () => [] };

  // Rows are rooted at the scope that created the list, not at the reconciling
  // effect — otherwise every recompute would dispose the rows we mean to keep.
  const dispose = createRoot((disposeRow) => {
    block = materializeBlock(
      rowFn(
        () => itemSignal.get(),
        () => (indexSignal ??= new StateSignal(indexValue)).get(),
      ),
    );
    return disposeRow;
  }, scope);

  return {
    block,
    dispose,
    item: itemSignal,
    setIndex(next: number) {
      indexValue = next;
      indexSignal?.set(next);
    },
  };
}

/**
 * Turn any block result into DOM with a stable identity.
 *
 * A block that is just an accessor (`{ item }`, a bare `:if`, a nested
 * `:for`) has no element of its own, so it gets a zero-width anchor and keeps
 * its content immediately before it. Reading `nodes()` reports whatever the
 * block currently occupies rather than what it occupied when it was built.
 */
function materializeBlock(value: unknown): MountedBlock {
  if (value instanceof Node) {
    const fixed = [value];
    return { nodes: () => fixed };
  }

  if (Array.isArray(value)) {
    const parts = value.map(materializeBlock);
    return { nodes: () => parts.flatMap((part) => part.nodes()) };
  }

  if (typeof value === 'function') {
    const anchor = document.createTextNode('');
    // The anchor starts in a detached holder so the first run has somewhere to
    // write; once the row is mounted, `anchor.parentNode` is the real parent.
    const holder = document.createDocumentFragment();
    holder.appendChild(anchor);

    let current: Current = null;
    buildEffect(() => {
      const parent = anchor.parentNode ?? holder;
      current = insertExpression(parent, (value as Accessor<unknown>)(), anchor, current);
    });

    return {
      nodes: () => {
        const out: Node[] = [];
        if (Array.isArray(current)) out.push(...current);
        else if (current) out.push(current);
        out.push(anchor);
        return out;
      },
    };
  }

  if (value === null || value === undefined) {
    const empty = [document.createTextNode('') as Node];
    return { nodes: () => empty };
  }

  const text = [document.createTextNode(toDisplayString(value)) as Node];
  return { nodes: () => text };
}

/** Materialise a block and return its current nodes. */
export function materialize(value: unknown): Node | Node[] {
  const nodes = materializeBlock(value).nodes();
  return nodes.length === 1 ? nodes[0]! : nodes;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export interface EventOptions {
  capture?: boolean;
  once?: boolean;
  passive?: boolean;
}

export function on(
  el: Element,
  name: string,
  handler: EventListener,
  options?: EventOptions,
): void {
  el.addEventListener(name, handler, options);
  onCleanup(() => el.removeEventListener(name, handler, options));
}

/** Event types that already have a document-level listener installed. */
const delegatedTypes = new Set<string>();

/**
 * Attach a handler without adding a listener to the element.
 *
 * One listener per event *type* is installed on the document; dispatch walks
 * up from the target looking for a handler stashed on each node. A table of a
 * thousand rows with two handlers each costs two listeners instead of two
 * thousand, and rows can be created and discarded without touching the
 * listener registry at all.
 */
export function delegate(el: Element, name: string, handler: EventListener): void {
  const key = `$$${name}`;
  (el as unknown as Record<string, unknown>)[key] = handler;

  if (!delegatedTypes.has(name)) {
    delegatedTypes.add(name);
    document.addEventListener(name, dispatchDelegated);
  }

  // No cleanup is registered on purpose. The handler is a property of the
  // node, so discarding the node discards it; and a re-run overwrites it in
  // place. Registering one would allocate a closure and a cleanups array per
  // handler, which is pure cost in exactly the teardown paths that matter —
  // a thousand-row table would carry two thousand of them.
}

function dispatchDelegated(event: Event): void {
  const key = `$$${event.type}`;
  let node = event.target as (Node & Record<string, unknown>) | null;

  // The walk is synthetic, so the browser's own bubbling has already
  // finished; `stopPropagation` is intercepted to stop *this* walk. Reading
  // `cancelBubble` would be the alternative, but it is deprecated.
  let stopped = false;
  const stopPropagation = event.stopPropagation.bind(event);
  Object.defineProperty(event, 'stopPropagation', {
    configurable: true,
    value() {
      stopped = true;
      stopPropagation();
    },
  });

  try {
    while (node !== null) {
      const handler = node[key] as EventListener | undefined;
      if (handler) {
        // `currentTarget` is null during a synthetic walk, so expose the node
        // the handler was attached to — that is what `.self` compares against.
        Object.defineProperty(event, 'currentTarget', {
          configurable: true,
          value: node,
        });
        Reflect.apply(handler, node, [event]);
        if (stopped) return;
      }
      node = node.parentNode as (Node & Record<string, unknown>) | null;
    }
  } finally {
    Reflect.deleteProperty(event, 'stopPropagation');
    Reflect.deleteProperty(event, 'currentTarget');
  }
}

export interface GuardConfig {
  stop?: boolean;
  prevent?: boolean;
  self?: boolean;
  system?: string[];
  keys?: string[];
}

/** Wrap a handler with the `.stop` / `.prevent` / `.enter` style modifiers. */
export function guard(handler: EventListener, config: GuardConfig): EventListener {
  return function guarded(this: unknown, event: Event) {
    if (config.self && event.target !== event.currentTarget) return;

    if (config.system?.length) {
      const e = event as MouseEvent & KeyboardEvent;
      for (const modifier of config.system) {
        const pressed =
          modifier === 'ctrl'
            ? e.ctrlKey
            : modifier === 'alt'
              ? e.altKey
              : modifier === 'shift'
                ? e.shiftKey
                : e.metaKey;
        if (!pressed) return;
      }
    }

    if (config.keys?.length) {
      const key = (event as KeyboardEvent).key;
      if (!config.keys.includes(key)) return;
    }

    if (config.stop) event.stopPropagation();
    if (config.prevent) event.preventDefault();

    return Reflect.apply(handler, this, [event]);
  };
}

// ---------------------------------------------------------------------------
// Attribute / property bindings
// ---------------------------------------------------------------------------

/**
 * Run several bindings from one effect instead of one each.
 *
 * An effect is the dominant per-row cost — roughly 1.6 kB retained apiece,
 * against 31 bytes for a signal and 105 for a scope — and a list row commonly
 * has three. Sharing one effect between them trades that for coarser
 * invalidation: any dependency of any binding in the group re-runs all of
 * them.
 *
 * That is cheaper than it sounds, because each binding still compares its own
 * value and writes to the DOM only when it changed; a re-run that finds
 * nothing different costs an accessor call and a comparison. It is not free,
 * though: a signal read by one binding now wakes the others, so a group is
 * worth it where the bindings share their dependencies — the cells of a row —
 * and not where they are independent.
 *
 * Nested `insert`, `each` and `branch` are unaffected: they build their own
 * effects directly rather than through `bind`, which is what keeps a row's
 * children from being swallowed into its parent's group.
 */
export function group(build: () => void): void {
  const updates: (() => void)[] = [];
  const previous = collecting;
  collecting = updates;
  try {
    build();
  } finally {
    collecting = previous;
  }

  if (updates.length === 0) return;
  // One binding gains nothing from the indirection.
  if (updates.length === 1) {
    renderEffect(updates[0]!);
    return;
  }
  renderEffect(() => {
    for (let i = 0; i < updates.length; i++) updates[i]!();
  });
}

function bind<T>(
  accessor: MaybeAccessor<T>,
  apply: (value: T) => void,
  /** The node this binding writes to, for the tools; see `declareTarget`. */
  owner?: Node,
): void {
  if (typeof accessor !== 'function') {
    apply(accessor as T);
    return;
  }
  // `first` matters because the initial value may legitimately be undefined,
  // which would otherwise be indistinguishable from "unchanged".
  let previous: T | undefined;
  let first = true;
  const update = (): void => {
    const value = (accessor as Accessor<T>)();
    if (first || !Object.is(value, previous)) {
      first = false;
      previous = value;
      apply(value);
    }
  };

  if (collecting) {
    // A grouped row shares one effect between several bindings, so no single
    // node owns it. Declaring one here would name the last binding's element
    // for every binding in the row.
    collecting.push(update);
    return;
  }
  if (__VOLT_DEV__) declareTarget(owner);
  renderEffect(update);
}

export function bindAttr(el: Element, name: string, accessor: MaybeAccessor<unknown>): void {
  bind(accessor, (value) => setAttribute(el, name, value), el);
}

export function bindProp(el: Element, name: string, accessor: MaybeAccessor<unknown>): void {
  bind(accessor, (value) => {
    (el as unknown as Record<string, unknown>)[name] = value;
  }, el);
}

/** Prefer the IDL property when the element actually has one. */
export function bindDynamic(el: Element, name: string, accessor: MaybeAccessor<unknown>): void {
  bind(accessor, (value) => {
    if (name in el) {
      (el as unknown as Record<string, unknown>)[name] = value;
    } else {
      setAttribute(el, name, value);
    }
  }, el);
}

function setAttribute(el: Element, name: string, value: unknown): void {
  if (value === null || value === undefined || value === false) el.removeAttribute(name);
  else el.setAttribute(name, value === true ? '' : String(value));
}

/**
 * Render content into a different container — `:portal`.
 *
 * With no virtual DOM there is nothing to reconcile across trees: a portal is
 * a node placed somewhere else. Context and disposal both follow the reactive
 * scope rather than the DOM, so content declared inside a provider still sees
 * it, and is still torn down with the component that declared it, wherever it
 * ended up on the page.
 *
 * `target` may be an element, a selector string, or null for `document.body`.
 * It is read once: re-homing live content is not something an overlay needs,
 * and supporting it would cost every portal a move path it never uses.
 *
 * On a page a server rendered, the content is already in the container: the
 * drain moved it there out of the `<template>` the response carried it in. So
 * this claims those nodes the way `hInsert` claims a hole's — the block builds
 * against them and `current` is seeded with them — and what used to be a
 * second copy appended on top of the server's is one tree that both sides
 * wrote. A page with nothing waiting takes neither branch and appends, which
 * is every client-rendered portal there has ever been.
 */
export function portal(target: unknown, build: () => unknown): void {
  const container = resolvePortalTarget(target);
  // Only a page that booted a server response has anything to adopt, and
  // `installed` is what says so — the drain is the only thing that relocates a
  // portal, and it is the first thing `hydrate` does.
  const adopted = installed === null ? null : adoptPortal(container);

  // Anchoring to a marker rather than appending means several portals into the
  // same container keep a stable order, and each removes only its own nodes.
  // Behind the adopted range, because that is the same invariant seen from the
  // other side: this portal's content sits immediately before its marker.
  const marker = document.createComment('');
  if (adopted === null) container.appendChild(marker);
  else container.insertBefore(marker, adopted[adopted.length - 1]!.nextSibling);

  // A single node is seeded as itself rather than as a list of one, so that a
  // block returning exactly the node it claimed short-circuits on identity —
  // the reason `hInsert` seeds the same way.
  let current: Current =
    adopted === null ? null : adopted.length === 1 ? adopted[0]! : adopted;

  // Portalled content is built here rather than inside an effect, so it would
  // otherwise land in an enclosing `group` — it belongs to itself.
  const previous = collecting;
  const enclosing = claiming;
  collecting = null;
  // The claim is replaced rather than left standing. The enclosing hole's
  // range does not contain this content — the server wrote it into a segment
  // of its own — so a block claiming from it would take a node belonging to
  // something else and stall the whole range reporting it.
  claiming =
    adopted === null ? null : { parent: container, nodes: adopted, index: 0, stalled: false };
  let built: unknown;
  try {
    built = build();
  } finally {
    collecting = previous;
    claiming = enclosing;
  }
  current = insertExpression(container, built, marker, current);

  onCleanup(() => {
    removeNodes(current);
    marker.remove();
  });
}

/**
 * The server's nodes for the next portal into this container, or null.
 *
 * Null is also what a container that has not been portalled into by a server
 * answers, and the call records that this portal built its own content — so a
 * record arriving after the page has hydrated knows it has nothing to add.
 */
function adoptPortal(container: Element): Node[] | null {
  const handoff = portalHandoff(container);
  const range = handoff.ranges.shift();
  if (range === undefined) {
    handoff.owed++;
    return null;
  }
  return range;
}

function resolvePortalTarget(target: unknown): Element {
  let resolved = target;
  while (typeof resolved === 'function') resolved = (resolved as Accessor<unknown>)();

  if (resolved === null || resolved === undefined) return document.body;
  if (resolved instanceof Element) return resolved;

  if (typeof resolved === 'string') {
    const found = document.querySelector(resolved);
    if (found) return found;
    throw new Error(
      `[volt] :portal target "${resolved}" matched no element. ` +
        'It has to exist before the component that portals into it mounts.',
    );
  }

  // V06 is the DOM runtime's own family. This was V0401 once, which is the
  // hydration state's — so a production report grouping by code filed a portal
  // mistake under a serialisation failure, and the documentation link sent both
  // to one page.
  throw voltError(
    'V0601',
    {},
    __VOLT_DEV__ && ':portal expects an element, a selector string, or nothing.',
  );
}

/**
 * Toggle a single class from a boolean.
 *
 * What `:class="{ danger: expr }"` compiles to when every key is written
 * literally, which is the overwhelmingly common shape. The general binding has
 * to allocate an object, normalise it to an array, and ask the element which
 * classes it already has; this compares one boolean and touches the DOM only
 * when the answer changes. In a list where one shared signal drives a class on
 * every row, that is the difference between every row doing DOM work on every
 * update and only the two rows that actually changed doing any.
 */
export function bindClassToggle(
  el: Element,
  name: string,
  accessor: MaybeAccessor<unknown>,
): void {
  // Undefined rather than false, so the first run always writes — the class
  // may be present in the template's own markup.
  let applied: boolean | undefined;

  bind(accessor, (value) => {
    const next = Boolean(value);
    if (next === applied) return;
    applied = next;
    el.classList.toggle(name, next);
  }, el);
}

export function bindClass(el: Element, accessor: MaybeAccessor<unknown>): void {
  // Only the classes this binding added are ever removed, so classes written
  // literally in the template survive every update.
  let applied: string[] = [];

  bind(accessor, (value) => {
    const next = normalizeClass(value);
    for (const cls of applied) if (!next.includes(cls)) el.classList.remove(cls);
    for (const cls of next) if (!el.classList.contains(cls)) el.classList.add(cls);
    applied = next;
  }, el);
}

/** Exported because a server composes the same string it would end up with. */
export function normalizeClass(value: unknown): string[] {
  if (!value) return [];
  if (typeof value === 'string') return value.split(/\s+/).filter(Boolean);
  if (Array.isArray(value)) return value.flatMap(normalizeClass);
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .filter(([, on]) => Boolean(on))
      .map(([cls]) => cls);
  }
  return [];
}

export function bindStyle(el: HTMLElement, accessor: MaybeAccessor<unknown>): void {
  let applied: Record<string, string> = {};

  bind(accessor, (value) => {
    const next = normalizeStyle(value);
    for (const key of Object.keys(applied)) {
      if (!(key in next)) el.style.removeProperty(key);
    }
    for (const [key, v] of Object.entries(next)) {
      if (applied[key] !== v) el.style.setProperty(key, v);
    }
    applied = next;
  }, el);
}

/** Exported for the same reason as `normalizeClass`. */
export function normalizeStyle(value: unknown): Record<string, string> {
  if (!value) return {};
  if (typeof value === 'string') {
    const out: Record<string, string> = {};
    for (const rule of value.split(';')) {
      const idx = rule.indexOf(':');
      if (idx === -1) continue;
      const key = rule.slice(0, idx).trim();
      if (key) out[key] = rule.slice(idx + 1).trim();
    }
    return out;
  }
  if (typeof value === 'object') {
    const out: Record<string, string> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === null || v === undefined || v === false) continue;
      out[hyphenate(key)] = String(v);
    }
    return out;
  }
  return {};
}

function hyphenate(name: string): string {
  return name.replaceAll(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

export function bindText(el: Element, accessor: MaybeAccessor<unknown>): void {
  bind(accessor, (value) => {
    const text = toDisplayString(value);
    const first = el.firstChild;
    // Patch the existing text node when there is exactly one, so a changing
    // value never detaches and recreates DOM.
    if (first !== null && first === el.lastChild && first.nodeType === Node.TEXT_NODE) {
      if ((first as Text).data !== text) (first as Text).data = text;
    } else {
      el.textContent = text;
    }
  }, el);
}

export function bindHtml(el: Element, accessor: MaybeAccessor<unknown>): void {
  bind(accessor, (value) => {
    el.innerHTML = value === null || value === undefined ? '' : String(value);
  }, el);
}

export function spread(el: Element, accessor: MaybeAccessor<Record<string, unknown>>): void {
  let applied: string[] = [];
  bind(accessor, (props) => {
    const next = props ?? {};
    for (const key of applied) if (!(key in next)) setAttribute(el, key, null);
    for (const [key, value] of Object.entries(next)) {
      if (key.startsWith('on') && typeof value === 'function') {
        el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
        continue;
      }
      if (key === 'class') bindClass(el, value);
      else if (key === 'style') bindStyle(el as HTMLElement, value);
      else if (key in el) (el as unknown as Record<string, unknown>)[key] = value;
      else setAttribute(el, key, value);
    }
    applied = Object.keys(next);
  }, el);
}

export function setRef(node: unknown, ctx: Record<string, unknown>, name: string): void {
  const existing = ctx[name];
  if (isWritableSignal(existing)) existing.set(node);
  else ctx[name] = node;

  onCleanup(() => {
    const current = ctx[name];
    if (isWritableSignal(current)) current.set(null);
    else if (ctx[name] === node) ctx[name] = null;
  });
}

// ---------------------------------------------------------------------------
// Two-way binding
// ---------------------------------------------------------------------------

export interface ModelModifiers {
  number?: boolean;
  trim?: boolean;
  lazy?: boolean;
}

export function writeModel(target: unknown, value: unknown, assign: () => void): void {
  if (isWritableSignal(target)) target.set(value);
  else assign();
}

/**
 * `:model="name"` yields the signal itself, not its value, so unwrap it.
 */
function readModel(accessor: Accessor<unknown>): unknown {
  const raw = accessor();
  return isSignal(raw) ? raw.get() : raw;
}

/*
 * One entry point per control instead of one that switches on a `kind` string.
 *
 * The compiler already knows which control it is looking at — it reads the tag
 * and the `type` attribute to decide — so a runtime switch re-decides at every
 * instantiation what the build settled at compile time, and makes the checkbox,
 * radio and select paths reachable from any template that binds a text input.
 * That was about 340 B of an app bundle spent on three controls the page does
 * not contain; `bundle-composition.test.ts` measures it on `examples/counter`.
 */

export function modelText(
  el: HTMLElement,
  accessor: Accessor<unknown>,
  setter: (value: unknown) => void,
  modifiers: ModelModifiers,
): void {
  const input = el as HTMLInputElement;
  renderEffect(() => {
    const value = toDisplayString(readModel(accessor));
    // Skip while the user is mid-edit, or the caret jumps to the end.
    if (input.value !== value) input.value = value;
  });

  on(input, modifiers.lazy ? 'change' : 'input', () => {
    let value: string | number = input.value;
    if (modifiers.trim) value = value.trim();
    if (modifiers.number) {
      const parsed = Number.parseFloat(value);
      value = Number.isNaN(parsed) ? value : parsed;
    }
    setter(value);
  });
}

export function modelCheckbox(
  el: HTMLElement,
  accessor: Accessor<unknown>,
  setter: (value: unknown) => void,
): void {
  const input = el as HTMLInputElement;
  renderEffect(() => {
    input.checked = Boolean(readModel(accessor));
  });
  on(input, 'change', () => setter(input.checked));
}

export function modelRadio(
  el: HTMLElement,
  accessor: Accessor<unknown>,
  setter: (value: unknown) => void,
): void {
  const input = el as HTMLInputElement;
  renderEffect(() => {
    input.checked = readModel(accessor) === input.value;
  });
  on(input, 'change', () => {
    if (input.checked) setter(input.value);
  });
}

export function modelSelect(
  el: HTMLElement,
  accessor: Accessor<unknown>,
  setter: (value: unknown) => void,
): void {
  const select = el as HTMLSelectElement;
  renderEffect(() => {
    select.value = toDisplayString(readModel(accessor));
  });
  on(select, 'change', () => setter(select.value));
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

export function toDisplayString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value) ?? '';
    } catch {
      return String(value);
    }
  }
  return String(value);
}

export { Signal, batch, effect, renderEffect, onCleanup, createRoot, untrack };
