/**
 * `<v-editor>`, driven the way a page drives it.
 *
 * The editing is `@voltdev/editor`'s, and is tested there: what typing,
 * return, paste and the undo keys do to a document, and what each formatting
 * command does to one. What is tested here is what the component adds — that
 * the element a caller can see is the element the engine edits and the one
 * their attributes land on, that the field's label, help and message are
 * tied to it, that the document is the caller's signal both ways, that the
 * toolbar says what is applied at the selection and does what it says, that
 * out of use means out of use, and that a server writes a document a reader
 * can read.
 *
 * Edits arrive as the browser sends them — `beforeinput`, keys, presses — and
 * a selection is put where a test wants it through the view, which is where a
 * click or a drag puts one.
 */
import { compileComponents } from './render.js';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Component, Signal, flushSync, mount } from '@voltdev/core';
import { compileTemplate } from '@voltdev/core/jit';
import { renderToStaticMarkup } from '@voltdev/core/server';
import { createLocaleProvider } from '@voltdev/primitives';
import {
  NodeSelection,
  Schema,
  TextSelection,
  Transaction,
  basicSchema,
  type EditorSelection,
  type Mark,
  type Node as DocNode,
} from '@voltdev/editor';
import template from '../src/components/editor.html?raw';
import { FORCED_COLORS_QUERY, rulesToCss, tokensCss, wrap, type Rule } from '../src/index.ts';
import { editorStyles } from '../src/sheet/editor.ts';
import { fieldStyles } from '../src/sheet/field.ts';
import { SYSTEM_COLORS, standIn, styledDocument } from './harness.ts';
import { VEditor } from '../src/components/editor.js';
import { documentMarkup } from '../src/components/editor-markup.js';

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

const s = basicSchema;
const doc = (...content: DocNode[]) => s.node('doc', null, content);
const p = (...content: DocNode[]) => s.node('paragraph', null, content);
const h = (level: number, ...content: DocNode[]) => s.node('heading', { level }, content);
const ul = (...content: DocNode[]) => s.node('bullet_list', null, content);
const li = (...content: DocNode[]) => s.node('list_item', null, content);
const quote = (...content: DocNode[]) => s.node('blockquote', null, content);
const t = (text: string, ...marks: Mark[]) => s.text(text, marks);
const B = s.mark('strong');

const surface = (host: HTMLElement): HTMLElement => host.querySelector('.volt-editor')!;
const toolbar = (host: HTMLElement): HTMLElement => host.querySelector('.volt-editor-toolbar')!;
const button = (host: HTMLElement, action: string): HTMLButtonElement =>
  host.querySelector(`[data-action="${action}"]`)!;
const buttons = (host: HTMLElement): HTMLButtonElement[] => [
  ...host.querySelectorAll<HTMLButtonElement>('.volt-toggle'),
];
const label = (host: HTMLElement): HTMLLabelElement => host.querySelector('.volt-field-label')!;
const hint = (host: HTMLElement): HTMLElement => host.querySelector('.volt-field-description')!;
const error = (host: HTMLElement): HTMLElement => host.querySelector('.volt-field-error')!;
const placeholder = (host: HTMLElement): HTMLElement | null => host.querySelector('.volt-editor-placeholder');

/** Text typed at the selection, as a browser asks for it. */
function type(host: HTMLElement, data: string): void {
  surface(host).dispatchEvent(
    new InputEvent('beforeinput', { inputType: 'insertText', data, bubbles: true, cancelable: true }),
  );
  flushSync();
}

function keydown(el: Element, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  el.dispatchEvent(event);
  flushSync();
  return event;
}

function click(el: Element): void {
  (el as HTMLElement).click();
  flushSync();
}

/** Put the selection where a click or a drag would. */
function select(editor: VEditor, selection: (doc: DocNode) => EditorSelection): void {
  const view = editor.view.get()!;
  view.dispatch(view.state.tr().setSelection(selection(view.state.doc)));
  flushSync();
}

const range = (anchor: number, head = anchor) => (d: DocNode) => TextSelection.create(d, anchor, head);

/** A page holding the document, with every prop bound to something it can change. */
@Component({
  selector: 'v-page',
  imports: [VEditor],
  render: compileTemplate(`
    <v-editor :ref="editor" :value="notes" label="Notes" description="Kept as you write it."
              placeholder="Write something" :disabled="off.get()" :readOnly="locked.get()"
              :prop-error="refused.get()" :onChange="heard"></v-editor>
  `),
})
class Page {
  editor: VEditor | null = null;
  notes = new Signal.State<DocNode>(doc(p(t('Hello'))));
  off = new Signal.State(false);
  locked = new Signal.State(false);
  refused = new Signal.State('');
  seen: DocNode[] = [];
  heard = (next: DocNode): void => {
    this.seen.push(next);
  };
}

describe('v-editor', () => {
  it('hands the element it draws to the engine, which edits it in place', () => {
    const { instance, host } = show(Page);
    const editor = instance.editor!;
    const el = surface(host);

    // The view's element is the template's own: the one `:host` marks, not
    // one the engine drew inside it.
    expect(editor.view.get()!.dom).toBe(el);
    expect(el.getAttribute('role')).toBe('textbox');
    expect(el.getAttribute('aria-multiline')).toBe('true');
    expect(el.getAttribute('contenteditable')).toBe('true');
    expect([...el.classList].sort()).toEqual(['volt-editor', 'volt-field-control']);
    // The document, drawn once: what the template wrote first is cleared, and
    // the engine draws beside nothing.
    expect(el.innerHTML).toBe('<p>Hello</p>');
    // Still where the template put it, after the words shown in an empty box.
    expect(el.parentElement!.classList.contains('volt-editor-body')).toBe(true);
    expect(el.parentElement!.lastElementChild).toBe(el);
  });

  it('lands what the caller wrote on the tag on the element being edited', () => {
    @Component({
      selector: 'v-page-host',
      imports: [VEditor],
      render: compileTemplate(`
        <v-editor class="mine" data-kind="notes" title="Your notes" id="notes" label="Notes"
                  aria-describedby="elsewhere"></v-editor>
        <p id="elsewhere">Shared with the team.</p>
      `),
    })
    class HostPage {}

    const { host } = show(HostPage);
    const el = surface(host);
    expect([...el.classList].sort()).toEqual(['mine', 'volt-editor', 'volt-field-control']);
    expect(el.dataset['kind']).toBe('notes');
    expect(el.getAttribute('title')).toBe('Your notes');
    // The id is the editor's, so the label and the toolbar point at it.
    expect(el.id).toBe('notes');
    expect(label(host).htmlFor).toBe('notes');
    expect(toolbar(host).getAttribute('aria-controls')).toBe('notes');
    // A description of the caller's own is added to the field's two.
    expect(el.getAttribute('aria-describedby')!.split(' ')).toEqual([hint(host).id, error(host).id, 'elsewhere']);
  });

  it('is named by its label, and by a name of the caller’s over it', () => {
    const { host } = show(Page);
    const el = surface(host);
    expect(el.getAttribute('aria-labelledby')).toBe(label(host).id);
    expect(label(host).textContent).toBe('Notes');
    expect(hint(host).textContent).toBe('Kept as you write it.');

    @Component({
      selector: 'v-page-named',
      imports: [VEditor],
      render: compileTemplate(`
        <v-editor label="Notes" :aria-label="name.get()"></v-editor>
        <v-editor label="Notes" aria-labelledby="heading"></v-editor>
      `),
    })
    class Named {
      name = new Signal.State('Meeting notes');
    }
    const named = show(Named);
    const [first, second] = [...named.host.querySelectorAll<HTMLElement>('.volt-editor')];
    // A name given stands the label's reference down, which would outrank it.
    expect(first!.getAttribute('aria-label')).toBe('Meeting notes');
    expect(first!.hasAttribute('aria-labelledby')).toBe(false);
    named.instance.name.set('Minutes');
    flushSync();
    expect(first!.getAttribute('aria-label')).toBe('Minutes');
    expect(second!.getAttribute('aria-labelledby')).toBe('heading');
  });

  it('puts the caret in the editor when its label is pressed', () => {
    const { host } = show(Page);
    click(label(host));
    expect(document.activeElement).toBe(surface(host));
  });

  it('writes every edit into the caller’s signal, and tells them', () => {
    const { instance, host } = show(Page);
    select(instance.editor!, range(6));
    type(host, '!');

    expect(instance.notes.get().eq(doc(p(t('Hello!'))))).toBe(true);
    expect(instance.seen).toHaveLength(1);
    expect(instance.seen[0]).toBe(instance.notes.get());
    expect(instance.editor!.state.get().doc).toBe(instance.notes.get());
    // A caret moved is not an edit.
    select(instance.editor!, range(1));
    expect(instance.seen).toHaveLength(1);
  });

  it('loads a document the caller writes in, and starts its history again', () => {
    const { instance, host } = show(Page);
    const editor = instance.editor!;
    select(editor, range(6));
    type(host, '!');
    expect(editor.can('undo')).toBe(true);

    instance.notes.set(doc(h(1, t('Agenda')), p(t('First'))));
    flushSync();
    expect(surface(host).innerHTML).toBe('<h1>Agenda</h1><p>First</p>');
    expect(editor.state.get().selection.anchor).toBe(1);
    // The steps it held were written against the document that went.
    expect(editor.can('undo')).toBe(false);
    // A document the caller wrote is not news to them.
    expect(instance.seen).toHaveLength(1);
  });

  it('keeps the caret and the history over an equal document written back', () => {
    const { instance, host } = show(Page);
    const editor = instance.editor!;
    select(editor, range(6));
    type(host, '!');

    instance.notes.set(doc(p(t('Hello!'))));
    flushSync();
    expect(editor.state.get().selection.anchor).toBe(7);
    expect(editor.can('undo')).toBe(true);
  });

  it('starts empty in the schema it was given, with buttons for what that schema has', () => {
    const plain = new Schema({
      nodes: { doc: { content: 'paragraph+' }, paragraph: { content: 'text*' }, text: {} },
      marks: { strong: {} },
    });

    @Component({
      selector: 'v-page-schema',
      imports: [VEditor],
      render: compileTemplate(`<v-editor :ref="editor" :schema="schema" label="Plain"></v-editor>`),
    })
    class SchemaPage {
      editor: VEditor | null = null;
      schema = plain;
    }

    const { instance, host } = show(SchemaPage);
    const state = instance.editor!.state.get();
    expect(state.doc.type.schema).toBe(plain);
    expect(state.doc.eq(plain.node('doc', null, [plain.node('paragraph')]))).toBe(true);
    // A heading button in a schema without headings would press nothing.
    expect(buttons(host).map((b) => b.dataset['action'])).toEqual(['bold', 'undo', 'redo']);
  });

  it('starts in the starter schema when given nothing', () => {
    @Component({
      selector: 'v-page-empty',
      imports: [VEditor],
      render: compileTemplate(`<v-editor :ref="editor" label="Notes"></v-editor>`),
    })
    class EmptyPage {
      editor: VEditor | null = null;
    }
    const { instance } = show(EmptyPage);
    expect(instance.editor!.state.get().doc.eq(doc(p()))).toBe(true);
  });

  it('refuses a schema and a document that disagree', () => {
    const other = new Schema({ nodes: { doc: { content: 'text*' }, text: {} } });
    @Component({
      selector: 'v-page-disagree',
      imports: [VEditor],
      render: compileTemplate(`<v-editor :value="notes" :schema="schema"></v-editor>`),
    })
    class Disagree {
      notes = new Signal.State(doc(p(t('Hello'))));
      schema = other;
    }
    expect(() => show(Disagree)).toThrow(/a schema and a document from another one/);
  });

  it('refuses a document from another schema written in later, and keeps the one it has', () => {
    const reported = vi.spyOn(console, 'error').mockImplementation(() => {});
    const other = new Schema({ nodes: { doc: { content: 'text*' }, text: {} } });
    const { instance, host } = show(Page);
    instance.notes.set(other.node('doc', null, [other.text('x')]));
    flushSync();
    expect(reported.mock.calls.some((call) => call.some((part) => /different schema/.test(String(part))))).toBe(true);
    expect(surface(host).innerHTML).toBe('<p>Hello</p>');
    expect(instance.editor!.state.get().doc.type.schema).toBe(basicSchema);
  });
});

describe('the toolbar', () => {
  it('is a named toolbar of toggles for the starter schema’s marks and blocks, and undo and redo', () => {
    const { host } = show(Page);
    expect(toolbar(host).getAttribute('role')).toBe('toolbar');
    expect(toolbar(host).getAttribute('aria-label')).toBe('Formatting');
    expect(toolbar(host).getAttribute('aria-controls')).toBe(surface(host).id);
    expect(buttons(host).map((b) => b.getAttribute('aria-label'))).toEqual([
      'Bold',
      'Italic',
      'Code',
      'Heading 1',
      'Heading 2',
      'Heading 3',
      'Bulleted list',
      'Numbered list',
      'Quote',
      'Undo',
      'Redo',
    ]);
    // Drawn as the toggle group draws its rows.
    const rows = [...host.querySelectorAll('.volt-toggle-group')];
    expect(rows.map((row) => row.querySelectorAll('.volt-toggle').length)).toEqual([3, 6, 2]);
    expect(rows.every((row) => row.getAttribute('data-orientation') === 'horizontal')).toBe(true);
    expect(buttons(host).every((b) => b.type === 'button')).toBe(true);
    // A toggle says whether it is down; an act like undo has no state to say.
    expect(button(host, 'bold').getAttribute('aria-pressed')).toBe('false');
    expect(button(host, 'undo').hasAttribute('aria-pressed')).toBe(false);
  });

  it('takes its names from the caller, in their language', () => {
    @Component({
      selector: 'v-page-labels',
      imports: [VEditor],
      render: compileTemplate(`<v-editor :labels="words"></v-editor>`),
    })
    class Labelled {
      words = {
        toolbar: 'Formatierung',
        bold: 'Fett',
        heading: (level: number) => `Überschrift ${level}`,
        undo: 'Rückgängig',
      };
    }
    const { host } = show(Labelled);
    expect(toolbar(host).getAttribute('aria-label')).toBe('Formatierung');
    expect(button(host, 'bold').getAttribute('aria-label')).toBe('Fett');
    expect(button(host, 'heading-2').getAttribute('aria-label')).toBe('Überschrift 2');
    expect(button(host, 'undo').getAttribute('aria-label')).toBe('Rückgängig');
    // What the caller left out is still said.
    expect(button(host, 'italic').getAttribute('aria-label')).toBe('Italic');
  });

  it('draws down the toggles for what is applied at the selection, and follows it', () => {
    const { instance, host } = show(Page);
    const editor = instance.editor!;
    instance.notes.set(doc(h(2, t('Title')), p(t('ab', B), t('cd')), ul(li(p(t('item')))), quote(p(t('said')))));
    flushSync();

    const down = () => buttons(host).filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.dataset['action']);

    select(editor, range(3));
    expect(down()).toEqual(['heading-2']);
    expect(button(host, 'heading-2').getAttribute('data-state')).toBe('on');

    // Inside the bold run: typing there would be bold, so bold is down.
    select(editor, range(9));
    expect(down()).toEqual(['bold']);
    select(editor, range(8, 10));
    expect(down()).toEqual(['bold']);
    select(editor, range(8, 12));
    expect(down()).toEqual([]);

    select(editor, range(17));
    expect(down()).toEqual(['bullet-list']);
    select(editor, range(25));
    expect(down()).toEqual(['blockquote']);
    expect(button(host, 'bold').getAttribute('data-state')).toBe('off');
  });

  it('applies a mark from the toolbar, and takes it off again', () => {
    const { instance, host } = show(Page);
    select(instance.editor!, range(1, 6));
    click(button(host, 'bold'));
    expect(instance.notes.get().eq(doc(p(t('Hello', B))))).toBe(true);
    expect(surface(host).innerHTML).toBe('<p><strong>Hello</strong></p>');
    expect(button(host, 'bold').getAttribute('aria-pressed')).toBe('true');

    click(button(host, 'bold'));
    expect(instance.notes.get().eq(doc(p(t('Hello'))))).toBe(true);
    expect(instance.seen).toHaveLength(2);
  });

  it('refuses a mark at a caret, and says so on the button', () => {
    const { instance, host } = show(Page);
    select(instance.editor!, range(3));
    // The engine keeps no marks for the next character typed, so there is
    // nowhere for bold pressed at a caret to go.
    expect(button(host, 'bold').getAttribute('aria-disabled')).toBe('true');
    expect(button(host, 'bold').hasAttribute('data-disabled')).toBe(true);
    click(button(host, 'bold'));
    expect(instance.seen).toHaveLength(0);
    // The blocks are another matter: the caret's block is what they change.
    expect(button(host, 'heading-1').hasAttribute('aria-disabled')).toBe(false);
  });

  it('says whether a button can be pressed without trying it, so a long selection costs nothing', () => {
    const { instance, host } = show(Page);
    const many = Array.from({ length: 200 }, (_, i) => p(t(`Paragraph ${i}`)));
    instance.notes.set(doc(...many));
    flushSync();
    const end = instance.editor!.state.get().doc.content.size - 1;

    // Trying a command is running it: one step per block for a mark, one
    // replacement per block for a heading, each over the whole document,
    // and that on every move of the caret.
    const tried = vi.spyOn(Transaction.prototype, 'step');
    select(instance.editor!, range(1, end));
    expect(tried).not.toHaveBeenCalled();
    expect(buttons(host).filter((b) => b.hasAttribute('aria-disabled')).map((b) => b.dataset['action'])).toEqual([
      'undo',
      'redo',
    ]);
    tried.mockRestore();

    click(button(host, 'bold'));
    expect(instance.notes.get().eq(doc(...many.map((para) => p(t(para.textContent, B)))))).toBe(true);
  });

  it('draws a block button pressable where its command declines, and a press there does nothing', () => {
    const { instance, host } = show(Page);
    instance.notes.set(doc(ul(li(p(t('item'))))));
    flushSync();
    select(instance.editor!, range(4));
    // An item opens with a paragraph, so it cannot open with a heading; the
    // button says so only by doing nothing, which is the price of not trying
    // every command on every move of the caret.
    expect(button(host, 'heading-1').hasAttribute('aria-disabled')).toBe(false);
    expect(instance.editor!.can('heading-1')).toBe(true);
    click(button(host, 'heading-1'));
    expect(instance.seen).toHaveLength(0);
    expect(surface(host).innerHTML).toBe('<ul><li><p>item</p></li></ul>');
  });

  it('turns the block into a heading and back, a list and a quote and out, each one undo', () => {
    const { instance, host } = show(Page);
    select(instance.editor!, range(3));

    click(button(host, 'heading-1'));
    expect(surface(host).innerHTML).toBe('<h1>Hello</h1>');
    expect(button(host, 'heading-1').getAttribute('aria-pressed')).toBe('true');
    click(button(host, 'heading-1'));
    expect(surface(host).innerHTML).toBe('<p>Hello</p>');

    click(button(host, 'bullet-list'));
    expect(surface(host).innerHTML).toBe('<ul><li><p>Hello</p></li></ul>');
    click(button(host, 'ordered-list'));
    expect(surface(host).innerHTML).toBe('<ol><li><p>Hello</p></li></ol>');
    click(button(host, 'ordered-list'));
    expect(surface(host).innerHTML).toBe('<p>Hello</p>');

    click(button(host, 'blockquote'));
    expect(surface(host).innerHTML).toBe('<blockquote><p>Hello</p></blockquote>');
    // The caret went in with the block, so the next press finds it inside.
    expect(button(host, 'blockquote').getAttribute('aria-pressed')).toBe('true');

    click(button(host, 'undo'));
    expect(surface(host).innerHTML).toBe('<p>Hello</p>');
    click(button(host, 'undo'));
    expect(surface(host).innerHTML).toBe('<ol><li><p>Hello</p></li></ol>');
    click(button(host, 'redo'));
    expect(surface(host).innerHTML).toBe('<p>Hello</p>');
  });

  it('runs undo and redo when there is something to take back, and says when there is not', () => {
    const { instance, host } = show(Page);
    expect(button(host, 'undo').getAttribute('aria-disabled')).toBe('true');
    expect(button(host, 'redo').getAttribute('aria-disabled')).toBe('true');
    select(instance.editor!, range(6));
    type(host, '!');
    expect(button(host, 'undo').hasAttribute('aria-disabled')).toBe(false);

    click(button(host, 'undo'));
    expect(instance.notes.get().eq(doc(p(t('Hello'))))).toBe(true);
    expect(button(host, 'undo').getAttribute('aria-disabled')).toBe('true');
    expect(button(host, 'redo').hasAttribute('aria-disabled')).toBe(false);
  });

  it('leaves focus where it was when a button is pressed with a pointer', () => {
    const { host } = show(Page);
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    button(host, 'heading-1').dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
  });

  it('holds one tab stop, and the arrows, Home and End move between the buttons that can be pressed', () => {
    const { instance, host } = show(Page);
    select(instance.editor!, range(3));
    const stops = () => buttons(host).filter((b) => b.getAttribute('tabindex') === '0').map((b) => b.dataset['action']);

    // At a caret the marks cannot be pressed, so the stop is the first block.
    expect(stops()).toEqual(['heading-1']);
    button(host, 'heading-1').focus();
    flushSync();

    keydown(document.activeElement!, { key: 'ArrowRight' });
    expect((document.activeElement as HTMLElement).dataset['action']).toBe('heading-2');
    expect(stops()).toEqual(['heading-2']);

    keydown(document.activeElement!, { key: 'End' });
    expect((document.activeElement as HTMLElement).dataset['action']).toBe('blockquote');
    keydown(document.activeElement!, { key: 'Home' });
    expect((document.activeElement as HTMLElement).dataset['action']).toBe('heading-1');
    // Past the start, round to the end: undo and redo have nothing to do yet,
    // and a button that cannot be pressed is stepped over.
    keydown(document.activeElement!, { key: 'ArrowLeft' });
    expect((document.activeElement as HTMLElement).dataset['action']).toBe('blockquote');
  });

  it('presses a button from the keyboard as a button presses', () => {
    const { instance, host } = show(Page);
    select(instance.editor!, range(3));
    button(host, 'heading-2').focus();
    // A space or a return on a focused button is the browser's click.
    click(button(host, 'heading-2'));
    expect(surface(host).innerHTML).toBe('<h2>Hello</h2>');
  });

  it('gives the caller’s own toolbar the editor’s buttons by name', () => {
    @Component({
      selector: 'v-page-own-toolbar',
      imports: [VEditor],
      render: compileTemplate(`
        <v-editor :ref="editor" :value="notes" label="Notes">
          <template :slot-toolbar="{ run, isOn, can }">
            <button type="button" class="mine" :disabled="!can('bold')" :aria-pressed="String(isOn('bold'))"
                    :click="run('bold')">Strong</button>
          </template>
        </v-editor>
      `),
    })
    class OwnToolbar {
      editor: VEditor | null = null;
      notes = new Signal.State(doc(p(t('Hello'))));
    }

    const { instance, host } = show(OwnToolbar);
    const mine = host.querySelector<HTMLButtonElement>('.mine')!;
    // The default buttons are replaced, and the toolbar round them stays.
    expect(host.querySelectorAll('.volt-toggle')).toHaveLength(0);
    expect(mine.closest('[role="toolbar"]')).toBe(toolbar(host));
    expect(mine.disabled).toBe(true);

    select(instance.editor!, range(1, 6));
    expect(mine.disabled).toBe(false);
    click(mine);
    expect(instance.notes.get().eq(doc(p(t('Hello', B))))).toBe(true);
    expect(mine.getAttribute('aria-pressed')).toBe('true');
  });
});

describe('undo and redo keys', () => {
  it('are the engine’s, and reach what the toolbar did as well as what was typed', () => {
    const { instance, host } = show(Page);
    select(instance.editor!, range(6));
    type(host, '!');
    click(button(host, 'heading-1'));

    keydown(surface(host), { key: 'z', ctrlKey: true });
    expect(instance.notes.get().eq(doc(p(t('Hello!'))))).toBe(true);
    keydown(surface(host), { key: 'z', ctrlKey: true });
    expect(instance.notes.get().eq(doc(p(t('Hello'))))).toBe(true);
    keydown(surface(host), { key: 'z', ctrlKey: true, shiftKey: true });
    expect(instance.notes.get().eq(doc(p(t('Hello!'))))).toBe(true);
  });
});

describe('out of use', () => {
  it('refuses edits, the toolbar and the tab order while disabled, and keeps its history for when it is back', () => {
    const { instance, host } = show(Page);
    const editor = instance.editor!;
    select(editor, range(6));
    type(host, '!');

    instance.off.set(true);
    flushSync();
    const el = surface(host);
    expect(el.getAttribute('contenteditable')).toBe('false');
    expect(el.getAttribute('aria-disabled')).toBe('true');
    expect(el.hasAttribute('tabindex')).toBe(false);
    // Still the same element, with the same document in it.
    expect(editor.view.get()!.dom).toBe(el);
    expect(el.innerHTML).toBe('<p>Hello!</p>');
    expect(buttons(host).every((b) => b.getAttribute('aria-disabled') === 'true')).toBe(true);
    expect(buttons(host).every((b) => b.getAttribute('tabindex') === '-1')).toBe(true);
    // No undo key is bound to a field nobody can type in.
    const key = keydown(el, { key: 'z', ctrlKey: true });
    expect(key.defaultPrevented).toBe(false);
    expect(instance.notes.get().eq(doc(p(t('Hello!'))))).toBe(true);
    editor.run('heading-1');
    expect(instance.notes.get().eq(doc(p(t('Hello!'))))).toBe(true);

    instance.off.set(false);
    flushSync();
    expect(el.getAttribute('contenteditable')).toBe('true');
    expect(el.hasAttribute('aria-disabled')).toBe(false);
    expect(el.hasAttribute('aria-readonly')).toBe(false);
    keydown(el, { key: 'z', ctrlKey: true });
    expect(instance.notes.get().eq(doc(p(t('Hello'))))).toBe(true);
  });

  it('keeps focus where it was when it is made read only and back, with the caret where it was', () => {
    const { instance, host } = show(Page);
    const editor = instance.editor!;
    select(editor, range(3));
    editor.focus();
    flushSync();
    const el = surface(host);
    expect(document.activeElement).toBe(el);

    instance.locked.set(true);
    flushSync();
    // The view is built again over the same element; a writer whose caret
    // was in it is not dropped back at the top of the page.
    expect(document.activeElement).toBe(el);
    expect(editor.state.get().selection.anchor).toBe(3);

    instance.locked.set(false);
    flushSync();
    expect(document.activeElement).toBe(el);
    type(host, '!');
    expect(instance.notes.get().eq(doc(p(t('He!llo'))))).toBe(true);
  });

  it('lets focus go when it is disabled, as a disabled control does, and takes none it did not have', () => {
    const { instance, host } = show(Page);
    instance.editor!.focus();
    flushSync();
    instance.off.set(true);
    flushSync();
    expect(document.activeElement).not.toBe(surface(host));

    const elsewhere = document.createElement('button');
    document.body.append(elsewhere);
    elsewhere.focus();
    instance.off.set(false);
    flushSync();
    instance.locked.set(true);
    flushSync();
    expect(document.activeElement).toBe(elsewhere);
  });

  it('keeps its tab stop and says it is read only, and edits nothing', () => {
    const { instance, host } = show(Page);
    instance.locked.set(true);
    flushSync();
    const el = surface(host);
    expect(el.getAttribute('contenteditable')).toBe('false');
    expect(el.getAttribute('aria-readonly')).toBe('true');
    expect(el.getAttribute('tabindex')).toBe('0');
    expect(el.hasAttribute('aria-disabled')).toBe(false);
    expect(buttons(host).every((b) => b.getAttribute('aria-disabled') === 'true')).toBe(true);

    instance.locked.set(false);
    flushSync();
    expect(el.hasAttribute('aria-readonly')).toBe(false);
    expect(el.hasAttribute('tabindex')).toBe(false);
    expect(el.getAttribute('contenteditable')).toBe('true');
  });
});

describe('the words in an empty editor', () => {
  it('are shown while the document is one empty paragraph, and go at the first character', () => {
    const { instance, host } = show(Page);
    expect(placeholder(host)).toBeNull();
    instance.notes.set(doc(p()));
    flushSync();

    const shown = placeholder(host)!;
    expect(shown.textContent).toBe('Write something');
    // Said once, by the editor itself; the words drawn over it are hidden.
    expect(shown.getAttribute('aria-hidden')).toBe('true');
    expect(surface(host).getAttribute('aria-placeholder')).toBe('Write something');

    type(host, 'a');
    expect(placeholder(host)).toBeNull();
  });
});

describe('the message', () => {
  it('shows the caller’s verdict and marks the editor invalid, until the next edit', () => {
    const { instance, host } = show(Page);
    instance.refused.set('Too short.');
    flushSync();
    expect(error(host).textContent).toBe('Too short.');
    expect(surface(host).getAttribute('aria-invalid')).toBe('true');
    expect(surface(host).getAttribute('data-state')).toBe('invalid');

    select(instance.editor!, range(6));
    type(host, '!');
    expect(error(host).textContent).toBe('');
    expect(surface(host).hasAttribute('aria-invalid')).toBe(false);
  });

  it('is set aside while the editor is out of use, and said again once it is back', () => {
    const { instance, host } = show(Page);
    instance.refused.set('Too short.');
    flushSync();
    instance.off.set(true);
    flushSync();
    expect(error(host).textContent).toBe('');
    instance.off.set(false);
    flushSync();
    expect(error(host).textContent).toBe('Too short.');
  });
});

describe('written by a server', () => {
  const serverBuild = (on: boolean): void => {
    (globalThis as { __VOLT_SERVER__?: boolean }).__VOLT_SERVER__ = on;
  };
  beforeAll(() => serverBuild(true));
  afterAll(() => serverBuild(false));

  it('is the document as markup a reader can read, marked read only until the engine loads', async () => {
    @Component({ selector: 'v-editor', render: compileTemplate(template, 'v-editor') })
    class ServerEditor extends VEditor {}

    @Component({
      selector: 'v-page-server',
      imports: [ServerEditor],
      render: compileTemplate(`<v-editor :value="notes" label="Notes"></v-editor>`),
    })
    class ServerPage {
      notes = new Signal.State(doc(h(1, t('Plan')), p(t('Ship '), t('<b>it</b>', B)), ul(li(p(t('soon'))))));
    }

    const { html } = await renderToStaticMarkup(ServerPage);
    // Written twice, the second is a parse error the browser drops.
    for (const tag of html.match(/<[a-z][^>]*>/g) ?? []) {
      const names = [...tag.matchAll(/\s([^\s="'>/]+)(?==|\s|\/?>)/g)].map((match) => match[1]);
      expect(names.filter((name, at) => names.indexOf(name) !== at), tag).toEqual([]);
    }
    const page = document.createElement('div');
    page.innerHTML = html;
    const el = page.querySelector<HTMLElement>('.volt-editor')!;

    expect(el.innerHTML).toBe(
      '<h1>Plan</h1><p>Ship <strong>&lt;b&gt;it&lt;/b&gt;</strong></p><ul><li><p>soon</p></li></ul>',
    );
    expect(el.getAttribute('role')).toBe('textbox');
    expect(el.getAttribute('aria-multiline')).toBe('true');
    expect(el.getAttribute('aria-labelledby')).toBe(page.querySelector('.volt-field-label')!.id);
    expect(el.getAttribute('aria-describedby')).toBe(
      `${page.querySelector('.volt-field-description')!.id} ${page.querySelector('.volt-field-error')!.id}`,
    );
    // Nothing typed into it goes anywhere yet, so it says so, and is not
    // editable at all: a browser would otherwise let a reader type into
    // markup the engine is about to draw over.
    expect(el.getAttribute('aria-readonly')).toBe('true');
    expect(el.getAttribute('tabindex')).toBe('0');
    expect(el.hasAttribute('contenteditable')).toBe(false);
    expect(
      [...page.querySelectorAll('.volt-toggle')].every((b) => b.getAttribute('aria-disabled') === 'true'),
    ).toBe(true);
  });

  it('writes a document with no block in it as a browser shows it: one empty block, and the words over it', async () => {
    const loose = new Schema({
      nodes: { doc: { content: 'paragraph*' }, paragraph: { content: 'text*' }, text: {} },
    });

    @Component({ selector: 'v-editor', render: compileTemplate(template, 'v-editor') })
    class ServerEditor extends VEditor {}

    @Component({
      selector: 'v-page-server-empty',
      imports: [ServerEditor],
      render: compileTemplate(`<v-editor :value="notes" label="Notes" placeholder="Write"></v-editor>`),
    })
    class ServerEmpty {
      notes = new Signal.State<DocNode>(loose.node('doc', null, []));
    }

    // A server runs no effect, so what it writes is the editor's state as it
    // was built.
    const { html } = await renderToStaticMarkup(ServerEmpty);
    const page = document.createElement('div');
    page.innerHTML = html;
    expect(page.querySelector('.volt-editor')!.innerHTML).toBe('<p><br></p>');
    expect(page.querySelector('.volt-editor-placeholder')?.textContent).toBe('Write');
  });
});

describe('the markup a server writes', () => {
  it('writes each node as the starter renderers draw it, the first mark outermost', () => {
    const link = s.mark('link', { href: 'https://example.com/?a=1&b="2"', title: 'Ex' });
    const written = documentMarkup(
      doc(
        h(9, t('Clamped')),
        p(t('x', link, B), s.node('hard_break')),
        s.node('ordered_list', { start: 3 }, [li(p(t('three')))]),
        s.node('code_block', null, [t('a < b')]),
        p(s.node('image', { src: 'a.png', alt: '' })),
        s.node('horizontal_rule'),
        p(),
      ),
    );
    expect(written).toBe(
      '<h6>Clamped</h6>' +
        // Strong is ranked before link in the schema, so it is the outer one —
        // the order `Mark.addToSet` keeps and the view nests by.
        '<p><strong><a href="https://example.com/?a=1&amp;b=&quot;2&quot;" title="Ex">x</a></strong><br><br></p>' +
        '<ol start="3"><li><p>three</p></li></ol>' +
        '<pre><code>a &lt; b</code></pre>' +
        '<p><img src="a.png" alt=""></p>' +
        '<hr>' +
        '<p><br></p>',
    );
  });

  it('writes a heading whose level is no finite number at the first level, as the view draws it', () => {
    // A document from storage carries whatever its attributes were saved as;
    // the schema refuses only names it does not declare.
    const shown = doc(s.node('heading', { level: 'two' }, [t('Named')]), s.node('heading', { level: Infinity }, [t('Far')]));
    expect(documentMarkup(shown)).toBe('<h1>Named</h1><h1>Far</h1>');

    @Component({
      selector: 'v-page-odd-levels',
      imports: [VEditor],
      render: compileTemplate(`<v-editor :value="notes" label="Notes"></v-editor>`),
    })
    class OddLevels {
      notes = new Signal.State<DocNode>(shown);
    }
    const { host } = show(OddLevels);
    expect(surface(host).innerHTML).toBe(documentMarkup(shown));
  });

  it('leaves off a link’s address when following it would run script', () => {
    const linked = (href: string) => documentMarkup(doc(p(t('x', s.mark('link', { href })))));
    for (const href of ['javascript:alert(1)', 'JavaScript:alert(1)', 'java\tscript:alert(1)', ' javascript:x', 'data:text/html,<b>', 'vbscript:x']) {
      expect(linked(href), href).toBe('<p><a>x</a></p>');
    }
    for (const href of ['https://example.com/', 'http://example.com/', '/notes/2', '#top', 'mailto:a@example.com', 'tel:+441234']) {
      expect(linked(href), href).toBe(`<p><a href="${href}">x</a></p>`);
    }
  });

  it('writes a type the starter renderers do not name as the view’s fallback does', () => {
    const custom = new Schema({
      nodes: { doc: { content: 'note+' }, note: { content: 'text*' }, text: {} },
      marks: { shout: {} },
    });
    const written = documentMarkup(
      custom.node('doc', null, [custom.node('note', null, [custom.text('hi', [custom.mark('shout')])])]),
    );
    expect(written).toBe('<div data-node-type="note"><span data-mark-type="shout">hi</span></div>');
  });

  it('is what the engine draws for the same document', () => {
    const { instance, host } = show(Page);
    const shown = doc(h(2, t('A')), p(t('b', B), t('c')), quote(p(t('d'))), ul(li(p(t('e')))));
    instance.notes.set(shown);
    flushSync();
    expect(surface(host).innerHTML).toBe(documentMarkup(shown));
  });

  it('is what the engine draws for every node and mark the starter schema has', () => {
    const { instance, host } = show(Page);
    const link = s.mark('link', { href: 'https://example.com/?a=1&b=2', title: 'Ex' });
    const shown = doc(
      h(1, t('One')),
      h(3, t('Three')),
      p(t('a', s.mark('em')), t('b', s.mark('code')), t('c', link, B), s.node('hard_break'), t('d')),
      p(t('end'), s.node('hard_break')),
      s.node('ordered_list', { start: 4 }, [li(p(t('four')))]),
      s.node('ordered_list', null, [li(p(t('one')))]),
      s.node('code_block', null, [t('a < b && c')]),
      p(s.node('image', { src: 'a.png', alt: 'A', title: 'T' }), s.node('image', { src: 'b.png' })),
      s.node('horizontal_rule'),
      quote(p(t('said'))),
      p(),
    );
    instance.notes.set(shown);
    flushSync();
    expect(surface(host).innerHTML).toBe(documentMarkup(shown));
  });
});

describe('the sheet', () => {
  it('gives every rule an element of what the editor renders to select', () => {
    const { instance, host } = show(Page);
    instance.notes.set(doc(p(t('a'), s.node('image', { src: 'a.png' }))));
    flushSync();
    select(instance.editor!, (d) => NodeSelection.create(d, 2));
    const selectors = [...editorStyles.rules, ...editorStyles.forcedColors].map((rule) => rule.selector);
    const seen = new Set(selectors.filter((selector) => host.querySelector(selector) !== null));

    // The words in an empty editor, in a pass of their own.
    instance.notes.set(doc(p()));
    flushSync();
    for (const selector of selectors) if (host.querySelector(selector)) seen.add(selector);

    expect(selectors.filter((selector) => !seen.has(selector))).toEqual([]);
  });

  it('writes no class the sheets do not declare', () => {
    const declared = new Set([...Object.values(editorStyles.classes), ...Object.values(fieldStyles.classes), 'volt-toggle-group', 'volt-toggle']);
    const written = [...template.matchAll(/\sclass="([^"]*)"/g)].flatMap((match) => match[1]!.split(/\s+/));
    expect(written.filter((name) => name.startsWith('volt-') && !declared.has(name))).toEqual([]);
  });

  it('keeps the box’s spaces, and lays the empty-box words over its first line', () => {
    const style = document.createElement('style');
    style.textContent = `${tokensCss()}\n${rulesToCss([...fieldStyles.rules, ...editorStyles.rules])}`;
    document.head.append(style);
    try {
      const { instance, host } = show(Page);
      instance.notes.set(doc(p()));
      flushSync();
      const box = getComputedStyle(surface(host));
      expect(box.getPropertyValue('white-space')).toBe('pre-wrap');
      const over = getComputedStyle(placeholder(host)!);
      expect(over.getPropertyValue('position')).toBe('absolute');
      expect(over.getPropertyValue('pointer-events')).toBe('none');
      expect(getComputedStyle(surface(host).parentElement!).getPropertyValue('position')).toBe('relative');
    } finally {
      style.remove();
    }
  });
});

/**
 * The cascade a forced palette leaves, measured: the empty-box words in the
 * palette's colour for text that is not content, and a node selected whole
 * outlined in its colour for a selection.
 */
describe('the editor, once the palette is the user’s', () => {
  const forced = styledDocument({ forcedColors: true });
  afterAll(() => forced.close());

  const asTested = (rules: readonly Rule[]): Rule[] =>
    rules.map((rule) => ({
      selector: rule.selector,
      declarations: Object.fromEntries(
        Object.entries(rule.declarations).map(([property, value]) => [
          property,
          SYSTEM_COLORS.includes(value) ? standIn(value) : value,
        ]),
      ),
    }));

  beforeAll(() => {
    forced.addConsumerCss(
      `${rulesToCss(asTested(editorStyles.rules))}\n` +
        wrap(FORCED_COLORS_QUERY, rulesToCss(asTested(editorStyles.forcedColors), '  ')),
    );
  });

  it('draws the empty-box words in `GrayText`', () => {
    const words = forced.mount({ classes: ['volt-editor-placeholder'], text: 'Write something' });
    const style = words.ownerDocument.defaultView!.getComputedStyle(words);
    expect(style.getPropertyValue('color')).toBe(standIn('GrayText'));
  });

  it('outlines a node selected whole in `Highlight`', () => {
    const box = forced.mount({
      classes: ['volt-editor'],
      children: [{ tag: 'img', classes: ['volt-selected-node'] }],
    });
    const image = box.querySelector('img')!;
    const style = image.ownerDocument.defaultView!.getComputedStyle(image);
    expect(style.getPropertyValue('outline-color')).toBe(standIn('Highlight'));
    expect(style.getPropertyValue('outline-style')).toBe('solid');
  });
});

describe('what a screen reader is told', () => {
  it('hears a disabled editor as unavailable, and not as read only as well', () => {
    const { instance, host } = show(Page);
    instance.off.set(true);
    flushSync();
    const el = surface(host);
    // The engine marks every view it builds out of use `aria-readonly`; a
    // disabled text box is not one that can still be read and copied.
    expect(el.getAttribute('aria-disabled')).toBe('true');
    expect(el.hasAttribute('aria-readonly')).toBe(false);

    instance.off.set(false);
    instance.locked.set(true);
    flushSync();
    expect(el.getAttribute('aria-readonly')).toBe('true');
    expect(el.hasAttribute('aria-disabled')).toBe(false);
  });

  it('hears the empty-box words only while they are shown', () => {
    const { instance, host } = show(Page);
    // A document with text in it: nothing is shown, so nothing is said.
    expect(surface(host).hasAttribute('aria-placeholder')).toBe(false);

    instance.notes.set(doc(p()));
    flushSync();
    expect(surface(host).getAttribute('aria-placeholder')).toBe('Write something');

    type(host, 'a');
    expect(surface(host).hasAttribute('aria-placeholder')).toBe(false);
  });

  it('is told nothing new by a keystroke that changes nothing it is told', () => {
    const { instance, host } = show(Page);
    select(instance.editor!, range(6));
    type(host, '!');
    const el = surface(host);
    const written = vi.spyOn(el, 'setAttribute');
    const removed = vi.spyOn(el, 'removeAttribute');

    // The element being typed into is the one the attributes are on: each
    // write is a mutation of the editing host in the middle of an edit.
    type(host, '?');
    expect(instance.notes.get().eq(doc(p(t('Hello!?'))))).toBe(true);
    expect(written).not.toHaveBeenCalled();
    expect(removed).not.toHaveBeenCalled();
  });

  it('leaves an `aria-placeholder` of the caller’s own where they put it', () => {
    @Component({
      selector: 'v-page-own-placeholder',
      imports: [VEditor],
      render: compileTemplate(`<v-editor label="Notes" aria-placeholder="Say what changed"></v-editor>`),
    })
    class OwnPlaceholder {}

    const { host } = show(OwnPlaceholder);
    expect(surface(host).getAttribute('aria-placeholder')).toBe('Say what changed');
  });
});

describe('a link whose address would run script', () => {
  it('is drawn without its address by the engine too, so a reader cannot follow it', () => {
    const { instance, host } = show(Page);
    // Read only is where a press on a link is followed, and a document is
    // often one reader's writing opened by another.
    instance.locked.set(true);
    flushSync();
    const linked = (href: string) => t('x', s.mark('link', { href, title: 'T' }));
    const shown = doc(p(linked('javascript:alert(1)'), t(' '), linked('https://example.com/')));
    instance.notes.set(shown);
    flushSync();

    expect(surface(host).innerHTML).toBe(
      '<p><a title="T">x</a> <a href="https://example.com/" title="T">x</a></p>',
    );
    // What the engine draws is what a server wrote before it loaded.
    expect(surface(host).innerHTML).toBe(documentMarkup(shown));
  });
});

describe('the toolbar’s names from a locale', () => {
  it('are the catalogue’s, under the keys the reference gives, and English where it has none', () => {
    @Component({
      selector: 'v-page-catalogue',
      imports: [VEditor],
      render: compileTemplate(`<v-editor label="Notizen"></v-editor>`),
    })
    class Catalogue {
      locale = createLocaleProvider({
        defaultLocale: 'de',
        messages: {
          formatting: 'Formatierung',
          bold: 'Fett',
          heading: 'Überschrift {n}',
          bulletList: 'Aufzählung',
          quote: 'Zitat',
          redo: 'Wiederholen',
        },
      });
    }

    const { host } = show(Catalogue);
    expect(toolbar(host).getAttribute('aria-label')).toBe('Formatierung');
    expect(buttons(host).map((b) => b.getAttribute('aria-label'))).toEqual([
      'Fett',
      'Italic',
      'Code',
      'Überschrift 1',
      'Überschrift 2',
      'Überschrift 3',
      'Aufzählung',
      'Numbered list',
      'Zitat',
      'Undo',
      'Wiederholen',
    ]);
  });
});

describe('the label and the help as markup', () => {
  it('are taken from the slots, and still name and describe the box', () => {
    @Component({
      selector: 'v-page-slots',
      imports: [VEditor],
      render: compileTemplate(`
        <v-editor>
          <template :slot-label>Notes <abbr title="required">*</abbr></template>
          <template :slot-description>See the <a href="/guide">guide</a>.</template>
        </v-editor>
      `),
    })
    class Slotted {}

    const { host } = show(Slotted);
    expect(label(host).querySelector('abbr')!.textContent).toBe('*');
    expect(hint(host).querySelector('a')!.getAttribute('href')).toBe('/guide');
    expect(surface(host).getAttribute('aria-labelledby')).toBe(label(host).id);
    expect(surface(host).getAttribute('aria-describedby')!.split(' ')[0]).toBe(hint(host).id);
  });
});

describe('a disabled editor, written by a server', () => {
  const serverBuild = (on: boolean): void => {
    (globalThis as { __VOLT_SERVER__?: boolean }).__VOLT_SERVER__ = on;
  };
  beforeAll(() => serverBuild(true));
  afterAll(() => serverBuild(false));

  it('says it is unavailable rather than read only, and keeps no tab stop', async () => {
    @Component({ selector: 'v-editor', render: compileTemplate(template, 'v-editor') })
    class ServerEditor extends VEditor {}

    @Component({
      selector: 'v-page-server-disabled',
      imports: [ServerEditor],
      render: compileTemplate(`<v-editor :value="notes" label="Notes" disabled></v-editor>`),
    })
    class ServerPage {
      notes = new Signal.State(doc(p(t('Hello'))));
    }

    const { html } = await renderToStaticMarkup(ServerPage);
    const page = document.createElement('div');
    page.innerHTML = html;
    const el = page.querySelector<HTMLElement>('.volt-editor')!;
    expect(el.innerHTML).toBe('<p>Hello</p>');
    expect(el.getAttribute('aria-disabled')).toBe('true');
    expect(el.hasAttribute('aria-readonly')).toBe(false);
    expect(el.hasAttribute('tabindex')).toBe(false);
  });
});

describe('the toolbar’s tab stop', () => {
  it('moves to a button focused by Tab or a press, not only by the arrows', () => {
    const { instance, host } = show(Page);
    select(instance.editor!, range(3));
    const stops = () => buttons(host).filter((b) => b.getAttribute('tabindex') === '0').map((b) => b.dataset['action']);
    expect(stops()).toEqual(['heading-1']);

    // Focus that arrived some other way than the toolbar's own keys: a
    // shift-Tab back into the row, or a press that was not held.
    button(host, 'blockquote').focus();
    flushSync();
    expect(stops()).toEqual(['blockquote']);
  });
});

describe('read only, as the field hears it', () => {
  it('marks the field read only, and sets the caller’s verdict aside until it is back in use', () => {
    const { instance, host } = show(Page);
    const field = host.querySelector<HTMLElement>('.volt-field')!;
    instance.refused.set('Too short.');
    flushSync();
    expect(error(host).textContent).toBe('Too short.');

    // A verdict against text nobody can change is one nobody can act on.
    instance.locked.set(true);
    flushSync();
    expect(field.hasAttribute('data-readonly')).toBe(true);
    expect(error(host).textContent).toBe('');
    expect(surface(host).hasAttribute('aria-invalid')).toBe(false);

    instance.locked.set(false);
    flushSync();
    expect(field.hasAttribute('data-readonly')).toBe(false);
    expect(error(host).textContent).toBe('Too short.');
  });

  it('marks the field disabled as well as the box', () => {
    const { instance, host } = show(Page);
    instance.off.set(true);
    flushSync();
    expect(host.querySelector('.volt-field')!.hasAttribute('data-disabled')).toBe(true);
  });
});

describe('a tab stop of the caller’s own', () => {
  it('is left where they wrote it, once the engine has loaded', () => {
    @Component({
      selector: 'v-page-own-tabindex',
      imports: [VEditor],
      render: compileTemplate(`<v-editor label="Notes" tabindex="-1" :readOnly="locked.get()"></v-editor>`),
    })
    class OwnTabStop {
      locked = new Signal.State(false);
    }

    // A page managing focus itself — an editor inside a composite widget —
    // takes the box out of the tab order, and an editable one has no opinion
    // about that to write over it with.
    const { instance, host } = show(OwnTabStop);
    expect(surface(host).getAttribute('contenteditable')).toBe('true');
    expect(surface(host).getAttribute('tabindex')).toBe('-1');

    // Read only, the editor would put the box in the tab order itself; the
    // page's own placing still wins, and survives the way back.
    instance.locked.set(true);
    flushSync();
    expect(surface(host).getAttribute('tabindex')).toBe('-1');
    instance.locked.set(false);
    flushSync();
    expect(surface(host).getAttribute('tabindex')).toBe('-1');
  });

  it('is taken as a number when it is bound to one', () => {
    @Component({
      selector: 'v-page-bound-tabindex',
      imports: [VEditor],
      render: compileTemplate(`<v-editor label="Notes" :tabindex="order.get()"></v-editor>`),
    })
    class BoundTabStop {
      order = new Signal.State<number | undefined>(-1);
    }

    const { instance, host } = show(BoundTabStop);
    expect(surface(host).getAttribute('tabindex')).toBe('-1');
    // Unsaid again: the box is live and editable, so it has no opinion either.
    instance.order.set(undefined);
    flushSync();
    expect(surface(host).hasAttribute('tabindex')).toBe(false);
  });

  it('is the box’s own while the page has written none', () => {
    const { instance, host } = show(Page);
    expect(surface(host).hasAttribute('tabindex')).toBe(false);
    instance.locked.set(true);
    flushSync();
    expect(surface(host).getAttribute('tabindex')).toBe('0');
  });
});

/** An input method's event, with what it composed: happy-dom drops `data` from the init. */
function composition(el: Element, type: 'compositionstart' | 'compositionend', data?: string): void {
  const event = new CompositionEvent(type, { bubbles: true });
  if (data !== undefined) (event as { data: string }).data = data;
  el.dispatchEvent(event);
  flushSync();
}

describe('a toolbar of the page’s own, from the keyboard', () => {
  it('leaves the arrows, Home and End to a text field in it, and moves between the buttons it marks as items', () => {
    @Component({
      selector: 'v-page-own-fields',
      imports: [VEditor],
      render: compileTemplate(`
        <v-editor label="Notes">
          <template :slot-toolbar="{ run }">
            <button type="button" class="first" data-volt-item :click="run('bold')">Strong</button>
            <button type="button" class="second" data-volt-item :click="run('italic')">Slanted</button>
            <input class="address" aria-label="Link address" value="https://example.com">
          </template>
        </v-editor>
      `),
    })
    class OwnFields {}

    const { host } = show(OwnFields);
    // A link's address typed into the toolbar: the keys that move its caret
    // are its own, and taking them would leave it a field nobody can edit.
    const address = host.querySelector<HTMLInputElement>('.address')!;
    address.focus();
    for (const key of ['ArrowLeft', 'ArrowRight', 'Home', 'End']) {
      expect(keydown(address, { key }).defaultPrevented, key).toBe(false);
      expect(document.activeElement, key).toBe(address);
    }

    // Buttons marked as the toolbar's items still move with the arrows.
    const first = host.querySelector<HTMLButtonElement>('.first')!;
    first.focus();
    flushSync();
    expect(keydown(first, { key: 'ArrowRight' }).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(host.querySelector('.second'));
  });
});

describe('a press while an input method is composing', () => {
  it('waits for the composition to finish, and leaves the text being composed where the input method wrote it', () => {
    const { instance, host } = show(Page);
    select(instance.editor!, range(6));
    instance.editor!.focus();
    flushSync();
    const el = surface(host);
    const block = el.firstElementChild!;
    const composing = block.firstChild as Text;

    composition(el, 'compositionstart');
    composing.data = 'Helloか';
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    button(host, 'heading-1').dispatchEvent(down);
    click(button(host, 'heading-1'));
    // The browser owns that text until the composition ends: drawn as a
    // heading now, the paragraph would be taken out of the page under it.
    expect(el.firstElementChild).toBe(block);
    expect(composing.isConnected).toBe(true);
    expect(instance.seen).toHaveLength(0);

    composition(el, 'compositionend', 'か');
    expect(instance.notes.get().eq(doc(h(1, t('Helloか'))))).toBe(true);
    expect(el.innerHTML).toBe('<h1>Helloか</h1>');
    // The composed word, then the heading: two things, each one undo.
    expect(instance.seen).toHaveLength(2);
    keydown(el, { key: 'z', ctrlKey: true });
    expect(instance.notes.get().eq(doc(p(t('Helloか'))))).toBe(true);
  });

  it('makes every press made meanwhile, in the order they were made', () => {
    const { instance, host } = show(Page);
    select(instance.editor!, range(6));
    const el = surface(host);

    composition(el, 'compositionstart');
    click(button(host, 'heading-2'));
    click(button(host, 'blockquote'));
    expect(el.innerHTML).toBe('<p>Hello</p>');

    composition(el, 'compositionend', '!');
    expect(instance.notes.get().eq(doc(quote(h(2, t('Hello!')))))).toBe(true);
  });

  it('is dropped if the editor goes out of use before the composition ends, even if it is back by then', () => {
    const { instance, host } = show(Page);
    select(instance.editor!, range(6));
    const el = surface(host);

    composition(el, 'compositionstart');
    click(button(host, 'heading-1'));
    // The view the press was made in is taken down, composition and all.
    instance.locked.set(true);
    flushSync();
    instance.locked.set(false);
    flushSync();
    composition(el, 'compositionend', '');
    expect(instance.notes.get().eq(doc(p(t('Hello'))))).toBe(true);
  });
});

describe('the markup a server writes, for a schema of the page’s own', () => {
  it('closes a leaf the starter renderers do not name, as the view draws it', () => {
    const custom = new Schema({
      nodes: {
        doc: { content: 'block+' },
        paragraph: { content: 'inline*', group: 'block' },
        divider: { group: 'block' },
        mention: { group: 'inline', inline: true, attrs: { id: { default: '' } } },
        text: { group: 'inline' },
      },
    });
    const shown = custom.node('doc', null, [
      custom.node('paragraph', null, [custom.text('Hi '), custom.node('mention', { id: 'ada' }), custom.text(' there')]),
      custom.node('divider'),
      custom.node('paragraph', null, [custom.text('after')]),
    ]);

    // Read as a browser reads it: an element left open takes in everything
    // after it, so the words after a mention would be in the mention and
    // every block after a divider inside the divider.
    const read = document.createElement('div');
    read.innerHTML = documentMarkup(shown);
    expect(read.innerHTML).toBe(
      '<p>Hi <span data-node-type="mention"></span> there</p><div data-node-type="divider"></div><p>after</p>',
    );

    @Component({
      selector: 'v-page-own-leaves',
      imports: [VEditor],
      render: compileTemplate(`<v-editor :value="notes" label="Notes"></v-editor>`),
    })
    class OwnLeaves {
      notes = new Signal.State<DocNode>(shown);
    }
    const { host } = show(OwnLeaves);
    expect(surface(host).innerHTML).toBe(read.innerHTML);
  });
});

describe('an equal document written back', () => {
  it('draws nothing again, so a composition running meanwhile keeps its text', () => {
    const { instance, host } = show(Page);
    select(instance.editor!, range(6));
    const el = surface(host);
    const block = el.firstElementChild!;
    const composing = block.firstChild as Text;

    composition(el, 'compositionstart');
    composing.data = 'Helloか';
    // The page's own value back from a store that copies what it keeps:
    // equal to what is on screen, and not the same object.
    instance.notes.set(doc(p(t('Hello'))));
    flushSync();
    expect(el.firstElementChild).toBe(block);
    expect(composing.isConnected).toBe(true);

    composition(el, 'compositionend', 'か');
    expect(instance.notes.get().eq(doc(p(t('Helloか'))))).toBe(true);
    expect(el.innerHTML).toBe('<p>Helloか</p>');
    expect(instance.editor!.state.get().selection.anchor).toBe(7);
  });
});

describe('text in another language, or running the other way', () => {
  it('marks the box and the words shown in it while empty, and leaves the label and the toolbar the page’s', () => {
    @Component({
      selector: 'v-page-right-to-left',
      imports: [VEditor],
      render: compileTemplate(`<v-editor dir="rtl" lang="ar" label="Notes" placeholder="اكتب شيئًا"></v-editor>`),
    })
    class RightToLeft {}

    const { host } = show(RightToLeft);
    const marked = (el: Element, name: string) => el.closest(`[${name}]`)?.getAttribute(name) ?? null;
    // The words are laid over the box, so they have to start where its caret
    // does: under the page's direction they sat at the other edge from it.
    for (const el of [surface(host), placeholder(host)!]) {
      expect(marked(el, 'dir')).toBe('rtl');
      expect(marked(el, 'lang')).toBe('ar');
    }
    for (const el of [label(host), toolbar(host), hint(host)]) {
      expect(marked(el, 'dir')).not.toBe('rtl');
      expect(marked(el, 'lang')).not.toBe('ar');
    }
  });
});

describe('the caller’s verdict, once an edit has let go of it', () => {
  it('stays gone when the editor goes out of use and comes back', () => {
    const { instance, host } = show(Page);
    instance.refused.set('Too short.');
    flushSync();
    select(instance.editor!, range(6));
    type(host, '!');
    expect(error(host).textContent).toBe('');

    instance.off.set(true);
    flushSync();
    instance.off.set(false);
    flushSync();
    // Said again, it would be a verdict on text that has changed since.
    expect(error(host).textContent).toBe('');
    expect(surface(host).hasAttribute('aria-invalid')).toBe(false);
  });
});

describe('the arrows, from a button that stopped being pressable while it had focus', () => {
  /** Undo, pressed from the keyboard until there is nothing left to take back. */
  function undoneToNothing(host: HTMLElement, editor: VEditor): HTMLButtonElement {
    select(editor, range(6));
    type(host, '!');
    const undo = button(host, 'undo');
    undo.focus();
    flushSync();
    click(undo);
    return undo;
  }
  const focused = () => (document.activeElement as HTMLElement).dataset['action'];

  it('move to the pressable button beside it, and the tab stop stays with focus until it leaves', () => {
    const { instance, host } = show(Page);
    const stops = () => buttons(host).filter((b) => b.getAttribute('tabindex') === '0').map((b) => b.dataset['action']);
    const undo = undoneToNothing(host, instance.editor!);
    expect(undo.getAttribute('aria-disabled')).toBe('true');
    expect(focused()).toBe('undo');
    // The row's one stop is where focus is: elsewhere, shift-Tab would stop on
    // another button of the row on the way out of it.
    expect(stops()).toEqual(['undo']);

    // Counted from none of the buttons that can be pressed, a move started
    // again at an end of the row.
    keydown(undo, { key: 'ArrowRight' });
    expect(focused()).toBe('redo');
    undo.focus();
    flushSync();
    keydown(undo, { key: 'ArrowLeft' });
    expect(focused()).toBe('blockquote');

    // Once focus has gone, the stop goes to a button that can be pressed.
    undo.focus();
    flushSync();
    surface(host).focus();
    flushSync();
    expect(stops()).toEqual(['heading-1']);
  });

  it('read the arrows in the direction the row runs', () => {
    @Component({
      selector: 'v-page-rtl-toolbar',
      imports: [VEditor],
      render: compileTemplate(`<div dir="rtl"><v-editor :ref="editor" :value="notes" label="Notes"></v-editor></div>`),
    })
    class RightToLeftRow {
      editor: VEditor | null = null;
      notes = new Signal.State(doc(p(t('Hello'))));
    }

    const { instance, host } = show(RightToLeftRow);
    const undo = undoneToNothing(host, instance.editor!);
    // Right to left, the left arrow moves on through the row.
    keydown(undo, { key: 'ArrowLeft' });
    expect(focused()).toBe('redo');
    undo.focus();
    flushSync();
    keydown(undo, { key: 'ArrowRight' });
    expect(focused()).toBe('blockquote');
  });
});

describe('a different document loaded while an input method is composing', () => {
  it('drops what the composition commits, and the presses held for the document that went', () => {
    const { instance, host } = show(Page);
    select(instance.editor!, range(6));
    const el = surface(host);
    composition(el, 'compositionstart');
    (el.firstElementChild!.firstChild as Text).data = 'Helloか';
    click(button(host, 'heading-1'));

    // The word was being written into the document that went: committed now,
    // it would land at the start of the one that came, and the heading
    // pressed for the old one would turn the new one's first block.
    const other = doc(p(t('Other')), p(t('note')));
    instance.notes.set(other);
    flushSync();
    composition(el, 'compositionend', 'か');

    expect(instance.notes.get().eq(other)).toBe(true);
    expect(el.innerHTML).toBe('<p>Other</p><p>note</p>');
    expect(instance.seen).toHaveLength(0);
  });

  it('makes a press made after the document arrived, against that document', () => {
    const { instance, host } = show(Page);
    select(instance.editor!, range(6));
    const el = surface(host);
    composition(el, 'compositionstart');
    instance.notes.set(doc(p(t('Other')), p(t('note'))));
    flushSync();
    click(button(host, 'heading-2'));
    composition(el, 'compositionend', 'か');
    expect(instance.notes.get().eq(doc(h(2, t('Other')), p(t('note'))))).toBe(true);
    expect(instance.seen).toHaveLength(1);
  });

  it('keeps the caret where a click that ended it put it, in the document that came', () => {
    const { instance, host } = show(Page);
    select(instance.editor!, range(6));
    instance.editor!.focus();
    flushSync();
    const el = surface(host);
    composition(el, 'compositionstart');
    instance.notes.set(doc(p(t('Other')), p(t('note'))));
    flushSync();
    // Only what the composition commits is dropped: the caret a click moves
    // is the writer's, wherever the text went.
    const second = el.children[1]!.firstChild as Text;
    document.getSelection()!.setBaseAndExtent(second, 2, second, 2);
    composition(el, 'compositionend', 'か');
    expect(instance.notes.get().eq(doc(p(t('Other')), p(t('note'))))).toBe(true);
    expect(instance.editor!.state.get().selection.anchor).toBe(10);
  });
});

describe('a composition the editor goes out of use under', () => {
  it('commits nothing into an editor made read only meanwhile', () => {
    const { instance, host } = show(Page);
    select(instance.editor!, range(6));
    const el = surface(host);
    composition(el, 'compositionstart');
    instance.locked.set(true);
    flushSync();
    composition(el, 'compositionend', 'か');
    expect(instance.notes.get().eq(doc(p(t('Hello'))))).toBe(true);
    expect(el.innerHTML).toBe('<p>Hello</p>');
    expect(instance.seen).toHaveLength(0);
  });

  it('commits nothing into an editor disabled meanwhile', () => {
    const { instance, host } = show(Page);
    select(instance.editor!, range(6));
    const el = surface(host);
    composition(el, 'compositionstart');
    instance.off.set(true);
    flushSync();
    composition(el, 'compositionend', 'か');
    expect(instance.notes.get().eq(doc(p(t('Hello'))))).toBe(true);
    expect(instance.seen).toHaveLength(0);
  });

  it('commits nothing once the editor is back either, as the view it was composed in was taken down', () => {
    const { instance, host } = show(Page);
    select(instance.editor!, range(6));
    const el = surface(host);
    composition(el, 'compositionstart');
    instance.locked.set(true);
    flushSync();
    instance.locked.set(false);
    flushSync();
    composition(el, 'compositionend', 'か');
    expect(instance.notes.get().eq(doc(p(t('Hello'))))).toBe(true);
    expect(el.innerHTML).toBe('<p>Hello</p>');
  });

  it('leaves what the new view is asked for to be done', () => {
    const { instance, host } = show(Page);
    select(instance.editor!, range(1, 6));
    const el = surface(host);
    // One composition heard to its end first: nothing of it outlives it.
    composition(el, 'compositionstart');
    composition(el, 'compositionend', '');
    composition(el, 'compositionstart');
    instance.locked.set(true);
    flushSync();
    instance.locked.set(false);
    flushSync();
    // The view built again knows of no composition, so a press is made now.
    click(button(host, 'bold'));
    expect(instance.notes.get().eq(doc(p(t('Hello', B))))).toBe(true);
    composition(el, 'compositionend', 'か');
    expect(instance.notes.get().eq(doc(p(t('Hello', B))))).toBe(true);
    expect(instance.seen).toHaveLength(1);
  });
});

describe('the words in an empty editor, while an input method composes', () => {
  it('are taken away while it composes, and come back if it leaves nothing', () => {
    const { instance, host } = show(Page);
    instance.notes.set(doc(p()));
    flushSync();
    const el = surface(host);

    composition(el, 'compositionstart');
    // What it is writing is on screen and not yet in the document, so the
    // words would be drawn over it.
    expect(placeholder(host)).toBeNull();
    expect(el.hasAttribute('aria-placeholder')).toBe(false);

    composition(el, 'compositionend', '');
    expect(placeholder(host)).not.toBeNull();
    expect(el.getAttribute('aria-placeholder')).toBe('Write something');
  });
});

describe('a tab stop of the caller’s own, on a disabled editor', () => {
  it('gives way, as a disabled control’s does, and comes back with it', () => {
    @Component({
      selector: 'v-page-own-tabindex-disabled',
      imports: [VEditor],
      render: compileTemplate(`<v-editor label="Notes" tabindex="0" :disabled="off.get()"></v-editor>`),
    })
    class OwnTabStopDisabled {
      off = new Signal.State(true);
    }

    const { instance, host } = show(OwnTabStopDisabled);
    expect(surface(host).getAttribute('aria-disabled')).toBe('true');
    expect(surface(host).hasAttribute('tabindex')).toBe(false);
    instance.off.set(false);
    flushSync();
    expect(surface(host).getAttribute('tabindex')).toBe('0');
  });
});

describe('a mark button, over a node selected whole', () => {
  it('says it cannot be pressed, since an image holds no text to mark', () => {
    const { instance, host } = show(Page);
    instance.notes.set(doc(p(t('a'), s.node('image', { src: 'a.png' }), t('b'))));
    flushSync();
    select(instance.editor!, (d) => NodeSelection.create(d, 2));
    for (const mark of ['bold', 'italic', 'code']) {
      expect(button(host, mark).getAttribute('aria-disabled'), mark).toBe('true');
      expect(instance.editor!.can(mark as 'bold'), mark).toBe(false);
    }
    // The paragraph the image is in is what the block buttons change.
    expect(button(host, 'heading-1').hasAttribute('aria-disabled')).toBe(false);
  });
});

describe('what is not built', () => {
  it('binds no key to a mark: Ctrl-B and Ctrl-I over a selection change nothing, and are left to the page', () => {
    const { instance, host } = show(Page);
    select(instance.editor!, range(1, 6));
    for (const key of [{ key: 'b', ctrlKey: true }, { key: 'i', ctrlKey: true }, { key: 'b', metaKey: true }]) {
      expect(keydown(surface(host), key).defaultPrevented, key.key).toBe(false);
    }
    expect(instance.notes.get().eq(doc(p(t('Hello'))))).toBe(true);
    expect(instance.seen).toHaveLength(0);
  });

  it('posts nothing with a form, and has no name to post under', () => {
    @Component({
      selector: 'v-page-form',
      imports: [VEditor],
      render: compileTemplate(`<form><v-editor :value="notes" label="Notes"></v-editor></form>`),
    })
    class InAForm {
      notes = new Signal.State(doc(p(t('Hello'))));
    }

    const { host } = show(InAForm);
    expect([...new FormData(host.querySelector('form')!).keys()]).toEqual([]);

    @Component({
      selector: 'v-page-form-named',
      imports: [VEditor],
      render: compileTemplate(`<form><v-editor name="notes" label="Notes"></v-editor></form>`),
    })
    class Named {}
    expect(() => show(Named)).toThrow(/has no prop "name"/);
  });
});

describe('an empty editor, in a schema whose document may hold no block', () => {
  it('starts with a block to type into, the one the schema asks for first', () => {
    const loose = new Schema({
      nodes: { doc: { content: 'paragraph*' }, paragraph: { content: 'text*' }, text: {} },
    });

    @Component({
      selector: 'v-page-loose-schema',
      imports: [VEditor],
      render: compileTemplate(`<v-editor :ref="editor" :schema="schema" label="Loose" placeholder="Write"></v-editor>`),
    })
    class LooseSchema {
      editor: VEditor | null = null;
      schema = loose;
    }

    const { instance, host } = show(LooseSchema);
    // The least the schema allows is no block at all, which leaves a caret
    // nowhere to go and a keystroke nothing to land in.
    expect(instance.editor!.state.get().doc.eq(loose.node('doc', null, [loose.node('paragraph')]))).toBe(true);
    expect(placeholder(host)).not.toBeNull();
    type(host, 'a');
    expect(String(instance.editor!.state.get().doc)).toBe('doc(paragraph("a"))');
  });
});

describe('the arrows, from a button that stopped being pressable, at the edges of the row', () => {
  it('go round past the end, and leave a key with a modifier alone', () => {
    const { instance, host } = show(Page);
    select(instance.editor!, range(6));
    type(host, '!');
    keydown(surface(host), { key: 'z', ctrlKey: true });
    // Redo, pressed until there is nothing left to put back.
    const redo = button(host, 'redo');
    redo.focus();
    flushSync();
    click(redo);
    expect(redo.getAttribute('aria-disabled')).toBe('true');

    // A shortcut, not a move.
    expect(keydown(redo, { key: 'ArrowRight', ctrlKey: true }).defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(redo);
    // At a caret the marks cannot be pressed, so round past the end is the first heading.
    expect(keydown(redo, { key: 'ArrowRight' }).defaultPrevented).toBe(true);
    expect((document.activeElement as HTMLElement).dataset['action']).toBe('heading-1');
  });

  it('read the direction from the computed style where no `dir` is written', () => {
    @Component({
      selector: 'v-page-rtl-styled-toolbar',
      imports: [VEditor],
      render: compileTemplate(`<div style="direction: rtl"><v-editor :ref="editor" :value="notes" label="Notes"></v-editor></div>`),
    })
    class StyledRightToLeft {
      editor: VEditor | null = null;
      notes = new Signal.State(doc(p(t('Hello'))));
    }

    const { instance, host } = show(StyledRightToLeft);
    select(instance.editor!, range(6));
    type(host, '!');
    const undo = button(host, 'undo');
    undo.focus();
    flushSync();
    click(undo);
    keydown(undo, { key: 'ArrowLeft' });
    expect((document.activeElement as HTMLElement).dataset['action']).toBe('redo');
  });

  it('step over a button of the page’s own that is disabled outright', () => {
    @Component({
      selector: 'v-page-own-disabled-items',
      imports: [VEditor],
      render: compileTemplate(`
        <v-editor label="Notes">
          <template :slot-toolbar>
            <button type="button" class="first" data-volt-item>One</button>
            <button type="button" class="second" data-volt-item disabled>Two</button>
            <button type="button" class="third" data-volt-item data-disabled aria-disabled="true">Three</button>
          </template>
        </v-editor>
      `),
    })
    class OwnDisabledItems {}

    const { host } = show(OwnDisabledItems);
    // The third went out of use while it had focus; the second never had any to have.
    const third = host.querySelector<HTMLButtonElement>('.third')!;
    third.focus();
    flushSync();
    keydown(third, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(host.querySelector('.first'));
  });
});

describe('the words in an empty editor, when it goes out of use while an input method composes', () => {
  it('come back at once, since what it was writing went with the view', () => {
    const { instance, host } = show(Page);
    instance.notes.set(doc(p()));
    flushSync();
    composition(surface(host), 'compositionstart');
    expect(placeholder(host)).toBeNull();
    instance.locked.set(true);
    flushSync();
    expect(placeholder(host)).not.toBeNull();
  });
});

describe('presses held for a composition, and the compositions after it', () => {
  it('are made once, not again when a later composition ends', () => {
    const { instance, host } = show(Page);
    select(instance.editor!, range(6));
    const el = surface(host);
    composition(el, 'compositionstart');
    click(button(host, 'heading-1'));
    composition(el, 'compositionend', 'か');
    expect(instance.notes.get().eq(doc(h(1, t('Helloか'))))).toBe(true);

    // Pressed again, the heading would go back to a paragraph.
    composition(el, 'compositionstart');
    composition(el, 'compositionend', '!');
    expect(instance.notes.get().eq(doc(h(1, t('Helloか!'))))).toBe(true);
  });

  it('leave a composition that starts after an orphaned one, which never ended, to commit as usual', () => {
    const { instance, host } = show(Page);
    select(instance.editor!, range(6));
    const el = surface(host);
    composition(el, 'compositionstart');
    instance.locked.set(true);
    flushSync();
    instance.locked.set(false);
    flushSync();
    // No end was heard for that one; this one is written into what is on the page.
    composition(el, 'compositionstart');
    composition(el, 'compositionend', 'か');
    expect(instance.notes.get().eq(doc(p(t('Helloか'))))).toBe(true);
  });
});

describe('a verdict written on the tag', () => {
  it('is said from the start', () => {
    @Component({
      selector: 'v-page-error-on-tag',
      imports: [VEditor],
      render: compileTemplate(`<v-editor label="Notes" error="Too short."></v-editor>`),
    })
    class ErrorOnTag {}

    const { host } = show(ErrorOnTag);
    expect(error(host).textContent).toBe('Too short.');
    expect(surface(host).getAttribute('aria-invalid')).toBe('true');
  });
});

describe('an editor taken off the page', () => {
  it('lets go of its view, and a press made after does nothing', () => {
    const { instance } = show(Page);
    const editor = instance.editor!;
    select(editor, range(1, 6));
    unmount!();
    unmount = null;
    flushSync();
    // A callback left behind by the page — a shortcut, a timer — reaching
    // for a view that is gone would edit the page's document through it.
    expect(editor.view.get()).toBeNull();
    editor.run('bold');
    expect(instance.notes.get().eq(doc(p(t('Hello'))))).toBe(true);
    expect(instance.seen).toHaveLength(0);
  });
});

describe('a press held for a composition that a click elsewhere ends', () => {
  it('is made where it was pressed, and the caret stays where the click put it', () => {
    const { instance, host } = show(Page);
    instance.notes.set(doc(p(t('Hello')), p(t('World'))));
    flushSync();
    select(instance.editor!, range(6));
    instance.editor!.focus();
    flushSync();
    const el = surface(host);
    composition(el, 'compositionstart');
    (el.firstElementChild!.firstChild as Text).data = 'Helloか';
    click(button(host, 'heading-1'));

    // The click that commits the input method lands in the second paragraph.
    const world = el.children[1]!.firstChild as Text;
    document.getSelection()!.setBaseAndExtent(world, 2, world, 2);
    composition(el, 'compositionend', 'か');

    expect(String(instance.notes.get())).toBe(String(doc(h(1, t('Helloか')), p(t('World')))));
    // Wo|rld: the second block starts at 8 once the composed text is in.
    expect(instance.editor!.state.get().selection.anchor).toBe(11);
  });
});

describe('presses held for a composition that a click elsewhere ends, at its edges', () => {
  it('are made in the paragraph a composition over a rule left, not on the rule that went', () => {
    const { instance, host } = show(Page);
    instance.notes.set(doc(p(t('Hello')), s.node('horizontal_rule'), p(t('World'))));
    flushSync();
    select(instance.editor!, (d) => NodeSelection.create(d, 7));
    const el = surface(host);
    composition(el, 'compositionstart');
    click(button(host, 'heading-2'));
    composition(el, 'compositionend', 'か');

    // The rule is a paragraph holding what was composed, and that is what the
    // press was made in, with the caret after the text.
    expect(String(instance.notes.get())).toBe(String(doc(p(t('Hello')), h(2, t('か')), p(t('World')))));
    expect(instance.editor!.state.get().selection.anchor).toBe(9);
  });

  it('are made one after another from where the one before left the selection', () => {
    const { instance, host } = show(Page);
    instance.notes.set(doc(p(t('Hello')), p(t('World'))));
    flushSync();
    select(instance.editor!, range(1, 6));
    const el = surface(host);
    // An input method that gives up commits nothing, and the word it was
    // written over stays selected for the presses held meanwhile.
    composition(el, 'compositionstart');
    click(button(host, 'blockquote'));
    click(button(host, 'bold'));
    const world = el.children[1]!.firstChild as Text;
    document.getSelection()!.setBaseAndExtent(world, 2, world, 2);
    composition(el, 'compositionend', '');

    expect(String(instance.notes.get())).toBe(String(doc(quote(p(t('Hello', B))), p(t('World')))));
    expect(instance.editor!.state.get().selection.anchor).toBe(12);
  });

  it('are made where they were pressed when the click selects an image, which stays selected', () => {
    const { instance, host } = show(Page);
    instance.notes.set(doc(p(t('Hello')), p(t('a'), s.node('image', { src: 'a.png' }))));
    flushSync();
    select(instance.editor!, range(6));
    const el = surface(host);
    composition(el, 'compositionstart');
    click(button(host, 'heading-1'));
    click(el.querySelector('img')!);
    composition(el, 'compositionend', 'か');

    expect(String(instance.notes.get())).toBe(
      String(doc(h(1, t('Helloか')), p(t('a'), s.node('image', { src: 'a.png' })))),
    );
    const selection = instance.editor!.state.get().selection;
    expect(selection instanceof NodeSelection && selection.node.type.name).toBe('image');
  });

  it('are taken back by one undo each, which puts the caret where the press was made', () => {
    const { instance, host } = show(Page);
    instance.notes.set(doc(p(t('Hello')), p(t('World'))));
    flushSync();
    select(instance.editor!, range(6));
    const el = surface(host);
    composition(el, 'compositionstart');
    click(button(host, 'heading-1'));
    const world = el.children[1]!.firstChild as Text;
    document.getSelection()!.setBaseAndExtent(world, 2, world, 2);
    composition(el, 'compositionend', 'か');

    keydown(el, { key: 'z', ctrlKey: true });
    expect(String(instance.notes.get())).toBe(String(doc(p(t('Helloか')), p(t('World')))));
    expect(instance.editor!.state.get().selection.anchor).toBe(7);
  });
});

describe('presses held for a composition, when one of them puts the editor out of use', () => {
  it('stop there, and the rest are not made in the editor built again out of use', () => {
    @Component({
      selector: 'v-page-locks-on-heading',
      imports: [VEditor],
      render: compileTemplate(`
        <v-editor :ref="editor" :value="notes" label="Notes" :readOnly="locked.get()" :onChange="check"></v-editor>
      `),
    })
    class LocksOnHeading {
      editor: VEditor | null = null;
      notes = new Signal.State(doc(p(t('Hello'))));
      locked = new Signal.State(false);
      /** A page that takes a titled note for review at once, and redraws before going on. */
      check = (next: DocNode): void => {
        if (next.firstChild?.type.name !== 'heading') return;
        this.locked.set(true);
        flushSync();
      };
    }

    const { instance, host } = show(LocksOnHeading);
    select(instance.editor!, range(6));
    const el = surface(host);
    composition(el, 'compositionstart');
    click(button(host, 'heading-1'));
    click(button(host, 'blockquote'));
    composition(el, 'compositionend', 'か');
    expect(el.getAttribute('contenteditable')).toBe('false');
    expect(String(instance.notes.get())).toBe(String(doc(h(1, t('Helloか')))));
  });
});

describe('an empty document handed in, in a schema whose document may hold no block', () => {
  const loose = new Schema({
    nodes: { doc: { content: 'paragraph*' }, paragraph: { content: 'text*' }, text: {} },
  });

  @Component({
    selector: 'v-page-empty-given',
    imports: [VEditor],
    render: compileTemplate(`<v-editor :ref="editor" :value="notes" label="Loose" placeholder="Write"></v-editor>`),
  })
  class EmptyGiven {
    editor: VEditor | null = null;
    notes = new Signal.State<DocNode>(loose.node('doc', null, []));
  }

  it('is shown with a block to type into, and the words over it', () => {
    const { instance, host } = show(EmptyGiven);
    // Nothing in it can take a caret or a click, so a keystroke had nowhere
    // to land.
    expect(surface(host).innerHTML).toBe('<p><br></p>');
    expect(placeholder(host)).not.toBeNull();
    // The block is how an empty document is shown, not an edit: the page's
    // value is written at the first one.
    expect(instance.notes.get().childCount).toBe(0);
    type(host, 'a');
    expect(String(instance.notes.get())).toBe('doc(paragraph("a"))');
  });

  it('is shown the same way when it is written in later', () => {
    const { instance, host } = show(EmptyGiven);
    type(host, 'a');
    instance.notes.set(loose.node('doc', null, []));
    flushSync();
    expect(surface(host).innerHTML).toBe('<p><br></p>');
    expect(placeholder(host)).not.toBeNull();
    type(host, 'b');
    expect(String(instance.notes.get())).toBe('doc(paragraph("b"))');
  });

  it('is left on screen when the page writes it in again, and what is being composed in its block is kept', () => {
    const { instance, host } = show(EmptyGiven);
    const el = surface(host);
    composition(el, 'compositionstart');
    // The page's value is the empty document still; its block was never an
    // edit. Loaded again, it took the input method's text with it.
    instance.notes.set(loose.node('doc', null, []));
    flushSync();
    composition(el, 'compositionend', 'か');
    expect(String(instance.notes.get())).toBe('doc(paragraph("か"))');
  });

  it('keeps the attributes of the document it is, at the first edit', () => {
    const titled = new Schema({
      nodes: {
        doc: { content: 'paragraph*', attrs: { title: { default: '' } } },
        paragraph: { content: 'text*' },
        text: {},
      },
    });

    @Component({
      selector: 'v-page-empty-titled',
      imports: [VEditor],
      render: compileTemplate(`<v-editor :value="notes" label="Titled"></v-editor>`),
    })
    class EmptyTitled {
      notes = new Signal.State<DocNode>(titled.node('doc', { title: 'Plans' }, []));
    }

    const { instance, host } = show(EmptyTitled);
    type(host, 'a');
    expect(String(instance.notes.get())).toBe('doc(paragraph("a"))');
    expect(instance.notes.get().attrs['title']).toBe('Plans');
  });

  it('is shown as it is when the block its schema asks for first takes no text', () => {
    // Nothing a caret could go into would be the block its top node asks
    // for; a rule put there would be shown as though it had been written.
    const ruled = new Schema({
      nodes: {
        doc: { content: 'block*' },
        rule: { group: 'block' },
        paragraph: { content: 'text*', group: 'block' },
        text: {},
      },
    });

    @Component({
      selector: 'v-page-empty-ruled',
      imports: [VEditor],
      render: compileTemplate(`<v-editor :value="notes" label="Ruled"></v-editor>`),
    })
    class EmptyRuled {
      notes = new Signal.State<DocNode>(ruled.node('doc', null, []));
    }

    const { instance, host } = show(EmptyRuled);
    expect(surface(host).innerHTML).toBe('');
    expect(instance.notes.get().childCount).toBe(0);
  });
});

describe('a different signal bound as the value later', () => {
  it('is not followed, and the edits keep going to the one the editor was built with', () => {
    @Component({
      selector: 'v-page-swapped-value',
      imports: [VEditor],
      render: compileTemplate(`<v-editor :ref="editor" :value="current.get()" label="Notes"></v-editor>`),
    })
    class Swapped {
      editor: VEditor | null = null;
      first = new Signal.State<DocNode>(doc(p(t('First'))));
      second = new Signal.State<DocNode>(doc(p(t('Second'))));
      current = new Signal.State(this.first);
    }

    const { instance, host } = show(Swapped);
    instance.current.set(instance.second);
    flushSync();
    select(instance.editor!, range(6));
    type(host, '!');
    // Written into the second, the first note's text would be the second's.
    expect(String(instance.first.get())).toBe(String(doc(p(t('First!')))));
    expect(String(instance.second.get())).toBe(String(doc(p(t('Second')))));
    // And what is shown is the first's still, edited.
    expect(surface(host).textContent).toBe('First!');
  });
});

describe('the words in an empty editor, over a document that is not one empty block', () => {
  it('are not shown over an empty block with text after it, or over a lone rule', () => {
    const { instance, host } = show(Page);
    instance.notes.set(doc(p(), p(t('Second'))));
    flushSync();
    expect(placeholder(host)).toBeNull();
    instance.notes.set(doc(s.node('horizontal_rule')));
    flushSync();
    expect(placeholder(host)).toBeNull();
  });
});

describe('presses held for a composition, when one of them has a different document loaded', () => {
  it('stop there, and the rest are not made on the document that came', () => {
    @Component({
      selector: 'v-page-loads-on-heading',
      imports: [VEditor],
      render: compileTemplate(`
        <v-editor :ref="editor" :value="notes" label="Notes" :onChange="check"></v-editor>
      `),
    })
    class LoadsOnHeading {
      editor: VEditor | null = null;
      notes = new Signal.State(doc(p(t('Hello'))));
      /** A page that files a titled note away at once and opens a fresh one, redrawing before going on. */
      check = (next: DocNode): void => {
        if (next.firstChild?.type.name !== 'heading') return;
        this.notes.set(doc(p(t('Other'))));
        flushSync();
      };
    }

    const { instance, host } = show(LoadsOnHeading);
    select(instance.editor!, range(6));
    const el = surface(host);
    // A listener that throws is reported, not raised, so it is listened for.
    const thrown: unknown[] = [];
    const heard = (event: ErrorEvent): void => {
      thrown.push(event.error);
    };
    window.addEventListener('error', heard);
    try {
      composition(el, 'compositionstart');
      click(button(host, 'heading-1'));
      click(button(host, 'blockquote'));
      composition(el, 'compositionend', 'か');
    } finally {
      window.removeEventListener('error', heard);
    }
    expect(thrown).toEqual([]);
    expect(String(instance.notes.get())).toBe(String(doc(p(t('Other')))));
    expect(el.innerHTML).toBe('<p>Other</p>');
  });
});
