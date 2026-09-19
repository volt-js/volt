/**
 * Dismissal — closing a layer on Escape or a pointer outside it.
 *
 * Every dismissable layer needs the same three rules, and the details are
 * where libraries get this wrong:
 *
 *   - **Only the topmost layer responds to Escape.** With a dialog open over a
 *     popover, one keypress must close one layer, not both. That needs a
 *     shared stack, which is why this is a module-level registry rather than
 *     per-component state. Topmost of the layers that take the key, that is: a
 *     layer registered with `escape: false` has said the key is not its own,
 *     and the one beneath is asked instead — a tooltip that stays up through
 *     Escape must not cost the dialog under it the key. The same goes for a
 *     press and `outsidePointer: false`.
 *   - **Outside is measured on pointer *down*, acted on at pointer *up*.**
 *     Using click alone closes a layer when a drag that began inside it
 *     happens to release outside — selecting text in a dialog and releasing
 *     past its edge should not dismiss it.
 *   - **Nested layers are inside their parent.** A popover opened from a
 *     dialog is not "outside" the dialog, even though it is not a DOM
 *     descendant once portalled, so containment is asked of the whole stack
 *     above a layer rather than of its element alone.
 */

import { onCleanup } from '@voltdev/core';

export interface DismissOptions {
  /** Elements that count as inside, beyond the layer itself — e.g. a trigger. */
  exclude?: () => (Element | null | undefined)[];
  /**
   * Escape closes this layer. Default true. When false the key passes to the
   * layer beneath; a layer that must keep it from there takes it and declines
   * in `onDismiss`.
   */
  escape?: boolean;
  /**
   * A pointer press outside closes this layer. Default true. When false the
   * press is the layer beneath's to judge, as Escape is.
   */
  outsidePointer?: boolean;
}

interface Layer {
  node: () => Element | null | undefined;
  onDismiss: (reason: DismissReason) => void;
  options: DismissOptions;
}

export type DismissReason = 'escape' | 'outside-pointer';

/** Open layers, oldest first. The last entry is the topmost. */
const stack: Layer[] = [];
let listening = false;

/**
 * Close `onDismiss` when this layer should go away.
 *
 * Registers for as long as the calling scope lives, so a layer rendered under
 * `:if` is on the stack exactly while it is on screen.
 */
export function createDismiss(
  node: () => Element | null | undefined,
  onDismiss: (reason: DismissReason) => void,
  options: DismissOptions = {},
): void {
  const layer: Layer = { node, onDismiss, options };
  stack.push(layer);
  attach();

  onCleanup(() => {
    const index = stack.indexOf(layer);
    if (index !== -1) stack.splice(index, 1);
    detachIfIdle();
  });
}

function attach(): void {
  if (listening || typeof document === 'undefined') return;
  listening = true;
  // Capture, so a layer still dismisses when something inside the page stops
  // propagation on the way up.
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('pointerup', onPointerUp, true);
}

function detachIfIdle(): void {
  if (!listening || stack.length > 0) return;
  listening = false;
  document.removeEventListener('keydown', onKeyDown, true);
  document.removeEventListener('pointerdown', onPointerDown, true);
  document.removeEventListener('pointerup', onPointerUp, true);
}

/** The index of the topmost layer that takes this kind of dismissal, or -1. */
function topmost(kind: 'escape' | 'outsidePointer'): number {
  let index = stack.length - 1;
  while (index >= 0 && stack[index]!.options[kind] === false) index -= 1;
  return index;
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return;
  stack[topmost('escape')]?.onDismiss('escape');
}

/**
 * Where the current press started.
 *
 * Held between down and up so a drag that began inside a layer cannot dismiss
 * it by releasing outside.
 */
let pressedInside: boolean | null = null;

function onPointerDown(event: PointerEvent): void {
  const top = topmost('outsidePointer');
  pressedInside = top === -1 ? null : isInsideStack(event.target, top);
}

function onPointerUp(event: PointerEvent): void {
  const startedInside = pressedInside;
  pressedInside = null;
  if (startedInside !== false) return;

  const top = topmost('outsidePointer');
  // Both ends of the press have to be outside before this counts.
  if (top === -1 || isInsideStack(event.target, top)) return;

  stack[top]!.onDismiss('outside-pointer');
}

/**
 * Let the press in progress end without dismissing anything.
 *
 * For a layer that the press itself has just been spoken for by — a context
 * menu asked to move by a second right-click, where the platform sends
 * `contextmenu` between the button going down and coming up. That press began
 * outside the menu and will end there, and it is a request for the menu, not
 * a dismissal of it. With no press in progress this does nothing, which is
 * what makes it safe to call for the keyboard's context-menu key as well.
 */
export function forgetPress(): void {
  pressedInside = null;
}

/**
 * Whether `target` lies within the layer at `index` or anything stacked above
 * it, or within that layer's declared exclusions.
 */
function isInsideStack(target: EventTarget | null, index: number): boolean {
  if (!(target instanceof Node)) return false;

  for (let i = index; i < stack.length; i++) {
    const layer = stack[i]!;
    const el = layer.node();
    if (el?.contains(target)) return true;

    for (const extra of layer.options.exclude?.() ?? []) {
      if (extra?.contains(target)) return true;
    }
  }
  return false;
}

/**
 * Whether `target` is inside the layer whose element is `el`, counting every
 * layer stacked above it as inside.
 *
 * The pointer rule's containment, for the rules that watch focus instead: a
 * focus trap, and a popover that closes when focus lands outside it. A popover
 * or a menu opened from a dialog is portalled out of the dialog's subtree, so
 * each of those rules would see focus moving into it as focus leaving — and
 * two of them watching the whole document pull focus in opposite directions.
 *
 * Exclusions are not counted. They are where a press may land without
 * dismissing a layer, and a tooltip's trigger elsewhere on the page is not
 * somewhere focus becomes part of the layer beneath it. An element that no
 * layer registered answers for its own subtree alone.
 */
export function isInsideLayer(el: Element, target: Node): boolean {
  if (el.contains(target)) return true;
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i]!.node() !== el) continue;
    for (let j = i + 1; j < stack.length; j++) {
      if (stack[j]!.node()?.contains(target)) return true;
    }
    return false;
  }
  return false;
}

/** Test seam: the number of layers currently registered. */
export function dismissStackSize(): number {
  return stack.length;
}
