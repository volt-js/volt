/**
 * Which events get a real listener, and why that is not a preference.
 *
 * Chrome registers a `wheel`, `touchstart` or `touchmove` listener on the
 * document as passive whatever the listener asked for, so `preventDefault()`
 * from inside one is discarded. Delegating those events therefore compiled
 * `:wheel.prevent` into a handler that could not prevent anything — silently,
 * since the only symptom is a console warning in a browser no test runs in.
 *
 * happy-dom does not enforce that rule, so this file installs it: a
 * document-level listener for one of those types runs with `preventDefault`
 * neutered, exactly as the browser leaves it. Delegate `wheel` again and the
 * first test below goes red rather than passing on a lie.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { compileTemplate } from '@voltdev/core/jit';
import { Component, mount } from '@voltdev/core';
import { compile } from '@voltdev/compiler';
import { createRoot } from '@voltdev/reactivity';
import * as runtime from '@voltdev/core/runtime';

/** The types a browser forces passive when the listener sits at the root. */
const FORCED_PASSIVE = new Set(['wheel', 'touchstart', 'touchmove']);

/** Every event type a listener has been registered for on the document. */
const documentTypes: string[] = [];

const addToDocument = document.addEventListener.bind(document);

function recordAndForcePassive(
  type: string,
  listener: EventListener,
  options?: boolean | AddEventListenerOptions,
): void {
  documentTypes.push(type);
  if (!FORCED_PASSIVE.has(type)) {
    addToDocument(type, listener, options);
    return;
  }
  addToDocument(
    type,
    (event: Event) => {
      Object.defineProperty(event, 'preventDefault', { configurable: true, value: () => {} });
      try {
        listener.call(document, event);
      } finally {
        Reflect.deleteProperty(event, 'preventDefault');
      }
    },
    options,
  );
}

// Installed for the file rather than per test: the runtime registers a type at
// the document only the first time it delegates one, so a patch installed in a
// hook would miss whichever test ran second.
document.addEventListener = recordAndForcePassive as typeof document.addEventListener;

let host: HTMLElement;

beforeEach(() => {
  documentTypes.length = 0;
  document.body.innerHTML = '<div id="app"></div>';
  host = document.querySelector('#app')!;
});

describe('events that must not be delegated', () => {
  it('cancels a wheel, which a delegated listener could not', () => {
    const adjust = vi.fn();

    @Component({
      selector: 'v-wheelslider',
      render: compileTemplate(`<div :wheel.prevent="adjust()"></div>`),
    })
    class WheelSlider {
      adjust = adjust;
    }

    mount(WheelSlider, host);
    const event = new Event('wheel', { bubbles: true, cancelable: true });
    host.querySelector('div')!.dispatchEvent(event);

    expect(adjust).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  // The passive rule covers the first three; the rest are here because an
  // ancestor walk per event is the wrong trade for one that fires all frame,
  // and because cancelling `dragover` is how a drop target declares itself.
  for (const name of [
    'wheel',
    'touchstart',
    'touchmove',
    'touchend',
    'touchcancel',
    'mousemove',
    'mouseover',
    'mouseout',
    'pointermove',
    'pointerover',
    'pointerout',
    'dragover',
  ]) {
    it(`attaches :${name} to the element rather than the document`, () => {
      const seen = vi.fn();

      @Component({
        selector: `v-direct-${name}`,
        render: compileTemplate(`<div :${name}="seen()"></div>`),
      })
      class Direct {
        seen = seen;
      }

      mount(Direct, host);
      // Nothing that does not bubble ever reaches a document listener, so only
      // a listener on the element itself can see this one.
      host.querySelector('div')!.dispatchEvent(new Event(name, { bubbles: false }));

      expect(seen).toHaveBeenCalledTimes(1);
      expect(documentTypes).not.toContain(name);
    });
  }

  it('still delegates a click, so the absences above mean something', () => {
    @Component({
      selector: 'v-delegatedclick',
      render: compileTemplate(`<button :click="go()"></button>`),
    })
    class Delegated {
      go = vi.fn();
    }

    mount(Delegated, host);
    expect(documentTypes).toContain('click');
  });
});

describe('a page the server rendered', () => {
  it('attaches once for the type, not once per element it hydrates', () => {
    // The claim is about a page with many handlers, so the fixture has many:
    // a hundred rows, each with its own click. A hydration that attached per
    // element would install a hundred listeners and the page would still
    // work, which is why the count is what is asserted and not the clicking.
    const { body } = compile(
      `<ul><li :for="row in rows" :key="row"><button :click="pick(row)">{ row }</button></li></ul>`,
      { runtime: '_rt', target: 'hydrate' },
    );

    // Asserted on the emit as well as on the count: a build that stopped
    // emitting the handler at all would also attach nothing.
    expect(body).toContain('_rt.delegate(');
    expect(body).not.toContain('addEventListener');

    const picked: string[] = [];
    const rows = Array.from({ length: 100 }, (_, i) => `r${i}`);
    host.innerHTML = `<ul>${rows.map((r) => `<li><button>${r}</button></li>`).join('')}</ul>`;

    const before = documentTypes.filter((type) => type === 'click').length;

    // Counted on the prototype, because counting at the document cannot tell
    // "delegated once" from "attached to each button": neither moves the
    // document's tally, and both leave the page working. This is the number
    // that separates them.
    const elementListeners: string[] = [];
    const real = Element.prototype.addEventListener;
    Element.prototype.addEventListener = function (
      this: Element,
      type: string,
      ...rest: unknown[]
    ) {
      if (this !== (document as unknown as Element)) elementListeners.push(type);
      return (real as (...args: unknown[]) => void).call(this, type, ...rest);
    } as typeof Element.prototype.addEventListener;

    const render = (new Function('_rt', body) as (rt: unknown) => (ctx: object) => unknown)(runtime);
    try {
      createRoot(() => {
        runtime.hydrate(host, () => render({ rows, pick: (row: string) => picked.push(row) }));
      });
    } finally {
      Element.prototype.addEventListener = real;
    }
    const after = documentTypes.filter((type) => type === 'click').length;

    // Not one per button, and not one per button's ancestor either.
    expect(elementListeners).toEqual([]);
    // Zero or one at the document: zero when an earlier test in this file
    // already registered `click` there, which is the whole point of
    // registering it there. Never a hundred.
    expect(after - before).toBeLessThanOrEqual(1);

    // And the handlers work, so the count above is a count of something real.
    host.querySelectorAll('button')[42]!.click();
    expect(picked).toEqual(['r42']);
  });
});
