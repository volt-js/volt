/**
 * The components themselves, driven the way a page drives them.
 *
 * Every one is a thin shell over a primitive: the primitive holds the
 * behaviour and this holds the markup and the classes the sheet draws. So
 * what is worth asserting is that the shell hands the primitive what it was
 * given, puts the classes where the sheet expects them, and leaves nothing of
 * the primitive out of reach.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Signal, flushSync, mount } from '@voltdev/core';
import { compileTemplate } from '@voltdev/core/jit';
import { Component } from '@voltdev/core';
import { compileComponents, VButton, VDialog, VTable, VTableColumn } from './render.js';

compileComponents();

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

describe('v-button', () => {
  it('is a button, with the sheet’s class and the caller’s own', () => {
    @Component({
      selector: 'v-page',
      imports: [VButton],
      render: compileTemplate(`<v-button variant="danger" size="sm" class="mine">Delete</v-button>`),
    })
    class Page {}

    const button = show(Page).host.querySelector('button')!;
    expect([...button.classList].sort()).toEqual(['mine', 'volt-button']);
    expect(button.dataset['variant']).toBe('danger');
    expect(button.dataset['size']).toBe('sm');
    expect(button.type).toBe('button');
    expect(button.textContent?.trim()).toBe('Delete');
  });

  it('calls back on a press, and refuses one while disabled', () => {
    const presses: string[] = [];

    @Component({
      selector: 'v-page',
      imports: [VButton],
      render: compileTemplate(
        `<v-button :onPress="press" :disabled="off.get()">Go</v-button>`,
      ),
    })
    class Page {
      off = new Signal.State(false);
      press = (): void => void presses.push('pressed');
    }

    const { instance, host } = show(Page);
    const button = host.querySelector('button')!;
    button.click();
    expect(presses).toEqual(['pressed']);

    instance.off.set(true);
    flushSync();
    button.click();
    // Refused, and still reachable by keyboard, which is the package's rule
    // for every disabled control.
    expect(presses).toEqual(['pressed']);
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.hasAttribute('disabled')).toBe(false);
  });
});

describe('v-dialog', () => {
  @Component({
    selector: 'v-page',
    imports: [VDialog, VButton],
    render: compileTemplate(`
      <v-button :onPress="openIt">Delete project</v-button>
      <v-dialog :open="open" title="Delete this project?" description="This cannot be undone."
                class="mine">
        <p>Body</p>
        <template :slot-footer><v-button :onPress="closeIt">Cancel</v-button></template>
      </v-dialog>
    `),
  })
  class Page {
    open = new Signal.State(false);
    openIt = (): void => this.open.set(true);
    closeIt = (): void => this.open.set(false);
  }

  it('opens and closes on the signal the page holds', () => {
    const { instance, host } = show(Page);
    expect(document.querySelector('.volt-dialog-content')).toBe(null);

    (host.querySelector('button') as HTMLButtonElement).click();
    flushSync();

    const content = document.querySelector('.volt-dialog-content')!;
    expect(content).not.toBe(null);
    expect(content.getAttribute('role')).toBe('dialog');
    expect(content.getAttribute('aria-modal')).toBe('true');
    // Named and described from the props, by the primitive's own ids.
    const labelledBy = content.getAttribute('aria-labelledby');
    expect(document.getElementById(labelledBy!)?.textContent).toBe('Delete this project?');
    expect(content.textContent).toContain('Body');
    expect(content.textContent).toContain('Cancel');
    // What the caller wrote on the tag reached the content element.
    expect(content.classList.contains('mine')).toBe(true);

    instance.open.set(false);
    flushSync();
    expect(document.querySelector('.volt-dialog-content')).toBe(null);
  });

  it('closes on Escape, which is the primitive’s doing', () => {
    const { instance } = show(Page);
    instance.open.set(true);
    flushSync();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    flushSync();
    expect(instance.open.get()).toBe(false);
  });

  it('hands the primitive itself to whoever needs more than this offers', () => {
    @Component({
      selector: 'v-page2',
      imports: [VDialog],
      render: compileTemplate(`<v-dialog :ref="box" title="t"><p>b</p></v-dialog>`),
    })
    class Page2 {
      box: VDialog | null = null;
    }

    const { instance } = show(Page2);
    expect(instance.box?.dialog.isOpen()).toBe(false);
    instance.box!.dialog.open();
    flushSync();
    expect(instance.box!.dialog.isOpen()).toBe(true);
  });
});

describe('v-table', () => {
  interface Person {
    id: number;
    name: string;
    owed: number;
  }

  const people: Person[] = [
    { id: 1, name: 'Ada', owed: 12 },
    { id: 2, name: 'Grace', owed: 340 },
  ];

  it('draws a heading per column and a cell per field', () => {
    @Component({
      selector: 'v-page',
      imports: [VTable, VTableColumn],
      render: compileTemplate(`
        <v-table :data="rows.get()">
          <v-table-column field="name" label="Name"></v-table-column>
          <v-table-column field="owed" label="Owed" align="end"></v-table-column>
        </v-table>
      `),
    })
    class Page {
      rows = new Signal.State(people);
    }

    const { host } = show(Page);
    expect([...host.querySelectorAll('th')].map((th) => th.textContent?.trim())).toEqual([
      'Name',
      'Owed',
    ]);
    expect([...host.querySelectorAll('tbody tr')].map((tr) => tr.textContent?.trim())).toEqual([
      'Ada12',
      'Grace340',
    ]);
    expect(host.querySelector('table')!.className).toBe('volt-table');
    expect(host.querySelectorAll('th')[1]!.getAttribute('data-align')).toBe('end');
    expect(host.querySelectorAll('tbody td')[1]!.getAttribute('data-align')).toBe('end');
  });

  it('draws the template a column was given, once per row, with the row', () => {
    const pressed: string[] = [];

    @Component({
      selector: 'v-page',
      imports: [VTable, VTableColumn, VButton],
      render: compileTemplate(`
        <v-table :data="rows.get()">
          <v-table-column field="name" label="Name"></v-table-column>
          <v-table-column label="Actions">
            <template :slot-cell="{ row }">
              <v-button :onPress="() => edit(row)">Edit { row.name }</v-button>
            </template>
          </v-table-column>
        </v-table>
      `),
    })
    class Page {
      rows = new Signal.State(people);
      edit = (row: Person): void => void pressed.push(row.name);
    }

    const { host } = show(Page);
    const buttons = [...host.querySelectorAll('tbody button')];
    expect(buttons.map((b) => b.textContent?.trim())).toEqual(['Edit Ada', 'Edit Grace']);

    (buttons[1] as HTMLButtonElement).click();
    expect(pressed).toEqual(['Grace']);
  });

  it('keeps the body in step with a column written later', () => {
    @Component({
      selector: 'v-page',
      imports: [VTable, VTableColumn],
      render: compileTemplate(`
        <v-table :data="rows.get()">
          <v-table-column field="name" label="Name"></v-table-column>
          <v-table-column :for="field in extra.get()" :key="field" :field="field" :label="field"></v-table-column>
          <v-table-column field="owed" label="Owed"></v-table-column>
        </v-table>
      `),
    })
    class Page {
      rows = new Signal.State(people);
      extra = new Signal.State<string[]>([]);
    }

    const { instance, host } = show(Page);
    instance.extra.set(['id']);
    flushSync();

    // The heading between the two written ones, and the cells under it: a
    // column that registers last is not a column that is drawn last.
    expect([...host.querySelectorAll('th')].map((th) => th.textContent?.trim())).toEqual([
      'Name',
      'id',
      'Owed',
    ]);
    expect([...host.querySelectorAll('tbody tr')].map((tr) => tr.textContent?.trim())).toEqual([
      'Ada112',
      'Grace2340',
    ]);
  });

  it('marks the rows a caller has selected, for the palette and the reader', () => {
    @Component({
      selector: 'v-page',
      imports: [VTable, VTableColumn],
      render: compileTemplate(`
        <v-table :data="rows.get()" :selected="chosen.get()">
          <v-table-column field="name" label="Name"></v-table-column>
        </v-table>
      `),
    })
    class Page {
      rows = new Signal.State(people);
      chosen = new Signal.State<ReadonlySet<number>>(new Set([2]));
    }

    const { instance, host } = show(Page);
    const rows = () =>
      [...host.querySelectorAll('tbody tr')].map((tr) => tr.getAttribute('aria-selected'));
    expect(rows()).toEqual([null, 'true']);

    instance.chosen.set(new Set([1]));
    flushSync();
    expect(rows()).toEqual(['true', null]);
  });

  it('shows what it was given in place of no rows at all', () => {
    @Component({
      selector: 'v-page',
      imports: [VTable, VTableColumn],
      render: compileTemplate(`
        <v-table :data="rows.get()" empty="No one owes anything.">
          <v-table-column field="name" label="Name"></v-table-column>
          <v-table-column field="owed" label="Owed"></v-table-column>
        </v-table>
      `),
    })
    class Page {
      rows = new Signal.State<Person[]>([]);
    }

    const { instance, host } = show(Page);
    const cell = host.querySelector('.volt-table-empty')!;
    expect(cell.textContent?.trim()).toBe('No one owes anything.');
    expect(cell.getAttribute('colspan')).toBe('2');

    instance.rows.set(people);
    flushSync();
    expect(host.querySelector('.volt-table-empty')).toBe(null);
  });

  it('refuses to be a column of nothing', () => {
    @Component({
      selector: 'v-page',
      imports: [VTableColumn],
      render: compileTemplate(`<div><v-table-column field="name"></v-table-column></div>`),
    })
    class Page {}

    expect(() => show(Page)).toThrow(/inside <v-table>/);
  });
});
