/**
 * `renderToString`: the walk, the payload it carries, and the answer it gives
 * when the render did not finish.
 *
 * Three claims are worth a test each, and they fail in different ways.
 *
 * The bytes are the static walk's bytes — the segment tree is the primitive
 * and this is a second consumer of the finished one, so a difference here
 * would mean two emitters again and hydration defined against whichever one
 * ran.
 *
 * The payload is a **security boundary**. Anything a server puts in a page is
 * markup, and a value that came from a database is the least trustworthy thing
 * on it; so the adversarial cases below are not a survey of hostile strings
 * but the three specific ways script content can be escaped from — `</script>`,
 * the `<!--` tokenizer trap, and the JS-only line terminators — each asserted
 * inert by parsing the page the server would have sent and looking at what the
 * parser made of it, rather than by matching on the bytes.
 *
 * And a render that threw has no page. What is asserted there is the absence:
 * `html` is null, not a prefix of a page, whether the throw came out of the
 * walk or was swallowed by the error channel on its way to a console nobody
 * reads.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { compile } from '@voltdev/compiler';
import { compileTemplate } from '@voltdev/core/jit';
import {
  Component,
  STATE_ATTRIBUTE,
  Signal,
  createRoot,
  dataEffect,
  flushSync,
  hydratable,
  onCleanup,
  onError,
  trackRequestData,
  wasHydrated,
  type RenderFn,
} from '@voltdev/core';
import * as runtime from '@voltdev/core/runtime';
import {
  renderToStaticMarkup,
  renderToString,
  stateScript,
  type RenderedPage,
} from '@voltdev/core/server';

function serverBuild(on: boolean): void {
  (globalThis as { __VOLT_SERVER__?: boolean }).__VOLT_SERVER__ = on;
}

/** A render that must have succeeded, narrowed so the fields are readable. */
async function page(
  ...args: Parameters<typeof renderToString>
): Promise<RenderedPage> {
  const rendered = await renderToString(...args);
  if (rendered.status !== 200) throw rendered.error;
  return rendered;
}

/** The page as a browser would have it, which is the only honest reader. */
function parse(html: string): Document {
  return new DOMParser().parseFromString(
    `<!doctype html><html><body>${html}</body></html>`,
    'text/html',
  );
}

/** What the payload element carries, as JSON, from a parsed page. */
function payloadOf(doc: Document): unknown {
  const script = doc.querySelector(`script[${STATE_ATTRIBUTE}]`);
  return script === null ? null : JSON.parse(script.textContent ?? '');
}

beforeEach(() => {
  serverBuild(true);
  document.body.innerHTML = '';
});

afterEach(() => serverBuild(false));

describe('the page a render answers with', () => {
  it('writes the bytes the static walk writes, hole delimiters and all', async () => {
    @Component({
      selector: 'v-same',
      // Siblings on both sides of the hole: a lone dynamic child needs no
      // delimiters at all — the binding owns everything between the tags —
      // and eliding them there is a hydration win rather than an omission.
      render: compileTemplate(
        `<div><header>top</header><b :if="on.get()">{ label.get() }</b><footer>end</footer></div>`,
      ),
    })
    class Same {
      on = new Signal.State(true);
      label = new Signal.State('here');
    }

    const rendered = await page(Same);
    const stat = await renderToStaticMarkup(Same);

    expect(rendered.html).toBe(stat.html);
    // The delimiters are the writer's, which is what makes the two the same
    // walk: hydration steps by them, and the static consumer pays for them.
    expect(rendered.html).toContain('<!--[-->');
    expect(rendered.html).toContain('<!--]-->');
    expect(rendered.status).toBe(200);
    expect(rendered.error).toBeNull();
  });

  it('carries no state element at all when the page has no state', async () => {
    @Component({ selector: 'v-bare', render: compileTemplate(`<p>bare</p>`) })
    class Bare {}

    expect((await page(Bare)).state).toBe('');
  });

  it('still hands back the styles the request collected', async () => {
    @Component({
      selector: 'v-dressed',
      styles: '.dressed { color: red }',
      render: compileTemplate(`<p class="dressed">body</p>`),
    })
    class Dressed {}

    expect([...(await page(Dressed)).styles]).toEqual([['v-dressed', '.dressed { color: red }']]);
  });

  it('refuses to run in a client build rather than answering 500', async () => {
    @Component({ selector: 'v-wrongside', render: compileTemplate(`<p>x</p>`) })
    class WrongSide {}

    serverBuild(false);
    // A throw, because this is not one request failing: it is the wrong
    // bundle, and it will fail identically for every request after it.
    await expect(renderToString(WrongSide)).rejects.toThrow(/needs a server build/);
  });
});

describe('the state it carries', () => {
  it('sends the value the markup was rendered from', async () => {
    @Component({ selector: 'v-cart', render: compileTemplate(`<p>{ total.get() }</p>`) })
    class Cart {
      total = hydratable('cart.total', () => 42);
    }

    const rendered = await page(Cart);

    expect(rendered.html).toBe('<p>42</p>');
    expect(payloadOf(parse(rendered.state))).toEqual({ 'cart.total': 42 });
  });

  it('sends the value the request settled on, not the one the walk saw', async () => {
    // The pre-streaming shape, and the reason the payload is read after
    // `settleRequest` rather than during the walk: bytes already written
    // cannot be revisited, so the markup shows the loading state — but the
    // client hydrates straight into the answer instead of asking for it.
    @Component({ selector: 'v-late', render: compileTemplate(`<p>{ n.get() }</p>`) })
    class Late {
      n = hydratable<number | null>('late', () => null);
      constructor() {
        trackRequestData(Promise.resolve(7).then((value) => this.n.set(value)));
      }
    }

    const rendered = await page(Late);

    expect(rendered.html).toBe('<p></p>');
    expect(payloadOf(parse(rendered.state))).toEqual({ late: 7 });
  });

  it('leaves out a key the server has nothing for', async () => {
    @Component({ selector: 'v-empty', render: compileTemplate(`<p>x</p>`) })
    class Empty {
      missing = hydratable<string | undefined>('missing', () => undefined);
    }

    // Not `{"missing":null}`: null is a value a client would read as real,
    // and there is nothing here to read.
    expect((await page(Empty)).state).toBe('');
  });

  it('takes a nonce, because a page under a CSP ships no state without one', async () => {
    @Component({ selector: 'v-nonced', render: compileTemplate(`<p>{ v.get() }</p>`) })
    class Nonced {
      v = hydratable('v', () => 1);
    }

    const rendered = await page(Nonced, { nonce: 'r4nd0m' });
    const script = parse(rendered.state).querySelector('script')!;

    expect(script.getAttribute('nonce')).toBe('r4nd0m');
    expect(script.getAttribute('type')).toBe('application/json');
  });

  it('answers 500 when one key would carry two signals', async () => {
    @Component({ selector: 'v-twice', render: compileTemplate(`<p>x</p>`) })
    class Twice {
      a = hydratable('same', () => 1);
      b = hydratable('same', () => 2);
    }

    const rendered = await renderToString(Twice);

    expect(rendered.status).toBe(500);
    expect(rendered.html).toBeNull();
    expect((rendered.error as Error).message).toMatch(/hydratable under the key "same"/);
  });

  it('answers 500 for a value JSON would carry wrongly, naming the key', async () => {
    @Component({ selector: 'v-nan', render: compileTemplate(`<p>x</p>`) })
    class NotANumber {
      ratio = hydratable('ratio', () => Number.NaN);
    }

    const rendered = await renderToString(NotANumber);

    expect(rendered.status).toBe(500);
    expect((rendered.error as Error).message).toMatch(/"ratio"/);
    // The reason, rather than a shrug: null is what JSON would have written,
    // and the client cannot tell that from a null the server meant.
    expect((rendered.error as Error).message).toMatch(/null/);
  });

  it('answers 500 for a bigint and for a function, rather than dropping them', async () => {
    @Component({ selector: 'v-big', render: compileTemplate(`<p>x</p>`) })
    class Big {
      id = hydratable('id', () => 9007199254740993n);
    }

    @Component({ selector: 'v-fn', render: compileTemplate(`<p>x</p>`) })
    class Fn {
      go = hydratable<unknown>('go', () => ({ nested: () => 1 }));
    }

    expect((await renderToString(Big)).status).toBe(500);
    const fn = await renderToString(Fn);
    expect(fn.status).toBe(500);
    expect((fn.error as Error).message).toMatch(/"go"/);
  });

  it('keeps one request out of another request\u2019s payload', async () => {
    const after = (ms: number): Promise<void> =>
      new Promise((resolve) => setTimeout(resolve, ms));

    // The same key in both, which is the case a process-wide registry would
    // fail loudest on: it would refuse the second render outright, and before
    // that it would have put the first page's value in the second page.
    @Component({ selector: 'v-iso-a', render: compileTemplate(`<p>a</p>`) })
    class A {
      n = hydratable('n', () => 0);
      constructor() {
        trackRequestData(after(5).then(() => this.n.set(1)));
      }
    }

    @Component({ selector: 'v-iso-b', render: compileTemplate(`<p>b</p>`) })
    class B {
      n = hydratable('n', () => 0);
      constructor() {
        trackRequestData(after(0).then(() => this.n.set(2)));
      }
    }

    // Started together and settled out of order, which is the interleaving
    // that shares a scope if anything does.
    const [first, second] = await Promise.all([page(A), page(B)]);

    expect(payloadOf(parse(first.state))).toEqual({ n: 1 });
    expect(payloadOf(parse(second.state))).toEqual({ n: 2 });
  });

  it('refuses a hole in an array and allows one in an object, which JSON treats differently', () => {
    // The distinction is the whole reason the refusal reads `this`: in an
    // array the drop becomes a `null` in a position that had a hole, and the
    // client indexes into it; in an object the key simply is not there, which
    // reads back as `undefined` exactly as it did on the server.
    expect(() => stateScript({ rows: [1, undefined, 3] })).toThrow(/"rows"/);

    const doc = parse(stateScript({ row: { a: 1, b: undefined } }));
    expect(payloadOf(doc)).toEqual({ row: { a: 1 } });
  });
});

/**
 * The adversarial half.
 *
 * Every case here is asserted against a *parsed* page rather than against the
 * bytes, because the question is never "did we escape it" but "what did the
 * parser do with it" — and the two only agree while the escaping is right.
 */
describe('a value in the payload is inert in the page', () => {
  const HOSTILE = {
    ender: '</script><img src=x onerror="boom()">',
    // Puts an HTML tokenizer into script-data-escaped state, where the next
    // `</script>` closes nothing and the rest of the document is swallowed.
    comment: '<!--<script>',
    separators: 'before after end',
    surrogate: 'lone \ud800 half',
    ampersand: 'Smith & Co',
  };

  it('escapes every `<`, which is what the other three cases rest on', () => {
    const html = stateScript(HOSTILE);
    const json = html.slice(html.indexOf('>') + 1, html.lastIndexOf('</script>'));

    expect(json).not.toContain('<');
    expect(json).toContain('\\u003C');
    // And the JS-only line terminators, which are legal in JSON and a syntax
    // error the moment anything copies this into a script.
    expect(json).not.toContain(' ');
    expect(json).not.toContain(' ');
    expect(json).toContain('\\u2028');
  });

  it('ends the element where the server ended it, not where the value did', () => {
    const doc = parse(`${stateScript(HOSTILE)}<p id="after">after</p>`);

    // One script, no injected element, and the markup after the payload is
    // still the document's — the three things `</script>` and `<!--<script>`
    // each break in a different way.
    expect(doc.querySelectorAll('script')).toHaveLength(1);
    expect(doc.querySelector('img')).toBeNull();
    expect(doc.getElementById('after')?.textContent).toBe('after');
  });

  it('gives the client back exactly the string the server had', () => {
    const doc = parse(stateScript(HOSTILE));
    expect(payloadOf(doc)).toEqual(HOSTILE);

    // Spelled out for the two that JSON and the DOM each have their own way of
    // mangling: an unpaired surrogate, which only a well-formed stringify
    // survives, and an ampersand, which is raw text here and an entity in
    // every other position a server writes.
    const back = payloadOf(doc) as typeof HOSTILE;
    expect(back.surrogate.codePointAt(5)).toBe(0xd800);
    expect(back.ampersand).toBe('Smith & Co');
  });

  it('escapes a hostile key as well as a hostile value', () => {
    // Keys go through `JSON.stringify` and then the same escape as the rest of
    // the document, so there is no second rule to keep in step — asserted
    // because a key is the half of a payload nobody thinks of as data.
    const doc = parse(stateScript({ '</script><img src=x onerror="boom()">': 1 }));

    expect(doc.querySelectorAll('script')).toHaveLength(1);
    expect(doc.querySelector('img')).toBeNull();
    expect(payloadOf(doc)).toEqual({ '</script><img src=x onerror="boom()">': 1 });
  });

  it('does not let a nonce break out of its own attribute', () => {
    const nonce = 'abc"><script>boom()</script>';
    const doc = parse(stateScript({ v: 1 }, { nonce }));

    expect(doc.querySelectorAll('script')).toHaveLength(1);
    expect(doc.querySelector('script')!.getAttribute('nonce')).toBe(nonce);
  });
});

describe('the client starts from what the server sent', () => {
  /** Put a rendered page into this document, as a browser's parser would. */
  function serve(rendered: RenderedPage): HTMLElement {
    document.body.innerHTML = `<div id="app">${rendered.html}</div>${rendered.state}`;
    serverBuild(false);
    return document.getElementById('app')!;
  }

  @Component({ selector: 'v-adopt', render: compileTemplate(`<p>x</p>`) })
  class Held {
    n = hydratable('n', () => 1);
    nothing = hydratable<string | null>('nothing', () => null);
  }

  it('adopts the value under its key, and says that it did', async () => {
    serve(await page(Held));

    const n = hydratable('n', () => 0);
    expect(n.get()).toBe(1);
    expect(wasHydrated(n)).toBe(true);
  });

  it('adopts a null the server meant, rather than falling back', async () => {
    serve(await page(Held));

    const nothing = hydratable<string | null>('nothing', () => 'default');
    expect(nothing.get()).toBeNull();
    expect(wasHydrated(nothing)).toBe(true);
  });

  it('starts at its default for a key no payload carried', async () => {
    serve(await page(Held));

    const other = hydratable('never-sent', () => 'default');
    expect(other.get()).toBe('default');
    expect(wasHydrated(other)).toBe(false);
  });

  it('does not fetch what it arrived with, and does fetch what it did not', async () => {
    serve(await page(Held));

    // What `createResource(load, { data, immediate: !wasHydrated(data) })`
    // comes to: the whole point of the payload is this call count.
    let fetches = 0;
    const load = (): number => ++fetches;

    const adopted = hydratable('n', () => 0);
    if (!wasHydrated(adopted)) adopted.set(load());
    expect(fetches).toBe(0);
    expect(adopted.get()).toBe(1);

    const missing = hydratable('absent', () => 0);
    if (!wasHydrated(missing)) missing.set(load());
    expect(fetches).toBe(1);
  });

  it('reads the second page rather than answering from the first', async () => {
    serve(await page(Held));
    expect(hydratable('n', () => 0).get()).toBe(1);

    serverBuild(true);
    @Component({ selector: 'v-adopt-2', render: compileTemplate(`<p>x</p>`) })
    class Second {
      n = hydratable('n', () => 99);
    }
    serve(await page(Second));

    expect(hydratable('n', () => 0).get()).toBe(99);
  });

  it('falls back to defaults when the payload was cut short in transit', async () => {
    const rendered = await page(Held);
    // A truncated response: the element is there, its content is not JSON.
    serve({ ...rendered, state: rendered.state.replace('}</script>', '</script>') });

    const n = hydratable('n', () => 0);
    expect(n.get()).toBe(0);
    expect(wasHydrated(n)).toBe(false);
  });

  it('hydrates the markup the server wrote without painting over it', async () => {
    const SOURCE = `<p>{ total.get() }</p>`;

    @Component({ selector: 'v-round', render: compileTemplate(SOURCE) })
    class Round {
      total = hydratable('cart.total', () => 42);
    }

    const rendered = await page(Round);
    const host = serve(rendered);
    const text = host.querySelector('p')!.firstChild!;

    const { body } = compile(SOURCE, { runtime: '_rt', target: 'hydrate' });
    const render = (new Function('_rt', body) as (rt: unknown) => RenderFn)(runtime);
    // The client's own default is the loading value, which is the case worth
    // testing: without the payload this is what would be painted over the
    // server's answer.
    const total = hydratable('cart.total', () => 0);
    createRoot(() => {
      runtime.hydrate(host, () => render({ total }));
    });

    expect(host.querySelector('p')!.firstChild).toBe(text);
    expect((text as Text).data).toBe('42');

    total.set(43);
    flushSync();
    expect((text as Text).data).toBe('43');
  });

  it('paints over it when the payload is missing, which is what adoption prevents', async () => {
    const SOURCE = `<p>{ total.get() }</p>`;

    @Component({ selector: 'v-round-2', render: compileTemplate(SOURCE) })
    class Round {
      total = hydratable('cart.total', () => 42);
    }

    const rendered = await page(Round);
    // The same page with the state element stripped — a CSP without a nonce,
    // a proxy that rewrites, a shell that forgot to write it out.
    const host = serve({ ...rendered, state: '' });

    const { body } = compile(SOURCE, { runtime: '_rt', target: 'hydrate' });
    const render = (new Function('_rt', body) as (rt: unknown) => RenderFn)(runtime);
    const total = hydratable('cart.total', () => 0);
    createRoot(() => {
      runtime.hydrate(host, () => render({ total }));
    });

    expect(host.querySelector('p')!.textContent).toBe('0');
  });
});

describe('a render that did not finish has no page', () => {
  it('answers 500 for a throw out of the walk, with nothing half-written', async () => {
    const failed = new Error('no');

    @Component({
      selector: 'v-throws',
      render: compileTemplate(`<div><span>before</span><b>{ boom() }</b></div>`),
    })
    class Throws {
      boom(): string {
        throw failed;
      }
    }

    const rendered = await renderToString(Throws);

    expect(rendered.status).toBe(500);
    expect(rendered.error).toBe(failed);
    // Not "before" and half a div: the writer's bytes go with it.
    expect(rendered.html).toBeNull();
  });

  it('answers 500 for an error the effect channel would have swallowed', async () => {
    const failed = new Error('in an effect');

    @Component({ selector: 'v-effect-throws', render: compileTemplate(`<p>fine</p>`) })
    class EffectThrows {
      constructor() {
        // Caught by the scheduler and reported, never rethrown — so without a
        // boundary on the render's root this is a 200 with a hole in it.
        dataEffect(() => {
          throw failed;
        });
      }
    }

    const rendered = await renderToString(EffectThrows);

    expect(rendered.status).toBe(500);
    expect(rendered.error).toBe(failed);
    expect(rendered.html).toBeNull();
  });

  it('still sends the page when the application recovered from the error itself', async () => {
    const seen: unknown[] = [];

    @Component({ selector: 'v-recovers', render: compileTemplate(`<p>fine</p>`) })
    class Recovers {
      constructor() {
        // A component that declares itself a boundary sits below the render's
        // root, so what it swallows never reaches the answer.
        onError((error) => seen.push(error));
        dataEffect(() => {
          throw new Error('handled');
        });
      }
    }

    const rendered = await renderToString(Recovers);

    expect(seen).toHaveLength(1);
    expect(rendered.status).toBe(200);
    expect((rendered as RenderedPage).html).toBe('<p>fine</p>');
  });

  it('disposes what the failed render created', async () => {
    const cleaned: string[] = [];

    @Component({
      selector: 'v-leaky',
      render: compileTemplate(`<main><v-leaky-boom></v-leaky-boom></main>`),
      imports: () => [LeakyBoom],
    })
    class Leaky {
      constructor() {
        onCleanup(() => cleaned.push('leaky'));
      }
    }

    @Component({ selector: 'v-leaky-boom', render: compileTemplate(`<i>never</i>`) })
    class LeakyBoom {
      constructor() {
        throw new Error('nope');
      }
    }

    expect((await renderToString(Leaky)).status).toBe(500);
    // A request that failed still owns every effect it managed to create, and
    // one left observing per failure is the shape of leak that only appears
    // once something is already going wrong.
    expect(cleaned).toEqual(['leaky']);
  });
});
