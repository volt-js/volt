/**
 * `renderToStream`: the shell early, the rest as it lands, and the failure
 * that has nowhere left to put a status code.
 *
 * Four claims, and each is asserted against something that would still be
 * green if the code under it were deleted unless the assertion is written to
 * notice.
 *
 * **The shell does not wait.** Everything else here is an optimisation of an
 * optimisation; this is the whole point. It is tested by racing the first read
 * against a timer while the page's query is deliberately unresolved, because a
 * test that resolves the query first cannot tell a stream from a buffer.
 *
 * **A boundary arrives out of order.** Two boundaries, the second one faster,
 * and the assertion is on the order the chunks came out — settle order, not
 * declaration order. Asserting only that both arrived would pass on a
 * implementation that waited for the slowest and sent them in the order they
 * were written, which is the buffered render with extra steps.
 *
 * **What is written into a script is inert.** The same three specific escapes
 * the state payload is held to — `</script>`, the `<!--` tokenizer trap, and
 * the JS-only line terminators — now applied to the records that arrive after
 * the shell, and asserted by parsing the response and looking at what the
 * parser made of it rather than by matching bytes.
 *
 * **A failure after the first byte is markup.** The status line is gone by
 * then, so the only answers are to write something and stop, or to stop
 * silently. Both halves are asserted: the fallback is in the response, and the
 * bytes the failing region had already written are not.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { compileTemplate } from '@voltdev/core/jit';
import {
  Component,
  STATE_ATTRIBUTE,
  Signal,
  createContext,
  dataEffect,
  hydratable,
  provideContext,
  trackRequestData,
  useContext,
} from '@voltdev/core';
import {
  MarkupWriter,
  boundary,
  createComponent,
  renderToStaticMarkup,
  renderToStream,
  renderToString,
} from '@voltdev/core/server';

function serverBuild(on: boolean): void {
  (globalThis as { __VOLT_SERVER__?: boolean }).__VOLT_SERVER__ = on;
}

beforeEach(() => serverBuild(true));
afterEach(() => serverBuild(false));

/** A promise whose settling this test decides. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (e: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const decoder = new TextDecoder();

/** Every chunk, in order, once the stream has closed. */
async function chunks(stream: ReadableStream<Uint8Array>): Promise<string[]> {
  const reader = stream.getReader();
  const out: string[] = [];
  for (;;) {
    const next = await reader.read();
    if (next.done) return out;
    out.push(decoder.decode(next.value));
  }
}

async function whole(stream: ReadableStream<Uint8Array>): Promise<string> {
  return (await chunks(stream)).join('');
}

/** The response as a browser would have it, which is the only honest reader. */
function parse(html: string): Document {
  return new DOMParser().parseFromString(
    `<!doctype html><html><body>${html}</body></html>`,
    'text/html',
  );
}

/** A marker the race below returns instead of hanging for the whole suite. */
const HELD = Symbol('held');

/**
 * The first chunk, or `HELD` if the stream is still holding it.
 *
 * The timer is what makes the claim falsifiable: a `renderToStream` that
 * buffered would resolve this read only once the page's query answered, and
 * that query is deliberately still outstanding when this is called.
 */
async function firstChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<string | typeof HELD> {
  const raced = await Promise.race([
    reader.read(),
    new Promise<typeof HELD>((resolve) => setTimeout(() => resolve(HELD), 250)),
  ]);
  if (raced === HELD) return HELD;
  return raced.done ? '' : decoder.decode(raced.value);
}

describe('the shell', () => {
  it('goes out before the query it is waiting on answers', async () => {
    const slow = deferred<string>();

    @Component({
      selector: 'v-shell',
      render: compileTemplate(`<main><h1>shell</h1>{ body }</main>`),
    })
    class Shell {
      body = boundary(() => slow.promise, {
        fallback: (out: MarkupWriter) => out.raw('<p>loading</p>'),
        content: (value: string, out: MarkupWriter) => out.child(value),
      });
    }

    const stream = renderToStream(Shell);
    const reader = stream.getReader();

    const shell = await firstChunk(reader);

    // The query has not answered and is not going to until the line below it.
    expect(shell).not.toBe(HELD);
    expect(shell).toContain('<h1>shell</h1>');
    expect(shell).toContain('<p>loading</p>');
    // And it is only the shell: the answer cannot be in bytes written before
    // the answer existed.
    expect(shell).not.toContain('arrived');

    slow.resolve('arrived');
    let rest = '';
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      rest += decoder.decode(next.value);
    }
    expect(rest).toContain('arrived');
  });

  it('errors the stream when the walk throws, so a caller can still say 500', async () => {
    @Component({
      selector: 'v-broken',
      render: compileTemplate(`<p>{ boom() }</p>`),
    })
    class Broken {
      boom(): string {
        throw new Error('walked into a wall');
      }
    }

    // Nothing has been written at that point, so there is no half-page to send
    // by accident — which is the one capability streaming gives up the instant
    // the first byte is out.
    await expect(whole(renderToStream(Broken))).rejects.toThrow(/walked into a wall/);
  });
});

describe('a boundary', () => {
  it('fills its placeholder with a template and a record', async () => {
    @Component({
      selector: 'v-filled',
      render: compileTemplate(`<div><span>a</span>{ body }<span>b</span></div>`),
    })
    class Filled {
      body = boundary(() => Promise.resolve('answer'), {
        fallback: (out: MarkupWriter) => out.raw('<i>wait</i>'),
        content: (value: string, out: MarkupWriter) => out.child(value),
      });
    }

    const html = await whole(renderToStream(Filled));
    const doc = parse(html);
    const template = doc.querySelector('template[data-volt-b="0"]');

    // The content is inside a `<template>`, which is what keeps it from being
    // rendered where the stream happened to put it.
    expect(template).not.toBeNull();
    expect(template!.innerHTML).toBe('answer');
    // And the placeholder it belongs to is still where it was written, so
    // there is somewhere to move it to.
    expect(html).toContain('<!--v0--><i>wait</i><!--/v0-->');
    expect(html).toContain('self.__VOLT__.push(["b","0"])');
  });

  it('boots the queue as an array before the first record needs it', async () => {
    @Component({
      selector: 'v-boot',
      render: compileTemplate(`<p><em>x</em>{ body }</p>`),
    })
    class Boot {
      body = boundary(() => Promise.resolve('x'), {
        content: (value: string, out: MarkupWriter) => out.child(value),
      });
    }

    const html = await whole(renderToStream(Boot));

    // Array-then-swap: whichever of the boot line and the client runtime
    // arrives first creates it, and the record can be pushed either way.
    expect(html.indexOf('self.__VOLT__=self.__VOLT__||[]')).toBeGreaterThan(-1);
    expect(html.indexOf('self.__VOLT__=self.__VOLT__||[]')).toBeLessThan(
      html.indexOf('self.__VOLT__.push'),
    );
  });

  it('writes in the order the work settled, not the order it was declared', async () => {
    const first = deferred<string>();
    const second = deferred<string>();

    @Component({
      selector: 'v-ooo',
      render: compileTemplate(
        `<div><section><em>a</em>{ slow }</section><section><em>b</em>{ quick }</section></div>`,
      ),
    })
    class OutOfOrder {
      slow = boundary(() => first.promise, {
        fallback: (out: MarkupWriter) => out.raw('<i>slow</i>'),
        content: (value: string, out: MarkupWriter) => out.child(value),
      });
      quick = boundary(() => second.promise, {
        fallback: (out: MarkupWriter) => out.raw('<i>quick</i>'),
        content: (value: string, out: MarkupWriter) => out.child(value),
      });
    }

    const stream = renderToStream(OutOfOrder);
    const reader = stream.getReader();
    const shell = await firstChunk(reader);
    expect(shell).not.toBe(HELD);
    // Declared first, so its placeholder is first in the document.
    expect((shell as string).indexOf('<!--v0-->')).toBeLessThan(
      (shell as string).indexOf('<!--v1-->'),
    );

    second.resolve('second-answer');
    const early = await firstChunk(reader);
    // The one declared second, delivered first, while the one declared first
    // is still outstanding. A render that waited for the page would have to
    // deliver them together and in document order.
    expect(early).not.toBe(HELD);
    expect(early).toContain('second-answer');
    expect(early).toContain('data-volt-b="1"');
    expect(early).not.toContain('first-answer');

    first.resolve('first-answer');
    let rest = '';
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      rest += decoder.decode(next.value);
    }
    expect(rest).toContain('first-answer');
  });

  it('refuses to be written as text, where there is no hole to come back to', async () => {
    @Component({ selector: 'v-textonly', render: compileTemplate(`<p>{ body }</p>`) })
    class TextOnly {
      body = boundary(() => Promise.resolve('late'), {
        content: (value: string, out: MarkupWriter) => out.child(value),
      });
    }

    // An element whose children are all text is emitted as one write, with
    // `toDisplayString` folded into it, so the writer never sees the boundary
    // itself. Left alone that renders `{}` — an object with one symbol key —
    // which is a page that looks fine to every test that does not read it.
    await expect(whole(renderToStream(TextOnly))).rejects.toThrow(
      /boundary was written as text/,
    );
  });

  it('writes only its fallback in a render that has no stream to put it in', async () => {
    let asked = 0;

    @Component({
      selector: 'v-buffered',
      render: compileTemplate(`<p><em>x</em>{ body }</p>`),
    })
    class Buffered {
      body = boundary(
        () => {
          asked++;
          return Promise.resolve('late');
        },
        {
          fallback: (out: MarkupWriter) => out.raw('<i>wait</i>'),
          content: (value: string, out: MarkupWriter) => out.child(value),
        },
      );
    }

    const stat = await renderToStaticMarkup(Buffered);
    const rendered = await renderToString(Buffered);

    expect(stat.html).toBe('<p><em>x</em><!--[--><i>wait</i><!--]--></p>');
    expect(rendered.html).toBe('<p><em>x</em><!--[--><i>wait</i><!--]--></p>');
    // Nothing was requested, so a buffered render's time to first byte does
    // not silently depend on whether anybody streamed the same page.
    expect(asked).toBe(0);
  });
});

describe('a failure after the first byte', () => {
  it('writes the boundary fallback instead of the content when the work rejects', async () => {
    @Component({
      selector: 'v-rejects',
      render: compileTemplate(`<div><h1>up</h1>{ body }</div>`),
    })
    class Rejects {
      body = boundary(() => Promise.reject(new Error('query died')), {
        fallback: (out: MarkupWriter) => out.raw('<i>wait</i>'),
        content: (_value: unknown, out: MarkupWriter) => out.raw('<b>never</b>'),
        failed: (_error: unknown, out: MarkupWriter) => out.raw('<b>sorry</b>'),
      });
    }

    const html = await whole(renderToStream(Rejects));

    expect(html).toContain('<h1>up</h1>');
    expect(html).toContain('<b>sorry</b>');
    expect(html).not.toContain('<b>never</b>');
    expect(html).toContain('self.__VOLT__.push(["e","0"])');
  });

  it('keeps the half-written bytes of a region whose content threw out of the page', async () => {
    @Component({
      selector: 'v-halfway',
      render: compileTemplate(`<div><em>x</em>{ body }</div>`),
    })
    class Halfway {
      body = boundary(() => Promise.resolve('ok'), {
        content: (_value: string, out: MarkupWriter) => {
          out.raw('<b>half-written</b>');
          throw new Error('threw on the way out');
        },
        failed: (_error: unknown, out: MarkupWriter) => out.raw('<b>sorry</b>'),
      });
    }

    const html = await whole(renderToStream(Halfway));

    // The buffered segment is the one thing a socket cannot give back: bytes
    // that went into a writer that was then discarded never left the process.
    expect(html).not.toContain('half-written');
    expect(html).toContain('<b>sorry</b>');
  });

  it('writes a fallback into the response when nothing else can catch it', async () => {
    const late = deferred<void>();

    @Component({ selector: 'v-blowup', render: compileTemplate(`<main>shell</main>`) })
    class BlowUp {
      n = new Signal.State(0);
      constructor() {
        dataEffect(() => {
          if (this.n.get() > 0) throw new Error('exploded after the headers');
        });
        trackRequestData(late.promise.then(() => this.n.set(1)));
      }
    }

    const stream = renderToStream(BlowUp, {
      fallback: (error) => `<p>${error instanceof Error ? 'failed' : '?'}</p>`,
    });
    const reader = stream.getReader();

    const shell = await firstChunk(reader);
    expect(shell).not.toBe(HELD);
    expect(shell).toContain('<main>shell</main>');

    late.resolve();
    let rest = '';
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      rest += decoder.decode(next.value);
    }

    // The status line went out with the shell, so this is the only answer the
    // response has left.
    expect(rest).toContain('<p>failed</p>');
  });

  it('closes with an inert comment when the caller named no fallback', async () => {
    const late = deferred<void>();

    @Component({ selector: 'v-quiet', render: compileTemplate(`<main>shell</main>`) })
    class Quiet {
      n = new Signal.State(0);
      constructor() {
        dataEffect(() => {
          if (this.n.get() > 0) throw new Error('exploded');
        });
        trackRequestData(late.promise.then(() => this.n.set(1)));
      }
    }

    const stream = renderToStream(Quiet);
    const read = whole(stream);
    late.resolve();
    const html = await read;

    // A comment, not the exception's message: internals reaching a stranger's
    // browser is how a stack trace becomes a disclosure.
    expect(html).toContain('<!--[volt] the render failed after the response had started-->');
    expect(html).not.toContain('exploded');
  });
});

describe('what a late record carries', () => {
  it('cannot end the script it is written in', async () => {
    @Component({ selector: 'v-hostile', render: compileTemplate(`<p>{ n.get() }</p>`) })
    class Hostile {
      n = hydratable<number | null>('n', () => null);
      note = hydratable<string | null>('</script><img src=x onerror=alert(1)>', () => null);
      constructor() {
        trackRequestData(
          Promise.resolve().then(() => {
            this.n.set(1);
            this.note.set('</script><!--\u2028 still data');
          }),
        );
      }
    }

    const html = await whole(renderToStream(Hostile));
    const doc = parse(html);

    // Nothing broke out: the only element the payload produced is the script
    // it was written into.
    expect(doc.querySelector('img')).toBeNull();
    const pushes = [...doc.querySelectorAll('script')].filter((el) =>
      (el.textContent ?? '').includes('.push('),
    );
    expect(pushes).toHaveLength(1);
    // The raw bytes carry no `<` at all inside the record, which is what makes
    // `</script>`, `<!--` and a nested `<script` one rule instead of three.
    const body = pushes[0]!.textContent ?? '';
    expect(body).not.toContain('<');
    expect(body).not.toContain('\u2028');
    // And it still means what it meant: the value round-trips.
    const record = JSON.parse(body.slice(body.indexOf('(') + 1, body.lastIndexOf(')'))) as [
      string,
      Record<string, unknown>,
    ];
    expect(record[0]).toBe('s');
    expect(record[1]['</script><img src=x onerror=alert(1)>']).toBe(
      '</script><!--\u2028 still data',
    );
  });

  it('sends only the state that moved after the shell was written', async () => {
    @Component({ selector: 'v-moved', render: compileTemplate(`<p>{ a.get() }</p>`) })
    class Moved {
      a = hydratable('a', () => 1);
      b = hydratable<number | null>('b', () => null);
      constructor() {
        trackRequestData(Promise.resolve().then(() => this.b.set(2)));
      }
    }

    const html = await whole(renderToStream(Moved));
    const doc = parse(html);
    const shellState = JSON.parse(
      doc.querySelector(`script[${STATE_ATTRIBUTE}]`)!.textContent ?? '',
    ) as Record<string, unknown>;

    // The shell carries what the markup was rendered from.
    expect(shellState).toEqual({ a: 1, b: null });
    // The increment carries only the difference, so a page with one late query
    // does not re-send everything it already sent. Asserted as the parsed
    // record rather than as a substring, because `toContain` cannot tell an
    // increment from a payload that happens to start the same way.
    const push = [...doc.querySelectorAll('script')].find((el) =>
      (el.textContent ?? '').includes('.push('),
    )!;
    const body = push.textContent ?? '';
    expect(JSON.parse(body.slice(body.indexOf('(') + 1, body.lastIndexOf(')')))).toEqual([
      's',
      { b: 2 },
    ]);
  });

  it('escapes a portal selector on its way into a record', async () => {
    @Component({
      selector: 'v-portal',
      render: compileTemplate(
        `<div>body<template :portal="sel"><b>away</b></template></div>`,
      ),
    })
    class Portalled {
      sel = '</script>#slot';
    }

    const html = await whole(renderToStream(Portalled));
    const doc = parse(html);

    expect(doc.querySelector(`template[data-volt-portal]`)!.innerHTML).toBe('<b>away</b>');
    const push = [...doc.querySelectorAll('script')].find((el) =>
      (el.textContent ?? '').includes('.push('),
    )!;
    expect(push.textContent).not.toContain('<');
    expect(push.textContent).toContain('\\u003C/script>#slot');
  });
});

describe('the parts a streamed page cannot put in a head it has already sent', () => {
  it('carries a component style in the chunk that component arrived in', async () => {
    const slow = deferred<string>();

    @Component({
      selector: 'v-late-styled',
      styles: '.late { color: blue }',
      render: compileTemplate(`<b class="late">{ text }</b>`),
    })
    class LateStyled {
      text = 'late';
    }

    @Component({
      selector: 'v-styled',
      styles: '.shell { color: red }',
      imports: [LateStyled],
      render: compileTemplate(`<main class="shell"><em>x</em>{ body }</main>`),
    })
    class Styled {
      body = boundary(() => slow.promise, {
        content: (_value: string, out: MarkupWriter) => {
          createComponent(this, 'v-late-styled', null, null, null, out);
        },
      });
    }

    const stream = renderToStream(Styled);
    const reader = stream.getReader();
    const shell = await firstChunk(reader);
    expect(shell).not.toBe(HELD);
    expect(shell).toContain('<style data-volt="v-styled">.shell { color: red }</style>');
    // The component that declares it has not been rendered yet, so there is
    // nothing to declare.
    expect(shell).not.toContain('.late');

    slow.resolve('x');
    const rest: string[] = [];
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      rest.push(decoder.decode(next.value));
    }

    // In *that* chunk, not merely somewhere in the response: a page whose
    // late styles all arrive at the end is a page that renders every streamed
    // region unstyled first, which is the flash the `<head>` used to prevent.
    const arrival = rest.find((chunk) => chunk.includes('data-volt-b="0"'));
    expect(arrival).toBeDefined();
    expect(arrival).toContain('<style data-volt="v-late-styled">.late { color: blue }</style>');
    // And once, so a page with fifty boundaries does not carry the shell's
    // stylesheet fifty times.
    expect(rest.join('').split('data-volt="v-styled"')).toHaveLength(1);
  });
});

describe('a boundary inside a boundary', () => {
  it('runs the inner work and closes the stream', async () => {
    const outer = deferred<string>();
    const inner = deferred<string>();

    @Component({
      selector: 'v-nest',
      render: compileTemplate(`<main><h1>nest</h1>{ body }</main>`),
    })
    class Nest {
      inner = boundary(() => inner.promise, {
        fallback: (out: MarkupWriter) => out.raw('<p>inner pending</p>'),
        content: (value: string, out: MarkupWriter) => out.raw(`<i>${value}</i>`),
      });

      body = boundary(() => outer.promise, {
        fallback: (out: MarkupWriter) => out.raw('<p>outer pending</p>'),
        // The inner boundary is only claimed once this runs, which is once the
        // outer work has settled and its replacement is being written.
        content: (value: string, out: MarkupWriter) => {
          out.raw(`<o>${value}</o>`);
          out.child(this.inner);
        },
      });
    }

    const stream = renderToStream(Nest);
    // Both settle before anything reads, so a stream that never closes is the
    // only way this can fail — which is exactly the shape of the defect.
    outer.resolve('outer');
    inner.resolve('inner');

    const html = await Promise.race([
      whole(stream),
      new Promise<typeof HELD>((resolve) => setTimeout(() => resolve(HELD), 3000)),
    ]);

    expect(html, 'the stream never closed').not.toBe(HELD);
    const text = html as string;
    // The outer answer replaced its own placeholder, which is the single-level
    // case and was already covered.
    expect(text).toContain('<o>outer</o>');
    // The claim under test. Writing the outer replacement is what claims the
    // inner boundary, and a claim is only a registration: the response can
    // close with the inner fallback still standing in for work that was
    // registered and never started, and every assertion above would still
    // pass. This one is what notices.
    expect(text).toContain('<i>inner</i>');
    // Its fallback went out with the shell, so the replacement is the only
    // evidence — asserting the fallback is absent would be asserting the
    // opposite of how the protocol works.
    expect(text).toContain('inner pending');
  });
});

describe('what a stream runs its passes inside', () => {
  it('runs `setup` inside the render, before the root is built', async () => {
    // Otherwise a per-request provider — the router, its outlet — has nowhere
    // to be installed, and a streamed page renders every route's default.
    const Theme = createContext('none');

    @Component({ selector: 'v-themed', render: compileTemplate(`<p>{ theme }</p>`) })
    class Themed {
      theme = useContext(Theme);
    }

    const html = await whole(renderToStream(Themed, { setup: () => provideContext(Theme, 'dark') }));

    expect(html).toContain('<p>dark</p>');
  });

  it('enters `around` for the shell, for every flush after it and for every late chunk', async () => {
    let visible = false;
    const around = <T,>(run: () => T): T => {
      const previous = visible;
      visible = true;
      try {
        return run();
      } finally {
        visible = previous;
      }
    };
    const seen: string[] = [];
    const note = (what: string): void => {
      seen.push(`${what} ${visible}`);
    };

    @Component({
      selector: 'v-streamed-spans',
      render: compileTemplate(`<main><h1>spans</h1>{ body }</main>`),
    })
    class Streamed {
      n = new Signal.State(0);

      inner = boundary(
        () => {
          note('inner work');
          return Promise.resolve('inner');
        },
        {
          content: (value: string, out: MarkupWriter) => {
            note('inner content');
            out.raw(`<i>${value}</i>`);
          },
        },
      );

      // Each of the three places a streamed page can start a call: the walk
      // and the flush that goes out with the shell, a chunk being written (a
      // component constructed in it is built there), and the flush after one
      // that starts the boundary a chunk claimed.
      body = boundary(
        () => {
          note('outer work');
          return Promise.resolve('outer');
        },
        {
          content: (value: string, out: MarkupWriter) => {
            note('outer content');
            out.raw(`<o>${value}</o>`);
            out.child(this.inner);
          },
        },
      );

      constructor() {
        note('build');
        // And the flush after a wake: data nobody declared a boundary for
        // still holds the stream open, and an effect reading it runs again
        // once it lands.
        dataEffect(() => {
          const n = this.n.get();
          note(`effect ${n}`);
          if (n === 0) {
            trackRequestData(
              Promise.resolve().then(() => {
                note('answer');
                this.n.set(1);
              }),
            );
          }
        });
      }
    }

    const html = await whole(
      renderToStream(Streamed, { setup: () => note('setup'), around }),
    );

    expect(html).toContain('<i>inner</i>');
    expect([...seen].sort()).toEqual(
      [
        'setup true',
        'build true',
        'effect 0 true',
        'outer work true',
        'answer false',
        'effect 1 true',
        'outer content true',
        'inner work true',
        'inner content true',
      ].sort(),
    );
    expect(visible).toBe(false);
  });
});
