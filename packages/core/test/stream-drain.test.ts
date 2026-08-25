/**
 * The client half of streaming: what happens to a chunk after it arrives.
 *
 * `renderToStream` writes a boundary's fallback between two comments, and
 * later writes the real content into an inert `<template>` followed by a
 * `self.__VOLT__.push([op, …])` record. Until those records are read the
 * feature is one-ended — the bytes are on the page and the page still shows
 * the fallback — so every test here starts from bytes a real render produced
 * rather than from a fixture written to match. A fixture proves the drain
 * agrees with whoever wrote the fixture; only the stream proves the two halves
 * agree with each other.
 *
 * The delivery is simulated one chunk at a time, because that is the only way
 * the two boot orders are distinguishable: a page whose runtime loaded first
 * has a live queue when the record arrives, and a page whose runtime loaded
 * last finds an array of records already waiting. Both are tested, and they
 * are different code paths.
 *
 * Scripts inserted through `innerHTML` never execute — that is the HTML
 * specification, not a limitation of the test environment — so the emitted
 * script text is executed here instead, at the point in the chunk order a
 * parser would have reached it. The bytes run are the server's own.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { compileTemplate } from '@voltdev/core/jit';
import { Component } from '@voltdev/core';
import { MarkupWriter, boundary, renderToStream } from '@voltdev/core/server';
import { drainStream, hydrate } from '@voltdev/core/runtime';

function serverBuild(on: boolean): void {
  (globalThis as { __VOLT_SERVER__?: boolean }).__VOLT_SERVER__ = on;
}

interface QueueHost {
  __VOLT__?: unknown;
}

beforeEach(() => {
  serverBuild(true);
  document.body.innerHTML = '';
  // A fresh page: the queue a previous response installed is gone, which is
  // what the boot line in the next response will find.
  delete (globalThis as QueueHost).__VOLT__;
});

afterEach(() => serverBuild(false));

/** A promise whose settling this test decides. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const decoder = new TextDecoder();
const ran = new WeakSet<Element>();

/**
 * Put one chunk on the page the way a parser would, then run what it carried.
 *
 * The scripts are found by walking the document rather than by parsing the
 * chunk, so a record split across two enqueues would still be run exactly
 * once — the `WeakSet` is what makes the second visit a no-op.
 */
function receive(chunk: string): void {
  document.body.insertAdjacentHTML('beforeend', chunk);
  for (const script of document.querySelectorAll('script')) {
    if (ran.has(script)) continue;
    ran.add(script);
    // The state payload is `type="application/json"`: data, not code.
    if (script.getAttribute('type') !== null) continue;
    new Function(script.textContent ?? '')();
  }
}

/** Every chunk, in the order the stream produced them. */
async function chunks(stream: ReadableStream<Uint8Array>): Promise<string[]> {
  const reader = stream.getReader();
  const out: string[] = [];
  for (;;) {
    const next = await reader.read();
    if (next.done) return out;
    out.push(decoder.decode(next.value));
  }
}

/** Two boundaries in one page, so settle order and document order can differ. */
function twoBoundaries(
  first: Promise<string>,
  second: Promise<string>,
): new () => object {
  @Component({
    selector: 'v-drain-two',
    render: compileTemplate(`<main><h1>shell</h1>{ one }<hr>{ two }</main>`),
  })
  class Two {
    one = boundary(() => first, {
      fallback: (out: MarkupWriter) => out.raw('<i>waiting-one</i>'),
      content: (value: string, out: MarkupWriter) => out.child(value),
    });
    two = boundary(() => second, {
      fallback: (out: MarkupWriter) => out.raw('<i>waiting-two</i>'),
      content: (value: string, out: MarkupWriter) => out.child(value),
    });
  }
  return Two;
}

describe('draining a streamed page', () => {
  it('relocates the content when the runtime loads after every record', async () => {
    const one = deferred<string>();
    const two = deferred<string>();
    const stream = renderToStream(twoBoundaries(one.promise, two.promise));
    // Declared first, settled second: the records reach the page in an order
    // the document does not share.
    two.resolve('ANSWER-TWO');
    await Promise.resolve();
    one.resolve('ANSWER-ONE');

    for (const chunk of await chunks(stream)) receive(chunk);

    const main = document.querySelector('main')!;
    // Nothing has read the records yet, so the page is still its shell.
    expect(main.innerHTML).toContain('waiting-one');
    expect(Array.isArray((globalThis as QueueHost).__VOLT__)).toBe(true);

    // The node that will be moved, held so the assertion below can tell a
    // relocation from a re-parse: the server's own text node, not a copy.
    const carried = document.querySelector('template[data-volt-b="0"]')!.content.firstChild;

    drainStream();

    expect(main.innerHTML).toContain('<!--v0-->ANSWER-ONE<!--/v0-->');
    expect(main.innerHTML).toContain('<!--v1-->ANSWER-TWO<!--/v1-->');
    expect(main.innerHTML).not.toContain('waiting-one');
    expect(main.innerHTML).not.toContain('waiting-two');
    expect(carried!.parentNode).toBe(main);
    // The template is spent, and leaving it would make a second drain move a
    // second copy of the same content.
    expect(document.querySelector('template[data-volt-b]')).toBeNull();
  });

  it('relocates the content when the runtime loads before any record', async () => {
    const one = deferred<string>();
    const two = deferred<string>();
    const stream = renderToStream(twoBoundaries(one.promise, two.promise));
    two.resolve('EARLY-TWO');
    await Promise.resolve();
    one.resolve('EARLY-ONE');
    const parts = await chunks(stream);

    // The runtime is here first, before a single byte of the response.
    drainStream();

    receive(parts[0]!);
    const main = document.querySelector('main')!;
    expect(main.innerHTML).toContain('waiting-one');

    for (const chunk of parts.slice(1)) {
      receive(chunk);
      // Applied as it lands rather than at some later drain: after the chunk
      // carrying a record, that boundary is already filled and nothing has
      // called `drainStream` a second time.
      if (chunk.includes('data-volt-b="1"')) {
        expect(main.innerHTML).toContain('<!--v1-->EARLY-TWO<!--/v1-->');
      }
    }

    expect(main.innerHTML).toContain('<!--v0-->EARLY-ONE<!--/v0-->');
    expect(main.innerHTML).toContain('<!--v1-->EARLY-TWO<!--/v1-->');
    // The server's boot line ran after the swap and found something already
    // there, which is the half of array-then-swap that is easy to get wrong:
    // `self.__VOLT__ = self.__VOLT__ || []` must not replace a live queue.
    expect(Array.isArray((globalThis as QueueHost).__VOLT__)).toBe(false);
  });

  it('puts a late answer in its own placeholder, not in the first one it finds', async () => {
    const one = deferred<string>();
    const two = deferred<string>();
    const stream = renderToStream(twoBoundaries(one.promise, two.promise));
    two.resolve('BELONGS-TO-TWO');
    await Promise.resolve();
    one.resolve('BELONGS-TO-ONE');
    const parts = await chunks(stream);

    // The claim under test is that the records are read by id. It is only a
    // claim at all because the chunks arrive in the other order — assert that,
    // or a drain that walked placeholders in document order would pass.
    const order = parts.join('');
    expect(order.indexOf('BELONGS-TO-TWO')).toBeLessThan(order.indexOf('BELONGS-TO-ONE'));
    expect(order.indexOf('<!--v0-->')).toBeLessThan(order.indexOf('<!--v1-->'));

    for (const chunk of parts) receive(chunk);
    drainStream();

    const main = document.querySelector('main')!;
    expect(main.innerHTML).toContain('<!--v0-->BELONGS-TO-ONE<!--/v0-->');
    expect(main.innerHTML).toContain('<!--v1-->BELONGS-TO-TWO<!--/v1-->');
  });

  it('leaves the fallback standing when the boundary failed with nothing to show', async () => {
    @Component({
      selector: 'v-drain-failed',
      render: compileTemplate(`<div><h1>up</h1>{ body }</div>`),
    })
    class Failed {
      body = boundary(() => Promise.reject(new Error('the query died')), {
        fallback: (out: MarkupWriter) => out.raw('<i>could not load</i>'),
        content: (_value: unknown, out: MarkupWriter) => out.raw('<b>never</b>'),
      });
    }

    for (const chunk of await chunks(renderToStream(Failed))) receive(chunk);
    const template = document.querySelector('template[data-volt-b="0"]')!;
    // No `failed` writer, so the chunk carries an empty template and an `e`.
    expect(template.innerHTML).toBe('');

    drainStream();

    const div = document.querySelector('div')!;
    // Replacing the fallback with the nothing the boundary had would leave a
    // hole where the page said something was coming.
    expect(div.innerHTML).toContain('could not load');
    expect(document.querySelector('template[data-volt-b]')).toBeNull();
  });

  it('moves portalled content into the element it named', async () => {
    @Component({
      selector: 'v-drain-portal',
      render: compileTemplate(`<div><p>body</p><span :portal="'#dock'">docked</span></div>`),
    })
    class Portalled {}

    document.body.innerHTML = '<aside id="dock"></aside>';
    for (const chunk of await chunks(renderToStream(Portalled))) receive(chunk);

    // Written as a `<template>`, because content that is going to be moved
    // must not be rendered where the response happened to put it.
    expect(document.querySelector('#dock')!.innerHTML).toBe('');
    expect(document.querySelector('template[data-volt-portal]')).not.toBeNull();

    drainStream();

    expect(document.querySelector('#dock')!.innerHTML).toBe('<span>docked</span>');
    expect(document.querySelector('template[data-volt-portal]')).toBeNull();
  });

});

describe('a record whose placeholder has not arrived', () => {
  /**
   * The one hand-built page here, and the reason is worth writing down.
   *
   * A placeholder ends up inside an un-inserted `<template>` when one boundary
   * is nested in another, and `renderToStream` cannot emit that today: the
   * tail waits on the collector before flushing the lane that would start the
   * inner boundary's work, so the inner work never starts and the response
   * never closes. The outer half below is byte-for-byte what a real render of
   * a nested boundary does write before it stalls; the inner chunk is what the
   * same emitter would write next.
   *
   * The drain has to hold the shape anyway — queue on miss is what §3.5 asks
   * of `$V` — because the alternative is a record silently dropped, which is
   * the failure that looks exactly like a page that never got the answer.
   */
  const NESTED =
    '<main><!--v0--><i>outer-fallback</i><!--/v0--></main>' +
    '<template data-volt-b="0"><section><!--v1--><i>inner-fallback</i><!--/v1--></section></template>' +
    '<template data-volt-b="1">INNER</template>';

  /** Through the global, exactly as the emitted `self.__VOLT__.push(…)` does. */
  function push(record: unknown[]): void {
    ((globalThis as QueueHost).__VOLT__ as { push(record: unknown): void }).push(record);
  }

  const RELOCATED = '<!--v0--><section><!--v1-->INNER<!--/v1--></section><!--/v0-->';

  it('waits for it rather than dropping the record', () => {
    document.body.innerHTML = NESTED;
    (globalThis as QueueHost).__VOLT__ = [];
    drainStream();

    // The inner record first, while its placeholder is still inside a
    // template — invisible to a document walk, which is the whole reason a
    // `<template>` is the right container for a chunk.
    push(['b', '1']);
    expect(document.querySelector('main')!.innerHTML).toContain('outer-fallback');

    push(['b', '0']);

    // Moving the outer chunk revealed the inner placeholder, and the record
    // that missed was offered the page again rather than thrown away.
    expect(document.querySelector('main')!.innerHTML).toBe(RELOCATED);
    expect(document.querySelector('template[data-volt-b]')).toBeNull();
  });

  it('still holds it when the page boots a second time', () => {
    document.body.innerHTML = NESTED;
    (globalThis as QueueHost).__VOLT__ = [];
    drainStream();
    push(['b', '1']);

    // A second boot, which is what an island entry called once per island is.
    // Taking over the queue again would hand the page a new one, and the
    // record parked against the old one would never be looked at again.
    drainStream();
    push(['b', '0']);

    expect(document.querySelector('main')!.innerHTML).toBe(RELOCATED);
  });
});

describe('the wiring', () => {
  it('drains as part of hydrating, with nothing else asked to', async () => {
    const one = deferred<string>();
    const two = deferred<string>();
    const stream = renderToStream(twoBoundaries(one.promise, two.promise));
    one.resolve('WIRED-ONE');
    two.resolve('WIRED-TWO');
    for (const chunk of await chunks(stream)) receive(chunk);

    const main = document.querySelector('main')!;
    // The records are on the page and unread: this is exactly the state a real
    // page is in at the moment its runtime script finishes evaluating.
    expect(main.innerHTML).toContain('waiting-one');
    expect(Array.isArray((globalThis as QueueHost).__VOLT__)).toBe(true);

    // A host of its own, so what is asserted below is the drain and not
    // whatever hydrating the streamed region would itself have done to it.
    const app = document.createElement('div');
    app.append(document.createComment('h'));
    document.body.append(app);

    // The only call. No `drainStream` here — if the entry does not make it,
    // the page below is still showing both fallbacks.
    hydrate(app, () => undefined);

    expect(main.innerHTML).toContain('WIRED-ONE');
    expect(main.innerHTML).toContain('WIRED-TWO');
    expect(main.innerHTML).not.toContain('waiting-one');
    expect(main.innerHTML).not.toContain('waiting-two');
  });
});
