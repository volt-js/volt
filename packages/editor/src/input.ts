/**
 * `beforeinput`, translated into commands.
 *
 * This is the browser half of input handling, and it is deliberately thin.
 * Everything about *what an edit does to a document* lives in commands.ts;
 * what lives here is the knowledge that `deleteContentBackward` is what a
 * browser calls backspace, that a paste arrives as an `insertFromPaste` whose
 * text is on the `dataTransfer` rather than on `data`, and that during a
 * composition the browser owns the DOM and an editor that fights it loses.
 *
 * **Why `beforeinput` and not `keydown`.** A keystroke is not an edit. The same
 * physical key means different things under different keyboard layouts, input
 * methods, autocorrect, dictation and mobile keyboards — and on a phone there
 * frequently is no key event at all. `beforeinput` is the event the platform
 * defines in terms of the edit that is about to happen, which is the level this
 * layer wants to translate at. Shortcuts that are genuinely about keys — a
 * keymap binding for bold — are a different listener, and not this one.
 *
 * **Undo is the one key read here, because the browser will not report it.**
 * `historyUndo` and `historyRedo` are what a browser sends when it is about to
 * undo an edit of its own, and every edit here was cancelled before the
 * browser made it — so its undo stack is empty, and the platform's undo key
 * produces no `beforeinput` at all. The history is the editor's, so the key
 * has to be read as a key. Both roads lead to the same history: the input
 * types still arrive from an Edit menu or a shake-to-undo, and they are
 * honoured rather than declined. With no history to hand the keys are left
 * alone, since whatever undo the host has is then the one they belong to; the
 * input types are cancelled either way, because a browser undo would take
 * back DOM the model never saw change.
 *
 * **Why every non-composition event is prevented.** The model is the truth and
 * the DOM is a rendering of it. If the browser is allowed to perform an edit
 * that the model does not know about, the two diverge, and every position in
 * the document — every selection, every mapped step, every history entry — is
 * then computed against a document that is not what is on screen. That failure
 * is silent and unrecoverable. Refusing an edit the model cannot yet express
 * is neither: it is visible, and the person tries something else. So an input type
 * with no command behind it is cancelled and dropped, not delegated.
 *
 * **Composition is the exception, and has to be.** Between `compositionstart`
 * and `compositionend` an input method is writing directly into the DOM, and
 * the intermediate states are not edits — they are a candidate being chosen.
 * Cancelling them cancels the composition itself; rewriting the DOM underneath
 * one detaches it from the node it is editing, and on several platforms the
 * composition then commits into the wrong place or is silently abandoned. So
 * the browser is left alone until it says it is finished, and only then is the
 * finished text put through `insertText` like anything else. The model is
 * behind the DOM for the duration of a composition, on purpose, and catches up
 * in one step at the end.
 *
 * Because the model is the source of positions, this layer never asks the DOM
 * where the selection is: it reads it from the state. Keeping the DOM selection
 * and the model selection in step is the view's job — view.ts writes the one
 * into the other and reads a selection the browser moved back as a
 * transaction — and so is taking back the DOM a composition wrote.
 */

import {
  deleteBackward,
  deleteForward,
  deleteWordBackward,
  deleteWordForward,
  insertHardBreak,
  insertParagraph,
  insertPlainText,
  insertText,
} from './commands.js';
import type { EditorHistory } from './history.js';
import type { EditorState, EditorTransaction } from './state.js';

/** What an input layer needs of the editor around it. */
export interface EditorInputHost {
  /** The state to translate against, read fresh for every event. */
  state(): EditorState;
  /** Hand back a transaction that did something. Never called for a no-op. */
  dispatch(tr: EditorTransaction): void;
  /**
   * The history the undo keys and the `historyUndo` and `historyRedo` input
   * types act on. The host records every transaction it applies into it,
   * including the ones an undo hands to `dispatch` — that is what moves the
   * unit from one stack to the other. Without one, the keys are left alone.
   */
  readonly history?: EditorHistory | null;
}

/**
 * The input types a composition produces.
 *
 * Checked by name as well as by the `composing` flag, because the ordering is
 * not reliable: on several engines the first `beforeinput` of a composition
 * arrives *before* `compositionstart`, and treating that one as an ordinary
 * insertion is how an editor eats the first character of every composed word.
 */
const composed = new Set(['insertCompositionText', 'deleteCompositionText', 'insertFromComposition']);

/**
 * The text a paste carries.
 *
 * `dataTransfer` is where a real paste puts it and `data` is null; a synthetic
 * event does the opposite. Reading both is one line and removes a whole class
 * of "works everywhere but there".
 */
function pastedText(event: InputEvent): string {
  const transferred = event.dataTransfer?.getData('text/plain');
  if (transferred) return transferred;
  return event.data ?? '';
}

/**
 * Translate one input type into a command, and say whether it changed anything.
 *
 * Exported for the sake of being testable without an event loop, and because a
 * keymap will want to reach the same commands by the same names.
 *
 * `historyUndo` and `historyRedo` are not here, and this says no to them: an
 * undo is a transaction the history builds from its own stack, not an edit
 * written into one that is already open. `EditorInput` takes them to the
 * history instead.
 */
export function applyInputType(tr: EditorTransaction, inputType: string, event?: InputEvent): boolean {
  switch (inputType) {
    case 'insertText': {
      // The text is the event's `data`, so with no event, or one carrying
      // none, there is nothing to type — and typing nothing over a range
      // would delete the range.
      const text = event?.data;
      return text ? insertText(tr, text) : false;
    }
    case 'insertParagraph':
      return insertParagraph(tr);
    case 'insertLineBreak':
      return insertHardBreak(tr);
    case 'deleteContentBackward':
      return deleteBackward(tr);
    case 'deleteContentForward':
      return deleteForward(tr);
    case 'deleteWordBackward':
      return deleteWordBackward(tr);
    case 'deleteWordForward':
      return deleteWordForward(tr);
    case 'insertFromPaste': {
      // Flattened to text: a view takes a paste carrying HTML the schema can
      // read off the `paste` event before it becomes this one, so what
      // arrives here has only its text to give, as `insertPlainText` says.
      // A paste that carries no text — only an image, or only markup this
      // layer does not read — declines for the reason `insertText` does:
      // pasting nothing over a range would delete the range.
      const text = event ? pastedText(event) : '';
      return text ? insertPlainText(tr, text) : false;
    }
    default:
      return false;
  }
}

type Direction = 'undo' | 'redo';

/**
 * The letter a shortcut is pressed on, by the platform's reckoning.
 *
 * `key` on a Latin layout, so that Z is where Z is printed — on AZERTY the key
 * in QWERTY's Z place is W, and Ctrl+W is not undo. A layout that is not Latin
 * reports its own letter there, and the platform still undoes on the key in
 * Z's place, so a single letter outside ASCII falls back to `code`. A named
 * key — `Process`, which an input method sends for a key it is taking for
 * itself — is no letter at all.
 */
function shortcutLetter(event: KeyboardEvent): string | null {
  const key = event.key;
  if (/^[\x21-\x7e]$/.test(key)) return key.toLowerCase();
  if ([...key].length !== 1) return null;
  const physical = /^Key([A-Z])$/.exec(event.code);
  return physical ? physical[1]!.toLowerCase() : null;
}

/**
 * Which way through the history a key asks to go, if it is an undo key at all.
 *
 * Ctrl or Cmd with Z undoes, and with Shift as well redoes; Ctrl+Y redoes too,
 * which is the Windows spelling. Either modifier is taken on every platform
 * rather than guessing the platform from a user agent: Ctrl+Z on a Mac and
 * Cmd+Z elsewhere mean nothing else, so accepting both costs nothing. Both
 * held at once is neither: that chord is some other binding's. Alt rules a
 * key out, because AltGr arrives as Ctrl+Alt on Windows and types a
 * character there — AltGr+Z is ż on a Polish keyboard.
 */
function historyKey(event: KeyboardEvent): Direction | null {
  if (event.altKey || event.ctrlKey === event.metaKey) return null;
  const letter = shortcutLetter(event);
  if (letter === 'z') return event.shiftKey ? 'redo' : 'undo';
  if (letter === 'y' && event.ctrlKey && !event.shiftKey) return 'redo';
  return null;
}

/**
 * Listens for input on an element and turns it into transactions.
 *
 * Holds no document of its own: it asks the host for the state at the moment
 * the event arrives, which is what keeps it correct when something else — a
 * remote change, an undo — moved the document between two keystrokes.
 */
export class EditorInput {
  private readonly dom: HTMLElement;
  private readonly host: EditorInputHost;
  private composingNow = false;

  constructor(dom: HTMLElement, host: EditorInputHost) {
    this.dom = dom;
    this.host = host;
    dom.addEventListener('beforeinput', this.onBeforeInput as EventListener);
    dom.addEventListener('keydown', this.onKeyDown as EventListener);
    dom.addEventListener('compositionstart', this.onCompositionStart as EventListener);
    dom.addEventListener('compositionend', this.onCompositionEnd as EventListener);
  }

  /** Whether an input method is mid-composition, and so owns the DOM. */
  get composing(): boolean {
    return this.composingNow;
  }

  destroy(): void {
    this.dom.removeEventListener('beforeinput', this.onBeforeInput as EventListener);
    this.dom.removeEventListener('keydown', this.onKeyDown as EventListener);
    this.dom.removeEventListener('compositionstart', this.onCompositionStart as EventListener);
    this.dom.removeEventListener('compositionend', this.onCompositionEnd as EventListener);
  }

  private readonly onBeforeInput = (event: InputEvent): void => {
    if (this.composingNow || composed.has(event.inputType)) return;

    event.preventDefault();
    if (event.inputType === 'historyUndo') this.travel('undo');
    else if (event.inputType === 'historyRedo') this.travel('redo');
    else this.run((tr) => applyInputType(tr, event.inputType, event));
  };

  /**
   * The undo keys, read as keys for the reason the header gives.
   *
   * Left alone mid-composition, when the keys are the input method's; when
   * something else has already taken the key, which is how a host overrides
   * the binding; and when there is no history, when the host's own undo is
   * the one they belong to. Otherwise the key is the editor's even with
   * nothing to take back, so the browser does not go looking in a stack of
   * its own.
   */
  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.host.history || event.defaultPrevented) return;
    if (this.composingNow || event.isComposing) return;

    const direction = historyKey(event);
    if (!direction) return;
    event.preventDefault();
    this.travel(direction);
  };

  private readonly onCompositionStart = (): void => {
    this.composingNow = true;
  };

  /**
   * The composition is finished: put what it produced into the model.
   *
   * The model's selection has not moved during the composition — every event
   * that would have moved it was let through to the browser instead — so it is
   * still the range the composition started from, which is exactly what the
   * composed text should replace. That is why nothing had to be remembered at
   * `compositionstart`.
   *
   * Not handled, and said here so it is not mistaken for handled: an input
   * method that composes over text it chose itself rather than at the
   * selection. Android keyboards reopen the word beside the caret to correct
   * it, and the corrected word arrives here as text for the caret, where it
   * lands beside the word it was meant to replace. Knowing that range means
   * reading it off the composition's own events — their target ranges, mapped
   * back through the view — which nothing here does yet.
   */
  private readonly onCompositionEnd = (event: CompositionEvent): void => {
    this.composingNow = false;
    const text = event.data ?? '';
    if (text === '') return;

    this.run((tr) => {
      if (!insertText(tr, text)) return false;
      // A composed word is one undoable thing. Grouping it with the typing
      // that follows would make one undo take back both.
      tr.closeHistory();
      return true;
    });
  };

  /**
   * Take back, or put back, the latest unit.
   *
   * The history builds the transaction and the host applies it like any other
   * — and records it, which is what moves the unit across. Nothing to take
   * back dispatches nothing.
   */
  private travel(direction: Direction): void {
    const history = this.host.history;
    if (!history) return;
    const state = this.host.state();
    const tr = direction === 'undo' ? history.undo(state) : history.redo(state);
    if (tr) this.host.dispatch(tr);
  }

  /**
   * Run a command against a fresh transaction, dispatching only if it did
   * something.
   *
   * A command's return value is the whole answer to "did anything happen" —
   * every one of them declines rather than taking a step that changes nothing.
   * Checking the transaction as well would be a second, weaker test of the
   * same thing, and one nothing could make disagree.
   */
  private run(command: (tr: EditorTransaction) => boolean): void {
    const tr = this.host.state().tr();
    if (command(tr)) this.host.dispatch(tr);
  }
}
