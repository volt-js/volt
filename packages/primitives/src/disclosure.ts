/**
 * Disclosure — one section that expands, and the accordion built from many.
 *
 * Both are headless: they own state, keyboard and ARIA, and return prop
 * objects to spread onto whatever markup the consumer writes. Nothing here
 * renders, and nothing here has an opinion about styling.
 *
 *   class Details {
 *     content = new Signal.State<Element | null>(null);
 *     more = createCollapsible({ content: () => this.content.get() });
 *   }
 *
 *   <button :spread="more.triggerProps()" :click="more.toggle()">Details</button>
 *   <div :if="more.isPresent()" :ref="content" :spread="more.contentProps()">…</div>
 *
 * Presence keeps the content in the DOM until its exit animation has finished,
 * so a panel can animate closed rather than vanishing.
 *
 * The open panel's own height is published as a CSS custom property, because
 * the one thing every collapsible wants to animate is the one thing CSS cannot
 * animate on its own: `height: auto` has no numeric value to interpolate from,
 * and the number that would replace it is only known once the content has been
 * laid out. Measuring it here, when the panel appears and when it resizes,
 * means the consumer's animation is pure CSS and nothing measures per frame:
 *
 *   [data-state='open']   { animation: expand   150ms ease-out; }
 *   [data-state='closed'] { animation: collapse 150ms ease-out; }
 *
 *   @keyframes expand {
 *     from { height: 0 }
 *     to   { height: var(--volt-collapsible-height) }
 *   }
 *   @keyframes collapse {
 *     from { height: var(--volt-collapsible-height) }
 *     to   { height: 0 }
 *   }
 *
 * `createAccordion`, below, is the same panel repeated with one shared piece
 * of state and the keyboard the pattern asks for between the headers.
 */

import { Signal, createRoot, measureEffect, onCleanup } from '@voltdev/core';
import { createCollection } from './collection.js';
import { createId } from './id.js';
import { createPresence, type PresenceState } from './presence.js';
import { createRovingFocus, type Orientation } from './roving-focus.js';

// The proposal's own name for reading without subscribing; Volt adds no second
// spelling for it.
const { untrack } = Signal.subtle;

/** Where the measured height of a panel is published. */
export const COLLAPSIBLE_HEIGHT_PROPERTY = '--volt-collapsible-height';

/**
 * Marks an accordion header, with the value of the panel it opens.
 *
 * Deliberately not the shared `data-volt-item`: a panel may contain a menu, a
 * listbox or another collection of its own, and those items must not be
 * mistaken for headers of the accordion around them.
 *
 * It is not what the arrow keys move between, though. An accordion inside
 * another's panel carries this too, so each accordion also gives its headers
 * a generated attribute of its own and reads only that. This one stays the
 * stable name for CSS and tests to find a header by.
 */
export const ACCORDION_TRIGGER_ATTRIBUTE = 'data-volt-accordion-trigger';

/**
 * `style` is an object rather than a string so `:spread` merges the custom
 * property in without touching styles the template set itself.
 */
export type DisclosurePropValue = string | boolean | undefined | Readonly<Record<string, string>>;

export interface DisclosureProps {
  readonly [key: string]: DisclosurePropValue;
}

// ---------------------------------------------------------------------------
// The panel behind both components
// ---------------------------------------------------------------------------

interface PanelOptions {
  triggerId: string;
  contentId: string;
  isOpen: () => boolean;
  content: () => Element | null | undefined;
  /** Cannot be toggled at all. */
  disabled: () => boolean;
  /** Cannot be toggled while it is like this — an open panel that must stay. */
  locked: () => boolean;
  region: boolean;
  label: () => string | undefined;
}

interface Panel {
  isPresent(): boolean;
  state(): PresenceState;
  triggerProps(): DisclosureProps;
  contentProps(): DisclosureProps;
}

/**
 * Presence, measurement and ARIA for a single expanding section.
 *
 * The accordion shares this rather than holding a `createCollapsible` per item,
 * because an item's open state belongs to the accordion: giving each item its
 * own state signal as well would mean keeping two copies in step, and every
 * bug in that class of code is a disagreement between the two.
 */
function createPanel(options: PanelOptions): Panel {
  const { triggerId, contentId } = options;
  const presence = createPresence(options.isOpen, options.content);
  const height = new Signal.State<number | null>(null);

  /**
   * `scrollHeight` is the content's natural height even while the element is
   * clipped to nothing, which is exactly the height the animation has to
   * travel. The alternative, `getBoundingClientRect`, measures the box as it
   * is now — mid-collapse that is the height being animated away from, which
   * would feed the animation its own output. The cost is that `scrollHeight`
   * is an integer, so a fractional layout loses up to a pixel at the end.
   */
  const measure = (el: Element) => height.set(el.scrollHeight);

  measureEffect(() => {
    // Reading presence first is what makes this run again when the panel is
    // added to the page: the element may be reached by a DOM lookup rather
    // than a signal, and Volt has already flushed the render effects that
    // inserted it by the time this runs.
    if (!presence.isPresent()) return;
    const el = options.content();
    if (!el) return;

    measure(el);
    observeSize(el, () => measure(el));
  });

  const heightStyle = (): Readonly<Record<string, string>> => {
    const measured = height.get();
    // The last measurement is kept once the panel goes, so the exit animation
    // still has a height to collapse from.
    return measured === null ? {} : { [COLLAPSIBLE_HEIGHT_PROPERTY]: `${measured}px` };
  };

  return {
    isPresent: () => presence.isPresent(),
    state: () => presence.state(),

    triggerProps: () => ({
      id: triggerId,
      // A trigger inside a form is a submit button unless told otherwise.
      type: 'button',
      'aria-expanded': String(options.isOpen()),
      // Only while the panel exists: pointing `aria-controls` at an id that is
      // not in the document is a dangling reference, and the panel is removed
      // as soon as its exit animation has run.
      'aria-controls': presence.isPresent() ? contentId : undefined,
      // `aria-disabled` rather than `disabled`, so a disabled header can still
      // be reached and read. The consumer's own handler is not what enforces
      // it — `toggle` refuses — so nothing depends on them remembering.
      //
      // A header that is merely locked open reports the same way, as the
      // pattern asks, but is not marked for CSS: it is not greyed out, it is
      // the panel the user is currently reading.
      'aria-disabled': options.disabled() || options.locked() ? 'true' : undefined,
      'data-disabled': options.disabled() || undefined,
      'data-state': presence.state(),
    }),

    contentProps: () => {
      const label = options.label();
      const props: Record<string, DisclosurePropValue> = {
        id: contentId,
        'aria-label': label,
        // The header names the panel, which is why no string is invented here.
        'aria-labelledby': label === undefined ? triggerId : undefined,
        'data-state': presence.state(),
        'data-disabled': options.disabled() || undefined,
        style: heightStyle(),
      };
      // Left out rather than spread as undefined: `role` is one of the few
      // names here that an element also has as a property, and assigning
      // undefined to a property is not reliably the same as removing the
      // attribute it reflects.
      if (options.region) props.role = 'region';
      return props;
    },
  };
}

/**
 * Keep the measurement honest while the panel is open.
 *
 * Content that grows after it appears — an image arriving, text reflowing at a
 * new width — would otherwise animate towards a height it no longer has. Where
 * there is no `ResizeObserver`, on a server or in a test environment with no
 * layout, the last measurement simply stands.
 */
function observeSize(el: Element, onResize: () => void): void {
  const view = el.ownerDocument?.defaultView;
  if (typeof view?.ResizeObserver !== 'function') return;

  const observer = new view.ResizeObserver(onResize);
  observer.observe(el);
  onCleanup(() => observer.disconnect());
}

// ---------------------------------------------------------------------------
// Collapsible
// ---------------------------------------------------------------------------

export interface CollapsibleLabels {
  /**
   * Names the content, for when the trigger's own text does not name it well.
   * Left unset the panel is labelled by its trigger, so nothing is invented.
   */
  content?: string;
}

export interface CollapsibleOptions {
  /** The content element, once rendered. */
  content: () => Element | null | undefined;

  /**
   * Supply a signal to control it from outside. Without one it owns its own
   * state, which is what most callers want.
   */
  open?: Signal.State<boolean>;
  defaultOpen?: boolean;

  /** While true the trigger will not toggle. Default false. */
  disabled?: () => boolean;

  /**
   * Give the content `role="region"`. Default false: a lone disclosure is
   * rarely worth a landmark, and landmarks that name nothing in particular
   * make the landmark list harder to navigate, not easier.
   */
  region?: boolean;

  labels?: CollapsibleLabels;

  onOpenChange?: (open: boolean) => void;
}

export interface Collapsible {
  /** Whether the section is logically open. */
  isOpen(): boolean;
  /** Whether its content should be in the DOM — stays true during exit. */
  isPresent(): boolean;
  /** `open` or `closed`, for CSS to animate against. */
  state(): PresenceState;
  /** Whether the caller declared it disabled. */
  isDisabled(): boolean;

  open(): void;
  close(): void;
  toggle(): void;

  triggerProps(): DisclosureProps;
  contentProps(): DisclosureProps;
}

export function createCollapsible(options: CollapsibleOptions): Collapsible {
  const state = options.open ?? new Signal.State(options.defaultOpen ?? false);
  const disabled = () => options.disabled?.() ?? false;

  const setOpen = (next: boolean) => {
    // Disabled blocks these rather than only the trigger's own handler, since
    // these *are* what a trigger calls. A caller that must move a disabled
    // section anyway can write to the controlling signal directly.
    //
    // Both reads are untracked because `open()` may well be called from inside
    // an effect, and subscribing that effect to the state it just wrote — or to
    // whatever `disabled` reads — would run it again when the section closes,
    // and open it straight back up.
    if (untrack(disabled)) return;
    if (untrack(() => state.get()) === next) return;
    state.set(next);
    options.onOpenChange?.(next);
  };

  const panel = createPanel({
    triggerId: createId('collapsible-trigger'),
    contentId: createId('collapsible-content'),
    isOpen: () => state.get(),
    content: () => options.content(),
    disabled,
    // A lone disclosure always closes again; only an accordion can hold one
    // open.
    locked: () => false,
    region: options.region === true,
    label: () => options.labels?.content,
  });

  return {
    isOpen: () => state.get(),
    isPresent: () => panel.isPresent(),
    state: () => panel.state(),
    isDisabled: disabled,

    open: () => setOpen(true),
    close: () => setOpen(false),
    toggle: () => setOpen(!untrack(() => state.get())),

    triggerProps: () => panel.triggerProps(),
    contentProps: () => panel.contentProps(),
  };
}

// ---------------------------------------------------------------------------
// Accordion
// ---------------------------------------------------------------------------

export type AccordionType = 'single' | 'multiple';

export interface AccordionLabels {
  /** Names one panel, for when its header does not name it well. */
  content?: (value: string) => string | undefined;
}

export interface AccordionOptions {
  /** The element the headers live in. Their order is read from it. */
  container: () => Element | null | undefined;

  /** One panel open at a time, or several. Default single. */
  type?: AccordionType;

  /**
   * Supply a signal to control it from outside. The open panels are always a
   * list, even for a single accordion, so that changing `type` does not change
   * the shape of state a consumer already owns.
   */
  value?: Signal.State<string[]>;
  defaultValue?: string[];

  /**
   * Let a single accordion close its last open panel. Default false, matching
   * the usual "one panel is always open" accordion; the cost is that a user
   * who opened a panel cannot get back to a fully collapsed list, which is why
   * it is worth turning on when the panels are long.
   *
   * Meaningless when `type` is multiple, where every panel closes on its own.
   */
  collapsible?: boolean;

  /** Which panels cannot be toggled. */
  disabled?: (value: string) => boolean;

  /** Which arrows move between headers. Default vertical. */
  orientation?: Orientation;
  /** Wrap past the first and last header. Default true; APG allows either. */
  loop?: boolean;

  /**
   * Give each panel `role="region"`. Default true, as the pattern recommends —
   * but each region is a landmark, and APG's own advice is to drop them once
   * an accordion runs past roughly six panels, at which point they crowd out
   * every other landmark on the page.
   */
  region?: boolean;

  labels?: AccordionLabels;

  onValueChange?: (value: string[]) => void;
}

export interface Accordion {
  /** The open panels, in the order they were opened. */
  value(): readonly string[];
  isOpen(value: string): boolean;
  /** Whether a panel should be in the DOM — stays true during exit. */
  isPresent(value: string): boolean;
  state(value: string): PresenceState;
  /**
   * Whether the caller declared this panel disabled. A panel that is merely
   * open in an accordion that will not collapse it is not this, though its
   * header reports as disabled to assistive technology.
   */
  isDisabled(value: string): boolean;

  open(value: string): void;
  close(value: string): void;
  toggle(value: string): void;

  /**
   * Handle a keydown from a header. Returns true when it was consumed, and can
   * be bound on the accordion itself rather than on every header — a press
   * that did not come from a header is left alone.
   */
  onTriggerKeyDown(event: KeyboardEvent): boolean;

  rootProps(): DisclosureProps;
  itemProps(value: string): DisclosureProps;
  triggerProps(value: string): DisclosureProps;
  contentProps(value: string): DisclosureProps;
}

/**
 * Accordion — several collapsibles sharing one piece of state.
 *
 *   <div :ref="root" :spread="a.rootProps()" :keydown="a.onTriggerKeyDown($event)">
 *     <div :for="s in sections" :key="s.id" :spread="a.itemProps(s.id)">
 *       <h3>
 *         <button :spread="a.triggerProps(s.id)" :click="a.toggle(s.id)">{ s.title }</button>
 *       </h3>
 *       <div :if="a.isPresent(s.id)" :spread="a.contentProps(s.id)">{ s.body }</div>
 *     </div>
 *   </div>
 *
 * The headers must be buttons inside headings: the heading level is how a
 * screen reader user skims the list, and the button is what gives Enter and
 * Space for free.
 *
 * Every header stays in the page's tab sequence. That is the one place this
 * departs from the roving-focus primitive it uses to move between them: an
 * accordion is part of the document's reading order rather than a single
 * composite widget like a menu, so APG puts every header in the Tab order and
 * makes the arrow keys an addition rather than the only way through.
 */
export function createAccordion(options: AccordionOptions): Accordion {
  const type = options.type ?? 'single';
  const collapsible = options.collapsible === true;
  const orientation = options.orientation ?? 'vertical';
  const region = options.region !== false;
  const values = options.value ?? new Signal.State<string[]>(options.defaultValue ?? []);

  const isDisabled = (value: string) => options.disabled?.(value) ?? false;

  /**
   * Open, and the only one that could be. The pattern asks such a header to
   * report as disabled, because pressing it does nothing and a user who has
   * been told it is a control deserves to know that before they press it.
   */
  const isLocked = (value: string) =>
    type === 'single' && !collapsible && values.get().includes(value);

  const setValues = (next: string[]) => {
    if (sameValues(values.get(), next)) return;
    values.set(next);
    options.onValueChange?.(next);
  };

  // These read the open panels and the caller's `disabled` untracked, because
  // they may well be called from inside an effect, and subscribing that effect
  // to the state they write would run it again when the panel closes — and
  // open it straight back up.
  const open = (value: string) =>
    untrack(() => {
      if (isDisabled(value)) return;
      const current = values.get();
      if (current.includes(value)) return;
      setValues(type === 'multiple' ? [...current, value] : [value]);
    });

  const close = (value: string) =>
    untrack(() => {
      if (isDisabled(value) || isLocked(value)) return;
      const current = values.get();
      if (!current.includes(value)) return;
      setValues(current.filter((other) => other !== value));
    });

  // Panels are built the first time a value is asked about, since the values
  // are whatever the consumer renders. Each gets a root of its own rather than
  // living in whichever effect happened to ask first: a panel owned by a
  // render effect would be torn down and rebuilt every time that effect re-ran
  // — on every open and close — and each rebuild would abandon the exit
  // animation it was in the middle of. The price is that a value which
  // disappears from the list keeps its panel, two signals and an effect, until
  // the accordion itself goes.
  const panels = new Map<string, { panel: Panel; dispose: () => void }>();
  onCleanup(() => {
    for (const entry of panels.values()) entry.dispose();
    panels.clear();
  });

  const panelFor = (value: string): Panel => {
    const existing = panels.get(value);
    if (existing) return existing.panel;

    const contentId = createId('accordion-content');

    return createRoot((dispose) => {
      const panel = createPanel({
        triggerId: createId('accordion-trigger'),
        contentId,
        isOpen: () => values.get().includes(value),
        // Found by id rather than handed back by the consumer: an accordion of
        // twenty panels would otherwise need twenty refs threaded through the
        // template, all of them the consumer's to get wrong. `getElementById`
        // also avoids escaping a generated id into a selector.
        content: () => options.container()?.ownerDocument.getElementById(contentId),
        disabled: () => isDisabled(value),
        locked: () => isLocked(value),
        region,
        label: () => options.labels?.content?.(value),
      });
      panels.set(value, { panel, dispose });
      return panel;
    }, null);
  };

  // This accordion's own headers, told apart from those of one nested in a
  // panel. Both carry ACCORDION_TRIGGER_ATTRIBUTE and the inner one's sit in
  // this one's container, so the shared marker would put them in this one's
  // arrow sequence and have it answer keys pressed on them.
  const headerAttribute = `data-${createId('volt-accordion')}`;

  const collection = createCollection(() => options.container(), {
    attribute: headerAttribute,
    // A header that stays in the tab sequence has to stay in the arrow
    // sequence too, or the two orders disagree about which headers exist and a
    // disabled header becomes reachable one way but not the other.
    skipDisabled: false,
  });

  /**
   * The header the current key press came from.
   *
   * Focus is the real state here — every header is tabbable, so the user can
   * arrive at one without any arrow key being involved — which is why this is
   * taken from the event rather than mirrored in a signal that would go stale
   * the moment someone pressed Tab.
   */
  let focused: HTMLElement | null = null;

  const roving = createRovingFocus(
    collection,
    () => focused,
    (el) => {
      focused = el;
    },
    {
      orientation,
      loop: options.loop !== false,
      // A header's text is a sentence, not a label to be picked out of a list,
      // and APG's accordion has no typeahead for exactly that reason.
      typeahead: false,
    },
  );

  const triggerFrom = (target: EventTarget | null): HTMLElement | null => {
    if (!(target instanceof Element)) return null;
    const trigger = target.closest<HTMLElement>(`[${headerAttribute}]`);
    const container = options.container();
    return trigger && container?.contains(trigger) ? trigger : null;
  };

  return {
    value: () => values.get(),
    isOpen: (value) => values.get().includes(value),
    isPresent: (value) => panelFor(value).isPresent(),
    state: (value) => panelFor(value).state(),
    isDisabled,

    open,
    close,
    toggle: (value) => (untrack(() => values.get()).includes(value) ? close(value) : open(value)),

    onTriggerKeyDown(event: KeyboardEvent): boolean {
      const trigger = triggerFrom(event.target);
      // A key pressed inside a panel belongs to whatever is in the panel; an
      // arrow key in a textarea there must not move between headers.
      if (!trigger) return false;

      // Enter and Space are left to the browser. The header is a button, so it
      // already turns both into a click, and handling them here as well would
      // toggle the panel twice.
      if (event.key === 'Enter' || event.key === ' ') return false;

      focused = trigger;
      const handled = roving.onKeyDown(event);
      // Otherwise the arrows and End scroll the page out from under the header
      // that has just taken focus.
      if (handled) event.preventDefault();
      return handled;
    },

    rootProps: () => ({ 'data-orientation': orientation }),

    itemProps: (value) => ({
      'data-state': panelFor(value).state(),
      'data-disabled': isDisabled(value) || undefined,
      'data-orientation': orientation,
    }),

    triggerProps: (value) => ({
      ...panelFor(value).triggerProps(),
      // The shared marker says which panel a header opens, for styling and for
      // finding one; the accordion's own is what it moves between.
      [ACCORDION_TRIGGER_ATTRIBUTE]: value,
      [headerAttribute]: '',
    }),

    contentProps: (value) => panelFor(value).contentProps(),
  };
}

function sameValues(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
