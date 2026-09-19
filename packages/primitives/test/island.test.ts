/**
 * A subtree the framework does not own.
 *
 * The claims worth testing are the ones that are invisible when they fail: a
 * signal reaching one object rather than causing a redraw, a teardown that
 * happens without anyone remembering it, and nothing being drawn at all on a
 * server. None of those shows up in markup, which is why the assertions below
 * count calls rather than reading the DOM.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Signal, flushSync, onCleanup } from '@voltdev/core';
import { createRoot } from '@voltdev/reactivity';
import { ISLAND_ATTRIBUTE, createIsland, type Island } from '../src/island.js';

/** A stand-in for the thing an island is about. */
class Scene {
  pages: number[] = [];
  selected: string[] = [];
  destroyed = 0;
  constructor(readonly host: Element) {}
  goTo(page: number): void {
    this.pages.push(page);
  }
  select(id: string): void {
    this.selected.push(id);
  }
}

let host: HTMLElement;
let disposers: (() => void)[] = [];

function inRoot<T>(build: () => T): T {
  let value!: T;
  createRoot((dispose) => {
    disposers.push(dispose);
    value = build();
  });
  flushSync();
  return value;
}

beforeEach(() => {
  document.body.innerHTML = '<div id="host"></div>';
  host = document.querySelector('#host')!;
});

afterEach(() => {
  for (const dispose of disposers) dispose();
  disposers = [];
  flushSync();
  document.body.innerHTML = '';
});

describe('what the island owns', () => {
  it('is drawn once, with the host element, and reports what setup returned', () => {
    let calls = 0;
    const island = inRoot(() =>
      createIsland({
        host: () => host,
        setup: (el) => {
          calls++;
          return new Scene(el);
        },
      }),
    );

    expect(calls).toBe(1);
    expect(island.isReady()).toBe(true);
    expect(island.instance()?.host).toBe(host);
  });

  it('waits for an element that is in the document, since an unattached one has no box', () => {
    const ref = new Signal.State<Element | null>(null);
    const detached = document.createElement('div');

    const island = inRoot(() =>
      createIsland({ host: () => ref.get(), setup: (el) => new Scene(el) }),
    );
    expect(island.isReady()).toBe(false);

    ref.set(detached);
    flushSync();
    expect(island.isReady()).toBe(false);

    document.body.append(detached);
    ref.set(null);
    ref.set(detached);
    flushSync();
    expect(island.isReady()).toBe(true);
  });

  it('marks the element, so what is not the framework’s is visible', () => {
    const island = inRoot(() => createIsland({ host: () => host, setup: () => undefined }));
    expect(island.hostProps()[ISLAND_ATTRIBUTE]).toBe('');
  });

  it('is drawn once however many signals setup happens to read', () => {
    // A scene reads its initial state as it is built. Tracking that would make
    // every later change to it tear the scene down and draw it again — the
    // redraw the island exists to rule out, and what `sync` is for instead.
    const zoom = new Signal.State(4);
    let calls = 0;
    const island = inRoot(() =>
      createIsland({
        host: () => host,
        setup: (el) => {
          calls++;
          const scene = new Scene(el);
          scene.goTo(zoom.get());
          return scene;
        },
      }),
    );
    const first = island.instance();

    zoom.set(5);
    flushSync();

    expect(calls).toBe(1);
    expect(island.instance()).toBe(first);
  });

  it('is ready once drawn, whatever setup returned', () => {
    const tornDown = inRoot(() => createIsland({ host: () => host, setup: () => () => {} }));
    const nothing = inRoot(() => createIsland({ host: () => host, setup: () => undefined }));

    // Drawn is drawn: an island that hands back only its teardown, or nothing
    // at all, has still put its content in the host.
    expect(tornDown.isReady()).toBe(true);
    expect(nothing.isReady()).toBe(true);
    // There is still no object to hand an applier.
    expect(tornDown.instance()).toBe(null);
    expect(nothing.instance()).toBe(null);
  });
});

describe('synchronising into it', () => {
  function scened(): { island: Island<Scene>; page: Signal.State<number>; sel: Signal.State<string> } {
    const page = new Signal.State(1);
    const sel = new Signal.State('a');
    const island = inRoot(() => {
      const made = createIsland({ host: () => host, setup: (el) => new Scene(el) });
      made.sync(
        () => page.get(),
        (value, scene) => scene.goTo(value),
      );
      made.sync(
        () => sel.get(),
        (value, scene) => scene.select(value),
      );
      return made;
    });
    return { island, page, sel };
  }

  it('applies the current value once the island is ready', () => {
    const { island } = scened();
    expect(island.instance()?.pages).toEqual([1]);
    expect(island.instance()?.selected).toEqual(['a']);
  });

  it('reaches one operation, not a redraw of everything', () => {
    // The whole reason this primitive exists: a thousand annotations and one
    // selection change must touch one object.
    const { island, page } = scened();
    const scene = island.instance()!;
    scene.pages.length = 0;
    scene.selected.length = 0;

    page.set(2);
    flushSync();

    expect(scene.pages).toEqual([2]);
    expect(scene.selected).toEqual([]);
  });

  it('does not lose a change made before it was drawn', () => {
    const ref = new Signal.State<Element | null>(null);
    const page = new Signal.State(1);
    const island = inRoot(() => {
      const made = createIsland<Scene>({ host: () => ref.get(), setup: (el) => new Scene(el) });
      made.sync(
        () => page.get(),
        (value, scene) => scene.goTo(value),
      );
      return made;
    });

    page.set(7);
    flushSync();
    expect(island.isReady()).toBe(false);

    ref.set(host);
    flushSync();
    // 7, not 1: the applier runs against the value that stands when the island
    // appears, rather than replaying what it missed.
    expect(island.instance()?.pages).toEqual([7]);
  });

  it('does not enrol whatever the applier itself reads', () => {
    // An applier reaching into a scene may read signals of its own. Tracking
    // them would make the island re-apply for reasons that have nothing to do
    // with what it was told to watch.
    const page = new Signal.State(1);
    const unrelated = new Signal.State('x');
    let applied = 0;

    inRoot(() => {
      const made = createIsland({ host: () => host, setup: (el) => new Scene(el) });
      made.sync(
        () => page.get(),
        (value, scene) => {
          applied++;
          scene.goTo(value + unrelated.get().length);
        },
      );
      return made;
    });

    expect(applied).toBe(1);
    unrelated.set('yyy');
    flushSync();
    expect(applied).toBe(1);
  });
});

describe('teardown nobody has to remember', () => {
  it('runs the disposer setup returned', () => {
    let torn = 0;
    let island!: Island<unknown>;
    createRoot((dispose) => {
      island = createIsland({ host: () => host, setup: () => () => void torn++ });
      flushSync();
      expect(torn).toBe(0);
      expect(island.isReady()).toBe(true);
      dispose();
    });
    expect(torn).toBe(1);
    expect(island.isReady()).toBe(false);
  });

  it('runs cleanup registered from inside setup, and forgets the instance', () => {
    let torn = 0;
    let island!: Island<Scene>;
    createRoot((dispose) => {
      island = createIsland({
        host: () => host,
        setup: (el) => {
          const scene = new Scene(el);
          // The scope's cleanup is the island's; nothing else has to know.
          onCleanup(() => void torn++);
          return scene;
        },
      });
      flushSync();
      expect(island.isReady()).toBe(true);
      expect(torn).toBe(0);
      dispose();
    });
    expect(torn).toBe(1);
    expect(island.instance()).toBe(null);
    expect(island.isReady()).toBe(false);
  });
});

describe('on a server', () => {
  function serverBuild(on: boolean): void {
    (globalThis as { __VOLT_SERVER__?: boolean }).__VOLT_SERVER__ = on;
  }

  afterEach(() => serverBuild(false));

  it('draws nothing at all, so the host is emitted empty', () => {
    // Not a check written into the island: a server build's flush stops after
    // the data lane, and `setup` runs from a user effect. The claim is that
    // the scheduler's shape makes this unforgettable, so the test is against
    // the scheduler rather than against a branch.
    serverBuild(true);
    let calls = 0;
    const island = inRoot(() =>
      createIsland({
        host: () => host,
        setup: (el) => {
          calls++;
          return new Scene(el);
        },
      }),
    );

    expect(calls).toBe(0);
    expect(island.isReady()).toBe(false);
    expect(island.instance()).toBe(null);
    expect(host.childNodes).toHaveLength(0);
  });

  it('is waiting rather than inert, and draws when the same component runs in a browser', () => {
    let calls = 0;
    const options = {
      host: () => host,
      setup: (el: Element) => {
        calls++;
        return new Scene(el);
      },
    };

    // The request, and then the end of it. Ending it matters: the effect the
    // server never ran is queued rather than skipped, so a scope left alive
    // would draw the island the moment anything flushed — which is a real
    // property worth pinning, even though a server and a browser are two
    // processes and never share one here.
    serverBuild(true);
    let endRequest!: () => void;
    createRoot((dispose) => {
      endRequest = dispose;
      createIsland(options);
    });
    flushSync();
    expect(calls).toBe(0);
    endRequest();

    serverBuild(false);
    const client = inRoot(() => createIsland(options));
    expect(calls).toBe(1);
    expect(client.isReady()).toBe(true);
  });
});

describe('when setup fails', () => {
  it('reports it rather than leaving an empty box', () => {
    const errors: unknown[] = [];
    const island = inRoot(() =>
      createIsland({
        host: () => host,
        setup: () => {
          throw new Error('no webgl');
        },
        onError: (error) => errors.push(error),
      }),
    );

    expect(errors).toHaveLength(1);
    expect((errors[0] as Error).message).toBe('no webgl');
    expect(island.isReady()).toBe(false);
  });
});
