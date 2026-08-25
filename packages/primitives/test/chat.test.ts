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
import {
  createChat,
  type Chat,
  type ChatMessage,
  type ChatMessageInput,
  type ChatOptions,
} from '../src/chat.ts';

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
let resent: string[] = [];
let asked: string[] = [];

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
  resent = [];
  asked = [];
  chatOptions = {
    itemSize: 20,
    onSend: (text) => sent.push(text),
    onPinnedChange: (next) => pinChanges.push(next),
    onResend: (message, text) => resent.push(`${message.id}:${text}`),
    onRegenerate: (message) => asked.push(`regenerate:${message.id}`),
    onRetry: (message) => asked.push(`retry:${message.id}`),
    onCancel: (message) => asked.push(`cancel:${message.id}`),
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
            <span class="state">{ chat.statusText(row.message) }</span>
            <div class="part" :for="part in row.message.parts()" :key="part.id"
                 :spread="chat.partProps(part)">
              <button class="fold" :if="part.kind === 'reasoning'"
                      :spread="chat.partToggleProps(part)" :click="part.toggle()">fold</button>
              <button class="copy-code" :if="part.kind === 'code'"
                      :spread="chat.partCopyProps(part)" :click="chat.copyPart(part)">copy</button>
              <span class="part-body" :spread="chat.partContentProps(part)">{ part.text() }</span>
            </div>
            <div class="actions" :spread="chat.actionsProps(row.message)"
                 :keydown="onActionKey(row.message, $event)">
              <button class="action" :for="action in chat.actionsFor(row.message)" :key="action"
                      :spread="chat.actionProps(row.message, action)"
                      :click="chat.activate(row.message, action)">{ action }</button>
            </div>
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
  /** The same, for the last key an action group saw. */
  actionHandled: boolean;
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
    actionHandled = false;
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

    onActionKey(message: ChatMessage<string>, event: KeyboardEvent): void {
      this.actionHandled = this.chat.onActionKeyDown(message, event);
      if (this.actionHandled) event.preventDefault();
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

/** The buttons in one message's action group, in the order they are offered. */
function actionsOf(room: Room, index: number): HTMLButtonElement[] {
  const el = room.row(index);
  if (!el) throw new Error(`message ${index} is not rendered`);
  return [...el.querySelectorAll<HTMLButtonElement>('.action')];
}

function actionIn(room: Room, index: number, name: string): HTMLButtonElement {
  const el = actionsOf(room, index).find((button) => button.dataset.chatAction === name);
  if (!el) throw new Error(`message ${index} does not offer ${name}`);
  return el;
}

/** Which action of a message holds the group's single tab stop. */
function tabStop(room: Room, index: number): string[] {
  return actionsOf(room, index)
    .filter((button) => button.getAttribute('tabindex') === '0')
    .map((button) => button.dataset.chatAction ?? '');
}

function partsOf(room: Room, index: number): HTMLElement[] {
  const el = room.row(index);
  if (!el) throw new Error(`message ${index} is not rendered`);
  return [...el.querySelectorAll<HTMLElement>('.part')];
}

/** A clipboard that records rather than one the environment refuses to give. */
function stubClipboard(): string[] {
  const written: string[] = [];
  const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: (text: string) => {
        written.push(text);
        return Promise.resolve();
      },
    },
  });
  restores.push(() => {
    if (original) Object.defineProperty(navigator, 'clipboard', original);
    else Reflect.deleteProperty(navigator, 'clipboard');
  });
  return written;
}

/** Let a copy's promise resolve, and let the DOM catch up with it. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
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

// ---------------------------------------------------------------------------
// What a message can do with itself
// ---------------------------------------------------------------------------

describe('per-message actions', () => {
  it('offers what the message is in a position to do, and nothing else', () => {
    chatOptions = { ...chatOptions, self: 'ada' };
    const room = mountChat({ messages: [say(0, 'ada'), say(1, 'ben')] });
    const [mine, theirs] = room.chat.messages();

    // You resend your own words and ask for somebody else's again. That is the
    // whole of the difference, and it is the only thing `self` is read for.
    expect(room.chat.actionsFor(mine!)).toEqual(['copy', 'edit']);
    expect(room.chat.actionsFor(theirs!)).toEqual(['copy', 'regenerate']);

    room.chat.add({ id: 'live', author: 'ben', name: 'Ben', streaming: true });
    flushSync();
    // Nothing to copy from a reply that has not arrived; one thing to do.
    expect(room.chat.actionsFor(room.chat.messages().at(-1)!)).toEqual(['cancel']);

    room.chat.fail('m1', 'rate limited');
    flushSync();
    expect(room.chat.actionsFor(theirs!)).toEqual(['retry', 'copy']);
  });

  it('offers copy alone when it has not been told whose keyboard this is', () => {
    const room = mountChat({ messages: [say(0, 'ada')] });

    // Edit-and-resend means nothing without knowing which messages are yours,
    // and guessing is worse than not offering it.
    expect(room.chat.actionsFor(room.chat.messages()[0]!)).toEqual(['copy']);
  });

  it('gives a message one tab stop for all of its actions, not one each', () => {
    chatOptions = { ...chatOptions, actions: () => ['copy', 'edit', 'regenerate', 'retry'] };
    const room = mountChat({ messages: [say(0, 'ada')] });

    expect(actionsOf(room, 0)).toHaveLength(4);
    // Four buttons behind one Tab press. Four tab stops per message is a
    // transcript nobody can get past from the keyboard.
    expect(actionsOf(room, 0).map((el) => el.getAttribute('tabindex'))).toEqual([
      '0',
      '-1',
      '-1',
      '-1',
    ]);
  });

  it('moves the tab stop and the focus with the arrow keys, wrapping at the ends', () => {
    chatOptions = { ...chatOptions, actions: () => ['copy', 'edit', 'regenerate'] };
    const room = mountChat({ messages: [say(0, 'ada')] });
    const copy = actionIn(room, 0, 'copy');
    copy.focus();

    press(copy, 'ArrowRight');
    expect(tabStop(room, 0)).toEqual(['edit']);
    expect(document.activeElement).toBe(actionIn(room, 0, 'edit'));
    expect(room.instance.actionHandled).toBe(true);

    press(actionIn(room, 0, 'edit'), 'End');
    expect(document.activeElement).toBe(actionIn(room, 0, 'regenerate'));

    // Past the end and round, which is what every other roving group here does.
    press(actionIn(room, 0, 'regenerate'), 'ArrowRight');
    expect(tabStop(room, 0)).toEqual(['copy']);
    expect(document.activeElement).toBe(copy);

    press(copy, 'ArrowLeft');
    expect(document.activeElement).toBe(actionIn(room, 0, 'regenerate'));

    press(actionIn(room, 0, 'regenerate'), 'Home');
    expect(document.activeElement).toBe(copy);
  });

  it('swaps the arrows under a right-to-left writing direction', () => {
    chatOptions = { ...chatOptions, actions: () => ['copy', 'edit', 'regenerate'] };
    const room = mountChat({ messages: [say(0, 'ada')] });
    host.querySelector('.room')!.setAttribute('dir', 'rtl');
    const copy = actionIn(room, 0, 'copy');
    copy.focus();

    // Right is backwards here, so it wraps to the last action rather than
    // stepping to the second.
    press(copy, 'ArrowRight');
    expect(document.activeElement).toBe(actionIn(room, 0, 'regenerate'));

    press(actionIn(room, 0, 'regenerate'), 'ArrowLeft');
    expect(document.activeElement).toBe(copy);
  });

  it('keeps the reader on the same action as they move between messages', () => {
    chatOptions = { ...chatOptions, self: 'ada' };
    const room = mountChat({ messages: [say(0, 'ada'), say(1, 'ada'), say(2, 'ben')] });
    press(actionIn(room, 0, 'copy'), 'ArrowRight');

    // The second message offers the same actions, so Tab lands on the column
    // the reader was already in rather than back at the start of the row.
    expect(tabStop(room, 1)).toEqual(['edit']);
    // The third does not offer it, so it falls back to its own first action —
    // which is what keeps every group at exactly one tab stop.
    expect(tabStop(room, 2)).toEqual(['copy']);
  });

  it('leaves Enter and Space to the button under them', () => {
    chatOptions = { ...chatOptions, actions: () => ['copy', 'edit'] };
    const room = mountChat({ messages: [say(0, 'ada')] });

    press(actionIn(room, 0, 'copy'), 'Enter');
    expect(room.instance.actionHandled).toBe(false);
    press(actionIn(room, 0, 'copy'), ' ');
    expect(room.instance.actionHandled).toBe(false);
    // The tab stop did not move either: neither key is navigation.
    expect(tabStop(room, 0)).toEqual(['copy']);
  });

  it('copies a message, and marks only that message copied', async () => {
    const written = stubClipboard();
    const room = mountChat({ messages: [say(0, 'ada'), say(1, 'ada')] });

    actionIn(room, 0, 'copy').click();
    await settle();

    expect(written).toEqual(['message 0']);
    expect(actionIn(room, 0, 'copy').dataset.state).toBe('copied');
    // Two messages copied in turn must not both look copied. There is one
    // clipboard, and only one button can be telling the truth about it.
    expect(actionIn(room, 1, 'copy').dataset.state).toBe('idle');

    actionIn(room, 1, 'copy').click();
    await settle();

    expect(written).toEqual(['message 0', 'message 1']);
    expect(actionIn(room, 0, 'copy').dataset.state).toBe('idle');
    expect(actionIn(room, 1, 'copy').dataset.state).toBe('copied');
  });

  it('puts a message back in the composer, and resends it in place', () => {
    chatOptions = { ...chatOptions, self: 'ada' };
    const room = mountChat({ messages: [say(0, 'ada'), say(1, 'ben'), say(2, 'ada')] });

    actionIn(room, 0, 'edit').click();
    flushSync();

    expect(room.chat.editing()?.id).toBe('m0');
    expect(room.composer.value).toBe('message 0');
    // The caret goes where the editing happens, or the button has to be
    // followed by a Tab press nobody was told about.
    expect(document.activeElement).toBe(room.composer);

    type(room, 'what I meant');
    press(room.composer, 'Enter');

    // The message is the same message, with different words in it...
    expect(room.chat.messages().map((message) => message.id)).toEqual(['m0']);
    expect(room.chat.messages()[0]!.text()).toBe('what I meant');
    // ...and everything that was a reply to the old words is gone, because a
    // transcript that keeps them shows a conversation that never happened.
    expect(resent).toEqual(['m0:what I meant']);
    // Not also `onSend`: the transcript already holds this message.
    expect(sent).toEqual([]);
    expect(room.chat.editing()).toBe(null);
  });

  it('abandons an edit without touching the message', () => {
    chatOptions = { ...chatOptions, self: 'ada' };
    const room = mountChat({ messages: [say(0, 'ada'), say(1, 'ben')] });

    actionIn(room, 0, 'edit').click();
    flushSync();
    room.chat.cancelEdit();
    flushSync();

    expect(room.chat.editing()).toBe(null);
    expect(room.composer.value).toBe('');

    type(room, 'a new message');
    press(room.composer, 'Enter');

    // The next thing sent is a new message rather than a rewrite of the one
    // that was being edited, and the transcript kept its reply.
    expect(sent).toEqual(['a new message']);
    expect(resent).toEqual([]);
    expect(room.chat.messages().map((message) => message.text())).toEqual([
      'message 0',
      'message 1',
    ]);
  });

  it('forgets an edit when the conversation changes under it', () => {
    chatOptions = { ...chatOptions, self: 'ada' };
    const room = mountChat({ messages: [say(0, 'ada')] });
    room.chat.beginEdit('m0');
    flushSync();

    // The same id, because a conversation is reloaded far more often than it
    // is replaced — and an edit left standing would land on whichever message
    // came back wearing that id rather than on the words being edited.
    room.chat.setMessages([say(0, 'ada', 'a different history')]);
    flushSync();
    type(room, 'hello');
    press(room.composer, 'Enter');

    expect(room.chat.editing()).toBe(null);
    expect(sent).toEqual(['hello']);
    expect(resent).toEqual([]);
    expect(room.chat.messages()[0]!.text()).toBe('a different history');
  });

  it('regenerates a reply by emptying it and waiting for another', () => {
    chatOptions = { ...chatOptions, self: 'ada' };
    const room = mountChat({ messages: [say(0, 'ada'), say(1, 'ben'), say(2, 'ada')] });

    actionIn(room, 1, 'regenerate').click();
    flushSync();

    expect(asked).toEqual(['regenerate:m1']);
    expect(room.chat.messages()[1]!.text()).toBe('');
    // Waiting, not idle: the reply has been asked for and none of it is here.
    expect(room.chat.messages()[1]!.status()).toBe('typing');
    // What followed was a reply to the answer that has just been thrown away.
    expect(room.chat.messages().map((message) => message.id)).toEqual(['m0', 'm1']);

    room.chat.append('m1', 'a better answer');
    flushSync();
    expect(room.chat.messages()[1]!.text()).toBe('a better answer');
  });

  it('retries a failed message, clearing the failure with it', () => {
    const room = mountChat({ messages: [say(0, 'ada')] });
    room.chat.fail('m0', 'rate limited');
    flushSync();

    expect(room.chat.messages()[0]!.status()).toBe('error');
    expect(room.chat.messages()[0]!.error()).toBe('rate limited');
    expect(room.row(0)!.getAttribute('data-status')).toBe('error');

    actionIn(room, 0, 'retry').click();
    flushSync();

    expect(asked).toEqual(['retry:m0']);
    expect(room.chat.messages()[0]!.status()).toBe('idle');
    expect(room.chat.messages()[0]!.error()).toBe('');
    expect(room.row(0)!.hasAttribute('data-status')).toBe(false);
  });

  it('stops a generation that is under way, once', () => {
    const room = mountChat({ messages: [say(0, 'ada')] });
    room.chat.add({ id: 'live', author: 'ben', name: 'Ben', streaming: true });
    flushSync();

    actionIn(room, 1, 'cancel').click();
    flushSync();

    expect(asked).toEqual(['cancel:live']);
    expect(room.chat.messages()[1]!.streaming()).toBe(false);
    expect(room.chat.messages()[1]!.status()).toBe('idle');

    // Nothing is generating any more, so there is nothing left to stop.
    room.chat.cancel('live');
    expect(asked).toEqual(['cancel:live']);
  });
});

// ---------------------------------------------------------------------------
// What a message is doing
// ---------------------------------------------------------------------------

describe('message states', () => {
  it('shows a reply on its way before there is a token of it', () => {
    const room = mountChat({ messages: [say(0, 'ada')] });
    room.chat.add({ id: 'live', author: 'ben', name: 'Ben', typing: true });
    flushSync();

    const message = room.chat.messages().at(-1)!;
    expect(message.status()).toBe('typing');
    expect(room.chat.statusText(message)).toBe('Ben is typing');
    // Read from the message, so a consumer never has a second thing to switch
    // off — and never the indicator that stays up after the reply arrived.
    expect(room.row(1)!.getAttribute('data-status')).toBe('typing');
    expect(host.querySelectorAll('.state')[1]!.textContent).toBe('Ben is typing');
  });

  it('turns the indicator into the reply the moment a token lands', () => {
    const room = mountChat({ messages: [say(0, 'ada')] });
    room.chat.add({ id: 'live', author: 'ben', name: 'Ben', typing: true });
    flushSync();

    room.chat.append('live', 'here');
    flushSync();

    const message = room.chat.messages().at(-1)!;
    expect(message.status()).toBe('streaming');
    expect(message.streaming()).toBe(true);
    expect(room.chat.statusText(message)).toBe('Ben is replying');
    expect(room.row(1)!.getAttribute('data-status')).toBe('streaming');

    room.chat.finish('live');
    flushSync();
    expect(message.status()).toBe('idle');
    expect(room.chat.statusText(message)).toBe('');
  });

  it('does not count a reply that has not arrived as something unread', () => {
    const room = mountChat({ messages: transcript(20) });
    userScroll(room, 0);
    expect(room.chat.isPinned()).toBe(false);

    room.chat.add({ id: 'live', author: 'ben', name: 'Ben', typing: true });
    flushSync();
    // The count is of things there are to read, and there is nothing to read.
    expect(room.chat.unreadCount()).toBe(0);

    room.chat.add(say(21, 'ben'));
    flushSync();
    expect(room.chat.unreadCount()).toBe(1);
  });

  it('does not let a finish quietly clear a failure', () => {
    const room = mountChat({ messages: [say(0, 'ada')] });
    room.chat.add({ id: 'live', author: 'ben', name: 'Ben', streaming: true });
    flushSync();
    room.chat.fail('live', 'the connection dropped');
    flushSync();

    room.chat.finish('live');
    flushSync();

    // A failed message is not a finished one. Clearing it here would take the
    // retry button away from a reader who never got their answer.
    const message = room.chat.messages().at(-1)!;
    expect(message.status()).toBe('error');
    expect(room.chat.statusText(message)).toBe('Ben: the connection dropped');
    expect(room.chat.actionsFor(message)).toEqual(['retry', 'copy']);
  });

  it('says what a message with no reason to give is failing at', () => {
    const room = mountChat({ messages: [say(0, 'ada')] });
    room.chat.fail('m0');
    flushSync();

    expect(room.chat.statusText(room.chat.messages()[0]!)).toBe(
      "Ada's message could not be sent",
    );
  });
});

// ---------------------------------------------------------------------------
// The shape of a message, which is not the same as its rendering
// ---------------------------------------------------------------------------

describe('the shape of a message', () => {
  it('gives a plain message one text part over the very same signal', () => {
    const room = mountChat({ messages: [say(0, 'ada', '')] });
    room.chat.append('m0', 'Hel');
    flushSync();

    const parts = room.chat.messages()[0]!.parts();
    expect(parts).toHaveLength(1);
    expect(parts[0]!.kind).toBe('text');

    const body = host.querySelector('.part-body')!;
    const textNode = body.firstChild;
    room.chat.append('m0', 'lo');
    flushSync();

    // The part is the message's own text signal rather than a copy of it, so
    // rendering parts costs a streamed token exactly what rendering `text()`
    // costs: one text node's data.
    expect(parts[0]!.text()).toBe('Hello');
    expect(body.firstChild).toBe(textNode);
    expect(body.textContent).toBe('Hello');
    // The same tokens, from the same signal, whichever of the two a template
    // asked for. Two strings kept in step would be one string too many.
    expect(room.chat.messages()[0]!.text()).toBe('Hello');
    expect(host.querySelector('.body')!.textContent).toBe('Hello');
    expect(room.chat.messages()[0]!.parts()[0]).toBe(parts[0]);
  });

  it('names a code block by its language, and lets the keyboard reach it', () => {
    const room = mountChat({
      messages: [
        {
          ...say(0, 'ben'),
          text: undefined,
          parts: [
            { text: 'like this' },
            { kind: 'code', language: 'ts', text: 'let x = 1' },
          ],
        },
      ],
    });

    const [prose, code] = partsOf(room, 0);
    expect(prose!.getAttribute('data-part')).toBe('text');
    expect(prose!.hasAttribute('role')).toBe(false);

    expect(code!.getAttribute('role')).toBe('group');
    // The language is the one thing about a code block a reader cannot get
    // from having its text read out to them.
    expect(code!.getAttribute('aria-label')).toBe('Code, ts');
    expect(code!.getAttribute('data-language')).toBe('ts');
    // A code block scrolls sideways, and a region that scrolls has to be
    // reachable without a mouse.
    expect(code!.querySelector('.part-body')!.getAttribute('tabindex')).toBe('0');
    expect(prose!.querySelector('.part-body')!.hasAttribute('tabindex')).toBe(false);
  });

  it('copies a code block without the prose around it', async () => {
    const written = stubClipboard();
    const room = mountChat({
      messages: [
        {
          ...say(0, 'ben'),
          text: undefined,
          parts: [
            { text: 'like this' },
            { kind: 'code', language: 'ts', text: 'let x = 1' },
          ],
        },
      ],
    });

    const button = room.row(0)!.querySelector<HTMLButtonElement>('.copy-code')!;
    expect(button.getAttribute('aria-label')).toBe('Copy code');
    expect(button.dataset.state).toBe('idle');

    button.click();
    await settle();

    // The block, and nothing but the block. Pasting the sentence that
    // introduced the code into an editor is not what the button offered.
    expect(written).toEqual(['let x = 1']);
    expect(button.dataset.state).toBe('copied');
    expect(actionIn(room, 0, 'copy').dataset.state).toBe('idle');
  });

  it('folds reasoning away, and says that it is folded', () => {
    const room = mountChat({
      messages: [
        {
          ...say(0, 'ben'),
          text: undefined,
          parts: [{ kind: 'reasoning', text: 'first I checked' }, { text: 'no' }],
        },
      ],
    });

    const reasoning = partsOf(room, 0)[0]!;
    const toggle = reasoning.querySelector<HTMLButtonElement>('.fold')!;
    const content = reasoning.querySelector<HTMLElement>('.part-body')!;

    expect(reasoning.getAttribute('aria-label')).toBe('Reasoning');
    expect(reasoning.getAttribute('data-state')).toBe('closed');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    // The control has to say what it controls, and the two ids have to agree
    // without either prop object holding state.
    expect(content.id).not.toBe('');
    expect(toggle.getAttribute('aria-controls')).toBe(content.id);
    expect(content.hasAttribute('hidden')).toBe(true);

    toggle.click();
    flushSync();

    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(reasoning.getAttribute('data-state')).toBe('open');
    expect(content.hasAttribute('hidden')).toBe(false);
  });

  it('leaves reasoning and citations out of what the message says', async () => {
    const written = stubClipboard();
    const room = mountChat({
      messages: [
        {
          ...say(0, 'ben'),
          text: undefined,
          parts: [
            { kind: 'reasoning', text: 'thinking out loud' },
            { text: 'yes' },
            { kind: 'quote', text: 'as it says' },
            { kind: 'source', href: 'https://example.test/a', title: 'A' },
          ],
        },
      ],
    });

    // Reasoning is how the answer was arrived at and is usually folded away
    // unread; a citation's body is a URL. Neither is what the reader asked to
    // put on their clipboard, or to have read out to them.
    expect(room.chat.messages()[0]!.text()).toBe('yes\n\nas it says');
    await room.chat.copyMessage('m0');
    expect(written).toEqual(['yes\n\nas it says']);
    expect(partsOf(room, 0)[2]!.getAttribute('role')).toBe('blockquote');
  });

  it('numbers citations within the message they belong to', () => {
    const room = mountChat({
      messages: [
        {
          ...say(0, 'ben'),
          text: undefined,
          parts: [
            { text: 'as two people put it' },
            { kind: 'source', href: 'https://example.test/a', title: 'Widgets' },
            { text: 'and' },
            { kind: 'source', href: 'https://example.test/b' },
          ],
        },
      ],
    });

    const sources = partsOf(room, 0).filter((el) => el.dataset.part === 'source');
    // On screen a citation is "[2]", which is read out as "2" or as nothing.
    expect(sources.map((el) => el.getAttribute('aria-label'))).toEqual([
      'Source 1: Widgets',
      'Source 2',
    ]);
    expect(sources[0]!.getAttribute('href')).toBe('https://example.test/a');
  });

  it('streams into the last part the consumer opened', () => {
    const room = mountChat({ messages: [say(0, 'ben', 'here it is')] });
    const part = room.chat.addPart('m0', { kind: 'code', language: 'ts' })!;
    flushSync();

    room.chat.append('m0', 'let x');
    room.chat.append('m0', ' = 1');
    flushSync();

    // Tokens never decide for themselves where a part ends — that is parsing,
    // and parsing is the consumer's.
    expect(part.text()).toBe('let x = 1');
    expect(room.chat.messages()[0]!.parts()[0]!.text()).toBe('here it is');
    expect(room.chat.messages()[0]!.text()).toBe('here it is\n\nlet x = 1');
    expect(partsOf(room, 0)[1]!.getAttribute('aria-label')).toBe('Code, ts');
  });
});

// ---------------------------------------------------------------------------
// What a screen reader hears about a message's state
// ---------------------------------------------------------------------------

describe('announcing a state', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function spoken(): string {
    return [...document.querySelectorAll("[data-volt-announcer='polite']")]
      .map((region) => region.textContent ?? '')
      .join('')
      .trim();
  }

  it('says nothing about a reply that is only on its way', () => {
    const room = mountChat({ messages: transcript(1) });
    room.chat.add({ id: 'live', author: 'ben', name: 'Ben', typing: true });
    flushSync();
    vi.advanceTimersByTime(50);

    // There is nothing to say yet, and saying the name of somebody who has not
    // written anything is a stutter.
    expect(spoken()).toBe('');
  });

  it('says what failed, politely, through the shared region', () => {
    const room = mountChat({ messages: transcript(1) });
    room.chat.add({ id: 'live', author: 'ben', name: 'Ben', streaming: true });
    flushSync();
    room.chat.fail('live', 'the connection dropped');
    vi.advanceTimersByTime(50);

    expect(spoken()).toBe('Ben: the connection dropped');
    // A failure is worth interrupting a sentence for far less often than it
    // feels like it is, and this region is the one the announcer owns.
    expect(document.querySelectorAll("[data-volt-announcer='assertive']")).toHaveLength(0);
    expect(document.querySelectorAll("[data-volt-announcer='polite']")).toHaveLength(1);
  });
});
