import { Component, Prop, Signal } from '@voltdev/core';
import {
  createSlider,
  useLocale,
  type Locale,
  type Slider,
  type SliderMark,
  type SliderOrientation,
  type SliderProps,
} from '@voltdev/primitives';

/** One entry of a prop bag, as the primitive types them. */
type Entry = string | boolean | undefined;

/**
 * A bag with the entries that say nothing taken out.
 *
 * The root's bag is spread onto the element `:host` marks, which is where
 * everything a caller wrote on the tag has landed. `:spread` writes every key
 * it is handed, and `undefined` is written as "take that attribute away" — so
 * `data-required: undefined`, which is the primitive never having been told
 * the slider is required, removes a `data-required` the caller wrote there
 * themselves the first time a key rewrites the bag. No opinion is not the
 * opinion "not that".
 *
 * What the bag does carry still wins, and a key it stops carrying is still
 * cleared: the spread remembers what it wrote, so `data-dragging` ending
 * removes its own attribute without this having to say `undefined` to mean it.
 */
function said(props: Record<string, Entry>): SliderProps {
  return Object.fromEntries(Object.entries(props).filter(([, value]) => value !== undefined));
}

/**
 * The caller's own signal, refused when it is not one.
 *
 * `value` is the single signal the page and the slider both hold, and markup
 * has no way to write a signal: `value="40"` hands over a string, which the
 * primitive keeps and later calls `.get()` on. That `TypeError` is raised
 * inside an effect, where it is swallowed — what is left on the page is a
 * group with no thumbs, and nothing anywhere names the tag that caused it.
 * Refused here instead, while the prop is still the thing that is wrong, and
 * pointed at `defaultValue`, which is how starting at a number is spelled.
 */
function ownSignal(value: unknown): Signal.State<readonly number[]> {
  const candidate = value as Partial<Signal.State<readonly number[]>> | null | undefined;
  if (typeof candidate?.get === 'function' && typeof candidate.set === 'function') {
    return value as Signal.State<readonly number[]>;
  }
  throw new Error(
    `[volt] \`value\` on <v-slider> takes a signal your component holds, and \`${String(value)}\` ` +
      'is not one.\n' +
      '  To have it start at a number, write `defaultValue`. To drive it, hold a ' +
      '`new Signal.State<readonly number[]>([40])` and pass that: `:value="volume"`.',
  );
}

/**
 * The caller's wording, refused when it is not a function.
 *
 * Markup has no way to name a function except by binding it, so
 * `format="pounds"` hands over the word. Every thumb's bag calls it, inside an
 * effect, where the `TypeError` is swallowed — what is left on the page is a
 * thumb with no role, no value and no place in the tab order, and nothing
 * anywhere names the tag that caused it. Refused here instead, like `value`.
 *
 * Nothing is not refused, in either spelling: `null` is how a binding says
 * "none", and every reader of the wording already asks for it with `?.`.
 */
function wording(format: unknown): void {
  if (format === undefined || format === null || typeof format === 'function') return;
  throw new Error(
    `[volt] \`format\` on <v-slider> takes a function, and \`${String(format)}\` is not one.\n` +
      '  Bind it, with the colon: `:format="pounds"`, where `pounds` is ' +
      '`(value: number, index: number) => string`.',
  );
}

/**
 * A flag, as a tag is able to deliver one.
 *
 * Written bare it is on, and bound it is whatever it was bound to. Written as
 * an attribute it is a string, and every string is truthy — so
 * `disabled="false"` locked a slider the caller had just said was not locked,
 * and wrote `data-disabled="false"` on every part, which every
 * `[data-disabled]` rule matches. Every string is on here but `"false"`,
 * which nobody writes meaning on. A signal prop is handed the same string a
 * plain one is, so it goes through here too.
 */
function flag(value: boolean): boolean {
  // Typed as a flag and handed a string all the same: the type is what the
  // tag promises, and an attribute is what it delivers.
  const written: unknown = value;
  return written !== false && written !== 'false' && written !== null && written !== undefined;
}

/**
 * The way the track runs, refused when it is not one the primitive knows.
 *
 * The primitive reads anything that is not `vertical` as horizontal, and
 * writes whatever it was given into `aria-orientation` and `data-orientation`
 * all the same — so `orientation="sideways"` put a value ARIA does not have
 * on every thumb, beside a track the sheet drew lying down. Refused here,
 * while the prop is still the thing that is wrong.
 */
function orientationOf(value: unknown): SliderOrientation {
  if (value === undefined || value === null) return 'horizontal';
  if (value === 'horizontal' || value === 'vertical') return value;
  throw new Error(
    `[volt] \`orientation\` on <v-slider> is 'horizontal' or 'vertical', and ` +
      `\`${String(value)}\` is neither.\n` +
      '  It is the way the track runs: a slider stood on end is `vertical`, and grows upwards.',
  );
}

/**
 * A number, as an attribute is able to carry one.
 *
 * `min="20"` arrives as the string `'20'`, and the primitive adds to its
 * minimum when it quantises — `min + steps * step` — which for a string is
 * concatenation: a slider told `min="20"` reports its first step as `201`,
 * and nothing is raised anywhere. A string that is a number is that number,
 * which is the only thing `min="20"` could have been asking for.
 */
function numeric(value: number, fallback: number): number {
  // Typed as a number and handed a string all the same, which is the whole
  // reason this exists: the type is what the tag promises, and an attribute is
  // what it delivers.
  const written: unknown = value;
  if (typeof written === 'number') return written;
  if (typeof written === 'string' && written.trim() !== '' && Number.isFinite(Number(written))) {
    return Number(written);
  }
  return fallback;
}

/** `"20, 80"` as the numbers it spells, or nothing when any part is not one. */
function numbersIn(text: string): readonly number[] | undefined {
  const numbers = text.split(',').map((part) => (part.trim() === '' ? Number.NaN : Number(part)));
  return numbers.every(Number.isFinite) ? numbers : undefined;
}

/**
 * A starting value, in every way a tag can carry one.
 *
 * The primitive takes a list, one entry per thumb, and a list is what
 * `:defaultValue="[20, 80]"` hands over. `:defaultValue="40"` hands over a
 * number, and `defaultValue="40"` or `defaultValue="20, 80"` a string, and all
 * of them were asking for the same thing. Anything else is handed to the
 * primitive as nothing, which starts the thumb at the minimum.
 */
function startingValues(value: number | readonly number[]): readonly number[] | undefined {
  const written: unknown = value;
  if (typeof written === 'number') return [written];
  if (Array.isArray(written)) return written.map(Number);
  return typeof written === 'string' ? numbersIn(written) : undefined;
}

/**
 * Ticks, in every way a tag can carry them.
 *
 * A list is what the primitive takes. `marks="0, 50, 100"` is a string, and
 * the primitive would call `.map` on it while this class is still being built
 * — an error about a method, raised from inside a field initializer, naming
 * nothing the caller wrote. A string of numbers is those numbers as bare
 * ticks, which is all an attribute can spell; a tick with words under it
 * needs the binding.
 */
function ticks(
  value: readonly (number | SliderMark)[],
): readonly (number | SliderMark)[] | undefined {
  const written: unknown = value;
  if (Array.isArray(written)) return value;
  return typeof written === 'string' ? numbersIn(written) : undefined;
}

/**
 * Thumb names, in every way a tag can carry them.
 *
 * A list is what the binding hands over. `thumbLabels="From, To"` hands over
 * a string, and a string indexed is its letters: the thumbs of a range were
 * read out as "F" and "r", and a single thumb told `thumbLabels="Level"` as
 * "L". A comma separates names in an attribute as it separates numbers in
 * `defaultValue` and `marks`; a name with a comma in it needs the binding.
 */
function names(value: readonly string[] | undefined): readonly string[] | undefined {
  const written: unknown = value;
  return typeof written === 'string' ? written.split(',').map((part) => part.trim()) : value;
}

/**
 * A name the caller wrote, or nothing when what they wrote is blank.
 *
 * The accessible name computation skips an `aria-label` or `aria-labelledby`
 * that holds nothing but white space, so a blank one is no name at all, and
 * ranking it above the label this draws named nothing: `:aria-label="''"`
 * beside `label="Volume"` wrote an empty name over the reference to "Volume",
 * and left the thumb with no name a reader could hear.
 */
function written(value: string | undefined): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

/**
 * A slider, single or range: a track, the filled span, and a thumb per value.
 *
 * ```html
 * <v-slider :value="volume" label="Volume" name="volume"></v-slider>
 * <v-slider :defaultValue="[20, 80]" label="Price" name="price" :format="pounds"></v-slider>
 * ```
 *
 * One thumb or two is decided by how many numbers the value holds, not by a
 * flag: a range is a slider with a second thumb, and a flag beside the value
 * would only let the two disagree. The value is always a list for the same
 * reason — `values()` is the list, `value()` the first of it.
 *
 * The group carries the name and each thumb carries the role: a thumb is the
 * thing with a value, and `role="slider"` is where the arrows, Page keys, Home
 * and End live. A press on the track moves the nearest thumb to the pointer
 * and picks it up, so a value follows a finger from the first frame. The
 * press is heard on the track and not on the group, because the group also
 * holds the label, and a press on the words is not a press at a value.
 *
 * Behind every thumb is a real `<input type="range">`, visually hidden by the
 * primitive and carrying the value: it is what submits with the form, what
 * `form.reset()` puts back, and what the platform range-checks. A range
 * submits `name` twice, once per thumb, in ascending order.
 *
 * The sheet places nothing along the track. Where a thumb, a mark or the fill
 * sits is a percentage the primitive reports, and this writes it inline on the
 * one edge the sheet leaves to it — `inset-inline-start` along a horizontal track,
 * `inset-block-end` up a vertical one — so a horizontal slider mirrors itself
 * under `dir="rtl"` with no rule for it anywhere.
 */
@Component({ selector: 'v-slider', templateUrl: './slider.html' })
export class VSlider {
  /**
   * Your own signal, when the value belongs to your component. One number for
   * a slider, two for a range.
   */
  @Prop() value?: Signal.State<readonly number[]>;

  /**
   * The seven below are what the primitive is built with, read once while this
   * field list initializes — plain, because a signal would promise a caller
   * they can change them later and the primitive would not hear it.
   */
  /**
   * Where it starts, when the value is the slider's own. A number, a list, or
   * a string of either — `40`, `[20, 80]`, `"20, 80"`. Default the minimum.
   */
  @Prop() defaultValue?: number | readonly number[];
  /** The bottom of the range. Default 0. */
  @Prop() min = 0;
  /** The top of it. Default 100. */
  @Prop() max = 100;
  /** What every value is rounded to, and what one arrow press moves by. Default 1. */
  @Prop() step = 1;
  /** Which way the track runs. Default horizontal. */
  @Prop() orientation: SliderOrientation = 'horizontal';
  /**
   * Submitted as `name=value`, once per thumb. Without a name the hidden
   * inputs submit nothing.
   */
  @Prop() name?: string;
  /**
   * Ticks on the track: a value, or `{ value, label }` for one with words
   * under it. A value outside `min`–`max` is dropped. An attribute spells bare
   * ticks — `marks="0, 50, 100"`.
   */
  @Prop() marks?: readonly (number | SliderMark)[];

  /**
   * The name of the whole control, drawn above the track.
   *
   * Drawn rather than hidden because a slider has no words of its own to be
   * named from, and a control nobody can see the name of is one nobody can
   * find. A single thumb takes this as its own name too, unless `thumbLabels`
   * names it; the thumbs of a range are named apart from it.
   *
   * It is also what says there is a label at all. The `label` slot fills the
   * element this draws, so that markup written for the name lands in the
   * element the thumbs point at rather than beside it — and without this,
   * neither the element nor the slot is drawn.
   */
  @Prop() label = new Signal.State<string | undefined>(undefined);
  /**
   * A name per thumb, in order, which wins wherever it is given. Default
   * "Minimum" and "Maximum" for a range, and the slider's own name for a single
   * thumb — or "Value", when it has none. An attribute spells the list with
   * commas — `thumbLabels="From, To"`. A blank entry is no name, and leaves
   * that thumb its default.
   */
  @Prop() thumbLabels = new Signal.State<readonly string[] | undefined>(undefined);
  /**
   * What a screen reader hears in place of the number — "£25", "medium".
   * Default the number written for the locale, which already spaces and
   * separates its digits the way the language does.
   *
   * A signal, because it reaches every thumb's `aria-valuetext` on the next
   * write of its bag: a wording swapped for another has to reach a slider
   * already on screen.
   */
  @Prop() format = new Signal.State<
    ((value: number, index: number) => string) | null | undefined
  >(undefined);

  /**
   * The three below are the platform's own spellings, declared rather than
   * left to fall through to `:host`, which lands on this component's group as
   * well. A name written on the tag and the name the primitive's bag carries
   * would then be two spreads writing one attribute, and the bag — which
   * points `aria-labelledby` at its own label element, or at nothing — would
   * take the caller's back on the first move. Declaring them brings the name
   * here, where it is written together with the rest, and onto the single
   * thumb, which is the control a reader lands on.
   */
  /** Names the slider, and its one thumb, in place of `label`. */
  @Prop({ alias: 'aria-label' }) ariaLabel = new Signal.State<string | undefined>(undefined);
  /** Ids of whatever already names the slider; outranks `aria-label` and `label`. */
  @Prop({ alias: 'aria-labelledby' }) ariaLabelledBy = new Signal.State<string | undefined>(
    undefined,
  );
  /**
   * Ids of whatever describes it, written on every thumb — a thumb is where
   * focus lands, and a description is read when it does.
   */
  @Prop({ alias: 'aria-describedby' }) describedBy = new Signal.State<string | undefined>(
    undefined,
  );

  /**
   * Refuses the pointer and the keyboard, and is written through to the hidden
   * inputs so a slider nobody can reach submits nothing.
   *
   * Every thumb keeps its place in the tab order — `aria-disabled`, not the
   * `disabled` attribute — which is this package's rule for every disabled
   * control, and the primitive's. Written bare or bound; `disabled="false"`
   * is off.
   */
  @Prop() disabled = new Signal.State(false);

  /** Called with every value, including every frame of a drag. */
  @Prop() onValueChange?: (values: readonly number[]) => void;
  /**
   * Called once a gesture has ended — a drag released, a key pressed. This is
   * the one to send to a server; `onValueChange` fires per pointer move.
   */
  @Prop() onValueCommit?: (values: readonly number[]) => void;

  /**
   * The group, the track and the label, each a signal because the primitive
   * watches them: the thumbs and the hidden inputs are found under the group,
   * a press is measured against the track, and the name is read off the label
   * — none of which exist while this class is being built.
   */
  root = new Signal.State<Element | null>(null);
  track = new Signal.State<Element | null>(null);
  labelElement = new Signal.State<Element | null>(null);

  /**
   * The page's language, for the digits a thumb is announced with.
   *
   * Resolved once, while this field list initializes, because that is where a
   * provider is in scope. The locale itself is live.
   */
  readonly locale: Locale = useLocale();

  /**
   * The primitive, built from the props above — which is why props have to be
   * there while a field initializes.
   */
  readonly slider: Slider = createSlider({
    root: () => this.root.get(),
    track: () => this.track.get(),
    label: () => this.labelElement.get(),
    min: numeric(this.min, 0),
    max: numeric(this.max, 100),
    step: numeric(this.step, 1),
    orientation: orientationOf(this.orientation),
    disabled: () => flag(this.disabled.get()),
    valueText: (value, index) => this.valueText(value, index),
    ...(this.name !== undefined ? { name: this.name } : {}),
    ...(this.marks !== undefined ? { marks: ticks(this.marks) } : {}),
    ...(this.value !== undefined ? { value: ownSignal(this.value) } : {}),
    ...(this.defaultValue !== undefined
      ? { defaultValue: startingValues(this.defaultValue) }
      : {}),
    ...(this.onValueChange ? { onValueChange: this.onValueChange } : {}),
    ...(this.onValueCommit ? { onValueCommit: this.onValueCommit } : {}),
  });

  constructor() {
    // Asked once the tag has handed it over, and not in the bag that reads it,
    // where an error is swallowed.
    wording(Signal.subtle.untrack(() => this.format.get()));
  }

  /**
   * What names the group, or its one thumb: what the caller wrote on the tag,
   * or else the label this draws.
   *
   * A reference beats a name, as it does in the accessible name computation,
   * so the two are never both written — an element carrying both is named by
   * the reference, and the ignored name drifts out of date unnoticed. And a
   * name the caller wrote beats the label: two names can only disagree by
   * mistake, and the tag is the one they wrote. A blank one is not a name, and
   * outranks nothing.
   */
  naming(drawn: string | undefined): Record<string, Entry> {
    const reference = written(this.ariaLabelledBy.get());
    if (reference !== undefined) return { 'aria-labelledby': reference, 'aria-label': undefined };
    const name = written(this.ariaLabel.get());
    if (name !== undefined) return { 'aria-labelledby': undefined, 'aria-label': name };
    return { 'aria-labelledby': drawn, 'aria-label': undefined };
  }

  /**
   * What the group carries: the primitive's bag, and what names it.
   *
   * The primitive gives the group an id of its own, so that its thumbs can be
   * numbered after it, and nothing reads that id back off the element. It is
   * left out so that an `id` the caller wrote on the tag is the one on the
   * element they can see.
   */
  rootProps(): SliderProps {
    const { id: _numbering, ...props }: Record<string, Entry> = this.slider.rootProps();
    return said({ ...props, ...this.naming(this.drawnLabel()) });
  }

  /**
   * The id of the label this draws, while it draws one.
   *
   * Worked out from what the template is told rather than read off the
   * element, which is how the primitive answers. A server sets no ref, so its
   * answer there is nothing: a slider named by its label went out with the
   * group unnamed and its one thumb called "Value", and a page that attached
   * kept that "Value" beside the reference the client added, since a spread
   * that claims an element only takes away what it wrote itself. The element
   * is drawn exactly when `label` is set and carries the id the primitive
   * hands it, so on the client the two answers are one.
   */
  drawnLabel(): string | undefined {
    const id = this.slider.labelProps()['id'];
    return this.label.get() && typeof id === 'string' ? id : undefined;
  }

  /**
   * What one thumb carries: the primitive's bag, and the name it goes by.
   *
   * A name from `thumbLabels` is the thumb's own and wins outright. Ranking it
   * among the group's names instead made a cycle on a single thumb — the
   * drawn label beat it, it beat `aria-label`, and `aria-label` beat the
   * drawn label — so which name a reader heard turned on which two of the
   * three were written.
   *
   * Without one, a single thumb is the control, so whatever names the group
   * names it too. The thumbs of a range are named apart from the group,
   * because "Price, Minimum" is how a reader learns which end this is, and are
   * never given the group's reference — a thumb carrying both would read as
   * "Price Minimum Price".
   *
   * The caller's description is added to whatever the primitive's field
   * already points at, never written over it.
   */
  thumbProps(index: number): SliderProps {
    const props = this.slider.thumbProps(index);
    // Blank is no name, here as on the tag, and outranks nothing.
    const own = written(names(this.thumbLabels.get())?.[index]);
    const named: Record<string, Entry> = own
      ? { 'aria-labelledby': undefined, 'aria-label': own }
      : this.slider.values().length <= 1
        ? this.naming(this.drawnLabel())
        : { 'aria-labelledby': undefined, 'aria-label': undefined };
    // A blank list holds no id, and points at nothing.
    const described = [this.describedBy.get(), props['aria-describedby']]
      .filter((ids) => typeof ids === 'string' && ids.trim() !== '')
      .join(' ');
    return said({
      ...props,
      'aria-labelledby': named['aria-labelledby'],
      'aria-label': named['aria-labelledby']
        ? undefined
        : (named['aria-label'] ?? props['aria-label']),
      'aria-describedby': described || undefined,
    });
  }

  /** The value as a thumb announces it. */
  valueText(value: number, index: number): string {
    return this.format.get()?.(value, index) ?? this.locale.format.number(value);
  }

  /**
   * Whether any mark has words under it, which is when the track needs room
   * left beneath it. Written on the group for the sheet to read, since a mark
   * is inside the track and cannot make room outside it.
   */
  scaled(): boolean {
    return this.slider.marks().some((mark) => mark.label !== undefined);
  }

  /**
   * Where the fill runs, as the two edges of the range.
   *
   * Inline because it is a number, and the sheet holds no numbers a value
   * could be one of. Both edges rather than an edge and a width, so a range
   * between two thumbs and a fill from the minimum are one rule.
   */
  rangeStyle(): Record<string, string> {
    const { start, end } = this.slider.fill();
    return this.slider.orientation() === 'vertical'
      ? { 'inset-block-end': `${start}%`, 'inset-block-start': `${100 - end}%` }
      : { 'inset-inline-start': `${start}%`, 'inset-inline-end': `${100 - end}%` };
  }

  /**
   * Where something sits along the track, on the one edge the sheet leaves to
   * the value. The logical edge, so a horizontal slider mirrors itself under
   * `dir="rtl"` with no rule for it.
   */
  place(percent: number): Record<string, string> {
    return this.slider.orientation() === 'vertical'
      ? { 'inset-block-end': `${percent}%` }
      : { 'inset-inline-start': `${percent}%` };
  }
}
