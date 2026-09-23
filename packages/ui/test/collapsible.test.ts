/**
 * `<v-collapsible>`, driven the way a page drives it.
 *
 * The behaviour is `createCollapsible`'s and is tested where it lives. What is
 * left here is what the tag adds: a trigger and a panel, the classes and the
 * attributes the sheet's rules select on, what a caller writes landing on the
 * element with the role, every prop it forwards doing something, and the
 * primitive left reachable for everything it does not offer.
 *
 * happy-dom lays nothing out and animates nothing, so the measured height is
 * taken through a stubbed `scrollHeight` and an exit animation is what the
 * element is made to report — the numbers are arbitrary, where they end up is
 * not.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Component, Signal, flushSync, mount } from '@voltdev/core';
import { compileTemplate } from '@voltdev/core/jit';
import { COLLAPSIBLE_HEIGHT_PROPERTY } from '@voltdev/primitives';
import { compileComponents } from './render.js';
import { VCollapsible } from '../src/components/collapsible.js';
import { collapsibleStyles } from '../src/sheet/collapsible.js';
import { componentCss } from '../src/stylesheet.js';

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

/** A keydown as the user sends it: bubbling, and cancellable. */
function press(el: Element, key: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  el.dispatchEvent(event);
  flushSync();
  return event;
}

function click(el: Element): void {
  (el as HTMLElement).click();
  flushSync();
}

const root = (host: HTMLElement): HTMLElement => host.querySelector('.volt-collapsible')!;
const trigger = (host: HTMLElement): HTMLButtonElement =>
  host.querySelector<HTMLButtonElement>('.volt-collapsible-trigger')!;
const indicator = (host: HTMLElement): HTMLElement =>
  host.querySelector('.volt-collapsible-indicator')!;
const panel = (host: HTMLElement): HTMLElement | null =>
  host.querySelector('.volt-collapsible-panel');

@Component({
  selector: 'v-page',
  imports: [VCollapsible],
  render: compileTemplate(`
    <v-collapsible
      :open="open"
      :label="label.get()"
      :disabled="off.get()"
      class="mine"
      id="delivery"
      data-page="order"
      title="More about delivery"
      aria-describedby="hint"
    >
      <p>Everything leaves within a day.</p>
      <input :ref="field">
    </v-collapsible>
    <p id="hint">Opens below.</p>
  `),
})
class Page {
  open = new Signal.State(false);
  label = new Signal.State('Delivery');
  off = new Signal.State(false);
  field: HTMLInputElement | null = null;
}

describe('v-collapsible', () => {
  it('draws a trigger, and no panel until it opens', () => {
    const { instance, host } = show(Page);

    expect(root(host).contains(trigger(host))).toBe(true);
    expect(trigger(host).tagName).toBe('BUTTON');
    // A trigger inside a form submits it unless it says otherwise.
    expect(trigger(host).type).toBe('button');
    expect(trigger(host).textContent).toBe('Delivery');

    // The marker is drawn, not read: the words are the trigger's name.
    expect(trigger(host).contains(indicator(host))).toBe(true);
    expect(indicator(host).getAttribute('aria-hidden')).toBe('true');

    // Closed is not in the page at all.
    expect(panel(host)).toBeNull();

    click(trigger(host));
    expect(instance.open.get()).toBe(true);
    expect(root(host).contains(panel(host))).toBe(true);
    expect(panel(host)!.textContent).toContain('Everything leaves within a day.');
    // After the trigger, which is the order it is read in.
    expect(trigger(host).nextElementSibling).toBe(panel(host));
  });

  it('builds the panel’s content when it opens and throws it away when it closes', () => {
    const { instance, host } = show(Page);

    instance.open.set(true);
    flushSync();
    const first = instance.field!;
    first.value = 'half typed';

    instance.open.set(false);
    flushSync();
    expect(instance.field).toBeNull();

    instance.open.set(true);
    flushSync();
    // A new element with nothing in it — which is why state that has to
    // outlive a close belongs in a signal of the page's.
    expect(instance.field).not.toBe(first);
    expect(instance.field!.value).toBe('');
    expect(panel(host)!.contains(instance.field)).toBe(true);
  });

  it('lands what the caller wrote on the trigger, which is the element with the role', () => {
    const { instance, host } = show(Page);

    expect([...trigger(host).classList].sort()).toEqual(['mine', 'volt-collapsible-trigger']);
    expect(trigger(host).id).toBe('delivery');
    expect(trigger(host).getAttribute('data-page')).toBe('order');
    expect(trigger(host).title).toBe('More about delivery');
    expect(trigger(host).getAttribute('aria-describedby')).toBe('hint');

    // And none of it on the element around the trigger, which is there to be
    // laid out and says nothing to a screen reader.
    expect([...root(host).classList]).toEqual(['volt-collapsible']);
    expect(root(host).id).toBe('');
    expect(root(host).hasAttribute('data-page')).toBe(false);
    expect(root(host).hasAttribute('aria-describedby')).toBe(false);

    // All of it still theirs after every state the primitive's bag writes:
    // `:spread` rewrites the trigger each time what it reads changes.
    click(trigger(host));
    instance.off.set(true);
    flushSync();
    instance.off.set(false);
    click(trigger(host));

    expect([...trigger(host).classList].sort()).toEqual(['mine', 'volt-collapsible-trigger']);
    expect(trigger(host).id).toBe('delivery');
    expect(trigger(host).getAttribute('data-page')).toBe('order');
    expect(trigger(host).title).toBe('More about delivery');
    expect(trigger(host).getAttribute('aria-describedby')).toBe('hint');
  });

  it('names the trigger with an `aria-label` written on the tag', () => {
    @Component({
      selector: 'v-page-named',
      imports: [VCollapsible],
      render: compileTemplate(`
        <v-collapsible aria-label="Delivery details" label="More" region><p>Body</p></v-collapsible>
      `),
    })
    class NamedPage {}

    const { host } = show(NamedPage);
    // On the control, where a name means something — not on a wrapper that
    // has no role and throws it away.
    expect(trigger(host).getAttribute('aria-label')).toBe('Delivery details');
    expect(root(host).hasAttribute('aria-label')).toBe(false);

    click(trigger(host));
    expect(trigger(host).getAttribute('aria-label')).toBe('Delivery details');
    // A landmark is named by the trigger, so it takes the trigger's name too.
    expect(panel(host)!.getAttribute('aria-labelledby')).toBe(trigger(host).id);
  });

  it('keeps the id the caller chose on the trigger, and names the panel after it', () => {
    @Component({
      selector: 'v-page-id',
      imports: [VCollapsible],
      render: compileTemplate(`
        <v-collapsible :id="id.get()" label="More" :defaultOpen="true" region><p>Body</p></v-collapsible>
      `),
    })
    class IdPage {
      id = new Signal.State<string | undefined>('delivery');
    }

    const { instance, host } = show(IdPage);
    // Theirs, so a link, a test or a `for` written against it finds the
    // trigger — rather than an id minted inside the primitive that nobody
    // outside it can know.
    expect(trigger(host).id).toBe('delivery');
    expect(document.getElementById('delivery')).toBe(trigger(host));
    // The panel is named by the trigger, so by the id the trigger actually
    // carries: `aria-labelledby` pointing at an id nothing has names nothing.
    expect(panel(host)!.getAttribute('aria-labelledby')).toBe('delivery');
    expect(document.getElementById(trigger(host).getAttribute('aria-controls')!)).toBe(panel(host));

    // Followed when it is bound, the name with it.
    instance.id.set('shipping');
    flushSync();
    expect(trigger(host).id).toBe('shipping');
    expect(panel(host)!.getAttribute('aria-labelledby')).toBe('shipping');

    // And still after a close and an open, which is when the bags are rebuilt.
    click(trigger(host));
    click(trigger(host));
    expect(trigger(host).id).toBe('shipping');
    expect(panel(host)!.getAttribute('aria-labelledby')).toBe('shipping');

    // No id of theirs — unset or empty — and the primitive's stands in, with
    // the panel named after that instead.
    for (const none of [undefined, '']) {
      instance.id.set(none);
      flushSync();
      expect(trigger(host).id).toMatch(/^collapsible-trigger/);
      expect(panel(host)!.getAttribute('aria-labelledby')).toBe(trigger(host).id);
    }
  });

  it('marks the whole section with the `lang` and `dir` written on the tag, the panel as well', () => {
    @Component({
      selector: 'v-page-lang',
      imports: [VCollapsible],
      render: compileTemplate(`
        <v-collapsible lang="ar" dir="rtl" label="التوصيل" defaultOpen>
          <p>كل ما يُطلب قبل الرابعة يُشحن في اليوم نفسه.</p>
        </v-collapsible>
      `),
    })
    class ArabicPage {}

    const { host } = show(ArabicPage);
    // The tag is the section, so a language written on it is the language of
    // the words that open it and of the panel under them alike. On the
    // trigger alone, the panel would be read out in the page's voice and run
    // the page's way.
    expect(root(host).getAttribute('lang')).toBe('ar');
    expect(root(host).getAttribute('dir')).toBe('rtl');
    for (const part of [trigger(host), panel(host)!]) {
      expect(part.closest('[lang]')).toBe(root(host));
      expect(part.closest('[dir]')).toBe(root(host));
    }
  });

  it('follows a bound `lang` and `dir`, and takes each back when it is unset', () => {
    @Component({
      selector: 'v-page-lang-bound',
      imports: [VCollapsible],
      render: compileTemplate(`
        <v-collapsible :lang="lang.get()" :dir="dir.get()" label="More"><p>Body</p></v-collapsible>
      `),
    })
    class BoundPage {
      lang = new Signal.State<string | undefined>('fr');
      dir = new Signal.State<string | undefined>('ltr');
    }

    const { instance, host } = show(BoundPage);
    expect(root(host).getAttribute('lang')).toBe('fr');

    instance.lang.set('he');
    instance.dir.set('rtl');
    flushSync();
    expect(root(host).getAttribute('lang')).toBe('he');
    expect(root(host).getAttribute('dir')).toBe('rtl');

    // Empty is a language of its own — HTML reads `lang=""` as unknown, not as
    // the page's — so it is written as given.
    instance.lang.set('');
    flushSync();
    expect(root(host).getAttribute('lang')).toBe('');

    // Unset is nothing at all: the section goes back to the page's language
    // rather than being declared to be one called "undefined".
    instance.lang.set(undefined);
    instance.dir.set(undefined);
    flushSync();
    expect(root(host).hasAttribute('lang')).toBe(false);
    expect(root(host).hasAttribute('dir')).toBe(false);
    expect(trigger(host).hasAttribute('lang')).toBe(false);
    expect(trigger(host).hasAttribute('dir')).toBe(false);
  });

  it('writes every state the sheet draws a section by', () => {
    stubScrollHeight(120);
    const { instance, host } = show(Page);

    expect(trigger(host).getAttribute('data-state')).toBe('closed');
    expect(trigger(host).getAttribute('aria-expanded')).toBe('false');
    expect(trigger(host).hasAttribute('data-disabled')).toBe(false);
    expect(trigger(host).hasAttribute('aria-disabled')).toBe(false);

    click(trigger(host));
    expect(trigger(host).getAttribute('data-state')).toBe('open');
    expect(trigger(host).getAttribute('aria-expanded')).toBe('true');
    expect(panel(host)!.getAttribute('data-state')).toBe('open');
    // The height the keyframes travel to. `auto` interpolates against nothing,
    // so without this number on the element the sheet animates nothing at all.
    expect(panel(host)!.style.getPropertyValue(COLLAPSIBLE_HEIGHT_PROPERTY)).toBe('120px');

    instance.off.set(true);
    flushSync();
    expect(trigger(host).getAttribute('data-disabled')).toBe('');
    expect(trigger(host).getAttribute('aria-disabled')).toBe('true');
    expect(panel(host)!.getAttribute('data-disabled')).toBe('');
    // The package's rule for a disabled control: it keeps its place in the
    // tab order and the accessibility tree rather than leaving both.
    expect(trigger(host).hasAttribute('disabled')).toBe(false);
  });

  it('renders something for every rule its sheet has, in one state or another', async () => {
    // A rule nothing matches is a state a user never sees. Focus is a state
    // no test drives, so what is asked is whether the element and attributes
    // around it are ones this renders.
    const selectors = [...collapsibleStyles.rules, ...collapsibleStyles.forcedColors]
      .flatMap((rule) => rule.selector.split(','))
      .map((selector) => selector.trim().replaceAll(':focus-visible', ''));
    const unmatched = new Set(selectors);
    const look = (): void => {
      for (const selector of unmatched) if (document.querySelector(selector)) unmatched.delete(selector);
    };

    const { instance, host } = show(Page);
    look();
    click(trigger(host));
    look();
    // Closing, which is the state the collapse animates out of.
    const exit = pretendAnimating(panel(host)!);
    click(trigger(host));
    look();
    await exit.finish();
    instance.off.set(true);
    flushSync();
    look();

    expect([...unmatched]).toEqual([]);
  });

  it('turns the marker to say it is open, in a channel a forced palette leaves alone', () => {
    const style = document.createElement('style');
    style.textContent = componentCss(collapsibleStyles);
    document.head.append(style);
    restores.push(() => style.remove());

    const { host } = show(Page);
    const turn = (): string => getComputedStyle(indicator(host)).getPropertyValue('rotate');

    // The second of the two ways the sheet says it is open, and the one still
    // on the page once the panel has gone.
    expect(turn()).toBe('45deg');
    click(trigger(host));
    expect(turn()).toBe('225deg');

    // A turn is not a colour, so the palette cannot take it — as long as
    // nothing the sheet says for that palette takes it back instead.
    for (const rule of collapsibleStyles.forcedColors) {
      expect(Object.keys(rule.declarations), rule.selector).not.toContain('rotate');
    }
  });

  it('clips the panel only while its height moves, so a focus ring inside an open one is whole', () => {
    // A clip left on the panel at rest cuts the outline off whatever inside it
    // sits against an edge — the top of a field that opens the panel, the
    // start of a button — which is a focus indicator the user cannot see.
    // The clip is only needed while the height runs between zero and the
    // measured number, which is exactly while an animation is on the panel.
    const style = document.createElement('style');
    style.textContent = componentCss(collapsibleStyles);
    document.head.append(style);
    restores.push(() => style.remove());

    const { host } = show(Page);
    click(trigger(host));
    const open = getComputedStyle(panel(host)!);
    // Nothing clipping it — happy-dom leaves an unset property empty where a
    // browser would say `visible`.
    expect(['', 'visible']).toContain(open.getPropertyValue('overflow-x'));
    expect(['', 'visible']).toContain(open.getPropertyValue('overflow-y'));
    // Its own formatting context all the same, which the clip used to give it:
    // a margin inside stays inside, so the height measured at rest is the
    // height the animation travels to, and nothing jumps as it ends.
    expect(open.getPropertyValue('display')).toBe('flow-root');

    // Carried by the animations instead, for as long as they run. `hidden`
    // rather than `clip`, because the primitive measures `scrollHeight` as the
    // panel resizes, and a box that clips reports the height it is clipped to.
    for (const frames of collapsibleStyles.keyframes) {
      for (const step of frames.steps) {
        const where = `${frames.name} ${step.offset}`;
        expect(step.declarations['overflow-x'], where).toBe('hidden');
        expect(step.declarations['overflow-y'], where).toBe('hidden');
      }
    }
  });

  it('draws the marker from edges that turn the way `rotate` does, whichever way the text runs', () => {
    // `rotate` is physical: it turns the square the same way in a right-to-left
    // page as in a left-to-right one. An edge named along the text is not —
    // `border-inline-end` is the right edge in one and the left in the other —
    // so a chevron drawn from it and turned points down and up in English and
    // left and right in Arabic, which reads as back and next rather than as
    // shut and open. happy-dom keeps the two spellings apart instead of mapping
    // one onto the other, so this is asserted on the sheet rather than on a
    // computed style it would not compute.
    const marker = [...collapsibleStyles.rules, ...collapsibleStyles.forcedColors].filter((rule) =>
      rule.selector.endsWith('.volt-collapsible-indicator'),
    );
    const edges = marker.flatMap((rule) =>
      Object.keys(rule.declarations).filter((property) => property.startsWith('border-')),
    );

    // Something to check, so that a marker drawn some other way cannot pass
    // this by having no edges at all.
    expect(edges).toContain('border-bottom-width');
    expect(edges).toContain('border-right-width');
    for (const property of edges) expect(property).toMatch(/^border-(top|right|bottom|left)-/);
  });

  it('keeps a closing panel until the animation it started has finished', async () => {
    const { host } = show(Page);
    click(trigger(host));
    const exit = pretendAnimating(panel(host)!);

    click(trigger(host));
    // Marked closed and still there, which is the whole of what makes a
    // collapse animatable: the sheet's rule selects on this state.
    expect(panel(host)!.getAttribute('data-state')).toBe('closed');
    expect(trigger(host).getAttribute('data-state')).toBe('closed');
    expect(trigger(host).getAttribute('aria-expanded')).toBe('false');

    await exit.finish();
    expect(panel(host)).toBeNull();
  });

  it('pairs the trigger with its panel, and only while the panel is there', () => {
    const { host } = show(Page);

    // Pointing `aria-controls` at an id that is not in the document is a
    // dangling reference.
    expect(trigger(host).hasAttribute('aria-controls')).toBe(false);

    click(trigger(host));
    const open = panel(host)!;
    expect(document.getElementById(trigger(host).getAttribute('aria-controls')!)).toBe(open);
    // A lone disclosure is not a landmark unless the caller asks for one.
    expect(open.hasAttribute('role')).toBe(false);
    // And an element with no role takes no name: ARIA prohibits naming a
    // generic, a conformance checker refuses the markup, and a screen reader
    // ignores it anyway. The trigger is what says what the panel is.
    expect(open.hasAttribute('aria-labelledby')).toBe(false);
    expect(open.hasAttribute('aria-label')).toBe(false);
  });

  it('names the panel only once it is a landmark, `panelLabel` included', () => {
    @Component({
      selector: 'v-page-unnamed',
      imports: [VCollapsible],
      render: compileTemplate(`
        <v-collapsible defaultOpen panelLabel="Everything in the parcel" label="More">
          <p>Body</p>
        </v-collapsible>
      `),
    })
    class UnnamedPage {}

    const { host } = show(UnnamedPage);
    // Asked for a name and not a landmark: there is nothing the name could
    // be read out as, so it is not written onto an element that refuses it.
    expect(panel(host)!.hasAttribute('role')).toBe(false);
    expect(panel(host)!.hasAttribute('aria-label')).toBe(false);
    expect(panel(host)!.hasAttribute('aria-labelledby')).toBe(false);
  });

  it('leaves Enter and Space to the button, which already turns both into a press', () => {
    const heard = vi.fn();

    @Component({
      selector: 'v-page-keys',
      imports: [VCollapsible],
      render: compileTemplate(`
        <v-collapsible label="More" :disabled="off.get()" :onOpenChange="heard">
          <p>Body</p>
        </v-collapsible>
      `),
    })
    class KeysPage {
      off = new Signal.State(false);
      heard = heard;
    }

    const { instance, host } = show(KeysPage);

    // In the page's tab sequence as a button is, with nothing sitting at -1.
    expect(trigger(host).hasAttribute('tabindex')).toBe(false);
    trigger(host).focus();
    expect(document.activeElement).toBe(trigger(host));

    // Nothing answers the key itself: the browser makes a click of it, and
    // answering both would open the section and close it again in one press.
    for (const key of ['Enter', ' ']) {
      const event = press(trigger(host), key);
      expect(event.defaultPrevented, key).toBe(false);
      expect(panel(host), key).toBeNull();
    }
    click(trigger(host));
    expect(panel(host)).not.toBeNull();
    expect(heard).toHaveBeenCalledTimes(1);

    // Off, it can still be reached — a trigger a keyboard user cannot land on
    // is one they cannot learn is there — and what it refuses is the press.
    instance.off.set(true);
    flushSync();
    trigger(host).blur();
    trigger(host).focus();
    expect(document.activeElement).toBe(trigger(host));
    click(trigger(host));
    expect(panel(host)).not.toBeNull();
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('is the caller’s signal on both sides', () => {
    const { instance, host } = show(Page);

    instance.open.set(true);
    flushSync();
    expect(panel(host)).not.toBeNull();
    expect(trigger(host).getAttribute('aria-expanded')).toBe('true');

    click(trigger(host));
    // The trigger writes to the page's signal rather than to a copy of its own.
    expect(instance.open.get()).toBe(false);
    expect(panel(host)).toBeNull();
  });

  it('says what to write when `open` is handed a boolean, the way `<details open>` is', () => {
    @Component({
      selector: 'v-page-details',
      imports: [VCollapsible],
      render: compileTemplate(`<v-collapsible open label="More"><p>Body</p></v-collapsible>`),
    })
    class DetailsPage {}

    // Refused while the prop is the thing that is wrong, rather than as a
    // `TypeError` from inside the primitive's first effect.
    expect(() => show(DetailsPage)).toThrow(/`open` on <v-collapsible>[\s\S]*defaultOpen/);
  });

  it('refuses a signal it could not write to, and says that is why', () => {
    @Component({
      selector: 'v-page-derived',
      imports: [VCollapsible],
      render: compileTemplate(`<v-collapsible :open="shown" label="More"><p>Body</p></v-collapsible>`),
    })
    class DerivedPage {
      source = new Signal.State(false);
      shown = new Signal.Computed(() => this.source.get());
    }

    // The trigger closes the section by writing to `open`, so a derived signal
    // would pass every read and throw on the first press, from inside the
    // primitive. Refused as it arrives — and not as a `<details open>`, which
    // is not what was written.
    let refused: unknown = null;
    try {
      show(DerivedPage);
    } catch (error) {
      refused = error;
    }
    expect(String(refused)).toMatch(/`open` on <v-collapsible>[\s\S]*cannot be written/);
    expect(String(refused)).not.toMatch(/details/);
  });

  it('starts open when told to, owns its state after that, and reports only what moved it', () => {
    @Component({
      selector: 'v-page-default',
      imports: [VCollapsible],
      render: compileTemplate(`
        <v-collapsible label="More" defaultOpen :onOpenChange="heard"><p>Body</p></v-collapsible>
      `),
    })
    class DefaultPage {
      seen: boolean[] = [];
      heard = (open: boolean): void => void this.seen.push(open);
    }

    const { instance, host } = show(DefaultPage);
    expect(panel(host)).not.toBeNull();
    expect(trigger(host).getAttribute('aria-expanded')).toBe('true');
    // What it started with is nobody's choice, so nothing is reported.
    expect(instance.seen).toEqual([]);

    click(trigger(host));
    expect(panel(host)).toBeNull();
    click(trigger(host));
    expect(instance.seen).toEqual([false, true]);
  });

  it('reports what the trigger did, and not what the page wrote to its own signal', () => {
    const heard = vi.fn();

    @Component({
      selector: 'v-page-heard',
      imports: [VCollapsible],
      render: compileTemplate(`
        <v-collapsible :open="open" :onOpenChange="heard" label="More"><p>Body</p></v-collapsible>
      `),
    })
    class HeardPage {
      open = new Signal.State(false);
      heard = heard;
    }

    const { instance, host } = show(HeardPage);

    click(trigger(host));
    expect(heard).toHaveBeenCalledWith(true);

    instance.open.set(false);
    flushSync();
    expect(heard).toHaveBeenCalledTimes(1);
    expect(panel(host)).toBeNull();
  });

  it('hands focus in a panel the page closes back to the trigger', () => {
    // A press on the trigger already has focus there. A close from anywhere
    // else takes the focused field out of the page under the user, and focus
    // falls to `<body>` — the top of the document, for a keyboard user.
    const { instance, host } = show(Page);
    instance.open.set(true);
    flushSync();
    instance.field!.focus();
    expect(document.activeElement).toBe(instance.field);

    instance.open.set(false);
    flushSync();
    expect(panel(host)).toBeNull();
    // Under the id the caller gave it, which is not the one the primitive
    // minted: the trigger is found all the same.
    expect(trigger(host).id).toBe('delivery');
    expect(document.activeElement).toBe(trigger(host));
  });

  it('hands focus back to the trigger when the primitive is closed through `:ref`', () => {
    @Component({
      selector: 'v-page-ref-close',
      imports: [VCollapsible],
      render: compileTemplate(`
        <v-collapsible :ref="box" label="More" defaultOpen><input :ref="field"></v-collapsible>
      `),
    })
    class RefClosePage {
      box: VCollapsible | null = null;
      field: HTMLInputElement | null = null;
    }

    const { instance, host } = show(RefClosePage);
    instance.field!.focus();

    instance.box!.collapsible.close();
    flushSync();
    expect(document.activeElement).toBe(trigger(host));
  });

  it('refuses while disabled, and takes the refusal back with the signal', () => {
    const { instance, host } = show(Page);

    instance.off.set(true);
    flushSync();
    click(trigger(host));
    expect(instance.open.get()).toBe(false);
    expect(panel(host)).toBeNull();

    // The refusal is the trigger's; the page's own signal still moves it.
    instance.open.set(true);
    flushSync();
    expect(panel(host)).not.toBeNull();
    instance.open.set(false);
    flushSync();

    instance.off.set(false);
    flushSync();
    expect(trigger(host).hasAttribute('data-disabled')).toBe(false);
    expect(trigger(host).hasAttribute('aria-disabled')).toBe(false);

    click(trigger(host));
    expect(instance.open.get()).toBe(true);
    expect(panel(host)).not.toBeNull();
  });

  it('makes the panel a landmark when asked, named by the trigger or by `panelLabel`', () => {
    @Component({
      selector: 'v-page-region',
      imports: [VCollapsible],
      render: compileTemplate(`
        <v-collapsible
          region
          defaultOpen
          :panelLabel="name.get()"
          id="parcel"
          label="In the parcel"
        >
          <p>Three items</p>
        </v-collapsible>
      `),
    })
    class RegionPage {
      name = new Signal.State<string | undefined>(undefined);
    }

    const { instance, host } = show(RegionPage);
    expect(panel(host)!.getAttribute('role')).toBe('region');
    // Unnamed by the caller, the trigger names it: a landmark always has a
    // name to be listed under.
    expect(panel(host)!.getAttribute('aria-labelledby')).toBe('parcel');
    expect(panel(host)!.hasAttribute('aria-label')).toBe(false);

    // Followed as it changes, and only one of the two names at a time — two
    // would leave which wins to the screen reader. The trigger carrying an id
    // of the caller's does not bring the second one back.
    instance.name.set('Everything in the parcel');
    flushSync();
    expect(panel(host)!.getAttribute('aria-label')).toBe('Everything in the parcel');
    expect(panel(host)!.hasAttribute('aria-labelledby')).toBe(false);

    // An empty name is no name, and hands the panel back to its trigger.
    instance.name.set('');
    flushSync();
    expect(panel(host)!.hasAttribute('aria-label')).toBe(false);
    expect(panel(host)!.getAttribute('aria-labelledby')).toBe('parcel');
  });

  it('draws the words it was given, and follows a bound label', () => {
    const { instance, host } = show(Page);

    instance.label.set('Shipping');
    flushSync();
    expect(trigger(host).textContent).toBe('Shipping');
    // The words replace only the words: the marker is still drawn beside them.
    expect(trigger(host).contains(indicator(host))).toBe(true);
  });

  it('draws the trigger slot inside the button, and keeps the content of the tag the panel', () => {
    @Component({
      selector: 'v-page-slot',
      imports: [VCollapsible],
      render: compileTemplate(`
        <v-collapsible label="Unused">
          <template :slot-trigger>In the parcel <span class="count">3 items</span></template>
          <p>Three items</p>
        </v-collapsible>
      `),
    })
    class SlotPage {}

    const { host } = show(SlotPage);
    expect(trigger(host).querySelector('.count')!.textContent).toBe('3 items');
    expect(trigger(host).textContent).toContain('In the parcel');
    expect(trigger(host).textContent).not.toContain('Unused');
    // The marker comes last, after whatever the slot was filled with, which is
    // the end of the row the sheet pushes it to.
    expect(trigger(host).lastElementChild).toBe(indicator(host));
    expect(trigger(host).textContent).not.toContain('Three items');

    click(trigger(host));
    expect(panel(host)!.textContent).toContain('Three items');
  });

  it('hands the primitive itself to whoever needs more than this offers', () => {
    @Component({
      selector: 'v-page-ref',
      imports: [VCollapsible],
      render: compileTemplate(`
        <v-collapsible :ref="box" label="More"><p>Body</p></v-collapsible>
      `),
    })
    class RefPage {
      box: VCollapsible | null = null;
    }

    const { instance, host } = show(RefPage);
    expect(instance.box?.collapsible.isOpen()).toBe(false);

    instance.box!.collapsible.open();
    flushSync();
    expect(instance.box!.collapsible.isOpen()).toBe(true);
    expect(panel(host)).not.toBeNull();
    expect(trigger(host).getAttribute('data-state')).toBe('open');

    // And the element the primitive measures is the panel it drew.
    expect(instance.box!.content.get()).toBe(panel(host));
  });
});
