import { Component, Prop, Signal, createContext, effect, provideContext } from '@voltdev/core';
import {
  createToggleGroup,
  type ToggleGroup,
  type ToggleGroupBaseOptions,
  type ToggleGroupItemOptions,
  type ToggleGroupItemProps,
  type ToggleGroupProps,
} from '@voltdev/primitives';
import { TagChildren } from './children.js';
import type { VToggle } from './toggle.js';

/** Replaced by the build; `true` where there is none, which is a test run. */
declare const __VOLT_DEV__: boolean;

const { untrack } = Signal.subtle;

/** One value at a time, or any number of them. */
export type ToggleGroupType = 'single' | 'multiple';
/** Which arrows move between the toggles, and which way the sheet lays them out. */
export type ToggleGroupOrientation = 'horizontal' | 'vertical';

/**
 * How a toggle finds the group it was written inside.
 *
 * The content of a tag is built while the tag it sits in renders, so a
 * toggle's scope descends from this one. A toggle written anywhere else finds
 * nothing — and is a toggle on its own, which is a thing a toggle can be.
 */
export const ToggleGroupContext = createContext<VToggleGroup | null>(null);

/**
 * A flag, as a tag is able to deliver one.
 *
 * Written bare it is on, and bound it is whatever it was bound to. Written as
 * an attribute it is a string, and every string is truthy — so `loop="false"`
 * would be a group that still wrapped. Every string is on here but `"false"`,
 * which nobody writes meaning on.
 *
 * Bound to nothing — `:loop="settings.loop"` with the setting never set — it
 * is the default the prop was left at, which is what the primitive does with
 * an option it was not given. No opinion is not the opinion "off".
 */
export function flag(value: boolean, fallback: boolean): boolean {
  // Typed as a flag and handed a string all the same: the type is what the
  // tag promises, and an attribute is what it delivers.
  const written: unknown = value;
  if (written === null || written === undefined) return fallback;
  return written !== false && written !== 'false';
}

/**
 * A bag with the entries that say nothing taken out.
 *
 * Both of this pair's bags are spread onto the element `:host` marks, which
 * is where everything a caller wrote on the tag has landed. `:spread` writes
 * every key it is handed, and `undefined` is written as "take that attribute
 * away" — so `aria-labelledby: undefined`, which is the primitive having no
 * opinion about a group nobody pointed a heading at, removes an
 * `aria-labelledby` the caller wrote there themselves. No opinion is not the
 * opinion "not that". What the bag does carry still wins, and a key it stops
 * carrying is still cleared: the spread remembers what it wrote.
 */
export function said<T extends object>(props: T): T {
  return Object.fromEntries(
    Object.entries(props).filter(([, value]) => value !== undefined),
  ) as T;
}

/** What starts a single group, however the tag spelled it. */
function one(value: string | readonly string[] | undefined): string {
  if (typeof value === 'string') return value;
  return value?.[0] ?? '';
}

/** What starts a multiple group, however the tag spelled it. */
function many(value: string | readonly string[] | undefined): string[] {
  if (typeof value === 'string') return value === '' ? [] : [value];
  return value ? [...value] : [];
}

/**
 * A single group's value in the shape the primitive keeps it, over the string
 * the tag keeps it in.
 *
 * The two differ only in how they say nothing is chosen — `''` on the tag, as
 * `<v-tabs>` says it, and `null` in the primitive — so this is a view of the
 * caller's one signal rather than a second signal kept in step with it. A copy
 * would be a flush behind after every write, and a page that set its value and
 * then asked the primitive about it would be told the old one.
 */
class NoneAsNull extends Signal.State<string | null> {
  constructor(private readonly text: Signal.State<string>) {
    super(null);
  }

  override get(): string | null {
    return this.text.get() || null;
  }

  override set(value: string | null): void {
    this.text.set(value ?? '');
  }
}

/**
 * A set of buttons that stay down, over one value.
 *
 * ```html
 * <v-toggle-group :value="marks" type="multiple" label="Formatting">
 *   <v-toggle value="bold" label="Bold"><b>B</b></v-toggle>
 *   <v-toggle value="italic" label="Italic"><i>I</i></v-toggle>
 *   <v-toggle value="underline" label="Underline"><u>U</u></v-toggle>
 * </v-toggle-group>
 * ```
 *
 * The group holds one tab stop, on the chosen toggle, and the arrows move
 * inside it — so Tab steps over the row in one press and lands on what is in
 * effect. All of that is `createToggleGroup`'s, including which role the
 * group takes. A single group that has to keep one value chosen is a radio
 * group, because "exactly one of these" has no other correct announcement,
 * and that is what this is unless `deselectable` says the value may go back
 * to none, or `type="multiple"` says there may be several: those two are
 * groups of toggle buttons, pressed rather than checked.
 *
 * The toggles are addressed by value. Each `<v-toggle>` draws its own button
 * inside the group and registers here, so a list rendered with `:for` is as
 * good as one written out, and the group's tab stop survives a re-render that
 * replaces every button with a new one.
 *
 * `:host` is on the group element, which is the one carrying the role: a
 * class written on the tag lays the row out, and an `aria-label` names it.
 */
@Component({ selector: 'v-toggle-group', templateUrl: './toggle-group.html' })
export class VToggleGroup {
  /**
   * Your own signal, when the value belongs to your component:
   * `Signal.State<string>` for a single group, where `''` is nothing chosen,
   * and `Signal.State<string[]>` for a multiple one, in the order the values
   * were chosen.
   */
  @Prop() value?: Signal.State<string> | Signal.State<string[]>;
  /**
   * Chosen from the start, when the value is the group's own: a string, or a
   * list for a multiple group — which also takes a single string, since that
   * is all an attribute can write.
   *
   * This and the four below are what the primitive is *built* with, read once
   * while this field list initializes — plain, because a signal would promise
   * a caller they can change them later while the group went on keying and
   * announcing the shape it was built with.
   */
  @Prop() defaultValue?: string | readonly string[];
  /** One value at a time, or any number of them. Default single. */
  @Prop() type: ToggleGroupType = 'single';
  /**
   * A single group may go back to none: pressing the toggle that is down lets
   * it up, and the value becomes `''`. Off by default, which is what makes a
   * single group a radio group. Written bare, or bound; `deselectable="false"`
   * is the false it says.
   *
   * Unread by a multiple group, which can always be emptied — a row of
   * formatting buttons that refused to let the last of them up would be a row
   * nobody could clear.
   */
  @Prop() deselectable = false;
  /** Which arrows move, and which way the sheet lays the toggles out. Default horizontal. */
  @Prop() orientation: ToggleGroupOrientation = 'horizontal';
  /** Arrows wrap past the first and last toggle. Default true. */
  @Prop() loop = true;

  /**
   * Refuses the press and the keyboard for every toggle at once, and says so
   * on the group and on each of them.
   *
   * A signal, because the primitive reads it through an accessor: a group is
   * disabled by something that changes — a pending save, a permission.
   *
   * Read by the attribute's own rule, as every control in this package reads
   * it: written at all — bare, or `disabled="disabled"` — it is on.
   */
  @Prop() disabled = new Signal.State(false);
  /**
   * The name of the group. Without it, or `labelledBy`, the group has none,
   * because a default would be in this package's language rather than the
   * page's.
   *
   * A signal, unlike the five built into the primitive: it is read on every
   * render of the group, and the name of a widget is as often translated, or
   * drawn from data, as it is a literal.
   */
  @Prop() label = new Signal.State<string | undefined>(undefined);
  /** Id of an element already naming the group — a heading, a legend. Followed like `label`. */
  @Prop() labelledBy = new Signal.State<string | undefined>(undefined);
  /**
   * `label` in the platform's own spelling, declared rather than left to fall
   * through to `:host`, and winning over `label` when both are written.
   *
   * `:host` is on the group element, which is the one carrying the role — so
   * a name written on the tag lands in the right place on its own. What it
   * would not survive is the bag beside it: the primitive's `groupProps()`
   * names `aria-label`, and a spread re-applied with `undefined` there wipes
   * what the caller wrote a moment after it landed. A declared prop is never
   * a host attribute, so writing it down brings the name here, where
   * `groupProps()` merges it in instead.
   */
  @Prop({ alias: 'aria-label' }) ariaLabel = new Signal.State<string | undefined>(undefined);
  /** `labelledBy` in the platform's own spelling, declared for the reason `ariaLabel` gives. */
  @Prop({ alias: 'aria-labelledby' }) ariaLabelledBy = new Signal.State<string | undefined>(
    undefined,
  );
  /**
   * Called with the value a user chose, never with a default: a single group
   * with the value, or `''` once a `deselectable` group's toggle is let up; a
   * multiple group with the whole list each time it changes.
   */
  @Prop() onValueChange?: ((value: string) => void) | ((value: string[]) => void);

  /**
   * The group element.
   *
   * A signal rather than a plain field because the primitive watches it: the
   * toggles are found by querying this element, and nothing can be found
   * until it is there.
   */
  group = new Signal.State<Element | null>(null);

  /**
   * The `<v-toggle>` children, in the order their buttons are in the group.
   *
   * The primitive reads the DOM for everything it navigates, so this is not
   * how it finds them. It is how the group knows what was written inside it:
   * two toggles sharing a value would both draw as pressed, and that is caught
   * here rather than by a user.
   */
  readonly toggles = new TagChildren<VToggle>(
    () => this.group.get(),
    (toggle) => toggle.element,
  );

  /**
   * The primitive, built from the props above — which is why props have to be
   * there while a field initializes.
   */
  readonly toggleGroup: ToggleGroup = this.build();

  constructor() {
    provideContext(ToggleGroupContext, this);
    // After the flush rather than as each toggle is built: a `:for` that
    // draws its rows anew — a list fetched again, keyed on the rows — builds
    // each new toggle while the one it replaces is still registered, and the
    // two are one toggle, not twins. By the time an effect runs, the old row
    // has gone.
    if (__VOLT_DEV__) effect(() => this.checkTwins());
  }

  /**
   * What the group carries: the primitive's bag, and the two names that have
   * to follow a signal.
   *
   * One bag rather than a spread with attributes written beside it. A spread
   * rewrites the element whenever the state it reads changes, so a name
   * written next to it is a name the first press wipes. What the caller wrote
   * in ARIA wins over the prop that says the same thing: two spellings of one
   * name can only disagree by mistake, and the attribute is the one they wrote
   * on the tag.
   */
  groupProps(): ToggleGroupProps {
    return said({
      ...this.toggleGroup.groupProps(),
      'aria-label': this.ariaLabel.get() ?? this.label.get(),
      'aria-labelledby': this.ariaLabelledBy.get() ?? this.labelledBy.get(),
    });
  }

  /**
   * What one toggle carries: the primitive's bag, with the entries that say
   * nothing taken out, and the tab stop put where it belongs while the
   * primitive has put it nowhere.
   */
  itemProps(value: string, item: ToggleGroupItemOptions): ToggleGroupItemProps {
    const props = said(this.toggleGroup.itemProps(value, item));
    const resting = this.restingStop();
    if (resting === undefined) return props;
    return { ...props, tabindex: resting === value ? '0' : '-1' };
  }

  /**
   * The value whose toggle holds the group's one tab stop, while the
   * primitive has given it to none of them; `undefined` once it has.
   *
   * The primitive settles its tab stop in an effect, because the answer comes
   * from the DOM. A server runs no effects, so the markup it writes would
   * have every toggle at `-1` — Tab stepping over the whole group, and no key
   * reaching it, until a script attached. A browser's first render comes
   * before that effect too. So until it has run this answers the way it will:
   * the toggle that is down, and while none is, the first that can take the
   * stop — every toggle can, in a group that is out of use, which keeps its
   * one way in.
   *
   * A server writes each toggle once, in order, knowing only the toggles
   * before it. That is why a group with something chosen never hands the stop
   * to a toggle that is up while the one that is down may be still to come —
   * and why it does once every value chosen has been drawn and none of them
   * can take it: then nothing that can is still to come, and waiting would
   * leave the group with no stop at all. A chosen toggle that is refused and
   * drawn *after* the first that could take the stop, or a value no toggle
   * has, cannot be told from one still to come; a server leaves that group to
   * the browser, which places the stop as soon as a script attaches.
   */
  private restingStop(): string | null | undefined {
    const toggles = this.toggles.all.get();
    const placed = toggles.some(
      (toggle) => this.toggleGroup.itemProps(toggle.value.get()).tabindex === '0',
    );
    if (placed) return undefined;

    const open = this.disabled.get()
      ? toggles
      : toggles.filter((toggle) => !toggle.disabled.get());
    const value = this.toggleGroup.value();
    const chosen = value === null ? [] : typeof value === 'string' ? [value] : value;
    const drawn = chosen.every((each) => toggles.some((toggle) => toggle.value.get() === each));
    const stop =
      open.find((toggle) => chosen.includes(toggle.value.get())) ??
      (drawn ? open[0] : undefined);
    return stop?.value.get() ?? null;
  }

  /**
   * The primitive, in the shape the props asked for.
   *
   * Two calls rather than one, because the primitive's options are two types
   * — one carries a string, the other a list — and a union of the two matches
   * neither overload. `onValueChange` is read when the value changes rather
   * than here, so a callback bound to an expression is the one it is now.
   */
  private build(): ToggleGroup {
    const multiple = this.type === 'multiple';
    if (__VOLT_DEV__) this.checkValue(multiple);

    const base: ToggleGroupBaseOptions = {
      group: () => this.group.get(),
      orientation: this.orientation,
      loop: flag(this.loop, true),
      deselectable: multiple || flag(this.deselectable, false),
      // A flag rather than the string an attribute wrote: `isDisabled()` is
      // a boolean to everyone who asks the primitive.
      disabled: () => Boolean(this.disabled.get()),
    };

    if (multiple) {
      return createToggleGroup({
        ...base,
        type: 'multiple',
        value:
          (this.value as Signal.State<string[]> | undefined) ??
          new Signal.State(many(this.defaultValue)),
        onValueChange: (value) =>
          (this.onValueChange as ((value: string[]) => void) | undefined)?.(value),
      });
    }

    const text =
      (this.value as Signal.State<string> | undefined) ?? new Signal.State(one(this.defaultValue));
    return createToggleGroup({
      ...base,
      type: 'single',
      value: new NoneAsNull(text),
      onValueChange: (value) =>
        (this.onValueChange as ((value: string) => void) | undefined)?.(value ?? ''),
    });
  }

  /**
   * Two toggles in this group with one value, thrown rather than drawn.
   *
   * A value identifies a toggle — the group holds values, and reports them —
   * so two that shared one would be drawn down together, and a press on
   * either would answer for both. Read from what is registered once the DOM
   * has settled, so it hears about a toggle that arrives later, or a value
   * bound to something that changes, as well as two written side by side.
   */
  private checkTwins(): void {
    const seen = new Set<string>();
    for (const toggle of this.toggles.all.get()) {
      const value = toggle.value.get();
      if (seen.has(value)) {
        throw new Error(
          `[volt] Two <v-toggle> tags in one <v-toggle-group> carry the value "${value}".\n` +
            '  A value identifies a toggle — the group holds values, and reports them — ' +
            'so both of these would be drawn as pressed at once.',
        );
      }
      seen.add(value);
    }
  }

  /**
   * A signal of the wrong shape for the group's `type`, thrown rather than
   * worked around.
   *
   * Forgetting `type="multiple"` is the likely way here, and nothing else
   * would say so: the group would draw nothing pressed, and the first press
   * would write a string into a signal the page reads as a list.
   */
  private checkValue(multiple: boolean): void {
    if (!this.value) return;
    const held: unknown = untrack(() => this.value!.get());
    if (Array.isArray(held) === multiple) return;
    throw new Error(
      multiple
        ? '[volt] <v-toggle-group type="multiple"> was given a value that is not a list.\n' +
            '  A multiple group holds every value that is down: pass a Signal.State<string[]>.'
        : '[volt] <v-toggle-group> was given a list for its value, and it holds one value.\n' +
            '  Write type="multiple" for a group that holds several, or pass a ' +
            "Signal.State<string>, where '' is nothing chosen.",
    );
  }
}
