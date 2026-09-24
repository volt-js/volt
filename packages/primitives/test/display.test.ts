/**
 * Avatar, progress, separator and the visually-hidden style, driven through
 * real mounted components.
 *
 * Nearly everything worth asserting here is what assistive technology is told:
 * which element carries the name, what is announced when the value is unknown,
 * which keys a splitter answers to, and that hiding something visually does not
 * hide it from a screen reader as well.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compileTemplate } from '@voltdev/core/jit';
import { Component, Signal, createRoot, flushSync, mount } from '@voltdev/core';
import {
  createAvatar,
  createProgress,
  createSeparator,
  visuallyHidden,
  type AvatarOptions,
  type AvatarStatus,
  type ProgressOptions,
  type SeparatorOptions,
} from '../src/display.ts';
import { createLocaleProvider } from '../src/i18n.ts';

let host: HTMLElement;
let mounted: { unmount(): void }[] = [];
let disposers: (() => void)[] = [];

function track<T extends { unmount(): void }>(handle: T): T {
  mounted.push(handle);
  return handle;
}

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  host = document.querySelector('#app') as HTMLElement;
});

afterEach(() => {
  for (const handle of mounted) handle.unmount();
  for (const dispose of disposers) dispose();
  mounted = [];
  disposers = [];
  flushSync();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Avatar
// ---------------------------------------------------------------------------

/**
 * The shape a consumer is expected to write: the `<img>` stays mounted so the
 * browser can load it, and the fallback comes and goes.
 */
function mountAvatar(overrides: Partial<AvatarOptions> = {}) {
  @Component({
    selector: 'v-avatar',
    render: compileTemplate(`
      <span :spread="avatar.rootProps()">
        <img :ref="image" :spread="avatar.imageProps()">
        <span :if="avatar.isFallbackVisible()" class="fallback"
              :ref="fallback" :spread="avatar.fallbackProps()">{ avatar.initials() }</span>
      </span>
    `),
  })
  class Person {
    image = new Signal.State<Element | null>(null);
    fallback = new Signal.State<Element | null>(null);
    src = new Signal.State<string | null>('/ada.png');
    name = new Signal.State<string | null>('Ada Lovelace');
    avatar = createAvatar({
      image: () => this.image.get(),
      fallback: () => this.fallback.get(),
      src: () => this.src.get(),
      name: () => this.name.get(),
      ...overrides,
    });
  }

  const handle = track(mount(Person, host));
  const instance = handle.instance as Person;
  const image = () => host.querySelector('img') as HTMLImageElement;

  return {
    instance,
    avatar: instance.avatar,
    image,
    fallback: () => host.querySelector('.fallback'),
    load: () => {
      image().dispatchEvent(new Event('load'));
      flushSync();
    },
    fail: () => {
      image().dispatchEvent(new Event('error'));
      flushSync();
    },
  };
}

describe('avatar loading', () => {
  it('is loading from the moment it is built with a source, before any effect has run', () => {
    // What a server writes: its render stops before the user lane, so the
    // status it carries is the one the avatar was built with. Built bare
    // rather than mounted, since mounting runs the effect before anything
    // here could read.
    createRoot((dispose) => {
      expect(createAvatar({ src: () => '/ada.png' }).status()).toBe('loading');
      expect(createAvatar({ src: () => null }).status()).toBe('idle');
      dispose();
    });
  });

  it('is loading once there is a source, and loaded when the image says so', () => {
    const { avatar, load } = mountAvatar();
    flushSync();
    expect(avatar.status()).toBe('loading');

    load();
    expect(avatar.status()).toBe('loaded');
    expect(avatar.isImageVisible()).toBe(true);
  });

  it('reports an error and keeps the fallback up', () => {
    const { avatar, fallback, fail } = mountAvatar();
    flushSync();

    fail();
    expect(avatar.status()).toBe('error');
    // The point of a fallback: a broken image is not a blank space.
    expect(fallback()).not.toBeNull();
  });

  it('is idle with no source at all, rather than loading forever', () => {
    const { avatar, fallback } = mountAvatar({ src: () => null });
    flushSync();

    expect(avatar.status()).toBe('idle');
    expect(fallback()).not.toBeNull();
    // Nothing to fetch, so nothing should have been asked for.
    expect(host.querySelector('img')!.hasAttribute('src')).toBe(false);
  });

  it('counts an image that was already complete before it looked', () => {
    // Server-rendered markup, or a cache hit: the image finished loading before
    // any of this ran, so its load event fired while nothing was listening and
    // will never fire again.
    document.body.insertAdjacentHTML('beforeend', '<img id="ready" src="/ada.png">');
    const img = document.querySelector('#ready') as HTMLImageElement;
    Object.defineProperty(img, 'naturalWidth', { value: 64, configurable: true });

    const handle = track(mount(CachedAvatar, host));
    flushSync();
    expect((handle.instance as CachedAvatar).avatar.status()).toBe('loaded');
  });

  it('starts again when the source changes', () => {
    const { instance, avatar, load } = mountAvatar();
    flushSync();
    load();
    expect(avatar.status()).toBe('loaded');

    instance.src.set('/grace.png');
    flushSync();
    // A stale 'loaded' would leave the previous face on screen for the new one.
    expect(avatar.status()).toBe('loading');
    expect(host.querySelector('img')!.getAttribute('src')).toBe('/grace.png');
  });

  it('goes back to idle when the source is taken away', () => {
    const { instance, avatar, load } = mountAvatar();
    flushSync();
    load();

    instance.src.set(null);
    flushSync();
    expect(avatar.status()).toBe('idle');
  });

  it('can be controlled from outside, and reports its own changes', () => {
    const status = new Signal.State<AvatarStatus>('loaded');
    const onStatusChange = vi.fn();
    const { avatar, fail } = mountAvatar({ status, onStatusChange });

    flushSync();
    // The effect owns the truth about this element, so it corrects the caller.
    expect(status.get()).toBe('loading');
    expect(onStatusChange).toHaveBeenCalledWith('loading');

    fail();
    expect(status.get()).toBe('error');
    expect(avatar.status()).toBe('error');
  });
});

@Component({
  selector: 'v-cached',
  render: compileTemplate(`<span :spread="avatar.rootProps()"></span>`),
})
class CachedAvatar {
  avatar = createAvatar({
    image: () => document.querySelector('#ready'),
    src: () => '/ada.png',
  });
}

describe('what the avatar tells a screen reader', () => {
  it('names the fallback with the name, not the initials', () => {
    const { fallback } = mountAvatar();
    flushSync();

    const el = fallback()!;
    // "AL" is either spelled out or read as a word; neither is a person.
    expect(el.textContent).toBe('AL');
    expect(el.getAttribute('role')).toBe('img');
    expect(el.getAttribute('aria-label')).toBe('Ada Lovelace');
  });

  it('hides a fallback that has no name to give', () => {
    const { fallback } = mountAvatar({ name: () => null });
    flushSync();

    const el = fallback()!;
    // An empty placeholder announced as "image" is pure noise.
    expect(el.getAttribute('aria-hidden')).toBe('true');
    expect(el.hasAttribute('role')).toBe(false);
  });

  it('makes the image decorative while the fallback is saying the name', () => {
    const { image, fallback, load } = mountAvatar();
    flushSync();

    expect(fallback()).not.toBeNull();
    // Both are on screen, so exactly one of them should be announced.
    expect(image().getAttribute('alt')).toBe('');

    load();
    expect(fallback()).toBeNull();
    // Nothing else is left to say who this is.
    expect(image().getAttribute('alt')).toBe('Ada Lovelace');
  });

  it('names the image when no fallback is rendered at all', () => {
    @Component({
      selector: 'v-lone',
      render: compileTemplate(`<img :ref="image" :spread="avatar.imageProps()">`),
    })
    class Lone {
      image = new Signal.State<Element | null>(null);
      avatar = createAvatar({
        image: () => this.image.get(),
        src: () => '/ada.png',
        name: () => 'Ada Lovelace',
      });
    }

    track(mount(Lone, host));
    flushSync();
    expect(host.querySelector('img')!.getAttribute('alt')).toBe('Ada Lovelace');
  });

  it('always writes an alt attribute, even an empty one', () => {
    const { image } = mountAvatar({ name: () => null });
    flushSync();
    // With no alt at all, a screen reader reads the URL out instead.
    expect(image().hasAttribute('alt')).toBe(true);
    expect(image().getAttribute('alt')).toBe('');
  });

  it('publishes the status for CSS to hang off', () => {
    const { image, load } = mountAvatar();
    flushSync();
    expect(host.querySelector('span')!.getAttribute('data-status')).toBe('loading');

    load();
    expect(image().getAttribute('data-status')).toBe('loaded');
  });
});

describe('avatar fallback delay', () => {
  it('holds the fallback back so a cached image does not flash initials', () => {
    vi.useFakeTimers();
    const { fallback, load } = mountAvatar({ fallbackDelay: 300 });
    flushSync();

    expect(fallback()).toBeNull();

    load();
    flushSync();
    // The image won the race, so the initials were never shown at all.
    expect(fallback()).toBeNull();
  });

  it('shows the fallback once the delay is up', () => {
    vi.useFakeTimers();
    const { fallback } = mountAvatar({ fallbackDelay: 300 });
    flushSync();
    expect(fallback()).toBeNull();

    vi.advanceTimersByTime(300);
    flushSync();
    expect(fallback()).not.toBeNull();
  });

  it('does not wait once the load has already failed', () => {
    vi.useFakeTimers();
    const { fallback, fail } = mountAvatar({ fallbackDelay: 300 });
    flushSync();

    fail();
    // The delay covers a cache hit; there is nothing left to hope for here.
    expect(fallback()).not.toBeNull();
  });

  it('does not wait when there was never anything to load', () => {
    vi.useFakeTimers();
    const { fallback } = mountAvatar({ fallbackDelay: 300, src: () => null });
    flushSync();
    expect(fallback()).not.toBeNull();
  });
});

describe('initials', () => {
  function initialsFor(options: Partial<AvatarOptions>): string {
    let result = '';
    createRoot((dispose) => {
      disposers.push(dispose);
      result = createAvatar(options).initials();
    });
    return result;
  }

  it('takes the first and last word', () => {
    expect(initialsFor({ name: () => 'Ada Lovelace' })).toBe('AL');
    // The middle name is the part people drop.
    expect(initialsFor({ name: () => 'Ada King Lovelace' })).toBe('AL');
  });

  it('copes with one word, no word, and stray whitespace', () => {
    expect(initialsFor({ name: () => 'Ada' })).toBe('A');
    expect(initialsFor({ name: () => '   ' })).toBe('');
    expect(initialsFor({ name: () => null })).toBe('');
    expect(initialsFor({ name: () => '  Ada   Lovelace  ' })).toBe('AL');
  });

  it('keeps the case it was given', () => {
    // Upper-casing is a text-transform, and doing it here would need a locale:
    // a Turkish "i" upper-cases to "İ".
    expect(initialsFor({ name: () => 'ada lovelace' })).toBe('al');
  });

  it('does not cut a character in half', () => {
    // "🌟"[0] is half a surrogate pair, and renders as a replacement box.
    expect(initialsFor({ name: () => '🌟 Star' })).toBe('🌟S');
  });

  it('obeys maxInitials and a custom derivation', () => {
    expect(initialsFor({ name: () => 'Ada Lovelace', maxInitials: 1 })).toBe('A');
    expect(
      initialsFor({ name: () => '克强 李', initials: (name) => name.split(' ')[1] ?? '' }),
    ).toBe('李');
  });
});

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

function mountProgress(options: ProgressOptions = {}) {
  @Component({
    selector: 'v-progress',
    render: compileTemplate(
      `<div :spread="progress.rootProps()">` +
        `<div class="indicator" :spread="progress.indicatorProps()"></div>` +
        `</div>`,
    ),
  })
  class Bar {
    progress = createProgress(options);
  }

  const handle = track(mount(Bar, host));
  flushSync();
  return {
    progress: (handle.instance as Bar).progress,
    root: () => host.querySelector('[role="progressbar"]') as HTMLElement,
    indicator: () => host.querySelector('.indicator') as HTMLElement,
  };
}

describe('progress', () => {
  it('reports the role and the whole range', () => {
    const { root } = mountProgress({ defaultValue: 30 });
    expect(root().getAttribute('role')).toBe('progressbar');
    expect(root().getAttribute('aria-valuenow')).toBe('30');
    expect(root().getAttribute('aria-valuemin')).toBe('0');
    expect(root().getAttribute('aria-valuemax')).toBe('100');
  });

  it('omits aria-valuenow entirely when indeterminate', () => {
    const { root, progress, indicator } = mountProgress();
    expect(progress.isIndeterminate()).toBe(true);
    // Not "0", which a screen reader repeats as fact on a bar that may be
    // nearly finished. There is no ARIA value for "unknown".
    expect(root().hasAttribute('aria-valuenow')).toBe(false);
    expect(root().getAttribute('data-state')).toBe('indeterminate');
    expect(progress.percent()).toBeNull();
    // Nothing for CSS to size an indicator from either, for the same reason.
    expect(indicator().hasAttribute('data-value')).toBe(false);
  });

  it('says something while the value is unknown, and can be told not to', () => {
    const { root } = mountProgress();
    expect(root().getAttribute('aria-valuetext')).toBe('Loading…');

    const quiet = mountProgress({ labels: { indeterminate: '' } });
    expect(quiet.root().hasAttribute('aria-valuetext')).toBe(false);

    const own = mountProgress({ labels: { indeterminate: 'Chargement…' } });
    expect(own.root().getAttribute('aria-valuetext')).toBe('Chargement…');
  });

  it('says the wait in the language the locale provider speaks', () => {
    @Component({
      selector: 'v-bar-de',
      render: compileTemplate(`<div class="bar" :spread="progress.rootProps()"></div>`),
    })
    class GermanBar {
      locale = createLocaleProvider({ defaultLocale: 'de-DE', messages: { loading: 'Lädt…' } });
      progress = createProgress();
    }

    const handle = track(mount(GermanBar, host));
    flushSync();
    const bar = host.querySelector('.bar')!;
    // The catalogue already has a word for this; a provider that translates
    // it should not have to translate it again for every progress bar.
    expect(bar.getAttribute('aria-valuetext')).toBe('Lädt…');

    (handle.instance as GermanBar).locale.setMessages({ loading: 'Wird geladen…' });
    flushSync();
    expect(bar.getAttribute('aria-valuetext')).toBe('Wird geladen…');
  });

  it('drops back to indeterminate rather than announcing NaN', () => {
    const value = new Signal.State<number | null>(Number.NaN);
    const { root, progress } = mountProgress({ value });
    expect(progress.isIndeterminate()).toBe(true);
    expect(root().hasAttribute('aria-valuenow')).toBe(false);
  });

  it('clamps a value that falls outside the range', () => {
    const value = new Signal.State<number | null>(140);
    const { root, progress } = mountProgress({ value });
    expect(progress.value()).toBe(100);
    expect(root().getAttribute('aria-valuenow')).toBe('100');

    value.set(-20);
    flushSync();
    expect(root().getAttribute('aria-valuenow')).toBe('0');
  });

  it('works in a range that is not 0 to 100', () => {
    const { root, progress } = mountProgress({
      min: 1,
      max: 8,
      defaultValue: 3,
      valueText: (v, percent) => `step ${v} of 8, ${Math.round(percent)} percent`,
    });

    expect(root().getAttribute('aria-valuemin')).toBe('1');
    expect(root().getAttribute('aria-valuemax')).toBe('8');
    expect(root().getAttribute('aria-valuenow')).toBe('3');
    // Without this a screen reader announces its own percentage, which is not
    // what "step 3 of 8" sounds like.
    expect(root().getAttribute('aria-valuetext')).toBe('step 3 of 8, 29 percent');
    expect(progress.percent()).toBeCloseTo((2 / 7) * 100);
  });

  it('moves through loading to complete', () => {
    const value = new Signal.State<number | null>(0);
    const { root, progress, indicator } = mountProgress({ value });
    expect(progress.state()).toBe('loading');

    progress.setValue(100);
    flushSync();
    expect(progress.state()).toBe('complete');
    expect(root().getAttribute('data-state')).toBe('complete');
    expect(indicator().getAttribute('data-state')).toBe('complete');
    expect(indicator().getAttribute('data-value')).toBe('100');
  });

  it('reports changes through onValueChange', () => {
    const onValueChange = vi.fn();
    const { progress } = mountProgress({ defaultValue: 10, onValueChange });

    progress.setValue(20);
    expect(onValueChange).toHaveBeenCalledWith(20);

    progress.setValue(20);
    // Setting the same value again is not a change.
    expect(onValueChange).toHaveBeenCalledTimes(1);

    progress.setValue(null);
    expect(onValueChange).toHaveBeenLastCalledWith(null);
  });

  it('carries one name, not two', () => {
    const { root } = mountProgress({ label: 'Upload', defaultValue: 10 });
    expect(root().getAttribute('aria-label')).toBe('Upload');

    const referenced = mountProgress({
      label: 'Upload',
      labelledBy: 'caption',
      defaultValue: 10,
    });
    // A visible label wins, and the duplicate is dropped rather than left to
    // drift out of date behind it.
    expect(referenced.root().getAttribute('aria-labelledby')).toBe('caption');
    expect(referenced.root().hasAttribute('aria-label')).toBe(false);
  });

  it('is not focusable', () => {
    const { root } = mountProgress({ defaultValue: 10 });
    // A progressbar takes no input. Something the user can change is a slider.
    expect(root().hasAttribute('tabindex')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Visually hidden
// ---------------------------------------------------------------------------

describe('visuallyHidden', () => {
  it('never uses the two rules that would hide it from a screen reader too', () => {
    const style = visuallyHidden();
    // Both take the element out of the accessibility tree along with the page,
    // which is the opposite of what this is for.
    expect(Object.keys(style)).not.toContain('display');
    expect(Object.keys(style)).not.toContain('visibility');
  });

  it('keeps a one-pixel box rather than a zero-sized one', () => {
    const style = visuallyHidden();
    // Some engines drop a zero-sized box from the accessibility tree.
    expect(style.width).toBe('1px');
    expect(style.height).toBe('1px');
    expect(style.position).toBe('absolute');
    expect(style['clip-path']).toBe('inset(50%)');
    expect(style['white-space']).toBe('nowrap');
  });

  it('applies through a template, and stays out of the layout', () => {
    @Component({
      selector: 'v-hidden',
      render: compileTemplate(
        `<div><span class="sr" :style="hidden()">Sort ascending</span></div>`,
      ),
    })
    class Hidden {
      hidden = visuallyHidden;
    }

    track(mount(Hidden, host));
    flushSync();

    const el = host.querySelector('.sr') as HTMLElement;
    expect(el.style.position).toBe('absolute');
    expect(el.style.overflow).toBe('hidden');
    expect(el.style.getPropertyValue('clip-path')).toBe('inset(50%)');
    expect(el.style.getPropertyValue('clip')).toBe('rect(0, 0, 0, 0)');
    expect(el.style.display).toBe('');
    expect(el.style.visibility).toBe('');
    // The text is still there to be read, which is the entire point.
    expect(el.textContent).toBe('Sort ascending');
  });

  it('hands out a frozen object, since it is shared', () => {
    const style = visuallyHidden();
    expect(Object.isFrozen(style)).toBe(true);
    expect(visuallyHidden()).toBe(style);
  });
});

// ---------------------------------------------------------------------------
// Separator
// ---------------------------------------------------------------------------

function mountSeparator(options: SeparatorOptions = {}, dir?: string) {
  @Component({
    selector: 'v-separator',
    render: compileTemplate(
      `<div :attr-dir="dir">` +
        `<div class="sep" :spread="separator.separatorProps()"` +
        ` :keydown="separator.onKeyDown($event)"></div>` +
        `</div>`,
    ),
  })
  class Divider {
    dir = dir;
    separator = createSeparator(options);
  }

  const handle = track(mount(Divider, host));
  flushSync();
  const el = () => host.querySelector('.sep') as HTMLElement;

  return {
    separator: (handle.instance as Divider).separator,
    el,
    key(key: string, init: KeyboardEventInit = {}) {
      el().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }));
      flushSync();
    },
  };
}

describe('separator semantics', () => {
  it('is decorative by default', () => {
    const { el } = mountSeparator();
    // The commoner case by far: a rule between two menu groups says nothing
    // that the grouping does not already say.
    expect(el().getAttribute('role')).toBe('presentation');
    expect(el().hasAttribute('aria-orientation')).toBe(false);
    expect(el().getAttribute('data-orientation')).toBe('horizontal');
  });

  it('becomes a real separator when it means something', () => {
    const { el } = mountSeparator({ decorative: false });
    expect(el().getAttribute('role')).toBe('separator');
    expect(el().getAttribute('aria-orientation')).toBe('horizontal');
  });

  it('describes the line itself, not the way it moves', () => {
    const { el, separator } = mountSeparator({ decorative: false, orientation: 'vertical' });
    // A vertical rule stands between two side-by-side panes.
    expect(separator.orientation()).toBe('vertical');
    expect(el().getAttribute('aria-orientation')).toBe('vertical');
    expect(el().getAttribute('data-orientation')).toBe('vertical');
  });

  it('takes a name only when given one', () => {
    expect(mountSeparator({ decorative: false }).el().hasAttribute('aria-label')).toBe(false);

    const named = mountSeparator({ decorative: false, label: 'Section end' });
    expect(named.el().getAttribute('aria-label')).toBe('Section end');

    const referenced = mountSeparator({
      decorative: false,
      label: 'Section end',
      labelledBy: 'heading',
    });
    expect(referenced.el().getAttribute('aria-labelledby')).toBe('heading');
    expect(referenced.el().hasAttribute('aria-label')).toBe(false);
  });

  it('stays out of the tab order and answers no keys', () => {
    const { el, key, separator } = mountSeparator({ decorative: false });
    expect(el().hasAttribute('tabindex')).toBe(false);
    expect(separator.value()).toBeNull();

    const event = new KeyboardEvent('keydown', { key: 'ArrowRight' });
    // A divider is not a widget: it has no value for a key to change.
    expect(separator.onKeyDown(event)).toBe(false);
    key('ArrowRight');
  });
});

describe('window splitter', () => {
  const splitter = (resize: SeparatorOptions['resize'] = {}, dir?: string) =>
    mountSeparator(
      { orientation: 'vertical', label: 'Resize sidebar', resize: { defaultValue: 50, ...resize } },
      dir,
    );

  it('is a focusable separator that reports its position', () => {
    const { el } = splitter({ controls: 'sidebar' });
    expect(el().getAttribute('role')).toBe('separator');
    // Operable by keyboard means reachable by keyboard first.
    expect(el().getAttribute('tabindex')).toBe('0');
    expect(el().getAttribute('aria-valuenow')).toBe('50');
    expect(el().getAttribute('aria-valuemin')).toBe('0');
    expect(el().getAttribute('aria-valuemax')).toBe('100');
    expect(el().getAttribute('aria-controls')).toBe('sidebar');
    expect(el().getAttribute('aria-label')).toBe('Resize sidebar');
  });

  it('is never decorative, whatever it was asked to be', () => {
    const { el } = mountSeparator({ decorative: true, resize: {} });
    // A focusable presentational element is a contradiction; the role would be
    // ignored by the browser anyway.
    expect(el().getAttribute('role')).toBe('separator');
  });

  it('moves on the axis it crosses, and ignores the other one', () => {
    const { el, key, separator } = splitter({ step: 10 });

    key('ArrowRight');
    expect(separator.value()).toBe(60);
    expect(el().getAttribute('aria-valuenow')).toBe('60');

    key('ArrowLeft');
    expect(separator.value()).toBe(50);

    // Up and Down belong to a horizontal splitter, not this one.
    key('ArrowUp');
    key('ArrowDown');
    expect(separator.value()).toBe(50);
  });

  it('uses the vertical arrows when the line is horizontal', () => {
    const { separator, key } = mountSeparator({
      orientation: 'horizontal',
      label: 'Resize console',
      resize: { defaultValue: 50, step: 10 },
    });

    key('ArrowDown');
    expect(separator.value()).toBe(60);
    key('ArrowUp');
    expect(separator.value()).toBe(50);

    key('ArrowRight');
    expect(separator.value()).toBe(50);
  });

  it('swaps the arrows in a right-to-left layout', () => {
    const { separator, key } = splitter({ step: 10 }, 'rtl');
    // The primary pane is on the right, so Left is the way to make it bigger.
    key('ArrowLeft');
    expect(separator.value()).toBe(60);
    key('ArrowRight');
    expect(separator.value()).toBe(50);
  });

  it('goes to the ends with Home and End', () => {
    const { separator, key } = splitter({ min: 10, max: 90 });
    key('Home');
    expect(separator.value()).toBe(10);
    key('End');
    expect(separator.value()).toBe(90);
  });

  it('stops at the ends instead of running past them', () => {
    const { separator, key } = splitter({ min: 20, max: 80, step: 50 });
    key('ArrowLeft');
    expect(separator.value()).toBe(20);
    key('ArrowLeft');
    expect(separator.value()).toBe(20);

    key('ArrowRight');
    key('ArrowRight');
    expect(separator.value()).toBe(80);
  });

  it('collapses and restores on Enter when it can collapse', () => {
    const { separator, key } = splitter({ collapsible: true, defaultValue: 40 });

    key('Enter');
    expect(separator.value()).toBe(0);

    key('Enter');
    // Back where it was, not to some default: the user chose 40.
    expect(separator.value()).toBe(40);
  });

  it('leaves Enter alone when there is nothing to collapse to', () => {
    const { separator } = splitter({ defaultValue: 40 });
    const event = new KeyboardEvent('keydown', { key: 'Enter' });
    // Unconsumed, so a form or a button underneath still sees it.
    expect(separator.onKeyDown(event)).toBe(false);
    expect(separator.value()).toBe(40);
  });

  it('leaves modified keys to the application', () => {
    const { separator, key } = splitter({ step: 10 });
    key('ArrowRight', { ctrlKey: true });
    // Ctrl+Right is a shortcut, not a resize.
    expect(separator.value()).toBe(50);
  });

  it('reports moves, and can be driven from outside', () => {
    const value = new Signal.State(30);
    const onValueChange = vi.fn();
    const { el, key } = splitter({ value, step: 5, onValueChange });

    expect(el().getAttribute('aria-valuenow')).toBe('30');

    key('ArrowRight');
    expect(value.get()).toBe(35);
    expect(onValueChange).toHaveBeenCalledWith(35);

    value.set(70);
    flushSync();
    expect(el().getAttribute('aria-valuenow')).toBe('70');
  });

  it('spells the position out when told how', () => {
    const { el } = splitter({ defaultValue: 30, valueText: (v) => `${v} percent` });
    // "separator, 30" says nothing about what 30 means.
    expect(el().getAttribute('aria-valuetext')).toBe('30 percent');
  });

  it('never reports a value outside its range, however it was set', () => {
    const value = new Signal.State(Number.NaN);
    const { el, separator } = splitter({ value, min: 10, max: 90 });
    // aria-valuenow="NaN" is announced exactly as written.
    expect(el().getAttribute('aria-valuenow')).toBe('10');

    separator.setValue(999);
    flushSync();
    expect(separator.value()).toBe(90);
  });
});
