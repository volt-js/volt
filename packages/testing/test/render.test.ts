/**
 * The mount/unmount runtime.
 *
 * The assertion this file exists for is `leakedEffects()`. Everything else
 * here — the container, the instance, where the queries look — is scaffolding
 * around the one guarantee that cannot be seen by eye: after unmount the
 * scheduler is watching exactly what it watched before, so nothing the
 * component created is still observing a tree that no longer exists.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  Component,
  Signal,
  createRoot,
  effect,
  flushSync,
  onCleanup,
  renderEffect,
} from '@voltdev/core';
import { compileTemplate } from '@voltdev/core/jit';
import { createResource } from '@voltdev/primitives';
import { cleanup, render } from '../src/render.ts';
import { liveEffectCount } from '../src/scheduler.ts';

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

@Component({
  selector: 'v-counter',
  render: compileTemplate(`
    <div>
      <button :click="n.set(n.get() + 1)">Add one</button>
      <p role="status">{ n.get() }</p>
    </div>
  `),
})
class Counter {
  n = new Signal.State(0);
  /** A deferred effect, which is the kind a leak is usually made of. */
  seen = 0;
  watcher = effect(() => {
    this.n.get();
    this.seen++;
  });
}

describe('render', () => {
  it('mounts into the document, where delegated events can reach it', () => {
    const view = render(Counter);

    expect(view.container.parentElement).toBe(document.body);
    expect(view.getByRole('status').textContent).toBe('0');

    view.getByRole('button', { name: 'Add one' }).click();
    flushSync();
    expect(view.getByRole('status').textContent).toBe('1');
  });

  it('hands back the instance', () => {
    const view = render(Counter);
    view.instance.n.set(7);
    flushSync();
    expect(view.getByRole('status').textContent).toBe('7');
  });

  it('has already flushed deferred effects when it returns', () => {
    const view = render(Counter);
    // Not 0: a user effect's first run is deferred, and a caller that had to
    // flush before asserting would be testing the scheduler, not the component.
    expect(view.instance.seen).toBe(1);
  });

  it('takes the container away on unmount, and does not mind being called twice', () => {
    const view = render(Counter);
    const { container } = view;

    view.unmount();
    expect(container.parentElement).toBeNull();
    expect(document.body.innerHTML).toBe('');
    expect(() => view.unmount()).not.toThrow();
  });
});

describe('queries on the result', () => {
  it('find portalled content, which is not inside the container', () => {
    @Component({
      selector: 'v-portalled',
      render: compileTemplate(`
        <div>
          <button>Open</button>
          <div :portal role="dialog" aria-label="Settings">panel</div>
        </div>
      `),
    })
    class Portalled {}

    const view = render(Portalled);

    // The whole reason the bound queries look at the document: a portal
    // renders outside the component that declared it, and a container-scoped
    // query would miss precisely the part worth asserting on.
    expect(view.container.querySelector('[role="dialog"]')).toBeNull();
    expect(view.getByRole('dialog', { name: 'Settings' }).textContent).toBe('panel');
  });

  it('go quiet again once unmounted', () => {
    const view = render(Counter);
    expect(view.queryByRole('status')).not.toBeNull();
    view.unmount();
    expect(view.queryByRole('status')).toBeNull();
  });
});

describe('leaked effects', () => {
  it('are none for a component that unmounts cleanly', () => {
    const view = render(Counter);
    view.instance.n.set(3);
    flushSync();

    view.unmount();
    expect(view.leakedEffects()).toBe(0);
  });

  it('are none for effects created inside other effects', () => {
    @Component({
      selector: 'v-nested',
      render: compileTemplate('<p :if="open.get()">{ label() }</p>'),
    })
    class Nested {
      open = new Signal.State(true);
      inner = new Signal.State('a');
      // A render effect that owns a user effect: disposal has to walk the
      // scope tree, not just the effects created at the top level.
      shell = renderEffect(() => {
        effect(() => void this.inner.get());
      });

      label(): string {
        return this.inner.get();
      }
    }

    const view = render(Nested);
    view.instance.open.set(false);
    flushSync();

    view.unmount();
    expect(view.leakedEffects()).toBe(0);
  });

  it('count an effect that outlives the component', () => {
    const escaped = new Signal.State(0);
    let stop = (): void => {};

    @Component({
      selector: 'v-leaky',
      render: compileTemplate('<p>{ n.get() }</p>'),
    })
    class Leaky {
      n = escaped;
      constructor() {
        // The failure this whole mechanism exists for, written on purpose. A
        // detached root is owned by nobody, so unmounting the component cannot
        // dispose what is inside it — which is what a global store that
        // subscribes lazily and never unsubscribes looks like from the
        // scheduler's side, and nothing in the DOM says so.
        createRoot((dispose) => {
          stop = dispose;
          effect(() => void escaped.get());
        }, null);
      }
    }

    const view = render(Leaky);
    view.unmount();

    expect(view.leakedEffects()).toBe(1);
    stop();
    expect(view.leakedEffects()).toBe(0);
  });

  it('count a resource that outlives the component, though it fetches from the data lane', () => {
    let stop = (): void => {};

    @Component({
      selector: 'v-leaky-resource',
      render: compileTemplate('<p>{ user.status() }</p>'),
    })
    class LeakyResource {
      // The same escape as above, made by a resource: its request is started
      // from a data effect rather than a user one, and a count that watched
      // only the user and render lanes would call this component clean.
      user = createRoot((dispose) => {
        stop = dispose;
        return createResource(async () => 'Ada');
      }, null);
    }

    const view = render(LeakyResource);
    view.unmount();

    expect(view.leakedEffects()).toBe(1);
    stop();
    expect(view.leakedEffects()).toBe(0);
  });

  it('run cleanups on unmount', () => {
    const order: string[] = [];

    @Component({
      selector: 'v-cleanup',
      render: compileTemplate('<p>{ n.get() }</p>'),
    })
    class WithCleanup {
      n = new Signal.State(0);
      watcher = effect(() => {
        this.n.get();
        onCleanup(() => order.push('effect'));
      });
    }

    const view = render(WithCleanup);
    view.unmount();

    expect(order).toEqual(['effect']);
    expect(view.leakedEffects()).toBe(0);
  });
});

describe('cleanup', () => {
  it('unmounts everything still mounted, newest first', () => {
    const before = liveEffectCount();
    const first = render(Counter);
    render(Counter);

    cleanup();

    expect(document.body.innerHTML).toBe('');
    expect(liveEffectCount()).toBe(before);
    // Already gone, so its own unmount is a no-op rather than an error.
    expect(() => first.unmount()).not.toThrow();
  });

  it('does not mind being called with nothing mounted', () => {
    expect(() => cleanup()).not.toThrow();
  });
});
