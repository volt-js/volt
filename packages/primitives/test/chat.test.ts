/**
 * Chat, driven through a real mounted component.
 *
 * Three things here are worth testing and the rest is scaffolding around them.
 *
 * *The scroll model*, because it is the part users notice when it is wrong and
 * never notice when it is right, and because every one of its cases is a
 * coincidence of two events — a message arriving while the reader happens to
 * be somewhere. Each case is set up explicitly rather than waited for.
 *
 * *Streaming*, where the claim is not that the text changes but that nothing
 * else does. So the assertions are about identity: the same elements, and the
 * same text node, before and after a token lands.
 *
 * *What is announced*, which is invisible on screen and silent when broken.
 *
 * `ResizeObserver` is replaced with one that delivers exactly the entries a
 * test asks it to, because happy-dom lays nothing out: a measurement that
 * cannot be scheduled cannot be tested, and every interesting scroll case here
 * is about a measurement landing at a particular moment.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compileTemplate } from '@voltdev/core/jit';
import { Component, Signal, flushSync, mount } from '@voltdev/core';
import { resetAnnouncer } from '../src/announcer.ts';
import { createChat, type Chat, type ChatMessageInput, type ChatOptions } from '../src/chat.ts';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface Measurement {
  target: Element;
  /** Height, in a horizontal writing mode. */
  block: number;
}

class FakeResizeObserver {
  static live: FakeResizeObserver[] = [];

  readonly targets = new Set<Element>();

  constructor(private readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.live.push(this);
  }

  observe(el: Element): void {
    this.targets.add(el);
  }

  unobserve(el: Element): void {
    this.targets.delete(el);
  }

  disconnect(): void {
    this.targets.clear();
  }

  deliver(measurements: Measurement[]): void {
    const entries = measurements.map(({ target, block }) => {
      const box: ResizeObserverSize = { blockSize: block, inlineSize: 0 };
      return {
        target,
        borderBoxSize: [box],
        contentBoxSize: [box],
        devicePixelContentBoxSize: [box],
      } as unknown as ResizeObserverEntry;
    });
    this.callback(entries, this as unknown as ResizeObserver);
    flushSync();
  }
}

let host: HTMLElement;
let mounted: { unmount(): void }[] = [];
let restores: (() => void)[] = [];
let selectors = 0;
let sent: string[] = [];
let pinChanges: boolean[] = [];

/** Options for the chat the next `mountChat` will build. */
let chatOptions: Omit<ChatOptions<string>, 'scroller' | 'container' | 'composer'>;

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  host = document.querySelector('#app')!;

  FakeResizeObserver.live = [];
  const view = window as unknown as { ResizeObserver: unknown };
  const original = view.ResizeObserver;
  view.ResizeObserver = FakeResizeObserver;
  restores.push(() => {
    view.ResizeObserver = original;
  });

  sent = [];
  pinChanges = [];
  chatOptions = {
    itemSize: 20,
    onSend: (text) => sent.push(text),
    onPinnedChange: (next) => pinChanges.push(next),
  };
});

afterEach(() => {
  for (const handle of mounted) handle.unmount();
  mounted = [];
  flushSync();
  resetAnnouncer();
  for (let i = restores.length - 1; i >= 0; i--) restores[i]!();
  restores = [];
});

const TEMPLATE = `
  <div class="room">
    <div class="log" :ref="scroller" :spread="chat.logProps()" :keydown="onKey($event)">
      <div class="sizer" :spread="chat.sizerProps()">
        <div class="box" :ref="box" :spread="chat.containerProps()">
          <div class="msg" :for="row in chat.rendered()" :key="row.id"
               :spread="chat.messageProps(row)">
            <span class="name" :if="row.startsGroup">{ row.message.name }</span>
            <span class="body">{ row.message.text() }</span>
          </div>
        </div>
      </div>
    </div>
    <button class="jump" :if="chat.showJumpToLatest()" :spread="chat.jumpToLatestProps()"
            :click="chat.jumpToLatest()">{ chat.unreadCount() }</button>
    <textarea class="composer" :ref="composer" :spread="chat.composerProps()"
              :input="chat.onComposerInput($event)" :keydown="onComposerKey($event)"></textarea>
  </div>
`;

interface ChatInstance {
  chat: Chat<string>;
  /** What the composer's handler returned for the last key it saw. */
  composerHandled: boolean;
}

interface Room {
  chat: Chat<string>;
  instance: ChatInstance;
  handle: { unmount(): void };
  observer: FakeResizeObserver;
  scroller: HTMLElement;
  composer: HTMLTextAreaElement;
  jump(): HTMLButtonElement | null;
  rows(): HTMLElement[];
  bodies(): HTMLElement[];
  row(index: number): HTMLElement | null;
}

/**
 * A message from `author`, numbered so its text is recognisable.
 *
 * Timestamps step by a second so that a `groupWithin` test has something to
 * work with, and so no two messages share an instant by accident.
 */
function say(index: number, author: string, text?: string): ChatMessageInput<string> {
  return {
    id: `m${index}`,
    author,
    name: author === 'ada' ? 'Ada' : 'Ben',
    text: text ?? `message ${index}`,
    timestamp: 1000 + index * 1000,
  };
}

function transcript(count: number, author: (index: number) => string = () => 'ada') {
  return Array.from({ length: count }, (_, index) => say(index, author(index)));
}

/**
 * Mount a chat whose scroller has a known client box.
 *
 * The box is stubbed between mounting and the first measurement, because that
 * is the only way a size reaches the virtualizer here — and it is the real
 * one: in a browser the size arrives through the observer after layout too.
 */
function mountChat({
  height = 100,
  messages = [] as readonly ChatMessageInput<string>[],
} = {}): Room {
  @Component({ selector: `v-chat-${++selectors}`, render: compileTemplate(TEMPLATE) })
  class ChatComponent {
    scroller = new Signal.State<Element | null>(null);
    box = new Signal.State<Element | null>(null);
    composer = new Signal.State<Element | null>(null);
    composerHandled = false;
    chat = createChat<string>({
      ...chatOptions,
      scroller: () => this.scroller.get(),
      container: () => this.box.get(),
      composer: () => this.composer.get(),
    });

    onKey(event: KeyboardEvent): void {
      if (this.chat.onKeyDown(event)) event.preventDefault();
    }

    onComposerKey(event: KeyboardEvent): void {
      this.composerHandled = this.chat.onComposerKeyDown(event);
      if (this.composerHandled) event.preventDefault();
    }
  }

  const handle = mount(ChatComponent, host);
  mounted.push(handle);

  const scroller = host.querySelector<HTMLElement>('.log')!;
  Object.defineProperty(scroller, 'clientHeight', { value: height, configurable: true });
  Object.defineProperty(scroller, 'clientWidth', { value: 0, configurable: true });

  const observer = FakeResizeObserver.live.at(-1)!;
  observer.deliver([{ target: scroller, block: height }]);

  const instance = handle.instance as ChatInstance;
  if (messages.length > 0) {
    instance.chat.setMessages(messages);
    flushSync();
  }

  return {
    handle,
    instance,
    chat: instance.chat,
    observer,
    scroller,
    composer: host.querySelector<HTMLTextAreaElement>('.composer')!,
    jump: () => host.querySelector<HTMLButtonElement>('.jump'),
    rows: () => [...host.querySelectorAll<HTMLElement>('.msg')],
    bodies: () => [...host.querySelectorAll<HTMLElement>('.body')],
    row: (index) => host.querySelector<HTMLElement>(`[aria-posinset="${index + 1}"]`),
  };
}

/** A scroll the reader performed. happy-dom fires no event of its own. */
function userScroll(room: Room, offset: number): void {
  room.scroller.scrollTop = offset;
  room.scroller.dispatchEvent(new Event('scroll'));
  flushSync();
}

/** The measurement of a rendered message landing, as the observer would. */
function measure(room: Room, index: number, height: number): void {
  const el = room.row(index);
  if (!el) throw new Error(`message ${index} is not rendered`);
  Object.defineProperty(el, 'checkVisibility', { value: () => true, configurable: true });
  room.observer.deliver([{ target: el, block: height }]);
}

function press(el: HTMLElement, key: string, modifiers: Partial<KeyboardEventInit> = {}): void {
  el.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers }),
  );
  flushSync();
}

function type(room: Room, text: string): void {
  room.composer.value = text;
  room.composer.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

// ---------------------------------------------------------------------------
// The message list
// ---------------------------------------------------------------------------

describe('the message list', () => {
  it('renders a window of the transcript rather than all of it', () => {
    const room = mountChat({ messages: transcript(500) });

    // Five messages fit in the viewport, plus two of overscan each way.
    expect(room.rows().length).toBeLessThan(12);
    expect(room.chat.messages()).toHaveLength(500);
  });

  it('counts the whole transcript for assistive technology, not the window', () => {
    const room = mountChat({ messages: transcript(500) });
    const first = room.rows()[0]!;

    // Virtualization is invisible to a sighted reader and a lie to everyone
    // else unless the real numbers are put back by hand.
    expect(first.getAttribute('aria-setsize')).toBe('500');
    expect(Number(first.getAttribute('aria-posinset'))).toBeGreaterThan(1);
    expect(first.getAttribute('role')).toBe('article');
  });

  it('names each message by its author, and carries whatever the consumer attached', () => {
    const room = mountChat();
    room.chat.setMessages([{ ...say(0, 'ada'), data: 'delivered' }]);
    flushSync();

    expect(room.rows()[0]!.getAttribute('aria-label')).toBe('Ada');
    expect(room.chat.messages()[0]!.data).toBe('delivered');
  });

  it('groups consecutive messages from one author', () => {
    const room = mountChat({
      messages: [say(0, 'ada'), say(1, 'ada'), say(2, 'ben')],
    });

    const rows = room.chat.rendered();
    expect(rows.map((row) => row.startsGroup)).toEqual([true, false, true]);
    expect(rows.map((row) => row.endsGroup)).toEqual([false, true, true]);

    // The name is rendered once per run, which is the whole point of grouping.
    expect([...host.querySelectorAll('.name')].map((el) => el.textContent)).toEqual([
      'Ada',
      'Ben',
    ]);
  });

  it('groups as a view, so a message arriving mid-run re-groups both sides of itself', () => {
    const room = mountChat({ messages: [say(0, 'ada'), say(1, 'ben')] });
    expect(room.chat.rendered().map((row) => row.startsGroup)).toEqual([true, true]);

    // The same message objects, seen differently: nothing was written onto
    // them, so the run before and the run after both change for free.
    const before = room.chat.messages();
    room.chat.add(say(2, 'ben'));
    flushSync();

    expect(room.chat.messages()[0]).toBe(before[0]);
    expect(room.chat.messages()[1]).toBe(before[1]);
    expect(room.chat.rendered().map((row) => row.startsGroup)).toEqual([true, true, false]);
    expect(room.chat.rendered().map((row) => row.endsGroup)).toEqual([true, false, true]);
  });

  it('breaks a run when too long passed between two messages', () => {
    chatOptions = { ...chatOptions, groupWithin: 1500 };
    const room = mountChat({
      messages: [
        { ...say(0, 'ada'), timestamp: 0 },
        { ...say(1, 'ada'), timestamp: 1000 },
        { ...say(2, 'ada'), timestamp: 9000 },
      ],
    });

    expect(room.chat.rendered().map((row) => row.startsGroup)).toEqual([true, false, true]);
  });

  it('marks the run in the DOM, so styling never has to recompute it', () => {
    const room = mountChat({ messages: [say(0, 'ada'), say(1, 'ada')] });
    const [first, second] = room.rows();

    expect(first!.hasAttribute('data-group-start')).toBe(true);
    expect(first!.hasAttribute('data-group-end')).toBe(false);
    expect(second!.hasAttribute('data-group-start')).toBe(false);
    expect(second!.hasAttribute('data-group-end')).toBe(true);
  });

  it('measures messages rather than trusting the estimate, so heights can vary', () => {
    const room = mountChat({ messages: transcript(10) });
    const sizer = host.querySelector<HTMLElement>('.sizer')!;
    // At the top, so that following the end does not move under the assertion.
    userScroll(room, 0);

    // Ten messages at the 20px estimate.
    expect(sizer.style.height).toBe('200px');
    expect(room.chat.rendered()[0]!.index).toBe(0);

    // The first is four lines rather than one. Everything after it moves, and
    // the scrollbar has to tell the truth about the new total.
    measure(room, 0, 80);
    expect(sizer.style.height).toBe('260px');
  });
});

// ---------------------------------------------------------------------------
// Scroll behaviour
// ---------------------------------------------------------------------------

describe('staying at the bottom', () => {
  it('opens at the newest message', () => {
    const room = mountChat({ messages: transcript(10) });

    // Ten messages of 20px in a 100px viewport: the end is 100px down.
    expect(room.scroller.scrollTop).toBe(100);
    expect(room.chat.isPinned()).toBe(true);
    expect(room.chat.isAtBottom()).toBe(true);
  });

  it('follows a message that arrives while pinned', () => {
    const room = mountChat({ messages: transcript(10) });

    room.chat.add(say(10, 'ben'));
    flushSync();

    expect(room.scroller.scrollTop).toBe(120);
    expect(room.chat.unreadCount()).toBe(0);
  });

  it('keeps up as the newest message turns out to be taller than the estimate', () => {
    const room = mountChat({ messages: transcript(10) });
    room.chat.add(say(10, 'ben'));
    flushSync();

    // The estimate said 20 and the message is 120: half of it would be below
    // the fold if the pin were keyed on the number of messages rather than on
    // how tall the transcript is.
    measure(room, 10, 120);
    expect(room.scroller.scrollTop).toBe(220);
  });

  it('releases the moment the reader scrolls up, and stops following', () => {
    const room = mountChat({ messages: transcript(10) });

    userScroll(room, 0);
    expect(room.chat.isPinned()).toBe(false);
    expect(pinChanges).toEqual([false]);

    room.chat.add(say(10, 'ben'));
    flushSync();

    // Content was added below the viewport, so nothing the reader is looking
    // at moved — and nothing dragged them to the end.
    expect(room.scroller.scrollTop).toBe(0);
  });

  it('allows a little slack, because a scroll rarely lands on the pixel', () => {
    const room = mountChat({ messages: transcript(10) });

    // 20px short of the end, inside the 32px threshold.
    userScroll(room, 80);
    expect(room.chat.isPinned()).toBe(true);

    userScroll(room, 60);
    expect(room.chat.isPinned()).toBe(false);
  });

  it('counts what arrived unseen, and says the count in the affordance name', () => {
    const room = mountChat({ messages: transcript(10) });
    userScroll(room, 0);

    expect(room.jump()).not.toBeNull();
    expect(room.jump()!.getAttribute('aria-label')).toBe('Jump to latest');

    room.chat.add(say(10, 'ben'));
    room.chat.add(say(11, 'ben'));
    flushSync();

    expect(room.chat.unreadCount()).toBe(2);
    expect(room.jump()!.getAttribute('aria-label')).toBe('2 new messages');
    expect(room.jump()!.textContent).toBe('2');
  });

  it('re-pins and clears the count when the reader scrolls back down by hand', () => {
    const room = mountChat({ messages: transcript(10) });
    userScroll(room, 0);
    room.chat.add(say(10, 'ben'));
    flushSync();
    expect(room.chat.unreadCount()).toBe(1);

    // Eleven messages of 20 in a 100 viewport: the end is 120 down.
    userScroll(room, 120);

    expect(room.chat.isPinned()).toBe(true);
    expect(room.chat.unreadCount()).toBe(0);
    expect(room.jump()).toBeNull();
    expect(pinChanges).toEqual([false, true]);
  });

  it('goes to the end when the affordance is pressed', () => {
    const room = mountChat({ messages: transcript(10) });
    userScroll(room, 0);
    room.chat.add(say(10, 'ben'));
    flushSync();

    room.jump()!.click();
    flushSync();

    expect(room.scroller.scrollTop).toBe(120);
    expect(room.chat.isPinned()).toBe(true);
    expect(room.chat.unreadCount()).toBe(0);
    expect(room.jump()).toBeNull();
  });

  it('holds the reader still when content above them grows', () => {
    const room = mountChat({ messages: transcript(100) });
    userScroll(room, 400);
    expect(room.chat.isPinned()).toBe(false);

    // Message 18 is rendered above the viewport, and turns out to be three
    // times the estimate. Everything below it — including what is on screen —
    // would slide down by 40px if nothing compensated.
    measure(room, 18, 60);

    expect(room.scroller.scrollTop).toBe(440);
    // The distance to the end is what it was, so the pin has not changed and
    // nothing was dragged to the bottom.
    expect(room.chat.isPinned()).toBe(false);
    expect(room.chat.isAtBottom()).toBe(false);
  });

  it('stays at the end when content above it grows while pinned', () => {
    const room = mountChat({ messages: transcript(10) });
    expect(room.scroller.scrollTop).toBe(100);

    // Message 3 is above the fold at this point, and doubles in height.
    measure(room, 3, 40);

    // 220 of transcript in a 100 viewport.
    expect(room.scroller.scrollTop).toBe(120);
    expect(room.chat.isAtBottom()).toBe(true);
  });

  it('does not report the pin changing when it did not', () => {
    const room = mountChat({ messages: transcript(10) });

    userScroll(room, 100);
    userScroll(room, 95);
    room.chat.add(say(10, 'ben'));
    flushSync();

    expect(pinChanges).toEqual([]);
  });

  it('scrolls from the keyboard, since a region that cannot be focused cannot', () => {
    const room = mountChat({ messages: transcript(100) });
    expect(room.scroller.getAttribute('tabindex')).toBe('0');

    press(room.scroller, 'Home');
    expect(room.scroller.scrollTop).toBe(0);
    expect(room.chat.isPinned()).toBe(false);

    press(room.scroller, 'End');
    expect(room.scroller.scrollTop).toBe(1900);
  });

  it('opens a new conversation at its end, with nothing unread', () => {
    const room = mountChat({ messages: transcript(10) });
    userScroll(room, 0);
    room.chat.add(say(10, 'ben'));
    flushSync();
    expect(room.chat.unreadCount()).toBe(1);

    room.chat.setMessages(transcript(4));
    flushSync();

    expect(room.chat.messages()).toHaveLength(4);
    expect(room.chat.unreadCount()).toBe(0);
    expect(room.chat.isPinned()).toBe(true);
    // Four messages of 20 do not fill a 100 viewport, so the end is the top.
    expect(room.scroller.scrollTop).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Streaming
// ---------------------------------------------------------------------------

describe('streaming', () => {
  it('writes one text node per token, and re-renders nothing', () => {
    const room = mountChat({ messages: transcript(3) });
    const message = room.chat.add({ id: 'live', author: 'ben', name: 'Ben', streaming: true });
    flushSync();

    const rowsBefore = room.rows();
    const body = room.bodies().at(-1)!;
    const listBefore = room.chat.messages();

    room.chat.append('live', 'Hel');
    flushSync();
    // Captured after the first token rather than before it: a message with no
    // text has no text node to patch, and the claim being made is about the
    // tokens after the first, which is every token of a real stream.
    const textNode = body.firstChild;
    expect(textNode).toBeInstanceOf(Text);

    room.chat.append('live', 'lo');
    flushSync();

    // The text arrived...
    expect(body.textContent).toBe('Hello');
    // ...into the very same text node, which is only possible if the binding
    // subscribed to the message's own signal.
    expect(body.firstChild).toBe(textNode);
    // ...and nothing above it was touched: same elements, in the same order.
    expect(room.rows()).toEqual(rowsBefore);
    for (const [index, row] of room.rows().entries()) expect(row).toBe(rowsBefore[index]);
    // ...because the transcript itself never changed. A list that fires is a
    // list that re-runs, whatever the reconciler does about it afterwards.
    expect(room.chat.messages()).toBe(listBefore);
    expect(message.text()).toBe('Hello');
  });

  it('holds the scroll position while a message streams under the reader', () => {
    const room = mountChat({ messages: transcript(20) });
    userScroll(room, 0);
    room.chat.add({ id: 'live', author: 'ben', name: 'Ben', streaming: true });
    flushSync();

    for (const token of ['one ', 'two ', 'three']) {
      room.chat.append('live', token);
      flushSync();
    }

    expect(room.scroller.scrollTop).toBe(0);
  });

  it('follows a message that grows while pinned', () => {
    const room = mountChat({ messages: transcript(10) });
    room.chat.add({ id: 'live', author: 'ben', name: 'Ben', streaming: true });
    flushSync();
    expect(room.scroller.scrollTop).toBe(120);

    // Tokens land, the browser re-lays the message out, and its measurement
    // arrives taller each time. The view has to keep up with each one.
    room.chat.append('live', 'a paragraph of it');
    flushSync();
    measure(room, 10, 60);
    expect(room.scroller.scrollTop).toBe(160);

    room.chat.append('live', ' and another');
    flushSync();
    measure(room, 10, 100);
    expect(room.scroller.scrollTop).toBe(200);
  });

  it('marks the streaming message, and unmarks it when it finishes', () => {
    const room = mountChat({ messages: transcript(1) });
    const message = room.chat.add({ id: 'live', author: 'ben', streaming: true });
    flushSync();

    expect(room.rows().at(-1)!.hasAttribute('data-streaming')).toBe(true);

    room.chat.finish('live');
    flushSync();

    expect(message.streaming()).toBe(false);
    expect(room.rows().at(-1)!.hasAttribute('data-streaming')).toBe(false);
  });

  it('ignores tokens for a message that is not there, and empty ones', () => {
    const room = mountChat({ messages: transcript(1) });
    room.chat.append('nobody', 'hello');
    room.chat.append('m0', '');
    flushSync();

    expect(room.chat.messages()[0]!.text()).toBe('message 0');
  });
});

// ---------------------------------------------------------------------------
// The composer
// ---------------------------------------------------------------------------

describe('the composer', () => {
  it('asks the browser to size itself to its content', () => {
    chatOptions = { ...chatOptions, rows: 2, maxRows: 8 };
    const room = mountChat();

    expect(room.composer.style.getPropertyValue('field-sizing')).toBe('content');
    expect(room.composer.style.getPropertyValue('min-height')).toBe('2lh');
    expect(room.composer.style.getPropertyValue('max-height')).toBe('8lh');
    expect(room.composer.getAttribute('rows')).toBe('2');
  });

  it('grows without a ceiling when none was asked for', () => {
    const room = mountChat();
    expect(room.composer.style.getPropertyValue('max-height')).toBe('');
  });

  it('sends on Enter, and empties itself', () => {
    const room = mountChat();
    type(room, 'hello there');
    expect(room.chat.canSend()).toBe(true);

    press(room.composer, 'Enter');

    expect(sent).toEqual(['hello there']);
    expect(room.chat.draft()).toBe('');
    expect(room.composer.value).toBe('');
    expect(room.instance.composerHandled).toBe(true);
  });

  it('leaves Shift+Enter alone, so it inserts a newline', () => {
    const room = mountChat();
    type(room, 'first line');

    press(room.composer, 'Enter', { shiftKey: true });

    expect(sent).toEqual([]);
    expect(room.chat.draft()).toBe('first line');
    expect(room.instance.composerHandled).toBe(false);
  });

  it('does not send the Enter that commits an IME candidate', () => {
    const room = mountChat();
    type(room, 'にほんご');

    press(room.composer, 'Enter', { isComposing: true } as Partial<KeyboardEventInit>);

    expect(sent).toEqual([]);
    expect(room.chat.draft()).toBe('にほんご');
  });

  it('leaves a modified Enter to whatever the application bound it to', () => {
    const room = mountChat();
    type(room, 'hello');

    press(room.composer, 'Enter', { metaKey: true });

    expect(sent).toEqual([]);
    expect(room.instance.composerHandled).toBe(false);
  });

  it('sends nothing but eats the key when there is only whitespace', () => {
    const room = mountChat();
    type(room, '   ');
    expect(room.chat.canSend()).toBe(false);

    press(room.composer, 'Enter');

    expect(sent).toEqual([]);
    // Consumed anyway: an empty composer must not grow a blank line because
    // somebody pressed send.
    expect(room.instance.composerHandled).toBe(true);
  });

  it('writes the box when the draft is set from outside typing', () => {
    const room = mountChat();
    room.chat.setDraft('a reply');
    flushSync();

    expect(room.composer.value).toBe('a reply');
    expect(room.chat.send()).toBe('a reply');
    expect(sent).toEqual(['a reply']);
  });
});

// ---------------------------------------------------------------------------
// What a screen reader hears
// ---------------------------------------------------------------------------

describe('announcements', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** What the shared polite region is holding. */
  function spoken(): string {
    return [...document.querySelectorAll("[data-volt-announcer='polite']")]
      .map((region) => region.textContent ?? '')
      .join('')
      .trim();
  }

  function assertiveRegions(): number {
    return document.querySelectorAll("[data-volt-announcer='assertive']").length;
  }

  it('says an arriving message politely', () => {
    const room = mountChat({ messages: transcript(2) });
    room.chat.add(say(2, 'ben', 'are you there'));
    flushSync();
    vi.advanceTimersByTime(50);

    expect(spoken()).toBe('Ben: are you there');
    // Never assertive. Interrupting whatever is being read every time somebody
    // types is worse than saying nothing at all.
    expect(assertiveRegions()).toBe(0);
  });

  it('says a streamed message once, when it is finished, not once per token', () => {
    const room = mountChat({ messages: transcript(1) });
    room.chat.add({ id: 'live', author: 'ben', name: 'Ben', streaming: true });
    flushSync();
    vi.advanceTimersByTime(50);
    expect(spoken()).toBe('');

    for (const token of ['half ', 'a ', 'sentence']) {
      room.chat.append('live', token);
      flushSync();
      vi.advanceTimersByTime(50);
      expect(spoken()).toBe('');
    }

    room.chat.finish('live');
    vi.advanceTimersByTime(50);
    expect(spoken()).toBe('Ben: half a sentence');
  });

  it('says nothing about history that was loaded rather than sent', () => {
    const room = mountChat();
    room.chat.setMessages(transcript(20));
    flushSync();
    vi.advanceTimersByTime(50);

    expect(spoken()).toBe('');
  });

  it('mounts no live region of its own, and keeps the transcript from being one', () => {
    const room = mountChat({ messages: transcript(3) });
    room.chat.add(say(3, 'ben'));
    flushSync();
    vi.advanceTimersByTime(50);

    expect(room.scroller.getAttribute('role')).toBe('log');
    // `log` implies `aria-live: polite`, and under virtualization that would
    // read out every message the reader scrolls past.
    expect(room.scroller.getAttribute('aria-live')).toBe('off');
    expect(document.querySelectorAll("[data-volt-announcer='polite']")).toHaveLength(1);
  });

  it('stays silent when the consumer says so', () => {
    chatOptions = { ...chatOptions, announceMessages: false };
    const room = mountChat({ messages: transcript(1) });
    room.chat.add(say(1, 'ben'));
    flushSync();
    vi.advanceTimersByTime(50);

    expect(spoken()).toBe('');
  });

});
