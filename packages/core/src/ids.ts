/**
 * Ids for wiring ARIA relationships, derived from where a component sits
 * rather than from when it was created.
 *
 * `aria-labelledby` and friends refer to elements by id, so a component that
 * renders twice on a page needs two distinct ids without the author supplying
 * them. A counter was enough for a browser, and is wrong for a server twice
 * over: one process renders many pages at once, so a counter hands request B
 * ids that continue request A's; and once a stream flushes out of order,
 * render order stops matching document order, so the same element is numbered
 * differently depending on which fetch happened to answer first.
 *
 * Position has neither problem. Every component instantiation enters a frame
 * that knows its index in its parent, and an id is that path plus a number
 * from the frame that mints it. Two renders of the same tree therefore agree
 * on every id, which is also what hydration needs: the client has to arrive at
 * the id the server wrote without being told it.
 *
 * A frame's counter serves both purposes — child frames and ids — so an id
 * minted in a parent can never collide with one minted below it: everything
 * below carries at least one more segment.
 *
 * What is *not* claimed: an instantiation that happens after the first render,
 * from an effect rather than from its parent's construction, has no frame to
 * sit in and mints from the root. Those ids stay unique, which is all a
 * browser asks of them; they are not stable across a reload, and nothing that
 * appears only after hydration needs them to be. A lazy component is the
 * exception, because it appears late on one side and not the other: it holds
 * its place instead — see `holdPosition`.
 */

import { clearRequestState, requestState } from '@voltdev/reactivity';

interface Frame {
  readonly parent: Frame | null;
  readonly index: number;
  /** Handed out to the next child frame or the next id, whichever asks. */
  next: number;
  /** Built on the first id minted here, and only then — most frames mint none. */
  path: string | null;
}

const ROOT = Symbol('volt.ids');

/**
 * The frame everything without a parent mints from — per request, so two
 * concurrent renders cannot be handed the same id.
 */
function rootFrame(): Frame {
  return requestState(ROOT, () => ({ parent: null, index: -1, next: 0, path: '' }));
}

let frame: Frame | null = null;

/**
 * Enter the frame of the component being instantiated, returning the frame it
 * displaced. Synchronous by contract: `instantiate` restores in a `finally`,
 * so no frame is ever open across an `await`.
 */
export function enterPosition(): Frame | null {
  const parent = frame ?? rootFrame();
  const previous = frame;
  frame = { parent, index: parent.next++, next: 0, path: null };
  return previous;
}

export function exitPosition(previous: Frame | null): void {
  frame = previous;
}

/**
 * Take a child's place in the current frame for a component built later.
 *
 * A lazy component is instantiated when its chunk lands, from an effect, where
 * there is no frame at all — so it would mint from the root, and whatever came
 * after it in its parent would be numbered one lower than on a side that had
 * the chunk already. Both sides take the place when the walk passes it, and
 * both build into it through `atPosition`, which is what makes the server's
 * ids and the browser's agree however each came by the chunk.
 *
 * What is kept is a stand-in for the parent, holding the index this child was
 * given: its path is the parent's, so a frame opened under it is the frame the
 * child would have had.
 */
export function holdPosition(): Frame {
  const parent = frame ?? rootFrame();
  return { parent: parent.parent, index: parent.index, next: parent.next++, path: parent.path };
}

/** Run `build` where `holdPosition` took a place, so the frame it opens is that place. */
export function atPosition<T>(held: Frame, build: () => T): T {
  const previous = frame;
  // A copy, so the place itself is never advanced: building into it again
  // would open the same place, not the next.
  frame = { ...held };
  try {
    return build();
  } finally {
    frame = previous;
  }
}

function pathOf(target: Frame): string {
  return (target.path ??= `${pathOf(target.parent!)}${target.index}-`);
}

export function createId(prefix = 'volt'): string {
  const owner = frame ?? rootFrame();
  return `${prefix}-${pathOf(owner)}${owner.next++}`;
}

/** Test seam: start numbering this request's tree again from the top. */
export function resetIds(): void {
  clearRequestState(ROOT);
}
