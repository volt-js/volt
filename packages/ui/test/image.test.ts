/**
 * `<v-image>`, driven the way a page drives it.
 *
 * How the load is watched is `createImage`'s, and is tested where it lives.
 * What is tested here is the shell: that what a caller writes on the tag
 * reaches the box their layout places, that every state the sheet draws is on
 * the element its rules select on, that the placeholder and the message stand
 * in the box exactly when they should, that `alt` is required and an empty one
 * is the primitive's decoration, that the names land on the picture rather
 * than on a box with no role, that every prop does something, and that the
 * primitive is within reach.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Component, Signal, flushSync, mount } from '@voltdev/core';
import { compileTemplate } from '@voltdev/core/jit';
import { renderToStaticMarkup } from '@voltdev/core/server';
import { createLocaleProvider } from '@voltdev/primitives';
import { compileComponents } from './render.js';
import { VImage } from '../src/components/image.js';
import { VSkeletonShape } from '../src/components/skeleton-shape.js';
import template from '../src/components/image.html?raw';
import { imageStyles } from '../src/sheet/image.js';
import { FORCED_COLORS_QUERY, rulesToCss, wrap, type Rule } from '../src/index.ts';
import { SYSTEM_COLORS, standIn, styledDocument, type Fixture } from './harness.ts';

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

/** A page of one tag, written as a caller writes it. */
let pages = 0;
function page(markup: string): new () => object {
  @Component({
    selector: `v-page-${(pages += 1)}`,
    imports: [VImage],
    render: compileTemplate(markup),
  })
  class Page {}
  return Page;
}

const box = (host: HTMLElement): HTMLElement => host.querySelector('.volt-image')!;
const picture = (host: HTMLElement): HTMLImageElement =>
  host.querySelector<HTMLImageElement>('.volt-image-picture')!;
const placeholder = (host: HTMLElement): HTMLElement | null =>
  host.querySelector('.volt-image-placeholder');
const message = (host: HTMLElement): HTMLElement | null => host.querySelector('.volt-image-error');

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
];

/** Which of the two stand-ins is in the box, if either. */
const standing = (host: HTMLElement): string[] =>
  [placeholder(host) && 'placeholder', message(host) && 'error'].filter(
    (part): part is string => Boolean(part),
  );

/** Hold every warning, so a test can read them and none reaches the console. */
const warnings = () => vi.spyOn(console, 'warn').mockImplementation(() => {});

describe('v-image', () => {
  it('is a box with the picture in it, with the sheet’s classes and the caller’s own', () => {
    const { host } = show(
      page(
        `<v-image class="mine" id="cover" data-test="cover" src="/cover.jpg"
                  alt="The first edition, in green cloth" width="1200" height="800"></v-image>`,
      ),
    );

    // What the caller wrote lands on the box, which is what the tag renders:
    // the element their layout places, and the one holding the space.
    expect(host.firstElementChild).toBe(box(host));
    expect([...box(host).classList].sort()).toEqual(['mine', 'volt-image']);
    expect(box(host).id).toBe('cover');
    expect(box(host).dataset['test']).toBe('cover');

    // The space, held before a byte arrives: the shape on the box, and the
    // size on the picture, which is what the box takes its width from.
    expect(box(host).style.getPropertyValue('aspect-ratio')).toBe('1200 / 800');
    expect(picture(host).getAttribute('width')).toBe('1200');
    expect(picture(host).getAttribute('height')).toBe('800');

    // The picture is fetched from the start, inside the box, and the
    // placeholder stands in the box until it arrives.
    expect(box(host).contains(picture(host))).toBe(true);
    expect(picture(host).getAttribute('src')).toBe('/cover.jpg');
    expect(picture(host).getAttribute('alt')).toBe('The first edition, in green cloth');
    expect(picture(host).hasAttribute('role')).toBe(false);
    expect(statuses(host)).toEqual(['loading', 'loading']);
    expect(standing(host)).toEqual(['placeholder']);
    expect(placeholder(host)?.getAttribute('aria-hidden')).toBe('true');

    // The defaults, written out, so a hand-written box and this one are drawn
    // by the same rules and fetched the same way.
    expect(picture(host).getAttribute('data-fit')).toBe('cover');
    expect(picture(host).getAttribute('loading')).toBe('lazy');
    expect(picture(host).getAttribute('decoding')).toBe('async');
  });

  it('shows the picture once it loads, the message when it fails, and nothing when there is none', () => {
    @Component({
      selector: 'v-page-states',
      imports: [VImage],
      render: compileTemplate(`<v-image :src="photo.get()" alt="A cover"></v-image>`),
    })
    class Page {
      photo = new Signal.State<string | null>('/cover.jpg');
    }

    const { instance, host } = show(Page);
    // The one image element throughout: an `<img>` taken off the page is one
    // the browser stops fetching.
    const image = picture(host);

    load(host);
    expect(statuses(host)).toEqual(['loaded', 'loaded']);
    expect(standing(host)).toEqual([]);

    // A bound `src` follows its signal: a new picture is a new load, and the
    // placeholder is back in the box while it comes.
    instance.photo.set('/cover-2.jpg');
    flushSync();
    expect(picture(host)).toBe(image);
    expect(picture(host).getAttribute('src')).toBe('/cover-2.jpg');
    expect(statuses(host)).toEqual(['loading', 'loading']);
    expect(standing(host)).toEqual(['placeholder']);

    // The message is words, because a broken-image icon reads as nothing.
    fail(host);
    expect(statuses(host)).toEqual(['error', 'error']);
    expect(standing(host)).toEqual(['error']);
    expect(message(host)?.textContent?.trim()).toBe('The picture did not load.');
    expect(message(host)?.hasAttribute('aria-hidden')).toBe(false);
    // The picture stays, `alt` and all: it is what a reader has of it.
    expect(picture(host)).toBe(image);
    expect(picture(host).getAttribute('alt')).toBe('A cover');

    // No picture at all: nothing is asked for — an empty `src` is a request
    // for the page itself — and nothing stands in for it either.
    instance.photo.set(null);
    flushSync();
    expect(picture(host)).toBe(image);
    expect(picture(host).hasAttribute('src')).toBe(false);
    expect(statuses(host)).toEqual(['idle', 'idle']);
    expect(standing(host)).toEqual([]);

    // And back: the same element, loading again.
    instance.photo.set('/cover.jpg');
    flushSync();
    expect(statuses(host)).toEqual(['loading', 'loading']);
  });

  it('asks for the picture once, however often its status, its words or its names move', () => {
    @Component({
      selector: 'v-page-asked-once',
      imports: [VImage],
      render: compileTemplate(
        `<v-image :src="photo.get()" srcset="/cover-1x.jpg 1x, /cover-2x.jpg 2x" sizes="50vw"
                  :alt="said.get()" :aria-label="spoken.get()"></v-image>`,
      ),
    })
    class Page {
      photo = new Signal.State('/missing.jpg');
      said = new Signal.State<string | undefined>(undefined);
      spoken = new Signal.State<string | undefined>(undefined);
    }

    const { instance, host } = show(Page);

    // Every write of a source, the same value included: a browser takes
    // `src` written again as the picture asked for again, and a picture that
    // failed is fetched again — so a status that moved, or a name that
    // changed, would each have cost a request for the same missing file.
    const written = new MutationObserver(() => {});
    written.observe(picture(host), { attributeFilter: ['src', 'srcset', 'sizes'] });
    const sources = (): string[] => written.takeRecords().map((record) => record.attributeName!);

    fail(host);
    expect(statuses(host)).toEqual(['error', 'error']);
    instance.said.set('The first edition');
    instance.spoken.set('The first edition, in green cloth');
    flushSync();
    expect(picture(host).getAttribute('alt')).toBe('The first edition');
    expect(sources()).toEqual([]);

    // A new picture is the one write, and the load that follows adds none.
    instance.photo.set('/cover.jpg');
    flushSync();
    expect(sources()).toEqual(['src']);
    load(host);
    expect(sources()).toEqual([]);
    expect(picture(host).getAttribute('src')).toBe('/cover.jpg');
    expect(picture(host).getAttribute('srcset')).toBe('/cover-1x.jpg 1x, /cover-2x.jpg 2x');
    expect(picture(host).getAttribute('sizes')).toBe('50vw');
    written.disconnect();
  });

  it('refuses a tag with no `alt`', () => {
    // Refused rather than read out as a URL: it is the one decision about a
    // picture that cannot be deferred.
    expect(() => show(page(`<v-image src="/cover.jpg"></v-image>`))).toThrow(
      /<v-image>[\s\S]*"alt"/,
    );
  });

  it('builds the primitive decorative for an empty `alt`, and the primitive marks it so', () => {
    @Component({
      selector: 'v-page-decorative',
      imports: [VImage],
      render: compileTemplate(`<v-image :ref="flourish" src="/flourish.svg" alt=""></v-image>`),
    })
    class Page {
      flourish: VImage | null = null;
    }

    const { instance, host } = show(Page);

    // The primitive's word, not the component's: an empty alt, so it is
    // skipped, and `role="presentation"` beside it, so a sanitiser that strips
    // empty attributes cannot turn it back into a URL being read aloud.
    expect(instance.flourish!.image.isDecorative()).toBe(true);
    expect(picture(host).getAttribute('alt')).toBe('');
    expect(picture(host).getAttribute('role')).toBe('presentation');

    // A failure of a picture that says nothing says nothing either.
    fail(host);
    expect(message(host)?.textContent?.trim()).toBe('The picture did not load.');
    expect(message(host)?.getAttribute('aria-hidden')).toBe('true');
  });

  it('takes `alt` written bare for an empty one, as HTML does', () => {
    const { host } = show(page(`<v-image src="/flourish.svg" alt></v-image>`));
    // `<img alt>` is `alt=""`, and a tag written the same way means the same.
    expect(picture(host).getAttribute('alt')).toBe('');
    expect(picture(host).getAttribute('role')).toBe('presentation');
    expect(picture(host).getAttribute('src')).toBe('/flourish.svg');
  });

  it('takes spaces for an empty `alt`, since spaces are not a description', () => {
    const { host } = show(page(`<v-image src="/flourish.svg" alt="   "></v-image>`));
    expect(picture(host).getAttribute('alt')).toBe('');
    expect(picture(host).getAttribute('role')).toBe('presentation');
  });

  it('follows the `alt` it is bound to, from no words yet to words', () => {
    @Component({
      selector: 'v-page-bound-alt',
      imports: [VImage],
      render: compileTemplate(`<v-image :ref="cover" src="/cover.jpg" :alt="said.get()"></v-image>`),
    })
    class Page {
      cover: VImage | null = null;
      /** A title still on its way, which is `undefined` and not decoration. */
      said = new Signal.State<string | undefined>(undefined);
    }

    const warn = warnings();
    const { instance, host } = show(Page);

    // Nothing is read out as a URL meanwhile, and nothing is decided either.
    expect(instance.cover!.image.isDecorative()).toBe(false);
    expect(picture(host).getAttribute('alt')).toBe('');
    expect(picture(host).hasAttribute('role')).toBe(false);

    instance.said.set('  The first edition ');
    flushSync();
    expect(picture(host).getAttribute('alt')).toBe('The first edition');

    instance.said.set('The second edition');
    flushSync();
    expect(picture(host).getAttribute('alt')).toBe('The second edition');
    expect(warn).not.toHaveBeenCalled();
  });

  it('says so when words arrive for a picture built as decoration, once', () => {
    @Component({
      selector: 'v-page-late-words',
      imports: [VImage],
      render: compileTemplate(`<v-image src="/cover.jpg" :alt="said.get()"></v-image>`),
    })
    class Page {
      /** The trap: `''` while the title loads. */
      said = new Signal.State('');
    }

    const warn = warnings();
    const { instance, host } = show(Page);
    expect(warn).not.toHaveBeenCalled();

    instance.said.set('The first edition');
    flushSync();
    instance.said.set('The second edition');
    flushSync();

    // The primitive decided, and it decides once: the words are not written.
    expect(picture(host).getAttribute('alt')).toBe('');
    expect(picture(host).getAttribute('role')).toBe('presentation');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toMatch(
      /<v-image>[\s\S]*empty `alt`[\s\S]*The first edition[\s\S]*undefined/,
    );
  });

  it('hands `srcset` and `sizes` to the picture, follows them, and loads from `srcset` alone', () => {
    @Component({
      selector: 'v-page-sources',
      imports: [VImage],
      render: compileTemplate(
        `<v-image alt="A cover" :srcset="candidates.get()" :sizes="widths.get()"></v-image>`,
      ),
    })
    class Page {
      candidates = new Signal.State('/cover-1x.jpg 1x, /cover-2x.jpg 2x');
      widths = new Signal.State('50vw');
    }

    const { instance, host } = show(Page);

    // A source on its own: the browser is the one choosing, so there is
    // nothing for `src` to say.
    expect(picture(host).hasAttribute('src')).toBe(false);
    expect(picture(host).getAttribute('srcset')).toBe('/cover-1x.jpg 1x, /cover-2x.jpg 2x');
    expect(picture(host).getAttribute('sizes')).toBe('50vw');
    expect(statuses(host)).toEqual(['loading', 'loading']);
    expect(standing(host)).toEqual(['placeholder']);

    instance.candidates.set('/cover-800.jpg 800w, /cover-1600.jpg 1600w');
    instance.widths.set('(min-width: 60rem) 30rem, 100vw');
    flushSync();
    expect(picture(host).getAttribute('srcset')).toBe('/cover-800.jpg 800w, /cover-1600.jpg 1600w');
    expect(picture(host).getAttribute('sizes')).toBe('(min-width: 60rem) 30rem, 100vw');
  });

  it('reads a size written as an attribute, or bound as a number', () => {
    const { host } = show(
      page(`<v-image src="/cover.jpg" alt="A cover" width="640" :height="480"></v-image>`),
    );
    // `'640'` is what an attribute hands over, and it has to become the number
    // the primitive holds the space with, not a string it drops.
    expect(box(host).style.getPropertyValue('aspect-ratio')).toBe('640 / 480');
    expect(picture(host).getAttribute('width')).toBe('640');
    expect(picture(host).getAttribute('height')).toBe('480');
  });

  it.each(['100%', '0', '-5', 'Infinity', ' ', 'wide'])(
    'refuses `%s` for a size, rather than a box with no shape',
    (size) => {
      // A length in CSS is a class's business, and the primitive would drop
      // every one of these without a word.
      expect(() =>
        show(page(`<v-image src="/cover.jpg" alt="A cover" width="${size}" height="800"></v-image>`)),
      ).toThrow(/`width` on <v-image>[\s\S]*CSS pixels/);
    },
  );

  it('takes `ratio` for the shape, over the one the size implies and on its own', () => {
    const { host } = show(
      page(
        `<div>
           <v-image class="sized" src="/wide.jpg" alt="A wide one" width="1200" height="800" ratio="16 / 9"></v-image>
           <v-image class="shaped" src="/unknown.jpg" alt="A picture of no known size" ratio="4/3"></v-image>
         </div>`,
      ),
    );
    const sized = host.querySelector<HTMLElement>('.sized')!;
    const shaped = host.querySelector<HTMLElement>('.shaped')!;

    // The ratio wins the box; the size is still on the picture, which is
    // where the box takes its width from.
    expect(sized.style.getPropertyValue('aspect-ratio')).toBe('16 / 9');
    expect(sized.querySelector('img')?.getAttribute('width')).toBe('1200');

    // Nothing to write on the picture, and a shape for the box all the same.
    expect(shaped.style.getPropertyValue('aspect-ratio')).toBe('4 / 3');
    expect(shaped.querySelector('img')?.hasAttribute('width')).toBe(false);
    expect(shaped.querySelector('img')?.hasAttribute('height')).toBe(false);
  });

  it.each(['16:9', '0 / 9', '16 / 9 / 2', 'wide', '', 'Infinity / 1', '0x10'])(
    'refuses `%s` for a ratio, which a browser would drop without a word',
    (ratio) => {
      expect(() =>
        show(page(`<v-image src="/cover.jpg" alt="A cover" ratio="${ratio}"></v-image>`)),
      ).toThrow(/`ratio` on <v-image>[\s\S]*16 \/ 9/);
    },
  );

  it('holds no space open when it has no idea of the shape', () => {
    const { host } = show(page(`<v-image src="/cover.jpg" alt="A cover"></v-image>`));
    expect(box(host).style.getPropertyValue('aspect-ratio')).toBe('');
    expect(picture(host).hasAttribute('width')).toBe(false);
  });

  it('keeps the caller’s own style beside the primitive’s shape', () => {
    const { host } = show(
      page(`<v-image src="/cover.jpg" alt="A cover" ratio="16 / 9" style="inline-size: 20rem"></v-image>`),
    );
    // Adds to what was written, never over it: the width is the caller's way
    // of sizing a box that only knows its shape.
    expect(box(host).style.getPropertyValue('inline-size')).toBe('20rem');
    expect(box(host).style.getPropertyValue('aspect-ratio')).toBe('16 / 9');
  });

  it('writes `fit` on the picture and follows it', () => {
    @Component({
      selector: 'v-page-fit',
      imports: [VImage],
      render: compileTemplate(`<v-image src="/cover.jpg" alt="A cover" :fit="how.get()"></v-image>`),
    })
    class Page {
      how = new Signal.State<'cover' | 'contain'>('contain');
    }

    const { instance, host } = show(Page);
    expect(picture(host).getAttribute('data-fit')).toBe('contain');

    instance.how.set('cover');
    flushSync();
    expect(picture(host).getAttribute('data-fit')).toBe('cover');
  });

  it('writes the loading and decoding hints it was given', () => {
    const { host } = show(
      page(`<v-image src="/hero.jpg" alt="The hero" loading="eager" decoding="sync"></v-image>`),
    );
    // The one picture that must not wait says so, and is decoded in the same
    // frame as the words beside it.
    expect(picture(host).getAttribute('loading')).toBe('eager');
    expect(picture(host).getAttribute('decoding')).toBe('sync');
  });

  it('calls `onLoad` and `onError` once each, when a load is over', () => {
    @Component({
      selector: 'v-page-callbacks',
      imports: [VImage],
      render: compileTemplate(
        `<v-image :src="photo.get()" alt="A cover" :onLoad="loaded" :onError="failed"></v-image>`,
      ),
    })
    class Page {
      photo = new Signal.State('/cover.jpg');
      loaded = vi.fn();
      failed = vi.fn();
    }

    const { instance, host } = show(Page);
    // A load starting is not news.
    expect(instance.loaded).not.toHaveBeenCalled();
    expect(instance.failed).not.toHaveBeenCalled();

    load(host);
    expect(instance.loaded).toHaveBeenCalledTimes(1);
    expect(instance.failed).not.toHaveBeenCalled();

    instance.photo.set('/missing.jpg');
    flushSync();
    fail(host);
    expect(instance.loaded).toHaveBeenCalledTimes(1);
    expect(instance.failed).toHaveBeenCalledTimes(1);
  });

  it('calls `onLoad` for a picture that was in the cache before anything listened', () => {
    // Complete before the first look: its `load` event fired with nobody
    // there, and will not fire again.
    vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true);
    vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(1200);

    @Component({
      selector: 'v-page-cached',
      imports: [VImage],
      render: compileTemplate(`<v-image src="/cover.jpg" alt="A cover" :onLoad="loaded"></v-image>`),
    })
    class Page {
      loaded = vi.fn();
    }

    const { instance, host } = show(Page);
    expect(statuses(host)).toEqual(['loaded', 'loaded']);
    expect(standing(host)).toEqual([]);
    expect(instance.loaded).toHaveBeenCalledTimes(1);
  });

  it('lets a caller draw the placeholder, and takes it down when the picture arrives', () => {
    @Component({
      selector: 'v-page-placeholder',
      imports: [VImage, VSkeletonShape],
      render: compileTemplate(
        `<v-image src="/cover.jpg" alt="A cover" ratio="3 / 2">
           <v-skeleton-shape :slot-placeholder shape="block" height="100%"></v-skeleton-shape>
         </v-image>`,
      ),
    })
    class Page {}

    const { host } = show(Page);

    // Inside the placeholder, which is hidden from a reader as a whole.
    const shape = host.querySelector('.volt-skeleton-shape');
    expect(shape).not.toBeNull();
    expect(placeholder(host)?.contains(shape)).toBe(true);

    load(host);
    expect(host.querySelector('.volt-skeleton-shape')).toBeNull();
    expect(placeholder(host)).toBeNull();
  });

  it('lets a caller say in their own words that the picture did not load', () => {
    const { host } = show(
      page(
        `<v-image src="/cover.jpg" alt="A cover">
           <span :slot-error class="apology">No cover for this one.</span>
         </v-image>`,
      ),
    );
    expect(host.querySelector('.apology')).toBeNull();

    fail(host);
    // Their words replace the default rather than joining it.
    expect(message(host)?.querySelector('.apology')?.textContent).toBe('No cover for this one.');
    expect(message(host)?.textContent?.trim()).toBe('No cover for this one.');
  });

  it('says that the picture did not load in the provider’s words, and in English without one', () => {
    @Component({
      selector: 'v-page-german',
      imports: [VImage],
      render: compileTemplate(`<v-image src="/cover.jpg" alt="Die Erstausgabe"></v-image>`),
    })
    class German {
      locale = createLocaleProvider({
        defaultLocale: 'de',
        messages: { imageFailed: 'Das Bild wurde nicht geladen.' },
      });
    }

    // The message is the one thing the tag says in words of its own, so it is
    // the locale's to say, as every other word the library speaks is.
    const german = show(German).host;
    fail(german);
    expect(message(german)?.textContent?.trim()).toBe('Das Bild wurde nicht geladen.');
    unmount?.();
    unmount = null;

    // A provider with no word for it is no reason to say nothing.
    @Component({
      selector: 'v-page-french',
      imports: [VImage],
      render: compileTemplate(`<v-image src="/cover.jpg" alt="La première édition"></v-image>`),
    })
    class French {
      locale = createLocaleProvider({ defaultLocale: 'fr' });
    }
    const french = show(French).host;
    fail(french);
    expect(message(french)?.textContent?.trim()).toBe('The picture did not load.');
  });

  it('puts the names on the picture, not on the box, and follows them', () => {
    @Component({
      selector: 'v-page-names',
      imports: [VImage],
      render: compileTemplate(
        `<p id="caption">The first edition, photographed in 1998</p><p id="credit">Photo: A. Lovelace</p>
         <v-image src="/cover.jpg" alt="The first edition" aria-labelledby="caption"
                  :aria-describedby="credit.get()" :aria-label="spoken.get()"></v-image>`,
      ),
    })
    class Page {
      credit = new Signal.State<string | undefined>('credit');
      spoken = new Signal.State<string | undefined>('The first edition, in green cloth');
    }

    const { instance, host } = show(Page);

    // The box has no role, where a name is thrown away.
    for (const name of ['aria-label', 'aria-labelledby', 'aria-describedby']) {
      expect(box(host).hasAttribute(name), name).toBe(false);
    }
    expect(picture(host).getAttribute('aria-label')).toBe('The first edition, in green cloth');
    expect(picture(host).getAttribute('aria-labelledby')).toBe('caption');
    expect(picture(host).getAttribute('aria-describedby')).toBe('credit');
    // The `alt` stays beside them, to be heard if a reference finds nothing.
    expect(picture(host).getAttribute('alt')).toBe('The first edition');

    instance.credit.set(undefined);
    instance.spoken.set(undefined);
    flushSync();
    expect(picture(host).hasAttribute('aria-describedby')).toBe(false);
    expect(picture(host).hasAttribute('aria-label')).toBe(false);

    // Spaces are not a name: one would hide the `alt` behind nothing.
    instance.spoken.set('   ');
    flushSync();
    expect(picture(host).hasAttribute('aria-label')).toBe(false);
  });

  it('drops a name from a picture that says nothing, and says so', () => {
    const warn = warnings();
    const { host } = show(
      page(`<v-image src="/flourish.svg" alt="" aria-label="A flourish" aria-describedby="caption"></v-image>`),
    );

    // A global ARIA attribute overrides `role="presentation"`, so a
    // description on a decorative picture would announce it again, nameless.
    // The primitive's decision is the one kept.
    expect(picture(host).getAttribute('role')).toBe('presentation');
    expect(picture(host).hasAttribute('aria-label')).toBe(false);
    expect(picture(host).hasAttribute('aria-describedby')).toBe(false);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toMatch(
      /<v-image>[\s\S]*aria-label="A flourish" and aria-describedby="caption"[\s\S]*empty `alt`/,
    );
  });

  it('keeps quiet about a name beside an `alt` that says something', () => {
    const warn = warnings();
    show(page(`<v-image src="/cover.jpg" alt="A cover" aria-describedby="caption"></v-image>`));
    expect(warn).not.toHaveBeenCalled();
  });

  it('hands the primitive over', () => {
    @Component({
      selector: 'v-page-ref',
      imports: [VImage],
      render: compileTemplate(
        `<v-image :ref="cover" src="/cover.jpg" alt="A cover" width="1200" height="800"></v-image>`,
      ),
    })
    class Page {
      cover: VImage | null = null;
    }

    const { instance, host } = show(Page);

    expect(instance.cover).toBeInstanceOf(VImage);
    expect(instance.cover!.image.status()).toBe('loading');
    expect(instance.cover!.image.aspectRatio()).toBe('1200 / 800');
    expect(instance.cover!.image.isDecorative()).toBe(false);

    load(host);
    expect(instance.cover!.image.status()).toBe('loaded');
    expect(instance.cover!.image.isLoaded()).toBe(true);
  });

  it('hands the primitive to a page that draws from its status, wherever that is written', () => {
    // The pattern the docs give: the ref held in a signal, so that a binding
    // read before the picture existed — one written above it — is read again
    // once it does, rather than having found nothing and tracked nothing.
    @Component({
      selector: 'v-page-ref-status',
      imports: [VImage],
      render: compileTemplate(
        `<p class="failed" :if="failed()">Could not load the cover</p>
         <v-image :ref="cover" src="/cover.jpg" alt="A cover"></v-image>`,
      ),
    })
    class Page {
      cover = new Signal.State<VImage | null>(null);
      failed(): boolean {
        return this.cover.get()?.image.hasError() === true;
      }
    }

    const { host } = show(Page);
    expect(host.querySelector('.failed')).toBeNull();
    fail(host);
    expect(host.querySelector('.failed')).not.toBeNull();
  });

  it('takes no focus and answers no key', () => {
    const { host } = show(page(`<v-image src="/cover.jpg" alt="A cover"></v-image>`));

    // A picture is something to look at: the primitive gives it no keyboard,
    // and nothing here puts it in the tab order to find none there.
    expect(host.querySelectorAll('[tabindex]')).toHaveLength(0);
    expect(host.querySelectorAll('button, a, input')).toHaveLength(0);

    for (const key of ['Enter', ' ', 'Escape']) {
      box(host).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      flushSync();
    }
    expect(statuses(host)).toEqual(['loading', 'loading']);
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
describe('v-image, written by a server', () => {
  const serverBuild = (on: boolean): void => {
    (globalThis as { __VOLT_SERVER__?: boolean }).__VOLT_SERVER__ = on;
  };
  beforeAll(() => serverBuild(true));
  afterAll(() => serverBuild(false));

  it('writes the status the primitive is built with: loading, with the placeholder up', async () => {
    @Component({ selector: 'v-image', render: compileTemplate(template, 'v-image') })
    class ServerImage extends VImage {}

    @Component({
      selector: 'v-page-server',
      imports: [ServerImage],
      render: compileTemplate(
        `<v-image src="/cover.jpg" alt="The first edition" width="1200" height="800">
           <span :slot-placeholder class="shimmer"></span>
         </v-image>
         <v-image src="/flourish.svg" alt=""></v-image>
         <v-image alt="Nothing yet"><span :slot-placeholder class="never"></span></v-image>
         <v-image srcset="/cover-1x.jpg 1x, /cover-2x.jpg 2x" alt="Candidates only"></v-image>
         <v-image src="   " alt="Only spaces"></v-image>`,
      ),
    })
    class Page {}

    const { html } = await renderToStaticMarkup(Page);
    // Read back as a page would read it, so each box is looked at on its own.
    const parsed = document.createElement('template');
    parsed.innerHTML = html;
    const [cover, flourish, empty, candidates, spaces] = [
      ...parsed.content.querySelectorAll<HTMLElement>('.volt-image'),
    ];
    const img = (box: HTMLElement | undefined) => box!.querySelector('.volt-image-picture')!;

    // The same status a browser's first flush writes, so a rule keyed on it
    // draws the server's markup too — and the placeholder with it, which is
    // what a reader sees until the picture has painted over it. A server has
    // no elements and runs no effects, so this cannot wait for either.
    expect(cover!.getAttribute('data-status')).toBe('loading');
    expect(img(cover).getAttribute('data-status')).toBe('loading');
    expect(cover!.querySelector('.volt-image-placeholder .shimmer')).not.toBeNull();
    expect(html).not.toContain('volt-image-error');

    // The space, held from the first byte: the shape on the box and the size
    // on the picture, where a browser reads a ratio before the bytes arrive.
    expect(cover!.getAttribute('style')).toMatch(/aspect-ratio:\s*1200 \/ 800/);
    expect(img(cover).getAttribute('width')).toBe('1200');
    expect(img(cover).getAttribute('height')).toBe('800');
    expect(img(cover).getAttribute('alt')).toBe('The first edition');
    expect(img(cover).getAttribute('src')).toBe('/cover.jpg');
    expect(img(cover).getAttribute('loading')).toBe('lazy');

    // The decorative one is decoration for anyone who meets it, script or no.
    expect(img(flourish).getAttribute('alt')).toBe('');
    expect(img(flourish).getAttribute('role')).toBe('presentation');

    // Nothing to load is nothing loading, on a server as anywhere.
    expect(empty!.getAttribute('data-status')).toBe('idle');
    expect(empty!.querySelector('.never')).toBeNull();

    // The same reading of a source the primitive makes in a browser, so the
    // two agree on the first byte: candidates alone are something to load,
    // and spaces are not a source.
    expect(candidates!.getAttribute('data-status')).toBe('loading');
    expect(img(candidates).getAttribute('srcset')).toBe('/cover-1x.jpg 1x, /cover-2x.jpg 2x');
    expect(spaces!.getAttribute('data-status')).toBe('idle');
    expect(img(spaces).hasAttribute('src')).toBe(false);
  });
});

/**
 * What the sheet draws, measured in a document that has it.
 *
 * The registry's sweeps check that each state differs from the next; these
 * check that each rule says what it is for, so that one taken away is a test
 * that fails rather than a picture that quietly looks wrong.
 */
describe('v-image, drawn by its sheet', () => {
  /** The rules as the harness writes the package's own: system colours as their stand-ins. */
  function imageCss(): string {
    const standIns = (list: readonly Rule[]): Rule[] =>
      list.map((rule) => ({
        selector: rule.selector,
        declarations: Object.fromEntries(
          Object.entries(rule.declarations).map(([property, value]) => [
            property,
            SYSTEM_COLORS.includes(value) ? standIn(value) : value,
          ]),
        ),
      }));
    return [
      rulesToCss(standIns(imageStyles.rules)),
      wrap(FORCED_COLORS_QUERY, rulesToCss(standIns(imageStyles.forcedColors), '  ')),
    ].join('\n\n');
  }

  const plain = styledDocument();
  const forced = styledDocument({ forcedColors: true });
  plain.addConsumerCss(imageCss());
  forced.addConsumerCss(imageCss());

  afterAll(async () => {
    await Promise.all([plain.close(), forced.close()]);
  });

  /** The box as the component writes it, in a status, with or without a size of its own. */
  const fixture = (status: string, options: { sized?: boolean; fit?: string } = {}): Fixture => ({
    tag: 'span',
    classes: ['volt-image'],
    attributes: { 'data-status': status, style: 'aspect-ratio: 3 / 2' },
    children: [
      {
        tag: 'img',
        classes: ['volt-image-picture'],
        attributes: {
          alt: 'A cover',
          'data-status': status,
          'data-fit': options.fit ?? 'cover',
          ...(options.sized === false ? {} : { width: '1200', height: '800' }),
        },
      },
      ...(status === 'loading'
        ? [{ tag: 'span', classes: ['volt-image-placeholder'], attributes: { 'aria-hidden': 'true' } }]
        : []),
      ...(status === 'error' ? [{ tag: 'span', classes: ['volt-image-error'] }] : []),
    ],
  });

  type Dom = typeof plain;
  const styleOf = (dom: Dom, element: Element): CSSStyleDeclaration =>
    dom.window.getComputedStyle(element as never) as unknown as CSSStyleDeclaration;
  const part = (dom: Dom, root: Element, name: string): CSSStyleDeclaration =>
    styleOf(dom, root.querySelector(`.volt-image-${name}`)!);

  /** A token as the document resolves it. */
  const token = (dom: Dom, name: string): string => {
    const probe = dom.mount({ tag: 'span', attributes: { style: `background-color: var(${name})` } });
    const value = styleOf(dom, probe).getPropertyValue('background-color');
    probe.remove();
    return value;
  };

  it('holds the space in a fill apart from either surface a page is painted in', () => {
    // A page is painted `surface` or `surface-sunken` — the documentation's
    // own frame is the second — and a fill that is either one of them holds
    // the space in a colour nobody can see, with the message floating in it.
    const surfaces = [token(plain, '--volt-color-surface'), token(plain, '--volt-color-surface-sunken')];
    for (const status of ['idle', 'loading', 'error']) {
      const fill = styleOf(plain, plain.mount(fixture(status))).getPropertyValue('background-color');
      expect(fill, status).not.toBe('');
      expect(surfaces, status).not.toContain(fill);
    }
    // And none once the picture is there to say where it is, so a picture
    // with transparency sits on the page rather than on a card.
    const loaded = styleOf(plain, plain.mount(fixture('loaded'))).getPropertyValue('background-color');
    expect(['', 'transparent', 'rgba(0, 0, 0, 0)']).toContain(loaded);
  });

  it('crops the picture to the box, or letterboxes it for `contain`', () => {
    expect(part(plain, plain.mount(fixture('loaded')), 'picture').getPropertyValue('object-fit')).toBe('cover');
    const contained = plain.mount(fixture('loaded', { fit: 'contain' }));
    expect(part(plain, contained, 'picture').getPropertyValue('object-fit')).toBe('contain');
  });

  it('hides a picture with nothing to show, and keeps it for a reader', () => {
    for (const status of ['idle', 'error']) {
      const picture = part(plain, plain.mount(fixture(status)), 'picture');
      // In opacity, which keeps its `alt` in the accessibility tree, and
      // folded to no height, so a broken icon takes none of the box.
      expect(picture.getPropertyValue('opacity'), status).toBe('0');
      expect(picture.getPropertyValue('block-size'), status).toBe('0');
      expect(['none', 'hidden'], status).not.toContain(picture.getPropertyValue('display'));
      expect(picture.getPropertyValue('visibility'), status).not.toBe('hidden');
    }
    // A picture on its way is seen as it paints, and one that is there is.
    for (const status of ['loading', 'loaded']) {
      const picture = part(plain, plain.mount(fixture(status)), 'picture');
      expect(picture.getPropertyValue('opacity'), status).not.toBe('0');
      expect(picture.getPropertyValue('block-size'), status).toBe('100%');
    }
  });

  it('lays the placeholder over the whole box, beneath the picture', () => {
    const placeholder = part(plain, plain.mount(fixture('loading')), 'placeholder');
    expect(placeholder.getPropertyValue('position')).toBe('absolute');
    expect(placeholder.getPropertyValue('z-index')).toBe('-1');
    expect(placeholder.getPropertyValue('inline-size')).toBe('100%');
    expect(placeholder.getPropertyValue('block-size')).toBe('100%');
    // Beneath the picture, but not beneath the page.
    const root = styleOf(plain, plain.mount(fixture('loading')));
    expect(root.getPropertyValue('isolation')).toBe('isolate');
    expect(root.getPropertyValue('position')).toBe('relative');
  });

  it('holds the ratio by clipping, and takes its container’s width when the picture has none', () => {
    const sized = styleOf(plain, plain.mount(fixture('loading')));
    expect(sized.getPropertyValue('overflow-y')).toBe('hidden');
    expect(sized.getPropertyValue('overflow-x')).toBe('hidden');
    // The picture's own `width` is what sizes a box that has one.
    expect(sized.getPropertyValue('inline-size')).not.toBe('100%');
    const unsized = styleOf(plain, plain.mount(fixture('loading', { sized: false })));
    expect(unsized.getPropertyValue('inline-size')).toBe('100%');
  });

  it('lays the box out as an `<img>` is laid out, and fills it with whatever stands there', () => {
    // Shrunk to its picture's width and never wider than its container, as an
    // `<img>` is; without the cap a picture `width="1200"` runs off a phone.
    const root = styleOf(plain, plain.mount(fixture('loading')));
    expect(root.getPropertyValue('display')).toBe('inline-block');
    expect(root.getPropertyValue('max-inline-size')).toBe('100%');

    // The picture is the box's width both ways — a small one is not left in a
    // corner of a ratio — and a block, so no line's descender sits under it.
    const picture = part(plain, plain.mount(fixture('loaded', { sized: false })), 'picture');
    expect(picture.getPropertyValue('display')).toBe('block');
    expect(picture.getPropertyValue('min-inline-size')).toBe('100%');
    expect(picture.getPropertyValue('max-inline-size')).toBe('100%');

    // The placeholder stretches what the slot holds to the box.
    const placeholder = part(plain, plain.mount(fixture('loading')), 'placeholder');
    expect(placeholder.getPropertyValue('display')).toBe('grid');
    expect(placeholder.getPropertyValue('justify-items')).toBe('stretch');
    expect(placeholder.getPropertyValue('align-items')).toBe('stretch');

    // The message fills a box that has a height and is centred in it, and is
    // no width of its own, so a sentence cannot widen a box its picture sized.
    const message = part(plain, plain.mount(fixture('error')), 'error');
    expect(message.getPropertyValue('display')).toBe('flex');
    expect(message.getPropertyValue('align-items')).toBe('center');
    expect(message.getPropertyValue('justify-content')).toBe('center');
    expect(message.getPropertyValue('inline-size')).toBe('100%');
    expect(message.getPropertyValue('block-size')).toBe('100%');
    expect(message.getPropertyValue('contain')).toBe('inline-size');
  });

  it('outlines the space it holds once the palette is the user’s, and only then', () => {
    // The fill goes with the palette, and a box with no fill and no edge is
    // no shape: the outline is what says where a picture will be.
    const probe = forced.mount({
      tag: 'span',
      attributes: { style: 'outline-style: solid; outline-width: var(--volt-border-width-1)' },
    });
    const borderWidth = styleOf(forced, probe).getPropertyValue('outline-width');
    probe.remove();
    expect(borderWidth).not.toBe('');
    for (const status of ['idle', 'loading', 'error']) {
      const box = styleOf(forced, forced.mount(fixture(status)));
      expect(box.getPropertyValue('outline-style'), status).toBe('solid');
      expect(box.getPropertyValue('outline-color'), status).toBe(standIn('CanvasText'));
      expect(box.getPropertyValue('background-color'), status).toBe(standIn('Canvas'));
      // A border's width, drawn inside the box: a container that clips its
      // overflow, or a neighbour flush against it, would hide one outside.
      expect(box.getPropertyValue('outline-width'), status).toBe(borderWidth);
      expect(box.getPropertyValue('outline-offset'), status).toMatch(/^(-|calc\(-1)/);
    }
    // A picture that is there says so itself.
    const undrawn = ['', 'none'];
    expect(undrawn).toContain(
      styleOf(forced, forced.mount(fixture('loaded'))).getPropertyValue('outline-style'),
    );
    // And the ordinary palette draws no line round a picture at all.
    expect(undrawn).toContain(
      styleOf(plain, plain.mount(fixture('loading'))).getPropertyValue('outline-style'),
    );
  });

  it('writes the message in the palette’s own text colour', () => {
    const message = part(forced, forced.mount(fixture('error')), 'error');
    expect(message.getPropertyValue('color')).toBe(standIn('CanvasText'));
  });
});
