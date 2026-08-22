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
 * The scroll model is described at `createChat` itself, since it is the part
 * most worth reading before using this.
 */

import { Signal, effect } from '@voltdev/core';
import { announce } from './announcer.js';
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
  /** Anything the consumer needs to carry with the message. */
  data?: T;
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
  /** Still arriving. */
  streaming(): boolean;
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
   * A message was sent from the composer. The transcript is the consumer's to
   * add to — only they know who is sending — so this is where `add` is called.
   */
  onSend?: (text: string) => void;
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

  /** Scrolling keys for the transcript. Returns true when it consumed one. */
  onKeyDown(event: KeyboardEvent): boolean;
  /** Enter sends, Shift+Enter does not. Returns true when it consumed the key. */
  onComposerKeyDown(event: KeyboardEvent): boolean;
  onComposerInput(event: Event): void;

  logProps(): ChatProps;
  sizerProps(): ChatProps;
  containerProps(): ChatProps;
  messageProps(row: ChatRow<T>): ChatProps;
  composerProps(): ChatProps;
  jumpToLatestProps(): ChatProps;
}

/** The writable half of a message, which never leaves this module. */
interface Entry<T> extends ChatMessage<T> {
  readonly body: Signal.State<string>;
  readonly live: Signal.State<boolean>;
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
  };

  const messages = new Signal.State<readonly ChatMessage<T>[]>([]);
  /** Where the writable half of each message lives, so `append` can find it. */
  const byId = new Map<string, Entry<T>>();

  const pinned = new Signal.State(true);
  const unread = new Signal.State(0);
  const draft = new Signal.State('');

  // --- The transcript ------------------------------------------------------

  const createEntry = (input: ChatMessageInput<T>): Entry<T> => {
    const body = new Signal.State(input.text ?? '');
    const live = new Signal.State(input.streaming === true);
    const entry: Entry<T> = {
      id: input.id ?? createId('message'),
      author: input.author,
      name: input.name ?? input.author,
      timestamp: input.timestamp ?? Date.now(),
      data: input.data,
      body,
      live,
      text: () => body.get(),
      streaming: () => live.get(),
    };
    byId.set(entry.id, entry);
    return entry;
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
  const speak = (message: ChatMessage<T>): void => {
    if (options.announceMessages === false) return;
    announce(labels.messageArrived(message), { priority: 'polite' });
  };

  const add = (input: ChatMessageInput<T>): ChatMessage<T> => {
    const entry = createEntry(input);
    messages.set([...untrack(() => messages.get()), entry]);

    // Counted against the pin rather than against what is on screen: a reader
    // who has scrolled up has not seen this message even if the arithmetic
    // happens to place it inside their viewport.
    if (!untrack(() => pinned.get())) unread.set(untrack(() => unread.get()) + 1);

    // A message that is about to be streamed has no text to say yet, and
    // announcing it token by token would be an unusable stutter. `finish` says
    // it once, whole.
    if (!untrack(() => entry.streaming())) speak(entry);
    return entry;
  };

  const append = (id: string, token: string): void => {
    const entry = byId.get(id);
    if (!entry || token === '') return;
    entry.body.set(untrack(() => entry.body.get()) + token);
  };

  const finish = (id: string): void => {
    const entry = byId.get(id);
    if (!entry || !untrack(() => entry.live.get())) return;
    entry.live.set(false);
    speak(entry);
  };

  const setMessages = (inputs: readonly ChatMessageInput<T>[]): void => {
    byId.clear();
    messages.set(inputs.map(createEntry));
    // History is not news. A conversation opens at its end, showing the newest
    // message with nothing unread, which is also what switching conversation
    // has to reset to.
    unread.set(0);
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
    options.onSend?.(text);
    return text;
  };

  return {
    messages: () => messages.get(),
    rendered,

    add,
    append,
    finish,
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
  };
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
 * By tag name rather than by `instanceof`, as the other primitives test it:
 * the constructor is a browser global with nothing behind it on a server, and
 * a guard that throws there would take the whole render with it.
 */
function isTextControl(el: unknown): el is HTMLTextAreaElement | HTMLInputElement {
  const tag = (el as Element | null | undefined)?.tagName;
  return tag === 'TEXTAREA' || tag === 'INPUT';
}
