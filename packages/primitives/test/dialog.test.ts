/**
 * Dialog, driven through a real mounted component.
 *
 * The behaviour worth asserting is the accessibility: what a screen reader is
 * told, where focus goes and comes back to, and that the page behind is really
 * inert rather than merely covered.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compileTemplate } from '@voltdev/core/jit';
import {
  Component,
  Signal,
  createRoot,
  effect,
  flushSync,
  getFlushMetrics,
  mount,
  resetFlushMetrics,
} from '@voltdev/core';
import { createDialog, createDismiss, createPopover, createToaster } from '@voltdev/primitives';

let host: HTMLElement;
/**
 * Mounted components, unmounted after each test.
 *
 * Scroll locking is counted across every open dialog on the page, so a test
 * that leaves one mounted holds the lock for the next one — the same way an
 * application that never unmounts would.
 */
let mounted: { unmount(): void }[] = [];

function track<T extends { unmount(): void }>(handle: T): T {
  mounted.push(handle);
  return handle;
}

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div><div id="behind">page</div>';
  host = document.querySelector('#app')!;
});

afterEach(() => {
  for (const handle of mounted) handle.unmount();
  mounted = [];
  flushSync();
});

@Component({
  selector: 'v-confirm',
  render: compileTemplate(`
    <div>
      <button :ref="trigger" :spread="dialog.triggerProps()" :click="dialog.toggle()">open</button>
      <div :if="dialog.isPresent()" :portal :ref="content" :spread="dialog.contentProps()">
        <h2 :spread="dialog.titleProps()">Title</h2>
        <p :spread="dialog.descriptionProps()">Description</p>
        <button class="ok" :click="dialog.close()">ok</button>
      </div>
    </div>
  `),
})
class Confirm {
  trigger = new Signal.State<Element | null>(null);
  content = new Signal.State<Element | null>(null);
  dialog = createDialog({
    trigger: () => this.trigger.get(),
    content: () => this.content.get(),
  });
}

function setup() {
  const handle = track(mount(Confirm, host));
  const instance = handle.instance as Confirm;
  return {
    handle,
    instance,
    trigger: () => host.querySelector('button')!,
    content: () => document.querySelector('[role="dialog"]'),
  };
}

function escape() {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
}

describe('opening and closing', () => {
  it('starts closed with nothing rendered', () => {
    const { content } = setup();
    expect(content()).toBeNull();
  });

  it('opens from the trigger and renders outside the component', () => {
    const { trigger, content } = setup();
    trigger().click();
    flushSync();

    expect(content()).not.toBeNull();
    // Portalled, so it escapes any ancestor's overflow and stacking context.
    expect(host.contains(content())).toBe(false);
  });

  it('closes on Escape', () => {
    const { trigger, content } = setup();
    trigger().click();
    flushSync();

    escape();
    flushSync();
    expect(content()).toBeNull();
  });

  it('closes on a press outside', () => {
    const { trigger, content } = setup();
    trigger().click();
    flushSync();

    const behind = document.querySelector('#behind')!;
    behind.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    behind.dispatchEvent(new Event('pointerup', { bubbles: true }));
    flushSync();
    expect(content()).toBeNull();
  });

  it('does not close when the press is on the trigger', () => {
    const { trigger, content } = setup();
    trigger().click();
    flushSync();

    // Otherwise dismissal would close it and the trigger would reopen it.
    trigger().dispatchEvent(new Event('pointerdown', { bubbles: true }));
    trigger().dispatchEvent(new Event('pointerup', { bubbles: true }));
    flushSync();
    expect(content()).not.toBeNull();
  });

  it('reports changes through onOpenChange', () => {
    const onOpenChange = vi.fn();

    @Component({
      selector: 'v-cb',
      render: compileTemplate(
        `<div><button :click="dialog.open()">go</button>` +
          `<div :if="dialog.isPresent()" :ref="content" :spread="dialog.contentProps()">x</div></div>`,
      ),
    })
    class WithCallback {
      content = new Signal.State<Element | null>(null);
      dialog = createDialog({ content: () => this.content.get(), onOpenChange });
    }

    const handle = track(mount(WithCallback, host));
    host.querySelector('button')!.click();
    flushSync();
    expect(onOpenChange).toHaveBeenCalledWith(true);

    (handle.instance as WithCallback).dialog.close();
    flushSync();
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });
});

describe('told not to close', () => {
  it('keeps what it does not close on from the layer beneath', () => {
    const beneath = vi.fn();
    const disposeBeneath = createRoot((dispose) => {
      createDismiss(() => document.querySelector('#app'), beneath);
      return dispose;
    });
    try {
      @Component({
        selector: 'v-must-answer',
        render: compileTemplate(
          `<div><button :click="dialog.open()">open</button>` +
            `<div :if="dialog.isPresent()" :portal :ref="content" :spread="dialog.contentProps()">` +
            `<button>agree</button></div></div>`,
        ),
      })
      class MustAnswer {
        content = new Signal.State<Element | null>(null);
        dialog = createDialog({
          content: () => this.content.get(),
          closeOnEscape: false,
          closeOnOutsidePointer: false,
        });
      }

      const page = track(mount(MustAnswer, host)).instance as MustAnswer;
      host.querySelector('button')!.click();
      flushSync();

      // A modal that will not close is still where the key and the press were
      // aimed; whatever it covers must not close behind it instead.
      escape();
      const behind = document.querySelector('#behind')!;
      behind.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      behind.dispatchEvent(new Event('pointerup', { bubbles: true }));
      flushSync();
      expect(page.dialog.isOpen()).toBe(true);
      expect(beneath).not.toHaveBeenCalled();
    } finally {
      disposeBeneath();
    }
  });
});

describe('opened from an effect', () => {
  @Component({
    selector: 'v-upload',
    render: compileTemplate(
      `<div><div :if="dialog.isPresent()" :portal :ref="content" :spread="dialog.contentProps()">` +
        `<button>retry</button></div></div>`,
    ),
  })
  class Upload {
    failed = new Signal.State(false);
    content = new Signal.State<Element | null>(null);
    dialog = createDialog({ content: () => this.content.get() });

    constructor() {
      effect(() => {
        if (this.failed.get()) this.dialog.open();
      });
    }
  }

  it('does not make the effect depend on the dialog it opened', () => {
    const upload = track(mount(Upload, host)).instance as Upload;
    upload.failed.set(true);
    flushSync();
    expect(upload.dialog.isOpen()).toBe(true);

    // Closed while `failed` still holds. An effect that had subscribed to the
    // dialog's state would run again here and open it straight back up.
    upload.dialog.close();
    flushSync();
    expect(upload.dialog.isOpen()).toBe(false);
  });

  it('does not make an effect that toggles it depend on it either', () => {
    const upload = track(mount(Upload, host)).instance as Upload;
    const flip = new Signal.State(false);
    const dispose = createRoot((dispose) => {
      effect(() => {
        if (flip.get()) upload.dialog.toggle();
      });
      return dispose;
    });
    flip.set(true);
    flushSync();
    expect(upload.dialog.isOpen()).toBe(true);

    upload.dialog.close();
    flushSync();
    expect(upload.dialog.isOpen()).toBe(false);
    dispose();
  });
});

describe('what assistive technology is told', () => {
  it('labels the trigger and links it to the content', () => {
    const { trigger, content } = setup();
    expect(trigger().getAttribute('aria-haspopup')).toBe('dialog');
    expect(trigger().getAttribute('aria-expanded')).toBe('false');

    trigger().click();
    flushSync();
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(trigger().getAttribute('aria-controls')).toBe(content()!.id);
  });

  it('marks the content as a modal dialog, labelled and described', () => {
    const { trigger, content } = setup();
    trigger().click();
    flushSync();

    const el = content()!;
    expect(el.getAttribute('role')).toBe('dialog');
    expect(el.getAttribute('aria-modal')).toBe('true');
    expect(el.getAttribute('aria-labelledby')).toBe(el.querySelector('h2')!.id);
    expect(el.getAttribute('aria-describedby')).toBe(el.querySelector('p')!.id);
  });

  it('omits the label reference when no title was rendered', () => {
    @Component({
      selector: 'v-bare',
      render: compileTemplate(
        `<div><button :click="dialog.open()">go</button>` +
          `<div :if="dialog.isPresent()" :ref="content" :spread="dialog.contentProps()">no title</div></div>`,
      ),
    })
    class Bare {
      content = new Signal.State<Element | null>(null);
      dialog = createDialog({ content: () => this.content.get() });
    }

    track(mount(Bare, host));
    host.querySelector('button')!.click();
    flushSync();

    // A dangling aria-labelledby is worse than none: both announce an
    // unlabelled dialog, but the dangling one hides the mistake.
    const el = document.querySelector('[role="dialog"]')!;
    expect(el.hasAttribute('aria-labelledby')).toBe(false);
  });

  it('hides the rest of the page from screen readers while open', () => {
    const { trigger } = setup();
    const behind = document.querySelector('#behind')!;

    trigger().click();
    flushSync();
    // A focus trap does not bind a screen reader's own cursor; without this
    // the page behind can be read straight through the dialog.
    expect(behind.getAttribute('aria-hidden')).toBe('true');

    escape();
    flushSync();
    expect(behind.hasAttribute('aria-hidden')).toBe(false);
  });

  it('leaves a toaster announcing, so a toast raised meanwhile is heard', () => {
    @Component({
      selector: 'v-with-toasts',
      render: compileTemplate(`
        <div>
          <button :click="dialog.open()">open</button>
          <div class="region" :portal :ref="region" :spread="toaster.regionProps()">
            <div class="toast" :for="toast in toaster.visible()" :key="toast.id"
                 :spread="toaster.toastProps(toast)">{ toast.data() }</div>
          </div>
          <div :if="dialog.isPresent()" :portal :ref="content" :spread="dialog.contentProps()">
            <button>ok</button>
          </div>
        </div>
      `),
    })
    class WithToasts {
      region = new Signal.State<Element | null>(null);
      content = new Signal.State<Element | null>(null);
      toaster = createToaster<string>({ region: () => this.region.get(), duration: 0 });
      dialog = createDialog({ content: () => this.content.get() });
    }

    const page = track(mount(WithToasts, host)).instance as WithToasts;
    host.querySelector('button')!.click();
    flushSync();
    expect(document.querySelector('#behind')!.getAttribute('aria-hidden')).toBe('true');

    page.toaster.add('Saved');
    flushSync();

    // The region holds no live region of its own until a toast arrives, and an
    // inert subtree is out of the accessibility tree: a toast raised inside
    // one is never announced.
    const toast = document.querySelector('.toast')!;
    expect(toast.getAttribute('aria-live')).toBe('polite');
    expect(toast.closest('[inert]')).toBeNull();
    expect(toast.closest('[aria-hidden="true"]')).toBeNull();
  });
});

describe('focus', () => {
  it('moves into the dialog on open and back to the trigger on close', () => {
    const { trigger, content } = setup();
    trigger().focus();

    trigger().click();
    flushSync();
    expect(content()!.contains(document.activeElement)).toBe(true);

    escape();
    flushSync();
    expect(document.activeElement).toBe(trigger());
  });

  it('keeps focus inside while open', () => {
    const { trigger } = setup();
    trigger().click();
    flushSync();

    const behind = document.querySelector('#behind') as HTMLElement;
    behind.tabIndex = 0;
    behind.focus();

    expect(document.querySelector('[role="dialog"]')!.contains(document.activeElement)).toBe(true);
  });
});

describe('scroll locking', () => {
  it('locks the page while open and releases it after', () => {
    const { trigger } = setup();
    trigger().click();
    flushSync();
    expect(document.body.style.overflow).toBe('hidden');

    escape();
    flushSync();
    expect(document.body.style.overflow).not.toBe('hidden');
  });

  it('pads the page by the width of the scrollbar it hides', () => {
    // happy-dom lays nothing out, so the root reports whatever width it is told.
    const root = document.documentElement;
    const original = Object.getOwnPropertyDescriptor(root, 'clientWidth');
    Object.defineProperty(root, 'clientWidth', {
      configurable: true,
      get: () => window.innerWidth - 15,
    });

    try {
      const { trigger } = setup();
      trigger().click();
      flushSync();
      expect(document.body.style.paddingRight).toBe('15px');

      escape();
      flushSync();
      expect(document.body.style.paddingRight).toBe('');
    } finally {
      if (original) Object.defineProperty(root, 'clientWidth', original);
      else Reflect.deleteProperty(root, 'clientWidth');
    }
  });

  it('measures the scrollbar in the measure lane, not with a layout of its own', () => {
    const { trigger } = setup();
    resetFlushMetrics();
    trigger().click();
    flushSync();

    // A geometry read from an ordinary effect forces a layout the flush's
    // one measure drain would otherwise have paid for.
    expect(getFlushMetrics().strayReads).toBe(0);
  });
});

describe('another layer opened from inside', () => {
  /** A pointer press and the click it becomes, focusing on the way as a browser does. */
  function pressAndClick(el: HTMLElement) {
    el.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    el.focus();
    el.dispatchEvent(new Event('pointerup', { bubbles: true }));
    el.click();
    flushSync();
  }

  it('lets focus into a popover opened from the dialog, and keeps it open there', () => {
    @Component({
      selector: 'v-dialog-popover',
      render: compileTemplate(`
        <div>
          <button class="open" :click="dialog.open()">open</button>
          <div :if="dialog.isPresent()" :portal :ref="content" :spread="dialog.contentProps()">
            <button class="first">first</button>
            <button class="filters" :ref="trigger" :spread="popover.triggerProps()">filters</button>
          </div>
          <div :if="popover.isPresent()" :portal :ref="panel" :spread="popover.contentProps()">
            <input class="field" />
            <input class="other" />
          </div>
        </div>
      `),
    })
    class WithPopover {
      content = new Signal.State<Element | null>(null);
      trigger = new Signal.State<Element | null>(null);
      panel = new Signal.State<Element | null>(null);
      dialog = createDialog({ content: () => this.content.get() });
      popover = createPopover({
        trigger: () => this.trigger.get(),
        content: () => this.panel.get(),
      });
    }

    const page = track(mount(WithPopover, host)).instance as WithPopover;
    host.querySelector<HTMLElement>('.open')!.click();
    flushSync();

    pressAndClick(document.querySelector<HTMLElement>('.filters')!);
    // The popover is portalled out of the dialog, but it is a layer above it:
    // the dialog's trap has no business pulling focus back out of it.
    expect(page.popover.isOpen()).toBe(true);
    expect(document.activeElement).toBe(document.querySelector('.field'));

    document.querySelector<HTMLElement>('.other')!.focus();
    flushSync();
    expect(page.popover.isOpen()).toBe(true);
    expect(document.activeElement).toBe(document.querySelector('.other'));

    // Back into the dialog is outside the popover, which closes; the dialog
    // stays.
    document.querySelector<HTMLElement>('.first')!.focus();
    flushSync();
    expect(page.popover.isOpen()).toBe(false);
    expect(page.dialog.isOpen()).toBe(true);
    expect(document.activeElement).toBe(document.querySelector('.first'));
  });

  it('lets focus into a dialog opened from the dialog, and gives it back after', () => {
    @Component({
      selector: 'v-dialog-dialog',
      render: compileTemplate(`
        <div>
          <button class="open" :click="outer.open()">open</button>
          <div :if="outer.isPresent()" :portal class="outer" :ref="outerContent"
               :spread="outer.contentProps()">
            <button class="confirm" :click="inner.open()">delete</button>
          </div>
          <div :if="inner.isPresent()" :portal class="inner" :ref="innerContent"
               :spread="inner.contentProps()">
            <button class="sure">sure</button>
          </div>
        </div>
      `),
    })
    class Stacked {
      outerContent = new Signal.State<Element | null>(null);
      innerContent = new Signal.State<Element | null>(null);
      outer = createDialog({ content: () => this.outerContent.get() });
      inner = createDialog({ content: () => this.innerContent.get() });
    }

    const page = track(mount(Stacked, host)).instance as Stacked;
    host.querySelector<HTMLElement>('.open')!.click();
    flushSync();

    const confirm = document.querySelector<HTMLElement>('.confirm')!;
    pressAndClick(confirm);
    expect(page.inner.isOpen()).toBe(true);
    expect(document.activeElement).toBe(document.querySelector('.sure'));
    // The outer dialog is page behind the inner one now.
    expect(document.querySelector('.outer')!.getAttribute('aria-hidden')).toBe('true');

    escape();
    flushSync();
    expect(page.inner.isOpen()).toBe(false);
    expect(page.outer.isOpen()).toBe(true);
    expect(document.activeElement).toBe(confirm);
    expect(document.querySelector('.outer')!.hasAttribute('aria-hidden')).toBe(false);
    // One lock per dialog, so the outer one still holds the page still.
    expect(document.body.style.overflow).toBe('hidden');
  });
});
