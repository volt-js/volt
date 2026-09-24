/**
 * `<v-badge>`, driven the way a page drives it.
 *
 * The count, the cap and the name are `createBadge`'s and are tested where
 * they live. What is tested here is the shell: that what a caller writes on
 * the tag reaches the badge, that a count arrives whichever way it was
 * written and follows what it was bound to, that every state the sheet draws
 * is on the element its rules select on, that the control the badge counts
 * for is described by it without losing what it was described by already,
 * that every prop handed to the primitive does something, and that nothing
 * about the primitive is out of reach.
 *
 * The last two blocks hold the sheet to the two promises this markup leans on
 * and the shared suites cannot see: the corner is found with logical insets,
 * and a dot is still a dot once the palette is the user's.
 */
import { compileComponents } from './render.js';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { Component, Signal, flushSync, mount } from '@voltdev/core';
import { compileTemplate } from '@voltdev/core/jit';
import { focusableWithin } from '@voltdev/primitives';
import { FORCED_COLORS_QUERY, primitiveTokens, rulesToCss, wrap, type Rule } from '../src/index.ts';
import { VBadge } from '../src/components/badge.js';
import { VButton } from '../src/components/button.js';
import { badgeStyles } from '../src/sheet/badge.js';
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

/** Change something the page holds, and let the badge catch up. */
function change(action: () => void): void {
  action();
  flushSync();
}

const badges = (host: HTMLElement): HTMLElement[] => [...host.querySelectorAll<HTMLElement>('.volt-badge')];
const badge = (host: HTMLElement): HTMLElement => badges(host)[0]!;
const button = (host: HTMLElement): HTMLElement => host.querySelector('button')!;

/** What a reader is told about the badge, and what is on screen, in one line. */
function said(element: Element): { name: string | null; text: string; hidden: boolean } {
  return {
    name: element.getAttribute('aria-label'),
    text: element.textContent?.trim() ?? '',
    hidden: element.hasAttribute('data-empty') && element.getAttribute('aria-hidden') === 'true',
  };
}

describe('v-badge', () => {
  it('is a badge on the corner of what it wraps, with the sheet’s classes and the caller’s own', () => {
    @Component({
      selector: 'v-page-anatomy',
      imports: [VBadge, VButton],
      render: compileTemplate(
        `<v-badge class="mine" data-test="inbox" title="Inbox" count="3" describes="unread messages">` +
          `<v-button>Inbox</v-button></v-badge>`,
      ),
    })
    class Page {}

    const { host } = show(Page);
    const anchor = host.querySelector<HTMLElement>('.volt-badge-anchor')!;

    // The content first and the badge after it, both in the anchor — which is
    // what puts the badge on the content's corner rather than in line.
    expect(host.firstElementChild).toBe(anchor);
    expect([...anchor.children]).toEqual([button(host), badge(host)]);

    // What the caller wrote lands on the badge, the element carrying the role
    // and the name, and not on the box around it.
    expect([...badge(host).classList].sort()).toEqual(['mine', 'volt-badge']);
    expect(badge(host).dataset['test']).toBe('inbox');
    expect(badge(host).title).toBe('Inbox');
    expect([...anchor.classList]).toEqual(['volt-badge-anchor']);

    // The digits are drawn; the words are what is said.
    expect(badge(host).getAttribute('role')).toBe('img');
    expect(said(badge(host))).toEqual({ name: '3 unread messages', text: '3', hidden: false });
    expect(badge(host).dataset['tone']).toBe('danger');
    expect(badge(host).hasAttribute('data-dot')).toBe(false);
  });

  it('follows a count bound to a number, and goes at zero', () => {
    @Component({
      selector: 'v-page-number',
      imports: [VBadge, VButton],
      render: compileTemplate(
        `<v-badge :count="unread.get()" describes="unread messages"><v-button>Inbox</v-button></v-badge>`,
      ),
    })
    class Page {
      unread = new Signal.State(2);
    }

    const { instance, host } = show(Page);
    expect(said(badge(host))).toEqual({ name: '2 unread messages', text: '2', hidden: false });

    change(() => instance.unread.set(0));
    // Still on the page, so its id and whatever the caller wrote on the tag
    // have somewhere to be, and off the screen and out of what is heard.
    expect(said(badge(host))).toEqual({ name: null, text: '', hidden: true });
    expect(badge(host).hasAttribute('role')).toBe(false);

    change(() => instance.unread.set(5));
    expect(said(badge(host))).toEqual({ name: '5 unread messages', text: '5', hidden: false });
  });

  it('shows zero when told zero is worth showing, however that is written', () => {
    @Component({
      selector: 'v-page-zero',
      imports: [VBadge],
      render: compileTemplate(`
        <div>
          <v-badge :count="0" describes="errors" showZero></v-badge>
          <v-badge :count="0" describes="errors" showZero="true"></v-badge>
          <v-badge :count="0" describes="errors" :showZero="true"></v-badge>
          <v-badge :count="0" describes="errors" showZero="false"></v-badge>
          <v-badge :count="0" describes="errors"></v-badge>
        </div>
      `),
    })
    class Page {}

    const { host } = show(Page);
    // An attribute is a string, and the primitive takes only `true` for on:
    // `showZero="true"` has to be read as the word it is, and so does "false".
    expect(badges(host).map((each) => said(each).text)).toEqual(['0', '0', '0', '', '']);
    expect(said(badges(host)[0]!)).toEqual({ name: '0 errors', text: '0', hidden: false });
    expect(said(badges(host)[3]!).hidden).toBe(true);
  });

  it('reads through a signal of the caller’s own, and writes back into it', () => {
    @Component({
      selector: 'v-page-signal',
      imports: [VBadge, VButton],
      render: compileTemplate(`
        <div>
          <v-badge :ref="inbox" :count="unread" describes="unread messages"><v-button>Inbox</v-button></v-badge>
          <v-badge :count="total" describes="tasks"></v-badge>
        </div>
      `),
    })
    class Page {
      inbox: VBadge | null = null;
      unread = new Signal.State<number | null>(4);
      mine = new Signal.State(1);
      theirs = new Signal.State(2);
      total = new Signal.Computed<number | null>(() => this.mine.get() + this.theirs.get());
    }

    const { instance, host } = show(Page);
    const [inbox, tasks] = badges(host) as [HTMLElement, HTMLElement];

    // The signal itself, not a number read out of it once: the tag's own
    // signal holds it, and the primitive reads through.
    expect(said(inbox).text).toBe('4');
    change(() => instance.unread.set(7));
    expect(said(inbox)).toEqual({ name: '7 unread messages', text: '7', hidden: false });

    // A derived count follows what it is derived from.
    expect(said(tasks).text).toBe('3');
    change(() => instance.theirs.set(10));
    expect(said(tasks)).toEqual({ name: '11 tasks', text: '11', hidden: false });

    // `:ref` reaches the primitive, and a count set there is the page's own.
    expect(instance.inbox?.badge.count()).toBe(7);
    change(() => instance.inbox!.badge.setCount(1));
    expect(instance.unread.get()).toBe(1);
    expect(said(inbox).text).toBe('1');
  });

  it('takes a count written as an attribute, and draws nothing for one that is not a number', () => {
    @Component({
      selector: 'v-page-attribute',
      imports: [VBadge],
      render: compileTemplate(`
        <div>
          <v-badge count="12" describes="drafts"></v-badge>
          <v-badge count="lots" describes="drafts"></v-badge>
        </div>
      `),
    })
    class Page {}

    const { host } = show(Page);
    const [twelve, lots] = badges(host) as [HTMLElement, HTMLElement];
    expect(said(twelve)).toEqual({ name: '12 drafts', text: '12', hidden: false });
    // Not "NaN drafts", which is read out exactly as written.
    expect(said(lots).hidden).toBe(true);
    expect(lots.hasAttribute('data-count')).toBe(false);
  });

  it('writes a count set through `:ref` into its own count when it was handed a number', () => {
    @Component({
      selector: 'v-page-own',
      imports: [VBadge],
      render: compileTemplate(`<v-badge :ref="drafts" count="2" describes="drafts"></v-badge>`),
    })
    class Page {
      drafts: VBadge | null = null;
    }

    const { instance, host } = show(Page);
    change(() => instance.drafts!.badge.setCount(6));
    expect(instance.drafts!.count.get()).toBe(6);
    expect(said(badge(host)).text).toBe('6');
  });

  it('draws nothing for no count, unless it is a dot, when it is a status named by `describes`', () => {
    @Component({
      selector: 'v-page-status',
      imports: [VBadge, VButton],
      render: compileTemplate(`
        <div>
          <v-badge :count="unread.get()" describes="unread messages"><v-button>Inbox</v-button></v-badge>
          <v-badge :dot="online.get()" describes="Online"><span class="avatar">AL</span></v-badge>
        </div>
      `),
    })
    class Page {
      unread = new Signal.State<number | null>(null);
      online = new Signal.State(true);
    }

    const { instance, host } = show(Page);
    const [inbox, presence] = badges(host) as [HTMLElement, HTMLElement];

    // A count that has not arrived is not a status: the primitive would name
    // it "unread messages", and there is nothing on screen to name.
    expect(said(inbox)).toEqual({ name: null, text: '', hidden: true });
    expect(inbox.hasAttribute('role')).toBe(false);

    expect(said(presence)).toEqual({ name: 'Online', text: '', hidden: false });
    expect(presence.getAttribute('role')).toBe('img');
    expect(presence.hasAttribute('data-dot')).toBe(true);
    // A status is something being so, not something being wrong.
    expect(presence.dataset['tone']).toBe('accent');

    change(() => instance.online.set(false));
    expect(said(presence)).toEqual({ name: null, text: '', hidden: true });

    change(() => instance.unread.set(3));
    expect(said(inbox)).toEqual({ name: '3 unread messages', text: '3', hidden: false });
    expect(inbox.dataset['tone']).toBe('danger');
  });

  it('draws a count as a dot without taking the number out of what is heard', () => {
    @Component({
      selector: 'v-page-dot',
      imports: [VBadge, VButton],
      render: compileTemplate(
        `<v-badge :count="unread.get()" dot describes="unread messages"><v-button>Inbox</v-button></v-badge>`,
      ),
    })
    class Page {
      unread = new Signal.State(3);
    }

    const { instance, host } = show(Page);
    expect(badge(host).hasAttribute('data-dot')).toBe(true);
    expect(said(badge(host))).toEqual({ name: '3 unread messages', text: '', hidden: false });
    expect(badge(host).dataset['tone']).toBe('danger');

    // And the dot follows the count it stands for.
    change(() => instance.unread.set(0));
    expect(said(badge(host)).hidden).toBe(true);
  });

  it('caps the count at 99 unless told otherwise', () => {
    @Component({
      selector: 'v-page-cap',
      imports: [VBadge],
      render: compileTemplate(`
        <div>
          <v-badge :count="many.get()" describes="unread messages"></v-badge>
          <v-badge :count="many.get()" max="9" describes="alerts"></v-badge>
          <v-badge :count="many.get()" :max="Infinity" describes="rows"></v-badge>
        </div>
      `),
    })
    class Page {
      many = new Signal.State(150);
    }

    const { instance, host } = show(Page);
    const [capped, nine, open] = badges(host) as [HTMLElement, HTMLElement, HTMLElement];

    // A corner has room for two digits and a plus; the name says what the
    // plus means.
    expect(said(capped)).toEqual({ name: 'More than 99 unread messages', text: '99+', hidden: false });
    expect(capped.hasAttribute('data-overflow')).toBe(true);
    expect(said(nine)).toEqual({ name: 'More than 9 alerts', text: '9+', hidden: false });
    expect(said(open)).toEqual({ name: '150 rows', text: '150', hidden: false });
    expect(open.hasAttribute('data-overflow')).toBe(false);

    change(() => instance.many.set(8));
    expect(badges(host).map((each) => said(each).text)).toEqual(['8', '8', '8']);
    expect(capped.hasAttribute('data-overflow')).toBe(false);
  });

  it('takes the tone it is given, and follows one bound to a signal', () => {
    @Component({
      selector: 'v-page-tone',
      imports: [VBadge],
      render: compileTemplate(`<v-badge count="4" :tone="tone.get()" describes="drafts"></v-badge>`),
    })
    class Page {
      tone = new Signal.State<'neutral' | 'accent' | 'danger' | undefined>('neutral');
    }

    const { instance, host } = show(Page);
    expect(badge(host).dataset['tone']).toBe('neutral');
    change(() => instance.tone.set('accent'));
    expect(badge(host).dataset['tone']).toBe('accent');
    // Unset, a count goes back to the tone a count defaults to.
    change(() => instance.tone.set(undefined));
    expect(badge(host).dataset['tone']).toBe('danger');
  });

  it('says each count in the words it is given, which is how a plural is said properly', () => {
    const labels = {
      count: (n: number, what: string) => (n === 1 ? '1 unread message' : `${n} ${what}`),
      overflow: (max: number) => `Over ${max} unread`,
    };

    @Component({
      selector: 'v-page-labels',
      imports: [VBadge],
      render: compileTemplate(
        `<v-badge :count="unread.get()" :labels="labels" describes="unread messages"></v-badge>`,
      ),
    })
    class Page {
      unread = new Signal.State(1);
      labels = labels;
    }

    const { instance, host } = show(Page);
    expect(said(badge(host)).name).toBe('1 unread message');
    change(() => instance.unread.set(2));
    expect(said(badge(host)).name).toBe('2 unread messages');
    change(() => instance.unread.set(100));
    expect(said(badge(host)).name).toBe('Over 99 unread');
  });

  it('keeps a name given outright through every change of count', () => {
    @Component({
      selector: 'v-page-name',
      imports: [VBadge],
      render: compileTemplate(
        `<v-badge :count="unread.get()" :aria-label="name.get()" describes="unread messages"></v-badge>`,
      ),
    })
    class Page {
      unread = new Signal.State(3);
      name = new Signal.State('New mail');
    }

    const { instance, host } = show(Page);
    expect(said(badge(host)).name).toBe('New mail');

    // The primitive names the badge on every change of count, and a name the
    // caller wrote has to outlast each of them rather than lose to the next.
    change(() => instance.unread.set(4));
    expect(said(badge(host)).name).toBe('New mail');

    // Nothing on screen, so nothing to name; back on screen, the caller's name.
    change(() => instance.unread.set(0));
    expect(said(badge(host)).name).toBeNull();
    change(() => instance.unread.set(1));
    expect(said(badge(host)).name).toBe('New mail');
    expect(badge(host).getAttribute('role')).toBe('img');

    change(() => instance.name.set('Mail waiting'));
    expect(said(badge(host)).name).toBe('Mail waiting');
  });

  it('describes the control it counts for, beside what the caller described it with', () => {
    @Component({
      selector: 'v-page-described',
      imports: [VBadge, VButton],
      render: compileTemplate(`
        <div>
          <v-badge :count="unread.get()" describes="unread messages">
            <v-button aria-describedby="hint">Inbox</v-button>
          </v-badge>
          <p id="hint">Opens your mail</p>
        </div>
      `),
    })
    class Page {
      unread = new Signal.State(2);
    }

    const { instance, host } = show(Page);
    const id = badge(host).id;
    expect(id).not.toBe('');

    // Tab reaches the button and never the badge, so the button is where the
    // count has to be heard — added to the caller's own description.
    expect(button(host).getAttribute('aria-describedby')).toBe(`hint ${id}`);
    // And the badge stays in the reading order, as help text beside a field
    // does, rather than being hidden from a reader moving line by line.
    expect(badge(host).hasAttribute('aria-hidden')).toBe(false);

    // Nothing waiting, nothing described; the caller's own stays.
    change(() => instance.unread.set(0));
    expect(button(host).getAttribute('aria-describedby')).toBe('hint');
    change(() => instance.unread.set(9));
    expect(button(host).getAttribute('aria-describedby')).toBe(`hint ${id}`);
  });

  it('is described by the id it is given, and follows one bound to a signal', () => {
    @Component({
      selector: 'v-page-id',
      imports: [VBadge, VButton],
      render: compileTemplate(
        `<v-badge :id="which.get()" count="3" describes="unread messages"><v-button>Inbox</v-button></v-badge>`,
      ),
    })
    class Page {
      which = new Signal.State('inbox-count');
    }

    const { instance, host } = show(Page);
    expect(badge(host).id).toBe('inbox-count');
    expect(button(host).getAttribute('aria-describedby')).toBe('inbox-count');

    // The reference moves with the id, rather than pointing at one that is gone.
    change(() => instance.which.set('mail-count'));
    expect(badge(host).id).toBe('mail-count');
    expect(button(host).getAttribute('aria-describedby')).toBe('mail-count');
  });

  it('puts a class, an id and a name written on the tag on the badge, and nowhere else', () => {
    @Component({
      selector: 'v-page-written',
      imports: [VBadge, VButton],
      render: compileTemplate(
        `<v-badge class="mine" id="inbox-count" aria-label="New mail" count="3" describes="unread messages">` +
          `<v-button>Inbox</v-button></v-badge>`,
      ),
    })
    class Page {}

    const { host } = show(Page);
    const anchor = host.querySelector<HTMLElement>('.volt-badge-anchor')!;

    // The badge is the element with the role, so it is the one the caller's
    // id and name are for: the anchor carries neither, and the button is
    // described by the id the caller chose rather than a minted one.
    expect(badge(host).id).toBe('inbox-count');
    expect(anchor.id).toBe('');
    expect([...host.querySelectorAll('[id]')]).toEqual([badge(host)]);
    expect(said(badge(host))).toEqual({ name: 'New mail', text: '3', hidden: false });
    expect([...host.querySelectorAll('[aria-label]')]).toEqual([badge(host)]);
    expect([...badge(host).classList].sort()).toEqual(['mine', 'volt-badge']);
    expect(button(host).getAttribute('aria-describedby')).toBe('inbox-count');
  });

  it('gives a control it no longer describes back what it was lent', () => {
    @Component({
      selector: 'v-page-swap',
      imports: [VBadge],
      render: compileTemplate(`
        <v-badge :count="unread.get()" describes="unread messages">
          <button :attr-tabindex="first.get() ? 0 : -1" aria-describedby="hint">Archive</button>
          <button>Inbox</button>
        </v-badge>
      `),
    })
    class Page {
      unread = new Signal.State(2);
      first = new Signal.State(true);
    }

    const { instance, host } = show(Page);
    const [archive, inbox] = [...host.querySelectorAll('button')] as [HTMLElement, HTMLElement];
    const id = badge(host).id;
    expect(archive.getAttribute('aria-describedby')).toBe(`hint ${id}`);
    expect(inbox.hasAttribute('aria-describedby')).toBe(false);

    // Archive leaves the tab order, so Inbox is the first tab stop now. The
    // badge notices at the next count: the id moves, and what the caller
    // wrote on Archive is all that is left on it.
    change(() => {
      instance.first.set(false);
      instance.unread.set(3);
    });
    expect(archive.getAttribute('aria-describedby')).toBe('hint');
    expect(inbox.getAttribute('aria-describedby')).toBe(id);
  });

  it('finds a control that was hidden or absent when it mounted, the moment it takes focus', () => {
    @Component({
      selector: 'v-page-later',
      imports: [VBadge, VButton],
      render: compileTemplate(`
        <div>
          <div :style="closed.get() ? 'display: none' : ''">
            <v-badge count="3" describes="unread messages"><v-button>Inbox</v-button></v-badge>
          </div>
          <v-badge count="5" describes="drafts"><v-button :if="ready.get()">Drafts</v-button></v-badge>
        </div>
      `),
    })
    class Page {
      closed = new Signal.State(true);
      ready = new Signal.State(false);
    }

    const { instance, host } = show(Page);
    const [inboxBadge, draftsBadge] = badges(host) as [HTMLElement, HTMLElement];

    // A panel shut when the badge mounted, and a button not yet rendered: no
    // tab stop to describe either time, and nothing the badge reads changes
    // when the panel opens or the button arrives.
    expect(host.querySelector('[aria-describedby]')).toBeNull();
    change(() => {
      instance.closed.set(false);
      instance.ready.set(true);
    });
    expect(host.querySelector('[aria-describedby]')).toBeNull();

    // Focus is when the description is heard, so focus is when it is looked
    // for again.
    for (const each of host.querySelectorAll<HTMLElement>('button')) {
      each.focus();
      each.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    }
    flushSync();
    const [inbox, drafts] = [...host.querySelectorAll('button')] as [HTMLElement, HTMLElement];
    expect(inbox.getAttribute('aria-describedby')).toBe(inboxBadge.id);
    expect(drafts.getAttribute('aria-describedby')).toBe(draftsBadge.id);

    // Every focus looks again, and a look that finds nothing changed writes
    // nothing: an attribute set to its own value is still a mutation to
    // everything watching the tree.
    const written = vi.spyOn(inbox, 'setAttribute');
    const removed = vi.spyOn(inbox, 'removeAttribute');
    inbox.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    flushSync();
    expect(written).not.toHaveBeenCalled();
    expect(removed).not.toHaveBeenCalled();
    expect(inbox.getAttribute('aria-describedby')).toBe(inboxBadge.id);
  });

  it('describes nothing where there is no control to describe', () => {
    @Component({
      selector: 'v-page-nothing',
      imports: [VBadge],
      render: compileTemplate(`
        <div>
          <v-badge dot describes="Online"><span class="avatar">AL</span></v-badge>
          <v-badge count="3" describes="drafts"></v-badge>
        </div>
      `),
    })
    class Page {}

    const { host } = show(Page);
    // An avatar takes no focus, so a description on it is one no keyboard
    // reaches; the badge beside it in the reading order is how it is heard.
    expect(host.querySelector('[aria-describedby]')).toBeNull();
    for (const each of badges(host)) expect(each.hasAttribute('aria-hidden')).toBe(false);

    // Nothing written inside, so the badge is alone in its anchor and stands in line.
    const standalone = badges(host)[1]!;
    expect([...standalone.parentElement!.children]).toEqual([standalone]);
  });

  it('takes no focus and answers no keys, leaving the tab order to the control', () => {
    @Component({
      selector: 'v-page-keys',
      imports: [VBadge, VButton],
      render: compileTemplate(
        `<v-badge count="3" describes="unread messages"><v-button>Inbox</v-button></v-badge>`,
      ),
    })
    class Page {}

    const { host } = show(Page);
    // A badge is not a control: the primitive gives it no keyboard, and the
    // one tab stop here is the button it counts for.
    expect(badge(host).hasAttribute('tabindex')).toBe(false);
    expect(focusableWithin(host)).toEqual([button(host)]);

    const before = said(badge(host));
    for (const key of ['Enter', ' ', 'Delete', 'Backspace']) {
      badge(host).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    }
    flushSync();
    expect(said(badge(host))).toEqual(before);
  });

  it('says so when it has not been told what it counts', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    @Component({
      selector: 'v-page-unnamed',
      imports: [VBadge],
      render: compileTemplate(`<v-badge count="3"></v-badge>`),
    })
    class Unnamed {}

    show(Unnamed);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toMatch(/<v-badge>[\s\S]*describes=/);
  });

  it('says nothing when the name comes from somewhere', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    @Component({
      selector: 'v-page-named',
      imports: [VBadge],
      render: compileTemplate(`
        <div>
          <v-badge count="3" describes="drafts"></v-badge>
          <v-badge dot aria-label="Online"></v-badge>
          <v-badge count="3" :labels="labels"></v-badge>
        </div>
      `),
    })
    class Named {
      labels = { count: (n: number) => `${n} drafts` };
    }

    show(Named);
    expect(warn).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// The sheet
// ---------------------------------------------------------------------------

/**
 * Every rule and value that would anchor the badge to a physical side. A
 * browser reads these the same in every direction, so any of them here is a
 * badge left on the right-hand corner of a right-to-left page.
 */
const PHYSICAL = [
  'left',
  'right',
  'top',
  'bottom',
  'translate',
  'transform',
  'margin-left',
  'margin-right',
  'padding-left',
  'padding-right',
];

describe('the badge’s sheet', () => {
  const rules: readonly Rule[] = [...badgeStyles.rules, ...badgeStyles.forcedColors];

  it('hangs the badge on its corner with logical insets, so a right-to-left page mirrors it', () => {
    const anchored = rules.filter((rule) => rule.selector.includes(':not(:only-child)'));
    expect(anchored.length).toBeGreaterThan(0);
    for (const rule of anchored) {
      expect(rule.declarations['position'], rule.selector).toBe('absolute');
      expect(rule.declarations['inset-inline-start'], rule.selector).toBeDefined();
      expect(rule.declarations['inset-block-start'], rule.selector).toBeDefined();
    }
    for (const rule of rules) {
      for (const property of Object.keys(rule.declarations)) {
        expect(PHYSICAL, `${rule.selector} { ${property} }`).not.toContain(property);
      }
    }
  });

  /**
   * The badge's rules as the harness writes the package's own: every system
   * colour spelled as the stand-in happy-dom keeps, and the forced block
   * wrapped in its query.
   */
  function badgeCss(): string {
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
      rulesToCss(standIns(badgeStyles.rules)),
      wrap(FORCED_COLORS_QUERY, rulesToCss(standIns(badgeStyles.forcedColors), '  ')),
    ].join('\n\n');
  }

  const plain = styledDocument();
  const forced = styledDocument({ forcedColors: true });
  plain.addConsumerCss(badgeCss());
  forced.addConsumerCss(badgeCss());

  afterAll(async () => {
    await Promise.all([plain.close(), forced.close()]);
  });

  /** A button with a badge on its corner, or a badge on its own. */
  const fixture = (attributes: Record<string, string>, content = true): Fixture => ({
    tag: 'span',
    classes: ['volt-badge-anchor'],
    children: [
      ...(content ? [{ tag: 'button' }] : []),
      { tag: 'span', classes: ['volt-badge'], attributes: { role: 'img', ...attributes } },
    ],
  });

  const style = (dom: typeof plain, attributes: Record<string, string>, content = true) =>
    dom.window.getComputedStyle(dom.mount(fixture(attributes, content)).querySelector('.volt-badge')!);

  it('sits on the corner of content, and in line with none', () => {
    const corner = style(plain, { 'data-tone': 'danger' });
    expect(corner.getPropertyValue('position')).toBe('absolute');
    // Presses there belong to the control it is drawn over.
    expect(corner.getPropertyValue('pointer-events')).toBe('none');

    const inline = style(plain, { 'data-tone': 'danger' }, false);
    expect(inline.getPropertyValue('position')).not.toBe('absolute');
    expect(inline.getPropertyValue('pointer-events')).not.toBe('none');
  });

  it('fills each tone from its own role in the ordinary palette', () => {
    const fill = (tone: string) => style(plain, { 'data-tone': tone }).getPropertyValue('background-color');
    expect(fill('danger')).toBe(primitiveTokens['--volt-palette-danger-500']);
    expect(fill('accent')).toBe(primitiveTokens['--volt-palette-accent-500']);
    expect(fill('neutral')).toBe(primitiveTokens['--volt-palette-neutral-100']);
    // A tone the sheet does not know is drawn as the default, not as nothing.
    expect(fill('purple')).toBe(primitiveTokens['--volt-palette-danger-500']);
  });

  it('keeps every badge, and so every dot, filled once the palette is the user’s', () => {
    // A dot has no digits, so its fill is all of it: a fill left for the
    // palette to choose comes back as the page's own colour, and the dot is
    // gone. Every tone, since a rule naming the tone outranks the plain one.
    for (const tone of ['danger', 'accent', 'neutral']) {
      for (const dot of [{}, { 'data-dot': '' }]) {
        const computed = style(forced, { 'data-tone': tone, ...dot });
        expect(computed.getPropertyValue('background-color'), tone).toBe(standIn('CanvasText'));
        expect(computed.getPropertyValue('color'), tone).toBe(standIn('Canvas'));
        expect(computed.getPropertyValue('border-block-start-color'), tone).toBe(standIn('Canvas'));
      }
    }
  });
});
