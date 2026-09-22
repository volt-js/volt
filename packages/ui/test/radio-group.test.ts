/**
 * `<v-radio-group>` and `<v-radio>`, driven the way a page drives them.
 *
 * The behaviour is `createRadioGroup`'s and is tested where it lives. What is
 * tested here is the shell: that what a caller writes on either tag reaches
 * the element carrying the role, that the two states the sheet draws are on
 * the element its rules select on, that the group is one tab stop with the
 * keyboard the primitive provides, that the hidden radios the form reads are
 * really there under one name, and that nothing about the primitive is out of
 * reach.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Component, Signal, flushSync, mount } from '@voltdev/core';
import { compileTemplate } from '@voltdev/core/jit';
import { compileComponents } from './render.js';
import { VRadio } from '../src/components/radio.js';
import { VRadioGroup } from '../src/components/radio-group.js';

compileComponents();

let unmount: (() => void) | null = null;

afterEach(() => {
  unmount?.();
  unmount = null;
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

/**
 * Let the DOM's own order come back.
 *
 * The radios are collected as they register and sorted by where their rows
 * ended up, which a `MutationObserver` reports — a microtask away rather than
 * a flush.
 */
async function settle(): Promise<void> {
  await Promise.resolve();
  flushSync();
}

/** A keydown as the user sends it: bubbling, and cancellable. */
function press(target: Element, key: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  flushSync();
  return event;
}

const group = (host: HTMLElement): HTMLElement => host.querySelector('.volt-radio-group')!;
const rows = (host: HTMLElement): HTMLLabelElement[] => [
  ...host.querySelectorAll<HTMLLabelElement>('.volt-radio-field'),
];
const radios = (host: HTMLElement): HTMLElement[] => [
  ...host.querySelectorAll<HTMLElement>('.volt-radio'),
];
const inputs = (host: HTMLElement): HTMLInputElement[] => [...host.querySelectorAll('input')];
const states = (host: HTMLElement): (string | null)[] =>
  radios(host).map((radio) => radio.getAttribute('data-state'));
const tabStops = (host: HTMLElement): (string | null)[] =>
  radios(host).map((radio) => radio.getAttribute('tabindex'));

/** Two plans and a third nobody may have, which is the shape most tests want. */
@Component({
  selector: 'v-plans',
  imports: [VRadio, VRadioGroup],
  render: compileTemplate(`
    <v-radio-group :value="plan" name="plan" label="Billing plan" :onValueChange="record">
      <v-radio value="monthly">Monthly</v-radio>
      <v-radio value="yearly">Yearly</v-radio>
      <v-radio value="lifetime" :disabled="true">Lifetime</v-radio>
    </v-radio-group>
  `),
})
class Plans {
  plan = new Signal.State<string | null>(null);
  chosen: (string | null)[] = [];
  record = (value: string | null): void => void this.chosen.push(value);
}

describe('v-radio-group', () => {
  it('is a radiogroup of rows, with the sheet’s classes and the caller’s own', () => {
    @Component({
      selector: 'v-page',
      imports: [VRadio, VRadioGroup],
      render: compileTemplate(`
        <span id="note">Billed to the card on file.</span>
        <v-radio-group class="mine" id="plan" name="plan" label="Billing plan">
          <v-radio value="monthly" class="first" id="monthly" aria-describedby="note">Monthly</v-radio>
          <v-radio value="quarterly" aria-label="Every three months"></v-radio>
          <v-radio value="yearly">Yearly</v-radio>
        </v-radio-group>
      `),
    })
    class Page {}

    const { host } = show(Page);

    // What the caller wrote lands on the element carrying the role, which is
    // the group itself — so a name written on the tag names the radiogroup.
    expect([...group(host).classList].sort()).toEqual(['mine', 'volt-radio-group']);
    expect(group(host).id).toBe('plan');
    expect(group(host).getAttribute('role')).toBe('radiogroup');
    expect(group(host).getAttribute('aria-label')).toBe('Billing plan');

    // Same rule one level down: `:host` is on the `role="radio"` element, not
    // on the `<label>` around it, which carries no role at all.
    expect([...radios(host)[0]!.classList].sort()).toEqual(['first', 'volt-radio']);
    expect(radios(host)[0]!.id).toBe('monthly');
    expect(radios(host).map((radio) => radio.getAttribute('role'))).toEqual([
      'radio',
      'radio',
      'radio',
    ]);
    expect(radios(host)[0]!.textContent).toContain('Monthly');
    expect(rows(host)[0]!.tagName).toBe('LABEL');
    expect(rows(host)[0]!.contains(radios(host)[0]!)).toBe(true);

    // A radio with nothing written inside it is named by `aria-label`, and
    // that name has to reach the element with `role="radio"` — on the row
    // around it, it would name nothing at all.
    expect(radios(host)[1]!.getAttribute('aria-label')).toBe('Every three months');
    expect(rows(host)[1]!.hasAttribute('aria-label')).toBe(false);

    // The circle and the dot inside it, which is how the sheet says chosen in
    // a channel a forced palette cannot take away.
    const indicator = radios(host)[0]!.querySelector('.volt-radio-indicator')!;
    expect(indicator.getAttribute('aria-hidden')).toBe('true');
    expect(indicator.querySelector('.volt-radio-dot')).not.toBe(null);

    // Anything else written on the tag lands there too, and stays: the bag the
    // primitive fills has no opinion about a description, so nothing in it can
    // write over one.
    expect(radios(host)[0]!.getAttribute('aria-describedby')).toBe('note');
    rows(host)[0]!.click();
    flushSync();
    expect(radios(host)[0]!.getAttribute('aria-describedby')).toBe('note');

    // Each radio draws a real input, hidden by the primitive rather than left
    // out: it is the half that submits, validates and resets.
    expect(inputs(host).map((input) => input.type)).toEqual(['radio', 'radio', 'radio']);
    expect(inputs(host).map((input) => input.name)).toEqual(['plan', 'plan', 'plan']);
    expect(inputs(host).map((input) => input.value)).toEqual([
      'monthly',
      'quarterly',
      'yearly',
    ]);
    expect(inputs(host)[0]!.getAttribute('aria-hidden')).toBe('true');
    expect(inputs(host)[0]!.getAttribute('tabindex')).toBe('-1');
  });

  it('writes every state the sheet’s rules select on', () => {
    const { instance, host } = show(Plans);

    expect(states(host)).toEqual(['unchecked', 'unchecked', 'unchecked']);
    expect(radios(host)[2]!.getAttribute('data-disabled')).toBe('');
    expect(radios(host)[2]!.getAttribute('aria-disabled')).toBe('true');
    expect(radios(host)[0]!.hasAttribute('data-disabled')).toBe(false);

    instance.plan.set('yearly');
    flushSync();
    expect(states(host)).toEqual(['unchecked', 'checked', 'unchecked']);
    expect(radios(host).map((radio) => radio.getAttribute('aria-checked'))).toEqual([
      'false',
      'true',
      'false',
    ]);
    expect(inputs(host).map((input) => input.checked)).toEqual([false, true, false]);

    // The sheet lays the group out from `data-orientation`, and says the same
    // thing to a screen reader in ARIA.
    expect(group(host).getAttribute('data-orientation')).toBe('vertical');
    expect(group(host).getAttribute('aria-orientation')).toBe('vertical');
    expect(group(host).hasAttribute('data-disabled')).toBe(false);
  });

  it('lays the group out the way the markup asks, and says so', () => {
    @Component({
      selector: 'v-page',
      imports: [VRadio, VRadioGroup],
      render: compileTemplate(`
        <v-radio-group :orientation="way.get()" label="Billing plan">
          <v-radio value="monthly">Monthly</v-radio>
        </v-radio-group>
      `),
    })
    class Page {
      way = new Signal.State<'horizontal' | 'vertical'>('horizontal');
    }

    const { instance, host } = show(Page);
    expect(group(host).getAttribute('data-orientation')).toBe('horizontal');
    expect(group(host).getAttribute('aria-orientation')).toBe('horizontal');

    instance.way.set('vertical');
    flushSync();
    expect(group(host).getAttribute('data-orientation')).toBe('vertical');
  });

  it('holds one tab stop, on the chosen radio or the first one', () => {
    const { instance, host } = show(Plans);

    // Nothing chosen: the first radio holds it, or Tab could not reach the
    // group at all.
    expect(tabStops(host)).toEqual(['0', '-1', '-1']);

    instance.plan.set('yearly');
    flushSync();
    expect(tabStops(host)).toEqual(['-1', '0', '-1']);

    // A disabled radio never holds it, which is the group's one departure from
    // keeping a disabled control reachable.
    instance.plan.set('lifetime');
    flushSync();
    expect(tabStops(host)).toEqual(['-1', '-1', '-1']);
  });

  it('keeps the tab stop when the radios arrive with the data they are drawn from', async () => {
    @Component({
      selector: 'v-page',
      imports: [VRadio, VRadioGroup],
      render: compileTemplate(`
        <v-radio-group :value="plan" name="plan" label="Billing plan">
          <v-radio :for="option in plans.get()" :key="option" :value="option">{ option }</v-radio>
        </v-radio-group>
      `),
    })
    class Page {
      plan = new Signal.State<string | null>(null);
      plans = new Signal.State<string[]>([]);
    }

    const { instance, host } = show(Page);
    expect(tabStops(host)).toEqual([]);

    // The radios a request brought back. Nothing is chosen, so the first of
    // them holds the tab stop — a group where none of them does is a question
    // Tab steps over and no key reaches again.
    instance.plans.set(['monthly', 'yearly']);
    flushSync();
    await settle();
    expect(tabStops(host)).toEqual(['0', '-1']);

    rows(host)[1]!.click();
    flushSync();
    expect(tabStops(host)).toEqual(['-1', '0']);
  });

  it('keeps it when the chosen radio is not one of these', async () => {
    @Component({
      selector: 'v-page',
      imports: [VRadio, VRadioGroup],
      render: compileTemplate(`
        <v-radio-group :value="plan" name="plan" label="Billing plan">
          <v-radio :for="option in plans.get()" :key="option" :value="option">{ option }</v-radio>
        </v-radio-group>
      `),
    })
    class Page {
      // A choice restored from somewhere — a saved form, a query string —
      // whose option has since been retired.
      plan = new Signal.State<string | null>('lifetime');
      plans = new Signal.State<string[]>(['monthly', 'yearly']);
    }

    const { instance, host } = show(Page);
    expect(states(host)).toEqual(['unchecked', 'unchecked']);
    expect(tabStops(host)).toEqual(['0', '-1']);

    // And when the chosen one leaves while the group is on screen.
    instance.plan.set('yearly');
    flushSync();
    expect(tabStops(host)).toEqual(['-1', '0']);

    instance.plans.set(['monthly']);
    flushSync();
    await settle();
    expect(tabStops(host)).toEqual(['0']);

    // The choice itself is left alone: nothing here answered the question, and
    // a group that answered it on the page's behalf would be inventing one.
    expect(instance.plan.get()).toBe('yearly');
  });

  it('gives it to the first radio that can take it, and to none while the group is off', () => {
    @Component({
      selector: 'v-page',
      imports: [VRadio, VRadioGroup],
      render: compileTemplate(`
        <v-radio-group :disabled="off.get()" label="Billing plan">
          <v-radio value="monthly" :disabled="true">Monthly</v-radio>
          <v-radio value="yearly">Yearly</v-radio>
        </v-radio-group>
      `),
    })
    class Page {
      off = new Signal.State(false);
    }

    const { instance, host } = show(Page);
    expect(tabStops(host)).toEqual(['-1', '0']);

    instance.off.set(true);
    flushSync();
    expect(tabStops(host)).toEqual(['-1', '-1']);
  });

  it('holds the radios in the order their rows ended up in', async () => {
    @Component({
      selector: 'v-page',
      imports: [VRadio, VRadioGroup],
      render: compileTemplate(`
        <v-radio-group :ref="plans" name="plan" label="Billing plan">
          <v-radio :for="option in order.get()" :key="option" :value="option">{ option }</v-radio>
          <v-radio value="lifetime">Lifetime</v-radio>
        </v-radio-group>
      `),
    })
    class Page {
      plans: VRadioGroup | null = null;
      order = new Signal.State(['monthly', 'yearly']);
    }

    const { instance, host } = show(Page);
    const collected = (): string[] =>
      instance.plans!.radios.all.get().map((radio) => radio.value.get());
    const written = (): string[] =>
      inputs(host).map((input) => input.value);

    expect(collected()).toEqual(written());

    // The same radios in the other order: nothing joins or leaves, so only the
    // DOM says anything happened — and the rows are what it says it about,
    // which is why each radio hands the group the row it drew.
    instance.order.set(['yearly', 'monthly']);
    flushSync();
    await settle();
    expect(written()).toEqual(['yearly', 'monthly', 'lifetime']);
    expect(collected()).toEqual(written());

    // Which is also what decides where the tab stop goes while nothing is
    // chosen: the first radio on screen, not the first one that registered.
    expect(tabStops(host)).toEqual(['0', '-1', '-1']);
  });

  it('moves with the arrows, choosing as it goes, and steps over what is off', () => {
    const { instance, host } = show(Plans);
    radios(host)[0]!.focus();

    const down = press(radios(host)[0]!, 'ArrowDown');
    expect(instance.plan.get()).toBe('yearly');
    expect(document.activeElement).toBe(radios(host)[1]);
    // Uncancelled, an arrow scrolls the page.
    expect(down.defaultPrevented).toBe(true);

    // Past the disabled radio and round to the first, which is what `loop`
    // being on means.
    press(radios(host)[1]!, 'ArrowDown');
    expect(instance.plan.get()).toBe('monthly');
    expect(document.activeElement).toBe(radios(host)[0]);

    // All four arrows move, whatever the orientation says, because native
    // radios answer to all four.
    press(radios(host)[0]!, 'ArrowRight');
    expect(instance.plan.get()).toBe('yearly');
    press(radios(host)[1]!, 'ArrowUp');
    expect(instance.plan.get()).toBe('monthly');

    press(radios(host)[0]!, 'End');
    expect(instance.plan.get()).toBe('yearly');
    press(radios(host)[1]!, 'Home');
    expect(instance.plan.get()).toBe('monthly');

    expect(instance.chosen).toEqual(['yearly', 'monthly', 'yearly', 'monthly', 'yearly', 'monthly']);
  });

  it('stops at the ends when told not to wrap', () => {
    @Component({
      selector: 'v-page',
      imports: [VRadio, VRadioGroup],
      render: compileTemplate(`
        <v-radio-group :value="plan" :loop="false" label="Billing plan">
          <v-radio value="monthly">Monthly</v-radio>
          <v-radio value="yearly">Yearly</v-radio>
        </v-radio-group>
      `),
    })
    class Page {
      plan = new Signal.State<string | null>('yearly');
    }

    const { instance, host } = show(Page);
    radios(host)[1]!.focus();

    press(radios(host)[1]!, 'ArrowDown');
    expect(instance.plan.get()).toBe('yearly');
    expect(document.activeElement).toBe(radios(host)[1]);

    press(radios(host)[1]!, 'ArrowUp');
    expect(instance.plan.get()).toBe('monthly');
  });

  it('chooses the focused radio with Space, and leaves Enter to the form', () => {
    const { instance, host } = show(Plans);
    radios(host)[1]!.focus();

    // How a group entered by Tab with nothing chosen gets its first answer.
    const space = press(radios(host)[1]!, ' ');
    expect(instance.plan.get()).toBe('yearly');
    expect(space.defaultPrevented).toBe(true);

    const enter = press(radios(host)[1]!, 'Enter');
    expect(enter.defaultPrevented).toBe(false);
  });

  it('chooses once on a press, wherever in the row it lands', () => {
    const { instance, host } = show(Plans);

    // The words: a label forwards this press to the hidden input it labels, so
    // a row that does not swallow that one answers twice and looks dead.
    rows(host)[1]!.click();
    flushSync();
    expect(instance.plan.get()).toBe('yearly');
    expect(instance.chosen).toEqual(['yearly']);
    expect(inputs(host).map((input) => input.checked)).toEqual([false, true, false]);

    radios(host)[0]!.click();
    flushSync();
    expect(instance.plan.get()).toBe('monthly');
    expect(instance.chosen).toEqual(['yearly', 'monthly']);

    // A radio that is off refuses the press and leaves the answer alone.
    rows(host)[2]!.click();
    flushSync();
    expect(instance.plan.get()).toBe('monthly');
    expect(instance.chosen).toEqual(['yearly', 'monthly']);
  });

  it('submits one value under the group’s name, and enforces required', () => {
    @Component({
      selector: 'v-page',
      imports: [VRadio, VRadioGroup],
      render: compileTemplate(`
        <form>
          <v-radio-group :value="plan" name="plan" :required="must.get()" label="Billing plan">
            <v-radio value="monthly">Monthly</v-radio>
            <v-radio value="yearly">Yearly</v-radio>
          </v-radio-group>
        </form>
      `),
    })
    class Page {
      plan = new Signal.State<string | null>(null);
      must = new Signal.State(false);
    }

    const { instance, host } = show(Page);
    const form = host.querySelector('form')!;
    const submitted = (): [string, FormDataEntryValue][] => [...new FormData(form).entries()];

    expect(submitted()).toEqual([]);

    rows(host)[1]!.click();
    flushSync();
    expect(submitted()).toEqual([['plan', 'yearly']]);

    rows(host)[0]!.click();
    flushSync();
    expect(submitted()).toEqual([['plan', 'monthly']]);

    // The constraint belongs to the group, so it goes on every mirror: the
    // platform treats them all as satisfied the moment one is checked.
    instance.must.set(true);
    flushSync();
    expect(group(host).getAttribute('aria-required')).toBe('true');
    expect(inputs(host).map((input) => input.required)).toEqual([true, true]);
  });

  it('follows the signal it was given, both ways', () => {
    const { instance, host } = show(Plans);

    instance.plan.set('monthly');
    flushSync();
    expect(states(host)).toEqual(['checked', 'unchecked', 'unchecked']);
    // A write by the page is not a choice a user made.
    expect(instance.chosen).toEqual([]);

    rows(host)[1]!.click();
    flushSync();
    expect(instance.plan.get()).toBe('yearly');
    expect(instance.chosen).toEqual(['yearly']);
  });

  it('starts where it was told to, when the choice is its own', () => {
    @Component({
      selector: 'v-page',
      imports: [VRadio, VRadioGroup],
      render: compileTemplate(`
        <v-radio-group defaultValue="yearly" name="plan" label="Billing plan">
          <v-radio value="monthly">Monthly</v-radio>
          <v-radio value="yearly">Yearly</v-radio>
        </v-radio-group>
      `),
    })
    class Page {}

    const { host } = show(Page);
    expect(states(host)).toEqual(['unchecked', 'checked']);
    expect(inputs(host)[1]!.hasAttribute('checked')).toBe(true);
    expect(tabStops(host)).toEqual(['-1', '0']);
  });

  it('refuses every radio while the group is off, and submits nothing', () => {
    @Component({
      selector: 'v-page',
      imports: [VRadio, VRadioGroup],
      render: compileTemplate(`
        <v-radio-group :value="plan" name="plan" :disabled="off.get()" label="Billing plan">
          <v-radio value="monthly">Monthly</v-radio>
          <v-radio value="yearly">Yearly</v-radio>
        </v-radio-group>
      `),
    })
    class Page {
      plan = new Signal.State<string | null>(null);
      off = new Signal.State(true);
    }

    const { instance, host } = show(Page);

    expect(group(host).getAttribute('data-disabled')).toBe('');
    expect(group(host).getAttribute('aria-disabled')).toBe('true');
    expect(states(host)).toEqual(['unchecked', 'unchecked']);
    // A group that is off has no tab stop at all: every radio in it is one the
    // arrows step over.
    expect(tabStops(host)).toEqual(['-1', '-1']);
    expect(inputs(host).map((input) => input.disabled)).toEqual([true, true]);

    rows(host)[0]!.click();
    press(radios(host)[0]!, 'ArrowDown');
    expect(instance.plan.get()).toBe(null);

    instance.off.set(false);
    flushSync();
    rows(host)[0]!.click();
    flushSync();
    expect(instance.plan.get()).toBe('monthly');
  });

  it('names the group, and keeps what the caller wrote in ARIA', () => {
    @Component({
      selector: 'v-page',
      imports: [VRadio, VRadioGroup],
      render: compileTemplate(`
        <h2 id="heading">Billing plan</h2>
        <v-radio-group :label="question.get()" :value="plan">
          <v-radio value="monthly">Monthly</v-radio>
        </v-radio-group>
        <v-radio-group aria-label="How often" label="stale">
          <v-radio value="monthly">Monthly</v-radio>
        </v-radio-group>
        <v-radio-group labelledBy="heading">
          <v-radio value="monthly">Monthly</v-radio>
        </v-radio-group>
        <v-radio-group aria-labelledby="heading" labelledBy="stale">
          <v-radio value="monthly">Monthly</v-radio>
        </v-radio-group>
      `),
    })
    class Page {
      question = new Signal.State<string | undefined>('Billing plan');
      plan = new Signal.State<string | null>(null);
    }

    const { instance, host } = show(Page);
    const groups = [...host.querySelectorAll('.volt-radio-group')];

    expect(groups[0]!.getAttribute('aria-label')).toBe('Billing plan');

    // A name bound to a signal — translated, or arriving with the data —
    // follows it.
    instance.question.set('How often you pay');
    flushSync();
    expect(groups[0]!.getAttribute('aria-label')).toBe('How often you pay');

    // And it is still there after a choice was made: the group's attributes
    // are rewritten on every change, and a name written beside them rather
    // than among them is wiped by the first one.
    rows(host)[0]!.click();
    flushSync();
    expect(groups[0]!.getAttribute('aria-label')).toBe('How often you pay');

    // Two spellings of one name can only disagree by mistake, and the one the
    // caller wrote on the tag is the one that counts.
    expect(groups[1]!.getAttribute('aria-label')).toBe('How often');

    // The other half of the name: an element on the page that already asks the
    // question, in either spelling.
    expect(groups[2]!.getAttribute('aria-labelledby')).toBe('heading');
    expect(groups[2]!.hasAttribute('aria-label')).toBe(false);
    expect(groups[3]!.getAttribute('aria-labelledby')).toBe('heading');
  });

  it('leaves alone the ARIA it has nothing to say about, and clears its own', () => {
    @Component({
      selector: 'v-page',
      imports: [VRadio, VRadioGroup],
      render: compileTemplate(`
        <v-radio-group
          :value="plan"
          :required="must.get()"
          name="plan"
          label="Billing plan"
          aria-describedby="note"
          data-density="tight"
        >
          <v-radio value="monthly" aria-describedby="note" data-density="tight">Monthly</v-radio>
          <v-radio value="yearly">Yearly</v-radio>
        </v-radio-group>
      `),
    })
    class Page {
      plan = new Signal.State<string | null>(null);
      must = new Signal.State(false);
    }

    const { instance, host } = show(Page);
    const kept = (el: Element): (string | null)[] => [
      el.getAttribute('aria-describedby'),
      el.getAttribute('data-density'),
    ];

    // Both tags land on the element carrying the role, which is also the
    // element the bag is spread onto — so anything the bag has no value for is
    // an attribute of the caller's that a rewrite could take away.
    expect(kept(group(host))).toEqual(['note', 'tight']);
    expect(kept(radios(host)[0]!)).toEqual(['note', 'tight']);

    rows(host)[1]!.click();
    flushSync();
    expect(kept(group(host))).toEqual(['note', 'tight']);
    expect(kept(radios(host)[0]!)).toEqual(['note', 'tight']);

    // What the group does say, it still takes back: a state that ends is an
    // attribute removed, not one left behind saying the group is still in it.
    instance.must.set(true);
    flushSync();
    expect(group(host).getAttribute('aria-required')).toBe('true');
    instance.must.set(false);
    flushSync();
    expect(group(host).hasAttribute('aria-required')).toBe(false);
  });

  it('keeps the ARIA a caller wrote that it has no opinion of its own about', () => {
    @Component({
      selector: 'v-page',
      imports: [VRadio, VRadioGroup],
      render: compileTemplate(`
        <v-radio-group :value="plan" name="plan" label="Billing plan" aria-required="true">
          <v-radio value="monthly" aria-disabled="true">Monthly</v-radio>
          <v-radio value="yearly">Yearly</v-radio>
        </v-radio-group>
      `),
    })
    class Page {
      plan = new Signal.State<string | null>(null);
    }

    const { host } = show(Page);

    // Neither prop is set, so the primitive's bag carries `undefined` for both
    // of these — which is the primitive having nothing to say, not it saying
    // no. Written as an attribute it is a removal, and what it removes is the
    // caller's own.
    expect(group(host).getAttribute('aria-required')).toBe('true');
    expect(radios(host)[0]!.getAttribute('aria-disabled')).toBe('true');

    rows(host)[1]!.click();
    flushSync();
    expect(group(host).getAttribute('aria-required')).toBe('true');
    expect(radios(host)[0]!.getAttribute('aria-disabled')).toBe('true');
  });

  it('hands the primitive itself to whoever needs more than this offers', () => {
    @Component({
      selector: 'v-page-ref',
      imports: [VRadio, VRadioGroup],
      render: compileTemplate(`
        <v-radio-group :ref="plans" name="plan" label="Billing plan">
          <v-radio value="monthly">Monthly</v-radio>
          <v-radio value="yearly">Yearly</v-radio>
        </v-radio-group>
      `),
    })
    class PageRef {
      plans: VRadioGroup | null = null;
    }

    const { instance, host } = show(PageRef);
    expect(instance.plans?.radioGroup.value()).toBe(null);

    instance.plans!.radioGroup.select('yearly');
    flushSync();
    expect(instance.plans!.radioGroup.isSelected('yearly')).toBe(true);
    expect(states(host)).toEqual(['unchecked', 'checked']);

    // The radios it collected, in the order they are drawn.
    expect(instance.plans!.radios.all.get().map((radio) => radio.value.get())).toEqual([
      'monthly',
      'yearly',
    ]);
  });

  it('follows a value that changes on a radio', () => {
    @Component({
      selector: 'v-page',
      imports: [VRadio, VRadioGroup],
      render: compileTemplate(`
        <v-radio-group :value="plan" name="plan" label="Billing plan">
          <v-radio :value="second.get()">Second</v-radio>
        </v-radio-group>
      `),
    })
    class Page {
      plan = new Signal.State<string | null>('yearly');
      second = new Signal.State('monthly');
    }

    const { instance, host } = show(Page);
    expect(states(host)).toEqual(['unchecked']);
    expect(inputs(host)[0]!.value).toBe('monthly');

    instance.second.set('yearly');
    flushSync();
    expect(states(host)).toEqual(['checked']);
    expect(inputs(host)[0]!.value).toBe('yearly');
  });

  it('says so when a radio is written outside a group', () => {
    @Component({
      selector: 'v-loose',
      imports: [VRadio],
      render: compileTemplate(`<v-radio value="monthly">Monthly</v-radio>`),
    })
    class Loose {}

    expect(() => show(Loose)).toThrow(/<v-radio> has to be written inside <v-radio-group>/);
  });

  it('says so when two radios carry one value', () => {
    @Component({
      selector: 'v-twins',
      imports: [VRadio, VRadioGroup],
      render: compileTemplate(`
        <v-radio-group name="plan" label="Billing plan">
          <v-radio value="monthly">Monthly</v-radio>
          <v-radio value="monthly">Monthly, again</v-radio>
        </v-radio-group>
      `),
    })
    class Twins {}

    expect(() => show(Twins)).toThrow(/carry the value "monthly"/);
  });
});
