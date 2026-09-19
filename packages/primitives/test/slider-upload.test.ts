/**
 * Slider and file upload, driven through real mounted components.
 *
 * Both are controls the platform has no element for, so both are judged on the
 * parts a consumer cannot retrofit: what each thumb tells a screen reader, which
 * way the arrows and the pointer run once direction and orientation are counted,
 * whether the hidden mirrors that make a submit work are still telling the truth,
 * and — for the upload — whether a file that was refused, cancelled or retried
 * ends up in a state the user can act on.
 *
 * Geometry is supplied by hand: happy-dom lays nothing out, so every track is a
 * zero-width track until a test says otherwise. Its `DataTransfer` is limited
 * in the same way, so the drag events are built from a stand-in described where
 * it is defined.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compileTemplate } from '@voltdev/core/jit';
import { Component, Signal, flushSync, mount } from '@voltdev/core';
import { createLocaleProvider } from '../src/i18n.ts';
import {
  createFileUpload,
  createSlider,
  fetchTransport,
  xhrTransport,
  type FileUpload,
  type FileUploadOptions,
  type Slider,
  type SliderOptions,
  type UploadItem,
  type UploadRequest,
  type UploadTransport,
} from '../src/slider-upload.ts';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

let host: HTMLElement;
let mounted: { unmount(): void }[] = [];
let selectors = 0;

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  host = document.querySelector('#app')!;
});

afterEach(() => {
  for (const handle of mounted) handle.unmount();
  mounted = [];
  flushSync();
  vi.useRealTimers();
});

/** Give an element a box, since nothing here is laid out. */
function layout(el: Element, box: Partial<DOMRect>): void {
  const rect: DOMRect = {
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: 0,
    height: 0,
    ...box,
    toJSON: () => rect,
  } as DOMRect;
  el.getBoundingClientRect = () => rect;
}

/** A horizontal track two hundred pixels wide, starting at the left edge. */
const HORIZONTAL = { left: 0, right: 200, width: 200, top: 0, bottom: 20, height: 20 };
/** A vertical track two hundred pixels tall, with its maximum at the top. */
const VERTICAL = { left: 0, right: 20, width: 20, top: 0, bottom: 200, height: 200 };

const SLIDER = `
  <div class="slider" :ref="root" :spread="slider.rootProps()"
       :pointerdown="slider.onPointerDown($event)"
       :keydown="onKey($event)">
    <span class="label" :ref="label" :spread="slider.labelProps()">Price</span>
    <span class="track" :ref="track" :spread="slider.trackProps()">
      <span class="range" :spread="slider.rangeProps()"></span>
    </span>
    <span class="thumb" :for="(v, i) of slider.values()" :key="i"
          :spread="slider.thumbProps(i)"></span>
    <input class="mirror" :for="(v, i) of slider.values()" :key="i"
           :spread="slider.inputProps(i)">
  </div>
`;

/** The same slider with the help text and the error message a form field owns. */
const DESCRIBED = `
  <div class="slider" :ref="root" :spread="slider.rootProps()" :keydown="onKey($event)">
    <span class="label" :ref="label" :spread="slider.labelProps()">Price</span>
    <span class="track" :ref="track" :spread="slider.trackProps()"></span>
    <span class="thumb" :for="(v, i) of slider.values()" :key="i"
          :spread="slider.thumbProps(i)"></span>
    <p class="hint" :ref="hint" :spread="slider.descriptionProps()">In pounds</p>
    <p class="error" :ref="error" :spread="slider.errorMessageProps()">Too high</p>
    <input class="mirror" :for="(v, i) of slider.values()" :key="i"
           :spread="slider.inputProps(i)">
  </div>
`;

/** A slider with no label of its own, for the naming rules. */
const BARE = `
  <div class="slider" :ref="root" :spread="slider.rootProps()" :keydown="onKey($event)">
    <span class="track" :ref="track" :spread="slider.trackProps()"></span>
    <span class="thumb" :for="(v, i) of slider.values()" :key="i"
          :spread="slider.thumbProps(i)"></span>
  </div>
`;

const MARKED = `
  <div class="slider" :ref="root" :spread="slider.rootProps()" :keydown="onKey($event)">
    <span class="track" :ref="track" :spread="slider.trackProps()"></span>
    <span class="mark" :for="mark of slider.marks()" :key="mark.value"
          :spread="slider.markProps(mark)"></span>
    <span class="thumb" :for="(v, i) of slider.values()" :key="i"
          :spread="slider.thumbProps(i)"></span>
  </div>
`;

/** The mirrors behind a consumer's `:if`, the way a lazily revealed panel holds them. */
const LATE_MIRRORS = `
  <div class="slider" :ref="root" :spread="slider.rootProps()" :keydown="onKey($event)">
    <span class="track" :ref="track" :spread="slider.trackProps()"></span>
    <span class="thumb" :for="(v, i) of slider.values()" :key="i"
          :spread="slider.thumbProps(i)"></span>
    <span class="panel" :if="ready.get()">
      <input class="mirror" :for="(v, i) of slider.values()" :key="i"
             :spread="slider.inputProps(i)">
    </span>
  </div>
`;

type Options = Omit<SliderOptions, 'root' | 'track' | 'label' | 'description' | 'errorMessage'>;

interface SliderHarness {
  slider: Slider;
  root: HTMLElement;
  track: HTMLElement;
  thumbs(): HTMLElement[];
  thumb(index: number): HTMLElement;
  mirrors(): HTMLInputElement[];
  /** Render whatever the template kept behind its `:if`, and settle it. */
  reveal(): void;
  /** What `onKeyDown` returned for the last key the slider saw. */
  handled(): boolean;
  unmount(): void;
}

function build(
  template: string,
  options: Options,
  parent: HTMLElement = host,
  box: Partial<DOMRect> = HORIZONTAL,
): SliderHarness {
  @Component({ selector: `v-slider-${++selectors}`, render: compileTemplate(template) })
  class SliderComponent {
    root = new Signal.State<Element | null>(null);
    track = new Signal.State<Element | null>(null);
    label = new Signal.State<Element | null>(null);
    hint = new Signal.State<Element | null>(null);
    error = new Signal.State<Element | null>(null);
    ready = new Signal.State(false);
    lastHandled = false;
    slider: Slider = createSlider({
      ...options,
      root: () => this.root.get(),
      track: () => this.track.get(),
      label: () => this.label.get(),
      description: () => this.hint.get(),
      errorMessage: () => this.error.get(),
    });

    onKey(event: KeyboardEvent): void {
      this.lastHandled = this.slider.onKeyDown(event);
    }
  }

  const handle = mount(SliderComponent, parent);
  mounted.push(handle);
  flushSync();

  const instance = handle.instance as SliderComponent;
  const root = parent.querySelector<HTMLElement>('.slider')!;
  const track = parent.querySelector<HTMLElement>('.track')!;
  layout(track, box);

  return {
    slider: instance.slider,
    root,
    track,
    thumbs: () => [...parent.querySelectorAll<HTMLElement>('.thumb')],
    thumb: (index) => parent.querySelectorAll<HTMLElement>('.thumb')[index]!,
    mirrors: () => [...parent.querySelectorAll<HTMLInputElement>('.mirror')],
    reveal: () => {
      instance.ready.set(true);
      flushSync();
    },
    handled: () => instance.lastHandled,
    unmount: () => handle.unmount(),
  };
}

function setup(options: Options = {}, box: Partial<DOMRect> = HORIZONTAL): SliderHarness {
  return build(SLIDER, options, host, box);
}

/**
 * Reset the form in the order a browser does, which this environment's own
 * `reset()` does not: the event first, then every microtask its listeners
 * queued — a press on a reset button runs them as each listener returns, with
 * nothing else on the stack to wait for — and only then the controls put back.
 */
async function browserReset(form: HTMLFormElement): Promise<void> {
  const event = new Event('reset', { bubbles: true, cancelable: true });
  if (!form.dispatchEvent(event)) return;
  await Promise.resolve();
  flushSync();

  // The environment's `reset()` puts the controls back and then dispatches an
  // event of its own, which is the one that has just been heard.
  const dispatch = form.dispatchEvent;
  form.dispatchEvent = () => true;
  try {
    form.reset();
  } finally {
    form.dispatchEvent = dispatch;
  }
  await Promise.resolve();
  flushSync();
}

function press(el: HTMLElement, key: string, modifiers: Partial<KeyboardEventInit> = {}): boolean {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers });
  el.dispatchEvent(event);
  flushSync();
  return event.defaultPrevented;
}

function pointerDown(el: HTMLElement, point: { clientX?: number; clientY?: number }): PointerEvent {
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
  el.dispatchEvent(event);
  flushSync();
  return event;
}

function pointerMove(point: { clientX?: number; clientY?: number }): void {
  document.dispatchEvent(
    new PointerEvent('pointermove', {
      bubbles: true,
      pointerId: 1,
      clientX: 0,
      clientY: 0,
      ...point,
    }),
  );
  flushSync();
}

function pointerUp(): void {
  document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
  flushSync();
}

// ---------------------------------------------------------------------------
// Slider: what assistive technology is told
// ---------------------------------------------------------------------------

describe('slider: what assistive technology is told', () => {
  it('gives every thumb the slider role and the numbers that go with it', () => {
    const { root, thumb } = setup({ defaultValue: [20], min: 0, max: 100 });

    // The group carries the name; the role belongs to the thumb, because the
    // thumb is the thing with a value.
    expect(root.getAttribute('role')).toBe('group');

    const only = thumb(0);
    expect(only.getAttribute('role')).toBe('slider');
    expect(only.getAttribute('aria-valuenow')).toBe('20');
    expect(only.getAttribute('aria-valuemin')).toBe('0');
    expect(only.getAttribute('aria-valuemax')).toBe('100');
    expect(only.getAttribute('aria-orientation')).toBe('horizontal');
    expect(only.getAttribute('tabindex')).toBe('0');
  });

  it('says which values a thumb of a range may actually take', () => {
    const { thumbs } = setup({ defaultValue: [20, 80] });
    const [low, high] = thumbs();

    // Not 0–100: this thumb cannot pass its neighbour, and announcing values it
    // will refuse to take is announcing a lie.
    expect(low!.getAttribute('aria-valuemin')).toBe('0');
    expect(low!.getAttribute('aria-valuemax')).toBe('80');
    expect(high!.getAttribute('aria-valuemin')).toBe('20');
    expect(high!.getAttribute('aria-valuemax')).toBe('100');
  });

  it('narrows the announced bounds as the other thumb approaches', () => {
    const { slider, thumbs } = setup({ defaultValue: [20, 80] });
    slider.setValue(1, 40);
    flushSync();
    expect(thumbs()[0]!.getAttribute('aria-valuemax')).toBe('40');
  });

  it('names one thumb from the slider and the ends of a range by hand', () => {
    const single = setup({ defaultValue: [20] });
    const label = host.querySelector('.label')!;

    // One thumb is the slider, so it borrows the slider's name rather than
    // inventing "Value" beside it.
    expect(single.thumb(0).getAttribute('aria-labelledby')).toBe(label.id);
    expect(single.thumb(0).hasAttribute('aria-label')).toBe(false);
    single.unmount();

    const range = build(SLIDER, { defaultValue: [20, 50, 80] });
    expect(range.thumbs().map((el) => el.getAttribute('aria-label'))).toEqual([
      'Minimum',
      'Value 2',
      'Maximum',
    ]);
  });

  it('does not point a range thumb at the group label as well as naming it', () => {
    const { thumbs } = setup({ defaultValue: [20, 80] });
    // Both would be announced, and the group's name is already read out around
    // them — "Price Minimum Price" is what a thumb carrying both says.
    expect(thumbs().map((el) => el.hasAttribute('aria-labelledby'))).toEqual([false, false]);
    expect(thumbs().map((el) => el.getAttribute('aria-label'))).toEqual(['Minimum', 'Maximum']);
  });

  it('flags the thumb the pointer picked up, and only that one', () => {
    const { thumbs, track } = setup({ defaultValue: [20, 80] });
    // Nothing is active until something picks a thumb up, and a styling hook
    // that is on every thumb at rest cannot say which one moved.
    expect(thumbs().map((el) => el.hasAttribute('data-active'))).toEqual([false, false]);

    pointerDown(track, { clientX: 180 });
    expect(thumbs().map((el) => el.hasAttribute('data-active'))).toEqual([false, true]);
  });

  it('takes the thumb names it is given', () => {
    const { thumbs } = setup({
      defaultValue: [20, 80],
      labels: { minimum: 'From', maximum: 'To' },
    });
    expect(thumbs().map((el) => el.getAttribute('aria-label'))).toEqual(['From', 'To']);
  });

  it('names an unlabelled slider rather than pointing at an id nothing has', () => {
    const harness = build(BARE, { defaultValue: [20] });

    // A dangling aria-labelledby reads exactly like no name at all, and hides
    // the mistake from every audit that only checks the attribute is there.
    expect(harness.root.hasAttribute('aria-labelledby')).toBe(false);
    expect(harness.thumb(0).hasAttribute('aria-labelledby')).toBe(false);
    expect(harness.thumb(0).getAttribute('aria-label')).toBe('Value');
  });

  it('describes the thumb from the help text and the error, in that order', () => {
    const harness = build(DESCRIBED, { defaultValue: [20] });
    const hint = host.querySelector('.hint')!;
    const error = host.querySelector('.error')!;

    expect(harness.thumb(0).getAttribute('aria-describedby')).toBe(`${hint.id} ${error.id}`);
    // Both ids belong to elements that are really there.
    expect(document.getElementById(hint.id)).not.toBeNull();
    expect(document.getElementById(error.id)).not.toBeNull();
  });

  it('says nothing about a description that was never rendered', () => {
    const harness = build(BARE, { defaultValue: [20] });
    expect(harness.thumb(0).hasAttribute('aria-describedby')).toBe(false);
  });

  it('speaks the value as text, formatted for the locale by default', () => {
    const plain = setup({ defaultValue: [1500], max: 10_000 });
    expect(plain.thumb(0).getAttribute('aria-valuetext')).toBe('1,500');
    plain.unmount();

    const priced = build(SLIDER, {
      defaultValue: [25],
      valueText: (value) => `£${value}`,
    });
    expect(priced.thumb(0).getAttribute('aria-valuetext')).toBe('£25');
  });

  it('keeps a disabled thumb in the tab order and says it is unavailable', () => {
    const { root, thumb, mirrors } = setup({ defaultValue: [20], disabled: () => true });

    // `aria-disabled`, not the attribute: a thumb that vanishes from the tab
    // order cannot be found and asked about.
    expect(thumb(0).getAttribute('aria-disabled')).toBe('true');
    expect(thumb(0).getAttribute('tabindex')).toBe('0');
    expect(root.getAttribute('data-disabled')).toBe('');
    // The mirror is the one that must really be disabled, or a disabled slider
    // still submits.
    expect(mirrors()[0]!.disabled).toBe(true);
  });

  it('does not label the thumb through the label element', () => {
    build(DESCRIBED, { defaultValue: [20] });
    // A `for` would point at the mirror, so pressing the words would focus a
    // one-pixel input instead of the thumb the user can see.
    expect(host.querySelector('.label')!.hasAttribute('for')).toBe(false);
  });

  it('says nothing is wrong until validation has run, then says it on the thumb', async () => {
    const harness = build(DESCRIBED, {
      defaultValue: [80],
      validate: (values) => ((values[0] ?? 0) > 50 ? 'Too expensive' : null),
    });

    // A slider that announces itself as invalid before anything has been
    // checked is the most common form bug there is.
    expect(harness.thumb(0).hasAttribute('aria-invalid')).toBe(false);

    await harness.slider.field.validate();
    flushSync();
    expect(harness.thumb(0).getAttribute('aria-invalid')).toBe('true');
    expect(harness.slider.field.messages()).toEqual(['Too expensive']);
    // The message is announced where it appears, not only where it is pointed
    // at from.
    expect(host.querySelector('.error')!.getAttribute('role')).toBe('alert');
  });
});

// ---------------------------------------------------------------------------
// Slider: the keyboard
// ---------------------------------------------------------------------------

describe('slider: the keyboard', () => {
  it('steps by one step in both directions', () => {
    const { slider, thumb } = setup({ defaultValue: [50], step: 5 });

    expect(press(thumb(0), 'ArrowRight')).toBe(true);
    expect(slider.value()).toBe(55);
    press(thumb(0), 'ArrowUp');
    expect(slider.value()).toBe(60);
    press(thumb(0), 'ArrowLeft');
    press(thumb(0), 'ArrowDown');
    expect(slider.value()).toBe(50);
  });

  it('pages by ten steps unless told otherwise', () => {
    const tens = setup({ defaultValue: [50], step: 1 });
    press(tens.thumb(0), 'PageUp');
    expect(tens.slider.value()).toBe(60);
    press(tens.thumb(0), 'PageDown');
    press(tens.thumb(0), 'PageDown');
    expect(tens.slider.value()).toBe(40);
    tens.unmount();

    const quarters = build(SLIDER, { defaultValue: [50], step: 5, largeStep: 25 });
    press(quarters.thumb(0), 'PageUp');
    expect(quarters.slider.value()).toBe(75);
  });

  it('takes Home and End to the ends of the slider', () => {
    const { slider, thumb } = setup({ defaultValue: [50], min: 10, max: 90 });
    press(thumb(0), 'Home');
    expect(slider.value()).toBe(10);
    press(thumb(0), 'End');
    expect(slider.value()).toBe(90);
  });

  it('stops Home and End at the neighbouring thumb', () => {
    const { slider, thumbs } = setup({ defaultValue: [20, 80] });

    press(thumbs()[0]!, 'End');
    // Not 100: End is the end of this thumb's range, and pushing through the
    // other thumb would reorder the pair behind the user's back.
    expect(slider.values()).toEqual([80, 80]);
    press(thumbs()[1]!, 'Home');
    expect(slider.values()).toEqual([80, 80]);
  });

  it('clamps at the ends and consumes the key anyway', () => {
    const { slider, thumb } = setup({ defaultValue: [100] });
    // Consumed even though nothing moved, or the page scrolls under a slider
    // the user is holding an arrow down on.
    expect(press(thumb(0), 'ArrowRight')).toBe(true);
    expect(slider.value()).toBe(100);
  });

  it('leaves keys it does not own to whatever wraps the slider', () => {
    const { slider, thumb, handled } = setup({ defaultValue: [50] });
    // A modified key is a shortcut, not a nudge, and Tab still has to leave.
    expect(press(thumb(0), 'ArrowRight', { ctrlKey: true })).toBe(false);
    expect(press(thumb(0), 'ArrowRight', { metaKey: true })).toBe(false);
    expect(press(thumb(0), 'Tab')).toBe(false);
    expect(handled()).toBe(false);
    expect(slider.value()).toBe(50);
  });

  it('ignores keys while disabled', () => {
    const { slider, thumb, handled } = setup({ defaultValue: [50], disabled: () => true });
    expect(press(thumb(0), 'ArrowRight')).toBe(false);
    expect(handled()).toBe(false);
    expect(slider.value()).toBe(50);
  });

  it('ignores a key that reached the slider without a thumb', () => {
    const { root, handled, slider } = setup({ defaultValue: [50] });
    // Nothing has been touched, so there is no thumb the key could be about.
    expect(press(root, 'ArrowRight')).toBe(false);
    expect(handled()).toBe(false);
    expect(slider.value()).toBe(50);
  });

  it('moves the last thumb the pointer touched when the key came from elsewhere', () => {
    const { root, track, slider } = setup({ defaultValue: [20, 80] });
    pointerDown(track, { clientX: 180 });
    pointerUp();

    press(root, 'ArrowRight');
    expect(slider.values()).toEqual([20, 91]);
  });

  it('keeps a fractional step off the floating-point rocks', () => {
    const { slider, thumb } = setup({ defaultValue: [0.2], min: 0, max: 1, step: 0.1 });
    press(thumb(0), 'ArrowRight');

    // 0.2 + 0.1 is 0.30000000000000004, which is what a slider submits and a
    // screen reader reads out unless the precision is put back.
    expect(slider.value()).toBe(0.3);
    expect(thumb(0).getAttribute('aria-valuenow')).toBe('0.3');
  });

  it('commits once per press but reports every change', () => {
    const onValueChange = vi.fn();
    const onValueCommit = vi.fn();
    const { thumb } = setup({ defaultValue: [50], onValueChange, onValueCommit });

    press(thumb(0), 'ArrowRight');
    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueCommit).toHaveBeenCalledTimes(1);
    expect(onValueCommit).toHaveBeenLastCalledWith([51]);

    // At an end nothing changes, but the gesture still happened.
    press(thumb(0), 'Home');
    press(thumb(0), 'Home');
    expect(onValueChange).toHaveBeenCalledTimes(2);
    expect(onValueCommit).toHaveBeenCalledTimes(3);
  });

  it('marks the field touched once a key has been pressed', () => {
    const { slider, thumb, root } = setup({ defaultValue: [50] });
    expect(slider.field.isTouched()).toBe(false);
    press(thumb(0), 'ArrowRight');
    expect(slider.field.isTouched()).toBe(true);
    expect(root.getAttribute('data-touched')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Slider: direction and orientation
// ---------------------------------------------------------------------------

describe('slider: direction and orientation', () => {
  it('mirrors left and right under a right-to-left ancestor', () => {
    host.setAttribute('dir', 'rtl');
    const { slider, thumb, root } = setup({ defaultValue: [50] });

    expect(slider.direction()).toBe('rtl');
    expect(root.getAttribute('data-direction')).toBe('rtl');

    // The key that moves the thumb towards the screen's right edge is the one
    // that lowers the value, because the track runs the other way.
    press(thumb(0), 'ArrowLeft');
    expect(slider.value()).toBe(51);
    press(thumb(0), 'ArrowRight');
    expect(slider.value()).toBe(50);
  });

  it('leaves up and down alone under a right-to-left ancestor', () => {
    host.setAttribute('dir', 'rtl');
    const { slider, thumb } = setup({ defaultValue: [50] });

    // Vertical order is not mirrored by language, so a right-to-left slider has
    // two keys that increase and two that decrease.
    press(thumb(0), 'ArrowUp');
    expect(slider.value()).toBe(51);
    press(thumb(0), 'ArrowDown');
    expect(slider.value()).toBe(50);
  });

  it('takes a direction it is given over the one in the DOM', () => {
    host.setAttribute('dir', 'ltr');
    const { slider, thumb } = setup({ defaultValue: [50], dir: 'rtl' });
    expect(slider.direction()).toBe('rtl');
    press(thumb(0), 'ArrowLeft');
    expect(slider.value()).toBe(51);
  });

  it('reads a press against the track, left to right', () => {
    const { slider, track } = setup({ defaultValue: [0] });
    pointerDown(track, { clientX: 50 });
    // A quarter of the way across two hundred pixels.
    expect(slider.value()).toBe(25);
  });

  it('reads a press backwards under a right-to-left ancestor', () => {
    host.setAttribute('dir', 'rtl');
    const { slider, track } = setup({ defaultValue: [0] });
    pointerDown(track, { clientX: 50 });

    // The same pixel is a quarter of the way from the *right*, which is 75.
    // This is the one place the pointer has to know about direction at all.
    expect(slider.value()).toBe(75);
  });

  it('reads a vertical press from the bottom up', () => {
    const { slider, track } = setup({ defaultValue: [0], orientation: 'vertical' }, VERTICAL);
    pointerDown(track, { clientY: 50 });

    // Screen y grows downwards and value grows upwards, so a press near the top
    // is a high value.
    expect(slider.value()).toBe(75);
    expect(slider.orientation()).toBe('vertical');
  });

  it('does not mirror a vertical track for a right-to-left locale', () => {
    host.setAttribute('dir', 'rtl');
    const { slider, track } = setup({ defaultValue: [0], orientation: 'vertical' }, VERTICAL);
    pointerDown(track, { clientY: 50 });

    // Arabic does not flip up and down, and a vertical slider whose maximum
    // moved to the bottom under one locale would be unusable.
    expect(slider.value()).toBe(75);
  });

  it('inverts the axis on top of everything else when asked', () => {
    const horizontal = setup({ defaultValue: [0], inverted: true });
    pointerDown(horizontal.track, { clientX: 50 });
    expect(horizontal.slider.value()).toBe(75);
    horizontal.unmount();

    const vertical = build(
      SLIDER,
      { defaultValue: [0], orientation: 'vertical', inverted: true },
      host,
      VERTICAL,
    );
    pointerDown(vertical.track, { clientY: 50 });
    expect(vertical.slider.value()).toBe(25);
  });

  it('draws an inverted thumb at the end the finger is on', () => {
    const { slider, root, track } = setup({ defaultValue: [0], inverted: true });
    pointerDown(track, { clientX: 50 });

    // Inversion is a fact about the track, so it has to reach every reading of
    // the track and not only the pointer. A press a quarter along reads 75; if
    // the position the consumer renders from still says 75 the thumb is drawn
    // at the far end from the finger, and dragging right walks it left.
    expect(slider.value()).toBe(75);
    expect(slider.percentAt(0)).toBe(25);
    // One thumb fills from the minimum, which inversion has moved to the top.
    expect(slider.fill()).toEqual({ start: 25, end: 100 });

    // Direction has a CSS mirror in `inset-inline-start`; inversion has none,
    // so decoration a percentage cannot carry needs the flag to compensate.
    expect(root.getAttribute('data-inverted')).toBe('');
    expect(track.getAttribute('data-inverted')).toBe('');
  });

  it('leaves the position alone when it was not asked to invert', () => {
    const { slider, root } = setup({ defaultValue: [25] });
    expect(slider.percentAt(0)).toBe(25);
    expect(root.hasAttribute('data-inverted')).toBe(false);
  });

  it('reports the axis on the thumb even for the default orientation', () => {
    const { thumb } = setup({ defaultValue: [50] });
    // Horizontal is ARIA's default, but a user who cannot see the track has no
    // other way to learn which arrows do anything.
    expect(thumb(0).getAttribute('aria-orientation')).toBe('horizontal');
  });
});

// ---------------------------------------------------------------------------
// Slider: the value
// ---------------------------------------------------------------------------

describe('slider: the value', () => {
  it('quantises whatever it is given onto the step grid', () => {
    const { slider } = setup({ defaultValue: [23], step: 10 });
    expect(slider.values()).toEqual([20]);

    slider.setValue(0, 27);
    flushSync();
    expect(slider.values()).toEqual([30]);
  });

  it('clamps out of range values rather than reporting them', () => {
    const { slider } = setup({ defaultValue: [50], min: 10, max: 90 });
    slider.setValue(0, 1000);
    flushSync();
    expect(slider.value()).toBe(90);
    slider.setValue(0, -1000);
    flushSync();
    expect(slider.value()).toBe(10);
  });

  it('survives a step of zero, which would otherwise divide by it', () => {
    const { slider } = setup({ defaultValue: [50], step: 0 });
    // A caller bug that would surface as NaN in aria-valuenow.
    expect(slider.value()).toBe(50);
    slider.setValue(0, 51.4);
    flushSync();
    expect(slider.value()).toBe(51);
  });

  it('refuses to move while disabled', () => {
    const { slider } = setup({ defaultValue: [50], disabled: () => true });
    slider.setValue(0, 80);
    slider.setValues([10]);
    slider.stepBy(0, 5);
    flushSync();
    expect(slider.value()).toBe(50);
  });

  it('reports where a value sits along the track as a percentage', () => {
    const { slider } = setup({ defaultValue: [25], min: 0, max: 200 });
    expect(slider.percentAt(0)).toBe(12.5);
    expect(slider.percentFor(200)).toBe(100);
    // One thumb fills from the start, because everything below it is chosen.
    expect(slider.fill()).toEqual({ start: 0, end: 12.5 });
  });

  it('fills between the thumbs of a range', () => {
    const { slider } = setup({ defaultValue: [20, 80] });
    expect(slider.fill()).toEqual({ start: 20, end: 80 });
  });

  it('can be driven from outside, and cannot be driven out of range', () => {
    const value = new Signal.State<readonly number[]>([30]);
    const { slider, thumb, mirrors } = setup({ value, min: 0, max: 100 });

    value.set([70]);
    flushSync();
    expect(slider.value()).toBe(70);
    expect(thumb(0).getAttribute('aria-valuenow')).toBe('70');
    expect(mirrors()[0]!.value).toBe('70');

    // A controlled signal set to something impossible must not put the thumb
    // off the end of its own track.
    value.set([-40]);
    flushSync();
    expect(slider.value()).toBe(0);
    expect(thumb(0).getAttribute('aria-valuenow')).toBe('0');
  });

  it('writes back into the signal it was given', () => {
    const value = new Signal.State<readonly number[]>([30]);
    const { thumb } = setup({ value });
    press(thumb(0), 'ArrowRight');
    expect(value.get()).toEqual([31]);
  });

  it('owns its own value when it was given none', () => {
    // The uncontrolled case is the one most callers use and the one most often
    // left untested.
    const { slider, thumb } = setup({});
    expect(slider.values()).toEqual([0]);
    press(thumb(0), 'End');
    expect(slider.value()).toBe(100);
  });

  it('sorts a pair it is handed the wrong way round', () => {
    const { slider } = setup({ defaultValue: [80, 20] });
    // Read through the same clamp as a write, so no consumer can start a
    // range slider crossed over.
    expect(slider.values()).toEqual([80, 80]);
  });

  it('refuses an index the slider has no thumb for', () => {
    const onValueChange = vi.fn();
    const { slider } = setup({ defaultValue: [20], onValueChange });

    // A caller reaching past the last thumb would otherwise grow the value a
    // thumb at a time, and the array it grew is what the form submits.
    slider.setValue(1, 60);
    slider.setValue(-1, 60);
    flushSync();

    expect(slider.values()).toEqual([20]);
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('reports nothing for a write that leaves the value where it was', () => {
    const onValueChange = vi.fn();
    const { slider } = setup({ defaultValue: [40], onValueChange });

    slider.setValues([40]);
    flushSync();
    // Off the grid on the way in and the same value once settled, which is the
    // case a comparison made before quantising would miss.
    slider.setValues([40.4]);
    flushSync();

    expect(slider.values()).toEqual([40]);
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('survives a negative step and a negative page step', () => {
    const { slider, thumb } = setup({ defaultValue: [50], step: -10, largeStep: -100 });

    // Zero is the caller bug that divides; a negative one is the caller bug
    // that runs the slider backwards, and both fall back to the default.
    press(thumb(0), 'ArrowRight');
    expect(slider.value()).toBe(51);
    press(thumb(0), 'PageUp');
    expect(slider.value()).toBe(61);
  });

  it('refuses a value that is not a number rather than reporting NaN', () => {
    const value = new Signal.State<readonly number[]>([40]);
    const { slider, thumb } = setup({ value, min: 10, max: 90 });

    // What an upstream parse hands back when it failed. NaN reaches the form
    // through the mirror and `aria-valuenow` through the thumb, and neither is
    // a value anything can act on.
    value.set([Number.NaN]);
    flushSync();

    expect(slider.value()).toBe(10);
    expect(thumb(0).getAttribute('aria-valuenow')).toBe('10');
  });

  it('answers zero for a track with no span rather than NaN', () => {
    const { slider, thumb } = setup({ defaultValue: [5], min: 5, max: 5 });

    // A range whose ends have come out equal is a caller bug the same way a
    // step of zero is, and the answer it must not give is a percentage nobody
    // can position with.
    expect(slider.percentAt(0)).toBe(0);
    expect(slider.percentFor(5)).toBe(0);
    expect(slider.fill()).toEqual({ start: 0, end: 0 });
    expect(thumb(0).getAttribute('aria-valuenow')).toBe('5');
  });
});

// ---------------------------------------------------------------------------
// Slider: two thumbs
// ---------------------------------------------------------------------------

describe('slider: two thumbs', () => {
  it('will not let a thumb pass its neighbour', () => {
    const { slider } = setup({ defaultValue: [20, 80] });
    slider.setValue(0, 95);
    flushSync();
    expect(slider.values()).toEqual([80, 80]);

    slider.setValue(1, 5);
    flushSync();
    expect(slider.values()).toEqual([80, 80]);
  });

  it('keeps the gap it was told to keep', () => {
    const { slider, thumbs } = setup({ defaultValue: [20, 80], minStepsBetweenThumbs: 10 });
    slider.setValue(0, 95);
    flushSync();
    expect(slider.values()).toEqual([70, 80]);
    expect(thumbs()[0]!.getAttribute('aria-valuemax')).toBe('70');
  });

  it('gives a press to the nearest thumb', () => {
    const { slider, track } = setup({ defaultValue: [20, 80] });
    // 180px of 200 is 90, which is nearer 80 than 20.
    pointerDown(track, { clientX: 180 });
    expect(slider.values()).toEqual([20, 90]);
    expect(slider.activeIndex()).toBe(1);
  });

  it('pulls a stack of thumbs apart in the direction of the press', () => {
    const stacked = setup({ defaultValue: [100, 100] });
    pointerDown(stacked.track, { clientX: 60 });
    // Distance cannot break a tie, so the press goes to the thumb that can
    // travel towards it — otherwise two thumbs at the maximum are welded shut.
    expect(stacked.slider.values()).toEqual([30, 100]);
    stacked.unmount();

    const bottom = build(SLIDER, { defaultValue: [0, 0] });
    layout(bottom.track, HORIZONTAL);
    pointerDown(bottom.track, { clientX: 140 });
    expect(bottom.slider.values()).toEqual([0, 70]);
  });

  it('gives a press to the nearer thumb when that is the lower one', () => {
    const { slider, track } = setup({ defaultValue: [20, 80] });
    // 60px of 200 is 30, which is nearer 20 than 80. The tie-break that pulls
    // a stack apart walks upwards from the nearest thumb, and it must stop at
    // the first neighbour that is not sitting on the same value.
    pointerDown(track, { clientX: 60 });
    expect(slider.values()).toEqual([30, 80]);
    expect(slider.activeIndex()).toBe(0);
  });

  it('picks up a thumb where it is rather than jumping it to the press', () => {
    const { slider, thumbs } = setup({ defaultValue: [20, 80] });
    // The press landed on the thumb, so the value must not move before the
    // first pointer move — a thumb is wider than a pixel.
    pointerDown(thumbs()[1]!, { clientX: 40 });
    expect(slider.values()).toEqual([20, 80]);
    expect(slider.activeIndex()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Slider: dragging
// ---------------------------------------------------------------------------

describe('slider: dragging', () => {
  it('follows the pointer and commits once on release', () => {
    const onValueChange = vi.fn();
    const onValueCommit = vi.fn();
    const { slider, track } = setup({ defaultValue: [0], onValueChange, onValueCommit });

    pointerDown(track, { clientX: 20 });
    expect(slider.isDragging()).toBe(true);
    pointerMove({ clientX: 100 });
    pointerMove({ clientX: 160 });
    expect(slider.value()).toBe(80);
    expect(onValueCommit).not.toHaveBeenCalled();

    pointerUp();
    expect(slider.isDragging()).toBe(false);
    expect(onValueChange).toHaveBeenCalledTimes(3);
    expect(onValueCommit).toHaveBeenCalledTimes(1);
    expect(onValueCommit).toHaveBeenLastCalledWith([80]);
  });

  it('moves focus to the thumb it picked up', () => {
    const { track, thumb } = setup({ defaultValue: [0] });
    const event = pointerDown(track, { clientX: 100 });

    // Prevented, or the press starts a text selection that fights the drag.
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(thumb(0));
  });

  it('stops listening to the document once the drag is over', () => {
    const onValueChange = vi.fn();
    const { slider, track } = setup({ defaultValue: [0], onValueChange });

    pointerDown(track, { clientX: 20 });
    pointerUp();
    onValueChange.mockClear();

    pointerMove({ clientX: 180 });
    // A document listener left behind would carry on dragging a slider nobody
    // is touching.
    expect(onValueChange).not.toHaveBeenCalled();
    expect(slider.value()).toBe(10);
  });

  it('ignores a pointer that is not the one being dragged', () => {
    const { slider, track } = setup({ defaultValue: [0] });
    pointerDown(track, { clientX: 20 });

    document.dispatchEvent(
      new PointerEvent('pointermove', { pointerId: 99, clientX: 180, bubbles: true }),
    );
    flushSync();
    // A second finger must not fight the first for the same thumb.
    expect(slider.value()).toBe(10);
  });

  it('ignores a release from a pointer that is not the one being dragged', () => {
    const onValueCommit = vi.fn();
    const { slider, track } = setup({ defaultValue: [0], onValueCommit });
    pointerDown(track, { clientX: 20 });

    document.dispatchEvent(new PointerEvent('pointerup', { pointerId: 99, bubbles: true }));
    flushSync();

    // A second finger lifting must not end the first finger's drag: the value
    // would stop following the pointer that is still down, and the commit
    // would report a gesture the user has not finished.
    expect(slider.isDragging()).toBe(true);
    expect(onValueCommit).not.toHaveBeenCalled();

    pointerMove({ clientX: 180 });
    expect(slider.value()).toBe(90);
  });

  it('lets go of the document when the component unmounts mid-drag', () => {
    const onValueChange = vi.fn();
    const { track, unmount } = setup({ defaultValue: [0], onValueChange });

    pointerDown(track, { clientX: 20 });
    unmount();
    flushSync();
    onValueChange.mockClear();

    pointerMove({ clientX: 180 });
    // The listeners are on the document, so nothing else would ever remove them.
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('ignores a secondary button and a secondary finger', () => {
    const { slider, track } = setup({ defaultValue: [0] });

    track.dispatchEvent(
      new PointerEvent('pointerdown', { button: 2, isPrimary: true, clientX: 100, bubbles: true }),
    );
    track.dispatchEvent(
      new PointerEvent('pointerdown', { button: 0, isPrimary: false, clientX: 100, bubbles: true }),
    );
    flushSync();

    expect(slider.value()).toBe(0);
    expect(slider.isDragging()).toBe(false);
  });

  it('ignores a press while disabled', () => {
    const { slider, track } = setup({ defaultValue: [0], disabled: () => true });
    pointerDown(track, { clientX: 100 });
    expect(slider.value()).toBe(0);
    expect(slider.isDragging()).toBe(false);
  });

  it('flags the drag for styling and marks the field touched at the end', () => {
    const { slider, root, track } = setup({ defaultValue: [0] });
    pointerDown(track, { clientX: 100 });
    expect(root.getAttribute('data-dragging')).toBe('');
    pointerUp();
    expect(root.hasAttribute('data-dragging')).toBe(false);
    expect(slider.field.isTouched()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Slider: marks
// ---------------------------------------------------------------------------

describe('slider: marks', () => {
  it('sorts the marks and drops the ones off the track', () => {
    const { slider } = setup({ marks: [100, 25, { value: 50, label: 'Half' }, 300, -10] });
    expect(slider.marks()).toEqual([{ value: 25 }, { value: 50, label: 'Half' }, { value: 100 }]);
  });

  it('says which marks the value has passed', () => {
    build(MARKED, { defaultValue: [50], marks: [0, 25, 50, 75, 100] });
    const states = [...host.querySelectorAll('.mark')].map((el) => el.getAttribute('data-state'));
    expect(states).toEqual(['active', 'active', 'active', 'inactive', 'inactive']);
  });

  it('marks only the span between the thumbs of a range', () => {
    build(MARKED, { defaultValue: [25, 75], marks: [0, 25, 50, 75, 100] });
    const states = [...host.querySelectorAll('.mark')].map((el) => el.getAttribute('data-state'));
    expect(states).toEqual(['inactive', 'active', 'active', 'active', 'inactive']);
  });

  it('moves between marks instead of by step when snapping', () => {
    const { slider, thumb } = setup({
      defaultValue: [25],
      marks: [0, 25, 50, 100],
      snapToMarks: true,
    });

    press(thumb(0), 'ArrowRight');
    expect(slider.value()).toBe(50);
    press(thumb(0), 'ArrowRight');
    expect(slider.value()).toBe(100);
    press(thumb(0), 'ArrowRight');
    expect(slider.value()).toBe(100);
    press(thumb(0), 'Home');
    expect(slider.value()).toBe(0);
  });

  it('lands a blocked thumb on the last mark its neighbour leaves room for', () => {
    const { slider } = setup({
      defaultValue: [0, 70],
      marks: [0, 30, 70, 100],
      snapToMarks: true,
      minStepsBetweenThumbs: 5,
    });

    // The gap puts the bound between two marks, so the mark nearest the value
    // asked for is on the far side of it. Snapping there and letting the
    // neighbour be shoved along would leave the signal holding one array while
    // `values()` reported another; the honest answer is the last mark this
    // thumb still has room for.
    slider.setValue(0, 65);
    expect(slider.values()).toEqual([30, 70]);
  });

  it('leaves the value off the marks until it is asked to snap', () => {
    const { slider, thumb } = setup({ defaultValue: [20], marks: [0, 25, 50, 75, 100] });

    // Without `snapToMarks` the marks are a scale to read the thumb against,
    // and the value goes on moving by step through them.
    expect(slider.values()).toEqual([20]);
    slider.setValue(0, 30);
    flushSync();
    expect(slider.value()).toBe(30);
    press(thumb(0), 'ArrowRight');
    expect(slider.value()).toBe(31);
  });

  it('snaps a press to the nearest mark', () => {
    const { slider, track } = setup({
      defaultValue: [0],
      marks: [0, 25, 50, 100],
      snapToMarks: true,
    });
    // 120px of 200 is 60, which is nearer 50 than 100.
    pointerDown(track, { clientX: 120 });
    expect(slider.value()).toBe(50);
  });

  it('refuses a mark the gap puts out of reach instead of moving the other thumb', () => {
    const changes: number[][] = [];
    const { slider, thumbs } = setup({
      defaultValue: [25, 50],
      marks: [0, 25, 50, 75, 100],
      snapToMarks: true,
      minStepsBetweenThumbs: 1,
      onValueChange: (value) => {
        changes.push([...value]);
      },
    });

    press(thumbs()[0]!, 'ArrowRight');

    // The next mark is 50 and the gap keeps this thumb at 49, which is not a
    // mark at all. Writing 49 and re-quantising it on read reported [50, 51]
    // over a signal holding [49, 50]: a value the slider never submits, and an
    // upper thumb that moved on its own because the lower one was shoved into
    // it. 25 is the only mark this thumb can reach, and it is already there.
    expect(slider.values()).toEqual([25, 50]);
    expect(changes).toEqual([]);
  });

  it('reports the value the signal beside it is holding, gap and marks and all', () => {
    const value = new Signal.State<readonly number[]>([25, 50]);
    const { slider, thumbs } = setup({
      value,
      marks: [0, 25, 50, 75, 100],
      snapToMarks: true,
      minStepsBetweenThumbs: 1,
    });

    press(thumbs()[0]!, 'ArrowRight');
    flushSync();

    // What a form submits is the signal, and what the interface shows is
    // `values()`. The two disagreeing is the defect whichever of them is right.
    expect(slider.values()).toEqual(value.get());
  });

  it('walks a blocked thumb up to the last mark that fits in front of it', () => {
    const { slider, thumbs } = setup({
      defaultValue: [0, 50],
      marks: [0, 25, 50, 75, 100],
      snapToMarks: true,
      minStepsBetweenThumbs: 1,
    });

    // Dragged past its neighbour: 49 is where the gap stops it and 25 is the
    // last mark before that, so the thumb goes as far as the grid allows
    // rather than parking between two marks.
    slider.setValue(0, 100);
    flushSync();
    expect(slider.values()).toEqual([25, 50]);
  });
});

// ---------------------------------------------------------------------------
// Slider: the hidden mirrors
// ---------------------------------------------------------------------------

describe('slider: the hidden mirrors', () => {
  it('keeps one native input per thumb, out of the tab order and out of the tree', () => {
    const { mirrors } = setup({ defaultValue: [20, 80], name: 'price' });
    expect(mirrors()).toHaveLength(2);

    for (const input of mirrors()) {
      expect(input.type).toBe('range');
      expect(input.name).toBe('price');
      expect(input.getAttribute('tabindex')).toBe('-1');
      // The thumb carries the role and the tab stop; announcing the mirror as
      // well would announce every thumb twice.
      expect(input.getAttribute('aria-hidden')).toBe('true');
    }
    expect(mirrors().map((input) => input.value)).toEqual(['20', '80']);
  });

  it('submits one entry per thumb', () => {
    const form = document.createElement('form');
    host.append(form);
    build(SLIDER, { defaultValue: [20, 80], name: 'price' }, form);

    // The whole reason the mirrors exist: a range slider submits twice.
    expect(new FormData(form).getAll('price')).toEqual(['20', '80']);
  });

  it('never submits the string "undefined" for an unnamed slider', () => {
    const { mirrors } = setup({ defaultValue: [20] });
    // `name` is a property on an input, so assigning undefined would submit it.
    expect(mirrors()[0]!.name).toBe('');
  });

  it('follows the value as it moves', () => {
    const { thumb, mirrors } = setup({ defaultValue: [20], name: 'price' });
    press(thumb(0), 'ArrowRight');
    expect(mirrors()[0]!.value).toBe('21');
  });

  it('gives the control id of the field to the first mirror only', () => {
    const { slider, mirrors } = setup({ defaultValue: [20, 80] });
    expect(mirrors()[0]!.id).toBe(slider.field.ids().control);
    expect(mirrors()[1]!.id).toBe('');
  });

  it('restores the value the form was reset to', async () => {
    const form = document.createElement('form');
    host.append(form);
    const { slider, thumb, mirrors } = build(SLIDER, { defaultValue: [20], name: 'price' }, form);

    press(thumb(0), 'End');
    expect(slider.value()).toBe(100);

    await browserReset(form);

    expect(slider.value()).toBe(20);
    expect(mirrors()[0]!.value).toBe('20');
  });

  it('stays where it is when the reset is called off', async () => {
    const form = document.createElement('form');
    host.append(form);
    const { slider, thumb, mirrors } = build(SLIDER, { defaultValue: [20], name: 'price' }, form);
    press(thumb(0), 'End');
    form.addEventListener('reset', (event) => event.preventDefault(), true);

    await browserReset(form);

    // Nothing else in the form went back, so a thumb that did would be showing
    // a value the user never agreed to give up.
    expect(slider.value()).toBe(100);
    expect(mirrors()[0]!.value).toBe('100');
  });

  it('puts a disabled slider back on a form reset, thumb and all', async () => {
    const form = document.createElement('form');
    host.append(form);
    const disabled = new Signal.State(false);
    const { slider, thumb, mirrors } = build(
      SLIDER,
      { defaultValue: [20], name: 'price', disabled: () => disabled.get() },
      form,
    );
    press(thumb(0), 'End');
    disabled.set(true);
    flushSync();

    await browserReset(form);

    // The platform puts a disabled control back like any other, so the value
    // has to go back with it — or the moved value is what the slider submits
    // the moment it is enabled again.
    expect(slider.values()).toEqual([20]);
    expect(thumb(0).getAttribute('aria-valuenow')).toBe('20');
    disabled.set(false);
    flushSync();
    expect(mirrors()[0]!.value).toBe('20');
    expect(new FormData(form).getAll('price')).toEqual(['20']);
  });

  it('puts a disabled slider back when its field is reset', () => {
    const disabled = new Signal.State(false);
    const { slider, thumb, mirrors } = setup({
      defaultValue: [20],
      name: 'price',
      disabled: () => disabled.get(),
    });
    press(thumb(0), 'End');
    disabled.set(true);
    flushSync();

    slider.field.reset();
    flushSync();

    expect(slider.values()).toEqual([20]);
    expect(mirrors()[0]!.value).toBe('20');
    expect(slider.field.isDirty()).toBe(false);
  });

  it('still submits the value it shows after a reset that changed nothing', async () => {
    const form = document.createElement('form');
    host.append(form);
    const { slider, mirrors } = build(SLIDER, { defaultValue: [20], name: 'price' }, form);

    await browserReset(form);

    // The platform resets every control to its own default, and the mirror's
    // default is empty because the value is written as a property and never as
    // an attribute. The slider still says 20, so a submit now sends something
    // the user never chose.
    expect(slider.value()).toBe(20);
    expect(mirrors()[0]!.value).toBe('20');
    expect(new FormData(form).getAll('price')).toEqual(['20']);
  });
});

// ---------------------------------------------------------------------------
// Slider: dirtiness
// ---------------------------------------------------------------------------

describe('slider: dirtiness', () => {
  it('goes dirty on the first move and clean again back at the default', () => {
    const { slider, thumb, root } = setup({ defaultValue: [20], name: 'price' });
    expect(slider.field.isDirty()).toBe(false);
    expect(root.hasAttribute('data-dirty')).toBe(false);

    // The gesture is the edit, so the field has to be told about the value the
    // gesture produced rather than the one the mirror was still showing.
    press(thumb(0), 'ArrowRight');
    expect(slider.value()).toBe(21);
    expect(slider.field.isDirty()).toBe(true);
    expect(root.getAttribute('data-dirty')).toBe('');

    // Dirty means "differs from what a reset would restore", so coming back to
    // the default is coming back to clean — an unsaved-changes guard built on
    // this must stop asking.
    press(thumb(0), 'ArrowLeft');
    expect(slider.value()).toBe(20);
    expect(slider.field.isDirty()).toBe(false);
    expect(root.hasAttribute('data-dirty')).toBe(false);
  });

  it('goes dirty from a press on the track', () => {
    const { slider, root, track } = setup({ defaultValue: [20], name: 'price' });

    pointerDown(track, { clientX: 100 });
    pointerUp();
    expect(slider.value()).toBe(50);
    expect(slider.field.isDirty()).toBe(true);
    expect(root.getAttribute('data-dirty')).toBe('');

    // A press that lands back on the default is as much a way home as the
    // keyboard is.
    pointerDown(track, { clientX: 40 });
    pointerUp();
    expect(slider.value()).toBe(20);
    expect(slider.field.isDirty()).toBe(false);
    expect(root.hasAttribute('data-dirty')).toBe(false);
  });

  it('goes dirty when the value is set through the API', () => {
    const { slider } = setup({ defaultValue: [20], name: 'price' });

    slider.setValues([60]);
    flushSync();
    expect(slider.field.isDirty()).toBe(true);

    slider.setValue(0, 20);
    flushSync();
    expect(slider.field.isDirty()).toBe(false);
  });

  it('follows a value driven from the signal it was given', () => {
    const value = new Signal.State<readonly number[]>([30]);
    const { slider, root } = setup({ value, name: 'price' });

    // A controlled slider never goes through a gesture at all, and the field
    // would otherwise report a form nobody has touched as clean while it
    // submits something else.
    value.set([70]);
    flushSync();
    expect(slider.field.isDirty()).toBe(true);
    expect(root.getAttribute('data-dirty')).toBe('');

    value.set([30]);
    flushSync();
    expect(slider.field.isDirty()).toBe(false);
  });

  it('measures dirtiness against the value a reset restores', async () => {
    const form = document.createElement('form');
    host.append(form);
    const { slider, thumb, mirrors } = build(
      SLIDER,
      { defaultValue: [20], min: 10, max: 30, step: 5, name: 'price' },
      form,
    );

    // The mirror's own default is what the field compares against, so a slider
    // whose bounds put the default nowhere near the midpoint is where a stale
    // comparison shows up as the wrong answer rather than the right one by
    // luck.
    expect(mirrors()[0]!.defaultValue).toBe('20');

    press(thumb(0), 'ArrowRight');
    expect(slider.value()).toBe(25);
    expect(slider.field.isDirty()).toBe(true);

    await browserReset(form);

    expect(slider.value()).toBe(20);
    expect(slider.field.isDirty()).toBe(false);
  });

  it('counts every thumb of a range, not only the one the field validates', () => {
    const { slider, thumb, root, mirrors } = setup({ defaultValue: [20, 80], name: 'price' });
    // Every mirror carries a default of its own, but the field reads the first
    // one alone — so a range whose upper thumb moved is where dirtiness taken
    // from a single control claims there is nothing to save.
    expect(mirrors().map((mirror) => mirror.defaultValue)).toEqual(['20', '80']);

    press(thumb(1), 'ArrowRight');
    expect(slider.values()).toEqual([20, 81]);
    expect(slider.field.isDirty()).toBe(true);
    expect(root.getAttribute('data-dirty')).toBe('');
    // Every surface the field publishes dirtiness on says the same thing. The
    // control's own record is the first thumb's mirror, which has not moved,
    // so this is where a prop object left reading it disagrees with the field.
    expect(slider.field.controlProps()['data-dirty']).toBe(true);

    // The first thumb back where it started, with the second still moved: the
    // control the field validates now reads its default again, and the slider
    // still holds a value a reset would change.
    press(thumb(0), 'ArrowRight');
    press(thumb(0), 'ArrowLeft');
    expect(slider.values()).toEqual([20, 81]);
    expect(slider.field.isDirty()).toBe(true);

    press(thumb(1), 'ArrowLeft');
    expect(slider.values()).toEqual([20, 80]);
    expect(slider.field.isDirty()).toBe(false);
    expect(root.hasAttribute('data-dirty')).toBe(false);
  });

  it('counts a value the mirror was given by something other than the slider', () => {
    const form = document.createElement('form');
    host.append(form);
    const { slider, root, mirrors } = build(SLIDER, { defaultValue: [20, 80], name: 'price' }, form);

    // A session restore, an autofill or a script writes the control itself
    // rather than going through the slider, and the form goes on to submit a
    // value the user never chose. A guard that only ever hears about the
    // slider's own writes has nothing to say about it.
    //
    // Written to the upper thumb's mirror, which is not the control the field
    // listens to — so the render that follows is the slider's own delegation
    // and nothing else.
    const mirror = mirrors()[1]!;
    mirror.value = '90';
    mirror.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();

    expect(new FormData(form).getAll('price')).toEqual(['20', '90']);
    expect(slider.field.isDirty()).toBe(true);
    expect(root.getAttribute('data-dirty')).toBe('');

    // Not a latch: the next value the slider writes fills the mirrors from
    // itself, so what was written over them is gone with it.
    slider.setValues([20, 30]);
    flushSync();
    slider.setValues([20, 80]);
    flushSync();
    expect(mirrors()[1]!.value).toBe('80');
    expect(slider.field.isDirty()).toBe(false);
    expect(root.hasAttribute('data-dirty')).toBe(false);
  });

  it('counts a restore that announces itself with change alone', () => {
    const form = document.createElement('form');
    host.append(form);
    const { slider, root, mirrors } = build(SLIDER, { defaultValue: [20, 80], name: 'price' }, form);

    // A restored session fires `change` and no `input` in some engines, and on
    // the upper thumb's mirror there is no field listener to cover for a
    // slider that only heard about one of the two.
    const mirror = mirrors()[1]!;
    mirror.value = '90';
    mirror.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();

    expect(slider.field.isDirty()).toBe(true);
    expect(root.getAttribute('data-dirty')).toBe('');
  });

  it('counts a value written straight to a mirror, with no event to announce it', () => {
    const form = document.createElement('form');
    host.append(form);
    const { slider, mirrors } = build(SLIDER, { defaultValue: [20], name: 'price' }, form);

    // A session restore, a page back from the bfcache and an autofill all write
    // the control itself, and some of them fire nothing at all. The form
    // submits what is there whether or not anything announced it, so what is
    // there is what dirtiness is measured over — an answer that waits to be
    // told leaves a restored form calling itself saved.
    mirrors()[0]!.value = '77';

    expect(new FormData(form).getAll('price')).toEqual(['77']);
    expect(slider.field.isDirty()).toBe(true);
    expect(slider.field.fieldProps()['data-dirty']).toBe(true);
  });

  it('counts a silent write to the mirror the field never validates', () => {
    const form = document.createElement('form');
    host.append(form);
    const { slider, mirrors } = build(SLIDER, { defaultValue: [20, 80], name: 'price' }, form);

    // The field validates the first thumb's mirror and no other, so the upper
    // one is where a restore lands with nothing at all watching it.
    mirrors()[1]!.value = '90';

    expect(new FormData(form).getAll('price')).toEqual(['20', '90']);
    expect(slider.field.isDirty()).toBe(true);
    expect(slider.field.fieldProps()['data-dirty']).toBe(true);
  });

  it('puts a restored value on the page as soon as the restore announces itself', () => {
    const form = document.createElement('form');
    host.append(form);
    const { root, mirrors } = build(SLIDER, { defaultValue: [20], name: 'price' }, form);

    mirrors()[0]!.value = '77';
    // Assigning to `value` invalidates nothing, so the rendered attribute can
    // only follow the first thing that does. A page restored from the bfcache
    // fires `pageshow` and nothing else — no input, no change, no navigation.
    window.dispatchEvent(new Event('pageshow'));
    flushSync();

    expect(root.getAttribute('data-dirty')).toBe('');

    // The second restore of a page is worth as much as the first: a page can
    // go back into the bfcache and come out of it again, and an answer that
    // was rendered once and then stopped moving is a stale one.
    mirrors()[0]!.value = '20';
    window.dispatchEvent(new Event('pageshow'));
    flushSync();

    expect(root.hasAttribute('data-dirty')).toBe(false);
  });

  it('moves the thumb to a value written into a mirror, once the write is announced', () => {
    const form = document.createElement('form');
    host.append(form);
    const onValueChange = vi.fn();
    const { slider, thumb, mirrors } = build(
      SLIDER,
      { defaultValue: [20, 80], name: 'price', onValueChange },
      form,
    );

    // A restored session writes the control and says so. A thumb that stayed
    // at 80 would show one value over a form that submits another.
    const mirror = mirrors()[1]!;
    mirror.value = '90';
    mirror.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();

    expect(slider.values()).toEqual([20, 90]);
    expect(thumb(1).getAttribute('aria-valuenow')).toBe('90');
    expect(onValueChange).toHaveBeenLastCalledWith([20, 90]);
    expect(new FormData(form).getAll('price')).toEqual(['20', '90']);

    // And a page back from the bfcache, which announces itself with nothing
    // but `pageshow`.
    mirrors()[0]!.value = '35';
    window.dispatchEvent(new Event('pageshow'));
    flushSync();

    expect(slider.values()).toEqual([35, 90]);
    expect(thumb(0).getAttribute('aria-valuenow')).toBe('35');
  });

  it('takes up a value written into a mirror while it is disabled', () => {
    const form = document.createElement('form');
    host.append(form);
    const { slider, mirrors } = build(
      SLIDER,
      { defaultValue: [20], name: 'price', disabled: () => true },
      form,
    );

    // A restore does not ask whether the control is enabled, and a value left
    // behind in the mirror is the one submitted the moment it is.
    const mirror = mirrors()[0]!;
    mirror.value = '60';
    mirror.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();

    expect(slider.values()).toEqual([60]);
  });

  it('keeps the thumbs in order when a value written into a mirror would cross them', () => {
    const form = document.createElement('form');
    host.append(form);
    const { slider, mirrors } = build(SLIDER, { defaultValue: [20, 20], name: 'price' }, form);

    // Settled like any other value, the upper thumb stays where it is — so
    // nothing the render would rewrite has changed, and the mirror is put
    // right by hand or it goes on submitting a value no thumb shows.
    const mirror = mirrors()[1]!;
    mirror.value = '10';
    mirror.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();

    expect(slider.values()).toEqual([20, 20]);
    expect(new FormData(form).getAll('price')).toEqual(['20', '20']);
    expect(slider.field.isDirty()).toBe(false);
  });

  it('lets a form reset take back a mirror the slider never wrote', async () => {
    const form = document.createElement('form');
    host.append(form);
    const { slider, root, mirrors } = build(SLIDER, { defaultValue: [20], name: 'price' }, form);

    const mirror = mirrors()[0]!;
    mirror.value = '77';
    mirror.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(slider.field.isDirty()).toBe(true);
    expect(root.hasAttribute('data-dirty')).toBe(true);

    // The platform puts every mirror back to the `value` attribute the slider
    // wrote, so the reset is what ends the drift — the slider itself has no
    // value to rewrite them with, being on its default throughout.
    await browserReset(form);
    expect(mirrors()[0]!.value).toBe('20');
    expect(slider.field.isDirty()).toBe(false);
    // And what is rendered says so too, although the platform announces
    // nothing when it puts a mirror back.
    expect(root.hasAttribute('data-dirty')).toBe(false);
  });

  it('clears a mirror it never wrote when the field is reset', () => {
    const form = document.createElement('form');
    host.append(form);
    const { slider, root, mirrors } = build(SLIDER, { defaultValue: [20], name: 'price' }, form);

    const mirror = mirrors()[0]!;
    mirror.value = '77';
    mirror.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(slider.field.isDirty()).toBe(true);

    // `reset` clears what the field has recorded, and a form that was
    // autofilled once could otherwise never be called saved again. Clearing a
    // flag would not have been enough: the mirror is what a submit reads, so a
    // field that says it is clean has to have put the mirror back first.
    slider.field.reset();
    flushSync();
    expect(mirrors()[0]!.value).toBe('20');
    expect(new FormData(form).getAll('price')).toEqual(['20']);
    expect(slider.field.isDirty()).toBe(false);
    expect(root.hasAttribute('data-dirty')).toBe(false);
  });

  it('puts a moved slider back when the field is reset', () => {
    const form = document.createElement('form');
    host.append(form);
    const { slider, root, thumb, mirrors } = build(
      SLIDER,
      { defaultValue: [20], name: 'price' },
      form,
    );

    press(thumb(0), 'ArrowRight');
    expect(slider.value()).toBe(21);

    // The mirrors are half of what a reset has to put back and the value is
    // the other half. Putting back only the mirrors leaves the thumb showing
    // 21 over a form submitting 20 — the defect this model exists to answer,
    // with the two halves swapped over.
    slider.field.reset();
    flushSync();

    expect(slider.values()).toEqual([20]);
    expect(thumb(0).getAttribute('aria-valuenow')).toBe('20');
    expect(mirrors()[0]!.value).toBe('20');
    expect(new FormData(form).getAll('price')).toEqual(['20']);
    expect(slider.field.isDirty()).toBe(false);
    expect(root.hasAttribute('data-dirty')).toBe(false);
  });

  it('answers for the submit, not the thumb, when a restore writes the default', () => {
    const form = document.createElement('form');
    host.append(form);
    const { slider, thumb, mirrors } = build(SLIDER, { defaultValue: [20], name: 'price' }, form);

    press(thumb(0), 'ArrowRight');
    // A restore landing on the default over a slider the user has moved is
    // where the two halves disagree most sharply: the thumb says 21 and the
    // form would send 20. Dirty asks whether a reset would change the submit,
    // and it would not — the thumb left standing at 21 is the limit of a model
    // that will not move the value on the user's behalf, not a wrong answer
    // about the form.
    mirrors()[0]!.value = '20';

    expect(slider.values()).toEqual([21]);
    expect(new FormData(form).getAll('price')).toEqual(['20']);
    expect(slider.field.isDirty()).toBe(false);
  });

  it('is clean at the default even when the mirrors arrive after the first render', () => {
    const { slider, root, thumb, mirrors, reveal } = build(LATE_MIRRORS, {
      defaultValue: [20],
      name: 'price',
    });

    // The control the field found at mount was the root itself, which has no
    // value and no default of its own — so an answer that leans on the field's
    // own comparison latches on the first move and never comes back.
    reveal();
    expect(mirrors()[0]!.value).toBe('20');
    expect(slider.field.isDirty()).toBe(false);

    press(thumb(0), 'ArrowRight');
    expect(slider.field.isDirty()).toBe(true);

    press(thumb(0), 'ArrowLeft');
    expect(slider.values()).toEqual([20]);
    expect(slider.field.isDirty()).toBe(false);
    expect(root.hasAttribute('data-dirty')).toBe(false);
  });

  it('answers in the same tick as the gesture, in both directions', () => {
    const { slider, thumb } = setup({ defaultValue: [20], name: 'price' });
    const arrow = (key: string) =>
      thumb(0).dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
      );

    // Nothing is flushed in between: a handler that reads both halves of the
    // slider's own API must not be told the value moved and the form is
    // untouched.
    arrow('ArrowRight');
    expect(slider.value()).toBe(21);
    expect(slider.field.isDirty()).toBe(true);
    expect(slider.field.fieldProps()['data-dirty']).toBe(true);
    flushSync();

    // The way home is the half that an answer taken from the control gets
    // wrong: the mirror still holds the value this gesture has just replaced,
    // so a Save button driven from here stays lit over a form at its default.
    arrow('ArrowLeft');
    expect(slider.value()).toBe(20);
    expect(slider.field.isDirty()).toBe(false);
    expect(slider.field.fieldProps()['data-dirty']).toBeUndefined();
    flushSync();
  });

  it('answers in the same tick as a drag', () => {
    const { slider, track } = setup({ defaultValue: [20], name: 'price' });

    pointerDown(track, { clientX: 100 });
    expect(slider.value()).toBe(50);
    expect(slider.field.isDirty()).toBe(true);

    // A drag reports every move, and a move that passes back over the default
    // is where the answer has to change with it rather than a frame later.
    document.dispatchEvent(
      new PointerEvent('pointermove', { bubbles: true, pointerId: 1, clientX: 40 }),
    );
    expect(slider.value()).toBe(20);
    expect(slider.field.isDirty()).toBe(false);
    pointerUp();
  });

  it('answers in the same tick as a value set through the API', () => {
    const { slider } = setup({ defaultValue: [20], name: 'price' });

    slider.setValues([90]);
    expect(slider.values()).toEqual([90]);
    expect(slider.field.isDirty()).toBe(true);
    expect(slider.field.fieldProps()['data-dirty']).toBe(true);
    flushSync();

    slider.setValues([20]);
    expect(slider.values()).toEqual([20]);
    expect(slider.field.isDirty()).toBe(false);
    expect(slider.field.fieldProps()['data-dirty']).toBeUndefined();
    flushSync();
  });

  it('answers in the same tick as a write to the signal it was given', () => {
    const value = new Signal.State<readonly number[]>([30]);
    const { slider } = setup({ value, name: 'price' });

    value.set([70]);
    expect(slider.field.isDirty()).toBe(true);
    flushSync();

    value.set([30]);
    expect(slider.field.isDirty()).toBe(false);
    flushSync();
  });

  it('tells a value-change listener what it tells the form', () => {
    const seen: [readonly number[], boolean][] = [];
    const { slider, thumb } = setup({
      defaultValue: [20],
      name: 'price',
      onValueChange: (values) => seen.push([values, slider.field.isDirty()]),
    });

    // The callback runs from inside the write, which is the earliest anything
    // outside can ask — and the answer it gets is the one a consumer's
    // unsaved-changes guard is built on.
    press(thumb(0), 'ArrowRight');
    press(thumb(0), 'ArrowLeft');
    expect(seen).toEqual([
      [[21], true],
      [[20], false],
    ]);
  });
});

// ---------------------------------------------------------------------------
// Slider: validation
// ---------------------------------------------------------------------------

describe('slider: validation', () => {
  it('records the value the mirror settled on, not the one it replaced', () => {
    const { slider, thumb } = setup({ defaultValue: [20], name: 'price' });

    // The field reads its record from the control, and the control is a mirror
    // the consumer's template fills — so a field told about the edit before
    // that has happened records the value the gesture replaced, for ever.
    press(thumb(0), 'ArrowRight');
    expect(slider.value()).toBe(21);
    expect(slider.field.value()).toBe('21');
  });

  it('revalidates as the thumb moves, once validation has run', async () => {
    const harness = build(DESCRIBED, {
      defaultValue: [20],
      validate: (values) => ((values[0] ?? 0) > 50 ? 'Too expensive' : null),
    });

    expect(await harness.slider.field.validate()).toBe(true);
    flushSync();

    // Nothing asks again: the edit is the trigger. A field that has to be
    // asked leaves a verdict on screen about a value the user has already
    // corrected.
    press(harness.thumb(0), 'End');
    expect(harness.slider.field.messages()).toEqual(['Too expensive']);
    expect(harness.thumb(0).getAttribute('aria-invalid')).toBe('true');

    press(harness.thumb(0), 'Home');
    expect(harness.slider.field.messages()).toEqual([]);
    expect(harness.thumb(0).hasAttribute('aria-invalid')).toBe(false);
  });

  it('revalidates a value driven from the signal it was given', async () => {
    const value = new Signal.State<readonly number[]>([80]);
    const harness = build(DESCRIBED, {
      value,
      validate: (values) => ((values[0] ?? 0) > 50 ? 'Too expensive' : null),
    });

    expect(await harness.slider.field.validate()).toBe(false);
    flushSync();
    expect(harness.slider.field.messages()).toEqual(['Too expensive']);

    // A controlled slider is moved by writing the signal, which calls no method
    // of the slider's — so a field told about edits from the setters alone
    // never hears that the value it refused is gone.
    value.set([10]);
    flushSync();
    expect(harness.slider.field.isValid()).toBe(true);
    expect(harness.slider.field.messages()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Upload harness
// ---------------------------------------------------------------------------

const UPLOAD = `
  <div class="upload" :spread="upload.rootProps()">
    <span class="label" :ref="label" :spread="upload.labelProps()">Attachments</span>
    <div class="zone" :ref="zone" :spread="upload.dropZoneProps()"
         :dragenter="upload.onDragEnter($event)"
         :dragover="upload.onDragOver($event)"
         :dragleave="upload.onDragLeave($event)"
         :drop="upload.onDrop($event)"
         :keydown="onKey($event)">
      <span class="inner">Drop files here</span>
    </div>
    <input class="picker" :ref="input" :spread="upload.inputProps()"
           :change="upload.onInputChange($event)">
    <button class="trigger" :spread="upload.triggerProps()">Browse</button>
    <div class="bar" :spread="upload.progressProps()"></div>
    <ul>
      <li class="item" :for="entry of upload.items()" :key="entry.id"
          :spread="upload.itemProps(entry)">
        <span class="item-bar" :spread="upload.itemProgressProps(entry)"></span>
        <button class="cancel" :spread="upload.cancelProps(entry)"></button>
        <button class="retry" :spread="upload.retryProps(entry)"></button>
        <button class="remove" :spread="upload.removeProps(entry)"></button>
      </li>
    </ul>
    <p class="hint" :ref="hint" :spread="upload.descriptionProps()">Images only</p>
    <div class="live" :ref="live" :spread="upload.liveRegionProps()">{ upload.announcement() }</div>
  </div>
`;

/** The same upload with no drop zone and no live region wired up. */
const PLAIN_UPLOAD = `
  <div class="upload" :spread="upload.rootProps()">
    <input class="picker" :ref="input" :spread="upload.inputProps()"
           :change="upload.onInputChange($event)">
    <div class="live" :spread="upload.liveRegionProps()">{ upload.announcement() }</div>
  </div>
`;

/** One in-flight request, held open so a test can decide how it ends. */
interface Sent {
  readonly request: UploadRequest;
  resolve(value?: unknown): void;
  reject(error?: unknown): void;
  aborted: boolean;
}

let sent: Sent[] = [];

/** A transport that goes nowhere and honours its signal, as a real one must. */
function heldTransport(): UploadTransport {
  return (request) =>
    new Promise<unknown>((resolve, reject) => {
      const entry: Sent = { request, resolve, reject, aborted: false };
      sent.push(entry);
      request.signal.addEventListener('abort', () => {
        entry.aborted = true;
        reject(new Error('Upload cancelled'));
      });
    });
}

const requestsFor = (name: string): Sent[] => sent.filter((one) => one.request.file.name === name);
const lastFor = (name: string): Sent => requestsFor(name).at(-1)!;

function file(name: string, size = 100, type = 'image/png'): File {
  return new File([new Uint8Array(size)], name, { type });
}

/** Let the promise chain and the scheduler catch up, as async.test.ts does. */
async function settle(turns = 8): Promise<void> {
  for (let i = 0; i < turns; i++) {
    await Promise.resolve();
    flushSync();
  }
}

/**
 * Fake only the clock: Volt's scheduler runs on `queueMicrotask`, and faking
 * that stops every effect in the library.
 */
function useClock(): void {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
}

async function advance(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
  await settle();
}

type UploadOptions = Omit<
  FileUploadOptions,
  'input' | 'dropZone' | 'liveRegion' | 'label' | 'description' | 'errorMessage'
>;

interface UploadHarness {
  upload: FileUpload;
  root: HTMLElement;
  zone: HTMLElement;
  picker: HTMLInputElement;
  live: HTMLElement;
  /** The rendered row for one queued file. */
  item(index: number): HTMLElement;
  handled(): boolean;
  unmount(): void;
}

function buildUpload(
  options: UploadOptions = {},
  template = UPLOAD,
  parent: HTMLElement = host,
): UploadHarness {
  @Component({ selector: `v-upload-${++selectors}`, render: compileTemplate(template) })
  class UploadComponent {
    input = new Signal.State<Element | null>(null);
    zone = new Signal.State<Element | null>(null);
    live = new Signal.State<Element | null>(null);
    label = new Signal.State<Element | null>(null);
    hint = new Signal.State<Element | null>(null);
    lastHandled = false;
    // The plain template deliberately wires neither a drop zone nor a live
    // region, which is a shape the component supports and has to survive.
    upload: FileUpload = createFileUpload(
      template === UPLOAD
        ? {
            ...options,
            input: () => this.input.get(),
            dropZone: () => this.zone.get(),
            liveRegion: () => this.live.get(),
            label: () => this.label.get(),
            description: () => this.hint.get(),
          }
        : { ...options, input: () => this.input.get() },
    );

    onKey(event: KeyboardEvent): void {
      this.lastHandled = this.upload.onKeyDown(event);
    }
  }

  const handle = mount(UploadComponent, parent);
  mounted.push(handle);
  flushSync();
  const instance = handle.instance as UploadComponent;

  return {
    upload: instance.upload,
    root: parent.querySelector<HTMLElement>('.upload')!,
    zone: parent.querySelector<HTMLElement>('.zone')!,
    picker: parent.querySelector<HTMLInputElement>('.picker')!,
    live: parent.querySelector<HTMLElement>('.live')!,
    item: (index) => parent.querySelectorAll<HTMLElement>('.item')[index]!,
    handled: () => instance.lastHandled,
    unmount: () => handle.unmount(),
  };
}

/**
 * A drag carrying files.
 *
 * happy-dom's `DataTransfer` reports each item's own MIME type in `types`, where
 * a real file drag reports the `'Files'` marker the component looks for — so
 * this plain object stands in for one, carrying exactly the fields the handlers
 * read.
 */
function dragEvent(
  type: string,
  files: readonly File[],
  types = ['Files'],
  items: readonly DataTransferItem[] = [],
): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', {
    value: { types, files, items, dropEffect: 'none' },
  });
  return event;
}

/**
 * A dropped directory tree.
 *
 * `FileSystemEntry` is the callback API a drop exposes, and no engine happy-dom
 * runs implements it — so the tree is built here out of the four members the
 * walk actually reads. `readEntries` answers once with the batch and then with
 * nothing, because an empty result is the only end-of-list the real reader has.
 */
function fileEntry(one: File): FileSystemEntry {
  return {
    isFile: true,
    isDirectory: false,
    file: (ok: (value: File) => void) => ok(one),
  } as unknown as FileSystemEntry;
}

function directoryEntry(children: readonly FileSystemEntry[]): FileSystemEntry {
  return {
    isFile: false,
    isDirectory: true,
    createReader: () => {
      let read = false;
      return {
        readEntries: (ok: (batch: readonly FileSystemEntry[]) => void) => {
          // Flipped before answering, not after: the reader is called again
          // from inside its own callback, and a flag set afterwards is still
          // false when the second call reads it.
          const batch = read ? [] : children;
          read = true;
          ok(batch);
        },
      };
    },
  } as unknown as FileSystemEntry;
}

/** A dragged item that exposes an entry, which is how a folder arrives. */
const entryItem = (entry: FileSystemEntry): DataTransferItem =>
  ({ kind: 'file', webkitGetAsEntry: () => entry }) as unknown as DataTransferItem;

function dispatch(el: EventTarget, event: Event): Event {
  el.dispatchEvent(event);
  flushSync();
  return event;
}

/**
 * A paste carrying files. `ClipboardEvent` needs the same stand-in.
 *
 * `items` is carried separately because the engines that put a screenshot there
 * leave `files` empty, and that split is the whole reason the handler reads
 * both.
 */
function pasteEvent(files: readonly File[], items: readonly DataTransferItem[] = []): Event {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: { files, items } });
  return event;
}

/** One clipboard entry, carrying only the two members the handler reads. */
const clipboardItem = (kind: string, value: File | null): DataTransferItem =>
  ({ kind, getAsFile: () => value }) as unknown as DataTransferItem;

/**
 * What the picker hands back.
 *
 * Through a real `DataTransfer` rather than by redefining `files`, because the
 * component writes that list as well as reading it — a stubbed property would
 * be read-only and would hide the very thing under test, which is that the
 * files the user chose stay on the input.
 */
function pick(input: HTMLInputElement, files: readonly File[]): void {
  const data = new DataTransfer();
  for (const one of files) data.items.add(one);
  input.files = data.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  flushSync();
}

/** The names the input would submit, which is not the same as the queue. */
const picked = (input: HTMLInputElement): string[] =>
  [...(input.files ?? [])].map((one) => one.name);

const statuses = (upload: FileUpload): string[] => upload.items().map((entry) => entry.status);
const codes = (upload: FileUpload): (string | undefined)[] =>
  upload.items().map((entry) => entry.error?.code);

/** Requests are collected across a whole test, so they start empty in each. */
beforeEach(() => {
  sent = [];
});

// ---------------------------------------------------------------------------
// Upload: the queue
// ---------------------------------------------------------------------------

describe('upload: the queue', () => {
  it('takes files, sends them, and reports what came back', async () => {
    const onItemComplete = vi.fn();
    const { upload } = buildUpload({ transport: heldTransport(), onItemComplete });

    upload.add([file('a.png')]);
    flushSync();
    expect(statuses(upload)).toEqual(['uploading']);
    expect(requestsFor('a.png')).toHaveLength(1);

    lastFor('a.png').resolve({ id: 'remote-1' });
    await settle();

    const [item] = upload.items();
    expect(item!.status).toBe('success');
    expect(item!.progress).toBe(100);
    expect(item!.response).toEqual({ id: 'remote-1' });
    expect(onItemComplete).toHaveBeenCalledTimes(1);
  });

  it('is only a queue without a transport', () => {
    const { upload } = buildUpload({});
    upload.add([file('a.png')]);
    flushSync();
    // Which is what a form that submits its files through the input itself
    // wants: a list to show, and nothing sent.
    expect(statuses(upload)).toEqual(['pending']);
  });

  it('waits to be told when it is not automatic', async () => {
    const { upload } = buildUpload({ transport: heldTransport(), auto: false });
    upload.add([file('a.png')]);
    flushSync();
    expect(sent).toHaveLength(0);

    upload.upload();
    await settle();
    expect(sent).toHaveLength(1);
  });

  it('sends three at a time and starts the next as one finishes', async () => {
    const { upload } = buildUpload({ transport: heldTransport() });
    upload.add(['a', 'b', 'c', 'd'].map((name) => file(`${name}.png`)));
    await settle();

    expect(sent).toHaveLength(3);
    expect(statuses(upload)).toEqual(['uploading', 'uploading', 'uploading', 'pending']);

    lastFor('a.png').resolve();
    await settle();
    expect(requestsFor('d.png')).toHaveLength(1);
    expect(statuses(upload)).toEqual(['success', 'uploading', 'uploading', 'uploading']);
  });

  it('sends one at a time when told to', async () => {
    const { upload } = buildUpload({ transport: heldTransport(), concurrency: 1 });
    upload.add([file('a.png'), file('b.png')]);
    await settle();
    expect(sent).toHaveLength(1);
  });

  it('counts the queue by state', async () => {
    const { upload } = buildUpload({ transport: heldTransport(), accept: 'image/*' });
    upload.add([file('a.png'), file('b.txt', 100, 'text/plain')]);
    await settle();
    expect(upload.counts()).toEqual({
      pending: 0,
      uploading: 1,
      success: 0,
      error: 0,
      cancelled: 0,
      rejected: 1,
    });
  });

  it('drops a file from the queue on request, and stops it going up', async () => {
    const { upload } = buildUpload({ transport: heldTransport() });
    const [item] = upload.add([file('a.png')]);
    await settle();

    upload.remove(item!.id);
    await settle();
    expect(upload.items()).toHaveLength(0);
    expect(lastFor('a.png').aborted).toBe(true);
  });

  it('keeps one file only when only one may be chosen', () => {
    const { upload, picker } = buildUpload({ multiple: false });
    upload.add([file('a.png'), file('b.png')]);
    flushSync();

    // The input it stands for holds one file; a queue of two under a control
    // that submits one of them is a lie about what will be sent.
    expect(upload.items().map((entry) => entry.file.name)).toEqual(['a.png']);
    expect(picker.multiple).toBe(false);

    upload.add([file('c.png')]);
    flushSync();
    expect(upload.items().map((entry) => entry.file.name)).toEqual(['c.png']);
  });

  it('stops the upload of a file it replaces', async () => {
    const harness = buildUpload({ transport: heldTransport(), multiple: false });
    harness.upload.add([file('a.png')]);
    await settle();
    expect(requestsFor('a.png')).toHaveLength(1);

    harness.upload.add([file('b.png')]);
    await settle();

    // The replaced file is out of the queue and out of the list, so nothing can
    // reach it to cancel it — and it goes on holding a concurrency slot and
    // sending bytes for a file the user has changed their mind about.
    expect(lastFor('a.png').aborted).toBe(true);
  });

  it('hands back everything it was given, refusals included', async () => {
    const onFilesAdded = vi.fn();
    const { upload } = buildUpload({ accept: 'image/*', onFilesAdded });
    const added = upload.add([file('a.png'), file('notes.txt', 10, 'text/plain')]);
    await settle();

    // The refusals come back with the rest, so a consumer can show them in one
    // place rather than discovering them in the queue afterwards.
    expect(added.map((entry) => entry.status)).toEqual(['pending', 'rejected']);
    expect(onFilesAdded).toHaveBeenCalledWith(added);
    expect(upload.item(added[0]!.id)).toEqual(added[0]);
  });

  it('changes nothing when it is handed no files', async () => {
    const harness = buildUpload({ multiple: false, transport: heldTransport() });
    harness.upload.add([file('a.png')]);
    await settle();

    // A single-file upload replaces what it holds, so an empty add that gets
    // as far as the replacing throws the file away and puts nothing in its
    // place — the one caller that can pass nothing is the consumer's own.
    expect(harness.upload.add([])).toEqual([]);
    await settle();
    expect(harness.upload.items().map((entry) => entry.file.name)).toEqual(['a.png']);
  });
});

// ---------------------------------------------------------------------------
// Upload: progress
// ---------------------------------------------------------------------------

describe('upload: progress', () => {
  it('reports no progress for a queue with no bytes in it', async () => {
    const harness = buildUpload({ transport: heldTransport() });
    // An empty queue has nothing to be finished with. Asking `every` about no
    // files answers yes, which is how an upload holding nothing reports itself
    // complete.
    expect(harness.upload.progress()).toBe(0);

    // Zero-byte files are the case the same branch exists for, and they are
    // finished only once they have actually been sent.
    harness.upload.add([file('empty.txt', 0, 'text/plain')]);
    await settle();
    expect(harness.upload.progress()).toBe(0);

    lastFor('empty.txt').resolve();
    await settle();
    expect(harness.upload.progress()).toBe(100);
  });

  it('reports the progress of one file as bytes arrive', async () => {
    const onItemProgress = vi.fn();
    const harness = buildUpload({ transport: heldTransport(), onItemProgress });
    harness.upload.add([file('a.png', 100)]);
    await settle();

    lastFor('a.png').request.progress(40);
    flushSync();

    expect(harness.upload.items()[0]!.loaded).toBe(40);
    expect(harness.upload.items()[0]!.progress).toBe(40);
    expect(harness.item(0).getAttribute('data-progress')).toBe('40');
    expect(onItemProgress).toHaveBeenCalled();
  });

  it('gives each file its own progress bar', async () => {
    const harness = buildUpload({ transport: heldTransport() });
    harness.upload.add([file('a.png', 100), file('b.png', 100)]);
    await settle();

    lastFor('a.png').request.progress(25);
    flushSync();

    const bars = [...host.querySelectorAll('.item-bar')];
    expect(bars[0]!.getAttribute('role')).toBe('progressbar');
    expect(bars[0]!.getAttribute('aria-valuenow')).toBe('25');
    expect(bars[0]!.getAttribute('aria-label')).toBe('Uploading a.png');
    // The other file's bar must not move because this one did.
    expect(bars[1]!.getAttribute('aria-valuenow')).toBe('0');
  });

  it('adds the files up by bytes rather than by count', async () => {
    const harness = buildUpload({ transport: heldTransport() });
    harness.upload.add([file('small.png', 100), file('big.png', 300)]);
    await settle();

    lastFor('small.png').request.progress(100);
    flushSync();

    // A hundred of four hundred bytes: a file count would have said fifty.
    expect(harness.upload.loadedBytes()).toBe(100);
    expect(harness.upload.totalBytes()).toBe(400);
    expect(harness.upload.progress()).toBe(25);
    expect(host.querySelector('.bar')!.getAttribute('aria-valuenow')).toBe('25');
  });

  it('leaves refused and cancelled files out of the total', async () => {
    const harness = buildUpload({ transport: heldTransport(), maxSize: 150 });
    harness.upload.add([file('ok.png', 100), file('huge.png', 500)]);
    await settle();

    // The refused file was never going to be sent, so counting its bytes would
    // pin the bar below a hundred for ever.
    expect(harness.upload.totalBytes()).toBe(100);

    lastFor('ok.png').resolve();
    await settle();
    expect(harness.upload.progress()).toBe(100);
  });

  it('finishes the bar for a file with no bytes in it', async () => {
    const harness = buildUpload({ transport: heldTransport() });
    harness.upload.add([file('empty.png', 0)]);
    await settle();
    expect(harness.upload.items()[0]!.progress).toBe(0);

    lastFor('empty.png').resolve();
    await settle();
    // Anything but a hundred leaves an empty file's bar short of the end for
    // ever, because there is no ratio to report.
    expect(harness.upload.items()[0]!.progress).toBe(100);
    expect(harness.upload.progress()).toBe(100);
  });

  it('knows while it is busy', async () => {
    const harness = buildUpload({ transport: heldTransport() });
    harness.upload.add([file('a.png')]);
    await settle();
    expect(harness.upload.isUploading()).toBe(true);
    expect(harness.root.getAttribute('data-uploading')).toBe('');

    lastFor('a.png').resolve();
    await settle();
    expect(harness.upload.isUploading()).toBe(false);
  });

  it('stops saying it is busy when the last file in flight is removed', async () => {
    const harness = buildUpload({ transport: heldTransport() });
    const [only] = harness.upload.add([file('a.png')]);
    await settle();
    expect(harness.root.getAttribute('data-uploading')).toBe('');

    harness.upload.remove(only!.id);
    await settle();

    // The queue is empty and the request it was for has been aborted. The count
    // of requests in flight is the only thing that still says otherwise, and a
    // rendered attribute reading a number nothing announces goes on saying an
    // upload is in progress for the life of the page.
    expect(harness.upload.items()).toHaveLength(0);
    expect(harness.upload.isUploading()).toBe(false);
    expect(harness.root.getAttribute('data-uploading')).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// Upload: cancel, retry and failure
// ---------------------------------------------------------------------------

describe('upload: cancel, retry and failure', () => {
  it('cancels a file in flight without calling it a failure', async () => {
    const harness = buildUpload({ transport: heldTransport() });
    const [item] = harness.upload.add([file('a.png', 100)]);
    await settle();
    lastFor('a.png').request.progress(60);
    flushSync();

    harness.upload.cancel(item!.id);
    await settle();

    expect(lastFor('a.png').aborted).toBe(true);
    expect(harness.upload.items()[0]!.status).toBe('cancelled');
    // Not an error, and the bytes already sent are kept: a chunked upload
    // resumes from them.
    expect(harness.upload.items()[0]!.error).toBeNull();
    expect(harness.upload.items()[0]!.loaded).toBe(60);
  });

  it('cancels a file that never started', async () => {
    const harness = buildUpload({ transport: heldTransport(), concurrency: 1 });
    const [, second] = harness.upload.add([file('a.png'), file('b.png')]);
    await settle();

    harness.upload.cancel(second!.id);
    await settle();
    expect(statuses(harness.upload)).toEqual(['uploading', 'cancelled']);
    expect(requestsFor('b.png')).toHaveLength(0);
  });

  it('cancels everything at once', async () => {
    const harness = buildUpload({ transport: heldTransport() });
    harness.upload.add([file('a.png'), file('b.png')]);
    await settle();

    harness.upload.cancelAll();
    await settle();
    expect(statuses(harness.upload)).toEqual(['cancelled', 'cancelled']);
  });

  it('records a failure against the file, with a reason', async () => {
    const onItemError = vi.fn();
    const harness = buildUpload({ transport: heldTransport(), onItemError });
    harness.upload.add([file('a.png')]);
    await settle();

    lastFor('a.png').reject(new Error('Upload failed with status 500'));
    await settle();

    const [item] = harness.upload.items();
    expect(item!.status).toBe('error');
    expect(item!.error).toEqual({
      code: 'transport',
      message: 'Upload failed with status 500',
      cause: expect.any(Error),
    });
    expect(onItemError).toHaveBeenCalledTimes(1);
    expect(harness.item(0).getAttribute('data-error')).toBe('transport');
  });

  it('retries by itself, after a wait, as many times as it was allowed', async () => {
    useClock();
    const harness = buildUpload({
      transport: heldTransport(),
      retries: 1,
      retryDelay: () => 1000,
    });
    harness.upload.add([file('a.png')]);
    await settle();

    lastFor('a.png').reject(new Error('boom'));
    await settle();
    // Still the first request: the wait has not passed, and a retry that fired
    // immediately would hit the same overloaded server.
    expect(requestsFor('a.png')).toHaveLength(1);
    expect(harness.upload.items()[0]!.status).toBe('uploading');

    await advance(1000);
    expect(requestsFor('a.png')).toHaveLength(2);
    expect(harness.upload.items()[0]!.attempts).toBe(2);

    lastFor('a.png').reject(new Error('boom'));
    await advance(1000);
    // Two attempts is all it was given, so the second failure is final.
    expect(requestsFor('a.png')).toHaveLength(2);
    expect(harness.upload.items()[0]!.status).toBe('error');
  });

  it('sends a failed file again when asked, and clears the failure', async () => {
    const harness = buildUpload({ transport: heldTransport() });
    const [item] = harness.upload.add([file('a.png')]);
    await settle();
    lastFor('a.png').reject(new Error('boom'));
    await settle();

    harness.upload.retry(item!.id);
    await settle();
    expect(requestsFor('a.png')).toHaveLength(2);
    expect(harness.upload.items()[0]!.error).toBeNull();
    expect(harness.upload.items()[0]!.attempts).toBe(1);

    lastFor('a.png').resolve();
    await settle();
    expect(harness.upload.items()[0]!.status).toBe('success');
  });

  it('retries everything that failed or was stopped, and nothing that was refused', async () => {
    const harness = buildUpload({ transport: heldTransport(), accept: 'image/*' });
    const [, stopped] = harness.upload.add([
      file('a.png'),
      file('b.png'),
      file('c.txt', 100, 'text/plain'),
    ]);
    await settle();

    lastFor('a.png').reject(new Error('boom'));
    harness.upload.cancel(stopped!.id);
    await settle();
    expect(statuses(harness.upload)).toEqual(['error', 'cancelled', 'rejected']);

    harness.upload.retryFailed();
    await settle();
    expect(statuses(harness.upload)).toEqual(['uploading', 'uploading', 'rejected']);
    // A refusal is a fact about the file, not about the request: sending it
    // again would fail in exactly the same way.
    expect(requestsFor('c.txt')).toHaveLength(0);
  });

  it('will not send the same file twice when retry is pressed mid-upload', async () => {
    const harness = buildUpload({ transport: heldTransport() });
    const [item] = harness.upload.add([file('a.png')]);
    await settle();
    expect(requestsFor('a.png')).toHaveLength(1);

    // `retryProps` marks the button `aria-disabled` rather than disabled while
    // an upload is running, and an aria-disabled button still fires its click —
    // so this is one press away in every consumer.
    harness.upload.retry(item!.id);
    await settle();

    const live = requestsFor('a.png').filter((one) => !one.aborted);
    expect(live).toHaveLength(1);

    // And whichever request is live has to remain the one cancel can reach.
    harness.upload.cancel(item!.id);
    await settle();
    expect(requestsFor('a.png').every((one) => one.aborted)).toBe(true);
  });

  it('starts a cancelled file again from the top', async () => {
    const harness = buildUpload({ transport: heldTransport() });
    const [item] = harness.upload.add([file('a.png')]);
    await settle();
    harness.upload.cancel(item!.id);
    await settle();

    harness.upload.uploadItem(item!.id);
    await settle();
    expect(requestsFor('a.png')).toHaveLength(2);
    expect(harness.upload.items()[0]!.status).toBe('uploading');
  });

  it('empties the queue and stops everything in it', async () => {
    const harness = buildUpload({ transport: heldTransport() });
    harness.upload.add([file('a.png'), file('b.png')]);
    await settle();

    harness.upload.clear();
    await settle();
    expect(harness.upload.items()).toHaveLength(0);
    expect(sent.every((one) => one.aborted)).toBe(true);
  });
  it('says something readable whatever the transport threw', async () => {
    const harness = buildUpload({ transport: heldTransport() });
    harness.upload.add([file('a.png'), file('b.png'), file('c.png')]);
    await settle();

    lastFor('a.png').reject('the disk is full');
    lastFor('b.png').reject({ code: 500 });
    lastFor('c.png').reject(new Error(''));
    await settle();

    // A transport is consumer code and may throw anything at all. What reaches
    // the user has to be a sentence either way, and an object rendered into a
    // message reads as "[object Object]".
    expect(harness.upload.items().map((entry) => entry.error?.message)).toEqual([
      'the disk is full',
      'Upload failed',
      'Upload failed',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Upload: refusing a file
// ---------------------------------------------------------------------------

describe('upload: refusing a file', () => {
  it('keeps a refused file in the queue with its own reason', async () => {
    const onReject = vi.fn();
    const harness = buildUpload({ transport: heldTransport(), accept: 'image/*', onReject });
    harness.upload.add([file('notes.txt', 100, 'text/plain')]);
    await settle();

    // A file that silently fails to appear is the worst possible answer to
    // "why isn't my photo uploading".
    const [item] = harness.upload.items();
    expect(item!.status).toBe('rejected');
    expect(item!.error!.code).toBe('type');
    expect(item!.error!.message).toContain('notes.txt');
    expect(sent).toHaveLength(0);
    expect(onReject).toHaveBeenCalledWith(item!.file, item!.error);
  });

  it('gives every file in one drop its own verdict', async () => {
    const harness = buildUpload({
      transport: heldTransport(),
      accept: 'image/*',
      maxSize: 200,
    });
    harness.upload.add([
      file('good.png', 100),
      file('huge.png', 500),
      file('notes.txt', 10, 'text/plain'),
    ]);
    await settle();

    // One message for the batch would leave two of these three unexplained.
    expect(statuses(harness.upload)).toEqual(['uploading', 'rejected', 'rejected']);
    expect(codes(harness.upload)).toEqual([undefined, 'size', 'type']);
    const messages = harness.upload.items().map((entry) => entry.error?.message ?? '');
    expect(messages[1]).toContain('huge.png');
    expect(messages[2]).toContain('notes.txt');
    expect(messages[1]).not.toBe(messages[2]);
  });

  it('counts the places left across the whole queue, not one drop', async () => {
    const harness = buildUpload({ maxFiles: 2 });
    harness.upload.add([file('a.png'), file('b.png')]);
    harness.upload.add([file('c.png')]);
    await settle();

    expect(statuses(harness.upload)).toEqual(['pending', 'pending', 'rejected']);
    expect(harness.upload.items()[2]!.error!.code).toBe('count');
  });

  it('lets a single-file upload replace the one file it is allowed to hold', async () => {
    const harness = buildUpload({ multiple: false, maxFiles: 1, transport: heldTransport() });
    harness.upload.add([file('a.png')]);
    await settle();

    harness.upload.add([file('b.png')]);
    await settle();

    // The file being replaced is on its way out and occupies no place. Counting
    // it refused the replacement and cancelled what it replaced, leaving the
    // control holding one rejected file, nothing to send, and an empty list on
    // the input the form reads.
    expect(harness.upload.items().map((entry) => entry.file.name)).toEqual(['b.png']);
    expect(statuses(harness.upload)).toEqual(['uploading']);
    expect(codes(harness.upload)).toEqual([undefined]);
    expect(picked(harness.picker)).toEqual(['b.png']);
  });

  it('frees a place again when a file is removed', async () => {
    const harness = buildUpload({ maxFiles: 1 });
    const [first] = harness.upload.add([file('a.png')]);
    harness.upload.remove(first!.id);
    harness.upload.add([file('b.png')]);
    await settle();
    expect(statuses(harness.upload)).toEqual(['pending']);
  });

  it('refuses a file for a reason only the consumer knows', async () => {
    const harness = buildUpload({
      validate: (candidate) => (candidate.name.startsWith('.') ? 'Hidden files are not allowed' : null),
    });
    harness.upload.add([file('.secret.png'), file('fine.png')]);
    await settle();

    expect(codes(harness.upload)).toEqual(['custom', undefined]);
    expect(harness.upload.items()[0]!.error!.message).toBe('Hidden files are not allowed');
  });

  it('takes a code from the consumer as well as a message', async () => {
    const harness = buildUpload({
      validate: () => ({ code: 'size', message: 'Too big for this album' }),
    });
    harness.upload.add([file('a.png')]);
    await settle();
    expect(harness.upload.items()[0]!.error).toEqual({
      code: 'size',
      message: 'Too big for this album',
    });
  });

  it('matches the accept list the way the attribute does', async () => {
    const harness = buildUpload({ accept: '.pdf,image/*' });
    harness.upload.add([
      file('photo.JPG', 10, 'image/jpeg'),
      file('paper.PDF', 10, ''),
      file('notes.txt', 10, 'text/plain'),
    ]);
    await settle();

    // A camera writes .JPG, and nobody means to exclude it.
    expect(statuses(harness.upload)).toEqual(['pending', 'pending', 'rejected']);
  });

  it('takes the wording it is given', async () => {
    const harness = buildUpload({
      maxSize: 10,
      labels: { sizeRejected: (candidate, max) => `${candidate.name} exceeds ${max} bytes` },
    });
    harness.upload.add([file('a.png', 100)]);
    await settle();
    expect(harness.upload.items()[0]!.error!.message).toBe('a.png exceeds 10 bytes');
  });

  it('matches an accept list naming one exact type', async () => {
    const harness = buildUpload({ accept: 'image/png' });
    harness.upload.add([file('a.png', 10, 'image/png'), file('b.gif', 10, 'image/gif')]);
    await settle();

    // The third form the attribute takes, and the only one the list above does
    // not exercise: no wildcard and no leading dot, so the type is compared
    // whole.
    expect(statuses(harness.upload)).toEqual(['pending', 'rejected']);
  });

  it('accepts everything when the accept list names nothing', async () => {
    const harness = buildUpload({ accept: ' , ' });
    harness.upload.add([file('notes.txt', 10, 'text/plain')]);
    await settle();

    // A list of separators is a list of nothing, and a filter that names no
    // type filters nothing out — the alternative is a field that silently
    // refuses every file it is offered.
    expect(statuses(harness.upload)).toEqual(['pending']);
  });

  it('adds nothing at all while disabled', async () => {
    const harness = buildUpload({ disabled: () => true, transport: heldTransport() });
    expect(harness.upload.add([file('a.png')])).toEqual([]);
    await settle();
    expect(harness.upload.items()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Upload: dragging and dropping
// ---------------------------------------------------------------------------

describe('upload: dragging and dropping', () => {
  it('cancels dragover, which is the only thing that makes a drop possible', () => {
    const harness = buildUpload({});
    const event = dispatch(harness.zone, dragEvent('dragover', [file('a.png')]));

    // Without this the browser refuses the drop and then navigates to the file,
    // replacing the page.
    expect(event.defaultPrevented).toBe(true);
    expect((event as DragEvent).dataTransfer!.dropEffect).toBe('copy');
  });

  it('lights up on entry and goes out on the way past', () => {
    const harness = buildUpload({});
    const files = [file('a.png')];

    dispatch(harness.zone, dragEvent('dragenter', files));
    expect(harness.upload.isDragging()).toBe(true);
    expect(harness.zone.getAttribute('data-dragging')).toBe('');

    dispatch(harness.zone, dragEvent('dragleave', files));
    expect(harness.upload.isDragging()).toBe(false);
  });

  it('does not flicker as the pointer crosses into a child', () => {
    const harness = buildUpload({});
    const files = [file('a.png')];
    const inner = host.querySelector('.inner')!;

    dispatch(harness.zone, dragEvent('dragenter', files));
    // Entering the child fires enter on the child and leave on the zone, in
    // that order, and a zone made of more than one element flickers unless the
    // crossings are counted.
    dispatch(inner, dragEvent('dragenter', files));
    dispatch(harness.zone, dragEvent('dragleave', files));
    expect(harness.upload.isDragging()).toBe(true);

    dispatch(inner, dragEvent('dragleave', files));
    expect(harness.upload.isDragging()).toBe(false);
  });

  it('takes the files a drop carries', async () => {
    const harness = buildUpload({ transport: heldTransport() });
    dispatch(harness.zone, dragEvent('dragenter', [file('a.png')]));
    const event = dispatch(harness.zone, dragEvent('drop', [file('a.png'), file('b.png')]));
    await settle();

    expect(event.defaultPrevented).toBe(true);
    expect(harness.upload.items().map((entry) => entry.file.name)).toEqual(['a.png', 'b.png']);
    expect(harness.upload.isDragging()).toBe(false);
  });

  it('ignores a drag that is carrying no files', () => {
    const harness = buildUpload({});
    // Text dragged out of a paragraph, which must not light the zone up.
    const event = dispatch(harness.zone, dragEvent('dragover', [], ['text/plain']));
    expect(event.defaultPrevented).toBe(false);
    dispatch(harness.zone, dragEvent('dragenter', [], ['text/plain']));
    expect(harness.upload.isDragging()).toBe(false);
  });

  it('refuses the drop while disabled', async () => {
    const harness = buildUpload({ disabled: () => true });
    const over = dispatch(harness.zone, dragEvent('dragover', [file('a.png')]));
    // Not a drop target at all, so the drop never arrives.
    expect(over.defaultPrevented).toBe(false);

    const drop = dispatch(harness.zone, dragEvent('drop', [file('a.png')]));
    await settle();
    // Cancelled anyway, or a drop that slipped through opens the file over the
    // application.
    expect(drop.defaultPrevented).toBe(true);
    expect(harness.upload.items()).toHaveLength(0);
  });

  it('takes a drop anywhere on the page when asked, and lets go on unmount', async () => {
    const harness = buildUpload({ fullPage: true });
    const elsewhere = document.body;

    dispatch(elsewhere, dragEvent('dragenter', [file('a.png')]));
    expect(harness.upload.isPageDragging()).toBe(true);
    expect(dispatch(elsewhere, dragEvent('dragover', [file('a.png')])).defaultPrevented).toBe(true);

    dispatch(elsewhere, dragEvent('drop', [file('a.png')]));
    await settle();
    expect(harness.upload.items()).toHaveLength(1);
    expect(harness.upload.isPageDragging()).toBe(false);

    harness.unmount();
    flushSync();
    // A document listener left behind cancels every drag on the page for ever.
    expect(dispatch(elsewhere, dragEvent('dragover', [file('b.png')])).defaultPrevented).toBe(false);
  });

  it('takes a drop on the zone once, not once per zone it landed in', async () => {
    const harness = buildUpload({ fullPage: true });
    dispatch(harness.zone, dragEvent('drop', [file('a.png')]));
    await settle();

    // `onDrop` stops the event so the page-wide zone underneath does not take
    // the same files again — but Volt delegates `drop`, so the zone's handler
    // and the page's handler are two listeners on the document itself, and
    // `stopPropagation` does not reach a listener on the same node. Both run,
    // and one drop is queued twice.
    expect(harness.upload.items()).toHaveLength(1);
  });

  it('leaves a page-wide drop that is carrying no files to the page', async () => {
    const harness = buildUpload({ fullPage: true });

    const event = dispatch(document.body, dragEvent('drop', [], ['text/plain']));
    await settle();

    // A selection dragged into a textarea somewhere else on the page. Cancelling
    // it drops the text on the floor, and a full-page upload that does this
    // breaks drag-and-drop editing everywhere it is mounted — the same hazard
    // `onDragOver` and `onPaste` each already guard against.
    expect(event.defaultPrevented).toBe(false);
    expect(harness.upload.items()).toHaveLength(0);
  });

  it('takes files pasted onto the page, and lets go on unmount', async () => {
    const harness = buildUpload({ paste: true });

    const event = pasteEvent([file('screenshot.png')]);
    dispatch(document, event);
    await settle();
    expect(harness.upload.items()).toHaveLength(1);
    expect(event.defaultPrevented).toBe(true);

    // A paste that held text must reach whatever field the user was in.
    const empty = pasteEvent([]);
    dispatch(document, empty);
    expect(empty.defaultPrevented).toBe(false);

    harness.unmount();
    flushSync();
    dispatch(document, pasteEvent([file('later.png')]));
    await settle();
    expect(harness.upload.items()).toHaveLength(1);
  });

  it('takes a plain drop even when it was asked to walk directories', async () => {
    const harness = buildUpload({ directory: true, transport: heldTransport() });
    dispatch(harness.zone, dragEvent('drop', [file('a.png')]));
    await settle();

    // A drag of loose files exposes no entries to walk, and `directory` says
    // folders are welcome rather than that nothing else is.
    expect(harness.upload.items().map((entry) => entry.file.name)).toEqual(['a.png']);
  });

  it('walks a dropped folder for the files inside it', async () => {
    const harness = buildUpload({ directory: true, transport: heldTransport() });
    const tree = directoryEntry([
      fileEntry(file('top.png')),
      directoryEntry([fileEntry(file('nested.png'))]),
    ]);

    dispatch(harness.zone, dragEvent('drop', [], ['Files'], [entryItem(tree)]));
    // The walk is a promise per entry and a promise per page of a directory,
    // so it takes more turns to settle than a drop of loose files does.
    await settle(40);

    // The folder itself is not a file, and neither is the one inside it: what
    // the queue takes is what the tree holds.
    expect(harness.upload.items().map((entry) => entry.file.name)).toEqual([
      'top.png',
      'nested.png',
    ]);
  });

  it('stops walking a folder at the depth it was given', async () => {
    const harness = buildUpload({
      directory: true,
      maxDirectoryDepth: 1,
      transport: heldTransport(),
    });
    const tree = directoryEntry([
      fileEntry(file('top.png')),
      directoryEntry([fileEntry(file('nested.png'))]),
    ]);

    dispatch(harness.zone, dragEvent('drop', [], ['Files'], [entryItem(tree)]));
    await settle(40);

    // A directory tree is user input, and a symlinked loop read to the end
    // never ends.
    expect(harness.upload.items().map((entry) => entry.file.name)).toEqual(['top.png']);
  });

  it('takes a screenshot that arrives as a clipboard item', async () => {
    const harness = buildUpload({ paste: true });
    const shot = file('screenshot.png', 10, 'image/png');
    // Some engines hand a pasted screenshot over as an item and leave `files`
    // empty, which is the case the whole feature exists for. The string item
    // beside it is the text half of the same paste, and is not a file.
    const event = pasteEvent([], [
      clipboardItem('string', null),
      clipboardItem('file', shot),
    ]);
    dispatch(document, event);
    await settle();

    expect(harness.upload.items().map((entry) => entry.file.name)).toEqual(['screenshot.png']);
    expect(event.defaultPrevented).toBe(true);
  });

  it('watches the page for a paste only when asked', async () => {
    const harness = buildUpload({});

    const event = pasteEvent([file('screenshot.png')]);
    dispatch(document, event);
    await settle();

    // Taking a paste nobody asked for means every copy of an image anywhere on
    // the page lands in this queue.
    expect(harness.upload.items()).toHaveLength(0);
    expect(event.defaultPrevented).toBe(false);
  });

  it('leaves a paste to the page while disabled', async () => {
    const harness = buildUpload({ paste: true, disabled: () => true });

    // Through the handler rather than the document, because the listener is not
    // attached while disabled: `onPaste` is published, and a consumer wires it
    // to an element of their own exactly as the drag handlers are wired here,
    // so the guard inside is the only refusal that route meets.
    const event = pasteEvent([file('screenshot.png')]);
    harness.upload.onPaste(event as ClipboardEvent);
    await settle();

    expect(harness.upload.items()).toHaveLength(0);
    // Cancelling and then refusing is the worst of both: the files are dropped
    // and the paste is swallowed from whatever field the user was really in.
    expect(event.defaultPrevented).toBe(false);
  });

  it('watches the page for a drag only when asked', async () => {
    const harness = buildUpload({});
    const elsewhere = document.body;

    dispatch(elsewhere, dragEvent('dragenter', [file('a.png')]));
    expect(harness.upload.isPageDragging()).toBe(false);
    // Cancelling `dragover` on the document is what makes the whole page a drop
    // target, so an upload that has not been asked to be one must not.
    expect(dispatch(elsewhere, dragEvent('dragover', [file('a.png')])).defaultPrevented).toBe(
      false,
    );

    dispatch(elsewhere, dragEvent('drop', [file('a.png')]));
    await settle();
    expect(harness.upload.items()).toHaveLength(0);
  });

  it('stops watching the page while disabled', async () => {
    const harness = buildUpload({ fullPage: true, disabled: () => true });
    const elsewhere = document.body;

    dispatch(elsewhere, dragEvent('dragenter', [file('a.png')]));
    // A disabled zone that lights the page up and cancels the drag says the
    // drop is coming here, and then refuses it.
    expect(harness.upload.isPageDragging()).toBe(false);
    expect(dispatch(elsewhere, dragEvent('dragover', [file('a.png')])).defaultPrevented).toBe(
      false,
    );

    dispatch(elsewhere, dragEvent('drop', [file('a.png')]));
    await settle();
    expect(harness.upload.items()).toHaveLength(0);
  });

  it('leaves a page-wide drag that is carrying no files to the page', () => {
    const harness = buildUpload({ fullPage: true });
    const elsewhere = document.body;

    // A selection dragged between two fields that have nothing to do with this
    // upload. The drop is already left alone; the drag has to be too, or the
    // page lights up for it and the browser is told it may land here.
    dispatch(elsewhere, dragEvent('dragenter', [], ['text/plain']));
    expect(harness.upload.isPageDragging()).toBe(false);
    expect(dispatch(elsewhere, dragEvent('dragover', [], ['text/plain'])).defaultPrevented).toBe(
      false,
    );
  });

  it('puts the page highlight out when the drag leaves the page', () => {
    const harness = buildUpload({ fullPage: true });
    const elsewhere = document.body;
    const files = [file('a.png')];

    dispatch(elsewhere, dragEvent('dragenter', files));
    expect(harness.upload.isPageDragging()).toBe(true);

    // The same crossings the zone counts: entering the zone fires enter on it
    // and leave on what the pointer came from, and the page is still under a
    // drag throughout.
    dispatch(harness.zone, dragEvent('dragenter', files));
    dispatch(elsewhere, dragEvent('dragleave', files));
    expect(harness.upload.isPageDragging()).toBe(true);

    dispatch(harness.zone, dragEvent('dragleave', files));
    expect(harness.upload.isPageDragging()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Upload: the picker
// ---------------------------------------------------------------------------

describe('upload: the picker', () => {
  it('takes what the picker hands back and leaves it on the input', () => {
    const harness = buildUpload({});
    pick(harness.picker, [file('a.png')]);

    expect(harness.upload.items()).toHaveLength(1);
    // Emptying the input was what stood here, so that picking the same file
    // twice raised `change` again. Per the HTML spec that empties the
    // platform's selected files, which un-submits a file the user has already
    // chosen — and the input is the whole reason this component keeps one.
    expect(picked(harness.picker)).toEqual(['a.png']);
  });

  it('lets the same file be picked again once it has left the queue', () => {
    const harness = buildUpload({});
    const [item] = harness.upload.add([file('a.png')]);
    flushSync();
    expect(picked(harness.picker)).toEqual(['a.png']);

    harness.upload.remove(item!.id);
    flushSync();
    // A file that has left the queue leaves the input with it, so the next
    // pick of the same file is a change again — which is what emptying the
    // input used to buy, without un-submitting everything else.
    expect(picked(harness.picker)).toEqual([]);

    pick(harness.picker, [file('a.png')]);
    expect(harness.upload.items()).toHaveLength(1);
  });

  it('keeps every file the user has chosen, not only the last pick', () => {
    const harness = buildUpload({});
    pick(harness.picker, [file('a.png')]);
    // A second visit to the picker replaces the platform's list with one file.
    pick(harness.picker, [file('b.png')]);

    // The input has to end up carrying the queue, or a native submit posts
    // whichever file the user happened to choose last.
    expect(harness.upload.items().map((entry) => entry.file.name)).toEqual(['a.png', 'b.png']);
    expect(picked(harness.picker)).toEqual(['a.png', 'b.png']);
  });

  it('never submits a file it refused', async () => {
    const harness = buildUpload({ accept: 'image/*' });
    pick(harness.picker, [file('a.png'), file('notes.txt', 10, 'text/plain')]);
    await settle();

    // The refusal is listed so the user can read why, but a file the component
    // will not send must not travel with the form either.
    expect(statuses(harness.upload)).toEqual(['pending', 'rejected']);
    expect(picked(harness.picker)).toEqual(['a.png']);
  });

  it('carries a dropped file into a native submit, and satisfies required', async () => {
    const form = document.createElement('form');
    host.append(form);
    const harness = buildUpload({ required: () => true }, UPLOAD, form);

    expect(harness.picker.validity.valueMissing).toBe(true);
    dispatch(harness.zone, dragEvent('drop', [file('a.png')]));
    await settle();

    // A drop never goes near the input, so without putting it there the
    // browser refuses the submit of a file the user has already chosen — and
    // no queue path could ever satisfy it, because `setCustomValidity('')`
    // cannot clear a platform `valueMissing`.
    expect(picked(harness.picker)).toEqual(['a.png']);
    expect(harness.picker.validity.valueMissing).toBe(false);

    // And it is the input that carries it into the submit, which is the whole
    // reason a headless uploader keeps one.
    harness.picker.name = 'attachments';
    const sentFiles = new FormData(form).getAll('attachments') as File[];
    expect(sentFiles.map((one) => one.name)).toEqual(['a.png']);
  });

  it('opens the picker from the keyboard, because a drop zone has no other route', () => {
    const harness = buildUpload({});
    const clicked = vi.fn();
    harness.picker.addEventListener('click', clicked);

    expect(press(harness.zone, 'Enter')).toBe(true);
    expect(press(harness.zone, ' ')).toBe(true);
    expect(clicked).toHaveBeenCalledTimes(2);
    expect(harness.handled()).toBe(true);
  });

  it('leaves a shortcut and an ordinary key alone', () => {
    const harness = buildUpload({});
    expect(press(harness.zone, 'Enter', { metaKey: true })).toBe(false);
    expect(press(harness.zone, 'a')).toBe(false);
    expect(harness.handled()).toBe(false);
  });

  it('opens nothing while disabled', () => {
    const harness = buildUpload({ disabled: () => true });
    const clicked = vi.fn();
    harness.picker.addEventListener('click', clicked);

    expect(press(harness.zone, 'Enter')).toBe(false);
    harness.upload.open();
    expect(clicked).not.toHaveBeenCalled();
  });

  it('answers Enter and Space even when it was handed no drop zone', () => {
    const harness = buildUpload({}, PLAIN_UPLOAD);
    const clicked = vi.fn();
    harness.picker.addEventListener('click', clicked);

    // `dropZoneProps` hands out `role="button"`, `tabindex="0"` and a label
    // that promises "press to choose files" whether or not the `dropZone`
    // accessor was supplied — and a ref for finding an element says nothing
    // about the keyboard. APG's button pattern requires Enter and Space to
    // activate, so a zone that answers the mouse and not the keyboard is the
    // failure the role promises against.
    for (const key of ['Enter', ' ']) {
      const event = new KeyboardEvent('keydown', { key, cancelable: true });
      expect(harness.upload.onKeyDown(event)).toBe(true);
      expect(event.defaultPrevented).toBe(true);
    }
    expect(clicked).toHaveBeenCalledTimes(2);
  });

  it('leaves Enter alone when the key came from outside the zone it was given', () => {
    const harness = buildUpload({});
    const clicked = vi.fn();
    harness.picker.addEventListener('click', clicked);

    // What the accessor can honestly gate is reach, not the keyboard map: a
    // handler wired further up than the zone — this shape — would otherwise
    // swallow Enter from every field underneath it, and Enter in a text field
    // has to reach the form.
    const answers: boolean[] = [];
    harness.root.addEventListener('keydown', (event) => {
      answers.push(harness.upload.onKeyDown(event));
    });
    const enter = () => new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });

    dispatch(host.querySelector('.hint')!, enter());
    expect(answers).toEqual([false]);
    expect(clicked).not.toHaveBeenCalled();

    // Anything the zone is built from still activates it.
    dispatch(host.querySelector('.inner')!, enter());
    expect(answers).toEqual([false, true]);
    expect(clicked).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Upload: what assistive technology is told
// ---------------------------------------------------------------------------

describe('upload: what assistive technology is told', () => {
  it('makes the drop zone a button, because that is what it does', () => {
    const harness = buildUpload({});
    const hint = host.querySelector('.hint')!;

    expect(harness.zone.getAttribute('role')).toBe('button');
    expect(harness.zone.getAttribute('tabindex')).toBe('0');
    expect(harness.zone.getAttribute('aria-label')).toBe(
      'Drop files here, or press to choose files',
    );
    expect(harness.zone.getAttribute('aria-describedby')).toBe(hint.id);
    expect(document.getElementById(hint.id)).not.toBeNull();
  });

  it('keeps a disabled zone in the tab order and says it is unavailable', () => {
    const harness = buildUpload({ disabled: () => true, transport: heldTransport() });

    // The same rule the slider's thumbs follow: `aria-disabled` on a control
    // that stays reachable. Removing it from the tab order while still saying
    // `aria-disabled` contradicts itself — nothing can reach the state to hear
    // it — and a zone that vanishes cannot be found and asked about.
    expect(harness.zone.getAttribute('tabindex')).toBe('0');
    expect(harness.zone.getAttribute('aria-disabled')).toBe('true');

    // Reachable, and still inert.
    const clicked = vi.fn();
    harness.picker.addEventListener('click', clicked);
    expect(press(harness.zone, 'Enter')).toBe(false);
    expect(clicked).not.toHaveBeenCalled();
  });

  it('keeps a real file input behind it all', () => {
    const harness = buildUpload({ accept: 'image/*' });
    expect(harness.picker.type).toBe('file');
    expect(harness.picker.multiple).toBe(true);
    expect(harness.picker.getAttribute('accept')).toBe('image/*');
    // The picker's own filter is a hint, never a guarantee.
    expect(harness.picker.hasAttribute('webkitdirectory')).toBe(false);
  });

  it('asks for whole directories only when it was told to', () => {
    const harness = buildUpload({ directory: true });
    expect(harness.picker.hasAttribute('webkitdirectory')).toBe(true);
  });

  it('names the buttons after the file they act on', async () => {
    const harness = buildUpload({ transport: heldTransport() });
    harness.upload.add([file('holiday.png')]);
    await settle();

    const label = (selector: string) =>
      host.querySelector(selector)!.getAttribute('aria-label');
    expect(label('.cancel')).toBe('Cancel upload of holiday.png');
    expect(label('.retry')).toBe('Retry upload of holiday.png');
    expect(label('.remove')).toBe('Remove holiday.png');

    // Present but unavailable, rather than gone: a button that disappears the
    // moment an upload finishes moves everything next to it.
    expect(host.querySelector('.cancel')!.hasAttribute('aria-disabled')).toBe(false);
    expect(host.querySelector('.retry')!.getAttribute('aria-disabled')).toBe('true');

    lastFor('holiday.png').reject(new Error('boom'));
    await settle();
    expect(host.querySelector('.cancel')!.getAttribute('aria-disabled')).toBe('true');
    expect(host.querySelector('.retry')!.hasAttribute('aria-disabled')).toBe(false);
  });

  it('names the remove button from the locale catalogue, as every other remove button is', async () => {
    @Component({
      selector: `v-upload-${++selectors}`,
      render: compileTemplate(`
        <div class="upload">
          <input class="picker" :ref="input" :spread="upload.inputProps()">
          <ul>
            <li :for="entry of upload.items()" :key="entry.id">
              <button class="remove" :spread="upload.removeProps(entry)"></button>
            </li>
          </ul>
        </div>
      `),
    })
    class GermanUpload {
      input = new Signal.State<Element | null>(null);
      locale = createLocaleProvider({ defaultLocale: 'de-DE', messages: { remove: 'Entfernen' } });
      upload = createFileUpload({ input: () => this.input.get() });
    }

    const handle = mount(GermanUpload, host);
    mounted.push(handle);
    flushSync();
    (handle.instance as GermanUpload).upload.add([file('urlaub.png')]);
    await settle();

    expect(host.querySelector('.remove')!.getAttribute('aria-label')).toBe('Entfernen urlaub.png');
  });

  it("names the remove button with the catalogue's whole phrase, where it has one", async () => {
    @Component({
      selector: `v-upload-${++selectors}`,
      render: compileTemplate(`
        <div class="upload">
          <input class="picker" :ref="input" :spread="upload.inputProps()">
          <ul>
            <li :for="entry of upload.items()" :key="entry.id">
              <button class="remove" :spread="upload.removeProps(entry)"></button>
            </li>
          </ul>
        </div>
      `),
    })
    class GermanUpload {
      input = new Signal.State<Element | null>(null);
      // German puts the verb last. A phrase with the label in it lets the
      // language choose the order, which `remove` followed by the label cannot.
      locale = createLocaleProvider({
        defaultLocale: 'de-DE',
        messages: { remove: 'Entfernen', removeItem: '{label} entfernen' },
      });
      upload = createFileUpload({ input: () => this.input.get() });
    }

    const handle = mount(GermanUpload, host);
    mounted.push(handle);
    flushSync();
    (handle.instance as GermanUpload).upload.add([file('urlaub.png')]);
    await settle();

    expect(host.querySelector('.remove')!.getAttribute('aria-label')).toBe('urlaub.png entfernen');
  });

  it('announces politely, and never as an emergency', () => {
    const harness = buildUpload({});
    expect(harness.live.getAttribute('role')).toBe('status');
    expect(harness.live.getAttribute('aria-live')).toBe('polite');
    expect(harness.live.getAttribute('aria-atomic')).toBe('true');
  });

  it('names the aggregate bar', () => {
    buildUpload({});
    const bar = host.querySelector('.bar')!;
    expect(bar.getAttribute('role')).toBe('progressbar');
    expect(bar.getAttribute('aria-label')).toBe('Upload progress');
  });
});

// ---------------------------------------------------------------------------
// Upload: announcements
// ---------------------------------------------------------------------------

describe('upload: announcements', () => {
  it('says nothing until the region has been on the page long enough to hear it', async () => {
    useClock();
    const harness = buildUpload({ transport: heldTransport() });
    harness.upload.add([file('a.png')]);
    await settle();
    lastFor('a.png').resolve();
    await settle();

    // A region that is announced into in the same frame it appears is a region
    // no screen reader reads.
    expect(harness.upload.announcement()).toBe('');

    await advance(50);
    expect(harness.upload.announcement()).toBe('1 files uploaded');
    expect(harness.live.textContent).toBe('1 files uploaded');
  });

  it('counts up as files land, and reports a failure at the end', async () => {
    useClock();
    const onComplete = vi.fn();
    const harness = buildUpload({ transport: heldTransport(), onComplete });
    await advance(50);

    harness.upload.add([file('a.png'), file('b.png')]);
    await settle();

    lastFor('a.png').resolve();
    await settle();
    // Announced per event rather than per byte: a percentage read aloud four
    // times a second is not information.
    expect(harness.upload.announcement()).toBe('1 of 2 files uploaded');
    expect(onComplete).not.toHaveBeenCalled();

    lastFor('b.png').reject(new Error('boom'));
    await settle();
    expect(harness.upload.announcement()).toBe('1 of 2 files failed to upload');
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('counts neither a file it refused nor one that was called off', async () => {
    useClock();
    const harness = buildUpload({ transport: heldTransport(), accept: 'image/*' });
    await advance(50);

    harness.upload.add([file('a.png'), file('b.png'), file('notes.txt', 10, 'text/plain')]);
    await settle();

    const called = harness.upload.items().find((entry) => entry.file.name === 'b.png')!;
    harness.upload.cancel(called.id);
    await settle();
    lastFor('a.png').resolve();
    await settle();

    // Neither the refused file nor the cancelled one is part of this upload,
    // so counting them leaves the region saying "1 of 3" about an upload that
    // has finished everything it was ever going to send.
    expect(harness.upload.announcement()).toBe('1 files uploaded');
  });

  it('still has something to say when no region was wired up', async () => {
    const harness = buildUpload({ transport: heldTransport() }, PLAIN_UPLOAD);
    harness.upload.add([file('a.png')]);
    await settle();
    lastFor('a.png').resolve();
    await settle();

    // The region accessor is optional, and `liveRegionProps` is offered for a
    // region the consumer writes themselves — so a consumer who spreads the
    // props without also passing the accessor gets a region that is never
    // written to. Silence for a message the consumer did render is a worse
    // failure than one announced a little early, which is the rule the rest of
    // the library follows for an absent region.
    expect(harness.upload.announcement()).toBe('1 files uploaded');
  });
});

// ---------------------------------------------------------------------------
// Upload: the form around it
// ---------------------------------------------------------------------------

describe('upload: the form around it', () => {
  it('refuses a submit while files are still going up', async () => {
    const form = document.createElement('form');
    host.append(form);
    const harness = buildUpload({ transport: heldTransport() }, UPLOAD, form);

    harness.upload.add([file('a.png')]);
    await settle();

    const blocked = new Event('submit', { bubbles: true, cancelable: true });
    form.dispatchEvent(blocked);
    flushSync();
    // A form that posts half an upload is worse than one that makes the user
    // wait — and the refused submit is when the user is told to.
    expect(blocked.defaultPrevented).toBe(true);
    expect(harness.upload.field.messages()).toEqual(['Wait for the upload to finish.']);

    lastFor('a.png').resolve();
    await settle();
    // The message goes when the reason does, not at the next submit.
    expect(harness.upload.field.messages()).toEqual([]);
    const allowed = new Event('submit', { bubbles: true, cancelable: true });
    form.dispatchEvent(allowed);
    expect(allowed.defaultPrevented).toBe(false);
  });

  it('does not call an upload in progress invalid before anyone has submitted', async () => {
    const harness = buildUpload({ transport: heldTransport() });

    harness.upload.add([file('a.png')]);
    await settle();

    // Nothing is wrong yet: a file going up is not a mistake, and an error
    // region that said "Wait for the upload to finish." every time an upload
    // began would be an alarm about nothing.
    expect(harness.upload.field.state()).toBe('valid');
    expect(harness.upload.field.messages()).toEqual([]);
    expect(harness.picker.hasAttribute('aria-invalid')).toBe(false);
  });

  it('is not invalid at mount when required and empty', async () => {
    const harness = buildUpload({ required: () => true });
    await settle();

    // The one thing the form field exists to prevent: a required field
    // announcing itself wrong before anyone has done anything.
    expect(harness.upload.field.state()).toBe('valid');
    expect(harness.upload.field.messages()).toEqual([]);
    expect(harness.picker.hasAttribute('aria-invalid')).toBe(false);
  });

  it('lets a form without a transport post its files itself', async () => {
    const form = document.createElement('form');
    host.append(form);
    const harness = buildUpload({ name: 'attachments' }, UPLOAD, form);

    harness.upload.add([file('a.png')]);
    await settle();

    // Nothing will ever send these, so nothing is on its way: the form is what
    // posts them, through the input.
    const submit = new Event('submit', { bubbles: true, cancelable: true });
    form.dispatchEvent(submit);
    expect(submit.defaultPrevented).toBe(false);
    expect(harness.picker.name).toBe('attachments');
    expect((new FormData(form).getAll('attachments') as File[]).map((one) => one.name)).toEqual([
      'a.png',
    ]);
  });

  it('leaves the input unnamed when a transport sends the files', async () => {
    const harness = buildUpload({ name: 'attachments', transport: heldTransport() });

    // The input holds every queued file, sent ones included, so a name would
    // post each of them a second time with the form.
    expect(harness.picker.hasAttribute('name')).toBe(false);
  });

  it('empties the queue with the input on a form reset', async () => {
    const form = document.createElement('form');
    host.append(form);
    const harness = buildUpload({ transport: heldTransport(), accept: 'image/*' }, UPLOAD, form);

    harness.upload.add([file('a.png'), file('notes.txt', 10, 'text/plain')]);
    await settle();
    expect(harness.upload.field.isInvalid()).toBe(true);

    form.reset();
    await settle();

    // The browser empties the input, and a queue that kept its files would go
    // on listing — and sending — what the form has just been told to forget.
    expect(harness.upload.items()).toEqual([]);
    expect(lastFor('a.png').aborted).toBe(true);
    expect(picked(harness.picker)).toEqual([]);
    expect(harness.upload.field.state()).toBe('valid');
    const submit = new Event('submit', { bubbles: true, cancelable: true });
    form.dispatchEvent(submit);
    expect(submit.defaultPrevented).toBe(false);
  });

  it('keeps every file when the reset is called off', async () => {
    const form = document.createElement('form');
    host.append(form);
    const harness = buildUpload({ transport: heldTransport() }, UPLOAD, form);

    harness.upload.add([file('a.png')]);
    await settle();
    form.addEventListener('reset', (event) => event.preventDefault(), true);

    form.dispatchEvent(new Event('reset', { bubbles: true, cancelable: true }));
    await settle();

    // "Discard your changes?" answered no: nothing else in the form went back,
    // so an upload that threw its files away would be the only thing that did.
    expect(harness.upload.items().map((item) => item.file.name)).toEqual(['a.png']);
    expect(lastFor('a.png').aborted).toBe(false);
  });

  it('lets a submit through while busy when told to', async () => {
    const harness = buildUpload({ transport: heldTransport(), blockSubmitWhileBusy: false });
    harness.upload.add([file('a.png')]);
    await settle();
    expect(harness.upload.field.messages()).toEqual([]);
  });

  it('puts the reason a file was refused where the form can show it', async () => {
    const harness = buildUpload({ accept: 'image/*' });
    harness.upload.add([file('notes.txt', 10, 'text/plain')]);
    await settle();

    expect(harness.upload.field.isInvalid()).toBe(true);
    expect(harness.upload.field.messages()[0]).toContain('notes.txt');
  });

  it('puts the reason an upload failed where the form can show it', async () => {
    const harness = buildUpload({ transport: heldTransport() });
    harness.upload.add([file('a.png')]);
    await settle();
    lastFor('a.png').reject(new Error('The server is out of room'));
    await settle();

    // A refusal and a failure are the same fact to a form: this control is not
    // carrying what the user thinks it is, and the reason has to travel with
    // the refusal rather than being left in the queue for a consumer to notice.
    expect(harness.upload.field.isInvalid()).toBe(true);
    expect(harness.upload.field.messages()[0]).toBe('The server is out of room');
  });

  it('counts a drop as an edit, though the input never saw it', async () => {
    const harness = buildUpload({});
    expect(harness.upload.field.isDirty()).toBe(false);

    dispatch(harness.zone, dragEvent('drop', [file('a.png')]));
    await settle();

    // `add` tells the field it was edited, because a drop raises none of the
    // events the field listens for. But the field measures dirtiness by reading
    // the control's value, and a file input's value is only ever written by the
    // platform's own picker — so a queue full of dropped files reports a form
    // with nothing in it to save.
    expect(harness.upload.field.isDirty()).toBe(true);
    expect(harness.root.getAttribute('data-dirty')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Upload: chunks
// ---------------------------------------------------------------------------

describe('upload: chunks', () => {
  it('sends a file one slice at a time, and says which slice each one is', async () => {
    const harness = buildUpload({ transport: heldTransport(), chunkSize: 100 });
    harness.upload.add([file('big.png', 250)]);
    await settle();

    expect(requestsFor('big.png')).toHaveLength(1);
    expect(lastFor('big.png').request.chunk).toEqual({ index: 0, count: 3, start: 0, end: 100 });
    expect(lastFor('big.png').request.body.size).toBe(100);

    lastFor('big.png').resolve();
    await settle();
    // Committed only once the server has taken it, which is what makes the
    // resume point trustworthy.
    expect(harness.upload.items()[0]!.chunk).toBe(1);
    expect(harness.upload.items()[0]!.loaded).toBe(100);
    expect(lastFor('big.png').request.chunk).toEqual({ index: 1, count: 3, start: 100, end: 200 });

    lastFor('big.png').resolve();
    await settle();
    expect(lastFor('big.png').request.body.size).toBe(50);

    lastFor('big.png').resolve();
    await settle();
    expect(harness.upload.items()[0]!.status).toBe('success');
    expect(requestsFor('big.png')).toHaveLength(3);
  });

  it('reports progress within a chunk as progress through the file', async () => {
    const harness = buildUpload({ transport: heldTransport(), chunkSize: 100 });
    harness.upload.add([file('big.png', 200)]);
    await settle();

    lastFor('big.png').resolve();
    await settle();
    lastFor('big.png').request.progress(50);
    flushSync();

    // 150 of 200, not 50 of 100: a bar that sat still for a whole chunk and
    // then jumped would be worse than no bar.
    expect(harness.upload.items()[0]!.loaded).toBe(150);
    expect(harness.upload.items()[0]!.progress).toBe(75);
  });

  it('carries on from the last slice the server took', async () => {
    useClock();
    const harness = buildUpload({
      transport: heldTransport(),
      chunkSize: 100,
      retries: 1,
      retryDelay: () => 500,
    });
    harness.upload.add([file('big.png', 300)]);
    await settle();

    lastFor('big.png').resolve();
    await settle();
    lastFor('big.png').reject(new Error('connection lost'));
    await advance(500);

    // A failure costs one chunk rather than the whole file.
    expect(lastFor('big.png').request.chunk!.index).toBe(1);
    expect(requestsFor('big.png')).toHaveLength(3);
  });

  it('asks the server what it already has before starting', async () => {
    const resumeFrom = vi.fn(() => 200);
    const harness = buildUpload({ transport: heldTransport(), chunkSize: 100, resumeFrom });
    harness.upload.add([file('big.png', 300)]);
    await settle();

    // An upload interrupted in an earlier session resumes rather than restarts.
    expect(resumeFrom).toHaveBeenCalledTimes(1);
    expect(lastFor('big.png').request.chunk!.index).toBe(2);
    expect(harness.upload.items()[0]!.loaded).toBe(200);
  });

  it('calls a chunked upload cancelled, not finished, when it is stopped between slices', async () => {
    const onItemComplete = vi.fn();
    const harness = buildUpload({
      transport: heldTransport(),
      chunkSize: 50,
      onItemComplete,
    });
    const [item] = harness.upload.add([file('big.png', 100)]);
    await settle();
    expect(requestsFor('big.png')).toHaveLength(1);

    // Cancelled in the window between one slice being taken and the next being
    // issued: the resolve queues the continuation, and this lands before it
    // runs. Leaving the loop rather than throwing here returns the last slice's
    // response as though the file were finished.
    lastFor('big.png').resolve();
    harness.upload.cancel(item!.id);
    await settle();

    // Half a file on the server is not a success. A bar reading 100%, an
    // `onItemComplete` for a file nobody finished sending, and a submit-blocking
    // validity cleared on the strength of it are all one wrong status apart.
    expect(harness.upload.items()[0]!.status).toBe('cancelled');
    expect(harness.upload.items()[0]!.progress).toBe(50);
    expect(onItemComplete).not.toHaveBeenCalled();
    // And the slice it was stopped before is never sent.
    expect(requestsFor('big.png')).toHaveLength(1);

    // The bytes already taken are kept, because that is where a retry resumes.
    expect(harness.upload.items()[0]!.chunk).toBe(1);
  });

  it('answers a cancel that lands while the server is being asked what it has', async () => {
    let answer: (bytes: number) => void = () => {};
    const resumeFrom = () => new Promise<number>((resolve) => (answer = resolve));
    const harness = buildUpload({ transport: heldTransport(), chunkSize: 50, resumeFrom });
    const [item] = harness.upload.add([file('big.png', 100)]);
    await settle();
    expect(requestsFor('big.png')).toHaveLength(0);

    harness.upload.cancel(item!.id);
    answer(0);
    await settle();

    // `resumeFrom` is handed no signal and so cannot be cancelled; a cancel
    // that arrives while it is outstanding has to be caught on the way out, or
    // the upload the user stopped starts anyway the moment the server answers.
    expect(requestsFor('big.png')).toHaveLength(0);
    expect(harness.upload.items()[0]!.status).toBe('cancelled');
  });
});

// ---------------------------------------------------------------------------
// Upload: letting go
// ---------------------------------------------------------------------------

describe('upload: letting go', () => {
  it('takes its uploads with it when the component goes away', async () => {
    const harness = buildUpload({ transport: heldTransport() });
    harness.upload.add([file('a.png')]);
    await settle();

    harness.unmount();
    flushSync();
    // Requests outlive nothing: an upload that must survive the UI belongs to
    // something above it.
    expect(lastFor('a.png').aborted).toBe(true);
  });

  it('leaves the files still queued behind it unsent', async () => {
    const harness = buildUpload({ transport: heldTransport(), concurrency: 1 });
    harness.upload.add([file('a.png'), file('b.png'), file('c.png')]);
    await settle();
    expect(requestsFor('a.png')).toHaveLength(1);
    expect(requestsFor('b.png')).toHaveLength(0);

    harness.unmount();
    await settle();

    // Aborting the controllers is not enough on its own: every abort rejects a
    // transport, every rejection runs the sender's own `finally`, and that
    // pumps the queue again — starting the next file with a fresh controller
    // nothing will ever abort, and chaining down the rest of the queue as each
    // one finishes. A component that goes away takes its uploads with it.
    expect(lastFor('a.png').aborted).toBe(true);
    expect(requestsFor('b.png')).toHaveLength(0);
    expect(requestsFor('c.png')).toHaveLength(0);
  });

  it('starts nothing for a handler that outlived it', async () => {
    const harness = buildUpload({ transport: heldTransport(), auto: false });
    const [item] = harness.upload.add([file('a.png')]);
    await settle();

    harness.unmount();
    flushSync();

    // A button still on the screen for a frame, or a promise resolving into a
    // torn-down component: emptying the queue's wants on teardown covers the
    // files queued at that moment, and the latch covers everything after.
    harness.upload.upload();
    harness.upload.retry(item!.id);
    harness.upload.uploadItem(item!.id);
    await settle();
    expect(requestsFor('a.png')).toHaveLength(0);
  });

  it('leaves no retry waiting behind it', async () => {
    useClock();
    const harness = buildUpload({
      transport: heldTransport(),
      retries: 3,
      retryDelay: () => 10_000,
    });
    harness.upload.add([file('a.png')]);
    await settle();
    lastFor('a.png').reject(new Error('boom'));
    await settle();
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    harness.unmount();
    flushSync();
    await advance(10_000);
    // A timer that survives the component fires into a queue nobody is
    // watching, and holds the whole closure alive until it does.
    expect(requestsFor('a.png')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Upload: the two transports that ship
// ---------------------------------------------------------------------------

/**
 * A request as `pump` builds one, for driving a transport on its own.
 *
 * Both transports are exported and are the ones every consumer starts from, so
 * they are judged directly rather than through a queue that would have to fake
 * the network underneath them anyway.
 */
function uploadRequest(overrides: Partial<UploadRequest> = {}): UploadRequest {
  const one = file('a.png', 4, 'image/png');
  const item: UploadItem = {
    id: 'item-1',
    file: one,
    path: one.name,
    status: 'uploading',
    loaded: 0,
    total: one.size,
    progress: 0,
    error: null,
    response: undefined,
    attempts: 1,
    chunk: 0,
  };
  return {
    file: one,
    item,
    body: one,
    chunk: null,
    signal: new AbortController().signal,
    progress: () => {},
    ...overrides,
  };
}

/** Enough of `XMLHttpRequest` for the transport, and a way to drive it. */
class FakeXhr {
  static last: FakeXhr | null = null;

  status = 200;
  responseText = '';
  withCredentials = false;
  method = '';
  url = '';
  aborted = false;
  sent: unknown = null;
  readonly headers: Record<string, string> = {};
  responseHeaders: Record<string, string> = {};
  readonly upload = new EventTarget();
  private readonly events = new EventTarget();

  constructor() {
    FakeXhr.last = this;
  }

  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(key: string, value: string): void {
    this.headers[key] = value;
  }

  getResponseHeader(name: string): string | null {
    return this.responseHeaders[name.toLowerCase()] ?? null;
  }

  addEventListener(type: string, listener: EventListener): void {
    this.events.addEventListener(type, listener);
  }

  send(body: unknown): void {
    this.sent = body;
  }

  abort(): void {
    this.aborted = true;
    this.events.dispatchEvent(new Event('abort'));
  }

  /** What the network would say: bytes on the way up, then the response. */
  reportProgress(loaded: number, lengthComputable = true): void {
    const event = new Event('progress');
    Object.defineProperty(event, 'lengthComputable', { value: lengthComputable });
    Object.defineProperty(event, 'loaded', { value: loaded });
    this.upload.dispatchEvent(event);
  }

  respond(status: number, text = '', contentType = ''): void {
    this.status = status;
    this.responseText = text;
    this.responseHeaders = contentType ? { 'content-type': contentType } : {};
    this.events.dispatchEvent(new Event('load'));
  }
}

describe('upload: the two transports that ship', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    FakeXhr.last = null;
  });

  const fieldsOf = (body: unknown): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const [key, value] of (body as FormData).entries()) {
      if (typeof value === 'string') out[key] = value;
      else out[key] = `file:${value.name}`;
    }
    return out;
  };

  it('sends a multipart body, and hands back what came out of it', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    const request = uploadRequest();
    const done = xhrTransport({ url: '/files' })(request);

    const xhr = FakeXhr.last!;
    expect(xhr.method).toBe('POST');
    expect(xhr.url).toBe('/files');
    // The name travels beside the bytes, because a multipart part carries a
    // filename the server has no other way to trust.
    expect(fieldsOf(xhr.sent)).toEqual({ file: 'file:a.png', name: 'a.png' });

    xhr.respond(200, '{"id":"remote-1"}', 'application/json');
    // A server that promised JSON is taken at its word, and a body that is not
    // JSON is handed back whole rather than thrown over.
    expect(await done).toEqual({ id: 'remote-1' });
  });

  it('adds the path a file came in under, and only when it has one', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    const flat = uploadRequest();
    void xhrTransport({ url: '/files' })(flat);
    expect(fieldsOf(FakeXhr.last!.sent)).not.toHaveProperty('path');

    const nested = uploadRequest();
    void xhrTransport({ url: '/files' })({
      ...nested,
      item: { ...nested.item, path: 'holiday/a.png' },
    });
    // So the server can rebuild the tree rather than receive a flat pile of
    // names — and a file whose path is its name has no tree to rebuild.
    expect(fieldsOf(FakeXhr.last!.sent).path).toBe('holiday/a.png');
  });

  it('reports the bytes that have gone, and finishes the bar by hand', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    const seen: number[] = [];
    const request = uploadRequest({ progress: (loaded) => seen.push(loaded) });
    const done = xhrTransport({ url: '/files' })(request);

    const xhr = FakeXhr.last!;
    xhr.reportProgress(2);
    // A length the engine cannot measure is not a measurement.
    xhr.reportProgress(3, false);
    xhr.respond(200, 'ok', 'text/plain');
    await done;

    // The last progress event can arrive before the last byte is acknowledged.
    expect(seen).toEqual([2, 4]);
  });

  it('refuses a status outside the successful range', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    const done = xhrTransport({ url: '/files' })(uploadRequest());
    FakeXhr.last!.respond(500, 'no');
    await expect(done).rejects.toThrow('Upload failed with status 500');

    const created = xhrTransport({ url: '/files' })(uploadRequest());
    FakeXhr.last!.respond(201, 'made');
    // 201 and 204 are what a file endpoint answers with as often as 200.
    expect(await created).toBe('made');

    const moved = xhrTransport({ url: '/files' })(uploadRequest());
    FakeXhr.last!.respond(302, 'elsewhere');
    await expect(moved).rejects.toThrow('Upload failed with status 302');
  });

  it('gives up when the request is called off', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    const controller = new AbortController();
    const done = xhrTransport({ url: '/files' })(uploadRequest({ signal: controller.signal }));

    controller.abort();
    expect(FakeXhr.last!.aborted).toBe(true);
    await expect(done).rejects.toThrow('Upload cancelled');
  });

  it('takes its url and its headers from the request when they are functions', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    const request = uploadRequest();
    const done = xhrTransport({
      url: (one) => `/files/${one.item.id}`,
      headers: (one) => ({ 'x-name': one.file.name }),
      method: 'PUT',
      raw: true,
    })(request);

    const xhr = FakeXhr.last!;
    expect(xhr.method).toBe('PUT');
    expect(xhr.url).toBe('/files/item-1');
    expect(xhr.headers).toEqual({ 'x-name': 'a.png' });
    // `raw` sends the bytes themselves, which is what a signed object-storage
    // URL expects, rather than wrapping them in a multipart form.
    expect(xhr.sent).toBe(request.body);
    xhr.respond(200, '');
    await done;
  });

  it('goes over fetch when that is what it was asked for', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return Promise.resolve(
        new Response('{"id":"remote-2"}', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    });

    const seen: number[] = [];
    const result = await fetchTransport({
      url: (request) => `/files/${request.item.id}`,
      headers: { 'x-album': 'holiday' },
    })(uploadRequest({ progress: (loaded) => seen.push(loaded) }));

    expect(calls[0]!.url).toBe('/files/item-1');
    expect(calls[0]!.init.headers).toEqual({ 'x-album': 'holiday' });
    expect(calls[0]!.init.credentials).toBe('same-origin');
    expect(result).toEqual({ id: 'remote-2' });
    // Nothing to measure, so the whole body lands at once.
    expect(seen).toEqual([4]);
  });

  it('reads a body as the content type says to read it', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    const done = xhrTransport({ url: '/files' })(uploadRequest());
    // Valid JSON, announced as text. Parsing it anyway turns an id the server
    // wrote as text into a number, which is not the same identifier.
    FakeXhr.last!.respond(200, '42', 'text/plain');
    expect(await done).toBe('42');

    const asJson = xhrTransport({ url: '/files' })(uploadRequest());
    FakeXhr.last!.respond(200, '0042', 'application/json');
    // Malformed JSON from a server that promised JSON is still a fact worth
    // handing back rather than an upload that looks failed.
    expect(await asJson).toBe('0042');
  });

  it('refuses a fetch the server did not accept', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('no', { status: 413 })));
    await expect(fetchTransport({ url: '/files' })(uploadRequest())).rejects.toThrow(
      'Upload failed with status 413',
    );
  });

  it('parses the body the way it was told to', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(
        new Response('id=remote-3', { status: 200, headers: { 'content-type': 'text/plain' } }),
      ),
    );

    const result = await fetchTransport({
      url: '/files',
      // The hook exists for the servers that answer in something other than
      // JSON, and it is asked before the content type is looked at.
      parse: (body, contentType) => ({ body, contentType }),
    })(uploadRequest());

    expect(result).toEqual({ body: 'id=remote-3', contentType: 'text/plain' });
  });
});
