/**
 * Menu — a dropdown menu or a context menu, with the accessibility wired in.
 *
 * One primitive covers both, because they differ in only two ways: where the
 * content is anchored, and what gives it its name. A dropdown menu hangs off a
 * trigger and borrows that trigger's label; a context menu opens at the
 * pointer and so needs a label of its own.
 *
 * This is headless: it owns state, keyboard and ARIA, and returns prop objects
 * to spread onto whatever markup the consumer writes. Nothing here renders.
 *
 * A dropdown menu is positioned by `createAnchor`, which is CSS anchor
 * positioning and nothing else: the trigger is given an `anchor-name`, the
 * content a `position-anchor`, a `position-area` and the fallbacks to try when
 * the placement asked for would leave the viewport. Nothing measures a
 * rectangle and nothing listens for scroll, which is the same bargain the
 * popover and the tooltip make. It is taken from the shared implementation
 * rather than written out inline a third time, because that one also resolves
 * the writing direction against the trigger: a portalled menu's containing
 * block is <body>, which knows nothing about the direction of the region its
 * trigger sits in, so a logical span keyword left for the browser to resolve
 * aligns to the wrong edge of an RTL toolbar on an LTR page. A submenu wants
 * `placement: 'right-start'` and gets flipped to the left of its parent by the
 * engine, at the moment it would overflow, for no script at all.
 *
 * A context menu is not anchored, because there is no element to anchor it to:
 * `position()` reports where it was asked for, and the consumer decides what
 * that means in pixels.
 *
 *   class Actions {
 *     trigger = new Signal.State<Element | null>(null);
 *     content = new Signal.State<Element | null>(null);
 *     menu = createMenu({
 *       trigger: () => this.trigger.get(),
 *       content: () => this.content.get(),
 *       onSelect: (_item, value) => this.run(value),
 *     });
 *   }
 *
 *   <button :ref="trigger" :spread="menu.triggerProps()"
 *           :click="menu.toggle()"
 *           :keydown="menu.onTriggerKeyDown($event)">Actions</button>
 *
 *   <div :if="menu.isPresent()" :portal :ref="content"
 *        :spread="menu.contentProps()"
 *        :keydown="menu.onContentKeyDown($event)"
 *        :click="menu.onItemClick($event)"
 *        :pointermove="menu.onItemPointerMove($event)">
 *     <button :spread="menu.itemProps({ value: 'rename' })">Rename</button>
 *     <div :spread="menu.separatorProps()"></div>
 *     <button :spread="menu.itemProps({ value: 'delete', disabled: true })">Delete</button>
 *   </div>
 *
 * Both handlers resolve the item from the event's target, so wiring them once
 * on the content covers every item — including items a consumer renders from a
 * loop, which cannot each hold a `:ref`.
 *
 * For a context menu, leave `trigger` unset and open from the area itself:
 *
 *   <div :contextmenu="menu.onContextMenu($event)">…</div>
 *
 * The area is not a trigger. It gets no `aria-expanded`, and a press on it
 * dismisses the menu like a press anywhere else.
 *
 * The keyboard map is the WAI-ARIA menu and menu-button patterns:
 *
 *   trigger   Enter, Space, ArrowDown    open with the first item focused
 *             ArrowUp                    open with the last item focused
 *   content   ArrowDown, ArrowUp         next, previous — wrapping by default
 *             Home, End                  first, last
 *             printable characters       typeahead, accumulating for 500ms
 *             Enter, Space               choose the focused item
 *             Escape                     close, focus back to the trigger
 *             Tab                        close, and carry on out of the trigger
 *
 * Focus is trapped inside an open menu, because that is what `createFocusScope`
 * gives and because every deliberate way out of a menu — Escape, Tab, choosing
 * an item, a press outside — closes it first. The cost is one real case: a
 * press that lands on a text field elsewhere on the page closes the menu but
 * does not focus the field, because the trap is still live when the browser
 * moves focus and only lets go at pointer-up. That field takes a second click.
 * The alternative is focus escaping a menu that is still open, which strands a
 * keyboard user behind an overlay they cannot see; this way round is better.
 */

import { Signal, effect, onCleanup } from '@voltdev/core';
import { createPresence, type PresenceState } from './presence.js';
import { createDismiss, forgetPress, type DismissReason } from './dismiss.js';
import { createFocusScope } from './focus-scope.js';
import { createCollection, ITEM_ATTRIBUTE } from './collection.js';
import { createRovingFocus, type Orientation } from './roving-focus.js';
import { createAnchor, type AnchorPlacement } from './anchoring.js';
import { createId } from './id.js';

// The proposal's own name for reading without subscribing; Volt adds no second
// spelling for it.
const { untrack } = Signal.subtle;

/**
 * `menuitem` acts; the other two carry a state, and must say so with
 * `aria-checked` or they are announced as plain items.
 */
export type MenuItemRole = 'menuitem' | 'menuitemcheckbox' | 'menuitemradio';

/** Where focus lands when the menu opens. */
export type MenuOpenFocus = 'first' | 'last' | 'none';

/** Viewport coordinates of the press that opened a context menu. */
export interface MenuPosition {
  readonly x: number;
  readonly y: number;
}

export interface MenuLabels {
  /**
   * The menu's accessible name, used when no trigger names it — a context
   * menu, most often. Default "Menu".
   */
  menu?: string;
}

export interface MenuItemOptions {
  /** Passed to `onSelect`, so a loop of items needs no per-item wiring. */
  value?: string;
  /** Default `menuitem`. */
  role?: MenuItemRole;
  /** For the checkbox and radio roles. `mixed` is a part-checked checkbox. */
  checked?: boolean | 'mixed';
  /** Skipped by navigation, still announced. */
  disabled?: boolean;
  /**
   * What typeahead matches on, when the visible text is not what anyone would
   * type — an item whose label leads with an icon's alt text or a shortcut.
   */
  textValue?: string;
  /** Overrides the menu's `closeOnSelect` for this item alone. */
  closeOnSelect?: boolean;
}

export interface MenuOptions {
  /** The menu's content element, once rendered. */
  content: () => Element | null | undefined;
  /**
   * The element that opens it. It names the menu, and a press on it is not
   * treated as outside. Omit it for a context menu.
   */
  trigger?: () => Element | null | undefined;

  /**
   * Supply a signal to control the menu from outside. Without one it owns its
   * own state, which is what most callers want.
   */
  open?: Signal.State<boolean>;
  defaultOpen?: boolean;

  /**
   * Which side of the trigger the menu sits on. Default `bottom-start`, which
   * lines the menu's leading edge up with the trigger's — leading, not left,
   * because the alignment mirrors under `dir="rtl"`. A submenu wants
   * `right-start`. Ignored by a context menu, which has no trigger.
   */
  placement?: AnchorPlacement;
  /** The gap between trigger and menu. A number is pixels. */
  offset?: number | string;
  /** Let the browser flip to the opposite side when it would overflow. Default true. */
  flip?: boolean;

  /** Which arrows move. Default vertical. */
  orientation?: Orientation;
  /** Arrow keys wrap past the ends. Default true. */
  loop?: boolean;
  /** Typing letters jumps to a matching item. Default true. */
  typeahead?: boolean;
  /** How long typed characters accumulate, in ms. Default 500. */
  typeaheadTimeout?: number;

  /** Escape closes it. Default true. */
  closeOnEscape?: boolean;
  /** A press outside closes it. Default true. */
  closeOnOutsidePointer?: boolean;
  /** Choosing an item closes it. Default true. */
  closeOnSelect?: boolean;

  labels?: MenuLabels;

  onOpenChange?: (open: boolean) => void;
  /** `value` is whatever `itemProps` was given, so the item need not be read. */
  onSelect?: (item: HTMLElement, value: string | undefined) => void;
}

/** A bag of attributes to spread; `style` is an object of CSS declarations. */
export interface MenuProps {
  readonly [key: string]: string | boolean | undefined | Readonly<Record<string, string>>;
}

export interface Menu {
  /** Whether the menu is logically open. */
  isOpen(): boolean;
  /** Whether its content should be in the DOM — stays true during exit. */
  isPresent(): boolean;
  /** `open` or `closed`, for CSS to animate against. */
  state(): PresenceState;
  /**
   * Where a context menu was opened, in viewport coordinates, or null if it
   * has only ever been opened from a trigger. Kept while the exit animation
   * runs, so the menu does not jump on its way out.
   */
  position(): MenuPosition | null;
  /** The item that currently holds focus, for styling the highlight. */
  activeItem(): HTMLElement | null;
  /**
   * The trigger's `anchor-name`, for CSS that has to position something else
   * against the same element — a menu sized to the control it drops from,
   * `width: anchor-size(--volt-anchor-1 width)`. A context menu still has a
   * name, and nothing carries it.
   */
  anchorName(): string;
  /**
   * The side the menu was asked to sit on, for an entry animation's transform
   * origin. Not necessarily the side it is on: when the engine takes one of
   * the fallbacks it does not report which, and there is no API to ask.
   */
  placement(): AnchorPlacement;

  open(focus?: MenuOpenFocus): void;
  close(): void;
  toggle(): void;

  /** Move focus to an item, making it the one the arrows move on from. */
  focusItem(item: HTMLElement | null): void;
  /** Choose an item: report it, and close unless it says otherwise. */
  select(item: HTMLElement | null): void;

  onTriggerKeyDown(event: KeyboardEvent): void;
  onContentKeyDown(event: KeyboardEvent): void;
  /** Opens at the pointer and suppresses the platform's own menu. */
  onContextMenu(event: MouseEvent): void;
  onItemClick(event: MouseEvent): void;
  onItemPointerMove(event: PointerEvent): void;

  triggerProps(): MenuProps;
  contentProps(): MenuProps;
  itemProps(options?: MenuItemOptions): MenuProps;
  separatorProps(): MenuProps;
}

export function createMenu(options: MenuOptions): Menu {
  const state = options.open ?? new Signal.State(options.defaultOpen ?? false);
  const orientation = options.orientation ?? 'vertical';
  const label = options.labels?.menu ?? 'Menu';

  const contentId = createId('menu-content');
  const triggerId = createId('menu-trigger');

  const active = new Signal.State<HTMLElement | null>(null);
  const pointer = new Signal.State<MenuPosition | null>(null);

  /**
   * Whether the trigger really carries the id the content points at. The
   * consumer may have skipped `triggerProps`, and a dangling `aria-labelledby`
   * announces an unnamed menu while hiding the fact that the name is missing.
   */
  const triggerNamesMenu = new Signal.State(false);

  const presence = createPresence(
    () => state.get(),
    () => options.content(),
  );
  const collection = createCollection(() => options.content());

  // Keyed off whether a trigger was supplied at all rather than off what it
  // currently returns, so the content is laid out the same way on the frame it
  // appears as on every frame after it. It is also the same line the rest of
  // the file draws between the two menus: a dropdown hangs off a trigger, a
  // context menu has nothing to hang off.
  const anchored = options.trigger !== undefined;
  const anchor = createAnchor({
    anchor: () => options.trigger?.(),
    defaultPlacement: options.placement ?? 'bottom-start',
    offset: options.offset,
    flip: options.flip,
  });

  const setOpen = (next: boolean) => {
    // Untracked because `open()` may well be called from inside an effect, and
    // subscribing that effect to the state it just wrote would run it again
    // when the menu closes — and open it straight back up.
    if (untrack(() => state.get()) === next) return;
    state.set(next);
    options.onOpenChange?.(next);
  };

  const closesOnSelect = (item: HTMLElement): boolean => {
    // Read back off the item rather than held here, because the menu never
    // sees the options object again once `itemProps` has returned it — which
    // is what lets items be rendered from a loop.
    const declared = item.getAttribute('data-close-on-select');
    if (declared !== null) return declared !== 'false';
    return options.closeOnSelect !== false;
  };

  const select = (item: HTMLElement | null) => {
    if (!item || isDisabled(item)) return;
    options.onSelect?.(item, item.getAttribute('data-value') ?? undefined);
    if (closesOnSelect(item)) setOpen(false);
  };

  const roving = createRovingFocus(
    collection,
    () => active.get(),
    (el) => active.set(el),
    {
      orientation,
      loop: options.loop,
      typeahead: options.typeahead,
      typeaheadTimeout: options.typeaheadTimeout,
      onSelect: select,
    },
  );

  /**
   * Where focus should land once the content exists.
   *
   * Held across the render because the effect below runs after the key that
   * opened the menu has been and gone, and the DOM cannot be asked which one
   * it was.
   */
  let openFocus: MenuOpenFocus = 'none';

  const openMenu = (focus: MenuOpenFocus = 'none') => {
    openFocus = focus;
    setOpen(true);
  };

  // Everything that only applies while open lives in one effect, so it is set
  // up and torn down as a unit — and, because these register cleanups, in
  // exactly the reverse order on the way out.
  effect(() => {
    if (!state.get()) return;
    const content = options.content();
    if (!content) return;

    triggerNamesMenu.set(options.trigger?.()?.id === triggerId);

    createDismiss(
      () => options.content(),
      (reason: DismissReason) => {
        if (reason === 'escape' && options.closeOnEscape === false) return;
        if (reason === 'outside-pointer' && options.closeOnOutsidePointer === false) return;
        setOpen(false);
      },
      {
        // Escape and the press are always taken here, and declined above when
        // the menu is told not to close on them: a layer that holds focus and
        // stays open still keeps them from the layer beneath it.
        // The trigger is not "outside": dismissing on it would close the menu
        // and then the trigger's own handler would reopen it.
        exclude: () => (options.trigger ? [options.trigger()] : []),
      },
    );

    createFocusScope(() => options.content(), {
      // Focus is placed below instead, so that the item receiving it is also
      // the one the arrow keys move on from. Letting the scope focus the first
      // item would leave nothing active, and the first ArrowDown would then
      // "move" to the item already focused.
      autoFocus: false,
      restoreFocus: true,
      initialFocus: () => active.get() ?? content,
    });

    const target =
      openFocus === 'first' ? collection.first() : openFocus === 'last' ? collection.last() : null;

    // With no item to focus the menu itself takes focus: it was opened by a
    // pointer, and highlighting an item would claim a choice nobody has made.
    // The keys still work, because they are handled on the content.
    if (target) roving.focus(target);
    else (content as HTMLElement).focus?.();

    onCleanup(() => active.set(null));
  });

  return {
    isOpen: () => state.get(),
    isPresent: () => presence.isPresent(),
    state: () => presence.state(),
    position: () => pointer.get(),
    activeItem: () => active.get(),
    anchorName: () => anchor.name(),
    placement: () => anchor.placement(),

    open: (focus) => openMenu(focus),
    close: () => setOpen(false),
    toggle: () => (untrack(() => state.get()) ? setOpen(false) : openMenu('none')),

    focusItem: (item) => roving.focus(item),
    select,

    onTriggerKeyDown(event) {
      // A modified key is a shortcut, not an instruction to open a menu.
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      switch (event.key) {
        case 'Enter':
        case ' ':
        case 'ArrowDown':
          openMenu('first');
          break;
        case 'ArrowUp':
          openMenu('last');
          break;
        default:
          return;
      }

      // Enter and Space on a button also fire a click, which would toggle the
      // menu straight back shut; the arrows would scroll the page.
      event.preventDefault();
    },

    onContentKeyDown(event) {
      // Escape is deliberately absent: dismissal owns it, on the document and
      // in the capture phase, so that one press closes one layer.
      if (event.key === 'Tab') {
        // Not prevented. The menu closes, focus returns to the trigger, and
        // the browser's own Tab then carries on from there — which is where a
        // user who tabbed out of a menu expects to be.
        setOpen(false);
        return;
      }

      // Arrows scroll the page, Space scrolls it too, and Enter re-fires as a
      // click on a focused button item — which would choose it twice.
      if (roving.onKeyDown(event)) event.preventDefault();
    },

    onContextMenu(event) {
      // The whole point of a custom context menu is that the platform's own
      // does not appear over it.
      event.preventDefault();
      pointer.set({ x: event.clientX, y: event.clientY });

      // A second press while open moves the menu rather than reopening it:
      // focus is already inside, and closing first would restore focus to
      // whatever the user was on before, only to take it away again. Where the
      // platform asks as the button goes down, that press is still in progress
      // and began outside the menu, so its release would otherwise dismiss the
      // menu it has just moved.
      if (state.get()) {
        forgetPress();
        return;
      }
      openMenu('none');
    },

    onItemClick(event) {
      const item = itemFrom(event.target);
      if (!item) return;
      if (isDisabled(item)) {
        // A disabled item still swallows the press: it is visibly there, and
        // an `<a>` item would otherwise follow its href.
        event.preventDefault();
        return;
      }
      select(item);
    },

    onItemPointerMove(event) {
      const item = itemFrom(event.target);
      // Pointer *move* rather than enter, because a menu that opens under a
      // stationary cursor, or scrolls beneath it, never fires enter — and
      // moving within an item fires this many times, hence the check.
      if (!item || isDisabled(item) || item === active.get()) return;
      roving.focus(item);
    },

    triggerProps: () => {
      const props: Record<string, MenuProps[string]> = {
        id: triggerId,
        'aria-haspopup': 'menu',
        'aria-expanded': String(state.get()),
        'aria-controls': state.get() ? contentId : undefined,
        'data-state': presence.state(),
      };
      // Assigned rather than read off a known key, because anchoring hands
      // back an empty bag where the browser cannot do it — and writing
      // `style: undefined` is not the same as writing no style at all.
      if (anchored) Object.assign(props, anchor.anchorProps());
      return props;
    },

    contentProps: () => {
      const props: Record<string, MenuProps[string]> = {
        id: contentId,
        role: 'menu',
        // Vertical is ARIA's own default for a menu, so it is only worth
        // saying when it is not true.
        'aria-orientation': orientation === 'horizontal' ? 'horizontal' : undefined,
        'aria-labelledby': triggerNamesMenu.get() ? triggerId : undefined,
        'aria-label': triggerNamesMenu.get() ? undefined : label,
        'data-state': presence.state(),
        // Focusable so the menu can hold focus itself when it opens with no
        // item highlighted, and so focus has somewhere to go that is not the
        // page.
        tabindex: '-1',
      };
      // Where it goes, what to try instead when that would overflow, and
      // `data-anchored` for the CSS that has to place it by hand on an engine
      // which cannot. A context menu gets none of it, so an inline
      // `position: absolute` never fights the `fixed` its own coordinates want.
      if (anchored) Object.assign(props, anchor.floatingProps());
      return props;
    },

    itemProps: (item = {}) => {
      const role = item.role ?? 'menuitem';
      return {
        [ITEM_ATTRIBUTE]: '',
        role,
        // A checkbox or radio item with no `aria-checked` is announced as an
        // ordinary item, so an omitted state means unchecked, not absent.
        'aria-checked': role === 'menuitem' ? undefined : String(item.checked ?? false),
        // `aria-disabled`, never the `disabled` attribute: a disabled item
        // stays in the accessibility tree, so it can be found and heard to be
        // unavailable rather than appear to have vanished. The `data-` twin is
        // what the collection skips by.
        'aria-disabled': item.disabled ? 'true' : undefined,
        'data-disabled': item.disabled ? '' : undefined,
        'data-value': item.value,
        'data-label': item.textValue,
        'data-close-on-select':
          item.closeOnSelect === undefined ? undefined : String(item.closeOnSelect),
        // No item is in the tab order. Tab closes the menu rather than walking
        // it, so there is no tab stop to rove: focus is moved to items
        // directly, and that is what assistive technology follows.
        tabindex: '-1',
      };
    },

    separatorProps: () => ({
      role: 'separator',
      // A separator lies across the menu, so it is perpendicular to it. ARIA
      // defaults a separator to horizontal, which is right for the usual
      // vertical menu, so only the other case needs saying.
      'aria-orientation': orientation === 'horizontal' ? 'vertical' : undefined,
    }),
  };
}

/** The item an event happened in, allowing for markup inside the item. */
function itemFrom(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  return target.closest<HTMLElement>(`[${ITEM_ATTRIBUTE}]`);
}

/**
 * The same two attributes the collection skips by, so that navigation and
 * selection can never disagree about what is disabled.
 */
function isDisabled(item: Element): boolean {
  return item.hasAttribute('data-disabled') || item.hasAttribute('disabled');
}
