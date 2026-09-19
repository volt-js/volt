/**
 * What the display primitives write on a server.
 *
 * A server drains render and data effects and stops there, so anything a
 * primitive learns in an ordinary `effect` is not known when the bytes are
 * written. The claim tested here is that each one writes what it starts from
 * without claiming something that is not true of the page — a list with rows
 * in it is not "empty", and a transcript opens at its end.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { compileTemplate } from '@voltdev/core/jit';
import { Component, Signal, createRequestScope, mount, settleRequest } from '@voltdev/core';
import { createChat } from '../src/chat.ts';
import { createEmptyState } from '../src/feedback.ts';
import { resetLocaleCaches } from '../src/i18n.ts';

/** The build flag, which the test config compiles to a live read of this global. */
function serverBuild(on: boolean): void {
  (globalThis as { __VOLT_SERVER__?: boolean }).__VOLT_SERVER__ = on;
}

/** Everything one request wrote. */
async function renderRequest(component: Parameters<typeof mount>[0]): Promise<HTMLElement> {
  const scope = createRequestScope();
  const host = document.createElement('div');
  await settleRequest(scope, () => {
    mount(component, host);
  });
  return host;
}

beforeEach(() => {
  serverBuild(true);
  resetLocaleCaches();
});

afterEach(() => {
  serverBuild(false);
  resetLocaleCaches();
});

describe('an empty state counting from the DOM', () => {
  @Component({
    selector: 'v-server-results',
    render: compileTemplate(`
      <div>
        <ul class="list" :ref="list" :spread="empty.collectionProps()">
          <li :for="row in rows" :key="row" data-volt-item>{ row }</li>
        </ul>
        <p class="message" :if="empty.isMessageVisible()">{ empty.message() }</p>
      </div>
    `),
  })
  class Results {
    rows = ['Ada', 'Grace', 'Alan'];
    list = new Signal.State<Element | null>(null);
    empty = createEmptyState({ collection: () => this.list.get() });
  }

  it('does not call a list with rows in it empty', async () => {
    const host = await renderRequest(Results);
    const list = host.querySelector('.list')!;

    expect(list.querySelectorAll('li')).toHaveLength(3);
    // The count is taken by an effect a server never runs, so nothing is
    // known about it yet — which is not the same as knowing it is zero.
    expect(list.hasAttribute('data-empty')).toBe(false);
    expect(list.hasAttribute('aria-describedby')).toBe(false);
    expect(list.getAttribute('data-status')).not.toBe('empty');
    expect(host.querySelector('.message')).toBeNull();
  });
});

describe('a chat transcript', () => {
  @Component({
    selector: 'v-server-room',
    render: compileTemplate(`
      <div class="log" :ref="scroller" :spread="chat.logProps()">
        <div :spread="chat.sizerProps()">
          <div :ref="list" :spread="chat.containerProps()">
            <p class="msg" :for="row in chat.rendered()" :key="row.id"
               :spread="chat.messageProps(row)">{ row.message.text() }</p>
          </div>
        </div>
      </div>
    `),
  })
  class Room {
    scroller = new Signal.State<Element | null>(null);
    list = new Signal.State<Element | null>(null);
    chat = createChat({
      scroller: () => this.scroller.get(),
      container: () => this.list.get(),
    });

    constructor() {
      this.chat.setMessages(
        Array.from({ length: 50 }, (_, index) => ({
          id: `m${index}`,
          author: index % 2 === 0 ? 'ada' : 'ben',
          text: `message ${index}`,
        })),
      );
    }
  }

  it('opens at its end, where the reader is about to be', async () => {
    const host = await renderRequest(Room);
    const written = [...host.querySelectorAll('.msg')].map((row) => row.textContent);

    // A server has no viewport and runs nothing that scrolls, so the window it
    // writes is the one the transcript starts from. That has to be the newest
    // message and what leads up to it: the oldest is the far end of the
    // history, and the page would swap every row of it out on attaching.
    expect(written).toEqual(['message 47', 'message 48', 'message 49']);
    expect(host.querySelector('.msg:last-child')!.getAttribute('aria-posinset')).toBe('50');
  });
});
