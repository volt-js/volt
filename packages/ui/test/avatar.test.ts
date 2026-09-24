/**
 * `<v-avatar>`, driven the way a page drives it.
 *
 * Which of the two is shown and which of them carries the name is
 * `createAvatar`'s, and is tested where it lives. What is tested here is the
 * shell: that what a caller writes on the tag reaches the box their layout
 * places, that every state the sheet draws is on the element its rules select
 * on, that the name is heard exactly once whichever of the two is up, that the
 * three attributes which name or describe land where the name is rather than
 * on a box with no role, that every prop does something, and that the
 * primitive is within reach.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Component, Signal, flushSync, mount } from '@voltdev/core';
import { compileTemplate } from '@voltdev/core/jit';
import { renderToStaticMarkup } from '@voltdev/core/server';
import { compileComponents } from './render.js';
import { VAvatar } from '../src/components/avatar.js';
import template from '../src/components/avatar.html?raw';

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

const box = (host: HTMLElement): HTMLElement => host.querySelector('.volt-avatar')!;
const picture = (host: HTMLElement): HTMLImageElement =>
  host.querySelector<HTMLImageElement>('.volt-avatar-image')!;
const initials = (host: HTMLElement): HTMLElement | null =>
  host.querySelector('.volt-avatar-fallback');

/**
 * What a browser sends the `<img>` when it is done. happy-dom fetches no
 * images and sends neither, so the test sends them.
 */
function load(host: HTMLElement): void {
  picture(host).dispatchEvent(new Event('load'));
  flushSync();
}

function fail(host: HTMLElement): void {
  picture(host).dispatchEvent(new Event('error'));
  flushSync();
}

/** The status each part carries, box first, for the rules that read it. */
const statuses = (host: HTMLElement): (string | null)[] => [
  box(host).getAttribute('data-status'),
  picture(host).getAttribute('data-status'),
  initials(host)?.getAttribute('data-status') ?? null,
];

/**
 * Every name a screen reader would read out of the avatar, in order.
 *
 * An image is named by a non-empty `alt`; anything with `role="img"` by its
 * `aria-label`; and nothing under `aria-hidden` at all. The box is counted
 * too — a name that landed there would be one more thing heard.
 */
function heard(host: HTMLElement): string[] {
  const names: string[] = [];
  for (const element of [box(host), ...box(host).querySelectorAll('*')]) {
    if (element.closest('[aria-hidden="true"]')) continue;
    if (element.tagName === 'IMG') {
      const alt = element.getAttribute('alt');
      if (alt) names.push(alt);
    } else if (element.hasAttribute('aria-label')) {
      names.push(element.getAttribute('aria-label')!);
    }
  }
  return names;
}

describe('v-avatar', () => {
  it('is a box with the picture and the initials in it, with the sheet’s classes and the caller’s own', () => {
    @Component({
      selector: 'v-page-anatomy',
      imports: [VAvatar],
      render: compileTemplate(
        `<v-avatar class="mine" id="ada" data-test="face" src="/ada.png" name="Ada Lovelace"></v-avatar>`,
      ),
    })
    class Page {}

    const { host } = show(Page);

    // What the caller wrote lands on the box, which is what the tag renders:
    // the element their layout places, and the one a row of them overlaps.
    expect(host.firstElementChild).toBe(box(host));
    expect([...box(host).classList].sort()).toEqual(['mine', 'volt-avatar']);
    expect(box(host).id).toBe('ada');
    expect(box(host).dataset['test']).toBe('face');

    // The defaults, written out, so a hand-written box and this one are drawn
    // by the same rules.
    expect(box(host).getAttribute('data-size')).toBe('md');
    expect(box(host).getAttribute('data-shape')).toBe('circle');

    // The picture is fetched from the start, inside the box, and the initials
    // stand in front of it until it arrives.
    expect(box(host).contains(picture(host))).toBe(true);
    expect(picture(host).getAttribute('src')).toBe('/ada.png');
    expect(statuses(host)).toEqual(['loading', 'loading', 'loading']);
    expect(initials(host)?.textContent).toBe('AL');

    // The initials are the name, not two letters, and the picture is quiet
    // beside them.
    expect(initials(host)?.getAttribute('role')).toBe('img');
    expect(initials(host)?.getAttribute('aria-label')).toBe('Ada Lovelace');
    expect(picture(host).getAttribute('alt')).toBe('');
    expect(heard(host)).toEqual(['Ada Lovelace']);
  });

  it('shows the picture once it loads and the initials whenever it has not, saying the name once in each', () => {
    @Component({
      selector: 'v-page-states',
      imports: [VAvatar],
      render: compileTemplate(`<v-avatar :src="photo.get()" name="Ada Lovelace"></v-avatar>`),
    })
    class Page {
      photo = new Signal.State<string | null>('/ada.png');
    }

    const { instance, host } = show(Page);
    // The one image element throughout: an `<img>` taken off the page is one
    // the browser stops fetching.
    const image = picture(host);

    load(host);
    expect(statuses(host)).toEqual(['loaded', 'loaded', null]);
    expect(initials(host)).toBe(null);
    // Nothing else is left to say who this is, so the picture says it.
    expect(picture(host).getAttribute('alt')).toBe('Ada Lovelace');
    expect(heard(host)).toEqual(['Ada Lovelace']);

    // A bound `src` follows its signal: a new picture is a new load, and the
    // initials are back in front of it while it comes.
    instance.photo.set('/ada-2.png');
    flushSync();
    expect(picture(host)).toBe(image);
    expect(picture(host).getAttribute('src')).toBe('/ada-2.png');
    expect(statuses(host)).toEqual(['loading', 'loading', 'loading']);
    expect(heard(host)).toEqual(['Ada Lovelace']);

    fail(host);
    expect(statuses(host)).toEqual(['error', 'error', 'error']);
    expect(initials(host)?.textContent).toBe('AL');
    expect(picture(host).getAttribute('alt')).toBe('');
    expect(heard(host)).toEqual(['Ada Lovelace']);

    // No picture at all: nothing is asked for — an empty `src` is a request
    // for the page itself — and the initials are all there is.
    instance.photo.set(null);
    flushSync();
    expect(picture(host)).toBe(image);
    expect(picture(host).hasAttribute('src')).toBe(false);
    expect(statuses(host)).toEqual(['idle', 'idle', 'idle']);
    expect(heard(host)).toEqual(['Ada Lovelace']);
  });

  it('says nothing about a picture of nobody in particular', () => {
    @Component({
      selector: 'v-page-nameless',
      imports: [VAvatar],
      render: compileTemplate(`<v-avatar src="/crowd.png"></v-avatar>`),
    })
    class Page {}

    const { host } = show(Page);

    // A blank circle announced as "image" is noise, so both are decoration.
    expect(initials(host)?.getAttribute('aria-hidden')).toBe('true');
    expect(initials(host)?.hasAttribute('role')).toBe(false);
    expect(initials(host)?.textContent).toBe('');
    // Always an `alt`, even an empty one: without it the URL is read out.
    expect(picture(host).getAttribute('alt')).toBe('');
    expect(heard(host)).toEqual([]);

    load(host);
    expect(picture(host).getAttribute('alt')).toBe('');
    expect(heard(host)).toEqual([]);
  });

  it('takes the name from a signal, and the initials and the picture’s `alt` with it', () => {
    @Component({
      selector: 'v-page-name',
      imports: [VAvatar],
      render: compileTemplate(`<v-avatar src="/me.png" :name="who.get()"></v-avatar>`),
    })
    class Page {
      who = new Signal.State('Ada Lovelace');
    }

    const { instance, host } = show(Page);
    expect(initials(host)?.textContent).toBe('AL');

    instance.who.set('Grace Brewster Hopper');
    flushSync();
    // First and last: the middle name is the part people leave out.
    expect(initials(host)?.textContent).toBe('GH');
    expect(initials(host)?.getAttribute('aria-label')).toBe('Grace Brewster Hopper');

    load(host);
    instance.who.set('Katherine Johnson');
    flushSync();
    expect(picture(host).getAttribute('alt')).toBe('Katherine Johnson');
    expect(heard(host)).toEqual(['Katherine Johnson']);
  });

  it('draws the size and the shape asked for, and follows them', () => {
    @Component({
      selector: 'v-page-look',
      imports: [VAvatar],
      render: compileTemplate(
        `<v-avatar name="Ada Lovelace" :size="size.get()" :shape="shape.get()"></v-avatar>`,
      ),
    })
    class Page {
      size = new Signal.State<'sm' | 'md' | 'lg'>('sm');
      shape = new Signal.State<'circle' | 'square'>('square');
    }

    const { instance, host } = show(Page);
    expect(box(host).getAttribute('data-size')).toBe('sm');
    expect(box(host).getAttribute('data-shape')).toBe('square');

    instance.size.set('lg');
    instance.shape.set('circle');
    flushSync();
    expect(box(host).getAttribute('data-size')).toBe('lg');
    expect(box(host).getAttribute('data-shape')).toBe('circle');
  });

  it('lets a caller draw the fallback, and keeps it named', () => {
    @Component({
      selector: 'v-page-icon',
      imports: [VAvatar],
      render: compileTemplate(
        `<v-avatar src="/ada.png" name="Ada Lovelace">
           <span :slot-fallback class="icon">☺</span>
         </v-avatar>`,
      ),
    })
    class Page {}

    const { host } = show(Page);

    // The icon replaces the initials rather than joining them, and it is
    // inside the element carrying the name — `role="img"` makes whatever is
    // in there part of the picture, so the icon is not a second thing heard.
    expect(initials(host)?.querySelector('.icon')?.textContent).toBe('☺');
    expect(initials(host)?.textContent).toBe('☺');
    expect(initials(host)?.getAttribute('role')).toBe('img');
    expect(heard(host)).toEqual(['Ada Lovelace']);

    // And it goes with the initials when the picture arrives.
    load(host);
    expect(host.querySelector('.icon')).toBe(null);
  });

  it('hands the fallback the initials, for a caller who wants them drawn their own way', () => {
    @Component({
      selector: 'v-page-scoped',
      imports: [VAvatar],
      render: compileTemplate(
        `<v-avatar :name="who.get()">
           <template :slot-fallback="{ initials }"><b class="mark">{ initials }</b></template>
         </v-avatar>`,
      ),
    })
    class Page {
      who = new Signal.State('Ada Lovelace');
    }

    const { instance, host } = show(Page);
    const mark = host.querySelector('.mark')!;
    expect(mark.textContent).toBe('AL');

    instance.who.set('Alan Turing');
    flushSync();
    // The same element, following: the slot is handed an accessor, not a copy.
    expect(host.querySelector('.mark')).toBe(mark);
    expect(mark.textContent).toBe('AT');
  });

  it('hands the primitive over', () => {
    @Component({
      selector: 'v-page-ref',
      imports: [VAvatar],
      render: compileTemplate(`<v-avatar :ref="face" src="/ada.png" name="Ada Lovelace"></v-avatar>`),
    })
    class Page {
      face: VAvatar | null = null;
    }

    const { instance, host } = show(Page);

    expect(instance.face).toBeInstanceOf(VAvatar);
    expect(instance.face!.avatar.status()).toBe('loading');
    expect(instance.face!.avatar.isFallbackVisible()).toBe(true);
    expect(instance.face!.avatar.initials()).toBe('AL');

    load(host);
    expect(instance.face!.avatar.status()).toBe('loaded');
    expect(instance.face!.avatar.isImageVisible()).toBe(true);
  });

  it('hands the primitive to a page that draws from its status, wherever that is written', () => {
    // The pattern the docs give: the ref held in a signal, so that a binding
    // read before the avatar existed — one written above it — is read again
    // once it does, rather than having found nothing and tracked nothing.
    @Component({
      selector: 'v-page-ref-status',
      imports: [VAvatar],
      render: compileTemplate(
        `<p class="failed" :if="failed()">Could not load the picture</p>
         <v-avatar :ref="face" src="/ada.png" name="Ada Lovelace"></v-avatar>`,
      ),
    })
    class Page {
      face = new Signal.State<VAvatar | null>(null);
      failed(): boolean {
        return this.face.get()?.avatar.status() === 'error';
      }
    }

    const { host } = show(Page);
    expect(host.querySelector('.failed')).toBeNull();
    fail(host);
    expect(host.querySelector('.failed')).not.toBeNull();
  });

  it('takes no focus and answers no key', () => {
    @Component({
      selector: 'v-page-keys',
      imports: [VAvatar],
      render: compileTemplate(`<v-avatar src="/ada.png" name="Ada Lovelace"></v-avatar>`),
    })
    class Page {}

    const { host } = show(Page);

    // A picture is something to look at: the primitive gives it no keyboard,
    // and nothing here puts it in the tab order to find none there.
    expect(host.querySelectorAll('[tabindex]')).toHaveLength(0);
    expect(host.querySelectorAll('button, a, input')).toHaveLength(0);

    for (const key of ['Enter', ' ', 'Escape']) {
      box(host).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      flushSync();
    }
    expect(statuses(host)).toEqual(['loading', 'loading', 'loading']);
  });

  it('says `aria-label` in place of the name, and keeps the initials the name’s', () => {
    @Component({
      selector: 'v-page-label',
      imports: [VAvatar],
      render: compileTemplate(
        `<v-avatar src="/ada.png" name="Ada Lovelace" :aria-label="said.get()"></v-avatar>`,
      ),
    })
    class Page {
      said = new Signal.State<string | undefined>('Ada Lovelace (you)');
    }

    const { instance, host } = show(Page);

    // Not on the box, where it would be a second name or none at all.
    expect(box(host).hasAttribute('aria-label')).toBe(false);
    expect(initials(host)?.textContent).toBe('AL');
    expect(initials(host)?.getAttribute('aria-label')).toBe('Ada Lovelace (you)');
    expect(heard(host)).toEqual(['Ada Lovelace (you)']);

    load(host);
    expect(picture(host).getAttribute('alt')).toBe('Ada Lovelace (you)');
    expect(heard(host)).toEqual(['Ada Lovelace (you)']);

    // Taken back, the name is what is heard again.
    instance.said.set(undefined);
    flushSync();
    expect(picture(host).getAttribute('alt')).toBe('Ada Lovelace');
  });

  it('takes `aria-label` for the name when there is no other', () => {
    @Component({
      selector: 'v-page-label-only',
      imports: [VAvatar],
      render: compileTemplate(`<v-avatar aria-label="Ada Lovelace"></v-avatar>`),
    })
    class Page {}

    const { host } = show(Page);
    expect(initials(host)?.textContent).toBe('AL');
    expect(initials(host)?.getAttribute('role')).toBe('img');
    expect(heard(host)).toEqual(['Ada Lovelace']);
  });

  it('puts the references where the name is, whichever element that is', () => {
    @Component({
      selector: 'v-page-references',
      imports: [VAvatar],
      render: compileTemplate(
        `<p id="who">Ada Lovelace, author</p><p id="presence">Online</p>
         <v-avatar src="/ada.png" name="Ada Lovelace" aria-labelledby="who"
                   aria-describedby="presence"></v-avatar>`,
      ),
    })
    class Page {}

    const { host } = show(Page);

    expect(box(host).hasAttribute('aria-labelledby')).toBe(false);
    expect(box(host).hasAttribute('aria-describedby')).toBe(false);
    // On the initials while they carry the name, and not on the quiet picture.
    expect(initials(host)?.getAttribute('aria-labelledby')).toBe('who');
    expect(initials(host)?.getAttribute('aria-describedby')).toBe('presence');
    expect(picture(host).hasAttribute('aria-labelledby')).toBe(false);
    // The name stays beside the reference, for a reference that finds nothing.
    expect(initials(host)?.getAttribute('aria-label')).toBe('Ada Lovelace');

    // And on the picture once it is the one carrying it.
    load(host);
    expect(picture(host).getAttribute('aria-labelledby')).toBe('who');
    expect(picture(host).getAttribute('aria-describedby')).toBe('presence');
  });

  it('says so when a reference has no name to fall back on', () => {
    @Component({
      selector: 'v-page-unnamed-reference',
      imports: [VAvatar],
      render: compileTemplate(`<v-avatar src="/crowd.png" aria-labelledby="who"></v-avatar>`),
    })
    class Page {}

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { host } = show(Page);

    // Decoration, as the primitive decided, and the reference put on nothing
    // it has hidden.
    expect(initials(host)?.getAttribute('aria-hidden')).toBe('true');
    expect(initials(host)?.hasAttribute('aria-labelledby')).toBe(false);
    expect(picture(host).hasAttribute('aria-labelledby')).toBe(false);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toMatch(/<v-avatar>[\s\S]*aria-labelledby[\s\S]*name/);
    warn.mockRestore();
  });

  it('keeps quiet about a reference that has a name beside it', () => {
    @Component({
      selector: 'v-page-named-reference',
      imports: [VAvatar],
      render: compileTemplate(
        `<v-avatar name="Ada Lovelace" aria-labelledby="who"></v-avatar>
         <v-avatar aria-label="Grace Hopper" aria-labelledby="who" aria-describedby="presence"></v-avatar>`,
      ),
    })
    class Page {}

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    show(Page);
    // `aria-label` is a name as much as `name` is, so a reference beside it
    // has somewhere to go.
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('says so when a description has no name to go beside', () => {
    @Component({
      selector: 'v-page-unnamed-description',
      imports: [VAvatar],
      render: compileTemplate(`<v-avatar src="/crowd.png" aria-describedby="presence"></v-avatar>`),
    })
    class Page {}

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { host } = show(Page);

    // Decoration, so the description is put on nothing — and it is dropped
    // just as a label would be, which is worth hearing about.
    expect(initials(host)?.hasAttribute('aria-describedby')).toBe(false);
    expect(picture(host).hasAttribute('aria-describedby')).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toMatch(/<v-avatar>[\s\S]*aria-describedby[\s\S]*name/);
    warn.mockRestore();
  });

  it('follows references bound to a signal, and drops one taken away', () => {
    @Component({
      selector: 'v-page-bound-references',
      imports: [VAvatar],
      render: compileTemplate(
        `<v-avatar src="/ada.png" name="Ada Lovelace" :aria-labelledby="by.get()"
                   :aria-describedby="about.get()"></v-avatar>`,
      ),
    })
    class Page {
      by = new Signal.State<string | undefined>('who');
      about = new Signal.State<string | undefined>('presence');
    }

    const { instance, host } = show(Page);
    expect(initials(host)?.getAttribute('aria-labelledby')).toBe('who');
    expect(initials(host)?.getAttribute('aria-describedby')).toBe('presence');

    instance.by.set('caption');
    instance.about.set(undefined);
    flushSync();
    expect(initials(host)?.getAttribute('aria-labelledby')).toBe('caption');
    expect(initials(host)?.hasAttribute('aria-describedby')).toBe(false);

    load(host);
    instance.about.set('away');
    flushSync();
    expect(picture(host).getAttribute('aria-labelledby')).toBe('caption');
    expect(picture(host).getAttribute('aria-describedby')).toBe('away');
  });

  it('takes `aria-label` for the name when `name` is only blanks', () => {
    // A name bound from data can arrive as spaces, which is no name at all:
    // the primitive trims it to nothing, so it must not stand in the way of
    // the words the caller did give.
    @Component({
      selector: 'v-page-blank-name',
      imports: [VAvatar],
      render: compileTemplate(`<v-avatar name="  " aria-label="Ada Lovelace"></v-avatar>`),
    })
    class Page {}

    const { host } = show(Page);
    expect(initials(host)?.textContent).toBe('AL');
    expect(initials(host)?.getAttribute('role')).toBe('img');
    expect(heard(host)).toEqual(['Ada Lovelace']);
  });

  it('ignores an `aria-label` of blanks, and says the name', () => {
    @Component({
      selector: 'v-page-blank-label',
      imports: [VAvatar],
      render: compileTemplate(`<v-avatar src="/ada.png" name="Ada Lovelace" aria-label="  "></v-avatar>`),
    })
    class Page {}

    const { host } = show(Page);
    expect(initials(host)?.getAttribute('aria-label')).toBe('Ada Lovelace');
    load(host);
    expect(picture(host).getAttribute('alt')).toBe('Ada Lovelace');
  });
});

/**
 * The bytes a server writes, which a reader meets before any script runs —
 * and meets for good if none does.
 *
 * `compileTemplate` picks its target from `__VOLT_SERVER__` when it is called,
 * so the tag is compiled here with the flag up, as a subclass that inherits
 * every prop: the client registration the rest of this file uses is left as
 * it is.
 */
describe('v-avatar, written by a server', () => {
  const serverBuild = (on: boolean): void => {
    (globalThis as { __VOLT_SERVER__?: boolean }).__VOLT_SERVER__ = on;
  };
  beforeAll(() => serverBuild(true));
  afterAll(() => serverBuild(false));

  /** Every name in the markup: a non-empty `alt`, or an `aria-label`. */
  const namesIn = (html: string): string[] =>
    [...html.matchAll(/\b(?:alt|aria-label)="([^"]+)"/g)].map((match) => match[1]!);

  it('says the name once, with the initials up and no element yet to point at', async () => {
    @Component({ selector: 'v-avatar', render: compileTemplate(template, 'v-avatar') })
    class ServerAvatar extends VAvatar {}

    @Component({
      selector: 'v-page-server',
      imports: [ServerAvatar],
      render: compileTemplate(
        `<v-avatar src="/ada.png" name="Ada Lovelace" aria-describedby="presence"></v-avatar>
         <v-avatar src="/crowd.png"></v-avatar>`,
      ),
    })
    class Page {}

    const { html } = await renderToStaticMarkup(Page);

    // The initials are what a server can show, so they carry the name, and
    // the picture beside them is quiet — as it is on the client until it has
    // loaded. A server has no elements, so this cannot wait for one.
    expect(html).toContain('role="img"');
    expect(namesIn(html)).toEqual(['Ada Lovelace']);
    expect(html.match(/aria-describedby="presence"/g)).toHaveLength(1);
    expect(html).toMatch(/<img[^>]*\balt=""[^>]*src="\/ada\.png"/);
    // The same status a browser's first flush writes, so a rule keyed on it
    // draws the server's markup too.
    expect(html).toMatch(/<span[^>]*data-status="loading"[^>]*class="volt-avatar"/);
    // The nameless one stays decoration, and its picture still has an `alt`.
    expect(html).toMatch(/<img[^>]*\balt=""[^>]*src="\/crowd\.png"/);
  });
});
