import { Component, Prop, Signal, effect } from '@voltdev/core';
import { createSkeleton, type Skeleton } from '@voltdev/primitives';

declare const __VOLT_DEV__: boolean;

/** Which shape stands in for the content: a block, a line of text, a circle. */
export type SkeletonShape = 'block' | 'text' | 'circle';

/**
 * A number a caller may have written as an attribute.
 *
 * `delay="300"` arrives as the string `'300'` — an attribute is how most of
 * these are written — and goes on into `setTimeout`, which takes a string and
 * a typo with it: `Number('1s')` is `NaN`, a `NaN` timeout fires on the next
 * tick, and every one of these three options is then silently the thing it was
 * set to avoid. The boxes go up with no delay, the minimum holds them for no
 * time at all, and the region announces into the same mutation that made it.
 *
 * Emptiness is judged after the trim, because `Number` reads whitespace as
 * zero: `minDuration=" "` would otherwise be a minimum quietly turned off.
 */
function milliseconds(value: number | string, prop: string): number {
  const text = typeof value === 'number' ? value : value.trim();
  const parsed = text === '' ? Number.NaN : Number(text);
  if (Number.isNaN(parsed)) {
    throw new Error(
      `[volt] \`${prop}\` on <v-skeleton> takes a number of milliseconds, and ` +
        `\`${String(value)}\` is not one.`,
    );
  }
  return parsed;
}

/**
 * A skeleton: the shape of content that has not arrived.
 *
 * ```html
 * <v-skeleton :loading="pending" shape="text" :count="3">
 *   <p>{ article.get().body }</p>
 * </v-skeleton>
 * ```
 *
 * The content is the default slot, and it is the placeholder's other half
 * rather than something beside it: while the load is on, the boxes stand where
 * the paragraph will be, and when it ends they are replaced by it. That is the
 * whole of why a skeleton is worth more than a spinner — it holds the layout
 * the content is coming into, so nothing jumps when it lands.
 *
 * The boxes are decoration and say so: `aria-hidden` keeps them out of the
 * accessibility tree and `inert` out of the tab order, both from the
 * primitive. A dozen empty boxes read out as a dozen empty boxes is the thing
 * a skeleton must not do, so the one sentence that replaces them — "Loading…",
 * then "Loaded" — goes into a polite live region this renders beside the
 * content and keeps on the page whether there is anything to say or not.
 *
 * What a caller writes on the tag — their class, their id, their `data-*` —
 * lands on the element standing in for the content, which is the one their
 * layout has a place for. A name is the one thing it cannot carry: that
 * element has no role, where `aria-label` means nothing, and the only element
 * here that has one is the region, where a name is announced *instead of* the
 * message. One written there is left where it was put and said out loud in
 * development, because nobody who can see the screen would ever find out.
 *
 * State is one signal both sides hold. Pass `loading` and it is yours to read
 * and write; pass nothing and the skeleton owns it, and `:ref` reaches
 * `setLoading`.
 */
@Component({ selector: 'v-skeleton', templateUrl: './skeleton.html' })
export class VSkeleton {
  /** Your own signal, when what is being waited for belongs to your component. */
  @Prop() loading?: Signal.State<boolean>;
  /**
   * The six below are what the primitive is built with, read once while this
   * field list initializes — plain, because a signal would promise a caller
   * they can change them later and the primitive would not hear it.
   *
   * The three timings take a number or the string an attribute makes of one:
   * `delay="300"` is the spelling most of them are written in, and a value
   * that is not a number at all is refused by name rather than passed on to
   * `setTimeout` as a `NaN` that fires at once.
   */
  /** Where it starts, when the skeleton owns its state. */
  @Prop() defaultLoading = false;
  /**
   * Hold the placeholder back this long, in milliseconds. Default 0.
   *
   * Zero, unlike a spinner's, because a skeleton *is* the layout: delaying it
   * shows a blank hole and then a jump, which is worse than the flash it would
   * have avoided.
   */
  @Prop() delay?: number | string;
  /** Once up, keep it up at least this long, in milliseconds. Default 0. */
  @Prop() minDuration?: number | string;
  /**
   * How long the live region must have been on the page before words written
   * into it are announced, in milliseconds. Default 50.
   *
   * An escape hatch for a caller who knows the region was already there — zero
   * turns the wait off. It is not the number to reach for first: a message
   * that lands in the same DOM mutation as the region carrying it is announced
   * by nobody.
   */
  @Prop() announceDelay?: number | string;
  /**
   * What the region says while the boxes are up. Default the locale's
   * `loading` — `Loading…`.
   *
   * Set it to `''` for a skeleton in a group where one of them already speaks:
   * six regions all saying "Loading…" is six interruptions for one wait.
   */
  @Prop() label?: string;
  /**
   * What it says once the content has arrived. Default the locale's `loaded`,
   * or `Loaded`. `''` says nothing, which is right when the content announces
   * itself some other way.
   */
  @Prop() loadedLabel?: string;

  /** Which shape the boxes are. */
  @Prop() shape = new Signal.State<SkeletonShape>('text');
  /** How many of them. */
  @Prop() count = new Signal.State(1);
  /** Any CSS length, put on every box — `12rem`, `60%`. A circle's diameter. */
  @Prop() width = new Signal.State<string | undefined>(undefined);
  /** Any CSS length, likewise. A circle takes its height from `width`. */
  @Prop() height = new Signal.State<string | undefined>(undefined);

  /** Called with the state the load moved to, as it moves. */
  @Prop() onLoadingChange?: (loading: boolean) => void;

  /**
   * The live region, which is a sibling of the content and not a child of it.
   *
   * `contentProps()` puts `aria-busy` on the content while the load is on, and
   * `aria-busy` on an ancestor of a live region means "do not announce what
   * changes in here yet" — which would silence the one sentence this component
   * exists to deliver.
   */
  region = new Signal.State<Element | null>(null);

  /**
   * The element standing in for the caller's content, which is where `:host`
   * puts everything they wrote on the tag. Held so that a name written there
   * can be answered; see `reportNameOnContent`.
   */
  content = new Signal.State<Element | null>(null);

  /**
   * The primitive, built from the props above — which is why props have to be
   * there while a field initializes.
   */
  readonly skeleton: Skeleton = createSkeleton({
    region: () => this.region.get(),
    ...(this.loading ? { loading: this.loading } : {}),
    defaultLoading: this.defaultLoading,
    ...(this.delay !== undefined ? { delay: milliseconds(this.delay, 'delay') } : {}),
    ...(this.minDuration !== undefined
      ? { minDuration: milliseconds(this.minDuration, 'minDuration') }
      : {}),
    ...(this.announceDelay !== undefined
      ? { announceDelay: milliseconds(this.announceDelay, 'announceDelay') }
      : {}),
    labels: {
      ...(this.label !== undefined ? { loading: this.label } : {}),
      ...(this.loadedLabel !== undefined ? { loaded: this.loadedLabel } : {}),
    },
    ...(this.onLoadingChange ? { onLoadingChange: this.onLoadingChange } : {}),
  });

  constructor() {
    if (__VOLT_DEV__) effect(() => this.reportNameOnContent());
  }

  /**
   * A name written on the tag names nothing, so say so.
   *
   * `:host` is the element standing in for the content, and it carries no
   * role — `aria-busy` is a state, not one — so `aria-label` written on the
   * tag is thrown away by every screen reader. Moving it is not an option
   * either: the one element here with a role is the live region, and a name
   * on a live region is announced *instead of* its contents in some readers,
   * which for this one is the whole message lost. So the attribute is left
   * where the caller put it and the loss is said out loud, because otherwise
   * only a screen reader user ever finds out.
   */
  private reportNameOnContent(): void {
    const content = this.content.get();
    if (!content || typeof console === 'undefined') return;
    // Unless the caller gave the element a role of their own, which is the one
    // way a name written there means something.
    if (content.hasAttribute('role')) return;

    const wrote = ['aria-label', 'aria-labelledby'].filter((name) => content.hasAttribute(name));
    if (wrote.length === 0) return;

    console.warn(
      `[volt] <v-skeleton> was given ${wrote.join(' and ')}, which lands on the element ` +
        'standing in for your content — an element with no role, where a name means nothing.\n' +
        '  A skeleton is not a control and its live region must stay nameless. Name the ' +
        'content itself, or give this element a role of your own to hold the name.',
    );
  }

  /**
   * Whether the content is what belongs on screen.
   *
   * `idle` is the one of the primitive's three states with nothing to stand in
   * for: not loading, and not still serving out a minimum. The other two hold
   * the content back — during the delay because it has not arrived, and during
   * the minimum because putting it up now is the flash the minimum exists to
   * prevent.
   */
  arrived(): boolean {
    return this.skeleton.state() === 'idle';
  }

  /** One entry per box, because a template repeats over a list. */
  shapes(): readonly number[] {
    return Array.from({ length: this.lines() }, (_, index) => index);
  }

  /**
   * Whether this box is the short last line of a paragraph.
   *
   * Only for text, and only where there is more than one: a column of lines
   * all ending together reads as a table, and a single line cut short reads as
   * a mistake.
   */
  trailing(index: number): boolean {
    return this.shape.get() === 'text' && index > 0 && index === this.lines() - 1;
  }

  /** At least one, and a whole number: a caller's count is arithmetic. */
  private lines(): number {
    return Math.max(1, Math.trunc(this.count.get()) || 1);
  }
}
