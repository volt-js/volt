/**
 * `<v-slider>`, driven the way a page drives it.
 *
 * The arithmetic, the keyboard map and the ARIA are `createSlider`'s and are
 * tested where they live. What is tested here is the shell: that what a
 * caller writes on the tag reaches the group and, where it is a name, the
 * single thumb; that every state the sheet draws is on the element its rules
 * select on; that the positions the sheet cannot hold are written inline on
 * the logical edge; that the hidden inputs a form reads are really there, one
 * per thumb; that every prop forwarded to the primitive does something; and
 * that nothing about the primitive is out of reach.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Component, Signal, flushSync, hydrate, mount, type RenderFn } from '@voltdev/core';
import { compile, compileTemplate } from '@voltdev/core/jit';
import * as runtime from '@voltdev/core/runtime';
import * as server from '@voltdev/core/server';
import { renderToStaticMarkup } from '@voltdev/core/server';
import { createLocaleProvider } from '@voltdev/primitives';
import { compileComponents } from './render.js';
import { standIn, styledDocument, SYSTEM_COLORS } from './harness.ts';
import { VSlider } from '../src/components/slider.js';
import template from '../src/components/slider.html?raw';
import { FORCED_COLORS_QUERY, rulesToCss, wrap, type Rule } from '../src/index.ts';
import { sliderClasses, sliderStyles } from '../src/sheet/slider.js';
import { componentCss } from '../src/stylesheet.js';
import { tokensCss } from '../src/tokens.js';

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

/** Give the track a box, since nothing here is laid out: two hundred pixels along, eight tall. */
function layout(el: Element, box: Partial<DOMRect> = {}): void {
  const rect = {
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 200,
    bottom: 8,
    width: 200,
    height: 8,
    ...box,
    toJSON: () => rect,
  } as DOMRect;
  el.getBoundingClientRect = () => rect;
}

function pointerDown(target: Element, point: { clientX?: number; clientY?: number }): PointerEvent {
  const event = new PointerEvent('pointerdown', {
    bubbles: true,
    cancelable: true,
    button: 0,
    isPrimary: true,
    pointerId: 1,
    clientX: 0,
    clientY: 0,
    ...point,
  });
  target.dispatchEvent(event);
  flushSync();
  return event;
}

function pointerMove(point: { clientX?: number; clientY?: number }): void {
  document.dispatchEvent(
    new PointerEvent('pointermove', { bubbles: true, pointerId: 1, clientX: 0, clientY: 0, ...point }),
  );
  flushSync();
}

function pointerUp(): void {
  document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
  flushSync();
}

const group = (host: HTMLElement): HTMLElement => host.querySelector('.volt-slider')!;
const label = (host: HTMLElement): HTMLElement | null => host.querySelector('.volt-slider-label');
const track = (host: HTMLElement): HTMLElement => host.querySelector('.volt-slider-track')!;
const range = (host: HTMLElement): HTMLElement => host.querySelector('.volt-slider-range')!;
const thumbs = (host: HTMLElement): HTMLElement[] => [
  ...host.querySelectorAll<HTMLElement>('.volt-slider-thumb'),
];
const marks = (host: HTMLElement): HTMLElement[] => [
  ...host.querySelectorAll<HTMLElement>('.volt-slider-mark'),
];
const inputs = (host: HTMLElement): HTMLInputElement[] => [...host.querySelectorAll('input')];
const values = (host: HTMLElement): (string | null)[] =>
  thumbs(host).map((thumb) => thumb.getAttribute('aria-valuenow'));
const inlineStart = (el: HTMLElement): string => el.style.getPropertyValue('inset-inline-start');

describe('v-slider', () => {
  it('is a group holding a track, a fill and a thumb, with the sheet’s classes and the caller’s own', () => {
    @Component({
      selector: 'v-page-anatomy',
      imports: [VSlider],
      render: compileTemplate(
        `<v-slider class="mine" id="volume" data-test="slider" title="Loudness" label="Volume" name="volume" :defaultValue="40"></v-slider>`,
      ),
    })
    class Page {}

    const { host } = show(Page);

    // What the caller wrote lands on the group, which is the element carrying
    // the control's name and the whole of what they can see — and the group
    // is what the tag renders, with no layout element between the two.
    expect(host.firstElementChild).toBe(group(host));
    expect([...group(host).classList].sort()).toEqual(['mine', 'volt-slider']);
    expect(group(host).id).toBe('volume');
    expect(group(host).dataset['test']).toBe('slider');
    expect(group(host).title).toBe('Loudness');
    expect(group(host).getAttribute('role')).toBe('group');

    // The label is drawn, and it is what names the group and its one thumb.
    expect(label(host)?.textContent).toBe('Volume');
    expect(label(host)?.id).not.toBe('');
    expect(group(host).getAttribute('aria-labelledby')).toBe(label(host)!.id);

    // The role is the thumb's, with the numbers a reader needs beside it.
    const [thumb] = thumbs(host);
    expect(thumbs(host)).toHaveLength(1);
    expect(thumb!.getAttribute('role')).toBe('slider');
    expect(thumb!.getAttribute('aria-labelledby')).toBe(label(host)!.id);
    expect(thumb!.hasAttribute('aria-label')).toBe(false);
    expect(thumb!.getAttribute('aria-valuemin')).toBe('0');
    expect(thumb!.getAttribute('aria-valuemax')).toBe('100');
    expect(thumb!.getAttribute('aria-valuenow')).toBe('40');
    expect(thumb!.getAttribute('aria-orientation')).toBe('horizontal');
    expect(thumb!.getAttribute('tabindex')).toBe('0');

    // The parts the sheet draws, each inside the last: the fill and the thumb
    // sit in the track, so the percentage each is placed at is a percentage
    // of the box a press is measured against.
    expect(group(host).contains(track(host))).toBe(true);
    expect(track(host).contains(range(host))).toBe(true);
    expect(track(host).contains(thumb!)).toBe(true);

    // Behind the thumb is a real input, hidden by the primitive rather than
    // left out: it is the half that submits, validates and resets.
    const [input] = inputs(host);
    expect(inputs(host)).toHaveLength(1);
    expect(input!.type).toBe('range');
    expect(input!.name).toBe('volume');
    expect(input!.value).toBe('40');
    expect(input!.getAttribute('aria-hidden')).toBe('true');
    expect(input!.getAttribute('tabindex')).toBe('-1');

    // A key marks the field touched, which writes the group's bag again, and
    // what the caller wrote is still there afterwards.
    press(thumb!, 'ArrowRight');
    expect(group(host).hasAttribute('data-touched')).toBe(true);
    expect(group(host).id).toBe('volume');
    expect([...group(host).classList].sort()).toEqual(['mine', 'volt-slider']);
    expect(group(host).dataset['test']).toBe('slider');
    expect(group(host).title).toBe('Loudness');
  });

  it('leaves alone what the caller wrote under a name the primitive has no opinion on', () => {
    @Component({
      selector: 'v-page-no-opinion',
      imports: [VSlider],
      render: compileTemplate(
        `<v-slider data-required="" data-readonly="" label="Volume" :defaultValue="40"></v-slider>`,
      ),
    })
    class Page {}

    const { host } = show(Page);

    // The group's bag carries both names, and says nothing with either: this
    // slider is neither required nor read-only as far as the primitive knows.
    // A bag that says nothing is not a bag that says "not that", so what the
    // caller wrote stays — through the first write and the ones a key causes.
    expect(group(host).hasAttribute('data-required')).toBe(true);
    expect(group(host).hasAttribute('data-readonly')).toBe(true);
    press(thumbs(host)[0]!, 'ArrowRight');
    expect(group(host).hasAttribute('data-touched')).toBe(true);
    expect(group(host).hasAttribute('data-required')).toBe(true);
    expect(group(host).hasAttribute('data-readonly')).toBe(true);
  });

  it('writes every state the sheet’s rules select on', () => {
    @Component({
      selector: 'v-page-states',
      imports: [VSlider],
      render: compileTemplate(
        `<v-slider :value="price" :disabled="off.get()" :marks="[0, { value: 50, label: 'Half' }, 100]"></v-slider>`,
      ),
    })
    class Page {
      price = new Signal.State<readonly number[]>([20, 60]);
      off = new Signal.State(false);
    }

    const { instance, host } = show(Page);
    const [low, high] = thumbs(host) as [HTMLElement, HTMLElement];

    // Orientation on every part, since each is laid out by its own rule.
    for (const part of [group(host), track(host), range(host), low, high, ...marks(host)]) {
      expect(part.getAttribute('data-orientation')).toBe('horizontal');
    }

    // A tick inside the fill and one outside it are drawn apart; the words
    // under one of them are what asks for room beneath the track.
    expect(marks(host).map((mark) => mark.getAttribute('data-state'))).toEqual([
      'inactive',
      'active',
      'inactive',
    ]);
    expect(marks(host).map((mark) => mark.getAttribute('aria-hidden'))).toEqual(['true', 'true', 'true']);
    expect(marks(host)[1]!.querySelector('.volt-slider-mark-label')?.textContent).toBe('Half');
    expect(marks(host)[0]!.querySelector('.volt-slider-mark-label')).toBeNull();
    expect(group(host).hasAttribute('data-scale')).toBe(true);

    // Nothing touched yet: no thumb is the keys' and nothing is held.
    expect(low.hasAttribute('data-active')).toBe(false);
    expect(group(host).hasAttribute('data-dragging')).toBe(false);

    // A key makes its thumb the one the keys move, which the sheet puts on
    // top of the other.
    press(high, 'ArrowLeft');
    expect(high.hasAttribute('data-active')).toBe(true);
    expect(low.hasAttribute('data-active')).toBe(false);

    // Held: the group says so for as long as the pointer does.
    layout(track(host));
    pointerDown(track(host), { clientX: 30 });
    expect(group(host).hasAttribute('data-dragging')).toBe(true);
    expect(low.hasAttribute('data-active')).toBe(true);
    pointerUp();
    expect(group(host).hasAttribute('data-dragging')).toBe(false);

    // Off: every part says it for itself, since each is drawn by its own
    // rule, and the thumbs stay reachable while refusing the keys.
    instance.off.set(true);
    flushSync();
    for (const part of [group(host), track(host), range(host), low, high]) {
      expect(part.hasAttribute('data-disabled')).toBe(true);
    }
    expect(low.getAttribute('aria-disabled')).toBe('true');
    expect(low.getAttribute('tabindex')).toBe('0');
    expect(inputs(host).map((input) => input.disabled)).toEqual([true, true]);

    const before = instance.price.get();
    press(low, 'ArrowRight');
    pointerDown(track(host), { clientX: 100 });
    expect(instance.price.get()).toBe(before);
    expect(group(host).hasAttribute('data-dragging')).toBe(false);

    // And back: the binding follows the signal both ways.
    instance.off.set(false);
    flushSync();
    expect(group(host).hasAttribute('data-disabled')).toBe(false);
    expect(low.hasAttribute('aria-disabled')).toBe(false);
  });

  it('is off when `disabled` is written bare or bound true, and live when it says `false`', () => {
    @Component({
      selector: 'v-page-disabled-spellings',
      imports: [VSlider],
      render: compileTemplate(`
        <v-slider disabled label="Bare" :defaultValue="40"></v-slider>
        <v-slider disabled="false" label="Word" :defaultValue="40"></v-slider>
        <v-slider :disabled="off.get()" label="Bound" :defaultValue="40"></v-slider>
      `),
    })
    class Page {
      off = new Signal.State<boolean>(true);
    }

    const { instance, host } = show(Page);
    const [bare, word, bound] = [...host.querySelectorAll<HTMLElement>('.volt-slider')] as [
      HTMLElement,
      HTMLElement,
      HTMLElement,
    ];
    const parts = (slider: HTMLElement): HTMLElement[] => [
      slider,
      slider.querySelector('.volt-slider-track')!,
      slider.querySelector('.volt-slider-range')!,
      slider.querySelector('.volt-slider-thumb')!,
    ];
    const off = (slider: HTMLElement): boolean[] => [
      ...parts(slider).map((part) => part.hasAttribute('data-disabled')),
      slider.querySelector('.volt-slider-thumb')!.hasAttribute('aria-disabled'),
      slider.querySelector('input')!.disabled,
    ];

    expect(off(bare)).toEqual([true, true, true, true, true, true]);
    expect(off(bound)).toEqual([true, true, true, true, true, true]);

    // An attribute is a string, and every string is truthy: `disabled="false"`
    // locked the slider it said was not locked, and wrote `data-disabled="false"`
    // on every part, which every `[data-disabled]` rule matches.
    expect(off(word)).toEqual([false, false, false, false, false, false]);
    const thumb = word.querySelector<HTMLElement>('.volt-slider-thumb')!;
    press(thumb, 'ArrowRight');
    expect(thumb.getAttribute('aria-valuenow')).toBe('41');

    instance.off.set(false);
    flushSync();
    expect(off(bound)).toEqual([false, false, false, false, false, false]);
  });

  it('writes the positions the sheet cannot hold, on the logical edge', () => {
    @Component({
      selector: 'v-page-geometry',
      imports: [VSlider],
      render: compileTemplate(`<v-slider :value="price" :marks="[25, 75]"></v-slider>`),
    })
    class Page {
      price = new Signal.State<readonly number[]>([20, 60]);
    }

    const { instance, host } = show(Page);

    // A thumb at its value, a mark at its own, and the fill between the two
    // thumbs — written as two edges, so a fill from the minimum is the same
    // rule as a span between two thumbs.
    expect(thumbs(host).map(inlineStart)).toEqual(['20%', '60%']);
    expect(marks(host).map(inlineStart)).toEqual(['25%', '75%']);
    expect(inlineStart(range(host))).toBe('20%');
    expect(range(host).style.getPropertyValue('inset-inline-end')).toBe('40%');

    // The value moves the thumb and the fill together.
    instance.price.set([20, 90]);
    flushSync();
    expect(thumbs(host).map(inlineStart)).toEqual(['20%', '90%']);
    expect(range(host).style.getPropertyValue('inset-inline-end')).toBe('10%');
    expect(marks(host).map((mark) => mark.getAttribute('data-state'))).toEqual(['active', 'active']);

    // Nothing on the block axis, which is the sheet's, and nothing on a
    // physical edge, which would not mirror.
    expect(thumbs(host)[0]!.style.getPropertyValue('inset-block-end')).toBe('');
    for (const part of [range(host), ...thumbs(host), ...marks(host)]) {
      for (const physical of ['left', 'right', 'top', 'bottom', 'translate', 'transform']) {
        expect(part.style.getPropertyValue(physical), physical).toBe('');
      }
    }
  });

  it('runs up a vertical track, from the bottom', () => {
    @Component({
      selector: 'v-page-vertical',
      imports: [VSlider],
      render: compileTemplate(
        `<v-slider :value="warmth" orientation="vertical" :marks="[50]" label="Warmth"></v-slider>`,
      ),
    })
    class Page {
      warmth = new Signal.State<readonly number[]>([30]);
    }

    const { host } = show(Page);
    const [thumb] = thumbs(host) as [HTMLElement];

    // `orientation` reaches the primitive, which says so on every part and to
    // the reader.
    for (const part of [group(host), track(host), range(host), thumb, ...marks(host)]) {
      expect(part.getAttribute('data-orientation')).toBe('vertical');
    }
    expect(thumb.getAttribute('aria-orientation')).toBe('vertical');

    // Placed from the bottom, since the value grows upwards — and on the
    // block edge alone, with the inline one left to the sheet to centre.
    expect(thumb.style.getPropertyValue('inset-block-end')).toBe('30%');
    expect(inlineStart(thumb)).toBe('');
    expect(marks(host)[0]!.style.getPropertyValue('inset-block-end')).toBe('50%');
    expect(range(host).style.getPropertyValue('inset-block-end')).toBe('0%');
    expect(range(host).style.getPropertyValue('inset-block-start')).toBe('70%');

    // A press is measured up the track: the top is the maximum.
    layout(track(host), { right: 8, width: 8, bottom: 200, height: 200 });
    pointerDown(track(host), { clientX: 4, clientY: 50 });
    pointerUp();
    expect(values(host)).toEqual(['75']);

    // And Up is the key that raises it, which is what the orientation says.
    press(thumb, 'ArrowUp');
    expect(values(host)).toEqual(['76']);
  });

  it('takes the keyboard the primitive provides, on whichever thumb has it', () => {
    const commits: (readonly number[])[] = [];

    @Component({
      selector: 'v-page-keys',
      imports: [VSlider],
      render: compileTemplate(
        `<v-slider :value="price" step="5" :onValueCommit="record" label="Price"></v-slider>`,
      ),
    })
    class Page {
      price = new Signal.State<readonly number[]>([20, 60]);
      record = (values: readonly number[]): void => void commits.push(values);
    }

    const { instance, host } = show(Page);
    const [low, high] = thumbs(host) as [HTMLElement, HTMLElement];

    // One step either way; `step` reaches the primitive, so a step is five.
    expect(press(low, 'ArrowRight').defaultPrevented).toBe(true);
    expect(instance.price.get()).toEqual([25, 60]);
    press(low, 'ArrowUp');
    expect(instance.price.get()).toEqual([30, 60]);
    press(low, 'ArrowLeft');
    press(low, 'ArrowDown');
    expect(instance.price.get()).toEqual([20, 60]);

    // A large step is ten of them.
    press(high, 'PageUp');
    expect(instance.price.get()).toEqual([20, 100]);
    press(high, 'PageDown');
    expect(instance.price.get()).toEqual([20, 50]);

    // Home and End reach the ends of this thumb's range, which stops at its
    // neighbour: the low thumb cannot pass the high one.
    press(low, 'End');
    expect(instance.price.get()).toEqual([50, 50]);
    press(low, 'Home');
    expect(instance.price.get()).toEqual([0, 50]);
    expect(low.getAttribute('aria-valuemax')).toBe('50');
    expect(high.getAttribute('aria-valuemin')).toBe('0');

    // A key is a whole gesture, so each one is committed.
    expect(commits).toHaveLength(8);
    expect(commits.at(-1)).toEqual([0, 50]);

    // Anything else is left alone.
    expect(press(low, 'Enter').defaultPrevented).toBe(false);
    expect(press(low, ' ').defaultPrevented).toBe(false);
  });

  it('follows the writing direction written on the tag', () => {
    @Component({
      selector: 'v-page-rtl',
      imports: [VSlider],
      render: compileTemplate(`<v-slider :value="volume" dir="rtl" label="Volume"></v-slider>`),
    })
    class Page {
      volume = new Signal.State<readonly number[]>([40]);
    }

    const { instance, host } = show(Page);

    // `dir` lands on the group, which is where the primitive reads it from:
    // the arrows swap, since the track runs the other way.
    expect(group(host).getAttribute('dir')).toBe('rtl');
    expect(group(host).getAttribute('data-direction')).toBe('rtl');
    press(thumbs(host)[0]!, 'ArrowLeft');
    expect(instance.volume.get()).toEqual([41]);
    press(thumbs(host)[0]!, 'ArrowRight');
    expect(instance.volume.get()).toEqual([40]);

    // The position is a percentage of the value, whichever way the track
    // runs: `inset-inline-start` mirrors itself, so the sheet needs no rule.
    expect(inlineStart(thumbs(host)[0]!)).toBe('40%');

    // A press is read from the right: a fifth of the way in from the right
    // edge is a fifth of the way up.
    layout(track(host));
    pointerDown(track(host), { clientX: 160 });
    pointerUp();
    expect(instance.volume.get()).toEqual([20]);
  });

  it('moves the nearest thumb to a press and drags it from there, committing once', () => {
    const changes: (readonly number[])[] = [];
    const commits: (readonly number[])[] = [];

    @Component({
      selector: 'v-page-pointer',
      imports: [VSlider],
      render: compileTemplate(
        `<v-slider :value="price" :onValueChange="change" :onValueCommit="commit" label="Price"></v-slider>`,
      ),
    })
    class Page {
      price = new Signal.State<readonly number[]>([20, 60]);
      change = (values: readonly number[]): void => void changes.push(values);
      commit = (values: readonly number[]): void => void commits.push(values);
    }

    const { instance, host } = show(Page);
    layout(track(host));

    // A press at three quarters of the way along is nearest the high thumb,
    // which goes to it at once and takes focus, so the arrows carry on from
    // the thumb the user just touched.
    const down = pointerDown(track(host), { clientX: 150 });
    expect(down.defaultPrevented).toBe(true);
    expect(instance.price.get()).toEqual([20, 75]);
    expect(document.activeElement).toBe(thumbs(host)[1]);
    expect(thumbs(host).map(inlineStart)).toEqual(['20%', '75%']);

    // Every frame of the drag is a change, and none of them is a commit.
    pointerMove({ clientX: 180 });
    pointerMove({ clientX: 100 });
    expect(instance.price.get()).toEqual([20, 50]);
    expect(changes).toEqual([[20, 75], [20, 90], [20, 50]]);
    expect(commits).toEqual([]);

    // Let go: one commit, with where the value settled.
    pointerUp();
    expect(commits).toEqual([[20, 50]]);
    expect(group(host).hasAttribute('data-dragging')).toBe(false);
  });

  it('hears a press on the track and not on the words above it', () => {
    @Component({
      selector: 'v-page-label-press',
      imports: [VSlider],
      render: compileTemplate(`<v-slider :value="volume" label="Volume"></v-slider>`),
    })
    class Page {
      volume = new Signal.State<readonly number[]>([40]);
    }

    const { instance, host } = show(Page);
    layout(track(host));

    // The label is inside the group, and a press on it is somewhere along the
    // page's x axis — which the track would read as a value. It is a press on
    // the name, so nothing moves and nothing is picked up.
    const missed = pointerDown(label(host)!, { clientX: 20 });
    expect(missed.defaultPrevented).toBe(false);
    expect(instance.volume.get()).toEqual([40]);
    expect(group(host).hasAttribute('data-dragging')).toBe(false);

    // The same press on the track is a value.
    pointerDown(track(host), { clientX: 20 });
    pointerUp();
    expect(instance.volume.get()).toEqual([10]);
  });

  it('follows the value it was bound to, and reports what it moves it to', () => {
    const changes: (readonly number[])[] = [];

    @Component({
      selector: 'v-page-bound',
      imports: [VSlider],
      render: compileTemplate(
        `<v-slider :value="volume" :onValueChange="record" label="Volume"></v-slider>`,
      ),
    })
    class Page {
      volume = new Signal.State<readonly number[]>([40]);
      record = (values: readonly number[]): void => void changes.push(values);
    }

    const { instance, host } = show(Page);
    expect(values(host)).toEqual(['40']);

    // Written from outside: the thumb, the fill and the input all follow.
    instance.volume.set([70]);
    flushSync();
    expect(values(host)).toEqual(['70']);
    expect(inlineStart(thumbs(host)[0]!)).toBe('70%');
    expect(range(host).style.getPropertyValue('inset-inline-end')).toBe('30%');
    expect(inputs(host)[0]!.value).toBe('70');

    // Moved by the user: the signal is written, and the caller told.
    press(thumbs(host)[0]!, 'ArrowRight');
    expect(instance.volume.get()).toEqual([71]);
    expect(changes).toEqual([[71]]);

    // A second value is a second thumb, without remounting anything.
    instance.volume.set([20, 80]);
    flushSync();
    expect(values(host)).toEqual(['20', '80']);
    expect(inputs(host)).toHaveLength(2);
  });

  it('takes its range and step from the tag, in either spelling of a number', () => {
    @Component({
      selector: 'v-page-range',
      imports: [VSlider],
      render: compileTemplate(`
        <v-slider :defaultValue="70" :min="20" :max="120" :step="10" label="Warmth"></v-slider>
        <v-slider defaultValue="70" min="20" max="120" step="10" label="Warmth"></v-slider>
      `),
    })
    class Page {}

    const { host } = show(Page);
    const sliders = [...host.querySelectorAll<HTMLElement>('.volt-slider')];

    for (const slider of sliders) {
      const thumb = slider.querySelector<HTMLElement>('.volt-slider-thumb')!;
      const input = slider.querySelector('input')!;

      // `min` and `max` reach the primitive, which reports them and measures
      // against them: 70 is halfway along 20–120, not 58% of 120.
      expect(thumb.getAttribute('aria-valuemin')).toBe('20');
      expect(thumb.getAttribute('aria-valuemax')).toBe('120');
      expect(thumb.getAttribute('aria-valuenow')).toBe('70');
      expect(inlineStart(thumb)).toBe('50%');
      expect(input.min).toBe('20');
      expect(input.max).toBe('120');
      expect(input.step).toBe('10');

      // An attribute is only ever a string, and a string added to a number
      // is a longer string: `min="20"` would otherwise step to "201".
      press(thumb, 'ArrowRight');
      expect(thumb.getAttribute('aria-valuenow')).toBe('80');
    }
  });

  it('starts where it was told to, in every way a tag can say it', () => {
    @Component({
      selector: 'v-page-default',
      imports: [VSlider],
      render: compileTemplate(`
        <v-slider :defaultValue="[20, 80]" label="Price"></v-slider>
        <v-slider defaultValue="20, 80" label="Price"></v-slider>
        <v-slider defaultValue="40" label="Volume"></v-slider>
        <v-slider label="Volume"></v-slider>
        <v-slider defaultValue="loud" label="Volume"></v-slider>
      `),
    })
    class Page {}

    const { host } = show(Page);
    const sliders = [...host.querySelectorAll<HTMLElement>('.volt-slider')];
    const nows = (slider: HTMLElement): (string | null)[] =>
      [...slider.querySelectorAll('.volt-slider-thumb')].map((thumb) => thumb.getAttribute('aria-valuenow'));

    // Two numbers are two thumbs, however they were written.
    expect(nows(sliders[0]!)).toEqual(['20', '80']);
    expect(nows(sliders[1]!)).toEqual(['20', '80']);
    expect(nows(sliders[2]!)).toEqual(['40']);
    // Nothing said, or nothing a number, starts one thumb at the minimum.
    expect(nows(sliders[3]!)).toEqual(['0']);
    expect(nows(sliders[4]!)).toEqual(['0']);
  });

  it('draws the ticks it was given, in either spelling', () => {
    @Component({
      selector: 'v-page-marks',
      imports: [VSlider],
      render: compileTemplate(`
        <v-slider marks="0, 50, 100, 150" label="Bare"></v-slider>
        <v-slider :marks="[{ value: 100, label: 'Most' }, 0]" label="Scale"></v-slider>
        <v-slider label="None"></v-slider>
      `),
    })
    class Page {}

    const { host } = show(Page);
    const [bare, scale, none] = [...host.querySelectorAll<HTMLElement>('.volt-slider')] as [
      HTMLElement,
      HTMLElement,
      HTMLElement,
    ];
    const at = (slider: HTMLElement): (string | null)[] =>
      [...slider.querySelectorAll('.volt-slider-mark')].map((mark) => mark.getAttribute('data-value'));

    // Spelt as an attribute: bare ticks, with the one off the end dropped.
    expect(at(bare)).toEqual(['0', '50', '100']);
    expect(bare.querySelector('.volt-slider-mark-label')).toBeNull();
    expect(bare.hasAttribute('data-scale')).toBe(false);

    // Bound: in order, and with words where they were given, which is what
    // asks for room beneath the track.
    expect(at(scale)).toEqual(['0', '100']);
    expect(scale.querySelector('.volt-slider-mark-label')?.textContent).toBe('Most');
    expect(scale.hasAttribute('data-scale')).toBe(true);

    expect(at(none)).toEqual([]);
  });

  it('says the value the way the caller formats it, or the way the language writes it', () => {
    @Component({
      selector: 'v-page-format',
      imports: [VSlider],
      render: compileTemplate(
        `<v-slider :value="price" :max="5000" :format="wording.get()" label="Price"></v-slider>`,
      ),
    })
    class Page {
      locale = createLocaleProvider({ defaultLocale: 'de-DE' });
      price = new Signal.State<readonly number[]>([1500, 2500]);
      wording = new Signal.State<((value: number) => string) | undefined>(undefined);
    }

    const { instance, host } = show(Page);
    const spoken = (): (string | null)[] =>
      thumbs(host).map((thumb) => thumb.getAttribute('aria-valuetext'));

    // Without a wording, the locale's digits: German groups thousands with a
    // point, which is what `1500` read out as a number is not.
    expect(spoken()).toEqual(['1.500', '2.500']);

    // With one, the caller's words — and a wording bound to a signal reaches
    // thumbs already on screen.
    instance.wording.set((value) => `€${value}`);
    flushSync();
    expect(spoken()).toEqual(['€1500', '€2500']);

    // And it follows the value.
    press(thumbs(host)[0]!, 'ArrowRight');
    expect(spoken()).toEqual(['€1501', '€2500']);
  });

  it('names the thumbs of a range apart from the group, in the caller’s words or the default ones', () => {
    @Component({
      selector: 'v-page-thumb-names',
      imports: [VSlider],
      render: compileTemplate(`
        <v-slider :defaultValue="[20, 80]" label="Price"></v-slider>
        <v-slider :defaultValue="[20, 80]" label="Price" :thumbLabels="names.get()"></v-slider>
        <v-slider :defaultValue="[20, 50, 80]" label="Price" :thumbLabels="['Low']"></v-slider>
      `),
    })
    class Page {
      names = new Signal.State<readonly string[]>(['From', 'To']);
    }

    const { instance, host } = show(Page);
    const sliders = [...host.querySelectorAll<HTMLElement>('.volt-slider')];
    const names = (slider: HTMLElement): (string | null)[] =>
      [...slider.querySelectorAll('.volt-slider-thumb')].map((thumb) => thumb.getAttribute('aria-label'));
    const referenced = (slider: HTMLElement): boolean[] =>
      [...slider.querySelectorAll('.volt-slider-thumb')].map((thumb) => thumb.hasAttribute('aria-labelledby'));

    // "Price, Minimum" is how a reader learns which end this is: the group
    // has the label, and the thumbs each a name of their own — never both,
    // which would read as "Price Minimum Price".
    expect(sliders[0]!.getAttribute('aria-labelledby')).toBe(
      sliders[0]!.querySelector('.volt-slider-label')!.id,
    );
    expect(names(sliders[0]!)).toEqual(['Minimum', 'Maximum']);
    expect(referenced(sliders[0]!)).toEqual([false, false]);

    expect(names(sliders[1]!)).toEqual(['From', 'To']);
    instance.names.set(['Lowest', 'Highest']);
    flushSync();
    expect(names(sliders[1]!)).toEqual(['Lowest', 'Highest']);

    // A name per thumb, in order; the ones not named keep the defaults.
    expect(names(sliders[2]!)).toEqual(['Low', 'Value 2', 'Maximum']);
  });

  it('takes the thumbs’ names as an attribute, a comma between each', () => {
    @Component({
      selector: 'v-page-thumb-names-attribute',
      imports: [VSlider],
      render: compileTemplate(`
        <v-slider :defaultValue="[20, 80]" label="Price" thumbLabels="From, To"></v-slider>
        <v-slider :defaultValue="40" thumbLabels="Level"></v-slider>
      `),
    })
    class Page {}

    const { host } = show(Page);
    const [range, single] = [...host.querySelectorAll<HTMLElement>('.volt-slider')] as [
      HTMLElement,
      HTMLElement,
    ];
    const names = (slider: HTMLElement): (string | null)[] =>
      [...slider.querySelectorAll('.volt-slider-thumb')].map((thumb) => thumb.getAttribute('aria-label'));

    // An attribute is a string, and a string indexed is its letters: read as a
    // list, these were "F" and "r", and the single thumb was "L".
    expect(names(range)).toEqual(['From', 'To']);
    expect(names(single)).toEqual(['Level']);
  });

  it('names the group and its one thumb, and leaves off every name it was not given', () => {
    @Component({
      selector: 'v-page-names',
      imports: [VSlider],
      render: compileTemplate(`
        <span id="heading">Volume</span>
        <span id="hint">Louder than seven annoys the neighbours.</span>
        <v-slider></v-slider>
        <v-slider :label="name.get()"></v-slider>
        <v-slider aria-label="Volume" label="stale"></v-slider>
        <v-slider aria-labelledby="heading" label="stale"></v-slider>
        <v-slider :aria-describedby="described.get()" :defaultValue="[20, 80]"></v-slider>
        <v-slider :thumbLabels="['Level']"></v-slider>
        <v-slider label="Volume" :thumbLabels="['Level']"></v-slider>
        <v-slider aria-label="Volume" :thumbLabels="['Level']"></v-slider>
        <v-slider aria-label="Volume" label="Loudness"></v-slider>
      `),
    })
    class Page {
      name = new Signal.State<string | undefined>('Volume');
      described = new Signal.State('hint');
    }

    const { instance, host } = show(Page);
    const sliders = [...host.querySelectorAll<HTMLElement>('.volt-slider')];
    const thumbOf = (slider: HTMLElement): HTMLElement => slider.querySelector('.volt-slider-thumb')!;

    // Nothing named: no label is drawn, and neither the group nor the thumb
    // carries an empty name a reader would have to decide what to do with.
    // The thumb still has to be called something, so it is called "Value".
    expect(sliders[0]!.querySelector('.volt-slider-label')).toBeNull();
    for (const name of ['aria-label', 'aria-labelledby', 'aria-describedby']) {
      expect(sliders[0]!.hasAttribute(name), name).toBe(false);
      expect(thumbOf(sliders[0]!).hasAttribute(name), name).toBe(name === 'aria-label');
    }
    expect(thumbOf(sliders[0]!).getAttribute('aria-label')).toBe('Value');

    // A label bound to a signal follows it, on screen and in the name — and
    // survives the group's attributes being written again, which is what a
    // move does.
    expect(sliders[1]!.querySelector('.volt-slider-label')?.textContent).toBe('Volume');
    instance.name.set('Loudness');
    flushSync();
    press(thumbOf(sliders[1]!), 'ArrowRight');
    expect(sliders[1]!.querySelector('.volt-slider-label')?.textContent).toBe('Loudness');
    expect(sliders[1]!.getAttribute('aria-labelledby')).toBe(sliders[1]!.querySelector('.volt-slider-label')!.id);

    // Taken away, the label goes and so does every reference to it.
    instance.name.set(undefined);
    flushSync();
    expect(sliders[1]!.querySelector('.volt-slider-label')).toBeNull();
    expect(sliders[1]!.hasAttribute('aria-labelledby')).toBe(false);
    expect(thumbOf(sliders[1]!).hasAttribute('aria-labelledby')).toBe(false);
    expect(thumbOf(sliders[1]!).getAttribute('aria-label')).toBe('Value');

    // A single thumb is the control, so the name written on the tag is its
    // name too, and it wins over the label — a reference over a name, as the
    // accessible name computation ranks them, so neither thumb carries both.
    expect(sliders[2]!.getAttribute('aria-label')).toBe('Volume');
    expect(sliders[2]!.hasAttribute('aria-labelledby')).toBe(false);
    expect(thumbOf(sliders[2]!).getAttribute('aria-label')).toBe('Volume');
    expect(thumbOf(sliders[2]!).hasAttribute('aria-labelledby')).toBe(false);
    expect(sliders[3]!.getAttribute('aria-labelledby')).toBe('heading');
    expect(sliders[3]!.hasAttribute('aria-label')).toBe(false);
    expect(thumbOf(sliders[3]!).getAttribute('aria-labelledby')).toBe('heading');
    expect(thumbOf(sliders[3]!).hasAttribute('aria-label')).toBe(false);

    // A description goes where focus lands, which is every thumb — and it
    // follows what it was bound to.
    const described = (): (string | null)[] =>
      [...sliders[4]!.querySelectorAll('.volt-slider-thumb')].map((thumb) => thumb.getAttribute('aria-describedby'));
    expect(described()).toEqual(['hint', 'hint']);
    expect(sliders[4]!.hasAttribute('aria-describedby')).toBe(false);
    instance.described.set('hint error');
    flushSync();
    expect(described()).toEqual(['hint error', 'hint error']);

    // The one thumb of an unnamed slider, named on its own.
    expect(thumbOf(sliders[5]!).getAttribute('aria-label')).toBe('Level');

    // A thumb's own name wins outright, whatever else names the group: over
    // the drawn label, over `aria-label`, and with the group keeping its own.
    // Ranked among the group's names it made a cycle, since `aria-label`
    // beats the drawn label in turn.
    const label = sliders[6]!.querySelector('.volt-slider-label')!;
    expect(sliders[6]!.getAttribute('aria-labelledby')).toBe(label.id);
    expect(thumbOf(sliders[6]!).getAttribute('aria-label')).toBe('Level');
    expect(thumbOf(sliders[6]!).hasAttribute('aria-labelledby')).toBe(false);
    expect(sliders[7]!.getAttribute('aria-label')).toBe('Volume');
    expect(thumbOf(sliders[7]!).getAttribute('aria-label')).toBe('Level');
    expect(sliders[8]!.getAttribute('aria-label')).toBe('Volume');
    expect(sliders[8]!.hasAttribute('aria-labelledby')).toBe(false);
    expect(thumbOf(sliders[8]!).getAttribute('aria-label')).toBe('Volume');
    expect(thumbOf(sliders[8]!).hasAttribute('aria-labelledby')).toBe(false);
  });

  it('follows a name bound to a signal, on the group and its one thumb', () => {
    @Component({
      selector: 'v-page-bound-names',
      imports: [VSlider],
      render: compileTemplate(`
        <span id="heading">Volume</span>
        <span id="other">Loudness</span>
        <v-slider :aria-label="spoken.get()" label="Drawn" :defaultValue="40"></v-slider>
        <v-slider :aria-labelledby="pointer.get()" label="Drawn" :defaultValue="40"></v-slider>
      `),
    })
    class Page {
      spoken = new Signal.State<string | undefined>('Volume');
      pointer = new Signal.State<string | undefined>('heading');
    }

    const { instance, host } = show(Page);
    const [named, referenced] = [...host.querySelectorAll<HTMLElement>('.volt-slider')] as [
      HTMLElement,
      HTMLElement,
    ];
    const thumbOf = (slider: HTMLElement): HTMLElement => slider.querySelector('.volt-slider-thumb')!;
    const drawn = (slider: HTMLElement): string => slider.querySelector('.volt-slider-label')!.id;

    expect(named.getAttribute('aria-label')).toBe('Volume');
    expect(thumbOf(named).getAttribute('aria-label')).toBe('Volume');
    instance.spoken.set('Loudness');
    flushSync();
    expect(named.getAttribute('aria-label')).toBe('Loudness');
    expect(thumbOf(named).getAttribute('aria-label')).toBe('Loudness');
    // Taken away, the label it was standing in for names both again.
    instance.spoken.set(undefined);
    flushSync();
    expect(named.hasAttribute('aria-label')).toBe(false);
    expect(named.getAttribute('aria-labelledby')).toBe(drawn(named));
    expect(thumbOf(named).hasAttribute('aria-label')).toBe(false);
    expect(thumbOf(named).getAttribute('aria-labelledby')).toBe(drawn(named));

    expect(referenced.getAttribute('aria-labelledby')).toBe('heading');
    expect(thumbOf(referenced).getAttribute('aria-labelledby')).toBe('heading');
    instance.pointer.set('other');
    flushSync();
    expect(referenced.getAttribute('aria-labelledby')).toBe('other');
    expect(thumbOf(referenced).getAttribute('aria-labelledby')).toBe('other');
    instance.pointer.set(undefined);
    flushSync();
    expect(referenced.getAttribute('aria-labelledby')).toBe(drawn(referenced));
    expect(thumbOf(referenced).getAttribute('aria-labelledby')).toBe(drawn(referenced));
  });

  it('takes a blank name for no name, and goes on naming the thumb after its label', () => {
    @Component({
      selector: 'v-page-blank-names',
      imports: [VSlider],
      render: compileTemplate(`
        <v-slider :aria-label="spoken.get()" label="Volume" :defaultValue="40"></v-slider>
        <v-slider :aria-labelledby="pointer.get()" label="Volume" :defaultValue="40"></v-slider>
        <v-slider aria-label=" " :defaultValue="40"></v-slider>
      `),
    })
    class Page {
      spoken = new Signal.State<string | undefined>('');
      pointer = new Signal.State<string | undefined>('');
    }

    const { instance, host } = show(Page);
    const [named, referenced, unnamed] = [...host.querySelectorAll<HTMLElement>('.volt-slider')] as [
      HTMLElement,
      HTMLElement,
      HTMLElement,
    ];
    const thumbOf = (slider: HTMLElement): HTMLElement => slider.querySelector('.volt-slider-thumb')!;
    const drawn = (slider: HTMLElement): string => slider.querySelector('.volt-slider-label')!.id;

    // An empty `aria-label` and an empty `aria-labelledby` are both skipped by
    // the accessible name computation, so ranking either above the drawn label
    // left a thumb with no name at all beside the word "Volume" — a reference
    // to nothing in place of a reference to the label.
    for (const slider of [named, referenced]) {
      expect(slider.getAttribute('aria-labelledby')).toBe(drawn(slider));
      expect(slider.hasAttribute('aria-label')).toBe(false);
      expect(thumbOf(slider).getAttribute('aria-labelledby')).toBe(drawn(slider));
      expect(thumbOf(slider).hasAttribute('aria-label')).toBe(false);
    }

    // With nothing drawn either, the thumb keeps the name it is given when
    // nothing names it.
    expect(unnamed.hasAttribute('aria-label')).toBe(false);
    expect(thumbOf(unnamed).getAttribute('aria-label')).toBe('Value');

    // And a name that arrives afterwards still wins, as one written at once does.
    instance.spoken.set('Loudness');
    instance.pointer.set('');
    flushSync();
    expect(named.getAttribute('aria-label')).toBe('Loudness');
    expect(thumbOf(named).getAttribute('aria-label')).toBe('Loudness');
    expect(thumbOf(named).hasAttribute('aria-labelledby')).toBe(false);
  });

  it('takes a blank thumb name for no name, as it takes a blank name on the tag', () => {
    @Component({
      selector: 'v-page-blank-thumb-names',
      imports: [VSlider],
      render: compileTemplate(`
        <v-slider label="Volume" :defaultValue="40" :thumbLabels="[' ']"></v-slider>
        <v-slider label="Price" :defaultValue="[20, 80]" :thumbLabels="['From', ' ']"></v-slider>
      `),
    })
    class Page {}

    const { host } = show(Page);
    const [single, range] = [...host.querySelectorAll<HTMLElement>('.volt-slider')] as [
      HTMLElement,
      HTMLElement,
    ];
    const thumbsOf = (slider: HTMLElement): HTMLElement[] => [
      ...slider.querySelectorAll<HTMLElement>('.volt-slider-thumb'),
    ];

    // A name of nothing but white space is skipped by the accessible name
    // computation, so winning outright with one left the thumb unnamed beside
    // the word "Volume" — the label it would otherwise have been named after.
    const [lone] = thumbsOf(single) as [HTMLElement];
    expect(lone.getAttribute('aria-labelledby')).toBe(single.querySelector('.volt-slider-label')!.id);
    expect(lone.hasAttribute('aria-label')).toBe(false);

    // In a range, the thumb not named keeps the default its end is given.
    expect(thumbsOf(range).map((thumb) => thumb.getAttribute('aria-label'))).toEqual(['From', 'Maximum']);
  });

  it('fills the label it draws with markup written for it', () => {
    @Component({
      selector: 'v-page-label-slot',
      imports: [VSlider],
      render: compileTemplate(`
        <v-slider :defaultValue="[40, 120]" :max="200" label="Price">
          <template :slot-label>Price <small>per night</small></template>
        </v-slider>
        <v-slider :defaultValue="40">
          <template :slot-label>Unannounced</template>
        </v-slider>
      `),
    })
    class Page {}

    const { host } = show(Page);
    const [named, unnamed] = [...host.querySelectorAll<HTMLElement>('.volt-slider')] as [
      HTMLElement,
      HTMLElement,
    ];

    // The markup lands in the element the group is named after, so what is
    // drawn and what is read out are one thing.
    const drawn = named.querySelector('.volt-slider-label')!;
    expect(drawn.querySelector('small')?.textContent).toBe('per night');
    expect(drawn.textContent).toBe('Price per night');
    expect(named.getAttribute('aria-labelledby')).toBe(drawn.id);

    // `label` is what says there is a label at all; without it the slot has
    // nowhere to go, and the group is not named after an element that is not
    // there.
    expect(unnamed.querySelector('.volt-slider-label')).toBeNull();
    expect(unnamed.textContent).not.toContain('Unannounced');
    expect(unnamed.hasAttribute('aria-labelledby')).toBe(false);
  });

  it('submits once per thumb with the form it is written in, and resets with it', () => {
    @Component({
      selector: 'v-page-form',
      imports: [VSlider],
      render: compileTemplate(`
        <form>
          <v-slider :value="price" name="price" label="Price"></v-slider>
          <v-slider :defaultValue="30" label="Unnamed"></v-slider>
        </form>
      `),
    })
    class Page {
      price = new Signal.State<readonly number[]>([20, 80]);
    }

    const { instance, host } = show(Page);
    const form = host.querySelector('form')!;
    const submitted = (): [string, FormDataEntryValue][] => [...new FormData(form).entries()];

    // `name` reaches every input, so a range submits it twice, low then high;
    // a slider with no name submits nothing at all.
    expect(submitted()).toEqual([
      ['price', '20'],
      ['price', '80'],
    ]);
    const unnamed = host.querySelectorAll('.volt-slider')[1]!.querySelector('input')!;
    expect(unnamed.hasAttribute('name')).toBe(false);

    press(thumbs(host)[1]!, 'ArrowLeft');
    expect(submitted()).toEqual([
      ['price', '20'],
      ['price', '79'],
    ]);

    // A reset puts back what the slider was built with, on both halves.
    form.reset();
    flushSync();
    expect(instance.price.get()).toEqual([20, 80]);
    expect(values(host).slice(0, 2)).toEqual(['20', '80']);
    expect(submitted()).toEqual([
      ['price', '20'],
      ['price', '80'],
    ]);
  });

  it('refuses a value that is not a signal, while the tag is still what is wrong', () => {
    @Component({
      selector: 'v-page-not-a-signal',
      imports: [VSlider],
      render: compileTemplate(`<v-slider value="40" label="Volume"></v-slider>`),
    })
    class Page {}

    // `value` is the one signal the page and the slider both hold, and markup
    // has no way to write one — so `value="40"` hands over the string, which
    // the primitive would call `.get()` on inside an effect, where the error
    // is swallowed and the page is left with a group holding no thumb.
    expect(() => show(Page)).toThrow(/`value` on <v-slider> takes a signal/);
    expect(() => show(Page)).toThrow(/defaultValue/);
  });

  it('refuses a wording that is not a function, rather than leave a thumb nobody can reach', () => {
    @Component({
      selector: 'v-page-format-word',
      imports: [VSlider],
      render: compileTemplate(`<v-slider format="pounds" label="Price" :defaultValue="40"></v-slider>`),
    })
    class Page {}

    // Markup has no way to name a function except by binding it, so
    // `format="pounds"` hands over the word. The thumb's bag called it inside
    // an effect, where the error was swallowed and the thumb was drawn with
    // no role, no value and no place in the tab order.
    expect(() => show(Page)).toThrow(/`format` on <v-slider> takes a function/);
    expect(() => show(Page)).toThrow(/:format="pounds"/);
  });

  it('takes a wording bound to nothing for no wording, and says the number', () => {
    @Component({
      selector: 'v-page-format-nothing',
      imports: [VSlider],
      render: compileTemplate(`<v-slider :format="wording.get()" label="Price" :defaultValue="40"></v-slider>`),
    })
    class Page {
      wording = new Signal.State<((value: number) => string) | null>(null);
    }

    // `null` is how a binding says "none": the caller did bind it, with the
    // colon, and was told to — while the slider reads the wording with `?.`
    // and would have said the number.
    const { instance, host } = show(Page);
    expect(thumbs(host)[0]!.getAttribute('aria-valuetext')).toBe('40');

    instance.wording.set((value) => `£${value}`);
    flushSync();
    expect(thumbs(host)[0]!.getAttribute('aria-valuetext')).toBe('£40');
  });

  it('refuses an orientation it has no track for, rather than write it into the ARIA', () => {
    @Component({
      selector: 'v-page-orientation-word',
      imports: [VSlider],
      render: compileTemplate(`<v-slider orientation="sideways" label="Volume" :defaultValue="40"></v-slider>`),
    })
    class Page {}

    // The primitive writes whatever it is given into `aria-orientation` and
    // `data-orientation`, and reads anything but `vertical` as horizontal: the
    // thumb went out as `aria-orientation="sideways"`, which is no value ARIA
    // has, beside a track the sheet drew lying down.
    expect(() => show(Page)).toThrow(/`orientation` on <v-slider> is 'horizontal' or 'vertical'/);
    expect(() => show(Page)).toThrow(/sideways/);
  });

  it('leaves off a description that names nothing', () => {
    @Component({
      selector: 'v-page-blank-description',
      imports: [VSlider],
      render: compileTemplate(`<v-slider aria-describedby=" " label="Volume" :defaultValue="40"></v-slider>`),
    })
    class Page {}

    const { host } = show(Page);

    // A list of ids that holds no id points at nothing, as a blank name names
    // nothing; it was written through to the thumb as it stood.
    expect(thumbs(host)[0]!.hasAttribute('aria-describedby')).toBe(false);
  });

  it('hands the primitive itself to whoever needs more than this offers', () => {
    @Component({
      selector: 'v-page-ref',
      imports: [VSlider],
      render: compileTemplate(`<v-slider :ref="price" :defaultValue="[20, 80]" label="Price"></v-slider>`),
    })
    class Page {
      price: VSlider | null = null;
    }

    const { instance, host } = show(Page);
    expect(instance.price).toBeInstanceOf(VSlider);
    expect(instance.price?.slider.values()).toEqual([20, 80]);

    // The primitive is told which element the label is, so what it reports to
    // someone composing their own parts around it is what the page shows.
    expect(instance.price!.slider.rootProps()['aria-labelledby']).toBe(label(host)!.id);

    instance.price!.slider.setValues([30, 70]);
    flushSync();
    expect(values(host)).toEqual(['30', '70']);
    expect(thumbs(host).map(inlineStart)).toEqual(['30%', '70%']);
    expect(instance.price!.slider.fill()).toEqual({ start: 30, end: 70 });
    expect(instance.price!.slider.isDisabled()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The component and its sheet, measured together
// ---------------------------------------------------------------------------

/** The sheet's own rules in the document, for what has to be measured. */
function withSheet(): void {
  const style = document.createElement('style');
  style.textContent = `${tokensCss()}\n\n${componentCss(sliderStyles)}`;
  document.head.append(style);
  restores.push(() => style.remove());
}

/**
 * A computed length, in pixels.
 *
 * happy-dom resolves every token but leaves `calc()` as it was written, so
 * the arithmetic the sheet hands the browser is done here instead — on
 * `rem` at the default sixteen pixels, which is what the tokens are in.
 */
function px(value: string): number {
  const expression = value
    .replace(/^calc/, '')
    .replace(/(-?[\d.]+)rem/g, '($1*16)')
    .replace(/(-?[\d.]+)px/g, '$1');
  if (!/^[\d\s.+\-*/()]+$/.test(expression)) throw new Error(`not a length: ${value}`);
  return Number(new Function(`return ${expression};`)());
}

describe('v-slider and the sheet', () => {
  @Component({
    selector: 'v-page-sheet',
    imports: [VSlider],
    render: compileTemplate(`
      <v-slider :value="price" :disabled="off.get()" :marks="[0, { value: 50, label: 'Half' }, 100]" label="Price"></v-slider>
      <v-slider :value="warmth" orientation="vertical" :marks="[{ value: 50, label: 'Mild' }]" label="Warmth"></v-slider>
    `),
  })
  class SheetPage {
    price = new Signal.State<readonly number[]>([20, 60]);
    warmth = new Signal.State<readonly number[]>([30]);
    off = new Signal.State(false);
  }

  it('writes only classes the sheet declares', () => {
    const { host } = show(SheetPage);
    const declared = new Set<string>(Object.values(sliderClasses));
    const written = [...host.querySelectorAll('*')].flatMap((element) =>
      [...element.classList].filter((name) => name.startsWith('volt-')),
    );
    expect(new Set(written)).toEqual(declared);
  });

  it('gives every rule something the component draws', () => {
    const selectors = [...sliderStyles.rules, ...sliderStyles.forcedColors]
      .flatMap((rule) => rule.selector.split(',').map((selector) => selector.trim()))
      // The pointer and keyboard focus are states nothing here drives; what
      // is asked is whether the classes and attributes around them are ones
      // the component writes.
      .map((selector) => selector.replaceAll(':hover', '').replaceAll(':focus-visible', ''));
    const unmatched = new Set(selectors);
    const look = (): void => {
      for (const selector of unmatched) if (document.querySelector(selector)) unmatched.delete(selector);
    };

    const { instance, host } = show(SheetPage);
    look();

    // The keys' thumb, and one held.
    const [low] = thumbs(host) as [HTMLElement];
    press(low, 'ArrowRight');
    look();
    layout(track(host));
    pointerDown(track(host), { clientX: 40 });
    look();
    pointerUp();

    // And off.
    instance.off.set(true);
    flushSync();
    look();

    expect([...unmatched]).toEqual([]);
  });

  it('gives a thumb a target a finger can land on, centred on its value along the logical edge', () => {
    withSheet();
    const { host } = show(SheetPage);
    const [horizontal, vertical] = [...host.querySelectorAll<HTMLElement>('.volt-slider')] as [
      HTMLElement,
      HTMLElement,
    ];
    const style = (root: HTMLElement, part: string): CSSStyleDeclaration =>
      getComputedStyle(root.querySelector(`.volt-slider-${part}`)!);

    const thumb = style(horizontal, 'thumb');
    const size = px(thumb.getPropertyValue('inline-size'));
    expect(size).toBeGreaterThanOrEqual(24);
    expect(px(thumb.getPropertyValue('block-size'))).toBe(size);

    // Pulled back by half itself on the edge the value is written on, so the
    // middle of the thumb is the value — a margin, which mirrors, and nothing
    // on a physical side or a translation, which would not.
    expect(px(thumb.getPropertyValue('margin-inline-start'))).toBe(-size / 2);
    for (const physical of ['left', 'right', 'translate', 'transform']) {
      expect(thumb.getPropertyValue(physical), physical).toBe('');
    }

    // Up a vertical track the same thing happens on the block end, and the
    // thumb is centred across the track on the inline axis instead.
    const upright = style(vertical, 'thumb');
    expect(px(upright.getPropertyValue('margin-block-end'))).toBe(-size / 2);
    expect(px(upright.getPropertyValue('margin-inline-start'))).toBe(-size / 2);
    expect(upright.getPropertyValue('inset-inline-start')).toBe('50%');
  });

  it('keeps a thumb at either end, and the words under a tick, inside the slider’s own box', () => {
    withSheet();
    const { host } = show(SheetPage);
    const [horizontal, vertical] = [...host.querySelectorAll<HTMLElement>('.volt-slider')] as [
      HTMLElement,
      HTMLElement,
    ];
    const style = (root: HTMLElement, part: string): CSSStyleDeclaration =>
      getComputedStyle(root.querySelector(`.volt-slider-${part}`)!);

    const size = px(style(horizontal, 'thumb').getPropertyValue('inline-size'));
    const along = style(horizontal, 'track');
    const thickness = px(along.getPropertyValue('block-size'));

    // Half a thumb hangs past each end of the track, and the rest of it past
    // each side; the track's margins are what make room for both.
    expect(px(along.getPropertyValue('margin-inline-start'))).toBe(size / 2);
    expect(px(along.getPropertyValue('margin-inline-end'))).toBe(size / 2);
    expect(px(along.getPropertyValue('margin-block-start'))).toBe((size - thickness) / 2);
    expect(px(along.getPropertyValue('margin-block-end'))).toBe((size - thickness) / 2);

    const up = style(vertical, 'track');
    expect(px(up.getPropertyValue('margin-block-start'))).toBe(size / 2);
    expect(px(up.getPropertyValue('margin-block-end'))).toBe(size / 2);
    expect(px(up.getPropertyValue('margin-inline-start'))).toBe((size - px(up.getPropertyValue('inline-size'))) / 2);

    // The words start below a thumb resting on their tick — whose far edge is
    // half the track and half a thumb from the track's own edge — and the
    // group leaves room for all of them under the track.
    const words = style(horizontal, 'mark-label');
    const top = px(words.getPropertyValue('margin-block-start'));
    expect(top).toBeGreaterThan(thickness / 2 + size / 2);
    const bottom = top + px(words.getPropertyValue('font-size')) * Number(words.getPropertyValue('line-height'));
    const room =
      thickness +
      px(along.getPropertyValue('margin-block-end')) +
      px(getComputedStyle(horizontal).getPropertyValue('padding-block-end'));
    expect(room).toBeGreaterThanOrEqual(bottom);

    // Beside a vertical track, the same clearance runs along the inline axis.
    expect(px(style(vertical, 'mark-label').getPropertyValue('margin-inline-start'))).toBe(top);
  });
});

/**
 * The cascade a forced palette leaves, measured rather than read: the pairs in
 * `forced-colors.test.ts` ask only whether two states still differ, and a
 * disabled slider differs from a live one on its thumb whatever its scale is
 * drawn in. What a reader is shown, part by part, is asked here by the
 * palette's own names.
 */
describe('v-slider, once the palette is the user’s', () => {
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
      `${rulesToCss(asTested(sliderStyles.rules))}\n` +
        wrap(FORCED_COLORS_QUERY, rulesToCss(asTested(sliderStyles.forcedColors), '  ')),
    );
  });

  /**
   * A range with a scale, as the component draws one: a tick below the span
   * and one inside it, each with words under it, and the group, the track,
   * the fill and the thumb carrying `data-disabled` when it is off.
   */
  const look = (off: boolean) => {
    const disabled: Record<string, string> = off ? { 'data-disabled': '' } : {};
    const tick = (state: string) => ({
      tag: 'span',
      classes: ['volt-slider-mark'],
      attributes: { 'aria-hidden': 'true', 'data-state': state, 'data-orientation': 'horizontal' },
      children: [{ tag: 'span', classes: ['volt-slider-mark-label'] }],
    });
    const root = forced.mount({
      classes: ['volt-slider'],
      attributes: { role: 'group', 'data-orientation': 'horizontal', 'data-scale': '', ...disabled },
      children: [
        { tag: 'span', classes: ['volt-slider-label'] },
        {
          tag: 'span',
          classes: ['volt-slider-track'],
          attributes: { 'data-orientation': 'horizontal', ...disabled },
          children: [
            {
              tag: 'span',
              classes: ['volt-slider-range'],
              attributes: { 'data-orientation': 'horizontal', ...disabled },
            },
            tick('inactive'),
            tick('active'),
            {
              tag: 'span',
              classes: ['volt-slider-thumb'],
              attributes: { role: 'slider', 'data-orientation': 'horizontal', tabindex: '0', ...disabled },
            },
          ],
        },
      ],
    });
    // Computed in the document it was mounted into, which is the forced one.
    const computed = (selector: string, index = 0): CSSStyleDeclaration =>
      root.ownerDocument.defaultView!.getComputedStyle(root.querySelectorAll(selector)[index]!);
    return {
      label: computed('.volt-slider-label').getPropertyValue('color'),
      edge: computed('.volt-slider-track').getPropertyValue('border-inline-start-color'),
      fill: computed('.volt-slider-range').getPropertyValue('background-color'),
      thumb: computed('.volt-slider-thumb').getPropertyValue('border-inline-start-color'),
      tickOutside: computed('.volt-slider-mark', 0).getPropertyValue('background-color'),
      tickInside: computed('.volt-slider-mark', 1).getPropertyValue('background-color'),
      wordsOutside: computed('.volt-slider-mark-label', 0).getPropertyValue('color'),
      wordsInside: computed('.volt-slider-mark-label', 1).getPropertyValue('color'),
      dimmed: root.ownerDocument.defaultView!.getComputedStyle(root).getPropertyValue('opacity'),
    };
  };

  it('draws the span in the palette’s colour for a selection, and every tick against what it sits on', () => {
    const live = look(false);
    expect(live.fill).toBe(standIn('Highlight'));
    expect(live.edge).toBe(standIn('CanvasText'));
    expect(live.thumb).toBe(standIn('CanvasText'));
    expect(live.tickOutside).toBe(standIn('CanvasText'));
    expect(live.tickInside).toBe(standIn('HighlightText'));
    expect(live.wordsOutside).toBe(standIn('CanvasText'));
    expect(live.wordsInside).toBe(standIn('CanvasText'));
  });

  it('draws a slider that is off in `GrayText`, its scale included, and does not dim it again', () => {
    const off = look(true);
    for (const part of [off.label, off.edge, off.fill, off.thumb]) expect(part).toBe(standIn('GrayText'));

    // The opacity that dims the whole slider in the ordinary palette is handed
    // back, so whatever is not restated in `GrayText` is drawn as though it
    // were live: the words under the ticks stayed `CanvasText`, beside a label
    // in `GrayText`, and the ticks kept the colours of a live scale.
    expect(off.dimmed).toBe('1');
    expect(off.wordsOutside).toBe(standIn('GrayText'));
    expect(off.wordsInside).toBe(standIn('GrayText'));
    expect(off.tickOutside).toBe(standIn('GrayText'));
    // A tick inside the span sits on a `GrayText` fill, so it is cut out of it
    // in `Canvas` — `HighlightText` is the palette's colour for text on
    // `Highlight`, which this fill no longer is.
    expect(off.tickInside).toBe(standIn('Canvas'));
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
describe('v-slider, written by a server', () => {
  const serverBuild = (on: boolean): void => {
    (globalThis as { __VOLT_SERVER__?: boolean }).__VOLT_SERVER__ = on;
  };
  beforeAll(() => serverBuild(true));
  afterAll(() => serverBuild(false));

  it('puts every thumb where its value is, with the numbers a reader needs, before anything attaches', async () => {
    @Component({ selector: 'v-slider', render: compileTemplate(template, 'v-slider') })
    class ServerSlider extends VSlider {}

    @Component({
      selector: 'v-page-server',
      imports: [ServerSlider],
      render: compileTemplate(`
        <v-slider id="price" class="mine" :defaultValue="[20, 60]" name="price" label="Price"
                  :marks="[{ value: 50, label: 'Half' }]"></v-slider>
      `),
    })
    class Page {}

    const { html } = await renderToStaticMarkup(Page);

    const root = /<div [^>]*class="volt-slider[ "][^>]*>/.exec(html)?.[0] ?? '';
    expect(root).toContain('id="price"');
    expect(root).toContain('class="volt-slider mine"');
    expect(root).toContain('role="group"');
    expect(root).toContain('data-scale=""');
    expect(root).toContain(`aria-labelledby="${drawnLabel(html)}"`);

    // The thumbs are drawn at their values on the first paint, not after the
    // page wakes up — a slider that jumps into place is one that was wrong.
    const drawn = [...html.matchAll(/<span [^>]*class="volt-slider-thumb"[^>]*>/g)].map((m) => m[0]);
    expect(drawn).toHaveLength(2);
    expect(drawn[0]).toContain('role="slider"');
    expect(drawn[0]).toContain('aria-valuenow="20"');
    expect(drawn[0]).toContain('aria-label="Minimum"');
    expect(drawn[0]).toContain('style="inset-inline-start:20%"');
    expect(drawn[1]).toContain('aria-valuenow="60"');
    expect(drawn[1]).toContain('aria-label="Maximum"');
    expect(drawn[1]).toContain('style="inset-inline-start:60%"');

    // And the form's half is there too, so a submit before the page attaches
    // still sends the values.
    const hidden = [...html.matchAll(/<input [^>]*>/g)].map((m) => m[0]);
    expect(hidden).toHaveLength(2);
    expect(hidden[0]).toContain('name="price"');
    expect(hidden[0]).toContain('value="20"');
    expect(hidden[1]).toContain('value="60"');
    expect(html).toContain('class="volt-slider-mark-label">Half</span>');
  });

  it('names the group and its one thumb after the label it draws, before anything attaches', async () => {
    @Component({ selector: 'v-slider', render: compileTemplate(template, 'v-slider') })
    class ServerSlider extends VSlider {}

    @Component({
      selector: 'v-page-server-named',
      imports: [ServerSlider],
      render: compileTemplate(`<v-slider :defaultValue="40" label="Volume"></v-slider>`),
    })
    class Page {}

    const { html } = await renderToStaticMarkup(Page);
    const id = drawnLabel(html);
    expect(id).not.toBe('');

    // A server sets no ref, so a name read off the label element is a name a
    // reader without script never hears: the group went out unnamed and its
    // one thumb was called "Value", beside a label that said "Volume".
    const root = /<div [^>]*class="volt-slider"[^>]*>/.exec(html)?.[0] ?? '';
    expect(root).toContain(`aria-labelledby="${id}"`);
    const thumb = /<span [^>]*class="volt-slider-thumb"[^>]*>/.exec(html)?.[0] ?? '';
    expect(thumb).toContain(`aria-labelledby="${id}"`);
    expect(thumb).not.toContain('aria-label=');
  });
});

/** The id the server wrote on the label it drew, or nothing. */
function drawnLabel(html: string): string {
  const tag = /<span [^>]*class="volt-slider-label"[^>]*>/.exec(html)?.[0] ?? '';
  return /\sid="([^"]+)"/.exec(tag)?.[1] ?? '';
}

/**
 * One template, compiled for both halves of a page: written as bytes while
 * the build flag is up, and claimed from those bytes once it is down.
 */
function both(source: string, filename: string): RenderFn {
  const forServer = compile(source, { filename, runtime: '_rt', target: 'server' }).body;
  const forHydrate = compile(source, { filename, runtime: '_rt', target: 'hydrate' }).body;
  const write = (new Function('_rt', forServer) as (rt: unknown) => RenderFn)(server);
  const claim = (new Function('_rt', forHydrate) as (rt: unknown) => RenderFn)(runtime);
  return (ctx, out) =>
    (globalThis as { __VOLT_SERVER__?: boolean }).__VOLT_SERVER__ === true
      ? write(ctx, out)
      : claim(ctx, out);
}

describe('v-slider, written by a server and claimed by a browser', () => {
  @Component({ selector: 'v-slider', render: both(template, 'v-slider'), host: true })
  class RoundTripSlider extends VSlider {}

  @Component({
    selector: 'v-page-served',
    imports: [RoundTripSlider],
    render: both(
      `<v-slider :value="volume" label="Volume" id="volume" class="mine"></v-slider>`,
      'v-page-served',
    ),
  })
  class Served {
    volume = new Signal.State<readonly number[]>([40]);
  }

  it('claims the thumb the server wrote, with the one name the client would give it', async () => {
    (globalThis as { __VOLT_SERVER__?: boolean }).__VOLT_SERVER__ = true;
    let html: string;
    try {
      html = (await renderToStaticMarkup(Served)).html;
    } finally {
      (globalThis as { __VOLT_SERVER__?: boolean }).__VOLT_SERVER__ = false;
    }

    const host = document.createElement('div');
    host.innerHTML = html;
    document.body.append(host);
    const thumb = thumbs(host)[0]!;

    const mismatches: unknown[] = [];
    const stop = runtime.onHydrationMismatch((mismatch) => mismatches.push(mismatch));
    let instance: Served;
    try {
      const handle = hydrate(Served, host);
      unmount = handle.unmount;
      instance = handle.instance as Served;
      flushSync();
    } finally {
      stop();
    }

    expect(mismatches).toEqual([]);
    expect(thumbs(host)[0]).toBe(thumb);
    expect(group(host).id).toBe('volume');
    expect([...group(host).classList].sort()).toEqual(['mine', 'volt-slider']);

    // A spread that claims an element remembers only what it wrote itself, so
    // a name the server wrote and the client would not is never taken away:
    // the thumb kept the server's "Value" beside the client's reference, which
    // is the pair of names this component exists never to write.
    const drawn = label(host)!.id;
    expect(group(host).getAttribute('aria-labelledby')).toBe(drawn);
    expect(thumb.getAttribute('aria-labelledby')).toBe(drawn);
    expect(thumb.hasAttribute('aria-label')).toBe(false);

    // And live from there on.
    press(thumb, 'ArrowRight');
    expect(instance!.volume.get()).toEqual([41]);
    expect(inlineStart(thumb)).toBe('41%');
  });
});
