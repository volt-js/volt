/**
 * `<v-toggle-group>` and `<v-toggle>`, driven the way a page drives them.
 *
 * The behaviour is `createToggleGroup`'s and `createToggle`'s, and is tested
 * where each lives. What is left here is what the pair adds: a button drawn
 * per tag inside the group, the classes and attributes the sheet's rules
 * select on, each prop handed to a primitive doing something, the lone
 * toggle a tag becomes outside a group, both primitives left reachable for
 * everything this does not offer, and the corners and stacking of the row the
 * sheet draws from what the tags render.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Component, Signal, flushSync, mount } from '@voltdev/core';
import { compileTemplate } from '@voltdev/core/jit';
import { renderToStaticMarkup } from '@voltdev/core/server';
import { compileComponents } from './render.js';
import { standIn, styledDocument, SYSTEM_COLORS } from './harness.ts';
import { VToggle } from '../src/components/toggle.js';
import { VToggleGroup } from '../src/components/toggle-group.js';
import groupTemplate from '../src/components/toggle-group.html?raw';
import toggleTemplate from '../src/components/toggle.html?raw';
import { FORCED_COLORS_QUERY, rulesToCss, tokensCss, wrap, type Rule } from '../src/index.ts';
import { toggleGroupStyles } from '../src/sheet/toggle-group.ts';

compileComponents();

let unmount: (() => void) | null = null;

afterEach(() => {
  unmount?.();
  unmount = null;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

function show<T>(component: new () => T): { instance: T; host: HTMLElement } {
  const host = document.createElement('div');
  document.body.append(host);
  const handle = mount(component, host);
  unmount = handle.unmount;
  flushSync();
  return { instance: handle.instance as T, host };
}

/**
 * Let the group hear about toggles that came or went: nothing announces
 * that, so the primitive watches the DOM and is told on a microtask.
 */
async function settle(): Promise<void> {
  await Promise.resolve();
  flushSync();
}

/** A keydown as a real one arrives: from the focused toggle, bubbling to the group. */
function press(el: Element, key: string): void {
  el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  flushSync();
}

function click(el: Element): void {
  (el as HTMLElement).click();
  flushSync();
}

const group = (host: HTMLElement): HTMLElement => host.querySelector('.volt-toggle-group')!;
const toggles = (host: HTMLElement): HTMLButtonElement[] => [
  ...host.querySelectorAll<HTMLButtonElement>('.volt-toggle'),
];
const states = (host: HTMLElement): string[] =>
  toggles(host).map((toggle) => toggle.getAttribute('data-state') ?? '');
const tabStops = (host: HTMLElement): string[] =>
  toggles(host).map((toggle) => toggle.getAttribute('tabindex') ?? '');
const focused = (): string | null => document.activeElement?.getAttribute('data-value') ?? null;

/** A row that must keep one value, which is the default, with the page holding it. */
@Component({
  selector: 'v-page',
  imports: [VToggleGroup, VToggle],
  render: compileTemplate(`
    <v-toggle-group :value="align" label="Alignment" class="mine" data-kind="row">
      <v-toggle value="left" label="Align left" class="first" id="align-left">L</v-toggle>
      <v-toggle value="center" label="Align centre" aria-describedby="centre-hint">C</v-toggle>
      <v-toggle value="right" label="Align right" :disabled="off.get()">R</v-toggle>
      <v-toggle value="justify" label="Justify">J</v-toggle>
    </v-toggle-group>
  `),
})
class Page {
  /** A plain string: a group that must keep a value never writes `null` into it. */
  align = new Signal.State('left');
  off = new Signal.State(true);
}

/** Several at once, with the page holding the list. */
@Component({
  selector: 'v-page-multiple',
  imports: [VToggleGroup, VToggle],
  render: compileTemplate(`
    <v-toggle-group :value="marks" type="multiple" label="Formatting" :onValueChange="heard">
      <v-toggle value="bold"><b>B</b></v-toggle>
      <v-toggle value="italic"><i>I</i></v-toggle>
      <v-toggle value="underline"><u>U</u></v-toggle>
    </v-toggle-group>
  `),
})
class MultiplePage {
  marks = new Signal.State<string[]>([]);
  seen: string[][] = [];
  heard = (value: string[]): void => {
    this.seen.push(value);
  };
}

/** One value that may go back to none, which makes the group a row of buttons. */
@Component({
  selector: 'v-page-deselectable',
  imports: [VToggleGroup, VToggle],
  render: compileTemplate(`
    <v-toggle-group deselectable :onValueChange="heard">
      <v-toggle value="list">List</v-toggle>
      <v-toggle value="grid">Grid</v-toggle>
      <v-toggle value="map">Map</v-toggle>
    </v-toggle-group>
  `),
})
class DeselectablePage {
  seen: string[] = [];
  heard = (value: string): void => {
    this.seen.push(value);
  };
}

/** A toggle on its own, with the page holding whether it is down. */
@Component({
  selector: 'v-page-lone',
  imports: [VToggle],
  render: compileTemplate(`
    <v-toggle :pressed="wrapping" class="mine" :disabled="off.get()" :onPressedChange="heard">
      Wrap lines
    </v-toggle>
  `),
})
class LonePage {
  wrapping = new Signal.State(false);
  off = new Signal.State(false);
  seen: boolean[] = [];
  heard = (pressed: boolean): void => {
    this.seen.push(pressed);
  };
}

describe('v-toggle-group', () => {
  it('draws a button per tag inside the group that names them', () => {
    const { host } = show(Page);
    const row = group(host);

    // One value that has to stay chosen is a radio group, which is the one
    // correct announcement for "exactly one of these".
    expect(row.getAttribute('role')).toBe('radiogroup');
    expect(row.getAttribute('aria-label')).toBe('Alignment');
    expect(toggles(host).map((toggle) => toggle.textContent)).toEqual(['L', 'C', 'R', 'J']);
    expect(toggles(host).every((toggle) => toggle.getAttribute('role') === 'radio')).toBe(true);
    // Every button is inside the group, which is where the primitive looks.
    expect(row.querySelectorAll('.volt-toggle')).toHaveLength(4);
    // A toggle inside a form submits it unless it says otherwise.
    expect(toggles(host).every((toggle) => toggle.type === 'button')).toBe(true);
    // The primitive's own marks, which are how a press finds its value.
    expect(toggles(host).map((toggle) => toggle.getAttribute('data-value'))).toEqual([
      'left',
      'center',
      'right',
      'justify',
    ]);
    expect(toggles(host).every((toggle) => toggle.hasAttribute('data-volt-item'))).toBe(true);
  });

  it('lands what the caller wrote on each tag on the element they can see', () => {
    const { host } = show(Page);
    const row = group(host);

    // The group's own class and data land on the element carrying the role.
    expect([...row.classList].sort()).toEqual(['mine', 'volt-toggle-group']);
    expect(row.dataset['kind']).toBe('row');
    // A toggle's class and id land on its button, beside the sheet's class.
    const [left, center] = toggles(host);
    expect([...left!.classList].sort()).toEqual(['first', 'volt-toggle']);
    expect(left!.id).toBe('align-left');

    // What the caller wrote that the primitive has no opinion about survives
    // the bag being applied again, which every press does.
    expect(center!.getAttribute('aria-describedby')).toBe('centre-hint');
    click(center!);
    expect(center!.getAttribute('data-state')).toBe('on');
    expect(center!.getAttribute('aria-describedby')).toBe('centre-hint');
  });

  it('lands an id and a name written on the group on the group element', () => {
    @Component({
      selector: 'v-page-group-host',
      imports: [VToggleGroup, VToggle],
      render: compileTemplate(`
        <v-toggle-group id="alignment" class="mine" aria-label="Alignment" title="Where the text sits">
          <v-toggle value="left">L</v-toggle>
        </v-toggle-group>
      `),
    })
    class GroupHostPage {}

    const { host } = show(GroupHostPage);
    const row = group(host);
    // The element carrying the role, which is the one a label points at and a
    // screen reader names.
    expect(row.getAttribute('role')).toBe('radiogroup');
    expect(row.id).toBe('alignment');
    expect(row.classList.contains('mine')).toBe(true);
    expect(row.getAttribute('aria-label')).toBe('Alignment');
    expect(row.getAttribute('title')).toBe('Where the text sits');
    expect(host.querySelectorAll('[id="alignment"]')).toHaveLength(1);
  });

  it('keeps the ARIA a caller wrote that the primitive has no opinion of its own about', () => {
    @Component({
      selector: 'v-page-caller-aria',
      imports: [VToggleGroup, VToggle],
      render: compileTemplate(`
        <v-toggle-group :ref="row" type="multiple" label="Formatting">
          <v-toggle :ref="bold" value="bold" aria-disabled="true">B</v-toggle>
          <v-toggle value="italic">I</v-toggle>
        </v-toggle-group>
        <v-toggle :ref="lone" aria-disabled="true">Pin</v-toggle>
      `),
    })
    class CallerAriaPage {
      row: VToggleGroup | null = null;
      bold: VToggle | null = null;
      lone: VToggle | null = null;
    }

    const { instance, host } = show(CallerAriaPage);
    const [bold, italic, pin] = toggles(host);

    // Neither toggle is disabled, so each bag carries `undefined` for
    // `aria-disabled` — the primitive having nothing to say, not it saying
    // no. Spread, that is a removal, and what it removes is the caller's own.
    expect(bold!.getAttribute('aria-disabled')).toBe('true');
    expect(pin!.getAttribute('aria-disabled')).toBe('true');
    click(italic!);
    click(pin!);
    expect(bold!.getAttribute('aria-disabled')).toBe('true');
    expect(pin!.getAttribute('aria-disabled')).toBe('true');

    // The same holds of every bag this pair spreads: an entry is a value or
    // it is not there.
    const bags = [
      instance.row!.groupProps(),
      instance.row!.itemProps('italic', {}),
      instance.bold!.props(),
      instance.lone!.props(),
    ];
    for (const bag of bags) {
      expect(Object.entries(bag).filter(([, value]) => value === undefined)).toEqual([]);
    }
  });

  it('writes every state the sheet draws a toggle and the group by', () => {
    const { host } = show(Page);
    const [left, center, right] = toggles(host);

    expect(states(host)).toEqual(['on', 'off', 'off', 'off']);
    expect(left!.getAttribute('aria-checked')).toBe('true');
    expect(center!.getAttribute('aria-checked')).toBe('false');
    expect(group(host).getAttribute('data-orientation')).toBe('horizontal');
    expect(group(host).getAttribute('aria-orientation')).toBe('horizontal');

    expect(right!.getAttribute('data-disabled')).toBe('');
    expect(right!.getAttribute('aria-disabled')).toBe('true');
    // The package's rule for a disabled control: it keeps its place in the
    // accessibility tree rather than being taken out of the platform's.
    expect(right!.hasAttribute('disabled')).toBe(false);

    // One tab stop for the whole row, on the toggle that is down.
    expect(tabStops(host)).toEqual(['0', '-1', '-1', '-1']);
  });

  it('names each toggle after its label, and the group after an element already on the page', () => {
    @Component({
      selector: 'v-page-named',
      imports: [VToggleGroup, VToggle],
      render: compileTemplate(`
        <h2 id="format-heading">Formatting</h2>
        <v-toggle-group type="multiple" labelledBy="format-heading">
          <v-toggle value="bold" :label="name.get()"><b>B</b></v-toggle>
          <v-toggle value="italic" label="Italic" aria-label="Slanted"><i>I</i></v-toggle>
          <v-toggle value="code">Code</v-toggle>
        </v-toggle-group>
      `),
    })
    class NamedPage {
      name = new Signal.State('Bold');
    }

    const { instance, host } = show(NamedPage);
    expect(group(host).getAttribute('aria-labelledby')).toBe('format-heading');
    expect(group(host).hasAttribute('aria-label')).toBe(false);

    const [bold, italic, code] = toggles(host);
    expect(bold!.getAttribute('aria-label')).toBe('Bold');
    // The name of a control is as often translated, or drawn from data, as
    // it is a literal — so it is read on every render like any other prop.
    instance.name.set('Strong');
    flushSync();
    expect(bold!.getAttribute('aria-label')).toBe('Strong');

    // A name the caller wrote the platform's way wins over `label`, and the
    // spread that carries the primitive's bag does not wipe it.
    expect(italic!.getAttribute('aria-label')).toBe('Slanted');
    // An empty name is worse than none: it would override the words inside.
    expect(code!.hasAttribute('aria-label')).toBe(false);
  });

  it('follows the name the group was given, and one written in ARIA over it', () => {
    @Component({
      selector: 'v-page-group-named',
      imports: [VToggleGroup, VToggle],
      render: compileTemplate(`
        <v-toggle-group :label="name.get()" aria-describedby="hint">
          <v-toggle value="one">One</v-toggle>
        </v-toggle-group>
        <v-toggle-group label="Alignment" aria-label="Where the text sits">
          <v-toggle value="two">Two</v-toggle>
        </v-toggle-group>
        <v-toggle-group labelledBy="heading" aria-labelledby="caption">
          <v-toggle value="three">Three</v-toggle>
        </v-toggle-group>
      `),
    })
    class GroupNamedPage {
      name = new Signal.State('Alignment');
    }

    const { instance, host } = show(GroupNamedPage);
    const [first, second, third] = host.querySelectorAll('.volt-toggle-group');
    expect(first!.getAttribute('aria-label')).toBe('Alignment');
    instance.name.set('Ausrichtung');
    flushSync();
    expect(first!.getAttribute('aria-label')).toBe('Ausrichtung');
    // What the caller wrote that the group has no opinion about is left where
    // it landed, rather than taken away by a bag that said `undefined`.
    expect(first!.getAttribute('aria-describedby')).toBe('hint');

    expect(second!.getAttribute('aria-label')).toBe('Where the text sits');
    expect(third!.getAttribute('aria-labelledby')).toBe('caption');
  });

  it('follows the arrow keys, choosing as it goes, over the disabled toggle and around the ends', () => {
    const { instance, host } = show(Page);
    const [left, center, , justify] = toggles(host);

    left!.focus();
    press(left!, 'ArrowRight');
    // A radio group chooses as focus moves, which is what the pattern asks
    // for and what native radios do.
    expect(focused()).toBe('center');
    expect(instance.align.get()).toBe('center');
    expect(states(host)).toEqual(['off', 'on', 'off', 'off']);

    press(center!, 'ArrowRight');
    expect(focused()).toBe('justify');
    expect(instance.align.get()).toBe('justify');

    press(justify!, 'ArrowRight');
    expect(focused()).toBe('left');

    press(left!, 'End');
    expect(focused()).toBe('justify');
    press(justify!, 'Home');
    expect(focused()).toBe('left');

    // The tab stop followed, so Tab comes back to where the keyboard was.
    expect(tabStops(host)).toEqual(['0', '-1', '-1', '-1']);
  });

  it('moves without choosing in a group of toggle buttons', () => {
    const { instance, host } = show(MultiplePage);
    const [bold, italic] = toggles(host);

    // Several values at once is not what a radio group means, whatever else
    // is said: this is a group of buttons, pressed rather than checked.
    expect(group(host).getAttribute('role')).toBe('group');
    expect(group(host).hasAttribute('aria-orientation')).toBe(false);
    expect(bold!.getAttribute('aria-pressed')).toBe('false');
    expect(bold!.hasAttribute('aria-checked')).toBe(false);

    bold!.focus();
    press(bold!, 'ArrowRight');
    expect(focused()).toBe('italic');
    // A toolbar whose buttons applied themselves as you arrowed past would
    // be unusable, so the arrows only move here.
    expect(instance.marks.get()).toEqual([]);
    // And the tab stop moved with them, although nothing is down: Tab comes
    // back to where the keyboard was, not to the start of the row.
    expect(tabStops(host)).toEqual(['-1', '0', '-1']);

    click(italic!);
    expect(instance.marks.get()).toEqual(['italic']);
    expect(italic!.getAttribute('aria-pressed')).toBe('true');
  });

  it('holds several values, in the order they were chosen, and reports the whole list', () => {
    const { instance, host } = show(MultiplePage);
    const [bold, italic, underline] = toggles(host);

    click(underline!);
    click(bold!);
    expect(instance.marks.get()).toEqual(['underline', 'bold']);
    expect(states(host)).toEqual(['on', 'off', 'on']);
    expect(instance.seen).toEqual([['underline'], ['underline', 'bold']]);

    click(underline!);
    expect(instance.marks.get()).toEqual(['bold']);

    // The last one down lets go as readily as the others: a row of
    // formatting buttons that could not be cleared would be no use.
    click(bold!);
    expect(instance.marks.get()).toEqual([]);
    expect(instance.seen.at(-1)).toEqual([]);

    // The caller's signal on the other side too.
    instance.marks.set(['italic', 'underline']);
    flushSync();
    expect(states(host)).toEqual(['off', 'on', 'on']);
    expect(italic!.getAttribute('aria-pressed')).toBe('true');
  });

  it('says nothing is chosen with an empty string, in the page’s signal and to it', () => {
    @Component({
      selector: 'v-page-none',
      imports: [VToggleGroup, VToggle],
      render: compileTemplate(`
        <v-toggle-group :ref="box" :value="view" deselectable>
          <v-toggle value="list">List</v-toggle>
          <v-toggle value="grid">Grid</v-toggle>
        </v-toggle-group>
      `),
    })
    class NonePage {
      box: VToggleGroup | null = null;
      view = new Signal.State('');
    }

    const { instance, host } = show(NonePage);
    const [, grid] = toggles(host);
    expect(states(host)).toEqual(['off', 'off']);

    click(grid!);
    expect(instance.view.get()).toBe('grid');
    click(grid!);
    expect(instance.view.get()).toBe('');

    instance.view.set('list');
    flushSync();
    expect(states(host)).toEqual(['on', 'off']);
    // The primitive keeps the same value in its own spelling, read straight
    // through rather than copied, so it is never a flush behind the page.
    instance.view.set('');
    expect(instance.box!.toggleGroup.value()).toBeNull();
    instance.view.set('grid');
    expect(instance.box!.toggleGroup.value()).toBe('grid');
    flushSync();
    expect(states(host)).toEqual(['off', 'on']);
  });

  it('is a row of buttons when the value may go back to none', () => {
    const { instance, host } = show(DeselectablePage);
    const [list, grid] = toggles(host);

    expect(group(host).getAttribute('role')).toBe('group');
    expect(list!.getAttribute('role')).toBe('button');
    expect(list!.getAttribute('aria-pressed')).toBe('false');
    // Nothing chosen to start with: the tab stop falls to the first toggle,
    // or Tab could not reach the group at all.
    expect(tabStops(host)).toEqual(['0', '-1', '-1']);

    click(grid!);
    expect(states(host)).toEqual(['off', 'on', 'off']);
    expect(instance.seen).toEqual(['grid']);
    // The tab stop follows use, so Tab comes back to the toggle last pressed.
    expect(tabStops(host)).toEqual(['-1', '0', '-1']);

    // Pressed again, the chosen toggle comes up and the group holds nothing,
    // which a single value says as the empty string.
    click(grid!);
    expect(states(host)).toEqual(['off', 'off', 'off']);
    expect(instance.seen).toEqual(['grid', '']);
  });

  it('keeps one tab stop through disable, enable and clear', async () => {
    @Component({
      selector: 'v-page-kept-stop',
      imports: [VToggleGroup, VToggle],
      render: compileTemplate(`
        <v-toggle-group :value="view" deselectable :disabled="off.get()" label="View">
          <v-toggle value="list">List</v-toggle>
          <v-toggle value="grid" :disabled="lone.get()">Grid</v-toggle>
          <v-toggle value="map">Map</v-toggle>
        </v-toggle-group>
      `),
    })
    class Page {
      view = new Signal.State('grid');
      // Off from the start, the usual shape of a toolbar waiting on a load.
      off = new Signal.State(true);
      lone = new Signal.State(false);
    }

    const { instance, host } = show(Page);
    // Out of use, a toggle group keeps its one way in, on the toggle that is
    // down — the package's rule for a disabled control.
    expect(tabStops(host)).toEqual(['-1', '0', '-1']);

    instance.off.set(false);
    flushSync();
    expect(tabStops(host)).toEqual(['-1', '0', '-1']);

    instance.view.set('');
    flushSync();
    expect(tabStops(host)).toEqual(['0', '-1', '-1']);

    instance.off.set(true);
    flushSync();
    instance.off.set(false);
    flushSync();
    expect(tabStops(host)).toEqual(['0', '-1', '-1']);

    // The toggle that is down, switched off on its own, hands the stop on.
    instance.view.set('grid');
    flushSync();
    instance.lone.set(true);
    flushSync();
    await settle();
    expect(tabStops(host)).toEqual(['0', '-1', '-1']);
    instance.lone.set(false);
    flushSync();
    await settle();
    expect(tabStops(host).filter((stop) => stop === '0')).toHaveLength(1);
  });

  it('refuses to clear the last value unless told it may', () => {
    const { instance, host } = show(Page);
    const [left] = toggles(host);

    click(left!);
    expect(instance.align.get()).toBe('left');
    expect(left!.getAttribute('aria-checked')).toBe('true');
  });

  it('takes `deselectable="false"` at its word', () => {
    @Component({
      selector: 'v-page-kept',
      imports: [VToggleGroup, VToggle],
      render: compileTemplate(`
        <v-toggle-group deselectable="false" defaultValue="one">
          <v-toggle value="one">One</v-toggle>
          <v-toggle value="two">Two</v-toggle>
        </v-toggle-group>
      `),
    })
    class KeptPage {}

    const { host } = show(KeptPage);
    // An attribute is a string, and `"false"` is not a way of saying yes.
    expect(group(host).getAttribute('role')).toBe('radiogroup');
    click(toggles(host)[0]!);
    expect(states(host)).toEqual(['on', 'off']);
  });

  it('refuses a disabled toggle, and takes the refusal back when the signal does', () => {
    const { instance, host } = show(Page);
    const right = toggles(host)[2]!;

    click(right);
    expect(instance.align.get()).toBe('left');

    instance.off.set(false);
    flushSync();
    expect(right.hasAttribute('data-disabled')).toBe(false);
    expect(right.hasAttribute('aria-disabled')).toBe(false);

    click(right);
    expect(instance.align.get()).toBe('right');
    expect(right.getAttribute('data-state')).toBe('on');
  });

  it('reads `disabled` written as an attribute the same way inside a group as outside one', () => {
    @Component({
      selector: 'v-page-disabled-words',
      imports: [VToggleGroup, VToggle],
      render: compileTemplate(`
        <v-toggle-group :value="view" deselectable>
          <v-toggle value="list" disabled="disabled">List</v-toggle>
          <v-toggle value="grid">Grid</v-toggle>
          <v-toggle value="map" disabled="true">Map</v-toggle>
        </v-toggle-group>
        <v-toggle-group :ref="row" disabled="disabled">
          <v-toggle value="one">One</v-toggle>
        </v-toggle-group>
        <v-toggle :ref="lone" disabled="disabled">Pin</v-toggle>
      `),
    })
    class DisabledWordsPage {
      view = new Signal.State('');
      row: VToggleGroup | null = null;
      lone: VToggle | null = null;
    }

    const { instance, host } = show(DisabledWordsPage);
    const [list, grid, map, one, pin] = toggles(host);

    // An attribute is a string, and `disabled="disabled"` is how HTML has
    // always written the flag. A toggle in a group is refused by it exactly
    // as a toggle on its own is, and as a group is.
    for (const toggle of [list!, map!, one!, pin!]) {
      expect(toggle.getAttribute('aria-disabled'), toggle.textContent!).toBe('true');
      expect(toggle.hasAttribute('data-disabled'), toggle.textContent!).toBe(true);
    }
    expect(grid!.hasAttribute('aria-disabled')).toBe(false);

    click(list!);
    click(map!);
    expect(instance.view.get()).toBe('');
    // Stepped over by the arrows, and never the tab stop.
    expect(tabStops(host).slice(0, 3)).toEqual(['-1', '0', '-1']);
    grid!.focus();
    press(grid!, 'ArrowRight');
    expect(focused()).toBe('grid');

    // And each primitive is told a flag, not the string that was written.
    expect(instance.row!.toggleGroup.isDisabled()).toBe(true);
    expect(instance.lone!.toggle!.isDisabled()).toBe(true);
  });

  it('refuses every toggle while the group is disabled, and says so on each', () => {
    @Component({
      selector: 'v-page-off',
      imports: [VToggleGroup, VToggle],
      render: compileTemplate(`
        <v-toggle-group :disabled="off.get()" defaultValue="one">
          <v-toggle value="one">One</v-toggle>
          <v-toggle value="two">Two</v-toggle>
        </v-toggle-group>
      `),
    })
    class OffPage {
      off = new Signal.State(true);
    }

    const { instance, host } = show(OffPage);
    const [one, two] = toggles(host);

    expect(group(host).getAttribute('aria-disabled')).toBe('true');
    expect(group(host).getAttribute('data-disabled')).toBe('');
    expect(toggles(host).every((toggle) => toggle.getAttribute('data-disabled') === '')).toBe(true);
    // A disabled group keeps its one way in, as a disabled checkbox keeps its
    // tab stop: it is discoverable, and refuses the press.
    expect(tabStops(host)).toEqual(['0', '-1']);

    click(two!);
    expect(states(host)).toEqual(['on', 'off']);

    one!.focus();
    press(one!, 'ArrowRight');
    expect(focused()).toBe('one');

    instance.off.set(false);
    flushSync();
    expect(group(host).hasAttribute('aria-disabled')).toBe(false);
    expect(group(host).hasAttribute('data-disabled')).toBe(false);
    expect(two!.hasAttribute('data-disabled')).toBe(false);

    click(two!);
    expect(states(host)).toEqual(['off', 'on']);
  });

  it('is the caller’s signal on both sides', () => {
    const { instance, host } = show(Page);

    instance.align.set('justify');
    flushSync();
    expect(states(host)).toEqual(['off', 'off', 'off', 'on']);
    // The tab stop moves with the value: Tab arrives at what is in effect.
    expect(tabStops(host)).toEqual(['-1', '-1', '-1', '0']);

    click(toggles(host)[1]!);
    expect(instance.align.get()).toBe('center');
  });

  it('starts where the caller defaulted to, and keeps quiet about it', () => {
    @Component({
      selector: 'v-page-default',
      imports: [VToggleGroup, VToggle],
      render: compileTemplate(`
        <v-toggle-group defaultValue="two" :onValueChange="heard">
          <v-toggle value="one">One</v-toggle>
          <v-toggle value="two">Two</v-toggle>
          <v-toggle value="three">Three</v-toggle>
        </v-toggle-group>
        <v-toggle-group type="multiple" :defaultValue="['b', 'c']">
          <v-toggle value="a">A</v-toggle>
          <v-toggle value="b">B</v-toggle>
          <v-toggle value="c">C</v-toggle>
        </v-toggle-group>
      `),
    })
    class DefaultPage {
      seen: string[] = [];
      heard = (value: string): void => {
        this.seen.push(value);
      };
    }

    const { instance, host } = show(DefaultPage);
    expect(states(host)).toEqual(['off', 'on', 'off', 'off', 'on', 'on']);
    expect(tabStops(host)).toEqual(['-1', '0', '-1', '-1', '0', '-1']);
    // A default is nobody's choice, so an application saving the value on
    // change does not record a write no user made.
    expect(instance.seen).toEqual([]);
  });

  it('takes a default in whichever shape the tag could write it', () => {
    @Component({
      selector: 'v-page-default-shapes',
      imports: [VToggleGroup, VToggle],
      render: compileTemplate(`
        <v-toggle-group :ref="written" type="multiple" defaultValue="bold">
          <v-toggle value="italic">I</v-toggle>
          <v-toggle value="bold">B</v-toggle>
        </v-toggle-group>
        <v-toggle-group :ref="empty" type="multiple" defaultValue="">
          <v-toggle value="c">C</v-toggle>
        </v-toggle-group>
        <v-toggle-group :ref="listed" :defaultValue="['e']">
          <v-toggle value="d">D</v-toggle>
          <v-toggle value="e">E</v-toggle>
        </v-toggle-group>
      `),
    })
    class DefaultShapesPage {
      written: VToggleGroup | null = null;
      empty: VToggleGroup | null = null;
      listed: VToggleGroup | null = null;
    }

    const { instance, host } = show(DefaultShapesPage);
    // An attribute can only write a string, so a multiple group takes one as
    // the list of one it means — and the empty string as nothing at all,
    // rather than as a value no toggle has.
    expect(instance.written!.toggleGroup.value()).toEqual(['bold']);
    expect(instance.empty!.toggleGroup.value()).toEqual([]);
    // A single group handed a list starts at the first value in it.
    expect(instance.listed!.toggleGroup.value()).toBe('e');
    expect(states(host)).toEqual(['off', 'on', 'off', 'off', 'on']);
  });

  it('reports the values a user chose through the group’s own primitive', () => {
    @Component({
      selector: 'v-page-ref',
      imports: [VToggleGroup, VToggle],
      render: compileTemplate(`
        <v-toggle-group :ref="box" :onValueChange="heard">
          <v-toggle value="one">One</v-toggle>
          <v-toggle value="two">Two</v-toggle>
        </v-toggle-group>
      `),
    })
    class RefPage {
      box: VToggleGroup | null = null;
      seen: string[] = [];
      heard = (value: string): void => {
        this.seen.push(value);
      };
    }

    const { instance, host } = show(RefPage);
    expect(instance.box?.toggleGroup.value()).toBeNull();

    // The primitive itself, for whoever needs more than the tag offers.
    instance.box!.toggleGroup.select('two');
    flushSync();
    expect(instance.box!.toggleGroup.isSelected('two')).toBe(true);
    expect(states(host)).toEqual(['off', 'on']);
    expect(instance.seen).toEqual(['two']);

    // And the toggles it was written with, in the order they are drawn.
    expect(instance.box!.toggles.all.get().map((toggle) => toggle.value.get())).toEqual([
      'one',
      'two',
    ]);
  });

  it('turns the axis over to the group', () => {
    @Component({
      selector: 'v-page-vertical',
      imports: [VToggleGroup, VToggle],
      render: compileTemplate(`
        <v-toggle-group orientation="vertical" deselectable>
          <v-toggle value="one">One</v-toggle>
          <v-toggle value="two">Two</v-toggle>
        </v-toggle-group>
        <v-toggle-group orientation="vertical" label="Size">
          <v-toggle value="s">S</v-toggle>
          <v-toggle value="m">M</v-toggle>
        </v-toggle-group>
      `),
    })
    class VerticalPage {}

    const { host } = show(VerticalPage);
    const [buttons, radios] = host.querySelectorAll('.volt-toggle-group');
    const [one] = toggles(host);
    expect(buttons!.getAttribute('data-orientation')).toBe('vertical');

    one!.focus();
    // A row of separate buttons owns only its own axis.
    press(one!, 'ArrowRight');
    expect(focused()).toBe('one');
    press(one!, 'ArrowDown');
    expect(focused()).toBe('two');

    // A group that must keep a value is one control, and says which way it
    // runs — which a group of buttons has no attribute for.
    expect(radios!.getAttribute('data-orientation')).toBe('vertical');
    expect(radios!.getAttribute('aria-orientation')).toBe('vertical');
  });

  it('reads a flag bound to nothing as the default it was left at', () => {
    @Component({
      selector: 'v-page-unset',
      imports: [VToggleGroup, VToggle],
      render: compileTemplate(`
        <v-toggle-group :loop="settings.loop" :deselectable="settings.deselectable">
          <v-toggle value="one">One</v-toggle>
          <v-toggle value="two">Two</v-toggle>
        </v-toggle-group>
        <v-toggle-group :loop="none" :deselectable="none">
          <v-toggle value="three">Three</v-toggle>
          <v-toggle value="four">Four</v-toggle>
        </v-toggle-group>
      `),
    })
    class UnsetPage {
      /** Options a page passes through without having set every one. */
      settings: { loop?: boolean; deselectable?: boolean } = {};
      none = null;
    }

    const { host } = show(UnsetPage);
    const [one, , three] = toggles(host);
    const [first, second] = host.querySelectorAll('.volt-toggle-group');

    // Nothing said is no opinion, and the opinion is the default's: a group
    // that wraps, and that keeps its one value.
    expect(first!.getAttribute('role')).toBe('radiogroup');
    expect(second!.getAttribute('role')).toBe('radiogroup');
    one!.focus();
    press(one!, 'ArrowLeft');
    expect(focused()).toBe('two');
    three!.focus();
    press(three!, 'ArrowLeft');
    expect(focused()).toBe('four');
  });

  it('stops at the ends when the caller turned looping off', () => {
    @Component({
      selector: 'v-page-ends',
      imports: [VToggleGroup, VToggle],
      render: compileTemplate(`
        <v-toggle-group loop="false" deselectable>
          <v-toggle value="one">One</v-toggle>
          <v-toggle value="two">Two</v-toggle>
        </v-toggle-group>
      `),
    })
    class EndsPage {}

    const { host } = show(EndsPage);
    const [one, two] = toggles(host);

    one!.focus();
    press(one!, 'ArrowLeft');
    expect(focused()).toBe('one');
    press(one!, 'ArrowRight');
    expect(focused()).toBe('two');
    press(two!, 'ArrowRight');
    expect(focused()).toBe('two');
  });

  it('takes toggles that arrive later, and keeps them in the order they are drawn', async () => {
    @Component({
      selector: 'v-page-grown',
      imports: [VToggleGroup, VToggle],
      render: compileTemplate(`
        <v-toggle-group :ref="box" deselectable>
          <v-toggle value="first">First</v-toggle>
          <v-toggle :for="name in extra.get()" :key="name" :value="name">{ name }</v-toggle>
          <v-toggle value="last">Last</v-toggle>
        </v-toggle-group>
      `),
    })
    class GrownPage {
      box: VToggleGroup | null = null;
      extra = new Signal.State<string[]>([]);
    }

    const { instance, host } = show(GrownPage);
    instance.extra.set(['middle']);
    flushSync();
    await settle();

    // A toggle that registers last is not a toggle that is drawn last.
    expect(toggles(host).map((toggle) => toggle.textContent)).toEqual(['First', 'middle', 'Last']);
    expect(instance.box!.toggles.all.get().map((toggle) => toggle.value.get())).toEqual([
      'first',
      'middle',
      'last',
    ]);
    // And the arrows reach it, which is the group having heard about it.
    toggles(host)[0]!.focus();
    press(toggles(host)[0]!, 'ArrowRight');
    expect(focused()).toBe('middle');
  });

  it('refuses two toggles with one value, written so or arriving so', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const twins = (): unknown[] =>
      error.mock.calls.filter((call) =>
        call.some((part) => /Two <v-toggle> tags in one <v-toggle-group>/.test(String(part))),
      );

    @Component({
      selector: 'v-page-twins',
      imports: [VToggleGroup, VToggle],
      render: compileTemplate(`
        <v-toggle-group>
          <v-toggle value="one">One</v-toggle>
          <v-toggle value="one">Uno</v-toggle>
        </v-toggle-group>
      `),
    })
    class TwinsPage {}

    show(TwinsPage);
    expect(twins()).toHaveLength(1);
    unmount?.();
    unmount = null;
    error.mockClear();

    // One that arrives later with a value already taken is the same mistake.
    @Component({
      selector: 'v-page-late-twin',
      imports: [VToggleGroup, VToggle],
      render: compileTemplate(`
        <v-toggle-group deselectable>
          <v-toggle value="one">One</v-toggle>
          <v-toggle :for="name in extra.get()" :key="name" :value="name">{ name }</v-toggle>
        </v-toggle-group>
      `),
    })
    class LateTwinPage {
      extra = new Signal.State<string[]>([]);
    }

    const { instance } = show(LateTwinPage);
    expect(twins()).toHaveLength(0);
    instance.extra.set(['one']);
    flushSync();
    await settle();
    expect(twins()).toHaveLength(1);
  });

  it('takes a fresh list of the same toggles without calling them twins', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    // The list a page holds is replaced whenever it is fetched again, and a
    // `:for` keyed on the rows themselves draws every row anew — each new
    // toggle built while the one it replaces is still there. That is not two
    // toggles with one value, and nothing may say it is.
    @Component({
      selector: 'v-page-refetched',
      imports: [VToggleGroup, VToggle],
      render: compileTemplate(`
        <v-toggle-group :value="view" deselectable>
          <v-toggle :for="option in options.get()" :key="option" :value="option.value">{ option.text }</v-toggle>
        </v-toggle-group>
      `),
    })
    class RefetchedPage {
      view = new Signal.State('grid');
      options = new Signal.State([
        { value: 'list', text: 'List' },
        { value: 'grid', text: 'Grid' },
      ]);
    }

    const { instance, host } = show(RefetchedPage);
    instance.options.set([
      { value: 'list', text: 'Rows' },
      { value: 'grid', text: 'Tiles' },
    ]);
    flushSync();
    await settle();

    expect(error).not.toHaveBeenCalled();
    expect(toggles(host).map((toggle) => toggle.textContent)).toEqual(['Rows', 'Tiles']);
    expect(states(host)).toEqual(['off', 'on']);
    click(toggles(host)[0]!);
    expect(instance.view.get()).toBe('list');
  });

  it('refuses a value of the wrong shape for its type', () => {
    @Component({
      selector: 'v-page-list-for-one',
      imports: [VToggleGroup, VToggle],
      render: compileTemplate(`
        <v-toggle-group :value="marks">
          <v-toggle value="bold">B</v-toggle>
        </v-toggle-group>
      `),
    })
    class ListForOnePage {
      marks = new Signal.State<string[]>([]);
    }

    @Component({
      selector: 'v-page-one-for-list',
      imports: [VToggleGroup, VToggle],
      render: compileTemplate(`
        <v-toggle-group type="multiple" :value="mark">
          <v-toggle value="bold">B</v-toggle>
        </v-toggle-group>
      `),
    })
    class OneForListPage {
      mark = new Signal.State('bold');
    }

    // Forgetting `type="multiple"` would otherwise draw nothing pressed and
    // write a string into the page's list on the first press.
    expect(() => show(ListForOnePage)).toThrow(/Write type="multiple"/);
    document.body.innerHTML = '';
    expect(() => show(OneForListPage)).toThrow(/pass a Signal.State<string\[\]>/);
  });
});

describe('v-toggle', () => {
  it('is a toggle button of its own outside a group', () => {
    const { instance, host } = show(LonePage);
    const button = host.querySelector<HTMLButtonElement>('.volt-toggle')!;

    expect(button.getAttribute('role')).toBe('button');
    expect(button.type).toBe('button');
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(button.getAttribute('data-state')).toBe('off');
    expect(button.textContent?.trim()).toBe('Wrap lines');
    // What the caller wrote lands on the button, beside the sheet's class.
    expect([...button.classList].sort()).toEqual(['mine', 'volt-toggle']);
    // Reachable by Tab like any button, and not inside a group's marks.
    expect(button.getAttribute('tabindex')).toBe('0');
    expect(button.hasAttribute('data-volt-item')).toBe(false);

    click(button);
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(button.getAttribute('data-state')).toBe('on');
    expect(instance.wrapping.get()).toBe(true);
    expect(instance.seen).toEqual([true]);

    // The caller's signal on the other side too.
    instance.wrapping.set(false);
    flushSync();
    expect(button.getAttribute('data-state')).toBe('off');
    expect(instance.seen).toEqual([true]);
  });

  it('refuses the press while disabled, and stays where a keyboard can find it', () => {
    const { instance, host } = show(LonePage);
    const button = host.querySelector<HTMLButtonElement>('.volt-toggle')!;

    instance.off.set(true);
    flushSync();
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.getAttribute('data-disabled')).toBe('');
    expect(button.disabled).toBe(false);
    expect(button.getAttribute('tabindex')).toBe('0');

    click(button);
    expect(instance.wrapping.get()).toBe(false);
    expect(instance.seen).toEqual([]);

    instance.off.set(false);
    flushSync();
    click(button);
    expect(instance.wrapping.get()).toBe(true);
  });

  it('starts down when told to, is named by its label, and hands over its primitive', () => {
    @Component({
      selector: 'v-page-lone-default',
      imports: [VToggle],
      render: compileTemplate(`
        <v-toggle :ref="box" defaultPressed :label="muted.get() ? 'Unmute' : 'Mute'"
                  :onPressedChange="heard">M</v-toggle>
        <v-toggle defaultPressed="false" aria-label="Pin">P</v-toggle>
        <v-toggle>Plain</v-toggle>
      `),
    })
    class LoneDefaultPage {
      box: VToggle | null = null;
      muted = new Signal.State(true);
      seen: boolean[] = [];
      heard = (pressed: boolean): void => {
        this.seen.push(pressed);
        this.muted.set(pressed);
      };
    }

    const { instance, host } = show(LoneDefaultPage);
    const [mute, pin, plain] = toggles(host);
    // Up unless told otherwise.
    expect(plain!.getAttribute('aria-pressed')).toBe('false');

    expect(mute!.getAttribute('aria-pressed')).toBe('true');
    expect(mute!.getAttribute('aria-label')).toBe('Unmute');
    // A default is nobody's choice.
    expect(instance.seen).toEqual([]);

    // The name follows the state through the signal it was bound to.
    click(mute!);
    expect(mute!.getAttribute('aria-pressed')).toBe('false');
    expect(mute!.getAttribute('aria-label')).toBe('Mute');
    expect(instance.seen).toEqual([false]);

    // `"false"` written as an attribute is the false it says.
    expect(pin!.getAttribute('aria-pressed')).toBe('false');
    // A name written the platform's way survives the spread beside it.
    expect(pin!.getAttribute('aria-label')).toBe('Pin');

    // The primitive itself, for whoever needs more than the tag offers — and
    // no group to speak of.
    expect(instance.box!.group).toBeNull();
    instance.box!.toggle!.press();
    flushSync();
    expect(mute!.getAttribute('data-state')).toBe('on');
    expect(instance.box!.toggle!.isPressed()).toBe(true);
  });

  it('has no primitive of its own inside a group, where the group holds the state', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    @Component({
      selector: 'v-page-member',
      imports: [VToggleGroup, VToggle],
      render: compileTemplate(`
        <v-toggle-group :ref="row">
          <v-toggle :ref="box" value="one" :pressed="ignored">One</v-toggle>
          <v-toggle value="two" defaultPressed :onPressedChange="heard">Two</v-toggle>
          <v-toggle value="three" defaultPressed="false">Three</v-toggle>
        </v-toggle-group>
      `),
    })
    class MemberPage {
      row: VToggleGroup | null = null;
      box: VToggle | null = null;
      ignored = new Signal.State(true);
      heard = (): void => {};
    }

    const { instance, host } = show(MemberPage);
    expect(instance.box!.toggle).toBeNull();
    expect(instance.box!.group).toBe(instance.row);
    // The state is the group's: a `pressed` written on a member is unread,
    // and a development build says so rather than leaving it to be found.
    expect(states(host)).toEqual(['off', 'off', 'off']);
    // Every one of the three is named, and a flag that says no is not one of
    // them: `defaultPressed="false"` asks for what a member is anyway.
    expect(warn).toHaveBeenCalledTimes(2);
    expect(String(warn.mock.calls[0]![0])).toMatch(/<v-toggle value="one"> was given pressed,/);
    expect(String(warn.mock.calls[1]![0])).toMatch(
      /<v-toggle value="two"> was given defaultPressed and onPressedChange,/,
    );
  });

  it('refuses a toggle inside a group that has no value', () => {
    @Component({
      selector: 'v-page-valueless',
      imports: [VToggleGroup, VToggle],
      render: compileTemplate(`
        <v-toggle-group>
          <v-toggle>Bold</v-toggle>
        </v-toggle-group>
      `),
    })
    class ValuelessPage {}

    expect(() => show(ValuelessPage)).toThrow(/inside a <v-toggle-group> needs a value/);
  });
});

/**
 * The sheet's rules for the row, held against the markup these two tags draw.
 * The rest of the sheet is held against the primitive in `primitives.test.ts`;
 * what that cannot see is which corners a segment keeps, which depends on
 * how many toggles the component put in the row.
 */
describe('the segmented row', () => {
  /** Every side and corner a rule names, in the physical spelling. */
  const PHYSICAL = /(^|-)(left|right|top|bottom)(-|$)/;

  const corners = (el: Element): string[] => {
    const style = getComputedStyle(el);
    return ['start-start', 'start-end', 'end-start', 'end-end'].map((corner) =>
      style.getPropertyValue(`border-${corner}-radius`),
    );
  };

  function withSheet(run: () => void): void {
    const style = document.createElement('style');
    style.textContent = `${tokensCss()}\n${rulesToCss(toggleGroupStyles.rules)}`;
    document.head.append(style);
    try {
      run();
    } finally {
      style.remove();
    }
  }

  it('names no physical side, so a page written right to left mirrors it', () => {
    const rules = [...toggleGroupStyles.rules, ...toggleGroupStyles.forcedColors];
    const physical = rules.flatMap((rule) =>
      Object.keys(rule.declarations)
        .filter((property) => PHYSICAL.test(property))
        .map((property) => `${rule.selector} { ${property} }`),
    );
    expect(physical).toEqual([]);
  });

  it('rounds only the ends of a row, and every corner of a group of one', () => {
    @Component({
      selector: 'v-page-corners',
      imports: [VToggleGroup, VToggle],
      render: compileTemplate(`
        <v-toggle-group label="Three">
          <v-toggle value="a">A</v-toggle>
          <v-toggle value="b">B</v-toggle>
          <v-toggle value="c">C</v-toggle>
        </v-toggle-group>
        <v-toggle-group label="One">
          <v-toggle value="only">Only</v-toggle>
        </v-toggle-group>
        <v-toggle>Alone</v-toggle>
      `),
    })
    class CornersPage {}

    withSheet(() => {
      const { host } = show(CornersPage);
      const [first, middle, last, only, alone] = toggles(host);
      const round = '0.25rem';

      expect(corners(first!)).toEqual([round, '0', round, '0']);
      expect(corners(middle!)).toEqual(['0', '0', '0', '0']);
      expect(corners(last!)).toEqual(['0', round, '0', round]);
      // First and last at once, which is where a rule writing all four
      // corners for each end would leave only one end rounded.
      expect(corners(only!)).toEqual([round, round, round, round]);
      expect(corners(alone!)).toEqual([round, round, round, round]);

      // Each segment after the first steps back over its neighbour's edge,
      // so the two draw one line between them.
      expect(getComputedStyle(first!).getPropertyValue('margin-inline-start')).toBe('0');
      expect(getComputedStyle(middle!).getPropertyValue('margin-inline-start')).not.toBe('0');
    });
  });

  it('raises a toggle that is down over its neighbours, and one with focus over that', () => {
    withSheet(() => {
      const { host } = show(Page);
      const [left, center, , justify] = toggles(host);
      expect(getComputedStyle(left!).getPropertyValue('z-index')).toBe('1');
      // Unset, which happy-dom reports as nothing where a browser says `auto`.
      expect(['', 'auto']).toContain(getComputedStyle(center!).getPropertyValue('z-index'));
      // Above a toggle that is down, or the ring would be drawn beneath it.
      // One not measured yet, since happy-dom keeps a computed style it has
      // already handed out across a change of focus.
      justify!.focus();
      expect(getComputedStyle(justify!).getPropertyValue('z-index')).toBe('2');
      // The row is a stacking context of its own, so raising a segment never
      // lifts it over the page around the group.
      expect(getComputedStyle(group(host)).getPropertyValue('isolation')).toBe('isolate');
    });
  });

  it('fills a toggle that is down, edges it to match, and keeps every segment whole', () => {
    withSheet(() => {
      const { host } = show(Page);
      const [left, center] = toggles(host);
      const down = getComputedStyle(left!);
      const up = getComputedStyle(center!);
      const edges = (style: CSSStyleDeclaration): string[] =>
        ['block-start', 'block-end', 'inline-start', 'inline-end'].map((edge) =>
          style.getPropertyValue(`border-${edge}-color`),
        );

      // Down is a fill, not only a heavier word: the row's choice reads at a
      // glance, as a segmented control's does.
      expect(down.getPropertyValue('background-color')).not.toBe(
        up.getPropertyValue('background-color'),
      );
      // Its edge is the fill's own colour, so a raised segment is one block
      // rather than a filled box inside a grey frame.
      expect(edges(down)).toEqual(Array(4).fill(down.getPropertyValue('background-color')));

      // Every segment as tall as the tallest, so the shared edges meet; and
      // none squeezed narrower than its words when the row runs short of room.
      expect(getComputedStyle(group(host)).getPropertyValue('align-items')).toBe('stretch');
      expect(up.getPropertyValue('flex-shrink')).toBe('0');
    });
  });

  it('stacks a vertical group, and shares the block edge between its segments', () => {
    @Component({
      selector: 'v-page-column',
      imports: [VToggleGroup, VToggle],
      render: compileTemplate(`
        <v-toggle-group label="Row">
          <v-toggle value="a">A</v-toggle>
          <v-toggle value="b">B</v-toggle>
        </v-toggle-group>
        <v-toggle-group orientation="vertical" label="Column">
          <v-toggle value="c">C</v-toggle>
          <v-toggle value="d">D</v-toggle>
        </v-toggle-group>
      `),
    })
    class ColumnPage {}

    withSheet(() => {
      const { host } = show(ColumnPage);
      const [row, column] = host.querySelectorAll('.volt-toggle-group');
      const [, , c, d] = toggles(host);
      expect(getComputedStyle(row!).getPropertyValue('flex-direction')).toBe('row');
      expect(getComputedStyle(column!).getPropertyValue('flex-direction')).toBe('column');
      // Stacked, the line two segments share is the one between their blocks.
      expect(getComputedStyle(c!).getPropertyValue('margin-block-start')).toBe('0');
      expect(getComputedStyle(d!).getPropertyValue('margin-block-start')).not.toBe('0');
      expect(getComputedStyle(d!).getPropertyValue('margin-inline-start')).toBe('0');
      expect(corners(c!)).toEqual(['0.25rem', '0.25rem', '0', '0']);
      expect(corners(d!)).toEqual(['0', '0', '0.25rem', '0.25rem']);
    });
  });

  it('gives every rule an element of what the two tags render to select', () => {
    @Component({
      selector: 'v-page-every-rule',
      imports: [VToggleGroup, VToggle],
      render: compileTemplate(`
        <v-toggle-group label="Alignment" defaultValue="b">
          <v-toggle value="a">A</v-toggle>
          <v-toggle value="b">B</v-toggle>
          <v-toggle value="c" disabled>C</v-toggle>
        </v-toggle-group>
        <v-toggle-group type="multiple" orientation="vertical" :defaultValue="['x']" disabled>
          <v-toggle value="x">X</v-toggle>
          <v-toggle value="y">Y</v-toggle>
        </v-toggle-group>
        <v-toggle defaultPressed>Wrap</v-toggle>
      `),
    })
    class EveryRulePage {}

    // The scene in `primitives.test.ts` draws the primitive's markup by hand;
    // this is the markup the components themselves write. The pointer and
    // focus are the browser's to add, so only what is written is asked about.
    const { host } = show(EveryRulePage);
    const selectors = [...toggleGroupStyles.rules, ...toggleGroupStyles.forcedColors].map(
      (rule) => rule.selector.replaceAll(':hover', '').replaceAll(':focus-visible', ''),
    );
    expect(selectors.filter((selector) => host.querySelector(selector) === null)).toEqual([]);
  });
});

/**
 * The cascade a forced palette leaves, measured rather than read: the pairs in
 * `forced-colors.test.ts` ask only whether two states still differ, and a
 * difference happy-dom invents — an `opacity` it reports as nothing on one
 * side and `1` on the other — is enough to satisfy them. What a user is shown
 * is asked here: which colour each state is, from the palette's own names.
 */
describe('the toggles, once the palette is the user’s', () => {
  const forced = styledDocument({ forcedColors: true });
  afterAll(() => forced.close());

  /** The sheet as `harness.ts` installs it: system colours as stand-ins, the pointer as an attribute. */
  const asTested = (rules: readonly Rule[]): Rule[] =>
    rules.map((rule) => ({
      selector: rule.selector.replaceAll(':hover', '[data-hover]'),
      declarations: Object.fromEntries(
        Object.entries(rule.declarations).map(([property, value]) => [
          property,
          SYSTEM_COLORS.includes(value) ? standIn(value) : value,
        ]),
      ),
    }));

  beforeAll(() => {
    forced.addConsumerCss(
      `${rulesToCss(asTested(toggleGroupStyles.rules))}\n` +
        wrap(FORCED_COLORS_QUERY, rulesToCss(asTested(toggleGroupStyles.forcedColors), '  ')),
    );
  });

  const look = (attributes: Record<string, string>, focus = false) => {
    const button = forced.mount({ tag: 'button', classes: ['volt-toggle'], attributes, focus });
    // Computed in the document it was mounted into, which is the forced one.
    const style = button.ownerDocument.defaultView!.getComputedStyle(button);
    const read = (property: string): string => style.getPropertyValue(property);
    return {
      fill: read('background-color'),
      text: read('color'),
      weight: read('font-weight'),
      ring: read('outline-color'),
      opacity: read('opacity'),
      adjust: read('forced-color-adjust'),
      edges: ['block-start', 'block-end', 'inline-start', 'inline-end'].map((edge) =>
        read(`border-${edge}-color`),
      ),
    };
  };

  const UP = { 'data-state': 'off' };
  const DOWN = { 'data-state': 'on' };
  const OFF = { 'data-disabled': '' };

  it('draws a toggle that is down in the pair the palette keeps for a selection', () => {
    const up = look(UP);
    const down = look(DOWN);
    expect(up.fill).toBe(standIn('ButtonFace'));
    expect(up.text).toBe(standIn('ButtonText'));
    expect(down.fill).toBe(standIn('Highlight'));
    expect(down.text).toBe(standIn('HighlightText'));
    // The pointer over it takes none of that away.
    expect(look({ ...DOWN, 'data-hover': '' }).fill).toBe(standIn('Highlight'));
    // And the weight, which no palette touches, says it too.
    expect(down.weight).not.toBe(up.weight);
  });

  it('keeps the words on a toggle that is down from being painted over', () => {
    // Under a forced palette Chrome paints a backplate of `Canvas` behind
    // every run of text, so that words stay legible over a picture. On a
    // `Highlight` fill that backplate is a box in the page's own colour, and
    // `HighlightText` on it is that same colour in the dark scheme and the
    // light one alike: the toggle that is down says which it is and no longer
    // what it is. Opting out hands back the backplate, and with it the words.
    // happy-dom paints nothing, so what is asked is the opt-out itself.
    expect(look(DOWN).adjust).toBe('none');
    expect(look({ ...DOWN, 'data-hover': '' }).adjust).toBe('none');
    // A toggle that is up stays under the palette, which chooses its colours.
    expect(look(UP).adjust).not.toBe('none');
  });

  it('names every colour a toggle that is down paints from the palette', () => {
    // Out from under the palette, nothing replaces a colour the forced rules
    // forget: the brand's focus ring, or its hover fill, would be drawn as it
    // is, on `Highlight`, in a palette the user chose so that it would not be.
    const palette = new Set(SYSTEM_COLORS.map(standIn));
    const shapes = {
      down: look(DOWN),
      hovered: look({ ...DOWN, 'data-hover': '' }),
      unavailable: look({ ...DOWN, ...OFF }),
    };
    for (const [name, shape] of Object.entries(shapes)) {
      for (const colour of [shape.fill, shape.text, ...shape.edges]) {
        expect(palette, `${name}: ${colour}`).toContain(colour);
      }
    }
    const focused = look(DOWN, true);
    expect(focused.ring).toBe(standIn('Highlight'));
  });

  it('draws an unavailable toggle in `GrayText`, down or up', () => {
    expect(look({ ...UP, ...OFF }).text).toBe(standIn('GrayText'));
    // Undimmed: `GrayText` is the palette's own word for unavailable, and
    // fading it as well only takes contrast from a palette chosen for it.
    expect(look({ ...UP, ...OFF }).opacity).toBe('1');
    expect(look({ ...DOWN, ...OFF }).opacity).toBe('1');

    // Down and unavailable: `GrayText` on `Highlight` is a pairing the
    // palette promises nothing about, so the fill goes back and the edge,
    // all four sides of it, says down instead — beside the weight.
    const both = look({ ...DOWN, ...OFF });
    expect(both.text).toBe(standIn('GrayText'));
    expect(both.fill).toBe(standIn('ButtonFace'));
    expect(both.edges).toEqual(Array(4).fill(standIn('GrayText')));
    expect(look({ ...UP, ...OFF }).edges).not.toEqual(both.edges);
    expect(both.weight).toBe(look(DOWN).weight);
  });
});

describe('the pair, written by a server', () => {
  const serverBuild = (on: boolean): void => {
    (globalThis as { __VOLT_SERVER__?: boolean }).__VOLT_SERVER__ = on;
  };
  beforeAll(() => serverBuild(true));
  afterAll(() => serverBuild(false));

  it('gives each group its one tab stop, and each button one type, before anything attaches', async () => {
    @Component({ selector: 'v-toggle-group', render: compileTemplate(groupTemplate, 'v-toggle-group') })
    class ServerGroup extends VToggleGroup {}
    @Component({ selector: 'v-toggle', render: compileTemplate(toggleTemplate, 'v-toggle') })
    class ServerToggle extends VToggle {}

    @Component({
      selector: 'v-page-server',
      imports: [ServerGroup, ServerToggle],
      render: compileTemplate(`
        <v-toggle-group :value="align" label="Alignment">
          <v-toggle value="left">L</v-toggle>
          <v-toggle value="center">C</v-toggle>
          <v-toggle value="right">R</v-toggle>
        </v-toggle-group>
        <v-toggle-group type="multiple" label="Formatting">
          <v-toggle value="bold" disabled>B</v-toggle>
          <v-toggle value="italic">I</v-toggle>
        </v-toggle-group>
        <v-toggle-group label="Off" disabled>
          <v-toggle value="one" disabled>One</v-toggle>
          <v-toggle value="two">Two</v-toggle>
        </v-toggle-group>
        <v-toggle-group defaultValue="free" label="Plan">
          <v-toggle value="free" disabled>Free</v-toggle>
          <v-toggle value="pro">Pro</v-toggle>
          <v-toggle value="team">Team</v-toggle>
        </v-toggle-group>
        <v-toggle-group type="multiple" :defaultValue="['bold']" label="Marks">
          <v-toggle value="bold" disabled>B</v-toggle>
          <v-toggle value="italic">I</v-toggle>
        </v-toggle-group>
        <v-toggle-group type="multiple" :defaultValue="['bold', 'code']" label="More marks">
          <v-toggle value="bold" disabled>B</v-toggle>
          <v-toggle value="italic">I</v-toggle>
          <v-toggle value="code">C</v-toggle>
        </v-toggle-group>
        <v-toggle :pressed="wrap">Wrap</v-toggle>
      `),
    })
    class Page {
      align = new Signal.State('center');
      wrap = new Signal.State(true);
    }

    const { html } = await renderToStaticMarkup(Page);

    // Written twice, the second is a parse error the browser drops; a page
    // that validates its markup is told about every button.
    const buttons = html.match(/<button[^>]*>/g) ?? [];
    expect(buttons).toHaveLength(16);
    for (const button of buttons) expect(button.match(/\stype=/g), button).toHaveLength(1);

    // Until a script attaches, Tab is all a keyboard has. A group with every
    // toggle at -1 is one it steps over without a word: the stop goes where
    // the browser will put it — on the toggle that is down, on the first one
    // that can take it while none is, and on the first of a group that is
    // out of use, which keeps its one way in whichever of its toggles were
    // refused on their own.
    const page = document.createElement('div');
    page.innerHTML = html;
    const stops = [...page.querySelectorAll('.volt-toggle-group')].map((row) =>
      [...row.querySelectorAll('.volt-toggle')].map((toggle) => toggle.getAttribute('tabindex')),
    );
    expect(stops).toEqual([
      ['-1', '0', '-1'],
      ['-1', '0'],
      ['0', '-1'],
      // What is down cannot take the stop in a group still in use, and has
      // already been drawn, so nothing that can is still to come: the stop
      // goes where the browser will put it, on the first toggle that can.
      // Waiting for a chosen toggle that is already here and refused would
      // leave the whole group to Tab past.
      ['-1', '0', '-1'],
      ['-1', '0'],
      // One of the two chosen is refused, and the other may still come — so
      // the toggle between them waits, rather than taking a stop the one
      // after it takes as well.
      ['-1', '-1', '0'],
    ]);
  });
});
