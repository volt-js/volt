/**
 * What a slot passes to the content that fills it.
 *
 * A slot outlet has always been able to hand data over — `<slot name="cell"
 * :row="row">` builds an object of getters — and until now nothing on the
 * other side could name it, so the data went nowhere. That is the gap a
 * component library cannot be built across: a table renders one cell template
 * once per row, and the template only means anything if the table can hand it
 * that row.
 *
 * `:slot-<name>="pattern"` is the naming. The pattern is the one `:for` takes
 * on its left, and what it binds are accessors over the outlet's getters — so
 * content follows the value it was handed rather than a copy of it, and a row
 * whose own signal changes rewrites one text node instead of rebuilding the
 * template that drew it.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { compileTemplate } from '@voltdev/core/jit';
import { Component, Prop, Signal, flushSync, mount } from '@voltdev/core';

let unmount: (() => void) | null = null;

afterEach(() => {
  unmount?.();
  unmount = null;
  document.body.innerHTML = '';
});

function show<T>(component: new () => T): { instance: T; host: HTMLElement } {
  const host = document.createElement('div');
  document.body.append(host);
  const handle = mount(component, host);
  unmount = handle.unmount;
  flushSync();
  return { instance: handle.instance as T, host };
}

interface Row {
  id: number;
  label: Signal.State<string>;
}

/** A list that hands each row's content the row and where it sits. */
@Component({
  selector: 'v-rows',
  render: compileTemplate(`
    <ul>
      <li :for="row in rows.get()" :key="row.id">
        <slot name="row" :row="row" :index="row.id">{ row.label.get() }</slot>
      </li>
    </ul>
  `),
})
class Rows {
  @Prop() rows = new Signal.State<Row[]>([]);
}

function twoRows(): Signal.State<Row[]> {
  return new Signal.State<Row[]>([
    { id: 1, label: new Signal.State('one') },
    { id: 2, label: new Signal.State('two') },
  ]);
}

describe('content that names what its slot passes', () => {
  it('binds the names it destructures, per row', () => {
    @Component({
      selector: 'v-page',
      imports: [Rows],
      render: compileTemplate(`
        <v-rows :rows="rows.get()">
          <template :slot-row="{ row, index }"><b>{ index }: { row.label.get() }</b></template>
        </v-rows>
      `),
    })
    class Page {
      rows = twoRows();
    }

    const { host } = show(Page);
    expect([...host.querySelectorAll('b')].map((b) => b.textContent)).toEqual(['1: one', '2: two']);
  });

  it('follows the value it was handed rather than a copy of it', () => {
    @Component({
      selector: 'v-page',
      imports: [Rows],
      render: compileTemplate(`
        <v-rows :rows="rows.get()">
          <template :slot-row="{ row }"><b>{ row.label.get() }</b></template>
        </v-rows>
      `),
    })
    class Page {
      rows = twoRows();
    }

    const { instance, host } = show(Page);
    const first = host.querySelector('b')!;
    first.dataset['mark'] = 'kept';

    // The row's own signal, not the list: the content rewrites its text and
    // stays the element it was.
    instance.rows.get()[0]!.label.set('ONE');
    flushSync();

    expect(host.querySelector('b')!.textContent).toBe('ONE');
    expect(host.querySelector('b')).toBe(first);
    expect(host.querySelector('b')!.dataset['mark']).toBe('kept');
  });

  it('binds the whole object under one name', () => {
    @Component({
      selector: 'v-page',
      imports: [Rows],
      render: compileTemplate(`
        <v-rows :rows="rows.get()">
          <template :slot-row="scope"><b>{ scope.index }</b></template>
        </v-rows>
      `),
    })
    class Page {
      rows = twoRows();
    }

    expect([...show(Page).host.querySelectorAll('b')].map((b) => b.textContent)).toEqual(['1', '2']);
  });

  it('fills a slot without naming anything, as content always could', () => {
    @Component({
      selector: 'v-page',
      imports: [Rows],
      render: compileTemplate(`<v-rows :rows="rows.get()"><b :slot-row>row</b></v-rows>`),
    })
    class Page {
      rows = twoRows();
    }

    expect([...show(Page).host.querySelectorAll('b')].map((b) => b.textContent)).toEqual([
      'row',
      'row',
    ]);
  });

  it('leaves the fallback where nothing fills the slot', () => {
    @Component({
      selector: 'v-page',
      imports: [Rows],
      render: compileTemplate(`<v-rows :rows="rows.get()"></v-rows>`),
    })
    class Page {
      rows = twoRows();
    }

    expect(show(Page).host.textContent).toContain('one');
  });

  it('binds what the default slot passes, from the tag', () => {
    @Component({
      selector: 'v-frame',
      render: compileTemplate(`<div><slot :name="who.get()">nobody</slot></div>`),
    })
    class Frame {
      who = new Signal.State('Ada');
    }

    @Component({
      selector: 'v-page',
      imports: [Frame],
      render: compileTemplate(`<v-frame :slot-default="{ name }"><b>{ name }</b></v-frame>`),
    })
    class Page {}

    expect(show(Page).host.querySelector('b')!.textContent).toBe('Ada');
  });
});
