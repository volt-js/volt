/**
 * The instrumentation a developer-tools panel reads, and nothing more.
 *
 * There is no UI here and no extension: this is the model side of one, exposed
 * so that a panel, a test, or an error reporter can all ask the same
 * questions. Four of them, which are the four the roadmap asks for:
 *
 *   - `componentTree()` — instances, their props and their scopes
 *   - `signalGraph()`   — nodes and edges, and which of them are live
 *   - `updates()`       — which write woke which effect
 *   - `effectStats()`, `flushes()` — run counts, durations, flush timings
 *
 * Every entry point is reached only from inside an `if (__VOLT_DEV__)` block,
 * so a production build drops the call sites, then this module, then the
 * listener it installs. `test/devtools.test.ts` proves that on built bytes
 * rather than on the promise.
 *
 * The signal graph is walked with `Signal.subtle.introspectSources`,
 * `introspectSinks`, `hasSinks` and `hasSources`. Those four exist for exactly
 * this and were nearly cut for their ~100 B; nothing else here reaches into
 * the graph's internals, which is the point of them.
 *
 * What is collected always, and what costs nothing until asked:
 *
 *   always   the component tree, where each effect was declared, and the
 *            writes that woke an effect this turn
 *   session  run counts, durations, flush records, the update log
 *
 * The split is deliberate. The tree is a handful of objects per screen, and
 * the wakes are two array slots each, which a development build can carry; a
 * record and a timing per effect run is not, because building a list row is
 * effect construction and this must not be the reason a dev build feels slow.
 * What is always on is what an effect that throws needs to name the write
 * behind it, which is not something anyone can be asked to turn on first.
 *
 * Always means always in a development build, and nowhere else. The roadmap
 * asks for one shape that serves the panel and a production crash report
 * alike; `__VOLT_DEV__` makes those two exclusive, because the guard keeping a
 * null check off every signal write in production is the same guard that
 * removes the call telling this module the write happened. The panel was
 * chosen. A production build reports what it reported before — the error and
 * its stack, with `explain` never asked and no causality to add.
 */

import type { Scope } from '@voltdev/reactivity';
import {
  requestState,
  setDevListener,
  type DevListener,
  type EffectPhase,
} from '@voltdev/reactivity';
// The lowered spelling, as everywhere else in the framework: reaching through
// the `Signal` namespace object retains every member of it.
import {
  Computed as ComputedSignal,
  State as StateSignal,
  Watcher as WatcherNode,
  hasSinks,
  hasSources,
  introspectSinks,
  introspectSources,
  untrack,
} from '@voltdev/reactivity/signals';

// ---------------------------------------------------------------------------
// What the tools see
// ---------------------------------------------------------------------------

export interface ComponentNode {
  id: number;
  /** The class name, as written. */
  name: string;
  /** The tag it answers to in a template. */
  selector: string;
  /** The live instance, for a panel that wants to read more off it. */
  instance: object | null;
  /**
   * The scope that owns it: disposing this is what tears the instance down.
   * Null only for a component built outside any root.
   */
  scope: Scope | null;
  /** Declared props by their template-facing name, signals unwrapped. */
  props: Record<string, unknown>;
  children: ComponentNode[];
}

export type SignalKind = 'state' | 'computed' | 'effect' | 'watcher';

export interface SignalNode {
  id: number;
  kind: SignalKind;
  label: string;
  /** Something depends on this — `Signal.subtle.hasSinks`. */
  observed: boolean;
  /** This depends on something — `Signal.subtle.hasSources`. */
  observing: boolean;
  /** Current value, for a state or a computed. Effects have none. */
  value?: unknown;
  sources: number[];
  sinks: number[];
  /** The live node, so a panel can subscribe to or write to it. */
  node: object;
}

export interface Write {
  /** Monotonic, so two records can be told apart and ordered. */
  seq: number;
  /**
   * The signal written. Name it with `labelOf` — naming builds a string, and
   * a write is on the hot path of every interaction while reading one of
   * these records is not.
   */
  signal: object;
  previous: unknown;
  value: unknown;
  time: number;
  /** Where the write came from, when the session asked for stacks. */
  stack?: string;
}

export interface UpdateRecord {
  seq: number;
  /** The effect that ran, identified as it is in the signal graph. */
  effect: number;
  /** Resolved when read, so a record nobody opens costs nothing to name. */
  readonly effectLabel: string;
  phase: EffectPhase;
  /** The component the effect belongs to, when it was created under one. */
  component: string | null;
  /**
   * The writes that woke it, oldest first. Empty for an effect's first run,
   * which nothing woke.
   */
  causes: Write[];
  /**
   * How the nearest cause reached the effect: signal ids from the written
   * signal down to the effect, computeds included. One id — the written
   * signal alone — when the effect read it directly, and empty only for a
   * first run, which no write caused.
   */
  through: number[];
  time: number;
  durationMs: number;
}

export interface EffectStat {
  id: number;
  label: string;
  phase: EffectPhase;
  component: string | null;
  runs: number;
  totalMs: number;
  lastMs: number;
  maxMs: number;
}

export interface FlushRecord {
  time: number;
  durationMs: number;
  /** Passes over the lanes. More than one means an effect wrote a signal. */
  passes: number;
  forcedLayouts: number;
  /** Effect runs the flush drained. */
  effects: number;
}

export interface RecordOptions {
  /** How many update records to keep. Oldest are dropped. */
  limit?: number;
  /**
   * Capture a stack per write. Off by default: it is the one thing here that
   * costs on the write path rather than on the read.
   */
  stacks?: boolean;
  /**
   * Keep this many writes so a session can step back through them.
   *
   * Off by default, and for two reasons rather than one. It turns every write
   * into a record, where otherwise a write that wakes nothing never becomes
   * an object at all. And it holds `previous` — so the values a page has
   * moved on from stay reachable, which is exactly what stepping back needs
   * and exactly what a long session should not accumulate unasked.
   */
  history?: number;
}

export interface Devtools {
  /** Bumped when a field of any of these shapes changes meaning. */
  readonly version: number;

  componentTree(): ComponentNode[];
  componentFor(instance: object): ComponentNode | null;

  /**
   * The reachable graph. Seeded from a component instance, a signal, or —
   * with no argument — every signal every registered component holds.
   */
  signalGraph(from?: object): SignalNode[];

  /** Give a signal a name a panel can show. */
  label(signal: object, name: string): void;
  /** What a panel shows for a node: its name, or its kind and id. */
  labelOf(node: object): string;

  startRecording(options?: RecordOptions): void;
  stopRecording(): void;
  readonly recording: boolean;
  updates(): UpdateRecord[];
  /** One line naming the writer, for a log line or an error report. */
  describeUpdate(update: UpdateRecord): string;
  /**
   * Called with each update while a session is recording.
   *
   * The channel an error reporter takes, rather than a panel-shaped snapshot:
   * the record that answers "why did this update" is the same one that makes a
   * crash report actionable, so it is one shape and one hook. The half of that
   * needing no session is already wired — an effect that throws names the
   * write that woke it in its message.
   */
  subscribe(listener: (update: UpdateRecord) => void): () => void;

  /**
   * The writes kept, oldest first, when a session asked for history.
   *
   * `at` is where the page currently stands in them: the index of the last
   * write that has been applied, and `history().length - 1` when the page is
   * where it would be if nothing had travelled.
   */
  history(): { writes: readonly Write[]; at: number };
  /**
   * Put every signal back the way it stood after write `index`, or before the
   * first one at `-1`. Returns false if there is no such position.
   *
   * This restores *state*, which is not the same as restoring the page.
   * Effects re-run, because that is what a signal changing means here — so a
   * step back through a write that sent a request sends no second request,
   * while a step back through one that filtered a list filters it again. That
   * asymmetry is a property of stepping through a reactive graph rather than a
   * replay log, and a panel should say so rather than imply otherwise.
   */
  travelTo(index: number): boolean;

  effectStats(): EffectStat[];
  flushes(): FlushRecord[];

  /** Drop everything collected. The tree and live effects are kept. */
  reset(): void;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface ComponentRecord {
  id: number;
  name: string;
  selector: string;
  instance: object | null;
  scope: Scope | null;
  props: readonly PropName[];
  parent: ComponentRecord | null;
  children: ComponentRecord[];
}

/** What `@Prop` recorded, structurally — devtools does not import its type. */
interface PropName {
  property: string;
  alias: string;
}

interface EffectRecord {
  node: object;
  phase: EffectPhase;
  component: string | null;
  runs: number;
  totalMs: number;
  lastMs: number;
  maxMs: number;
}

interface RunFrame {
  record: EffectRecord;
  causes: Write[];
  start: number;
}

/**
 * Writes remembered per effect until it runs.
 *
 * Bounded because this list is kept whether or not a session is recording —
 * an effect nothing has re-run yet would otherwise accumulate every write
 * aimed at it, holding each of those values alive.
 */
const MAX_CAUSES = 8;
const DEFAULT_LIMIT = 200;
const MAX_FLUSHES = 60;
const MAX_WAKE_LOG = 8_192;
/** A graph walk stops here rather than hanging a panel on a huge app. */
const MAX_GRAPH_NODES = 5_000;

let hub: Devtools | null = null;

const ids = new WeakMap<object, number>();
const labels = new WeakMap<object, string>();
/**
 * Effect and write, in pairs, for every wake since the last flush ended.
 *
 * The always-on half of "why did this update", and flat because of it: a
 * write reaching an effect costs one push here, where a map keyed by effect
 * cost several times that on a path every interaction runs. Only `explain`
 * reads it, and only when an effect has thrown, so a scan is the right way
 * round to pay.
 */
let wakeLog: object[] = [];
/** The same, indexed per effect, kept only while a session is recording. */
let causes = new WeakMap<object, Write[]>();
const effects = new Map<object, EffectRecord>();
/**
 * The component each effect was created under, kept whether or not a session
 * is recording.
 *
 * Only the construction stack knows this, and it is unwound long before
 * anything runs. Collecting it on the session's terms would mean a panel
 * opened after the page loaded — which is every panel — saw `null` for every
 * effect that already existed. One weak entry per effect declared inside a
 * component is the whole of what that costs.
 */
const componentOfEffect = new WeakMap<object, string>();
const componentsByInstance = new WeakMap<object, ComponentRecord>();

/**
 * The mounted roots — one set per server request, one per process elsewhere.
 *
 * A browser has a single page, so module scope is the right home for this. A
 * server has one process and many requests, nothing disposes a request's
 * scopes, and a module-level tree would therefore hand each request every
 * earlier request's instances, props and scopes — readable, and alive. This
 * is exactly the split `requestState` exists to make.
 */
const ROOTS = Symbol('volt.devtools.roots');
function roots(): ComponentRecord[] {
  return requestState<ComponentRecord[]>(ROOTS, () => []);
}

let stack: ComponentRecord[] = [];
let updateLog: UpdateRecord[] = [];
let flushLog: FlushRecord[] = [];
let subscribers: ((update: UpdateRecord) => void)[] = [];
let runStack: RunFrame[] = [];

let nextId = 1;
let writeSeq = 0;
let updateSeq = 0;
let recording = false;
let captureStacks = false;

/**
 * The writes kept for stepping, oldest first, and where the page stands in
 * them. `travelling` suppresses recording while a step is being applied, so
 * putting a signal back does not itself become a write to step through.
 */
let historyLimit = 0;
let history: Write[] = [];
let historyAt = -1;
let travelling = false;
let limit = DEFAULT_LIMIT;

let flushStart = 0;
let flushRuns = 0;

/**
 * The write being propagated, materialised on the first effect it wakes.
 *
 * A write that nothing observes is the common case — a signal read by no
 * effect yet, or set twice in a batch — so the record is not built until
 * something is actually woken by it. The three fields below are what the
 * graph handed over; `pending` is the record they become.
 */
let pendingSignal: object | null = null;
let pendingPrevious: unknown;
let pendingValue: unknown;
let pending: Write | null = null;

function now(): number {
  return performance.now();
}

function idOf(node: object): number {
  let id = ids.get(node);
  if (id === undefined) ids.set(node, (id = nextId++));
  return id;
}

// ---------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------

function kindOf(node: object): SignalKind {
  if (node instanceof StateSignal) return 'state';
  if (node instanceof ComputedSignal) {
    // An effect is a computed a watcher watches — the one distinction the
    // public surface can draw, and it needs no access to the node's fields.
    const watched = introspectSinks(node).some((sink) => sink instanceof WatcherNode);
    return watched ? 'effect' : 'computed';
  }
  return 'watcher';
}

function labelOf(node: object): string {
  const named = labels.get(node);
  if (named) return named;
  const effectRecord = effects.get(node);
  if (effectRecord) {
    const owner = effectRecord.component ? effectRecord.component + ' ' : '';
    return `${owner}${effectRecord.phase} effect #${idOf(node)}`;
  }
  return `${kindOf(node)}#${idOf(node)}`;
}

/**
 * Name a component's signals after the fields holding them.
 *
 * Signals carry no name of their own, and `state#7` tells a reader nothing.
 * Own enumerable fields are exactly where a component keeps its state, and by
 * the time an instance is registered its field initializers have all run.
 */
function nameSignals(record: ComponentRecord): void {
  const instance = record.instance;
  if (!instance) return;
  for (const key of Object.keys(instance)) {
    const value = (instance as Record<string, unknown>)[key];
    if (value instanceof StateSignal || value instanceof ComputedSignal) {
      if (!labels.has(value)) labels.set(value, `${record.name}.${key}`);
    }
  }
}

/** A value shortened to something a panel row or a log line can hold. */
function preview(value: unknown): string {
  if (typeof value === 'string') {
    return JSON.stringify(value.length > 40 ? value.slice(0, 39) + '…' : value);
  }
  if (typeof value === 'function') return `ƒ ${value.name || 'anonymous'}`;
  if (Array.isArray(value)) return `Array(${value.length})`;
  if (typeof Node !== 'undefined' && value instanceof Node) {
    return `<${value.nodeName.toLowerCase()}>`;
  }
  if (value && typeof value === 'object') return value.constructor?.name ?? 'Object';
  return String(value);
}

/** A value read without subscribing the reader, or the error it threw. */
function peek(value: unknown): unknown {
  if (value instanceof StateSignal || value instanceof ComputedSignal) {
    try {
      return untrack(() => (value as { get(): unknown }).get());
    } catch (err) {
      return err;
    }
  }
  return value;
}

// ---------------------------------------------------------------------------
// Component tree — called from component.ts, dev only
// ---------------------------------------------------------------------------

/**
 * @internal Open a component's registration, before its constructor runs.
 *
 * Before, not after, so that an effect declared in a field initializer is
 * attributed to the component that declares it rather than to its parent.
 */
export function enterComponent(
  name: string,
  selector: string,
  props: Iterable<PropName>,
  scope: Scope | null,
): object {
  const parent = stack.length > 0 ? stack[stack.length - 1]! : null;
  const record: ComponentRecord = {
    id: nextId++,
    name,
    selector,
    instance: null,
    scope,
    props: [...props],
    parent,
    children: [],
  };
  (parent ? parent.children : roots()).push(record);
  stack.push(record);
  return record;
}

/** @internal The instance exists; index it and name what it holds. */
export function attachComponent(handle: object, instance: object): void {
  const record = handle as ComponentRecord;
  record.instance = instance;
  componentsByInstance.set(instance, record);
  nameSignals(record);
}

/** @internal Close the registration. Runs even if the render threw. */
export function exitComponent(handle: object): void {
  const index = stack.lastIndexOf(handle as ComponentRecord);
  if (index !== -1) stack.length = index;
}

/**
 * @internal Forget a component whose scope has been disposed.
 *
 * Its children are adopted by its parent rather than dropped: a child's own
 * disposal may come later, and a node hanging off nothing would vanish from
 * the tree while it is still on screen.
 */
export function removeComponent(handle: object): void {
  const record = handle as ComponentRecord;
  const siblings = record.parent ? record.parent.children : roots();
  const at = siblings.indexOf(record);
  if (at !== -1) siblings.splice(at, 1, ...record.children);
  for (const child of record.children) child.parent = record.parent;
  record.children = [];
  if (record.instance) componentsByInstance.delete(record.instance);
}

function toNode(record: ComponentRecord): ComponentNode {
  const instance = record.instance as Record<string, unknown> | null;
  const props: Record<string, unknown> = {};
  if (instance) {
    for (const prop of record.props) props[prop.alias] = peek(instance[prop.property]);
  }
  return {
    id: record.id,
    name: record.name,
    selector: record.selector,
    instance: record.instance,
    scope: record.scope,
    props,
    children: record.children.map(toNode),
  };
}

// ---------------------------------------------------------------------------
// Signal graph
// ---------------------------------------------------------------------------

function seedsFor(from?: object): object[] {
  if (from === undefined) {
    const seeds: object[] = [];
    for (const record of allComponents(roots())) collectSignals(record.instance, seeds);
    for (const node of effects.keys()) seeds.push(node);
    return seeds;
  }
  const isNode =
    from instanceof StateSignal || from instanceof ComputedSignal || from instanceof WatcherNode;
  if (isNode) return [from];
  const seeds: object[] = [];
  collectSignals(from, seeds);
  return seeds;
}

function collectSignals(instance: object | null, into: object[]): void {
  if (!instance) return;
  for (const key of Object.keys(instance)) {
    const value = (instance as Record<string, unknown>)[key];
    if (value instanceof StateSignal || value instanceof ComputedSignal) into.push(value);
  }
}

function* allComponents(records: ComponentRecord[]): Generator<ComponentRecord> {
  for (const record of records) {
    yield record;
    yield* allComponents(record.children);
  }
}

function sourcesOf(node: object): object[] {
  const consumer = node instanceof ComputedSignal || node instanceof WatcherNode;
  return consumer ? introspectSources(node) : [];
}

function sinksOf(node: object): object[] {
  return node instanceof StateSignal || node instanceof ComputedSignal ? introspectSinks(node) : [];
}

function buildGraph(from?: object): SignalNode[] {
  const seen = new Map<object, SignalNode>();
  const queue = seedsFor(from);

  for (let i = 0; i < queue.length && seen.size < MAX_GRAPH_NODES; i++) {
    const node = queue[i]!;
    if (seen.has(node)) continue;

    const kind = kindOf(node);
    const sources = sourcesOf(node);
    const sinks = sinksOf(node);
    const entry: SignalNode = {
      id: idOf(node),
      kind,
      label: labelOf(node),
      observed: node instanceof WatcherNode ? false : hasSinks(node as StateSignal<unknown>),
      observing: node instanceof StateSignal ? false : hasSources(node as ComputedSignal<unknown>),
      sources: sources.map(idOf),
      sinks: sinks.map(idOf),
      node,
    };
    // An effect's value is the effect running. Reading it would make
    // inspecting the graph change the program it is inspecting.
    if (kind === 'state' || kind === 'computed') entry.value = peek(node);
    seen.set(node, entry);

    for (const next of sources) if (!seen.has(next)) queue.push(next);
    for (const next of sinks) if (!seen.has(next)) queue.push(next);
  }

  return [...seen.values()];
}

/**
 * How a write reached an effect: the shortest chain of sources back to it.
 *
 * Read from the effect's dependencies rather than recorded during
 * propagation, because the graph already holds the answer and paying for it
 * on every write to build a trail nobody may ask for is the wrong trade.
 */
function pathFrom(effect: object, signal: object): number[] {
  const previous = new Map<object, object | null>([[effect, null]]);
  const queue: object[] = [effect];

  for (let i = 0; i < queue.length && i < MAX_GRAPH_NODES; i++) {
    const node = queue[i]!;
    if (node === signal) {
      const path: number[] = [];
      let step: object | null = node;
      while (step && step !== effect) {
        path.push(idOf(step));
        step = previous.get(step) ?? null;
      }
      // Written signal first, then whatever relayed it down to the effect.
      return path;
    }
    for (const source of sourcesOf(node)) {
      if (!previous.has(source)) {
        previous.set(source, node);
        queue.push(source);
      }
    }
  }
  return [];
}

// ---------------------------------------------------------------------------
// The listener
// ---------------------------------------------------------------------------

function materialise(): Write {
  if (pending) return pending;
  const signal = pendingSignal!;
  pending = {
    seq: ++writeSeq,
    signal,
    previous: pendingPrevious,
    value: pendingValue,
    time: now(),
    stack: captureStacks ? trimStack() : undefined,
  };
  return pending;
}

/** The caller's frames, with the framework's own removed from the top. */
function trimStack(): string | undefined {
  const lines = new Error().stack?.split('\n') ?? [];
  return lines
    .filter((line) => !line.includes('devtools') && !line.includes('graph.'))
    .slice(1, 6)
    .join('\n');
}

function effectRecord(node: object, phase: EffectPhase): EffectRecord {
  let record = effects.get(node);
  if (!record) {
    effects.set(
      node,
      (record = {
        node,
        phase,
        component: componentOfEffect.get(node) ?? null,
        runs: 0,
        totalMs: 0,
        lastMs: 0,
        maxMs: 0,
      }),
    );
  }
  return record;
}

const listener: DevListener = {
  write(signal, previous, value) {
    pendingSignal = signal;
    pendingPrevious = previous;
    pendingValue = value;
    pending = null;

    if (historyLimit === 0 || travelling) return;
    // A write made after stepping back abandons what was ahead: the page has
    // taken a different turn, and keeping the old branch would offer a
    // "forward" that leads somewhere this state never came from.
    if (historyAt < history.length - 1) history.length = historyAt + 1;
    history.push(materialise());
    if (history.length > historyLimit) history.shift();
    historyAt = history.length - 1;
  },

  wake(effect) {
    const write = materialise();
    wakeLog.push(effect, write);
    // A turn that writes without ever flushing — a batch left open — would
    // otherwise grow this without bound.
    if (wakeLog.length > MAX_WAKE_LOG) wakeLog.splice(0, MAX_WAKE_LOG / 2);
    if (!recording) return;

    let list = causes.get(effect);
    if (!list) causes.set(effect, (list = []));
    // One write reaching an effect down two paths is one cause, not two.
    if (list.length > 0 && list[list.length - 1]!.seq === write.seq) return;
    if (list.length === MAX_CAUSES) list.shift();
    list.push(write);
  },

  effectCreated(effect, phase) {
    // Ahead of the session check: where an effect came from can only be read
    // now, while the component that declared it is still on the stack.
    const owner = stack.length > 0 ? stack[stack.length - 1]!.name : null;
    if (owner) componentOfEffect.set(effect, owner);
    if (!recording) return;
    effectRecord(effect, phase);
  },

  effectDisposed(effect) {
    // Dropped rather than kept as history: the record holds the node, and the
    // node holds the closure and whatever DOM it captured.
    effects.delete(effect);
  },

  runStarted(effect, phase) {
    if (!recording) return;
    runStack.push({
      record: effectRecord(effect, phase),
      // Copied now: the run may write signals that wake this same effect.
      causes: [...(causes.get(effect) ?? [])],
      start: now(),
    });
  },

  runEnded(effect) {
    const frame = runStack.length > 0 ? runStack[runStack.length - 1] : undefined;
    if (!frame || frame.record.node !== effect) return;
    runStack.pop();

    const durationMs = now() - frame.start;
    const record = frame.record;
    record.runs++;
    record.totalMs += durationMs;
    record.lastMs = durationMs;
    if (durationMs > record.maxMs) record.maxMs = durationMs;
    flushRuns++;

    const nearest = frame.causes[frame.causes.length - 1];
    const update: UpdateRecord = {
      seq: ++updateSeq,
      effect: idOf(effect),
      get effectLabel() {
        return labelOf(effect);
      },
      phase: record.phase,
      component: record.component,
      causes: frame.causes,
      through: nearest ? pathFrom(effect, nearest.signal) : [],
      time: frame.start,
      durationMs,
    };
    updateLog.push(update);
    if (updateLog.length > limit) updateLog.shift();
    for (const subscriber of subscribers) subscriber(update);

    // This run has accounted for them; the next one starts empty.
    causes.get(effect)?.splice(0);
  },

  flushStarted() {
    if (!recording) return;
    flushStart = now();
    flushRuns = 0;
  },

  flushEnded(passes, forcedLayouts) {
    // The log spans one turn: the writes that provoked this flush, and any the
    // flush itself made. Past that they explain nothing.
    wakeLog.length = 0;
    if (!recording || passes === 0) return;
    flushLog.push({
      time: flushStart,
      durationMs: now() - flushStart,
      passes,
      forcedLayouts,
      effects: flushRuns,
    });
    if (flushLog.length > MAX_FLUSHES) flushLog.shift();
  },

  explain(effect) {
    const written: string[] = [];
    let seen = 0;
    // Newest first, and stopping early: an effect woken by a hundred writes
    // is not made clearer by naming all hundred in an error message.
    for (let i = wakeLog.length - 2; i >= 0 && written.length < 3; i -= 2) {
      if (wakeLog[i] !== effect) continue;
      const write = wakeLog[i + 1] as Write;
      if (write.seq === seen) continue;
      seen = write.seq;
      written.push(
        `${labelOf(write.signal)} (${preview(write.previous)} → ${preview(write.value)})`,
      );
    }
    if (written.length === 0) return null;
    return 'woken by ' + written.reverse().join(', ');
  },
};

// ---------------------------------------------------------------------------
// Installation
// ---------------------------------------------------------------------------

const api: Devtools = {
  version: 1,

  componentTree: () => roots().map(toNode),
  componentFor: (instance) => {
    const record = componentsByInstance.get(instance);
    return record ? toNode(record) : null;
  },

  signalGraph: (from) => buildGraph(from),
  label: (signal, name) => {
    labels.set(signal, name);
  },
  labelOf,

  startRecording(options) {
    limit = options?.limit ?? DEFAULT_LIMIT;
    captureStacks = options?.stacks ?? false;
    historyLimit = options?.history ?? 0;
    if (historyLimit === 0) {
      history = [];
      historyAt = -1;
    }
    recording = true;
  },
  stopRecording() {
    recording = false;
    historyLimit = 0;
    runStack = [];
    // Replaced rather than emptied — there is no walking a WeakMap — so that
    // the next session cannot open with causes left over from this one.
    causes = new WeakMap();
  },
  get recording() {
    return recording;
  },
  updates: () => [...updateLog],
  history: () => ({ writes: [...history], at: historyAt }),

  travelTo(index) {
    if (index < -1 || index >= history.length) return false;
    if (index === historyAt) return true;

    // Suppressed rather than filtered afterwards: a restore reaches the same
    // listener as any other write, and recording it would append the
    // undoing of a step to the very list being stepped through.
    travelling = true;
    try {
      if (index < historyAt) {
        // Backwards, newest first, so a signal written twice ends on the
        // value it held before the earlier of the two.
        for (let i = historyAt; i > index; i--) {
          const write = history[i]!;
          (write.signal as StateSignal<unknown>).set(write.previous);
        }
      } else {
        for (let i = historyAt + 1; i <= index; i++) {
          const write = history[i]!;
          (write.signal as StateSignal<unknown>).set(write.value);
        }
      }
    } finally {
      travelling = false;
    }

    historyAt = index;
    return true;
  },

  describeUpdate,
  subscribe(listenerFn) {
    subscribers.push(listenerFn);
    return () => {
      const at = subscribers.indexOf(listenerFn);
      if (at !== -1) subscribers.splice(at, 1);
    };
  },

  effectStats: () =>
    [...effects.values()]
      // An effect declared during the session but not yet run has nothing to
      // report but zeroes, and a panel sorting by cost would rank it above
      // whatever is actually slow.
      .filter((record) => record.runs > 0)
      .map((record) => ({
        id: idOf(record.node),
        label: labelOf(record.node),
        phase: record.phase,
        component: record.component,
        runs: record.runs,
        totalMs: record.totalMs,
        lastMs: record.lastMs,
        maxMs: record.maxMs,
      }))
      .sort((a, b) => b.runs - a.runs),

  flushes: () => [...flushLog],

  reset() {
    updateLog = [];
    flushLog = [];
    runStack = [];
    wakeLog = [];
    history = [];
    historyAt = -1;
    causes = new WeakMap();
    updateSeq = 0;
    for (const record of effects.values()) {
      record.runs = 0;
      record.totalMs = 0;
      record.lastMs = 0;
      record.maxMs = 0;
    }
  },
};

function describeUpdate(update: UpdateRecord): string {
  if (update.causes.length === 0) return `${update.effectLabel} ran for the first time`;
  const causeText = update.causes
    .map(
      (write) =>
        `${labelOf(write.signal)} ${preview(write.previous)} → ${preview(write.value)}`,
    )
    .join(', ');
  return `${update.effectLabel} ran because ${causeText}`;
}

/**
 * Start listening. Idempotent, and called from the component layer's module
 * scope so the tools are attached before an application's first effect runs,
 * whichever entry point it imported.
 */
export function install(): Devtools {
  // Set every time rather than only on the first call, so that a session that
  // detached the listener — a test measuring what the hooks cost, most of all
  // — can put it back by asking for the tools again.
  setDevListener(listener);
  if (hub) return hub;
  hub = api;
  // The name a browser extension looks for. It is deliberately the only thing
  // published globally: everything else is reached through this object.
  (globalThis as Record<string, unknown>)['__VOLT_DEVTOOLS__'] = api;
  return api;
}

/** The tools, installing them if they are not yet listening. */
export function devtools(): Devtools {
  return install();
}
