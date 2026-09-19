/**
 * The contract this package restates, held against the primitives that
 * write it.
 *
 * This package does not import `@voltdev/primitives`. Each component file
 * restates the `data-` attributes its primitive writes, and `contract.ts` the
 * one custom property a primitive measures — which keeps the styled layer
 * something that can be taken away, and means a primitive can rename an
 * attribute and leave a rule here selecting on nothing. The other suites hold
 * the sheet only to itself, so nothing noticed when that happened.
 *
 * So each component here is the markup the reference page documents, spread
 * with a real primitive's props, mounted by Volt, with the sheet in the
 * document — the same copy `harness.ts` builds. What is asserted is what the
 * two halves do together.
 *
 * One departure from the documented markup: nothing here is rendered under
 * `:if="isPresent()"`. A closing element stays on the page for as long as its
 * exit animation runs, and happy-dom runs none, so the closed state the rules
 * animate out of would otherwise never be seen. Left mounted, an element
 * carries the state its primitive writes whether it is open or not.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { compileTemplate } from '@voltdev/core/jit';
import { Component, Signal, flushSync, mount } from '@voltdev/core';
import {
  COLLAPSIBLE_HEIGHT_PROPERTY,
  createAccordion,
  createCheckbox,
  createDialog,
  createMenu,
  createPopover,
  createTabs,
  createToaster,
  createTooltip,
  resetTooltipDelayGroup,
  type AnchorPlacement,
  type TabsOrientation,
  type Toast,
} from '@voltdev/primitives';
import { componentStyles, contractProperties, primitiveTokens } from '../src/index.ts';
import { unlayeredCss } from './harness.ts';

let host: HTMLElement;
let mounted: { unmount(): void }[] = [];

beforeAll(() => {
  const style = document.createElement('style');
  style.textContent = unlayeredCss();
  document.head.append(style);
});

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  host = document.querySelector('#app')!;
  resetTooltipDelayGroup();
});

afterEach(() => {
  for (const handle of mounted) handle.unmount();
  mounted = [];
  flushSync();
  vi.unstubAllGlobals();
});

function show<T>(component: new () => T): T {
  const handle = mount(component, host);
  mounted.push(handle);
  flushSync();
  return handle.instance as T;
}

function step(action: () => void): void {
  action();
  flushSync();
}

/** An engine without CSS anchor positioning, as the primitives ask about it. */
function withoutAnchorPositioning(): void {
  vi.stubGlobal('CSS', { supports: () => false });
}

function computed(selector: string): CSSStyleDeclaration {
  const element = document.querySelector(selector);
  expect(element, `nothing rendered matches ${selector}`).not.toBeNull();
  return getComputedStyle(element as Element);
}

/**
 * One side of a box, in both spellings: `margin-*` on the left side is
 * `margin-left` and `margin-inline-start`, and `inset` there is `left` and
 * `inset-inline-start`. A browser treats the two as one property in a
 * horizontal, left-to-right page, which is the only kind rendered here;
 * happy-dom keeps them apart, so a side is read both ways.
 */
const LOGICAL = { top: 'block-start', bottom: 'block-end', left: 'inline-start', right: 'inline-end' };
type Side = keyof typeof LOGICAL;

const OPPOSITE: Record<Side, Side> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };

function spellings(style: CSSStyleDeclaration, property: string, which: Side): string[] {
  const names =
    property === 'inset'
      ? [which, `inset-${LOGICAL[which]}`]
      : [property.replace('*', which), property.replace('*', LOGICAL[which])];
  return names.map((name) => style.getPropertyValue(name));
}

/** The side's value, from whichever spelling set it. */
function side(style: CSSStyleDeclaration, property: string, which: Side): string {
  return spellings(style, property, which).find((value) => value !== '') ?? '';
}

/** Nothing, however it is spelled. */
function isZero(value: string): boolean {
  return value === '' || Number.parseFloat(value) === 0;
}

// ---------------------------------------------------------------------------
// The documented markup, one component per primitive
// ---------------------------------------------------------------------------

let placement: AnchorPlacement = 'bottom';
let orientation: TabsOrientation = 'horizontal';

@Component({
  selector: 'v-styled-accordion',
  render: compileTemplate(`
    <div class="volt-accordion" :ref="root" :spread="accordion.rootProps()">
      <div :for="section in sections" :key="section" class="volt-accordion-item"
           :spread="accordion.itemProps(section)">
        <h3 class="volt-accordion-header">
          <button class="volt-accordion-trigger" :spread="accordion.triggerProps(section)"
                  :click="accordion.toggle(section)">{ section }</button>
        </h3>
        <div class="volt-accordion-panel" :spread="accordion.contentProps(section)">{ section }</div>
      </div>
    </div>
  `),
})
class StyledAccordion {
  sections = ['shipping', 'returns', 'archived'];
  root = new Signal.State<Element | null>(null);
  accordion = createAccordion({
    container: () => this.root.get(),
    type: 'multiple',
    disabled: (value) => value === 'archived',
  });
}

@Component({
  selector: 'v-styled-checkbox',
  render: compileTemplate(`
    <div>
      <label :for="box in boxes" :key="box.name" class="volt-checkbox-field">
        <span class="volt-checkbox" :spread="box.control.controlProps()">
          <span class="volt-checkbox-indicator" aria-hidden="true">✓</span>
          { box.name }
        </span>
      </label>
    </div>
  `),
})
class StyledCheckbox {
  boxes = [
    { name: 'unchecked', control: createCheckbox() },
    { name: 'checked', control: createCheckbox({ defaultChecked: true }) },
    { name: 'mixed', control: createCheckbox({ defaultChecked: 'indeterminate' }) },
    { name: 'disabled', control: createCheckbox({ disabled: () => true }) },
  ];
}

@Component({
  selector: 'v-styled-dialog',
  render: compileTemplate(`
    <div>
      <button :ref="trigger" :spread="dialog.triggerProps()" :click="dialog.open()">Delete</button>
      <div :portal class="volt-dialog-overlay" :data-state="dialog.state()"></div>
      <div :portal class="volt-dialog-content" :ref="content" :spread="dialog.contentProps()">
        <h2 class="volt-dialog-title" :spread="dialog.titleProps()">Delete this project?</h2>
        <p class="volt-dialog-description" :spread="dialog.descriptionProps()">It cannot be undone.</p>
        <div class="volt-dialog-footer">
          <button :click="dialog.close()">Cancel</button>
        </div>
      </div>
    </div>
  `),
})
class StyledDialog {
  trigger = new Signal.State<Element | null>(null);
  content = new Signal.State<Element | null>(null);
  dialog = createDialog({ trigger: () => this.trigger.get(), content: () => this.content.get() });
}

@Component({
  selector: 'v-styled-menu',
  render: compileTemplate(`
    <div>
      <button :ref="trigger" :spread="menu.triggerProps()" :click="menu.toggle()">Actions</button>
      <div :portal :ref="content" class="volt-menu-content" :spread="menu.contentProps()">
        <button class="volt-menu-item" :spread="menu.itemProps({ value: 'rename' })">Rename</button>
        <div class="volt-menu-separator" :spread="menu.separatorProps()"></div>
        <button class="volt-menu-item" :spread="menu.itemProps({ value: 'delete', disabled: true })">Delete</button>
        <button class="volt-menu-item" disabled :spread="menu.itemProps({ value: 'archive' })">Archive</button>
      </div>
    </div>
  `),
})
class StyledMenu {
  trigger = new Signal.State<Element | null>(null);
  content = new Signal.State<Element | null>(null);
  menu = createMenu({ trigger: () => this.trigger.get(), content: () => this.content.get() });
}

@Component({
  selector: 'v-styled-context-menu',
  render: compileTemplate(`
    <div>
      <div class="area" :contextmenu="menu.onContextMenu($event)">Right-click here</div>
      <div :if="menu.isPresent()" :portal :ref="content" class="volt-menu-content"
           :spread="menu.contentProps()">
        <button class="volt-menu-item" :spread="menu.itemProps({ value: 'copy' })">Copy</button>
      </div>
    </div>
  `),
})
class StyledContextMenu {
  content = new Signal.State<Element | null>(null);
  menu = createMenu({ content: () => this.content.get() });
}

@Component({
  selector: 'v-styled-popover',
  render: compileTemplate(`
    <div>
      <button :ref="trigger" :spread="popover.triggerProps()">Filters</button>
      <div :portal :ref="content" class="volt-popover-content" :spread="popover.contentProps()">
        <h2 class="volt-popover-title" :spread="popover.titleProps()">Filters</h2>
        <p class="volt-popover-description" :spread="popover.descriptionProps()">Narrow the list.</p>
        <div class="volt-popover-arrow" :spread="popover.arrowProps()"></div>
      </div>
    </div>
  `),
})
class StyledPopover {
  trigger = new Signal.State<Element | null>(null);
  content = new Signal.State<Element | null>(null);
  popover = createPopover({
    trigger: () => this.trigger.get(),
    content: () => this.content.get(),
    placement,
  });
}

@Component({
  selector: 'v-styled-tabs',
  render: compileTemplate(`
    <div>
      <div class="volt-tabs-list" :ref="list" :spread="tabs.listProps()">
        <button class="volt-tabs-tab" :spread="tabs.tabProps('account')">Account</button>
        <button class="volt-tabs-tab" :spread="tabs.tabProps('billing')">Billing</button>
        <button class="volt-tabs-tab" :spread="tabs.tabProps('archive', { disabled: true })">Archive</button>
      </div>
      <div class="volt-tabs-panel" :spread="tabs.panelProps('account')">Account</div>
      <div class="volt-tabs-panel" :spread="tabs.panelProps('billing')">Billing</div>
      <div class="volt-tabs-panel" :spread="tabs.panelProps('archive')">Archive</div>
    </div>
  `),
})
class StyledTabs {
  list = new Signal.State<Element | null>(null);
  tabs = createTabs({ list: () => this.list.get(), label: 'Settings', orientation });
}

@Component({
  selector: 'v-styled-toasts',
  render: compileTemplate(`
    <div>
      <div class="volt-toast-region" :ref="region" :spread="toaster.regionProps()">
        <div :for="toast in toaster.visible()" :key="toast.id" class="volt-toast"
             :spread="toaster.toastProps(toast)">
          <p class="volt-toast-title">{ toast.data() }</p>
          <p class="volt-toast-description">Details</p>
          <div class="volt-toast-actions">
            <button :spread="toaster.closeProps()" :click="toast.dismiss()">Close</button>
          </div>
        </div>
        <div :if="gone.get()" class="volt-toast" :spread="toaster.toastProps(gone.get())"></div>
      </div>
    </div>
  `),
})
class StyledToasts {
  region = new Signal.State<Element | null>(null);
  toaster = createToaster<string>({ region: () => this.region.get(), max: 4, duration: 0 });
  /** A dismissed toast, kept on the page as its exit animation would keep it. */
  gone = new Signal.State<Toast<string> | null>(null);
}

@Component({
  selector: 'v-styled-tooltip',
  render: compileTemplate(`
    <div>
      <button :ref="trigger" :spread="tip.triggerProps()">Save</button>
      <div :portal :ref="content" class="volt-tooltip-content" :spread="tip.contentProps()">Save the file</div>
    </div>
  `),
})
class StyledTooltip {
  trigger = new Signal.State<Element | null>(null);
  content = new Signal.State<Element | null>(null);
  tip = createTooltip({ trigger: () => this.trigger.get(), content: () => this.content.get() });
}

const PLACEMENTS: readonly AnchorPlacement[] = [
  'top',
  'top-start',
  'top-end',
  'right',
  'right-start',
  'right-end',
  'bottom',
  'bottom-start',
  'bottom-end',
  'left',
  'left-start',
  'left-end',
];

/**
 * Every state each component's rules distinguish, reached through the
 * primitive's own API. `look` is called in each of them.
 */
const scenes: Record<string, (look: () => void) => void> = {
  accordion(look) {
    const { accordion } = show(StyledAccordion);
    look();
    step(() => accordion.open('shipping'));
    look();
  },

  checkbox(look) {
    show(StyledCheckbox);
    look();
  },

  dialog(look) {
    const { dialog } = show(StyledDialog);
    step(() => dialog.open());
    look();
    step(() => dialog.close());
    look();
  },

  menu(look) {
    const { menu } = show(StyledMenu);
    step(() => menu.open());
    look();
    step(() => menu.close());
    look();
  },

  popover(look) {
    for (const each of PLACEMENTS) {
      placement = each;
      const { popover } = show(StyledPopover);
      step(() => popover.open());
      look();
      step(() => popover.close());
      look();
      for (const handle of mounted.splice(0)) handle.unmount();
      flushSync();
    }
  },

  tabs(look) {
    for (const each of ['horizontal', 'vertical'] as const) {
      orientation = each;
      show(StyledTabs);
      look();
    }
  },

  toast(look) {
    const scene = show(StyledToasts);
    step(() => {
      for (const type of ['info', 'success', 'warning', 'error'] as const) scene.toaster.add(type, { type });
    });
    look();
    const first = scene.toaster.visible()[0]!;
    step(() => {
      first.dismiss();
      scene.gone.set(first);
    });
    look();
  },

  tooltip(look) {
    const { tip } = show(StyledTooltip);
    step(() => tip.open());
    look();
    step(() => tip.close());
    look();
  },
};

/** A selector list, split at the commas that separate its selectors. */
function selectorsIn(list: string): string[] {
  const selectors: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < list.length; index += 1) {
    const character = list[index];
    if (character === '(') depth += 1;
    else if (character === ')') depth -= 1;
    else if (character === ',' && depth === 0) {
      selectors.push(list.slice(start, index).trim());
      start = index + 1;
    }
  }
  selectors.push(list.slice(start).trim());
  return selectors;
}

describe('every rule selects something its primitive renders', () => {
  it('covers every component that has a primitive behind it', () => {
    // The button is the one without: its attributes are ones the consumer
    // writes, so there is nothing of a primitive's for it to agree with.
    const styled = componentStyles.map((component) => component.name).filter((name) => name !== 'button');
    expect(Object.keys(scenes).sort()).toEqual(styled.sort());
  });

  for (const component of componentStyles) {
    const scene = scenes[component.name];
    if (!scene) continue;

    it(`${component.name}`, () => {
      // The pointer and keyboard focus are states the scenes do not drive;
      // what is being asked is whether the classes and attributes around them
      // are ones the primitive writes.
      const selectors = [...component.rules, ...component.forcedColors]
        .flatMap((rule) => selectorsIn(rule.selector))
        .map((selector) => selector.replaceAll(':hover', '').replaceAll(':focus-visible', ''));
      const unmatched = new Set(selectors);
      const look = () => {
        for (const selector of unmatched) if (document.querySelector(selector)) unmatched.delete(selector);
      };

      scene(look);
      // And again where the answer to "can this engine anchor?" is no, since
      // the primitives write something different there.
      for (const handle of mounted.splice(0)) handle.unmount();
      flushSync();
      withoutAnchorPositioning();
      scene(look);

      expect([...unmatched], `${component.name}: rules no rendered element matches`).toEqual([]);
    });
  }

  it('names every custom property a primitive measures and a rule reads', () => {
    const { accordion } = show(StyledAccordion);
    step(() => accordion.open('shipping'));

    const panel = document.querySelector<HTMLElement>('.volt-accordion-panel')!;
    expect(contractProperties.has(COLLAPSIBLE_HEIGHT_PROPERTY)).toBe(true);
    for (const property of contractProperties) {
      expect(panel.style.getPropertyValue(property), property).not.toBe('');
    }
  });
});

// ---------------------------------------------------------------------------
// What the two halves do together
// ---------------------------------------------------------------------------

/**
 * The border a browser's own stylesheet gives every `<button>`. happy-dom has
 * no such stylesheet, so without this a rule that forgot a `<button>`'s edges
 * looks exactly like one that cleared them. Written in the spelling the sheet
 * uses, since happy-dom does not treat `border-left-width` and
 * `border-inline-start-width` as one property the way a browser does, and a
 * type selector, which is weaker than any rule here, the way the browser's own
 * rules are.
 */
const BUTTON_BORDER = `button {
  ${(['top', 'bottom', 'left', 'right'] as const)
    .map((which) => `border-${LOGICAL[which]}-width: 2px; border-${LOGICAL[which]}-style: outset;`)
    .join('\n  ')}
}`;

function withButtonBorder(run: () => void): void {
  const style = document.createElement('style');
  style.textContent = BUTTON_BORDER;
  document.head.prepend(style);
  try {
    run();
  } finally {
    style.remove();
  }
}

describe('the menu', () => {
  it('draws the item under the pointer, and never one that is disabled', () => {
    const { menu } = show(StyledMenu);
    step(() => menu.open());

    const hover = (value: string): string => {
      const item = document.querySelector(`.volt-menu-item[data-value='${value}']`)!;
      const before = getComputedStyle(item).getPropertyValue('background-color');
      item.setAttribute('data-hover', '');
      const after = getComputedStyle(item).getPropertyValue('background-color');
      item.removeAttribute('data-hover');
      expect(before, value).toBe('transparent');
      return after;
    };

    // Focus follows the pointer through a menu without a ring, so this is the
    // only thing marking where the pointer is.
    expect(hover('rename')).toBe(primitiveTokens['--volt-palette-neutral-100']);
    // Disabled through the primitive, and natively: the primitive treats both
    // as unavailable, and an item that lights up looks like it will do
    // something.
    expect(hover('delete')).toBe('transparent');
    expect(hover('archive')).toBe('transparent');
  });

  it('fixes a context menu to the viewport, where `position()` measures the press', () => {
    const { menu } = show(StyledContextMenu);
    const area = document.querySelector('.area')!;
    step(() => {
      area.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 60 }));
    });

    expect(menu.position()).toEqual({ x: 40, y: 60 });
    expect(computed('.volt-menu-content').getPropertyValue('position')).toBe('fixed');
  });

  it('leaves an anchored menu positioned the way the primitive wrote it', () => {
    const { menu } = show(StyledMenu);
    step(() => menu.open());
    // Inline, so it wins over the sheet's `fixed` whatever that says.
    expect(document.querySelector<HTMLElement>('.volt-menu-content')!.style.position).toBe('absolute');
  });

  it('draws none of the border a browser gives a `<button>` item', () => {
    const { menu } = show(StyledMenu);
    step(() => menu.open());

    withButtonBorder(() => {
      const style = computed(".volt-menu-item[data-value='rename']");
      for (const which of ['top', 'bottom', 'left', 'right'] as const) {
        expect(isZero(side(style, 'border-*-width', which)), which).toBe(true);
      }
    });
  });
});

describe('tabs', () => {
  it('draws none of the border a browser gives a `<button>` tab, beyond its own edge', () => {
    orientation = 'horizontal';
    show(StyledTabs);

    withButtonBorder(() => {
      const style = computed('.volt-tabs-tab');
      for (const which of ['top', 'left', 'right'] as const) {
        expect(isZero(side(style, 'border-*-width', which)), which).toBe(true);
      }
      expect(side(style, 'border-*-width', 'bottom')).toBe(primitiveTokens['--volt-border-width-2']);
    });
  });

  it('marks the selected tab of a vertical list on the edge beside its panels', () => {
    orientation = 'vertical';
    show(StyledTabs);

    withButtonBorder(() => {
      const selected = computed(".volt-tabs-tab[data-state='active']");
      expect(side(selected, 'border-*-color', 'right')).toBe(primitiveTokens['--volt-palette-accent-500']);
      expect(side(selected, 'border-*-width', 'right')).toBe(primitiveTokens['--volt-border-width-2']);
      for (const which of ['top', 'bottom', 'left'] as const) {
        expect(isZero(side(selected, 'border-*-width', which)), which).toBe(true);
      }

      const other = computed(".volt-tabs-tab[data-state='inactive']");
      expect(side(other, 'border-*-color', 'right')).toBe('transparent');
    });
  });
});

describe('the tooltip', () => {
  it('lets the pointer onto the content, which the primitive keeps open for it', () => {
    const { tip } = show(StyledTooltip);
    step(() => tip.open());
    // The primitive listens for the pointer on the content so that a long
    // description can be read without the tooltip closing under it — WCAG's
    // Content on Hover or Focus. `pointer-events: none` would switch that off.
    expect(computed('.volt-tooltip-content').getPropertyValue('pointer-events')).not.toBe('none');
  });
});

describe('floating elements on an engine without anchor positioning', () => {
  // Every current engine has CSS anchor positioning, so the sheet has nothing
  // to say here. The placement it used to write assumed a wrapper shared with
  // the trigger, and the primitives' own examples portal all three to <body>,
  // where it put them against the page: a tooltip above the top of it.
  it('places none of the three against the page', () => {
    withoutAnchorPositioning();
    placement = 'bottom';
    const { popover } = show(StyledPopover);
    const { menu } = show(StyledMenu);
    const { tip } = show(StyledTooltip);
    step(() => {
      popover.open();
      menu.open();
      tip.open();
    });

    for (const selector of ['.volt-popover-content', '.volt-menu-content', '.volt-tooltip-content']) {
      const element = document.querySelector(selector)!;
      expect(element.parentElement, selector).toBe(document.body);
      expect(element.getAttribute('data-anchored'), selector).toBe('false');
      const style = getComputedStyle(element);
      for (const which of ['top', 'bottom', 'left', 'right'] as const) {
        expect(spellings(style, 'inset', which), `${selector} ${which}`).toEqual(['', '']);
      }
    }
  });
});

describe('the popover', () => {
  /** Which side of the content faces the trigger, for each placement. */
  const FACING: Record<string, Side> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };

  function open(at: AnchorPlacement): void {
    placement = at;
    const { popover } = show(StyledPopover);
    step(() => popover.open());
  }

  for (const at of PLACEMENTS) {
    const facing = FACING[at.split('-')[0] as string] as Side;
    const across: Side[] = facing === 'top' || facing === 'bottom' ? ['left', 'right'] : ['top', 'bottom'];

    it(`${at}: leaves its gap on the side facing the trigger, and on no side across it`, () => {
      open(at);
      const style = computed('.volt-popover-content');
      expect(side(style, 'margin-*', facing)).toBe(primitiveTokens['--volt-space-2']);
      // A margin across the placement would push an aligned popover off the
      // edge it is aligned to.
      for (const which of across) expect(isZero(side(style, 'margin-*', which)), which).toBe(true);
    });

    it(`${at}: draws its arrow on that side, pointing out of it`, () => {
      open(at);
      const style = computed('.volt-popover-arrow');
      expect(side(style, 'inset', facing), 'on the facing edge').not.toBe('');
      expect(side(style, 'inset', OPPOSITE[facing]), 'not on the far one').toBe('');

      // A square turned forty-five degrees shows a corner made of two of its
      // edges; the two facing into the popover are the ones left undrawn.
      const hidden: Record<Side, readonly Side[]> = {
        top: ['bottom', 'right'],
        bottom: ['top', 'left'],
        left: ['top', 'right'],
        right: ['bottom', 'left'],
      };
      for (const which of ['top', 'bottom', 'left', 'right'] as const) {
        const styles = spellings(style, 'border-*-style', which);
        if (hidden[facing].includes(which)) expect(styles, which).toContain('none');
        else expect(styles, which).not.toContain('none');
      }
    });

    it(`${at}: sets its arrow along that edge where the trigger is`, () => {
      open(at);
      const style = computed('.volt-popover-arrow');
      const alignment = at.split('-')[1];
      // Aligned to the trigger's start or end, the arrow sits near that end of
      // the edge, which is where the trigger is; centred, at the middle.
      const [start, end] = across;
      const near = alignment === 'end' ? (end as Side) : (start as Side);
      const value = side(style, 'inset', near);
      expect(value, near).not.toBe('');
      expect(value.includes('50%'), `${near}: ${value}`).toBe(alignment === undefined);
      expect(side(style, 'inset', OPPOSITE[near]), OPPOSITE[near]).toBe('');
    });
  }
});

describe('the checkbox', () => {
  it('takes its label inside the control, the way the primitive’s own example writes it', () => {
    show(StyledCheckbox);
    const control = computed('.volt-checkbox');
    // The control holds the words as well as the box, so it is not a box.
    expect(control.getPropertyValue('inline-size')).toBe('');
    expect(control.getPropertyValue('block-size')).toBe('');
    expect(isZero(side(control, 'border-*-width', 'top'))).toBe(true);

    const box = computed('.volt-checkbox-indicator');
    expect(box.getPropertyValue('inline-size')).toBe(primitiveTokens['--volt-space-5']);
    expect(box.getPropertyValue('block-size')).toBe(primitiveTokens['--volt-space-5']);
  });

  it('shows the mark only on a box that is checked or part-checked', () => {
    show(StyledCheckbox);
    const box = (state: string): CSSStyleDeclaration =>
      computed(`.volt-checkbox[data-state='${state}'] .volt-checkbox-indicator`);

    // The box is drawn in every state; only the mark inside it comes and goes.
    for (const state of ['unchecked', 'checked', 'indeterminate']) {
      expect(box(state).getPropertyValue('visibility'), state).not.toBe('hidden');
    }
    expect(box('unchecked').getPropertyValue('color')).toBe('transparent');
    expect(box('checked').getPropertyValue('color')).toBe(primitiveTokens['--volt-palette-white']);
    expect(box('indeterminate').getPropertyValue('color')).toBe(primitiveTokens['--volt-palette-white']);
  });
});
