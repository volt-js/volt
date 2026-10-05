import { Component, Prop, Signal, effect, onCleanup } from '@voltdev/core';
import {
  EditorHistory,
  EditorState,
  EditorView,
  NodeSelection,
  basicMarkRenderers,
  basicSchema,
  blockActive,
  listActive,
  markActive,
  setBlockType,
  toggleList,
  toggleMark,
  toggleWrap,
  wrapActive,
  type EditorSelection,
  type EditorTransaction,
  type Mark,
  type Node as DocNode,
  type Schema,
} from '@voltdev/editor';
import {
  createCollection,
  createFormField,
  createRovingFocus,
  useProvidedLocale,
  type FormField,
  type FormFieldProps,
  type Locale,
  type MessageValues,
} from '@voltdev/primitives';
import { documentMarkup, runsScript } from './editor-markup.js';

const { untrack } = Signal.subtle;

/** What a toolbar button does, by name — the default toolbar's, and a toolbar of your own's. */
export type EditorAction =
  | 'bold'
  | 'italic'
  | 'code'
  | 'heading-1'
  | 'heading-2'
  | 'heading-3'
  | 'bullet-list'
  | 'ordered-list'
  | 'blockquote'
  | 'undo'
  | 'redo';

/**
 * The names the toolbar's buttons are announced by, in your users' language.
 *
 * Each falls back to the locale's catalogue under the key in brackets, and to
 * English after that: `toolbar` (`formatting`), `bold`, `italic`, `code`,
 * `heading` (`heading`, with the level as `{n}`), `bulletList`,
 * `orderedList`, `blockquote` (`quote`), `undo` and `redo`.
 */
export interface EditorLabels {
  readonly toolbar?: string;
  readonly bold?: string;
  readonly italic?: string;
  readonly code?: string;
  readonly heading?: (level: number) => string;
  readonly bulletList?: string;
  readonly orderedList?: string;
  readonly blockquote?: string;
  readonly undo?: string;
  readonly redo?: string;
}

/** One button of the default toolbar. */
export interface EditorToolbarAction {
  readonly key: EditorAction;
  /** What the button shows. Its name is `aria-label`, so this is never what is announced. */
  readonly glyph: string;
  /** Whether it stays down while what it applies is there — a mark, a block — rather than being an act, like undo. */
  readonly toggle: boolean;
}

interface Action extends EditorToolbarAction {
  name(): string;
  isOn(state: EditorState): boolean;
  /**
   * Whether a press could do anything, from what is known without trying it:
   * a mark needs text selected, and undo and redo need something to take
   * back. Every other refusal is the command's own, found by the press.
   */
  pressable(state: EditorState): boolean;
  /** The transaction a press dispatches, or null when the command declines it. */
  perform(state: EditorState): EditorTransaction | null;
}

/** A segmented row of the default toolbar. */
export interface EditorToolbarGroup {
  readonly name: string;
  readonly actions: readonly EditorToolbarAction[];
}

/** Whether a toolbar button can be pressed now, and whether it is down. */
interface ActionStatus {
  readonly enabled: boolean;
  readonly on: boolean;
}

/**
 * A rich text field: the label, a toolbar, the document, a line of help, and
 * the message.
 *
 * ```html
 * <v-editor :value="notes" label="Notes" placeholder="Write something…"
 *           description="Bold, lists and quotes are kept."></v-editor>
 * ```
 *
 * The editing is `@voltdev/editor`'s, all of it: typing, deleting, return,
 * paste, composition, the undo keys. What this adds is a field round it — the
 * same label, help and message every text field here has, wired to the
 * editable element by `createFormField` — a toolbar over the engine's
 * formatting commands, and the document as a signal a page can bind.
 *
 * **The value is the document itself.** The engine has no JSON form of a
 * document, and a document is immutable, so a signal holding one is a signal
 * that changes exactly when the text does and costs nothing to compare. A
 * page reads `notes.get()` and has the whole document, and writes one in to
 * load it; an equal document written back — a page round-tripping its own
 * value — is left as it is on screen, with the caret and the undo history,
 * and a different one starts both again.
 *
 * **The editable element is the engine's view, and `:host` is on it.** It
 * carries `role="textbox"`, `aria-multiline`, and the name and description
 * the field points at it, and that is where a class, an `aria-label` or a
 * `data-*` written on the tag lands. The view takes the element over as the
 * document's own rendering rather than drawing one of its own inside it, so
 * the element a caller can see is the element being edited.
 *
 * **A server writes the document as markup.** The engine needs a browser to
 * draw anything, so before it loads the same element holds the document as
 * plain elements — headings, paragraphs, lists, marks — and says it is read
 * only, which until the engine has loaded it is. The engine draws over it
 * from the model once it is there, in the same elements: a link whose address
 * would run script is drawn without one by both.
 *
 * **Out of use, the view is built again.** The engine fixes whether a view is
 * editable when it is built, and an uneditable one binds no undo key and
 * says `aria-readonly` itself, so `disabled` and `readOnly` build the view
 * again over the same element, state and history, rather than leaving keys
 * bound to a field nobody can type in. A disabled editor takes the engine's
 * `aria-readonly` back: read only promises text that can still be reached and
 * copied, and a disabled control promises nothing.
 *
 * Not here: keyboard shortcuts for the marks, links, images, a toolbar that
 * floats over the selection, and a value posted with a form. The toolbar slot
 * is where a page puts more, with the editor's own `run`, `isOn` and `can` to
 * drive it.
 */
@Component({ selector: 'v-editor', templateUrl: './editor.html' })
export class VEditor {
  /**
   * Your own signal, holding the document — a `Node` from `@voltdev/editor`.
   * Every edit writes the new document into it, and a document written into
   * it from outside is loaded. Without one the editor starts empty.
   *
   * Read once, while the field list initializes, as every component in the
   * package reads its `value` signal: a different signal bound here later is
   * neither loaded nor written, and edits go on reaching the first.
   */
  @Prop() value?: Signal.State<DocNode>;
  /**
   * The schema of the document the editor makes when it is given none. Read
   * once, while the field list initializes; a document given as `value`
   * carries its own, and a schema here that disagrees is refused. Default the
   * engine's `basicSchema`.
   */
  @Prop() schema?: Schema;
  /**
   * The editable element's id, and so the `for` of the label. Declared rather
   * than left to `:host` for the reason `<v-textarea>` gives: the field writes
   * an id of its own there otherwise. Read once.
   */
  @Prop() id?: string;
  /** Called with the new document after every edit — never for a document you wrote in yourself. */
  @Prop() onChange?: (doc: DocNode) => void;

  /** The words above the editor. Markup instead, in the `label` slot. */
  @Prop() label = new Signal.State('');
  /** The line under it. Markup instead, in the `description` slot. */
  @Prop() description = new Signal.State('');
  /**
   * A verdict of your own — a server refusing what was written — shown at
   * once as the message, and marking the editor invalid. Empty is no verdict.
   * The editor lets go of it on the next edit, as `<v-password-input>` does,
   * so a message never outlives its correction; one handed over while the
   * editor is out of use is said once it is back, unless an edit came first.
   * What is bound here is handed over whenever it changes, and a signal set
   * to the string it already holds has not changed — so clear yours as an
   * attempt starts, and the same words after it are said again.
   *
   * Bound as `:prop-error`: `error` is a DOM event's name, and `:error` on any
   * tag is a listener for it. Written out — `error="…"` — it is a prop.
   */
  @Prop() error = new Signal.State('');
  /**
   * Shown in the editor while the document is one empty block and no input
   * method is composing in it, and given to a screen reader as
   * `aria-placeholder` for as long as it is shown. Not a label: it is gone at
   * the first character.
   */
  @Prop() placeholder = new Signal.State('');
  /**
   * Refuses every edit and every toolbar button, takes the editor out of the
   * tab order, and says so with `aria-disabled` — not `aria-readonly` as
   * well. Read by the attribute's own rule: written at all, it is on.
   */
  @Prop() disabled = new Signal.State(false);
  /**
   * Refuses every edit and every toolbar button, and keeps the editor in the
   * tab order so its text can still be selected and copied. Read by the
   * attribute's own rule.
   */
  @Prop() readOnly = new Signal.State(false);
  /** The toolbar's names, in your users' language. See `EditorLabels`. */
  @Prop() labels = new Signal.State<EditorLabels>({});

  /**
   * Names the editor, in the platform's own spelling. Declared rather than
   * left to `:host` for the reason `<v-textarea>` gives: the field points
   * `aria-labelledby` at its own label, which would outrank it, so a name
   * given here stands that reference down.
   */
  @Prop({ alias: 'aria-label' }) ariaLabel = new Signal.State<string | undefined>(undefined);
  /** Names the editor from somewhere else on the page, instead of the label. */
  @Prop({ alias: 'aria-labelledby' }) labelledBy = new Signal.State<string | undefined>(undefined);
  /** Ids of anything else that describes it. Added to the field's own two, not instead of them. */
  @Prop({ alias: 'aria-describedby' }) describedBy = new Signal.State<string | undefined>(undefined);
  /**
   * The box's place in the tab order, for a page that manages focus itself.
   *
   * Declared rather than left to `:host` because the editor writes one of its
   * own — while the engine has not loaded, and while the box is read only —
   * and two spreads writing one attribute is the caller's losing: the one
   * written last wins, and the editor's, taken back once the view is live,
   * would take the caller's with it. Given here, it wins whatever the editor
   * would have said — but not `disabled`, which takes the box out of the tab
   * order wherever it was placed, as it takes a native control out.
   */
  @Prop({ alias: 'tabindex' }) tabIndex = new Signal.State<string | number | undefined>(undefined);
  /**
   * The language the document is written in.
   *
   * Declared rather than left to `:host`, which is the editable element: the
   * words shown in an empty box are laid over it from beside it, not drawn in
   * it, and are in the box's language as its text is. Written on the element
   * round both, which each inherits it from; the label, the toolbar and the
   * help are the page's, and keep the page's. Bound as an attribute, as
   * `<v-collapsible>` binds it, so an unset one is not written at all.
   */
  @Prop() lang = new Signal.State<string | undefined>(undefined);
  /**
   * Which way the document runs, on the element round the box and the words
   * shown in it while it is empty, for the reason `lang` is: on the box
   * alone, the words sat at the page's starting edge while the caret was at
   * the box's.
   */
  @Prop() dir = new Signal.State<string | undefined>(undefined);

  /**
   * The parts, as elements. Signals because the field and the view are built
   * before any of them exists, and each is wired the moment it does.
   */
  labelEl = new Signal.State<Element | null>(null);
  toolbarEl = new Signal.State<Element | null>(null);
  body = new Signal.State<HTMLElement | null>(null);
  surface = new Signal.State<HTMLElement | null>(null);
  descriptionEl = new Signal.State<Element | null>(null);
  errorEl = new Signal.State<Element | null>(null);

  /** The label, the help and the message, wired to the editable element. */
  readonly field: FormField = createFormField({
    control: () => this.surface.get(),
    label: () => this.labelEl.get(),
    description: () => this.descriptionEl.get(),
    errorMessage: () => this.errorEl.get(),
    disabled: () => Boolean(this.disabled.get()),
    readOnly: () => Boolean(this.readOnly.get()),
    ...(this.id !== undefined ? { id: this.id } : {}),
  });

  /**
   * The undo history, kept here rather than in the view so it outlives one:
   * a view built again when the editor is taken out of use and put back is
   * handed the same history, and undo still reaches what was typed before.
   */
  readonly history = new EditorHistory();

  /** The caller's signal, as `value` held it while the field list initialized. */
  private readonly bound = this.value;

  /**
   * The state on screen — the document and the selection — as a signal, so a
   * toolbar, a word count or anything else in a template follows it.
   */
  readonly state = new Signal.State<EditorState>(EditorState.create(this.startingDocument()));

  /**
   * The engine's view, once it is on the page: everything this component
   * does not offer — the DOM position mapping, `focus`, dispatching a
   * transaction of your own — is there. Null on a server, and until the
   * element exists.
   */
  readonly view = new Signal.State<EditorView | null>(null);

  /**
   * Whether the document is one empty block, which is what the empty-box
   * words wait for. A signal of its own rather than read from the state
   * where it is wanted, because what wants it includes the editable
   * element's attributes, written again whenever anything they read changes:
   * read from the state, every keystroke rewrote them on the element being
   * typed into. A keystroke that leaves this as it was reaches nothing.
   */
  private readonly blank = new Signal.Computed(() => {
    const { doc } = this.state.get();
    const only = doc.childCount === 1 ? doc.firstChild : null;
    return only !== null && only.isTextblock && only.content.size === 0;
  });

  /**
   * The provider's catalogue, when there is one. Only its words are wanted,
   * and the toolbar has English of its own, so no stand-in locale is built
   * when nothing provides one.
   */
  private readonly locale: Locale | null = useProvidedLocale();
  private readonly actions: readonly Action[] = this.buildActions();

  /** The default toolbar's rows, from what the schema has: a button for a type it lacks is not drawn. */
  readonly groups: readonly EditorToolbarGroup[] = groupsOf(this.actions);

  /**
   * Every button's state, worked out once per state rather than once per button.
   *
   * Whether a button can be pressed is not found by pressing it. Trying a
   * command is running it — a mark is a step per block and a heading a
   * replacement per block, each over the whole document — and this runs on
   * every keystroke and every move of the caret, so trying all eleven made
   * the toolbar the costliest thing about typing in a long document and a
   * select-all in one a wait of seconds. So a button is drawn pressable
   * unless what refuses it is known for nothing: the editor is out of use, a
   * mark has no text selected to go on, or the history has nothing to take
   * back. A command that declines for a reason of its own — a heading asked
   * for in a list item's opening paragraph, which must stay one — is found
   * out by the press, which then does nothing.
   */
  private readonly status = new Signal.Computed<ReadonlyMap<EditorAction, ActionStatus>>(() => {
    const state = this.state.get();
    const usable = this.view.get() !== null && this.editable();
    return new Map(
      this.actions.map((action) => [
        action.key,
        {
          enabled: usable && action.pressable(state),
          on: action.toggle && action.isOn(state),
        },
      ]),
    );
  });

  /** The toolbar button that last had focus, where the toolbar's one tab stop goes back to. */
  private readonly focusedItem = new Signal.State<HTMLElement | null>(null);
  /** Whether that button has focus still. */
  private readonly toolbarFocused = new Signal.State(false);
  private readonly roving = createRovingFocus(
    createCollection(() => this.toolbarEl.get()),
    () => this.focusedItem.get(),
    (item) => this.focusedItem.set(item),
    { orientation: 'horizontal', typeahead: false },
  );

  /**
   * Whether the caller's message still stands: handed over, and not let go of
   * by an edit since — which decides whether it is said again when the
   * editor comes back into use.
   */
  private standing = false;

  constructor() {
    // The view, once the element is on the page — and again whenever the
    // editor goes in or out of use, which the engine fixes when a view is
    // built. Never on a server, which runs no effects and has no DOM to
    // edit; what it writes instead is `markup()`.
    let refocus = false;
    effect(() => {
      const surface = this.surface.get();
      const body = this.body.get();
      const editable = this.editable();
      if (!surface || !body) return;
      const view = untrack(() => this.mount(surface, body, editable));
      // A view taken down takes its element out of the page, and focus goes
      // with it; a writer whose caret was there gets it back where it was,
      // unless the editor is now disabled, which a disabled control never
      // keeps. The render effects have run by now, so a read-only element
      // already has the tab stop that makes it focusable.
      if (refocus && untrack(() => !this.disabled.get())) view.focus();
      refocus = false;
      onCleanup(() => {
        refocus = surface.contains(surface.ownerDocument.activeElement);
        // A composition goes with the view it was written in: see `orphaned`.
        if (view.input.composing) this.orphaned = true;
        surface.removeEventListener('compositionstart', this.beforeComposition);
        body.removeEventListener('compositionend', this.compositionEnding, true);
        surface.removeEventListener('compositionend', this.afterComposition);
        this.heldPresses = [];
        this.composing.set(false);
        view.destroy();
        if (untrack(() => this.view.get()) === view) this.view.set(null);
      });
    });

    // A document written into the caller's signal from outside is loaded.
    effect(() => {
      const doc = this.bound?.get();
      if (doc) untrack(() => this.load(doc));
    });

    // The caller's verdict, handed to the field as `<v-password-input>` hands
    // one over. An effect's first run comes after the render, so the element
    // it is measured against is there by then.
    effect(() => {
      const message = this.error.get();
      this.standing = true;
      untrack(() => this.field.setCustomValidity(message));
    });

    // A message that still stands is handed over again whenever the editor
    // goes in or out of use: out of it, the field judges nothing and sets the
    // message aside, and back in it, says it again. One an edit let go of
    // stays gone.
    let inUse: boolean | undefined;
    effect(() => {
      const now = this.editable();
      const before = inUse;
      inUse = now;
      if (before === undefined || before === now || !this.standing) return;
      untrack(() => this.field.setCustomValidity(this.error.get()));
    });
  }

  /** Whether edits are taken: neither disabled nor read only, by the attribute's rule. */
  editable(): boolean {
    return !this.disabled.get() && !this.readOnly.get();
  }

  /** Put the caret in the editor, where the selection is. */
  focus(): void {
    this.view.get()?.focus();
  }

  /**
   * Press a toolbar button by name. Nothing happens if it is not there, the
   * editor is out of use, or its command declines where the selection is; a
   * press while an input method is composing is made once it has finished.
   */
  readonly run = (key: EditorAction): void => {
    const view = this.view.get();
    const action = this.actions.find((each) => each.key === key);
    if (!view || !action || !this.editable()) return;
    // The browser owns the text being composed until the composition ends,
    // and a command draws again the blocks it changes: run now, it would take
    // the input method's text out of the page under it. A press on the
    // toolbar keeps the caret in the text, so a composition outlives one. It
    // waits instead, as the engine makes a click on an image wait.
    if (view.input.composing) {
      this.heldPresses.push(key);
      return;
    }
    const tr = action.perform(view.state);
    if (tr) view.dispatch(tr);
  };

  /**
   * Presses made while an input method was composing, made in order once it
   * has finished — each against the state the one before left, and each
   * dropped if the editor has gone out of use meanwhile, or a different
   * document has been loaded since it was made.
   */
  private heldPresses: EditorAction[] = [];

  /**
   * Whether an input method is composing in the box. The engine keeps what is
   * being composed out of the document until it is finished, so an empty box
   * is still empty in the model while the words being written are on screen.
   */
  private readonly composing = new Signal.State(false);

  /**
   * Whether the composition running now has lost what it was written into:
   * the view it began in was taken down, as going out of use takes it, or a
   * different document was loaded under it. Its text went into elements that
   * are off the page, against a document that is not the one shown, so what
   * it commits is dropped rather than written in at a caret it never saw —
   * the start of a document loaded meanwhile, or the box of an editor made
   * read only meanwhile, which takes no edit.
   */
  private orphaned = false;

  /**
   * Whether a composition's end is being heard: from its `compositionend`
   * reaching the body until the view's own listeners have had it, which is
   * when what it commits is dispatched.
   */
  private ending = false;

  private readonly beforeComposition = (): void => {
    // Whatever went from under an earlier one, this one is written into what
    // is on the page.
    this.orphaned = false;
    this.composing.set(true);
  };

  /**
   * Where the presses held for a composition were made: the selection it
   * began from, and once it has committed text, the caret after that text.
   * Read when its end reaches the body, before the view's listeners have it,
   * because one of them puts the caret wherever a click that ended the
   * composition put it — another paragraph, which a heading pressed in this
   * one would otherwise turn into.
   */
  private heldAt: EditorSelection | null = null;

  private readonly compositionEnding = (): void => {
    this.ending = true;
    this.heldAt = this.view.get()?.state.selection ?? null;
  };

  private readonly afterComposition = (): void => {
    this.ending = false;
    this.composing.set(false);
    this.makeHeld(this.heldAt);
  };

  /**
   * Make the presses held for a composition, in order: the first where it was
   * pressed, each after it where the one before left the selection. The
   * caret a click put somewhere else stays there, carried past what each
   * press changed, as the view keeps it past the composed text.
   *
   * Each is taken off the list as it is made, so whatever empties the list
   * stops the rest: a document loaded by one press's `onChange`, against
   * which the selection the next was made at means nothing, or the view
   * taken down.
   */
  private makeHeld(from: EditorSelection | null): void {
    let at = from;
    while (this.heldPresses.length > 0) {
      const key = this.heldPresses.shift()!;
      const view = this.view.get();
      const action = this.actions.find((each) => each.key === key);
      if (!view || !action || !this.editable()) return;
      const state = view.state;
      const elsewhere = at !== null && !at.eq(state.selection);
      const tr = action.perform(elsewhere ? EditorState.create(state.doc, at!) : state);
      if (!tr) continue;
      at = tr.selection;
      if (elsewhere) tr.setSelection(state.selection.map(tr.doc, tr.mapping));
      view.dispatch(tr);
    }
  }

  /** Whether a toolbar button is down: the mark or block it applies is there, at the selection. */
  readonly isOn = (key: EditorAction): boolean => this.status.get().get(key)?.on ?? false;

  /**
   * Whether a toolbar button can be pressed now, as far as is known without
   * pressing it: see `status` for what that leaves for the press to find out.
   */
  readonly can = (key: EditorAction): boolean => this.status.get().get(key)?.enabled ?? false;

  /**
   * What the editable element carries: the field's bag, the three names merged
   * into it as `<v-textarea>` merges them, and what the engine cannot say
   * before it has loaded.
   *
   * Until the view is on the page — on a server, and in a browser until the
   * effect has run — nothing typed there goes anywhere, so the element says
   * it is read only and keeps a tab stop, as the view's own read-only element
   * does; the view writes the same `aria-readonly` whenever it is built out of
   * use, so the two never disagree about it. A disabled editor says neither,
   * and the `aria-readonly` the view wrote is taken off: `undefined` here is
   * the spread removing it.
   *
   * The empty-box words are said only while they are shown, as a native
   * placeholder is; under text they describe nothing on screen. With none to
   * say the key is left out rather than written empty, so an
   * `aria-placeholder` the caller wrote on the tag stays where they put it.
   */
  surfaceProps(): FormFieldProps {
    const own = this.field.controlProps();
    const ids = this.field.ids();
    // A server sets no `:ref`, and the field points only at parts it has
    // seen, so there it points at none — and what a reader gets before the
    // engine loads would be a text box with no name. The label, the help and
    // the message are always drawn, under the ids the field gave them, so
    // those are the ids it will point at once it has seen them.
    const unseen = this.labelEl.get() === null;
    const labelled = own['aria-labelledby'] ?? (unseen ? ids.label : undefined);
    const fieldDescribed = own['aria-describedby'] ?? (unseen ? `${ids.description} ${ids.errorMessage}` : undefined);
    const named = said(this.ariaLabel.get());
    const from = said(this.labelledBy.get());
    const described = [fieldDescribed, this.describedBy.get()]
      .map(said)
      .filter((id): id is string => id !== undefined)
      .join(' ');
    const live = this.view.get() !== null && this.editable();
    const disabled = Boolean(this.disabled.get());
    const hint = this.placeholderShown() ? said(this.placeholder.get()) : undefined;
    const placed = this.tabIndex.get();
    let stop = said(typeof placed === 'number' ? String(placed) : placed) ?? (live ? undefined : '0');
    // Out of the tab order wherever the page placed it, as a native control is.
    if (disabled) stop = undefined;

    return {
      ...own,
      'aria-label': named,
      'aria-labelledby': from ?? (named ? undefined : labelled),
      'aria-describedby': described || undefined,
      'aria-readonly': live || disabled ? undefined : 'true',
      ...(hint !== undefined ? { 'aria-placeholder': hint } : {}),
      tabindex: stop,
    };
  }

  /** What the toolbar carries: its name, and the element it acts on. */
  toolbarProps(): FormFieldProps {
    const surface = this.surface.get();
    return {
      'aria-label': this.word(this.labels.get().toolbar, 'formatting', 'Formatting'),
      'aria-controls': surface?.id || this.field.ids().control,
    };
  }

  /** What one button of the default toolbar carries. */
  actionProps(action: EditorToolbarAction): FormFieldProps {
    const status = this.status.get().get(action.key);
    const enabled = status?.enabled ?? false;
    const on = status?.on ?? false;
    const named = this.actions.find((each) => each.key === action.key);
    return {
      'data-action': action.key,
      'aria-label': named?.name(),
      // An act like undo is a button, not a toggle: it has no state to say.
      'aria-pressed': action.toggle ? String(on) : undefined,
      'data-state': on ? 'on' : 'off',
      // `aria-disabled` rather than `disabled`: a button that stops being
      // pressable while it has focus — undo, pressed until nothing is left —
      // keeps it, where a disabled one would drop it to the page. The arrows
      // step over it all the same, and the tab stop rests on one only while
      // it has focus.
      'aria-disabled': enabled ? undefined : 'true',
      'data-disabled': enabled ? undefined : '',
      tabindex: this.tabStop() === action.key ? '0' : '-1',
    };
  }

  /** A press of a button of the default toolbar. */
  press(action: EditorToolbarAction): void {
    this.run(action.key);
  }

  /**
   * A press on a toolbar button leaves focus where it was. The selection is
   * the model's and survives a blur, but a press that took focus away would
   * leave a writer to click back into the text after every button.
   */
  hold(event: Event): void {
    event.preventDefault();
  }

  /**
   * The arrows, Home and End move between the toolbar's buttons; Tab steps
   * over the row. Only from one of its items: a toolbar of the page's own can
   * hold a text field — a link's address — where those keys move the caret,
   * and the toolbar hears them as they bubble out of it.
   */
  onToolbarKeyDown(event: KeyboardEvent): void {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.hasAttribute('data-volt-item')) return;
    if (event.key.startsWith('Arrow') && !reachable(target)) {
      // A button that stopped being pressable while it had focus — undo,
      // pressed until nothing is left — is not one the arrows move between,
      // and a move counted from none of them starts again at an end of the
      // row. It goes to the nearest one beside it instead.
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const toolbar = this.toolbarEl.get();
      const next = toolbar ? beside(toolbar, target, (event.key === 'ArrowRight') !== rightToLeft(toolbar)) : null;
      if (next) {
        this.roving.focus(next);
        event.preventDefault();
      }
      return;
    }
    if (this.roving.onKeyDown(event)) event.preventDefault();
  }

  /** Where the toolbar's tab stop rests: the button that last had focus. */
  onToolbarFocus(event: FocusEvent): void {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.hasAttribute('data-volt-item')) return;
    this.focusedItem.set(target);
    this.toolbarFocused.set(true);
  }

  /** Focus leaving a button, for another or for somewhere off the toolbar. */
  onToolbarBlur(): void {
    this.toolbarFocused.set(false);
  }

  /**
   * The document as markup, for a server to write: the engine draws nothing
   * without a browser. Read once, untracked, because on a browser this is
   * what the view clears and draws over, and redrawing it after would take
   * the document out from under the view.
   */
  markup(): string {
    return documentMarkup(untrack(() => this.state.get()).doc);
  }

  /**
   * Whether the empty-box words are shown: there are some, the document is one
   * empty block, and no input method is writing into it — what one writes is
   * on screen before it is in the document, and the words would lie over it.
   */
  placeholderShown(): boolean {
    return said(this.placeholder.get()) !== undefined && this.blank.get() && !this.composing.get();
  }

  /** The message on screen: the first of them, as the platform would take one. */
  message(): string {
    return this.field.messages()[0] ?? '';
  }

  /**
   * The button holding the toolbar's one tab stop: the one that last had
   * focus while it can be pressed, else the first that can. None while
   * nothing can, which is a toolbar a keyboard has no reason to stop on.
   *
   * A button keeps it while it has focus, pressable or not: moved to another
   * button of the row, shift-Tab from this one would stop there on the way
   * out of the row.
   */
  private tabStop(): EditorAction | null {
    const status = this.status.get();
    const last = this.focusedItem.get()?.getAttribute('data-action') as EditorAction | null | undefined;
    if (last && (status.get(last)?.enabled || this.toolbarFocused.get())) return last;
    return this.actions.find((action) => status.get(action.key)?.enabled)?.key ?? null;
  }

  /**
   * Hand the element to a new view.
   *
   * What is in it goes first — what a server wrote, or what the last view
   * drew — because the view draws the document into the element beside
   * whatever is there. It is given as the document node's own rendering, so
   * the view edits this element rather than one of its own inside it, and
   * appends it to the body it is already the last thing in.
   */
  private mount(surface: HTMLElement, body: HTMLElement, editable: boolean): EditorView {
    surface.replaceChildren();
    const state = this.state.get();
    const view = new EditorView(body, {
      state,
      editable,
      history: this.history,
      renderers: {
        nodes: { [state.doc.type.name]: () => ({ dom: surface }) },
        marks: { link: inertLink },
      },
      dispatchTransaction: (tr, on) => this.dispatch(tr, on),
    });
    surface.addEventListener('compositionstart', this.beforeComposition);
    // Captured on the body, so it is heard before any of the view's own
    // listeners on the element.
    body.addEventListener('compositionend', this.compositionEnding, true);
    // After the view's own listeners, which put the composed text into the
    // document and the caret after it, so a press held meanwhile is made
    // against the text the writer composed.
    surface.addEventListener('compositionend', this.afterComposition);
    this.view.set(view);
    return view;
  }

  /**
   * Every transaction ends here: the view shows it and records it, the state
   * signal follows, and an edit reaches the caller's signal, the field and
   * `onChange`.
   */
  private dispatch(tr: EditorTransaction, view: EditorView): void {
    // What an orphaned composition commits: see `orphaned`.
    if (this.ending && this.orphaned && tr.changed) return;
    const before = view.state.doc;
    const next = view.state.apply(tr);
    view.update(next, tr);
    this.state.set(next);
    if (next.doc === before) return;
    if (this.ending) this.heldAt = next.selection;

    // An edit lets go of the caller's verdict, as typing in any field does.
    this.standing = false;
    this.field.markEdited();
    this.bound?.set(next.doc);
    this.onChange?.(next.doc);
  }

  /**
   * Load a document written in from outside.
   *
   * One equal to what is on screen, shown as `shownAs` shows it, is left
   * there, with the selection and the history: handed to the view, a document arriving without the transaction
   * that made it is drawn again whole, which on every save a store echoes
   * back is a redraw of the whole document — and one landing during a
   * composition takes the input method's text out of the page under it. Any
   * other starts with the caret at the beginning and an empty history, since
   * nothing in either was written against it.
   */
  private load(doc: DocNode): void {
    const current = this.state.get();
    if (doc.type.schema !== current.doc.type.schema) {
      throw new Error(
        '[volt] <v-editor> was given a document from a different schema than the one it was built with.\n' +
          '  The toolbar and the view were made for one schema; build the editor again for the other.',
      );
    }
    const shown = shownAs(doc);
    if (shown.eq(current.doc)) return;
    const next = EditorState.create(shown);
    const view = this.view.get();
    // A composition running now was written against the document that goes,
    // and so was every press waiting for one to finish — or being made after
    // it, when one of them had an `onChange` load this.
    if (view?.input.composing) this.orphaned = true;
    this.heldPresses = [];
    if (view) view.update(next);
    this.state.set(view?.state ?? next);
  }

  /** The document the editor starts with: the caller's, or an empty one of the schema. */
  private startingDocument(): DocNode {
    const given = this.bound ? untrack(() => this.bound!.get()) : undefined;
    if (given) {
      if (this.schema && given.type.schema !== this.schema) {
        throw new Error(
          '[volt] <v-editor> was given a schema and a document from another one.\n' +
            '  A document carries its own schema: leave `schema` out, or make the document from it.',
        );
      }
      return shownAs(given);
    }
    const empty = (this.schema ?? basicSchema).topNodeType.createAndFill();
    if (!empty) {
      throw new Error(
        "[volt] <v-editor> cannot make an empty document in this schema: its top node needs content it can't fill in.\n" +
          '  Pass a document as `value`.',
      );
    }
    return shownAs(empty);
  }

  /** A name from `labels`, else the locale's catalogue, else English. */
  private word(override: string | undefined, key: string, fallback: string, values?: MessageValues): string {
    return override ?? (this.locale?.has(key) ? this.locale.t(key, values) : fallback);
  }

  /** The buttons the schema has types for, in the order the toolbar draws them. */
  private buildActions(): Action[] {
    const schema = untrack(() => this.state.get()).doc.type.schema;
    const { marks, nodes } = schema;
    const labels = (): EditorLabels => this.labels.get();
    const actions: Action[] = [];
    const command =
      (run: (state: EditorState, tr: EditorTransaction) => boolean) =>
      (state: EditorState): EditorTransaction | null => {
        const tr = state.tr();
        return run(state, tr) ? tr : null;
      };

    const mark = (key: 'bold' | 'italic' | 'code', type: string, glyph: string, fallback: string): void => {
      const markType = marks[type];
      if (!markType) return;
      actions.push({
        key,
        glyph,
        toggle: true,
        name: () => this.word(labels()[key], key, fallback),
        isOn: (state) => markActive(state, markType),
        // The refusal format.ts states first, and the one a toolbar meets most.
        pressable: (state) => selectsText(state.selection),
        perform: command((_, tr) => toggleMark(tr, markType)),
      });
    };
    mark('bold', 'strong', 'B', 'Bold');
    mark('italic', 'em', 'I', 'Italic');
    mark('code', 'code', '</>', 'Code');

    const heading = nodes['heading'];
    const paragraph = nodes['paragraph'];
    if (heading && paragraph) {
      for (const level of [1, 2, 3] as const) {
        const attrs = { level };
        actions.push({
          key: `heading-${level}`,
          glyph: `H${level}`,
          toggle: true,
          name: () => labels().heading?.(level) ?? this.word(undefined, 'heading', `Heading ${level}`, { n: level }),
          isOn: (state) => blockActive(state, heading, attrs),
          pressable: () => true,
          // A second press puts the paragraph back, which is what a heading
          // button that stays down promises.
          perform: command((state, tr) =>
            blockActive(state, heading, attrs) ? setBlockType(tr, paragraph) : setBlockType(tr, heading, attrs),
          ),
        });
      }
    }

    const item = nodes['list_item'];
    const list = (key: 'bullet-list' | 'ordered-list', type: string, glyph: string, label: () => string): void => {
      const listType = nodes[type];
      if (!listType || !item) return;
      actions.push({
        key,
        glyph,
        toggle: true,
        name: label,
        isOn: (state) => listActive(state, listType, item),
        pressable: () => true,
        perform: command((_, tr) => toggleList(tr, listType, item)),
      });
    };
    list('bullet-list', 'bullet_list', '•', () => this.word(labels().bulletList, 'bulletList', 'Bulleted list'));
    list('ordered-list', 'ordered_list', '1.', () => this.word(labels().orderedList, 'orderedList', 'Numbered list'));

    const quote = nodes['blockquote'];
    if (quote) {
      actions.push({
        key: 'blockquote',
        glyph: '❝',
        toggle: true,
        name: () => this.word(labels().blockquote, 'quote', 'Quote'),
        isOn: (state) => wrapActive(state, quote),
        pressable: () => true,
        perform: command((_, tr) => toggleWrap(tr, quote)),
      });
    }

    actions.push(
      {
        key: 'undo',
        glyph: '↶',
        toggle: false,
        name: () => this.word(labels().undo, 'undo', 'Undo'),
        isOn: () => false,
        // The depth rather than a transaction: building one applies every
        // step of the unit, which after a mark across a long document is
        // as costly as the mark was. Every change to the history is a
        // state shown, so the status is asked again whenever this moves.
        pressable: () => this.history.undoDepth > 0,
        perform: (state) => this.history.undo(state),
      },
      {
        key: 'redo',
        glyph: '↷',
        toggle: false,
        name: () => this.word(labels().redo, 'redo', 'Redo'),
        isOn: () => false,
        pressable: () => this.history.redoDepth > 0,
        perform: (state) => this.history.redo(state),
      },
    );
    return actions;
  }
}

/** The toolbar's rows: the marks, the blocks, and the history, each drawn only if it has a button. */
function groupsOf(actions: readonly Action[]): EditorToolbarGroup[] {
  const rows: Record<string, readonly EditorAction[]> = {
    marks: ['bold', 'italic', 'code'],
    blocks: ['heading-1', 'heading-2', 'heading-3', 'bullet-list', 'ordered-list', 'blockquote'],
    history: ['undo', 'redo'],
  };
  return Object.entries(rows)
    .map(([name, keys]) => ({
      name,
      actions: actions
        .filter((action) => keys.includes(action.key))
        .map(({ key, glyph, toggle }) => ({ key, glyph, toggle })),
    }))
    .filter((group) => group.actions.length > 0);
}

/**
 * A document as the editor shows it: as it is, unless it holds no block — the
 * least a top node whose content may be empty allows, and one that leaves a
 * caret nowhere to go and a click nothing to land on. That is shown with the
 * textblock its top node asks for first, an empty one the empty-box words
 * are laid over. The block is how the empty document looks, not an edit: the
 * caller's signal keeps the document it holds until the first one.
 */
function shownAs(doc: DocNode): DocNode {
  if (doc.childCount > 0) return doc;
  const first = doc.type.contentMatch.defaultType;
  const block = first?.isTextblock ? first.createAndFill() : null;
  return (block ? doc.type.createAndFill(doc.attrs, block) : null) ?? doc;
}

/**
 * The engine's link, drawn without an address that would run script rather
 * than go somewhere.
 *
 * Paste already keeps such a link out, but a document handed over as `value`
 * comes from wherever the page keeps documents — often one reader's writing
 * opened by another — and an editor out of use is not editable, so a press on
 * a link in it is followed. The rule is the server markup's, so the element is
 * the same before the engine loads and after.
 */
function inertLink(mark: Mark, document: Document): HTMLElement {
  const dom = basicMarkRenderers['link']?.(mark, document) ?? document.createElement('a');
  const href = dom.getAttribute('href');
  if (href !== null && runsScript(href)) dom.removeAttribute('href');
  return dom;
}

/**
 * Whether a selection has text in it for a mark to go on: not a caret, and
 * not an image or a rule selected whole, whose range holds no text either.
 */
function selectsText(selection: EditorSelection): boolean {
  return !selection.empty && !(selection instanceof NodeSelection && selection.node.isLeaf);
}

/** Whether the toolbar's arrows stop on an item, by the rule its collection keeps. */
function reachable(item: Element): boolean {
  return !item.hasAttribute('data-disabled') && !item.hasAttribute('disabled');
}

/**
 * The nearest item of a toolbar the arrows stop on, from one they do not, in
 * the direction a key moves through the row — round past its end, as the
 * arrows go everywhere else.
 */
function beside(toolbar: Element, from: Element, forward: boolean): HTMLElement | null {
  const items = [...toolbar.querySelectorAll<HTMLElement>('[data-volt-item]')];
  const at = items.indexOf(from as HTMLElement);
  const step = forward ? 1 : -1;
  for (let i = 1; i < items.length; i++) {
    const item = items[(((at + step * i) % items.length) + items.length) % items.length]!;
    if (reachable(item)) return item;
  }
  return null;
}

/**
 * Whether a row runs right to left, read as the toolbar's own arrows read
 * it: the nearest `dir` written, and the computed direction where there is
 * none.
 */
function rightToLeft(el: Element): boolean {
  const declared = el.closest('[dir]');
  if (declared) return declared.getAttribute('dir')?.toLowerCase() === 'rtl';
  return el.ownerDocument.defaultView?.getComputedStyle(el).direction === 'rtl';
}

/** What a caller actually wrote, or nothing at all if it came to nothing. */
function said(value: string | boolean | undefined): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}
