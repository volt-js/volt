/**
 * The developer-tools instrumentation.
 *
 * Four things have to be true and none of them can be taken on trust: the
 * hooks describe a component that is actually on screen, "why did this update"
 * names the write that really woke the effect rather than the most recent
 * write anywhere, the numbers under "what did it cost" are measurements rather
 * than shapes, and a production build contains none of it. The last one is
 * asserted against built bytes — the claim is about what ships, so reading the
 * source would prove nothing.
 *
 * Where a number is asserted it is asserted exactly, against a stubbed clock
 * where the real one would make that flaky. A bound a constant satisfies —
 * `durationMs >= 0`, `runs >= 2` — is not a measurement of anything.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { build } from 'esbuild';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { compileTemplate } from '@voltdev/core/jit';
import {
  Component,
  Prop,
  Signal,
  createRequestScope,
  effect,
  flushSync,
  measureEffect,
  mount,
  settleRequest,
} from '@voltdev/core';
// Not re-exported by the framework entry, because an application disposes a
// scope by unmounting or by the root that made it. A panel is handed the scope
// itself, which is what the test below is about.
import { disposeScope, runWithScope, setDevListener } from '@voltdev/reactivity';
import {
  devtools,
  type ComponentNode,
  type SignalNode,
  type UpdateRecord,
} from '@voltdev/core/devtools';

const tools = devtools();

@Component({ selector: 'v-badge', render: compileTemplate(`<em>{ text.get() }</em>`) })
class Badge {
  // Aliased deliberately: a prop whose alias equalled its property name could
  // not tell a tree keyed by the template-facing name from one keyed by the
  // field, which is the distinction `props` claims to make.
  @Prop({ alias: 'caption' }) text = new Signal.State('none');
}

@Component({
  selector: 'v-counter',
  imports: [Badge],
  render: compileTemplate(
    `<div><span>{ doubled.get() }</span><v-badge :caption="label.get()"></v-badge></div>`,
  ),
})
class Counter {
  count = new Signal.State(2);
  doubled = new Signal.Computed(() => this.count.get() * 2);
  label = new Signal.State('hi');
}

@Component({
  selector: 'v-list',
  render: compileTemplate(`<ul><li :for="row in rows.get()" :key="row">{ row }</li></ul>`),
})
class List {
  rows = new Signal.State(['a', 'b']);
}

// `data-tip` rather than `title`: an attribute with no IDL property behind it
// is set through `setAttribute`, which is the binding shape this is about.
@Component({ selector: 'v-tagged', render: compileTemplate(`<p :data-tip="tip.get()">t</p>`) })
class Tagged {
  tip = new Signal.State('first');
}

@Component({ selector: 'v-overlay', render: compileTemplate(`<i>overlay</i>`) })
class Overlay {}

@Component({ selector: 'v-portal', render: compileTemplate(`<div>portal</div>`) })
class Portal {
  // A modal put elsewhere in the document: declared inside this component, so
  // the tools record it as a child of it, but owned by a root of its own, so
  // it outlives this component's scope. That is the only way the two trees —
  // where a component was declared, and which scope disposes it — come apart.
  overlay = runWithScope(null, () => mount(Overlay, document.querySelector('#overlay')!));
}

let host: HTMLElement;
let unmount: (() => void) | null = null;
let counter: Counter;

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  host = document.querySelector('#app')!;
  tools.stopRecording();
  tools.reset();
});

afterEach(() => {
  unmount?.();
  unmount = null;
});

function mountCounter(): Counter {
  const handle = mount(Counter, host);
  unmount = handle.unmount;
  counter = handle.instance as Counter;
  return counter;
}

function find(nodes: ComponentNode[], name: string): ComponentNode | undefined {
  for (const node of nodes) {
    if (node.name === name) return node;
    const inner = find(node.children, name);
    if (inner) return inner;
  }
  return undefined;
}

function labelled(nodes: SignalNode[], label: string): SignalNode {
  const node = nodes.find((candidate) => candidate.label === label);
  if (!node) {
    throw new Error(`no signal labelled ${label}, only ${nodes.map((n) => n.label).join(', ')}`);
  }
  return node;
}

/** The writers a record blames, named as a panel would name them. */
function named(update: UpdateRecord): string[] {
  return update.causes.map((cause) => tools.labelOf(cause.signal));
}

describe('the object an extension reaches', () => {
  // One test below detaches the listener. Put it back afterwards, so a
  // failure inside that test is one failure rather than the rest of the file.
  afterEach(() => {
    devtools();
  });

  it('is published under the name the documentation gives', () => {
    expect((globalThis as Record<string, unknown>)['__VOLT_DEVTOOLS__']).toBe(tools);
  });

  it('carries a version an extension can check its assumptions against', () => {
    expect(Number.isInteger(tools.version)).toBe(true);
    expect(tools.version).toBeGreaterThanOrEqual(1);
  });

  it('says whether a session is running', () => {
    // A panel reopened on a page it was already recording reads this to know
    // which button to draw.
    expect(tools.recording).toBe(false);
    tools.startRecording();
    expect(tools.recording).toBe(true);
    tools.stopRecording();
    expect(tools.recording).toBe(false);
  });

  it('re-attaches to the reactive core after something detached it', () => {
    mountCounter();
    // What measuring the cost of the hooks means: take them out. This is the
    // whole reason `install` sets the listener on every call rather than once.
    setDevListener(null);
    tools.startRecording();
    counter.count.set(3);
    flushSync();
    expect(tools.updates()).toEqual([]);

    expect(devtools()).toBe(tools);
    counter.count.set(4);
    flushSync();
    expect(named(tools.updates().at(-1)!)).toEqual(['Counter.count']);
  });
});

describe('component tree', () => {
  it('reports instances, their props and their scopes', () => {
    const instance = mountCounter();

    const root = find(tools.componentTree(), 'Counter');
    expect(root).toBeDefined();
    expect(root!.selector).toBe('v-counter');
    expect(root!.instance).toBe(instance);
    expect(root!.scope).not.toBeNull();

    const badge = find([root!], 'Badge');
    expect(badge).toBeDefined();
    // The prop is shown by its template-facing name — `caption`, not the
    // `text` field behind it — and unwrapped: what the parent passed down,
    // not the signal object holding it.
    expect(badge!.props).toEqual({ caption: 'hi' });
  });

  it('hands back the scope that owns the instance, not some other scope', () => {
    mountCounter();
    const span = host.querySelector('span')!;
    expect(span.textContent).toBe('4');

    // The documented use of the field: disposing this is what unmounts the
    // component. So the bindings stop, and the tree forgets it.
    disposeScope(find(tools.componentTree(), 'Counter')!.scope!);
    unmount = null;

    counter.count.set(50);
    flushSync();
    expect(span.textContent).toBe('4');
    expect(find(tools.componentTree(), 'Counter')).toBeUndefined();
  });

  it('follows a prop as it changes', () => {
    mountCounter();
    counter.label.set('bye');
    flushSync();

    expect(find(tools.componentTree(), 'Badge')!.props['caption']).toBe('bye');
  });

  it('finds the node for an instance a panel is holding', () => {
    const instance = mountCounter();
    const node = tools.componentFor(instance);
    expect(node!.name).toBe('Counter');
    expect(node!.instance).toBe(instance);
    expect(tools.componentFor({})).toBeNull();

    unmount!();
    unmount = null;
    expect(tools.componentFor(instance)).toBeNull();
  });

  it('forgets a component once its scope is disposed', () => {
    mountCounter();
    expect(find(tools.componentTree(), 'Counter')).toBeDefined();

    unmount!();
    unmount = null;
    expect(find(tools.componentTree(), 'Counter')).toBeUndefined();
    expect(find(tools.componentTree(), 'Badge')).toBeUndefined();
  });

  it('hands a departing component its children rather than dropping them', () => {
    document.body.innerHTML = '<div id="app"></div><div id="overlay"></div>';
    host = document.querySelector('#app')!;
    const handle = mount(Portal, host);
    const overlay = (handle.instance as Portal).overlay;
    expect(find(tools.componentTree(), 'Overlay')).toBeDefined();

    handle.unmount();

    // The overlay's own root was not touched, so it is still on screen. A
    // child dropped with its parent would vanish from the tree while it is
    // still rendering.
    expect(document.querySelector('#overlay')!.textContent).toBe('overlay');
    expect(find(tools.componentTree(), 'Portal')).toBeUndefined();
    expect(find(tools.componentTree(), 'Overlay')).toBeDefined();

    overlay.unmount();
    expect(find(tools.componentTree(), 'Overlay')).toBeUndefined();
  });
});

describe('signal graph', () => {
  it('reports the nodes and edges reachable from a component', () => {
    mountCounter();
    const graph = tools.signalGraph(counter);

    const count = labelled(graph, 'Counter.count');
    const doubled = labelled(graph, 'Counter.doubled');

    // Ids tell two nodes apart or they are not ids: every assertion below
    // that compares one to another would hold for a constant otherwise.
    expect(new Set(graph.map((node) => node.id)).size).toBe(graph.length);

    expect(count.kind).toBe('state');
    expect(count.value).toBe(2);
    expect(doubled.kind).toBe('computed');
    expect(doubled.value).toBe(4);

    // The edge the derivation is made of, in both directions.
    expect(doubled.sources).toContain(count.id);
    expect(count.sinks).toContain(doubled.id);

    // Live, in the sense the roadmap asks for: something is watching.
    expect(count.observed).toBe(true);
    expect(count.observing).toBe(false);
    expect(doubled.observed).toBe(true);
    expect(doubled.observing).toBe(true);

    // The binding that renders it is an effect, not a computed, and it reads
    // the derived value rather than the state.
    const binding = graph.find(
      (node) => node.kind === 'effect' && node.sources.includes(doubled.id),
    );
    expect(binding).toBeDefined();
    expect(binding!.value).toBeUndefined();
    expect(doubled.sinks).toContain(binding!.id);
  });

  it('marks a signal nothing depends on as unobserved, and again once it is dropped', () => {
    const lonely = new Signal.State(1);
    tools.label(lonely, 'lonely');
    const observed = (): boolean => labelled(tools.signalGraph(lonely), 'lonely').observed;

    expect(observed()).toBe(false);
    const dispose = effect(() => {
      lonely.get();
    });
    flushSync();
    expect(observed()).toBe(true);

    // `observed` is what is live now, not what was ever read.
    dispose();
    flushSync();
    expect(observed()).toBe(false);
  });

  it('re-reads values rather than caching them', () => {
    mountCounter();
    counter.count.set(21);
    flushSync();

    const graph = tools.signalGraph(counter);
    expect(labelled(graph, 'Counter.count').value).toBe(21);
    expect(labelled(graph, 'Counter.doubled').value).toBe(42);
  });

  it('crosses a component boundary', () => {
    mountCounter();
    const graph = tools.signalGraph(counter);
    // The child's prop is named after the child that declares it, and is
    // reachable from the parent because a render effect writes it.
    expect(graph.some((node) => node.label === 'Badge.text')).toBe(true);
  });

  it('reads values without subscribing whoever asked', () => {
    mountCounter();
    let runs = 0;
    const dispose = effect(() => {
      runs++;
      tools.signalGraph(counter);
    });
    flushSync();
    expect(runs).toBe(1);

    // A panel that read values tracked would re-run whatever opened it on the
    // next write, which is the tools driving the application they measure.
    counter.count.set(11);
    flushSync();
    expect(runs).toBe(1);
    dispose();
  });

  it('walks every mounted component when given no seed', () => {
    mountCounter();
    const loose = new Signal.State(1);
    tools.label(loose, 'loose');

    const everything = tools.signalGraph().map((node) => node.label);
    expect(everything).toContain('Counter.count');
    expect(everything).toContain('Badge.text');

    // Every signal a registered component holds, which is not every signal:
    // one nothing has read and no component declares is reachable from
    // nowhere, and is found only by seeding the walk with it.
    expect(everything).not.toContain('loose');
    expect(tools.signalGraph(loose).map((node) => node.label)).toEqual(['loose']);
  });
});

describe('why did this update', () => {
  it('names the write that woke each effect, not the last write anywhere', () => {
    mountCounter();
    tools.startRecording();

    // Two writes, one flush. If the cause were global state rather than
    // per-effect, both effects would name whichever was written last.
    counter.count.set(3);
    counter.label.set('bye');
    flushSync();

    const updates = tools.updates();
    const fromCount = updates.filter((u) => named(u).includes('Counter.count'));
    const fromLabel = updates.filter((u) => named(u).includes('Counter.label'));

    expect(fromCount).toHaveLength(1);
    expect(fromLabel).toHaveLength(1);
    expect(named(fromCount[0]!)).toEqual(['Counter.count']);
    expect(named(fromLabel[0]!)).toEqual(['Counter.label']);

    const cause = fromCount[0]!.causes[0]!;
    expect(cause.previous).toBe(2);
    expect(cause.value).toBe(3);
    expect(tools.describeUpdate(fromCount[0]!)).toContain('Counter.count 2 → 3');
    expect(fromCount[0]!.phase).toBe('render');
  });

  it('collects every write that woke a run, and starts the next run empty', () => {
    const first = new Signal.State(0);
    const second = new Signal.State(0);
    tools.label(first, 'first');
    tools.label(second, 'second');
    const dispose = effect(() => {
      first.get();
      second.get();
    });
    flushSync();
    tools.startRecording();

    // Both writes land before the effect runs. The second one reaches an
    // effect that is already dirty, which is precisely the case a wake
    // recorded after the colour check would drop.
    first.set(1);
    second.set(1);
    flushSync();
    expect(named(tools.updates().at(-1)!)).toEqual(['first', 'second']);

    // The run has accounted for them; they must not be blamed again.
    second.set(2);
    flushSync();
    expect(named(tools.updates().at(-1)!)).toEqual(['second']);
    dispose();
  });

  it('keeps the newest causes rather than every cause', () => {
    const signals = Array.from({ length: 12 }, () => new Signal.State(0));
    signals.forEach((signal, index) => tools.label(signal, `s${index}`));
    const dispose = effect(() => {
      for (const signal of signals) signal.get();
    });
    flushSync();
    tools.startRecording();

    for (const signal of signals) signal.set(1);
    flushSync();

    // Bounded, because the list is kept whether or not a session is running:
    // an effect nothing has re-run yet would otherwise hold every value ever
    // aimed at it alive.
    expect(named(tools.updates().at(-1)!)).toEqual(['s4', 's5', 's6', 's7', 's8', 's9', 's10', 's11']);
    dispose();
  });

  it('counts a write that reached an effect down two paths once', () => {
    const source = new Signal.State(0);
    tools.label(source, 'source');
    const left = new Signal.Computed(() => source.get() + 1);
    const right = new Signal.Computed(() => source.get() * 2);
    const dispose = effect(() => {
      left.get();
      right.get();
    });
    flushSync();
    tools.startRecording();

    // The write reaches the effect through both computeds, so the wake fires
    // twice for it. One write is one cause.
    source.set(1);
    flushSync();

    expect(named(tools.updates().at(-1)!)).toEqual(['source']);
    dispose();
  });

  it('does not open a session with causes left over from the last one', () => {
    const value = new Signal.State(0);
    tools.label(value, 'value');
    const dispose = effect(() => {
      value.get();
    });
    flushSync();

    tools.startRecording();
    // Woken inside the session, but the session ends before the flush that
    // would have charged the wake to a run and cleared it.
    value.set(1);
    tools.stopRecording();
    flushSync();

    tools.startRecording();
    value.set(2);
    flushSync();

    // A stale write blamed for a new session's update is the failure this
    // guards: the panel would name a `.set()` from before it was opened.
    expect(tools.updates().at(-1)!.causes.map((cause) => cause.value)).toEqual([2]);
    dispose();
  });

  it('shortens a value to something a row or a log line can hold', () => {
    const value = new Signal.State<unknown>(['a', 'b']);
    tools.label(value, 'Cart.items');
    const dispose = effect(() => {
      value.get();
    });
    flushSync();
    tools.startRecording();

    const shown = (next: unknown): string => {
      value.set(next);
      flushSync();
      return tools.describeUpdate(tools.updates().at(-1)!);
    };

    // The shape the reference advertises as the error-message format, down to
    // the counts: a whole cart inlined into a log line explains nothing.
    expect(shown(['a', 'b', 'c'])).toContain('Cart.items Array(2) → Array(3)');
    expect(shown(function submit() {})).toContain('Array(3) → ƒ submit');
    expect(shown(document.createElement('p'))).toContain('ƒ submit → <p>');
    expect(shown('y'.repeat(80))).toContain(`<p> → ${JSON.stringify('y'.repeat(39) + '…')}`);
    dispose();
  });

  it('reports how the write reached the effect', () => {
    mountCounter();
    tools.startRecording();
    counter.count.set(4);
    flushSync();

    const graph = tools.signalGraph(counter);
    const update = tools.updates().find((u) => named(u).includes('Counter.count'))!;

    const count = labelled(graph, 'Counter.count');
    const doubled = labelled(graph, 'Counter.doubled');
    // Two ids, and two different ones: a path of the right length made of one
    // repeated id would say nothing about which node relayed the write.
    expect(count.id).not.toBe(doubled.id);
    // Written signal first, then what relayed it: the computed in between.
    expect(update.through).toEqual([count.id, doubled.id]);
  });

  it('reports the written signal alone when the effect read it directly', () => {
    mountCounter();
    tools.startRecording();
    counter.label.set('bye');
    flushSync();

    const graph = tools.signalGraph(counter);
    const update = tools.updates().find((u) => named(u).includes('Counter.label'))!;
    const label = labelled(graph, 'Counter.label');
    expect(update.through).toEqual([label.id]);
    // And that id belongs to that signal and to nothing else in the graph.
    expect(graph.filter((node) => node.id === label.id)).toHaveLength(1);
  });

  it('follows a write across a component boundary', () => {
    mountCounter();
    tools.startRecording();
    counter.label.set('done');
    flushSync();

    // The parent's binding writes the child's prop, which wakes the child's
    // own binding — a second update naming a different writer.
    const causes = tools.updates().map((u) => named(u).join());
    expect(causes).toContain('Counter.label');
    expect(causes).toContain('Badge.text');
  });

  it('says so when nothing woke the effect', () => {
    tools.startRecording();
    const dispose = effect(() => {});
    flushSync();

    const first = tools.updates().at(-1)!;
    expect(first.causes).toEqual([]);
    expect(first.through).toEqual([]);
    expect(tools.describeUpdate(first)).toContain('ran for the first time');
    dispose();
  });

  it('hands each record to a subscriber as it happens', () => {
    mountCounter();
    const seen: string[] = [];
    const stop = tools.subscribe((update) => {
      const cause = update.causes[0];
      seen.push(cause ? tools.labelOf(cause.signal) : 'none');
    });
    tools.startRecording();

    counter.count.set(9);
    flushSync();
    stop();
    const after = seen.length;
    counter.count.set(10);
    flushSync();

    expect(seen).toContain('Counter.count');
    expect(seen).toHaveLength(after);
  });

  it('keeps only the last records a session asked for', () => {
    const value = new Signal.State(0);
    const dispose = effect(() => {
      value.get();
    });
    flushSync();
    tools.startRecording({ limit: 2 });

    for (let i = 1; i <= 4; i++) {
      value.set(i);
      flushSync();
    }

    const updates = tools.updates();
    expect(updates).toHaveLength(2);
    expect(updates.map((update) => update.causes[0]!.value)).toEqual([3, 4]);
    dispose();
  });

  it('captures where a write came from only when a session asks for stacks', () => {
    const value = new Signal.State(0);
    const dispose = effect(() => {
      value.get();
    });
    flushSync();

    tools.startRecording();
    value.set(1);
    flushSync();
    expect(tools.updates().at(-1)!.causes[0]!.stack).toBeUndefined();

    tools.startRecording({ stacks: true });
    value.set(2);
    flushSync();
    const stack = tools.updates().at(-1)!.causes[0]!.stack;
    expect(stack).toBeTypeOf('string');
    expect(stack!.length).toBeGreaterThan(0);
    // The caller's frames, with the framework's own removed from the top.
    expect(stack).not.toContain('graph.');
    dispose();
  });

  it('does not blame a write from an earlier turn', () => {
    const first = new Signal.State(0);
    const second = new Signal.State(0);
    tools.label(first, 'first');
    tools.label(second, 'second');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const dispose = effect(() => {
      first.get();
      if (second.get() > 0) throw new Error('boom');
    });
    flushSync();
    first.set(1);
    flushSync();
    second.set(1);
    flushSync();

    const message = String(spy.mock.calls[0]?.[0]);
    expect(message).toContain('woken by second (0 → 1)');
    expect(message).not.toContain('first');
    spy.mockRestore();
    dispose();
  });

  it('names the writer in the message when an effect throws', () => {
    const trigger = new Signal.State(false);
    tools.label(trigger, 'trigger');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const dispose = effect(() => {
      if (trigger.get()) throw new Error('boom');
    });
    flushSync();
    trigger.set(true);
    flushSync();

    expect(spy.mock.calls[0]?.[0]).toContain('woken by trigger (false → true)');
    spy.mockRestore();
    dispose();
  });

  it('names at most the three newest writes, oldest first', () => {
    const signals = ['w1', 'w2', 'w3', 'w4'].map((name) => {
      const signal = new Signal.State(0);
      tools.label(signal, name);
      return signal;
    });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    let runs = 0;
    const dispose = effect(() => {
      for (const signal of signals) signal.get();
      if (++runs > 1) throw new Error('boom');
    });
    flushSync();

    for (const signal of signals) signal.set(1);
    flushSync();

    // Capped, because an effect woken by everything is not explained by a
    // message naming everything; and read in the order the writes happened,
    // which is the opposite of the order they are found in.
    const message = String(spy.mock.calls[0]?.[0]);
    expect(message).toContain('woken by w2 (0 → 1), w3 (0 → 1), w4 (0 → 1)');
    expect(message).not.toContain('w1');
    spy.mockRestore();
    dispose();
  });

  it('forgets the oldest wakes in a turn that never flushes', () => {
    const flag = new Signal.State(false);
    const noise = new Signal.State(0);
    tools.label(flag, 'flag');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const thrower = effect(() => {
      if (flag.get()) throw new Error('boom');
    });
    const bystander = effect(() => {
      noise.get();
    });
    flushSync();

    // A turn small enough to fit in the log names the write, so the assertion
    // below is about the bound rather than about attribution being broken.
    flag.set(true);
    noise.set(1);
    flushSync();
    expect(String(spy.mock.calls[0]?.[0])).toContain('woken by flag');

    flag.set(false);
    flushSync();
    spy.mockClear();

    // The same wake, buried under more wakes than the log holds. A batch left
    // open would otherwise grow this for as long as the turn lasts.
    flag.set(true);
    for (let i = 2; i < 4_300; i++) noise.set(i);
    flushSync();
    expect(String(spy.mock.calls[0]?.[0])).not.toContain('woken by');

    spy.mockRestore();
    thrower();
    bystander();
  });

  it('blames only the write that woke the effect that threw', () => {
    const quiet = new Signal.State(0);
    const loud = new Signal.State(0);
    tools.label(quiet, 'quiet');
    tools.label(loud, 'loud');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const bystander = effect(() => {
      quiet.get();
    });
    const thrower = effect(() => {
      if (loud.get() > 0) throw new Error('boom');
    });
    flushSync();

    // One turn, two effects, two writes. Attribution that was per-turn rather
    // than per-effect would name the bystander's write here too.
    loud.set(1);
    quiet.set(1);
    flushSync();

    const message = String(spy.mock.calls[0]?.[0]);
    expect(message).toContain('woken by loud (0 → 1)');
    expect(message).not.toContain('quiet');
    spy.mockRestore();
    bystander();
    thrower();
  });
});

describe('performance', () => {
  it('counts each effect run and attributes it to the component that declared it', () => {
    // Mounted first, recording second — the order an extension opened after
    // the page loaded is stuck with, and the one that used to report `null`
    // for every effect that already existed.
    mountCounter();
    tools.startRecording();

    counter.count.set(5);
    flushSync();
    counter.count.set(6);
    flushSync();
    counter.label.set('bye');
    flushSync();

    const stats = tools.effectStats();
    expect(stats.filter((stat) => stat.component === 'Counter').map((stat) => stat.runs)).toEqual([
      2,
    ]);
    // Two, because the binding that writes the prop is built while the child
    // is being constructed: the `:caption` binding and the child's own text.
    expect(stats.filter((stat) => stat.component === 'Badge').map((stat) => stat.runs)).toEqual([
      1, 1,
    ]);
    expect(stats.every((stat) => stat.phase === 'render')).toBe(true);
  });

  it('lists the busiest effect first', () => {
    const quiet = new Signal.State(0);
    const busy = new Signal.State(0);
    tools.startRecording();
    // Declared quiet-first, so the order effects were created in is the
    // opposite of the answer. A list handed back unsorted would pass a
    // fixture whose creation order already agreed with its run counts.
    const stopQuiet = effect(() => {
      quiet.get();
    });
    const stopBusy = effect(() => {
      busy.get();
    });
    flushSync();

    for (let i = 1; i <= 3; i++) {
      busy.set(i);
      flushSync();
    }

    expect(tools.effectStats().map((stat) => stat.runs)).toEqual([4, 1]);
    stopQuiet();
    stopBusy();
  });

  it('leaves out an effect that has not run yet', () => {
    tools.startRecording();
    const dispose = effect(() => {});

    // Declared inside the session but not yet flushed: a row of zeroes, which
    // a panel sorting by cost would rank above whatever is actually slow.
    expect(tools.effectStats()).toEqual([]);
    flushSync();
    expect(tools.effectStats()).toHaveLength(1);
    dispose();
  });

  it('drops a disposed effect rather than keeping it as history', () => {
    tools.startRecording();
    const dispose = effect(() => {});
    flushSync();
    expect(tools.effectStats()).toHaveLength(1);

    // Its record holds the node, and the node holds the closure and whatever
    // DOM it captured, so history here is a leak with a name.
    dispose();
    expect(tools.effectStats()).toEqual([]);
  });

  it('times each run, and remembers the worst one', () => {
    // A stubbed clock, because the claim is that these are measurements: a
    // real one can only be asserted against a bound, and a bound is what a
    // hard-coded zero satisfies.
    let clock = 0;
    const spy = vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const cost = new Signal.State(0);
    const dispose = effect(() => {
      clock += cost.get();
    });
    flushSync();
    tools.startRecording();

    cost.set(5);
    flushSync();
    cost.set(3);
    flushSync();

    const stats = tools.effectStats();
    expect(stats).toHaveLength(1);
    expect(stats[0]!.runs).toBe(2);
    expect(stats[0]!.lastMs).toBe(3);
    expect(stats[0]!.maxMs).toBe(5);
    expect(stats[0]!.totalMs).toBe(8);

    // A flush is timed the same way, over the runs it drained.
    expect(tools.flushes().map((flush) => flush.durationMs)).toEqual([5, 3]);
    spy.mockRestore();
    dispose();
  });

  it('records what each flush cost', () => {
    mountCounter();
    const measured: number[] = [];
    const dispose = measureEffect(() => {
      measured.push(counter.count.get());
    });
    flushSync();
    tools.startRecording();

    counter.count.set(6);
    flushSync();

    const flushes = tools.flushes();
    expect(flushes).toHaveLength(1);
    // One pass over the render lane and one over the measure lane, and the
    // single layout the measure lane exists to force exactly once.
    expect(flushes[0]!.passes).toBe(2);
    expect(flushes[0]!.forcedLayouts).toBe(1);
    // The binding that renders the count, and the measure effect reading it.
    expect(flushes[0]!.effects).toBe(2);
    dispose();
  });

  it('keeps the last 60 flushes and drops the rest', () => {
    let clock = 0;
    const spy = vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const cost = new Signal.State(0);
    const dispose = effect(() => {
      clock += cost.get();
    });
    flushSync();
    tools.startRecording();

    // Each flush costs a different amount, so which 60 were kept is readable
    // rather than only how many.
    for (let i = 1; i <= 65; i++) {
      cost.set(i);
      flushSync();
    }

    // Bounded because a session left open records a flush per interaction for
    // as long as the page is up.
    expect(tools.flushes().map((flush) => flush.durationMs)).toEqual(
      Array.from({ length: 60 }, (_, i) => i + 6),
    );
    spy.mockRestore();
    dispose();
  });

  it('does not record a flush that found nothing to do', () => {
    mountCounter();
    tools.startRecording();

    // A flush with an empty queue is not a flush. Recording it would put
    // zero-length rows between the ones that measure something.
    flushSync();
    flushSync();
    expect(tools.flushes()).toEqual([]);

    counter.count.set(3);
    flushSync();
    expect(tools.flushes()).toHaveLength(1);
  });

  it('collects nothing until asked', () => {
    mountCounter();
    counter.count.set(7);
    flushSync();

    expect(tools.updates()).toEqual([]);
    expect(tools.flushes()).toEqual([]);
    expect(tools.effectStats()).toEqual([]);
  });
});

/**
 * The DOM a binding wrote, which is what a panel highlights on hover.
 *
 * Every claim here is about attribution rather than about markup: the DOM
 * these bindings write is already covered elsewhere, and what is new is which
 * effect gets the credit for it. So each test writes through more than one
 * binding, or writes outside every binding, and asserts on the split.
 */
describe('the DOM a binding wrote', () => {
  /** The last update, which is the effect a targeted write woke. */
  function lastEffect(): number {
    return tools.updates().at(-1)!.effect;
  }

  it('names the text node the binding rewrote, by id or by node', () => {
    mountCounter();
    const span = host.querySelector('span')!;
    const text = span.firstChild!;

    tools.startRecording();
    counter.count.set(3);
    flushSync();
    expect(span.textContent).toBe('6');

    const id = lastEffect();
    expect(tools.nodesWrittenBy(id)).toEqual([text]);
    // The same answer for a panel holding the graph node rather than its id.
    const node = tools.signalGraph().find((candidate) => candidate.id === id)!.node;
    expect(tools.nodesWrittenBy(node)).toEqual([text]);
  });

  it('gives each binding in one flush the node it wrote, not the flush\'s nodes', () => {
    mountCounter();
    const span = host.querySelector('span')!;
    const em = host.querySelector('em')!;

    tools.startRecording();
    counter.count.set(5);
    counter.label.set('bye');
    flushSync();
    expect(span.textContent).toBe('10');
    expect(em.textContent).toBe('bye');

    const written = new Map(
      tools.updates().map((update) => [update.effect, tools.nodesWrittenBy(update.effect)]),
    );
    const counted = [...written.values()].filter((nodes) => nodes.length > 0);
    // Two bindings ran and each is credited with one node: the span's text and
    // the badge's, never both under one effect.
    expect(counted).toContainEqual([span.firstChild]);
    expect(counted).toContainEqual([em.firstChild]);
    expect(counted.every((nodes) => nodes.length === 1)).toBe(true);
  });

  it('names the element an attribute binding wrote', () => {
    const handle = mount(Tagged, host);
    unmount = handle.unmount;
    const p = host.querySelector('p')!;

    tools.startRecording();
    (handle.instance as Tagged).tip.set('second');
    flushSync();
    expect(p.getAttribute('data-tip')).toBe('second');

    expect(tools.nodesWrittenBy(lastEffect())).toEqual([p]);
  });

  it('does not blame a binding for DOM the page wrote outside every effect', () => {
    mountCounter();
    const span = host.querySelector('span')!;

    tools.startRecording();
    // A write no binding made: an event handler reaching for the DOM itself,
    // or anything else on the page. It happens before the flush, so the first
    // effect to run is the one that would wear it.
    const stray = document.createElement('aside');
    host.appendChild(stray);

    counter.count.set(9);
    flushSync();

    expect(tools.nodesWrittenBy(lastEffect())).toEqual([span.firstChild]);
  });

  it('names the nodes a list binding inserted, and the parent it emptied', () => {
    const handle = mount(List, host);
    unmount = handle.unmount;
    const rows = (handle.instance as List).rows;
    const ul = host.querySelector('ul')!;

    tools.startRecording();
    rows.set(['a', 'b', 'c']);
    flushSync();

    const added = host.querySelectorAll('li')[2]!;
    expect(added.textContent).toBe('c');

    // One effect in that flush is credited with the new row, and it is the
    // binding that put it in the list rather than the row itself: the row's
    // own text binding ran for the first time, into DOM still detached, and
    // an observer of the document cannot see a write like that at all.
    const credited = tools
      .updates()
      .filter((update) => tools.nodesWrittenBy(update.effect).includes(added));
    expect(credited.length).toBe(1);
    const firstRuns = tools.updates().filter((update) => update.causes.length === 0);
    expect(firstRuns.length).toBeGreaterThan(0);
    expect(firstRuns.map((update) => tools.nodesWrittenBy(update.effect))).toEqual(
      firstRuns.map(() => []),
    );

    rows.set(['a', 'b']);
    flushSync();
    expect(host.querySelectorAll('li').length).toBe(2);

    const after = tools.nodesWrittenBy(credited[0]!.effect);
    // The row is gone from the document, so there is nothing to draw a box
    // around; what the binding emptied is still there and still its.
    expect(after).not.toContain(added);
    expect(after).toContain(ul);
  });

  it('keeps the nodes a binding wrote most recently rather than every node', () => {
    const texts = Array.from({ length: 36 }, () => host.appendChild(document.createTextNode('')));
    const tick = new Signal.State(0);

    tools.startRecording();
    effect(() => {
      if (tick.get() === 0) {
        // Filled to the cap exactly, so the next run is the one that evicts.
        for (let i = 0; i < 32; i++) texts[i]!.data = 'a';
        return;
      }
      // The oldest of those written again, then four it has never written.
      // Four nodes have to go, and the one just rewritten is not among them.
      texts[0]!.data = 'b';
      for (let i = 32; i < 36; i++) texts[i]!.data = 'b';
    });
    flushSync();
    tick.set(1);
    flushSync();

    const written = tools.nodesWrittenBy(lastEffect());
    expect(written.length).toBe(32);
    expect(written).toContain(texts[0]);
    expect(written).toContain(texts[35]);
    expect(written).not.toContain(texts[4]);
  });

  it('drops what it collected when the session is reset, and goes on collecting', () => {
    mountCounter();
    const span = host.querySelector('span')!;

    tools.startRecording();
    counter.count.set(21);
    flushSync();
    const id = lastEffect();
    expect(tools.nodesWrittenBy(id)).toEqual([span.firstChild]);

    tools.reset();
    expect(tools.nodesWrittenBy(id)).toEqual([]);

    // The session is still running, so the binding's next write is collected
    // like the first: reset drops what was collected, not the collecting.
    counter.count.set(22);
    flushSync();
    expect(span.textContent).toBe('44');
    expect(tools.nodesWrittenBy(lastEffect())).toEqual([span.firstChild]);
  });

  it('collects nothing once the session is over', () => {
    mountCounter();
    const span = host.querySelector('span')!;

    tools.startRecording();
    counter.count.set(11);
    flushSync();
    const id = lastEffect();
    expect(tools.nodesWrittenBy(id)).toEqual([span.firstChild]);

    tools.stopRecording();
    expect(tools.nodesWrittenBy(id)).toEqual([]);

    // And the binding goes on writing that node without any of it being kept.
    counter.count.set(12);
    flushSync();
    expect(span.textContent).toBe('24');
    expect(tools.nodesWrittenBy(id)).toEqual([]);
  });
});

/**
 * A server renders many pages in one process, and nothing disposes a request's
 * scopes: the request is dropped whole. Instrumentation kept in module scope
 * would therefore hand every request the last one's instances, props and
 * scopes — alive, and readable.
 */
describe('server rendering', () => {
  function serverBuild(on: boolean): void {
    (globalThis as { __VOLT_SERVER__?: boolean }).__VOLT_SERVER__ = on;
  }

  beforeEach(() => {
    serverBuild(true);
  });

  afterEach(() => {
    serverBuild(false);
  });

  it('keeps one request out of the next', async () => {
    const perRequest: number[] = [];

    for (let i = 0; i < 3; i++) {
      const scope = createRequestScope();
      const into = document.createElement('div');
      await settleRequest(scope, () => {
        mount(Counter, into);
        perRequest.push(find(tools.componentTree(), 'Counter') ? 1 : 0);
        perRequest.push(tools.componentTree().length);
      });
    }

    // Each request saw its own component, and only its own.
    expect(perRequest).toEqual([1, 1, 1, 1, 1, 1]);
    expect(find(tools.componentTree(), 'Counter')).toBeUndefined();
    expect(tools.signalGraph().filter((node) => node.label.startsWith('Counter.'))).toEqual([]);
  });
});

/**
 * The whole point of `__VOLT_DEV__`: none of the above reaches an application.
 *
 * Bundled the way an application is — the plugin defines the flag false for a
 * production build, and a minifier drops the branches — then read back. The
 * dev bundle is built the same way as a control, so a marker that stopped
 * meaning anything fails the test rather than passing it silently.
 */
describe('production build', () => {
  const root = resolve(import.meta.dirname, '../../..');

  const fromSource = {
    '@voltdev/reactivity/signals': resolve(root, 'packages/reactivity/src/signals.ts'),
    '@voltdev/reactivity': resolve(root, 'packages/reactivity/src/index.ts'),
    '@voltdev/compiler': resolve(root, 'packages/compiler/src/index.ts'),
    '@voltdev/core/runtime': resolve(root, 'packages/core/src/runtime.ts'),
    '@voltdev/core': resolve(root, 'packages/core/src/index.ts'),
  };

  /** What an installed dependency resolves to: the built package, not `src`. */
  const fromPackage = {
    '@voltdev/reactivity/signals': resolve(root, 'packages/reactivity/dist/signals.js'),
    '@voltdev/reactivity': resolve(root, 'packages/reactivity/dist/index.js'),
    '@voltdev/core': resolve(root, 'packages/core/dist/index.js'),
  };

  /** An application entry, bundled and minified the way one is shipped. */
  async function bundle(dev: boolean, alias: Record<string, string>): Promise<string> {
    const result = await build({
      stdin: {
        contents:
          "import { mount, effect, renderEffect, Signal, flushSync } from '@voltdev/core';\n" +
          'globalThis.app = { mount, effect, renderEffect, Signal, flushSync };',
        resolveDir: root,
        loader: 'ts',
      },
      bundle: true,
      write: false,
      format: 'esm',
      target: 'esnext',
      minify: true,
      alias,
      define: { __VOLT_DEV__: String(dev), __VOLT_SERVER__: 'false' },
    });
    return result.outputFiles[0]!.text;
  }

  // Property names and string literals, which minification keeps. Local names
  // are mangled, so asserting on those would pass for the wrong reason.
  const markers = [
    // The tools themselves.
    '__VOLT_DEVTOOLS__',
    'componentTree',
    'signalGraph',
    'effectStats',
    'describeUpdate',
    'startRecording',
    'woken by',
    // The seam in the reactive core they attach to.
    'flushStarted',
    'flushEnded',
    'runStarted',
    'runEnded',
    'effectCreated',
    'effectDisposed',
    'explain',
    // The two on the hot path, written as the call rather than the bare name:
    // every `Signal.State.set` and every effect wake goes through these, so
    // they are the ones the guard most has to remove. `wake`/`write` alone
    // would match too much of an unrelated bundle to mean anything.
    '.wake(',
    '.write(',
  ];

  it('carries none of the instrumentation', async () => {
    const [production, development] = await Promise.all([
      bundle(false, fromSource),
      bundle(true, fromSource),
    ]);

    expect(markers.filter((marker) => development.includes(marker))).toEqual(markers);
    expect(markers.filter((marker) => production.includes(marker))).toEqual([]);
    expect(production.length).toBeLessThan(development.length);

    // Asserted here rather than added to the list above, which the test below
    // also holds `dist` to: that bundle is built when the package is published
    // and not when this file changes, so a marker added here would fail there
    // until the next release rather than say anything about the strip.
    expect(development).toContain('nodesWrittenBy');
    expect(production).not.toContain('nodesWrittenBy');
  }, 30_000);

  /**
   * The same claim about the bytes an application installs rather than the
   * source it never sees. The published bundle keeps `if (__VOLT_DEV__)
   * install()` and a real import of the module beside it, so dropping both
   * rests on the consumer's define plus `sideEffects: false` in the manifest —
   * a path the assertion above does not travel.
   */
  // Skipped rather than passed when `pnpm build` has not run: a test that
  // bundles nothing and reports green is worse than one that reports nothing,
  // because only the second is visible in the run.
  it.skipIf(!existsSync(resolve(root, 'packages/core/dist/index.js')))(
    'carries none of it out of the published package either',
    async () => {
      const [production, development] = await Promise.all([
        bundle(false, fromPackage),
        bundle(true, fromPackage),
      ]);

      expect(markers.filter((marker) => development.includes(marker))).toEqual(markers);
      expect(markers.filter((marker) => production.includes(marker))).toEqual([]);
    },
    30_000,
  );
});

describe('stepping back through what was written', () => {
  beforeEach(() => {
    tools.reset();
    tools.stopRecording();
  });

  afterEach(() => {
    tools.stopRecording();
    tools.reset();
  });

  it('keeps nothing unless a session asks for it, since holding `previous` holds the past', () => {
    const count = new Signal.State(0);
    tools.startRecording();
    count.set(1);
    count.set(2);
    flushSync();

    expect(tools.history().writes).toHaveLength(0);
    expect(tools.history().at).toBe(-1);
  });

  it('keeps every write when asked, including the ones that woke nothing', () => {
    // Nothing reads `quiet`, so no effect ever runs for it. It is still a
    // write, and a session stepping back has to put it back.
    const quiet = new Signal.State('a');
    tools.startRecording({ history: 10 });
    quiet.set('b');
    quiet.set('c');
    flushSync();

    const { writes, at } = tools.history();
    expect(writes.map((write) => write.value)).toEqual(['b', 'c']);
    expect(at).toBe(1);
  });

  it('puts a signal back, and forward again', () => {
    const count = new Signal.State(0);
    const seen: number[] = [];
    effect(() => seen.push(count.get()));
    flushSync();

    tools.startRecording({ history: 10 });
    count.set(1);
    count.set(2);
    flushSync();
    expect(count.get()).toBe(2);

    expect(tools.travelTo(0)).toBe(true);
    flushSync();
    expect(count.get()).toBe(1);

    expect(tools.travelTo(-1)).toBe(true);
    flushSync();
    expect(count.get()).toBe(0);

    expect(tools.travelTo(1)).toBe(true);
    flushSync();
    expect(count.get()).toBe(2);

    // Not one run per write. The two writes before the first flush coalesced
    // into a single run, as they are meant to, so the live session saw 0 then
    // 2 — while stepping visits 1 on the way past because each step is
    // flushed on its own. A panel showing effect runs will therefore show
    // more of them going backwards than the page ever performed forwards.
    expect(seen).toEqual([0, 2, 1, 0, 2]);
  });

  it('unwinds two writes to one signal in the order they were made', () => {
    const name = new Signal.State('first');
    tools.startRecording({ history: 10 });
    name.set('second');
    name.set('third');
    flushSync();

    tools.travelTo(-1);
    flushSync();
    expect(name.get()).toBe('first');
  });

  it('restores several signals at once, oldest position first', () => {
    const a = new Signal.State(1);
    const b = new Signal.State('x');
    tools.startRecording({ history: 10 });
    a.set(2);
    b.set('y');
    a.set(3);
    flushSync();

    tools.travelTo(0);
    flushSync();
    expect(a.get()).toBe(2);
    expect(b.get()).toBe('x');
  });

  it('does not record its own restoring, which would step through itself', () => {
    const count = new Signal.State(0);
    tools.startRecording({ history: 10 });
    count.set(1);
    flushSync();

    tools.travelTo(-1);
    flushSync();
    expect(tools.history().writes).toHaveLength(1);
    expect(tools.history().at).toBe(-1);
  });

  it('abandons what was ahead once the page takes a different turn', () => {
    const count = new Signal.State(0);
    tools.startRecording({ history: 10 });
    count.set(1);
    count.set(2);
    flushSync();

    tools.travelTo(0);
    flushSync();
    // A write from here is a new branch: offering "forward" to 2 afterwards
    // would lead somewhere this state never came from.
    count.set(99);
    flushSync();

    const { writes, at } = tools.history();
    expect(writes.map((write) => write.value)).toEqual([1, 99]);
    expect(at).toBe(1);
  });

  it('drops the oldest rather than growing without bound', () => {
    const count = new Signal.State(0);
    tools.startRecording({ history: 3 });
    for (let i = 1; i <= 5; i++) count.set(i);
    flushSync();

    expect(tools.history().writes.map((write) => write.value)).toEqual([3, 4, 5]);
    expect(tools.history().at).toBe(2);
  });

  it('refuses a position that is not in the history', () => {
    const count = new Signal.State(0);
    tools.startRecording({ history: 10 });
    count.set(1);
    flushSync();

    expect(tools.travelTo(5)).toBe(false);
    expect(tools.travelTo(-2)).toBe(false);
    expect(count.get()).toBe(1);
  });

  it('stops keeping history when the session ends', () => {
    const count = new Signal.State(0);
    tools.startRecording({ history: 10 });
    count.set(1);
    flushSync();
    tools.stopRecording();
    count.set(2);
    flushSync();

    expect(tools.history().writes).toHaveLength(1);
  });
});
