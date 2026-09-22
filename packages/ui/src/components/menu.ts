import { Component, Prop, Signal, createContext, provideContext } from '@voltdev/core';
import {
  createMenu,
  type AnchorPlacement,
  type Menu,
  type MenuProps,
  type Orientation,
} from '@voltdev/primitives';
import { TagChildren } from './children.js';
import type { VMenuItem } from './menu-item.js';

/**
 * How an item or a separator finds the menu it was written inside.
 *
 * The content of a tag is built while the tag it sits in renders, so both
 * children initialize in a scope descending from this one — including through
 * the portal, which moves elements and not scopes. Either one written anywhere
 * else finds nothing and says so.
 */
export const MenuContext = createContext<VMenu | null>(null);

/**
 * The gap, as a length the browser will keep.
 *
 * `offset` is pixels or a CSS length, and an attribute is only ever a string:
 * `offset="8"` arrives as `'8'`, which the primitive writes into a margin the
 * CSSOM then drops for having no unit — so the gap silently never happens and
 * the two spellings of one prop disagree. A string that is a number is that
 * many pixels, which is the only thing `offset="8"` could have been asking
 * for; anything else is already a length and is passed through untouched.
 */
function length(offset: number | string): number | string {
  if (typeof offset !== 'string') return offset;
  const trimmed = offset.trim();
  return trimmed !== '' && Number.isFinite(Number(trimmed)) ? Number(trimmed) : offset;
}

/**
 * The bag, less the entries it carries as `undefined`.
 *
 * `:spread` takes back the keys the new object does not carry, and the bags
 * this is used on are the ones spread over an element `:host` writes to — the
 * sheet, an item, the line between two groups of them. There an entry carried
 * as `undefined` is not an attribute skipped but the caller's own attribute
 * *removed*: `aria-checked` on an item that carries no state, `data-label` on
 * one with nothing to say about typeahead, `aria-orientation` on a separator
 * already lying the way it lies. Dropping them is what leaves what the caller
 * wrote alone, which is this package's rule for every element a caller can
 * reach.
 *
 * The trigger's bag is not filtered and must not be: that button is the
 * component's own from end to end, and a name cleared by the signal it was
 * bound to has to come back off it.
 */
export function said(props: MenuProps): Record<string, unknown> {
  return Object.fromEntries(Object.entries(props).filter(([, value]) => value !== undefined));
}

/**
 * A menu: a button, and the list of actions it opens.
 *
 * ```html
 * <v-menu :onSelect="run">
 *   <template :slot-trigger>Actions</template>
 *   <v-menu-item value="rename">Rename</v-menu-item>
 *   <v-menu-separator></v-menu-separator>
 *   <v-menu-item value="delete" :disabled="locked.get()">Delete</v-menu-item>
 * </v-menu>
 * ```
 *
 * The trigger is the component's, for the reason the popover's is: the sheet
 * does not place the menu, CSS anchor positioning does, and the `anchor-name`
 * that does it has to be on an element this renders. So the trigger is a
 * `<button>` drawn with the sheet's button rules — `variant` and `size` are
 * that button's — and the `trigger` slot is what goes inside it. That button
 * is also what names the menu: it carries the primitive's own id, and the
 * content points `aria-labelledby` at it, which is the menu-button pattern.
 *
 * The content portals, so the content is what carries `:host`:
 * `<v-menu class="wide">` is about the sheet of actions a user can see, not
 * about the button left behind. Its `id` and its `role` stay the primitive's,
 * because the trigger's `aria-controls` points at the one and its
 * `aria-haspopup` promises the other.
 *
 * Items are `<v-menu-item>` tags written inside, and they draw themselves
 * where they are written — inside the portalled sheet. Each registers here,
 * which is what lets a choice made with the keyboard reach the tag that was
 * chosen: the primitive reports the element, and only this side knows which
 * tag drew it.
 *
 * There is no `highlighted` attribute to bind and no rule in the sheet that
 * wants one. Roving focus moves real DOM focus between items, so the item
 * under the keyboard is the focused item and `:focus-visible` is what marks
 * it — which also keeps a focus ring from being dragged around behind a
 * pointer.
 *
 * This is the dropdown half of `createMenu`. A context menu has no trigger to
 * hang off, is placed from `position()` in viewport coordinates, and needs a
 * name of its own; it stays markup you write, with the same primitive and the
 * same classes.
 */
@Component({ selector: 'v-menu', templateUrl: './menu.html' })
export class VMenu {
  /** Your own signal, when the open state belongs to your component. */
  @Prop() open?: Signal.State<boolean>;

  /**
   * The eleven below are what the primitive is built with, read once while
   * this field list initializes — plain, because a signal would promise a
   * caller they can change them later and the primitive would not hear it.
   */
  /** Where it starts, when the menu owns its state. */
  @Prop() defaultOpen = false;
  /**
   * Which side of the trigger the sheet sits on, and which edge it lines up
   * with. `-start` is the leading edge, so it mirrors under `dir="rtl"`.
   */
  @Prop() placement: AnchorPlacement = 'bottom-start';
  /**
   * The gap between trigger and sheet, written inline by the primitive. A
   * number is pixels, and so is a number written as an attribute.
   */
  @Prop() offset?: number | string;
  /** Let the browser move the sheet to the opposite side when it would overflow. */
  @Prop() flip = true;
  /** Which arrows move between items, and which way a separator lies. */
  @Prop() orientation: Orientation = 'vertical';
  /** Wrap past the first and last item. */
  @Prop() loop = true;
  /** Typing letters jumps to the item they start. */
  @Prop() typeahead = true;
  /** How long typed characters accumulate, in ms. Default 500. */
  @Prop() typeaheadTimeout?: number;
  /**
   * Escape closes it. Turned off the key is still swallowed, because a menu
   * holding focus keeps it from the layer beneath.
   */
  @Prop() closeOnEscape = true;
  /** A press outside closes it. A press on the trigger is not outside. */
  @Prop() closeOnOutsidePointer = true;
  /** Choosing an item closes it. An item may say otherwise for itself. */
  @Prop() closeOnSelect = true;

  /**
   * The trigger's name, for a trigger whose words are an icon.
   *
   * It names the button, and through it the menu, because the sheet is
   * labelled by the button. A trigger that has words of its own needs none of
   * these: an `aria-label` over visible text is a name a speech-control user
   * cannot say.
   */
  @Prop() label = new Signal.State<string | undefined>(undefined);
  /**
   * The same name, and the same id, in the spelling the platform already has.
   *
   * Declared rather than left to fall through to `:host`, and that is the
   * whole of the fix they are. `:host` is on the sheet, which is already
   * named by the trigger — so a name landing there is outranked by
   * `aria-labelledby` and says nothing, while the button a reader announces
   * keeps none. A declared prop is never a host attribute, so writing them
   * down is what puts them on the trigger with the rest of its bag. What a
   * caller wrote in ARIA wins over the prop saying the same thing: two
   * spellings of one name can only disagree by mistake.
   */
  @Prop({ alias: 'aria-label' }) ariaLabel = new Signal.State<string | undefined>(undefined);
  @Prop({ alias: 'aria-labelledby' }) ariaLabelledBy = new Signal.State<string | undefined>(
    undefined,
  );

  /** The trigger's look: `primary`, `danger`, `ghost`, or nothing for the plain button. */
  @Prop() variant = new Signal.State<'primary' | 'danger' | 'ghost' | undefined>(undefined);
  /** The trigger's size: `sm`, `lg`, or nothing for the middle one. */
  @Prop() size = new Signal.State<'sm' | 'lg' | undefined>(undefined);

  @Prop() onOpenChange?: (open: boolean) => void;
  /**
   * Called with the `value` of the item chosen.
   *
   * The whole menu in one callback, which is what a sheet of actions drawn
   * from a list needs — an item rendered by `:for` cannot carry a handler per
   * row without building one per render.
   */
  @Prop() onSelect?: (value: string | undefined) => void;

  /** The button the sheet is anchored to, and named by. */
  trigger = new Signal.State<Element | null>(null);
  content = new Signal.State<Element | null>(null);

  /**
   * The item tags, in the order their buttons are in the sheet.
   *
   * What this is for is the reverse lookup: the primitive reports the element
   * that was chosen, because that is all it has, and a choice made with Enter
   * never fires a click that an item could have heard for itself.
   */
  readonly items = new TagChildren<VMenuItem>(
    () => this.content.get(),
    (item) => item.element,
  );

  /**
   * The primitive, built from the props above — which is why props have to be
   * there while a field initializes.
   */
  readonly menu: Menu = createMenu({
    trigger: () => this.trigger.get(),
    content: () => this.content.get(),
    ...(this.open ? { open: this.open } : {}),
    defaultOpen: this.defaultOpen,
    placement: this.placement,
    ...(this.offset !== undefined ? { offset: length(this.offset) } : {}),
    flip: this.flip,
    orientation: this.orientation,
    loop: this.loop,
    typeahead: this.typeahead,
    ...(this.typeaheadTimeout !== undefined ? { typeaheadTimeout: this.typeaheadTimeout } : {}),
    closeOnEscape: this.closeOnEscape,
    closeOnOutsidePointer: this.closeOnOutsidePointer,
    closeOnSelect: this.closeOnSelect,
    ...(this.onOpenChange ? { onOpenChange: this.onOpenChange } : {}),
    onSelect: (element, value) => this.chose(element, value),
  });

  constructor() {
    provideContext(MenuContext, this);
  }

  /**
   * The trigger's attributes: the primitive's bag, with the naming in it.
   *
   * One bag rather than a spread and an attribute beside it. `:spread`
   * rewrites the element whenever what it reads changes and takes back the
   * keys the new object does not carry, so a name written next to it is a
   * name the first open wipes. The names are not handed to the primitive
   * either, which reads its options once: they are read here, so a name bound
   * to a signal follows it.
   */
  triggerProps(): MenuProps {
    return {
      ...this.menu.triggerProps(),
      'aria-label': this.ariaLabel.get() ?? this.label.get(),
      'aria-labelledby': this.ariaLabelledBy.get(),
    };
  }

  /**
   * The sheet's attributes: the primitive's bag, with nothing carried as
   * `undefined` and nothing said about the name.
   *
   * An entry a bag carries as `undefined` is not an attribute skipped but an
   * attribute *removed*, and this bag is spread over the element `:host`
   * writes to. Two of its entries are undefined for most of a menu's life —
   * `aria-orientation` for every vertical menu, and `aria-labelledby` until
   * the open effect has confirmed the trigger really carries the id it points
   * at — so passing them through would take the caller's own off the sheet.
   *
   * `aria-label` is dropped outright rather than filtered. The bag carries it
   * as the primitive's fallback name for a menu with no trigger to be named
   * by, which this never is; written even for the one frame before the effect
   * runs, it would replace what the caller put on the tag and then be taken
   * back again. A name for this menu belongs on the button: `label`.
   */
  contentProps(): Record<string, unknown> {
    const props = said(this.menu.contentProps());
    delete props['aria-label'];
    return props;
  }

  /**
   * An item was chosen: tell the tag that drew it, or the menu.
   *
   * One press, one action. An item carrying its own callback is not also
   * reported to the menu's, which would run two things for one choice — the
   * defect a row of a table with a button in it used to have.
   */
  private chose(element: HTMLElement, value: string | undefined): void {
    const item = this.items.all.get().find((each) => each.element === element);
    if (item?.onSelect) item.onSelect();
    else this.onSelect?.(value);
  }
}
