/**
 * `<v-tabs>` and `<v-tab>`, driven the way a page drives them.
 *
 * The behaviour is `createTabs`' and is tested where it lives. What is left
 * here is what this pair adds: a tab drawn per tag inside the list, a panel
 * drawn per tag below it from what was written inside the tag, the classes and
 * the attributes the sheet's rules select on, and the primitive left reachable
 * for everything this does not offer.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Component, Signal, flushSync, mount } from '@voltdev/core';
import { compileTemplate } from '@voltdev/core/jit';
import { compileComponents } from './render.js';
import { VTab } from '../src/components/tab.js';
import { VTabs } from '../src/components/tabs.js';

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
 * A reorder is watched for rather than rendered from, so the sections learn it
 * from a `MutationObserver` — which is a microtask away rather than a flush.
 */
async function settle(): Promise<void> {
  await Promise.resolve();
  flushSync();
}

/** A keydown as a real one arrives: from the focused tab, bubbling to the list. */
function press(el: Element, key: string): void {
  el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  flushSync();
}

const tabs = (host: HTMLElement): HTMLElement[] => [
  ...host.querySelectorAll<HTMLElement>('.volt-tabs-tab'),
];

const panels = (host: HTMLElement): HTMLElement[] => [
  ...host.querySelectorAll<HTMLElement>('.volt-tabs-panel'),
];

/** Each panel named by the words of the tab that labels it. */
const panelsByTab = (host: HTMLElement): string[] =>
  panels(host).map(
    (panel) => document.getElementById(panel.getAttribute('aria-labelledby')!)?.textContent ?? '',
  );

@Component({
  selector: 'v-page',
  imports: [VTabs, VTab],
  render: compileTemplate(`
    <v-tabs :value="section" label="Settings" class="mine">
      <v-tab value="account" label="Account" class="first"><p>Who you are.</p></v-tab>
      <v-tab value="billing" label="Billing"><p>What you owe.</p></v-tab>
      <v-tab value="archive" label="Archive" :disabled="off.get()"><p>What is gone.</p></v-tab>
      <v-tab value="keys" label="Keys"><p>What opens what.</p></v-tab>
    </v-tabs>
  `),
})
class Page {
  section = new Signal.State('account');
  off = new Signal.State(true);
}

/** A tab list whose tabs come and go, which is what a closable one is. */
@Component({
  selector: 'v-page-closable',
  imports: [VTabs, VTab],
  render: compileTemplate(`
    <v-tabs :value="section" :onValueChange="heard">
      <v-tab :for="name in names.get()" :key="name" :value="name" :label="name"></v-tab>
    </v-tabs>
  `),
})
class ClosablePage {
  names = new Signal.State(['a', 'b', 'c']);
  section = new Signal.State('b');
  seen: string[] = [];
  heard = (value: string): void => {
    this.seen.push(value);
  };
}

/** The widget owning its own selection, started and named by the caller. */
@Component({
  selector: 'v-page-default',
  imports: [VTabs, VTab],
  render: compileTemplate(`
    <h2 id="sections-heading">Sections</h2>
    <v-tabs defaultValue="two" labelledBy="sections-heading" :onValueChange="heard">
      <v-tab value="one" label="One"></v-tab>
      <v-tab value="two" label="Two"></v-tab>
      <v-tab value="three" label="Three"></v-tab>
    </v-tabs>
  `),
})
class DefaultPage {
  seen: string[] = [];
  heard = (value: string): void => {
    this.seen.push(value);
  };
}

describe('v-tabs', () => {
  it('draws a tab per tag in the list, and a panel per tag below it', () => {
    const { host } = show(Page);
    const list = host.querySelector('.volt-tabs-list')!;

    expect(list.getAttribute('role')).toBe('tablist');
    expect(list.getAttribute('aria-label')).toBe('Settings');
    expect(tabs(host).map((tab) => tab.textContent)).toEqual([
      'Account',
      'Billing',
      'Archive',
      'Keys',
    ]);
    // A tab inside a form submits it unless it says otherwise, and the
    // primitive cannot say it: a tab is as often a `<div>` or an `<a>`.
    expect(tabs(host).every((tab) => (tab as HTMLButtonElement).type === 'button')).toBe(true);

    // The panels are drawn where this puts them, which is below the list and
    // never inside it: a query from the list is how the primitive finds its
    // tabs, and a panel holding a second tabs widget would answer it.
    expect(list.querySelector('.volt-tabs-panel')).toBe(null);
    expect(panels(host).map((panel) => panel.textContent)).toEqual([
      'Who you are.',
      'What you owe.',
      'What is gone.',
      'What opens what.',
    ]);
  });

  it('lands what the caller wrote on each tag on the element they can see', () => {
    const { host } = show(Page);

    // The widget's own class is on the element wrapping the list and the
    // panels, which is the thing a page lays out.
    const root = host.querySelector('.mine')!;
    expect(root.querySelector('.volt-tabs-list')).not.toBe(null);
    expect(root.querySelectorAll('.volt-tabs-panel').length).toBe(4);

    // A tab's own class is on the tab, beside the sheet's.
    expect([...tabs(host)[0]!.classList].sort()).toEqual(['first', 'volt-tabs-tab']);
  });

  it('writes every state the sheet draws a tab and a panel by', () => {
    const { host } = show(Page);
    const [account, billing, archive] = tabs(host);

    expect(account!.getAttribute('data-state')).toBe('active');
    expect(billing!.getAttribute('data-state')).toBe('inactive');
    expect(account!.getAttribute('data-orientation')).toBe('horizontal');
    expect(archive!.getAttribute('data-disabled')).toBe('');
    expect(archive!.getAttribute('aria-disabled')).toBe('true');
    // The package's rule for a disabled control: it keeps its place in the
    // accessibility tree rather than being taken out of the platform's.
    expect(archive!.hasAttribute('disabled')).toBe(false);

    expect(panels(host)[0]!.getAttribute('data-state')).toBe('active');
    expect(panels(host)[0]!.hidden).toBe(false);
    // Hidden rather than unmounted, so every tab's `aria-controls` resolves —
    // which is also why nothing in the sheet gives a panel a `display`.
    expect(panels(host)[1]!.hidden).toBe(true);
    expect(panels(host)[1]!.getAttribute('data-state')).toBe('inactive');
    // In the tab order whichever panel is showing, so a panel of plain prose
    // is reachable, and its focus ring has something to draw on.
    expect(panels(host)[0]!.getAttribute('tabindex')).toBe('0');
  });

  it('turns the axis over to the list, the tabs and the panels', () => {
    @Component({
      selector: 'v-page-vertical',
      imports: [VTabs, VTab],
      render: compileTemplate(`
        <v-tabs orientation="vertical">
          <v-tab value="one" label="One"></v-tab>
          <v-tab value="two" label="Two"></v-tab>
        </v-tabs>
      `),
    })
    class VerticalPage {}

    const { host } = show(VerticalPage);
    expect(host.querySelector('.volt-tabs-list')!.getAttribute('data-orientation')).toBe('vertical');
    expect(host.querySelector('.volt-tabs-list')!.getAttribute('aria-orientation')).toBe('vertical');
    expect(tabs(host)[0]!.getAttribute('data-orientation')).toBe('vertical');
    expect(panels(host)[0]!.getAttribute('data-orientation')).toBe('vertical');

    // With nothing said about the value, the first tab selects itself: a tab
    // list with nothing selected shows no panel at all.
    expect(tabs(host)[0]!.getAttribute('data-state')).toBe('active');
  });

  it('pairs each tab with its own panel, by the primitive’s ids', () => {
    const { host } = show(Page);

    for (const [at, tab] of tabs(host).entries()) {
      expect(document.getElementById(tab.getAttribute('aria-controls')!)).toBe(panels(host)[at]);
      expect(panels(host)[at]!.getAttribute('aria-labelledby')).toBe(tab.id);
    }
  });

  it('follows the arrow keys, over the disabled tab and around the ends', () => {
    const { instance, host } = show(Page);
    const [account, billing, archive, keys] = tabs(host);

    account!.focus();
    press(account!, 'ArrowRight');
    // Automatic activation: the arrows select as they move, which is what the
    // pattern asks for while showing a panel is cheap.
    expect(document.activeElement).toBe(billing);
    expect(instance.section.get()).toBe('billing');

    press(billing!, 'ArrowRight');
    expect(document.activeElement).toBe(keys);
    expect(archive!.getAttribute('data-state')).toBe('inactive');

    press(keys!, 'ArrowRight');
    expect(document.activeElement).toBe(account);

    press(account!, 'End');
    expect(document.activeElement).toBe(keys);
    press(keys!, 'Home');
    expect(document.activeElement).toBe(account);

    // One tab stop for the whole list, so Tab steps over the list rather than
    // through it.
    expect(tabs(host).map((tab) => tab.getAttribute('tabindex'))).toEqual(['0', '-1', '-1', '-1']);
  });

  it('waits for Enter when the caller asked for manual activation', () => {
    @Component({
      selector: 'v-page-manual',
      imports: [VTabs, VTab],
      render: compileTemplate(`
        <v-tabs activation="manual" :value="section">
          <v-tab value="one" label="One"></v-tab>
          <v-tab value="two" label="Two"></v-tab>
        </v-tabs>
      `),
    })
    class ManualPage {
      section = new Signal.State('one');
    }

    const { instance, host } = show(ManualPage);
    const [one, two] = tabs(host);

    one!.focus();
    press(one!, 'ArrowRight');
    expect(document.activeElement).toBe(two);
    expect(instance.section.get()).toBe('one');

    press(two!, 'Enter');
    expect(instance.section.get()).toBe('two');
    expect(two!.getAttribute('data-state')).toBe('active');
  });

  it('refuses a disabled tab, by click as well as by key', () => {
    const { instance, host } = show(Page);
    const archive = tabs(host)[2]!;

    archive.click();
    flushSync();
    expect(instance.section.get()).toBe('account');

    // And takes the refusal back when the caller's signal does: `disabled` is
    // read by the template, so it is a signal, and binding it keeps it live.
    instance.off.set(false);
    flushSync();
    expect(archive.hasAttribute('data-disabled')).toBe(false);

    archive.click();
    flushSync();
    expect(instance.section.get()).toBe('archive');
    expect(archive.getAttribute('data-state')).toBe('active');
    expect(panels(host)[2]!.hidden).toBe(false);
  });

  it('is the caller’s signal on both sides', () => {
    const { instance, host } = show(Page);

    instance.section.set('keys');
    flushSync();
    expect(tabs(host).map((tab) => tab.getAttribute('data-state'))).toEqual([
      'inactive',
      'inactive',
      'inactive',
      'active',
    ]);
    expect(panels(host).map((panel) => panel.hidden)).toEqual([true, true, true, false]);

    tabs(host)[1]!.click();
    flushSync();
    expect(instance.section.get()).toBe('billing');
  });

  it('keeps the panels in step with a tab written later', () => {
    @Component({
      selector: 'v-page-grown',
      imports: [VTabs, VTab],
      render: compileTemplate(`
        <v-tabs>
          <v-tab value="first" label="First"></v-tab>
          <v-tab :for="name in extra.get()" :key="name" :value="name" :label="name"></v-tab>
          <v-tab value="last" label="Last"></v-tab>
        </v-tabs>
      `),
    })
    class GrownPage {
      extra = new Signal.State<string[]>([]);
    }

    const { instance, host } = show(GrownPage);
    instance.extra.set(['middle']);
    flushSync();

    // The tab between the two written ones, and its panel between theirs: a
    // tab that registers last is not a tab that is drawn last.
    expect(tabs(host).map((tab) => tab.textContent)).toEqual(['First', 'middle', 'Last']);
    expect(panelsByTab(host)).toEqual(['First', 'middle', 'Last']);
  });

  it('draws the words a tab was given, and follows a bound label', () => {
    @Component({
      selector: 'v-page-label',
      imports: [VTabs, VTab],
      render: compileTemplate(`
        <v-tabs>
          <v-tab value="one" :label="name.get()"></v-tab>
          <v-tab value="two" label="Two">
            <template :slot-tab><b>T</b>wo</template>
            <p>Body</p>
          </v-tab>
        </v-tabs>
      `),
    })
    class LabelPage {
      name = new Signal.State('One');
    }

    const { instance, host } = show(LabelPage);
    expect(tabs(host)[0]!.textContent).toBe('One');

    instance.name.set('Uno');
    flushSync();
    expect(tabs(host)[0]!.textContent).toBe('Uno');

    // The `tab` slot is the tab's own markup; the content of the tag stays
    // the panel, which is the larger of the two by far.
    expect(tabs(host)[1]!.querySelector('b')!.textContent).toBe('T');
    expect(panels(host)[1]!.textContent).toBe('Body');
  });

  it('hands the primitive itself to whoever needs more than this offers', () => {
    @Component({
      selector: 'v-page-ref',
      imports: [VTabs, VTab],
      render: compileTemplate(`
        <v-tabs :ref="box">
          <v-tab value="one" label="One"></v-tab>
          <v-tab value="two" label="Two"></v-tab>
        </v-tabs>
      `),
    })
    class RefPage {
      box: VTabs | null = null;
    }

    const { instance, host } = show(RefPage);
    expect(instance.box?.tabs.value()).toBe('one');

    instance.box!.tabs.select('two');
    flushSync();
    expect(instance.box!.tabs.isSelected('two')).toBe(true);
    expect(tabs(host)[1]!.getAttribute('data-state')).toBe('active');
  });

  it('refuses to be a tab of nothing', () => {
    @Component({
      selector: 'v-page-loose',
      imports: [VTab],
      render: compileTemplate(`<div><v-tab value="one" label="One"></v-tab></div>`),
    })
    class LoosePage {}

    expect(() => show(LoosePage)).toThrow(/<v-tab> has to be written inside <v-tabs>/);
  });

  it('brings the selection back to a tab that is there when the open one goes', () => {
    const { instance, host } = show(ClosablePage);
    expect(instance.section.get()).toBe('b');

    instance.names.set(['a', 'c']);
    flushSync();

    // The tab that took its place, so closing a tab leaves the widget where
    // the eye already was rather than jumping to the start.
    expect(instance.section.get()).toBe('c');
    expect(tabs(host).map((tab) => tab.getAttribute('data-state'))).toEqual([
      'inactive',
      'active',
    ]);
    expect(panels(host)[1]!.hidden).toBe(false);
    // And the list is still reachable by Tab, which is what a widget with
    // nothing selected loses: every tab would sit at -1.
    expect(tabs(host).map((tab) => tab.getAttribute('tabindex'))).toEqual(['-1', '0']);

    // The last tab going takes the selection to the one before it.
    instance.names.set(['a']);
    flushSync();
    expect(instance.section.get()).toBe('a');
    expect(panels(host)[0]!.hidden).toBe(false);
  });

  it('selects a tab when the value it was handed names none', () => {
    @Component({
      selector: 'v-page-stale',
      imports: [VTabs, VTab],
      render: compileTemplate(`
        <v-tabs :value="section">
          <v-tab value="one" label="One"></v-tab>
          <v-tab value="two" label="Two"></v-tab>
        </v-tabs>
      `),
    })
    class StalePage {
      // A selection restored from somewhere that outlived the tab it names.
      section = new Signal.State('nope');
    }

    const { instance, host } = show(StalePage);
    expect(instance.section.get()).toBe('one');
    expect(panels(host)[0]!.hidden).toBe(false);
    expect(tabs(host).map((tab) => tab.getAttribute('tabindex'))).toEqual(['0', '-1']);

    // And again for a value set later: the widget shows a panel or it shows
    // nothing at all, and nothing at all is not one of its states.
    instance.section.set('gone');
    flushSync();
    expect(instance.section.get()).toBe('one');
    expect(panels(host)[0]!.hidden).toBe(false);
  });

  it('follows a tab that renamed itself while it was showing', () => {
    @Component({
      selector: 'v-page-renamed',
      imports: [VTabs, VTab],
      render: compileTemplate(`
        <v-tabs :value="section">
          <v-tab value="first" label="First"></v-tab>
          <v-tab :value="name.get()" label="Second"></v-tab>
        </v-tabs>
      `),
    })
    class RenamedPage {
      name = new Signal.State('second');
      section = new Signal.State('second');
    }

    const { instance, host } = show(RenamedPage);
    expect(panels(host)[1]!.hidden).toBe(false);

    instance.name.set('segundo');
    flushSync();

    // The tab is the same tab, so it keeps the selection rather than handing
    // it to whichever tab happens to be first.
    expect(instance.section.get()).toBe('segundo');
    expect(tabs(host)[1]!.getAttribute('data-state')).toBe('active');
    expect(panels(host)[1]!.hidden).toBe(false);
  });

  it('steps over a disabled tab when it brings the selection back', () => {
    @Component({
      selector: 'v-page-closable-off',
      imports: [VTabs, VTab],
      render: compileTemplate(`
        <v-tabs :value="section">
          <v-tab
            :for="name in names.get()"
            :key="name"
            :value="name"
            :label="name"
            :disabled="name === 'b'"
          ></v-tab>
        </v-tabs>
      `),
    })
    class ClosableOffPage {
      names = new Signal.State(['a', 'b', 'c']);
      section = new Signal.State('a');
    }

    const { instance, host } = show(ClosableOffPage);
    instance.names.set(['b', 'c']);
    flushSync();

    // A disabled tab refuses a click and refuses a key, so it is not something
    // this may select on the caller's behalf either.
    expect(instance.section.get()).toBe('c');
    expect(panels(host)[1]!.hidden).toBe(false);
  });

  it('starts at the tab the caller defaulted to, and keeps quiet about it', () => {
    const { instance, host } = show(DefaultPage);

    expect(tabs(host).map((tab) => tab.getAttribute('data-state'))).toEqual([
      'inactive',
      'active',
      'inactive',
    ]);
    expect(panels(host)[1]!.hidden).toBe(false);
    // A default is nobody's choice, so an application saving the value on
    // change does not record a write no user made.
    expect(instance.seen).toEqual([]);
  });

  it('names the list by an element that is already on the page', () => {
    const { host } = show(DefaultPage);
    const list = host.querySelector('.volt-tabs-list')!;

    expect(list.getAttribute('aria-labelledby')).toBe('sections-heading');
    expect(list.hasAttribute('aria-label')).toBe(false);
  });

  it('reports the selections a user made, and nothing else', () => {
    const { instance, host } = show(ClosablePage);

    tabs(host)[2]!.click();
    flushSync();
    expect(instance.seen).toEqual(['c']);

    // The selection moving because the tab it was on was taken away is the
    // page's own edit coming back to it, not a user's choice: it hears about
    // that through the signal it passed.
    instance.names.set(['a', 'b']);
    flushSync();
    expect(instance.section.get()).toBe('b');
    expect(instance.seen).toEqual(['c']);
  });

  it('stops at the last tab when the caller turned looping off', () => {
    @Component({
      selector: 'v-page-ends',
      imports: [VTabs, VTab],
      render: compileTemplate(`
        <v-tabs :value="section" :loop="false">
          <v-tab value="one" label="One"></v-tab>
          <v-tab value="two" label="Two"></v-tab>
        </v-tabs>
      `),
    })
    class EndsPage {
      section = new Signal.State('one');
    }

    const { instance, host } = show(EndsPage);
    const [one, two] = tabs(host);

    one!.focus();
    press(one!, 'ArrowLeft');
    expect(document.activeElement).toBe(one);
    expect(instance.section.get()).toBe('one');

    press(one!, 'ArrowRight');
    expect(document.activeElement).toBe(two);

    press(two!, 'ArrowRight');
    expect(document.activeElement).toBe(two);
    expect(instance.section.get()).toBe('two');
  });

  it('follows the name the list was given', () => {
    @Component({
      selector: 'v-page-named',
      imports: [VTabs, VTab],
      render: compileTemplate(`
        <v-tabs :label="name.get()">
          <v-tab value="one" label="One"></v-tab>
        </v-tabs>
      `),
    })
    class NamedPage {
      name = new Signal.State('Settings');
    }

    const { instance, host } = show(NamedPage);
    const list = host.querySelector('.volt-tabs-list')!;
    expect(list.getAttribute('aria-label')).toBe('Settings');

    // The name of a widget is as often translated, or written from data, as
    // it is a literal — so it is read on every render like any other prop.
    instance.name.set('Reports');
    flushSync();
    expect(list.getAttribute('aria-label')).toBe('Reports');
  });

  it('says where the name of a tab list belongs when one lands on the wrapper', () => {
    @Component({
      selector: 'v-page-misnamed',
      imports: [VTabs, VTab],
      render: compileTemplate(`
        <v-tabs aria-label="Settings widget">
          <v-tab value="one" label="One"></v-tab>
        </v-tabs>
      `),
    })
    class MisnamedPage {}

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { host } = show(MisnamedPage);

    // What the caller wrote stays where they wrote it — this takes nothing
    // away — but the element it is on has no role, so the list it was meant
    // for is still unnamed, and nothing else would ever say so.
    expect(host.firstElementChild!.getAttribute('aria-label')).toBe('Settings widget');
    expect(host.querySelector('.volt-tabs-list')!.hasAttribute('aria-label')).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toMatch(/aria-label[\s\S]*label=/);
    warn.mockRestore();
  });

  it('keeps quiet about a name the caller gave the wrapper a role to hold', () => {
    @Component({
      selector: 'v-page-region',
      imports: [VTabs, VTab],
      render: compileTemplate(`
        <v-tabs role="region" aria-label="Settings">
          <v-tab value="one" label="One"></v-tab>
        </v-tabs>
      `),
    })
    class RegionPage {}

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    show(RegionPage);

    // A role written on the tag is the one way a name lands on something: the
    // wrapper is that caller's region, and they said so.
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('keeps the panels in the order the tabs were moved into', async () => {
    @Component({
      selector: 'v-page-moved',
      imports: [VTabs, VTab],
      render: compileTemplate(`
        <v-tabs>
          <v-tab :for="name in names.get()" :key="name" :value="name" :label="name"></v-tab>
        </v-tabs>
      `),
    })
    class MovedPage {
      names = new Signal.State(['a', 'b', 'c']);
    }

    const { instance, host } = show(MovedPage);
    instance.names.set(['c', 'b', 'a']);
    flushSync();
    await settle();

    // A reorder moves elements without adding or removing a child, so nothing
    // the sections were built from changed — the order comes back from the
    // DOM, which is the side that decided it.
    expect(tabs(host).map((tab) => tab.textContent)).toEqual(['c', 'b', 'a']);
    expect(panelsByTab(host)).toEqual(['c', 'b', 'a']);
  });
});
