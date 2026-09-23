import { Component, Prop, Signal } from '@voltdev/core';
import {
  createProgress,
  useLocale,
  type Locale,
  type Progress,
  type ProgressLabels,
  type ProgressProps,
} from '@voltdev/primitives';

/**
 * The caller's own signal, refused when it is not one.
 *
 * `value` is the single signal the page and the bar both hold, and markup has
 * no way to write a signal: `value="40"` and `:value="40"` hand over a string
 * or a number, which the primitive keeps and later calls `.get()` on. That
 * `TypeError` is raised inside an effect, where it is swallowed — what is left
 * on the page is a `<div>` with no role, no value and an empty label, a bar
 * that announces nothing, and nothing anywhere names the tag that caused it.
 * Refused here instead, while the prop is still the thing that is wrong, and
 * pointed at `defaultValue`, which is how starting at a number is spelled and
 * is a value either spelling can carry.
 */
function ownSignal(value: unknown): Signal.State<number | null> {
  const candidate = value as Partial<Signal.State<number | null>> | null | undefined;
  if (typeof candidate?.get === 'function' && typeof candidate.set === 'function') {
    return value as Signal.State<number | null>;
  }
  throw new Error(
    `[volt] \`value\` on <v-progress> takes a signal your component holds, and \`${String(value)}\` ` +
      'is not one.\n' +
      '  To have it start at a number, write `defaultValue`. To drive it, hold a ' +
      '`new Signal.State<number | null>(0)` and pass that: `:value="sent"`.',
  );
}

/**
 * A starting value, as an attribute is able to carry one.
 *
 * `defaultValue` is a number, and an attribute is only ever a string:
 * `defaultValue="40"` arrives as `'40'`, which the primitive refuses for not
 * being a finite number and reports as no value at all — so the two spellings
 * of one prop disagree, and the one that disagrees draws the travelling bar.
 * That bar says nobody knows how far along this is, where the caller said 40,
 * and nothing is raised anywhere. A string that is a number is that number,
 * which is the only thing `defaultValue="40"` could have been asking for;
 * anything else is passed through for the primitive to refuse as it already
 * does.
 *
 * `min` and `max` need none of this. They are written out with `String` and
 * compared arithmetically, and both of those read `'20'` as 20 already.
 */
function startingValue(value: number | null): number | null {
  // Typed as a number and handed a string all the same, which is the whole
  // reason this exists: the type is what the tag promises, and an attribute is
  // what it delivers.
  const written: unknown = value;
  if (typeof written !== 'string') return value;
  const trimmed = written.trim();
  return trimmed !== '' && Number.isFinite(Number(trimmed)) ? Number(trimmed) : value;
}

/**
 * How far along something is: a track, a bar, and the value written under it.
 *
 * ```html
 * <v-progress :value="sent" label="Uploading"></v-progress>
 * ```
 *
 * The value is nullable, and `null` is the indeterminate bar — the one that
 * says work is happening without claiming how much is left. That is why there
 * is no separate flag for it: a flag and a number can disagree, and the number
 * wins in the accessibility tree, where `aria-valuenow` is read out as fact.
 * While the value is null the primitive writes no `aria-valuenow` at all, and
 * the sheet puts the bar in motion instead of at a width.
 *
 * The label says the value the way the page's language writes it —
 * `Intl.NumberFormat`, so a French page gets `38 %` and an Arabic one gets its
 * own digits, rather than the `38%` a template would have concatenated. The
 * same string goes to `aria-valuetext`, so what is read out and what is on
 * screen cannot drift apart. Give `format` whenever the range is not a
 * percentage of anything: `3 of 8 files` is what "step 3 of 8" should sound
 * like, and `38%` is not.
 *
 * Nothing inside the bar is announced. `progressbar` makes its children
 * presentational, which is what keeps the label from being read a second time
 * after `aria-valuetext` has already said it — and also why the bar has to be
 * named from outside its own contents, with `label` or `labelledBy`.
 *
 * A progress bar takes no input and holds no focus. Something the user can
 * change is a slider, which is a different role with a keyboard map of its own.
 */
@Component({ selector: 'v-progress', templateUrl: './progress.html' })
export class VProgress {
  /** Your own signal, when how far along it is belongs to your component. */
  @Prop() value?: Signal.State<number | null>;

  /**
   * The four below are what the primitive is built with, read once while this
   * field list initializes — plain, because a signal would promise a caller
   * they can change them later and the primitive would not hear it. Each of
   * them is something the primitive keeps for itself; the two the template
   * also reads are signals, below, because a value this component draws has
   * to follow whatever it was bound to.
   */
  /** Where it starts, when the bar owns its value. `null` is indeterminate. */
  @Prop() defaultValue?: number | null;
  /** The bottom of the range, reported as `aria-valuemin`. Default 0. */
  @Prop() min = 0;
  /** The top of it, reported as `aria-valuemax`, and the value that is done. Default 100. */
  @Prop() max = 100;
  /** Called with the value the bar moved to, when something moves it. */
  @Prop() onValueChange?: (value: number | null) => void;

  /**
   * What the value reads as, in the label and in `aria-valuetext`.
   *
   * Handed the clamped value and its percentage of the range. Without one the
   * percentage is formatted by the locale, which is right for a range that is
   * a proportion and wrong for one that counts things.
   *
   * A signal, because the label is drawn from it: a wording swapped for
   * another — files for a percentage, bytes for a share — has to reach a bar
   * already on screen, and it has to reach the label and `aria-valuetext` on
   * the same pass, since the point of computing one string is that the two
   * cannot say different things.
   */
  @Prop() format = new Signal.State<((value: number, percent: number) => string) | undefined>(
    undefined,
  );
  /**
   * What is said while there is no value. Default the locale's `loading` —
   * `Loading…`. `''` says nothing, and writes no `aria-valuetext` either.
   *
   * A signal for the same reason as `format`, and read through to the
   * primitive rather than handed over, so that the wait a page rewrites moves
   * the label and what is announced together.
   */
  @Prop() indeterminateLabel = new Signal.State<string | undefined>(undefined);

  /** Names a bar, which cannot be named by the label drawn inside it. */
  @Prop() label = new Signal.State<string | undefined>(undefined);
  /** Id of the element that names it, when something on the page already does. */
  @Prop() labelledBy = new Signal.State<string | undefined>(undefined);

  /**
   * The same two in the platform's own spelling, and the third, which only the
   * platform has a spelling for.
   *
   * Declared rather than left to fall through to `:host`, which lands on this
   * component's root as well. A name written on the tag and a name the bag
   * carries would then be two spreads writing one attribute, and the bag —
   * which has no opinion about `aria-label` unless it was handed one — would
   * take the caller's name back on the first change of value.
   */
  @Prop({ alias: 'aria-label' }) ariaLabel = new Signal.State<string | undefined>(undefined);
  @Prop({ alias: 'aria-labelledby' }) ariaLabelledBy = new Signal.State<string | undefined>(
    undefined,
  );
  @Prop({ alias: 'aria-describedby' }) describedBy = new Signal.State<string | undefined>(
    undefined,
  );

  /**
   * Whether the value is drawn under the track. Default true.
   *
   * The label is where the default slot lands, so turning it off takes
   * anything written inside the tag with it. Nothing is lost to a screen
   * reader either way: the value is in `aria-valuetext`, and the label is
   * inside a `progressbar`, whose contents are presentational.
   */
  @Prop() showValue = new Signal.State(true);

  /**
   * The page's language, for the digits and the separator.
   *
   * Resolved once, while this field list initializes, because that is where a
   * provider is in scope. The locale itself is live: swapping the provider's
   * language reaches a bar already on screen.
   */
  readonly locale: Locale = useLocale();

  /**
   * The primitive, built from the props above — which is why props have to be
   * there while a field initializes.
   */
  readonly progress: Progress = createProgress({
    min: this.min,
    max: this.max,
    // The label's own string, so the two cannot say different numbers.
    valueText: (value, percent) => this.valueText(value, percent),
    labels: this.labels(),
    ...(this.value !== undefined ? { value: ownSignal(this.value) } : {}),
    ...(this.defaultValue !== undefined
      ? { defaultValue: startingValue(this.defaultValue) }
      : {}),
    ...(this.onValueChange ? { onValueChange: this.onValueChange } : {}),
  });

  /**
   * The wait's wording, read through rather than handed over.
   *
   * The primitive reads `labels.indeterminate` on every call — that is how a
   * catalogue swapped later reaches a bar already on screen — so a getter is
   * all it takes for a signal to reach `aria-valuetext` too. Handing it the
   * string instead would freeze what is announced at whatever the wording was
   * when the component was built, while the label beside it followed: the one
   * drift this component is written to make impossible.
   *
   * A method rather than an object literal in the field above, because a
   * getter written there would read its own literal's `this`, not this
   * instance's.
   */
  labels(): ProgressLabels {
    const indeterminateLabel = this.indeterminateLabel;
    return {
      get indeterminate(): string | undefined {
        return indeterminateLabel.get();
      },
    };
  }

  /**
   * What the bar carries: the primitive's ARIA, and what names it.
   *
   * One bag rather than a spread and an attribute beside it. `:spread`
   * rewrites the element whenever the state it reads changes and clears the
   * keys the new object does not carry, so a name written next to it is a name
   * the first change of value wipes. The names are not handed to the primitive
   * either, which reads its options once: they are read here, so a name bound
   * to a signal — a file's own, a step that changes — follows it.
   *
   * What the caller wrote in ARIA wins over the prop that says the same thing.
   * Two spellings of one name can only disagree by mistake, and the attribute
   * is the one they wrote on the tag.
   */
  rootProps(): ProgressProps {
    const labelledBy = this.ariaLabelledBy.get() ?? this.labelledBy.get();
    return {
      ...this.progress.rootProps(),
      'aria-labelledby': labelledBy,
      // One name only: an element with both is named by the reference, and the
      // ignored `aria-label` then drifts out of date unnoticed.
      'aria-label': labelledBy ? undefined : (this.ariaLabel.get() ?? this.label.get()),
      'aria-describedby': this.describedBy.get(),
    };
  }

  /** The value as the label and `aria-valuetext` both say it. */
  valueText(value: number, percent: number): string {
    const format = this.format.get();
    if (format) return format(value, percent);
    // `Intl` writes the digits, the separator and the sign the way the
    // language does; `${percent}%` writes them the way English does.
    return this.locale.format.percent(percent / 100);
  }

  /**
   * What the label says: the value, or the wait while there is no value.
   *
   * The wait is spelled the same way the primitive spells it, from the same
   * signal, so that the label and `aria-valuetext` are one answer read twice
   * rather than two answers that agree until one of them changes.
   */
  text(): string {
    const value = this.progress.value();
    if (value === null) return this.indeterminateLabel.get() ?? this.locale.t('loading');
    return this.valueText(value, this.progress.percent() ?? 0);
  }

  /**
   * How far the bar has come, as a width.
   *
   * Written inline because it is a number, and the sheet holds no numbers a
   * value could be one of. Nothing at all while indeterminate: the width is
   * then the sheet's, and an inline one would beat the rule that sizes the
   * travelling bar.
   */
  fill(): Record<string, string> {
    const percent = this.progress.percent();
    return percent === null ? {} : { 'inline-size': `${percent}%` };
  }
}
