/**
 * `<v-code>`, driven the way a page drives it.
 *
 * When a block becomes a region, and what it is called then, is `createCode`'s
 * and is tested where it lives; putting text on the clipboard is
 * `createClipboard`'s. What is left here is what the tag adds: the two shapes
 * and the content drawn as it was written, the copy button and the words on
 * it, the gutter and the lines it counts, the classes and attributes the
 * sheet's rules select on, what a caller writes landing on the element with
 * the role, every prop it forwards doing something, and the primitive left
 * reachable for everything it does not offer.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Component, Signal, flushSync, mount } from '@voltdev/core';
import { compileTemplate } from '@voltdev/core/jit';
import { renderToStaticMarkup } from '@voltdev/core/server';
import { createLocaleProvider, resetAnnouncer } from '@voltdev/primitives';
import { compileComponents } from './render.js';
import { VCode, type CodeWording } from '../src/components/code.js';
import template from '../src/components/code.html?raw';
import { codeClasses, codeStyles } from '../src/sheet/code.js';
import { componentCss } from '../src/stylesheet.js';
import { primitiveTokens, tokensCss } from '../src/tokens.js';

compileComponents();

let unmount: (() => void) | null = null;
let restores: (() => void)[] = [];

afterEach(() => {
  unmount?.();
  unmount = null;
  for (let i = restores.length - 1; i >= 0; i--) restores[i]!();
  restores = [];
  vi.restoreAllMocks();
  vi.useRealTimers();
  resetAnnouncer();
  document.body.innerHTML = '';
});

function show<T>(component: new () => T): { instance: T; host: HTMLElement } {
  const host = document.createElement('div');
  document.body.append(host);
  const handle = mount(component, host);
  unmount = handle.unmount;
  flushSync();
  return { instance: handle.instance as T, host };
}

/** The sheet's own rules in the document, for what has to be measured. */
function withSheet(): void {
  const style = document.createElement('style');
  style.textContent = `${tokensCss()}\n\n${componentCss(codeStyles)}`;
  document.head.append(style);
  restores.push(() => style.remove());
}

/**
 * Every block wider than its box, as the primitive measures it. A test
 * document lays nothing out, so every box is zero wide and nothing ever
 * scrolls without this.
 */
function overflowing(when: () => boolean = () => true): void {
  vi.spyOn(Element.prototype, 'scrollWidth', 'get').mockImplementation(function (this: Element) {
    return this.classList.contains('volt-code-block') && when() ? 900 : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(400);
}

/**
 * Every block taller than its box, as a block given a height from the tag is
 * once its lines run past it. The same measuring as `overflowing`, downwards.
 */
function towering(when: () => boolean = () => true): void {
  vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockImplementation(function (this: Element) {
    return this.classList.contains('volt-code-block') && when() ? 900 : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(320);
}

/** Let a change to the code reach the frame it is measured in, and draw what that changed. */
async function remeasured(): Promise<void> {
  await settled();
  await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
  flushSync();
}

/** A clipboard that takes whatever it is given, and says what that was. */
function clipboard(): ReturnType<typeof vi.fn> {
  const write = vi.fn(async (_text: string) => {});
  vi.spyOn(navigator.clipboard, 'writeText').mockImplementation(write);
  return write;
}

/** Let a copy's promise, or a mutation's report, settle, and draw what it changed. */
async function settled(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  flushSync();
}

/** What the page's live region of that priority is saying. */
function heard(priority: 'polite' | 'assertive'): string {
  return document.querySelector(`[data-volt-announcer="${priority}"]`)?.textContent ?? '';
}

const pre = (host: HTMLElement): HTMLElement => host.querySelector('pre')!;
const content = (host: HTMLElement): HTMLElement => host.querySelector('.volt-code-content')!;
const inline = (host: HTMLElement): HTMLElement => host.querySelector('.volt-code')!;
const button = (host: HTMLElement): HTMLButtonElement | null => host.querySelector('.volt-code-copy');
const rows = (host: HTMLElement): string[] =>
  [...host.querySelectorAll('.volt-code-line')].map((row) => row.textContent ?? '');

const SOURCE = 'function total(items) {\n  return items.reduce((sum, item) => sum + item, 0);\n}\n';

@Component({
  selector: 'v-sample-page',
  imports: [VCode],
  render: compileTemplate(`
    <v-code
      block
      :ref="box"
      :language="language.get()"
      :copyable="copyable.get()"
      :wrap="wrap.get()"
      :lineNumbers="numbered.get()"
      :labels="labels.get()"
    >{ source.get() }</v-code>
  `),
})
class Sample {
  box: VCode | null = null;
  source = new Signal.State(SOURCE);
  language = new Signal.State<string | undefined>('TypeScript');
  copyable = new Signal.State(false);
  wrap = new Signal.State(false);
  numbered = new Signal.State(false);
  labels = new Signal.State<CodeWording | undefined>(undefined);
}

describe('v-code, inline', () => {
  @Component({
    selector: 'v-sentence-page',
    imports: [VCode],
    render: compileTemplate(`
      <p>Call <v-code :language="language.get()">Array.prototype.at</v-code> with a negative index.</p>
    `),
  })
  class Sentence {
    language = new Signal.State<string | undefined>(undefined);
  }

  it('draws a run of code as one `<code>`, holding what was written', () => {
    const { host } = show(Sentence);
    const code = inline(host);

    expect(code.tagName).toBe('CODE');
    expect(code.getAttribute('role')).toBe('code');
    expect(code.textContent).toBe('Array.prototype.at');
    expect(code.parentElement!.tagName).toBe('P');
    // None of a block's parts: no box, no button, no gutter.
    expect(host.querySelector('pre')).toBeNull();
    expect(host.querySelectorAll('button, .volt-code-lines')).toHaveLength(0);
    expect(code.hasAttribute('data-language')).toBe(false);
    // And no tab stop: a run in a sentence never scrolls on its own.
    expect(code.hasAttribute('tabindex')).toBe(false);
  });

  it('writes the language for a highlighter or a rule to find, and follows a signal', () => {
    const { instance, host } = show(Sentence);

    instance.language.set('JavaScript');
    flushSync();
    expect(inline(host).dataset['language']).toBe('JavaScript');

    instance.language.set('Rust');
    flushSync();
    expect(inline(host).dataset['language']).toBe('Rust');

    instance.language.set(undefined);
    flushSync();
    expect(inline(host).hasAttribute('data-language')).toBe(false);
  });

  it('lands what the caller wrote on the `<code>`, which is the element with the role', () => {
    @Component({
      selector: 'v-written-page',
      imports: [VCode],
      render: compileTemplate(`
        <p>Run <v-code
          :language="language.get()"
          class="mine"
          id="command"
          title="A shell command"
          lang="en"
          data-hint="shell"
          aria-describedby="note"
        >rm -rf dist</v-code>.</p>
        <p id="note">Deletes the build.</p>
      `),
    })
    class Written {
      language = new Signal.State('bash');
    }

    const { instance, host } = show(Written);
    const code = inline(host);
    expect([...code.classList].sort()).toEqual(['mine', 'volt-code']);
    expect(code.id).toBe('command');
    expect(code.title).toBe('A shell command');
    expect(code.lang).toBe('en');
    expect(code.dataset['hint']).toBe('shell');
    expect(code.getAttribute('aria-describedby')).toBe('note');

    // Still all theirs once the primitive's bag has been written again.
    instance.language.set('zsh');
    flushSync();
    expect([...code.classList].sort()).toEqual(['mine', 'volt-code']);
    expect(code.id).toBe('command');
    expect(code.getAttribute('aria-describedby')).toBe('note');
    expect(code.dataset['language']).toBe('zsh');
  });

  it('says so when it is handed what only a block can draw, and draws none of it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    @Component({
      selector: 'v-misplaced-page',
      imports: [VCode],
      render: compileTemplate(`
        <p><v-code copyable :lineNumbers="numbered.get()">npm test</v-code></p>
        <p><v-code>npm run build</v-code></p>
      `),
    })
    class Misplaced {
      numbered = new Signal.State(true);
    }

    const { instance, host } = show(Misplaced);
    expect(host.querySelectorAll('button, .volt-code-lines, [data-line-numbers]')).toHaveLength(0);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toMatch(/`copyable` and `lineNumbers` on an inline <v-code>/);

    // Once, rather than again every time one of them changes.
    instance.numbered.set(false);
    flushSync();
    instance.numbered.set(true);
    flushSync();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('says so when it is handed a name, which a run of code cannot carry', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    @Component({
      selector: 'v-named-run-page',
      imports: [VCode],
      render: compileTemplate(`
        <p><v-code label="The at method">Array.prototype.at</v-code></p>
        <p><v-code aria-label="The last item">items.at(-1)</v-code></p>
        <p><v-code label="   ">x</v-code></p>
      `),
    })
    class NamedRun {}

    const { host } = show(NamedRun);
    // ARIA prohibits naming `role="code"`, so neither lands — and nothing
    // anywhere said why until this did.
    expect(host.querySelector('[aria-label]')).toBeNull();
    expect(warn).toHaveBeenCalledTimes(2);
    expect(String(warn.mock.calls[0]![0])).toMatch(/`label` on an inline <v-code>/);
    expect(String(warn.mock.calls[1]![0])).toMatch(/`aria-label` on an inline <v-code>/);
  });

  it('keeps a role the caller wrote, rather than writing the primitive’s over it', () => {
    @Component({
      selector: 'v-role-run-page',
      imports: [VCode],
      render: compileTemplate(
        `<p><v-code :role="role.get()" :language="language.get()">grid</v-code></p>`,
      ),
    })
    class RoleRun {
      role = new Signal.State<string | undefined>('term');
      language = new Signal.State('css');
    }

    const { instance, host } = show(RoleRun);
    expect(inline(host).getAttribute('role')).toBe('term');
    instance.language.set('scss');
    flushSync();
    expect(inline(host).getAttribute('role')).toBe('term');
    expect(inline(host).dataset['language']).toBe('scss');

    // Bound, it follows; and with none, the primitive's stands again.
    instance.role.set('definition');
    flushSync();
    expect(inline(host).getAttribute('role')).toBe('definition');
    instance.role.set(undefined);
    flushSync();
    expect(inline(host).getAttribute('role')).toBe('code');
  });

  it('reads `block="false"` as the inline code it says', () => {
    @Component({
      selector: 'v-false-page',
      imports: [VCode],
      render: compileTemplate(`<p><v-code block="false">x</v-code></p>`),
    })
    class FalsePage {}

    const { host } = show(FalsePage);
    expect(host.querySelector('pre')).toBeNull();
    expect(inline(host).textContent).toBe('x');
  });
});

describe('v-code, a block', () => {
  it('draws a `<pre>` around a `<code>`, holding the code exactly as it was written', () => {
    const { host } = show(Sample);
    const box = pre(host);

    expect(box.classList.contains('volt-code-block')).toBe(true);
    expect(content(host).tagName).toBe('CODE');
    expect(content(host).parentElement).toBe(box);
    expect(content(host).getAttribute('role')).toBe('code');
    // Every newline and every space of indentation, which is the whole of
    // what a block of code is for.
    expect(content(host).textContent).toBe(SOURCE);
    // And nothing of the template's own between the parts: a `<pre>` draws
    // every space it holds.
    expect([...box.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE)).toEqual([]);
    // The primitive's marks, on the box and on the code.
    expect(box.hasAttribute('data-block')).toBe(true);
    expect(box.dataset['language']).toBe('TypeScript');
    expect(content(host).dataset['language']).toBe('TypeScript');
  });

  it('is no tab stop and no region while the code fits', () => {
    const { instance, host } = show(Sample);
    const box = pre(host);

    expect(box.hasAttribute('tabindex')).toBe(false);
    expect(box.hasAttribute('role')).toBe(false);
    expect(box.hasAttribute('aria-label')).toBe(false);
    expect(instance.box!.code.isScrollable()).toBe(false);
  });

  it('becomes a named region a keyboard can reach once it is wider than its box', () => {
    overflowing();
    const { instance, host } = show(Sample);
    const box = pre(host);

    expect(box.getAttribute('tabindex')).toBe('0');
    expect(box.getAttribute('role')).toBe('region');
    expect(box.getAttribute('aria-label')).toBe('Code, TypeScript');
    // Reachable, which is what lets the arrow keys scroll it at all.
    box.focus();
    expect(document.activeElement).toBe(box);
    expect(instance.box!.code.isScrollable()).toBe(true);

    // The name follows the language, and without one says only what it is.
    instance.language.set('Rust');
    flushSync();
    expect(box.getAttribute('aria-label')).toBe('Code, Rust');
    expect(box.dataset['language']).toBe('Rust');
    expect(content(host).dataset['language']).toBe('Rust');
    instance.language.set(undefined);
    flushSync();
    expect(box.getAttribute('aria-label')).toBe('Code');
    expect(box.hasAttribute('data-language')).toBe(false);
  });

  it('names the region with `label`, and follows a label bound to a signal', () => {
    @Component({
      selector: 'v-labelled-page',
      imports: [VCode],
      render: compileTemplate(`<v-code block language="bash" :label="label.get()">npm ci</v-code>`),
    })
    class Labelled {
      label = new Signal.State<string | undefined>('Install the dependencies');
    }

    overflowing();
    const { instance, host } = show(Labelled);
    expect(pre(host).getAttribute('aria-label')).toBe('Install the dependencies');

    instance.label.set('Install exactly what the lockfile says');
    flushSync();
    expect(pre(host).getAttribute('aria-label')).toBe('Install exactly what the lockfile says');

    // An empty name is no name, and neither is one of blanks: the
    // primitive's stands, rather than a tab stop called nothing.
    instance.label.set('');
    flushSync();
    expect(pre(host).getAttribute('aria-label')).toBe('Code, bash');
    instance.label.set('   ');
    flushSync();
    expect(pre(host).getAttribute('aria-label')).toBe('Code, bash');
    instance.label.set('  Install  ');
    flushSync();
    expect(pre(host).getAttribute('aria-label')).toBe('Install');
  });

  it('takes `aria-label` on the tag over `label`, and names nothing while the block fits', () => {
    @Component({
      selector: 'v-aria-page',
      imports: [VCode],
      render: compileTemplate(`
        <v-code block label="From the prop" :aria-label="name.get()">npm ci</v-code>
      `),
    })
    class Aria {
      name = new Signal.State<string | undefined>('From the attribute');
    }

    overflowing();
    const scrolling = show(Aria);
    expect(pre(scrolling.host).getAttribute('aria-label')).toBe('From the attribute');
    scrolling.instance.name.set(undefined);
    flushSync();
    expect(pre(scrolling.host).getAttribute('aria-label')).toBe('From the prop');
    unmount?.();
    unmount = null;
    vi.restoreAllMocks();

    // A `<pre>` that fits has no role, and ARIA prohibits naming an element
    // that has none — so neither name is written anywhere.
    const fitting = show(Aria);
    expect(pre(fitting.host).hasAttribute('aria-label')).toBe(false);
    expect(fitting.host.querySelector('[aria-label]')).toBeNull();
  });

  it('becomes a named region a keyboard can reach once it is taller than its box', async () => {
    // The height a caller gives the tag, which is the way a long block is
    // kept from running down the page. The primitive measures only across.
    let tall = true;
    towering(() => tall);

    @Component({
      selector: 'v-tall-page',
      imports: [VCode],
      render: compileTemplate(`
        <v-code
          block
          wrap
          :ref="box"
          language="TypeScript"
          :label="label.get()"
          style="max-block-size: 20rem"
        >{ source.get() }</v-code>
      `),
    })
    class Tall {
      box: VCode | null = null;
      source = new Signal.State(SOURCE);
      label = new Signal.State<string | undefined>(undefined);
    }

    const { instance, host } = show(Tall);
    const box = pre(host);
    expect(box.getAttribute('tabindex')).toBe('0');
    expect(box.getAttribute('role')).toBe('region');
    expect(box.getAttribute('aria-label')).toBe('Code, TypeScript');
    box.focus();
    expect(document.activeElement).toBe(box);
    // Said through `:ref` too, beside the primitive's own, which measures across.
    expect(instance.box!.scrolls()).toBe(true);
    expect(instance.box!.code.isScrollable()).toBe(false);

    instance.label.set('The whole module');
    flushSync();
    expect(box.getAttribute('aria-label')).toBe('The whole module');

    // Code that shrinks back under the height is no longer one.
    tall = false;
    instance.source.set('export {};\n');
    await remeasured();
    expect(box.hasAttribute('tabindex')).toBe(false);
    expect(box.hasAttribute('role')).toBe(false);
    expect(box.hasAttribute('aria-label')).toBe(false);
    expect(instance.box!.scrolls()).toBe(false);
  });

  it('names a block that scrolls in the provider’s words, whichever way it scrolls', () => {
    @Component({
      selector: 'v-german-blocks-page',
      imports: [VCode],
      render: compileTemplate(`
        <v-code block language="TypeScript" id="typed">{ source }</v-code>
        <v-code block id="untyped">{ source }</v-code>
      `),
    })
    class GermanBlocks {
      source = SOURCE;
      locale = createLocaleProvider({
        defaultLocale: 'de',
        messages: { codeBlockLanguage: 'Quelltext, {language}', codeBlock: 'Quelltext' },
      });
    }

    const names = (host: HTMLElement): (string | null)[] =>
      ['#typed', '#untyped'].map((id) => host.querySelector(id)!.getAttribute('aria-label'));

    overflowing();
    const across = show(GermanBlocks);
    expect(names(across.host)).toEqual(['Quelltext, TypeScript', 'Quelltext']);
    unmount?.();
    unmount = null;
    vi.restoreAllMocks();

    towering();
    const down = show(GermanBlocks);
    expect(names(down.host)).toEqual(['Quelltext, TypeScript', 'Quelltext']);
    unmount?.();
    unmount = null;
    vi.restoreAllMocks();

    // And the English the primitive falls back on, with no provider at all.
    @Component({
      selector: 'v-english-blocks-page',
      imports: [VCode],
      render: compileTemplate(`
        <v-code block language="TypeScript" id="typed">{ source }</v-code>
        <v-code block id="untyped">{ source }</v-code>
      `),
    })
    class EnglishBlocks {
      source = SOURCE;
    }
    towering();
    expect(names(show(EnglishBlocks).host)).toEqual(['Code, TypeScript', 'Code']);
  });

  it('keeps a role the caller wrote on a block, while it scrolls and after', async () => {
    let wide = true;
    overflowing(() => wide);

    @Component({
      selector: 'v-figure-page',
      imports: [VCode],
      render: compileTemplate(`
        <v-code block role="figure" language="bash" label="Install">{ source.get() }</v-code>
      `),
    })
    class Figure {
      source = new Signal.State('npm ci --ignore-scripts --no-audit --no-fund\n');
    }

    const { instance, host } = show(Figure);
    const box = pre(host);
    // Still a tab stop with a name, which is what scrolling asks for — under
    // the role the caller chose rather than the primitive's.
    expect(box.getAttribute('role')).toBe('figure');
    expect(box.getAttribute('tabindex')).toBe('0');
    expect(box.getAttribute('aria-label')).toBe('Install');

    wide = false;
    instance.source.set('npm ci\n');
    await remeasured();
    expect(box.hasAttribute('tabindex')).toBe(false);
    // Not taken away with the region's: it was never the primitive's to take.
    expect(box.getAttribute('role')).toBe('figure');
    // A role that is there to carry one keeps the name it was given.
    expect(box.getAttribute('aria-label')).toBe('Install');
  });

  it('lands what the caller wrote on the `<pre>`, and none of it on the parts inside', () => {
    @Component({
      selector: 'v-boxed-page',
      imports: [VCode],
      render: compileTemplate(`
        <v-code
          block
          copyable
          lineNumbers
          language="bash"
          class="mine"
          id="install"
          style="max-block-size: 20rem"
          title="Install"
          lang="en"
          data-hint="setup"
          aria-describedby="note"
        >{ source }</v-code>
        <p id="note">Run it once.</p>
      `),
    })
    class Boxed {
      source = 'pnpm install\npnpm build\n';
    }

    overflowing();
    const { host } = show(Boxed);
    const box = pre(host);

    expect([...box.classList].sort()).toEqual(['mine', 'volt-code-block']);
    expect(box.id).toBe('install');
    expect(box.style.getPropertyValue('max-block-size')).toBe('20rem');
    expect(box.title).toBe('Install');
    expect(box.lang).toBe('en');
    expect(box.dataset['hint']).toBe('setup');
    expect(box.getAttribute('aria-describedby')).toBe('note');
    // Beside the primitive's own, which the caller's did not displace.
    expect(box.getAttribute('role')).toBe('region');
    expect(box.getAttribute('tabindex')).toBe('0');

    expect(box.querySelectorAll('*').length).toBeGreaterThan(3);
    for (const part of box.querySelectorAll('*')) {
      expect(part.id, part.className).toBe('');
      expect(part.classList.contains('mine'), part.className).toBe(false);
      expect(part.hasAttribute('title'), part.className).toBe(false);
      expect(part.hasAttribute('aria-describedby'), part.className).toBe(false);
    }
  });
});

describe('v-code, copying', () => {
  it('draws no button unless asked, and follows `copyable` bound to a signal', () => {
    const { instance, host } = show(Sample);
    expect(button(host)).toBeNull();

    instance.copyable.set(true);
    flushSync();
    expect(button(host)).not.toBeNull();

    instance.copyable.set(false);
    flushSync();
    expect(button(host)).toBeNull();
  });

  it('reads `copyable="false"` as the false it says', () => {
    @Component({
      selector: 'v-uncopied-page',
      imports: [VCode],
      render: compileTemplate(`<v-code block copyable="false">npm ci</v-code>`),
    })
    class Uncopied {}

    expect(button(show(Uncopied).host)).toBeNull();
  });

  it('is a real button in the box, named for what it does', () => {
    const { instance, host } = show(Sample);
    instance.copyable.set(true);
    flushSync();
    const press = button(host)!;

    expect(press.tagName).toBe('BUTTON');
    // Inside a form, a button with no type submits it.
    expect(press.type).toBe('button');
    expect(press.getAttribute('aria-label')).toBe('Copy code');
    expect(press.textContent).toBe('Copy code');
    expect(press.dataset['state']).toBe('idle');
    // In the box, so a block sized from the tag carries it; after the code,
    // so a reader going through the box meets the code first.
    expect(press.parentElement).toBe(pre(host));
    expect(content(host).compareDocumentPosition(press) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // And not in the code, which is the text that is copied.
    expect(content(host).contains(press)).toBe(false);
  });

  it('puts the code on the clipboard as it is on the page, and nothing else in the box', async () => {
    const write = clipboard();
    const { instance, host } = show(Sample);
    instance.copyable.set(true);
    instance.numbered.set(true);
    flushSync();

    button(host)!.click();
    await settled();
    // Not the button's words, and not the lines the gutter holds.
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith(SOURCE);

    // Read when it is pressed, so a source that changed is the one copied.
    instance.source.set('echo changed\n');
    flushSync();
    button(host)!.click();
    await settled();
    expect(write).toHaveBeenLastCalledWith('echo changed\n');
  });

  it('copies what a highlighter drew as the text it holds', async () => {
    const write = clipboard();

    @Component({
      selector: 'v-highlighted-page',
      imports: [VCode],
      render: compileTemplate(`
        <v-code block copyable language="ts"><span :html="highlighted"></span></v-code>
      `),
    })
    class Highlighted {
      highlighted =
        '<span class="keyword">const</span> answer <span class="operator">=</span> ' +
        '<span class="number">42</span>;';
    }

    const { host } = show(Highlighted);
    expect(content(host).querySelector('.keyword')!.textContent).toBe('const');
    button(host)!.click();
    await settled();
    expect(write).toHaveBeenCalledWith('const answer = 42;');
  });

  it('shows that it copied and says so in the live region, keeping its name', async () => {
    clipboard();
    const { instance, host } = show(Sample);
    instance.copyable.set(true);
    flushSync();
    const press = button(host)!;

    press.click();
    await settled();
    expect(press.textContent).toBe('Copied');
    expect(press.dataset['state']).toBe('copied');
    // The name stays put: a name changing under a screen reader's focus is
    // read out unreliably, and the live region is what says it.
    expect(press.getAttribute('aria-label')).toBe('Copy code');
    expect(instance.box!.clipboard.isCopied()).toBe(true);
    await vi.waitFor(() => expect(heard('polite')).toBe('Copied'));
  });

  it('goes back to what it does once the moment has passed', async () => {
    vi.useFakeTimers();
    clipboard();
    const { instance, host } = show(Sample);
    instance.copyable.set(true);
    flushSync();

    button(host)!.click();
    await vi.advanceTimersByTimeAsync(0);
    flushSync();
    expect(button(host)!.textContent).toBe('Copied');

    await vi.advanceTimersByTimeAsync(2000);
    flushSync();
    expect(button(host)!.textContent).toBe('Copy code');
    expect(button(host)!.dataset['state']).toBe('idle');
  });

  it('shows and says that it could not copy when the clipboard refuses', async () => {
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
    const { instance, host } = show(Sample);
    instance.copyable.set(true);
    flushSync();

    button(host)!.click();
    await settled();
    expect(button(host)!.textContent).toBe('Could not copy');
    expect(button(host)!.dataset['state']).toBe('failed');
    expect(button(host)!.getAttribute('aria-label')).toBe('Copy code');
    await vi.waitFor(() => expect(heard('assertive')).toBe('Could not copy'));
  });

  it('takes its words from `labels`, and follows labels bound to a signal', async () => {
    clipboard();
    const { instance, host } = show(Sample);
    instance.copyable.set(true);
    instance.labels.set({ copy: 'Copier le code', copied: 'Copié' });
    flushSync();

    expect(button(host)!.getAttribute('aria-label')).toBe('Copier le code');
    expect(button(host)!.textContent).toBe('Copier le code');

    button(host)!.click();
    await settled();
    expect(button(host)!.textContent).toBe('Copié');
    await vi.waitFor(() => expect(heard('polite')).toBe('Copié'));

    // An empty name is no name, and the default stands — as does one of
    // blanks, which would be a button called nothing with nothing on it.
    instance.labels.set({ copy: '' });
    flushSync();
    expect(button(host)!.getAttribute('aria-label')).toBe('Copy code');
    instance.labels.set({ copy: '   ' });
    flushSync();
    expect(button(host)!.getAttribute('aria-label')).toBe('Copy code');
  });

  it('takes a blank word for a failure as no word, on the button and in the region alike', async () => {
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
    const { instance, host } = show(Sample);
    instance.copyable.set(true);
    instance.labels.set({ failed: ' ' });
    flushSync();

    button(host)!.click();
    await settled();
    expect(button(host)!.textContent).toBe('Could not copy');
    await vi.waitFor(() => expect(heard('assertive')).toBe('Could not copy'));
  });

  it('takes a blank word for no word, on the button and in the region alike', async () => {
    clipboard();
    const { instance, host } = show(Sample);
    instance.copyable.set(true);
    instance.labels.set({ copied: '   ' });
    flushSync();

    button(host)!.click();
    await settled();
    // Not an empty button beside a region that says nothing.
    expect(button(host)!.textContent).toBe('Copied');
    await vi.waitFor(() => expect(heard('polite')).toBe('Copied'));
  });

  it('says what it could not do in the words `labels` gives', async () => {
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
    const { instance, host } = show(Sample);
    instance.copyable.set(true);
    instance.labels.set({ failed: 'Copie impossible' });
    flushSync();

    button(host)!.click();
    await settled();
    expect(button(host)!.textContent).toBe('Copie impossible');
    await vi.waitFor(() => expect(heard('assertive')).toBe('Copie impossible'));
  });

  it('shows the provider’s word for a copy, which is the word it says', async () => {
    clipboard();

    @Component({
      selector: 'v-german-page',
      imports: [VCode],
      render: compileTemplate(`<v-code block copyable>npm ci</v-code>`),
    })
    class German {
      locale = createLocaleProvider({ defaultLocale: 'de', messages: { copied: 'Kopiert' } });
    }

    const { host } = show(German);
    button(host)!.click();
    await settled();
    expect(button(host)!.textContent).toBe('Kopiert');
    await vi.waitFor(() => expect(heard('polite')).toBe('Kopiert'));
  });
});

describe('v-code, wrapping', () => {
  it('marks a block that wraps for the sheet, and follows `wrap` bound to a signal', () => {
    const { instance, host } = show(Sample);
    expect(pre(host).hasAttribute('data-wrap')).toBe(false);

    instance.wrap.set(true);
    flushSync();
    expect(pre(host).hasAttribute('data-wrap')).toBe(true);

    instance.wrap.set(false);
    flushSync();
    expect(pre(host).hasAttribute('data-wrap')).toBe(false);
  });
});

describe('v-code, line numbers', () => {
  it('draws a gutter with a row per line, hidden from assistive technology', () => {
    const { instance, host } = show(Sample);
    expect(host.querySelector('.volt-code-lines')).toBeNull();
    expect(pre(host).hasAttribute('data-line-numbers')).toBe(false);

    instance.numbered.set(true);
    flushSync();
    const gutter = host.querySelector('.volt-code-lines')!;
    expect(gutter.getAttribute('aria-hidden')).toBe('true');
    expect(gutter.parentElement).toBe(pre(host));
    expect(pre(host).hasAttribute('data-line-numbers')).toBe(true);
    // A row per line, each holding its line to wrap where the line does. The
    // final newline ends the last line rather than starting a fourth.
    expect(rows(host)).toEqual([
      'function total(items) {',
      '  return items.reduce((sum, item) => sum + item, 0);',
      '}',
    ]);
    for (const row of host.querySelectorAll('.volt-code-line')) {
      expect(row.children).toHaveLength(1);
      expect(row.firstElementChild!.className).toBe('volt-code-line-text');
    }

    instance.numbered.set(false);
    flushSync();
    expect(host.querySelector('.volt-code-lines')).toBeNull();
    expect(pre(host).hasAttribute('data-line-numbers')).toBe(false);
  });

  it('puts no number in the markup, so none is in the text', () => {
    const { instance, host } = show(Sample);
    instance.numbered.set(true);
    flushSync();

    // The numbers are the sheet's markers: the code is the code, and the
    // gutter holds the lines' own text and nothing else.
    expect(content(host).textContent).toBe(SOURCE);
    expect(host.querySelector('.volt-code-lines')!.textContent).toBe(SOURCE.split('\n').join(''));
  });

  it('counts an empty line as a line, and breaks lines where a `<pre>` does', async () => {
    const { instance, host } = show(Sample);
    instance.source.set('first\n\nthird');
    instance.numbered.set(true);
    flushSync();
    expect(rows(host)).toEqual(['first', '', 'third']);

    // A carriage return is drawn as a space: `\r\n` is one line break, and a
    // lone `\r` is none.
    instance.source.set('dos\r\nline\rstill');
    flushSync();
    await settled();
    expect(rows(host)).toEqual(['dos\r', 'line\rstill']);
  });

  it('follows content that changes under it', async () => {
    const { instance, host } = show(Sample);
    instance.numbered.set(true);
    flushSync();
    expect(rows(host)).toHaveLength(3);

    // A bound source that changes is a text node that changes, which no
    // signal of the component's sees.
    instance.source.set('first\n\nthird\nfourth\n');
    flushSync();
    await settled();
    expect(rows(host)).toEqual(['first', '', 'third', 'fourth']);

    // And a highlighter rewriting the code after it was drawn.
    content(host).innerHTML = '<span class="keyword">let</span> a;\n<span class="keyword">let</span> b;';
    await settled();
    expect(rows(host)).toEqual(['let a;', 'let b;']);
  });

  it('draws no rows for no code', () => {
    const { instance, host } = show(Sample);
    instance.source.set('');
    instance.numbered.set(true);
    flushSync();
    expect(host.querySelector('.volt-code-lines')).not.toBeNull();
    expect(rows(host)).toEqual([]);
  });

  it('reads `lineNumbers="false"` and `wrap="false"` as the false they say', () => {
    @Component({
      selector: 'v-unnumbered-page',
      imports: [VCode],
      render: compileTemplate(`<v-code block lineNumbers="false" wrap="false">{ source }</v-code>`),
    })
    class Unnumbered {
      source = 'a\nb';
    }

    const { host } = show(Unnumbered);
    expect(host.querySelector('.volt-code-lines')).toBeNull();
    expect(pre(host).hasAttribute('data-line-numbers')).toBe(false);
    expect(pre(host).hasAttribute('data-wrap')).toBe(false);
  });
});

describe('v-code and :ref', () => {
  it('hands the primitive itself to whoever needs more than this offers', async () => {
    const write = clipboard();
    const { instance, host } = show(Sample);
    const box = instance.box!;

    expect(box).toBeInstanceOf(VCode);
    expect(box.code.language()).toBe('TypeScript');
    expect(box.code.isScrollable()).toBe(false);
    expect(box.code.preProps()['data-block']).toBe('');
    expect(pre(host).dataset['language']).toBe(box.code.language());
    // The clipboard too, so a page can copy from a shortcut of its own.
    await box.clipboard.copy();
    expect(write).toHaveBeenCalledWith(SOURCE);
    expect(box.clipboard.status()).toBe('copied');
  });

  it('builds the same fields for inline code, so a `:ref` finds them on every tag', () => {
    @Component({
      selector: 'v-inline-ref-page',
      imports: [VCode],
      render: compileTemplate(`<p><v-code :ref="run" language="css">display: grid</v-code></p>`),
    })
    class InlineRef {
      run: VCode | null = null;
    }

    const { instance } = show(InlineRef);
    expect(instance.run!.code.language()).toBe('css');
    expect(instance.run!.code.preProps()).toEqual({});
    expect(instance.run!.clipboard.status()).toBe('idle');
  });

  it('tells a `:ref` that inline code draws none of a block’s parts, whatever it was asked for', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    @Component({
      selector: 'v-inline-asked-page',
      imports: [VCode],
      render: compileTemplate(`<p><v-code :ref="run" copyable wrap lineNumbers>npm test</v-code></p>`),
    })
    class InlineAsked {
      run: VCode | null = null;
    }

    const { instance } = show(InlineAsked);
    expect(instance.run!.copies()).toBe(false);
    expect(instance.run!.wraps()).toBe(false);
    expect(instance.run!.numbered()).toBe(false);
    expect(instance.run!.scrolls()).toBe(false);
  });
});

describe('v-code and the sheet', () => {
  /** Inline, and a block with every part a block can have. */
  @Component({
    selector: 'v-everything-page',
    imports: [VCode],
    render: compileTemplate(`
      <p>Call <v-code language="js">Array.prototype.at</v-code>.</p>
      <v-code block language="ts" copyable wrap lineNumbers>{ source }</v-code>
    `),
  })
  class Everything {
    source = SOURCE;
  }

  it('writes every class the sheet declares, and only those', () => {
    const { host } = show(Everything);
    const written = [...host.querySelectorAll('*')].flatMap((element) =>
      [...element.classList].filter((name) => name.startsWith('volt-')),
    );
    expect(new Set(written)).toEqual(new Set<string>(Object.values(codeClasses)));
  });

  it('gives every rule something the component draws', () => {
    // The pointer and keyboard focus are states nothing here drives; what is
    // asked is whether the classes and attributes around them are drawn.
    const selectors = [...codeStyles.rules, ...codeStyles.forcedColors]
      .flatMap((rule) => rule.selector.split(',').map((selector) => selector.trim()))
      .map((selector) => selector.replaceAll(':hover', '').replaceAll(':focus-visible', ''));

    show(Everything);
    const unmatched = selectors.filter((selector) => document.querySelector(selector) === null);
    expect(unmatched).toEqual([]);
  });

  it('draws inline code in a monospace face on a tint, and a block in a box that scrolls', () => {
    withSheet();
    const { host } = show(Everything);

    const run = getComputedStyle(inline(host));
    expect(run.getPropertyValue('font-family')).toMatch(/monospace$/);
    // Never the keyword alone, which a browser draws smaller than the text.
    expect(run.getPropertyValue('font-family')).not.toBe('monospace');
    expect(run.getPropertyValue('background-color')).toBe(
      primitiveTokens['--volt-palette-neutral-50'],
    );

    const box = getComputedStyle(pre(host));
    expect(box.getPropertyValue('overflow-x')).toBe('auto');
    expect(box.getPropertyValue('border-start-start-radius')).toBe(primitiveTokens['--volt-radius-2']);
    expect(box.getPropertyValue('padding-block-start')).toBe(primitiveTokens['--volt-space-3']);
    // `wrap` is on in this page.
    expect(box.getPropertyValue('white-space')).toBe('pre-wrap');
  });

  it('draws the numbers as markers the platform counts, over text it lays out and hides', () => {
    withSheet();
    const { host } = show(Everything);

    const gutter = getComputedStyle(host.querySelector('.volt-code-lines')!);
    // Reset here, or a block inside a numbered list carries on from its count.
    expect(gutter.getPropertyValue('counter-reset')).toBe('list-item');
    expect(gutter.getPropertyValue('user-select')).toBe('none');

    const row = getComputedStyle(host.querySelector('.volt-code-line')!);
    expect(row.getPropertyValue('display')).toBe('list-item');
    expect(row.getPropertyValue('list-style-type')).toBe('decimal');
    const text = getComputedStyle(host.querySelector('.volt-code-line-text')!);
    expect(text.getPropertyValue('visibility')).toBe('hidden');
  });

  it('keeps the copy button in the corner of a block that scrolls under it', () => {
    withSheet();
    const { host } = show(Everything);
    const press = getComputedStyle(button(host)!);

    expect(press.getPropertyValue('position')).toBe('sticky');
    expect(press.getPropertyValue('justify-self')).toBe('end');
    expect(press.getPropertyValue('align-self')).toBe('start');
  });

  it('sets the copy button in a column of its own, beside the code and never over it', () => {
    withSheet();
    const { host } = show(Everything);
    const press = getComputedStyle(button(host)!);

    // In the code's own cell it sat over the end of the first line — for good
    // in a block that fits, where there is no scrolling it out from under.
    for (const part of [content(host), host.querySelector('.volt-code-lines')!]) {
      expect(getComputedStyle(part).getPropertyValue('grid-column-start')).toBe('1');
    }
    expect(press.getPropertyValue('grid-column-start')).toBe('2');
    expect(press.getPropertyValue('grid-row-start')).toBe('1');
    expect(getComputedStyle(pre(host)).getPropertyValue('column-gap')).toBe(
      primitiveTokens['--volt-space-3'],
    );

    // Stuck at the corner it rests in. A sticky inset counts from inside the
    // box's padding, so the padding's worth again moved the button down and
    // in the moment a block began to scroll.
    expect(press.getPropertyValue('inset-block-start')).toMatch(/^0(px)?$/);
    expect(press.getPropertyValue('inset-inline-end')).toMatch(/^0(px)?$/);
  });
});

/**
 * The bytes a server writes, which a reader meets before any script runs.
 *
 * `compileTemplate` picks its target from `__VOLT_SERVER__` when it is called,
 * so the tag is compiled here with the flag up, as a subclass that inherits
 * every prop: the client registration the rest of this file uses is left as
 * it is.
 */
describe('v-code, written by a server', () => {
  const serverBuild = (on: boolean): void => {
    (globalThis as { __VOLT_SERVER__?: boolean }).__VOLT_SERVER__ = on;
  };
  beforeAll(() => serverBuild(true));
  afterAll(() => serverBuild(false));

  it('draws both shapes and the code as written, with no numbers until the page attaches', async () => {
    @Component({ selector: 'v-code', render: compileTemplate(template, 'v-code') })
    class ServerCode extends VCode {}

    @Component({
      selector: 'v-code-server-page',
      imports: [ServerCode],
      render: compileTemplate(`
        <p>Call <v-code language="JavaScript" id="at">Array.prototype.at</v-code>.</p>
        <v-code block language="TypeScript" copyable lineNumbers class="mine">{ source }</v-code>
      `),
    })
    class Page {
      source = 'if (a < b) {\n  swap(a, b);\n}\n';
    }

    const { html } = await renderToStaticMarkup(Page);

    const run = /<code [^>]*class="volt-code"[^>]*>([^<]*)<\/code>/.exec(html);
    expect(run?.[0]).toContain('role="code"');
    expect(run?.[0]).toContain('data-language="JavaScript"');
    expect(run?.[0]).toContain('id="at"');
    expect(run?.[1]).toBe('Array.prototype.at');

    const box = /<pre [^>]*>/.exec(html)?.[0] ?? '';
    expect(box).toContain('class="volt-code-block mine"');
    expect(box).toContain('data-block=""');
    expect(box).toContain('data-language="TypeScript"');
    expect(box).toContain('data-line-numbers=""');
    // A server lays nothing out, so it cannot know the block scrolls: no tab
    // stop and no name, which is the conservative half of the guess.
    expect(box).not.toContain('tabindex');
    expect(box).not.toContain('role=');

    // The code exactly as written, escaped and nothing more.
    expect(html).toContain('if (a &lt; b) {\n  swap(a, b);\n}\n</code>');
    // The gutter, empty: its lines are read off the page.
    expect(html).toMatch(/<span class="volt-code-lines" aria-hidden="true">(<!--[^>]*-->)*<\/span>/);
    const press = /<button ([^>]*)>([^<]*)<\/button>/.exec(html);
    expect(press?.[1]).toContain('class="volt-code-copy"');
    expect(press?.[1]).toContain('type="button"');
    expect(press?.[1]).toContain('aria-label="Copy code"');
    expect(press?.[2]).toBe('Copy code');
    // Nothing between the parts of the box but markup: a `<pre>` draws every
    // space it holds, a server's as much as a browser's.
    const inside = /<pre [^>]*>([\s\S]*)<\/pre>/.exec(html)?.[1] ?? '';
    const between = inside.replace(/<code[\s\S]*?<\/code>/, '').replace(/<[^>]*>/g, '');
    expect(between).toBe('Copy code');
  });
});
