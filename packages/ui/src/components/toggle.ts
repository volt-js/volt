import { Component, Prop, Signal, useContext } from '@voltdev/core';
import { createToggle, type Toggle, type ToggleProps } from '@voltdev/primitives';
import { ToggleGroupContext, flag, said, type VToggleGroup } from './toggle-group.js';

/** Replaced by the build; `true` where there is none, which is a test run. */
declare const __VOLT_DEV__: boolean;

const { untrack } = Signal.subtle;

/**
 * A button that stays down.
 *
 * Inside a `<v-toggle-group>` it is one of the group's values: the group
 * holds whether it is down, the arrows reach it, and a press is answered by
 * the group's own listener rather than one of its own.
 *
 * ```html
 * <v-toggle value="bold" label="Bold"><b>B</b></v-toggle>
 * ```
 *
 * On its own it is a lone toggle over `createToggle` — bold, mute, pin —
 * with `role="button"` and `aria-pressed`, which is deliberately not a switch
 * and not a checkbox: a switch is announced as on or off, a checkbox belongs
 * to a form, and a toggle button is an action that stays applied.
 *
 * ```html
 * <v-toggle :pressed="wrapping">Wrap lines</v-toggle>
 * ```
 *
 * Which of the two it is, is decided by where it was written, once, while its
 * fields initialize. `value` means something only inside a group; `pressed`,
 * `defaultPressed` and `onPressedChange` only outside one, where there is no
 * group to hold the state instead.
 *
 * `:host` is on the button, which is the element carrying the role: a class
 * written on the tag styles the button, and an `aria-label` names it.
 */
@Component({ selector: 'v-toggle', templateUrl: './toggle.html' })
export class VToggle {
  /**
   * Identifies the toggle in its group: what the group holds, and what it
   * reports. Required inside a group, and never `''`, which is how a single
   * group says nothing is chosen.
   */
  @Prop() value = new Signal.State('');
  /**
   * The button's name, for a toggle whose content is an icon. A toggle with
   * words inside it is named by them and needs none. Bind it for a name that
   * changes with the state — `:label="muted.get() ? 'Unmute' : 'Mute'"`.
   */
  @Prop() label = new Signal.State<string | undefined>(undefined);
  /**
   * The same name in the platform's own spelling, declared rather than left
   * to fall through to `:host`: the primitive's bag names `aria-label`, and
   * a spread re-applied with `undefined` there would wipe what the caller
   * wrote a moment after it landed. Written on the tag, it wins over `label`.
   */
  @Prop({ alias: 'aria-label' }) ariaLabel = new Signal.State<string | undefined>(undefined);
  /**
   * Refuse the press, and say so.
   *
   * `aria-disabled` rather than the `disabled` attribute, so a lone toggle
   * keeps its place in the tab order: a control a keyboard user cannot reach
   * is one they cannot discover is there. Inside a group the arrows step over
   * it, and it holds the group's tab stop only when the whole group is off.
   *
   * Read by the attribute's own rule, inside a group and out of one: written
   * at all — bare, or `disabled="disabled"` — it is on.
   */
  @Prop() disabled = new Signal.State(false);

  /**
   * Your own signal, when the state of a lone toggle belongs to your
   * component. Read once, while the primitive is built. Inside a group the
   * group holds the state, and this is unread.
   */
  @Prop() pressed?: Signal.State<boolean>;
  /**
   * Down from the start, when a lone toggle owns its own state. Read once,
   * while the primitive is built, so plain. Written bare, or bound;
   * `defaultPressed="false"` is the false it says.
   */
  @Prop() defaultPressed = false;
  /** Called with the new state on a press a lone toggle did not refuse, never with a default. */
  @Prop() onPressedChange?: (pressed: boolean) => void;

  /** The button this draws, which is how the group learns where the toggle is. */
  element: HTMLElement | null = null;

  /**
   * The group this was written inside, read while the field initializes —
   * which is when a toggle is inside the group's own render. Null for a
   * toggle on its own.
   */
  readonly group: VToggleGroup | null = useContext(ToggleGroupContext);

  /**
   * The primitive of a lone toggle. Null inside a group, whose own primitive
   * — `group.toggleGroup` — holds the state of every toggle in it.
   */
  readonly toggle: Toggle | null = this.group
    ? null
    : createToggle({
        defaultPressed: flag(this.defaultPressed, false),
        // A flag rather than the string an attribute wrote, as the group's
        // own primitive is told.
        disabled: () => Boolean(this.disabled.get()),
        ...(this.pressed ? { pressed: this.pressed } : {}),
        // Read when the state changes rather than here, so a callback bound
        // to an expression is the one it is now.
        onPressedChange: (pressed) => this.onPressedChange?.(pressed),
      });

  constructor() {
    if (!this.group) return;
    if (__VOLT_DEV__) untrack(() => this.checkMembership());
    this.group.toggles.add(this);
  }

  /**
   * What the button carries: the primitive's bag, with the name merged into
   * it rather than written beside it.
   *
   * `:spread` rewrites the element whenever what it reads changes and takes
   * back the keys the new object does not carry, so an attribute applied next
   * to it is an attribute one of the two silently wins. Merged here, a bound
   * name follows its signal, and a name the caller wrote in ARIA wins over
   * `label`.
   */
  props(): ToggleProps {
    const own: ToggleProps = this.group
      ? // The group's primitive takes `true` and nothing else as disabled, and
        // an attribute delivers a string: `disabled="disabled"` would be a
        // toggle refused on its own and pressable in a group.
        this.group.itemProps(this.value.get(), { disabled: Boolean(this.disabled.get()) })
      : this.toggle!.props();
    return said({ ...own, 'aria-label': this.ariaLabel.get() ?? this.label.get() });
  }

  /**
   * Two of the mistakes a toggle written inside a group can make, each of
   * which would otherwise pass without a sound. The third — a value a sibling
   * already has — is the group's to catch, once the DOM has settled: as a
   * toggle is built, the row it replaces may still be there.
   *
   * No value is thrown: the group holds values, so a toggle without its own
   * is one the group cannot tell apart from the next — or from nothing
   * chosen, which a single group writes as `''`. The props of a lone toggle
   * are said in the console instead, since the toggle still works: they are
   * simply never read, and a caller listening on `onPressedChange` would wait
   * for a call that never comes.
   */
  private checkMembership(): void {
    const value = this.value.get();
    if (value === '') {
      throw new Error(
        '[volt] A <v-toggle> inside a <v-toggle-group> needs a value.\n' +
          '  The group holds values and reports them, so a toggle without one of its own ' +
          'cannot be told apart from the next.',
      );
    }

    const lone = [
      this.pressed ? 'pressed' : '',
      flag(this.defaultPressed, false) ? 'defaultPressed' : '',
      this.onPressedChange ? 'onPressedChange' : '',
    ].filter(Boolean);
    if (lone.length === 0 || typeof console === 'undefined') return;
    console.warn(
      `[volt] <v-toggle value="${value}"> was given ${lone.join(' and ')}, which only a toggle ` +
        'on its own reads. Inside a <v-toggle-group> the group holds whether it is down.\n' +
        "  Read and write the group's `value` instead, and listen on its `onValueChange`.",
    );
  }
}
