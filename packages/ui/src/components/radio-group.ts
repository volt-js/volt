import { Component, Prop, Signal, createContext, provideContext } from '@voltdev/core';
import { createRadioGroup, type ControlProps, type RadioGroup } from '@voltdev/primitives';
import { TagChildren } from './children.js';
import type { VRadio } from './radio.js';

/**
 * How a radio finds the group it was written inside.
 *
 * The content of a tag is built while the tag it sits in renders, so a radio's
 * scope descends from this one. A radio written anywhere else finds nothing
 * and says so.
 */
export const RadioGroupContext = createContext<VRadioGroup | null>(null);

/**
 * A bag with the entries that say nothing taken out.
 *
 * Both of this component's bags are spread onto the element `:host` marks,
 * which is where everything a caller wrote on the tag has landed. `:spread`
 * writes every key it is handed, and `undefined` is written as "take that
 * attribute away" — so `aria-required: undefined`, which is the primitive
 * having no opinion about a group that was never told it is required, removes
 * an `aria-required` the caller wrote there themselves. No opinion is not the
 * opinion "not that", and only the second is a reason to take away what
 * somebody else put on their own element.
 *
 * What the bag does carry still wins, and a key it stops carrying is still
 * cleared: the spread remembers what it wrote, so a state that ends removes
 * its own attribute without this having to say `undefined` to mean it.
 */
function said(props: ControlProps): ControlProps {
  return Object.fromEntries(Object.entries(props).filter(([, value]) => value !== undefined));
}

/**
 * A radio group: one choice out of several.
 *
 * ```html
 * <v-radio-group :value="plan" name="plan" label="Billing plan">
 *   <v-radio value="monthly">Monthly</v-radio>
 *   <v-radio value="yearly">Yearly, two months free</v-radio>
 * </v-radio-group>
 * ```
 *
 * The group is one control rather than a row of them. It holds a single tab
 * stop — the chosen radio, or the first while nothing is chosen — and the
 * arrows move within it, choosing as they go, which is what native radios do
 * and what makes the group answerable with one key per option instead of two.
 * All of that is `createRadioGroup`'s, including the hidden native radios that
 * carry the answer into the form: each `<v-radio>` draws one, they share this
 * group's `name`, and that is what `FormData`, `form.reset()` and the
 * browser's own `required` handling read.
 *
 * A `radiogroup` takes no name from the radios inside it — the words belong to
 * each choice, not to the question — so the question has to be written down:
 * `label`, or `labelledBy` pointing at the heading that already asks it.
 * Without either the group is announced as an unnamed group of radios, and a
 * screen reader user hears the answers without the question.
 */
@Component({ selector: 'v-radio-group', templateUrl: './radio-group.html' })
export class VRadioGroup {
  /** Your own signal, when the choice belongs to your component. */
  @Prop() value?: Signal.State<string | null>;
  /**
   * The three below are what the primitive is built with, read once while this
   * field list initializes — plain, because a signal would promise a caller
   * they can change them later and the primitive would not hear it.
   */
  /** Chosen from the start, when the choice is the group's own. */
  @Prop() defaultValue?: string | null;
  /**
   * The name every radio submits under. It is also what makes the hidden
   * inputs one group to the platform; without it the group submits nothing.
   */
  @Prop() name?: string;
  /** Arrows wrap past the first and last radio. */
  @Prop() loop = true;

  /**
   * Which way the radios are laid out: the sheet stacks them unless this says
   * otherwise, and the group says so in `aria-orientation`.
   *
   * It does not change the keyboard. Native radios answer to all four arrows
   * however they are arranged, and so do these.
   */
  @Prop() orientation = new Signal.State<'horizontal' | 'vertical'>('vertical');

  /** The question the radios answer, for a group with no heading of its own. */
  @Prop() label = new Signal.State<string | undefined>(undefined);
  /** Id of the element that asks it, when something on the page already does. */
  @Prop() labelledBy = new Signal.State<string | undefined>(undefined);

  /**
   * The same two in the platform's own spelling, declared rather than left to
   * fall through to `:host`.
   *
   * `:host` is on the group element, which is the one carrying
   * `role="radiogroup"` — so a name written on the tag lands in the right
   * place on its own. What it would not survive is the bag beside it: the
   * primitive's `groupProps()` names `aria-label`, and a spread re-applied
   * with `undefined` there wipes what the caller wrote a moment after it
   * landed. A declared prop is never a host attribute, so writing these down
   * brings the name here, where `groupProps()` merges it in instead.
   */
  @Prop({ alias: 'aria-label' }) ariaLabel = new Signal.State<string | undefined>(undefined);
  @Prop({ alias: 'aria-labelledby' }) ariaLabelledBy = new Signal.State<string | undefined>(
    undefined,
  );

  /**
   * Refuses the press and the keyboard for every radio at once, and is written
   * through to the hidden inputs so a disabled group submits nothing.
   *
   * A disabled radio is the package's one exception to keeping a disabled
   * control in the tab order: the arrows step over it and it never holds the
   * group's tab stop, so a group disabled as a whole has no tab stop at all.
   */
  @Prop() disabled = new Signal.State(false);
  /** Written through to every hidden input, so the platform enforces it. */
  @Prop() required = new Signal.State(false);

  /** Called with the value a user chose, or with null when a reset clears it. */
  @Prop() onValueChange?: (value: string | null) => void;

  /**
   * The group element.
   *
   * A signal rather than a plain field because the primitive watches it: the
   * radios are found by querying this element, and nothing can be found until
   * it is there.
   */
  group = new Signal.State<Element | null>(null);

  /**
   * The radios, in the order their rows are in the group.
   *
   * The primitive reads the DOM for everything it navigates, so this is not
   * how it finds them. It is how the group knows what was written inside it:
   * two radios sharing a value would both draw as chosen and both submit, and
   * that is caught here rather than by a user. It is also what `itemProps`
   * reads to put the tab stop back on a group the primitive's one reading of
   * the DOM was too early to see.
   *
   * In the order their rows are in, which is why each radio hands over the
   * row it drew: a `:for` that reorders moves the rows and registers nothing,
   * so the order comes back from the DOM, which is the side that decided it.
   */
  readonly radios = new TagChildren<VRadio>(
    () => this.group.get(),
    (radio) => radio.field,
  );

  /**
   * The primitive, built from the props above — which is why props have to be
   * there while a field initializes.
   */
  readonly radioGroup: RadioGroup = createRadioGroup({
    group: () => this.group.get(),
    disabled: () => this.disabled.get(),
    required: () => this.required.get(),
    loop: this.loop,
    ...(this.name !== undefined ? { name: this.name } : {}),
    ...(this.value ? { value: this.value } : {}),
    ...(this.defaultValue !== undefined ? { defaultValue: this.defaultValue } : {}),
    ...(this.onValueChange ? { onValueChange: this.onValueChange } : {}),
  });

  constructor() {
    provideContext(RadioGroupContext, this);
  }

  /**
   * What the group carries: the primitive's bag, and the three entries that
   * have to follow a signal.
   *
   * One bag rather than a spread with attributes written beside it. A spread
   * rewrites the element whenever the state it reads changes, so a name
   * written next to it is a name the first choice wipes. The names are not
   * handed to the primitive either, which is built once: they are read here,
   * so a question bound to a signal — one that is translated, or arrives with
   * the data — follows it.
   *
   * What the caller wrote in ARIA wins over the prop that says the same thing.
   * Two spellings of one name can only disagree by mistake, and the attribute
   * is the one they wrote on the tag.
   */
  groupProps(): ControlProps {
    return said({
      ...this.radioGroup.groupProps(),
      'aria-label': this.ariaLabel.get() ?? this.label.get(),
      'aria-labelledby': this.ariaLabelledBy.get() ?? this.labelledBy.get(),
      'aria-orientation': this.orientation.get(),
      // The sheet lays the radios out from this, and reads nothing from ARIA,
      // which is there to be spoken rather than styled against.
      'data-orientation': this.orientation.get(),
    });
  }

  /**
   * What one radio carries: the primitive's bag, and the tab stop put back
   * when the primitive cannot see where it belongs.
   *
   * A radio group holds a single tab stop, on the chosen radio — and, while
   * nothing is chosen, on the first one, or Tab could not reach the group at
   * all. The primitive works that fallback out by reading the DOM, once, when
   * the group element appears, and again whenever the choice is cleared: it
   * has no list of the radios to hear about, and says so. This side does —
   * they register as they are built — which is the same ground `<v-tabs>`
   * heals its own selection on.
   *
   * Two ordinary edits land outside that one reading, and both leave every
   * radio at `tabindex="-1"`, which is Tab stepping over the whole question
   * and no key reaching it again:
   *
   * - the radios arrive with the data they are drawn from, after the group
   *   has rendered empty;
   * - the choice names no radio here — restored from a saved form or a query
   *   string after the option was retired, or holding the value of a radio
   *   that has since left the page.
   *
   * So while nothing on screen answers the question, the tab stop is decided
   * here, from the radios in the order their rows are in. Everything else is
   * left to the primitive, including the group whose chosen radio is off:
   * that is one tab stop deliberately given to a radio that cannot take it,
   * and it is the primitive's to say so.
   */
  itemProps(value: string, disabled: boolean): ControlProps {
    const props = said(this.radioGroup.itemProps(value, disabled));
    const chosen = this.radioGroup.value();
    const radios = this.radios.all.get();
    if (chosen !== null && radios.some((radio) => radio.value.get() === chosen)) return props;

    const first = this.disabled.get()
      ? undefined
      : radios.find((radio) => !radio.disabled.get());
    return { ...props, tabindex: first?.value.get() === value ? '0' : '-1' };
  }
}
