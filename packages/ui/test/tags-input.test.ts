/**
 * `<v-tags-input>`, driven the way a page drives it.
 *
 * The behaviour is `createTagsInput`'s and `createFormField`'s, and is tested
 * where it lives. What is tested here is the shell: that what a caller writes
 * on the tag reaches the box rather than the layout around it, that the parts
 * are really there and really tied to one another, that every state the
 * sheet's rules select on is written on the element those rules name, that
 * each prop handed to the primitive does something, and that nothing about
 * the primitive is out of reach.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Component, Signal, flushSync, mount } from '@voltdev/core';
import { compileTemplate } from '@voltdev/core/jit';
import { compileComponents } from './render.js';
import { VTagsInput } from '../src/components/tags-input.js';
import { chipStyles, componentCss, fieldStyles, tokensCss } from '../src/index.ts';
import { tagsInputStyles } from '../src/sheet/tags-input.js';
import { mounted } from './scene.ts';
import { scene } from './scenes/tags-input.ts';

compileComponents();

let unmount: (() => void) | null = null;

afterEach(() => {
  unmount?.();
  unmount = null;
  for (const handle of mounted.splice(0)) handle.unmount();
  flushSync();
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

const field = (host: HTMLElement): HTMLElement => host.querySelector('.volt-field')!;
const label = (host: HTMLElement): HTMLLabelElement => host.querySelector('label')!;
const box = (host: HTMLElement): HTMLElement => host.querySelector('.volt-tags-input')!;
const list = (host: HTMLElement): HTMLElement => host.querySelector('.volt-tags-input-list')!;
const chips = (host: HTMLElement): HTMLElement[] => [
  ...host.querySelectorAll<HTMLElement>('.volt-tags-input-tag'),
];
const chip = (host: HTMLElement, index: number): HTMLElement => chips(host)[index]!;
const words = (host: HTMLElement): string[] =>
  chips(host).map((el) => el.querySelector('.volt-chip-label')!.textContent ?? '');
const removes = (host: HTMLElement): HTMLButtonElement[] => [
  ...host.querySelectorAll<HTMLButtonElement>('.volt-chip-remove'),
];
const input = (host: HTMLElement): HTMLInputElement =>
  host.querySelector<HTMLInputElement>('.volt-tags-input-input')!;
/** What submits: one per tag, inside the field and outside the box. */
const hidden = (host: HTMLElement): HTMLInputElement[] => [
  ...host.querySelectorAll<HTMLInputElement>('.volt-field > input'),
];
const hint = (host: HTMLElement): HTMLElement => host.querySelector('.volt-field-description')!;
const error = (host: HTMLElement): HTMLElement => host.querySelector('.volt-field-error')!;
const status = (host: HTMLElement): HTMLElement => host.querySelector('.volt-tags-input-status')!;
const stops = (host: HTMLElement): string[] =>
  chips(host).map((el) => el.getAttribute('tabindex') ?? '');

/** An edit as the user makes it: the box first, then the event it fires. */
function type(el: HTMLInputElement, text: string): void {
  el.value = text;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

/** A keydown as the user sends one: bubbling, and cancellable. */
function press(target: Element, key: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  flushSync();
  return event;
}

/** Typed and then committed with Enter, which is how most tags arrive. */
function enter(el: HTMLInputElement, text: string): KeyboardEvent {
  type(el, text);
  return press(el, 'Enter');
}

function paste(target: Element, text: string): ClipboardEvent {
  const data = new DataTransfer();
  data.setData('text', text);
  const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  flushSync();
  return event;
}

/** A submit as a press on the button makes it, so it can be refused. */
function submit(form: HTMLFormElement): boolean {
  const event = new Event('submit', { bubbles: true, cancelable: true });
  form.dispatchEvent(event);
  flushSync();
  return !event.defaultPrevented;
}

/** A selector list, split at the commas that separate its selectors and not at those inside `:has()`. */
function selectorsIn(list: string): string[] {
  const selectors: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < list.length; index += 1) {
    const character = list[index];
    if (character === '(') depth += 1;
    else if (character === ')') depth -= 1;
    else if (character === ',' && depth === 0) {
      selectors.push(list.slice(start, index).trim());
      start = index + 1;
    }
  }
  selectors.push(list.slice(start).trim());
  return selectors;
}

describe('v-tags-input', () => {
  it('is a label, a box of tags and a text input, a line of help, a message and a live region, tied to one another', () => {
    @Component({
      selector: 'v-page',
      imports: [VTagsInput],
      render: compileTemplate(
        `<v-tags-input class="mine" label="Topics" description="Enter or a comma adds one."
                       defaultValue="design, rust"></v-tags-input>`,
      ),
    })
    class Page {}

    const { host } = show(Page);

    // What the caller wrote lands on the box: it is the element carrying the
    // role, and the row a class lays out. The `<div>` around it is layout
    // nobody named.
    expect([...box(host).classList].sort()).toEqual(['mine', 'volt-field-control', 'volt-tags-input']);
    expect(field(host).classList.contains('mine')).toBe(false);
    expect(box(host).getAttribute('role')).toBe('group');

    // The row is a list inside the box, and each tag a chip in it, written
    // from an attribute that is split the way a paste is.
    expect(box(host).contains(list(host))).toBe(true);
    expect(list(host).getAttribute('role')).toBe('list');
    expect(list(host).getAttribute('aria-label')).toBe('Tags');
    expect(words(host)).toEqual(['design', 'rust']);
    expect(chips(host).every((el) => el.getAttribute('role') === 'listitem')).toBe(true);
    expect(chips(host).every((el) => el.classList.contains('volt-chip'))).toBe(true);
    // One tab stop for the whole row.
    expect(stops(host)).toEqual(['0', '-1']);

    // A button per tag, named after it, and never a stop of its own.
    expect(removes(host).map((el) => el.getAttribute('aria-label'))).toEqual([
      'Remove design',
      'Remove rust',
    ]);
    expect(removes(host).every((el) => el.getAttribute('tabindex') === '-1')).toBe(true);
    expect(removes(host).every((el) => el.type === 'button')).toBe(true);

    // The text input is the field's control: what the label's `for` names, and
    // after the row in the box. The box borrows its ARIA, which is how a
    // screen reader hears one field.
    expect(box(host).contains(input(host))).toBe(true);
    expect(input(host).type).toBe('text');
    expect(label(host).textContent).toBe('Topics');
    expect(label(host).getAttribute('for')).toBe(input(host).id);
    expect(input(host).getAttribute('aria-labelledby')).toBe(label(host).id);
    expect(box(host).getAttribute('aria-labelledby')).toBe(label(host).id);
    expect(hint(host).textContent).toBe('Enter or a comma adds one.');
    // The standing explanation first and the news second, which is the order
    // a screen reader reads them in.
    expect(box(host).getAttribute('aria-describedby')).toBe(`${hint(host).id} ${error(host).id}`);
    expect(input(host).getAttribute('aria-describedby')).toBe(`${hint(host).id} ${error(host).id}`);

    // Both live regions are on the page before they have anything to say,
    // since one that arrives already holding its message is one nothing was
    // watching.
    expect(error(host).getAttribute('role')).toBe('alert');
    expect(error(host).textContent).toBe('');
    expect(status(host).getAttribute('role')).toBe('status');
    expect(status(host).getAttribute('aria-live')).toBe('polite');
    expect(status(host).textContent).toBe('');
    expect(field(host).getAttribute('data-state')).toBe('valid');
  });

  it('lands everything else the caller wrote on the box as well', () => {
    @Component({
      selector: 'v-page',
      imports: [VTagsInput],
      render: compileTemplate(
        `<v-tags-input label="Topics" title="Up to five" lang="en" data-testid="topics"></v-tags-input>`,
      ),
    })
    class Page {}

    const { host } = show(Page);

    expect(box(host).getAttribute('title')).toBe('Up to five');
    expect(box(host).getAttribute('data-testid')).toBe('topics');
    expect(box(host).getAttribute('lang')).toBe('en');
    expect(field(host).hasAttribute('title')).toBe(false);
    expect(input(host).hasAttribute('data-testid')).toBe(false);
  });

  it('lands a class, an id and a name written together where each belongs', () => {
    @Component({
      selector: 'v-page',
      imports: [VTagsInput],
      render: compileTemplate(
        `<v-tags-input class="mine" id="topics" aria-label="Topics you write about" label="Topics"></v-tags-input>`,
      ),
    })
    class Page {}

    const { host } = show(Page);

    // The class and the name on the box, which carries the role; the id on
    // the text input, which the label's `for` has to reach; and none of the
    // three on the layout around them.
    expect(box(host).classList.contains('mine')).toBe(true);
    expect(box(host).getAttribute('aria-label')).toBe('Topics you write about');
    expect(input(host).id).toBe('topics');
    expect(label(host).getAttribute('for')).toBe('topics');
    expect(box(host).id).not.toBe('topics');
    for (const el of [field(host), label(host), list(host)]) {
      expect(el.classList.contains('mine')).toBe(false);
      expect(el.getAttribute('aria-label')).not.toBe('Topics you write about');
      expect(el.id).not.toBe('topics');
    }
  });

  it('gives the text input the id the label points at', () => {
    @Component({
      selector: 'v-page',
      imports: [VTagsInput],
      render: compileTemplate(`<v-tags-input id="topics" label="Topics"></v-tags-input>`),
    })
    class Page {}

    const { host } = show(Page);

    // The label's press has to land where typing happens, and the box is not
    // that.
    expect(input(host).id).toBe('topics');
    expect(label(host).getAttribute('for')).toBe('topics');
    expect(box(host).id).not.toBe('topics');
  });

  it('adds what is typed on Enter, a separator or leaving the field, and says so', () => {
    @Component({
      selector: 'v-page',
      imports: [VTagsInput],
      render: compileTemplate(`<v-tags-input label="Topics"></v-tags-input>`),
    })
    class Page {}

    const { host } = show(Page);

    expect(enter(input(host), ' rust ').defaultPrevented).toBe(true);
    expect(words(host)).toEqual(['rust']);
    // Emptied for the next one, and said, because nothing on screen moved
    // focus to tell a screen reader anything happened.
    expect(input(host).value).toBe('');
    expect(status(host).textContent).toBe('rust added');

    type(input(host), 'go');
    expect(press(input(host), ',').defaultPrevented).toBe(true);
    expect(words(host)).toEqual(['rust', 'go']);
    expect(status(host).textContent).toBe('go added');

    // With nothing half-typed, Enter is the form's.
    expect(press(input(host), 'Enter').defaultPrevented).toBe(false);

    // Escape takes back what is half-typed rather than the field.
    type(input(host), 'zg');
    expect(press(input(host), 'Escape').defaultPrevented).toBe(true);
    expect(input(host).value).toBe('');

    // A tag half-typed when the user tabs away is not lost.
    input(host).focus();
    type(input(host), 'zig');
    input(host).blur();
    flushSync();
    expect(words(host)).toEqual(['rust', 'go', 'zig']);
  });

  it('splits a paste into several tags, and leaves a paste with nothing to split alone', () => {
    @Component({
      selector: 'v-page',
      imports: [VTagsInput],
      render: compileTemplate(`<v-tags-input label="Topics"></v-tags-input>`),
    })
    class Page {}

    const { host } = show(Page);

    expect(paste(input(host), 'go, zig\nnim').defaultPrevented).toBe(true);
    expect(words(host)).toEqual(['go', 'zig', 'nim']);

    // Just typing, which the user can still edit before pressing Enter.
    expect(paste(input(host), 'rust').defaultPrevented).toBe(false);
    expect(words(host)).toEqual(['go', 'zig', 'nim']);
  });

  it('moves along the row with the arrows, and removes the tag under the keyboard', () => {
    @Component({
      selector: 'v-page',
      imports: [VTagsInput],
      render: compileTemplate(
        `<v-tags-input label="Topics" defaultValue="design, rust, go, zig"></v-tags-input>`,
      ),
    })
    class Page {}

    const { host } = show(Page);

    // Backspace in an empty box takes the last tag away.
    input(host).focus();
    expect(press(input(host), 'Backspace').defaultPrevented).toBe(true);
    expect(words(host)).toEqual(['design', 'rust', 'go']);
    expect(status(host).textContent).toBe('zig removed');
    // But it deletes text when there is text to delete.
    type(input(host), 'x');
    expect(press(input(host), 'Backspace').defaultPrevented).toBe(false);
    type(input(host), '');

    // The back arrow in an empty box steps into the row, onto its last tag,
    // and the row's one stop follows focus there.
    expect(press(input(host), 'ArrowLeft').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(chip(host, 2));
    expect(stops(host)).toEqual(['-1', '-1', '0']);

    press(chip(host, 2), 'ArrowLeft');
    expect(document.activeElement).toBe(chip(host, 1));
    expect(stops(host)).toEqual(['-1', '0', '-1']);

    // Delete takes away the tag under the keyboard, and focus goes to the tag
    // that took its place rather than to the top of the document.
    expect(press(chip(host, 1), 'Delete').defaultPrevented).toBe(true);
    expect(words(host)).toEqual(['design', 'go']);
    expect(document.activeElement).toBe(chip(host, 1));
    expect(chip(host, 1).textContent).toContain('go');
    expect(status(host).textContent).toBe('rust removed');

    // The forward arrow off the last tag steps back out into the text input.
    expect(press(chip(host, 1), 'ArrowRight').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(input(host));

    // The last tag going hands focus to the text input.
    press(input(host), 'ArrowLeft');
    press(chip(host, 1), 'Backspace');
    expect(document.activeElement).toBe(chip(host, 0));
    press(chip(host, 0), 'Backspace');
    expect(chips(host)).toEqual([]);
    expect(document.activeElement).toBe(input(host));
  });

  it('leaves focus where it is when a removal only carries the tag holding it along', () => {
    @Component({
      selector: 'v-page',
      imports: [VTagsInput],
      render: compileTemplate(`<v-tags-input label="Topics" :value="topics"></v-tags-input>`),
    })
    class Page {
      topics = new Signal.State<readonly string[]>(['design', 'rust', 'go']);
    }

    const { instance, host } = show(Page);
    const held = chip(host, 2);
    held.focus();

    // The page drops a tag before the one the user is on. Each tag is its own
    // element, keyed by its words, so the one holding focus moves along and
    // keeps it, and the row's one stop moves with it.
    instance.topics.set(['rust', 'go']);
    flushSync();
    expect(chip(host, 1)).toBe(held);
    expect(document.activeElement).toBe(held);
    expect(stops(host)).toEqual(['-1', '0']);
  });

  it('removes a tag with its button, and hands focus on from it', () => {
    @Component({
      selector: 'v-page',
      imports: [VTagsInput],
      render: compileTemplate(`<v-tags-input label="Topics" defaultValue="design, rust, go"></v-tags-input>`),
    })
    class Page {}

    const { host } = show(Page);

    // A press leaves focus on the button, which is inside the tag it removes.
    const button = removes(host)[0]!;
    button.focus();
    button.click();
    flushSync();

    expect(words(host)).toEqual(['rust', 'go']);
    expect(status(host).textContent).toBe('design removed');
    expect(document.activeElement).toBe(chip(host, 0));
  });

  it('marks the tag a refused duplicate collided with, until the next edit', () => {
    @Component({
      selector: 'v-page',
      imports: [VTagsInput],
      render: compileTemplate(`<v-tags-input label="Topics" defaultValue="design, rust"></v-tags-input>`),
    })
    class Page {}

    const { host } = show(Page);

    // `Rust` and `rust` are one tag. The text stays to be fixed, the tag it
    // collided with is marked — the sheet's one mark of its own — and the
    // live region says why nothing was added.
    expect(enter(input(host), 'Rust').defaultPrevented).toBe(true);
    expect(words(host)).toEqual(['design', 'rust']);
    expect(input(host).value).toBe('Rust');
    expect(chip(host, 1).hasAttribute('data-duplicate')).toBe(true);
    expect(chip(host, 0).hasAttribute('data-duplicate')).toBe(false);
    expect(status(host).textContent).toBe('Rust is already in the list');

    type(input(host), 'Rusty');
    expect(chip(host, 1).hasAttribute('data-duplicate')).toBe(false);
  });

  it('keeps a second copy when allowDuplicates is written bare, and not when it says false', () => {
    @Component({
      selector: 'v-page',
      imports: [VTagsInput],
      render: compileTemplate(
        `<v-tags-input label="Votes" name="vote" allowDuplicates defaultValue="yes"></v-tags-input>`,
      ),
    })
    class Page {}

    const { host } = show(Page);

    enter(input(host), 'yes');
    expect(words(host)).toEqual(['yes', 'yes']);
    expect(hidden(host).map((el) => el.value)).toEqual(['yes', 'yes']);
    // Each copy is its own element: taking the second away leaves the first.
    const first = chip(host, 0);
    press(chip(host, 1), 'Delete');
    expect(chips(host)).toEqual([first]);
    unmount?.();

    @Component({
      selector: 'v-page2',
      imports: [VTagsInput],
      render: compileTemplate(
        `<v-tags-input label="Votes" allowDuplicates="false" defaultValue="yes"></v-tags-input>`,
      ),
    })
    class Page2 {}

    const other = show(Page2).host;
    enter(input(other), 'yes');
    expect(words(other)).toEqual(['yes']);
  });

  it('takes away the very copy the keyboard is on, and hands focus on from it', () => {
    @Component({
      selector: 'v-page',
      imports: [VTagsInput],
      render: compileTemplate(
        `<v-tags-input label="Votes" allowDuplicates defaultValue="yes, no, yes"></v-tags-input>`,
      ),
    })
    class Page {}

    const { host } = show(Page);
    const [, no, second] = chips(host);

    // The first `yes` goes. Its element goes with it, not the second's: the
    // two share their words, and an element kept for its words would be the
    // focused one, carried to the end to stand for the other — a move that
    // blurs it and leaves focus on `<body>`.
    chip(host, 0).focus();
    press(chip(host, 0), 'Delete');
    expect(words(host)).toEqual(['no', 'yes']);
    expect(chips(host)).toEqual([no, second]);
    expect(document.activeElement).toBe(no);
    expect(stops(host)).toEqual(['0', '-1']);
  });

  it('hands focus on when the page itself takes away copies around the one it is on', () => {
    @Component({
      selector: 'v-page',
      imports: [VTagsInput],
      render: compileTemplate(`<v-tags-input label="Votes" allowDuplicates :value="votes"></v-tags-input>`),
    })
    class Page {
      votes = new Signal.State<readonly string[]>(['yes', 'no', 'yes', 'maybe']);
    }

    const { instance, host } = show(Page);
    const [held, no, second] = chips(host);
    held!.focus();

    // Two tags gone in one write, at either end of the row: what is left
    // keeps its own elements, and focus moves on from the one that went.
    instance.votes.set(['no', 'yes']);
    flushSync();
    expect(chips(host)).toEqual([no, second]);
    expect(held!.isConnected).toBe(false);
    expect(document.activeElement).toBe(no);
  });

  it('ends a tag on the separators it is given, and on no others', () => {
    @Component({
      selector: 'v-page',
      imports: [VTagsInput],
      render: compileTemplate(`<v-tags-input label="Topics" separators=";|"></v-tags-input>`),
    })
    class Page {}

    const { host } = show(Page);

    // A comma is typing, here, and each character written is a separator of
    // its own rather than the pair of them one.
    type(input(host), 'a,b');
    expect(press(input(host), ',').defaultPrevented).toBe(false);
    expect(press(input(host), ';').defaultPrevented).toBe(true);
    expect(words(host)).toEqual(['a,b']);
    type(input(host), 'go');
    expect(press(input(host), '|').defaultPrevented).toBe(true);
    expect(words(host)).toEqual(['a,b', 'go']);
    // And a paste splits on what ends a tag.
    paste(input(host), 'zig;nim|odin');
    expect(words(host)).toEqual(['a,b', 'go', 'zig', 'nim', 'odin']);
    unmount?.();

    @Component({
      selector: 'v-page2',
      imports: [VTagsInput],
      render: compileTemplate(
        `<v-tags-input label="Topics" :separators="ends" :defaultValue="start"></v-tags-input>`,
      ),
    })
    class Page2 {
      ends = ['|', ' '];
      start = ['design'];
    }

    const other = show(Page2).host;
    expect(words(other)).toEqual(['design']);
    type(input(other), 'go');
    press(input(other), ' ');
    type(input(other), 'zig');
    press(input(other), '|');
    expect(words(other)).toEqual(['design', 'go', 'zig']);
  });

  it('stops at max, and marks the box and the text input full', () => {
    @Component({
      selector: 'v-page',
      imports: [VTagsInput],
      render: compileTemplate(`<v-tags-input label="Topics" max="2" defaultValue="design"></v-tags-input>`),
    })
    class Page {}

    const { host } = show(Page);

    expect(box(host).hasAttribute('data-full')).toBe(false);
    enter(input(host), 'rust');
    expect(box(host).getAttribute('data-full')).toBe('');
    expect(input(host).getAttribute('data-full')).toBe('');

    // `max="2"` is the string '2' until it is read as the number it is.
    enter(input(host), 'go');
    expect(words(host)).toEqual(['design', 'rust']);
    expect(input(host).value).toBe('go');

    // Room again once one goes.
    press(chip(host, 0), 'Delete');
    expect(box(host).hasAttribute('data-full')).toBe(false);
    press(input(host), 'Enter');
    expect(words(host)).toEqual(['rust', 'go']);
  });

  it('refuses a limit that is not a count while it is still the thing that is wrong', () => {
    @Component({
      selector: 'v-page',
      imports: [VTagsInput],
      render: compileTemplate(`<v-tags-input label="Topics" max="five"></v-tags-input>`),
    })
    class Page {}

    expect(() => show(Page)).toThrow(/`max` on <v-tags-input> takes a whole number of tags/);
  });

  it('refuses a tag the caller’s rule refuses, in the rule’s own words, until the next edit', () => {
    const changes: (readonly string[])[] = [];

    @Component({
      selector: 'v-page',
      imports: [VTagsInput],
      render: compileTemplate(
        `<v-tags-input label="Topics" :validate="rule" :onValueChange="changed"></v-tags-input>`,
      ),
    })
    class Page {
      rule = (tag: string): string | null => (/\s/.test(tag) ? 'One word per tag.' : null);
      changed = (tags: readonly string[]): void => void changes.push(tags);
    }

    const { host } = show(Page);

    enter(input(host), 'machine learning');
    expect(words(host)).toEqual([]);
    expect(changes).toEqual([]);
    // Left in the box to be fixed, with the reason under it, on the box the
    // field's sheet draws, and in the control so a submit is refused for it.
    expect(input(host).value).toBe('machine learning');
    expect(error(host).textContent).toBe('One word per tag.');
    expect(field(host).getAttribute('data-state')).toBe('invalid');
    expect(box(host).getAttribute('data-state')).toBe('invalid');
    expect(box(host).getAttribute('aria-invalid')).toBe('true');
    expect(input(host).validationMessage).toBe('One word per tag.');

    type(input(host), 'ml');
    expect(error(host).textContent).toBe('');
    expect(box(host).getAttribute('data-state')).toBe('valid');
    press(input(host), 'Enter');
    expect(words(host)).toEqual(['ml']);
    expect(changes).toEqual([['ml']]);
  });

  it('calls onValueChange with the tags on every change', () => {
    const changes: (readonly string[])[] = [];

    @Component({
      selector: 'v-page',
      imports: [VTagsInput],
      render: compileTemplate(`<v-tags-input label="Topics" :onValueChange="changed"></v-tags-input>`),
    })
    class Page {
      changed = (tags: readonly string[]): void => void changes.push(tags);
    }

    const { host } = show(Page);

    enter(input(host), 'rust');
    paste(input(host), 'go,zig');
    press(input(host), 'Backspace');
    expect(changes).toEqual([['rust'], ['rust', 'go'], ['rust', 'go', 'zig'], ['rust', 'go']]);
  });

  it('follows a value bound to a signal, and writes every change back into it', () => {
    @Component({
      selector: 'v-page',
      imports: [VTagsInput],
      render: compileTemplate(`<v-tags-input label="Topics" name="topic" :value="topics"></v-tags-input>`),
    })
    class Page {
      topics = new Signal.State<readonly string[]>(['design']);
    }

    const { instance, host } = show(Page);
    expect(words(host)).toEqual(['design']);

    instance.topics.set(['design', 'rust', 'go']);
    flushSync();
    expect(words(host)).toEqual(['design', 'rust', 'go']);
    expect(hidden(host).map((el) => el.value)).toEqual(['design', 'rust', 'go']);

    enter(input(host), 'zig');
    expect(instance.topics.get()).toEqual(['design', 'rust', 'go', 'zig']);
    press(chip(host, 0), 'Delete');
    expect(instance.topics.get()).toEqual(['rust', 'go', 'zig']);
  });

  it('starts from a written list with its blanks dropped and its line breaks splitting', () => {
    @Component({
      selector: 'v-page',
      imports: [VTagsInput],
      render: compileTemplate(
        `<v-tags-input label="Topics" name="topic" defaultValue=" design,, rust ,
                       go
                       ,"></v-tags-input>`,
      ),
    })
    class Page {}

    const { host } = show(Page);

    // Split the way a paste is: on the separators and on line breaks, each
    // piece trimmed, and the empty ones a stray comma leaves are no tag.
    expect(words(host)).toEqual(['design', 'rust', 'go']);
    expect(hidden(host).map((el) => el.value)).toEqual(['design', 'rust', 'go']);
  });

  it('starts from a written list split on its line breaks alone, as a paste is', () => {
    @Component({
      selector: 'v-page',
      imports: [VTagsInput],
      render: compileTemplate(`<v-tags-input label="Topics" separators=";" defaultValue="design
                       rust"></v-tags-input>`),
    })
    class Page {}

    const { host } = show(Page);

    // No separator anywhere in it, so it is the line break that splits — as
    // it would in a paste, whatever the separators are.
    expect(words(host)).toEqual(['design', 'rust']);
  });

  it('submits one entry per tag under its name, and a reset puts the row back', () => {
    @Component({
      selector: 'v-page',
      imports: [VTagsInput],
      render: compileTemplate(`
        <form><v-tags-input label="Topics" name="topic" defaultValue="design, rust"></v-tags-input></form>
      `),
    })
    class Page {}

    const { host } = show(Page);
    const form = host.querySelector('form')!;

    // Hidden, and outside the box: the server reads a list, and nothing a
    // user tabs through is a copy of a tag.
    expect(hidden(host).every((el) => el.type === 'hidden')).toBe(true);
    expect(hidden(host).some((el) => box(host).contains(el))).toBe(false);
    expect(new FormData(form).getAll('topic')).toEqual(['design', 'rust']);

    enter(input(host), 'go');
    press(chip(host, 0), 'Delete');
    expect(new FormData(form).getAll('topic')).toEqual(['rust', 'go']);
    // The text input is not one of them.
    expect(input(host).name).toBe('');

    form.dispatchEvent(new Event('reset', { bubbles: true, cancelable: true }));
    flushSync();
    expect(words(host)).toEqual(['design', 'rust']);
    expect(new FormData(form).getAll('topic')).toEqual(['design', 'rust']);
  });

  it('refuses an empty row on submit when required, in its own words', () => {
    @Component({
      selector: 'v-page',
      imports: [VTagsInput],
      render: compileTemplate(`
        <form><v-tags-input label="Topics" name="topic" :required="must.get()"></v-tags-input></form>
      `),
    })
    class Page {
      must = new Signal.State(true);
    }

    const { instance, host } = show(Page);
    const form = host.querySelector('form')!;

    // Said on the text input, the half of the field whose role takes it — a
    // group has no `aria-required` — and checked against the tags rather than
    // written to it as the platform's own: an empty box beside five tags is a
    // filled-in field.
    expect(input(host).getAttribute('aria-required')).toBe('true');
    expect(box(host).hasAttribute('aria-required')).toBe(false);
    expect(input(host).required).toBe(false);
    expect(field(host).getAttribute('data-required')).toBe('');

    expect(submit(form)).toBe(false);
    expect(error(host).textContent).toBe('Add at least one tag.');
    expect(box(host).getAttribute('aria-invalid')).toBe('true');

    enter(input(host), 'rust');
    expect(submit(form)).toBe(true);
    expect(error(host).textContent).toBe('');

    // And let go of.
    instance.must.set(false);
    flushSync();
    press(chip(host, 0), 'Delete');
    expect(input(host).hasAttribute('aria-required')).toBe(false);
    expect(submit(form)).toBe(true);
  });

  it('is taken out of use when disabled, and given back', () => {
    @Component({
      selector: 'v-page',
      imports: [VTagsInput],
      render: compileTemplate(
        `<v-tags-input label="Topics" defaultValue="design, rust" :disabled="off.get()"></v-tags-input>`,
      ),
    })
    class Page {
      off = new Signal.State(false);
    }

    const { instance, host } = show(Page);
    expect(removes(host)).toHaveLength(2);

    instance.off.set(true);
    flushSync();

    // The platform's own attribute on the text input, which takes it out of
    // the form, and ARIA on the box the field's sheet draws.
    expect(input(host).disabled).toBe(true);
    expect(box(host).getAttribute('aria-disabled')).toBe('true');
    expect(field(host).getAttribute('data-disabled')).toBe('');
    // A button that does nothing is not drawn, and the tags stay where Tab
    // reaches them, so they can still be read.
    expect(removes(host)).toEqual([]);
    expect(stops(host)).toEqual(['0', '-1']);
    // Nothing is added or removed.
    expect(enter(input(host), 'go').defaultPrevented).toBe(false);
    expect(press(chip(host, 0), 'Delete').defaultPrevented).toBe(false);
    expect(words(host)).toEqual(['design', 'rust']);

    instance.off.set(false);
    flushSync();
    expect(input(host).disabled).toBe(false);
    expect(box(host).hasAttribute('aria-disabled')).toBe(false);
    expect(removes(host)).toHaveLength(2);
  });

  it('takes the tags out of the form while disabled, as a disabled control is', () => {
    @Component({
      selector: 'v-page',
      imports: [VTagsInput],
      render: compileTemplate(`
        <form><v-tags-input label="Topics" name="topic" defaultValue="design, rust" :disabled="off.get()"></v-tags-input></form>
      `),
    })
    class Page {
      off = new Signal.State(true);
    }

    const { instance, host } = show(Page);
    const form = host.querySelector('form')!;

    // The tags submit from the hidden inputs, not from the text input, so
    // disabling the text input alone would leave every tag in the request.
    expect(new FormData(form).getAll('topic')).toEqual([]);
    expect(hidden(host).every((el) => el.disabled)).toBe(true);

    instance.off.set(false);
    flushSync();
    expect(new FormData(form).getAll('topic')).toEqual(['design', 'rust']);

    instance.off.set(true);
    flushSync();
    expect(new FormData(form).getAll('topic')).toEqual([]);
  });

  it('keeps the row reachable but unchangeable when read-only', () => {
    @Component({
      selector: 'v-page',
      imports: [VTagsInput],
      render: compileTemplate(
        `<v-tags-input label="Topics" defaultValue="design, rust" :readOnly="locked.get()"></v-tags-input>`,
      ),
    })
    class Page {
      locked = new Signal.State(true);
    }

    const { instance, host } = show(Page);

    expect(input(host).readOnly).toBe(true);
    expect(input(host).disabled).toBe(false);
    // Said in ARIA on the text input, which is a control and may be read-only.
    // The box is a `group`, which ARIA does not let be, so it is marked for
    // the sheet instead and says nothing a checker would refuse.
    expect(input(host).getAttribute('aria-readonly')).toBe('true');
    expect(box(host).hasAttribute('aria-readonly')).toBe(false);
    expect(box(host).getAttribute('data-readonly')).toBe('');
    expect(field(host).getAttribute('data-readonly')).toBe('');
    expect(removes(host)).toEqual([]);
    // Both stops are still there, so the tags can be read and copied.
    expect(stops(host)).toEqual(['0', '-1']);
    expect(press(input(host), 'Backspace').defaultPrevented).toBe(false);
    expect(press(chip(host, 0), 'Delete').defaultPrevented).toBe(false);
    expect(words(host)).toEqual(['design', 'rust']);

    instance.locked.set(false);
    flushSync();
    expect(input(host).readOnly).toBe(false);
    expect(box(host).hasAttribute('data-readonly')).toBe(false);
    expect(removes(host)).toHaveLength(2);
  });

  it('reads a flag written as "false" as the false it says', () => {
    @Component({
      selector: 'v-page',
      imports: [VTagsInput],
      render: compileTemplate(`
        <form><v-tags-input label="Topics" name="topic" defaultValue="design"
                            disabled="false" readOnly="false" required="false"></v-tags-input></form>
      `),
    })
    class Page {}

    const { host } = show(Page);
    const form = host.querySelector('form')!;

    // An attribute is a string, and `"false"` is a truthy one: read as it
    // stands, each of these would have switched on the very state it says is
    // off — a field out of use, a row nobody can change, an empty row refused.
    expect(input(host).disabled).toBe(false);
    expect(box(host).hasAttribute('aria-disabled')).toBe(false);
    expect(new FormData(form).getAll('topic')).toEqual(['design']);
    expect(input(host).readOnly).toBe(false);
    expect(box(host).hasAttribute('data-readonly')).toBe(false);
    expect(input(host).hasAttribute('aria-required')).toBe(false);
    expect(field(host).hasAttribute('data-required')).toBe(false);
    expect(removes(host)).toHaveLength(1);

    press(chip(host, 0), 'Delete');
    expect(words(host)).toEqual([]);
    expect(submit(form)).toBe(true);
  });

  it('shows the caller’s verdict, bound or written, and takes it back', () => {
    @Component({
      selector: 'v-page',
      imports: [VTagsInput],
      render: compileTemplate(
        // `error` shares its name with a DOM event, which is what `:error`
        // would mean; the escape says it is the prop.
        `<v-tags-input label="Topics" :prop-error="verdict.get()"></v-tags-input>`,
      ),
    })
    class Page {
      verdict = new Signal.State('');
    }

    const { instance, host } = show(Page);

    instance.verdict.set('Pick topics from the list.');
    flushSync();
    expect(error(host).textContent).toBe('Pick topics from the list.');
    expect(box(host).getAttribute('data-state')).toBe('invalid');
    expect(box(host).getAttribute('aria-invalid')).toBe('true');
    expect(input(host).validationMessage).toBe('Pick topics from the list.');

    instance.verdict.set('');
    flushSync();
    expect(error(host).textContent).toBe('');
    expect(box(host).getAttribute('data-state')).toBe('valid');
    unmount?.();

    @Component({
      selector: 'v-page2',
      imports: [VTagsInput],
      render: compileTemplate(`<v-tags-input label="Topics" error="That list is closed."></v-tags-input>`),
    })
    class Page2 {}

    // Handed to the field once the control is on the page, rather than while
    // the class is built, when there is nothing to measure it against.
    const other = show(Page2).host;
    expect(error(other).textContent).toBe('That list is closed.');
    expect(field(other).getAttribute('data-state')).toBe('invalid');
  });

  it('lets the caller’s verdict go on the next edit, and does not bring it back of its own accord', () => {
    @Component({
      selector: 'v-page',
      imports: [VTagsInput],
      render: compileTemplate(
        `<v-tags-input label="Topics" :prop-error="verdict.get()" :disabled="off.get()"></v-tags-input>`,
      ),
    })
    class Page {
      verdict = new Signal.State('');
      off = new Signal.State(false);
    }

    const { instance, host } = show(Page);

    instance.verdict.set('Pick topics from the list.');
    flushSync();
    expect(error(host).textContent).toBe('Pick topics from the list.');

    type(input(host), 'r');
    expect(error(host).textContent).toBe('');

    // Nothing the caller wrote has changed, so nothing the caller wrote is
    // said again — not when the field is taken out of use and given back.
    instance.off.set(true);
    flushSync();
    instance.off.set(false);
    flushSync();
    expect(error(host).textContent).toBe('');
    expect(input(host).validationMessage).toBe('');
  });

  it('shows one message, the one the submit was refused over, when there are two', () => {
    @Component({
      selector: 'v-page',
      imports: [VTagsInput],
      render: compileTemplate(`
        <form><v-tags-input label="Topics" required error="That list is closed."></v-tags-input></form>
      `),
    })
    class Page {}

    const { host } = show(Page);

    // The caller's verdict and the empty row are both reasons, and the line
    // under the box says the first — the one the platform holds.
    expect(submit(host.querySelector('form')!)).toBe(false);
    expect(error(host).textContent).toBe('That list is closed.');
    expect(input(host).validationMessage).toBe('That list is closed.');
  });

  it('shows the placeholder in the empty text input', () => {
    @Component({
      selector: 'v-page',
      imports: [VTagsInput],
      render: compileTemplate(`<v-tags-input label="Topics" placeholder="Add a topic"></v-tags-input>`),
    })
    class Page {}

    const { host } = show(Page);
    expect(input(host).placeholder).toBe('Add a topic');
  });

  it('words the list, the buttons and the live region the caller’s way', () => {
    @Component({
      selector: 'v-page',
      imports: [VTagsInput],
      render: compileTemplate(
        `<v-tags-input label="Sujets" :labels="words" defaultValue="design"></v-tags-input>`,
      ),
    })
    class Page {
      words = {
        list: 'Sujets choisis',
        remove: (tag: string) => `Retirer ${tag}`,
        added: (tag: string) => `${tag} ajouté`,
        removed: (tag: string) => `${tag} retiré`,
        duplicate: (tag: string) => `${tag} y est déjà`,
      };
    }

    const { host } = show(Page);

    expect(list(host).getAttribute('aria-label')).toBe('Sujets choisis');
    expect(removes(host)[0]!.getAttribute('aria-label')).toBe('Retirer design');
    enter(input(host), 'rust');
    expect(status(host).textContent).toBe('rust ajouté');
    enter(input(host), 'Rust');
    expect(status(host).textContent).toBe('Rust y est déjà');
    type(input(host), '');
    press(input(host), 'Backspace');
    expect(status(host).textContent).toBe('rust retiré');
  });

  it('refuses an empty row in the caller’s words when they have some', () => {
    @Component({
      selector: 'v-page',
      imports: [VTagsInput],
      render: compileTemplate(`
        <form><v-tags-input label="Sujets" required :labels="words"></v-tags-input></form>
      `),
    })
    class Page {
      words = { empty: 'Ajoutez au moins un sujet.' };
    }

    const { host } = show(Page);

    expect(submit(host.querySelector('form')!)).toBe(false);
    expect(error(host).textContent).toBe('Ajoutez au moins un sujet.');
  });

  it('draws a label, a line of help and each tag written as markup', () => {
    @Component({
      selector: 'v-page',
      imports: [VTagsInput],
      render: compileTemplate(`
        <v-tags-input defaultValue="design, rust">
          <template :slot-label>Topics <abbr title="required">*</abbr></template>
          <template :slot-description>See the <a href="/topics">list of topics</a>.</template>
          <template :slot-tag="{ tag, index }"><b>#{ tag }</b> { index }</template>
        </v-tags-input>
      `),
    })
    class Page {}

    const { host } = show(Page);

    expect(label(host).querySelector('abbr')?.getAttribute('title')).toBe('required');
    expect(hint(host).querySelector('a')?.getAttribute('href')).toBe('/topics');
    expect(chips(host).map((el) => el.querySelector('b')?.textContent)).toEqual(['#design', '#rust']);
    expect(words(host).map((text) => text.replace(/\s+/g, ' ').trim())).toEqual(['#design 0', '#rust 1']);
    // The buttons are named after the tag, not after whatever drew it.
    expect(removes(host)[1]!.getAttribute('aria-label')).toBe('Remove rust');
    // Still the elements the field points at, whatever was written into them.
    expect(box(host).getAttribute('aria-labelledby')).toBe(label(host).id);
    expect(box(host).getAttribute('aria-describedby')).toContain(hint(host).id);

    // A tag drawn this way follows the row like any other.
    press(chip(host, 0), 'Delete');
    expect(chips(host).map((el) => el.querySelector('b')?.textContent)).toEqual(['#rust']);
  });

  it('follows words that change', () => {
    @Component({
      selector: 'v-page',
      imports: [VTagsInput],
      render: compileTemplate(
        `<v-tags-input :label="words.get()" :description="help.get()"></v-tags-input>`,
      ),
    })
    class Page {
      words = new Signal.State('Topics');
      help = new Signal.State('Up to five.');
    }

    const { instance, host } = show(Page);
    expect(label(host).textContent).toBe('Topics');

    instance.words.set('Interests');
    instance.help.set('As many as you like.');
    flushSync();
    expect(label(host).textContent).toBe('Interests');
    expect(hint(host).textContent).toBe('As many as you like.');
  });

  it('adds what the caller says about the field to what the field says', () => {
    @Component({
      selector: 'v-page',
      imports: [VTagsInput],
      render: compileTemplate(`
        <span id="heading">What you write about</span>
        <span id="rules">Lower case only.</span>
        <v-tags-input label="Topics" aria-labelledby="heading"
                      :aria-describedby="extra.get()"></v-tags-input>
      `),
    })
    class Page {
      extra = new Signal.State('rules');
    }

    const { instance, host } = show(Page);

    // A name from elsewhere wins on both halves of the field, since the two
    // are one field to whoever hears them.
    expect(box(host).getAttribute('aria-labelledby')).toBe('heading');
    expect(input(host).getAttribute('aria-labelledby')).toBe('heading');
    // A description is added, after the field's own two.
    expect(box(host).getAttribute('aria-describedby')).toBe(`${hint(host).id} ${error(host).id} rules`);
    expect(input(host).getAttribute('aria-describedby')).toBe(
      `${hint(host).id} ${error(host).id} rules`,
    );

    instance.extra.set('');
    flushSync();
    expect(box(host).getAttribute('aria-describedby')).toBe(`${hint(host).id} ${error(host).id}`);
  });

  it('follows a name from elsewhere that changes, and hands back to the label when it goes', () => {
    @Component({
      selector: 'v-page',
      imports: [VTagsInput],
      render: compileTemplate(`
        <span id="heading">What you write about</span>
        <span id="other">What you read about</span>
        <v-tags-input label="Topics" :aria-labelledby="from.get()"></v-tags-input>
      `),
    })
    class Page {
      from = new Signal.State('heading');
    }

    const { instance, host } = show(Page);
    expect(box(host).getAttribute('aria-labelledby')).toBe('heading');

    instance.from.set('other');
    flushSync();
    expect(box(host).getAttribute('aria-labelledby')).toBe('other');
    expect(input(host).getAttribute('aria-labelledby')).toBe('other');

    instance.from.set('');
    flushSync();
    expect(box(host).getAttribute('aria-labelledby')).toBe(label(host).id);
    expect(input(host).getAttribute('aria-labelledby')).toBe(label(host).id);
  });

  it('lets a name the caller wrote be the name the field has', () => {
    @Component({
      selector: 'v-page',
      imports: [VTagsInput],
      render: compileTemplate(`<v-tags-input label="Topics" :aria-label="named.get()"></v-tags-input>`),
    })
    class Page {
      named = new Signal.State<string | undefined>('Topics you write about');
    }

    const { instance, host } = show(Page);

    // `aria-labelledby` outranks `aria-label` wherever a name is computed, so
    // the field's reference to its own label is stood down. The `for` stays:
    // a press on the words still puts the caret in the text input.
    expect(box(host).getAttribute('aria-label')).toBe('Topics you write about');
    expect(box(host).hasAttribute('aria-labelledby')).toBe(false);
    expect(input(host).getAttribute('aria-label')).toBe('Topics you write about');
    expect(input(host).hasAttribute('aria-labelledby')).toBe(false);
    expect(label(host).getAttribute('for')).toBe(input(host).id);

    instance.named.set(undefined);
    flushSync();
    expect(box(host).hasAttribute('aria-label')).toBe(false);
    expect(box(host).getAttribute('aria-labelledby')).toBe(label(host).id);
  });

  it('puts the caret in the text input when the space around the tags is pressed', () => {
    @Component({
      selector: 'v-page',
      imports: [VTagsInput],
      render: compileTemplate(`<v-tags-input label="Topics" defaultValue="design"></v-tags-input>`),
    })
    class Page {}

    const { host } = show(Page);

    // Each press from somewhere else, so that it is the press that put the
    // caret there.
    box(host).click();
    flushSync();
    expect(document.activeElement).toBe(input(host));

    chip(host, 0).focus();
    list(host).click();
    flushSync();
    expect(document.activeElement).toBe(input(host));

    // A press on a tag is a press on the tag.
    chip(host, 0).focus();
    chip(host, 0).click();
    flushSync();
    expect(document.activeElement).toBe(chip(host, 0));
  });

  it('keeps what is half-typed in the text input when the space around the tags is pressed', () => {
    @Component({
      selector: 'v-page',
      imports: [VTagsInput],
      render: compileTemplate(`<v-tags-input label="Topics" defaultValue="design"></v-tags-input>`),
    })
    class Page {}

    const { host } = show(Page);

    /**
     * A press as a browser makes it. Moving focus to what was pressed is the
     * press's own default, and happy-dom does not perform it, so it is done
     * here unless the press was refused — the box and the row both take
     * focus, each having a `tabindex`.
     */
    const pressOn = (target: HTMLElement): MouseEvent => {
      const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
      target.dispatchEvent(down);
      if (!down.defaultPrevented) target.focus();
      flushSync();
      target.click();
      flushSync();
      return down;
    };

    input(host).focus();
    type(input(host), 'rus');

    // A press beside the text means "type here", which the user already is:
    // focus never leaves the text input, so nothing is committed by its blur.
    for (const part of [box(host), list(host)]) {
      pressOn(part);
      expect(words(host)).toEqual(['design']);
      expect(input(host).value).toBe('rus');
      expect(document.activeElement).toBe(input(host));
    }

    // A press on a tag is the tag's, and moves focus to it as it would.
    expect(pressOn(chip(host, 0)).defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(chip(host, 0));
  });

  it('hands the primitive itself to whoever needs more than this offers', () => {
    @Component({
      selector: 'v-page',
      imports: [VTagsInput],
      render: compileTemplate(`<v-tags-input :ref="handle" label="Topics" max="3"></v-tags-input>`),
    })
    class Page {
      handle: VTagsInput | null = null;
    }

    const { instance, host } = show(Page);
    const tags = instance.handle!.tags;

    expect(tags.add('design')).toBe(true);
    expect(tags.add('rust')).toBe(true);
    flushSync();
    expect(words(host)).toEqual(['design', 'rust']);
    expect(tags.isFull()).toBe(false);

    tags.add('go');
    flushSync();
    expect(tags.isFull()).toBe(true);

    tags.clear();
    flushSync();
    expect(chips(host)).toEqual([]);
    expect(status(host).textContent).toBe('All tags removed');
  });

  it('is drawn by the field, the chip and its own entry together', () => {
    // The three entries the component's markup names, as a subset of the
    // sheet would carry them.
    const style = document.createElement('style');
    style.textContent = [tokensCss(), ...[fieldStyles, chipStyles, tagsInputStyles].map((entry) => componentCss(entry))].join('\n\n');
    document.head.append(style);

    @Component({
      selector: 'v-page',
      imports: [VTagsInput],
      render: compileTemplate(
        `<v-tags-input label="Topics" defaultValue="design, rust" :disabled="off.get()"></v-tags-input>`,
      ),
    })
    class Page {
      off = new Signal.State(false);
    }

    const css = (el: Element, property: string): string => getComputedStyle(el).getPropertyValue(property);

    /**
     * Where the ring is with focus on one part, on a field mounted for the
     * purpose: happy-dom keeps an element's computed style across a change of
     * focus inside it, so a box measured once reads the same ever after.
     */
    const ringWith = (part: (host: HTMLElement) => HTMLElement): { box: string; part: string } => {
      unmount?.();
      const { host } = show(Page);
      part(host).focus();
      flushSync();
      return { box: css(box(host), 'outline-style'), part: css(part(host), 'outline-style') };
    };

    try {
      // One ring at a time, on what the next key press acts on: the box
      // while the text input holds focus, since the text input has no edge
      // to draw one round, and the tag itself while a tag does.
      expect(ringWith(input)).toEqual({ box: 'solid', part: 'none' });
      expect(ringWith((host) => chip(host, 0))).toMatchObject({ part: 'solid' });
      expect(ringWith((host) => chip(host, 0)).box).not.toBe('solid');

      unmount?.();
      const { instance, host } = show(Page);
      expect(css(box(host), 'outline-style')).not.toBe('solid');

      // The box is the field's control, and the row inside it is this entry's.
      expect(css(box(host), 'display')).toBe('flex');
      expect(css(box(host), 'flex-wrap')).toBe('wrap');
      expect(chips(host).every((el) => css(el, 'display') === 'inline-flex')).toBe(true);
      // The text input is stripped back to its caret: the box is its edge.
      expect(css(input(host), 'border-inline-start-width')).toBe('0');

      // The tag a refused duplicate collided with keeps the row where it was
      // and doubles its edge, which is the mark that outlives the palette.
      const plain = css(chip(host, 1), 'border-inline-start-width');
      enter(input(host), 'Rust');
      expect(css(chip(host, 1), 'border-inline-start-width')).not.toBe(plain);
      expect(css(chip(host, 0), 'border-inline-start-width')).toBe(plain);

      // A press anywhere in the box types, and the box says so — until the
      // field is out of use, when the field's own cursor says that instead.
      expect(css(box(host), 'cursor')).toBe('text');
      instance.off.set(true);
      flushSync();
      expect(css(box(host), 'cursor')).toBe('not-allowed');
    } finally {
      style.remove();
    }
  });

  it('draws a read-only row on the surface the field gives any read-only control', () => {
    const style = document.createElement('style');
    style.textContent = [tokensCss(), ...[fieldStyles, chipStyles, tagsInputStyles].map((entry) => componentCss(entry))].join('\n\n');
    document.head.append(style);

    @Component({
      selector: 'v-page',
      imports: [VTagsInput],
      render: compileTemplate(`
        <v-tags-input label="Topics" defaultValue="design" :readOnly="locked.get()"></v-tags-input>
        <input class="volt-field-control" aria-readonly="true" readonly id="reference">
      `),
    })
    class Page {
      locked = new Signal.State(false);
    }

    const css = (el: Element, property: string): string => getComputedStyle(el).getPropertyValue(property);

    try {
      const { instance, host } = show(Page);
      // A plain read-only box, as `field` draws it from `aria-readonly`.
      const surface = css(host.querySelector('#reference')!, 'background-color');
      expect(css(box(host), 'background-color')).not.toBe(surface);

      // The group may not say `aria-readonly`, so the look has to come from
      // what it does say — and come out the same.
      instance.locked.set(true);
      flushSync();
      expect(css(box(host), 'background-color')).toBe(surface);
    } finally {
      style.remove();
    }
  });

  it('draws nothing the primitive never renders', () => {
    // What `primitives.test.ts` holds every registered sheet to, run here as
    // well: the scene walks the documented markup through every state its
    // rules distinguish, and a selector nothing in it ever matched is a rule
    // that draws nothing.
    document.body.innerHTML = '<div id="app"></div>';
    const selectors = [...tagsInputStyles.rules, ...tagsInputStyles.forcedColors]
      .flatMap((rule) => selectorsIn(rule.selector))
      .map((selector) => selector.replaceAll(':hover', '').replaceAll(':focus-visible', ''));
    const unmatched = new Set(selectors);

    scene(() => {
      for (const selector of unmatched) if (document.querySelector(selector)) unmatched.delete(selector);
    });

    expect([...unmatched]).toEqual([]);
  });
});
