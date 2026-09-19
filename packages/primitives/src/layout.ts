/**
 * Layout — scroll areas, resizable panels, ratio boxes, and the spacing
 * helpers a theme drives.
 *
 * Most of this file computes props and styles rather than behaviour, which is
 * unusual for a headless library and worth saying plainly: `stack`, `flex`,
 * `grid`, `container` and `center` are pure functions, and `createAspectRatio`
 * holds a ratio and nothing more. None of them registers an effect or listens
 * to anything. They exist so that spacing is expressed as tokens the theme
 * resolves, instead of raw pixels scattered through templates.
 *
 * Two of them do carry real interaction:
 *
 *   - `createScrollArea` derives a custom scrollbar's geometry from the
 *     viewport's own scroll offsets, and drags it — while leaving native
 *     scrolling, the wheel and touch momentum entirely alone.
 *   - `createResizable` is APG's window splitter generalised to any number of
 *     panels, in either axis, nestable, with per-panel limits, collapse and
 *     persisted sizes.
 *
 * Nothing here renders. Where a style is emitted it is because the value is
 * arithmetic the consumer cannot do in CSS — a thumb's position, a panel's
 * share of a group — or because the interaction does not work without it, as
 * with `touch-action` on a draggable handle. Everything else is left to the
 * stylesheet.
 *
 * `visuallyHidden` lives in `display.ts`; it is not repeated here.
 */

import { Signal, effect, measureEffect, onCleanup } from '@voltdev/core';
import { createId } from './id.js';

// The proposal's own name for reading without subscribing; Volt adds no second
// spelling for it.
const { untrack } = Signal.subtle;

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

/**
 * A style object rather than a string, so `:spread` merges these declarations
 * into whatever the template set itself instead of replacing the lot.
 */
export type LayoutStyle = Readonly<Record<string, string>>;

export type LayoutPropValue = string | boolean | undefined | LayoutStyle;

export interface LayoutProps {
  readonly [key: string]: LayoutPropValue;
}

/** The axis a layout runs along: `horizontal` is a row, `vertical` a column. */
export type LayoutAxis = 'horizontal' | 'vertical';

// ---------------------------------------------------------------------------
// Spacing and size tokens
// ---------------------------------------------------------------------------

/**
 * A step on a scale — `3`, `'md'`, `'gutter'`. Never a length.
 *
 * Taking raw values here would be easier and would also defeat the point: a
 * theme cannot restyle `gap: 12px`, but it can redefine `--volt-space-3`. The
 * cost is that a one-off value has nowhere to go, and has to be written in the
 * consumer's own stylesheet — which is the right place for it anyway.
 */
export type SpaceToken = string | number;

/** A step on the size scale — a container width, a grid column floor. */
export type SizeToken = string | number;

export const SPACE_PREFIX = '--volt-space-';
export const SIZE_PREFIX = '--volt-size-';

/**
 * The custom property a spacing token refers to.
 *
 * No fallback value is written into the `var()`. A token the theme has not
 * defined makes the declaration invalid at computed-value time, so the
 * property falls back to its initial value and the mistake is visible; a
 * silent fallback of `0` would hide it.
 */
export function spaceVar(token: SpaceToken, prefix: string = SPACE_PREFIX): string {
  return `var(${prefix}${token})`;
}

export function sizeVar(token: SizeToken, prefix: string = SIZE_PREFIX): string {
  return `var(${prefix}${token})`;
}

/** Flow-relative alignment: `start` and `end` follow writing direction. */
export type LayoutAlign = 'start' | 'center' | 'end' | 'stretch' | 'baseline';

export type LayoutJustify =
  | 'start'
  | 'center'
  | 'end'
  | 'between'
  | 'around'
  | 'evenly'
  | 'stretch';

const JUSTIFY: Readonly<Record<LayoutJustify, string>> = Object.freeze({
  start: 'start',
  center: 'center',
  end: 'end',
  between: 'space-between',
  around: 'space-around',
  evenly: 'space-evenly',
  stretch: 'stretch',
});

/** Options every box helper shares. */
export interface BoxOptions {
  /** Gap between children, from the space scale. */
  gap?: SpaceToken;
  /** Overrides `gap` along the block axis. */
  rowGap?: SpaceToken;
  /** Overrides `gap` along the inline axis. */
  columnGap?: SpaceToken;
  /** Padding on all sides, from the space scale. */
  padding?: SpaceToken;
  /** Overrides `padding` along the inline axis. */
  paddingInline?: SpaceToken;
  /** Overrides `padding` along the block axis. */
  paddingBlock?: SpaceToken;
  align?: LayoutAlign;
  justify?: LayoutJustify;
  /** Lay the box out inline, so it sits in a line of text. */
  inline?: boolean;
  /** Space scale prefix, when an application namespaces its own. */
  spacePrefix?: string;
}

function applyBox(style: Record<string, string>, options: BoxOptions): void {
  const prefix = options.spacePrefix ?? SPACE_PREFIX;

  if (options.gap !== undefined) style.gap = spaceVar(options.gap, prefix);
  if (options.rowGap !== undefined) style['row-gap'] = spaceVar(options.rowGap, prefix);
  if (options.columnGap !== undefined) style['column-gap'] = spaceVar(options.columnGap, prefix);

  // Logical properties throughout: `padding-inline` mirrors under `dir="rtl"`
  // where `padding-left` does not.
  if (options.padding !== undefined) style.padding = spaceVar(options.padding, prefix);
  if (options.paddingInline !== undefined) {
    style['padding-inline'] = spaceVar(options.paddingInline, prefix);
  }
  if (options.paddingBlock !== undefined) {
    style['padding-block'] = spaceVar(options.paddingBlock, prefix);
  }

  if (options.align !== undefined) style['align-items'] = options.align;
  if (options.justify !== undefined) style['justify-content'] = JUSTIFY[options.justify];
}

export interface FlexOptions extends BoxOptions {
  /** Default `row`. */
  direction?: 'row' | 'column' | 'row-reverse' | 'column-reverse';
  /** Allow children onto more lines. Default false. */
  wrap?: boolean;
}

/**
 * A flex box.
 *
 *   <div :style="flex({ gap: 3, align: 'center' })">…</div>
 */
export function flex(options: FlexOptions = {}): LayoutStyle {
  const style: Record<string, string> = { display: options.inline ? 'inline-flex' : 'flex' };
  if (options.direction) style['flex-direction'] = options.direction;
  if (options.wrap) style['flex-wrap'] = 'wrap';
  applyBox(style, options);
  return Object.freeze(style);
}

export type StackOptions = Omit<FlexOptions, 'direction'>;

/**
 * A column of children with an even gap — the single most common layout in any
 * application, and the reason the gap belongs on the parent rather than as a
 * margin on each child: margins collapse, do not respond to reordering, and
 * leave a stray one at the end.
 */
export function stack(options: StackOptions = {}): LayoutStyle {
  return flex({ ...options, direction: 'column' });
}

export interface GridOptions extends BoxOptions {
  /** Equal columns, or an explicit track list. */
  columns?: number | string;
  /** Equal rows, or an explicit track list. */
  rows?: number | string;
  /**
   * Fill the row with as many columns as fit, none narrower than this size
   * token. Takes precedence over `columns`.
   */
  minColumn?: SizeToken;
  /** Size scale prefix, when an application namespaces its own. */
  sizePrefix?: string;
}

/**
 * A grid.
 *
 * `minColumn` writes the auto-fitting track list, including the `min()` that
 * stops it overflowing: `minmax(200px, 1fr)` is wider than the grid itself
 * once the viewport is under 200px, and the row scrolls sideways. Wrapping the
 * floor in `min(…, 100%)` is the fix, and it is the sort of thing that has to
 * be remembered every single time — so it is written here once.
 */
export function grid(options: GridOptions = {}): LayoutStyle {
  const style: Record<string, string> = { display: options.inline ? 'inline-grid' : 'grid' };

  if (options.minColumn !== undefined) {
    const floor = sizeVar(options.minColumn, options.sizePrefix ?? SIZE_PREFIX);
    style['grid-template-columns'] = `repeat(auto-fit, minmax(min(${floor}, 100%), 1fr))`;
  } else if (options.columns !== undefined) {
    style['grid-template-columns'] = tracks(options.columns);
  }

  if (options.rows !== undefined) style['grid-template-rows'] = tracks(options.rows);

  applyBox(style, options);
  return Object.freeze(style);
}

function tracks(value: number | string): string {
  return typeof value === 'number' ? `repeat(${Math.max(1, Math.trunc(value))}, 1fr)` : value;
}

export interface ContainerOptions {
  /** Maximum inline size, from the size scale. */
  size?: SizeToken;
  /** Padding along the inline axis, from the space scale. */
  padding?: SpaceToken;
  spacePrefix?: string;
  sizePrefix?: string;
}

/**
 * A centred reading column.
 *
 * `margin-inline: auto` is unconditional: a container that is not centred is
 * just a max-width, and needs no helper. `box-sizing: border-box` is here
 * because the padding must come out of the maximum rather than be added to it
 * — otherwise a "1024px" container is 1024px plus two gutters wide, which is
 * never what was meant.
 */
export function container(options: ContainerOptions = {}): LayoutStyle {
  const style: Record<string, string> = {
    'margin-inline': 'auto',
    'box-sizing': 'border-box',
  };
  if (options.size !== undefined) {
    style['max-inline-size'] = sizeVar(options.size, options.sizePrefix ?? SIZE_PREFIX);
  }
  if (options.padding !== undefined) {
    style['padding-inline'] = spaceVar(options.padding, options.spacePrefix ?? SPACE_PREFIX);
  }
  return Object.freeze(style);
}

export interface CenterOptions {
  gap?: SpaceToken;
  padding?: SpaceToken;
  /** Stack the children instead of putting them in a row. */
  column?: boolean;
  inline?: boolean;
  /** Minimum height, from the size scale — for centring in a fixed area. */
  minBlockSize?: SizeToken;
  spacePrefix?: string;
  sizePrefix?: string;
}

/** Children centred on both axes. */
export function center(options: CenterOptions = {}): LayoutStyle {
  const style: Record<string, string> = {
    display: options.inline ? 'inline-flex' : 'flex',
    'align-items': 'center',
    'justify-content': 'center',
  };
  if (options.column) style['flex-direction'] = 'column';
  if (options.gap !== undefined) {
    style.gap = spaceVar(options.gap, options.spacePrefix ?? SPACE_PREFIX);
  }
  if (options.padding !== undefined) {
    style.padding = spaceVar(options.padding, options.spacePrefix ?? SPACE_PREFIX);
  }
  if (options.minBlockSize !== undefined) {
    style['min-block-size'] = sizeVar(options.minBlockSize, options.sizePrefix ?? SIZE_PREFIX);
  }
  return Object.freeze(style);
}

// ---------------------------------------------------------------------------
// Aspect ratio
// ---------------------------------------------------------------------------

/**
 * `16 / 9` as a pair, or `1.7778` as a single number.
 *
 * The pair is preferred and is why this is not simply `number`: `16 / 9`
 * evaluated in JavaScript is a repeating decimal, and rounding it puts a
 * fraction of a pixel of letterboxing into every video on the page. Given the
 * pair, the browser does the division at full precision.
 */
export type AspectRatioValue = number | readonly [number, number];

/** How replaced content is fitted into the box. */
export type AspectRatioFit = 'cover' | 'contain' | 'fill' | 'none' | 'scale-down';

export interface AspectRatioOptions {
  /**
   * Supply a signal to control the ratio from outside — a player switching
   * between 16:9 and 4:3. Without one it owns its own.
   */
  ratio?: Signal.State<AspectRatioValue>;
  defaultRatio?: AspectRatioValue;
  /** Default `cover`. */
  fit?: AspectRatioFit;
  onRatioChange?: (ratio: AspectRatioValue) => void;
}

export interface AspectRatio {
  ratio(): AspectRatioValue;
  setRatio(ratio: AspectRatioValue): void;
  /** The ratio as a single number, or null when it cannot be used. */
  value(): number | null;
  /** Just the declaration, for `:style`. */
  style(): LayoutStyle;
  rootProps(): LayoutProps;
  /** For an `<img>`, `<video>` or `<iframe>` filling the box. */
  contentProps(): LayoutProps;
}

/**
 * A box that keeps its shape.
 *
 *   <div :spread="ratio.rootProps()">
 *     <img :spread="ratio.contentProps()" src="…" alt="…">
 *   </div>
 *
 * `aspect-ratio` is the whole implementation. The padding-top trick it replaces
 * needed a wrapper, absolute positioning, and could only ever derive height
 * from width; `aspect-ratio` works from whichever dimension is constrained, so
 * the same box behaves in a grid row of fixed height.
 */
export function createAspectRatio(options: AspectRatioOptions = {}): AspectRatio {
  const state = options.ratio ?? new Signal.State<AspectRatioValue>(options.defaultRatio ?? 1);
  const fit = options.fit ?? 'cover';

  const declaration = (): string => {
    const raw = state.get();
    if (ratioOf(raw) === null) return 'auto';
    // The pair is written as CSS writes it, so the browser divides rather than
    // this doing it and handing over a rounded decimal.
    return typeof raw === 'number' ? String(raw) : `${raw[0]} / ${raw[1]}`;
  };

  return {
    ratio: () => state.get(),
    setRatio: (next) => {
      state.set(next);
      options.onRatioChange?.(next);
    },
    value: () => ratioOf(state.get()),

    style: () => Object.freeze({ 'aspect-ratio': declaration() }),

    rootProps: () => {
      const ratio = declaration();
      return { 'data-ratio': ratio, style: { 'aspect-ratio': ratio } };
    },

    contentProps: () => ({
      style: {
        // Replaced content ignores the parent's shape unless told to fill it,
        // and then distorts unless told how. `display: block` removes the
        // inline baseline gap that otherwise shows as a few pixels of
        // background below the image.
        display: 'block',
        'inline-size': '100%',
        'block-size': '100%',
        'object-fit': fit,
      },
    }),
  };
}

/**
 * A ratio as one number, or null when it is not one a box can have.
 *
 * Zero, a negative, a NaN, or a pair over a zero denominator would all reach
 * CSS as a box with no height and nothing on the page to say why. Refusing
 * them leaves the box sized by its content, which is at least visible.
 */
function ratioOf(raw: AspectRatioValue): number | null {
  const n = typeof raw === 'number' ? raw : raw[0] / raw[1];
  return Number.isFinite(n) && n > 0 ? n : null;
}

// ---------------------------------------------------------------------------
// Scroll area
// ---------------------------------------------------------------------------

/** Marks the thumb, so a press on it is not mistaken for a press on the track. */
export const SCROLL_THUMB_ATTRIBUTE = 'data-volt-scroll-thumb';

/** Thumb length along the scrollbar, already clamped to the minimum. */
export const SCROLL_THUMB_SIZE_PROPERTY = '--volt-scroll-thumb-size';

/** Thumb distance from the track's start, allowing for the thumb's own length. */
export const SCROLL_THUMB_OFFSET_PROPERTY = '--volt-scroll-thumb-offset';

/**
 * Sub-pixel slack before content counts as overflowing.
 *
 * A box whose content is exactly as tall as it is routinely reports a
 * `scrollHeight` a fraction larger, because layout rounds. Without slack the
 * scrollbar appears and disappears as the window resizes past a half pixel.
 */
const OVERFLOW_TOLERANCE = 1;

export type ScrollAreaAxisName = 'vertical' | 'horizontal';

export interface ScrollAreaLabels {
  /** Default "Vertical scrollbar". */
  verticalScrollbar?: string;
  /** Default "Horizontal scrollbar". */
  horizontalScrollbar?: string;
  /** Names the viewport when it is focusable. No default: see `viewportProps`. */
  viewport?: string;
  /** A spoken position — "a third of the way down" beats "33". No default. */
  scrollPosition?: (percent: number, axis: ScrollAreaAxisName) => string;
}

export interface ScrollAreaOptions {
  /** The element that actually scrolls. */
  viewport: () => Element | null | undefined;
  /**
   * The content inside the viewport. Only used to notice it growing; without
   * it, a change in content length is picked up on the next scroll, resize, or
   * call to `measure`.
   */
  content?: () => Element | null | undefined;

  /** The vertical scrollbar track, for the arithmetic a drag needs. */
  verticalScrollbar?: () => Element | null | undefined;
  horizontalScrollbar?: () => Element | null | undefined;

  /** Shortest the thumb may get, in px. Default 20. */
  minThumbSize?: number;
  /** How far one arrow press scrolls, in px. Default 40. */
  step?: number;
  /** How much of the current view a page press keeps, in px. Default 40. */
  pageOverlap?: number;
  /** A press on the track pages towards the pointer, or jumps to it. Default `page`. */
  trackPointer?: 'page' | 'jump';

  /**
   * Hide the platform's own scrollbars with `scrollbar-width: none`. Default
   * true. Note what this deliberately does not do: set `overflow`. The
   * viewport stays whatever the stylesheet made it.
   */
  hideNativeScrollbar?: boolean;
  /** How long after the last scroll the bars still count as active, in ms. Default 600. */
  hideDelay?: number;
  /** Put the scrollbars in the tab order. Default false — see `scrollbarProps`. */
  focusableScrollbars?: boolean;

  /** Overrides the writing direction rather than reading it from the DOM. */
  dir?: 'ltr' | 'rtl';
  labels?: ScrollAreaLabels;
  onScroll?: (position: { top: number; left: number }) => void;
}

export interface ScrollAreaAxis {
  /** Whether there is anything to scroll on this axis. */
  overflows(): boolean;
  /** Visible length along this axis, in px. */
  viewportSize(): number;
  /** Total content length along this axis, in px. */
  scrollSize(): number;
  /** How far it can travel, in px. */
  range(): number;
  /**
   * Distance from the start of the content, in px.
   *
   * Logical, not `scrollLeft`: in a right-to-left document `scrollLeft` starts
   * at zero and runs negative, so a consumer written against it gets the sign
   * wrong exactly once, in the language they do not test in. This counts up
   * from the inline start in both directions.
   */
  offset(): number;
  /** 0 at the start, 1 at the end. */
  progress(): number;
  /** Thumb length as a fraction of the track, before the minimum applies. */
  thumbSize(): number;

  scrollTo(offset: number): void;
  scrollBy(delta: number): void;

  /** Handle a keydown. Returns true when it was consumed. */
  onKeyDown(event: KeyboardEvent): boolean;
  onThumbPointerDown(event: PointerEvent): void;
  onTrackPointerDown(event: PointerEvent): void;

  scrollbarProps(): LayoutProps;
  thumbProps(): LayoutProps;
}

export interface ScrollArea {
  vertical: ScrollAreaAxis;
  horizontal: ScrollAreaAxis;
  /** Whether either axis overflows. */
  overflows(): boolean;
  /** Whether both do, so the corner between them has something to cover. */
  hasCorner(): boolean;
  /** True during a scroll and for `hideDelay` after it, for overlay bars. */
  isScrolling(): boolean;
  isDragging(): boolean;
  /** Re-read the geometry, for content that changed without resizing. */
  measure(): void;

  viewportProps(): LayoutProps;
  cornerProps(): LayoutProps;
}

interface ScrollGeometry {
  readonly top: number;
  readonly left: number;
  readonly clientWidth: number;
  readonly clientHeight: number;
  readonly scrollWidth: number;
  readonly scrollHeight: number;
}

const EMPTY_GEOMETRY: ScrollGeometry = Object.freeze({
  top: 0,
  left: 0,
  clientWidth: 0,
  clientHeight: 0,
  scrollWidth: 0,
  scrollHeight: 0,
});

/**
 * A scroll area with scrollbars of your own.
 *
 *   class Log {
 *     viewport = new Signal.State<Element | null>(null);
 *     bar = new Signal.State<Element | null>(null);
 *     area = createScrollArea({
 *       viewport: () => this.viewport.get(),
 *       verticalScrollbar: () => this.bar.get(),
 *     });
 *   }
 *
 *   <div :ref="viewport" :spread="area.viewportProps()">…</div>
 *   <div :if="area.vertical.overflows()" :ref="bar"
 *        :spread="area.vertical.scrollbarProps()"
 *        :pointerdown="area.vertical.onTrackPointerDown($event)"
 *        :keydown="area.vertical.onKeyDown($event)">
 *     <div :spread="area.vertical.thumbProps()"
 *          :pointerdown="area.vertical.onThumbPointerDown($event)"></div>
 *   </div>
 *
 * The one rule this is built around: **the viewport keeps scrolling itself.**
 * The usual way to fake a scrollbar — `overflow: hidden` plus a transform
 * driven from wheel events — breaks the wheel's own acceleration curve, touch
 * momentum, trackpad rubber-banding, keyboard scrolling, scroll anchoring,
 * find-in-page, and every `scrollIntoView` in the application. So the native
 * scroll stays exactly as it is, the platform's bars are hidden with
 * `scrollbar-width: none`, and this reads the resulting offsets back. The
 * `scroll` listener is registered passive, which is what tells the browser it
 * is safe to keep scrolling on the compositor thread.
 *
 * The thumb's length and position are emitted as custom properties rather than
 * as `block-size` and `inset-block-start`, so positioning stays the
 * stylesheet's business. They are already-complete CSS expressions:
 *
 *   .thumb { block-size: var(--volt-scroll-thumb-size);
 *            inset-block-start: var(--volt-scroll-thumb-offset); }
 *
 * The percentages inside them resolve against the track at layout time, which
 * is deliberate: it means the thumb stays correct when the track changes size
 * without anything here having to measure it.
 */
export function createScrollArea(options: ScrollAreaOptions): ScrollArea {
  const viewportId = createId('scroll-viewport');
  const minThumb = Math.max(0, options.minThumbSize ?? 20);
  const step = options.step ?? 40;
  const pageOverlap = options.pageOverlap ?? 40;
  const hideDelay = options.hideDelay ?? 600;

  const geometry = new Signal.State<ScrollGeometry>(EMPTY_GEOMETRY);
  const scrolling = new Signal.State(false);
  const dragging = new Signal.State<ScrollAreaAxisName | null>(null);

  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let stopDrag: (() => void) | null = null;

  const rtl = (): boolean =>
    options.dir ? options.dir === 'rtl' : isRtl(options.viewport() ?? null);

  const markScrolling = () => {
    scrolling.set(true);
    if (idleTimer !== null) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      scrolling.set(false);
      idleTimer = null;
    }, hideDelay);
  };

  const measure = () => {
    const el = options.viewport();
    if (!el) return;

    const next: ScrollGeometry = {
      top: el.scrollTop,
      left: el.scrollLeft,
      clientWidth: el.clientWidth,
      clientHeight: el.clientHeight,
      scrollWidth: el.scrollWidth,
      scrollHeight: el.scrollHeight,
    };
    const previous = untrack(() => geometry.get());
    // Reusing the old object when nothing moved keeps a resize observer that
    // fires on every animation frame from waking every reader.
    if (sameGeometry(previous, next)) return;

    geometry.set(next);

    if (previous.top !== next.top || previous.left !== next.left) {
      markScrolling();
      // Reported from here rather than from the listener so that a
      // programmatic scroll reports once, and the browser's own event that
      // follows it — which finds nothing changed — does not report again.
      options.onScroll?.({ top: next.top, left: next.left });
    }
  };

  // Six geometry reads in one go, so the phase that pays for the layout is
  // the one that gets them. Every later measurement comes from a scroll or a
  // resize, which is outside any flush and has no phase to belong to.
  measureEffect(() => {
    const el = options.viewport();
    if (!el) return;

    measure();

    const onScroll = () => measure();
    // Passive: this handler never prevents anything, and saying so is what
    // lets the browser keep touch momentum off the main thread.
    el.addEventListener('scroll', onScroll, { passive: true });
    onCleanup(() => el.removeEventListener('scroll', onScroll));

    observeSize(el, measure);
    // The viewport's own size does not change when the content inside it
    // grows, so the content is watched too when it has been handed over.
    const inner = options.content?.();
    if (inner) observeSize(inner, measure);
  });

  onCleanup(() => {
    if (idleTimer !== null) clearTimeout(idleTimer);
    // A drag runs from an event handler, outside any reactive scope, so its
    // listeners are not anyone else's to clean up.
    stopDrag?.();
  });

  const makeAxis = (name: ScrollAreaAxisName): ScrollAreaAxis => {
    const vertical = name === 'vertical';

    const viewportSize = () =>
      vertical ? geometry.get().clientHeight : geometry.get().clientWidth;
    const scrollSize = () => (vertical ? geometry.get().scrollHeight : geometry.get().scrollWidth);
    const range = () => Math.max(0, scrollSize() - viewportSize());
    const overflows = () => range() > OVERFLOW_TOLERANCE;

    const offset = () => {
      const g = geometry.get();
      const raw = vertical ? g.top : rtl() ? -g.left : g.left;
      return clamp(raw, 0, range());
    };

    const progress = () => {
      const travel = range();
      return travel > 0 ? clamp(offset() / travel, 0, 1) : 0;
    };

    const thumbSize = () => {
      const total = scrollSize();
      return total > 0 ? clamp(viewportSize() / total, 0, 1) : 1;
    };

    const scrollTo = (next: number) => {
      const el = options.viewport();
      if (!el || !Number.isFinite(next)) return;
      const target = clamp(next, 0, range());
      if (vertical) el.scrollTop = target;
      else el.scrollLeft = rtl() ? -target : target;
      // The property is applied synchronously; the event is not. Measuring now
      // keeps the thumb in step with the same frame the press happened in.
      measure();
    };

    const track = (thumb: Element): Element | null => {
      const declared = vertical ? options.verticalScrollbar?.() : options.horizontalScrollbar?.();
      // Falling back to the parent is a guess about markup, and it is only a
      // measurement: getting it wrong scales the drag slightly, it does not
      // break it. Passing the accessor removes the guess.
      return declared ?? thumb.parentElement;
    };

    /** How far along the track a press landed, counting from its start. */
    const pointerAlong = (event: PointerEvent, rect: DOMRect): number => {
      if (vertical) return event.clientY - rect.top;
      // In a right-to-left document the track starts at its right edge.
      return rtl() ? rect.right - event.clientX : event.clientX - rect.left;
    };

    return {
      overflows,
      viewportSize,
      scrollSize,
      range,
      offset,
      progress,
      thumbSize,
      scrollTo,
      scrollBy: (delta) => scrollTo(offset() + delta),

      onKeyDown(event) {
        // A modified key is a browser shortcut, not a scroll.
        if (event.ctrlKey || event.metaKey || event.altKey) return false;

        const travel = range();
        if (travel <= 0) return false;

        // Never a whole viewport: a page that scrolls by exactly its own
        // height leaves the reader with no line in common between the two, and
        // no way to tell whether anything was skipped.
        const page = Math.max(step, viewportSize() - pageOverlap);
        const forwardKey = vertical ? 'ArrowDown' : rtl() ? 'ArrowLeft' : 'ArrowRight';
        const backKey = vertical ? 'ArrowUp' : rtl() ? 'ArrowRight' : 'ArrowLeft';

        let next: number;
        switch (event.key) {
          case forwardKey:
            next = offset() + step;
            break;
          case backKey:
            next = offset() - step;
            break;
          case 'PageDown':
            next = offset() + page;
            break;
          case 'PageUp':
            next = offset() - page;
            break;
          case 'Home':
            next = 0;
            break;
          case 'End':
            next = travel;
            break;
          case ' ':
            // Space pages down and Shift+Space pages up, as every browser
            // does — but only on the vertical axis, where that is what it
            // means.
            if (!vertical) return false;
            next = offset() + (event.shiftKey ? -page : page);
            break;
          default:
            return false;
        }

        scrollTo(next);
        // Otherwise the arrows scroll the page behind as well, and the area
        // moves twice as far as it was asked to.
        event.preventDefault();
        return true;
      },

      onThumbPointerDown(event) {
        // The middle and right buttons open menus and paste; neither drags.
        if (event.button !== 0 || !event.isPrimary) return;
        if (untrack(() => dragging.get()) !== null) return;

        const thumb = event.currentTarget;
        if (!(thumb instanceof HTMLElement)) return;

        const trackEl = track(thumb);
        const trackRect = trackEl?.getBoundingClientRect();
        const thumbRect = thumb.getBoundingClientRect();
        if (!trackRect) return;

        const trackLength = vertical ? trackRect.height : trackRect.width;
        const thumbLength = vertical ? thumbRect.height : thumbRect.width;
        // What the pointer has to cross for the content to travel its full
        // range: the track, less the thumb that sits in it.
        const usable = trackLength - thumbLength;
        const travel = range();
        if (usable <= 0 || travel <= 0) return;

        // Without this the browser starts a text selection, and a drag that
        // began on the thumb ends up highlighting half the page.
        event.preventDefault();

        const startPointer = vertical ? event.clientY : event.clientX;
        const startOffset = offset();
        // Rightwards moves the content towards its start in a right-to-left
        // document, so the pointer delta is mirrored with the axis.
        const sign = !vertical && rtl() ? -1 : 1;

        thumb.setPointerCapture?.(event.pointerId);
        dragging.set(name);

        const onMove = (move: PointerEvent) => {
          if (move.pointerId !== event.pointerId) return;
          const moved = ((vertical ? move.clientY : move.clientX) - startPointer) * sign;
          // Measured from where the drag started rather than accumulated from
          // the last move: an accumulated delta drifts, because every step is
          // clamped at the ends and the clamped-off remainder is never given
          // back when the pointer comes away from the edge.
          scrollTo(startOffset + (moved * travel) / usable);
        };

        const onCancelKey = (key: KeyboardEvent) => {
          if (key.key !== 'Escape') return;
          scrollTo(startOffset);
          stop();
        };

        const stop = () => {
          thumb.removeEventListener('pointermove', onMove);
          thumb.removeEventListener('pointerup', stop);
          thumb.removeEventListener('pointercancel', stop);
          thumb.removeEventListener('lostpointercapture', stop);
          document.removeEventListener('keydown', onCancelKey, true);
          if (thumb.hasPointerCapture?.(event.pointerId)) {
            thumb.releasePointerCapture(event.pointerId);
          }
          dragging.set(null);
          stopDrag = null;
        };

        thumb.addEventListener('pointermove', onMove);
        thumb.addEventListener('pointerup', stop);
        thumb.addEventListener('pointercancel', stop);
        // The browser can take a capture away — another element grabbing it, a
        // gesture being recognised — and the drag has to end when it does.
        thumb.addEventListener('lostpointercapture', stop);
        document.addEventListener('keydown', onCancelKey, true);
        stopDrag = stop;
      },

      onTrackPointerDown(event) {
        if (event.button !== 0 || !event.isPrimary) return;
        // The thumb's own handler owns presses that land on it, and this one
        // runs as well because the press bubbles out through the track.
        const target = event.target;
        if (target instanceof Element && target.closest(`[${SCROLL_THUMB_ATTRIBUTE}]`)) return;

        const trackEl = event.currentTarget;
        if (!(trackEl instanceof HTMLElement)) return;

        const rect = trackEl.getBoundingClientRect();
        const trackLength = vertical ? rect.height : rect.width;
        const travel = range();
        if (trackLength <= 0 || travel <= 0) return;

        event.preventDefault();

        const pointer = pointerAlong(event, rect);
        const thumbLength = Math.max(minThumb, thumbSize() * trackLength);
        const usable = Math.max(1, trackLength - thumbLength);

        if (options.trackPointer === 'jump') {
          // Centre the thumb under the pointer, rather than putting its start
          // there — otherwise the content jumps half a thumb further than the
          // place that was pointed at.
          scrollTo(((pointer - thumbLength / 2) / usable) * travel);
          return;
        }

        const thumbStart = usable * progress();
        const page = Math.max(step, viewportSize() - pageOverlap);
        if (pointer < thumbStart) scrollTo(offset() - page);
        else if (pointer > thumbStart + thumbLength) scrollTo(offset() + page);
      },

      scrollbarProps: () => {
        const percent = Math.round(progress() * 100);
        const label =
          name === 'vertical'
            ? (options.labels?.verticalScrollbar ?? 'Vertical scrollbar')
            : (options.labels?.horizontalScrollbar ?? 'Horizontal scrollbar');

        return {
          role: 'scrollbar',
          // Required on a scrollbar, and the reason the viewport carries an id
          // whether or not the consumer wanted one.
          'aria-controls': viewportId,
          'aria-orientation': name,
          'aria-valuemin': '0',
          'aria-valuemax': '100',
          'aria-valuenow': String(percent),
          'aria-valuetext': options.labels?.scrollPosition?.(percent, name),
          'aria-label': label,
          'aria-disabled': overflows() ? undefined : 'true',
          // Not in the tab order by default. The viewport is focusable and the
          // platform already scrolls it with the arrows, so a second tab stop
          // per scroll area buys nothing and costs a keypress on every one of
          // them. Applications that replace scrolling entirely want this on.
          tabindex: options.focusableScrollbars && overflows() ? '0' : undefined,
          'data-orientation': name,
          'data-state': scrolling.get() || dragging.get() !== null ? 'scrolling' : 'idle',
          'data-overflow': overflows() ? '' : undefined,
          'data-dragging': dragging.get() === name ? '' : undefined,
        };
      },

      thumbProps: () => {
        // The minimum is applied in CSS rather than here because only the
        // browser knows how long the track is, and `max()` of a length and a
        // percentage is exactly the clamp wanted. The offset then subtracts
        // the same expression, so a thumb held at its minimum still stops at
        // the end of the track instead of running past it.
        const size = `max(${css(minThumb)}px, ${css(thumbSize() * 100)}%)`;
        return {
          [SCROLL_THUMB_ATTRIBUTE]: '',
          'data-orientation': name,
          'data-dragging': dragging.get() === name ? '' : undefined,
          style: {
            [SCROLL_THUMB_SIZE_PROPERTY]: size,
            [SCROLL_THUMB_OFFSET_PROPERTY]: `calc((100% - ${size}) * ${css(progress())})`,
            // A touch that starts on the thumb must drag it. Without this the
            // browser claims the gesture for scrolling and the drag never gets
            // a second event. It is scoped to the thumb: the viewport must
            // keep its default `touch-action` or touch scrolling dies with it.
            'touch-action': 'none',
          },
        };
      },
    };
  };

  const vertical = makeAxis('vertical');
  const horizontal = makeAxis('horizontal');

  return {
    vertical,
    horizontal,
    overflows: () => vertical.overflows() || horizontal.overflows(),
    hasCorner: () => vertical.overflows() && horizontal.overflows(),
    isScrolling: () => scrolling.get() || dragging.get() !== null,
    isDragging: () => dragging.get() !== null,
    measure,

    viewportProps: () => {
      const label = options.labels?.viewport;
      const props: Record<string, LayoutPropValue> = {
        id: viewportId,
        // Only once there is something to scroll. A scroll container that
        // cannot scroll is a tab stop that does nothing, and adding one to
        // every panel on a page is a real cost to a keyboard user. WCAG asks
        // for the tab stop precisely when the content is scrollable, which is
        // what this reads.
        tabindex: vertical.overflows() || horizontal.overflows() ? '0' : undefined,
        'data-overflow-x': horizontal.overflows() ? '' : undefined,
        'data-overflow-y': vertical.overflows() ? '' : undefined,
      };

      // A focusable element with no accessible name is announced as nothing at
      // all. `group` rather than `region` because a region is a landmark, and
      // a page of scrollable panels should not be a page of landmarks.
      if (label) {
        props.role = 'group';
        props['aria-label'] = label;
      }

      if (options.hideNativeScrollbar !== false) {
        props.style = { 'scrollbar-width': 'none' };
      }
      return props;
    },

    cornerProps: () => ({
      // Decoration filling the square where the two bars meet. It has no
      // meaning and nothing to announce.
      'aria-hidden': 'true',
      'data-volt-scroll-corner': '',
    }),
  };
}

function sameGeometry(a: ScrollGeometry, b: ScrollGeometry): boolean {
  return (
    a.top === b.top &&
    a.left === b.left &&
    a.clientWidth === b.clientWidth &&
    a.clientHeight === b.clientHeight &&
    a.scrollWidth === b.scrollWidth &&
    a.scrollHeight === b.scrollHeight
  );
}

// ---------------------------------------------------------------------------
// Resizable
// ---------------------------------------------------------------------------

/**
 * Marks a handle and carries its index, for CSS and for finding one.
 *
 * Nothing here reads it. Handlers are wired per handle rather than delegated
 * from the group, which is exactly what lets one group nest inside another
 * without an event on the inner handle reaching the outer group's listener.
 */
export const RESIZABLE_HANDLE_ATTRIBUTE = 'data-volt-resizable-handle';

/** One panel's share of the group, as a percentage. */
export const RESIZABLE_SIZE_PROPERTY = '--volt-resizable-size';

/** Every panel's share as an `fr` track, with an `auto` track between each pair, for a grid. */
export const RESIZABLE_TEMPLATE_PROPERTY = '--volt-resizable-template';

/** Percentage points below which two sizes are the same size. */
const SIZE_EPSILON = 0.01;

export interface ResizablePanel {
  /** Smallest share, as a percentage of the group. Default 0. */
  min?: number;
  /** Largest share, as a percentage of the group. Default 100. */
  max?: number;
  /** Starting share. Unset panels split whatever the set ones leave. */
  defaultSize?: number;
  /** Can be collapsed out of the way, leaving only its handle. */
  collapsible?: boolean;
  /** Share when collapsed. Default 0. Never more than `min`. */
  collapsedSize?: number;
}

export interface ResizableLabels {
  /** Names a handle. Default "Resize panel N". */
  handle?: (index: number) => string;
  /** A spoken size. Default "N percent". */
  valueText?: (size: number, index: number) => string;
}

/** The two methods this needs from `Storage`, so a test can pass a fake. */
export interface ResizableStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface ResizableOptions {
  /** One entry per panel, in order. Fixed for the life of the group. */
  panels: readonly ResizablePanel[];
  /** The element the panels sit in — measured to turn a drag into a share. */
  group: () => Element | null | undefined;

  /** Which way the panels are laid out. Default `horizontal`, i.e. a row. */
  orientation?: LayoutAxis;

  /**
   * Supply a signal to control the sizes from outside. Without one it owns
   * them. Percentages, one per panel, summing to 100.
   */
  sizes?: Signal.State<number[]>;

  /** Percentage points one arrow press moves. Default 1. */
  step?: number;
  /** Percentage points a shifted arrow press moves. Default 10. */
  largeStep?: number;

  /**
   * How far past its minimum a collapsible panel must be pushed before it
   * collapses, in percentage points. Defaults to half the distance between its
   * minimum and its collapsed size.
   */
  collapseThreshold?: number;

  /**
   * Remember the sizes under this key. Nothing is stored without one. A usable
   * stored layout is read back when the group is created — into the `sizes`
   * signal, when one was handed in.
   */
  storageKey?: string;
  /** Default `localStorage`. */
  storage?: ResizableStorage;

  /** Overrides the writing direction rather than reading it from the DOM. */
  dir?: 'ltr' | 'rtl';
  labels?: ResizableLabels;

  onSizesChange?: (sizes: number[]) => void;
  onCollapse?: (index: number) => void;
  onExpand?: (index: number) => void;
}

export interface ResizableHandleOptions {
  /** Accessible name for this handle, overriding the label default. */
  label?: string;
  /** Id of an element that already names it. Preferred over `label`. */
  labelledBy?: string;
  /** This boundary cannot be moved. */
  disabled?: boolean;
}

export interface Resizable {
  /** The axis the panels are laid out along. */
  orientation(): LayoutAxis;
  /** The direction each separator line runs — the perpendicular. */
  separatorOrientation(): LayoutAxis;

  sizes(): readonly number[];
  size(index: number): number;
  setSizes(sizes: readonly number[]): void;

  isCollapsed(index: number): boolean;
  collapse(index: number): void;
  expand(index: number): void;
  toggleCollapse(index: number): void;

  /** Move the boundary after panel `index` by `delta` percentage points. */
  resize(index: number, delta: number): void;
  /** Set one panel's size directly, taking the difference from its neighbours. */
  resizeTo(index: number, size: number): void;
  /** Back to the declared defaults. */
  reset(): void;

  isDragging(): boolean;
  /** Which boundary is being dragged, or null. */
  activeHandle(): number | null;

  groupProps(): LayoutProps;
  panelProps(index: number): LayoutProps;
  /** `index` is the boundary between panel `index` and panel `index + 1`. */
  handleProps(index: number, options?: ResizableHandleOptions): LayoutProps;

  /** Handle a keydown on handle `index`. Returns true when it was consumed. */
  onHandleKeyDown(index: number, event: KeyboardEvent): boolean;
  onHandlePointerDown(index: number, event: PointerEvent): void;
  onHandleDoubleClick(index: number, event: MouseEvent): void;
}

interface PanelLimits {
  readonly min: number;
  readonly max: number;
  readonly collapsible: boolean;
  readonly collapsed: number;
}

/**
 * Panels a splitter moves between.
 *
 *   <div :ref="group" :spread="split.groupProps()">
 *     <div :spread="split.panelProps(0)">…</div>
 *     <div :spread="split.handleProps(0, { label: 'Resize sidebar' })"
 *          :keydown="split.onHandleKeyDown(0, $event)"
 *          :pointerdown="split.onHandlePointerDown(0, $event)"></div>
 *     <div :spread="split.panelProps(1)">…</div>
 *   </div>
 *
 * Sizes are percentages of the group, held as an array that always sums to
 * 100. That is what makes a group survive a window resize without any
 * measurement, and it is what `aria-valuenow` wants to say. The cost is that a
 * limit cannot be expressed in pixels — "this sidebar never goes below 200px"
 * has to become a percentage the application computes for the width it has.
 *
 * A word on `aria-orientation`, because the two readings of "horizontal"
 * disagree here and libraries differ on which they use. A separator's
 * orientation in ARIA describes the line, not the movement — the same rule
 * that makes `<hr>` horizontal. So a horizontal group, whose panels sit side
 * by side, is divided by *vertical* separators, and it is Left and Right that
 * move them. `orientation` names the group's axis, `aria-orientation` reports
 * the line, and `separatorOrientation()` is there when a consumer needs the
 * same answer.
 *
 * Nesting works because there is no shared state and nothing is delegated from
 * the group: each handle carries its own handlers, so an event on an inner
 * handle bubbles out past the outer group with nothing there to act on it.
 *
 * This does not compose `createSeparator`, which covers the same ARIA and a
 * near-identical key map for one pane. It cannot: that primitive owns a single
 * number, and a group of panels owns an array with a sum to keep. Driving it
 * from a mirror signal would mean two copies of the same fact — and a cascade
 * that applies less than it was asked for would immediately disagree with the
 * mirror. One source of truth is worth the duplicated key map.
 */
export function createResizable(options: ResizableOptions): Resizable {
  const orientation = options.orientation ?? 'horizontal';
  const separatorOrientation: LayoutAxis =
    orientation === 'horizontal' ? 'vertical' : 'horizontal';
  const count = options.panels.length;
  const step = options.step ?? 1;
  const largeStep = options.largeStep ?? 10;

  const groupId = createId('resizable');
  const panelIds = options.panels.map((_, index) => `${groupId}-panel-${index}`);

  const limits: PanelLimits[] = options.panels.map((panel) => {
    const min = clamp(panel.min ?? 0, 0, 100);
    const max = clamp(panel.max ?? 100, min, 100);
    // A collapsed panel is smaller than its minimum by definition; a collapsed
    // size above the minimum would mean collapsing made it bigger.
    const collapsed = panel.collapsible ? clamp(panel.collapsedSize ?? 0, 0, min) : min;
    return { min, max, collapsible: Boolean(panel.collapsible), collapsed };
  });

  const defaults = normalise(distributeDefaults(options.panels, limits), limits);

  const storage = resolveStorage(options);
  const stored = loadSizes(storage, options.storageKey, limits);
  const state = options.sizes ?? new Signal.State<number[]>(stored ?? defaults);
  // A controlled group is stored like any other, so it is restored like any
  // other: otherwise it saves a layout that nothing ever reads back. Not
  // reported through `onSizesChange`, any more than an owned group's restored
  // layout is — nobody moved a boundary.
  if (options.sizes && stored) options.sizes.set(stored);

  const dragging = new Signal.State<number | null>(null);

  /**
   * The size to give a panel back when it is expanded.
   *
   * Not persisted: only the sizes are stored, so after a reload an expand goes
   * to the panel's minimum instead of the size it had before it was collapsed.
   * Storing it would mean a second stored shape to validate and migrate, for a
   * detail nobody notices twice.
   */
  const restore = new Map<number, number>();

  let stopDrag: (() => void) | null = null;
  let lastStored: string | null = null;

  const sizes = (): readonly number[] => state.get();

  const commit = (next: number[]) => {
    const current = untrack(() => state.get());
    if (sameSizes(current, next)) return;
    state.set(next);
    options.onSizesChange?.(next);
  };

  /** Whether panel `index` is at or under its collapsed size in `source`. */
  const collapsedIn = (source: readonly number[], index: number): boolean => {
    const limit = limits[index];
    if (!limit?.collapsible) return false;
    return (source[index] ?? 0) <= limit.collapsed + SIZE_EPSILON;
  };

  const isCollapsed = (index: number): boolean => collapsedIn(sizes(), index);

  /** The panel a handle collapses: the one it names, or the one after it. */
  const collapsibleAt = (index: number): number => {
    if (limits[index]?.collapsible) return index;
    if (limits[index + 1]?.collapsible) return index + 1;
    return -1;
  };

  /**
   * What each panel may currently do.
   *
   * A collapsed panel's ceiling is its collapsed size, so an ordinary drag
   * cannot inch it open to a width below its own minimum; it opens by crossing
   * the threshold, in one step, to a size it is allowed to have.
   */
  const bounds = (source: readonly number[]): { floor: number; ceiling: number }[] =>
    limits.map((limit, index) => {
      const collapsedNow =
        limit.collapsible && (source[index] ?? 0) <= limit.collapsed + SIZE_EPSILON;
      return {
        floor: collapsedNow ? limit.collapsed : limit.min,
        ceiling: collapsedNow ? limit.collapsed : limit.max,
      };
    });

  const thresholdFor = (index: number): number => {
    if (options.collapseThreshold !== undefined) return Math.max(0, options.collapseThreshold);
    const limit = limits[index];
    if (!limit) return 0;
    return Math.max(SIZE_EPSILON, (limit.min - limit.collapsed) / 2);
  };

  /**
   * Move the boundary after `index` by `delta`, starting from `source`.
   *
   * The delta is always applied to a remembered starting point rather than to
   * the live sizes. During a drag that is what stops the pointer and the
   * boundary drifting apart: every intermediate position is clamped, and an
   * incremental model throws the clamped-off remainder away, so dragging into
   * a limit and back out again leaves the boundary short by however far it was
   * pushed past it.
   */
  const applyFrom = (source: readonly number[], index: number, delta: number): number[] => {
    if (index < 0 || index >= count - 1 || !Number.isFinite(delta)) return [...source];

    const bound = bounds(source);
    const { sizes: moved, applied } = moveBoundary(source, index, delta, bound);
    const overshoot = Math.abs(delta) - applied;
    if (overshoot <= SIZE_EPSILON) return moved;

    // The drag has run out of room. If the panel it is pushing into can
    // collapse, pushing far enough past its minimum collapses it; if the panel
    // it is pulling from is already collapsed, pulling far enough opens it.
    // Both are judged against the sizes the drag started from, so dragging
    // back out again undoes the snap rather than leaving it stuck.
    const { before, after } = sidesOf(index, count);
    const shrinking = delta > 0 ? index + 1 : index;
    const growing = delta > 0 ? index : index + 1;
    const shrinkSide = delta > 0 ? after : before;
    const growSide = delta > 0 ? before : after;

    const shrinkLimit = limits[shrinking];
    if (
      shrinkLimit?.collapsible &&
      !collapsedIn(moved, shrinking) &&
      overshoot >= thresholdFor(shrinking)
    ) {
      const collapsed = withPanelAt(moved, shrinking, shrinkLimit.collapsed, growSide, bound);
      if (collapsed) return collapsed;
    }

    const growLimit = limits[growing];
    if (
      growLimit?.collapsible &&
      collapsedIn(moved, growing) &&
      overshoot >= thresholdFor(growing)
    ) {
      const expanded = withPanelAt(moved, growing, growLimit.min, shrinkSide, bound);
      if (expanded) return expanded;
    }

    return moved;
  };

  const resize = (index: number, delta: number) => commit(applyFrom(sizes(), index, delta));

  const resizeTo = (index: number, size: number) => {
    if (index < 0 || index >= count) return;
    const current = sizes()[index] ?? 0;
    // The boundary to move is the one after the panel, except for the last
    // panel, which only has one on its left — and moving that one the other
    // way is what makes it bigger.
    if (index < count - 1) resize(index, size - current);
    else resize(index - 1, current - size);
  };

  const collapse = (index: number) => {
    const limit = limits[index];
    if (!limit?.collapsible || isCollapsed(index)) return;

    const current = sizes()[index] ?? 0;
    restore.set(index, current);
    const next = withPanelSize(sizes(), index, limit.collapsed, bounds(sizes()));
    commit(next);
    options.onCollapse?.(index);
  };

  const expand = (index: number) => {
    const limit = limits[index];
    if (!limit?.collapsible || !isCollapsed(index)) return;

    // Back to the size it had before, or — after a reload, where that was not
    // stored — to the smallest size it is allowed to have.
    const target = clamp(restore.get(index) ?? limit.min, limit.min, limit.max);
    commit(withPanelSize(sizes(), index, target, bounds(sizes())));
    options.onExpand?.(index);
  };

  // Persistence lives in an effect rather than in `commit`, so that a
  // controlled group — one handed a signal someone else writes to — is stored
  // just the same.
  effect(() => {
    const current = sizes();
    if (!storage || !options.storageKey) return;
    const serialised = JSON.stringify(current.map((n) => round(n, 4)));
    if (serialised === lastStored) return;
    lastStored = serialised;
    try {
      storage.setItem(options.storageKey, serialised);
    } catch {
      // Storage can refuse: disabled by policy, or full. Losing the layout
      // between visits is not worth taking the application down for.
    }
  });

  onCleanup(() => stopDrag?.());

  const handleDisabled = (event: Event): boolean =>
    event.currentTarget instanceof Element &&
    event.currentTarget.getAttribute('aria-disabled') === 'true';

  const rtl = (): boolean => (options.dir ? options.dir === 'rtl' : isRtl(options.group() ?? null));

  return {
    orientation: () => orientation,
    separatorOrientation: () => separatorOrientation,

    sizes,
    size: (index) => sizes()[index] ?? 0,
    setSizes: (next) => commit(normalise([...next], limits)),

    isCollapsed,
    collapse,
    expand,
    toggleCollapse: (index) => (isCollapsed(index) ? expand(index) : collapse(index)),

    resize,
    resizeTo,
    reset: () => {
      restore.clear();
      commit([...defaults]);
    },

    isDragging: () => dragging.get() !== null,
    activeHandle: () => dragging.get(),

    groupProps: () => ({
      'data-orientation': orientation,
      'data-dragging': dragging.get() === null ? undefined : '',
      style: {
        // Interleaved with `auto` for the handles, so a grid group can be
        // written as `grid-template-columns: var(--volt-resizable-template)`
        // and needs nothing else. Shares are `fr` rather than percentages:
        // percentages already add up to the whole group, so every handle
        // would be overflow, where `fr` tracks share out whatever the handles
        // leave, in proportion. The zero minimum lets a panel shrink below its
        // content's width, as `min-inline-size: 0` does in a flex group, which
        // uses the per-panel property instead.
        [RESIZABLE_TEMPLATE_PROPERTY]: sizes()
          .map((size) => `minmax(0, ${round(size, 4)}fr)`)
          .join(' auto '),
      },
    }),

    panelProps: (index) => ({
      id: panelIds[index],
      'data-panel-index': String(index),
      'data-collapsed': isCollapsed(index) ? '' : undefined,
      style: { [RESIZABLE_SIZE_PROPERTY]: `${round(sizes()[index] ?? 0, 4)}%` },
    }),

    handleProps: (index, handle = {}) => {
      const limit = limits[index];
      const size = sizes()[index] ?? 0;
      const valueMin = limit ? (limit.collapsible ? limit.collapsed : limit.min) : 0;
      const label =
        handle.label ?? options.labels?.handle?.(index) ?? `Resize panel ${index + 1}`;

      return {
        role: 'separator',
        // The line, not the movement. A row of panels is divided by vertical
        // lines.
        'aria-orientation': separatorOrientation,
        // The pane whose size the number describes.
        'aria-controls': panelIds[index],
        'aria-valuenow': String(round(size, 2)),
        'aria-valuemin': String(round(valueMin, 2)),
        'aria-valuemax': String(round(limit?.max ?? 100, 2)),
        'aria-valuetext':
          options.labels?.valueText?.(round(size, 2), index) ?? `${round(size, 0)} percent`,
        'aria-labelledby': handle.labelledBy,
        'aria-label': handle.labelledBy ? undefined : label,
        // `aria-disabled` rather than removing it from the tab order: a
        // splitter that cannot be moved is still worth finding and hearing
        // about. The handlers refuse it, so nothing depends on the consumer
        // remembering to.
        'aria-disabled': handle.disabled ? 'true' : undefined,
        tabindex: '0',
        [RESIZABLE_HANDLE_ATTRIBUTE]: String(index),
        'data-orientation': separatorOrientation,
        'data-dragging': dragging.get() === index ? '' : undefined,
        style: {
          // Same reason as the scroll thumb: without it the browser treats a
          // touch on the handle as the start of a scroll and the drag never
          // gets a second event.
          'touch-action': 'none',
        },
      };
    },

    onHandleKeyDown(index, event) {
      if (event.ctrlKey || event.metaKey || event.altKey) return false;
      if (handleDisabled(event)) return false;
      if (index < 0 || index >= count - 1) return false;

      const amount = event.shiftKey ? largeStep : step;
      // Perpendicular to the line: a row of panels is resized with Left and
      // Right, and in a right-to-left document the first panel is the right
      // one, so the pair swaps. Vertical order is never mirrored.
      const sideways = orientation === 'horizontal';
      const grow = sideways ? (rtl() ? 'ArrowLeft' : 'ArrowRight') : 'ArrowDown';
      const shrink = sideways ? (rtl() ? 'ArrowRight' : 'ArrowLeft') : 'ArrowUp';
      const limit = limits[index];

      switch (event.key) {
        case grow:
          resize(index, amount);
          break;
        case shrink:
          resize(index, -amount);
          break;
        // The ends of this panel's range, not of the document.
        case 'Home':
          resizeTo(index, limit?.min ?? 0);
          break;
        case 'End':
          resizeTo(index, limit?.max ?? 100);
          break;
        case 'Enter': {
          // The same panel a double-click would collapse, so the two ways of
          // asking for the same thing cannot disagree.
          const target = collapsibleAt(index);
          if (target === -1) return false;
          if (isCollapsed(target)) expand(target);
          else collapse(target);
          break;
        }
        default:
          return false;
      }

      // The arrows would scroll the page as well, and Home would jump to the
      // top of it.
      event.preventDefault();
      return true;
    },

    onHandlePointerDown(index, event) {
      if (event.button !== 0 || !event.isPrimary) return;
      if (handleDisabled(event)) return;
      if (untrack(() => dragging.get()) !== null) return;
      if (index < 0 || index >= count - 1) return;

      const handle = event.currentTarget;
      if (!(handle instanceof HTMLElement)) return;

      const groupEl = options.group();
      const rect = groupEl?.getBoundingClientRect();
      const groupSize = rect ? (orientation === 'horizontal' ? rect.width : rect.height) : 0;
      // With no measurable group there is no way to turn pixels into shares.
      // Refusing the drag leaves the keyboard path working, which is better
      // than moving the boundary by an arbitrary amount.
      if (groupSize <= 0) return;

      event.preventDefault();

      const startSizes = [...sizes()];
      const startPointer = orientation === 'horizontal' ? event.clientX : event.clientY;
      const sign = orientation === 'horizontal' && rtl() ? -1 : 1;

      handle.setPointerCapture?.(event.pointerId);
      dragging.set(index);

      const onMove = (move: PointerEvent) => {
        if (move.pointerId !== event.pointerId) return;
        const moved =
          ((orientation === 'horizontal' ? move.clientX : move.clientY) - startPointer) * sign;
        commit(applyFrom(startSizes, index, (moved / groupSize) * 100));
      };

      const onCancelKey = (key: KeyboardEvent) => {
        if (key.key !== 'Escape') return;
        // A drag is a single gesture, so cancelling it puts everything back —
        // not just the last increment.
        commit([...startSizes]);
        stop();
      };

      const stop = () => {
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', stop);
        handle.removeEventListener('pointercancel', stop);
        handle.removeEventListener('lostpointercapture', stop);
        document.removeEventListener('keydown', onCancelKey, true);
        if (handle.hasPointerCapture?.(event.pointerId)) {
          handle.releasePointerCapture(event.pointerId);
        }
        dragging.set(null);
        stopDrag = null;
      };

      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', stop);
      handle.addEventListener('pointercancel', stop);
      handle.addEventListener('lostpointercapture', stop);
      document.addEventListener('keydown', onCancelKey, true);
      stopDrag = stop;
    },

    onHandleDoubleClick(index, event) {
      if (handleDisabled(event)) return;
      const target = collapsibleAt(index);
      if (target === -1) return;
      event.preventDefault();
      if (isCollapsed(target)) expand(target);
      else collapse(target);
    },
  };
}

// ---------------------------------------------------------------------------
// Resizable arithmetic
//
// Kept as free functions on plain arrays: sizing rules are where a splitter
// gets its behaviour, and they are worth being able to reason about — and
// test — without a DOM or a signal anywhere near them.
// ---------------------------------------------------------------------------

interface Bound {
  readonly floor: number;
  readonly ceiling: number;
}

/**
 * Move the boundary after `index` by `delta` percentage points.
 *
 * The space comes from, and goes to, the panels on either side in order of
 * nearness — so a three-panel group whose middle panel is already at its
 * minimum keeps moving, taking from the far one, instead of stopping dead.
 * That cascade is what makes a multi-panel group feel like one layout rather
 * than a row of independent pairs.
 *
 * `applied` is how much actually moved, which is how the caller learns that
 * the drag has been pushed past a limit.
 */
function moveBoundary(
  source: readonly number[],
  index: number,
  delta: number,
  limits: readonly Bound[],
): { sizes: number[]; applied: number } {
  const { before, after } = sidesOf(index, source.length);
  const forward = delta > 0;
  const growing = forward ? before : after;
  const shrinking = forward ? after : before;

  const wanted = Math.abs(delta);
  // Both sides have to agree: space taken has to land somewhere, and space
  // given has to come from somewhere. The smaller of the two is what moves.
  const room = capacity(source, growing, limits, 'grow');
  const available = capacity(source, shrinking, limits, 'shrink');
  const applied = Math.min(wanted, room, available);

  if (applied <= SIZE_EPSILON) return { sizes: [...source], applied: 0 };

  const next = [...source];
  distribute(next, growing, applied, limits, 'grow');
  distribute(next, shrinking, applied, limits, 'shrink');
  return { sizes: next, applied };
}

/**
 * The panels on either side of the boundary after `index`, nearest first.
 *
 * `before` starts at `index` because that panel is on the near side of the
 * boundary being moved — the boundary after panel 0 is between panels 0 and 1.
 */
function sidesOf(index: number, length: number): { before: number[]; after: number[] } {
  const before: number[] = [];
  for (let i = index; i >= 0; i--) before.push(i);
  const after: number[] = [];
  for (let i = index + 1; i < length; i++) after.push(i);
  return { before, after };
}

function capacity(
  sizes: readonly number[],
  order: readonly number[],
  limits: readonly Bound[],
  direction: 'grow' | 'shrink',
): number {
  let total = 0;
  for (const i of order) {
    const size = sizes[i] ?? 0;
    const limit = limits[i];
    if (!limit) continue;
    total += direction === 'grow' ? limit.ceiling - size : size - limit.floor;
  }
  return Math.max(0, total);
}

/** Fill each panel in turn to its limit until `amount` is used up. */
function distribute(
  sizes: number[],
  order: readonly number[],
  amount: number,
  limits: readonly Bound[],
  direction: 'grow' | 'shrink',
): void {
  let left = amount;
  for (const i of order) {
    if (left <= SIZE_EPSILON) break;
    const limit = limits[i];
    if (!limit) continue;
    const size = sizes[i] ?? 0;
    const room = direction === 'grow' ? limit.ceiling - size : size - limit.floor;
    if (room <= 0) continue;
    const used = Math.min(room, left);
    sizes[i] = direction === 'grow' ? size + used : size - used;
    left -= used;
  }
}

/**
 * Put panel `index` at exactly `size`, moving the difference across `order`.
 *
 * Returns null when those panels cannot absorb or supply the whole difference,
 * in which case the caller leaves the sizes alone: a snap that half happens
 * would leave a panel at a size it is not allowed to be.
 */
function withPanelAt(
  sizes: readonly number[],
  index: number,
  size: number,
  order: readonly number[],
  limits: readonly Bound[],
): number[] | null {
  const difference = (sizes[index] ?? 0) - size;
  if (Math.abs(difference) <= SIZE_EPSILON) return null;

  // Space the panel gives up has to be taken by the others, and vice versa.
  const direction = difference > 0 ? 'grow' : 'shrink';
  if (capacity(sizes, order, limits, direction) + SIZE_EPSILON < Math.abs(difference)) return null;

  const next = [...sizes];
  next[index] = size;
  distribute(next, order, Math.abs(difference), limits, direction);
  return next;
}

/**
 * Put panel `index` at `size`, taking the difference from every other panel in
 * order of nearness. Used by `collapse` and `expand`, where there is no
 * boundary being dragged and the space simply has to go somewhere.
 */
function withPanelSize(
  sizes: readonly number[],
  index: number,
  size: number,
  limits: readonly Bound[],
): number[] {
  const next = [...sizes];
  const wanted = size - (next[index] ?? 0);
  if (Math.abs(wanted) <= SIZE_EPSILON) return next;

  const order: number[] = [];
  for (let distance = 1; distance < next.length; distance++) {
    if (index + distance < next.length) order.push(index + distance);
    if (index - distance >= 0) order.push(index - distance);
  }

  const direction = wanted > 0 ? 'shrink' : 'grow';
  // Only as much as the others can actually take or give, so the sizes still
  // sum to 100 afterwards. A panel that cannot be fully expanded is expanded
  // as far as there is room for.
  const change = Math.min(Math.abs(wanted), capacity(next, order, limits, direction));
  next[index] = (next[index] ?? 0) + (wanted > 0 ? change : -change);
  distribute(next, order, change, limits, direction);
  return next;
}

/** Starting sizes: declared ones as given, the rest sharing what is left. */
function distributeDefaults(
  panels: readonly ResizablePanel[],
  limits: readonly PanelLimits[],
): number[] {
  const declared = panels.map((panel) =>
    typeof panel.defaultSize === 'number' && Number.isFinite(panel.defaultSize)
      ? panel.defaultSize
      : null,
  );
  const claimed = declared.reduce<number>((total, size) => total + (size ?? 0), 0);
  const unset = declared.filter((size) => size === null).length;
  const share = unset > 0 ? Math.max(0, 100 - claimed) / unset : 0;

  return declared.map((size, index) => {
    const limit = limits[index];
    const raw = size ?? share;
    return limit ? clamp(raw, limit.collapsible ? limit.collapsed : limit.min, limit.max) : raw;
  });
}

/**
 * Push a set of sizes to exactly 100, respecting every panel's range.
 *
 * Needed after clamping, after loading stored sizes, and after anything the
 * consumer hands in: a group whose sizes do not sum to 100 renders as a gap or
 * an overflow, and the arithmetic above assumes the invariant holds.
 */
function normalise(sizes: number[], limits: readonly PanelLimits[]): number[] {
  const raw = sizes.map((size) => (Number.isFinite(size) ? Math.max(0, size) : 0));
  const sum = raw.reduce((total, size) => total + size, 0);
  // Scaled to 100 before clamping, so that sizes which are merely on the wrong
  // scale — halves given as `[0.5, 0.5]`, or a list that no longer adds up
  // after a panel was removed — keep the proportions they were asked for.
  // Handing the whole shortfall to the first panel instead would turn `[5, 5]`
  // into `[95, 5]`, which is not what anyone meant by two equal halves.
  const scale = sum > 0 ? 100 / sum : 0;

  const next = raw.map((size, index) => {
    const limit = limits[index];
    const scaled = scale > 0 ? size * scale : 100 / Math.max(1, raw.length);
    if (!limit) return scaled;
    const floor = limit.collapsible ? limit.collapsed : limit.min;
    return clamp(scaled, floor, limit.max);
  });

  const bound: Bound[] = limits.map((limit, index) => {
    const collapsedNow =
      limit.collapsible && (next[index] ?? 0) <= limit.collapsed + SIZE_EPSILON;
    return {
      floor: collapsedNow ? limit.collapsed : limit.min,
      ceiling: limit.max,
    };
  });

  const total = next.reduce((sum, size) => sum + size, 0);
  const difference = 100 - total;
  if (Math.abs(difference) <= SIZE_EPSILON) return next;

  const order = next.map((_, index) => index);
  distribute(next, order, Math.abs(difference), bound, difference > 0 ? 'grow' : 'shrink');
  return next;
}

function sameSizes(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((size, index) => Math.abs(size - (b[index] ?? 0)) <= SIZE_EPSILON / 10);
}

function resolveStorage(options: ResizableOptions): ResizableStorage | null {
  if (options.storage) return options.storage;
  if (!options.storageKey) return null;
  try {
    // Reading `localStorage` can itself throw where storage is blocked, so
    // even getting hold of it goes inside the guard.
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * Stored sizes, or null when there is nothing usable.
 *
 * Every check here is a real failure mode: the key holding something else, a
 * layout stored before a panel was added or removed, a hand-edited value. A
 * stored array of the wrong length silently mapped onto the current panels is
 * the worst of them — the layout comes back subtly wrong and nothing says why
 * — so length is checked before anything is trusted.
 */
function loadSizes(
  storage: ResizableStorage | null,
  key: string | undefined,
  limits: readonly PanelLimits[],
): number[] | null {
  if (!storage || !key) return null;

  let raw: string | null = null;
  try {
    raw = storage.getItem(key);
  } catch {
    return null;
  }
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!Array.isArray(parsed) || parsed.length !== limits.length) return null;
  if (!parsed.every((size) => typeof size === 'number' && Number.isFinite(size) && size >= 0)) {
    return null;
  }

  return normalise(parsed as number[], limits);
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Keep a measurement honest as things resize.
 *
 * Where there is no `ResizeObserver` — a server, or a test environment with no
 * layout — the last measurement simply stands.
 */
function observeSize(el: Element, onResize: () => void): void {
  const view = el.ownerDocument?.defaultView;
  if (typeof view?.ResizeObserver !== 'function') return;

  const observer = new view.ResizeObserver(onResize);
  observer.observe(el);
  onCleanup(() => observer.disconnect());
}

/**
 * Writing direction at `target`, by the same rule roving focus and the
 * separator use: the nearest `dir` attribute wins over computed style, because
 * an application that writes `dir` is stating intent, and the attribute can be
 * read before styles resolve.
 *
 * This is the third copy in the package. It belongs in a shared module now,
 * and the three should be lifted out together rather than one of them growing
 * a dependency on another component's file.
 */
function isRtl(target: Element | null): boolean {
  if (!target) return false;

  const declared = target.closest('[dir]');
  if (declared) return declared.getAttribute('dir')?.toLowerCase() === 'rtl';

  const view = target.ownerDocument?.defaultView;
  return view?.getComputedStyle?.(target).direction === 'rtl';
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/** A number CSS will accept: no exponent, no seventeen decimal places. */
function css(value: number): string {
  return String(Number.isFinite(value) ? round(value, 4) : 0);
}
