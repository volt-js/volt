/**
 * `<v-skeleton>`, driven the way a page drives it.
 *
 * The behaviour is `createSkeleton`'s and is tested where it lives. What is
 * tested here is the shell: that what a caller writes on the tag reaches the
 * element standing in for their content, that the boxes are the shape and the
 * number they asked for, that both states the sheet draws are on the element
 * its rules select on, that the live region is outside the `aria-busy` that
 * would have silenced it, and that every prop forwarded to the primitive does
 * something.
 *
 * Three of those props are timers, so three of these tests wait. Real ones
 * rather than fake: `createDeferredVisibility` measures with `Date.now()` as
 * well as scheduling with `setTimeout`, and a clock only half moved forward
 * reports a minimum that has elapsed and a placeholder that never comes down.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Component, Signal, flushSync, mount } from '@voltdev/core';
import { compileTemplate } from '@voltdev/core/jit';
import { compileComponents } from './render.js';
import { VSkeleton } from '../src/components/skeleton.js';
import { VSkeletonShape } from '../src/components/skeleton-shape.js';

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

/** Let a real timer fire, then let what it wrote reach the DOM. */
async function settle(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
  flushSync();
}

const root = (host: HTMLElement): HTMLElement => host.querySelector('.volt-skeleton')!;
const placeholder = (host: HTMLElement): HTMLElement | null =>
  host.querySelector('.volt-skeleton-placeholder');
const shapes = (host: HTMLElement): HTMLElement[] => [
  ...host.querySelectorAll<HTMLElement>('.volt-skeleton-shape'),
];
const region = (host: HTMLElement): HTMLElement => host.querySelector('.volt-skeleton-status')!;
const message = (host: HTMLElement): string => region(host).textContent ?? '';

describe('v-skeleton', () => {
  it('is boxes and a live region, with the sheet’s classes and the caller’s own', () => {
    @Component({
      selector: 'v-page',
      imports: [VSkeleton],
      render: compileTemplate(
        `<v-skeleton class="card" id="feed" data-test="feed" aria-describedby="hint"
                      :loading="pending">
           <p class="body">Arrived</p>
         </v-skeleton>`,
      ),
    })
    class Page {
      pending = new Signal.State(true);
    }

    const { host } = show(Page);

    // What the caller wrote lands on the element standing in for their
    // content, which is the one their layout has a place for.
    expect([...root(host).classList].sort()).toEqual(['card', 'volt-skeleton']);
    expect(root(host).id).toBe('feed');
    expect(root(host).dataset['test']).toBe('feed');
    // ARIA lands there too, and not on the live region: a name or a
    // description on a region is announced instead of its contents in some
    // screen readers, which for this one is the whole message lost.
    expect(root(host).getAttribute('aria-describedby')).toBe('hint');
    expect(region(host).hasAttribute('aria-describedby')).toBe(false);

    // "Being rebuilt — wait before reading me", on the content and nowhere
    // else.
    expect(root(host).getAttribute('aria-busy')).toBe('true');
    expect(root(host).getAttribute('data-state')).toBe('visible');
    expect(host.querySelector('.body')).toBe(null);

    const boxes = placeholder(host)!;
    expect(boxes.getAttribute('data-state')).toBe('visible');
    expect(boxes.getAttribute('aria-hidden')).toBe('true');
    expect(root(host).contains(boxes)).toBe(true);

    // The region is a sibling of the content, not a child: `aria-busy` on an
    // ancestor means "do not announce what changes in here yet", which is the
    // one sentence this component exists to deliver.
    expect(region(host).getAttribute('role')).toBe('status');
    expect(region(host).getAttribute('aria-live')).toBe('polite');
    expect(region(host).getAttribute('aria-atomic')).toBe('true');
    expect(root(host).contains(region(host))).toBe(false);
  });

  it('is out of the reader’s way and out of the keyboard’s', () => {
    @Component({
      selector: 'v-page',
      imports: [VSkeleton],
      render: compileTemplate(`<v-skeleton :count="3" defaultLoading></v-skeleton>`),
    })
    class Page {}

    const { host } = show(Page);
    const boxes = placeholder(host)!;

    // A skeleton has no keyboard of its own, and the point is that it has
    // none: `aria-hidden` alone would leave anything inside reachable by Tab
    // and nameless when it got there, so the primitive writes `inert` too.
    expect(boxes.getAttribute('aria-hidden')).toBe('true');
    expect(boxes.hasAttribute('inert')).toBe(true);
    expect(host.querySelectorAll('[tabindex]')).toHaveLength(0);
    expect(host.querySelectorAll('button, a, input')).toHaveLength(0);
  });

  it('draws the shape and the number the caller asked for, and follows them', () => {
    @Component({
      selector: 'v-page',
      imports: [VSkeleton],
      render: compileTemplate(
        `<v-skeleton defaultLoading :shape="kind.get()" :count="many.get()"></v-skeleton>`,
      ),
    })
    class Page {
      kind = new Signal.State('text');
      many = new Signal.State(3);
    }

    const { instance, host } = show(Page);

    expect(shapes(host)).toHaveLength(3);
    expect(shapes(host).map((box) => box.dataset['shape'])).toEqual(['text', 'text', 'text']);

    // The last line of a paragraph stops short, and only where there is a
    // paragraph to stop short of.
    expect(shapes(host).map((box) => box.hasAttribute('data-trailing'))).toEqual([
      false,
      false,
      true,
    ]);

    // A prop bound to a signal follows it, rather than being read once.
    instance.many.set(1);
    flushSync();
    expect(shapes(host)).toHaveLength(1);
    expect(shapes(host)[0]!.hasAttribute('data-trailing')).toBe(false);

    instance.kind.set('circle');
    instance.many.set(2);
    flushSync();
    expect(shapes(host).map((box) => box.dataset['shape'])).toEqual(['circle', 'circle']);
    // Trailing is a fact about text, so a second circle is not one.
    expect(shapes(host).some((box) => box.hasAttribute('data-trailing'))).toBe(false);

    // A count is arithmetic, and arithmetic produces halves and zeroes.
    instance.many.set(0);
    flushSync();
    expect(shapes(host)).toHaveLength(1);
  });

  it('puts the caller’s size on every box', () => {
    @Component({
      selector: 'v-page',
      imports: [VSkeleton],
      render: compileTemplate(
        `<v-skeleton defaultLoading :count="2" width="12rem" :height="tall.get()"></v-skeleton>`,
      ),
    })
    class Page {
      tall = new Signal.State('2rem');
    }

    const { instance, host } = show(Page);

    for (const box of shapes(host)) {
      expect(box.style.getPropertyValue('inline-size')).toBe('12rem');
      expect(box.style.getPropertyValue('block-size')).toBe('2rem');
    }

    instance.tall.set('4rem');
    flushSync();
    expect(shapes(host)[0]!.style.getPropertyValue('block-size')).toBe('4rem');
  });

  it('swaps the boxes for the content when the load ends, and back', () => {
    @Component({
      selector: 'v-page',
      imports: [VSkeleton],
      render: compileTemplate(
        `<v-skeleton :loading="pending"><p class="body">Arrived</p></v-skeleton>`,
      ),
    })
    class Page {
      pending = new Signal.State(true);
    }

    const { instance, host } = show(Page);

    expect(placeholder(host)).not.toBe(null);
    expect(host.querySelector('.body')).toBe(null);

    instance.pending.set(false);
    flushSync();

    expect(placeholder(host)).toBe(null);
    expect(host.querySelector('.body')!.textContent).toBe('Arrived');
    expect(root(host).hasAttribute('aria-busy')).toBe(false);
    expect(root(host).getAttribute('data-state')).toBe('idle');

    // A second wait, which is the case a component that only ever went one way
    // would pass without doing anything.
    instance.pending.set(true);
    flushSync();
    expect(placeholder(host)).not.toBe(null);
    expect(host.querySelector('.body')).toBe(null);
  });

  it('shows nothing at all while a delay runs', async () => {
    @Component({
      selector: 'v-page',
      imports: [VSkeleton],
      render: compileTemplate(
        `<v-skeleton :loading="pending" :delay="40"><p class="body">Arrived</p></v-skeleton>`,
      ),
    })
    class Page {
      pending = new Signal.State(true);
    }

    const { host } = show(Page);

    // On the page and taking no room, which is the sheet's to draw: the state
    // is here rather than the element being left out, so that a delay that
    // expires does not insert the boxes and move the page.
    expect(placeholder(host)!.getAttribute('data-state')).toBe('delayed');
    expect(root(host).getAttribute('data-state')).toBe('delayed');
    expect(host.querySelector('.body')).toBe(null);

    await settle(70);
    expect(placeholder(host)!.getAttribute('data-state')).toBe('visible');
  });

  it('keeps the boxes up for the minimum it was given', async () => {
    @Component({
      selector: 'v-page',
      imports: [VSkeleton],
      render: compileTemplate(
        `<v-skeleton :loading="pending" :minDuration="60"><p class="body">Arrived</p></v-skeleton>`,
      ),
    })
    class Page {
      pending = new Signal.State(true);
    }

    const { instance, host } = show(Page);
    expect(placeholder(host)).not.toBe(null);

    // The answer landed at once. Showing it now is the flash the minimum
    // exists to prevent, so the content waits with the boxes.
    instance.pending.set(false);
    flushSync();
    expect(placeholder(host)).not.toBe(null);
    expect(host.querySelector('.body')).toBe(null);

    await settle(90);
    expect(placeholder(host)).toBe(null);
    expect(host.querySelector('.body')!.textContent).toBe('Arrived');
  });

  it('says one sentence, once the region has been on the page long enough', async () => {
    @Component({
      selector: 'v-page',
      imports: [VSkeleton],
      render: compileTemplate(`<v-skeleton :loading="pending"></v-skeleton>`),
    })
    class Page {
      pending = new Signal.State(true);
    }

    const { instance, host } = show(Page);

    // The region is there and empty. A screen reader announces what changes
    // inside a region, not what a region arrives holding.
    expect(region(host).isConnected).toBe(true);
    expect(message(host)).toBe('');

    await settle(80);
    expect(message(host)).toBe('Loading…');

    instance.pending.set(false);
    flushSync();
    expect(message(host)).toBe('Loaded');
  });

  it('takes the words, and takes silence for an answer', async () => {
    @Component({
      selector: 'v-page',
      imports: [VSkeleton],
      render: compileTemplate(
        `<v-skeleton :loading="pending" :announceDelay="0" label="Fetching the feed"
                     loadedLabel=""></v-skeleton>`,
      ),
    })
    class Page {
      pending = new Signal.State(true);
    }

    const { instance, host } = show(Page);

    // Zero turns the wait off, so there is nothing to await here.
    expect(message(host)).toBe('Fetching the feed');

    instance.pending.set(false);
    flushSync();
    // An empty label is a caller saying the content announces itself.
    expect(message(host)).toBe('');
    expect(region(host).isConnected).toBe(true);
  });

  it('hands the primitive over, and says when it was used', () => {
    const moved: boolean[] = [];

    @Component({
      selector: 'v-page',
      imports: [VSkeleton],
      render: compileTemplate(
        `<v-skeleton :ref="feed" :onLoadingChange="record"><p class="body">Arrived</p></v-skeleton>`,
      ),
    })
    class Page {
      feed: VSkeleton | null = null;
      record = (loading: boolean): void => void moved.push(loading);
    }

    const { instance, host } = show(Page);

    // Nothing was passed in, so the skeleton owns the state — and `:ref` is
    // how a caller reaches it.
    expect(instance.feed).toBeInstanceOf(VSkeleton);
    expect(instance.feed!.skeleton.isLoading()).toBe(false);
    expect(host.querySelector('.body')).not.toBe(null);

    instance.feed!.skeleton.setLoading(true);
    flushSync();
    expect(moved).toEqual([true]);
    expect(placeholder(host)).not.toBe(null);

    instance.feed!.skeleton.setLoading(false);
    flushSync();
    expect(moved).toEqual([true, false]);

    // Set to what it already is, which is not a change and is not reported.
    instance.feed!.skeleton.setLoading(false);
    flushSync();
    expect(moved).toEqual([true, false]);
  });

  it('starts where `defaultLoading` says', () => {
    @Component({
      selector: 'v-page',
      imports: [VSkeleton],
      render: compileTemplate(
        `<v-skeleton defaultLoading><p class="body">Arrived</p></v-skeleton>`,
      ),
    })
    class Page {}

    const { host } = show(Page);
    expect(placeholder(host)).not.toBe(null);
    expect(host.querySelector('.body')).toBe(null);
  });

  it('lets a caller write the placeholder, and draws nothing of its own then', () => {
    @Component({
      selector: 'v-page',
      imports: [VSkeleton, VSkeletonShape],
      render: compileTemplate(
        `<v-skeleton defaultLoading :count="4">
           <template :slot-placeholder>
             <v-skeleton-shape class="avatar" shape="circle" width="2.5rem"></v-skeleton-shape>
             <v-skeleton-shape :shape="kind.get()"></v-skeleton-shape>
           </template>
           <p class="body">Arrived</p>
         </v-skeleton>`,
      ),
    })
    class Page {
      kind = new Signal.State('text');
    }

    const { instance, host } = show(Page);

    // Four boxes were asked for and none drawn: what was written for the slot
    // replaces the fallback rather than joining it.
    const boxes = shapes(host);
    expect(boxes).toHaveLength(2);
    expect(boxes.map((box) => box.dataset['shape'])).toEqual(['circle', 'text']);
    expect(placeholder(host)!.contains(boxes[0]!)).toBe(true);

    expect([...boxes[0]!.classList].sort()).toEqual(['avatar', 'volt-skeleton-shape']);
    expect(boxes[0]!.style.getPropertyValue('inline-size')).toBe('2.5rem');
    // Written anywhere a shape is wanted, so it hides itself rather than
    // trusting what it is inside to have done it.
    expect(boxes[1]!.getAttribute('aria-hidden')).toBe('true');

    instance.kind.set('block');
    flushSync();
    expect(shapes(host)[1]!.dataset['shape']).toBe('block');
  });

  it('says so when a name written on the tag would land where names mean nothing', () => {
    @Component({
      selector: 'v-page-misnamed',
      imports: [VSkeleton],
      render: compileTemplate(
        `<v-skeleton aria-label="Recent posts" :loading="pending"><p class="body">Arrived</p></v-skeleton>`,
      ),
    })
    class Misnamed {
      pending = new Signal.State(true);
    }

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { host } = show(Misnamed);

    // What the caller wrote stays where they wrote it — this takes nothing
    // away — but the element standing in for their content carries no role,
    // where a name is thrown away by every screen reader, and the one element
    // here that does carry a role is the region a name must never go on.
    expect(root(host).getAttribute('aria-label')).toBe('Recent posts');
    expect(region(host).hasAttribute('aria-label')).toBe(false);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toMatch(/<v-skeleton>[\s\S]*aria-label/);
    warn.mockRestore();
  });

  it('keeps quiet about a name the caller gave the element a role to hold', () => {
    @Component({
      selector: 'v-page-named-region',
      imports: [VSkeleton],
      render: compileTemplate(
        `<v-skeleton role="region" aria-label="Recent posts" defaultLoading></v-skeleton>`,
      ),
    })
    class NamedRegion {}

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { host } = show(NamedRegion);

    // A role written on the tag is the one way a name lands on something: the
    // element is that caller's region, and they said so.
    expect(root(host).getAttribute('role')).toBe('region');
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('takes its three timings from the tag, however they were written', async () => {
    @Component({
      selector: 'v-page',
      imports: [VSkeleton],
      render: compileTemplate(
        `<v-skeleton :loading="pending" delay="40" minDuration="10" announceDelay="0"
        ><p class="body">Arrived</p></v-skeleton>`,
      ),
    })
    class Page {
      pending = new Signal.State(true);
    }

    const { host } = show(Page);

    // `delay="40"` is the string `'40'` by the time the component has it, and
    // an attribute is how most of these are written. Read as numbers rather
    // than passed on: a string goes into `setTimeout` with a typo still in it.
    expect(placeholder(host)!.getAttribute('data-state')).toBe('delayed');
    // Zero turns the region's wait off, and `'0'` has to be that zero — the
    // words are held back with the boxes, so there is nothing to say yet.
    expect(message(host)).toBe('');

    await settle(70);
    expect(placeholder(host)!.getAttribute('data-state')).toBe('visible');
    expect(message(host)).toBe('Loading…');
  });

  it('refuses a timing that is not a number, while the prop is still what is wrong', () => {
    @Component({
      selector: 'v-page-nonsense',
      imports: [VSkeleton],
      render: compileTemplate(`<v-skeleton delay="half a second"></v-skeleton>`),
    })
    class Nonsense {}

    @Component({
      selector: 'v-page-blank',
      imports: [VSkeleton],
      render: compileTemplate(`<v-skeleton minDuration=" "></v-skeleton>`),
    })
    class Blank {}

    @Component({
      selector: 'v-page-late',
      imports: [VSkeleton],
      render: compileTemplate(`<v-skeleton announceDelay="soon"></v-skeleton>`),
    })
    class Late {}

    // Passed on, the first is a `NaN` timeout, which fires at once: the boxes
    // go up with no delay at all and the option reads as honoured. `Number('
    // ')` is zero, so the second is a minimum turned off by the spelling that
    // reads like nothing at all, and the third is the announcement race back.
    expect(() => show(Nonsense)).toThrow(/`delay` on <v-skeleton>/);
    expect(() => show(Blank)).toThrow(/`minDuration` on <v-skeleton>/);
    expect(() => show(Late)).toThrow(/`announceDelay` on <v-skeleton>/);
  });

  it('gives a box of the caller’s own its kind, its size and its short last line', () => {
    @Component({
      selector: 'v-page',
      imports: [VSkeleton, VSkeletonShape],
      render: compileTemplate(
        `<v-skeleton defaultLoading>
           <template :slot-placeholder>
             <v-skeleton-shape shape="block" height="4rem"></v-skeleton-shape>
             <v-skeleton-shape :width="wide.get()" :height="tall.get()"></v-skeleton-shape>
             <v-skeleton-shape data-trailing></v-skeleton-shape>
           </template>
           <p class="body">Arrived</p>
         </v-skeleton>`,
      ),
    })
    class Page {
      wide = new Signal.State('8rem');
      tall = new Signal.State('1rem');
    }

    const { instance, host } = show(Page);
    const boxes = shapes(host);

    // A block is as tall as it was told to be, which is the prop the demo's
    // card is assembled from and the one the sheet's own `block-size` would
    // have stood in for unnoticed.
    expect(boxes[0]!.dataset['shape']).toBe('block');
    expect(boxes[0]!.style.getPropertyValue('block-size')).toBe('4rem');

    expect(boxes[1]!.style.getPropertyValue('inline-size')).toBe('8rem');
    expect(boxes[1]!.style.getPropertyValue('block-size')).toBe('1rem');

    // Both follow a signal rather than being read once.
    instance.wide.set('10rem');
    instance.tall.set('2rem');
    flushSync();
    expect(shapes(host)[1]!.style.getPropertyValue('inline-size')).toBe('10rem');
    expect(shapes(host)[1]!.style.getPropertyValue('block-size')).toBe('2rem');

    // The short last line is the caller's to write here, since a placeholder
    // they assembled is the one this component cannot count the lines of — so
    // the attribute the sheet selects on has to reach the box from the tag.
    expect(boxes[2]!.hasAttribute('data-trailing')).toBe(true);
    expect(boxes[2]!.dataset['shape']).toBe('text');
  });
});
