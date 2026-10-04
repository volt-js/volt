import { Component, Prop, Signal, isWritableSignal } from '@voltdev/core';
import {
  createSeparator,
  type Separator,
  type SeparatorOptions,
  type SeparatorOrientation,
  type SeparatorProps,
} from '@voltdev/primitives';

/**
 * The bag with the entries that say nothing taken out.
 *
 * The bag is spread onto the element `:host` marks, which is where everything
 * a caller wrote on the tag has landed, and `:spread` writes `undefined` as
 * "take that attribute away". The primitive carries `aria-controls` and
 * `aria-valuetext` as `undefined` when it was handed nothing for them, which
 * is no opinion — not the opinion that the `aria-controls` the caller wrote
 * should go.
 */
function said(props: SeparatorProps): Record<string, string | boolean> {
  const kept: Record<string, string | boolean> = {};
  for (const [name, value] of Object.entries(props)) if (value !== undefined) kept[name] = value;
  return kept;
}

/**
 * The way the line runs, refused when it is not one the primitive knows.
 *
 * The primitive takes anything that is not `vertical` to be horizontal when it
 * reads the keys, and writes whatever it was given into `aria-orientation` and
 * `data-orientation` all the same — so `orientation="row"` is an invalid ARIA
 * value, and a separator the sheet draws no line on at all. Refused here,
 * while the prop is still the thing that is wrong.
 */
function orientationOf(value: unknown): SeparatorOrientation {
  if (value === undefined || value === null) return 'horizontal';
  if (value === 'horizontal' || value === 'vertical') return value;
  throw new Error(
    `[volt] \`orientation\` on <v-separator> is 'horizontal' or 'vertical', and ` +
      `\`${String(value)}\` is neither.\n` +
      '  It is the way the line runs: a rule between two panes side by side is `vertical`.',
  );
}

/**
 * A flag, as a tag is able to deliver one.
 *
 * Written bare it is on, and bound it is whatever it was bound to. Written as
 * an attribute it is a string, and every string is truthy — so
 * `decorative="false"` was a rule that stayed decorative, the one thing the
 * caller had said it was not. Every string is on here but `"false"`, which
 * nobody writes meaning on. Unset is the flag's own default.
 */
function flag(value: boolean, fallback: boolean): boolean {
  // Typed as a flag and handed a string all the same: the type is what the
  // tag promises, and an attribute is what it delivers.
  const written: unknown = value;
  if (written === undefined || written === null) return fallback;
  return written !== false && written !== 'false';
}

/**
 * A number, as an attribute is able to carry one, refused when it is none.
 *
 * `step="5"` arrives as the string `'5'`, and the primitive adds the step to
 * the size it has — `30 + '5'` is `'305'`, which it then clamps to the
 * maximum: one press of an arrow throws the pane to its end. `min="15"` is
 * worse, because the primitive refuses a size that is not a finite number,
 * and Home is then a key that does nothing. A string that is a number is
 * that number, which is the only thing `step="5"` could have been asking for.
 *
 * Anything else is refused rather than read as the default. Bound as `NaN`,
 * a `max` reached the DOM as `aria-valuenow="NaN"` and `aria-valuemax="NaN"`
 * — which a screen reader says as written — and no key moved the pane again;
 * written as `max="lots"`, it was 100 without a word about it. Unset is the
 * default.
 */
function numeric(name: 'min' | 'max' | 'step', value: number, fallback: number): number {
  const written: unknown = value;
  if (written === undefined || written === null) return fallback;
  const read = typeof written === 'string' && written.trim() !== '' ? Number(written) : written;
  if (typeof read === 'number' && Number.isFinite(read)) return read;
  throw new Error(
    `[volt] \`${name}\` on <v-separator> is a number, and \`${String(written)}\` is not one.\n` +
      "  It is in your units, as the size is — `:max=\"60\"`, or `max=\"60\"` — and it is what " +
      'the splitter reports and where its keys stop, so a value that is not a number has no ' +
      'reading that would be right.',
  );
}

/**
 * The range a splitter moves through, and how far one key moves it, refused
 * when no key could move it through that range.
 *
 * The primitive takes all three as they come: a `min` past `max` is written
 * out as `aria-valuemin` above `aria-valuemax`, with every key pinned at an
 * end, and a `step` of nought takes the arrows from the page and moves
 * nothing, where one below nought turns them round.
 */
function range(min: number, max: number, step: number): { min: number; max: number; step: number } {
  if (min > max) {
    throw new Error(
      `[volt] \`min\` on <v-separator> is ${min}, which is past \`max\` at ${max}.\n` +
        '  The pane is sized from `min` up to `max`, and Home and End take it to the one and the other.',
    );
  }
  if (step <= 0) {
    throw new Error(
      `[volt] \`step\` on <v-separator> is how far one press of an arrow moves the pane, and ${step} ` +
        'does not move it forward.\n' +
        '  The arrow towards the end grows the pane by `step`, and the other shrinks it: a step of 1 ' +
        'is a point in your units.',
    );
  }
  return { min, max, step };
}

/**
 * The caller's own signal, refused when it is not one.
 *
 * `resize` is the single signal the page and the splitter both hold — the
 * page sizes its pane from it, and the keys move it — and markup has no way
 * to write a signal: `resize="30"` hands over a string, which the primitive
 * keeps and calls `.get()` on inside an effect, where the `TypeError` is
 * swallowed. What is left is a line with no value that no key moves, and
 * nothing names the tag that caused it.
 */
function ownSignal(value: unknown): Signal.State<number> {
  if (isWritableSignal(value)) return value as Signal.State<number>;
  throw new Error(
    `[volt] \`resize\` on <v-separator> takes a signal your component holds, and ` +
      `\`${String(value)}\` is not one.\n` +
      '  It is the size of the pane before the line, which your markup sizes the pane from: ' +
      'hold a `new Signal.State(30)` and bind it as `:prop-resize="sidebar"` — `resize` is the ' +
      "window's event as well, so `:resize` would be read as a listener.",
  );
}

/**
 * A divider, and — given a size to move — a window splitter.
 *
 * ```html
 * <v-separator></v-separator>
 * <v-separator label="or"></v-separator>
 * <v-separator orientation="vertical" :prop-resize="sidebar" :min="15" :max="60"
 *              resizeLabel="Resize sidebar" collapsible></v-separator>
 * ```
 *
 * Decorative by default, as the primitive has it: most rules divide things
 * the page has already divided — two groups of a menu, two paragraphs — and
 * `role="separator"` on each one is an announcement about a line. `decorative`
 * false is for a rule that means something, such as the edge between two
 * regions, and gives it the role and a name.
 *
 * `label` is words on the line, drawn in a gap in the middle of it — "or"
 * between two ways to sign in, a date between two days of a chat. On a
 * decorative rule they are read where they stand, as the text they are; on
 * one with a role they are its name, since everything inside a separator is
 * presentational and would otherwise not be read at all.
 *
 * `resize` makes it a splitter: focusable, holding the size of the pane
 * before it, which the arrows move, Home and End take to `min` and `max`, and
 * Enter collapses and restores when it is `collapsible` — all of it the
 * primitive's. A pointer drag is not here. Dragging is layout: it has to know
 * where the panes are and what a pixel is worth in the caller's units, which
 * a separator does not. `createResizable` measures its group and drags;
 * `setValue` on this one's primitive is the way in for a drag of your own.
 *
 * Everything else a caller writes on the tag lands on the line's element,
 * which is the one with the role: `aria-controls` naming the pane a splitter
 * sizes, a `dir`, an `id`, a class.
 *
 * Every element it draws is a `<span>`, because a vertical rule stands
 * between two words as often as between two panes: a `<div>` written by a
 * server inside a paragraph ends the paragraph where it starts, in the
 * browser's parser, and the rule is pulled out of the line it stood in.
 */
@Component({ selector: 'v-separator', templateUrl: './separator.html' })
export class VSeparator {
  /**
   * The eight below are what the primitive is built with, read once while
   * this field list initializes — plain, because a signal would promise a
   * caller they can change them later and the primitive would not hear it.
   */
  /**
   * The way the line runs — not the way it moves. Default horizontal, as
   * `<hr>` is; a splitter between two panes side by side is a vertical line,
   * and Left and Right move it.
   */
  @Prop() orientation: SeparatorOrientation = 'horizontal';
  /**
   * A rule that only divides things the eye can already see are divided.
   * Default true. False gives it `role="separator"` and a name, for a rule that
   * means something, such as the edge between two regions. A splitter is never
   * decorative, whatever this says, because a control cannot be presentation.
   */
  @Prop() decorative = true;
  /**
   * The size of the pane before the line, in your units — a percentage, given
   * the default 0 to 100. Your signal, and what makes this a splitter: the
   * keys move it, and your markup sizes the pane from it.
   *
   * Bound as `:prop-resize`: `resize` is the window's event as well, and
   * `:resize` on any tag is read as a listener for it.
   */
  @Prop() resize?: Signal.State<number>;
  /** The smallest the pane before a splitter can be, and where Home takes it. Default 0. */
  @Prop() min = 0;
  /** The largest it can be, and where End takes it. Default 100, and never less than `min`. */
  @Prop() max = 100;
  /** How far one press of an arrow moves it. Default 1, and always more than nought. */
  @Prop() step = 1;
  /**
   * Enter collapses the pane to `min`, and the next Enter restores the size it
   * collapsed from. Default false.
   */
  @Prop() collapsible = false;
  /**
   * Called with each size the splitter moves the pane to — by a key, or by
   * `setValue` on the primitive — and not for a write to your own signal,
   * which you already know about.
   */
  @Prop() onResize?: (size: number) => void;

  /**
   * Words on the line, drawn in a gap in its middle — "or", a date between two
   * days of a chat. The name of a separator that is not decorative, unless it
   * is given one of its own.
   */
  @Prop() label = new Signal.State<string | undefined>(undefined);
  /**
   * What a splitter is called — "Resize sidebar" — which says what moving it
   * does. A splitter is a control and needs a name, and the words on a line
   * rarely make one; none is invented, because a wrong name is worse than a
   * missing one. Ignored on a line that does not move.
   */
  @Prop() resizeLabel = new Signal.State<string | undefined>(undefined);
  /**
   * The separator's name, in the platform's own spelling, ahead of
   * `resizeLabel` and `label`.
   *
   * Declared rather than left to fall through to `:host`, which lands on the
   * same element: a name written on the tag and the name the bag carries
   * would then be two spreads writing one attribute, and whichever ran last
   * would win. Declared, it is written with the rest — and not at all on a
   * decorative rule, whose role ARIA forbids naming.
   */
  @Prop({ alias: 'aria-label' }) ariaLabel = new Signal.State<string | undefined>(undefined);
  /**
   * The id of an element that already names the separator on screen, which
   * beats every other name, as it does in the accessible name computation.
   * Declared for the reason `aria-label` is, and dropped on a decorative rule
   * for the same reason.
   */
  @Prop({ alias: 'aria-labelledby' }) ariaLabelledBy = new Signal.State<string | undefined>(
    undefined,
  );

  /**
   * The primitive, built from the props above — which is why props have to be
   * there while a field initializes.
   */
  readonly separator: Separator = createSeparator(this.options());

  /**
   * The words on the line, when there are any to draw.
   *
   * Blank is none: a gap with nothing in it is a broken line, and a name of
   * spaces is no name.
   *
   * Anything else is the text it reads as. Typed as a string, and bound as
   * whatever the caller holds — a year kept as a number reached `trim` as a
   * number, and the `TypeError` was swallowed inside the binding: no words
   * drawn, no name written, and nothing said about either.
   */
  words(): string | undefined {
    const written: unknown = this.label.get();
    if (written === undefined || written === null) return undefined;
    const text = String(written);
    return text.trim() ? text : undefined;
  }

  /**
   * What the line's element carries: the primitive's bag, and what names it.
   *
   * A decorative rule is `role="presentation"` and nothing else. ARIA forbids
   * naming it, and a browser that meets a name there may answer by dropping
   * the presentation and exposing the element underneath — a nameless
   * `<span>` given a name, in the middle of the content — so a caller's
   * `aria-label` on a decorative rule is not written.
   */
  separatorProps(): Record<string, string | boolean> {
    const props = said(this.separator.separatorProps());
    if (props['role'] === 'presentation') return props;
    return { ...props, ...this.naming() };
  }

  /**
   * The primitive's keys, and the page's own use of them held back: the
   * arrows, Home and End it moves a splitter with would scroll the page as
   * well.
   */
  onKeyDown(event: KeyboardEvent): void {
    if (this.separator.onKeyDown(event)) event.preventDefault();
  }

  /**
   * What names a separator that has a role: a reference the caller wrote, or
   * else the first of their own name, a splitter's name, and the words on the
   * line.
   *
   * A reference beats a name, as it does in the accessible name computation,
   * so the two are never both written — an element carrying both is named by
   * the reference, and the ignored name drifts out of date unnoticed. Read
   * here, rather than handed to the primitive, because the primitive reads its
   * options once, and a name bound to a signal has to follow it.
   */
  private naming(): Record<string, string> {
    const reference = this.ariaLabelledBy.get();
    if (reference) return { 'aria-labelledby': reference };
    const splitter = this.separator.value() === null ? undefined : this.resizeLabel.get();
    const name = this.ariaLabel.get() || splitter || this.words();
    return name ? { 'aria-label': name } : {};
  }

  /** What the primitive is built with. */
  private options(): SeparatorOptions {
    const orientation = orientationOf(this.orientation);
    const decorative = flag(this.decorative, true);
    if (this.resize === undefined) return { orientation, decorative };
    return {
      orientation,
      decorative,
      resize: {
        value: ownSignal(this.resize),
        ...range(numeric('min', this.min, 0), numeric('max', this.max, 100), numeric('step', this.step, 1)),
        collapsible: flag(this.collapsible, false),
        ...(this.onResize ? { onValueChange: this.onResize } : {}),
      },
    };
  }
}
