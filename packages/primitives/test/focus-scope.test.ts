/**
 * Focus scope.
 *
 * A modal that does not trap focus is not modal for keyboard users, and one
 * that does not restore focus drops them at the top of the document with no
 * way back. Both are invisible to anyone testing with a mouse, so they are
 * tested here.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Signal, createRoot, effect, flushSync } from '@voltdev/core';
import { createFocusScope, focusableWithin } from '@voltdev/primitives';

// Every browser's user-agent stylesheet hides `[hidden]`, which is how
// `checkVisibility()` knows to leave out a hidden element. happy-dom has no
// user-agent stylesheet, so it is given that one rule.
document.head.insertAdjacentHTML('beforeend', '<style>[hidden] { display: none }</style>');

let disposers: (() => void)[] = [];

function scope(el: Element, options: Parameters<typeof createFocusScope>[1] = {}) {
  createRoot((dispose) => {
    disposers.push(dispose);
    createFocusScope(() => el, options);
  });
}

beforeEach(() => {
  document.body.innerHTML = `
    <button id="opener">open</button>
    <div id="page"><button id="page-btn">page</button></div>
    <div id="layer">
      <button id="first">first</button>
      <input id="middle" />
      <button id="last">last</button>
    </div>
    <div id="empty"></div>`;
});

afterEach(() => {
  for (const dispose of disposers) dispose();
  disposers = [];
  flushSync();
});

const el = (id: string) => document.querySelector(`#${id}`) as HTMLElement;

describe('collecting focusable elements', () => {
  it('finds them in tab order', () => {
    expect(focusableWithin(el('layer')).map((n) => n.id)).toEqual(['first', 'middle', 'last']);
  });

  it('skips disabled and hidden elements', () => {
    el('middle').setAttribute('disabled', '');
    el('last').setAttribute('hidden', '');
    expect(focusableWithin(el('layer')).map((n) => n.id)).toEqual(['first']);
  });

  it('puts a positive tabindex first, lowest first, the way Tab visits it', () => {
    el('middle').setAttribute('tabindex', '2');
    el('last').setAttribute('tabindex', '1');
    expect(focusableWithin(el('layer')).map((n) => n.id)).toEqual(['last', 'middle', 'first']);
  });

  it('keeps document order among equal positive tabindexes', () => {
    el('last').setAttribute('tabindex', '1');
    el('first').setAttribute('tabindex', '1');
    expect(focusableWithin(el('layer')).map((n) => n.id)).toEqual(['first', 'last', 'middle']);
  });

  it('leaves out a control that has been taken out of the tab order', () => {
    // The resting items of a roving group: focusable by script, skipped by Tab.
    el('middle').setAttribute('tabindex', '-1');
    expect(focusableWithin(el('layer')).map((n) => n.id)).toEqual(['first', 'last']);
  });

  it('leaves out what an ancestor hides', () => {
    document.querySelector('#layer')!.insertAdjacentHTML(
      'beforeend',
      `<div style="display: none"><button id="collapsed">collapsed</button></div>
       <div hidden><button id="closed">closed</button></div>
       <div style="visibility: hidden"><button id="invisible">invisible</button></div>`,
    );
    expect(focusableWithin(el('layer')).map((n) => n.id)).toEqual(['first', 'middle', 'last']);
  });

  it('keeps what a hidden attribute marks but a stylesheet shows anyway', () => {
    // `hidden` hides by way of a style rule an author's own rule outranks, and
    // what is rendered can take focus whatever its attributes say.
    document.head.insertAdjacentHTML(
      'beforeend',
      '<style id="shown">.shown[hidden] { display: block }</style>',
    );
    try {
      document
        .querySelector('#layer')!
        .insertAdjacentHTML('beforeend', '<div class="shown" hidden><button id="kept">kept</button></div>');
      expect(focusableWithin(el('layer')).map((n) => n.id)).toEqual([
        'first',
        'middle',
        'last',
        'kept',
      ]);
    } finally {
      document.querySelector('#shown')!.remove();
    }
  });
});

describe('entering', () => {
  it('focuses the first focusable element', () => {
    el('opener').focus();
    scope(el('layer'));
    expect(document.activeElement).toBe(el('first'));
  });

  it('honours an explicit initial target', () => {
    scope(el('layer'), { initialFocus: () => el('middle') });
    expect(document.activeElement).toBe(el('middle'));
  });

  it('can be told not to take focus', () => {
    el('opener').focus();
    scope(el('layer'), { autoFocus: false });
    expect(document.activeElement).toBe(el('opener'));
  });

  it('passes over an element inside something hidden, which could not take focus', () => {
    el('first').insertAdjacentHTML(
      'beforebegin',
      '<div style="display: none"><button id="collapsed">collapsed</button></div>',
    );
    scope(el('layer'));
    expect(document.activeElement).toBe(el('first'));
  });

  it('focuses the container when nothing inside can take focus', () => {
    scope(el('empty'));
    // Otherwise focus stays in the page behind, which is the bug this avoids.
    expect(document.activeElement).toBe(el('empty'));
    expect(el('empty').getAttribute('tabindex')).toBe('-1');
  });
});

describe('trapping', () => {
  it('pulls focus back when it escapes to the page', () => {
    scope(el('layer'));
    expect(document.activeElement).toBe(el('first'));

    // However focus got out — Tab, a click, or script — it comes back.
    el('page-btn').focus();
    expect(document.activeElement).toBe(el('first'));
  });

  /** What a browser does for Tab: the key goes down, focus moves, the key comes up. */
  function tab(to: HTMLElement, init: KeyboardEventInit = {}) {
    const from = document.activeElement ?? document.body;
    from.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, ...init }));
    to.focus();
    (document.activeElement ?? document.body).dispatchEvent(
      new KeyboardEvent('keyup', { key: 'Tab', bubbles: true, ...init }),
    );
  }

  it('wraps to the last element when Shift+Tab leaves from the first', () => {
    scope(el('layer'));
    expect(document.activeElement).toBe(el('first'));

    // The page behind can take focus, so Shift+Tab from the first element
    // lands on whatever comes before the layer.
    tab(el('page-btn'), { shiftKey: true });
    expect(document.activeElement).toBe(el('last'));
  });

  it('wraps to the first when Tab leaves from the last', () => {
    scope(el('layer'));
    el('last').focus();

    tab(el('page-btn'));
    expect(document.activeElement).toBe(el('first'));
  });

  it('does not take a later escape for a Shift+Tab that is long over', () => {
    scope(el('layer'));
    el('middle').focus();
    tab(el('first'), { shiftKey: true });
    expect(document.activeElement).toBe(el('first'));

    // A click on the page, or script: nothing was heading backwards.
    el('page-btn').focus();
    expect(document.activeElement).toBe(el('first'));
  });

  it('leaves focus alone while it stays inside', () => {
    scope(el('layer'));
    el('last').focus();
    expect(document.activeElement).toBe(el('last'));
  });

  it('stops trapping once disposed', () => {
    scope(el('layer'));
    for (const dispose of disposers) dispose();
    disposers = [];

    el('page-btn').focus();
    expect(document.activeElement).toBe(el('page-btn'));
  });
});

describe('restoring', () => {
  it('returns focus to whatever had it before', () => {
    el('opener').focus();
    scope(el('layer'));
    expect(document.activeElement).toBe(el('first'));

    for (const dispose of disposers) dispose();
    disposers = [];
    expect(document.activeElement).toBe(el('opener'));
  });

  it('can be told not to restore', () => {
    el('opener').focus();
    scope(el('layer'), { restoreFocus: false });
    for (const dispose of disposers) dispose();
    disposers = [];

    expect(document.activeElement).not.toBe(el('opener'));
  });

  it('does not restore to an element that has left the document', () => {
    el('opener').focus();
    scope(el('layer'));
    el('opener').remove();

    // Must not throw, and must not try to focus a detached node.
    expect(() => {
      for (const dispose of disposers) dispose();
      disposers = [];
    }).not.toThrow();
  });
});

describe('inside an effect', () => {
  it('does not make the effect that created it depend on what initialFocus reads', () => {
    const target = new Signal.State<Element>(el('middle'));
    let runs = 0;
    createRoot((dispose) => {
      disposers.push(dispose);
      effect(() => {
        runs += 1;
        createFocusScope(() => el('layer'), { initialFocus: () => target.get() });
      });
    });
    flushSync();
    expect(document.activeElement).toBe(el('middle'));

    // Re-running would tear the scope down and build it again, moving focus
    // under a user who has not asked for anything.
    el('first').focus();
    target.set(el('last'));
    flushSync();
    expect(runs).toBe(1);
    expect(document.activeElement).toBe(el('first'));
  });

  it('does not make an effect that lets focus escape depend on what initialFocus reads', () => {
    const target = new Signal.State<Element>(el('middle'));
    scope(el('layer'), { initialFocus: () => target.get() });

    // The trap recovers inside whatever moved focus, and here that is an
    // effect: the getter's read would land in that effect's dependencies.
    let runs = 0;
    createRoot((dispose) => {
      disposers.push(dispose);
      effect(() => {
        runs += 1;
        el('page-btn').focus();
      });
    });
    flushSync();
    expect(document.activeElement).toBe(el('middle'));

    target.set(el('last'));
    flushSync();
    expect(runs).toBe(1);
  });
});

describe('recovering from an escape cannot recurse', () => {
  it('survives a container with nothing focusable inside', () => {
    // Moving focus fires blur on the old holder and focusin on the new one, so
    // a trap that recovers inside its own focusin handler can bounce between
    // them until the stack runs out. A review probe found exactly that.
    scope(el('empty'));

    expect(() => {
      el('page-btn').focus();
      el('page-btn').focus();
    }).not.toThrow();
  });

  it('survives an element that refuses focus', () => {
    const stubborn = el('layer');
    // An element whose focus() does nothing is indistinguishable from one the
    // browser declined to focus, which is the real-world version of this.
    const original = HTMLElement.prototype.focus;
    let calls = 0;
    HTMLElement.prototype.focus = function patched(this: HTMLElement) {
      calls += 1;
      if (calls > 500) throw new Error('runaway focus recovery');
    };

    try {
      scope(stubborn);
      expect(() => el('page-btn').dispatchEvent(new Event('focusin', { bubbles: true })))
        .not.toThrow();
    } finally {
      HTMLElement.prototype.focus = original;
    }
  });
});
