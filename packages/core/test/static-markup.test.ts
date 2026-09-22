/**
 * The bytes a server build writes.
 *
 * Every other "server" test in this repository mounts a component into a DOM
 * and reads `innerHTML` back, which exercises the client emitter with a flag
 * flipped. This one drives `renderToStaticMarkup`, so what it asserts on is
 * what `MarkupWriter` actually produced — until now nothing did, and the whole
 * server emit path shipped without a caller or a test.
 *
 * The ordering below is load-bearing. `compileTemplate` picks its target from
 * `__VOLT_SERVER__` at the moment it is called, not at the moment the render
 * runs, so a component declared at module scope is compiled for the client
 * however the flag stands later. Every component here is therefore declared
 * inside the test that uses it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compileTemplate } from '@voltdev/core/jit';
import { Component, Prop, Signal } from '@voltdev/core';
import { renderToStaticMarkup } from '@voltdev/core/server';

function serverBuild(on: boolean): void {
  (globalThis as { __VOLT_SERVER__?: boolean }).__VOLT_SERVER__ = on;
}

beforeAll(() => serverBuild(true));
afterAll(() => serverBuild(false));

describe('what it writes', () => {
  it('writes a component to markup without a DOM', async () => {
    @Component({ selector: 'v-plain', render: compileTemplate(`<p>body</p>`) })
    class Plain {}

    expect((await renderToStaticMarkup(Plain)).html).toBe('<p>body</p>');
  });

  it('writes an interpolated value where the hole is', async () => {
    @Component({ selector: 'v-greet', render: compileTemplate(`<p>Hello, { name.get() }.</p>`) })
    class Greet {
      name = new Signal.State('world');
    }

    expect((await renderToStaticMarkup(Greet)).html).toBe('<p>Hello, world.</p>');
  });

  it('writes a void element without a closing tag', async () => {
    @Component({ selector: 'v-void', render: compileTemplate(`<div><br><img src="a.png" alt=""></div>`) })
    class Void {}

    const { html } = await renderToStaticMarkup(Void);
    expect(html).not.toContain('</br>');
    expect(html).not.toContain('</img>');
  });

  it('takes the branch a condition selects, and writes nothing for the other', async () => {
    @Component({
      selector: 'v-cond',
      render: compileTemplate(`<div><b :if="yes.get()">in</b><i :if="no.get()">out</i></div>`),
    })
    class Cond {
      yes = new Signal.State(true);
      no = new Signal.State(false);
    }

    const { html } = await renderToStaticMarkup(Cond);
    expect(html).toContain('<b>in</b>');
    expect(html).not.toContain('out');
  });

  it('writes one run of markup per row of a list', async () => {
    @Component({
      selector: 'v-list',
      render: compileTemplate(`<ul><li :for="n in ns.get()" :key="n">{ n }</li></ul>`),
    })
    class List {
      ns = new Signal.State([1, 2, 3]);
    }

    const { html } = await renderToStaticMarkup(List);
    expect(html.match(/<li/g)).toHaveLength(3);
    expect(html.replace(/<[^>]+>/g, '')).toBe('123');
  });

  it('writes the props a parent passed', async () => {
    @Component({ selector: 'v-titled', render: compileTemplate(`<h1>{ title }</h1>`) })
    class Titled {
      @Prop() title = 'untitled';
    }

    const { html } = await renderToStaticMarkup(Titled, { props: { title: 'given' } });
    expect(html).toBe('<h1>given</h1>');
  });
});

describe('what it refuses to write', () => {
  // The writer is producing bytes rather than setting `textContent`, so
  // nothing downstream will escape these for it.
  it('escapes markup in an interpolated value rather than emitting it', async () => {
    @Component({ selector: 'v-xss', render: compileTemplate(`<p>{ evil.get() }</p>`) })
    class Xss {
      evil = new Signal.State('<script>alert(1)</script>');
    }

    const { html } = await renderToStaticMarkup(Xss);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;');
  });

  it('escapes a quote in an attribute value, which would otherwise end the attribute', async () => {
    @Component({ selector: 'v-attr', render: compileTemplate(`<p :title="evil.get()">x</p>`) })
    class Attr {
      evil = new Signal.State('" onmouseover="alert(1)');
    }

    const { html } = await renderToStaticMarkup(Attr);
    expect(html).not.toContain('onmouseover="alert(1)"');
    expect(html).toContain('&quot;');
  });

  it('refuses to run at all in a client build, since the render functions differ', async () => {
    @Component({ selector: 'v-side', render: compileTemplate(`<p>body</p>`) })
    class Side {}

    serverBuild(false);
    try {
      await expect(renderToStaticMarkup(Side)).rejects.toThrow(/needs a server build/);
    } finally {
      serverBuild(true);
    }
  });
});

describe('what a caller wrote on a component tag', () => {
  it('is written into the element the template marks, with its own class kept', async () => {
    @Component({
      selector: 'v-button',
      render: compileTemplate(`<button :host class="volt-button" type="button"><slot></slot></button>`),
    })
    class Button {}

    @Component({
      selector: 'v-page',
      imports: [Button],
      render: compileTemplate(`<v-button class="wide" aria-label="Save" id="go">Go</v-button>`),
    })
    class Page {}

    const { html } = await renderToStaticMarkup(Page);
    expect(html).toContain('aria-label="Save"');
    expect(html).toContain('id="go"');
    expect(html).toMatch(/class="[^"]*volt-button[^"]*"/);
    expect(html).toMatch(/class="[^"]*wide[^"]*"/);
    expect(html).toContain('>Go<');
  });

  it('composes with the element’s own spread rather than replacing it', async () => {
    @Component({
      selector: 'v-panel',
      render: compileTemplate(`<div :host class="panel" :spread="own()"><slot></slot></div>`),
    })
    class Panel {
      own(): Record<string, unknown> {
        return { role: 'region', class: 'own' };
      }
    }

    @Component({
      selector: 'v-page',
      imports: [Panel],
      render: compileTemplate(`<v-panel class="wide" data-test="x">body</v-panel>`),
    })
    class Page {}

    const { html } = await renderToStaticMarkup(Page);
    expect(html).toContain('role="region"');
    expect(html).toContain('data-test="x"');
    for (const name of ['panel', 'own', 'wide']) {
      expect(html).toMatch(new RegExp(`class="[^"]*${name}[^"]*"`));
    }
  });
});
