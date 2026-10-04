/**
 * `<v-rating>`, driven the way a page drives it.
 *
 * The arithmetic, the keyboard map and the ARIA are `createRating`'s and are
 * tested where they live. What is tested here is the shell: that what a
 * caller writes on the tag reaches the group, which is the element carrying
 * the role; that every state the sheet draws is on the element its rules
 * select on; that the group is one tab stop with the keyboard the primitive
 * provides; that the hidden radios a form reads are really there under one
 * name; that the caller's signal and the primitive's number stay one score;
 * that every prop forwarded to the primitive does something; that the sheet
 * draws a half as half a star; and that nothing about the primitive is out of
 * reach.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Component, Signal, flushSync, mount } from '@voltdev/core';
import { compileTemplate } from '@voltdev/core/jit';
import { renderToStaticMarkup } from '@voltdev/core/server';
import { compileComponents } from './render.js';
import { standIn, styledDocument, SYSTEM_COLORS } from './harness.ts';
import { VRating } from '../src/components/rating.js';
import template from '../src/components/rating.html?raw';
import { FORCED_COLORS_QUERY, rulesToCss, wrap, type Rule } from '../src/index.ts';
import { ratingClasses, ratingStyles } from '../src/sheet/rating.js';
import { componentCss } from '../src/stylesheet.js';
import { primitiveTokens, semanticTokens, tokensCss } from '../src/tokens.js';

compileComponents();

let unmount: (() => void) | null = null;
let restores: (() => void)[] = [];

afterEach(() => {
  unmount?.();
  unmount = null;
  for (const restore of restores.splice(0).reverse()) restore();
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

/** A keydown as the user sends it: bubbling, and cancellable. */
function press(target: Element, key: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  flushSync();
  return event;
}

/** The pointer arriving over one star, which is all a preview is. */
function hover(target: Element): void {
  target.dispatchEvent(new PointerEvent('pointerenter'));
  flushSync();
}

function leave(target: Element): void {
  target.dispatchEvent(new PointerEvent('pointerleave'));
  flushSync();
}

function choose(target: HTMLElement): void {
  target.click();
  flushSync();
}

const groups = (host: HTMLElement): HTMLElement[] => [
  ...host.querySelectorAll<HTMLElement>('.volt-rating'),
];
const group = (host: HTMLElement): HTMLElement => groups(host)[0]!;
const stars = (host: HTMLElement): HTMLElement[] => [
  ...host.querySelectorAll<HTMLElement>('.volt-rating-star'),
];
const items = (host: HTMLElement): HTMLElement[] => [
  ...host.querySelectorAll<HTMLElement>('.volt-rating-item'),
];
const inputs = (host: HTMLElement): HTMLInputElement[] => [...host.querySelectorAll('input')];

/** The values of the radios carrying an attribute, which is how the sheet sees a state. */
const marked = (host: HTMLElement, attribute: string): (string | null)[] =>
  items(host)
    .filter((item) => item.hasAttribute(attribute))
    .map((item) => item.getAttribute('data-value'));

const tabStops = (host: HTMLElement): (string | null)[] =>
  items(host).map((item) => item.getAttribute('tabindex'));
const names = (host: HTMLElement): (string | null)[] =>
  items(host).map((item) => item.getAttribute('aria-label'));

describe('v-rating', () => {
  it('is a radio group of stars, with the sheet’s classes and the caller’s own', () => {
    @Component({
      selector: 'v-page-shape',
      imports: [VRating],
      render: compileTemplate(`
        <span id="hint">Five is the best there is.</span>
        <v-rating class="mine" data-test="kept" aria-describedby="hint" title="Stars" name="stars"
                  label="Your rating"></v-rating>
      `),
    })
    class Page {}

    const { host } = show(Page);
    const root = group(host);

    // What the caller wrote lands on the element carrying the role, which is
    // the group itself — so a class lays out the row and a description
    // describes the question.
    expect([...root.classList].sort()).toEqual(['mine', 'volt-rating']);
    expect(root.getAttribute('role')).toBe('radiogroup');
    expect(root.getAttribute('aria-label')).toBe('Your rating');
    expect(root.getAttribute('aria-describedby')).toBe('hint');
    expect(root.getAttribute('data-test')).toBe('kept');
    expect(root.getAttribute('title')).toBe('Stars');
    expect(root.getAttribute('aria-orientation')).toBe('horizontal');

    // Five stars of one radio each, every one named against the whole.
    expect(stars(host)).toHaveLength(5);
    expect(stars(host).map((star) => star.querySelectorAll('.volt-rating-item').length)).toEqual([
      1, 1, 1, 1, 1,
    ]);
    expect(items(host).map((item) => item.getAttribute('role'))).toEqual(Array(5).fill('radio'));
    expect(names(host)).toEqual(['1 of 5', '2 of 5', '3 of 5', '4 of 5', '5 of 5']);

    // The star is drawn in each radio, hidden from assistive technology, and
    // is an SVG shape inside an HTML radio — not an SVG radio, which is what a
    // block holding both would have parsed the radio as.
    for (const item of items(host)) {
      expect(item.namespaceURI).toBe('http://www.w3.org/1999/xhtml');
      const icon = item.querySelector('.volt-rating-icon')!;
      expect(icon.getAttribute('aria-hidden')).toBe('true');
      const svg = icon.querySelector('svg')!;
      expect(svg.namespaceURI).toBe('http://www.w3.org/2000/svg');
      expect(svg.querySelector('path')).not.toBeNull();
    }

    // One tab stop, on the first star while nothing is chosen.
    expect(tabStops(host)).toEqual(['0', '-1', '-1', '-1', '-1']);

    // A hidden radio per value, under the one name, outside the boxes that
    // clip the stars.
    expect(inputs(host).map((input) => [input.type, input.name, input.value])).toEqual([
      ['radio', 'stars', '1'],
      ['radio', 'stars', '2'],
      ['radio', 'stars', '3'],
      ['radio', 'stars', '4'],
      ['radio', 'stars', '5'],
    ]);
    for (const input of inputs(host)) {
      expect(input.parentElement).toBe(root);
      expect(input.getAttribute('aria-hidden')).toBe('true');
    }

    // The bag is spread again with every choice, and a description it never
    // carried is not one it takes back.
    choose(items(host)[2]!);
    expect(root.getAttribute('aria-describedby')).toBe('hint');
    expect([...root.classList].sort()).toEqual(['mine', 'volt-rating']);
  });

  it('writes every state the sheet’s rules select on', () => {
    @Component({
      selector: 'v-page-states',
      imports: [VRating],
      render: compileTemplate(`
        <v-rating label="Your rating" name="stars" :disabled="off.get()" :readOnly="locked.get()"></v-rating>
      `),
    })
    class Page {
      off = new Signal.State(false);
      locked = new Signal.State(false);
    }

    const { instance, host } = show(Page);
    const root = group(host);
    expect(marked(host, 'data-filled')).toEqual([]);

    // Chosen: every star up to the score is filled, and the one that is the
    // score is the checked radio holding the tab stop.
    choose(items(host)[2]!);
    expect(marked(host, 'data-filled')).toEqual(['1', '2', '3']);
    expect(items(host).map((item) => item.getAttribute('aria-checked'))).toEqual([
      'false',
      'false',
      'true',
      'false',
      'false',
    ]);
    expect(items(host)[2]!.getAttribute('data-state')).toBe('checked');
    expect(tabStops(host)).toEqual(['-1', '-1', '0', '-1', '-1']);
    expect(root.getAttribute('data-value')).toBe('3');

    // The pointer beyond the score lights the stars between the two, and only
    // those are the preview: the score stays drawn as the score under it.
    hover(items(host)[4]!);
    expect(marked(host, 'data-filled')).toEqual(['1', '2', '3', '4', '5']);
    expect(marked(host, 'data-preview')).toEqual(['4', '5']);
    expect(root.getAttribute('data-value')).toBe('3');

    // Below the score it shows what a press would choose, and none of it is a
    // preview of anything not already chosen.
    hover(items(host)[0]!);
    expect(marked(host, 'data-filled')).toEqual(['1']);
    expect(marked(host, 'data-preview')).toEqual([]);

    // Leaving the row puts the score back.
    leave(root);
    expect(marked(host, 'data-filled')).toEqual(['1', '2', '3']);
    expect(marked(host, 'data-preview')).toEqual([]);

    // Out of use: said on the group and on every radio, no tab stop anywhere,
    // and written through to the radios that submit. A press and the pointer
    // both do nothing.
    instance.off.set(true);
    flushSync();
    expect(root.hasAttribute('data-disabled')).toBe(true);
    expect(root.getAttribute('aria-disabled')).toBe('true');
    expect(marked(host, 'data-disabled')).toEqual(['1', '2', '3', '4', '5']);
    expect(tabStops(host)).toEqual(['-1', '-1', '-1', '-1', '-1']);
    expect(inputs(host).every((input) => input.disabled)).toBe(true);
    choose(items(host)[4]!);
    hover(items(host)[4]!);
    expect(marked(host, 'data-filled')).toEqual(['1', '2', '3']);
    expect(marked(host, 'data-preview')).toEqual([]);

    instance.off.set(false);
    flushSync();
    expect(root.hasAttribute('data-disabled')).toBe(false);
    expect(marked(host, 'data-disabled')).toEqual([]);
    expect(tabStops(host)).toEqual(['-1', '-1', '0', '-1', '-1']);

    // Read-only: an image named by the whole score, its stars hidden and out
    // of the tab order — and still filled, since showing the score is the
    // whole of what it is for. The radios that submit are not disabled.
    instance.locked.set(true);
    flushSync();
    expect(root.getAttribute('role')).toBe('img');
    expect(root.getAttribute('aria-label')).toBe('Rated 3 of 5');
    expect(root.hasAttribute('data-readonly')).toBe(true);
    expect(items(host).map((item) => item.getAttribute('aria-hidden'))).toEqual(
      Array(5).fill('true'),
    );
    expect(items(host).some((item) => item.hasAttribute('role'))).toBe(false);
    expect(items(host).some((item) => item.hasAttribute('tabindex'))).toBe(false);
    expect(marked(host, 'data-filled')).toEqual(['1', '2', '3']);
    expect(inputs(host).some((input) => input.disabled)).toBe(false);
    // An image is not a control, and `aria-readonly` is a state only a control
    // can be in: on `role="img"` it is an attribute the role does not allow.
    expect(root.hasAttribute('aria-readonly')).toBe(false);
    choose(items(host)[0]!);
    hover(items(host)[4]!);
    expect(marked(host, 'data-filled')).toEqual(['1', '2', '3']);
    expect(marked(host, 'data-preview')).toEqual([]);

    // And a radio group again once it ends, named by its question.
    instance.locked.set(false);
    flushSync();
    expect(root.getAttribute('role')).toBe('radiogroup');
    expect(root.getAttribute('aria-label')).toBe('Your rating');
    expect(root.hasAttribute('data-readonly')).toBe(false);
    expect(items(host).map((item) => item.getAttribute('role'))).toEqual(Array(5).fill('radio'));
  });

  it('lets go of the pointer’s preview the moment the stars stop being choosable', () => {
    @Component({
      selector: 'v-page-stale-preview',
      imports: [VRating],
      render: compileTemplate(`
        <v-rating label="Your rating" :defaultValue="2" :disabled="off.get()" :readOnly="locked.get()">
          <template :slot-icon="{ filled }"><b class="shape">{ filled ? '+' : '-' }</b></template>
        </v-rating>
      `),
    })
    class Page {
      off = new Signal.State(false);
      locked = new Signal.State(false);
    }

    const { instance, host } = show(Page);
    const root = group(host);
    const drawn = (): string =>
      items(host)
        .map((item) => item.querySelector('.shape')!.textContent)
        .join('');

    // The pointer rests on the last star, and then the rating is locked under
    // it — by a save that finished, say. Showing five stars beside a name that
    // says two would be the image contradicting itself, until the pointer
    // happened to move.
    hover(items(host)[4]!);
    expect(marked(host, 'data-preview')).toEqual(['3', '4', '5']);
    instance.locked.set(true);
    flushSync();
    expect(root.getAttribute('aria-label')).toBe('Rated 2 of 5');
    expect(marked(host, 'data-filled')).toEqual(['1', '2']);
    expect(marked(host, 'data-preview')).toEqual([]);
    expect(drawn()).toBe('++---');

    // Disabled under the pointer is the same: a preview of a press that can
    // no longer happen.
    instance.locked.set(false);
    flushSync();
    hover(items(host)[3]!);
    expect(marked(host, 'data-preview')).toEqual(['3', '4']);
    instance.off.set(true);
    flushSync();
    expect(marked(host, 'data-filled')).toEqual(['1', '2']);
    expect(marked(host, 'data-preview')).toEqual([]);
    expect(drawn()).toBe('++---');

    // And the pointer previews again once there is something to choose.
    instance.off.set(false);
    flushSync();
    hover(items(host)[3]!);
    expect(marked(host, 'data-preview')).toEqual(['3', '4']);
  });

  it('reads `"false"` written on `disabled` or `readOnly` as off, as it reads `halves`', () => {
    @Component({
      selector: 'v-page-written-flags',
      imports: [VRating],
      render: compileTemplate(`
        <v-rating readOnly="false" disabled="false" name="off" label="Written off"
                  :defaultValue="2"></v-rating>
        <v-rating readOnly disabled name="on" label="Written on" :defaultValue="2"></v-rating>
        <v-rating :readOnly="null" :disabled="null" name="unbound" label="Bound to nothing"></v-rating>
        <v-rating readOnly disabled="false" name="shown" :defaultValue="2"></v-rating>
        <v-rating :readOnly="nothing" :disabled="nothing" :halves="nothing" name="undefined"
                  label="Bound to undefined"></v-rating>
      `),
    })
    class Page {
      /** What an optional flag a page forwards holds until it is set. */
      nothing: boolean | undefined = undefined;
    }

    const { host } = show(Page);
    const [off, on, unbound, shown, undefinedBound] = groups(host) as [
      HTMLElement,
      HTMLElement,
      HTMLElement,
      HTMLElement,
      HTMLElement,
    ];

    // Written as an attribute, `"false"` is a string and every string is
    // truthy: without a reading of its own it would lock the rating a caller
    // had just said was not locked, and stop it submitting. Bound to `null`
    // or `undefined` — an optional flag forwarded from a page — is off too.
    expect(items(undefinedBound)).toHaveLength(5);
    for (const root of [off, unbound, undefinedBound]) {
      expect(root.getAttribute('role')).toBe('radiogroup');
      expect(root.hasAttribute('data-disabled')).toBe(false);
      expect(inputs(root).some((input) => input.disabled)).toBe(false);
      expect(tabStops(root)).toContain('0');
    }

    // Written bare, both are on.
    expect(on.getAttribute('role')).toBe('img');
    expect(inputs(on).every((input) => input.disabled)).toBe(true);
    expect(on.hasAttribute('data-disabled')).toBe(true);

    // Read-only on and disabled off is a score the form still sends, and is
    // not drawn as out of use.
    expect(shown.getAttribute('role')).toBe('img');
    expect(shown.hasAttribute('data-disabled')).toBe(false);
    expect(inputs(shown).some((input) => input.disabled)).toBe(false);
  });

  it('keeps one tab stop when the score falls between the stars it offers', () => {
    @Component({
      selector: 'v-page-between',
      imports: [VRating],
      render: compileTemplate(`
        <v-rating :defaultValue="2.5" name="between" label="Between"></v-rating>
        <v-rating :value="score" label="Bound"></v-rating>
        <v-rating :value="over" label="Beyond"></v-rating>
        <v-rating :defaultValue="0.3" label="Below"></v-rating>
        <v-rating :defaultValue="2.5" label="Off" disabled></v-rating>
        <v-rating :defaultValue="4.3" readOnly></v-rating>
      `),
    })
    class Page {
      score = new Signal.State<number | null>(4.3);
      /** A caller's own score, which is shown as it is: seven of five. */
      over = new Signal.State<number | null>(7);
    }

    const { instance, host } = show(Page);
    const [between, bound, beyond, below, off, average] = groups(host) as HTMLElement[];

    // An average, or a score from a rating that counted in halves, is a value
    // no radio here stands for — so no radio is checked, and the primitive's
    // tab stop, which goes to the checked radio, went nowhere: a keyboard
    // could not reach the rating at all. It goes to the last star the score
    // fills instead, which is the one the eye takes for the score.
    expect(tabStops(between!)).toEqual(['-1', '0', '-1', '-1', '-1']);
    expect(items(between!).some((item) => item.getAttribute('aria-checked') === 'true')).toBe(false);
    expect(tabStops(bound!)).toEqual(['-1', '-1', '-1', '0', '-1']);
    expect(tabStops(beyond!)).toEqual(['-1', '-1', '-1', '-1', '0']);
    expect(items(beyond!).some((item) => item.getAttribute('aria-checked') === 'true')).toBe(false);
    expect(tabStops(below!)).toEqual(['0', '-1', '-1', '-1', '-1']);
    // Disabled is still no tab stop at all, and an average shown read-only —
    // the usual place for a score between the stars — is an image with no
    // radios to stop on.
    expect(tabStops(off!)).toEqual(['-1', '-1', '-1', '-1', '-1']);
    expect(tabStops(average!)).toEqual(Array(5).fill(null));
    expect(average!.getAttribute('aria-label')).toBe('Rated 4.3 of 5');

    // And from there the keyboard works as it does anywhere else.
    items(between!)[1]!.focus();
    press(items(between!)[1]!, 'ArrowRight');
    expect(between!.getAttribute('data-value')).toBe('3');
    expect(tabStops(between!)).toEqual(['-1', '-1', '0', '-1', '-1']);
    press(items(bound!)[3]!, ' ');
    expect(instance.score.get()).toBe(4);
    expect(tabStops(bound!)).toEqual(['-1', '-1', '-1', '0', '-1']);

    // Moved off a step from outside, it follows.
    instance.score.set(1.5);
    flushSync();
    expect(tabStops(bound!)).toEqual(['0', '-1', '-1', '-1', '-1']);
  });

  it('keeps a tab stop for a rating that starts out of use with no score, once it is in use', () => {
    @Component({
      selector: 'v-page-late-stop',
      imports: [VRating],
      render: compileTemplate(`
        <v-rating label="Disabled first" :disabled="off.get()"></v-rating>
        <v-rating label="Read-only first" :readOnly="locked.get()"></v-rating>
        <v-rating label="Cleared while read-only" :value="score" :readOnly="locked.get()"></v-rating>
      `),
    })
    class Page {
      off = new Signal.State(true);
      locked = new Signal.State(true);
      score = new Signal.State<number | null>(3);
    }

    const { instance, host } = show(Page);
    const [disabled, readOnly, cleared] = groups(host) as [HTMLElement, HTMLElement, HTMLElement];

    // The primitive gives the tab stop to the first star it finds while there
    // is no score — and it looks once, when the group appears, skipping stars
    // that are disabled and finding none at all while the stars are an image.
    // A rating that starts out of use, the usual shape of one waiting on a
    // save or a sign-in, would come back with no tab stop anywhere: a keyboard
    // could not reach it at all.
    instance.score.set(null);
    flushSync();
    instance.off.set(false);
    instance.locked.set(false);
    flushSync();
    for (const root of [disabled, readOnly, cleared]) {
      expect(tabStops(root)).toEqual(['0', '-1', '-1', '-1', '-1']);
    }

    // And from there the keyboard answers as it does anywhere else: Space
    // chooses the star with focus, and an arrow moves on from it.
    items(disabled)[0]!.focus();
    press(items(disabled)[0]!, ' ');
    expect(disabled.getAttribute('data-value')).toBe('1');
    press(items(cleared)[0]!, 'ArrowRight');
    expect(instance.score.get()).toBe(2);
  });

  it('offers halves as two radios per star, the half before the whole', () => {
    @Component({
      selector: 'v-page-halves',
      imports: [VRating],
      render: compileTemplate(`
        <v-rating halves label="Halves" name="halves" :defaultValue="2.5"></v-rating>
        <v-rating halves="false" label="Written off"></v-rating>
        <v-rating :halves="false" label="Bound off"></v-rating>
        <v-rating :halves="null" label="Bound to nothing"></v-rating>
      `),
    })
    class Page {}

    const { host } = show(Page);
    const [halved, writtenOff, boundOff, boundNull] = groups(host);
    const inGroup = (root: HTMLElement): HTMLElement[] => [
      ...root.querySelectorAll<HTMLElement>('.volt-rating-item'),
    ];

    // Written bare it is on: ten radios in five stars, two to a star, the
    // half first, each named against the whole.
    expect(halved!.querySelectorAll('.volt-rating-star')).toHaveLength(5);
    expect(
      [...halved!.querySelectorAll('.volt-rating-star')].map((star) =>
        [...star.querySelectorAll('.volt-rating-item')].map((item) => item.getAttribute('data-value')),
      ),
    ).toEqual([
      ['0.5', '1'],
      ['1.5', '2'],
      ['2.5', '3'],
      ['3.5', '4'],
      ['4.5', '5'],
    ]);
    expect(inGroup(halved!)[0]!.getAttribute('aria-label')).toBe('0.5 of 5');
    expect(
      inGroup(halved!)
        .slice(0, 5)
        .filter((item) => item.hasAttribute('data-filled')),
    ).toHaveLength(5);
    expect(inGroup(halved!)[5]!.hasAttribute('data-filled')).toBe(false);
    expect([...halved!.querySelectorAll('input')].map((input) => input.value)).toEqual([
      '0.5', '1', '1.5', '2', '2.5', '3', '3.5', '4', '4.5', '5',
    ]);

    // A step is a half.
    press(inGroup(halved!)[4]!, 'ArrowRight');
    expect(halved!.getAttribute('data-value')).toBe('3');
    press(inGroup(halved!)[5]!, 'ArrowLeft');
    press(inGroup(halved!)[4]!, 'ArrowLeft');
    expect(halved!.getAttribute('data-value')).toBe('2');

    // `"false"` is the one string that is off, and bound it is what it was
    // bound to.
    expect(inGroup(writtenOff!)).toHaveLength(5);
    expect(inGroup(boundOff!)).toHaveLength(5);
    expect(inGroup(boundNull!)).toHaveLength(5);
  });

  it('takes the keyboard the primitive provides, as one tab stop', () => {
    @Component({
      selector: 'v-page-keys',
      imports: [VRating],
      render: compileTemplate(`<v-rating :value="stars" label="Your rating"></v-rating>`),
    })
    class Page {
      stars = new Signal.State<number | null>(null);
    }

    const { instance, host } = show(Page);
    const first = items(host)[0]!;
    first.focus();

    // Space chooses whatever has focus, which is how a row entered with
    // nothing chosen gets its first answer.
    expect(press(first, ' ').defaultPrevented).toBe(true);
    expect(instance.stars.get()).toBe(1);

    // Moving is choosing, and focus goes with it.
    press(first, 'ArrowRight');
    expect(instance.stars.get()).toBe(2);
    expect(document.activeElement).toBe(items(host)[1]);
    expect(tabStops(host)).toEqual(['-1', '0', '-1', '-1', '-1']);

    // All four arrows, as a native radio group answers them: Down goes on to
    // the next star and Up back to the one before, whatever the row looks
    // like.
    press(items(host)[1]!, 'ArrowDown');
    expect(instance.stars.get()).toBe(3);
    press(items(host)[2]!, 'ArrowUp');
    expect(instance.stars.get()).toBe(2);

    press(items(host)[1]!, 'End');
    expect(instance.stars.get()).toBe(5);
    expect(document.activeElement).toBe(items(host)[4]);

    // A row does not wrap at either end: past the last star is a misclick,
    // not a way back.
    press(items(host)[4]!, 'ArrowRight');
    expect(instance.stars.get()).toBe(5);

    press(items(host)[4]!, 'Home');
    expect(instance.stars.get()).toBe(1);
    expect(document.activeElement).toBe(first);
    press(first, 'ArrowLeft');
    expect(instance.stars.get()).toBe(1);

    // Delete takes the score away altogether, and Enter is the form's.
    press(first, 'ArrowRight');
    expect(press(items(host)[1]!, 'Delete').defaultPrevented).toBe(true);
    expect(instance.stars.get()).toBeNull();
    expect(marked(host, 'data-filled')).toEqual([]);
    expect(press(items(host)[0]!, 'Enter').defaultPrevented).toBe(false);
  });

  it('follows the writing direction written on the tag', () => {
    @Component({
      selector: 'v-page-rtl',
      imports: [VRating],
      render: compileTemplate(`<v-rating dir="rtl" :value="stars" label="التقييم"></v-rating>`),
    })
    class Page {
      stars = new Signal.State<number | null>(2);
    }

    const { instance, host } = show(Page);
    expect(group(host).getAttribute('dir')).toBe('rtl');

    // The stars run from the right, so Left is the arrow that raises.
    press(items(host)[1]!, 'ArrowLeft');
    expect(instance.stars.get()).toBe(3);
    press(items(host)[2]!, 'ArrowRight');
    expect(instance.stars.get()).toBe(2);
  });

  it('follows the score it was bound to, and reports what it moves it to', () => {
    @Component({
      selector: 'v-page-bound',
      imports: [VRating],
      render: compileTemplate(`
        <v-rating :value="stars" label="Your rating" :onValueChange="record"></v-rating>
      `),
    })
    class Page {
      stars = new Signal.State<number | null>(2);
      /** What the callback was given, beside what the signal held when it ran. */
      heard: [number | null, number | null][] = [];
      record = (value: number | null): void => {
        this.heard.push([value, this.stars.get()]);
      };
    }

    const { instance, host } = show(Page);
    expect(marked(host, 'data-filled')).toEqual(['1', '2']);

    // Written from outside, the stars follow and nobody is told: the caller
    // already knows what they wrote.
    instance.stars.set(4);
    flushSync();
    expect(marked(host, 'data-filled')).toEqual(['1', '2', '3', '4']);
    expect(items(host)[3]!.getAttribute('aria-checked')).toBe('true');
    instance.stars.set(null);
    flushSync();
    expect(marked(host, 'data-filled')).toEqual([]);
    expect(instance.heard).toEqual([]);
    // The caller's `null` is the primitive's zero, not a `null` handed through
    // to a number: the group says `0`, and the first star takes the tab stop.
    expect(group(host).getAttribute('data-value')).toBe('0');
    expect(tabStops(host)).toEqual(['0', '-1', '-1', '-1', '-1']);

    // Chosen by the user, the signal holds the score before the callback is
    // told it — so a callback that reads the signal reads the new score.
    choose(items(host)[0]!);
    expect(instance.stars.get()).toBe(1);
    press(items(host)[0]!, 'Backspace');
    expect(instance.stars.get()).toBeNull();
    expect(instance.heard).toEqual([
      [1, 1],
      [null, null],
    ]);
  });

  it('submits with the form it is written in, and resets with it', () => {
    @Component({
      selector: 'v-page-form',
      imports: [VRating],
      render: compileTemplate(`
        <form>
          <v-rating name="stars" :defaultValue="3" label="Your rating" :disabled="off.get()"
                    :readOnly="locked.get()" :onValueChange="record"></v-rating>
        </form>
      `),
    })
    class Page {
      off = new Signal.State(false);
      locked = new Signal.State(false);
      heard: (number | null)[] = [];
      record = (value: number | null): void => void this.heard.push(value);
    }

    const { instance, host } = show(Page);
    const form = host.querySelector('form')!;
    const submitted = (): [string, FormDataEntryValue][] => [...new FormData(form).entries()];

    expect(submitted()).toEqual([['stars', '3']]);
    choose(items(host)[4]!);
    expect(submitted()).toEqual([['stars', '5']]);

    // A reset puts back the score it was built with, on the stars and in what
    // submits, and says so.
    form.reset();
    flushSync();
    expect(marked(host, 'data-filled')).toEqual(['1', '2', '3']);
    expect(submitted()).toEqual([['stars', '3']]);
    expect(instance.heard).toEqual([5, 3]);

    // Read-only is a score that is still the answer; disabled is one that is
    // not sent at all.
    instance.locked.set(true);
    flushSync();
    expect(submitted()).toEqual([['stars', '3']]);
    instance.locked.set(false);
    instance.off.set(true);
    flushSync();
    expect(submitted()).toEqual([]);
  });

  it('takes its size and its starting score from the tag, in either spelling of a number', () => {
    @Component({
      selector: 'v-page-numbers',
      imports: [VRating],
      render: compileTemplate(`
        <v-rating max="10" defaultValue="7" label="Written"></v-rating>
        <v-rating :max="3" :defaultValue="2" label="Bound"></v-rating>
        <v-rating label="Neither"></v-rating>
      `),
    })
    class Page {}

    const { host } = show(Page);
    const [written, bound, neither] = groups(host).map((root) => [
      ...root.querySelectorAll<HTMLElement>('.volt-rating-item'),
    ]);

    expect(written).toHaveLength(10);
    expect(written!.map((item) => item.getAttribute('aria-label')).at(-1)).toBe('10 of 10');
    expect(written!.filter((item) => item.hasAttribute('data-filled'))).toHaveLength(7);
    expect(written![6]!.getAttribute('aria-checked')).toBe('true');

    expect(bound).toHaveLength(3);
    expect(bound!.filter((item) => item.hasAttribute('data-filled'))).toHaveLength(2);
    expect(bound![1]!.getAttribute('aria-checked')).toBe('true');

    // Five and unrated, when nothing says otherwise.
    expect(neither).toHaveLength(5);
    expect(neither!.some((item) => item.hasAttribute('data-filled'))).toBe(false);
  });

  it('holds a written starting score as the number it spells, and a spelling of none as unrated', () => {
    @Component({
      selector: 'v-page-spelled',
      imports: [VRating],
      render: compileTemplate(`
        <form>
          <v-rating :ref="written" defaultValue="3" name="written" label="Written"
                    :onValueChange="record"></v-rating>
          <v-rating :ref="junk" defaultValue="three" name="junk" label="Not a number"></v-rating>
        </form>
      `),
    })
    class Page {
      written: VRating | null = null;
      junk: VRating | null = null;
      heard: (number | null)[] = [];
      record = (value: number | null): void => void this.heard.push(value);
    }

    const { instance, host } = show(Page);
    const [, junkGroup] = groups(host) as [HTMLElement, HTMLElement];

    // The primitive keeps whatever it is handed, and `"3"` is not `3`: the
    // score it hands back would be text where it promises a number, and
    // asking whether 3 is chosen would say no.
    const written = instance.written!.rating;
    expect(written.value()).toBe(3);
    expect(written.isSelected(3)).toBe(true);

    // A reset puts back the number it started from, which is the score it
    // already holds — so nothing changed, and nobody is told otherwise.
    host.querySelector('form')!.reset();
    flushSync();
    expect(instance.heard).toEqual([]);

    // A spelling that is not a number is no score at all, not `NaN` — which
    // would be read out as "Rated NaN of 5" and written on the group.
    expect(instance.junk!.rating.value()).toBe(0);
    expect(junkGroup.getAttribute('data-value')).toBe('0');
    expect(marked(junkGroup, 'data-filled')).toEqual([]);
  });

  it('starts a score outside the stars at the nearest end, which is where a reset puts it back', () => {
    @Component({
      selector: 'v-page-outside',
      imports: [VRating],
      render: compileTemplate(`
        <form>
          <v-rating :defaultValue="7" name="over" label="Over" :onValueChange="record"></v-rating>
          <v-rating :defaultValue="-2" name="under" label="Under" :onValueChange="record"></v-rating>
          <v-rating :defaultValue="7" readOnly></v-rating>
          <v-rating :defaultValue="-2" readOnly></v-rating>
        </form>
      `),
    })
    class Page {
      heard: (number | null)[] = [];
      record = (value: number | null): void => void this.heard.push(value);
    }

    const { instance, host } = show(Page);
    const form = host.querySelector('form')!;
    const [over, under, overShown, underShown] = groups(host) as HTMLElement[];

    // Five stars hold at most five. Seven was drawn as five full stars beside
    // a name that said seven, with no radio checked, so the form sent nothing
    // for a rating that looked full; and below zero was read out as a score.
    expect(over!.getAttribute('data-value')).toBe('5');
    expect(items(over!)[4]!.getAttribute('aria-checked')).toBe('true');
    expect(under!.getAttribute('data-value')).toBe('0');
    expect(overShown!.getAttribute('aria-label')).toBe('Rated 5 of 5');
    expect(underShown!.getAttribute('aria-label')).toBe('Rated 0 of 5');
    expect([...new FormData(form).entries()]).toEqual([['over', '5']]);

    // The primitive's reset already puts back the nearest end. Starting
    // anywhere else, a reset with nothing changed moved the score and
    // reported a change nobody made.
    form.reset();
    flushSync();
    expect(instance.heard).toEqual([]);
    expect(groups(host).map((root) => root.getAttribute('data-value'))).toEqual(['5', '0', '5', '0']);
  });

  it('refuses a number of stars that is not one, while the tag is still what is wrong', () => {
    for (const [index, max] of ['ten', '0', '2.5'].entries()) {
      @Component({
        selector: `v-page-max-${index}`,
        imports: [VRating],
        render: compileTemplate(`<v-rating max="${max}" label="Rating"></v-rating>`),
      })
      class Page {}

      expect(() => show(Page)).toThrow(/`max` on <v-rating> takes a whole number of stars/);
    }
  });

  it('names the group in the caller’s words, and each star and the score in the caller’s wording', () => {
    @Component({
      selector: 'v-page-names',
      imports: [VRating],
      render: compileTemplate(`
        <h3 id="question">How was your stay?</h3>
        <v-rating :label="question.get()" :format="wording.get()"></v-rating>
        <v-rating label="Ignored" aria-label="Said the platform’s way"></v-rating>
        <v-rating aria-labelledby="question" label="Left off" :readOnly="locked.get()"
                  :defaultValue="4" :formatScore="scored.get()"></v-rating>
        <v-rating id="mine" label="With an id"></v-rating>
        <v-rating aria-labelledby="  " aria-label=" " label="  Fallen back  "></v-rating>
      `),
    })
    class Page {
      question = new Signal.State('How was your stay?');
      wording = new Signal.State<((value: number, max: number) => string) | undefined>(
        (value) => `${value} ${value === 1 ? 'star' : 'stars'}`,
      );
      scored = new Signal.State<((value: number, max: number) => string) | undefined>(undefined);
      locked = new Signal.State(false);
    }

    const { instance, host } = show(Page);
    const [named, aria, referenced, identified, blank] = groups(host);
    const itemNames = (root: HTMLElement): (string | null)[] =>
      [...root.querySelectorAll('.volt-rating-item')].map((item) => item.getAttribute('aria-label'));

    // Both follow what they were bound to: the question, and each star's
    // wording, on a rating already on screen.
    expect(named!.getAttribute('aria-label')).toBe('How was your stay?');
    expect(itemNames(named!)).toEqual(['1 star', '2 stars', '3 stars', '4 stars', '5 stars']);
    instance.question.set('How was the food?');
    instance.wording.set((value, max) => `${value} out of ${max}`);
    flushSync();
    expect(named!.getAttribute('aria-label')).toBe('How was the food?');
    expect(itemNames(named!)[2]).toBe('3 out of 5');
    instance.wording.set(undefined);
    flushSync();
    expect(itemNames(named!)[2]).toBe('3 of 5');

    // The platform's spelling wins over the prop that says the same thing.
    expect(aria!.getAttribute('aria-label')).toBe('Said the platform’s way');

    // A reference names the group while it is one, alone: the `label` beside
    // it is left off rather than written where nothing would read it.
    expect(referenced!.getAttribute('aria-labelledby')).toBe('question');
    expect(referenced!.hasAttribute('aria-label')).toBe(false);

    // It stands down while the group is an image, whose name is the score —
    // said the default way, and then in the caller's own words.
    instance.locked.set(true);
    flushSync();
    expect(referenced!.hasAttribute('aria-labelledby')).toBe(false);
    expect(referenced!.getAttribute('aria-label')).toBe('Rated 4 of 5');
    instance.scored.set((value, max) => `Noté ${value} sur ${max}`);
    flushSync();
    expect(referenced!.getAttribute('aria-label')).toBe('Noté 4 sur 5');

    instance.locked.set(false);
    flushSync();
    expect(referenced!.getAttribute('aria-labelledby')).toBe('question');
    expect(referenced!.hasAttribute('aria-label')).toBe(false);

    // The id is the primitive's to write, and it writes the one given.
    expect(identified!.id).toBe('mine');
    expect(named!.id).not.toBe('');

    // A reference or a name that comes to nothing but spaces is not one: it
    // would win over the words that were written, and name the group with
    // nothing. Each gives way to the next, and the words are trimmed.
    expect(blank!.hasAttribute('aria-labelledby')).toBe(false);
    expect(blank!.getAttribute('aria-label')).toBe('Fallen back');
  });

  it('lands a class, an id and a name on the element carrying the role, and follows a bound name', () => {
    @Component({
      selector: 'v-page-landing',
      imports: [VRating],
      render: compileTemplate(`
        <span id="one">One</span><span id="two">Two</span>
        <v-rating class="mine" id="landed" aria-label="Named on the tag"></v-rating>
        <v-rating :aria-label="named.get()" label="Fallen back"></v-rating>
        <v-rating :aria-labelledby="by.get()" label="Fallen back"></v-rating>
      `),
    })
    class Page {
      named = new Signal.State<string | undefined>('First');
      by = new Signal.State<string | undefined>('one');
    }

    const { instance, host } = show(Page);
    const [landed, named, referenced] = groups(host) as [HTMLElement, HTMLElement, HTMLElement];

    // Each lands on the group, which carries the role, and on nothing else —
    // not a star, and not a hidden radio.
    expect(landed.getAttribute('role')).toBe('radiogroup');
    expect([...host.querySelectorAll('.mine')]).toEqual([landed]);
    expect([...host.querySelectorAll('#landed')]).toEqual([landed]);
    expect([...host.querySelectorAll('[aria-label="Named on the tag"]')]).toEqual([landed]);

    // Bound, both ARIA spellings follow their signals, and give way to
    // `label` once the signal holds nothing.
    expect(named.getAttribute('aria-label')).toBe('First');
    expect(referenced.getAttribute('aria-labelledby')).toBe('one');
    instance.named.set('Second');
    instance.by.set('two');
    flushSync();
    expect(named.getAttribute('aria-label')).toBe('Second');
    expect(referenced.getAttribute('aria-labelledby')).toBe('two');
    instance.named.set(undefined);
    instance.by.set(undefined);
    flushSync();
    expect(named.getAttribute('aria-label')).toBe('Fallen back');
    expect(referenced.hasAttribute('aria-labelledby')).toBe(false);
    expect(referenced.getAttribute('aria-label')).toBe('Fallen back');
  });

  it('draws a shape of the caller’s own in every star, told its value and whether it is filled', () => {
    @Component({
      selector: 'v-page-icon',
      imports: [VRating],
      render: compileTemplate(`
        <v-rating label="Hearts" :defaultValue="2">
          <template :slot-icon="{ value, filled }"><b class="heart">{ value }{ filled ? '+' : '-' }</b></template>
        </v-rating>
      `),
    })
    class Page {}

    const { host } = show(Page);
    const drawn = (): string[] =>
      items(host).map((item) => item.querySelector('.volt-rating-icon .heart')?.textContent ?? '');

    expect(drawn()).toEqual(['1+', '2+', '3-', '4-', '5-']);
    expect(host.querySelector('.volt-rating-icon svg')).toBeNull();

    // The same marks the sheet reads, handed to the shape: the preview too.
    hover(items(host)[3]!);
    expect(drawn()).toEqual(['1+', '2+', '3+', '4+', '5-']);
  });

  it('refuses a value that is not a signal, while the tag is still what is wrong', () => {
    @Component({
      selector: 'v-page-not-a-signal',
      imports: [VRating],
      render: compileTemplate(`<v-rating value="3" label="Rating"></v-rating>`),
    })
    class Page {}

    expect(() => show(Page)).toThrow(/`value` on <v-rating> takes a signal/);
    expect(() => show(Page)).toThrow(/defaultValue/);
  });

  it('hands the primitive itself to whoever needs more than this offers', () => {
    @Component({
      selector: 'v-page-ref',
      imports: [VRating],
      render: compileTemplate(`<v-rating :ref="handle" label="Rating"></v-rating>`),
    })
    class Page {
      handle: VRating | null = null;
    }

    const { instance, host } = show(Page);
    const rating = instance.handle!.rating;

    rating.setValue(4);
    flushSync();
    expect(marked(host, 'data-filled')).toEqual(['1', '2', '3', '4']);
    expect(rating.value()).toBe(4);
    expect(rating.valueText()).toBe('Rated 4 of 5');
    expect(rating.values()).toEqual([1, 2, 3, 4, 5]);

    rating.preview(5);
    flushSync();
    expect(marked(host, 'data-preview')).toEqual(['5']);

    rating.clear();
    flushSync();
    expect(rating.value()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The component and its sheet, measured together
// ---------------------------------------------------------------------------

/** The sheet's own rules in the document, for what has to be measured. */
function withSheet(): void {
  const style = document.createElement('style');
  style.textContent = `${tokensCss()}\n\n${componentCss(ratingStyles)}`;
  document.head.append(style);
  restores.push(() => style.remove());
}

/** A token as it computes here: a semantic role resolved to the primitive it points at. */
function token(name: string): string {
  const value = semanticTokens[name] ?? name;
  const inner = /^var\((--[\w-]+)\)$/.exec(value)?.[1];
  return inner ? (primitiveTokens[inner] ?? value) : value;
}

describe('v-rating and the sheet', () => {
  @Component({
    selector: 'v-page-sheet',
    imports: [VRating],
    render: compileTemplate(`
      <v-rating :value="whole" label="Wholes" :disabled="off.get()" :readOnly="locked.get()"></v-rating>
      <v-rating :value="half" halves label="Halves"></v-rating>
    `),
  })
  class SheetPage {
    whole = new Signal.State<number | null>(null);
    half = new Signal.State<number | null>(2.5);
    off = new Signal.State(false);
    locked = new Signal.State(false);
  }

  it('writes only classes the sheet declares', () => {
    const { host } = show(SheetPage);
    const declared = new Set<string>(Object.values(ratingClasses));
    const written = [...host.querySelectorAll('*')].flatMap((element) =>
      [...element.classList].filter((name) => name.startsWith('volt-')),
    );
    expect(new Set(written)).toEqual(declared);
  });

  it('gives every rule something the component draws', () => {
    const selectors = [...ratingStyles.rules, ...ratingStyles.forcedColors]
      .flatMap((rule) => rule.selector.split(',').map((selector) => selector.trim()))
      // Keyboard focus is a state nothing here drives; what is asked is
      // whether the classes and attributes around it are ones the component
      // writes.
      .map((selector) => selector.replaceAll(':focus-visible', ''));
    const unmatched = new Set(selectors);
    const look = (): void => {
      for (const selector of unmatched) if (document.querySelector(selector)) unmatched.delete(selector);
    };

    const { instance, host } = show(SheetPage);
    const wholes = (): HTMLElement[] => [
      ...group(host).querySelectorAll<HTMLElement>('.volt-rating-item'),
    ];
    look();

    choose(wholes()[1]!);
    hover(wholes()[4]!);
    look();
    leave(group(host));

    instance.off.set(true);
    flushSync();
    look();
    instance.off.set(false);

    instance.locked.set(true);
    flushSync();
    look();

    expect([...unmatched]).toEqual([]);
  });

  it('draws a half as half a star, by clipping a whole one', () => {
    withSheet();
    const { host } = show(SheetPage);
    const [wholes, halves] = groups(host) as [HTMLElement, HTMLElement];
    const style = (element: Element): CSSStyleDeclaration => getComputedStyle(element);
    const icon = (item: Element): CSSStyleDeclaration =>
      style(item.querySelector('.volt-rating-icon')!);

    const star = style(halves.querySelector('.volt-rating-star')!);
    const size = star.getPropertyValue('inline-size');
    expect(size).toBe(primitiveTokens['--volt-space-6']);
    expect(star.getPropertyValue('block-size')).toBe(size);

    // The two radios of a star share its box equally, and each clips what it
    // holds to its own edges.
    const [half, whole] = [...halves.querySelectorAll('.volt-rating-star')[2]!.children] as [
      HTMLElement,
      HTMLElement,
    ];
    for (const item of [half, whole]) {
      expect(style(item).getPropertyValue('flex-grow')).toBe('1');
      expect(style(item).getPropertyValue('flex-basis')).toBe('0px');
      expect(style(item).getPropertyValue('overflow-x')).toBe('hidden');
      expect(style(item).getPropertyValue('overflow-y')).toBe('hidden');
    }

    // What each holds is the whole shape at the star's size, so what is left
    // after the clip is half of it: the near half for the first radio, and
    // the far half for the second, whose shape is pulled back by the radio's
    // own width — on the logical edge, so a right-to-left page fills from the
    // right, and on no physical side.
    for (const item of [half, whole]) {
      expect(icon(item).getPropertyValue('inline-size')).toBe(size);
      expect(icon(item).getPropertyValue('block-size')).toBe(size);
      for (const physical of ['left', 'right', 'translate', 'transform']) {
        expect(icon(item).getPropertyValue(physical), physical).toBe('');
      }
    }
    expect(icon(half).getPropertyValue('inset-inline-start')).toBe('0');
    expect(icon(whole).getPropertyValue('inset-inline-start')).toBe('-100%');
    // A star of one radio has nothing to pull back.
    expect(icon(wholes.querySelector('.volt-rating-item')!).getPropertyValue('inset-inline-start')).toBe('0');

    // At 2.5, the third star is that half filled and the other hollow.
    expect(icon(half).getPropertyValue('fill-opacity')).toBe('1');
    expect(icon(whole).getPropertyValue('fill-opacity')).toBe('0');
  });

  it('draws the shape in the colour it inherits, solid when filled and lighter when only previewed', () => {
    withSheet();
    const { host } = show(SheetPage);
    const root = group(host);
    const wholes = (): HTMLElement[] => [...root.querySelectorAll<HTMLElement>('.volt-rating-item')];
    const icon = (item: Element): CSSStyleDeclaration =>
      getComputedStyle(item.querySelector('.volt-rating-icon')!);

    // Fill and edge both follow `color`, which is what a forced palette
    // repaints; the shape is the difference it leaves alone.
    for (const property of ['fill', 'stroke']) {
      expect(icon(wholes()[0]!).getPropertyValue(property), property).toBe('currentColor');
    }
    expect(getComputedStyle(root).getPropertyValue('color')).toBe(
      token('--volt-color-border-strong'),
    );
    expect(icon(wholes()[0]!).getPropertyValue('fill-opacity')).toBe('0');

    choose(wholes()[1]!);
    expect(getComputedStyle(wholes()[1]!).getPropertyValue('color')).toBe(
      token('--volt-color-accent'),
    );
    expect(icon(wholes()[1]!).getPropertyValue('fill-opacity')).toBe('1');
    expect(icon(wholes()[1]!).getPropertyValue('opacity')).not.toBe('0.5');

    // Beyond the score, under the pointer: filled like the score, and lighter
    // than it, so the score stays readable underneath.
    hover(wholes()[3]!);
    expect(icon(wholes()[3]!).getPropertyValue('fill-opacity')).toBe('1');
    expect(icon(wholes()[3]!).getPropertyValue('opacity')).toBe('0.5');
    expect(icon(wholes()[1]!).getPropertyValue('opacity')).not.toBe('0.5');
  });

  it('holds what it hides inside itself, and hands the pointer through the shape to the radio', () => {
    withSheet();
    const { host } = show(SheetPage);
    const root = group(host);

    // The primitive positions each hidden radio absolutely, so the group has
    // to be the box they are positioned in — or they are placed against
    // whatever positioned ancestor the page happens to have, and a page that
    // scrolls to an invalid one scrolls somewhere else.
    expect(getComputedStyle(root).getPropertyValue('position')).toBe('relative');
    for (const input of inputs(host)) {
      expect(getComputedStyle(input).getPropertyValue('position')).toBe('absolute');
    }

    // The shape is drawn over the radio and is never the thing pressed, so a
    // shape of the caller's own cannot take the press or the preview for
    // itself.
    const icon = getComputedStyle(root.querySelector('.volt-rating-icon')!);
    expect(icon.getPropertyValue('pointer-events')).toBe('none');
    // Filling, colouring and lightening ease in, on the token every
    // transition is timed by, which is the one reduced motion takes away.
    expect(icon.getPropertyValue('transition-property')).toBe('fill-opacity, color, opacity');
    expect(ratingStyles.rules.find((rule) => rule.selector === '.volt-rating-icon')!.declarations)
      .toMatchObject({ 'transition-duration': 'var(--volt-duration-fast)' });
  });

  it('promises a press only where one can change the score', () => {
    withSheet();
    const { instance, host } = show(SheetPage);
    const item = (): HTMLElement => group(host).querySelector<HTMLElement>('.volt-rating-item')!;
    const cursor = (): string => getComputedStyle(item()).getPropertyValue('cursor');

    expect(cursor()).toBe('pointer');
    instance.off.set(true);
    flushSync();
    expect(cursor()).toBe('not-allowed');
    expect(getComputedStyle(group(host)).getPropertyValue('opacity')).toBe(
      token('--volt-disabled-opacity'),
    );
    instance.off.set(false);
    instance.locked.set(true);
    flushSync();
    expect(cursor()).toBe('default');
  });

  it('draws a read-only score that will not be sent as out of use', () => {
    withSheet();
    @Component({
      selector: 'v-page-shown-off',
      imports: [VRating],
      render: compileTemplate(`
        <form>
          <v-rating name="shown" readOnly :disabled="off.get()" :defaultValue="3"></v-rating>
        </form>
      `),
    })
    class Page {
      off = new Signal.State(false);
    }

    const { instance, host } = show(Page);
    const root = group(host);
    const form = host.querySelector('form')!;
    expect([...new FormData(form).entries()]).toEqual([['shown', '3']]);
    expect(root.hasAttribute('data-disabled')).toBe(false);
    expect(getComputedStyle(root).getPropertyValue('opacity')).not.toBe(
      token('--volt-disabled-opacity'),
    );

    // Disabled as well, the score is no longer the form's answer — and a
    // score the form will send has to look different from one it will not.
    // The primitive's image carries no `data-disabled`, so the sheet drew the
    // two the same; the image is still an image, named by its score.
    instance.off.set(true);
    flushSync();
    expect([...new FormData(form).entries()]).toEqual([]);
    expect(root.getAttribute('role')).toBe('img');
    expect(root.getAttribute('aria-label')).toBe('Rated 3 of 5');
    expect(root.hasAttribute('data-disabled')).toBe(true);
    expect(getComputedStyle(root).getPropertyValue('opacity')).toBe(
      token('--volt-disabled-opacity'),
    );
    // Still a fact rather than a choice: no star promises a press.
    expect(getComputedStyle(items(host)[0]!).getPropertyValue('cursor')).toBe('default');

    instance.off.set(false);
    flushSync();
    expect(root.hasAttribute('data-disabled')).toBe(false);
  });
});

/**
 * The cascade a forced palette leaves, measured rather than read: the pairs in
 * `forced-colors.test.ts` ask only whether two states still differ, and a
 * filled star that stayed `Highlight` inside a disabled rating would still
 * differ from an empty one. What a reader is shown is asked here, by the
 * palette's own names.
 */
describe('v-rating, once the palette is the user’s', () => {
  const forced = styledDocument({ forcedColors: true });
  afterAll(() => forced.close());

  /** The sheet as `harness.ts` installs it, with system colours as stand-ins. */
  const asTested = (rules: readonly Rule[]): Rule[] =>
    rules.map((rule) => ({
      selector: rule.selector,
      declarations: Object.fromEntries(
        Object.entries(rule.declarations).map(([property, value]) => [
          property,
          SYSTEM_COLORS.includes(value) ? standIn(value) : value,
        ]),
      ),
    }));

  beforeAll(() => {
    forced.addConsumerCss(
      `${rulesToCss(asTested(ratingStyles.rules))}\n` +
        wrap(FORCED_COLORS_QUERY, rulesToCss(asTested(ratingStyles.forcedColors), '  ')),
    );
  });

  /** One star of one radio, the group and the radio carrying what they are given. */
  const look = (
    on: { group?: Record<string, string>; radio?: Record<string, string> },
    focus = false,
  ) => {
    const root = forced.mount({
      classes: ['volt-rating'],
      attributes: { role: 'radiogroup', ...on.group },
      children: [
        {
          tag: 'span',
          classes: ['volt-rating-star'],
          children: [
            {
              tag: 'span',
              classes: ['volt-rating-item'],
              attributes: { role: 'radio', tabindex: '0', ...on.radio },
              focus,
              children: [{ tag: 'span', classes: ['volt-rating-icon'] }],
            },
          ],
        },
      ],
    });
    // Computed in the document it was mounted into, which is the forced one.
    const computed = (element: Element): CSSStyleDeclaration =>
      element.ownerDocument.defaultView!.getComputedStyle(element);
    const item = root.querySelector('.volt-rating-item')!;
    const style = computed(item);
    const shape = computed(item.querySelector('.volt-rating-icon')!);
    return {
      colour: style.getPropertyValue('color'),
      ring: style.getPropertyValue('outline-color'),
      fill: shape.getPropertyValue('fill-opacity'),
      opacity: shape.getPropertyValue('opacity'),
      dimmed: computed(root).getPropertyValue('opacity'),
    };
  };

  const FILLED = { 'data-filled': '' };
  const OFF = { 'data-disabled': '' };

  it('draws the score in the colour the palette keeps for a choice, and in shape', () => {
    const empty = look({});
    const filled = look({ radio: FILLED });
    expect(empty.colour).toBe(standIn('CanvasText'));
    expect(empty.fill).toBe('0');
    expect(filled.colour).toBe(standIn('Highlight'));
    expect(filled.fill).toBe('1');

    // A preview is the score's colour, lighter.
    const previewed = look({ radio: { ...FILLED, 'data-preview': '' } });
    expect(previewed.colour).toBe(standIn('Highlight'));
    expect(previewed.opacity).toBe('0.5');
  });

  it('draws a disabled score in `GrayText`, filled stars included, and does not dim it again', () => {
    const empty = look({ group: OFF, radio: OFF });
    const filled = look({ group: OFF, radio: { ...OFF, ...FILLED } });
    // `Highlight` on a filled star would make a score nobody can change look
    // live; solid against hollow still says which stars are the score.
    expect(empty.colour).toBe(standIn('GrayText'));
    expect(filled.colour).toBe(standIn('GrayText'));
    expect(filled.fill).toBe('1');
    expect(empty.fill).toBe('0');
    expect(filled.dimmed).toBe('1');
  });

  it('rings the star that has focus in the palette’s own colour for it', () => {
    expect(look({}, true).ring).toBe(standIn('Highlight'));
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
describe('v-rating, written by a server', () => {
  const serverBuild = (on: boolean): void => {
    (globalThis as { __VOLT_SERVER__?: boolean }).__VOLT_SERVER__ = on;
  };
  beforeAll(() => serverBuild(true));
  afterAll(() => serverBuild(false));

  it('shows the score, names every star and checks the radio that submits, before anything attaches', async () => {
    @Component({ selector: 'v-rating', render: compileTemplate(template, 'v-rating') })
    class ServerRating extends VRating {}

    @Component({
      selector: 'v-page-server',
      imports: [ServerRating],
      render: compileTemplate(`
        <v-rating id="stay" class="mine" name="stay" label="Your rating" :defaultValue="3"></v-rating>
        <v-rating readOnly halves :defaultValue="4.5"></v-rating>
        <v-rating name="fresh" label="Not rated yet"></v-rating>
      `),
    })
    class Page {}

    const { html } = await renderToStaticMarkup(Page);
    const page = document.createElement('div');
    page.innerHTML = html;
    const [editable, shown, fresh] = groups(page) as [HTMLElement, HTMLElement, HTMLElement];

    // With no score, the first star is the tab stop in the bytes as well:
    // the primitive finds its first star by looking in the document, and a
    // server has none to look in, so it wrote a row nobody could Tab to.
    expect(tabStops(fresh)).toEqual(['0', '-1', '-1', '-1', '-1']);

    expect(editable.id).toBe('stay');
    expect([...editable.classList].sort()).toEqual(['mine', 'volt-rating']);
    expect(editable.getAttribute('role')).toBe('radiogroup');
    expect(editable.getAttribute('aria-label')).toBe('Your rating');
    expect(names(editable)).toEqual(['1 of 5', '2 of 5', '3 of 5', '4 of 5', '5 of 5']);
    expect(marked(editable, 'data-filled')).toEqual(['1', '2', '3']);
    expect(tabStops(editable)).toEqual(['-1', '-1', '0', '-1', '-1']);
    expect(
      inputs(editable)
        .filter((input) => input.hasAttribute('checked'))
        .map((input) => [input.name, input.value]),
    ).toEqual([['stay', '3']]);

    expect(shown.getAttribute('role')).toBe('img');
    expect(shown.getAttribute('aria-label')).toBe('Rated 4.5 of 5');
    expect(shown.hasAttribute('aria-readonly')).toBe(false);
    expect(marked(shown, 'data-filled')).toEqual(['0.5', '1', '1.5', '2', '2.5', '3', '3.5', '4', '4.5']);
  });
});
