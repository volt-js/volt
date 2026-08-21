/**
 * Driving a row's bindings from one effect must not change what it renders.
 *
 * Grouping trades allocation for coarser invalidation, and the only thing that
 * is allowed to differ is how many times a binding's accessor runs — never the
 * DOM it produces, and never when it stops running. The nesting cases matter
 * most: content built inside a row belongs to that row, and joining the row's
 * group would keep it alive after the row is gone.
 */
import { describe, expect, it } from 'vitest';
import { compile } from '@voltdev/compiler';
import { Signal, flushSync } from '@voltdev/core';
import type { RenderFn } from '@voltdev/core';
import { createRoot } from '@voltdev/reactivity';
import * as runtime from '@voltdev/core/runtime';

function render(source: string, grouped: boolean): RenderFn {
  const { body } = compile(source, { runtime: '_rt', groupRowBindings: grouped });
  return (new Function('_rt', body) as (rt: unknown) => RenderFn)(runtime);
}

/**
 * Mount a template against a plain context object and return the host.
 *
 * Bypasses `mount`, which wants a decorated class; these cases vary the
 * context per run, and what is under test is the render function itself.
 */
function host(source: string, grouped: boolean, ctx: object): Element {
  document.body.innerHTML = '<div></div>';
  const el = document.body.firstElementChild!;
  createRoot(() => {
    runtime.insert(el, render(source, grouped)(ctx));
  });
  return el;
}

const LIST = `<ul>
  <li :for="row in rows.get()" :key="row.id" :class="{ on: row.id === sel.get() }">
    <span>{ row.id }</span><b>{ row.label.get() }</b>
  </li>
</ul>`;

interface Row {
  id: number;
  label: Signal.State<string>;
}

function rows(n: number): Row[] {
  return Array.from({ length: n }, (_, i) => ({
    id: i,
    label: new Signal.State(`row ${i}`),
  }));
}

describe('grouped row bindings', () => {
  it('emits one effect for the row instead of one per binding', () => {
    const plain = compile(LIST, { groupRowBindings: false }).renderBody;
    const grouped = compile(LIST, { groupRowBindings: true }).renderBody;

    expect(plain).not.toContain('_rt.group(');
    expect(grouped).toContain('_rt.group(');
    // The bindings moved inside the group rather than being duplicated.
    for (const source of [plain, grouped]) {
      expect(source.match(/_rt\.bind/g)).toHaveLength(3);
    }
  });

  it('renders and updates identically either way', () => {
    const shots: string[][] = [];

    for (const grouped of [false, true]) {
      const ctx = { rows: new Signal.State(rows(4)), sel: new Signal.State(-1) };
      const el = host(LIST, grouped, ctx);
      const taken: string[] = [];
      taken.push(el.innerHTML);

      ctx.sel.set(2);
      flushSync();
      taken.push(el.innerHTML);

      ctx.rows.get()[1]!.label.set('changed');
      flushSync();
      taken.push(el.innerHTML);

      // A wholesale replacement with one different element, the case a row's
      // item signal exists to make cheap.
      const next = ctx.rows.get().slice();
      next[3] = { id: 3, label: new Signal.State('replaced') };
      ctx.rows.set(next);
      flushSync();
      taken.push(el.innerHTML);

      shots.push(taken);
    }

    expect(shots[1]).toEqual(shots[0]);
  });

  it('reuses the row nodes when only one binding changes', () => {
    const ctx = { rows: new Signal.State(rows(3)), sel: new Signal.State(-1) };
    const el = host(LIST, true, ctx);
    const before = Array.from(el.firstElementChild!.children);

    ctx.sel.set(1);
    flushSync();

    const after = Array.from(el.firstElementChild!.children);
    expect(after).toEqual(before);
    expect((after[1] as Element).className).toBe('on');
    expect((after[0] as Element).className).toBe('');
  });

  it('keeps nested content out of the row group, so it dies with the row', () => {
    // `open` is read only by the nested branch. If that branch had joined the
    // row's group it would still be attached after the row was removed, and
    // this counter would keep climbing.
    let reads = 0;
    const open = new Signal.State(true);
    const ctx = {
      rows: new Signal.State(rows(2)),
      sel: new Signal.State(-1),
      open: {
        get(): boolean {
          reads++;
          return open.get();
        },
      },
    };

    const source = `<ul>
      <li :for="row in rows.get()" :key="row.id" :class="{ on: row.id === sel.get() }">
        <span>{ row.id }</span>
        <em :if="open.get()">{ row.label.get() }</em>
      </li>
    </ul>`;

    const el = host(source, true, ctx);
    expect(el.querySelectorAll('em')).toHaveLength(2);

    ctx.rows.set([]);
    flushSync();
    expect(el.querySelectorAll('em')).toHaveLength(0);

    const settled = reads;
    open.set(false);
    flushSync();
    expect(reads).toBe(settled);
  });

  it('does not group across a nested list', () => {
    const ctx = {
      rows: new Signal.State([
        { id: 1, tags: new Signal.State(['a', 'b']) },
        { id: 2, tags: new Signal.State(['c']) },
      ]),
    };
    const source = `<ul>
      <li :for="row in rows.get()" :key="row.id">
        <span>{ row.id }</span>
        <i :for="tag in row.tags.get()" :key="tag">{ tag }</i>
      </li>
    </ul>`;

    const el = host(source, true, ctx);
    expect(el.textContent?.replace(/\s+/g, '')).toBe('1ab2c');

    ctx.rows.get()[1]!.tags.set(['c', 'd']);
    flushSync();
    expect(el.textContent?.replace(/\s+/g, '')).toBe('1ab2cd');
  });
});
