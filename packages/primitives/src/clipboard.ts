/**
 * Copy to clipboard, with the three details that are always got wrong.
 *
 * The copying itself is one call. What makes this worth writing once is
 * everything around it:
 *
 *   - **The copied state has to end.** A button that says "Copied" for ever
 *     is lying by the time the user looks back at it, and one that resets on
 *     the next render resets at a moment that has nothing to do with the copy.
 *     So the state is held for a stated window and released on a timer that is
 *     cancelled if the component goes away first.
 *   - **The change has to be announced.** Swapping a label from "Copy" to
 *     "Copied" inside a button is a change to the button's own accessible
 *     name, which screen readers announce inconsistently and often not at all
 *     while focus is sitting on it. The sentence goes through the shared
 *     announcer instead, which is a region built for exactly this.
 *   - **It fails outside a secure context**, and on a page served over plain
 *     HTTP `navigator.clipboard` is simply not there. That is not an edge
 *     case for an internal tool on a LAN. The fallback is the old
 *     selection-and-`execCommand` dance, which is deprecated, still
 *     implemented everywhere, and the only thing that works there.
 *
 * A failure is reported rather than swallowed. The clipboard can refuse — a
 * permission policy, a page that is not focused — and a button that shows
 * "Copied" when nothing was copied is worse than one that shows nothing.
 */

import { Signal, onCleanup } from '@voltdev/core';
import { announce } from './announcer.js';

/** How long the copied state is held, in milliseconds. */
const COPIED_FOR = 2000;

export type CopyStatus = 'idle' | 'copied' | 'failed';

export interface ClipboardLabels {
  /** Announced once the text is on the clipboard. Default "Copied". */
  copied?: string;
  /** Announced when the clipboard refused. Default "Could not copy". */
  failed?: string;
}

export interface ClipboardOptions {
  /**
   * What to copy, read at the moment of the copy rather than held.
   *
   * An accessor because the value is usually something that changes — the
   * cell under the cursor, the id of the error currently shown.
   */
  text: () => string;
  /** How long `status()` stays at `copied` or `failed`. Default 2000. */
  resetAfter?: number;
  labels?: ClipboardLabels;
  /** Called after a successful copy, for anything beyond the announcement. */
  onCopy?: (text: string) => void;
  /** Called when the clipboard refused, with whatever it threw. */
  onError?: (error: unknown) => void;
}

export interface ClipboardProps {
  readonly type: 'button';
  readonly 'data-state': CopyStatus;
  readonly onclick: () => void;
}

export interface Clipboard {
  /** `idle` until a copy is attempted, then `copied` or `failed` for a window. */
  status(): CopyStatus;
  /** Whether the last attempt succeeded and its window has not closed. */
  isCopied(): boolean;
  /** Copy now. Resolves to whether the text reached the clipboard. */
  copy(): Promise<boolean>;
  /** Spread onto the button. */
  triggerProps(): ClipboardProps;
}

/**
 * Put text on the clipboard the way the platform allows.
 *
 * `navigator.clipboard` is absent rather than failing outside a secure
 * context, so the check is for the API and not for an exception it would
 * never get to throw.
 */
async function write(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  // Deprecated, and the only thing that works over plain HTTP. The textarea
  // is positioned rather than hidden because a `display: none` element cannot
  // be selected, and `readonly` keeps a mobile keyboard from opening over the
  // page for the instant it is focused.
  const carrier = document.createElement('textarea');
  carrier.value = text;
  carrier.setAttribute('readonly', '');
  carrier.setAttribute('aria-hidden', 'true');
  carrier.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0';
  document.body.append(carrier);

  const previous = document.activeElement;
  try {
    carrier.select();
    if (!document.execCommand('copy')) throw new Error('the page refused to copy');
  } finally {
    carrier.remove();
    // Focus went to the carrier and has to go back, or the copy costs the
    // user their place on the page.
    if (previous instanceof HTMLElement) previous.focus();
  }
}

export function createClipboard(options: ClipboardOptions): Clipboard {
  const status = new Signal.State<CopyStatus>('idle');
  const resetAfter = options.resetAfter ?? COPIED_FOR;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const settle = (next: Exclude<CopyStatus, 'idle'>): void => {
    status.set(next);
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      status.set('idle');
      timer = null;
    }, resetAfter);
  };

  // A timer outliving the button would set a signal nobody is reading, and in
  // a test it would fire against a torn-down document.
  onCleanup(() => {
    if (timer !== null) clearTimeout(timer);
  });

  const copy = async (): Promise<boolean> => {
    const text = options.text();
    try {
      await write(text);
    } catch (error) {
      settle('failed');
      announce(options.labels?.failed ?? 'Could not copy', { priority: 'assertive' });
      options.onError?.(error);
      return false;
    }

    settle('copied');
    // Through the region rather than by relabelling the button: a name that
    // changes under a screen reader's focus is announced unreliably, and this
    // is the sentence the user actually needs.
    announce(options.labels?.copied ?? 'Copied');
    options.onCopy?.(text);
    return true;
  };

  return {
    status: () => status.get(),
    isCopied: () => status.get() === 'copied',
    copy,
    triggerProps: () => ({
      // Inside a form, a button with no type submits it.
      type: 'button',
      'data-state': status.get(),
      onclick: () => void copy(),
    }),
  };
}
