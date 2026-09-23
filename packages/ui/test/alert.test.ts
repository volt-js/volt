/**
 * `<v-alert>`, driven the way a page drives it.
 *
 * The region timing, the dismiss stack and where focus lands are the
 * primitive's, and they are tested there. What is worth asserting here is the
 * seam: that the element carrying the role is the one the caller wrote on,
 * that the region stays on the page between messages, that every attribute
 * the sheet's rules select on is written by this markup, and that each prop
 * handed to the primitive does something — a prop asserted nowhere can be
 * deleted with the suite green.
 *
 * Timers are faked throughout, because the words are held back until the
 * region has been in the document long enough to be heard, and "long enough"
 * is a number the test has to be able to stand on.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Component, Signal, flushSync, mount } from '@voltdev/core';
import { compileTemplate } from '@voltdev/core/jit';
import { compileComponents } from './render.js';
import { unlayeredCss } from './harness.ts';
import { VAlert } from '../src/components/alert.js';

compileComponents();

// The sheet, in the document the components are mounted into. Two of the
// promises below are about what the rules do to the markup rather than about
// the markup alone — what `hidden` computes to while the region settles, and
// what a long unbroken word does to the box — and neither can be asked of an
// unstyled tree.
beforeAll(() => {
  const style = document.createElement('style');
  style.textContent = unlayeredCss();
  document.head.append(style);
});

/** What the primitive waits before writing words into a fresh region. */
const ANNOUNCE = 50;

let handles: { unmount(): void }[] = [];

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  for (const handle of handles) handle.unmount();
  handles = [];
  flushSync();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

/** Settle first — a timer nothing has started yet cannot fire — then run. */
function advance(ms: number): void {
  flushSync();
  vi.advanceTimersByTime(ms);
  flushSync();
}

/**
 * Mount, and by default wait out the announce delay, which every test but the
 * one about that delay wants over with.
 */
function show<T>(component: new () => T, settle = true): T {
  const host = document.createElement('div');
  document.body.append(host);
  const handle = mount(component, host);
  handles.push(handle);
  flushSync();
  if (settle) advance(ANNOUNCE);
  return handle.instance as T;
}

const region = (): HTMLElement => document.querySelector<HTMLElement>('.volt-alert')!;
const message = (): HTMLElement | null => document.querySelector<HTMLElement>('.volt-alert-message');
const icon = (): HTMLElement => document.querySelector<HTMLElement>('.volt-alert-icon')!;
const heading = (): Element | null => document.querySelector('.volt-alert-title');
const body = (): Element | null => document.querySelector('.volt-alert-description');
const action = (): HTMLButtonElement | null =>
  document.querySelector<HTMLButtonElement>('.volt-alert-actions button');
const dismiss = (): HTMLButtonElement | null =>
  document.querySelector<HTMLButtonElement>('.volt-alert-message > button');
const elsewhere = (): HTMLElement => document.querySelector<HTMLElement>('.elsewhere')!;

/** Focus, then settle: whether Escape is the alert's follows where focus is. */
function focusOn(element: HTMLElement): void {
  element.focus();
  flushSync();
}

function key(name: string): void {
  const target = document.activeElement ?? document;
  target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }));
  flushSync();
}

@Component({
  selector: 'v-page',
  imports: [VAlert],
  render: compileTemplate(`
    <button class="elsewhere">Save</button>
    <v-alert
      :ref="tag"
      class="mine"
      id="save-failed"
      data-corner="end"
      :severity="tone.get()"
      :title="line.get()"
      :dismissible="removable.get()"
      :dismissLabel="word.get()"
      :actionLabel="offer.get()"
      :onAction="retry"
      :onOpenChange="record"
    >The connection dropped at 40%.</v-alert>
  `),
})
class Page {
  tag: VAlert | null = null;
  tone = new Signal.State<'info' | 'success' | 'warning' | 'danger'>('info');
  removable = new Signal.State(true);
  line = new Signal.State<string | undefined>('Could not save');
  word = new Signal.State<string | undefined>(undefined);
  offer = new Signal.State<string | undefined>(undefined);
  retries = 0;
  opened: boolean[] = [];

  retry = (): void => {
    this.retries++;
  };

  record = (open: boolean): void => {
    this.opened.push(open);
  };
}

describe('the region', () => {
  it('is the live region itself, carrying what the caller wrote on the tag', () => {
    show(Page);
    const el = region();

    // `:host` is on the element with the role, so an id written on the tag
    // addresses the region — what a stylesheet of the caller's reaches for.
    expect(el.id).toBe('save-failed');
    expect(document.getElementById('save-failed')).toBe(el);
    expect([...el.classList].sort()).toEqual(['mine', 'volt-alert']);
    expect(el.dataset['corner']).toBe('end');

    // Polite for everything but danger, and the role and `aria-live` say the
    // same thing because some assistive technology honours only the second.
    expect(el.getAttribute('role')).toBe('status');
    expect(el.getAttribute('aria-live')).toBe('polite');
    // The message is read whole on every change; half a sentence is worse
    // than a repeat.
    expect(el.getAttribute('aria-atomic')).toBe('true');
    expect(el.getAttribute('data-priority')).toBe('polite');
    expect(el.getAttribute('data-state')).toBe('open');
    // Nothing names the region: a name on a live region is announced instead
    // of its contents in some screen readers.
    expect(el.hasAttribute('aria-label')).toBe(false);
  });

  it('is where a name written on the tag lands, for want of anywhere better', () => {
    @Component({
      selector: 'v-page-named',
      imports: [VAlert],
      render: compileTemplate(
        `<v-alert aria-label="Save status" aria-describedby="hint" title="Could not save"></v-alert>`,
      ),
    })
    class Named {}

    show(Named);
    // The other half of the rule above, and the reason the documentation says
    // not to write one: `:host` is on the element carrying the role, which
    // here is the live region, so a name reaches the region rather than a
    // wrapper — and a named live region is announced instead of its contents
    // in some screen readers. What matters for the component is that the two
    // land on the element with `aria-live` on it, because that is the element
    // a caller can see and can style.
    expect(region().getAttribute('aria-label')).toBe('Save status');
    expect(region().getAttribute('aria-describedby')).toBe('hint');
    // And the component's own ARIA still wins where the two meet: the role is
    // not a caller's to take.
    expect(region().getAttribute('role')).toBe('status');
  });

  it('stays on the page with nothing in it, so the next message is a change inside it', () => {
    const page = show(Page);
    page.tag!.alert.close();
    flushSync();

    // The whole reason there are two elements: the box goes, the region does
    // not. A region that arrived with its words announces nothing.
    expect(message()).toBe(null);
    expect(region().isConnected).toBe(true);
    expect(region().getAttribute('data-state')).toBe('closed');
    expect(region().getAttribute('aria-live')).toBe('polite');
  });

  it('keeps the unsettled message out of the page, not merely marked `hidden`', () => {
    show(Page, false);

    // `hidden` is a `display: none` in the user agent's stylesheet, and every
    // author rule outranks that whatever its specificity — so the `display:
    // flex` the box is laid out with puts it back on screen and back in the
    // accessibility tree. The region and its sentence would then arrive in one
    // mutation, which is the single thing this component exists to prevent,
    // and only the first message of an alert's life would be lost.
    expect(getComputedStyle(message()!).display).toBe('none');

    advance(ANNOUNCE);
    expect(getComputedStyle(message()!).display).toBe('flex');
  });

  it('holds the words back until it has settled, and pays that wait once', () => {
    const page = show(Page, false);

    // Present, so the box is in the DOM and its animation is armed — and
    // hidden, from the screen and from the accessibility tree alike, until
    // writing into the region would actually be heard.
    expect(message()).not.toBe(null);
    expect(message()!.hidden).toBe(true);

    advance(ANNOUNCE);
    expect(message()!.hidden).toBe(false);

    // The region was never removed, so the second message is immediate.
    page.tag!.alert.close();
    flushSync();
    page.tag!.alert.open();
    flushSync();
    expect(message()!.hidden).toBe(false);
  });
});

describe('severity', () => {
  it('writes what the sheet draws it by, and draws a mark of its own for it', () => {
    const page = show(Page);

    // Shape as well as hue: four colours down an edge come out of a forced
    // palette as one, and a glyph comes out of it as itself.
    const marks: Record<string, string> = {
      info: 'i',
      success: '✓',
      warning: '!',
      danger: '✕',
    };
    for (const [severity, glyph] of Object.entries(marks)) {
      page.tone.set(severity as 'info');
      flushSync();
      expect(region().getAttribute('data-severity')).toBe(severity);
      expect(icon().textContent).toBe(glyph);
    }

    // The mark is decoration; the words carry the message, and a glyph read
    // out in the middle of them is noise.
    expect(icon().getAttribute('aria-hidden')).toBe('true');
  });

  it('changes the mark without building a second region', () => {
    const page = show(Page);
    const first = region();
    const instance = page.tag;

    // `severity` is read once more than the template reads it: the priority
    // the primitive is built with comes from it, in a field initializer. If
    // that read were a dependency of whatever renders the tag, moving the
    // signal would rebuild the component — a fresh region, a fresh announce
    // delay, and a message written into a region that arrived holding it,
    // which announces nothing. The one thing severity may move is the mark.
    page.tone.set('danger');
    flushSync();
    expect(region()).toBe(first);
    expect(page.tag).toBe(instance);
    expect(message()!.hidden).toBe(false);
  });

  it('interrupts for danger and waits for a gap for everything else', () => {
    @Component({
      selector: 'v-page-danger',
      imports: [VAlert],
      render: compileTemplate(`<v-alert severity="danger" title="Could not save"></v-alert>`),
    })
    class Failure {}

    show(Failure);
    expect(region().getAttribute('role')).toBe('alert');
    expect(region().getAttribute('aria-live')).toBe('assertive');
    expect(region().getAttribute('data-priority')).toBe('assertive');
  });

  it('takes the priority the page asked for over the one severity implies', () => {
    @Component({
      selector: 'v-page-quiet',
      imports: [VAlert],
      render: compileTemplate(
        `<v-alert severity="danger" priority="polite" title="Could not save"></v-alert>`,
      ),
    })
    class Quiet {}

    show(Quiet);
    // An assertive region cuts a sentence off mid-word, so a page that knows
    // its danger can wait has to be able to say so.
    expect(region().getAttribute('role')).toBe('status');
    expect(region().getAttribute('aria-live')).toBe('polite');
  });
});

describe('the words', () => {
  it('draws the heading only where there is one, and follows it', () => {
    const page = show(Page);
    expect(heading()!.textContent).toBe('Could not save');

    page.line.set('Still could not save');
    flushSync();
    expect(heading()!.textContent).toBe('Still could not save');

    // Without a heading the body is the whole message, and an empty bold line
    // over it is a heading that says nothing.
    page.line.set(undefined);
    flushSync();
    expect(heading()).toBe(null);
    expect(body()!.textContent!.trim()).toBe('The connection dropped at 40%.');
  });

  it('falls back to the info mark for a severity nobody defined', () => {
    @Component({
      selector: 'v-page-typo',
      imports: [VAlert],
      render: compileTemplate(`<v-alert severity="urgnet" title="Could not save"></v-alert>`),
    })
    class Typo {}

    show(Typo);
    // A typo on the tag is an alert that looks like `info` rather than one
    // with a hole where its mark should be — which is where the sheet lands
    // too, since no severity rule matches what was written.
    expect(icon().textContent).toBe('i');
    expect(region().getAttribute('data-severity')).toBe('urgnet');
  });

  it('wraps the words in the box the sheet gives room to shrink', () => {
    show(Page);
    const content = document.querySelector('.volt-alert-content')!;

    // Not decoration: this is the flex item the sheet sets `min-inline-size:
    // 0` on, and without it one long unbroken word pushes the dismiss off the
    // end of the box. So the heading, the body and the actions all have to be
    // inside it, and the mark and the dismiss outside.
    expect(content.contains(heading()!)).toBe(true);
    expect(content.contains(body()!)).toBe(true);
    expect(content.contains(icon())).toBe(false);
    expect(content.contains(dismiss()!)).toBe(false);
    expect(getComputedStyle(content).minInlineSize).toBe('0');
  });

  it('takes a mark of the page’s own through the icon slot', () => {
    @Component({
      selector: 'v-page-marked',
      imports: [VAlert],
      render: compileTemplate(`
        <v-alert severity="warning" title="Almost full">
          <template :slot-icon><b class="ours">▲</b></template>
          Storage is at 92%.
        </v-alert>
      `),
    })
    class Marked {}

    show(Marked);
    expect(icon().querySelector('.ours')).not.toBe(null);
    expect(icon().textContent).toBe('▲');
    // The chrome stays the component's: the mark is still hidden from the
    // announcement, and the body still lands where the sheet draws it.
    expect(icon().getAttribute('aria-hidden')).toBe('true');
    expect(body()!.textContent!.trim()).toBe('Storage is at 92%.');
  });
});

describe('the buttons', () => {
  it('draws the action only where the label is not blank', () => {
    const page = show(Page);
    expect(action()).toBe(null);

    page.offer.set('Retry');
    flushSync();
    expect(action()!.textContent).toBe('Retry');
    // The same chrome as anything else the sheet puts in a box of its own.
    expect(action()!.className).toBe('volt-button');
    expect(action()!.dataset['variant']).toBe('ghost');
    expect(action()!.dataset['size']).toBe('sm');
    expect(action()!.type).toBe('button');

    // An unnamed button inside a live region is one a screen reader reaches
    // in the middle of the announcement and can say nothing about.
    page.offer.set('  ');
    flushSync();
    expect(action()).toBe(null);
  });

  it('runs the action and leaves the alert where it is', () => {
    const page = show(Page);
    page.offer.set('Retry');
    flushSync();

    action()!.click();
    flushSync();
    expect(page.retries).toBe(1);
    // The opposite of a toast, on purpose: `Retry` does not make the alert
    // untrue, and the page that knows whether it worked is the page that
    // closes it.
    expect(message()).not.toBe(null);
    expect(page.tag!.alert.isOpen()).toBe(true);
  });

  it('dismisses, named by the primitive, and follows a name bound to a signal', () => {
    const page = show(Page);
    const button = dismiss()!;

    // The glyph is decoration and has no accessible name of its own.
    expect(button.getAttribute('aria-label')).toBe('Dismiss');
    expect(button.querySelector('[aria-hidden="true"]')!.textContent).toBe('×');
    expect(button.type).toBe('button');
    // The same chrome the action wears, so the two sit at one size.
    expect(button.className).toBe('volt-button');
    expect(button.dataset['variant']).toBe('ghost');
    expect(button.dataset['size']).toBe('sm');

    page.word.set('Close');
    flushSync();
    expect(dismiss()!.getAttribute('aria-label')).toBe('Close');

    // Blank is not a name. The glyph inside is hidden from the reader, so an
    // empty label leaves a control with no accessible name at all, in the
    // middle of a live region — which is the reason a blank `actionLabel`
    // draws no button, and the same answer is owed here.
    page.word.set('   ');
    flushSync();
    expect(dismiss()!.getAttribute('aria-label')).toBe('Dismiss');

    dismiss()!.click();
    flushSync();
    expect(message()).toBe(null);
    expect(page.tag!.alert.isOpen()).toBe(false);
  });

  it('follows a `dismissible` bound to a signal, both ways', () => {
    const page = show(Page);
    expect(dismiss()).not.toBe(null);

    // A plain prop would have been read once and never spoken to again, which
    // is a page that can offer a way out and never take it back.
    page.removable.set(false);
    flushSync();
    expect(dismiss()).toBe(null);
    // And the message is still up: the control went, not the alert.
    expect(message()).not.toBe(null);

    page.removable.set(true);
    flushSync();
    expect(dismiss()!.getAttribute('aria-label')).toBe('Dismiss');
  });

  it('draws no dismiss where the page did not ask for one', () => {
    @Component({
      selector: 'v-page-permanent',
      imports: [VAlert],
      render: compileTemplate(`<v-alert title="Read-only mode"></v-alert>`),
    })
    class Permanent {}

    show(Permanent);
    // An alert the page controls should not grow a way out by accident.
    expect(dismiss()).toBe(null);
    expect(message()).not.toBe(null);
  });

  it('puts focus back where it came from rather than on the body', () => {
    show(Page);
    focusOn(elsewhere());
    focusOn(dismiss()!);

    dismiss()!.click();
    flushSync();

    // The focused node is removed by the press. Without the primitive being
    // given the region, focus falls to <body> and a keyboard user is dropped
    // at the top of the document.
    expect(message()).toBe(null);
    expect(document.activeElement).toBe(elsewhere());
  });
});

describe('the keyboard the primitive provides', () => {
  it('closes on Escape while focus is inside it', () => {
    show(Page);
    focusOn(dismiss()!);

    key('Escape');
    expect(message()).toBe(null);
  });

  it('leaves Escape alone while focus is anywhere else', () => {
    show(Page);
    focusOn(elsewhere());

    // An alert is not a layer. One that swallowed the page's Escape would
    // take it from the dialog or the menu it sits in.
    key('Escape');
    expect(message()).not.toBe(null);
  });

  it('keeps the key from closing it when the page said not to', () => {
    @Component({
      selector: 'v-page-sticky',
      imports: [VAlert],
      render: compileTemplate(`
        <v-alert title="Session expiring" :dismissible="true" :closeOnEscape="false"></v-alert>
      `),
    })
    class Sticky {}

    show(Sticky);
    focusOn(dismiss()!);

    key('Escape');
    expect(message()).not.toBe(null);
    // And the button still works, so nothing was turned off but the key.
    dismiss()!.click();
    flushSync();
    expect(message()).toBe(null);
  });
});

describe('whether it is up', () => {
  it('starts up, because a tag in the markup is there because the page put it there', () => {
    const page = show(Page);
    expect(message()).not.toBe(null);
    expect(page.tag!.alert.isOpen()).toBe(true);
  });

  it('starts down when the page says so, and opens on the primitive `:ref` reaches', () => {
    @Component({
      selector: 'v-page-later',
      imports: [VAlert],
      render: compileTemplate(
        `<v-alert :ref="tag" :defaultOpen="false" title="Could not save"></v-alert>`,
      ),
    })
    class Later {
      tag: VAlert | null = null;
    }

    const page = show(Later);
    expect(message()).toBe(null);

    // `:ref` on the tag is the primitive itself, so everything the component
    // did not think to offer is still reachable.
    page.tag!.alert.open();
    flushSync();
    expect(message()).not.toBe(null);
    expect(message()!.getAttribute('data-state')).toBe('open');
  });

  it('takes a signal of the page’s own, and writes back to it', () => {
    @Component({
      selector: 'v-page-controlled',
      imports: [VAlert],
      render: compileTemplate(`
        <v-alert :open="failed" severity="danger" :dismissible="true" title="Could not save">
          Check your connection.
        </v-alert>
      `),
    })
    class Controlled {
      failed = new Signal.State(false);
    }

    const page = show(Controlled);
    expect(message()).toBe(null);

    page.failed.set(true);
    flushSync();
    // No second wait: the region has been on the page since the tag was.
    expect(message()!.hidden).toBe(false);

    dismiss()!.click();
    flushSync();
    expect(page.failed.get()).toBe(false);
  });

  it('closes through the primitive without dropping focus on the body', () => {
    @Component({
      selector: 'v-page-retry',
      imports: [VAlert],
      render: compileTemplate(`
        <button class="elsewhere">Save</button>
        <v-alert :ref="tag" :open="failed" severity="danger" title="Could not save"
                 actionLabel="Retry" :onAction="retry">Check your connection.</v-alert>
      `),
    })
    class Retrying {
      tag: VAlert | null = null;
      failed = new Signal.State(true);
      retry = (): void => {
        // What a page does once it knows the statement no longer holds. It
        // goes through the primitive rather than through `failed` directly,
        // because the button being pressed is inside the box that is about to
        // be removed: `close()` moves focus out first, and a write straight to
        // the signal cannot, which leaves a keyboard user at the top of the
        // document. The signal is still written — it is the alert's state.
        this.tag!.alert.close();
      };
    }

    const page = show(Retrying);
    focusOn(elsewhere());
    focusOn(action()!);

    action()!.click();
    flushSync();
    expect(message()).toBe(null);
    expect(page.failed.get()).toBe(false);
    expect(document.activeElement).toBe(elsewhere());
  });

  it('tells the page each time it opens and closes', () => {
    const page = show(Page);
    expect(page.opened).toEqual([]);

    page.tag!.alert.close();
    page.tag!.alert.open();
    flushSync();
    expect(page.opened).toEqual([false, true]);

    dismiss()!.click();
    flushSync();
    expect(page.opened).toEqual([false, true, false]);
  });
});
