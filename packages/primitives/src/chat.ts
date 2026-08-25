/**
 * Chat — a transcript that grows at the bottom while someone is reading it.
 *
 * Built out of a list and a textarea, a chat is wrong in a way that is obvious
 * to everyone who uses it: the view jumps when a reply arrives, the reader
 * loses their place scrolling back through history, and every token of a
 * streamed answer costs a re-render of the whole conversation. Those three are
 * the whole of the hard part, and they are what this owns.
 *
 * This is headless: it owns the transcript, the scroll position, the composer's
 * keyboard and the ARIA, and returns prop objects to spread onto whatever
 * markup the consumer writes. Nothing here renders and nothing here styles.
 *
 *   class Room {
 *     scroller = new Signal.State<Element | null>(null);
 *     list = new Signal.State<Element | null>(null);
 *     composer = new Signal.State<Element | null>(null);
 *     chat = createChat({
 *       scroller: () => this.scroller.get(),
 *       container: () => this.list.get(),
 *       composer: () => this.composer.get(),
 *       onSend: (text) => this.chat.add({ author: 'ada', name: 'Ada', text }),
 *     });
 *   }
 *
 *   <div :ref="scroller" :spread="chat.logProps()" :keydown="chat.onKeyDown($event)">
 *     <div :spread="chat.sizerProps()">
 *       <div :ref="list" :spread="chat.containerProps()">
 *         <div :for="row in chat.rendered()" :key="row.id"
 *              :spread="chat.messageProps(row)">
 *           <b :if="row.startsGroup">{ row.message.name }</b>
 *           <p>{ row.message.text() }</p>
 *         </div>
 *       </div>
 *     </div>
 *   </div>
 *   <button :if="chat.showJumpToLatest()" :spread="chat.jumpToLatestProps()"
 *           :click="chat.jumpToLatest()">{ chat.unreadCount() } new</button>
 *   <textarea :ref="composer" :spread="chat.composerProps()"
 *             :input="chat.onComposerInput($event)"
 *             :keydown="chat.onComposerKeyDown($event) && $event.preventDefault()">
 *   </textarea>
 *
 * **A message's text is its own signal.** That is the reason streaming is
 * cheap here and expensive nearly everywhere else. `append` writes to one
 * signal, one text binding re-runs, and one text node's `data` changes — the
 * array of messages never fires, so the loop never re-runs, no element is
 * created or destroyed, and the scroll position cannot move because nothing
 * below the changed node was replaced. A framework that re-renders a list to
 * show a token has to fight all of that back afterwards.
 *
 * **Grouping is a view, not a change to the data.** Consecutive messages from
 * one author read as one block, and the only question that answers is about a
 * message's neighbours — so it is answered per row, from the list, rather than
 * written onto the messages. Nothing is materialised, nothing has to be kept
 * in step, and a message that arrives in the middle of a run re-groups both
 * sides of itself for free.
 *
 * **Windowing is `createVirtualizer`**, with measurement on, because no
 * message has a knowable height: a one-word reply and a twenty-line one are
 * the same kind of thing. Measurements are cached against the message id, so
 * loading older history at the top does not throw away what is already known
 * about the rest.
 *
 * **A message's parts are its shape, not its rendering.** A reply is rarely
 * one run of prose: it has code in it, a passage it is quoting, reasoning the
 * reader can unfold, and the sources it leant on. What a headless primitive
 * owns there is which parts a message has and what each one is called — the
 * roles, the names, the collapsed state of the reasoning, the button that
 * copies the code. It does not own how any of it looks, and it deliberately
 * does not own how the text became parts: there is no markdown parser here
 * and no syntax highlighter, because both are choices about rendering that
 * belong to the application and neither can be undone by a consumer who
 * wanted a different one.
 *
 * **A message's state is the message's.** Typing, generating, failed: each is
 * a property of the message it is about, so it is read from the message and
 * changes with it. Tracked alongside the transcript instead, every one of them
 * becomes a second thing to keep in step — and the one that drifts is always
 * the indicator that never goes away.
 *
 * The scroll model is described at `createChat` itself, since it is the part
 * most worth reading before using this.
 */

import { Signal, effect } from '@voltdev/core';
import { announce } from './announcer.js';
import { createClipboard, type CopyStatus } from './clipboard.js';
import { createId } from './id.js';
import {
  createVirtualizer,
  type VirtualOverscan,
  type VirtualScrollOptions,
} from './virtualizer.js';

// The proposal's own name for reading without subscribing; Volt adds no second
// spelling for it.
const { untrack } = Signal.subtle;

/**
 * The first guess at a message's height, in px, before one has been measured.
 *
 * Only the scrollbar and the size of the first rendered window depend on it,
 * and both are corrected within a frame of anything being on screen. Roughly
 * two lines and the space around them, which is what most messages are.
 */
const DEFAULT_MESSAGE_SIZE = 72;

/**
 * How close to the end still counts as being at the end, in px.
 *
 * It cannot be zero. Fractional layout, a zoom level that is not 100%, and a
 * scroll that lands a subpixel short all leave a reader who is visibly at the
 * bottom a fraction of a pixel away from it, and a chat that unpins there
 * stops following the conversation for no reason the reader can see. It also
 * cannot be large, or a reader who deliberately scrolled up one line gets
 * dragged back down. A couple of lines of slack is the balance.
 */
const DEFAULT_BOTTOM_THRESHOLD = 32;

/** Lines the composer shows before anything is typed into it. */
const DEFAULT_COMPOSER_ROWS = 1;

export interface ChatMessageInput<T = unknown> {
  /** Stable identity. Generated when absent. */
  id?: string;
  /**
   * Who sent it. This is an identity, not a display name — grouping compares
   * it, so two people called "Sam" must not share it.
   */
  author: string;
  /** What to call them on screen and in an announcement. Defaults to `author`. */
  name?: string;
  /** The body. Empty is normal for a message that is about to be streamed. */
  text?: string;
  /** Epoch milliseconds. Defaults to now, and only grouping reads it. */
  timestamp?: number;
  /**
   * Arriving token by token. A streaming message is not announced on arrival —
   * see `finish`.
   */
  streaming?: boolean;
  /**
   * A reply is on its way and none of it has arrived — the typing indicator.
   * The first token turns it into a streaming message on its own.
   */
  typing?: boolean;
  /**
   * The shape of the body, when it is more than one run of prose. Omit it and
   * the message is one text part over `text`, which is what most messages are.
   */
  parts?: readonly ChatPartInput[];
  /** Anything the consumer needs to carry with the message. */
  data?: T;
}

/**
 * Where a message is in its life.
 *
 * `typing` and `streaming` are one thing seen at two moments — a reply that is
 * coming, and a reply that has started to arrive — and keeping them apart is
 * what lets an indicator show before there is a single token to render.
 */
export type ChatMessageStatus = 'idle' | 'typing' | 'streaming' | 'error';

/**
 * What a message can offer to do with itself.
 *
 * `cancel` is here rather than beside the state it belongs to because it is a
 * button on a message like the others, and putting it anywhere else would give
 * it a tab stop of its own outside the roving group.
 */
export type ChatActionName = 'copy' | 'edit' | 'regenerate' | 'retry' | 'cancel';

/**
 * The kinds of part a message's body can be made of.
 *
 * A deliberately closed list. Each one exists because it changes the
 * *accessible shape* of the message — a name, a role, or a control — and not
 * because it looks different. Emphasis and links are not here for that reason:
 * they are rendering, and the consumer's markup already says them.
 */
export type ChatPartKind = 'text' | 'code' | 'quote' | 'reasoning' | 'source';

export interface ChatPartInput {
  /** Default `text`. */
  kind?: ChatPartKind;
  /** The part's own body. Streams into the last part of the message. */
  text?: string;
  /**
   * What the code is written in, as the consumer names it. Carried into the
   * block's accessible name and a data attribute; nothing here parses it, and
   * nothing here highlights by it.
   */
  language?: string;
  /** Where a source points. */
  href?: string;
  /** What to call a source, a code block, or a run of reasoning. */
  title?: string;
  /** Reasoning starts collapsed unless this says otherwise. */
  open?: boolean;
}

export interface ChatPart {
  /** Stable identity, which is what `:key` wants. */
  readonly id: string;
  readonly kind: ChatPartKind;
  /** Position among the message's parts. */
  readonly index: number;
  /**
   * Position among the parts of the same kind, from 1 — what "Source 2" is
   * counting. The message's own numbering, so a citation keeps its number
   * whatever prose surrounds it.
   */
  readonly ordinal: number;
  readonly language: string | undefined;
  readonly href: string | undefined;
  readonly title: string | undefined;
  /** The part's body, as a signal of its own, for the same reason a message's is. */
  text(): string;
  /** Whether a collapsible part is unfolded. Always true for the rest. */
  isOpen(): boolean;
  /** Unfold or fold it. Toggles when told nothing. */
  toggle(open?: boolean): void;
}

export interface ChatMessage<T = unknown> {
  readonly id: string;
  readonly author: string;
  readonly name: string;
  readonly timestamp: number;
  readonly data: T | undefined;
  /**
   * The body, as a signal of its own.
   *
   * Read it in the template rather than reading it out here and passing the
   * string down: a binding subscribed to this signal is what makes `append`
   * cost one text node instead of one list.
   */
  text(): string;
  /** Still arriving. The same question as `status() === 'streaming'`. */
  streaming(): boolean;
  /** Where this message is in its life. */
  status(): ChatMessageStatus;
  /** What went wrong, when the status is `error`. Empty otherwise. */
  error(): string;
  /**
   * The body's shape. One text part for a plain message, and that part shares
   * the message's own text signal — so a template that renders parts costs a
   * streamed token exactly what a template that renders `text()` costs.
   */
  parts(): readonly ChatPart[];
}

/** One message in the rendered window, with its place in the transcript. */
export interface ChatRow<T = unknown> {
  /** Position in the whole transcript, not in the window. */
  readonly index: number;
  /** The message's id, which is what `:key` wants. */
  readonly id: string;
  readonly message: ChatMessage<T>;
  /** First of a run from this author — where an avatar and a name belong. */
  readonly startsGroup: boolean;
  /** Last of a run — where the space before the next author belongs. */
  readonly endsGroup: boolean;
}

export interface ChatLabels<T = unknown> {
  /** Names the transcript. Default `Messages`. */
  log?: string;
  /** Names the composer. Default `Message`. */
  composer?: string;
  /**
   * The jump-to-latest control, given how many messages arrived unseen.
   * Default `Jump to latest` when none, `3 new messages` when some — the count
   * has to be in the name, because it is the only place a screen-reader user
   * can hear it.
   */
  jumpToLatest?: (unread: number) => string;
  /**
   * What is said when a message arrives. Default `Ada: hello`, falling back to
   * the text alone when there is no name worth saying.
   */
  messageArrived?: (message: ChatMessage<T>) => string;

  /**
   * Names each action button. A name is required rather than an icon's title,
   * because an icon-only button with no name is a button that says "button".
   */
  actions?: Partial<Record<ChatActionName, string>>;
  /** Names the group the actions sit in. Default `Message actions`. */
  actionGroup?: (message: ChatMessage<T>) => string;

  /** Default `Ada is typing`. */
  typing?: (message: ChatMessage<T>) => string;
  /** Default `Ada is replying`. */
  generating?: (message: ChatMessage<T>) => string;
  /** Default `Ada: message failed`, or the reason when there is one. */
  failed?: (message: ChatMessage<T>, error: string) => string;

  /** Names a code block, given whatever the consumer called the language. */
  codeBlock?: (language: string | undefined) => string;
  /** Names the button that copies one. Default `Copy code`. */
  copyCode?: string;
  /** Names a run of collapsible reasoning. Default `Reasoning`. */
  reasoning?: (title: string | undefined) => string;
  /** Names a citation, given its number within the message. */
  source?: (ordinal: number, title: string | undefined) => string;
}

export interface ChatOptions<T = unknown> {
  /** The element that scrolls, and the one carrying `role="log"`. */
  scroller: () => Element | null | undefined;
  /** The element the rendered window lives in — what `containerProps()` goes on. */
  container: () => Element | null | undefined;
  /** The `<textarea>`. Only needed for the parts that write to it, like `send`. */
  composer?: () => Element | null | undefined;

  /**
   * The first guess at a message's height, or a function for a better one per
   * message. Either way the real height is measured and the guess corrected,
   * because a message's height is a property of its text and its width.
   */
  itemSize?: number | ((index: number) => number);
  /** Space between messages, in px. Part of the arithmetic, not of layout. */
  gap?: number;
  /** Messages rendered beyond the viewport, each way. Default 2. */
  overscan?: number | Partial<VirtualOverscan>;

  /** How close to the bottom still counts as at the bottom, in px. Default 32. */
  bottomThreshold?: number;
  /**
   * Consecutive messages from one author group only when they are this close
   * together, in milliseconds. Without it, time is not part of the question
   * and a run is a run however long it took.
   */
  groupWithin?: number;

  /** Say arriving messages in the shared live region. Default true. */
  announceMessages?: boolean;

  /** Lines the composer starts at. Default 1. */
  rows?: number;
  /** Lines the composer stops growing at. Without one it grows for ever. */
  maxRows?: number;

  labels?: ChatLabels<T>;

  /**
   * Which author is the person at this keyboard.
   *
   * Only the default action set reads it, and it is the whole of what that set
   * needs: you edit and resend your own messages and regenerate somebody
   * else's, and no other rule distinguishes them. Left out, a message offers
   * copy alone — a primitive that cannot tell whose message it is has no
   * business guessing, and `actions` is there for anyone whose rule is
   * different.
   */
  self?: string;
  /**
   * Which actions a message offers, in the order they appear. Overrides the
   * default set entirely.
   */
  actions?: (message: ChatMessage<T>) => readonly ChatActionName[];

  /**
   * A message was sent from the composer. The transcript is the consumer's to
   * add to — only they know who is sending — so this is where `add` is called.
   */
  onSend?: (text: string) => void;
  /**
   * An edited message was sent again. `onSend` is not also called: the
   * transcript already holds this message, and adding a second copy of it is
   * exactly what edit-and-resend must not do.
   */
  onResend?: (message: ChatMessage<T>, text: string) => void;
  /** A reply was thrown away and another asked for. */
  onRegenerate?: (message: ChatMessage<T>) => void;
  /** A failed message is to be attempted again. */
  onRetry?: (message: ChatMessage<T>) => void;
  /** A generation in progress is to stop. */
  onCancel?: (message: ChatMessage<T>) => void;
  /** The view stopped following the conversation, or started again. */
  onPinnedChange?: (pinned: boolean) => void;
}

export type ChatPropValue =
  | string
  | number
  | boolean
  | undefined
  | Readonly<Record<string, string>>;

export interface ChatProps {
  readonly [key: string]: ChatPropValue;
}

export interface Chat<T = unknown> {
  /** The whole transcript, oldest first. */
  messages(): readonly ChatMessage<T>[];
  /** The window to render, oldest first, with each row's place in a run. */
  rendered(): readonly ChatRow<T>[];

  /** Add a message to the end, and return it so tokens can be appended to it. */
  add(input: ChatMessageInput<T>): ChatMessage<T>;
  /** Add a token to a message's text. */
  append(id: string, token: string): void;
  /** A streaming message has finished, which is when it is announced. */
  finish(id: string): void;
  /** It went wrong. The status becomes `error` and the reason is announced. */
  fail(id: string, error?: string): void;
  /** Stop a generation that is under way. */
  cancel(id: string): void;
  /** Clear a failure and ask for the message again. */
  retry(id: string): void;
  /** Throw a reply away and ask for another in its place. */
  regenerate(id: string): void;
  /** Give a message another part, streaming a structured reply. */
  addPart(id: string, part: ChatPartInput): ChatPart | null;
  /** Replace a message's shape. */
  setParts(id: string, parts: readonly ChatPartInput[]): void;
  /** Replace the transcript — loading history, or changing conversation. */
  setMessages(inputs: readonly ChatMessageInput<T>[]): void;

  /** Whether new content will be followed. */
  isPinned(): boolean;
  /** Whether the view is at the end right now. */
  isAtBottom(): boolean;
  /** Messages that arrived while the reader was not following. */
  unreadCount(): number;
  /** Whether the jump-to-latest affordance has anything to offer. */
  showJumpToLatest(): boolean;
  /** Go to the newest message and start following again. */
  jumpToLatest(options?: VirtualScrollOptions): void;

  /** What is in the composer. */
  draft(): string;
  setDraft(text: string): void;
  /** Whether there is anything worth sending. */
  canSend(): boolean;
  /** Send the draft, and return what was sent. Null when there was nothing. */
  send(): string | null;

  /** The message the composer is editing, or null. */
  editing(): ChatMessage<T> | null;
  /** Put a message back in the composer to be sent again. */
  beginEdit(id: string): void;
  /** Leave the message alone and empty the composer. */
  cancelEdit(): void;

  /** Which actions a message offers, in order. */
  actionsFor(message: ChatMessage<T>): readonly ChatActionName[];
  /** Run one — what a `:click` binds to. */
  activate(message: ChatMessage<T>, action: ChatActionName): void;
  /** Copy a whole message through the shared clipboard. */
  copyMessage(id: string): Promise<boolean>;
  /** Copy one part of one, which is what a code block's button does. */
  copyPart(part: ChatPart): Promise<boolean>;
  /** The copy state of a message id or a part id. `idle` for everything else. */
  copyStatus(key: string): CopyStatus;
  /** What to show for a message's state. Empty when there is nothing to say. */
  statusText(message: ChatMessage<T>): string;

  /** Scrolling keys for the transcript. Returns true when it consumed one. */
  onKeyDown(event: KeyboardEvent): boolean;
  /** Enter sends, Shift+Enter does not. Returns true when it consumed the key. */
  onComposerKeyDown(event: KeyboardEvent): boolean;
  onComposerInput(event: Event): void;
  /** Arrow keys across one message's actions. True when it consumed the key. */
  onActionKeyDown(message: ChatMessage<T>, event: KeyboardEvent): boolean;

  logProps(): ChatProps;
  sizerProps(): ChatProps;
  containerProps(): ChatProps;
  messageProps(row: ChatRow<T>): ChatProps;
  composerProps(): ChatProps;
  jumpToLatestProps(): ChatProps;
  /** The group a message's actions sit in — one tab stop for all of them. */
  actionsProps(message: ChatMessage<T>): ChatProps;
  actionProps(message: ChatMessage<T>, action: ChatActionName): ChatProps;
  /** The part's outer element, which is where its role and name live. */
  partProps(part: ChatPart): ChatProps;
  /** The element holding the part's text. */
  partContentProps(part: ChatPart): ChatProps;
  /** The button that folds a collapsible part. */
  partToggleProps(part: ChatPart): ChatProps;
  /** The button that copies a code block. */
  partCopyProps(part: ChatPart): ChatProps;
}

/** The writable half of a part, which never leaves this module. */
interface PartEntry extends ChatPart {
  readonly body: Signal.State<string>;
  readonly unfolded: Signal.State<boolean>;
}

/** The writable half of a message, which never leaves this module. */
interface Entry<T> extends ChatMessage<T> {
  readonly body: Signal.State<string>;
  readonly state: Signal.State<ChatMessageStatus>;
  readonly failure: Signal.State<string>;
  readonly partList: Signal.State<readonly PartEntry[]>;
  /**
   * Whether the parts are the consumer's or the one this made over `body`.
   * Not a signal: `text()` reads it, and the parts it would answer differently
   * about are written in the same breath, so the list's own signal is the one
   * that has to fire.
   */
  structured: boolean;
}

/**
 * One part, over a body signal it may or may not own.
 *
 * A plain message's only part is handed the message's own signal rather than
 * a copy of it. That is the whole reason parts cost nothing: `append` writes
 * one signal whether the template renders `message.text()` or walks
 * `message.parts()`, and there is never a second string to keep in step.
 */
function createPart(
  input: ChatPartInput,
  index: number,
  ordinal: number,
  shared?: Signal.State<string>,
): PartEntry {
  const body = shared ?? new Signal.State(input.text ?? '');
  // Only reasoning folds. Everything else answers the same question with
  // `true` so a template can ask any part without knowing which it has.
  const kind = input.kind ?? 'text';
  const unfolded = new Signal.State(kind === 'reasoning' ? input.open === true : true);
  return {
    id: createId('part'),
    kind,
    index,
    ordinal,
    language: input.language,
    href: input.href,
    title: input.title,
    body,
    unfolded,
    text: () => body.get(),
    isOpen: () => unfolded.get(),
    toggle: (open) => unfolded.set(open ?? !untrack(() => unfolded.get())),
  };
}

/** Build a consumer's parts, numbering each kind as it goes. */
function buildParts(inputs: readonly ChatPartInput[]): PartEntry[] {
  const counts = new Map<ChatPartKind, number>();
  return inputs.map((input, index) => {
    const kind = input.kind ?? 'text';
    const ordinal = (counts.get(kind) ?? 0) + 1;
    counts.set(kind, ordinal);
    return createPart(input, index, ordinal);
  });
}

/**
 * The whole of what a structured message says, for copying and announcing.
 *
 * Reasoning and sources are left out, and that is a judgement rather than an
 * oversight. Reasoning is how the reply was arrived at and is usually folded
 * away unread; a citation's body is a URL. Reading either aloud, or pasting it
 * into somebody's editor, is not what the reader asked for — the citation's
 * number and title are in its accessible name, which is where they belong.
 */
function joinParts(parts: readonly PartEntry[]): string {
  return parts
    .filter((part) => part.kind !== 'reasoning' && part.kind !== 'source')
    .map((part) => part.text())
    .filter((text) => text !== '')
    .join('\n\n');
}

/**
 * A chat transcript, its scroll position, and a composer.
 *
 * **The scroll model.** There are two different things here and conflating
 * them is what produces the defect everyone recognises. *At the bottom* is an
 * observation about geometry, true or false at any instant. *Pinned* is an
 * intention: whether new content should be followed. They agree most of the
 * time and must not be the same value, because the instant a message arrives
 * the view is no longer at the bottom — the collection just got taller — and a
 * pin derived from geometry would release itself exactly when it is needed.
 *
 * So the pin is changed by one thing only: the scroll offset *moving*. Growth
 * is not movement. Past the threshold after a move, the reader has left, and
 * following stops on that move rather than after a timeout; back within it,
 * they have returned, and following resumes and the unread count clears.
 * Nothing else touches the pin except `jumpToLatest` and a change of
 * conversation.
 *
 * The four cases that matter, and what each does:
 *
 *   - *a message arrives while pinned* — the transcript grows and the offset
 *     does not, so the pin holds, and the same effect scrolls to the new end.
 *     It watches the extent rather than the number of messages, so the
 *     correction that lands when the new message is measured moves the view
 *     again: a message whose real height is twice the estimate does not leave
 *     half of itself below the fold.
 *   - *a message arrives while scrolled up* — nothing scrolls, and the unread
 *     count goes up by one. Content was added below the viewport, so the
 *     reader's view is already still.
 *   - *the reader scrolls back down by hand* — the move that lands back inside
 *     the threshold re-pins and clears the count. There is nothing to press.
 *   - *content above the viewport grows* — an image loads, or an earlier
 *     message is measured for the first time, and everything below it moves.
 *     `createVirtualizer` compensates by the same amount so the view stays on
 *     what the reader was reading, and this deliberately does not scroll: the
 *     distance to the end has not changed, so the pin has not changed either.
 *     The browser's own scroll anchoring is turned off by `logProps` so that
 *     the two do not both correct the same shift.
 */
export function createChat<T = unknown>(options: ChatOptions<T>): Chat<T> {
  const threshold = options.bottomThreshold ?? DEFAULT_BOTTOM_THRESHOLD;
  const composerRows = options.rows ?? DEFAULT_COMPOSER_ROWS;
  const labels = {
    log: options.labels?.log ?? 'Messages',
    composer: options.labels?.composer ?? 'Message',
    jumpToLatest: options.labels?.jumpToLatest ?? defaultJumpLabel,
    messageArrived:
      options.labels?.messageArrived ??
      ((message: ChatMessage<T>): string =>
        message.name === '' ? message.text() : `${message.name}: ${message.text()}`),
    actions: { ...DEFAULT_ACTION_LABELS, ...options.labels?.actions },
    actionGroup: options.labels?.actionGroup ?? ((): string => 'Message actions'),
    typing:
      options.labels?.typing ??
      ((message: ChatMessage<T>): string =>
        message.name === '' ? 'Typing' : `${message.name} is typing`),
    generating:
      options.labels?.generating ??
      ((message: ChatMessage<T>): string =>
        message.name === '' ? 'Replying' : `${message.name} is replying`),
    failed:
      options.labels?.failed ??
      ((message: ChatMessage<T>, error: string): string =>
        defaultFailedLabel(message.name, error)),
    codeBlock:
      options.labels?.codeBlock ??
      ((language: string | undefined): string =>
        language === undefined ? 'Code' : `Code, ${language}`),
    copyCode: options.labels?.copyCode ?? 'Copy code',
    reasoning:
      options.labels?.reasoning ?? ((title: string | undefined): string => title ?? 'Reasoning'),
    source:
      options.labels?.source ??
      ((ordinal: number, title: string | undefined): string =>
        title === undefined ? `Source ${ordinal}` : `Source ${ordinal}: ${title}`),
  };

  const messages = new Signal.State<readonly ChatMessage<T>[]>([]);
  /** Where the writable half of each message lives, so `append` can find it. */
  const byId = new Map<string, Entry<T>>();

  const pinned = new Signal.State(true);
  const unread = new Signal.State(0);
  const draft = new Signal.State('');
  /** The message the composer is standing in for, while one is being edited. */
  const editing = new Signal.State<string | null>(null);
  /**
   * The action the keyboard last landed on, and so the one holding each
   * message's tab stop.
   *
   * One value for the whole transcript rather than one per message, and each
   * group falls back to its own first action when it does not offer this one.
   * That keeps exactly one tab stop per group either way, and it means a
   * reader who tabs from message to message stays on the same column instead
   * of being put back at the start of every row.
   */
  const preferredAction = new Signal.State<ChatActionName | null>(null);

  // --- The transcript ------------------------------------------------------

  const createEntry = (input: ChatMessageInput<T>): Entry<T> => {
    const body = new Signal.State(input.text ?? '');
    const structured = input.parts !== undefined && input.parts.length > 0;
    const state = new Signal.State<ChatMessageStatus>(
      input.streaming === true ? 'streaming' : input.typing === true ? 'typing' : 'idle',
    );
    const partList = new Signal.State<readonly PartEntry[]>(
      structured ? buildParts(input.parts ?? []) : [createPart({}, 0, 1, body)],
    );
    const entry: Entry<T> = {
      id: input.id ?? createId('message'),
      author: input.author,
      name: input.name ?? input.author,
      timestamp: input.timestamp ?? Date.now(),
      data: input.data,
      body,
      state,
      failure: new Signal.State(''),
      partList,
      structured,
      // Through the entry rather than the local, because `regenerate` and a
      // resend put a structured message back to plain and this has to answer
      // for the message it is on now, not the one it was built from.
      text: () => (entry.structured ? joinParts(partList.get()) : body.get()),
      streaming: () => state.get() === 'streaming',
      status: () => state.get(),
      error: () => entry.failure.get(),
      parts: () => partList.get(),
    };
    byId.set(entry.id, entry);
    return entry;
  };

  /** Put a message back to a single text part over its own body. */
  const rewrite = (entry: Entry<T>, text: string): void => {
    entry.structured = false;
    entry.body.set(text);
    entry.partList.set([createPart({}, 0, 1, entry.body)]);
  };

  /**
   * Drop everything after a message.
   *
   * A transcript is a line, not a tree. Editing a message or asking for a
   * different reply changes what everything below it was a reply to, and
   * leaving those messages in place would show a conversation that never
   * happened. Branching is the other answer to this and is a different
   * feature; this is the one that keeps the transcript true.
   */
  const truncateAfter = (entry: Entry<T>): void => {
    const list = untrack(() => messages.get());
    const index = list.indexOf(entry);
    if (index < 0 || index === list.length - 1) return;
    for (const message of list.slice(index + 1)) byId.delete(message.id);
    messages.set(list.slice(0, index + 1));
  };

  /**
   * Say a message in the shared live region.
   *
   * Always polite, and never configurable to anything else. `assertive`
   * interrupts whatever is being read, and a conversation that cuts the reader
   * off mid-sentence every time somebody types is worse than one that says
   * nothing — which is precisely the failure the roadmap's accessibility
   * bullet names. There is no region of this component's own: `announce` owns
   * the document's two, and a third would clip them.
   */
  const say = (sentence: string): void => {
    if (options.announceMessages === false) return;
    announce(sentence, { priority: 'polite' });
  };

  const speak = (message: ChatMessage<T>): void => {
    say(labels.messageArrived(message));
  };

  const add = (input: ChatMessageInput<T>): ChatMessage<T> => {
    const entry = createEntry(input);
    messages.set([...untrack(() => messages.get()), entry]);

    // Counted against the pin rather than against what is on screen: a reader
    // who has scrolled up has not seen this message even if the arithmetic
    // happens to place it inside their viewport. A typing indicator is not an
    // arrival and is not counted — the count is of things there are to read.
    if (!untrack(() => pinned.get()) && input.typing !== true) {
      unread.set(untrack(() => unread.get()) + 1);
    }

    // A message that is about to be streamed has no text to say yet, and
    // announcing it token by token would be an unusable stutter. `finish` says
    // it once, whole. The same goes for one that is only being waited on.
    if (untrack(() => entry.status()) === 'idle') speak(entry);
    return entry;
  };

  const append = (id: string, token: string): void => {
    const entry = byId.get(id);
    if (!entry || token === '') return;
    // Into the last part, which for a plain message is the message's own body
    // signal. `addPart` is how a consumer starts a new one; tokens never
    // decide for themselves where a part ends, because deciding that is
    // parsing and parsing is the consumer's.
    const parts = untrack(() => entry.partList.get());
    const target = parts[parts.length - 1]?.body ?? entry.body;
    target.set(untrack(() => target.get()) + token);
    // A reply that was on its way has started arriving. Noticing it here is
    // what keeps the typing indicator from being a second thing to switch off.
    if (untrack(() => entry.state.get()) === 'typing') entry.state.set('streaming');
  };

  const finish = (id: string): void => {
    const entry = byId.get(id);
    if (!entry) return;
    const status = untrack(() => entry.state.get());
    // A failed message is not a finished one, and `finish` must not quietly
    // clear an error the reader still has a retry button for.
    if (status !== 'streaming' && status !== 'typing') return;
    entry.state.set('idle');
    speak(entry);
  };

  const fail = (id: string, error = ''): void => {
    const entry = byId.get(id);
    if (!entry) return;
    entry.state.set('error');
    entry.failure.set(error);
    // Politely, like everything else here. A failure is worth interrupting a
    // sentence for far less often than it feels like it is.
    say(labels.failed(entry, error));
  };

  const cancel = (id: string): void => {
    const entry = byId.get(id);
    if (!entry) return;
    const status = untrack(() => entry.state.get());
    if (status !== 'streaming' && status !== 'typing') return;
    entry.state.set('idle');
    options.onCancel?.(entry);
  };

  const retry = (id: string): void => {
    const entry = byId.get(id);
    if (!entry || untrack(() => entry.state.get()) !== 'error') return;
    entry.failure.set('');
    entry.state.set('idle');
    options.onRetry?.(entry);
  };

  const regenerate = (id: string): void => {
    const entry = byId.get(id);
    if (!entry) return;
    truncateAfter(entry);
    rewrite(entry, '');
    entry.failure.set('');
    // Waiting, not idle: the reply has been asked for and none of it is here,
    // which is exactly what the typing indicator is for.
    entry.state.set('typing');
    options.onRegenerate?.(entry);
  };

  const addPart = (id: string, input: ChatPartInput): ChatPart | null => {
    const entry = byId.get(id);
    if (!entry) return null;
    const parts = untrack(() => entry.partList.get());
    const kind = input.kind ?? 'text';
    const ordinal = parts.filter((part) => part.kind === kind).length + 1;
    const part = createPart(input, parts.length, ordinal);
    // The message has a shape now, so its text is the shape's and not the
    // body's — which still backs the first part, and still streams.
    entry.structured = true;
    entry.partList.set([...parts, part]);
    return part;
  };

  const setParts = (id: string, inputs: readonly ChatPartInput[]): void => {
    const entry = byId.get(id);
    if (!entry) return;
    if (inputs.length === 0) {
      rewrite(entry, '');
      return;
    }
    entry.structured = true;
    entry.partList.set(buildParts(inputs));
  };

  const setMessages = (inputs: readonly ChatMessageInput<T>[]): void => {
    byId.clear();
    messages.set(inputs.map(createEntry));
    // History is not news. A conversation opens at its end, showing the newest
    // message with nothing unread, which is also what switching conversation
    // has to reset to.
    unread.set(0);
    // An edit of a message that is no longer in the transcript would send its
    // text back to nothing on the next Enter.
    editing.set(null);
    setPinned(true);
  };

  // --- Grouping ------------------------------------------------------------

  /**
   * Whether two adjacent messages read as one block.
   *
   * Adjacency is the caller's job — this is only ever asked about neighbours,
   * which is what keeps grouping O(1) per rendered row instead of a pass over
   * a transcript that may be tens of thousands long.
   */
  const sameRun = (
    before: ChatMessage<T> | undefined,
    after: ChatMessage<T> | undefined,
  ): boolean => {
    if (before === undefined || after === undefined) return false;
    if (before.author !== after.author) return false;
    if (options.groupWithin === undefined) return true;
    return after.timestamp - before.timestamp <= options.groupWithin;
  };

  // --- Windowing -----------------------------------------------------------

  const virtualizer = createVirtualizer({
    scroller: options.scroller,
    container: options.container,
    count: () => messages.get().length,
    itemSize: options.itemSize ?? DEFAULT_MESSAGE_SIZE,
    // Always, even when the caller gave a number. A number here is an
    // estimate; a message's height comes from its text and the width it wraps
    // at, and neither is knowable before it is on screen.
    measure: true,
    gap: options.gap,
    overscan: options.overscan,
    // By id, so history loaded at the top does not shift every measurement
    // onto the wrong message.
    getItemKey: (index) => messages.get()[index]?.id ?? index,
    counting: 'set',
    // A transcript scrolls, so it has to be reachable from the keyboard;
    // nothing else here is focusable to carry the tab stop instead.
    focusable: true,
  });

  const rendered = (): readonly ChatRow<T>[] => {
    const list = messages.get();
    const rows: ChatRow<T>[] = [];
    for (const item of virtualizer.items()) {
      const message = list[item.index];
      if (!message) continue;
      rows.push({
        index: item.index,
        id: message.id,
        message,
        startsGroup: !sameRun(list[item.index - 1], message),
        endsGroup: !sameRun(message, list[item.index + 1]),
      });
    }
    return rows;
  };

  // --- Staying at the bottom, or not ---------------------------------------

  /** The largest offset the scroller can reach — the end of the transcript. */
  const maxScroll = (): number =>
    Math.max(0, virtualizer.totalSize() - virtualizer.viewportSize());

  const isAtBottom = (): boolean => maxScroll() - virtualizer.scrollOffset() <= threshold;

  const setPinned = (next: boolean): void => {
    if (untrack(() => pinned.get()) === next) return;
    pinned.set(next);
    options.onPinnedChange?.(next);
  };

  /**
   * The offset this last acted on, so a move can be told from a growth.
   *
   * Not a signal. It is the effect's memory of itself, and a memory that
   * invalidated the thing remembering it would never settle. Every scroll this
   * component commands is written here as it is made, because a move it made
   * itself is not the reader going anywhere — and rediscovering it as an
   * unexplained scroll is precisely how a chat comes to think its reader left.
   */
  let lastOffset = 0;

  /**
   * Where both halves of the scroll model live: the pin follows the reader,
   * and the view follows the end while the pin holds.
   *
   * They are one effect because they are one decision made twice a frame, and
   * splitting them would put an ordering between two effects where the whole
   * correctness of this sits — a follow that ran before the release would drag
   * the reader back the instant they pressed Home.
   *
   * Every move arrives here rather than through a scroll listener of this
   * component's own. The virtualizer already publishes the offset for all
   * three kinds: the reader's own scrolling, the compensation it makes when
   * content above the viewport is measured, and its own keyboard scrolling. A
   * second listener on the same element would see some of those and not
   * others, and would race the virtualizer's listener for the ones it did see.
   */
  effect(() => {
    const offset = virtualizer.scrollOffset();
    const target = maxScroll();
    const count = messages.get().length;

    if (offset !== lastOffset) {
      lastOffset = offset;
      const near = target - offset <= threshold;
      setPinned(near);
      // Reaching the end is what marks the arrivals read. There is nothing to
      // press and nothing to dismiss: the reader has caught up.
      if (near) unread.set(0);
    }

    // Untracked, so that setting the pin just above does not send this effect
    // round again to read what it already knows.
    if (!untrack(() => pinned.get()) || count === 0) return;
    // Commanding a scroll that would not move anything is work for nothing.
    if (Math.abs(offset - target) < 1) return;
    untrack(() => virtualizer.scrollToOffset(target));
    // Recorded as the offset acted on, rather than waited for. The virtualizer
    // does not publish what it commands — the `scroll` event does, a frame
    // later — and this effect could not hear it anyway: a signal written
    // during a run that reads it is a notification the run discards when it
    // marks itself clean. Left unrecorded, `lastOffset` stays where it began,
    // every later move compares against a stale value, and the reader
    // scrolling away reads as no movement at all, so the pin never releases.
    lastOffset = target;
  });

  const jumpToLatest = (scrollOptions: VirtualScrollOptions = {}): void => {
    setPinned(true);
    unread.set(0);
    if (untrack(() => messages.get().length) === 0) return;
    untrack(() => virtualizer.scrollToOffset(maxScroll(), scrollOptions));
  };

  // --- The composer --------------------------------------------------------

  /**
   * Write the box directly.
   *
   * The element is the source of truth while someone is typing into it — a
   * value written back on every keystroke moves the caret to the end, which is
   * the bug that makes a naively controlled input unusable. So the signal
   * follows the box on input, and the box is only written when something other
   * than typing changed the draft: sending it, or setting it.
   */
  const writeComposer = (text: string): void => {
    const el = untrack(() => options.composer?.());
    if (isTextControl(el)) el.value = text;
  };

  const setDraft = (text: string): void => {
    draft.set(text);
    writeComposer(text);
  };

  const send = (): string | null => {
    const text = untrack(() => draft.get()).trim();
    // Whitespace is not a message. Enter on an empty composer is still
    // consumed by `onComposerKeyDown`, so it does not leave a newline behind.
    if (text === '') return null;
    setDraft('');

    const edited = untrack(() => editing.get());
    const entry = edited === null ? undefined : byId.get(edited);
    if (entry) {
      editing.set(null);
      truncateAfter(entry);
      rewrite(entry, text);
      entry.failure.set('');
      entry.state.set('idle');
      options.onResend?.(entry, text);
      return text;
    }

    editing.set(null);
    options.onSend?.(text);
    return text;
  };

  const beginEdit = (id: string): void => {
    const entry = byId.get(id);
    if (!entry) return;
    editing.set(id);
    setDraft(untrack(() => entry.text()));
    // Focus follows, because the composer is where the editing happens and a
    // button that fills a box somewhere else and leaves the caret behind is a
    // button that has to be followed by a Tab press nobody told the user about.
    const el = untrack(() => options.composer?.());
    if (isTextControl(el)) el.focus();
  };

  const cancelEdit = (): void => {
    if (untrack(() => editing.get()) === null) return;
    editing.set(null);
    setDraft('');
  };

  // --- Per-message actions -------------------------------------------------

  /**
   * One clipboard for the whole transcript, aimed at whatever is being copied.
   *
   * A clipboard per message would be a timer per message and a `createClipboard`
   * call outside the component's owner — the copied state would then never be
   * released when the chat goes away. So the text is a signal this writes just
   * before copying, and which button is showing "copied" is a second signal
   * beside it. Only one copy can be in flight anyway: there is one clipboard.
   */
  const copying = new Signal.State('');
  const copiedKey = new Signal.State<string | null>(null);
  const clipboard = createClipboard({ text: () => copying.get() });

  const copyText = async (key: string, text: string): Promise<boolean> => {
    copying.set(text);
    copiedKey.set(key);
    return clipboard.copy();
  };

  const copyStatus = (key: string): CopyStatus =>
    copiedKey.get() === key ? clipboard.status() : 'idle';

  const copyMessage = (id: string): Promise<boolean> => {
    const entry = byId.get(id);
    if (!entry) return Promise.resolve(false);
    return copyText(entry.id, untrack(() => entry.text()));
  };

  const copyPart = (part: ChatPart): Promise<boolean> =>
    copyText(part.id, untrack(() => part.text()));

  /**
   * What a message offers when the consumer has not said.
   *
   * The state decides first: there is nothing to copy from a reply that has
   * not arrived and nothing to regenerate about one that failed. Then who sent
   * it, which is the only other question — you resend your own words and ask
   * for somebody else's again.
   */
  const defaultActions = (message: ChatMessage<T>): readonly ChatActionName[] => {
    const status = message.status();
    if (status === 'typing' || status === 'streaming') return ['cancel'];
    if (status === 'error') return ['retry', 'copy'];
    if (options.self === undefined) return ['copy'];
    return message.author === options.self ? ['copy', 'edit'] : ['copy', 'regenerate'];
  };

  const actionsFor = (message: ChatMessage<T>): readonly ChatActionName[] =>
    options.actions?.(message) ?? defaultActions(message);

  /** The action holding this message's single tab stop. */
  const tabStopFor = (message: ChatMessage<T>): ChatActionName | null => {
    const list = actionsFor(message);
    if (list.length === 0) return null;
    const wanted = preferredAction.get();
    return wanted !== null && list.includes(wanted) ? wanted : list[0]!;
  };

  const activate = (message: ChatMessage<T>, action: ChatActionName): void => {
    // A pointer moves the tab stop too. Otherwise Tab after a click puts the
    // reader back on whichever button the keyboard last used, which is not the
    // one they are looking at.
    preferredAction.set(action);
    switch (action) {
      case 'copy':
        void copyMessage(message.id);
        return;
      case 'edit':
        beginEdit(message.id);
        return;
      case 'regenerate':
        regenerate(message.id);
        return;
      case 'retry':
        retry(message.id);
        return;
      case 'cancel':
        cancel(message.id);
        return;
    }
  };

  const statusText = (message: ChatMessage<T>): string => {
    switch (message.status()) {
      case 'typing':
        return labels.typing(message);
      case 'streaming':
        return labels.generating(message);
      case 'error':
        return labels.failed(message, message.error());
      case 'idle':
        return '';
    }
  };

  return {
    messages: () => messages.get(),
    rendered,

    add,
    append,
    finish,
    fail,
    cancel,
    retry,
    regenerate,
    addPart,
    setParts,
    setMessages,

    isPinned: () => pinned.get(),
    isAtBottom,
    unreadCount: () => unread.get(),
    showJumpToLatest: () => !pinned.get() && messages.get().length > 0,
    jumpToLatest,

    draft: () => draft.get(),
    setDraft,
    canSend: () => draft.get().trim() !== '',
    send,

    editing: () => {
      const id = editing.get();
      return id === null ? null : (byId.get(id) ?? null);
    },
    beginEdit,
    cancelEdit,

    actionsFor,
    activate,
    copyMessage,
    copyPart,
    copyStatus,
    statusText,

    onKeyDown: (event) => virtualizer.onKeyDown(event),

    onComposerKeyDown(event) {
      if (event.key !== 'Enter') return false;
      // An IME is mid-word: this Enter commits the candidate the reader is
      // choosing, and sending on it would cut a sentence in half in every
      // language that composes.
      if (event.isComposing) return false;
      // Shift+Enter is the newline, and a modified Enter belongs to whatever
      // shortcut the application has bound it to.
      if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return false;
      send();
      return true;
    },

    onComposerInput(event) {
      const el = event.target;
      if (!isTextControl(el)) return;
      draft.set(el.value);
    },

    onActionKeyDown(message, event) {
      // A modified key is a shortcut, not navigation.
      if (event.ctrlKey || event.metaKey || event.altKey) return false;

      const list = actionsFor(message);
      if (list.length === 0) return false;
      const current = tabStopFor(message);
      const from = current === null ? 0 : list.indexOf(current);

      // Resolved against writing direction, as every other roving group in
      // this package does: a toolbar laid out right to left has its first
      // action under the Right arrow.
      const rtl = isRtlAt(event.currentTarget ?? event.target);
      const forwardKey = rtl ? 'ArrowLeft' : 'ArrowRight';
      const backKey = rtl ? 'ArrowRight' : 'ArrowLeft';

      let next: number;
      switch (event.key) {
        case forwardKey:
          next = (from + 1) % list.length;
          break;
        case backKey:
          next = (from - 1 + list.length) % list.length;
          break;
        case 'Home':
          next = 0;
          break;
        case 'End':
          next = list.length - 1;
          break;
        default:
          // Enter and Space are left alone. These are buttons, and the
          // platform already activates a focused button on both.
          return false;
      }

      const name = list[next]!;
      preferredAction.set(name);
      // Focus moves now, from the DOM, rather than waiting for the tabindex
      // this just changed to be written back: the attribute is what Tab reads
      // later, and the arrow key has to move focus in this same turn.
      focusAction(event.currentTarget ?? event.target, name);
      return true;
    },

    logProps: () => ({
      ...virtualizer.scrollerProps(),
      role: 'log',
      // `log` carries an implicit `aria-live: polite`, and under virtualization
      // that is a trap: rows enter and leave the DOM as the reader scrolls, so
      // the region would read out old messages for the crime of scrolling past
      // them. Announcements come from `announce` instead, which says one
      // sentence per message that actually arrived.
      'aria-live': 'off',
      'aria-label': labels.log,
    }),

    sizerProps: () => ({ ...virtualizer.sizerProps(), role: 'presentation' }),
    containerProps: () => ({ ...virtualizer.containerProps(), role: 'presentation' }),

    messageProps: (row) => ({
      ...virtualizer.itemProps(row.index),
      role: 'article',
      // The author's name, so a reader moving between messages hears who each
      // is from. It names the article; the body is still its content.
      'aria-label': row.message.name,
      // Grouping is presentation, so it travels as data attributes for CSS to
      // act on — the run is a visual grouping and does not change what the
      // transcript means.
      'data-group-start': row.startsGroup || undefined,
      'data-group-end': row.endsGroup || undefined,
      'data-streaming': row.message.streaming() || undefined,
      // Absent while there is nothing the matter, so a selector for a state is
      // a selector for a state and not for the absence of the other three.
      'data-status': row.message.status() === 'idle' ? undefined : row.message.status(),
    }),

    composerProps: () => ({
      rows: String(composerRows),
      'aria-label': labels.composer,
      enterkeyhint: 'send',
      style: {
        // The platform's own auto-sizing. A hidden mirror element measured on
        // every keystroke is the alternative, and it has to be kept in step
        // with every font, padding and border the real box has — and still
        // cannot copy the scrollbar it grows. `rows` no longer sizes a box
        // that sizes itself, so the floor is stated in the same unit as the
        // ceiling: `lh` is the box's own line height, which is what an author
        // means by "three lines".
        'field-sizing': 'content',
        'min-height': `${composerRows}lh`,
        ...(options.maxRows === undefined ? {} : { 'max-height': `${options.maxRows}lh` }),
      },
    }),

    jumpToLatestProps: () => ({
      type: 'button',
      // The count belongs in the name. A badge showing "3" is invisible to a
      // screen reader, and "Jump to latest" alone does not say there is
      // anything to jump to.
      'aria-label': labels.jumpToLatest(unread.get()),
    }),

    actionsProps: (message) => ({
      // A toolbar, which is the role built for a set of controls sharing one
      // tab stop. Anything else here — a group, a list, nothing at all — asks
      // the reader to Tab through four buttons per message, and a transcript
      // of forty messages is then a hundred and sixty presses deep.
      role: 'toolbar',
      'aria-orientation': 'horizontal',
      'aria-label': labels.actionGroup(message),
      // How `onActionKeyDown` finds the sibling to move focus to. The
      // consumer's own markup between the group and its buttons is theirs.
      'data-chat-actions': '',
    }),

    actionProps: (message, action) => ({
      // Inside a form, a button with no type submits it.
      type: 'button',
      tabindex: tabStopFor(message) === action ? '0' : '-1',
      'aria-label': labels.actions[action],
      'data-chat-action': action,
      // Only the copy button has a state to show, and only about its own
      // message: two messages copied in turn must not both look copied.
      'data-state': action === 'copy' ? copyStatus(message.id) : undefined,
    }),

    partProps: (part) => {
      const common = { 'data-part': part.kind };
      switch (part.kind) {
        case 'code':
          return {
            ...common,
            // A group so the block has a name at all, and the name says what
            // the language is because that is the one thing about a code block
            // a reader cannot get from the text read out to them.
            role: 'group',
            'aria-label': labels.codeBlock(part.language),
            'data-language': part.language,
          };
        case 'quote':
          return { ...common, role: 'blockquote' };
        case 'reasoning':
          return {
            ...common,
            role: 'group',
            'aria-label': labels.reasoning(part.title),
            'data-state': part.isOpen() ? 'open' : 'closed',
          };
        case 'source':
          return {
            ...common,
            // The number is in the name. On screen a citation is "[2]", which
            // is read out as "2" or as nothing at all.
            'aria-label': labels.source(part.ordinal, part.title),
            href: part.href,
          };
        case 'text':
          return common;
      }
    },

    partContentProps: (part) => ({
      id: partContentId(part),
      // A code block scrolls sideways more often than not, and a region that
      // scrolls has to be reachable by keyboard or its content is unreadable
      // without a mouse. The name is on the group around it rather than here,
      // so it is not repeated every time focus lands.
      tabindex: part.kind === 'code' ? '0' : undefined,
      hidden: part.isOpen() ? undefined : true,
    }),

    partToggleProps: (part) => ({
      type: 'button',
      'aria-expanded': String(part.isOpen()),
      'aria-controls': partContentId(part),
      'data-state': part.isOpen() ? 'open' : 'closed',
    }),

    partCopyProps: (part) => ({
      type: 'button',
      'aria-label': labels.copyCode,
      'data-state': copyStatus(part.id),
    }),
  };
}

/**
 * The English defaults for the action buttons.
 *
 * Verbs, and each one says what it acts on. "Copy" alone is fine beside an
 * icon and useless in a list of forty buttons read out one after another,
 * which is how a screen-reader user meets a transcript.
 */
const DEFAULT_ACTION_LABELS: Record<ChatActionName, string> = {
  copy: 'Copy message',
  edit: 'Edit and resend',
  regenerate: 'Regenerate reply',
  retry: 'Try again',
  cancel: 'Stop generating',
};

/**
 * The English default for what a failed message says.
 *
 * The reason wins when there is one, because "could not be sent" tells the
 * reader nothing they cannot already see and "rate limited" tells them whether
 * pressing retry is worth anything.
 */
function defaultFailedLabel(name: string, error: string): string {
  if (error !== '') return name === '' ? error : `${name}: ${error}`;
  return name === '' ? 'Message could not be sent' : `${name}'s message could not be sent`;
}

/**
 * The English default for the jump-to-latest name.
 *
 * Plain strings rather than the locale catalogue, as the virtualizer's own
 * labels are: these are chat's words, not the library's, and a catalogue key
 * added here would be one every translation has to grow. `labels` is the way
 * past it.
 */
function defaultJumpLabel(unread: number): string {
  if (unread === 0) return 'Jump to latest';
  return unread === 1 ? '1 new message' : `${unread} new messages`;
}

/**
 * The id of the element a part's text lives in.
 *
 * Derived from the part's id rather than generated beside it, because the
 * toggle's `aria-controls` and the content's `id` are written by two different
 * prop objects and have to agree without either of them holding state.
 */
function partContentId(part: ChatPart): string {
  return `${part.id}-content`;
}

/**
 * Move focus to another action in the same group.
 *
 * Through the DOM from the button that was pressed, rather than through refs
 * the consumer would have to register. The group and the buttons are found by
 * the attributes `actionsProps` and `actionProps` put there, so whatever
 * markup sits in between is the consumer's business.
 */
function focusAction(from: EventTarget | null, action: ChatActionName): void {
  if (!(from instanceof Element)) return;
  const group = from.closest('[data-chat-actions]');
  group?.querySelector<HTMLElement>(`[data-chat-action="${action}"]`)?.focus();
}

/**
 * Writing direction at `target`.
 *
 * The nearest `dir` attribute wins over computed style, for the same reasons
 * roving focus reads it that way: an application that marks direction up with
 * `dir` is stating intent, and the attribute is readable before styles resolve.
 */
function isRtlAt(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const declared = target.closest('[dir]');
  if (declared) return declared.getAttribute('dir')?.toLowerCase() === 'rtl';
  const view = target.ownerDocument?.defaultView;
  return view?.getComputedStyle?.(target).direction === 'rtl';
}

/**
 * By tag name rather than by `instanceof`, as the other primitives test it:
 * the constructor is a browser global with nothing behind it on a server, and
 * a guard that throws there would take the whole render with it.
 */
function isTextControl(el: unknown): el is HTMLTextAreaElement | HTMLInputElement {
  const tag = (el as Element | null | undefined)?.tagName;
  return tag === 'TEXTAREA' || tag === 'INPUT';
}
