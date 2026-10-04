/**
 * `<v-separator>`, driven the way a page drives it.
 *
 * The keyboard map, the clamping and the ARIA are `createSeparator`'s and are
 * tested where they live. What is tested here is the shell: that what a
 * caller writes on the tag reaches the element carrying the role, that every
 * state the sheet draws is on the element its rules select on, that the words
 * on the line are drawn in a gap and name the line only where it has a role,
 * that the keys the primitive provides reach it and keep the page still, that
 * every prop forwarded to the primitive does something, and that nothing
 * about the primitive is out of reach.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Component, Signal, flushSync, mount } from '@voltdev/core';
import { compileTemplate } from '@voltdev/core/jit';
import { renderToStaticMarkup } from '@voltdev/core/server';
import { Window as HappyWindow } from 'happy-dom';
import { compileComponents } from './render.js';
import { SYSTEM_COLORS, standIn } from './harness.js';
import { VSeparator } from '../src/components/separator.js';
import template from '../src/components/separator.html?raw';
import { rulesToCss, wrap, type Rule } from '../src/css.js';
import { separatorClasses, separatorStyles } from '../src/sheet/separator.js';
import { FORCED_COLORS_QUERY, componentCss } from '../src/stylesheet.js';
import { primitiveTokens, tokensCss } from '../src/tokens.js';

compileComponents();

let unmount: (() => void) | null = null;
let restores: (() => void)[] = [];

afterEach(() => {
  unmount?.();
  unmount = null;
  for (let i = restores.length - 1; i >= 0; i--) restores[i]!();
  restores = [];
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
  style.textContent = `${tokensCss()}\n\n${componentCss(separatorStyles)}`;
  document.head.append(style);
  restores.push(() => style.remove());
}

/** A keydown as the user sends it: bubbling, and cancellable. */
function press(target: Element, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  flushSync();
  return event;
}

const rule = (host: HTMLElement): HTMLElement => host.querySelector('.volt-separator')!;
const rules = (host: HTMLElement): HTMLElement[] => [
  ...host.querySelectorAll<HTMLElement>('.volt-separator'),
];
const parts = (element: Element): string[] => [...element.children].map((child) => child.className);
const label = (element: Element): HTMLElement | null =>
  element.querySelector('.volt-separator-label');

describe('v-separator', () => {
  it('is a line, with the sheet’s classes and the caller’s own, on the element that would carry the role', () => {
    @Component({
      selector: 'v-page-anatomy',
      imports: [VSeparator],
      render: compileTemplate(
        `<v-separator class="mine" id="rule" data-test="line" title="Section break"></v-separator>`,
      ),
    })
    class Page {}

    const { host } = show(Page);

    // No wrapper: the element the tag renders is the one with the role, so
    // what the caller wrote is on the thing a reader meets.
    expect(host.firstElementChild).toBe(rule(host));
    expect([...rule(host).classList].sort()).toEqual(['mine', 'volt-separator']);
    expect(rule(host).id).toBe('rule');
    expect(rule(host).dataset['test']).toBe('line');
    expect(rule(host).title).toBe('Section break');

    // Decorative, as the primitive has it by default: presentation, the
    // orientation the sheet draws from, and nothing a presentational element
    // is not allowed to carry.
    expect(rule(host).getAttribute('role')).toBe('presentation');
    expect(rule(host).getAttribute('data-orientation')).toBe('horizontal');
    expect(rule(host).hasAttribute('aria-orientation')).toBe(false);
    expect(rule(host).hasAttribute('tabindex')).toBe(false);

    // One segment is the whole line, and there are no words on it.
    expect(parts(rule(host))).toEqual(['volt-separator-line']);
  });

  it('lands a class, an id and a name written on the tag on the element with the role, once it has one', () => {
    @Component({
      selector: 'v-page-landing',
      imports: [VSeparator],
      render: compileTemplate(`
        <v-separator :decorative="false" class="mine" id="rule" aria-label="Comments"></v-separator>
        <v-separator :prop-resize="size" class="handle" id="splitter" aria-label="Resize sidebar"></v-separator>
      `),
    })
    class Page {
      size = new Signal.State(30);
    }

    const { host } = show(Page);

    for (const [element, own, id, name] of [
      [host.querySelector('#rule'), 'mine', 'rule', 'Comments'],
      [host.querySelector('#splitter'), 'handle', 'splitter', 'Resize sidebar'],
    ] as const) {
      // One element, carrying all of it: no wrapper between the role and
      // what the caller wrote.
      expect(element?.getAttribute('role'), id).toBe('separator');
      expect(element?.parentElement, id).toBe(host);
      expect([...element!.classList].sort(), id).toEqual([own, 'volt-separator'].sort());
      expect(element?.getAttribute('aria-label'), id).toBe(name);
    }
    expect(host.querySelectorAll('[aria-label]')).toHaveLength(2);
  });

  it('draws its words in a gap between two segments of the line, following the signal they are bound to', () => {
    @Component({
      selector: 'v-page-words',
      imports: [VSeparator],
      render: compileTemplate(`<v-separator :label="words.get()"></v-separator>`),
    })
    class Page {
      words = new Signal.State<string | undefined>('or');
    }

    const { instance, host } = show(Page);

    expect(parts(rule(host))).toEqual([
      'volt-separator-line',
      'volt-separator-label',
      'volt-separator-line',
    ]);
    expect(label(rule(host))?.textContent).toBe('or');
    // On a decorative rule the words are read where they stand, as the text
    // they are: they do not name a line that has no role to be named.
    expect(rule(host).hasAttribute('aria-label')).toBe(false);

    instance.words.set('Yesterday');
    flushSync();
    expect(label(rule(host))?.textContent).toBe('Yesterday');

    // No words: the gap closes, and one segment is the line again.
    instance.words.set(undefined);
    flushSync();
    expect(parts(rule(host))).toEqual(['volt-separator-line']);

    instance.words.set('');
    flushSync();
    expect(parts(rule(host))).toEqual(['volt-separator-line']);
  });

  it('draws a number bound as its words as the text it reads as, and names the line with it', () => {
    @Component({
      selector: 'v-page-year',
      imports: [VSeparator],
      render: compileTemplate(`
        <v-separator :label="year"></v-separator>
        <v-separator :decorative="false" :label="year"></v-separator>
      `),
    })
    class Page {
      // A year between two years of a timeline, held as the number it is:
      // nothing in a template checks a prop's type, so this reaches the tag.
      year = 2024;
    }

    const { host } = show(Page);
    const [drawn, named] = rules(host) as [HTMLElement, HTMLElement];

    expect(label(drawn)?.textContent).toBe('2024');
    expect(label(named)?.textContent).toBe('2024');
    expect(named.getAttribute('aria-label')).toBe('2024');
  });

  it('takes blank words for none, which would be a gap with nothing in it and a name of spaces', () => {
    @Component({
      selector: 'v-page-blank',
      imports: [VSeparator],
      render: compileTemplate(`<v-separator :decorative="false" label="   "></v-separator>`),
    })
    class Page {}

    const { host } = show(Page);

    expect(parts(rule(host))).toEqual(['volt-separator-line']);
    expect(rule(host).getAttribute('role')).toBe('separator');
    expect(rule(host).hasAttribute('aria-label')).toBe(false);
  });

  it('draws nothing written inside the tag: the words on the line are `label`', () => {
    @Component({
      selector: 'v-page-inside',
      imports: [VSeparator],
      render: compileTemplate(`<v-separator>or</v-separator>`),
    })
    class Page {}

    const { host } = show(Page);

    expect(parts(rule(host))).toEqual(['volt-separator-line']);
    expect(rule(host).textContent).toBe('');
  });

  it('is a separator with a role and a name when it is not decorative, in either spelling of the flag', () => {
    @Component({
      selector: 'v-page-meaning',
      imports: [VSeparator],
      render: compileTemplate(`
        <v-separator :decorative="false" :label="words.get()"></v-separator>
        <v-separator decorative="false" label="Archived"></v-separator>
        <v-separator decorative label="Kept decorative"></v-separator>
      `),
    })
    class Page {
      words = new Signal.State<string | undefined>('Comments');
    }

    const { instance, host } = show(Page);
    const [bound, written, bare] = rules(host) as [HTMLElement, HTMLElement, HTMLElement];

    expect(bound.getAttribute('role')).toBe('separator');
    expect(bound.getAttribute('aria-orientation')).toBe('horizontal');
    expect(bound.getAttribute('aria-label')).toBe('Comments');
    // A rule is not a control: no tab stop, and no value to report.
    expect(bound.hasAttribute('tabindex')).toBe(false);
    expect(bound.hasAttribute('aria-valuenow')).toBe(false);

    // `decorative="false"` is a string, and every string is truthy: read as
    // one it would be a rule that stayed decorative.
    expect(written.getAttribute('role')).toBe('separator');
    expect(written.getAttribute('aria-label')).toBe('Archived');
    // Written bare, a flag is on.
    expect(bare.getAttribute('role')).toBe('presentation');

    // The name is the words, and follows them: everything inside a separator
    // is presentational, so what is drawn is read only through the name.
    instance.words.set('Replies');
    flushSync();
    expect(bound.getAttribute('aria-label')).toBe('Replies');
    expect(label(bound)?.textContent).toBe('Replies');

    instance.words.set(undefined);
    flushSync();
    expect(bound.hasAttribute('aria-label')).toBe(false);
  });

  it('runs either way, and refuses a way the primitive does not know', () => {
    @Component({
      selector: 'v-page-orientation',
      imports: [VSeparator],
      render: compileTemplate(`
        <v-separator orientation="vertical"></v-separator>
        <v-separator orientation="vertical" :decorative="false" label="Tools"></v-separator>
      `),
    })
    class Page {}

    const { host } = show(Page);
    const [decorative, meaningful] = rules(host) as [HTMLElement, HTMLElement];

    expect(decorative.getAttribute('data-orientation')).toBe('vertical');
    expect(meaningful.getAttribute('data-orientation')).toBe('vertical');
    expect(meaningful.getAttribute('aria-orientation')).toBe('vertical');

    @Component({
      selector: 'v-page-sideways',
      imports: [VSeparator],
      render: compileTemplate(`<v-separator orientation="row"></v-separator>`),
    })
    class Wrong {}

    // `row` would reach `aria-orientation` as an invalid value, and draw a
    // separator the sheet has no line for.
    expect(() => show(Wrong)).toThrow(/`orientation` on <v-separator> is 'horizontal' or 'vertical'/);
  });

  it('is named by the caller’s reference, then their name, then a splitter’s, then its words', () => {
    @Component({
      selector: 'v-page-names',
      imports: [VSeparator],
      render: compileTemplate(`
        <v-separator
          :decorative="false"
          :aria-labelledby="reference.get()"
          :aria-label="named.get()"
          :resizeLabel="splitter.get()"
          :label="words.get()"
        ></v-separator>
        <v-separator
          :prop-resize="size"
          :aria-label="named.get()"
          :resizeLabel="splitter.get()"
          :label="words.get()"
        ></v-separator>
      `),
    })
    class Page {
      reference = new Signal.State<string | undefined>('heading');
      named = new Signal.State<string | undefined>('Caller’s name');
      splitter = new Signal.State<string | undefined>('Resize sidebar');
      words = new Signal.State<string | undefined>('Sidebar');
      size = new Signal.State(30);
    }

    const { instance, host } = show(Page);
    const [line, handle] = rules(host) as [HTMLElement, HTMLElement];
    const naming = (element: HTMLElement) => [
      element.getAttribute('aria-labelledby'),
      element.getAttribute('aria-label'),
    ];

    // A reference beats a name, and the two are never both written.
    expect(naming(line)).toEqual(['heading', null]);
    // The caller's name beats the props that say the same thing.
    expect(naming(handle)).toEqual([null, 'Caller’s name']);

    instance.reference.set(undefined);
    instance.named.set(undefined);
    flushSync();
    // `resizeLabel` names only a line that moves.
    expect(naming(line)).toEqual([null, 'Sidebar']);
    expect(naming(handle)).toEqual([null, 'Resize sidebar']);

    instance.splitter.set(undefined);
    flushSync();
    expect(naming(handle)).toEqual([null, 'Sidebar']);

    instance.words.set(undefined);
    flushSync();
    // None is invented: a wrong name is worse than a missing one.
    expect(naming(line)).toEqual([null, null]);
    expect(naming(handle)).toEqual([null, null]);
  });

  it('writes no name at all on a decorative rule, whose role cannot carry one', () => {
    @Component({
      selector: 'v-page-unnamed',
      imports: [VSeparator],
      render: compileTemplate(
        `<v-separator aria-label="Divider" aria-labelledby="heading" label="or"></v-separator>`,
      ),
    })
    class Page {}

    const { host } = show(Page);

    expect(rule(host).getAttribute('role')).toBe('presentation');
    expect(rule(host).hasAttribute('aria-label')).toBe(false);
    expect(rule(host).hasAttribute('aria-labelledby')).toBe(false);
  });

  it('is a splitter when given a size to move: focusable, with the value it holds', () => {
    @Component({
      selector: 'v-page-splitter',
      imports: [VSeparator],
      render: compileTemplate(`
        <v-separator
          orientation="vertical"
          :prop-resize="sidebar"
          :min="15"
          :max="60"
          resizeLabel="Resize sidebar"
          aria-controls="sidebar"
          aria-describedby="hint"
        ></v-separator>
      `),
    })
    class Page {
      sidebar = new Signal.State(30);
    }

    const { instance, host } = show(Page);

    // Never decorative, whatever `decorative` said: a control cannot be
    // presentation.
    expect(rule(host).getAttribute('role')).toBe('separator');
    expect(rule(host).getAttribute('aria-orientation')).toBe('vertical');
    expect(rule(host).getAttribute('tabindex')).toBe('0');
    expect(rule(host).getAttribute('aria-valuenow')).toBe('30');
    expect(rule(host).getAttribute('aria-valuemin')).toBe('15');
    expect(rule(host).getAttribute('aria-valuemax')).toBe('60');
    expect(rule(host).getAttribute('aria-label')).toBe('Resize sidebar');

    // The primitive carries `aria-controls` and `aria-valuetext` as
    // `undefined` when it was handed neither, and that says nothing: what the
    // caller wrote on the tag stays.
    expect(rule(host).getAttribute('aria-controls')).toBe('sidebar');
    expect(rule(host).getAttribute('aria-describedby')).toBe('hint');
    expect(rule(host).hasAttribute('aria-valuetext')).toBe(false);

    // A size bound to a signal follows it, clamped to the range.
    instance.sidebar.set(45);
    flushSync();
    expect(rule(host).getAttribute('aria-valuenow')).toBe('45');
    instance.sidebar.set(90);
    flushSync();
    expect(rule(host).getAttribute('aria-valuenow')).toBe('60');

    // And the caller's own attribute survives the bag being written again.
    expect(rule(host).getAttribute('aria-controls')).toBe('sidebar');
  });

  it('keeps a spoken size the caller binds on the tag, and follows it', () => {
    @Component({
      selector: 'v-page-spoken',
      imports: [VSeparator],
      render: compileTemplate(`
        <v-separator :prop-resize="sidebar" resizeLabel="Resize sidebar"
                     :aria-valuetext="sidebar.get() + ' percent'"></v-separator>
      `),
    })
    class Page {
      sidebar = new Signal.State(30);
    }

    const { host } = show(Page);

    // The primitive carries its own `aria-valuetext` as `undefined`, which
    // would take this one away if it were written over it.
    expect(rule(host).getAttribute('aria-valuetext')).toBe('30 percent');
    press(rule(host), 'ArrowDown');
    expect(rule(host).getAttribute('aria-valuenow')).toBe('31');
    expect(rule(host).getAttribute('aria-valuetext')).toBe('31 percent');
  });

  it('is never decorative once it moves, even when told it is', () => {
    @Component({
      selector: 'v-page-told',
      imports: [VSeparator],
      render: compileTemplate(
        `<v-separator decorative :prop-resize="size" resizeLabel="Resize"></v-separator>`,
      ),
    })
    class Page {
      size = new Signal.State(50);
    }

    const { host } = show(Page);

    // A focusable element with `role="presentation"` is a contradiction a
    // browser resolves by ignoring the role, and the name with it.
    expect(rule(host).getAttribute('role')).toBe('separator');
    expect(rule(host).getAttribute('aria-label')).toBe('Resize');
  });

  it('takes the keys the primitive provides, across the line, and keeps the page from scrolling with them', () => {
    @Component({
      selector: 'v-page-keys',
      imports: [VSeparator],
      render: compileTemplate(`
        <v-separator orientation="vertical" :prop-resize="width" resizeLabel="Resize sidebar"></v-separator>
        <v-separator :prop-resize="height" resizeLabel="Resize output"></v-separator>
      `),
    })
    class Page {
      width = new Signal.State(30);
      height = new Signal.State(50);
    }

    const { instance, host } = show(Page);
    const [sideways, upright] = rules(host) as [HTMLElement, HTMLElement];

    // A vertical line stands between panes side by side, so Left and Right
    // move it; Up and Down are the page's.
    expect(press(sideways, 'ArrowRight').defaultPrevented).toBe(true);
    expect(instance.width.get()).toBe(31);
    expect(press(sideways, 'ArrowLeft').defaultPrevented).toBe(true);
    expect(instance.width.get()).toBe(30);
    expect(press(sideways, 'ArrowDown').defaultPrevented).toBe(false);
    expect(instance.width.get()).toBe(30);

    // A horizontal line moves with Up and Down: Down grows the pane above it.
    expect(press(upright, 'ArrowDown').defaultPrevented).toBe(true);
    expect(instance.height.get()).toBe(51);
    expect(press(upright, 'ArrowUp').defaultPrevented).toBe(true);
    expect(instance.height.get()).toBe(50);
    expect(press(upright, 'ArrowRight').defaultPrevented).toBe(false);

    // Home and End are the pane's smallest and largest, not the document's
    // start and end.
    expect(press(sideways, 'Home').defaultPrevented).toBe(true);
    expect(instance.width.get()).toBe(0);
    expect(sideways.getAttribute('aria-valuenow')).toBe('0');
    expect(press(sideways, 'End').defaultPrevented).toBe(true);
    expect(instance.width.get()).toBe(100);

    // A modified key is a shortcut, and Enter does nothing on a splitter that
    // does not collapse: neither is taken from the page.
    expect(press(sideways, 'ArrowLeft', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(press(sideways, 'Enter').defaultPrevented).toBe(false);
    expect(instance.width.get()).toBe(100);
  });

  it('swaps Left and Right under a right-to-left direction written on the tag', () => {
    @Component({
      selector: 'v-page-rtl',
      imports: [VSeparator],
      render: compileTemplate(
        `<v-separator dir="rtl" orientation="vertical" :prop-resize="width" resizeLabel="تغيير الحجم"></v-separator>`,
      ),
    })
    class Page {
      width = new Signal.State(30);
    }

    const { instance, host } = show(Page);

    // The pane before the line is on the right, so Left makes it larger.
    expect(rule(host).getAttribute('dir')).toBe('rtl');
    press(rule(host), 'ArrowLeft');
    expect(instance.width.get()).toBe(31);
    press(rule(host), 'ArrowRight');
    expect(instance.width.get()).toBe(30);
  });

  it('leaves every key alone on a line that does not move', () => {
    @Component({
      selector: 'v-page-still',
      imports: [VSeparator],
      render: compileTemplate(`
        <v-separator></v-separator>
        <v-separator :decorative="false" label="Comments"></v-separator>
      `),
    })
    class Page {}

    const { host } = show(Page);
    for (const each of rules(host)) {
      for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter']) {
        expect(press(each, key).defaultPrevented, key).toBe(false);
      }
      expect(each.hasAttribute('aria-valuenow')).toBe(false);
    }
  });

  it('collapses and restores with Enter when it is collapsible, in either spelling of the flag', () => {
    @Component({
      selector: 'v-page-collapse',
      imports: [VSeparator],
      render: compileTemplate(`
        <v-separator :prop-resize="first" :min="10" collapsible resizeLabel="First"></v-separator>
        <v-separator :prop-resize="second" collapsible="false" resizeLabel="Second"></v-separator>
      `),
    })
    class Page {
      first = new Signal.State(40);
      second = new Signal.State(40);
    }

    const { instance, host } = show(Page);
    const [collapsing, fixed] = rules(host) as [HTMLElement, HTMLElement];

    expect(press(collapsing, 'Enter').defaultPrevented).toBe(true);
    expect(instance.first.get()).toBe(10);
    expect(collapsing.getAttribute('aria-valuenow')).toBe('10');
    expect(press(collapsing, 'Enter').defaultPrevented).toBe(true);
    expect(instance.first.get()).toBe(40);

    // `collapsible="false"` is the false it says.
    expect(press(fixed, 'Enter').defaultPrevented).toBe(false);
    expect(instance.second.get()).toBe(40);
  });

  it('takes its range and step from the tag, in either spelling of a number', () => {
    @Component({
      selector: 'v-page-range',
      imports: [VSeparator],
      render: compileTemplate(`
        <v-separator :prop-resize="bound" :min="20" :max="80" :step="5" resizeLabel="Bound"></v-separator>
        <v-separator :prop-resize="written" min="20" max="80" step="5" resizeLabel="Written"></v-separator>
      `),
    })
    class Page {
      bound = new Signal.State(50);
      written = new Signal.State(50);
    }

    const { instance, host } = show(Page);

    for (const [index, size] of [instance.bound, instance.written].entries()) {
      const each = rules(host)[index]!;
      expect(each.getAttribute('aria-valuemin')).toBe('20');
      expect(each.getAttribute('aria-valuemax')).toBe('80');

      // `'5'` added to 50 is `'505'`: read as a string, one press would throw
      // the pane to its end.
      press(each, 'ArrowDown');
      expect(size.get()).toBe(55);
      // And Home would do nothing, refused for not being a number.
      press(each, 'Home');
      expect(size.get()).toBe(20);
      press(each, 'End');
      expect(size.get()).toBe(80);
    }
  });

  it('refuses a range or a step that is not a number, runs backwards, or does not move', () => {
    let page = 0;
    const refused = (markup: string, message: RegExp): void => {
      @Component({
        selector: `v-page-unmovable-${++page}`,
        imports: [VSeparator],
        render: compileTemplate(markup),
      })
      class Page {
        size = new Signal.State(30);
        nothing = Number.NaN;
        endless = Number.POSITIVE_INFINITY;
      }
      expect(() => show(Page), markup).toThrow(message);
      document.body.innerHTML = '';
    };

    // Bound as `NaN`, it reached the DOM as `aria-valuenow="NaN"` and
    // `aria-valuemax="NaN"`, and no key moved the pane again.
    refused(
      `<v-separator :prop-resize="size" :max="nothing" resizeLabel="R"></v-separator>`,
      /`max` on <v-separator> is a number, and `NaN` is not one/,
    );
    refused(
      `<v-separator :prop-resize="size" :min="endless" resizeLabel="R"></v-separator>`,
      /`min` on <v-separator> is a number, and `Infinity` is not one/,
    );
    // Written, a word that is not a number was the default, without a word
    // about it.
    refused(
      `<v-separator :prop-resize="size" max="lots" resizeLabel="R"></v-separator>`,
      /`max` on <v-separator> is a number, and `lots` is not one/,
    );
    refused(
      `<v-separator :prop-resize="size" step="fast" resizeLabel="R"></v-separator>`,
      /`step` on <v-separator> is a number, and `fast` is not one/,
    );
    refused(
      `<v-separator :prop-resize="size" min="" resizeLabel="R"></v-separator>`,
      /`min` on <v-separator> is a number, and `` is not one/,
    );
    // `aria-valuemin` above `aria-valuemax`, and every key pinned at an end.
    refused(
      `<v-separator :prop-resize="size" :min="80" :max="20" resizeLabel="R"></v-separator>`,
      /`min` on <v-separator> is 80, which is past `max` at 20/,
    );
    // Nought takes the arrows from the page and moves nothing; less than
    // nought turns them round.
    refused(
      `<v-separator :prop-resize="size" :step="0" resizeLabel="R"></v-separator>`,
      /`step` on <v-separator> is how far one press of an arrow moves the pane, and 0/,
    );
    refused(
      `<v-separator :prop-resize="size" step="-5" resizeLabel="R"></v-separator>`,
      /`step` on <v-separator> is how far one press of an arrow moves the pane, and -5/,
    );

    // A range of one size is a pane held where it is, which is a range a
    // caller can mean: it is announced as it stands, and no key moves it.
    @Component({
      selector: 'v-page-held',
      imports: [VSeparator],
      render: compileTemplate(
        `<v-separator :prop-resize="size" :min="40" :max="40" resizeLabel="R"></v-separator>`,
      ),
    })
    class Held {
      size = new Signal.State(40);
    }

    const { instance, host } = show(Held);
    expect(rule(host).getAttribute('aria-valuenow')).toBe('40');
    press(rule(host), 'ArrowDown');
    expect(instance.size.get()).toBe(40);
  });

  it('reads a range on a line that does not move as nothing, as the primitive does', () => {
    @Component({
      selector: 'v-page-unmoving-range',
      imports: [VSeparator],
      render: compileTemplate(`<v-separator min="lots" :step="0" label="or"></v-separator>`),
    })
    class Page {}

    // No size to move, so no range to be wrong about.
    const { host } = show(Page);
    expect(rule(host).getAttribute('role')).toBe('presentation');
  });

  it('takes a prop bound to nothing as the default it has unwritten', () => {
    @Component({
      selector: 'v-page-unset',
      imports: [VSeparator],
      render: compileTemplate(`
        <v-separator :orientation="nothing" :decorative="nothing" label="or"></v-separator>
        <v-separator :prop-resize="size" :orientation="nothing" :min="nothing" :max="nothing"
                     :step="nothing" :collapsible="nothing" resizeLabel="R"></v-separator>
      `),
    })
    class Page {
      nothing = undefined;
      size = new Signal.State(30);
    }

    const { instance, host } = show(Page);
    const [line, splitter] = rules(host) as [HTMLElement, HTMLElement];

    expect(line.getAttribute('data-orientation')).toBe('horizontal');
    expect(line.getAttribute('role')).toBe('presentation');
    expect(splitter.getAttribute('aria-orientation')).toBe('horizontal');
    expect(splitter.getAttribute('aria-valuemin')).toBe('0');
    expect(splitter.getAttribute('aria-valuemax')).toBe('100');
    press(splitter, 'ArrowDown');
    expect(instance.size.get()).toBe(31);
    // Not collapsible, so Enter is the page's.
    expect(press(splitter, 'Enter').defaultPrevented).toBe(false);
    expect(instance.size.get()).toBe(31);
  });

  it('reports each size it moves the pane to, and never one it was handed', () => {
    const heard: number[] = [];

    @Component({
      selector: 'v-page-heard',
      imports: [VSeparator],
      render: compileTemplate(
        `<v-separator :prop-resize="size" :onResize="(next) => heard.push(next)" resizeLabel="Resize"></v-separator>`,
      ),
    })
    class Page {
      size = new Signal.State(50);
      heard = heard;
    }

    const { instance, host } = show(Page);

    press(rule(host), 'ArrowDown');
    press(rule(host), 'End');
    // A key that moves nothing — already at the end — reports nothing.
    press(rule(host), 'End');
    expect(heard).toEqual([51, 100]);

    // A write to the caller's own signal is heard where it was written.
    instance.size.set(20);
    flushSync();
    expect(heard).toEqual([51, 100]);
  });

  it('refuses a size that is not a signal, while the tag is still what is wrong', () => {
    @Component({
      selector: 'v-page-not-a-signal',
      imports: [VSeparator],
      render: compileTemplate(`<v-separator resize="30" resizeLabel="Resize"></v-separator>`),
    })
    class Page {}

    expect(() => show(Page)).toThrow(/`resize` on <v-separator> takes a signal[\s\S]*:prop-resize/);

    // Written bare it is `true`, and written empty it is the empty string:
    // neither says more about a size than `30` does, and the empty one is not
    // taken for a line that does not move.
    @Component({
      selector: 'v-page-bare-resize',
      imports: [VSeparator],
      render: compileTemplate(`<v-separator resize resizeLabel="Resize"></v-separator>`),
    })
    class Bare {}

    @Component({
      selector: 'v-page-empty-resize',
      imports: [VSeparator],
      render: compileTemplate(`<v-separator resize="" resizeLabel="Resize"></v-separator>`),
    })
    class Empty {}

    for (const each of [Bare, Empty]) {
      document.body.innerHTML = '';
      expect(() => show(each), each.name).toThrow(/`resize` on <v-separator> takes a signal/);
    }
  });

  it('is handed its size as `:prop-resize`, since `:resize` is read as the window’s event', () => {
    @Component({
      selector: 'v-page-event',
      imports: [VSeparator],
      render: compileTemplate(`<v-separator :resize="size" resizeLabel="Resize"></v-separator>`),
    })
    class Page {
      size = new Signal.State(30);
    }

    // A listener on a component tag goes nowhere, and is refused.
    expect(() => show(Page)).toThrow(/`:on-resize` does not apply/);
  });

  it('hands the primitive itself to whoever needs more than this offers', () => {
    @Component({
      selector: 'v-page-ref',
      imports: [VSeparator],
      render: compileTemplate(`
        <v-separator :ref="handle" orientation="vertical" :prop-resize="width" resizeLabel="Resize"></v-separator>
      `),
    })
    class Page {
      handle: VSeparator | null = null;
      width = new Signal.State(30);
    }

    const { instance, host } = show(Page);
    const separator = instance.handle!.separator;

    expect(separator.orientation()).toBe('vertical');
    expect(separator.value()).toBe(30);

    // `setValue` is how a drag of the caller's own moves it.
    separator.setValue(42);
    flushSync();
    expect(instance.width.get()).toBe(42);
    expect(rule(host).getAttribute('aria-valuenow')).toBe('42');
  });
});

/** Every kind of line the sheet tells apart, in the orientation given. */
function everyKind(orientation: 'horizontal' | 'vertical') {
  @Component({
    selector: `v-page-kinds-${orientation}`,
    imports: [VSeparator],
    render: compileTemplate(`
      <v-separator :orientation="orientation"></v-separator>
      <v-separator :orientation="orientation" label="or"></v-separator>
      <v-separator :orientation="orientation" :decorative="false" label="Comments"></v-separator>
      <v-separator :orientation="orientation" :prop-resize="size" resizeLabel="Resize"></v-separator>
    `),
  })
  class Page {
    orientation = orientation;
    size = new Signal.State(30);
  }
  return Page;
}

describe('v-separator and the sheet', () => {
  it('writes only classes the sheet declares', () => {
    const { host } = show(everyKind('horizontal'));
    const declared = new Set<string>(Object.values(separatorClasses));
    const written = [...host.querySelectorAll('*')].flatMap((element) =>
      [...element.classList].filter((name) => name.startsWith('volt-')),
    );
    expect(written.length).toBeGreaterThan(0);
    for (const name of written) expect(declared, name).toContain(name);
  });

  it('gives every rule something the component draws', () => {
    // Focus is a state the page has to give it, so what is asked is whether
    // the element a focus rule is about is one the component draws.
    const selectors = [...separatorStyles.rules, ...separatorStyles.forcedColors]
      .flatMap((each) => each.selector.split(',').map((selector) => selector.trim()))
      .map((selector) => selector.replaceAll(':focus-visible', ''));
    const unmatched = new Set(selectors);

    for (const orientation of ['horizontal', 'vertical'] as const) {
      show(everyKind(orientation));
      for (const selector of unmatched) if (document.querySelector(selector)) unmatched.delete(selector);
      unmount?.();
      unmount = null;
    }

    expect([...unmatched]).toEqual([]);
  });

  it('draws the line on the edge it divides across: the block-start of a horizontal one, the inline-start of a vertical one', () => {
    withSheet();
    for (const [orientation, drawn, other] of [
      ['horizontal', 'block-start', 'inline-start'],
      ['vertical', 'inline-start', 'block-start'],
    ] as const) {
      const { host } = show(everyKind(orientation));
      const line = getComputedStyle(rule(host).querySelector('.volt-separator-line')!);
      expect(line.getPropertyValue(`border-${drawn}-style`), orientation).toBe('solid');
      expect(line.getPropertyValue(`border-${drawn}-width`), orientation).toBe(
        primitiveTokens['--volt-border-width-1'],
      );
      expect(['', 'none'], orientation).toContain(line.getPropertyValue(`border-${other}-style`));
      unmount?.();
      unmount = null;
    }
  });

  it('gives a splitter a grab area of eight pixels across its line, and a rule none', () => {
    withSheet();
    const px = (value: string): number =>
      value.endsWith('rem') ? Number.parseFloat(value) * 16 : Number.parseFloat(value) || 0;

    for (const [orientation, across] of [
      ['horizontal', 'min-block-size'],
      ['vertical', 'min-inline-size'],
    ] as const) {
      const { host } = show(everyKind(orientation));
      const [bare, , , splitter] = rules(host) as HTMLElement[];
      expect(px(getComputedStyle(splitter!).getPropertyValue(across)), orientation).toBeGreaterThanOrEqual(8);
      expect(px(getComputedStyle(bare!).getPropertyValue(across)), orientation).toBeLessThan(8);
      unmount?.();
      unmount = null;
    }
  });

  it('draws a splitter’s line in a control’s edge colour, and a rule’s in the quieter one', () => {
    withSheet();
    const { host } = show(everyKind('vertical'));
    const [bare, , , splitter] = rules(host) as HTMLElement[];
    const colour = (element: HTMLElement): string =>
      getComputedStyle(element.querySelector('.volt-separator-line')!).getPropertyValue(
        'border-inline-start-color',
      );

    expect(colour(bare!)).toBe(primitiveTokens['--volt-palette-neutral-200']);
    expect(colour(splitter!)).toBe(primitiveTokens['--volt-palette-neutral-400']);

    // The words are quieter than the text either side of them.
    const words = getComputedStyle(rules(host)[1]!.querySelector('.volt-separator-label')!);
    expect(words.getPropertyValue('color')).toBe(primitiveTokens['--volt-palette-neutral-600']);
  });

  it('rings a splitter that has focus inside its grab area, and marks the line it will move', () => {
    withSheet();
    @Component({
      selector: 'v-page-focus',
      imports: [VSeparator],
      render: compileTemplate(`
        <v-separator orientation="vertical" :prop-resize="first" resizeLabel="First"></v-separator>
        <v-separator orientation="vertical" :prop-resize="second" resizeLabel="Second"></v-separator>
      `),
    })
    class Page {
      first = new Signal.State(30);
      second = new Signal.State(60);
    }

    const { host } = show(Page);
    const [resting, focused] = rules(host) as [HTMLElement, HTMLElement];
    // Focused before anything is measured: happy-dom keeps an element's
    // computed style from its first read, and focus does not clear it.
    focused.focus();

    const ring = (element: HTMLElement): string[] => {
      const style = getComputedStyle(element);
      return ['outline-style', 'outline-width'].map((each) => style.getPropertyValue(each));
    };
    const line = (element: HTMLElement): string =>
      getComputedStyle(element.querySelector('.volt-separator-line')!).getPropertyValue(
        'border-inline-start-color',
      );

    // Both, because each says something the other does not: the ring is
    // round the thing the keys reach, and the line is the thing they move.
    expect(ring(focused)).toEqual(['solid', primitiveTokens['--volt-border-width-2']]);
    expect(getComputedStyle(focused).getPropertyValue('outline-offset')).toMatch(/^calc\(-1/);
    expect(line(focused)).toBe(primitiveTokens['--volt-palette-accent-500']);

    expect(ring(resting)[0]).not.toBe('solid');
    expect(line(resting)).toBe(primitiveTokens['--volt-palette-neutral-400']);
  });

  it('runs a vertical rule inline, as a column, the height of the row it stands in', () => {
    withSheet();
    const { host } = show(everyKind('vertical'));
    const style = getComputedStyle(rule(host));
    expect(style.getPropertyValue('display')).toBe('inline-flex');
    // Down the column, or the one segment sits in a row it is not stretched
    // across, and the line is nothing tall.
    expect(style.getPropertyValue('flex-direction')).toBe('column');
    expect(style.getPropertyValue('align-self')).toBe('stretch');
    // Between two words, with no row to stretch to, it is a line's height
    // and sits on the middle of the text either side, rather than nothing
    // tall on the baseline.
    expect(style.getPropertyValue('vertical-align')).toBe('middle');
    expect(style.getPropertyValue('min-block-size')).toBe(primitiveTokens['--volt-space-4']);
  });

  it('runs the line the whole length of the rule, through the middle of the words on it', () => {
    withSheet();
    for (const orientation of ['horizontal', 'vertical'] as const) {
      const { host } = show(everyKind(orientation));
      const worded = rules(host)[1]!;
      const [before, words, after] = [...worded.children].map((part) => getComputedStyle(part));

      // From a zero start, every segment takes an equal share of what the
      // words leave: without the growth a rule is a stub as long as its
      // minimum, and the words are off to one side of it.
      for (const segment of [before!, after!]) {
        expect(segment.getPropertyValue('flex-grow'), orientation).toBe('1');
        expect(Number.parseFloat(segment.getPropertyValue('flex-basis')), orientation).toBe(0);
      }
      expect(words!.getPropertyValue('flex-grow'), orientation).toBe('0');

      // Centred across: the segments are drawn on one edge of a box with
      // nothing in it, and stretched to the height of the words that edge
      // would run along their top rather than through their middle, and along
      // the edge of a splitter's grab area rather than down its centre.
      expect(getComputedStyle(worded).getPropertyValue('align-items'), orientation).toBe('center');
      expect(getComputedStyle(rules(host)[3]!).getPropertyValue('align-items'), orientation).toBe(
        'center',
      );
      unmount?.();
      unmount = null;
    }
  });

  it('draws every line in the palette’s text colour once it is forced, a splitter’s heavier, and the one the keys will move in `Highlight`', () => {
    // Rendered by the component, then measured in a document with the forced
    // palette on — the one this file renders into has it off.
    const { host } = show(everyKind('vertical'));
    const page = new HappyWindow({
      url: 'http://localhost/',
      settings: { device: { forcedColors: 'active' } },
    });
    restores.push(() => void page.happyDOM.close());
    const forced = page.document as unknown as Document;
    const computed = (element: Element): CSSStyleDeclaration =>
      forced.defaultView!.getComputedStyle(element);
    const named = (each: readonly Rule[]): Rule[] =>
      each.map((rule) => ({
        selector: rule.selector,
        declarations: Object.fromEntries(
          Object.entries(rule.declarations).map(([property, value]) => [
            property,
            SYSTEM_COLORS.includes(value) ? standIn(value) : value,
          ]),
        ),
      }));
    const style = forced.createElement('style');
    style.textContent = [
      tokensCss(),
      rulesToCss(separatorStyles.rules),
      wrap(FORCED_COLORS_QUERY, rulesToCss(named(separatorStyles.forcedColors), '  ')),
    ].join('\n\n');
    forced.head.append(style);
    // Twice over, so that one splitter can be focused before anything is
    // measured and the other left alone.
    forced.body.innerHTML = host.innerHTML + host.innerHTML;
    const lines = [...forced.querySelectorAll<HTMLElement>('.volt-separator')];
    const focused = lines[7]!;
    focused.focus();

    const colour = (element: Element): string =>
      computed(element.querySelector('.volt-separator-line')!).getPropertyValue(
        'border-inline-start-color',
      );

    // The rule's line and the splitter's alike: a colour of the sheet's own
    // left on either is a colour the palette was meant to replace.
    expect(colour(lines[0]!)).toBe(standIn('CanvasText'));
    expect(colour(lines[3]!)).toBe(standIn('CanvasText'));

    // One colour for both, so what told the splitter from the rule is gone:
    // its line is the weight of a control's edge instead, which the palette
    // keeps. The grab area round it is empty, and the line is all a pointer
    // has to find it by.
    const weight = (element: Element): string =>
      computed(element.querySelector('.volt-separator-line')!).getPropertyValue(
        'border-inline-start-width',
      );
    expect(weight(lines[0]!)).toBe(primitiveTokens['--volt-border-width-1']);
    expect(weight(lines[2]!)).toBe(primitiveTokens['--volt-border-width-1']);
    expect(weight(lines[3]!)).toBe(primitiveTokens['--volt-border-width-2']);
    expect(
      computed(lines[1]!.querySelector('.volt-separator-label')!).getPropertyValue('color'),
    ).toBe(standIn('CanvasText'));

    // Which splitter the keys will move is information, and the accent that
    // said so is gone.
    expect(colour(focused)).toBe(standIn('Highlight'));
    expect(computed(focused).getPropertyValue('outline-color')).toBe(standIn('Highlight'));

    // Along the text the same, on the edge a horizontal line is drawn on.
    unmount?.();
    unmount = null;
    forced.body.innerHTML = show(everyKind('horizontal')).host.innerHTML;
    const across = [...forced.querySelectorAll<HTMLElement>('.volt-separator')];
    const thickness = (element: Element): string =>
      computed(element.querySelector('.volt-separator-line')!).getPropertyValue(
        'border-block-start-width',
      );
    expect(thickness(across[0]!)).toBe(primitiveTokens['--volt-border-width-1']);
    expect(thickness(across[3]!)).toBe(primitiveTokens['--volt-border-width-2']);
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
describe('v-separator, written by a server', () => {
  const serverBuild = (on: boolean): void => {
    (globalThis as { __VOLT_SERVER__?: boolean }).__VOLT_SERVER__ = on;
  };
  beforeAll(() => serverBuild(true));
  afterAll(() => serverBuild(false));

  it('writes the role, the value and the name on the element a caller’s attributes land on', async () => {
    @Component({ selector: 'v-separator', render: compileTemplate(template, 'v-separator') })
    class ServerSeparator extends VSeparator {}

    @Component({
      selector: 'v-page-server',
      imports: [ServerSeparator],
      render: compileTemplate(`
        <v-separator label="or"></v-separator>
        <v-separator orientation="vertical" :prop-resize="sidebar" resizeLabel="Resize sidebar"
                     class="mine" aria-controls="sidebar"></v-separator>
      `),
    })
    class Page {
      sidebar = new Signal.State(30);
    }

    const { html } = await renderToStaticMarkup(Page);
    const lines = [...html.matchAll(/<span [^>]*class="volt-separator[ "][^>]*>/g)].map((m) => m[0]);
    expect(lines).toHaveLength(2);

    const [words, splitter] = lines;
    expect(words).toContain('role="presentation"');
    expect(words).toContain('data-orientation="horizontal"');
    expect(words).not.toContain('aria-label=');
    expect(html).toContain('<span class="volt-separator-label">or</span>');

    // A splitter is reachable and named before any script runs, so the first
    // thing a keyboard reaches is already the control it will be.
    expect(splitter).toContain('role="separator"');
    expect(splitter).toContain('aria-orientation="vertical"');
    expect(splitter).toContain('tabindex="0"');
    expect(splitter).toContain('aria-valuenow="30"');
    expect(splitter).toContain('aria-label="Resize sidebar"');
    expect(splitter).toContain('aria-controls="sidebar"');
    expect(splitter).toContain('class="volt-separator mine"');
  });

  it('stays inside the paragraph it stands in once a browser has parsed what the server wrote', async () => {
    @Component({ selector: 'v-separator', render: compileTemplate(template, 'v-separator') })
    class ServerSeparator extends VSeparator {}

    @Component({
      selector: 'v-page-byline',
      imports: [ServerSeparator],
      render: compileTemplate(`
        <p>Ann Lee <v-separator orientation="vertical"></v-separator> 3 min read</p>
        <p>Before <v-separator :decorative="false" label="Notes"></v-separator> after</p>
      `),
    })
    class Page {}

    const { html } = await renderToStaticMarkup(Page);
    // Parsed as a browser parses it. A block element ends an open paragraph
    // where it starts, so a rule drawn as one is pulled out of the line it
    // was meant to stand in, the words after it are left outside the
    // paragraph, and the page the browser built is no longer the one the
    // client claims.
    const page = document.createElement('div');
    page.innerHTML = html;

    const paragraphs = [...page.querySelectorAll('p')];
    expect(paragraphs).toHaveLength(2);
    for (const [index, paragraph] of paragraphs.entries()) {
      expect(paragraph.querySelector('.volt-separator'), `paragraph ${index}`).not.toBeNull();
    }
    expect(paragraphs[0]!.textContent).toMatch(/^Ann Lee\s+3 min read$/);
    expect(paragraphs[1]!.textContent).toMatch(/^Before\s+Notes\s+after$/);
  });
});
