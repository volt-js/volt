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
import { compileComponents, VButton, VDialog } from './render.js';

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
