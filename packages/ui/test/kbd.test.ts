/**
 * `<v-kbd>`, driven the way a page drives it.
 *
 * The symbols, the names and the platforms are `createKbd`'s and are tested
 * where it lives. What is left here is what the tag adds: a keycap per key and
 * the separator between them, `mod`, the classes and attributes the sheet's
 * rules select on, what a caller writes landing on the element a screen reader
 * meets, every prop it forwards doing something, and the primitive left
 * reachable for everything it does not offer.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Component, Signal, flushSync, mount } from '@voltdev/core';
import { compileTemplate } from '@voltdev/core/jit';
import { renderToStaticMarkup } from '@voltdev/core/server';
import { compileComponents } from './render.js';
import { VKbd } from '../src/components/kbd.js';
import template from '../src/components/kbd.html?raw';
import { kbdClasses, kbdStyles } from '../src/sheet/kbd.js';
import { componentCss } from '../src/stylesheet.js';
import { tokensCss } from '../src/tokens.js';

compileComponents();

let unmount: (() => void) | null = null;
let restores: (() => void)[] = [];

afterEach(() => {
  unmount?.();
  unmount = null;
  for (let i = restores.length - 1; i >= 0; i--) restores[i]!();
  restores = [];
  vi.restoreAllMocks();
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
  style.textContent = `${tokensCss()}\n\n${componentCss(kbdStyles)}`;
  document.head.append(style);
  restores.push(() => style.remove());
}

const chord = (host: HTMLElement): HTMLElement => host.querySelector('.volt-kbd')!;
const keys = (host: HTMLElement): HTMLElement[] => [
  ...host.querySelectorAll<HTMLElement>('.volt-kbd-key'),
];
const drawn = (host: HTMLElement): string[] => keys(host).map((key) => key.textContent ?? '');
const separators = (host: HTMLElement): HTMLElement[] => [
  ...host.querySelectorAll<HTMLElement>('.volt-kbd-separator'),
];

@Component({
  selector: 'v-page',
  imports: [VKbd],
  render: compileTemplate(`
    <p>Search with
      <v-kbd
        :keys="shortcut.get()"
        :size="size.get()"
        :platform="platform"
        class="mine"
        id="search-shortcut"
        data-hint="search"
        title="Search"
        lang="tr"
        aria-describedby="hint"
      ></v-kbd>.
    </p>
    <p id="hint">Anywhere on the page.</p>
  `),
})
class Page {
  shortcut = new Signal.State<string | readonly string[]>('mod+k');
  size = new Signal.State<'sm' | 'md'>('md');
  platform: 'apple' | 'other' = 'apple';
}

/** The same page on the other platform, which draws a separator between keys. */
@Component({
  selector: 'v-page-other',
  imports: [VKbd],
  render: compileTemplate(`<v-kbd :keys="shortcut.get()" platform="other"></v-kbd>`),
})
class OtherPage {
  shortcut = new Signal.State<string | readonly string[]>('mod+k');
}

describe('v-kbd', () => {
  it('draws one keycap per key inside the chord, as HTML spells a key combination', () => {
    const { host } = show(Page);

    expect(chord(host).tagName).toBe('KBD');
    expect(keys(host).map((key) => key.tagName)).toEqual(['KBD', 'KBD']);
    for (const key of keys(host)) expect(chord(host).contains(key)).toBe(true);
    expect(drawn(host)).toEqual(['⌘', 'k']);
    // Each key keyed by the name it came from, which is what `keyProps` writes.
    expect(keys(host).map((key) => key.dataset['key'])).toEqual(['Meta', 'k']);
  });

  it('is an image named by the words, so the symbols are never read', () => {
    const { host } = show(Page);

    expect(chord(host).getAttribute('role')).toBe('img');
    // The primitive's name: a letter keeps the case it was written in, and is
    // read the same either way.
    expect(chord(host).getAttribute('aria-label')).toBe('Command k');
    expect(chord(host).dataset['platform']).toBe('apple');
  });

  it('draws nothing between keys on an Apple platform', () => {
    const { host } = show(Page);

    expect(separators(host)).toEqual([]);
    expect(keys(host)[0]!.nextElementSibling).toBe(keys(host)[1]);
  });

  it('makes `mod` Control elsewhere, with a separator hidden from assistive technology', () => {
    const { host } = show(OtherPage);

    expect(drawn(host)).toEqual(['Ctrl', 'k']);
    expect(chord(host).getAttribute('aria-label')).toBe('Control k');
    expect(chord(host).dataset['platform']).toBe('other');

    const [between] = separators(host);
    expect(separators(host)).toHaveLength(1);
    expect(between!.textContent).toBe('+');
    expect(between!.getAttribute('aria-hidden')).toBe('true');
    // Between the two keys, not after the last.
    expect(between!.previousElementSibling).toBe(keys(host)[0]);
    expect(between!.nextElementSibling).toBe(keys(host)[1]);
  });

  it('draws the chord as the primitive writes it, so a copy of it is the shortcut', () => {
    const apple = show(Page);
    expect(chord(apple.host).textContent).toBe('⌘k');
    unmount?.();

    const other = show(OtherPage);
    expect(chord(other.host).textContent).toBe('Ctrl+k');
  });

  it('tells the plus key from the separator, which only the list form can write', () => {
    const { instance, host } = show(OtherPage);

    instance.shortcut.set(['mod', '+']);
    flushSync();
    // `Ctrl + +`: the first plus is the separator and the second is a key.
    expect(drawn(host)).toEqual(['Ctrl', '+']);
    expect(separators(host)).toHaveLength(1);
    expect(chord(host).getAttribute('aria-label')).toBe('Control +');
  });

  it('marks a character key for the sheet to capitalise, and no named key', () => {
    const { instance, host } = show(OtherPage);

    instance.shortcut.set(['mod', 'Shift', 'p']);
    flushSync();
    expect(keys(host).map((key) => key.hasAttribute('data-character'))).toEqual([
      false,
      false,
      true,
    ]);

    // The space bar's name is one character, and it is drawn as a word.
    instance.shortcut.set(['Control', ' ']);
    flushSync();
    expect(drawn(host)).toEqual(['Ctrl', 'Space']);
    expect(keys(host).map((key) => key.hasAttribute('data-character'))).toEqual([false, false]);
  });

  it('lands what the caller wrote on the chord, which is the element a screen reader meets', () => {
    const { instance, host } = show(Page);
    const root = chord(host);

    expect([...root.classList].sort()).toEqual(['mine', 'volt-kbd']);
    expect(root.id).toBe('search-shortcut');
    expect(root.dataset['hint']).toBe('search');
    expect(root.title).toBe('Search');
    expect(root.lang).toBe('tr');
    expect(root.getAttribute('aria-describedby')).toBe('hint');

    // And none of it on the keys, which are drawn and not read.
    for (const key of keys(host)) {
      expect([...key.classList]).toEqual(['volt-kbd-key']);
      expect(key.id).toBe('');
      expect(key.hasAttribute('title')).toBe(false);
      expect(key.hasAttribute('aria-describedby')).toBe(false);
    }

    // Still all theirs once the primitive's bag has been written again.
    instance.shortcut.set('Shift+Enter');
    flushSync();
    expect([...root.classList].sort()).toEqual(['mine', 'volt-kbd']);
    expect(root.id).toBe('search-shortcut');
    expect(root.getAttribute('aria-describedby')).toBe('hint');
  });

  it('takes a caller’s name in place of the primitive’s, and follows it', () => {
    @Component({
      selector: 'v-named-page',
      imports: [VKbd],
      render: compileTemplate(
        `<v-kbd keys="mod+k" platform="apple" :aria-label="name.get()"></v-kbd>`,
      ),
    })
    class NamedPage {
      name = new Signal.State<string | undefined>('Commande K');
    }

    const { instance, host } = show(NamedPage);
    expect(chord(host).getAttribute('aria-label')).toBe('Commande K');
    expect(chord(host).getAttribute('role')).toBe('img');

    instance.name.set('Befehl K');
    flushSync();
    expect(chord(host).getAttribute('aria-label')).toBe('Befehl K');

    // An empty name is no name: the primitive's stands, rather than an image
    // called nothing.
    instance.name.set('');
    flushSync();
    expect(chord(host).getAttribute('aria-label')).toBe('Command k');

    // And so is one of blanks, which the accessible name computation trims
    // to nothing anyway; a name with blanks round it is the name inside them.
    instance.name.set('   ');
    flushSync();
    expect(chord(host).getAttribute('aria-label')).toBe('Command k');
    instance.name.set('  Commande K ');
    flushSync();
    expect(chord(host).getAttribute('aria-label')).toBe('Commande K');
  });

  it('names nothing and claims no role while there are no keys', () => {
    @Component({
      selector: 'v-empty-page',
      imports: [VKbd],
      render: compileTemplate(`<v-kbd :keys="chord.get()" aria-label="Search"></v-kbd>`),
    })
    class EmptyPage {
      chord = new Signal.State<string | undefined>(undefined);
    }

    const { instance, host } = show(EmptyPage);
    expect(keys(host)).toEqual([]);
    expect(chord(host).hasAttribute('role')).toBe(false);
    // ARIA prohibits naming an element with no role.
    expect(chord(host).hasAttribute('aria-label')).toBe(false);

    instance.chord.set('Escape');
    flushSync();
    expect(chord(host).getAttribute('role')).toBe('img');
    expect(chord(host).getAttribute('aria-label')).toBe('Search');

    // And back: the role and the name go with the keys, rather than a name
    // left on an element that no longer has a role to carry it.
    instance.chord.set(undefined);
    flushSync();
    expect(keys(host)).toEqual([]);
    expect(chord(host).hasAttribute('role')).toBe(false);
    expect(chord(host).hasAttribute('aria-label')).toBe(false);
  });

  it('follows keys bound to a signal, keycaps and name together', () => {
    const { instance, host } = show(Page);

    instance.shortcut.set('mod+Shift+ArrowUp');
    flushSync();
    expect(drawn(host)).toEqual(['⌘', '⇧', '↑']);
    expect(chord(host).getAttribute('aria-label')).toBe('Command Shift Up arrow');

    instance.shortcut.set('Escape');
    flushSync();
    expect(drawn(host)).toEqual(['esc']);
    expect(chord(host).getAttribute('aria-label')).toBe('Escape');
  });

  it('keeps each keycap’s key and mark with it when the rows are reused', () => {
    const { instance, host } = show(Page);
    const before = keys(host);

    // Rows are kept by position, so swapping the two keys reuses both
    // elements: the first was a named key and is now a character, and what
    // each carries for the sheet has to have followed its key.
    instance.shortcut.set('k+mod');
    flushSync();
    expect(keys(host)).toEqual(before);
    expect(drawn(host)).toEqual(['k', '⌘']);
    expect(keys(host).map((key) => key.dataset['key'])).toEqual(['k', 'Meta']);
    expect(keys(host).map((key) => key.hasAttribute('data-character'))).toEqual([true, false]);
    expect(chord(host).getAttribute('aria-label')).toBe('k Command');
  });

  it('finds `mod` however the string is spaced, as the primitive finds every other key', () => {
    @Component({
      selector: 'v-spaced-page',
      imports: [VKbd],
      render: compileTemplate(`<v-kbd keys=" mod + k " platform="apple"></v-kbd>`),
    })
    class SpacedPage {}

    const { host } = show(SpacedPage);
    expect(drawn(host)).toEqual(['⌘', 'k']);
    expect(keys(host).map((key) => key.dataset['key'])).toEqual(['Meta', 'k']);
    expect(chord(host).getAttribute('aria-label')).toBe('Command k');
  });

  it('leaves a caller’s aria-hidden alone, which is how a shortcut is kept out of a control’s name', () => {
    @Component({
      selector: 'v-hidden-page',
      imports: [VKbd],
      render: compileTemplate(`
        <button aria-keyshortcuts="Control+K">
          Search <v-kbd :keys="chord.get()" platform="other" aria-hidden="true"></v-kbd>
        </button>
      `),
    })
    class HiddenPage {
      chord = new Signal.State<string | undefined>('mod+k');
    }

    const { instance, host } = show(HiddenPage);
    expect(chord(host).getAttribute('aria-hidden')).toBe('true');
    expect(chord(host).getAttribute('role')).toBe('img');

    // Still there once the primitive's bag has been written again, and once
    // it has been emptied.
    instance.chord.set('mod+Shift+k');
    flushSync();
    expect(chord(host).getAttribute('aria-hidden')).toBe('true');
    instance.chord.set(undefined);
    flushSync();
    expect(chord(host).getAttribute('aria-hidden')).toBe('true');
    expect(chord(host).hasAttribute('role')).toBe(false);
  });

  it('draws nothing written inside the tag, which is how the platform’s own <kbd> is written', () => {
    @Component({
      selector: 'v-filled-page',
      imports: [VKbd],
      render: compileTemplate(`
        <v-kbd platform="apple">⌘K</v-kbd>
        <v-kbd keys="mod+k" platform="apple">Ctrl+K</v-kbd>
      `),
    })
    class FilledPage {}

    const { host } = show(FilledPage);
    const [empty, full] = [...host.querySelectorAll<HTMLElement>('.volt-kbd')];
    // The chord is drawn from `keys` and nothing else: without them there is
    // no shortcut, and with them what was written inside is not what is drawn.
    expect(empty!.textContent).toBe('');
    expect(empty!.hasAttribute('role')).toBe(false);
    expect(full!.textContent).toBe('⌘k');
    expect(full!.getAttribute('aria-label')).toBe('Command k');
  });
  it('writes its size for the sheet, and follows a size bound to a signal', () => {
    const { instance, host } = show(Page);
    expect(chord(host).dataset['size']).toBe('md');

    instance.size.set('sm');
    flushSync();
    expect(chord(host).dataset['size']).toBe('sm');
  });

  it('hands the platform to the primitive, which draws that platform’s keys', () => {
    @Component({
      selector: 'v-both-page',
      imports: [VKbd],
      render: compileTemplate(`
        <v-kbd :ref="apple" keys="mod+Alt+k" platform="apple"></v-kbd>
        <v-kbd :ref="other" keys="mod+Alt+k" platform="other"></v-kbd>
      `),
    })
    class BothPage {
      apple: VKbd | null = null;
      other: VKbd | null = null;
    }

    const both = show(BothPage).instance;
    expect(both.apple!.shortcut.platform()).toBe('apple');
    expect(both.apple!.shortcut.label()).toBe('Command Option k');
    expect(both.other!.shortcut.platform()).toBe('other');
    expect(both.other!.shortcut.label()).toBe('Control Alt k');
  });

  it('reads the platform from the browser when none is given', () => {
    @Component({
      selector: 'v-sniffed-page',
      imports: [VKbd],
      render: compileTemplate(`<v-kbd keys="mod+k"></v-kbd>`),
    })
    class SniffedPage {}

    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko)',
    );
    const mac = show(SniffedPage).host;
    expect(drawn(mac)).toEqual(['⌘', 'k']);
    unmount?.();

    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)',
    );
    const windows = show(SniffedPage).host;
    expect(drawn(windows)).toEqual(['Ctrl', 'k']);
  });

  it('refuses a platform the primitive would read as everywhere else', () => {
    @Component({
      selector: 'v-mac-page',
      imports: [VKbd],
      render: compileTemplate(`<v-kbd keys="mod+k" platform="mac"></v-kbd>`),
    })
    class MacPage {}

    expect(() => show(MacPage)).toThrow(/`platform` on <v-kbd> is 'apple' or 'other'/);
  });

  it('hands the primitive itself to whoever needs more than this offers', () => {
    @Component({
      selector: 'v-ref-page',
      imports: [VKbd],
      render: compileTemplate(`<v-kbd :ref="box" keys="mod+Enter" platform="other"></v-kbd>`),
    })
    class RefPage {
      box: VKbd | null = null;
    }

    const { instance, host } = show(RefPage);
    expect(instance.box).toBeInstanceOf(VKbd);
    expect(instance.box!.shortcut.keys()).toEqual(['Control', 'Enter']);
    expect(instance.box!.shortcut.text()).toBe('Ctrl+Enter');
    expect(instance.box!.shortcut.label()).toBe('Control Enter');
    expect(chord(host).textContent).toBe(instance.box!.shortcut.text());
  });

  it('takes no focus and answers no key, which a shortcut written down never does', () => {
    const { host } = show(Page);
    const root = chord(host);

    // Out of the tab order, and nothing inside it in it either: the chord is
    // text about the keyboard, and the primitive offers no keyboard of its own.
    for (const element of [root, ...keys(host)]) {
      expect(element.hasAttribute('tabindex')).toBe(false);
      expect(element.tabIndex).toBe(-1);
    }

    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    root.dispatchEvent(event);
    flushSync();
    expect(event.defaultPrevented).toBe(false);
  });
});

describe('v-kbd and the sheet', () => {
  it('writes only classes the sheet declares', () => {
    const { host } = show(OtherPage);
    const declared = new Set<string>(Object.values(kbdClasses));
    const written = [...host.querySelectorAll('*')].flatMap((element) =>
      [...element.classList].filter((name) => name.startsWith('volt-')),
    );
    expect(written.length).toBeGreaterThan(0);
    for (const name of written) expect(declared, name).toContain(name);
  });

  it('gives every rule something the component draws', () => {
    const selectors = [...kbdStyles.rules, ...kbdStyles.forcedColors].flatMap((rule) =>
      rule.selector.split(',').map((selector) => selector.trim()),
    );
    const unmatched = new Set(selectors);
    const look = (): void => {
      for (const selector of unmatched) if (document.querySelector(selector)) unmatched.delete(selector);
    };

    // Every state the rules tell apart: a named key and a character, with a
    // separator between them and without one, at both sizes.
    show(OtherPage);
    look();
    unmount?.();
    const apple = show(Page);
    apple.instance.size.set('sm');
    flushSync();
    look();

    expect([...unmatched]).toEqual([]);
  });

  it('sits on the baseline, keeps a shortcut on one line, and capitalises letters only', () => {
    withSheet();
    const { instance, host } = show(OtherPage);
    instance.shortcut.set('mod+Escape+k');
    flushSync();

    const root = getComputedStyle(chord(host));
    expect(root.getPropertyValue('display')).toBe('inline-flex');
    expect(root.getPropertyValue('flex-wrap')).toBe('nowrap');
    expect(root.getPropertyValue('white-space')).toBe('nowrap');
    expect(root.getPropertyValue('align-items')).toBe('baseline');
    expect(root.getPropertyValue('vertical-align')).toBe('baseline');

    const [ctrl, escape, k] = keys(host).map((key) => getComputedStyle(key));
    expect(ctrl!.getPropertyValue('text-transform')).not.toBe('uppercase');
    expect(escape!.getPropertyValue('text-transform')).not.toBe('uppercase');
    expect(k!.getPropertyValue('text-transform')).toBe('uppercase');
  });

  it('draws the small size smaller', () => {
    withSheet();
    const { instance, host } = show(Page);
    const size = (): string => getComputedStyle(chord(host)).getPropertyValue('font-size');
    const md = size();

    instance.size.set('sm');
    flushSync();
    expect(size()).not.toBe(md);
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
describe('v-kbd, written by a server', () => {
  const serverBuild = (on: boolean): void => {
    (globalThis as { __VOLT_SERVER__?: boolean }).__VOLT_SERVER__ = on;
  };
  beforeAll(() => serverBuild(true));
  afterAll(() => serverBuild(false));

  it('draws everywhere else’s keys unless told the platform, on the element a caller’s attributes land on', async () => {
    @Component({ selector: 'v-kbd', render: compileTemplate(template, 'v-kbd') })
    class ServerKbd extends VKbd {}

    @Component({
      selector: 'v-page-server',
      imports: [ServerKbd],
      render: compileTemplate(`
        <v-kbd keys="mod+k" id="search" class="mine" aria-describedby="hint"></v-kbd>
        <v-kbd keys="mod+k" platform="apple" aria-label="Palette"></v-kbd>
        <v-kbd></v-kbd>
      `),
    })
    class Page {}

    const { html } = await renderToStaticMarkup(Page);
    const chords = [...html.matchAll(/<kbd [^>]*class="volt-kbd[ "][^>]*>/g)].map((m) => m[0]);
    expect(chords).toHaveLength(3);

    // A server has no browser to read the platform from, so it draws
    // everywhere else's keys and says so; a Mac replaces them when the page
    // attaches. What the caller wrote is on the chord, beside the primitive's.
    const [sniffed, told, empty] = chords;
    expect(sniffed).toContain('data-platform="other"');
    expect(sniffed).toContain('role="img"');
    expect(sniffed).toContain('aria-label="Control k"');
    expect(sniffed).toContain('id="search"');
    expect(sniffed).toContain('aria-describedby="hint"');
    expect(sniffed).toContain('class="volt-kbd mine"');
    expect(html).toContain('data-key="Control" class="volt-kbd-key">Ctrl</kbd>');
    expect(html).toContain('class="volt-kbd-separator" aria-hidden="true">+</span>');
    expect(html).toContain('data-character="" data-key="k" class="volt-kbd-key">k</kbd>');

    // Told the platform, both sides draw the same keys.
    expect(told).toContain('data-platform="apple"');
    expect(told).toContain('aria-label="Palette"');
    expect(html).toContain('data-key="Meta" class="volt-kbd-key">⌘</kbd>');

    // No keys: no role, and no name for a role it does not have.
    expect(empty).toContain('data-platform="other"');
    expect(empty).not.toContain('role=');
    expect(empty).not.toContain('aria-label=');
  });
});
