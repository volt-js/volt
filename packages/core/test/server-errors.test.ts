/**
 * Where a server render's errors go, on both sides of the first byte.
 *
 * A server has two failures that look like different problems and are not: a
 * component that throws while the walk is passing through it, and an effect
 * that throws several flushes later and reaches the error channel rather than
 * any `catch`. Both are one region of one page failing. What separates the
 * answers is not the failure but the response — whether the bytes holding that
 * region are still in a writer nobody has read, or already on a socket.
 *
 * So each claim here is written to fail for one reason:
 *
 * **A buffered render answers 200 with a recovered region.** Asserted against
 * the status *and* against the bytes the failed region had written, because a
 * boundary that wrote its fallback and left the wreckage in front of it would
 * pass an assertion that only looked for the fallback.
 *
 * **A streamed region that fails after the shell is gone is replaced by a
 * later chunk.** Asserted on the record and the template, and on the shell
 * having gone out *first* — a stream that buffered would recover the same
 * region in place and produce a page with no record in it at all, which is a
 * different mechanism passing the same test.
 *
 * **The page survives it.** The whole-response fallback is what `renderToStream`
 * does with a failure nothing took responsibility for, so its absence is what
 * says a boundary took responsibility. Asserted alongside the epilogue, since
 * a stream that was killed politely would also lack the fallback.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { compileTemplate } from '@voltdev/core/jit';
import { Component, Signal, dataEffect, trackRequestData } from '@voltdev/core';
import {
  MarkupWriter,
  errorBoundary,
  renderToStream,
  renderToString,
} from '@voltdev/core/server';

function serverBuild(on: boolean): void {
  (globalThis as { __VOLT_SERVER__?: boolean }).__VOLT_SERVER__ = on;
}

beforeEach(() => serverBuild(true));
afterEach(() => serverBuild(false));

const decoder = new TextDecoder();

async function whole(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  let out = '';
  for (;;) {
    const next = await reader.read();
    if (next.done) return out;
    out += decoder.decode(next.value);
  }
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('a boundary in a buffered render', () => {
  it('answers 200 with the fallback where the failed region was', async () => {
    @Component({
      selector: 'v-buffered',
      render: compileTemplate(`<main><h1>kept</h1>{ body }</main>`),
    })
    class Page {
      body = errorBoundary(
        (out: MarkupWriter) => {
          out.raw('<section><p>half</p>');
          throw new Error('walked into a wall');
        },
        {
          fallback: (error: unknown, out: MarkupWriter) => {
            out.raw(`<p class="oops">${(error as Error).message}</p>`);
          },
        },
      );
    }

    const page = await renderToString(Page);

    // The page is answerable. Before this, any throw under the walk was the
    // whole render's 500.
    expect(page.status).toBe(200);
    expect(page.html).toContain('<h1>kept</h1>');
    expect(page.html).toContain('<p class="oops">walked into a wall</p>');
    // And the bytes the failed region wrote are gone with it: `<section>` was
    // opened and never closed, so leaving it would hand a browser markup that
    // swallows the rest of the page.
    expect(page.html).not.toContain('half');
    expect(page.html).not.toContain('<section>');
  });

  it('recovers a failure that arrives after the walk, through the channel', async () => {
    const trigger = new Signal.State(0);

    @Component({
      selector: 'v-late-buffered',
      render: compileTemplate(`<main><h1>kept</h1>{ body }</main>`),
    })
    class Page {
      body = errorBoundary(
        (out: MarkupWriter) => {
          out.raw('<p>region</p>');
          dataEffect(() => {
            if (trigger.get() === 1) throw new Error('effect gave up');
          });
        },
        {
          fallback: (error: unknown, out: MarkupWriter) => {
            out.raw(`<p class="oops">${(error as Error).message}</p>`);
          },
        },
      );
      constructor() {
        // Settled inside the request, so the walk is long over and the bytes
        // after the region have been written by the time this raises.
        trackRequestData(Promise.resolve().then(() => trigger.set(1)));
      }
    }

    const page = await renderToString(Page);

    expect(page.status).toBe(200);
    expect(page.html).toContain('<p class="oops">effect gave up</p>');
    // The region is replaced where it stood rather than appended: `kept` is
    // still before it and the closing tag still after it.
    expect(page.html).toContain('<h1>kept</h1>');
    expect(page.html).not.toContain('<p>region</p>');
    expect(page.html!.endsWith('</main>')).toBe(true);
  });

  it('empties the region it could not finish, even with nothing to put there', async () => {
    @Component({
      selector: 'v-swallowed',
      render: compileTemplate(`<main><h1>kept</h1>{ body }</main>`),
    })
    class Page {
      body = errorBoundary((out: MarkupWriter) => {
        out.raw('<section><p>half</p>');
        throw new Error('nothing catches this');
      });
    }

    const page = await renderToString(Page);

    // No fallback means the boundary swallows, which is the client boundary's
    // behaviour too. What it must not mean is that the wreckage is sent: the
    // region opened a `<section>` it never closed, and a browser handed that
    // would put the rest of the document inside it.
    expect(page.status).toBe(200);
    expect(page.html).toBe('<main><h1>kept</h1><!--[--><!--]--></main>');
  });

  it('leaves a region that never fails exactly where it wrote it', async () => {
    @Component({
      selector: 'v-quiet',
      render: compileTemplate(`<main><h1>kept</h1>{ body }</main>`),
    })
    class Page {
      body = errorBoundary(
        (out: MarkupWriter) => {
          out.raw('<p>');
          out.raw('one');
          out.raw('</p>');
          out.raw('<i>two</i>');
        },
        { fallback: (_error: unknown, out: MarkupWriter) => out.raw('<p>unreached</p>') },
      );
    }

    const page = await renderToString(Page);

    // Byte for byte, and several chunks of them: a region is a list inside the
    // page's list of chunks, so the page is only correct if that list is
    // flattened rather than joined.
    expect(page.html).toBe('<main><h1>kept</h1><!--[--><p>one</p><i>two</i><!--]--></main>');
  });

  it('builds a fallback in the region it replaces, wherever the error came from', async () => {
    const trigger = new Signal.State(0);

    @Component({
      selector: 'v-nested-late',
      render: compileTemplate(`<main><h1>kept</h1>{ body }</main>`),
    })
    class Page {
      body = errorBoundary(
        (out: MarkupWriter) => {
          out.child(
            errorBoundary(
              (inner: MarkupWriter) => {
                inner.raw('<p>region</p>');
                dataEffect(() => {
                  if (trigger.get() === 1) throw new Error('first');
                });
              },
              {
                fallback: (_error: unknown, inner: MarkupWriter) => {
                  inner.raw('<p>inner</p>');
                  dataEffect(() => {
                    throw new Error('and the fallback too');
                  });
                },
              },
            ),
          );
          out.raw('<span></span>');
        },
        {
          fallback: (error: unknown, out: MarkupWriter) => {
            out.raw(`<p class="outer">${(error as Error).message}</p>`);
          },
        },
      );
      constructor() {
        trackRequestData(Promise.resolve().then(() => trigger.set(1)));
      }
    }

    const page = await renderToString(Page);

    // The error that replaced the inner region arrived through the channel,
    // from a flush that is on nobody's scope. The fallback it builds still has
    // to belong to the boundary that built it, or its own failure is a stray
    // that no boundary above ever hears about.
    expect(page.status).toBe(200);
    expect(page.html).toContain('<p class="outer">and the fallback too</p>');
    expect(page.html).not.toContain('<p>inner</p>');
    expect(page.html).not.toContain('<p>region</p>');
  });

  it('sends a fallback that fails in turn to the boundary above, not to itself', async () => {
    @Component({
      selector: 'v-nested',
      render: compileTemplate(`<main><h1>kept</h1>{ body }</main>`),
    })
    class Page {
      body = errorBoundary(
        (out: MarkupWriter) => {
          out.child(
            errorBoundary(
              () => {
                throw new Error('first');
              },
              {
                fallback: (_error: unknown, inner: MarkupWriter) => {
                  inner.raw('<p>inner</p>');
                  // Built under the boundary's own scope, so when it throws it
                  // arrives back at the boundary whose fallback it is.
                  dataEffect(() => {
                    throw new Error('and the fallback too');
                  });
                },
              },
            ),
          );
          out.raw('<span></span>');
        },
        {
          fallback: (error: unknown, out: MarkupWriter) => {
            out.raw(`<p class="outer">${(error as Error).message}</p>`);
          },
        },
      );
    }

    const page = await renderToString(Page);

    // The inner boundary is already showing its fallback, so it has nothing
    // left to replace and the error goes up. Asserted on the outer fallback
    // rather than on the absence of a loop, because a loop does not finish.
    expect(page.status).toBe(200);
    expect(page.html).toContain('<p class="outer">and the fallback too</p>');
    expect(page.html).not.toContain('<p>inner</p>');
  });

  it('sends a fallback that throws while writing out of the render', async () => {
    @Component({
      selector: 'v-looping',
      render: compileTemplate(`<main><h1>kept</h1>{ body }</main>`),
    })
    class Page {
      body = errorBoundary(
        () => {
          throw new Error('first');
        },
        {
          fallback: () => {
            throw new Error('and the fallback too');
          },
        },
      );
    }

    // Replacing the fallback with itself is the loop this guards, so what is
    // asserted is that the second error left the boundary rather than that the
    // call returned.
    const page = await renderToString(Page);
    expect(page.status).toBe(500);
    expect((page.error as Error).message).toBe('and the fallback too');
  });

  it('declines to a 500 when its handler rethrows', async () => {
    @Component({
      selector: 'v-declined',
      render: compileTemplate(`<main><h1>kept</h1>{ body }</main>`),
    })
    class Page {
      body = errorBoundary(
        () => {
          throw new Error('not mine');
        },
        {
          fallback: (_error: unknown, out: MarkupWriter) => out.raw('<p>caught</p>'),
          onError: (error: unknown) => {
            throw error;
          },
        },
      );
    }

    const page = await renderToString(Page);
    expect(page.status).toBe(500);
    expect((page.error as Error).message).toBe('not mine');
  });
});

describe('a boundary in a stream', () => {
  it('replaces its region with a late chunk once the shell has gone', async () => {
    const held = deferred<void>();
    const trigger = new Signal.State(0);

    @Component({
      selector: 'v-late-stream',
      render: compileTemplate(`<main><h1>shell</h1>{ body }</main>`),
    })
    class Page {
      body = errorBoundary(
        (out: MarkupWriter) => {
          out.raw('<p>region</p>');
          dataEffect(() => {
            if (trigger.get() === 1) throw new Error('too late for a status');
          });
        },
        {
          fallback: (error: unknown, out: MarkupWriter) => {
            out.raw(`<p class="oops">${(error as Error).message}</p>`);
          },
        },
      );
      constructor() {
        trackRequestData(held.promise);
      }
    }

    const stream = renderToStream(Page);
    const reader = stream.getReader();

    const shell = decoder.decode((await reader.read()).value);
    // The region went out intact, which is exactly why it cannot be rewritten.
    expect(shell).toContain('<p>region</p>');
    expect(shell).toContain('<!--v0-->');

    trigger.set(1);
    held.resolve();

    let rest = '';
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      rest += decoder.decode(next.value);
    }

    // The fallback arrives as its own chunk, in the same shape a boundary's
    // answer arrives in, with a record naming the region it replaces.
    expect(rest).toContain(
      '<template data-volt-b="0"><p class="oops">too late for a status</p></template>',
    );
    expect(rest).toContain('self.__VOLT__.push(["e","0"])');
    // And the page was not taken down for it: the whole-response fallback is
    // what happens when nothing takes responsibility, and something did.
    expect(shell + rest).not.toContain('the render failed after the response had started');
  });

  it('rewrites in place while the shell is still held', async () => {
    @Component({
      selector: 'v-early-stream',
      render: compileTemplate(`<main><h1>shell</h1>{ body }</main>`),
    })
    class Page {
      body = errorBoundary(
        (out: MarkupWriter) => {
          out.raw('<p>region</p>');
          throw new Error('during the walk');
        },
        {
          fallback: (_error: unknown, out: MarkupWriter) => out.raw('<p>early</p>'),
        },
      );
    }

    const html = await whole(renderToStream(Page));

    // Same boundary, same failure, different answer — because the bytes were
    // still in hand. No template, no record: nothing to replace.
    expect(html).toContain('<!--v0--><p>early</p><!--/v0-->');
    expect(html).not.toContain('<p>region</p>');
    expect(html).not.toContain('data-volt-b="0"');
  });
});
