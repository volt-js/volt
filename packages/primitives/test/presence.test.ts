/**
 * Presence, driven through a real mounted component.
 *
 * happy-dom computes declared style but runs no animations, and has no
 * `getAnimations` to ask what is running. That is exactly the "nothing is
 * animating" path, which is the one that has to be synchronous — an
 * unanimated library must not pay a frame of latency to close a menu.
 *
 * The animated path is exercised the way a browser would present it: the
 * styles are declared in a real stylesheet, what the engine would report
 * running once the element is marked closed is reported on that element, and
 * finishing an animation does what a browser does — settles its promise and
 * sends its end event.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { compileTemplate } from '@voltdev/core/jit';
import { Component, Signal, flushSync, mount } from '@voltdev/core';
import { createPresence } from '@voltdev/primitives';

let host: HTMLElement;
let mounted: { unmount(): void }[] = [];

beforeEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '<div id="app"></div>';
  host = document.querySelector('#app')!;
});

afterEach(() => {
  for (const handle of mounted) handle.unmount();
  mounted = [];
  flushSync();
  document.head.innerHTML = '';
});

@Component({
  selector: 'v-overlay',
  render: compileTemplate(
    `<div><p :if="presence.isPresent()" class="panel" :ref="content" :attr-data-state="presence.state()">body</p></div>`,
  ),
})
class Overlay {
  open = new Signal.State(false);
  content = new Signal.State<Element | null>(null);
  presence = createPresence(
    () => this.open.get(),
    () => this.content.get(),
  );
}

function setup() {
  const handle = mount(Overlay, host);
  mounted.push(handle);
  const instance = handle.instance as Overlay;
  return { handle, instance, panel: () => host.querySelector('p') };
}

/** Open the overlay, and hand back its element. */
function opened(instance: Overlay, panel: () => Element | null): Element {
  instance.open.set(true);
  flushSync();
  return panel()!;
}

/**
 * Declare styles, the way a stylesheet would. Longhands, because happy-dom
 * computes those and not the shorthands.
 */
function declare(css: string): void {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.append(style);
}

interface Played {
  /** Run to the end: settle `finished`, then send the end event. */
  finish(): void;
  /** Stop part way: reject `finished`, then send the cancel event. */
  cancel(): void;
}

interface PlayOptions {
  kind?: 'animation' | 'transition';
  playState?: AnimationPlayState;
  endTime?: number;
}

/**
 * Report these as the animations the engine has running on `el` while it
 * matches `when` — the rule the stylesheet declares them on. A browser has an
 * exit animation to report only once the element is marked closed, and asking
 * any earlier finds nothing.
 */
function running(el: Element, when: string, ...plays: PlayOptions[]): Played[] {
  const played = plays.map(({ kind = 'animation', playState = 'running', endTime = 150 }) => {
    let settle!: () => void;
    let abort!: (reason: unknown) => void;
    const finished = new Promise<Animation>((resolve, reject) => {
      settle = () => resolve(animation);
      abort = reject;
    });
    // A cancelled animation's promise rejects; nobody here is required to ask.
    finished.catch(() => {});
    const animation = {
      playState,
      finished,
      effect: { getComputedTiming: () => ({ endTime }) },
    } as unknown as Animation;

    return {
      animation,
      finish() {
        settle();
        el.dispatchEvent(new Event(`${kind}end`));
      },
      cancel() {
        abort(new DOMException('The animation was cancelled.', 'AbortError'));
        el.dispatchEvent(new Event(`${kind}cancel`));
      },
    };
  });

  Object.defineProperty(el, 'getAnimations', {
    configurable: true,
    value: () => (el.matches(when) ? played.map((play) => play.animation) : []),
  });
  return played;
}

/** Where every exit in this file is declared. */
const CLOSED = "[data-state='closed']";

/** Promise callbacks run as microtasks; let every one that is queued run. */
async function settled(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
  flushSync();
}

describe('without an animation', () => {
  it('starts absent when closed', () => {
    const { panel } = setup();
    expect(panel()).toBeNull();
  });

  it('appears immediately on open, marked open', () => {
    const { instance, panel } = setup();
    instance.open.set(true);
    flushSync();

    expect(panel()).not.toBeNull();
    expect(panel()!.getAttribute('data-state')).toBe('open');
  });

  it('leaves immediately on close, since nothing is animating', () => {
    const { instance, panel } = setup();
    instance.open.set(true);
    flushSync();

    instance.open.set(false);
    flushSync();
    // No waiting for a frame or a timer that would never fire.
    expect(panel()).toBeNull();
  });

  it('survives repeated open and close', () => {
    const { instance, panel } = setup();
    for (let i = 0; i < 3; i++) {
      instance.open.set(true);
      flushSync();
      expect(panel()).not.toBeNull();
      instance.open.set(false);
      flushSync();
      expect(panel()).toBeNull();
    }
  });
});

describe('with an exit animation', () => {
  beforeEach(() => {
    declare(`[data-state='closed'] { animation-name: fade-out; animation-duration: 150ms; }`);
  });

  it('stays mounted until the animation ends', async () => {
    const { instance, panel } = setup();
    const el = opened(instance, panel);
    const [exit] = running(el, CLOSED, {});

    instance.open.set(false);
    flushSync();

    // Still in the DOM, and marked closed so CSS can animate it out.
    expect(panel()).not.toBeNull();
    expect(panel()!.getAttribute('data-state')).toBe('closed');

    exit!.finish();
    await settled();
    expect(panel()).toBeNull();
  });

  it('ignores an animation ending on a descendant', async () => {
    const { instance, panel } = setup();
    const el = opened(instance, panel);
    const child = document.createElement('span');
    el.appendChild(child);
    const [exit] = running(el, CLOSED, {});

    instance.open.set(false);
    flushSync();

    // A child finishing its own animation must not tear down the parent.
    child.dispatchEvent(new Event('animationend', { bubbles: true }));
    await settled();
    expect(panel()).not.toBeNull();

    exit!.finish();
    await settled();
    expect(panel()).toBeNull();
  });

  it('cancels the exit when reopened mid-animation', async () => {
    const { instance, panel } = setup();
    const el = opened(instance, panel);
    const [exit] = running(el, CLOSED, {});

    instance.open.set(false);
    flushSync();
    expect(panel()!.getAttribute('data-state')).toBe('closed');

    instance.open.set(true);
    flushSync();
    expect(panel()!.getAttribute('data-state')).toBe('open');

    // The superseded exit must not release the content it no longer owns.
    exit!.finish();
    await settled();
    expect(panel()).not.toBeNull();
  });

  it('releases when the animation is cancelled too', async () => {
    const { instance, panel } = setup();
    const el = opened(instance, panel);
    const [exit] = running(el, CLOSED, {});

    instance.open.set(false);
    flushSync();
    expect(panel()).not.toBeNull();

    exit!.cancel();
    await settled();
    expect(panel()).toBeNull();
  });

  it('waits for the last of several, not the first to end', async () => {
    declare(
      `[data-state='closed'] { transition-property: opacity, transform; transition-duration: 150ms, 300ms; }`,
    );
    const { instance, panel } = setup();
    const el = opened(instance, panel);
    const [fade, slide] = running(
      el,
      CLOSED,
      { kind: 'transition', endTime: 150 },
      { kind: 'transition', endTime: 300 },
    );

    instance.open.set(false);
    flushSync();

    // Letting go at the first end event would cut the slide off halfway.
    fade!.finish();
    await settled();
    expect(panel()).not.toBeNull();

    slide!.finish();
    await settled();
    expect(panel()).toBeNull();
  });
});

describe('with something declared that closing does not start', () => {
  it('leaves at once when an animation declared in every state has long finished', () => {
    // Written on the element whatever its state: it ran as the panel arrived,
    // its name does not change on close, so it does not run again — and no
    // end event is coming.
    declare(`.panel { animation-name: fade-in; animation-duration: 150ms; }`);
    const { instance, panel } = setup();
    const el = opened(instance, panel);
    running(el, '.panel');

    instance.open.set(false);
    flushSync();
    expect(panel()).toBeNull();
  });

  it('leaves at once when that animation fills forwards and so is still reported', () => {
    declare(`.panel { animation-name: fade-in; animation-duration: 150ms; animation-fill-mode: both; }`);
    const { instance, panel } = setup();
    const el = opened(instance, panel);
    running(el, '.panel', { playState: 'finished' });

    instance.open.set(false);
    flushSync();
    expect(panel()).toBeNull();
  });

  it('leaves at once when closing changes nothing a transition is declared on', () => {
    // `transition: color` kept for a hover effect: closing changes no colour,
    // so no transition starts and no transitionend will ever arrive.
    declare(`.panel { transition-property: color; transition-duration: 150ms; }`);
    const { instance, panel } = setup();
    const el = opened(instance, panel);
    running(el, '.panel');

    instance.open.set(false);
    flushSync();
    expect(panel()).toBeNull();
  });

  it('leaves at once when the closed state loops for ever', () => {
    declare(
      `[data-state='closed'] { animation-name: pulse; animation-duration: 1s; animation-iteration-count: infinite; }`,
    );
    const { instance, panel } = setup();
    const el = opened(instance, panel);
    running(el, CLOSED, { endTime: Infinity });

    instance.open.set(false);
    flushSync();
    expect(panel()).toBeNull();
  });
});
