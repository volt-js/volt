/**
 * Which way a grid's row runs, and what that does to the arrows.
 *
 * Column 0 is at the inline start whatever the page's direction, and every
 * position the grid hands out — a column's `start`, a range, an export's
 * column order, a copy — is a place in the data, which runs the same way in
 * both. Three things follow the direction instead, because they are physical:
 * a transform, which moves an element left or right and not toward an end;
 * a pointer's `clientX`, which grows to the right; and the arrow keys, which
 * point at the screen. Right to left, the inline end is on the left, so the
 * distance a transform carries, the distance a drag covers, and the arrow that
 * walks toward the inline end are all mirrored. Logical properties need
 * nothing: the sticky insets, the margin and the padding a pinned grid moves
 * by are measured from the inline start already, and the browser puts that on
 * the right by itself.
 *
 * The answer is the browser's own: the `direction` the grid's element is laid
 * out in, read from computed style. A `dir` attribute is one way a page says
 * it, a stylesheet another, an ancestor a third, and only the computed value
 * hears all of them — and it is what the geometry is laid out by, which is
 * the question being asked. Asking for a computed style has the browser bring
 * its styles up to date first, so it is asked in the measure lane, where the
 * axes' reads have already paid for that, and only when it may have changed:
 * when the element arrives, when a `dir` is written on the element itself,
 * and when the nearest locale's direction changes. An element out of the
 * document has no style to ask — a page may build the grid before it attaches
 * it — so there the read waits for the grid to be laid out, which is the first
 * moment it has one.
 *
 * Nothing watches the rest of the page. A `dir` written on an ancestor would
 * need an observer over every element above the grid, or one over the whole
 * document, woken by every attribute any part of the page writes — a cost
 * paid by every grid for a change a page makes about never. A locale provider
 * already pays for that observer, once, and changes its direction when the
 * region it governs changes; the grid hears it through the locale and reads
 * its own element again. A page that turns its direction over above the grid
 * with no locale to say so should mount the grid again, which reads it afresh.
 *
 * A layer over the grid that reads an arrow — the grouping, opening a group
 * from its header — asks the grid it is in, not the page. A cell may run its
 * own way, as a label in another script marked with `dir` does, and the
 * arrows that open a group have to agree with the ones that walk the row they
 * are pressed in; nor does a keypress then ask for a style the measure lane
 * has already read.
 */

import { Signal, effect, measureEffect, onCleanup } from '@voltdev/core';
import type { Direction, Locale } from '@voltdev/primitives';

const { untrack } = Signal.subtle;

/**
 * Each mounted grid's element, and the direction that grid last read there.
 *
 * Keyed weakly, by the element, because that is all a layer has to go on: it
 * is handed a key event, not the grid, and it must not keep an element the
 * page has thrown away.
 */
const mountedGrids = new WeakMap<Element, () => Direction>();

/**
 * The direction `el` is laid out in.
 *
 * `ltr` where the document has no view to ask — a detached document, or one
 * built for parsing — since a layout nothing will draw has no side to mirror.
 */
export function directionOf(el: Element): Direction {
  const view = el.ownerDocument.defaultView;
  return view?.getComputedStyle(el).direction === 'rtl' ? 'rtl' : 'ltr';
}

/**
 * The direction of the element `root` names, kept current.
 *
 * `ltr` until the element is first measured, which is also all a server
 * render ever sees: a server drains no measure lane, and the first window it
 * writes sits at the inline start, where a mirrored transform and an
 * unmirrored one are both zero.
 *
 * `laidOut` is read in place of the style while the element is out of the
 * document, and only then: anything that changes as the grid is first laid
 * out, which sends the read round again once there is a style to ask.
 */
export function watchDirection(
  root: () => Element | null | undefined,
  locale: Locale,
  laidOut: () => unknown,
): () => Direction {
  const direction = new Signal.State<Direction>('ltr');
  const read = (): Direction => direction.get();
  /**
   * Bumped by a `dir` written on the element, to send the read below round
   * again. A count rather than the new direction, because the observer runs
   * outside the measure lane, and the attribute is only one of the things
   * that decide the answer.
   */
  const written = new Signal.State(0);
  /**
   * The locale's direction, held apart from everything it is worked out from.
   * Read directly, it would subscribe the read below to the locale's language
   * as well, and a change of language that leaves the direction where it was
   * would ask for a style for nothing.
   */
  const told = new Signal.Computed(() => locale.direction());
  /**
   * The `dir` the element carried when its style was last read, or undefined
   * before the first read. A locale governing the grid's own element writes
   * its `dir` there as its direction changes, and by the time the observer
   * hears of that write the read the locale sent round has already seen it.
   */
  let readUnder: string | null | undefined;
  /** Sends the read round again for a `dir` on `el` that the last read did not see. */
  const hear = (el: Element): void => {
    if (el.getAttribute('dir') === readUnder) return;
    written.set(untrack(() => written.get()) + 1);
  };

  measureEffect(() => {
    const el = root();
    // Read only to be told: a locale's direction is the page saying that the
    // region's direction may have changed, and computed style is what says
    // whether the grid's has.
    told.get();
    written.get();
    if (!el) return;
    // Asked out of the document, the style answers left to right, and nothing
    // would ask again when the page attaches the element: no `dir` is written
    // and no locale changes. Laid out, it has been attached.
    if (!el.isConnected) {
      laidOut();
      return;
    }
    readUnder = el.getAttribute('dir');
    direction.set(directionOf(el));
  });

  effect(() => {
    const el = root();
    if (!el) return;
    mountedGrids.set(el, read);
    onCleanup(() => {
      // A grid mounted on the same element since has put its own there.
      if (mountedGrids.get(el) === read) mountedGrids.delete(el);
    });
    if (typeof MutationObserver === 'undefined') return;
    const observer = new MutationObserver(() => hear(el));
    observer.observe(el, { attributes: true, attributeFilter: ['dir'] });
    onCleanup(() => observer.disconnect());
    // The measure lane read the element before this ran, and an effect that
    // ran in between may have written its `dir` with nothing yet listening.
    hear(el);
  });

  return read;
}

/**
 * The direction of the grid `el` is inside, as that grid last read it — or,
 * inside none, the direction `el` is laid out in.
 *
 * Found by walking up to the grid's own element, not by role: a grouped grid
 * is a `treegrid`, and the nearest element with either role could as well be
 * a grid a consumer put inside a cell.
 */
export function gridDirection(el: Element): Direction {
  for (let at: Element | null = el; at !== null; at = at.parentElement) {
    const read = mountedGrids.get(at);
    if (read !== undefined) return untrack(read);
  }
  return directionOf(el);
}

/**
 * A key as the grid's keyboard map reads it: `ArrowRight` toward the inline
 * end, `ArrowLeft` toward the start.
 *
 * Right to left the two arrows trade places, as they do in the browser's own
 * controls and in AG Grid: the arrow pointing at the next column on screen is
 * the one that reaches it. Every other key is the same both ways — Home and
 * End already name the ends of the row, and the rows do not run upward.
 */
export function inlineKey(key: string, direction: Direction): string {
  if (direction !== 'rtl') return key;
  if (key === 'ArrowRight') return 'ArrowLeft';
  if (key === 'ArrowLeft') return 'ArrowRight';
  return key;
}
