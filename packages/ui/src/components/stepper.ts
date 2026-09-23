import { Component, Prop, Signal, createContext, effect, provideContext } from '@voltdev/core';
import {
  createStepper,
  type NavigationProps,
  type StepStatus,
  type Stepper,
  type StepperLabels,
  type StepperOptions,
} from '@voltdev/primitives';
import { TagChildren } from './children.js';
import type { VStep } from './step.js';

const { untrack } = Signal.subtle;

/**
 * How a step finds the stepper it was written inside.
 *
 * The content of a tag is built while the tag it sits in renders, so a step's
 * scope descends from this one. A step written anywhere else finds nothing and
 * says so.
 */
export const StepperContext = createContext<VStepper | null>(null);

/**
 * The caller's own signal, refused when it is not one.
 *
 * The value of a stepper is a number, and a number is the easiest thing in
 * markup to write where a signal was meant: `:value="1"` hands the primitive a
 * number it later calls `.get()` on, inside an effect, where the `TypeError`
 * is swallowed and what is left is a list with no current step and every panel
 * hidden. Refused here instead, while the prop is still the thing that is
 * wrong, and pointed at `defaultValue`, which is how starting somewhere is
 * spelled.
 */
function ownSignal(value: unknown): Signal.State<number> {
  const candidate = value as Partial<Signal.State<number>> | null | undefined;
  if (typeof candidate?.get === 'function' && typeof candidate.set === 'function') {
    return value as Signal.State<number>;
  }
  // A computed signal is the other near miss, and printed it is only
  // `[object Object]`: say what is wrong with it instead.
  const refused =
    typeof candidate?.get === 'function'
      ? 'a signal it cannot write is not one — a user moving the step writes it'
      : `\`${String(value)}\` is not one`;
  throw new Error(
    `[volt] \`value\` on <v-stepper> takes a signal your component holds, and ${refused}.\n` +
      '  To start on a step, write `defaultValue`. To drive it, hold a ' +
      '`new Signal.State(0)` and pass that: `:value="step"`.',
  );
}

/**
 * Where the stepper starts, as an attribute is able to carry it.
 *
 * `defaultValue="2"` arrives as the string `'2'`, which the primitive would
 * keep and compare as a string for as long as nobody moved — `'10' < '9'` —
 * so a string that is a number is that number. Anything else starts at the
 * first step, which is where a stepper with no opinion starts anyway.
 */
function startingAt(value: number | undefined): number {
  const written: unknown = value;
  const index = typeof written === 'string' ? Number(written.trim()) : written;
  return typeof index === 'number' && Number.isFinite(index) ? index : 0;
}

/**
 * A multi-step process: the steps in order, the one the user is on, and the
 * panel belonging to it.
 *
 * ```html
 * <v-stepper :value="step" label="Checkout">
 *   <v-step label="Basket"><p>Two items.</p></v-step>
 *   <v-step label="Delivery" :errored="postcodeInvalid.get()">…</v-step>
 *   <v-step label="Payment">…</v-step>
 * </v-stepper>
 * ```
 *
 * One tag is one step, holding both halves of it, the way a tab does. The
 * step is what `<v-step>` draws, inside the list; the panel is what was
 * written inside the tag, which this draws after the list with `<slot :from>`.
 *
 * The value is a position, counted from 0, because that is how the primitive
 * counts: a step is identified by where it is. What the primitive owns is
 * which step is current and which ones the user may select. Whether a step is
 * done, broken or out of use is the page's knowledge, written on each
 * `<v-step>`, and read from there on every question the primitive asks.
 *
 * `:host` is on the `<nav>`, which carries the landmark and its name — so a
 * name written on the tag names the thing it looks like it names. The panels
 * are outside it: a navigation landmark holding a whole form would announce
 * the form as navigation. That leaves this component with more than one root
 * element, and the layout of a stepper beside its panels to the element the
 * page wraps it in.
 */
@Component({ selector: 'v-stepper', templateUrl: './stepper.html' })
export class VStepper {
  /** Your own signal, when the current step belongs to your component. */
  @Prop() value?: Signal.State<number>;
  /**
   * The four below are read once, while this field list initializes: three
   * are what the primitive is *built* with, and `defaultValue` is where the
   * position starts. Plain, because a signal would promise a caller they can
   * change them later while the stepper went on refusing and moving the way
   * it was built to.
   */
  /** The step to start on, counted from 0, when the position is the stepper's own. */
  @Prop() defaultValue?: number;
  /**
   * Steps are reached in order. Default true: a step can be selected once the
   * user has been that far, or once every step before it is complete. The
   * flow's own Continue — `stepper.next()` — is never refused, because it is
   * what has just done the validating.
   */
  @Prop() linear = true;
  /** Which arrows move between steps, and which way the list runs. */
  @Prop() orientation: 'horizontal' | 'vertical' = 'horizontal';
  /**
   * Wrap past the first and last step. Default false: a flow has two ends.
   * Written bare — `loop` — or bound; any value written on it is a string, and
   * a string is on.
   */
  @Prop() loop = false;
  /** Called with the step the user moved to, by selecting it or by `next`. */
  @Prop() onValueChange?: (index: number) => void;

  /**
   * The name of the navigation landmark. Without one it is the primitive's
   * "Progress", because a landmark with no name is one of several a screen
   * reader lists with nothing to tell them apart.
   *
   * Signals, like the three below: the primitive reads the name on every
   * `navProps()` rather than keeping a copy, and a name is as often translated
   * as it is a literal.
   */
  @Prop() label = new Signal.State<string | undefined>(undefined);
  /** Id of the element naming the landmark, when that name is already on screen. */
  @Prop() labelledBy = new Signal.State<string | undefined>(undefined);

  /**
   * The same two in the platform's own spelling.
   *
   * Declared rather than left to fall through to `:host`, which is the `<nav>`
   * the primitive writes its own `aria-label` on. A name written on the tag
   * and a name in the primitive's bag would be two spreads writing one
   * attribute, and whichever ran last would win. Declared, the caller's is the
   * one the bag carries.
   */
  @Prop({ alias: 'aria-label' }) ariaLabel = new Signal.State<string | undefined>(undefined);
  @Prop({ alias: 'aria-labelledby' }) ariaLabelledBy = new Signal.State<string | undefined>(
    undefined,
  );

  /**
   * What each status is called, in the words drawn out of sight inside every
   * step. Without one it is the primitive's English — "Completed", "Current
   * step", "Not started", "Error".
   */
  @Prop() statusLabel = new Signal.State<((status: StepStatus) => string) | undefined>(
    undefined,
  );

  /** The list the steps are drawn in, which is the element the primitive is given. */
  list = new Signal.State<Element | null>(null);

  /**
   * The position, which is the caller's own signal when they passed one.
   *
   * Always a signal of this component's, even where the caller passed none,
   * because how far the user has been is measured from it.
   */
  readonly position: Signal.State<number> =
    this.value !== undefined
      ? ownSignal(this.value)
      : new Signal.State(startingAt(this.defaultValue));

  /** The `<v-step>` children, in the order their steps are in the list. */
  readonly steps = new TagChildren<VStep>(
    () => this.list.get(),
    (step) => step.element,
  );

  /**
   * The furthest step the user has been on, which is what a step that says
   * nothing about its own completion is judged by.
   *
   * The primitive keeps the same number, and uses it for the same default —
   * but only when it is handed no `complete` at all. A step here may speak for
   * itself or not, one at a time, so the accessor this hands over has to be
   * able to answer for the ones that do not.
   */
  private readonly reached = new Signal.State(untrack(() => this.position.get()));

  /**
   * The primitive, built from the props above — which is why props have to be
   * there while a field initializes.
   */
  readonly stepper: Stepper = createStepper(this.options());

  constructor() {
    provideContext(StepperContext, this);

    // Including when the position is set from outside: a flow driven by the
    // URL moves the current step without calling anything here.
    effect(() => {
      const here = this.stepper.value();
      untrack(() => {
        if (here > this.reached.get()) this.reached.set(here);
        this.keepFocus(here);
      });
    });
  }

  /**
   * Take focus out of a panel this move has just hidden, onto the step shown.
   *
   * The flow's own Continue and Back are written inside a panel, so the button
   * a keyboard user has just pressed is inside the very panel the move hides —
   * and a browser drops focus on a hidden element to `<body>`, the top of the
   * document, with no way back into the flow. The step they are on now is
   * where they are: it says which step that is, and Tab from it reaches the
   * panel it shows.
   *
   * Only out of a panel of this stepper's that is hidden now. Focus anywhere
   * else was put there by something that meant it — the page's own choice of
   * a field in the new panel, or a step chosen from the list — and stays.
   */
  private keepFocus(here: number): void {
    // Asked of the document or the shadow root the list is drawn in, which is
    // where "what holds focus" has an answer about these elements.
    const root = this.list.get()?.getRootNode();
    if (!root || !('activeElement' in root)) return;
    const active = root.activeElement as Element | null;
    if (!active) return;

    const hidden = new Set<unknown>();
    for (const [index] of this.steps.all.get().entries()) {
      if (index !== here) hidden.add(this.stepper.panelProps(index)['id']);
    }
    for (let el: Element | null = active; el; el = el.parentElement) {
      if (!hidden.has(el.id)) continue;
      this.at(here)?.button?.focus();
      return;
    }
  }

  /** What the primitive is built with. */
  private options(): StepperOptions {
    return {
      list: () => this.list.get(),
      count: () => this.steps.all.get().length,
      value: this.position,
      complete: (index) => this.at(index)?.complete.get() ?? index < this.reached.get(),
      // Truthy rather than `true`, here and for `loop`, because the primitive
      // asks `=== true` and an attribute is a string: `errored="true"` and
      // `disabled="disabled"` would otherwise ask for the state in the words
      // that say so and get none.
      error: (index) => Boolean(this.at(index)?.errored.get()),
      disabled: (index) => Boolean(this.at(index)?.disabled.get()),
      linear: this.linear,
      orientation: this.orientation,
      loop: Boolean(this.loop),
      labels: this.labels(),
      ...(this.onValueChange ? { onValueChange: this.onValueChange } : {}),
    };
  }

  /**
   * The words the primitive speaks with, read through rather than handed over.
   *
   * The primitive reads `labels` on every call, so a getter is all it takes
   * for a signal to reach a stepper already on screen. A method rather than an
   * object literal in the field above, because a getter written there would
   * read its own literal's `this`, not this instance's.
   */
  private labels(): StepperLabels {
    const { ariaLabel, label, statusLabel } = this;
    return {
      get nav(): string | undefined {
        return ariaLabel.get() ?? label.get();
      },
      get status(): ((status: StepStatus) => string) | undefined {
        return statusLabel.get();
      },
    };
  }

  /** The step at a position, which is where every per-step question is answered. */
  private at(index: number): VStep | undefined {
    return this.steps.all.get()[index];
  }

  /**
   * What a panel carries: the primitive's, named by the step as it is drawn.
   *
   * The primitive names a panel by the id it minted for the step, and a step
   * that was given an id of its own draws that one instead — so the panel is
   * pointed at whichever the step actually has.
   */
  panelProps(step: VStep, index: number): NavigationProps {
    const own = this.stepper.panelProps(index);
    return { ...own, 'aria-labelledby': step.id.get() ?? own['aria-labelledby'] };
  }

  /**
   * What the `<nav>` carries: the primitive's landmark, and what names it.
   *
   * One name only. An element named by a reference ignores its `aria-label`,
   * which would then drift out of date where nobody hears it; so a reference,
   * written either way, takes the primitive's default name off.
   */
  navProps(): NavigationProps {
    const own = this.stepper.navProps();
    const labelledBy = this.ariaLabelledBy.get() ?? this.labelledBy.get();
    return {
      ...own,
      'aria-labelledby': labelledBy,
      'aria-label': labelledBy ? undefined : own['aria-label'],
    };
  }
}
