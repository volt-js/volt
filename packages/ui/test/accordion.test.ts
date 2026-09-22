/**
 * `<v-accordion>` and `<v-accordion-item>`, driven the way a page drives them.
 *
 * The behaviour is `createAccordion`'s and is tested where it lives. What is
 * left here is what this pair adds: a heading and a panel per tag, the classes
 * and the attributes the sheet's rules select on, the props this forwards, and
 * the primitive left reachable for everything it does not offer.
 *
 * happy-dom lays nothing out and animates nothing, so the measured height is
 * taken through a stubbed `scrollHeight` and an exit animation is what the
 * element is made to report — the numbers are arbitrary, where they end up is
 * not.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Component, Signal, flushSync, mount } from '@voltdev/core';
import { compileTemplate } from '@voltdev/core/jit';
import { ACCORDION_TRIGGER_ATTRIBUTE, COLLAPSIBLE_HEIGHT_PROPERTY } from '@voltdev/primitives';
import { compileComponents } from './render.js';
import { VAccordion } from '../src/components/accordion.js';
import { VAccordionItem } from '../src/components/accordion-item.js';

compileComponents();

let unmount: (() => void) | null = null;
let restores: (() => void)[] = [];

afterEach(() => {
  unmount?.();
  unmount = null;
  // Newest first: a stub laid over a stub has to come off in the order it went
  // on, or the first is put back over the second.
  for (let i = restores.length - 1; i >= 0; i--) restores[i]!();
  restores = [];
  document.body.innerHTML = '';
});

function show<T>(component: new () => T): { instance: T; host: HTMLElement } {
  const host = document.createElement('div');
  document.body.append(host);
  const handle = mount(component, host);
  unmount = handle.unmount;
  flushSync();
  return { instance: handle.instance as T, host };
}

/** A height for the panel to animate to, which no test environment measures. */
function stubScrollHeight(px: number): void {
  const proto = Element.prototype;
  const original = Object.getOwnPropertyDescriptor(proto, 'scrollHeight');

  Object.defineProperty(proto, 'scrollHeight', { configurable: true, get: () => px });
  restores.push(() => {
    if (original) Object.defineProperty(proto, 'scrollHeight', original);
    else Reflect.deleteProperty(proto, 'scrollHeight');
  });
}

/** Report an exit animation the way a browser would: only once marked closed. */
function pretendAnimating(el: Element): { finish(): Promise<void> } {
  let settle!: () => void;
  const finished = new Promise<void>((resolve) => {
    settle = resolve;
  });
  const animation = {
    playState: 'running',
    finished,
    effect: { getComputedTiming: () => ({ endTime: 150 }) },
  };

  Object.defineProperty(el, 'getAnimations', {
    configurable: true,
    value: () => (el.getAttribute('data-state') === 'closed' ? [animation] : []),
  });

  return {
    async finish(): Promise<void> {
      settle();
      await finished;
      await Promise.resolve();
      flushSync();
    },
  };
}

/** A keydown as a real one arrives: from the focused heading, bubbling to the root. */
function press(el: Element, key: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  el.dispatchEvent(event);
  flushSync();
  return event;
}

const items = (host: HTMLElement): HTMLElement[] => [
  ...host.querySelectorAll<HTMLElement>('.volt-accordion-item'),
];

const triggers = (host: HTMLElement): HTMLElement[] => [
  ...host.querySelectorAll<HTMLElement>('.volt-accordion-trigger'),
];

const panels = (host: HTMLElement): HTMLElement[] => [
  ...host.querySelectorAll<HTMLElement>('.volt-accordion-panel'),
];

const trigger = (host: HTMLElement, value: string): HTMLElement =>
  host.querySelector<HTMLElement>(`[${ACCORDION_TRIGGER_ATTRIBUTE}="${value}"]`)!;

const panel = (host: HTMLElement, value: string): HTMLElement | null =>
  trigger(host, value).closest('.volt-accordion-item')!.querySelector('.volt-accordion-panel');

@Component({
  selector: 'v-page',
  imports: [VAccordion, VAccordionItem],
  render: compileTemplate(`
    <v-accordion :value="open" :level="level.get()" class="mine" id="faq" data-page="questions">
      <v-accordion-item value="shipping" label="Shipping" class="first" id="shipping-section">
        <p>Everything leaves within a day.</p>
        <input :ref="field">
      </v-accordion-item>
      <v-accordion-item value="returns" label="Returns">
        <p>Thirty days, no questions asked.</p>
      </v-accordion-item>
      <v-accordion-item value="sizing" label="Sizing" :disabled="off.get()">
        <p>Everything runs small.</p>
      </v-accordion-item>
      <v-accordion-item value="gifts" label="Gifts">
        <p>Wrapped for nothing.</p>
      </v-accordion-item>
    </v-accordion>
  `),
})
class Page {
  open = new Signal.State<string[]>(['shipping']);
  off = new Signal.State(true);
  level = new Signal.State<number | string>(2);
  field: HTMLElement | null = null;
}

describe('v-accordion', () => {
  it('draws a heading per tag, and the panel of the section that is open', () => {
    const { host } = show(Page);

    expect(triggers(host).map((el) => el.textContent)).toEqual([
      'Shipping',
      'Returns',
      'Sizing',
      'Gifts',
    ]);
    // A heading element around the button, which is how a screen reader user
    // skims the list, and the button is what gives Enter and Space for free.
    for (const header of host.querySelectorAll('.volt-accordion-header')) {
      expect(header.tagName).toBe('H3');
      expect(header.firstElementChild).toBe(header.querySelector('.volt-accordion-trigger'));
    }
    // A heading inside a form submits it unless it says otherwise.
    expect(triggers(host).every((el) => (el as HTMLButtonElement).type === 'button')).toBe(true);

    // Only the open one: a closed panel is not in the page, which is what
    // makes an accordion of twenty sections cost one section's markup.
    expect(panels(host).length).toBe(1);
    expect(panel(host, 'shipping')!.textContent).toContain('Everything leaves within a day.');
    expect(panel(host, 'returns')).toBeNull();
  });

  it('lands what the caller wrote on each tag on the element they can see', () => {
    const { host } = show(Page);

    const root = host.querySelector('.mine')!;
    expect([...root.classList].sort()).toEqual(['mine', 'volt-accordion']);
    expect(root.querySelectorAll('.volt-accordion-item').length).toBe(4);
    // Every kind of thing a caller writes, on the one element they can see:
    // the id they chose is theirs, beside the ids the primitive mints for the
    // headings and the panels, which are not on this element at all.
    expect(root.id).toBe('faq');
    expect(root.getAttribute('data-page')).toBe('questions');

    // A section's own class is on the section, beside the sheet's — that is
    // the element the border is drawn on and the one carrying `data-state`.
    expect([...items(host)[0]!.classList].sort()).toEqual(['first', 'volt-accordion-item']);
    expect(items(host)[0]!.id).toBe('shipping-section');
    // And nothing of the caller's landed on the heading or the panel, whose
    // ids are the pair the primitive minted and points `aria-controls` at.
    expect(trigger(host, 'shipping').id).toMatch(/^accordion-trigger/);
    expect(panel(host, 'shipping')!.id).toMatch(/^accordion-content/);

    // All of it still theirs after the section has moved. The primitive's bag
    // is spread onto the same element, and a spread rewrites what it carries
    // every time the state it reads changes.
    trigger(host, 'returns').click();
    flushSync();
    expect([...items(host)[0]!.classList].sort()).toEqual(['first', 'volt-accordion-item']);
    expect(items(host)[0]!.id).toBe('shipping-section');
    expect(root.id).toBe('faq');
    expect(root.getAttribute('data-page')).toBe('questions');
  });

  it('says so when a name is written where a name means nothing', () => {
    @Component({
      selector: 'v-page-misnamed',
      imports: [VAccordion, VAccordionItem],
      render: compileTemplate(`
        <v-accordion aria-label="Questions">
          <v-accordion-item value="one" label="One" aria-label="The first one"><p>First</p></v-accordion-item>
        </v-accordion>
      `),
    })
    class MisnamedPage {}

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { host } = show(MisnamedPage);

    // What the caller wrote stays where they wrote it — this takes nothing
    // away — but both elements carry no role, where a name is thrown away by
    // every screen reader, and nothing else on the page would ever say so.
    expect(host.querySelector('.volt-accordion')!.getAttribute('aria-label')).toBe('Questions');
    expect(items(host)[0]!.getAttribute('aria-label')).toBe('The first one');
    expect(trigger(host, 'one').hasAttribute('aria-label')).toBe(false);

    expect(warn).toHaveBeenCalledTimes(2);
    const said = warn.mock.calls.map((call) => String(call[0])).join('\n');
    expect(said).toMatch(/<v-accordion>[\s\S]*aria-label/);
    // The section's message names what does name a section: its heading.
    expect(said).toMatch(/<v-accordion-item>[\s\S]*label=/);
    warn.mockRestore();
  });

  it('keeps quiet about a name the caller gave the element a role to hold', () => {
    @Component({
      selector: 'v-page-named-region',
      imports: [VAccordion, VAccordionItem],
      render: compileTemplate(`
        <v-accordion role="region" aria-label="Questions">
          <v-accordion-item value="one" label="One" role="group" aria-label="The first one"><p>First</p></v-accordion-item>
        </v-accordion>
      `),
    })
    class NamedRegionPage {}

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    show(NamedRegionPage);

    // A role written on the tag is the one way a name lands on something: the
    // element is that caller's region, and they said so.
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('writes every state the sheet draws a section by', () => {
    stubScrollHeight(120);
    const { host } = show(Page);

    expect(host.querySelector('.volt-accordion')!.getAttribute('data-orientation')).toBe('vertical');

    expect(items(host)[0]!.getAttribute('data-state')).toBe('open');
    expect(items(host)[0]!.getAttribute('data-orientation')).toBe('vertical');
    expect(items(host)[1]!.getAttribute('data-state')).toBe('closed');

    expect(trigger(host, 'shipping').getAttribute('data-state')).toBe('open');
    expect(trigger(host, 'shipping').getAttribute('aria-expanded')).toBe('true');
    expect(trigger(host, 'returns').getAttribute('aria-expanded')).toBe('false');

    expect(items(host)[2]!.getAttribute('data-disabled')).toBe('');
    expect(trigger(host, 'sizing').getAttribute('data-disabled')).toBe('');
    expect(trigger(host, 'sizing').getAttribute('aria-disabled')).toBe('true');
    // The package's rule for a disabled control: it keeps its place in the
    // accessibility tree rather than being taken out of the platform's.
    expect(trigger(host, 'sizing').hasAttribute('disabled')).toBe(false);

    expect(panel(host, 'shipping')!.getAttribute('data-state')).toBe('open');
    // The height the keyframes travel to. `auto` interpolates against nothing,
    // so without this number on the element the sheet animates nothing at all.
    expect(panel(host, 'shipping')!.style.getPropertyValue(COLLAPSIBLE_HEIGHT_PROPERTY)).toBe(
      '120px',
    );
  });

  it('keeps a closing panel until the animation it started has finished', async () => {
    const { host } = show(Page);
    const exit = pretendAnimating(panel(host, 'shipping')!);

    trigger(host, 'returns').click();
    flushSync();

    // Marked closed and still there, which is the whole of what makes a
    // collapse animatable: the sheet's rule selects on this state.
    expect(panel(host, 'shipping')!.getAttribute('data-state')).toBe('closed');
    expect(panel(host, 'returns')!.getAttribute('data-state')).toBe('open');

    await exit.finish();
    expect(panel(host, 'shipping')).toBeNull();
  });

  it('pairs each heading with its own panel, by the primitive’s ids', () => {
    const { host } = show(Page);
    const open = panel(host, 'shipping')!;

    expect(document.getElementById(trigger(host, 'shipping').getAttribute('aria-controls')!)).toBe(
      open,
    );
    // The heading names the panel, so nothing invents a string for it.
    expect(open.getAttribute('aria-labelledby')).toBe(trigger(host, 'shipping').id);
    expect(open.getAttribute('role')).toBe('region');

    // Only while the panel exists: `aria-controls` pointing at an id that is
    // not in the document is a dangling reference.
    expect(trigger(host, 'returns').hasAttribute('aria-controls')).toBe(false);
  });

  it('gives the headings the level the page around them needs', () => {
    const { instance, host } = show(Page);
    const header = host.querySelector('.volt-accordion-header')!;

    expect(header.getAttribute('aria-level')).toBe('2');

    // Read live like any other prop: an accordion that moves down a page moves
    // its headings with it.
    instance.level.set(4);
    flushSync();
    expect(header.getAttribute('aria-level')).toBe('4');
  });

  it('holds the headings at the third level until it is told otherwise', () => {
    @Component({
      selector: 'v-page-unlevelled',
      imports: [VAccordion, VAccordionItem],
      render: compileTemplate(`
        <v-accordion>
          <v-accordion-item value="one" label="One"><p>First</p></v-accordion-item>
        </v-accordion>
      `),
    })
    class UnlevelledPage {}

    const { host } = show(UnlevelledPage);
    // The level an accordion under an `<h2>` wants, which is the page most
    // accordions are written into — and the element's own level, so a page
    // that leaves it alone gets a heading that agrees with itself.
    expect(host.querySelector('.volt-accordion-header')!.getAttribute('aria-level')).toBe('3');
    expect(host.querySelector('.volt-accordion-header')!.tagName).toBe('H3');
  });

  it('moves between the headings, and leaves a press inside a panel alone', () => {
    const { instance, host } = show(Page);

    trigger(host, 'shipping').focus();
    const moved = press(trigger(host, 'shipping'), 'ArrowDown');
    expect(document.activeElement).toBe(trigger(host, 'returns'));
    // Otherwise the page scrolls out from under the heading that just took focus.
    expect(moved.defaultPrevented).toBe(true);

    // A disabled heading stays in the arrow sequence, because it stays in the
    // tab order: two orders that disagree about which headings exist leave one
    // reachable by Tab and not by an arrow.
    press(trigger(host, 'returns'), 'ArrowDown');
    expect(document.activeElement).toBe(trigger(host, 'sizing'));

    press(trigger(host, 'sizing'), 'End');
    expect(document.activeElement).toBe(trigger(host, 'gifts'));
    press(trigger(host, 'gifts'), 'ArrowDown');
    expect(document.activeElement).toBe(trigger(host, 'shipping'));
    press(trigger(host, 'shipping'), 'ArrowUp');
    expect(document.activeElement).toBe(trigger(host, 'gifts'));
    press(trigger(host, 'gifts'), 'Home');
    expect(document.activeElement).toBe(trigger(host, 'shipping'));

    // Every heading is in the page's tab sequence — an accordion is part of
    // the reading order rather than one composite widget — so the arrows are
    // an addition and nothing sits at -1.
    expect(triggers(host).every((el) => !el.hasAttribute('tabindex'))).toBe(true);

    // A key pressed in the panel belongs to whatever is in the panel: an arrow
    // in this field must not move between headings.
    instance.field!.focus();
    const typed = press(instance.field!, 'ArrowDown');
    expect(document.activeElement).toBe(instance.field);
    expect(typed.defaultPrevented).toBe(false);
  });

  it('refuses a disabled section, and takes the refusal back with the signal', () => {
    const { instance, host } = show(Page);

    trigger(host, 'sizing').click();
    flushSync();
    expect(instance.open.get()).toEqual(['shipping']);

    instance.off.set(false);
    flushSync();
    expect(trigger(host, 'sizing').hasAttribute('data-disabled')).toBe(false);
    expect(trigger(host, 'sizing').hasAttribute('aria-disabled')).toBe(false);

    trigger(host, 'sizing').click();
    flushSync();
    expect(instance.open.get()).toEqual(['sizing']);
    expect(panel(host, 'sizing')!.textContent).toContain('Everything runs small.');
  });

  it('is the caller’s signal on both sides', () => {
    const { instance, host } = show(Page);

    instance.open.set(['gifts']);
    flushSync();
    expect(panel(host, 'gifts')).not.toBeNull();
    expect(panel(host, 'shipping')).toBeNull();

    trigger(host, 'returns').click();
    flushSync();
    expect(instance.open.get()).toEqual(['returns']);
  });

  it('holds the last open section open, without greying its heading', () => {
    const { instance, host } = show(Page);

    trigger(host, 'shipping').click();
    flushSync();

    // A single accordion's heading is a switch between sections rather than a
    // switch for the section it sits on.
    expect(instance.open.get()).toEqual(['shipping']);
    expect(trigger(host, 'shipping').getAttribute('aria-disabled')).toBe('true');
    // Reported to assistive technology, because pressing it does nothing — and
    // not marked for the sheet, because it is the section being read rather
    // than one that is unavailable.
    expect(trigger(host, 'shipping').hasAttribute('data-disabled')).toBe(false);
  });

  it('lets the last section close when the caller asked for it', () => {
    @Component({
      selector: 'v-page-collapsible',
      imports: [VAccordion, VAccordionItem],
      render: compileTemplate(`
        <v-accordion :collapsible="true" :defaultValue="['one']" :onValueChange="heard">
          <v-accordion-item value="one" label="One"><p>First</p></v-accordion-item>
          <v-accordion-item value="two" label="Two"><p>Second</p></v-accordion-item>
        </v-accordion>
      `),
    })
    class CollapsiblePage {
      seen: string[][] = [];
      heard = (value: string[]): void => void this.seen.push(value);
    }

    const { instance, host } = show(CollapsiblePage);
    // What it started with, which is nobody's choice — so nothing is reported.
    expect(panel(host, 'one')).not.toBeNull();
    expect(instance.seen).toEqual([]);

    trigger(host, 'one').click();
    flushSync();
    expect(panel(host, 'one')).toBeNull();
    expect(instance.seen).toEqual([[]]);
  });

  it('keeps several sections open when told to', () => {
    @Component({
      selector: 'v-page-multiple',
      imports: [VAccordion, VAccordionItem],
      render: compileTemplate(`
        <v-accordion type="multiple">
          <v-accordion-item value="one" label="One"><p>First</p></v-accordion-item>
          <v-accordion-item value="two" label="Two"><p>Second</p></v-accordion-item>
        </v-accordion>
      `),
    })
    class MultiplePage {}

    const { host } = show(MultiplePage);
    trigger(host, 'one').click();
    trigger(host, 'two').click();
    flushSync();

    expect(panels(host).length).toBe(2);

    // And each closes on its own, which is the half a single accordion has not
    // got.
    trigger(host, 'one').click();
    flushSync();
    expect(panel(host, 'one')).toBeNull();
    expect(panel(host, 'two')).not.toBeNull();
  });

  it('turns the axis over to the root and the sections, and to the arrows', () => {
    @Component({
      selector: 'v-page-horizontal',
      imports: [VAccordion, VAccordionItem],
      render: compileTemplate(`
        <v-accordion orientation="horizontal" :loop="false">
          <v-accordion-item value="one" label="One"><p>First</p></v-accordion-item>
          <v-accordion-item value="two" label="Two"><p>Second</p></v-accordion-item>
        </v-accordion>
      `),
    })
    class HorizontalPage {}

    const { host } = show(HorizontalPage);
    expect(host.querySelector('.volt-accordion')!.getAttribute('data-orientation')).toBe(
      'horizontal',
    );
    expect(items(host)[0]!.getAttribute('data-orientation')).toBe('horizontal');

    trigger(host, 'one').focus();
    press(trigger(host, 'one'), 'ArrowDown');
    expect(document.activeElement).toBe(trigger(host, 'one'));

    press(trigger(host, 'one'), 'ArrowRight');
    expect(document.activeElement).toBe(trigger(host, 'two'));

    // Told not to loop, so the last heading is where it stops.
    press(trigger(host, 'two'), 'ArrowRight');
    expect(document.activeElement).toBe(trigger(host, 'two'));
  });

  it('drops the landmark for a list long enough to crowd one out', () => {
    @Component({
      selector: 'v-page-plain',
      imports: [VAccordion, VAccordionItem],
      render: compileTemplate(`
        <v-accordion :region="false" :defaultValue="['one']">
          <v-accordion-item value="one" label="One"><p>First</p></v-accordion-item>
        </v-accordion>
      `),
    })
    class PlainPage {}

    const { host } = show(PlainPage);
    expect(panel(host, 'one')!.hasAttribute('role')).toBe(false);
    // The heading still names it, which is the part that was never optional.
    expect(panel(host, 'one')!.getAttribute('aria-labelledby')).toBe(trigger(host, 'one').id);
  });

  it('refuses every heading while the whole list is off', () => {
    @Component({
      selector: 'v-page-off',
      imports: [VAccordion, VAccordionItem],
      render: compileTemplate(`
        <v-accordion :disabled="saving.get()">
          <v-accordion-item value="one" label="One"><p>First</p></v-accordion-item>
          <v-accordion-item value="two" label="Two"><p>Second</p></v-accordion-item>
        </v-accordion>
      `),
    })
    class OffPage {
      saving = new Signal.State(true);
    }

    const { instance, host } = show(OffPage);
    expect(triggers(host).every((el) => el.hasAttribute('data-disabled'))).toBe(true);

    trigger(host, 'one').click();
    flushSync();
    expect(panel(host, 'one')).toBeNull();

    instance.saving.set(false);
    flushSync();
    trigger(host, 'one').click();
    flushSync();
    expect(panel(host, 'one')).not.toBeNull();
  });

  it('draws the words a heading was given, and follows a bound label', () => {
    @Component({
      selector: 'v-page-label',
      imports: [VAccordion, VAccordionItem],
      render: compileTemplate(`
        <v-accordion>
          <v-accordion-item value="one" :label="name.get()"><p>First</p></v-accordion-item>
          <v-accordion-item value="two" label="Two">
            <template :slot-header><b>T</b>wo <span>2</span></template>
            <p>Second</p>
          </v-accordion-item>
        </v-accordion>
      `),
    })
    class LabelPage {
      name = new Signal.State('One');
    }

    const { instance, host } = show(LabelPage);
    expect(trigger(host, 'one').textContent).toBe('One');

    instance.name.set('Uno');
    flushSync();
    expect(trigger(host, 'one').textContent).toBe('Uno');

    // The `header` slot is the heading's own markup; the content of the tag
    // stays the panel, which is the larger of the two by far.
    expect(trigger(host, 'two').querySelector('b')!.textContent).toBe('T');
    trigger(host, 'two').click();
    flushSync();
    expect(panel(host, 'two')!.textContent).toContain('Second');
  });

  it('reaches a section written by a loop that grew later', async () => {
    @Component({
      selector: 'v-page-grown',
      imports: [VAccordion, VAccordionItem],
      render: compileTemplate(`
        <v-accordion :ref="box">
          <v-accordion-item value="first" label="First"><p>First</p></v-accordion-item>
          <v-accordion-item
            :for="name in extra.get()"
            :key="name"
            :value="name"
            :label="name"
            :disabled="true"
          ><p>Grown</p></v-accordion-item>
          <v-accordion-item value="last" label="Last"><p>Last</p></v-accordion-item>
        </v-accordion>
      `),
    })
    class GrownPage {
      extra = new Signal.State<string[]>([]);
      box: VAccordion | null = null;
    }

    const { instance, host } = show(GrownPage);
    instance.extra.set(['middle']);
    flushSync();
    await Promise.resolve();
    flushSync();

    // Registered after the section written below it and drawn between the two,
    // which is the DOM's order rather than the order the tags were built in.
    expect(triggers(host).map((el) => el.textContent)).toEqual(['First', 'middle', 'Last']);
    // And the list of sections says the same, which is what the element each
    // one hands back is for: registration order would put the grown section
    // last, and a caller reading `items` would be told the wrong order.
    expect(instance.box!.items.all.get().map((item) => item.value.get())).toEqual([
      'first',
      'middle',
      'last',
    ]);
    // And the accordion found the tag for it: only the tag knows it refuses.
    expect(trigger(host, 'middle').getAttribute('data-disabled')).toBe('');

    trigger(host, 'first').focus();
    press(trigger(host, 'first'), 'ArrowDown');
    expect(document.activeElement).toBe(trigger(host, 'middle'));
  });

  it('hands the primitive itself to whoever needs more than this offers', () => {
    @Component({
      selector: 'v-page-ref',
      imports: [VAccordion, VAccordionItem],
      render: compileTemplate(`
        <v-accordion :ref="box" type="multiple">
          <v-accordion-item value="one" label="One"><p>First</p></v-accordion-item>
          <v-accordion-item value="two" label="Two"><p>Second</p></v-accordion-item>
        </v-accordion>
      `),
    })
    class RefPage {
      box: VAccordion | null = null;
    }

    const { instance, host } = show(RefPage);
    expect(instance.box?.accordion.value()).toEqual([]);

    instance.box!.accordion.open('two');
    flushSync();
    expect(instance.box!.accordion.isOpen('two')).toBe(true);
    expect(panel(host, 'two')).not.toBeNull();
    expect(items(host)[1]!.getAttribute('data-state')).toBe('open');
  });

  it('leaves an accordion written inside a panel to itself', () => {
    @Component({
      selector: 'v-page-nested',
      imports: [VAccordion, VAccordionItem],
      render: compileTemplate(`
        <v-accordion :ref="outer" :defaultValue="['help']">
          <v-accordion-item value="help" label="Help">
            <v-accordion :ref="inner" :defaultValue="['first']">
              <v-accordion-item value="first" label="First"><p>One</p></v-accordion-item>
              <v-accordion-item value="second" label="Second"><p>Two</p></v-accordion-item>
            </v-accordion>
          </v-accordion-item>
          <v-accordion-item value="terms" label="Terms"><p>Terms</p></v-accordion-item>
        </v-accordion>
      `),
    })
    class NestedPage {
      outer: VAccordion | null = null;
      inner: VAccordion | null = null;
    }

    const { instance, host } = show(NestedPage);

    // A section belongs to the accordion it was written inside, which is the
    // one its scope descends from — not the one its element happens to sit in.
    expect(instance.outer!.items.all.get().map((item) => item.value.get())).toEqual([
      'help',
      'terms',
    ]);
    expect(instance.inner!.items.all.get().map((item) => item.value.get())).toEqual([
      'first',
      'second',
    ]);

    // And the arrows inside the panel belong to the accordion in it: the
    // heading below the whole nest is not where the next arrow goes.
    trigger(host, 'first').focus();
    press(trigger(host, 'first'), 'ArrowDown');
    expect(document.activeElement).toBe(trigger(host, 'second'));

    // The outer accordion answers its own headings all the same.
    trigger(host, 'terms').focus();
    press(trigger(host, 'terms'), 'ArrowUp');
    expect(document.activeElement).toBe(trigger(host, 'help'));
  });

  it('refuses to be a section of nothing', () => {
    @Component({
      selector: 'v-page-loose',
      imports: [VAccordionItem],
      render: compileTemplate(
        `<div><v-accordion-item value="one" label="One"></v-accordion-item></div>`,
      ),
    })
    class LoosePage {}

    expect(() => show(LoosePage)).toThrow(
      /<v-accordion-item> has to be written inside <v-accordion>/,
    );
  });

  it('refuses two sections that carry one value', () => {
    @Component({
      selector: 'v-page-twins',
      imports: [VAccordion, VAccordionItem],
      render: compileTemplate(`
        <v-accordion>
          <v-accordion-item value="one" label="One"><p>First</p></v-accordion-item>
          <v-accordion-item value="one" label="Again"><p>Second</p></v-accordion-item>
        </v-accordion>
      `),
    })
    class TwinsPage {}

    // Both would open at once, under one id: the value is what the open
    // sections are a list of, and what the pair of ids is minted from.
    expect(() => show(TwinsPage)).toThrow(/carry the value "one"/);
  });

  it('reports the sections a user opened, and nothing else', () => {
    const heard = vi.fn();

    @Component({
      selector: 'v-page-heard',
      imports: [VAccordion, VAccordionItem],
      render: compileTemplate(`
        <v-accordion :value="open" :onValueChange="heard" type="multiple">
          <v-accordion-item value="one" label="One"><p>First</p></v-accordion-item>
          <v-accordion-item value="two" label="Two"><p>Second</p></v-accordion-item>
        </v-accordion>
      `),
    })
    class HeardPage {
      open = new Signal.State<string[]>([]);
      heard = heard;
    }

    const { instance, host } = show(HeardPage);

    trigger(host, 'two').click();
    flushSync();
    expect(heard).toHaveBeenCalledWith(['two']);

    // The page writing its own signal is not a change the accordion made, so
    // it hears about that where it wrote it.
    instance.open.set(['one']);
    flushSync();
    expect(heard).toHaveBeenCalledTimes(1);
    expect(panel(host, 'one')).not.toBeNull();
  });
});
