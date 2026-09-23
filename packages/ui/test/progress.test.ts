/**
 * `<v-progress>`, driven the way a page drives it.
 *
 * The arithmetic and the ARIA are `createProgress`'s and are tested where they
 * live. What is tested here is the shell: that what a caller writes on the tag
 * reaches the element carrying the role, that every state the sheet draws is
 * on the element its rules select on, that the width the sheet cannot hold is
 * written inline and taken back again when there is no value, that the label
 * and `aria-valuetext` say the same thing in the page's own language, that
 * every prop forwarded to the primitive does something, and that nothing about
 * the primitive is out of reach.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Component, Signal, flushSync, mount } from '@voltdev/core';
import { compileTemplate } from '@voltdev/core/jit';
import { createLocaleProvider } from '@voltdev/primitives';
import { compileComponents } from './render.js';
import { VProgress } from '../src/components/progress.js';

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

/** A keydown as the user sends it: bubbling, and cancellable. */
function press(target: Element, key: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  flushSync();
  return event;
}

const bar = (host: HTMLElement): HTMLElement => host.querySelector('.volt-progress')!;
const track = (host: HTMLElement): HTMLElement => host.querySelector('.volt-progress-track')!;
const fill = (host: HTMLElement): HTMLElement => host.querySelector('.volt-progress-indicator')!;
const label = (host: HTMLElement): HTMLElement | null =>
  host.querySelector('.volt-progress-label');

/** What the page's language makes of a fraction, computed the way the bar does. */
const percent = (fraction: number, locale?: string): string =>
  new Intl.NumberFormat(locale, { style: 'percent' }).format(fraction);

describe('v-progress', () => {
  it('is a track, a bar and a label, with the sheet’s classes and the caller’s own', () => {
    @Component({
      selector: 'v-page-anatomy',
      imports: [VProgress],
      render: compileTemplate(
        `<v-progress class="mine" id="upload" data-test="bar" label="Uploading" :defaultValue="40"></v-progress>`,
      ),
    })
    class Page {}

    const { host } = show(Page);

    // What the caller wrote lands on the bar, which is the element carrying
    // the role and the only one a reader announces — and the bar is what the
    // tag renders, not something a wrapper holds, so there is no layout
    // element between the name and the role.
    expect(host.firstElementChild).toBe(bar(host));
    expect([...bar(host).classList].sort()).toEqual(['mine', 'volt-progress']);
    expect(bar(host).id).toBe('upload');
    expect(bar(host).dataset['test']).toBe('bar');

    expect(bar(host).getAttribute('role')).toBe('progressbar');
    expect(bar(host).getAttribute('aria-label')).toBe('Uploading');
    expect(bar(host).getAttribute('aria-valuemin')).toBe('0');
    expect(bar(host).getAttribute('aria-valuemax')).toBe('100');
    expect(bar(host).getAttribute('aria-valuenow')).toBe('40');

    // The parts the sheet draws, each inside the last.
    expect(bar(host).contains(track(host))).toBe(true);
    expect(track(host).contains(fill(host))).toBe(true);
    expect(label(host)?.textContent?.trim()).toBe(percent(0.4));
  });

  it('writes every state the sheet’s rules select on, and the width they cannot hold', () => {
    @Component({
      selector: 'v-page-states',
      imports: [VProgress],
      render: compileTemplate(`<v-progress :value="sent" label="Uploading"></v-progress>`),
    })
    class Page {
      sent = new Signal.State<number | null>(25);
    }

    const { instance, host } = show(Page);
    const state = (): [string | null, string | null] => [
      bar(host).getAttribute('data-state'),
      fill(host).getAttribute('data-state'),
    ];

    expect(state()).toEqual(['loading', 'loading']);
    expect(fill(host).style.getPropertyValue('inline-size')).toBe('25%');
    expect(fill(host).getAttribute('data-max')).toBe('100');

    // A prop bound to a signal follows it, rather than being read once.
    instance.sent.set(100);
    flushSync();
    expect(state()).toEqual(['complete', 'complete']);
    expect(fill(host).style.getPropertyValue('inline-size')).toBe('100%');
    expect(bar(host).getAttribute('data-value')).toBe('100');

    // No value: the sheet's travelling bar has a width of its own, so the
    // inline one has to be given back rather than left at its last number.
    instance.sent.set(null);
    flushSync();
    expect(state()).toEqual(['indeterminate', 'indeterminate']);
    expect(fill(host).style.getPropertyValue('inline-size')).toBe('');
    // And nothing claims a position the bar no longer has.
    expect(bar(host).hasAttribute('aria-valuenow')).toBe(false);
    expect(bar(host).hasAttribute('data-value')).toBe(false);
  });

  it('says the value the way the page’s language says it, on screen and out loud', () => {
    @Component({
      selector: 'v-page-locale',
      imports: [VProgress],
      render: compileTemplate(`<v-progress :value="sent" label="Envoi"></v-progress>`),
    })
    class Page {
      locale = createLocaleProvider({ defaultLocale: 'fr-FR' });
      sent = new Signal.State<number | null>(37.5);
    }

    const { instance, host } = show(Page);

    // French spaces the sign and English does not, which is the whole reason
    // this goes through `Intl` rather than through a template.
    expect(label(host)?.textContent?.trim()).toBe(percent(0.375, 'fr-FR'));
    expect(label(host)?.textContent?.trim()).not.toBe('37.5%');
    // What is read out is the same string, so the two cannot drift apart.
    expect(bar(host).getAttribute('aria-valuetext')).toBe(percent(0.375, 'fr-FR'));

    // A language swapped under a bar already on screen reaches it.
    instance.locale.setLocale('en-US');
    flushSync();
    expect(label(host)?.textContent?.trim()).toBe(percent(0.375, 'en-US'));
  });

  it('counts in whatever the range counts in, when told how', () => {
    @Component({
      selector: 'v-page-format',
      imports: [VProgress],
      render: compileTemplate(
        `<v-progress :value="done" :min="0" :max="8" :format="files" label="Copying"></v-progress>`,
      ),
    })
    class Page {
      done = new Signal.State<number | null>(3);
      files = (value: number): string => `${value} of 8 files`;
    }

    const { host } = show(Page);

    // `min` and `max` reach the primitive, which reports them and works the
    // percentage out against them.
    expect(bar(host).getAttribute('aria-valuemin')).toBe('0');
    expect(bar(host).getAttribute('aria-valuemax')).toBe('8');
    expect(bar(host).getAttribute('aria-valuenow')).toBe('3');
    expect(fill(host).style.getPropertyValue('inline-size')).toBe('37.5%');
    expect(fill(host).getAttribute('data-max')).toBe('8');

    // And the words are the caller's, in both places, rather than the 38% a
    // reader would otherwise work out and announce.
    expect(label(host)?.textContent?.trim()).toBe('3 of 8 files');
    expect(bar(host).getAttribute('aria-valuetext')).toBe('3 of 8 files');
  });

  it('counts from wherever the range starts, not from zero', () => {
    @Component({
      selector: 'v-page-min',
      imports: [VProgress],
      render: compileTemplate(
        `<v-progress :value="warmth" :min="20" :max="120" label="Warming"></v-progress>`,
      ),
    })
    class Page {
      warmth = new Signal.State<number | null>(70);
    }

    const { host } = show(Page);

    // `min` reaches the primitive, which reports it and measures against it:
    // 70 is halfway along 20–120, not 58% of 120.
    expect(bar(host).getAttribute('aria-valuemin')).toBe('20');
    expect(bar(host).getAttribute('aria-valuemax')).toBe('120');
    expect(bar(host).getAttribute('aria-valuenow')).toBe('70');
    expect(fill(host).style.getPropertyValue('inline-size')).toBe('50%');
    expect(label(host)?.textContent?.trim()).toBe(percent(0.5));
  });

  it('follows the wait it was bound to, on screen and out loud together', () => {
    @Component({
      selector: 'v-page-waiting-live',
      imports: [VProgress],
      render: compileTemplate(
        `<v-progress :indeterminateLabel="wait.get()" label="Uploading"></v-progress>`,
      ),
    })
    class Page {
      wait = new Signal.State('Waiting for the server');
    }

    const { instance, host } = show(Page);
    expect(label(host)?.textContent?.trim()).toBe('Waiting for the server');
    expect(bar(host).getAttribute('aria-valuetext')).toBe('Waiting for the server');

    // The wait is a sentence a page rewrites — "waiting" becomes "still
    // waiting" — and both the label and `aria-valuetext` have to hear it, or
    // the two strings this component computes once have drifted anyway.
    instance.wait.set('Still waiting');
    flushSync();
    expect(label(host)?.textContent?.trim()).toBe('Still waiting');
    expect(bar(host).getAttribute('aria-valuetext')).toBe('Still waiting');
  });

  it('follows the wording it was bound to, in both places at once', () => {
    @Component({
      selector: 'v-page-format-live',
      imports: [VProgress],
      render: compileTemplate(
        `<v-progress :value="done" :max="8" :format="wording.get()" label="Copying"></v-progress>`,
      ),
    })
    class Page {
      done = new Signal.State<number | null>(3);
      wording = new Signal.State<(value: number, percent: number) => string>(
        (value) => `${value} of 8 files`,
      );
    }

    const { instance, host } = show(Page);
    expect(label(host)?.textContent?.trim()).toBe('3 of 8 files');
    expect(bar(host).getAttribute('aria-valuetext')).toBe('3 of 8 files');

    instance.wording.set((_value, share) => `${share}% copied`);
    flushSync();
    expect(label(host)?.textContent?.trim()).toBe('37.5% copied');
    expect(bar(host).getAttribute('aria-valuetext')).toBe('37.5% copied');
  });

  it('names the wait while there is no value, in the caller’s words or the locale’s', () => {
    @Component({
      selector: 'v-page-waiting',
      imports: [VProgress],
      render: compileTemplate(`
        <v-progress label="Uploading"></v-progress>
        <v-progress label="Copying" indeterminateLabel="Working it out"></v-progress>
      `),
    })
    class Page {}

    const { host } = show(Page);
    const bars = [...host.querySelectorAll('.volt-progress')];
    const labels = [...host.querySelectorAll('.volt-progress-label')];

    // Nothing said about the value makes the bar indeterminate, which is the
    // state a bar starts in when it has not been told anything.
    expect(bars[0]!.getAttribute('data-state')).toBe('indeterminate');
    expect(labels[0]!.textContent?.trim()).toBe('Loading…');
    expect(bars[0]!.getAttribute('aria-valuetext')).toBe('Loading…');

    expect(labels[1]!.textContent?.trim()).toBe('Working it out');
    expect(bars[1]!.getAttribute('aria-valuetext')).toBe('Working it out');
  });

  it('starts where it was told to, when the value is its own', () => {
    @Component({
      selector: 'v-page-default',
      imports: [VProgress],
      render: compileTemplate(`<v-progress :defaultValue="60" label="Uploading"></v-progress>`),
    })
    class Page {}

    const { host } = show(Page);
    expect(bar(host).getAttribute('aria-valuenow')).toBe('60');
    expect(fill(host).style.getPropertyValue('inline-size')).toBe('60%');
  });

  it('draws the value unless asked not to, and hands it to whatever is written inside', () => {
    @Component({
      selector: 'v-page-label',
      imports: [VProgress],
      render: compileTemplate(`
        <v-progress :value="sent" :showValue="shown.get()" label="Uploading"
          :slot-default="{ valueText, value, percent }"
        ><b>{ valueText } — { value } — { percent }</b></v-progress>
      `),
    })
    class Page {
      sent = new Signal.State<number | null>(40);
      shown = new Signal.State(true);
    }

    const { instance, host } = show(Page);
    const written = (): string | undefined => label(host)?.querySelector('b')?.textContent?.trim();

    // The slot is handed what the label would have said, and the numbers
    // behind it, so a caller can write their own sentence around them.
    expect(written()).toBe(`${percent(0.4)} — 40 — 40`);

    // The names are live: content that draws the value follows it rather than
    // being built again for each one.
    instance.sent.set(80);
    flushSync();
    expect(written()).toBe(`${percent(0.8)} — 80 — 80`);

    // Turned off, the label is not in the DOM at all — and the bar is still
    // named, because the name never came from the label.
    instance.shown.set(false);
    flushSync();
    expect(label(host)).toBe(null);
    expect(bar(host).getAttribute('aria-label')).toBe('Uploading');
    expect(bar(host).getAttribute('aria-valuetext')).toBe(percent(0.8));
  });

  it('names the bar, and leaves off every name it was not given', () => {
    @Component({
      selector: 'v-page-names',
      imports: [VProgress],
      render: compileTemplate(`
        <span id="heading">Uploading</span>
        <span id="hint">Large files take a while.</span>
        <v-progress></v-progress>
        <v-progress :label="name.get()"></v-progress>
        <v-progress labelledBy="heading" :aria-describedby="described.get()"></v-progress>
        <v-progress aria-label="Uploading" label="stale"></v-progress>
        <v-progress aria-labelledby="heading" labelledBy="stale"></v-progress>
      `),
    })
    class Page {
      name = new Signal.State('Uploading');
      described = new Signal.State('hint');
    }

    const { instance, host } = show(Page);
    const bars = [...host.querySelectorAll('.volt-progress')];

    // An empty `aria-label` is a name a reader has to decide what to do with,
    // and an empty `aria-labelledby` is a list of ids pointing at nothing.
    for (const name of ['aria-label', 'aria-labelledby', 'aria-describedby']) {
      expect(bars[0]!.hasAttribute(name), name).toBe(false);
    }

    // A name bound to a signal follows it, and survives the bag being written
    // again — which is what happens on every change of value.
    expect(bars[1]!.getAttribute('aria-label')).toBe('Uploading');
    instance.name.set('Uploading photos');
    flushSync();
    expect(bars[1]!.getAttribute('aria-label')).toBe('Uploading photos');

    expect(bars[2]!.getAttribute('aria-labelledby')).toBe('heading');
    expect(bars[2]!.getAttribute('aria-describedby')).toBe('hint');
    instance.described.set('hint error');
    flushSync();
    expect(bars[2]!.getAttribute('aria-describedby')).toBe('hint error');

    // Two spellings of one name can only disagree by mistake, and the one on
    // the tag is the one that counts.
    expect(bars[3]!.getAttribute('aria-label')).toBe('Uploading');
    expect(bars[4]!.getAttribute('aria-labelledby')).toBe('heading');
    // One name only: a bar with both is named by the reference, and the
    // `aria-label` beside it is read by nobody and maintained by nobody.
    expect(bars[4]!.hasAttribute('aria-label')).toBe(false);
  });

  it('takes no focus and no keyboard, because it takes no input', () => {
    @Component({
      selector: 'v-page-inert',
      imports: [VProgress],
      render: compileTemplate(`<v-progress :value="sent" label="Uploading"></v-progress>`),
    })
    class Page {
      sent = new Signal.State<number | null>(40);
    }

    const { instance, host } = show(Page);

    // Something the user can change is a slider, which is a different role
    // with a keyboard map of its own. A bar has neither.
    expect(bar(host).hasAttribute('tabindex')).toBe(false);

    for (const key of ['ArrowRight', 'ArrowLeft', 'Home', 'End', ' ', 'Enter']) {
      const event = press(bar(host), key);
      expect(event.defaultPrevented, key).toBe(false);
      expect(instance.sent.get(), key).toBe(40);
    }
  });


  it('refuses a value that is not a signal, while the tag is still what is wrong', () => {
    @Component({
      selector: 'v-page-not-a-signal',
      imports: [VProgress],
      render: compileTemplate(`<v-progress value="40" label="Uploading"></v-progress>`),
    })
    class Page {}

    // `value` is the one signal the page and the bar both hold, and markup
    // has no way to write one — so `value="40"` hands over the string, which
    // the primitive keeps and calls `.get()` on inside an effect. That
    // `TypeError` is swallowed there, and what is left on the page is a
    // `<div>` with no role, no value and an empty label: a bar that announces
    // nothing, with nothing anywhere naming the tag that caused it.
    expect(() => show(Page)).toThrow(/`value` on <v-progress> takes a signal/);
    // And the advice is the spelling that would have worked.
    expect(() => show(Page)).toThrow(/defaultValue/);
  });


  it('starts where an attribute says, in either spelling of a number', () => {
    @Component({
      selector: 'v-page-default-attribute',
      imports: [VProgress],
      render: compileTemplate(`
        <v-progress defaultValue="40" label="Uploading"></v-progress>
        <v-progress :value="warmth" min="20" max="120" label="Warming"></v-progress>
      `),
    })
    class Page {
      warmth = new Signal.State<number | null>(70);
    }

    const { host } = show(Page);
    const bars = [...host.querySelectorAll('.volt-progress')];
    const fills = [...host.querySelectorAll('.volt-progress-indicator')] as HTMLElement[];

    // An attribute is only ever a string, and `'40'` is not a finite number:
    // the primitive reports no value at all, and what the caller gets is the
    // travelling bar — one saying nobody knows how far along this is, where
    // they asked for one that is 40 — with nothing raised anywhere.
    expect(bars[0]!.getAttribute('data-state')).toBe('loading');
    expect(bars[0]!.getAttribute('aria-valuenow')).toBe('40');
    expect(fills[0]!.style.getPropertyValue('inline-size')).toBe('40%');

    // The range is the same question, and already answers it: both spellings
    // reach the primitive as the numbers they read as.
    expect(bars[1]!.getAttribute('aria-valuemin')).toBe('20');
    expect(bars[1]!.getAttribute('aria-valuemax')).toBe('120');
    expect(fills[1]!.style.getPropertyValue('inline-size')).toBe('50%');
  });

  it('hands the primitive itself to whoever needs more than this offers', () => {
    const changes: (number | null)[] = [];

    @Component({
      selector: 'v-page-ref',
      imports: [VProgress],
      render: compileTemplate(
        `<v-progress :ref="upload" :onValueChange="record" label="Uploading"></v-progress>`,
      ),
    })
    class Page {
      upload: VProgress | null = null;
      record = (value: number | null): void => void changes.push(value);
    }

    const { instance, host } = show(Page);
    expect(instance.upload?.progress.isIndeterminate()).toBe(true);

    instance.upload!.progress.setValue(50);
    flushSync();
    expect(instance.upload!.progress.percent()).toBe(50);
    expect(fill(host).style.getPropertyValue('inline-size')).toBe('50%');
    expect(label(host)?.textContent?.trim()).toBe(percent(0.5));
    // The callback is the primitive's, which is the only thing that moves a
    // bar nobody bound a signal to.
    expect(changes).toEqual([50]);
  });
});
