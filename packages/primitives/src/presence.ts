/**
 * Presence — keeping content mounted until its exit animation has finished.
 *
 * Every overlay needs this. Removing a node the instant it closes means no
 * exit animation can ever play, but removing it on a timer means guessing a
 * duration that CSS already knows.
 *
 * This needs no support from the framework. Volt removes nodes when `:if`
 * turns false, so presence simply keeps that condition true a little longer:
 * on close it flips a `data-state` attribute, asks the element what is
 * actually animating on it, and lets the node go once all of that has
 * finished. If nothing is — no animation declared, one that closing does not
 * start, or reduced motion turning it off — the node is released
 * synchronously, so a library that never animates pays nothing and needs no
 * configuration.
 *
 *   class Dialog {
 *     open = new Signal.State(false);
 *     content = new Signal.State<Element | null>(null);
 *     presence = createPresence(
 *       () => this.open.get(),
 *       () => this.content.get(),
 *     );
 *   }
 *
 *   <div :if="presence.isPresent()"
 *        :ref="content"
 *        :attr-data-state="presence.state()">…</div>
 *
 * and in CSS:
 *
 *   [data-state='open']   { animation: fade-in  150ms; }
 *   [data-state='closed'] { animation: fade-out 150ms; }
 */

import { Signal, effect, onCleanup } from '@voltdev/core';

// The proposal's own name for reading without subscribing; Volt adds no second
// spelling for it.
const { untrack } = Signal.subtle;

export type PresenceState = 'open' | 'closed';

export interface Presence {
  /** Whether the content should be in the DOM right now. */
  isPresent(): boolean;
  /** Write to `data-state` so CSS can drive the animation. */
  state(): PresenceState;
}

export function createPresence(
  open: () => boolean,
  node: () => Element | null | undefined,
): Presence {
  const present = new Signal.State(untrack(open));

  let stopWaiting: (() => void) | null = null;

  const release = () => {
    stopWaiting?.();
    stopWaiting = null;
    present.set(false);
  };

  effect(() => {
    const isOpen = open();

    if (isOpen) {
      // Re-opening mid-exit has to cancel the wait, or the pending release
      // would tear down content that is on its way back in.
      stopWaiting?.();
      stopWaiting = null;
      present.set(true);
      return;
    }

    if (!untrack(() => present.get())) return;

    // The element already carries `data-state="closed"`: the state is derived
    // from `open` below rather than written from here, so the render effects
    // that put it on the element ran before this one — Volt flushes render
    // effects before user effects. Asking for its animations now applies the
    // exit rule and starts whatever that rule starts.
    const el = untrack(node);
    const running = el ? exitAnimations(el) : [];
    if (running.length === 0) {
      release();
      return;
    }

    // All of them, not the first to end: a fade over 150ms and a slide over
    // 300ms are one exit, and letting go at the first would cut the second off
    // halfway. A cancelled animation settles too, so an exit interrupted for
    // any reason still lets the node go.
    let superseded = false;
    stopWaiting = () => {
      superseded = true;
    };
    void Promise.allSettled(running.map((animation) => animation.finished)).then(() => {
      if (!superseded) release();
    });
  });

  onCleanup(() => stopWaiting?.());

  return {
    isPresent: () => present.get(),
    // Derived, not held. Written from the effect above, it would reach the DOM
    // a pass after that effect has asked the element what closing started — so
    // the question would be put to the open state, which starts no exit.
    state: () => (open() ? 'open' : 'closed'),
  };
}

/**
 * What is actually animating on the element now that it is marked closed.
 *
 * Asking the element rather than being told a duration is what lets CSS stay
 * the single source of truth — including when a `prefers-reduced-motion` rule
 * has turned the animation off, which shows up here as nothing running. And
 * asking what runs, rather than what is declared, is what makes that safe: an
 * animation written on the element in every state finished long before the
 * close and does not start again, and a `transition: color` kept for a hover
 * effect starts nothing when closing changes no colour. Neither sends an end
 * event, so waiting on either would keep the node in the page for good.
 *
 * Only the element's own count, so a spinner inside a panel cannot end the
 * panel's exit. And only one with an end: an infinite animation in the closed
 * state is a loop rather than an exit, and waiting for it would be waiting
 * for ever.
 */
function exitAnimations(el: Element): Animation[] {
  // A DOM implemented for tests may have no animation engine to ask, and
  // nothing animates there.
  if (typeof el.getAnimations !== 'function') return [];
  return el
    .getAnimations()
    .filter(
      (animation) =>
        animation.playState === 'running' &&
        Number.isFinite(animation.effect?.getComputedTiming().endTime),
    );
}
