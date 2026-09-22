import { Component, Prop, Signal } from '@voltdev/core';
import { createPopover, type Popover, type PopoverPlacement } from '@voltdev/primitives';

/**
 * The caller's own signal, refused when it is not one.
 *
 * `open` is the single signal the page and the popover both hold, and markup
 * has no way to write a signal: `open` and `:open="true"` hand over a boolean,
 * which the primitive keeps and later calls `.get()` on — a `TypeError` raised
 * inside an effect, which unmounts the whole page and names nothing that would
 * lead anyone back to the tag. Refused here instead, while the prop is still
 * the thing that is wrong, and pointed at `defaultOpen`, which is how starting
 * open is spelled and is a value either spelling can carry.
 */
function ownSignal(open: unknown): Signal.State<boolean> {
  const candidate = open as Partial<Signal.State<boolean>> | null | undefined;
  if (typeof candidate?.get === 'function' && typeof candidate.set === 'function') {
    return open as Signal.State<boolean>;
  }
  throw new Error(
    `[volt] \`open\` on <v-popover> takes a signal your component holds, and \`${String(open)}\` ` +
      'is not one.\n' +
      '  To have it start open, write `defaultOpen`. To drive it, hold a ' +
      '`new Signal.State(false)` and pass that: `:open="mine"`.',
  );
}

/**
 * The gap, as a length the browser will keep.
 *
 * `offset` is pixels or a CSS length, and an attribute is only ever a string:
 * `offset="8"` arrives as `'8'`, which goes into a margin the CSSOM then drops
 * for having no unit — so the gap silently never happens and the two spellings
 * of one prop disagree. A string that is a number is that many pixels, which
 * is the only thing `offset="8"` could have been asking for; anything else is
 * already a length and is passed through untouched.
 */
function length(offset: number | string): number | string {
  if (typeof offset !== 'string') return offset;
  const trimmed = offset.trim();
  return trimmed !== '' && Number.isFinite(Number(trimmed)) ? Number(trimmed) : offset;
}

/**
 * A popover: a panel anchored to the control that opened it.
 *
 * ```html
 * <v-popover title="Filters" description="Narrow the list." placement="bottom-start">
 *   <template :slot-trigger>Filters</template>
 *   <p>Everything since Monday.</p>
 * </v-popover>
 * ```
 *
 * The trigger belongs to the component, where the dialog's belongs to the
 * caller, and the difference is the positioning: the panel is placed against
 * the trigger in CSS, and the `anchor-name` that does it has to be on an
 * element this renders. So the trigger is a `<button>` drawn with the sheet's
 * button rules — `variant` and `size` are that button's — and the `trigger`
 * slot is what goes inside it.
 *
 * The panel portals, so it is the panel that carries `:host`:
 * `<v-popover class="wide">` is about the thing the caller can see opening,
 * not about the button left behind. Its `id` and its `role` are not the
 * caller's to write, and `contentProps` below says why.
 *
 * `title` and `description` are props, and the slots of the same names are
 * drawn *inside* the elements those props would have filled. That is what
 * keeps the naming honest: the primitive names the panel after the element
 * carrying its own id, so markup written for a heading has to land in that
 * element rather than beside it. The prop is therefore what says the panel has
 * a heading at all — without one the element is not rendered, the slot with it,
 * and the panel is named by `label` instead of by an empty line.
 *
 * Non-modal, like the primitive: focus moves into the panel, the page behind
 * stays live and scrollable, and focus landing anywhere else closes it.
 * `modal` traps focus instead — and wanting that is usually a sign that
 * `<v-dialog>` was the component being reached for.
 */
@Component({ selector: 'v-popover', templateUrl: './popover.html' })
export class VPopover {
  /** Your own signal, if the open state belongs to your component. */
  @Prop() open?: Signal.State<boolean>;

  /**
   * The nine below are what the primitive is built with, read once while this
   * field list initializes — plain, because a signal would promise a caller
   * they can change them later and the primitive would not hear it.
   */
  /** Where it starts, when the popover owns its state. */
  @Prop() defaultOpen = false;
  /** Which side of the trigger the panel sits on, and which edge it lines up with. */
  @Prop() placement: PopoverPlacement = 'bottom';
  /**
   * The gap between trigger and panel; a number is pixels, and so is a number
   * written as an attribute.
   *
   * Written inline by the primitive, on the side that faces the trigger, which
   * replaces the gap the sheet leaves. Worth setting only when that gap is
   * wrong for your design.
   */
  @Prop() offset?: number | string;
  /**
   * Let the browser move the panel to the opposite side when it would
   * overflow the viewport.
   *
   * The arrow is drawn from the placement that was asked for, and no engine
   * says which fallback it took — so a panel that flips keeps an arrow
   * pointing at nothing. Turning this and `shift` off holds the placement, at
   * the price of a panel that can run off the edge.
   */
  @Prop() flip = true;
  /** Let the browser line it up with the trigger's other edge instead. Same catch as `flip`. */
  @Prop() shift = true;
  /**
   * Keep focus inside the panel.
   *
   * Unlike the dialog this leaves the rest of the page live and scrolling: a
   * popover is small and transient, and a layer that needs the page behind it
   * switched off is a dialog.
   */
  @Prop() modal = false;
  /** Escape closes it. */
  @Prop() closeOnEscape = true;
  /** A press outside closes it. */
  @Prop() closeOnOutsidePointer = true;
  /**
   * The panel's name for a screen reader, for a popover with no title.
   *
   * The fallback rather than the preference: a visible title names the panel
   * for everyone, and is used instead whenever there is one. Leave it off and
   * an `aria-label` of your own written on the tag reaches the panel.
   */
  @Prop() label?: string;

  /** The heading, when the markup for it is a line of text. */
  @Prop() title = new Signal.State<string | undefined>(undefined);
  /** The line under the heading. */
  @Prop() description = new Signal.State<string | undefined>(undefined);
  /** The trigger's look: `primary`, `danger`, `ghost`, or nothing for the plain button. */
  @Prop() variant = new Signal.State<'primary' | 'danger' | 'ghost' | undefined>(undefined);
  /** The trigger's size: `sm`, `lg`, or nothing for the middle one. */
  @Prop() size = new Signal.State<'sm' | 'lg' | undefined>(undefined);
  @Prop() onOpenChange?: (open: boolean) => void;

  /** The button the panel is anchored to, and the press is not "outside" of. */
  trigger = new Signal.State<Element | null>(null);
  content = new Signal.State<Element | null>(null);

  /**
   * The primitive, built from the props above — which is why props have to be
   * there while a field initializes.
   */
  readonly popover: Popover = createPopover({
    trigger: () => this.trigger.get(),
    content: () => this.content.get(),
    ...(this.open !== undefined ? { open: ownSignal(this.open) } : {}),
    defaultOpen: this.defaultOpen,
    placement: this.placement,
    ...(this.offset !== undefined ? { offset: length(this.offset) } : {}),
    flip: this.flip,
    shift: this.shift,
    modal: this.modal,
    closeOnEscape: this.closeOnEscape,
    closeOnOutsidePointer: this.closeOnOutsidePointer,
    ...(this.label !== undefined ? { labels: { content: this.label } } : {}),
    ...(this.onOpenChange ? { onOpenChange: this.onOpenChange } : {}),
  });

  /**
   * Whether the heading element is drawn.
   *
   * A method rather than the condition written into the template, because the
   * panel's `aria-labelledby` has to agree with it exactly — two spellings of
   * one question is how a name comes to point at an element nobody rendered.
   */
  titled(): boolean {
    return Boolean(this.title.get());
  }

  /** The same question for the line under it. */
  described(): boolean {
    return Boolean(this.description.get());
  }

  /**
   * The panel's attributes: the primitive's bag, with the naming recomputed
   * and nothing carried as `undefined`.
   *
   * Two things the bag alone gets wrong on the one element a caller also
   * writes to.
   *
   * The primitive asks the DOM whether a title was rendered once per open,
   * which is right for markup that cannot change. `title` and `description`
   * here are signals, so a heading can arrive or leave while the panel is up:
   * a title set after opening went unannounced, and one cleared while open
   * left `aria-labelledby` pointing at a heading that no longer existed, which
   * costs the panel its name altogether rather than falling back to `label`.
   *
   * And an entry the bag carries as `undefined` is not an attribute skipped
   * but an attribute *removed*. Spread over `:host`, that took the caller's
   * own `aria-label` off the panel and left an unnamed dialog. An attribute
   * this has nothing to say about is left out of the bag entirely, and one it
   * stops having something to say about is still cleared — `:spread` removes
   * a key it wrote once the bag no longer names it.
   *
   * `id` and `role` are the two the caller does not get, and neither is
   * arbitrary: the id is what the trigger's `aria-controls` points at, and
   * `role="dialog"` is what its `aria-haspopup` promises. Reach the panel by
   * class or by `:ref`.
   */
  contentProps(): Record<string, unknown> {
    const titled = this.titled();
    const props: Record<string, unknown> = {
      ...this.popover.contentProps(),
      'aria-labelledby': titled ? this.popover.titleProps()['id'] : undefined,
      'aria-label': titled ? undefined : this.label,
      'aria-describedby': this.described() ? this.popover.descriptionProps()['id'] : undefined,
    };
    return Object.fromEntries(Object.entries(props).filter(([, value]) => value !== undefined));
  }
}
