/**
 * `<v-stepper>` and `<v-step>`, driven the way a page drives them.
 *
 * The behaviour is `createStepper`'s and is tested where it lives. What is
 * left here is what this pair adds: a step drawn per tag inside the list, a
 * panel drawn per tag after it from what was written inside the tag, the
 * statuses a step reports read from the tag rather than from a function of an
 * index, the attributes the sheet's rules select on, and the primitive left
 * reachable for everything this does not offer.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Window } from 'happy-dom';
import { Component, Signal, flushSync, mount } from '@voltdev/core';
import { compileTemplate } from '@voltdev/core/jit';
import { compileComponents } from './render.js';
import { SYSTEM_COLORS, standIn } from './harness.ts';
import { VStep } from '../src/components/step.js';
import { VStepper } from '../src/components/stepper.js';
import { stepperStyles } from '../src/sheet/stepper.js';
import { FORCED_COLORS_QUERY, rulesToCss, tokensCss, wrap, type Rule } from '../src/index.ts';

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

/** A keydown as a real one arrives: from the focused step, bubbling to the list. */
function press(el: Element, key: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  el.dispatchEvent(event);
  flushSync();
  return event;
}

function click(el: HTMLElement): void {
  el.click();
  flushSync();
}

const steps = (host: HTMLElement): HTMLElement[] => [
  ...host.querySelectorAll<HTMLElement>('.volt-stepper-step'),
];

const panels = (host: HTMLElement): HTMLElement[] => [
  ...host.querySelectorAll<HTMLElement>('.volt-stepper-panel'),
];

const statuses = (host: HTMLElement): (string | null)[] =>
  steps(host).map((step) => step.getAttribute('data-status'));

/** Which panels are showing, as the page sees them. */
const shown = (host: HTMLElement): boolean[] => panels(host).map((panel) => !panel.hidden);

const labels = (host: HTMLElement): string[] =>
  steps(host).map((step) => step.querySelector('.volt-stepper-label')!.textContent ?? '');

/** Each panel named by the words of the step that labels it. */
const panelsByStep = (host: HTMLElement): string[] =>
  panels(host).map(
    (panel) =>
      document
        .getElementById(panel.getAttribute('aria-labelledby')!)
        ?.querySelector('.volt-stepper-label')?.textContent ?? '',
  );

@Component({
  selector: 'v-page',
  imports: [VStepper, VStep],
  render: compileTemplate(`
    <v-stepper
      :ref="box"
      :value="step"
      label="Checkout"
      class="mine"
      aria-describedby="checkout-help"
      :onValueChange="heard"
    >
      <v-step label="Basket" class="first" :complete="basketDone.get()"><p>Two items.</p></v-step>
      <v-step label="Delivery" description="Address and date" :errored="postcodeBad.get()">
        <p>Where to.</p>
      </v-step>
      <v-step label="Payment"><p>How to pay.</p></v-step>
      <v-step label="Review" :disabled="off.get()"><p>Check it.</p></v-step>
      <v-step label="Done"><p>Thanks.</p></v-step>
    </v-stepper>
  `),
})
class Page {
  box: VStepper | null = null;
  step = new Signal.State(0);
  basketDone = new Signal.State<boolean | undefined>(undefined);
  postcodeBad = new Signal.State(false);
  off = new Signal.State(false);
  seen: number[] = [];
  heard = (index: number): void => {
    this.seen.push(index);
  };
}

describe('v-stepper', () => {
  it('draws a step per tag in the list, and a panel per tag after it', () => {
    const { host } = show(Page);
    const nav = host.querySelector('nav')!;
    const list = host.querySelector('.volt-stepper-list')!;

    expect(nav.getAttribute('role')).toBe('navigation');
    expect(nav.getAttribute('aria-label')).toBe('Checkout');
    expect(list.tagName).toBe('OL');
    expect(list.getAttribute('role')).toBe('list');
    expect([...list.children].every((child) => child.tagName === 'LI')).toBe(true);
    expect(labels(host)).toEqual(['Basket', 'Delivery', 'Payment', 'Review', 'Done']);
    // A step inside a form submits it unless it says otherwise, and the
    // primitive cannot say it: a step is as often a link.
    expect(steps(host).every((step) => (step as HTMLButtonElement).type === 'button')).toBe(true);

    // After the landmark and never inside it: a navigation region that held
    // the whole form would announce the form as navigation.
    expect(nav.querySelector('.volt-stepper-panel')).toBeNull();
    expect(panels(host).map((panel) => panel.textContent)).toEqual([
      'Two items.',
      'Where to.',
      'How to pay.',
      'Check it.',
      'Thanks.',
    ]);
  });

  it('lands what the caller wrote on each tag on the element they can see', () => {
    const { host } = show(Page);
    const nav = host.querySelector('nav')!;

    // The `<nav>` carries the landmark, so it is what a class, a description
    // or a name written on the tag is about.
    expect([...nav.classList].sort()).toEqual(['mine', 'volt-stepper']);
    expect(nav.getAttribute('aria-describedby')).toBe('checkout-help');

    // A step's own class is on the button, beside the sheet's — not on the
    // `<li>` around it.
    expect([...steps(host)[0]!.classList].sort()).toEqual(['first', 'volt-stepper-step']);
    expect(host.querySelector('li.first')).toBeNull();
  });

  it('lands an id and a name written on either tag on the element carrying the role', () => {
    @Component({
      selector: 'v-page-host',
      imports: [VStepper, VStep],
      render: compileTemplate(`
        <v-stepper id="flow" class="mine" aria-label="Checkout" data-flow="a">
          <v-step id="basket" class="first" aria-label="Basket, two items" label="Basket">
            <p>Two items.</p>
          </v-step>
          <v-step label="Delivery"><p>Where to.</p></v-step>
        </v-stepper>
      `),
    })
    class HostPage {}

    const { host } = show(HostPage);
    const nav = host.querySelector('nav')!;
    const [basket] = steps(host);

    // The landmark: its id, its class and its name, and nothing of them on
    // the list inside it or on the panels after it.
    expect(nav.id).toBe('flow');
    expect([...nav.classList].sort()).toEqual(['mine', 'volt-stepper']);
    expect(nav.getAttribute('aria-label')).toBe('Checkout');
    expect(nav.getAttribute('data-flow')).toBe('a');
    expect(host.querySelectorAll('#flow, .mine, [data-flow]')).toHaveLength(1);

    // The step: the button, never the `<li>` around it or the panel it shows.
    expect(basket!.id).toBe('basket');
    expect(basket!.getAttribute('aria-label')).toBe('Basket, two items');
    expect(basket!.classList.contains('first')).toBe(true);
    expect(host.querySelectorAll('[aria-label="Basket, two items"], .first')).toHaveLength(1);
    expect(panels(host)[0]!.hasAttribute('aria-label')).toBe(false);
  });

  it('pairs each step with its own panel, by the primitive’s ids', () => {
    const { host } = show(Page);

    for (const [at, step] of steps(host).entries()) {
      expect(document.getElementById(step.getAttribute('aria-controls')!)).toBe(panels(host)[at]);
      expect(panels(host)[at]!.getAttribute('aria-labelledby')).toBe(step.id);
      expect(panels(host)[at]!.getAttribute('role')).toBe('group');
    }
  });

  it('keeps an id the caller gave a step, and names its panel by it', () => {
    @Component({
      selector: 'v-page-ids',
      imports: [VStepper, VStep],
      render: compileTemplate(`
        <v-stepper>
          <v-step label="Basket" :id="name.get()"><p>Two items.</p></v-step>
          <v-step label="Delivery"><p>Where to.</p></v-step>
        </v-stepper>
      `),
    })
    class IdsPage {
      name = new Signal.State('basket-step');
    }

    const { instance, host } = show(IdsPage);
    // The primitive writes an id of its own on every step, and the caller's
    // would have been written over by it.
    expect(steps(host)[0]!.id).toBe('basket-step');
    expect(panels(host)[0]!.getAttribute('aria-labelledby')).toBe('basket-step');
    expect(steps(host)[1]!.id).not.toBe('');
    expect(panels(host)[1]!.getAttribute('aria-labelledby')).toBe(steps(host)[1]!.id);

    instance.name.set('first-step');
    flushSync();
    expect(steps(host)[0]!.id).toBe('first-step');
    expect(panels(host)[0]!.getAttribute('aria-labelledby')).toBe('first-step');
  });

  it('writes every status the sheet draws a step by', () => {
    const { instance, host } = show(Page);
    const [basket, delivery, , review] = steps(host);
    const marker = (step: HTMLElement): string =>
      step.querySelector('.volt-stepper-number')!.textContent ?? '';
    const said = (step: HTMLElement): string =>
      step.querySelector('.volt-stepper-status')!.textContent ?? '';

    expect(statuses(host)).toEqual(['current', 'upcoming', 'upcoming', 'upcoming', 'upcoming']);
    expect(basket!.getAttribute('aria-current')).toBe('step');
    expect(delivery!.hasAttribute('aria-current')).toBe(false);
    expect(steps(host).map(marker)).toEqual(['1', '2', '3', '4', '5']);
    expect(said(basket!)).toBe('Current step');
    expect(said(delivery!)).toBe('Not started');
    // The marker is drawing, and the words are what is read.
    expect(basket!.querySelector('.volt-stepper-marker')!.getAttribute('aria-hidden')).toBe('true');

    // Linear, so every step ahead is one the user has not earned: announced
    // as unavailable, and still focusable so it can be read ahead.
    expect(steps(host).slice(1).map((step) => step.getAttribute('aria-disabled'))).toEqual([
      'true',
      'true',
      'true',
      'true',
    ]);
    expect(steps(host).some((step) => step.hasAttribute('data-disabled'))).toBe(false);
    expect(shown(host)).toEqual([true, false, false, false, false]);

    instance.box!.stepper.next();
    flushSync();
    expect(statuses(host)).toEqual(['complete', 'current', 'upcoming', 'upcoming', 'upcoming']);
    expect(said(basket!)).toBe('Completed');
    expect(basket!.hasAttribute('aria-disabled')).toBe(false);
    expect(shown(host)).toEqual([false, true, false, false, false]);

    // An error is said over being current, and the step is still the one the
    // user is on — which is why the sheet reads current from `aria-current`.
    instance.postcodeBad.set(true);
    flushSync();
    expect(delivery!.getAttribute('data-status')).toBe('error');
    expect(delivery!.getAttribute('aria-current')).toBe('step');
    expect(marker(delivery!)).toBe('!');
    expect(said(delivery!)).toBe('Error');

    instance.off.set(true);
    flushSync();
    expect(review!.getAttribute('data-disabled')).toBe('');
    expect(review!.getAttribute('aria-disabled')).toBe('true');
    // The package's rule for a control that is off: it keeps its place in the
    // accessibility tree rather than being taken out of the platform's.
    expect(review!.hasAttribute('disabled')).toBe(false);
  });

  it('draws a line after every step but the last, hidden from the reader', () => {
    const { host } = show(Page);
    const separators = [...host.querySelectorAll('.volt-stepper-separator')];

    expect(separators).toHaveLength(4);
    expect(separators.every((line) => line.getAttribute('aria-hidden') === 'true')).toBe(true);
    expect(separators.every((line) => line.getAttribute('data-orientation') === 'horizontal')).toBe(
      true,
    );
    // Straight after the step, which is where the sheet looks for the status
    // of the step it leads away from.
    expect(separators[0]!.previousElementSibling).toBe(steps(host)[0]);
    expect(host.querySelector('li:last-child .volt-stepper-separator')).toBeNull();
  });

  it('refuses a step the user has not earned, and takes them back to one they have', () => {
    const { instance, host } = show(Page);

    click(steps(host)[2]!);
    expect(instance.step.get()).toBe(0);
    // Not even the next one: it is reached by finishing this one, which is
    // what the flow's own Continue does.
    click(steps(host)[1]!);
    expect(instance.step.get()).toBe(0);

    instance.box!.stepper.next();
    instance.box!.stepper.next();
    flushSync();
    expect(instance.step.get()).toBe(2);

    click(steps(host)[0]!);
    expect(instance.step.get()).toBe(0);
    // Going back does not lose the way forward again.
    click(steps(host)[2]!);
    expect(instance.step.get()).toBe(2);
    click(steps(host)[3]!);
    expect(instance.step.get()).toBe(2);
  });

  it('asks each step whether it is complete, and falls back to how far the user has been', () => {
    const { instance, host } = show(Page);

    // Done somewhere else, before the user got here: complete, and in a linear
    // flow that is also what lets them select the step after it.
    instance.basketDone.set(true);
    flushSync();
    expect(steps(host)[1]!.hasAttribute('aria-disabled')).toBe(false);
    click(steps(host)[1]!);
    expect(instance.step.get()).toBe(1);
    expect(statuses(host).slice(0, 2)).toEqual(['complete', 'current']);

    // Filled in and then invalidated: not complete, whatever the user has
    // walked past.
    instance.basketDone.set(false);
    flushSync();
    expect(statuses(host)[0]).toBe('upcoming');

    // And a step that says nothing is judged by the default again.
    instance.basketDone.set(undefined);
    flushSync();
    expect(statuses(host)[0]).toBe('complete');
  });

  it('steps over a step that cannot be used, and refuses it by click', () => {
    const { instance, host } = show(Page);
    instance.off.set(true);
    instance.step.set(2);
    flushSync();

    instance.box!.stepper.next();
    flushSync();
    expect(instance.step.get()).toBe(4);

    click(steps(host)[3]!);
    expect(instance.step.get()).toBe(4);

    // And takes the refusal back when the caller's signal does.
    instance.off.set(false);
    flushSync();
    expect(steps(host)[3]!.hasAttribute('data-disabled')).toBe(false);
    click(steps(host)[3]!);
    expect(instance.step.get()).toBe(3);
  });

  it('follows the arrow keys, and selects only a step the user may go to', () => {
    const { instance, host } = show(Page);
    const [basket, delivery, payment, review, done] = steps(host);
    instance.off.set(true);
    flushSync();

    basket!.focus();
    press(basket!, 'ArrowRight');
    // Focus moves; the selection does not. A step is chosen, not passed over.
    expect(document.activeElement).toBe(delivery);
    expect(instance.step.get()).toBe(0);

    // Not earned yet, so Enter there changes nothing.
    expect(press(delivery!, 'Enter').defaultPrevented).toBe(true);
    expect(instance.step.get()).toBe(0);

    press(delivery!, 'ArrowRight');
    expect(document.activeElement).toBe(payment);
    // The disabled step is skipped; one the flow only refuses is not.
    press(payment!, 'ArrowRight');
    expect(document.activeElement).toBe(done);
    expect(review!.getAttribute('tabindex')).toBe('-1');

    press(done!, 'Home');
    expect(document.activeElement).toBe(basket);
    press(basket!, 'End');
    expect(document.activeElement).toBe(done);

    // One tab stop for the whole list, on the step focus is on.
    expect(steps(host).filter((step) => step.getAttribute('tabindex') === '0')).toEqual([done]);

    // An ArrowDown a horizontal list did not use must still scroll the page.
    expect(press(done!, 'ArrowDown').defaultPrevented).toBe(false);

    instance.box!.stepper.next();
    flushSync();
    press(done!, 'Home');
    press(basket!, ' ');
    expect(instance.step.get()).toBe(0);
    press(basket!, 'ArrowRight');
    press(delivery!, 'Enter');
    expect(instance.step.get()).toBe(1);
  });

  describe('focus, when the step changes under it', () => {
    @Component({
      selector: 'v-page-focus',
      imports: [VStepper, VStep],
      render: compileTemplate(`
        <v-stepper :ref="box" :value="step">
          <v-step label="Basket"><button class="continue" :click="next">Continue</button></v-step>
          <v-step label="Delivery">
            <button class="back" :click="back">Back</button>
            <input class="postcode" />
          </v-step>
          <v-step label="Payment"><p>How to pay.</p></v-step>
        </v-stepper>
        <button class="outside" :click="next">Skip ahead</button>
      `),
    })
    class FocusPage {
      box: VStepper | null = null;
      step = new Signal.State(0);
      next = (): void => this.box!.stepper.next();
      back = (): void => this.box!.stepper.previous();
    }

    /** Where focus is, as a browser would leave it: nowhere, if its element is hidden. */
    const focused = (): Element | null => {
      const active = document.activeElement;
      return active?.closest('[hidden]') ? document.body : active;
    };

    it('takes it from the Continue that hid its own panel, to the step now shown', () => {
      const { host } = show(FocusPage);
      const continuing = host.querySelector<HTMLButtonElement>('.continue')!;

      continuing.focus();
      click(continuing);
      // Not `<body>`, which is the top of the document and no way back into
      // the flow: the step the user is on now, which says which one it is,
      // and from which Tab reaches the panel it shows.
      expect(focused()).toBe(steps(host)[1]);
      expect(steps(host)[1]!.getAttribute('tabindex')).toBe('0');

      const back = host.querySelector<HTMLButtonElement>('.back')!;
      back.focus();
      click(back);
      expect(focused()).toBe(steps(host)[0]);
    });

    it('takes it out of a hidden panel when the page moves the step itself', () => {
      const { instance, host } = show(FocusPage);
      instance.step.set(1);
      flushSync();
      host.querySelector<HTMLInputElement>('.postcode')!.focus();

      // A flow driven by the URL, or a Continue that writes the signal.
      instance.step.set(2);
      flushSync();
      expect(focused()).toBe(steps(host)[2]);
    });

    it('leaves focus that was never in a panel where it is', () => {
      const { host } = show(FocusPage);
      const outside = host.querySelector<HTMLButtonElement>('.outside')!;

      outside.focus();
      click(outside);
      expect(document.activeElement).toBe(outside);

      // A step chosen from the list keeps focus on the step chosen.
      steps(host)[0]!.focus();
      click(steps(host)[0]!);
      expect(document.activeElement).toBe(steps(host)[0]);
    });

    it('leaves focus the page put in the panel now shown', () => {
      const { instance, host } = show(FocusPage);
      const postcode = host.querySelector<HTMLInputElement>('.postcode')!;
      host.querySelector<HTMLButtonElement>('.continue')!.focus();

      // The page's own choice of where the user goes next, made in the same
      // turn as the move: that is what it meant, and it is not stranded.
      instance.box!.stepper.next();
      postcode.focus();
      flushSync();
      expect(document.activeElement).toBe(postcode);
    });
  });

  it('takes a state written as an attribute in the words that say so', () => {
    // An attribute is a string, and `errored="true"` asks for an error in the
    // words that say so. Read as `=== true` it was quietly nothing: the step
    // went on reporting itself current, and the one written `disabled="true"`
    // stayed selectable.
    @Component({
      selector: 'v-page-written',
      imports: [VStepper, VStep],
      render: compileTemplate(`
        <v-stepper loop="true" :linear="false">
          <v-step label="One" errored="true"></v-step>
          <v-step label="Two" disabled="true"></v-step>
          <v-step label="Three" disabled="disabled"></v-step>
          <v-step label="Four"></v-step>
        </v-stepper>
      `),
    })
    class WrittenPage {}

    const { host } = show(WrittenPage);
    const [one, two, three, four] = steps(host);

    expect(one!.getAttribute('data-status')).toBe('error');
    expect(one!.querySelector('.volt-stepper-number')!.textContent).toBe('!');
    expect(two!.getAttribute('data-disabled')).toBe('');
    expect(three!.getAttribute('data-disabled')).toBe('');
    click(two!);
    expect(one!.getAttribute('aria-current')).toBe('step');

    // `loop="true"` wraps, as `loop` and `:loop="true"` do.
    one!.focus();
    press(one!, 'ArrowLeft');
    expect(document.activeElement).toBe(four);
  });

  it('counts the steps it has, and goes no further than the last', () => {
    @Component({
      selector: 'v-page-count',
      imports: [VStepper, VStep],
      render: compileTemplate(`
        <v-stepper :ref="box" :value="step">
          <v-step label="One"></v-step>
          <v-step label="Two"></v-step>
          <v-step label="Three"></v-step>
          <v-step :if="more.get()" label="Four"></v-step>
        </v-stepper>
      `),
    })
    class CountPage {
      box: VStepper | null = null;
      step = new Signal.State(0);
      more = new Signal.State(false);
    }

    const { instance } = show(CountPage);
    const stepper = instance.box!.stepper;
    expect(stepper.count()).toBe(3);
    expect(stepper.stepLabel(0)).toBe('Step 1 of 3');

    for (let at = 0; at < 5; at++) stepper.next();
    flushSync();
    // Continue on the last step has nowhere to go, rather than onto a step
    // with no tag, no panel and nothing current in the list.
    expect(instance.step.get()).toBe(2);
    expect(stepper.isLast()).toBe(true);

    instance.more.set(true);
    flushSync();
    expect(stepper.count()).toBe(4);
    expect(stepper.isLast()).toBe(false);
  });

  it('stops at the ends unless the caller asked it to wrap', () => {
    @Component({
      selector: 'v-page-loop',
      imports: [VStepper, VStep],
      render: compileTemplate(`
        <v-stepper :loop="wraps">
          <v-step label="One"></v-step>
          <v-step label="Two"></v-step>
          <v-step label="Three"></v-step>
        </v-stepper>
      `),
    })
    class LoopPage {
      wraps = true;
    }

    @Component({
      selector: 'v-page-ends',
      imports: [VStepper, VStep],
      render: compileTemplate(`
        <v-stepper>
          <v-step label="One"></v-step>
          <v-step label="Two"></v-step>
        </v-stepper>
      `),
    })
    class EndsPage {}

    const ends = show(EndsPage).host;
    const [one] = steps(ends);
    one!.focus();
    press(one!, 'ArrowLeft');
    expect(document.activeElement).toBe(one);
    unmount?.();

    const loops = show(LoopPage).host;
    const first = steps(loops)[0]!;
    first.focus();
    press(first, 'ArrowLeft');
    expect(document.activeElement).toBe(steps(loops)[2]);
  });

  it('turns the axis over to the list, the keys and the lines', () => {
    @Component({
      selector: 'v-page-vertical',
      imports: [VStepper, VStep],
      render: compileTemplate(`
        <v-stepper orientation="vertical">
          <v-step label="One"></v-step>
          <v-step label="Two"></v-step>
        </v-stepper>
      `),
    })
    class VerticalPage {}

    const { host } = show(VerticalPage);
    const [one, two] = steps(host);
    expect(host.querySelector('.volt-stepper-list')!.getAttribute('data-orientation')).toBe(
      'vertical',
    );
    expect(host.querySelector('.volt-stepper-separator')!.getAttribute('data-orientation')).toBe(
      'vertical',
    );

    one!.focus();
    expect(press(one!, 'ArrowDown').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(two);
    expect(press(two!, 'ArrowRight').defaultPrevented).toBe(false);
  });

  it('goes anywhere when the caller says the order does not matter', () => {
    @Component({
      selector: 'v-page-free',
      imports: [VStepper, VStep],
      render: compileTemplate(`
        <v-stepper :value="step" :linear="false">
          <v-step label="Profile"></v-step>
          <v-step label="Password"></v-step>
          <v-step label="Notifications"></v-step>
        </v-stepper>
      `),
    })
    class FreePage {
      step = new Signal.State(0);
    }

    const { instance, host } = show(FreePage);
    expect(steps(host).some((step) => step.hasAttribute('aria-disabled'))).toBe(false);

    click(steps(host)[2]!);
    expect(instance.step.get()).toBe(2);
    // Nothing was done on the way, and passing a step is not doing it — but
    // with no `complete` of its own a step is judged by how far the user has
    // been, which is past both.
    expect(statuses(host)).toEqual(['complete', 'complete', 'current']);
  });

  it('is the caller’s signal on both sides', () => {
    const { instance, host } = show(Page);

    // A flow driven by the URL moves the step without calling anything here,
    // and the steps behind it count as reached all the same.
    instance.step.set(3);
    flushSync();
    expect(statuses(host)).toEqual(['complete', 'complete', 'complete', 'current', 'upcoming']);
    expect(shown(host)).toEqual([false, false, false, true, false]);

    click(steps(host)[1]!);
    expect(instance.step.get()).toBe(1);
    click(steps(host)[3]!);
    expect(instance.step.get()).toBe(3);
  });

  it('reports the moves a user made, and not the page’s own', () => {
    const { instance, host } = show(Page);

    instance.box!.stepper.next();
    flushSync();
    click(steps(host)[0]!);
    expect(instance.seen).toEqual([1, 0]);

    // The page wrote its own signal, so it already knows.
    instance.step.set(1);
    flushSync();
    expect(instance.seen).toEqual([1, 0]);
  });

  it('hands the primitive itself to whoever needs more than this offers', () => {
    const { instance, host } = show(Page);
    const stepper = instance.box!.stepper;

    expect(stepper.value()).toBe(0);
    expect(stepper.count()).toBe(5);
    expect(stepper.isFirst()).toBe(true);

    stepper.next();
    flushSync();
    expect(steps(host)[1]!.getAttribute('aria-current')).toBe('step');
    stepper.previous();
    flushSync();
    expect(steps(host)[0]!.getAttribute('aria-current')).toBe('step');
    expect(stepper.stepLabel(1)).toBe('Step 2 of 5');
  });

  it('starts where the caller said, written as an attribute or as a number', () => {
    @Component({
      selector: 'v-page-default',
      imports: [VStepper, VStep],
      render: compileTemplate(`
        <v-stepper :ref="written" defaultValue="2">
          <v-step label="One"></v-step><v-step label="Two"></v-step><v-step label="Three"></v-step>
        </v-stepper>
        <v-stepper :ref="bound" :defaultValue="1">
          <v-step label="One"></v-step><v-step label="Two"></v-step><v-step label="Three"></v-step>
        </v-stepper>
      `),
    })
    class DefaultPage {
      written: VStepper | null = null;
      bound: VStepper | null = null;
    }

    const { instance, host } = show(DefaultPage);
    // A number, which is what the position is compared as; `'10' < '9'` is
    // the bug a string would keep.
    expect(instance.written!.position.get()).toBe(2);
    expect(instance.bound!.position.get()).toBe(1);
    expect(statuses(host)).toEqual([
      'complete',
      'complete',
      'current',
      'complete',
      'current',
      'upcoming',
    ]);
  });

  it('refuses a value that is not a signal, and says what to write instead', () => {
    @Component({
      selector: 'v-page-number',
      imports: [VStepper, VStep],
      render: compileTemplate(`
        <v-stepper :value="1"><v-step label="One"></v-step></v-stepper>
      `),
    })
    class NumberPage {}

    expect(() => show(NumberPage)).toThrow(/`value` on <v-stepper>[\s\S]*defaultValue/);
    unmount?.();
    document.body.innerHTML = '';

    // A computed signal can be read and not written, and the stepper writes
    // the step a user moves to. Said as that, not as `[object Object]`.
    @Component({
      selector: 'v-page-computed',
      imports: [VStepper, VStep],
      render: compileTemplate(`
        <v-stepper :value="derived"><v-step label="One"></v-step></v-stepper>
      `),
    })
    class ComputedPage {
      derived = new Signal.Computed(() => 0);
    }

    let thrown: unknown;
    try {
      show(ComputedPage);
    } catch (error) {
      thrown = error;
    }
    expect(String(thrown)).not.toContain('[object Object]');
    expect(String(thrown)).toMatch(/cannot write[\s\S]*defaultValue/);
  });

  it('names the landmark, and follows the name it was bound to', () => {
    @Component({
      selector: 'v-page-named',
      imports: [VStepper, VStep],
      render: compileTemplate(`
        <h2 id="flow-heading">Checkout</h2>
        <v-stepper :label="name.get()"><v-step label="One"></v-step></v-stepper>
        <v-stepper><v-step label="One"></v-step></v-stepper>
        <v-stepper :aria-label="name.get()" label="Unheard"><v-step label="1"></v-step></v-stepper>
        <v-stepper labelledBy="flow-heading" label="Unheard"><v-step label="1"></v-step></v-stepper>
        <v-stepper aria-labelledby="flow-heading"><v-step label="One"></v-step></v-stepper>
      `),
    })
    class NamedPage {
      name = new Signal.State('Checkout');
    }

    const { instance, host } = show(NamedPage);
    const navs = [...host.querySelectorAll('nav')];
    const names = (): [string | null, string | null][] =>
      navs.map((nav) => [nav.getAttribute('aria-label'), nav.getAttribute('aria-labelledby')]);

    expect(names()).toEqual([
      ['Checkout', null],
      // A landmark with no name is one of several a screen reader lists with
      // nothing to tell them apart, so the primitive gives it one.
      ['Progress', null],
      // What the caller wrote in ARIA wins over the prop saying the same.
      ['Checkout', null],
      // One name only: a reference takes the default off, which would
      // otherwise drift out of date where nobody hears it.
      [null, 'flow-heading'],
      [null, 'flow-heading'],
    ]);

    instance.name.set('Returns');
    flushSync();
    expect(navs[0]!.getAttribute('aria-label')).toBe('Returns');
    expect(navs[2]!.getAttribute('aria-label')).toBe('Returns');
  });

  it('follows a reference to its name, in either spelling, and falls back when it goes', () => {
    @Component({
      selector: 'v-page-referenced',
      imports: [VStepper, VStep],
      render: compileTemplate(`
        <h2 id="first-heading">Checkout</h2>
        <h2 id="second-heading">Returns</h2>
        <v-stepper :labelledBy="heading.get()"><v-step label="One"></v-step></v-stepper>
        <v-stepper :aria-labelledby="heading.get()"><v-step label="One"></v-step></v-stepper>
      `),
    })
    class ReferencedPage {
      heading = new Signal.State<string | undefined>('first-heading');
    }

    const { instance, host } = show(ReferencedPage);
    const navs = [...host.querySelectorAll('nav')];
    const names = (): [string | null, string | null][] =>
      navs.map((nav) => [nav.getAttribute('aria-label'), nav.getAttribute('aria-labelledby')]);

    expect(names()).toEqual([
      [null, 'first-heading'],
      [null, 'first-heading'],
    ]);

    instance.heading.set('second-heading');
    flushSync();
    expect(names()).toEqual([
      [null, 'second-heading'],
      [null, 'second-heading'],
    ]);

    // With the reference gone, the landmark is not left with no name at all.
    instance.heading.set(undefined);
    flushSync();
    expect(names()).toEqual([
      ['Progress', null],
      ['Progress', null],
    ]);
  });

  it('says each status in the words it was given', () => {
    @Component({
      selector: 'v-page-words',
      imports: [VStepper, VStep],
      render: compileTemplate(`
        <v-stepper :statusLabel="words.get()">
          <v-step label="Un"></v-step>
          <v-step label="Deux"></v-step>
        </v-stepper>
      `),
    })
    class WordsPage {
      words = new Signal.State<(status: string) => string>((status) =>
        status === 'current' ? 'Étape en cours' : 'Pas commencée',
      );
    }

    const { instance, host } = show(WordsPage);
    const said = (): string[] =>
      [...host.querySelectorAll('.volt-stepper-status')].map((each) => each.textContent ?? '');
    expect(said()).toEqual(['Étape en cours', 'Pas commencée']);

    instance.words.set((status) => `[${status}]`);
    flushSync();
    expect(said()).toEqual(['[current]', '[upcoming]']);
  });

  it('draws the words a step was given, and follows them', () => {
    @Component({
      selector: 'v-page-label',
      imports: [VStepper, VStep],
      render: compileTemplate(`
        <v-stepper>
          <v-step :label="name.get()" :description="note.get()"></v-step>
          <v-step label="Payment">
            <template :slot-label><b>Pay</b>ment</template>
            <p>Body</p>
          </v-step>
        </v-stepper>
      `),
    })
    class LabelPage {
      name = new Signal.State('Delivery');
      note = new Signal.State('Address and date');
    }

    const { instance, host } = show(LabelPage);
    const description = (): Element | null => host.querySelector('.volt-stepper-description');
    expect(labels(host)[0]).toBe('Delivery');
    expect(description()!.textContent).toBe('Address and date');

    instance.name.set('Shipping');
    instance.note.set('');
    flushSync();
    expect(labels(host)[0]).toBe('Shipping');
    // Not an empty line under the label: no description, no element.
    expect(description()).toBeNull();

    // The `label` slot is the step's own markup; the content of the tag stays
    // the panel, which is the larger of the two by far.
    expect(steps(host)[1]!.querySelector('b')!.textContent).toBe('Pay');
    expect(panels(host)[1]!.textContent).toBe('Body');
  });

  it('keeps the panels and the lines in step with a step written later', () => {
    @Component({
      selector: 'v-page-grown',
      imports: [VStepper, VStep],
      render: compileTemplate(`
        <v-stepper>
          <v-step label="First"></v-step>
          <v-step :for="name in extra.get()" :key="name" :label="name"></v-step>
          <v-step :if="closing.get()" label="Last"></v-step>
        </v-stepper>
      `),
    })
    class GrownPage {
      extra = new Signal.State<string[]>([]);
      closing = new Signal.State(true);
    }

    const { instance, host } = show(GrownPage);
    instance.extra.set(['Middle']);
    flushSync();

    // A step that registers last is not a step that is drawn last.
    expect(labels(host)).toEqual(['First', 'Middle', 'Last']);
    expect(panelsByStep(host)).toEqual(['First', 'Middle', 'Last']);
    expect(steps(host).map((step) => step.querySelector('.volt-stepper-number')!.textContent))
      .toEqual(['1', '2', '3']);

    // The step that is last now has no line after it, and the one that was
    // last has one.
    instance.closing.set(false);
    flushSync();
    expect(host.querySelectorAll('.volt-stepper-separator')).toHaveLength(1);
    expect(host.querySelector('li:last-child .volt-stepper-separator')).toBeNull();
  });

  it('keeps what each panel holds with its own step when one is written before it', () => {
    // A panel is kept per step, not per position: a step written before it
    // moves the panel along, with its content and with whatever the user
    // typed there — rather than leaving it where it was, now named by the new
    // step and showing the old one's fields under it.
    @Component({
      selector: 'v-page-kept',
      imports: [VStepper, VStep],
      render: compileTemplate(`
        <v-stepper :linear="false">
          <v-step label="First"><input class="first" /></v-step>
          <v-step :for="name in extra.get()" :key="name" :label="name"><input :class="name" /></v-step>
          <v-step label="Last"><input class="last" /></v-step>
        </v-stepper>
      `),
    })
    class KeptPage {
      extra = new Signal.State<string[]>([]);
    }

    const { instance, host } = show(KeptPage);
    const typed = host.querySelector<HTMLInputElement>('input.last')!;
    typed.value = '1 High Street';

    instance.extra.set(['Middle']);
    flushSync();

    const held = panels(host).map((panel) => panel.querySelector('input')!.className);
    expect(panelsByStep(host)).toEqual(['First', 'Middle', 'Last']);
    expect(held).toEqual(['first', 'Middle', 'last']);
    expect(panels(host)[2]!.querySelector('input')).toBe(typed);
    expect(typed.value).toBe('1 High Street');
  });

  it('refuses to be a step of nothing', () => {
    @Component({
      selector: 'v-page-loose',
      imports: [VStep],
      render: compileTemplate(`<ol><v-step label="One"></v-step></ol>`),
    })
    class LoosePage {}

    expect(() => show(LoosePage)).toThrow(/<v-step> has to be written inside <v-stepper>/);
  });

  it('draws the check from edges that turn the way `rotate` does, whichever way the text runs', () => {
    // `rotate` is physical: it turns the box the same way in a right-to-left
    // page as in a left-to-right one. An edge named along the text is not —
    // `border-inline-end` is the right edge in one and the left in the other —
    // so a check drawn from it and turned is a check in English and a `<` in
    // Arabic: a finished step marked with a back arrow. happy-dom keeps the
    // two spellings apart instead of mapping one onto the other, so this is
    // asserted on the sheet rather than on a computed style it would not
    // compute.
    const check = [...stepperStyles.rules, ...stepperStyles.forcedColors].filter((rule) =>
      rule.selector.endsWith('.volt-stepper-check'),
    );
    const edges = check.flatMap((rule) =>
      Object.keys(rule.declarations).filter((property) => property.startsWith('border-')),
    );

    // Something to check, so that a check drawn some other way cannot pass
    // this by having no edges at all.
    expect(edges).toContain('border-bottom-width');
    expect(edges).toContain('border-right-width');
    for (const property of edges) expect(property).toMatch(/^border-(top|right|bottom|left)-/);
  });

  it('wraps a list too long for its width, rather than drawing one step over the next', () => {
    // Measured in Chrome at 360px, the width of a phone, with the demo's four
    // steps: each item was allowed to shrink below its own button, so the
    // button ran on over the line after it and under the next step, and the
    // page was 366px wide. happy-dom lays nothing out, so what is held here is
    // the pair of declarations that decides it.
    const declared = (selector: string): Record<string, string> =>
      stepperStyles.rules.find((rule) => rule.selector === selector)?.declarations ?? {};

    expect(declared('.volt-stepper-item')['min-inline-size']).toBeUndefined();
    expect(declared('.volt-stepper-list')['flex-wrap']).toBe('wrap');
    // A wrapped row sits apart from the one above it.
    expect(declared('.volt-stepper-list')['row-gap']).toBe('var(--volt-space-2)');
  });

  it('draws every marker in a pair of colours the forced palette makes legible together', async () => {
    // A forced palette promises contrast only between the colours it pairs:
    // text on `Canvas`, and `HighlightText` on `Highlight`. The marker of a
    // complete step is filled with `Highlight`, and a rule written for another
    // state that sets the marker's colour on its own — the one for a step the
    // flow refuses, which a step marked complete ahead of time also is —
    // draws the check in `GrayText` on that fill, which the palette never
    // promised anyone could see.
    @Component({
      selector: 'v-page-forced',
      imports: [VStepper, VStep],
      render: compileTemplate(`
        <v-stepper :defaultValue="1">
          <v-step label="Behind"></v-step>
          <v-step label="Here"></v-step>
          <v-step label="Ahead"></v-step>
          <v-step label="Done elsewhere" :complete="true"></v-step>
          <v-step label="Broken ahead" :errored="true"></v-step>
          <v-step label="Out of use" :disabled="true"></v-step>
        </v-stepper>
        <v-stepper>
          <v-step label="Broken here" :errored="true"></v-step>
          <v-step label="Next"></v-step>
        </v-stepper>
      `),
    })
    class ForcedPage {}

    const { host } = show(ForcedPage);
    const drawn = steps(host).map(
      (step) =>
        `${step.getAttribute('data-status')}` +
        `${step.getAttribute('aria-disabled') === 'true' ? ', refused' : ''}`,
    );
    // Every combination the markers are drawn in, so the check below cannot
    // pass by finding fewer of them.
    expect(drawn).toEqual([
      'complete',
      'current',
      'upcoming, refused',
      'complete, refused',
      'error, refused',
      'upcoming, refused',
      'error',
      'upcoming, refused',
    ]);

    const system = (value: string): string =>
      SYSTEM_COLORS.includes(value) ? standIn(value) : value;
    const standIns = (rules: readonly Rule[]): Rule[] =>
      rules.map((rule) => ({
        selector: rule.selector,
        declarations: Object.fromEntries(
          Object.entries(rule.declarations).map(([property, value]) => [property, system(value)]),
        ),
      }));
    const forced = new Window({ settings: { device: { forcedColors: 'active' } } });
    const sheet = forced.document.createElement('style');
    sheet.textContent = [
      tokensCss(),
      rulesToCss(standIns(stepperStyles.rules)),
      wrap(FORCED_COLORS_QUERY, rulesToCss(standIns(stepperStyles.forcedColors), '  ')),
    ].join('\n');
    forced.document.head.append(sheet);
    forced.document.body.innerHTML = host.innerHTML;

    const named = new Map(SYSTEM_COLORS.map((name) => [standIn(name), name]));
    const pairs = [...forced.document.querySelectorAll('.volt-stepper-step')].map((step) => {
      const style = forced.getComputedStyle(step.querySelector('.volt-stepper-marker')!);
      const on = named.get(style.getPropertyValue('background-color')) ?? 'unnamed';
      const ink = named.get(style.getPropertyValue('color')) ?? 'unnamed';
      return `${step.querySelector('.volt-stepper-label')!.textContent}: ${ink} on ${on}`;
    });
    const legible: Record<string, readonly string[]> = {
      Canvas: ['CanvasText', 'GrayText', 'Highlight'],
      Highlight: ['HighlightText'],
    };
    const illegible = pairs.filter((pair) => {
      const [, ink, on] = /: (\w+) on (\w+)$/.exec(pair)!;
      return !legible[on!]?.includes(ink!);
    });
    await forced.happyDOM.close();

    expect(illegible).toEqual([]);
  });

  it('draws something for every rule the sheet writes', () => {
    // Every status at once, across both orientations — so a rule selecting on
    // an attribute nothing here writes is a rule that never runs.
    @Component({
      selector: 'v-page-every',
      imports: [VStepper, VStep],
      render: compileTemplate(`
        <v-stepper :defaultValue="2">
          <v-step label="Basket"></v-step>
          <v-step label="Delivery" :errored="true"></v-step>
          <v-step label="Payment"></v-step>
          <v-step label="Review" :complete="true"></v-step>
          <v-step label="Done" description="Nothing to do" :disabled="true"></v-step>
        </v-stepper>
        <v-stepper orientation="vertical" :defaultValue="1">
          <v-step label="One"></v-step>
          <v-step label="Two"></v-step>
        </v-stepper>
      `),
    })
    class EveryPage {}

    show(EveryPage);
    // The pointer and keyboard focus are not driven here; what is asked is
    // whether the classes and attributes around them are ones this writes.
    const unmatched = [...stepperStyles.rules, ...stepperStyles.forcedColors]
      .map((rule) => rule.selector.replaceAll(':hover', '').replaceAll(':focus-visible', ''))
      .filter((selector) => document.querySelector(selector) === null);

    expect(unmatched).toEqual([]);
  });
});
