/**
 * List reconciliation, exercised the way Solid's `for` suite does.
 *
 * The mutation shapes here — rotations, backward-edge swaps, every
 * combination of removals — are the ones that break diffing algorithms, and
 * they are checked twice over: the resulting text must be right, and the
 * elements that survived must be the *same* elements, since reusing a node is
 * the entire point of keying.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { compileTemplate } from '@voltdev/core/jit';
import { Component, Signal, flushSync, mount } from '@voltdev/core';

let host: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  host = document.querySelector('#app')!;
});

@Component({
  selector: 'v-rows',
  render: compileTemplate(`<ul><li :for="n in items.get()" :key="n">{ n }</li></ul>`),
})
class Rows {
  items = new Signal.State<number[]>([]);
}

/** Mount with `from`, apply `to`, and report text plus which nodes survived. */
function reconcile(from: number[], to: number[]) {
  document.body.innerHTML = '<div id="app"></div>';
  host = document.querySelector('#app')!;

  const handle = mount(Rows, host);
  const instance = handle.instance as Rows;
  instance.items.set(from);
  flushSync();

  const before = new Map<string, Element>();
  for (const li of host.querySelectorAll('li')) before.set(li.textContent!, li);

  instance.items.set(to);
  flushSync();

  const after = [...host.querySelectorAll('li')];
  const reused = after.filter((li) => before.get(li.textContent!) === li).length;

  return {
    text: after.map((li) => li.textContent).join(','),
    reused,
    survivors: to.filter((n) => from.includes(n)).length,
  };
}

/** Every survivor must be the very same element it was before. */
function expectReconciled(from: number[], to: number[]) {
  const r = reconcile(from, to);
  expect(r.text, `${from} -> ${to}`).toBe(to.join(','));
  expect(r.reused, `${from} -> ${to}: reused nodes`).toBe(r.survivors);
}

const FIVE = [1, 2, 3, 4, 5];

describe('removals', () => {
  it('removes one from each position', () => {
    for (const drop of FIVE) {
      expectReconciled(FIVE, FIVE.filter((n) => n !== drop));
    }
  });

  it('removes two at a time, every pair', () => {
    for (let i = 0; i < FIVE.length; i++) {
      for (let j = i + 1; j < FIVE.length; j++) {
        const dropped = new Set([FIVE[i]!, FIVE[j]!]);
        expectReconciled(FIVE, FIVE.filter((n) => !dropped.has(n)));
      }
    }
  });

  it('removes three at a time', () => {
    expectReconciled(FIVE, [4, 5]);
    expectReconciled(FIVE, [1, 5]);
    expectReconciled(FIVE, [1, 2]);
    expectReconciled(FIVE, [2, 4]);
  });

  it('removes all', () => expectReconciled(FIVE, []));
});

describe('insertions', () => {
  it('inserts at the front, middle, and end', () => {
    expectReconciled(FIVE, [0, ...FIVE]);
    expectReconciled(FIVE, [1, 2, 99, 3, 4, 5]);
    expectReconciled(FIVE, [...FIVE, 6]);
  });

  it('grows from empty', () => expectReconciled([], FIVE));

  it('interleaves new items throughout', () => {
    expectReconciled(FIVE, [1, 10, 2, 20, 3, 30, 4, 40, 5]);
  });
});

describe('moves', () => {
  it('reverses', () => expectReconciled(FIVE, [...FIVE].reverse()));

  it('rotates left and right', () => {
    expectReconciled(FIVE, [2, 3, 4, 5, 1]);
    expectReconciled(FIVE, [5, 1, 2, 3, 4]);
    expectReconciled(FIVE, [3, 4, 5, 1, 2]);
  });

  it('swaps adjacent pairs', () => expectReconciled(FIVE, [2, 1, 4, 3, 5]));

  it('swaps the outer edges', () => expectReconciled(FIVE, [5, 2, 3, 4, 1]));

  it('swaps a backward edge', () => {
    // The case where the first new item is the last old one and vice versa.
    expectReconciled([1, 2, 3, 4], [4, 3, 2, 1]);
    expectReconciled([1, 2], [2, 1]);
  });

  it('moves one item to the far end', () => {
    expectReconciled(FIVE, [2, 3, 4, 5, 1]);
    expectReconciled(FIVE, [5, 1, 2, 3, 4]);
  });
});

describe('mixed mutations', () => {
  it('removes and inserts at once', () => {
    expectReconciled(FIVE, [1, 99, 3, 5]);
    expectReconciled(FIVE, [99, 2, 4, 98]);
  });

  it('reorders while removing', () => {
    expectReconciled(FIVE, [5, 3, 1]);
    expectReconciled(FIVE, [4, 2]);
  });

  it('replaces everything', () => {
    const r = reconcile(FIVE, [6, 7, 8, 9, 10]);
    expect(r.text).toBe('6,7,8,9,10');
    expect(r.reused).toBe(0);
  });

  it('handles a longer shuffle', () => {
    const ten = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expectReconciled(ten, [10, 3, 7, 1, 9, 2, 8, 4, 6, 5]);
    expectReconciled(ten, [5, 1, 9, 3]);
  });

  it('empties and refills repeatedly', () => {
    document.body.innerHTML = '<div id="app"></div>';
    host = document.querySelector('#app')!;
    const handle = mount(Rows, host);
    const instance = handle.instance as Rows;

    for (let i = 0; i < 5; i++) {
      instance.items.set(FIVE);
      flushSync();
      expect(host.querySelectorAll('li')).toHaveLength(5);
      instance.items.set([]);
      flushSync();
      expect(host.querySelectorAll('li')).toHaveLength(0);
    }
  });
});

describe('surrounding content is not disturbed', () => {
  it('keeps siblings either side of the list', () => {
    @Component({
      selector: 'v-sandwich',
      render: compileTemplate(`
        <div>
          <header>top</header>
          <ul><li :for="n in items.get()" :key="n">{ n }</li></ul>
          <footer>bottom</footer>
        </div>
      `),
    })
    class Sandwich {
      items = new Signal.State([1, 2, 3]);
    }

    const handle = mount(Sandwich, host);
    const header = host.querySelector('header')!;
    const footer = host.querySelector('footer')!;

    (handle.instance as Sandwich).items.set([3, 1]);
    flushSync();

    expect(host.querySelector('header')).toBe(header);
    expect(host.querySelector('footer')).toBe(footer);
    expect(host.querySelector('ul')!.textContent).toBe('31');
  });

  it('keeps two independent lists apart', () => {
    @Component({
      selector: 'v-two',
      render: compileTemplate(`
        <div>
          <ul class="a"><li :for="n in a.get()" :key="n">{ n }</li></ul>
          <ul class="b"><li :for="n in b.get()" :key="n">{ n }</li></ul>
        </div>
      `),
    })
    class Two {
      a = new Signal.State([1, 2]);
      b = new Signal.State([3, 4]);
    }

    const handle = mount(Two, host);
    (handle.instance as Two).a.set([2, 1]);
    flushSync();

    expect(host.querySelector('ul.a')!.textContent).toBe('21');
    expect(host.querySelector('ul.b')!.textContent).toBe('34');
  });
});

/**
 * The positional fast path.
 *
 * "One row changed" replaces the array wholesale and leaves every key where it
 * was, which the full algorithm can only discover by building a map of the
 * previous keys and looking each new one up in it. That map is the last thing
 * a no-op pass allocated, so the shape is detected first, in a single scan of
 * pointer comparisons, and the map is never built.
 *
 * What the tests below are actually watching is the map: a `Map` constructed
 * anywhere during the update fails the fast-path cases, and the hand-off cases
 * assert one *is* built, so that the absence above means the path was taken
 * rather than that the probe stopped working. The correctness assertions are
 * the same ones the rest of this file makes — which elements survived — since
 * a fast path that returns the wrong nodes is the failure that matters.
 */
interface Keyed {
  id: number;
  label: string;
}

@Component({
  selector: 'v-keyed',
  render: compileTemplate(`<ul><li :for="r in rows.get()" :key="r.id">{ r.label }</li></ul>`),
})
class KeyedRows {
  rows = new Signal.State<Keyed[]>([]);
}

/** How many `Map`s were constructed while `fn` ran. */
function mapsBuilt(fn: () => void): number {
  let built = 0;
  const real = globalThis.Map;
  globalThis.Map = new Proxy(real, {
    construct(target, args: unknown[], newTarget) {
      built++;
      return Reflect.construct(target, args, newTarget) as object;
    },
  }) as MapConstructor;
  try {
    fn();
  } finally {
    globalThis.Map = real;
  }
  return built;
}

/** Mount a keyed list and hand back the rows and a setter that flushes. */
function keyed(initial: Keyed[]) {
  document.body.innerHTML = '<div id="app"></div>';
  host = document.querySelector('#app')!;
  const instance = mount(KeyedRows, host).instance as KeyedRows;
  instance.rows.set(initial);
  flushSync();

  return {
    elements: () => [...host.querySelectorAll('li')],
    set(next: Keyed[]) {
      instance.rows.set(next);
      flushSync();
    },
  };
}

const KEYED = [
  { id: 1, label: 'one' },
  { id: 2, label: 'two' },
  { id: 3, label: 'three' },
];

/** A wholesale replacement: new objects, same ids, in the same order. */
const replaced = (labels: string[]) => KEYED.map((r, i) => ({ id: r.id, label: labels[i]! }));

describe('same length, same keys, same order', () => {
  it('updates the row that changed without building a key map', () => {
    const list = keyed(KEYED);
    const before = list.elements();

    const maps = mapsBuilt(() => list.set(replaced(['one', 'TWO', 'three'])));

    expect(maps).toBe(0);
    expect(host.textContent).toBe('oneTWOthree');
    // Every element survived, including the one whose text was rewritten.
    expect(list.elements()).toEqual(before);
  });

  it('refreshes items the keys cannot tell apart', () => {
    // Same keys, every item a different object with different contents. A fast
    // path that took "the keys did not move" to mean "nothing to do" would
    // leave all three rows showing what they showed before.
    const list = keyed(KEYED);
    list.set(replaced(['a', 'b', 'c']));
    expect(host.textContent).toBe('abc');
  });

  it('pairs duplicate keys positionally, as the map path does', () => {
    const list = keyed([
      { id: 1, label: 'a' },
      { id: 1, label: 'b' },
      { id: 2, label: 'c' },
    ]);
    const before = list.elements();

    const maps = mapsBuilt(() =>
      list.set([
        { id: 1, label: 'A' },
        { id: 1, label: 'B' },
        { id: 2, label: 'C' },
      ]),
    );

    expect(maps).toBe(0);
    expect(host.textContent).toBe('ABC');
    expect(list.elements()).toEqual(before);
  });

  it('takes the path again on a list that has just been reordered', () => {
    // The buffers swap on the pass that reorders, so the pass after it is the
    // one that would compare this pass's keys against a stale buffer.
    const list = keyed(KEYED);
    list.set([KEYED[2]!, KEYED[0]!, KEYED[1]!]);
    const before = list.elements();

    const maps = mapsBuilt(() =>
      list.set([
        { id: 3, label: 'THREE' },
        { id: 1, label: 'one' },
        { id: 2, label: 'two' },
      ]),
    );

    expect(maps).toBe(0);
    expect(host.textContent).toBe('THREEonetwo');
    expect(list.elements()).toEqual(before);
  });
});

describe('the first shape the fast path has to hand off', () => {
  it('hands off when the last key differs, and does not reuse that row', () => {
    // The boundary from the other side: everything matches until the final
    // comparison. A scan that stopped early — or one that only checked the
    // length — would refresh the row keyed 3 in place, which reads correctly
    // and is the wrong element: an id that changed is a different row, and
    // whatever was attached to the old one has to go with it.
    const list = keyed(KEYED);
    const before = list.elements();

    const maps = mapsBuilt(() =>
      list.set([KEYED[0]!, KEYED[1]!, { id: 9, label: 'nine' }]),
    );

    expect(maps).toBeGreaterThan(0);
    expect(host.textContent).toBe('onetwonine');
    const after = list.elements();
    expect(after.slice(0, 2)).toEqual(before.slice(0, 2));
    expect(after[2]).not.toBe(before[2]);
  });

  it('hands off when the first key differs', () => {
    const list = keyed(KEYED);
    const before = list.elements();

    const maps = mapsBuilt(() => list.set([{ id: 0, label: 'zero' }, KEYED[1]!, KEYED[2]!]));

    expect(maps).toBeGreaterThan(0);
    expect(host.textContent).toBe('zerotwothree');
    const after = list.elements();
    expect(after[0]).not.toBe(before[0]);
    expect(after.slice(1)).toEqual(before.slice(1));
  });

  it('hands off when the list is one longer, keys and order otherwise equal', () => {
    const list = keyed(KEYED);
    const before = list.elements();

    const maps = mapsBuilt(() => list.set([...KEYED, { id: 4, label: 'four' }]));

    expect(maps).toBeGreaterThan(0);
    expect(host.textContent).toBe('onetwothreefour');
    expect(list.elements().slice(0, 3)).toEqual(before);
  });

  it('hands off when the list is one shorter', () => {
    const list = keyed(KEYED);
    const before = list.elements();

    const maps = mapsBuilt(() => list.set(KEYED.slice(0, 2)));

    // The map, asserted rather than inferred, and this is the one hand-off
    // where that matters. A shortened list whose remaining keys are a prefix
    // of the old ones passes the key scan — only the length check refuses it —
    // and taking the fast path there leaves the dropped row's scope alive:
    // its nodes are written out of the document by the node buffer, so every
    // assertion about the page still holds while the row itself is never
    // disposed. Nothing visible in the DOM can see that. This can.
    expect(maps).toBeGreaterThan(0);
    expect(host.textContent).toBe('onetwo');
    expect(list.elements()).toEqual(before.slice(0, 2));
  });

  it('hands off a key that is NaN rather than pairing it', () => {
    // `===` and a `Map` disagree about `NaN` and only about `NaN`, and the
    // disagreement is in the safe direction: the scan refuses the pair and the
    // full algorithm, which compares keys the way a `Map` does, keeps the row.
    document.body.innerHTML = '<div id="app"></div>';
    host = document.querySelector('#app')!;
    const instance = mount(KeyedRows, host).instance as KeyedRows;
    instance.rows.set([{ id: Number.NaN, label: 'first' }]);
    flushSync();
    const before = host.querySelector('li')!;

    const maps = mapsBuilt(() => {
      instance.rows.set([{ id: Number.NaN, label: 'second' }]);
      flushSync();
    });

    expect(maps).toBeGreaterThan(0);
    expect(host.textContent).toBe('second');
    expect(host.querySelector('li')).toBe(before);
  });
});
