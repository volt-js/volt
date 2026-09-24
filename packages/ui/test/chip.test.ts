/**
 * `<v-chip>`, driven the way a page drives it.
 *
 * Where focus goes and which keys remove a chip are `createChip`'s, and are
 * tested where they live. What is tested here is the shell: what a caller
 * writes on the tag reaching the chip, the attributes the sheet's rules select
 * on, the button's name following the words it is named after, every prop the
 * tag forwards doing something, the chip asking rather than removing itself,
 * and nothing about the primitive out of reach.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Component, Signal, flushSync, mount } from '@voltdev/core';
import { compileTemplate } from '@voltdev/core/jit';
import { renderToStaticMarkup } from '@voltdev/core/server';
import { compileComponents } from './render.js';
import { VChip } from '../src/components/chip.js';
import template from '../src/components/chip.html?raw';

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
function press(target: Element, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  flushSync();
  return event;
}

function click(target: Element): void {
  (target as HTMLElement).click();
  flushSync();
}

/** Let a mutation observer hear what the last flush wrote, and settle what it set. */
async function observed(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  flushSync();
}

const chips = (host: HTMLElement): HTMLElement[] => [...host.querySelectorAll<HTMLElement>('.volt-chip')];
const chip = (host: HTMLElement): HTMLElement => host.querySelector('.volt-chip')!;
const named = (host: HTMLElement, text: string): HTMLElement =>
  chips(host).find((each) => each.textContent?.includes(text))!;
const button = (element: Element): HTMLButtonElement | null =>
  element.querySelector<HTMLButtonElement>('.volt-chip-remove');
const words = (element: Element): HTMLElement => element.querySelector('.volt-chip-label')!;

describe('v-chip', () => {
  it('is a tab stop holding its words, with the sheet’s classes and the caller’s own', () => {
    @Component({
      selector: 'v-page-anatomy',
      imports: [VChip],
      render: compileTemplate(`
        <v-chip class="mine" id="tag-ada" role="listitem" aria-label="Ada, reviewer" data-test="chip"
                aria-describedby="hint" removable>Ada</v-chip>
      `),
    })
    class Page {}

    const { host } = show(Page);
    const tag = chip(host);

    // The chip is what the tag renders — no wrapper between the caller and
    // the element that takes focus — and everything written on the tag is on
    // it, joined to the sheet's class rather than replacing it.
    expect(host.firstElementChild).toBe(tag);
    expect([...tag.classList].sort()).toEqual(['mine', 'volt-chip']);
    expect(tag.id).toBe('tag-ada');
    expect(tag.dataset['test']).toBe('chip');
    expect(tag.getAttribute('aria-describedby')).toBe('hint');
    // The chip has no role of its own, so the one a caller gives it — a set
    // read as a list — and the name they give it are on the element that
    // takes focus, not on anything around it.
    expect(tag.getAttribute('role')).toBe('listitem');
    expect(tag.getAttribute('aria-label')).toBe('Ada, reviewer');

    // The primitive's: the tab stop, and the mark its siblings are found by.
    expect(tag.getAttribute('tabindex')).toBe('0');
    expect(tag.hasAttribute('data-volt-item')).toBe(true);
    expect(tag.dataset['label']).toBe('Ada');
    // The component's, which the sheet draws.
    expect(tag.dataset['tone']).toBe('neutral');
    expect(tag.dataset['size']).toBe('md');

    // The words, and after them the button, which is never a tab stop and is
    // named after the chip it removes.
    expect(words(tag).textContent?.trim()).toBe('Ada');
    const remove = button(tag)!;
    expect(tag.lastElementChild).toBe(remove);
    expect(remove.type).toBe('button');
    expect(remove.getAttribute('tabindex')).toBe('-1');
    expect(remove.getAttribute('aria-label')).toBe('Remove Ada');
  });

  it('draws no button unless it is removable, and gives the keys nothing to do', () => {
    @Component({
      selector: 'v-page-fixed',
      imports: [VChip],
      render: compileTemplate(`<v-chip :onRemove="drop">Draft</v-chip>`),
    })
    class Page {
      dropped = 0;
      drop = (): void => {
        this.dropped += 1;
      };
    }

    const { instance, host } = show(Page);
    const tag = chip(host);
    expect(button(tag)).toBeNull();

    // Neither key is taken, so neither is kept from whatever else answers it.
    expect(press(tag, 'Delete').defaultPrevented).toBe(false);
    expect(press(tag, 'Backspace').defaultPrevented).toBe(false);
    expect(instance.dropped).toBe(0);

    // No tab stop either: a stop with nothing to do is one more press on the
    // way to something that does.
    expect(tag.getAttribute('tabindex')).toBe('-1');
  });

  it('takes focus when the removable chip beside it goes, though it is no tab stop', () => {
    @Component({
      selector: 'v-page-mixed',
      imports: [VChip],
      render: compileTemplate(`
        <div>
          <v-chip :for="tag in tags.get()" :key="tag" removable :onRemove="() => drop(tag)">{ tag }</v-chip>
          <v-chip>Locked</v-chip>
        </div>
      `),
    })
    class Page {
      tags = new Signal.State(['Ada']);
      drop(tag: string): void {
        this.tags.set(this.tags.get().filter((each) => each !== tag));
      }
    }

    const { host } = show(Page);
    const locked = named(host, 'Locked');
    expect(named(host, 'Ada').getAttribute('tabindex')).toBe('0');
    expect(locked.getAttribute('tabindex')).toBe('-1');

    // The fixed chip is the only neighbour. Unfocusable, the primitive's
    // `focus()` on it would do nothing, and focus would go with the chip it
    // was on — to `<body>`.
    const ada = named(host, 'Ada');
    ada.focus();
    press(ada, 'Delete');
    expect(ada.isConnected).toBe(false);
    expect(document.activeElement).toBe(locked);
  });

  it('asks to be removed on Delete, Backspace and its button, with focus moved on first', () => {
    @Component({
      selector: 'v-page-set',
      imports: [VChip],
      render: compileTemplate(`
        <div class="tags">
          <v-chip :for="tag in tags.get()" :key="tag" removable :onRemove="() => drop(tag)">{ tag }</v-chip>
        </div>
      `),
    })
    class Page {
      tags = new Signal.State(['Ada', 'Grace', 'Linus', 'Margaret']);
      /** Where focus was when each removal was asked for. */
      focusedWhenAsked: string[] = [];
      drop(tag: string): void {
        const focused = document.activeElement;
        const label = focused?.querySelector(':scope > .volt-chip-label');
        this.focusedWhenAsked.push(label ? label.textContent!.trim() : focused?.className ?? '');
        this.tags.set(this.tags.get().filter((each) => each !== tag));
      }
    }

    const { instance, host } = show(Page);
    const container = host.querySelector<HTMLElement>('.tags')!;
    const texts = (): string[] => chips(host).map((each) => words(each).textContent!.trim());

    // Delete, in the middle: the chip after it takes focus, which is where
    // the row closes up to.
    const grace = named(host, 'Grace');
    grace.focus();
    const deleted = press(grace, 'Delete');
    expect(deleted.defaultPrevented).toBe(true);
    expect(texts()).toEqual(['Ada', 'Linus', 'Margaret']);
    expect(document.activeElement).toBe(named(host, 'Linus'));

    // Backspace, at the end: there is nothing after it, so the one before.
    const margaret = named(host, 'Margaret');
    margaret.focus();
    expect(press(margaret, 'Backspace').defaultPrevented).toBe(true);
    expect(texts()).toEqual(['Ada', 'Linus']);
    expect(document.activeElement).toBe(named(host, 'Linus'));

    // The button, by pointer.
    click(button(named(host, 'Ada'))!);
    expect(texts()).toEqual(['Linus']);
    expect(document.activeElement).toBe(named(host, 'Linus'));

    // The last one: nothing is left to hold focus but the element that held
    // the chips, which is made focusable without joining the tab order.
    click(button(named(host, 'Linus'))!);
    expect(texts()).toEqual([]);
    expect(document.activeElement).toBe(container);
    expect(container.getAttribute('tabindex')).toBe('-1');

    // Each time, focus had already moved when the page was asked — the chip
    // was still there to be measured from, and a page that wants focus
    // elsewhere can put it there and win.
    expect(instance.focusedWhenAsked).toEqual(['Linus', 'Linus', 'Linus', 'tags']);
  });

  it('leaves a key that is a shortcut, and one typed into a field inside it, alone', () => {
    @Component({
      selector: 'v-page-keys',
      imports: [VChip],
      render: compileTemplate(`
        <v-chip removable :onRemove="drop">Ada <input aria-label="Rename"></v-chip>
      `),
    })
    class Page {
      dropped = 0;
      drop = (): void => {
        this.dropped += 1;
      };
    }

    const { instance, host } = show(Page);
    const tag = chip(host);

    expect(press(tag, 'Backspace', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(press(tag, 'Delete', { metaKey: true }).defaultPrevented).toBe(false);
    expect(press(tag.querySelector('input')!, 'Backspace').defaultPrevented).toBe(false);
    expect(instance.dropped).toBe(0);

    // And an unmodified key on the chip itself is still the chip's.
    expect(press(tag, 'Delete').defaultPrevented).toBe(true);
    expect(instance.dropped).toBe(1);
  });

  it('stays when the page does not remove it, since the chip only asks', () => {
    @Component({
      selector: 'v-page-refuse',
      imports: [VChip],
      render: compileTemplate(`
        <div>
          <v-chip removable :onRemove="refuse">Ada</v-chip>
          <v-chip removable>Grace</v-chip>
        </div>
      `),
    })
    class Page {
      asked = 0;
      refuse = (): void => {
        this.asked += 1;
      };
    }

    const { instance, host } = show(Page);

    const ada = named(host, 'Ada');
    ada.focus();
    press(ada, 'Delete');
    click(button(ada)!);
    expect(instance.asked).toBe(2);
    expect(ada.isConnected).toBe(true);
    expect(chips(host)).toHaveLength(2);

    // No callback at all is the same answer, not an error.
    const grace = named(host, 'Grace');
    expect(() => press(grace, 'Delete')).not.toThrow();
    expect(grace.isConnected).toBe(true);
  });

  it('names its button after its words, and follows them when they change in place', async () => {
    @Component({
      selector: 'v-page-words',
      imports: [VChip],
      render: compileTemplate(`<v-chip removable>{ name.get() }</v-chip>`),
    })
    class Page {
      name = new Signal.State('Ada');
    }

    const { instance, host } = show(Page);
    const tag = chip(host);
    expect(button(tag)!.getAttribute('aria-label')).toBe('Remove Ada');

    // A text node rewritten under a chip that stays: nothing a signal says,
    // so this is the case a name read once would have kept wrong.
    instance.name.set('Ada Lovelace');
    flushSync();
    await observed();
    expect(button(tag)!.getAttribute('aria-label')).toBe('Remove Ada Lovelace');
    expect(tag.dataset['label']).toBe('Ada Lovelace');
  });

  it('names its button from `label` when the words are not a name, and follows the label', async () => {
    @Component({
      selector: 'v-page-label',
      imports: [VChip],
      render: compileTemplate(`
        <v-chip removable :label="who.get()"><img alt="" src="data:,"><b>3</b> open</v-chip>
      `),
    })
    class Page {
      who = new Signal.State<string | undefined>('Ada’s reviews');
    }

    const { instance, host } = show(Page);
    const tag = chip(host);
    const name = (): string | null => button(tag)!.getAttribute('aria-label');
    expect(name()).toBe('Remove Ada’s reviews');

    instance.who.set('Grace’s reviews');
    flushSync();
    expect(name()).toBe('Remove Grace’s reviews');

    // Unset, the words stand in, markup and all.
    instance.who.set(undefined);
    flushSync();
    await observed();
    expect(name()).toBe('Remove 3 open');
  });

  it('draws the tone and the size it is given, and follows both', () => {
    @Component({
      selector: 'v-page-look',
      imports: [VChip],
      render: compileTemplate(`<v-chip :tone="tone.get()" :size="size.get()">Paid</v-chip>`),
    })
    class Page {
      tone = new Signal.State<'neutral' | 'accent' | 'success' | 'warning' | 'danger'>('success');
      size = new Signal.State<'sm' | 'md'>('sm');
    }

    const { instance, host } = show(Page);
    const tag = chip(host);
    expect(tag.dataset['tone']).toBe('success');
    expect(tag.dataset['size']).toBe('sm');

    for (const tone of ['accent', 'warning', 'danger', 'neutral'] as const) {
      instance.tone.set(tone);
      flushSync();
      expect(tag.dataset['tone']).toBe(tone);
    }

    instance.size.set('md');
    flushSync();
    expect(tag.dataset['size']).toBe('md');
  });

  it('hears the callback the page bound last', () => {
    @Component({
      selector: 'v-page-callback',
      imports: [VChip],
      render: compileTemplate(`<v-chip removable :onRemove="handler.get()">Ada</v-chip>`),
    })
    class Page {
      heard: string[] = [];
      handler = new Signal.State<() => void>(() => this.heard.push('first'));
    }

    const { instance, host } = show(Page);
    press(chip(host), 'Delete');

    instance.handler.set(() => instance.heard.push('second'));
    flushSync();
    press(chip(host), 'Delete');

    expect(instance.heard).toEqual(['first', 'second']);
  });

  it('is removable or not as it was built, with the button and the keys agreeing', () => {
    @Component({
      selector: 'v-page-once',
      imports: [VChip],
      render: compileTemplate(`<v-chip :removable="editable.get()" :onRemove="drop">Ada</v-chip>`),
    })
    class Page {
      editable = new Signal.State(true);
      dropped = 0;
      drop = (): void => {
        this.dropped += 1;
      };
    }

    const { instance, host } = show(Page);
    expect(button(chip(host))).not.toBeNull();

    // `removable` is read once, as the primitive is: a later write changes
    // neither the button nor what the keys do, so the two never disagree.
    instance.editable.set(false);
    flushSync();
    expect(button(chip(host))).not.toBeNull();
    press(chip(host), 'Delete');
    expect(instance.dropped).toBe(1);
  });

  it('reads `removable="false"` as the word it is, since an attribute arrives as a string', () => {
    @Component({
      selector: 'v-page-attribute',
      imports: [VChip],
      render: compileTemplate(`
        <div>
          <v-chip removable="false" :onRemove="drop">Ada</v-chip>
          <v-chip removable="true" :onRemove="drop">Grace</v-chip>
          <v-chip removable="" :onRemove="drop">Linus</v-chip>
        </div>
      `),
    })
    class Page {
      dropped = 0;
      drop = (): void => {
        this.dropped += 1;
      };
    }

    const { instance, host } = show(Page);

    // Written as an attribute the value is a string, and every string is
    // truthy — so a chip told `removable="false"` was drawing its button and
    // answering Delete, which is the one thing the caller had said not to do.
    const ada = named(host, 'Ada');
    expect(button(ada)).toBeNull();
    expect(ada.getAttribute('tabindex')).toBe('-1');
    expect(press(ada, 'Delete').defaultPrevented).toBe(false);
    expect(instance.dropped).toBe(0);

    // Every other spelling is on: the word `true`, and the bare attribute an
    // HTML parser hands over as an empty string.
    for (const name of ['Grace', 'Linus']) {
      const tag = named(host, name);
      expect(button(tag), name).not.toBeNull();
      expect(tag.getAttribute('tabindex'), name).toBe('0');
      expect(button(tag)!.getAttribute('aria-label'), name).toBe(`Remove ${name}`);
    }
  });

  it('stops listening to words it no longer names the button after, and when it is taken down', async () => {
    @Component({
      selector: 'v-page-listen',
      imports: [VChip],
      render: compileTemplate(`<v-chip removable :label="who.get()">Ada</v-chip>`),
    })
    class Page {
      who = new Signal.State<string | undefined>(undefined);
    }

    // The runtime keeps an observer of its own in development, drained around
    // every effect run, so only the observers that watched the chip's words
    // are counted: those are the chip's, and the ones that have to be let go.
    const observe = vi.spyOn(MutationObserver.prototype, 'observe');
    const disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect');
    try {
      const { instance, host } = show(Page);
      const tag = chip(host);
      const own = (): MutationObserver[] =>
        observe.mock.contexts.filter((_, index) => observe.mock.calls[index]![0] === words(tag));
      const letGo = (): number => disconnect.mock.contexts.filter((each) => own().includes(each)).length;

      expect(own()).toHaveLength(1);
      expect(letGo()).toBe(0);

      // `label` names the button now, so the words are nobody's business: an
      // observer left on them would go on reading text into a name nothing
      // shows, on every keystroke into an editable chip.
      instance.who.set('Ada Lovelace');
      flushSync();
      expect(letGo()).toBe(1);
      expect(own()).toHaveLength(1);

      // Back to the words, and watched again, by a fresh observer.
      instance.who.set(undefined);
      flushSync();
      expect(own()).toHaveLength(2);
      expect(new Set(own()).size).toBe(2);
      expect(button(tag)!.getAttribute('aria-label')).toBe('Remove Ada');

      // Taken down, the observer goes with it, rather than holding the chip's
      // subtree for as long as the page runs.
      unmount!();
      unmount = null;
      expect(letGo()).toBe(2);
    } finally {
      observe.mockRestore();
      disconnect.mockRestore();
    }
  });

  it('hands the primitive itself to whoever needs more than this offers', () => {
    @Component({
      selector: 'v-page-ref',
      imports: [VChip],
      render: compileTemplate(`
        <div>
          <v-chip :ref="first" removable :onRemove="drop">Ada</v-chip>
          <v-chip>Grace</v-chip>
        </div>
      `),
    })
    class Page {
      first: VChip | null = null;
      dropped = 0;
      drop = (): void => {
        this.dropped += 1;
      };
    }

    const { instance, host } = show(Page);
    const primitive = instance.first!.chip;

    expect(instance.first!.element.get()).toBe(named(host, 'Ada'));
    expect(primitive.isRemovable()).toBe(true);
    expect(primitive.isDisabled()).toBe(false);
    expect(primitive.label()).toBe('Ada');
    expect(primitive.neighbour()).toBe(named(host, 'Grace'));

    primitive.remove();
    flushSync();
    expect(instance.dropped).toBe(1);
    expect(document.activeElement).toBe(named(host, 'Grace'));
  });
});

/**
 * The bytes a server writes, which a reader meets before any script runs.
 *
 * `compileTemplate` picks its target from `__VOLT_SERVER__` when it is called,
 * so the tag is compiled here with the flag up, as a subclass that inherits
 * every prop: the client registration the rest of this file uses is left as
 * it is.
 */
describe('v-chip, written by a server', () => {
  const serverBuild = (on: boolean): void => {
    (globalThis as { __VOLT_SERVER__?: boolean }).__VOLT_SERVER__ = on;
  };
  beforeAll(() => serverBuild(true));
  afterAll(() => serverBuild(false));

  /** Each chip's opening tag and its button's, in page order. */
  const tags = (html: string): string[] => [...html.matchAll(/<(?:span|button)[^>]*>/g)].map((m) => m[0]);

  it('writes the tab stop, the fixed chip out of the order, and a button named by `label` or `Remove`', async () => {
    @Component({ selector: 'v-chip', render: compileTemplate(template, 'v-chip') })
    class ServerChip extends VChip {}

    @Component({
      selector: 'v-page-server',
      imports: [ServerChip],
      render: compileTemplate(`
        <div class="tags">
          <v-chip removable>Ada</v-chip>
          <v-chip removable label="Ada Lovelace"><b>AL</b></v-chip>
          <v-chip tone="danger" size="sm" id="overdue">Overdue</v-chip>
        </div>
      `),
    })
    class Page {}

    const { html } = await renderToStaticMarkup(Page);
    const [ada, adaRemove, initials, initialsRemove, overdue, ...rest] = tags(html).filter(
      (tag) => tag.includes('volt-chip"') || tag.includes('volt-chip-remove'),
    );
    expect(rest).toEqual([]);

    // A server has no words to read, so the button is named with the verb
    // alone until the page takes over — and with `label` it is named now.
    expect(ada).toContain('tabindex="0"');
    expect(ada).toContain('data-volt-item=""');
    expect(adaRemove).toContain('type="button"');
    expect(adaRemove).toContain('tabindex="-1"');
    expect(adaRemove).toContain('aria-label="Remove"');

    expect(initials).toContain('data-label="Ada Lovelace"');
    expect(initialsRemove).toContain('aria-label="Remove Ada Lovelace"');

    // The fixed chip: out of the tab order but focusable, drawn as asked, and
    // what was written on the tag on it.
    expect(overdue).toContain('tabindex="-1"');
    expect(overdue).toContain('data-tone="danger"');
    expect(overdue).toContain('data-size="sm"');
    expect(overdue).toContain('id="overdue"');
    expect(html.match(/volt-chip-remove/g)).toHaveLength(2);
  });
});
