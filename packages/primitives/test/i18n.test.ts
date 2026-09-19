/**
 * Locale, driven through real mounted components.
 *
 * The interesting claims are the ones a happy-path test never reaches: that a
 * child component which never saw the provider still finds it, that direction
 * resolved from the DOM does not freeze once the provider has written `dir` on
 * its own element, that a count string picks the right one of Polish's four
 * forms, that "yesterday" is a calendar fact rather than 24 hours, and that
 * two identical formatter requests really are one object.
 *
 * The arrow keys are in here too. Direction is only worth resolving if the
 * keyboard follows it, so the toolbar test changes nothing but the locale and
 * expects Right to start moving backwards.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compileTemplate } from '@voltdev/core/jit';
import { Component, Signal, flushSync, mount } from '@voltdev/core';
import {
  DEFAULT_MESSAGES,
  createLocale,
  createLocaleProvider,
  getCollator,
  getDateTimeFormat,
  getNumberFormat,
  relativeTimeParts,
  resetLocaleCaches,
  resolveDirection,
  useLocale,
  type LocaleOptions,
  type MessageCatalog,
} from '../src/i18n.ts';
import { createCollection } from '../src/collection.ts';
import { createRovingFocus } from '../src/roving-focus.ts';

let host: HTMLElement;
let mounted: { unmount(): void }[] = [];

function track<T extends { unmount(): void }>(handle: T): T {
  mounted.push(handle);
  return handle;
}

beforeEach(() => {
  // The document outlives a test, and both of these are inputs to the code
  // under test — a stale `lang` from the previous test is a locale nobody set.
  document.documentElement.removeAttribute('lang');
  document.documentElement.removeAttribute('dir');
  document.body.innerHTML = '<div id="app"></div>';
  host = document.querySelector('#app')!;
  resetLocaleCaches();
});

afterEach(() => {
  for (const handle of mounted) handle.unmount();
  mounted = [];
  flushSync();
});

/** A `MutationObserver` delivers late, so DOM-driven direction settles late. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  flushSync();
}

/**
 * ICU separates a number from its unit or currency sign with a non-breaking
 * space, which no assertion should have to spell.
 */
const plain = (value: string): string => value.replace(/[  ]/g, ' ');

function press(el: Element, key: string): void {
  el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  flushSync();
}

let sequence = 0;

/**
 * A provider on a single root element, with whatever the test wants inside it.
 *
 * The selector is unique per definition because the component registry is
 * keyed by it, and a test that reused one would resolve to another test's
 * component.
 */
function defineApp(body: string, options: LocaleOptions) {
  sequence += 1;

  @Component({
    selector: `v-i18n-app-${sequence}`,
    render: compileTemplate(
      `<div :ref="root" :spread="locale.providerProps()">${body}</div>`,
    ),
  })
  class App {
    root = new Signal.State<Element | null>(null);
    locale = createLocaleProvider({ element: () => this.root.get(), ...options });
  }

  return App;
}

function mountApp(body = '', options: LocaleOptions = {}) {
  const handle = track(mount(defineApp(body, options), host));
  flushSync();

  return {
    handle,
    locale: (handle.instance as InstanceType<ReturnType<typeof defineApp>>).locale,
    root: (): HTMLElement => host.firstElementChild as HTMLElement,
    text: (selector: string): string => host.querySelector(selector)?.textContent ?? '',
  };
}

describe('flowing through the reactive scope', () => {
  it('reaches a child component that never saw the provider', () => {
    @Component({
      selector: 'v-i18n-child',
      render: compileTemplate(
        `<div><span class="close">{ locale.t('close') }</span>` +
          `<span class="code">{ locale.code() }</span></div>`,
      ),
    })
    class Child {
      locale = useLocale();
    }

    @Component({
      selector: 'v-i18n-parent',
      imports: [Child],
      render: compileTemplate(`<div><v-i18n-child></v-i18n-child></div>`),
    })
    class Parent {
      locale = createLocaleProvider({
        defaultLocale: 'de-DE',
        messages: { close: 'Schließen' },
      });
    }

    track(mount(Parent, host));
    flushSync();

    expect(host.querySelector('.close')!.textContent).toBe('Schließen');
    expect(host.querySelector('.code')!.textContent).toBe('de-DE');
  });

  it('gives the nearest provider to each child, not the outermost', () => {
    @Component({
      selector: 'v-i18n-reader',
      render: compileTemplate(`<span class="reader">{ locale.code() }</span>`),
    })
    class Reader {
      locale = useLocale();
    }

    @Component({
      selector: 'v-i18n-inner',
      imports: [Reader],
      render: compileTemplate(`<div class="inner"><v-i18n-reader></v-i18n-reader></div>`),
    })
    class Inner {
      locale = createLocaleProvider({ defaultLocale: 'fr-FR' });
    }

    // Every component instance has a scope of its own, and a provider lands in
    // the scope of the component that creates it — so the inner one reaches its
    // own children and nothing beside or above it. The `:if` puts a structural
    // scope between the two providers as well, which is the other way a page
    // ends up nesting them.
    @Component({
      selector: 'v-i18n-outer',
      imports: [Inner, Reader],
      render: compileTemplate(
        `<div><v-i18n-inner :if="show.get()"></v-i18n-inner>` +
          `<div class="outer"><v-i18n-reader></v-i18n-reader></div></div>`,
      ),
    })
    class Outer {
      show = new Signal.State(true);
      locale = createLocaleProvider({ defaultLocale: 'de-DE' });
    }

    track(mount(Outer, host));
    flushSync();

    expect(host.querySelector('.inner .reader')!.textContent).toBe('fr-FR');
    // The inner provider must not have leaked upwards or sideways.
    expect(host.querySelector('.outer .reader')!.textContent).toBe('de-DE');
  });

  it('follows the scope through a portal rather than the DOM', () => {
    @Component({
      selector: 'v-i18n-portal-child',
      render: compileTemplate(`<span class="portalled">{ locale.code() }</span>`),
    })
    class PortalChild {
      locale = useLocale();
    }

    @Component({
      selector: 'v-i18n-portal-host',
      imports: [PortalChild],
      render: compileTemplate(
        `<div><div :portal><v-i18n-portal-child></v-i18n-portal-child></div></div>`,
      ),
    })
    class PortalHost {
      locale = createLocaleProvider({ defaultLocale: 'ja-JP' });
    }

    track(mount(PortalHost, host));
    flushSync();

    const portalled = document.querySelector('.portalled')!;
    // Rendered outside the provider's element entirely, and still inside its
    // scope — which is what makes an overlay's strings translatable.
    expect(host.contains(portalled)).toBe(false);
    expect(portalled.textContent).toBe('ja-JP');
  });

  it('falls back to the document language when nothing provides one', () => {
    document.documentElement.setAttribute('lang', 'de-DE');
    resetLocaleCaches();

    expect(useLocale().code()).toBe('de-DE');
  });

  it('ignores a malformed lang attribute instead of throwing on every format', () => {
    // A POSIX locale name copied into the markup. Every Intl constructor
    // throws RangeError on it, so taking it at face value would turn one
    // underscore into a page that does not render at all.
    document.documentElement.setAttribute('lang', 'en_US');
    resetLocaleCaches();

    const locale = useLocale();
    expect(locale.code()).toBe(navigator.language);
    expect(() => locale.format.number(1000)).not.toThrow();
  });

  it('hands back one ambient locale rather than building one per call', () => {
    expect(useLocale()).toBe(useLocale());
  });

  it('refuses to provide outside a reactive scope', () => {
    expect(() => createLocaleProvider()).toThrow(/reactive scope/);
  });
});

describe('what the catalogue says', () => {
  it('ships a default for every string the library emits', () => {
    expect(Object.keys(DEFAULT_MESSAGES).sort()).toEqual(
      [
        'clear',
        'close',
        'loading',
        'next',
        'noResults',
        'pageOf',
        'previous',
        'remove',
        'required',
        'selected',
        'sortedAscending',
        'sortedDescending',
      ].sort(),
    );
  });

  it('overrides only the keys a translation declares', () => {
    const app = mountApp(
      `<span class="close">{ locale.t('close') }</span>` +
        `<span class="next">{ locale.t('next') }</span>`,
      { defaultLocale: 'de-DE', messages: { close: 'Schließen' } },
    );

    expect(app.text('.close')).toBe('Schließen');
    // A partial translation must not blank the keys it has not reached yet.
    expect(app.text('.next')).toBe('Next');
  });

  it('returns the key itself when nothing defines it', () => {
    const locale = createLocale({ defaultLocale: 'en-GB' });
    // Not a string anyone wants on screen, which is the point: an empty gap
    // would be a mystery, and this names the key that is missing.
    expect(locale.t('somethingNobodyDefined')).toBe('somethingNobodyDefined');
    expect(locale.has('somethingNobodyDefined')).toBe(false);
    expect(locale.has('close')).toBe(true);
  });

  it('does not mistake what every object inherits for a message', () => {
    const locale = createLocale({ defaultLocale: 'en-GB' });

    // Both the catalogue and the defaults are plain objects, and a key is any
    // string: one that happens to name something on `Object.prototype` is
    // still a key nobody defined.
    for (const key of ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__']) {
      expect(locale.has(key)).toBe(false);
      expect(locale.t(key)).toBe(key);
      expect(locale.t(key, { n: 1 })).toBe(key);
    }

    // And a catalogue that does define one gets it.
    const own = createLocale({ defaultLocale: 'en-GB', messages: { constructor: 'Builder' } });
    expect(own.has('constructor')).toBe(true);
    expect(own.t('constructor')).toBe('Builder');
  });

  it('interpolates, tolerating spaces inside the braces', () => {
    const locale = createLocale({
      defaultLocale: 'en-GB',
      messages: { spaced: 'a { x } b {y}' },
    });

    expect(locale.t('pageOf', { n: 3, m: 12 })).toBe('Page 3 of 12');
    expect(locale.t('spaced', { x: 'one', y: 'two' })).toBe('a one b two');
  });

  it('leaves an unfilled placeholder standing', () => {
    const locale = createLocale({ defaultLocale: 'en-GB' });
    // A visible {m} is a bug report; "Page 3 of undefined" is a support call.
    expect(locale.t('pageOf', { n: 3 })).toBe('Page 3 of {m}');
  });

  it('localises numbers substituted into a string', () => {
    const de = createLocale({ defaultLocale: 'de-DE' });
    const en = createLocale({ defaultLocale: 'en-GB' });

    // The English default string with German numbers in it: the catalogue and
    // the formatting are separate decisions, and both follow the locale.
    expect(de.t('pageOf', { n: 1234, m: 5678 })).toBe('Page 1.234 of 5.678');
    expect(en.t('pageOf', { n: 1234, m: 5678 })).toBe('Page 1,234 of 5,678');
  });

  it('leaves a string value exactly as given, for ids that are not quantities', () => {
    const en = createLocale({
      defaultLocale: 'en-GB',
      messages: { invoice: 'Invoice {id}' },
    });
    expect(en.t('invoice', { id: '10000' })).toBe('Invoice 10000');
  });

  it('re-renders every string when the locale changes', () => {
    const app = mountApp(`<span class="label">{ locale.t('close') }</span>`, {
      defaultLocale: 'en-GB',
    });
    expect(app.text('.label')).toBe('Close');

    app.locale.setMessages({ close: 'Fermer' });
    app.locale.setLocale('fr-FR');
    flushSync();

    expect(app.text('.label')).toBe('Fermer');
    expect(app.root().getAttribute('lang')).toBe('fr-FR');
  });

  it('reports a locale change once, and not for a change to the same tag', () => {
    const onLocaleChange = vi.fn();
    const locale = createLocale({ defaultLocale: 'en-GB', onLocaleChange });

    locale.setLocale('de-DE');
    locale.setLocale('de-DE');

    expect(onLocaleChange).toHaveBeenCalledTimes(1);
    expect(onLocaleChange).toHaveBeenCalledWith('de-DE');
  });

  it('accepts a catalogue signal so a lazily loaded bundle can arrive later', () => {
    const messages = new Signal.State<MessageCatalog>({ close: 'Cerrar' });
    const app = mountApp(`<span class="label">{ locale.t('close') }</span>`, {
      defaultLocale: 'es-ES',
      messages,
    });

    expect(app.text('.label')).toBe('Cerrar');

    messages.set({ close: 'Cerrado' });
    flushSync();
    expect(app.text('.label')).toBe('Cerrado');
  });
});

describe('counting', () => {
  /** Polish has four categories, which is the case a two-form API cannot state. */
  const polish = {
    selected: {
      one: '{n} zaznaczony',
      few: '{n} zaznaczone',
      many: '{n} zaznaczonych',
      other: '{n} zaznaczonego',
    },
  };

  it('picks the right one of four Polish forms', () => {
    const pl = createLocale({ defaultLocale: 'pl-PL', messages: polish });

    expect(pl.t('selected', { n: 1 })).toBe('1 zaznaczony');
    expect(pl.t('selected', { n: 2 })).toBe('2 zaznaczone');
    expect(pl.t('selected', { n: 5 })).toBe('5 zaznaczonych');
  });

  it('falls back to other for a category the catalogue omits', () => {
    const pl = createLocale({
      defaultLocale: 'pl-PL',
      messages: { selected: { other: '{n} wybranych' } },
    });
    // A translator who filled in only one form gets a clumsy sentence, not a
    // missing one.
    expect(pl.t('selected', { n: 2 })).toBe('2 wybranych');
  });

  it('falls back to other when no count is given at all', () => {
    const en = createLocale({ defaultLocale: 'en-GB' });
    expect(en.t('selected')).toBe('{n} selected');
  });

  it('selects on the count but formats it for the locale', () => {
    const de = createLocale({ defaultLocale: 'de-DE' });
    expect(de.t('selected', { n: 1234 })).toBe('1.234 selected');
  });

  it('exposes the category for a component that branches itself', () => {
    const pl = createLocale({ defaultLocale: 'pl-PL' });
    expect(pl.plural(1)).toBe('one');
    expect(pl.plural(2)).toBe('few');
    expect(pl.plural(5)).toBe('many');
    expect(pl.plural(2, { type: 'ordinal' })).toBe('other');
  });
});

describe('direction', () => {
  it('takes an ancestor dir attribute over the language', () => {
    host.setAttribute('dir', 'rtl');
    const app = mountApp('', { defaultLocale: 'en-GB' });

    expect(app.locale.direction()).toBe('rtl');
    expect(app.root().getAttribute('dir')).toBe('rtl');
  });

  it('reads the language when the DOM declares nothing', () => {
    const app = mountApp('', { defaultLocale: 'ar-EG' });

    // Every unstyled element computes `ltr`, so a computed `ltr` says only
    // that nobody has said anything — it must not outrank the language.
    expect(app.locale.direction()).toBe('rtl');
    expect(app.root().getAttribute('dir')).toBe('rtl');
    expect(app.root().getAttribute('lang')).toBe('ar-EG');
  });

  it('reads the language on an engine that has only the older text info', () => {
    // Node 22 exposes `textInfo` and no `getTextInfo`; Node 24 has both, so a
    // machine running the newer one never exercises this path and the older
    // one silently renders Arabic left to right. `fa-IR` because the answer is
    // cached per tag and the tags above are already resolved.
    const proto = Intl.Locale.prototype as unknown as Record<string, unknown>;
    const method = proto.getTextInfo;
    delete proto.getTextInfo;
    try {
      expect(typeof new Intl.Locale('fa-IR').getTextInfo).toBe('undefined');
      const app = mountApp('', { defaultLocale: 'fa-IR' });
      expect(app.locale.direction()).toBe('rtl');
      expect(app.root().getAttribute('dir')).toBe('rtl');
    } finally {
      proto.getTextInfo = method;
    }
  });

  it('lets the explicit option win over both', () => {
    host.setAttribute('dir', 'rtl');
    const app = mountApp('', { defaultLocale: 'ar-EG', defaultDirection: 'ltr' });

    expect(app.locale.direction()).toBe('ltr');
    expect(app.root().getAttribute('dir')).toBe('ltr');
  });

  it('keeps following the language after writing dir on its own element', () => {
    const app = mountApp('', { defaultLocale: 'ar-EG' });
    expect(app.root().getAttribute('dir')).toBe('rtl');

    app.locale.setLocale('en-GB');
    flushSync();

    // Reading its own attribute back would have frozen this at rtl for ever.
    expect(app.root().getAttribute('dir')).toBe('ltr');
  });

  it('notices a dir attribute appearing on an ancestor later', async () => {
    const app = mountApp('', { defaultLocale: 'en-GB' });
    expect(app.locale.direction()).toBe('ltr');

    document.documentElement.setAttribute('dir', 'rtl');
    await settle();

    // The DOM is not reactive, so this only works because the provider is
    // watching for it.
    expect(app.locale.direction()).toBe('rtl');
    expect(app.root().getAttribute('dir')).toBe('rtl');
  });

  describe('when one provider is nested inside another', () => {
    /** An outer provider on its element, and an inner one on an element inside it. */
    function mountNested(outer: LocaleOptions, inner: LocaleOptions, between = '') {
      sequence += 1;

      @Component({
        selector: `v-i18n-nested-inner-${sequence}`,
        render: compileTemplate(
          `<section class="inner" :ref="root" :spread="locale.providerProps()"></section>`,
        ),
      })
      class Inner {
        root = new Signal.State<Element | null>(null);
        locale = createLocaleProvider({ element: () => this.root.get(), ...inner });
      }

      const tag = `v-i18n-nested-inner-${sequence}`;
      const body = between ? `<div dir="${between}"><${tag}></${tag}></div>` : `<${tag}></${tag}>`;

      @Component({
        selector: `v-i18n-nested-outer-${sequence}`,
        imports: [Inner],
        render: compileTemplate(
          `<div class="outer" :ref="root" :spread="locale.providerProps()">${body}</div>`,
        ),
      })
      class Outer {
        root = new Signal.State<Element | null>(null);
        locale = createLocaleProvider({ element: () => this.root.get(), ...outer });
      }

      const handle = track(mount(Outer, host));
      flushSync();
      return {
        locale: (handle.instance as Outer).locale,
        outer: () => host.querySelector('.outer')!,
        inner: () => host.querySelector('.inner')!,
      };
    }

    it('takes its direction from its own language, not the dir its parent wrote', () => {
      // The outer provider always writes an explicit `dir`. Read as though an
      // author had written it, an Arabic section inside an English page would
      // come out left to right, and setting the tag would not be enough.
      const page = mountNested({ defaultLocale: 'en-GB' }, { defaultLocale: 'ar-EG' });

      expect(page.outer().getAttribute('dir')).toBe('ltr');
      expect(page.inner().getAttribute('dir')).toBe('rtl');
    });

    it('is not overruled by the direction the parent’s dir computes to either', () => {
      // What a browser's own stylesheet does with `dir`, which the test DOM
      // does not do by itself: below the Arabic provider's element, every
      // element computes `rtl`.
      const sheet = document.createElement('style');
      sheet.textContent = '[dir="rtl"] { direction: rtl } [dir="ltr"] { direction: ltr }';
      document.head.append(sheet);
      try {
        const page = mountNested({ defaultLocale: 'ar-EG' }, { defaultLocale: 'en-GB' });
        expect(getComputedStyle(page.inner().parentElement!).direction).toBe('rtl');

        expect(page.outer().getAttribute('dir')).toBe('rtl');
        expect(page.inner().getAttribute('dir')).toBe('ltr');
      } finally {
        sheet.remove();
      }
    });

    it('needs nothing of the parent but its providerProps', () => {
      // A root provider has nothing above it to inherit from, and so no reason
      // to be given its element. Its `dir` still has to be known for its own.
      const page = mountNested(
        { defaultLocale: 'en-GB', element: undefined },
        { defaultLocale: 'ar-EG' },
      );

      expect(page.outer().getAttribute('dir')).toBe('ltr');
      expect(page.inner().getAttribute('dir')).toBe('rtl');
    });

    it('answers to a direction forced on the parent, as to a dir written by hand', async () => {
      // Forcing `rtl` on an English page is how a right-to-left layout gets
      // tried out, and a section with a locale of its own is part of the page.
      const page = mountNested(
        { defaultLocale: 'en-GB', defaultDirection: 'rtl' },
        { defaultLocale: 'en-GB' },
      );
      expect(page.outer().getAttribute('dir')).toBe('rtl');
      expect(page.inner().getAttribute('dir')).toBe('rtl');

      page.locale.setDirection('auto');
      await settle();
      expect(page.outer().getAttribute('dir')).toBe('ltr');
      expect(page.inner().getAttribute('dir')).toBe('ltr');
    });

    it('notices the parent’s direction being forced to the value it already had', async () => {
      const page = mountNested({ defaultLocale: 'en-GB' }, { defaultLocale: 'ar-EG' });
      expect(page.inner().getAttribute('dir')).toBe('rtl');

      // The parent's `dir` reads `ltr` before and after. What changed is whose
      // it is: the language's a moment ago, and now the author's.
      page.locale.setDirection('ltr');
      await settle();
      expect(page.outer().getAttribute('dir')).toBe('ltr');
      expect(page.inner().getAttribute('dir')).toBe('ltr');

      page.locale.setDirection('auto');
      await settle();
      expect(page.inner().getAttribute('dir')).toBe('rtl');
    });

    it('watches the mark on a resolved dir, not only the dir beside it', async () => {
      // A parent's element as a server wrote it, so that nothing here rewrites
      // `dir` in passing: the mark going is the only thing that happens.
      host.innerHTML = '<div dir="ltr" data-volt-dir="auto"><div class="slot"></div></div>';
      const slot = host.querySelector<HTMLElement>('.slot')!;
      track(mount(defineApp('', { defaultLocale: 'ar-EG' }), slot));
      flushSync();
      expect(slot.firstElementChild!.getAttribute('dir')).toBe('rtl');

      host.firstElementChild!.removeAttribute('data-volt-dir');
      await settle();
      expect(slot.firstElementChild!.getAttribute('dir')).toBe('ltr');
    });

    it('still answers to a dir an author wrote, inside the parent or above it', async () => {
      const between = mountNested({ defaultLocale: 'en-GB' }, { defaultLocale: 'en-GB' }, 'rtl');
      await settle();
      expect(between.inner().getAttribute('dir')).toBe('rtl');

      for (const handle of mounted) handle.unmount();
      mounted = [];
      host.setAttribute('dir', 'rtl');
      const above = mountNested({ defaultLocale: 'en-GB' }, { defaultLocale: 'en-GB' });
      await settle();
      expect(above.outer().getAttribute('dir')).toBe('rtl');
      expect(above.inner().getAttribute('dir')).toBe('rtl');
    });
  });

  it('stops watching the document once the component goes', async () => {
    const disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect');
    const app = mountApp('', { defaultLocale: 'en-GB' });

    app.handle.unmount();
    expect(disconnect).toHaveBeenCalled();
    disconnect.mockRestore();
  });

  it('defaults to ltr and honours the nearest attribute', () => {
    host.innerHTML = '<div dir="rtl"><span class="inner"></span></div>';

    expect(resolveDirection(null)).toBe('ltr');
    expect(resolveDirection(host.querySelector('.inner'))).toBe('rtl');
  });

  it('treats dir="auto" as nothing declared', () => {
    host.innerHTML = '<div dir="auto"><span class="inner"></span></div>';
    // `auto` delegates the decision to the text, per paragraph; there is no
    // single answer to give back here.
    expect(resolveDirection(host.querySelector('.inner'))).toBe('ltr');
  });
});

describe('the keyboard map follows the locale', () => {
  @Component({
    selector: 'v-i18n-toolbar',
    render: compileTemplate(`
      <div :ref="root" :spread="locale.providerProps()">
        <div :ref="list" role="toolbar" :keydown="onKeyDown($event)">
          <button class="a" data-volt-item>A</button>
          <button class="b" data-volt-item>B</button>
          <button class="c" data-volt-item>C</button>
        </div>
        <button class="close" :aria-label="locale.t('close')">×</button>
      </div>
    `),
  })
  class Toolbar {
    root = new Signal.State<Element | null>(null);
    list = new Signal.State<Element | null>(null);
    active = new Signal.State<HTMLElement | null>(null);
    locale = createLocaleProvider({
      defaultLocale: 'en-GB',
      element: () => this.root.get(),
    });
    roving = createRovingFocus(
      createCollection(() => this.list.get()),
      () => this.active.get(),
      (el) => this.active.set(el),
      { orientation: 'horizontal' },
    );

    onKeyDown(event: KeyboardEvent): void {
      if (this.roving.onKeyDown(event)) event.preventDefault();
    }
  }

  function setup() {
    const handle = track(mount(Toolbar, host));
    flushSync();
    return {
      locale: (handle.instance as Toolbar).locale,
      button: (name: string): HTMLElement => host.querySelector<HTMLElement>(`.${name}`)!,
    };
  }

  it('mirrors the arrows when the locale turns the page right to left', () => {
    const { locale, button } = setup();

    // Home rather than a bare focus(): the group's tab stop is state, and an
    // arrow key moves from where the group thinks it is, not from wherever the
    // browser last put focus.
    press(button('a'), 'Home');
    expect(document.activeElement).toBe(button('a'));

    press(button('a'), 'ArrowRight');
    expect(document.activeElement).toBe(button('b'));

    locale.setLocale('ar-EG');
    flushSync();

    // Nothing about the toolbar changed. The provider wrote `dir="rtl"` on the
    // element above it, and roving focus resolves its arrows against that same
    // attribute — which is the whole reason direction lives in one place.
    expect(button('a').closest('[dir]')!.getAttribute('dir')).toBe('rtl');

    press(button('b'), 'ArrowRight');
    expect(document.activeElement).toBe(button('a'));

    press(button('a'), 'ArrowLeft');
    expect(document.activeElement).toBe(button('b'));
  });

  it('leaves Home and End alone, because they are not directional', () => {
    const { locale, button } = setup();
    locale.setLocale('ar-EG');
    flushSync();

    button('a').focus();
    press(button('a'), 'End');
    expect(document.activeElement).toBe(button('c'));

    press(button('c'), 'Home');
    expect(document.activeElement).toBe(button('a'));
  });

  it('localises the accessible name and keeps it in step', () => {
    const { locale, button } = setup();
    expect(button('close').getAttribute('aria-label')).toBe('Close');

    locale.setMessages({ close: 'إغلاق' });
    locale.setLocale('ar-EG');
    flushSync();

    // The name a screen reader reads is the one thing on this button, and it
    // is the thing a hard-coded English string would leave behind.
    expect(button('close').getAttribute('aria-label')).toBe('إغلاق');
  });
});

describe('sorting', () => {
  it('puts ö after z in Swedish and before it in German', () => {
    const sv = createLocale({ defaultLocale: 'sv-SE' });
    const de = createLocale({ defaultLocale: 'de-DE' });

    // The same three strings, two correct answers. `localeCompare()` with no
    // argument can only give one of them, and it is whichever the machine
    // running the browser happens to prefer.
    expect(['ö', 'z', 'a'].sort(sv.compare)).toEqual(['a', 'z', 'ö']);
    expect(['ö', 'z', 'a'].sort(de.compare)).toEqual(['a', 'ö', 'z']);
  });

  it('keeps ı and i apart in Turkish', () => {
    const tr = createLocale({ defaultLocale: 'tr-TR' });
    const en = createLocale({ defaultLocale: 'en-GB' });

    expect(tr.compare('ı', 'i')).toBeLessThan(0);
    expect(en.compare('ı', 'i')).toBeGreaterThan(0);
  });

  it('orders embedded numbers the way a reader does', () => {
    const en = createLocale({ defaultLocale: 'en-GB' });
    expect(['Item 10', 'Item 9', 'Item 1'].sort(en.compare)).toEqual([
      'Item 1',
      'Item 9',
      'Item 10',
    ]);

    const alphabetical = createLocale({
      defaultLocale: 'en-GB',
      collator: { numeric: false },
    });
    expect(['Item 10', 'Item 9'].sort(alphabetical.compare)).toEqual(['Item 10', 'Item 9']);
  });

  it('changes its mind when the locale does', () => {
    const locale = createLocale({ defaultLocale: 'de-DE' });
    expect(locale.compare('ö', 'z')).toBeLessThan(0);

    locale.setLocale('sv-SE');
    expect(locale.compare('ö', 'z')).toBeGreaterThan(0);
  });

  it('hands back the same collator every time', () => {
    const locale = createLocale({ defaultLocale: 'en-GB' });
    expect(locale.collator()).toBe(locale.collator());
    expect(locale.collator({ sensitivity: 'base' })).not.toBe(locale.collator());
  });
});

describe('cached Intl instances', () => {
  it('returns one instance per locale and options', () => {
    expect(getNumberFormat('en-GB')).toBe(getNumberFormat('en-GB'));
    expect(getNumberFormat('en-GB')).not.toBe(getNumberFormat('de-DE'));
    expect(getNumberFormat('en-GB', { style: 'percent' })).not.toBe(getNumberFormat('en-GB'));
  });

  it('does not care what order the options were written in', () => {
    // Two spellings of the same formatter are the same formatter; keying on
    // the literal JSON would quietly build both.
    expect(getNumberFormat('en-GB', { style: 'currency', currency: 'EUR' })).toBe(
      getNumberFormat('en-GB', { currency: 'EUR', style: 'currency' }),
    );
  });

  it('keeps the kinds apart when they share a locale and no options', () => {
    getNumberFormat('en-GB');
    getCollator('en-GB');
    // A key made of the tag alone would hand a NumberFormat back to whoever
    // asked for a DateTimeFormat.
    expect(getDateTimeFormat('en-GB')).toBeInstanceOf(Intl.DateTimeFormat);
    expect(getCollator('en-GB')).toBeInstanceOf(Intl.Collator);
  });

  it('bounds itself, so options taken from data cannot leak', () => {
    const first = getNumberFormat('en-GB-x-a0');
    expect(getNumberFormat('en-GB-x-a0')).toBe(first);

    for (let i = 1; i <= 300; i++) getNumberFormat(`en-GB-x-a${i}`);

    expect(getNumberFormat('en-GB-x-a0')).not.toBe(first);
  });

  it('is emptied by the test seam', () => {
    const before = getNumberFormat('en-GB');
    resetLocaleCaches();
    expect(getNumberFormat('en-GB')).not.toBe(before);
  });
});

describe('formatting', () => {
  const en = () => createLocale({ defaultLocale: 'en-GB' });
  const de = () => createLocale({ defaultLocale: 'de-DE' });

  it('formats numbers, currency and percentages for the locale', () => {
    expect(en().format.number(1234.5)).toBe('1,234.5');
    expect(de().format.number(1234.5)).toBe('1.234,5');

    expect(plain(en().format.currency(1234.5, 'GBP'))).toBe('£1,234.50');
    expect(plain(de().format.currency(1234.5, 'EUR'))).toBe('1.234,50 €');

    // A fraction, because that is what Intl's percent style multiplies.
    expect(en().format.percent(0.425)).toBe('43%');
    expect(en().format.percent(0.425, { maximumFractionDigits: 1 })).toBe('42.5%');
  });

  it('follows a locale change without being rebuilt', () => {
    const locale = en();
    expect(locale.format.number(1234.5)).toBe('1,234.5');

    locale.setLocale('de-DE');
    // The formatter reads the tag per call; capturing it would have pinned the
    // whole application to whatever locale it booted with.
    expect(locale.format.number(1234.5)).toBe('1.234,5');
  });

  it('formats dates, and says nothing at all about an unparseable one', () => {
    const day = new Date(2026, 7, 16);

    expect(en().format.date(day, { dateStyle: 'medium' })).toBe('16 Aug 2026');
    expect(de().format.date(day, { dateStyle: 'medium' })).toBe('16.08.2026');
    expect(en().format.date('2026-08-16T12:00:00', { dateStyle: 'medium' })).toBe('16 Aug 2026');

    // Intl throws RangeError on an invalid date. Bad data from an API must not
    // take the page down with it.
    expect(en().format.date('not a date')).toBe('');
    expect(en().format.date(Number.NaN)).toBe('');
  });

  it('joins lists the way the language does', () => {
    expect(en().format.list(['a', 'b', 'c'])).toBe('a, b and c');
    expect(de().format.list(['a', 'b', 'c'])).toBe('a, b und c');
    expect(en().format.list(['a', 'b'], { type: 'disjunction' })).toBe('a or b');
  });

  it('counts bytes in units that match the number beside them', () => {
    const locale = en();

    // "byte" has no short form worth printing, so plain bytes are spelled out.
    expect(plain(locale.format.bytes(0))).toBe('0 bytes');
    expect(plain(locale.format.bytes(1))).toBe('1 byte');
    expect(plain(locale.format.bytes(1536))).toBe('1.5 kB');
    expect(plain(locale.format.bytes(-2048))).toBe('-2 kB');
    expect(plain(de().format.bytes(1536))).toBe('1,5 kB');
    expect(plain(locale.format.bytes(1536, { unitDisplay: 'long' }))).toBe('1.5 kilobytes');

    // 999,999 bytes is 999.999 kB, which rounds to "1,000 kB" — a number its
    // own unit contradicts.
    expect(plain(locale.format.bytes(999_999))).toBe('1 MB');

    expect(plain(locale.format.bytes(1536, { binary: true }))).toBe('1.5 KiB');
    expect(plain(locale.format.bytes(1_048_576, { binary: true }))).toBe('1 MiB');
    expect(plain(locale.format.bytes(Number.NaN))).toBe('NaN');
  });

  it('picks a relative unit by the calendar, not by elapsed milliseconds', () => {
    const locale = en();
    const now = new Date(2026, 7, 16, 12, 0);

    expect(locale.format.relativeTime(new Date(2026, 7, 16, 12, 0, 30), { now })).toBe(
      'in 30 seconds',
    );
    expect(locale.format.relativeTime(new Date(2026, 7, 16, 15, 0), { now })).toBe('in 3 hours');
    expect(locale.format.relativeTime(new Date(2026, 7, 15, 12, 0), { now })).toBe('yesterday');
    expect(locale.format.relativeTime(new Date(2026, 7, 6, 12, 0), { now })).toBe('last week');
    expect(locale.format.relativeTime(new Date(2026, 4, 16, 12, 0), { now })).toBe('3 months ago');
    expect(locale.format.relativeTime(new Date(2024, 7, 16, 12, 0), { now })).toBe('2 years ago');

    // 25 hours, and two calendar days: "yesterday" here would be a lie that
    // dividing by 86,400,000 tells every night.
    expect(
      locale.format.relativeTime(new Date(2026, 7, 14, 23, 30), {
        now: new Date(2026, 7, 16, 0, 30),
      }),
    ).toBe('2 days ago');
  });

  it('says weeks until a whole month has passed, wherever the month boundary falls', () => {
    const locale = en();

    // Eight days back from the 8th crosses into last month, and is still only
    // eight days: "last month" would rank it with something from the 1st of
    // that month, while 28 days back from the 30th is "4 weeks ago".
    const eighth = new Date(2026, 8, 8, 12, 0);
    expect(locale.format.relativeTime(new Date(2026, 7, 31, 12, 0), { now: eighth })).toBe(
      'last week',
    );
    const thirtieth = new Date(2026, 8, 30, 12, 0);
    expect(locale.format.relativeTime(new Date(2026, 8, 2, 12, 0), { now: thirtieth })).toBe(
      '4 weeks ago',
    );
    expect(locale.format.relativeTime(new Date(2026, 9, 1, 12, 0), { now: eighth })).toBe(
      'in 3 weeks',
    );

    expect(locale.format.relativeTime(new Date(2026, 7, 8, 12, 0), { now: eighth })).toBe(
      'last month',
    );
  });

  it('counts the months that have gone by, not the month boundaries crossed', () => {
    const locale = en();
    const firstOfMarch = new Date(2026, 2, 1, 12, 0);

    // February is the whole of the gap between these, and crossing both its
    // ends does not make 29 days two months — one day more than "4 weeks ago".
    expect(
      locale.format.relativeTime(new Date(2026, 0, 31, 12, 0), {
        now: new Date(2026, 1, 28, 12, 0),
      }),
    ).toBe('4 weeks ago');
    expect(locale.format.relativeTime(new Date(2026, 0, 31, 12, 0), { now: firstOfMarch })).toBe(
      'last month',
    );
    expect(locale.format.relativeTime(new Date(2026, 0, 1, 12, 0), { now: firstOfMarch })).toBe(
      '2 months ago',
    );
    expect(
      locale.format.relativeTime(firstOfMarch, { now: new Date(2026, 0, 31, 12, 0) }),
    ).toBe('next month');

    // Eleven whole months is still months, though the year has changed.
    expect(
      locale.format.relativeTime(new Date(2025, 2, 15, 12, 0), { now: firstOfMarch }),
    ).toBe('11 months ago');
  });

  it('counts years by the calendar, as it counts days', () => {
    const locale = en();
    const january = new Date(2026, 0, 10, 12, 0);

    // "Last year" names the calendar year before this one, and December 2024
    // is two before January 2026 however few months lie between them.
    expect(locale.format.relativeTime(new Date(2024, 11, 15, 12, 0), { now: january })).toBe(
      '2 years ago',
    );
    expect(locale.format.relativeTime(new Date(2025, 0, 5, 12, 0), { now: january })).toBe(
      'last year',
    );

    // A forced unit counts the same way, rather than calling yesterday this
    // year because twelve months have not gone by.
    const newYear = new Date(2026, 0, 1, 12, 0);
    const newYearsEve = new Date(2025, 11, 31, 12, 0);
    expect(locale.format.relativeTime(newYearsEve, { now: newYear, unit: 'year' })).toBe(
      'last year',
    );
    expect(locale.format.relativeTime(newYearsEve, { now: newYear, unit: 'quarter' })).toBe(
      'last quarter',
    );
    expect(locale.format.relativeTime(new Date(2026, 2, 31), { now: newYear, unit: 'quarter' })).toBe(
      'this quarter',
    );
  });

  it('hands the amount and the unit to code that is not a formatter', () => {
    const locale = en();
    const now = new Date(2026, 8, 8, 12, 0);

    // What a self-updating timestamp needs: the unit to pace its clock by, and
    // the same arithmetic as the formatter so the two never disagree.
    const cases: [Date, [number, string]][] = [
      [new Date(2026, 8, 8, 12, 1, 30), [2, 'minute']],
      [new Date(2026, 8, 7, 23, 0), [-13, 'hour']],
      [new Date(2026, 7, 31, 12, 0), [-1, 'week']],
      [new Date(2026, 6, 31, 12, 0), [-1, 'month']],
      [new Date(2024, 11, 15, 12, 0), [-2, 'year']],
    ];
    for (const [target, [amount, unit]] of cases) {
      expect(relativeTimeParts(target, now)).toEqual([amount, unit]);
      expect(locale.format.relativeTime(target, { now })).toBe(
        new Intl.RelativeTimeFormat('en-GB', { numeric: 'auto' }).format(
          amount,
          unit as Intl.RelativeTimeFormatUnit,
        ),
      );
    }
  });

  it('takes a forced unit, and a numeric style for a live countdown', () => {
    const locale = en();
    const now = new Date(2026, 7, 16, 12, 0);

    expect(locale.format.relativeTime(new Date(2026, 7, 16, 9, 0), { now, unit: 'day' })).toBe(
      'today',
    );
    expect(locale.format.relativeTime(new Date(2026, 7, 15, 12, 0), { now, unit: 'hour' })).toBe(
      '24 hours ago',
    );
    // 'auto' says "yesterday", which reads as a stopped clock in a countdown.
    expect(
      locale.format.relativeTime(new Date(2026, 7, 15, 12, 0), { now, numeric: 'always' }),
    ).toBe('1 day ago');

    expect(locale.format.relativeTime('not a date', { now })).toBe('');
  });

  it('speaks the language it is given, not the one the runtime prefers', () => {
    const now = new Date(2026, 7, 16, 12, 0);
    expect(de().format.relativeTime(new Date(2026, 7, 15, 12, 0), { now })).toBe('gestern');
  });
});
