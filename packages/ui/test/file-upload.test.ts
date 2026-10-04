/**
 * `<v-file-upload>`, driven the way a page drives it.
 *
 * The behaviour is `createFileUpload`'s and `createFormField`'s, and is tested
 * where it lives. What is tested here is the shell: that what a caller writes
 * on the tag reaches the zone rather than the field around it, that the parts
 * are really there and really tied to one another, that every state the
 * sheet's rules select on is written on the element those rules name, that
 * every option handed to the primitive does something, and that nothing about
 * the primitive is out of reach.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Component, Signal, flushSync, mount } from '@voltdev/core';
import { compileTemplate } from '@voltdev/core/jit';
import type { UploadItem, UploadRequest, UploadTransport } from '@voltdev/primitives';
import { compileComponents } from './render.js';
import { standIn, styledDocument, SYSTEM_COLORS, type Fixture } from './harness.ts';
import { VFileUpload, type UploadLabels } from '../src/components/file-upload.js';
import { FORCED_COLORS_QUERY, rulesToCss, wrap, type Rule } from '../src/index.ts';
import { fileUploadStyles } from '../src/sheet/file-upload.js';

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

const field = (host: HTMLElement): HTMLElement => host.querySelector('.volt-file-upload')!;
const zone = (host: HTMLElement): HTMLElement => host.querySelector('.volt-file-upload-zone')!;
const words = (host: HTMLElement): HTMLElement => host.querySelector('.volt-file-upload-label')!;
const picker = (host: HTMLElement): HTMLInputElement => host.querySelector('input[type="file"]')!;
const hint = (host: HTMLElement): HTMLElement | null =>
  host.querySelector('.volt-file-upload-description');
const message = (host: HTMLElement): HTMLElement => host.querySelector('.volt-file-upload-error')!;
const live = (host: HTMLElement): HTMLElement => host.querySelector('.volt-file-upload-status')!;
const rows = (host: HTMLElement): HTMLElement[] => [
  ...host.querySelectorAll<HTMLElement>('.volt-file-upload-item'),
];
const posted = (host: HTMLElement): HTMLInputElement[] => [
  ...host.querySelectorAll<HTMLInputElement>('input[type="hidden"]'),
];

/** A row's parts. */
const meta = (row: HTMLElement): string => row.querySelector('.volt-file-upload-meta')!.textContent!;
const bar = (row: HTMLElement): HTMLElement | null => row.querySelector('.volt-progress');
const indicator = (row: HTMLElement): HTMLElement => row.querySelector('.volt-progress-indicator')!;
const reason = (row: HTMLElement): HTMLElement | null => row.querySelector('.volt-file-upload-reason');
const actions = (row: HTMLElement): HTMLButtonElement[] => [
  ...row.querySelectorAll<HTMLButtonElement>('.volt-file-upload-action'),
];
const retryOf = (row: HTMLElement): HTMLButtonElement | undefined =>
  actions(row).find((button) => button.getAttribute('aria-label')?.startsWith('Retry'));
const removeOf = (row: HTMLElement): HTMLButtonElement => actions(row).at(-1)!;

function file(name: string, size: number, type = 'image/png'): File {
  return new File([new Uint8Array(size)], name, { type });
}

/** Files picked from the platform's own dialog, which raises `change`. */
function choose(input: HTMLInputElement, files: readonly File[]): void {
  const data = new DataTransfer();
  for (const each of files) data.items.add(each);
  input.files = data.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  flushSync();
}

/**
 * A drag event carrying files.
 *
 * happy-dom drops `dataTransfer` from a `DragEvent`'s init, and lists a
 * file's type among `types` where a browser lists `Files` — so the carrier is
 * written onto the event the way a browser would have filled it in.
 */
function drag(type: string, files: readonly File[] = []): DragEvent {
  const data = new DataTransfer();
  for (const each of files) data.items.add(each);
  const event = new DragEvent(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', {
    value: { types: ['Files'], files: data.files, items: data.items, dropEffect: 'none' },
  });
  return event;
}

function dispatch(el: Element, event: Event): Event {
  el.dispatchEvent(event);
  flushSync();
  return event;
}

/** A keydown as the user sends one: bubbling, and cancellable. */
function press(el: Element, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  return dispatch(
    el,
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }),
  ) as KeyboardEvent;
}

function click(el: HTMLElement): void {
  dispatch(el, new MouseEvent('click', { bubbles: true, cancelable: true }));
}

/** Let the requests' promises run on, then the effects they woke. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  flushSync();
}

/** The picker, which is what a press on the zone opens, and which happy-dom cannot. */
function watchPicker(): ReturnType<typeof vi.fn> {
  const opened = vi.fn();
  vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
    opened(this);
  });
  return opened;
}

interface Request {
  readonly request: UploadRequest;
  resolve(value?: unknown): void;
  reject(error: unknown): void;
}

/** A transport the test answers by hand, one request at a time. */
class Server {
  readonly requests: Request[] = [];
  readonly transport: UploadTransport = (request) =>
    new Promise((resolve, reject) => this.requests.push({ request, resolve, reject }));

  /** The request for a file, the latest one when it was sent more than once. */
  for(name: string): Request {
    const found = this.requests.filter((each) => each.request.file.name === name).at(-1);
    if (!found) throw new Error(`nothing was sent for ${name}`);
    return found;
  }
}

describe('v-file-upload', () => {
  it('is a zone with words in it, a hidden picker it opens, a line of help and a message', () => {
    @Component({
      selector: 'v-page',
      imports: [VFileUpload],
      render: compileTemplate(
        `<v-file-upload :transport="server.transport" description="PNG or JPEG."></v-file-upload>`,
      ),
    })
    class Page {
      server = new Server();
    }

    const { host } = show(Page);

    // A button, because that is what it does, and a tab stop.
    expect(zone(host).getAttribute('role')).toBe('button');
    expect(zone(host).getAttribute('tabindex')).toBe('0');
    expect(zone(host).parentElement).toBe(field(host));

    // Named by the words inside it rather than by a second name written over
    // them, so what is heard is what is seen.
    expect(words(host).parentElement).toBe(zone(host));
    expect(words(host).textContent).toBe('Drop files here, or press to choose files');
    expect(zone(host).hasAttribute('aria-label')).toBe(false);
    expect(zone(host).hasAttribute('aria-labelledby')).toBe(false);

    // The same words label the picker, through the field's own reference; the
    // `for` that comes with it means nothing on a `<span>` and is left off.
    expect(picker(host).getAttribute('aria-labelledby')).toBe(words(host).id);
    expect(words(host).hasAttribute('for')).toBe(false);

    // Hidden in the page rather than taken out of it, and out of the tab
    // order, since the zone is the stop that opens it.
    expect(picker(host).type).toBe('file');
    expect(picker(host).getAttribute('tabindex')).toBe('-1');
    expect(picker(host).style.position).toBe('absolute');
    expect(picker(host).style.display).not.toBe('none');
    expect(picker(host).multiple).toBe(true);
    // No filter was asked for, so none is written: the property would keep
    // `undefined` as the word "undefined".
    expect(picker(host).hasAttribute('accept')).toBe(false);
    // The transport sends the bytes, so the picker submits none of them.
    expect(picker(host).hasAttribute('name')).toBe(false);

    // The help and the message describe both controls, help first.
    const described = `${hint(host)!.id} ${message(host).id}`;
    expect(hint(host)!.textContent).toBe('PNG or JPEG.');
    expect(zone(host).getAttribute('aria-describedby')).toBe(described);
    expect(picker(host).getAttribute('aria-describedby')).toBe(described);

    // The message is a live region on the page from the start, empty.
    expect(message(host).getAttribute('role')).toBe('alert');
    expect(message(host).textContent).toBe('');
    expect(message(host).getAttribute('data-state')).toBe('valid');

    // And so is the polite one that says when files finish.
    expect(live(host).getAttribute('role')).toBe('status');
    expect(live(host).getAttribute('aria-live')).toBe('polite');

    // Nothing listed yet.
    expect(host.querySelector('.volt-file-upload-list')).toBeNull();
  });

  it('lands what the caller wrote on the tag on the zone', () => {
    @Component({
      selector: 'v-page',
      imports: [VFileUpload],
      render: compileTemplate(
        `<v-file-upload :transport="server.transport" class="mine" id="photos"
                        title="Holiday photos" data-testid="upload"></v-file-upload>`,
      ),
    })
    class Page {
      server = new Server();
    }

    const { host } = show(Page);

    // The zone is the control: the element with the role, the one a keyboard
    // reaches, and the one a reader sees.
    expect([...zone(host).classList].sort()).toEqual(['mine', 'volt-file-upload-zone']);
    expect(zone(host).id).toBe('photos');
    expect(zone(host).getAttribute('title')).toBe('Holiday photos');
    expect(zone(host).getAttribute('data-testid')).toBe('upload');
    expect(field(host).classList.contains('mine')).toBe(false);
    expect(field(host).hasAttribute('data-testid')).toBe(false);
  });

  it('names both controls the caller’s way, and adds their description to the field’s', () => {
    @Component({
      selector: 'v-page',
      imports: [VFileUpload],
      render: compileTemplate(`
        <h2 id="heading">Attachments</h2>
        <p id="note">Shared with the whole team.</p>
        <v-file-upload :transport="server.transport" aria-label="Photos"
                       aria-describedby="note"></v-file-upload>
        <v-file-upload :transport="server.transport" aria-label="Ignored"
                       aria-labelledby="heading"></v-file-upload>
      `),
    })
    class Page {
      server = new Server();
    }

    const { host } = show(Page);
    const [named, referenced] = [...host.querySelectorAll<HTMLElement>('.volt-file-upload')];
    const zoneOf = (el: Element) => el.querySelector('.volt-file-upload-zone')!;
    const pickerOf = (el: Element) => el.querySelector('input[type="file"]')!;
    const errorOf = (el: Element) => el.querySelector('.volt-file-upload-error')!;

    // A name of the caller's stands the field's reference down on the picker,
    // which would otherwise outrank it.
    expect(zoneOf(named!).getAttribute('aria-label')).toBe('Photos');
    expect(pickerOf(named!).getAttribute('aria-label')).toBe('Photos');
    expect(pickerOf(named!).hasAttribute('aria-labelledby')).toBe(false);
    expect(zoneOf(named!).getAttribute('aria-describedby')).toBe(`${errorOf(named!).id} note`);
    expect(pickerOf(named!).getAttribute('aria-describedby')).toBe(`${errorOf(named!).id} note`);

    // A reference outranks a name, so the two are never written together.
    expect(zoneOf(referenced!).getAttribute('aria-labelledby')).toBe('heading');
    expect(zoneOf(referenced!).hasAttribute('aria-label')).toBe(false);
    expect(pickerOf(referenced!).getAttribute('aria-labelledby')).toBe('heading');
    expect(pickerOf(referenced!).hasAttribute('aria-label')).toBe(false);
  });

  it('takes its words from `label`, from the default slot, or from `labels.dropZone`', () => {
    @Component({
      selector: 'v-page',
      imports: [VFileUpload],
      render: compileTemplate(`
        <v-file-upload class="one" :transport="server.transport" :label="said.get()"></v-file-upload>
        <v-file-upload class="two" :transport="server.transport" label="Never shown">
          <span class="icon" aria-hidden="true">⇪</span> Drop the contract here
        </v-file-upload>
        <v-file-upload class="three" :transport="server.transport" :labels="wording"></v-file-upload>
      `),
    })
    class Page {
      server = new Server();
      said = new Signal.State('Drop photos here');
      wording: UploadLabels = { dropZone: 'Déposez vos fichiers ici' };
    }

    const { instance, host } = show(Page);
    const wordsOf = (name: string) =>
      host.querySelector(`.${name} .volt-file-upload-label`)!.textContent!.trim();

    expect(wordsOf('one')).toBe('Drop photos here');
    instance.said.set('Drop receipts here');
    flushSync();
    expect(wordsOf('one')).toBe('Drop receipts here');

    // Markup in the slot is the zone's content, icon and all, and still the
    // element the picker is labelled by.
    expect(host.querySelector('.two .volt-file-upload-label .icon')).not.toBeNull();
    expect(wordsOf('two')).toBe('⇪ Drop the contract here');

    expect(wordsOf('three')).toBe('Déposez vos fichiers ici');
  });

  it('shows the help only while there is some, and keeps the references in step', () => {
    @Component({
      selector: 'v-page',
      imports: [VFileUpload],
      render: compileTemplate(
        `<v-file-upload :transport="server.transport" :description="help.get()"></v-file-upload>`,
      ),
    })
    class Page {
      server = new Server();
      help = new Signal.State('');
    }

    const { instance, host } = show(Page);

    expect(hint(host)).toBeNull();
    expect(zone(host).getAttribute('aria-describedby')).toBe(message(host).id);

    instance.help.set('Up to 5 MB each.');
    flushSync();
    expect(hint(host)!.textContent).toBe('Up to 5 MB each.');
    expect(zone(host).getAttribute('aria-describedby')).toBe(`${hint(host)!.id} ${message(host).id}`);
  });

  it('lists a file on its way with a bar, then finished, in the progress sheet’s classes', async () => {
    @Component({
      selector: 'v-page',
      imports: [VFileUpload],
      render: compileTemplate(`<v-file-upload :transport="server.transport"></v-file-upload>`),
    })
    class Page {
      server = new Server();
    }

    const { instance, host } = show(Page);
    choose(picker(host), [file('beach.png', 10)]);

    const [row] = rows(host);
    expect(row!.getAttribute('data-status')).toBe('uploading');
    expect(row!.getAttribute('data-progress')).toBe('0');
    expect(row!.hasAttribute('data-error')).toBe(false);
    expect(row!.querySelector('.volt-file-upload-name')!.textContent).toBe('beach.png');
    expect(meta(row!)).toBe('10 bytes · 0%');
    expect(host.querySelector('.volt-file-upload-list')!.getAttribute('role')).toBe('list');

    // The bar is `<v-progress>`'s markup, so its sheet draws it.
    expect(bar(row!)!.getAttribute('role')).toBe('progressbar');
    expect(bar(row!)!.getAttribute('aria-label')).toBe('Uploading beach.png');
    expect(bar(row!)!.querySelector('.volt-progress-track')).not.toBeNull();
    expect(indicator(row!).getAttribute('data-state')).toBe('loading');
    expect(indicator(row!).style.getPropertyValue('inline-size')).toBe('0%');

    // A retry with nothing to retry is there but unavailable, and the remove
    // is live. Both are buttons named for the file.
    expect(retryOf(row!)!.getAttribute('aria-disabled')).toBe('true');
    expect(removeOf(row!).getAttribute('aria-label')).toBe('Remove beach.png');
    expect(removeOf(row!).hasAttribute('aria-disabled')).toBe(false);
    for (const button of actions(row!)) expect(button.type).toBe('button');

    // Halfway: the bar and the words follow the bytes.
    instance.server.for('beach.png').request.progress(5);
    flushSync();
    expect(indicator(row!).style.getPropertyValue('inline-size')).toBe('50%');
    expect(row!.getAttribute('data-progress')).toBe('50');
    expect(meta(row!)).toBe('10 bytes · 50%');

    instance.server.for('beach.png').resolve('f_1');
    await settle();
    expect(rows(host)[0]).toBe(row);
    expect(row!.getAttribute('data-status')).toBe('success');
    expect(meta(row!)).toBe('10 bytes · Uploaded');
    expect(indicator(row!).getAttribute('data-state')).toBe('complete');
    expect(indicator(row!).style.getPropertyValue('inline-size')).toBe('100%');
  });

  it('marks a failed file, says why, and sends it again from its retry', async () => {
    const failed: UploadItem[] = [];

    @Component({
      selector: 'v-page',
      imports: [VFileUpload],
      render: compileTemplate(
        `<v-file-upload :transport="server.transport" :onError="heard"></v-file-upload>`,
      ),
    })
    class Page {
      server = new Server();
      heard = (item: UploadItem) => failed.push(item);
    }

    const { instance, host } = show(Page);
    choose(picker(host), [file('beach.png', 10)]);
    instance.server.for('beach.png').reject(new Error('The server is full.'));
    await settle();

    const [row] = rows(host);
    expect(row!.getAttribute('data-status')).toBe('error');
    expect(row!.getAttribute('data-error')).toBe('transport');
    expect(reason(row!)!.textContent).toBe('The server is full.');
    expect(meta(row!)).toBe('10 bytes · Failed');
    expect(failed.map((item) => item.file.name)).toEqual(['beach.png']);

    // The field refuses a submit for the same reason, and says so.
    expect(message(host).textContent).toBe('The server is full.');
    expect(message(host).getAttribute('data-state')).toBe('invalid');
    expect(picker(host).getAttribute('aria-invalid')).toBe('true');

    // The retry is live now, and stays where it was once pressed, so focus
    // stays on it rather than falling to the top of the page.
    const retry = retryOf(row!)!;
    expect(retry.hasAttribute('aria-disabled')).toBe(false);
    retry.focus();
    click(retry);
    expect(instance.server.requests).toHaveLength(2);
    expect(row!.getAttribute('data-status')).toBe('uploading');
    expect(row!.hasAttribute('data-error')).toBe(false);
    expect(reason(row!)).toBeNull();
    expect(document.activeElement).toBe(retry);
    expect(retry.getAttribute('aria-disabled')).toBe('true');

    instance.server.for('beach.png').resolve('f_1');
    await settle();
    expect(row!.getAttribute('data-status')).toBe('success');
    expect(message(host).textContent).toBe('');
  });

  it('removes a file, cancelling it on its way, and hands focus to the zone', () => {
    @Component({
      selector: 'v-page',
      imports: [VFileUpload],
      render: compileTemplate(`<v-file-upload :transport="server.transport"></v-file-upload>`),
    })
    class Page {
      server = new Server();
    }

    const { instance, host } = show(Page);
    choose(picker(host), [file('beach.png', 10), file('dunes.png', 10)]);
    const [first] = rows(host);

    const remove = removeOf(first!);
    remove.focus();
    click(remove);

    expect(rows(host).map((row) => row.querySelector('.volt-file-upload-name')!.textContent)).toEqual([
      'dunes.png',
    ]);
    expect(instance.server.for('beach.png').request.signal.aborted).toBe(true);
    expect(document.activeElement).toBe(zone(host));
    // The picker holds what is listed, and nothing that was taken out.
    expect([...picker(host).files!].map((each) => each.name)).toEqual(['dunes.png']);
  });

  it('lists a refused file with its reason and sends none of it, for each limit', () => {
    const refused: UploadItem[] = [];

    @Component({
      selector: 'v-page',
      imports: [VFileUpload],
      render: compileTemplate(`
        <v-file-upload class="type" :transport="server.transport" accept="image/*" :onError="heard"></v-file-upload>
        <v-file-upload class="size" :transport="server.transport" maxSize="50" :onError="heard"></v-file-upload>
        <v-file-upload class="count" :transport="server.transport" :maxFiles="1" :onError="heard"></v-file-upload>
      `),
    })
    class Page {
      server = new Server();
      heard = (item: UploadItem) => refused.push(item);
    }

    const { instance, host } = show(Page);
    const part = (name: string) => host.querySelector<HTMLElement>(`.volt-file-upload:has(.${name})`)!;

    expect(picker(part('type')).accept).toBe('image/*');

    choose(picker(part('type')), [file('notes.txt', 10, 'text/plain')]);
    // An attribute spells the limit as text, and it is still a limit.
    choose(picker(part('size')), [file('huge.png', 100)]);
    choose(picker(part('count')), [file('one.png', 10), file('two.png', 10)]);

    const refusedRow = (name: string) =>
      rows(host).find((row) => row.querySelector('.volt-file-upload-name')!.textContent === name)!;

    for (const [name, code, why] of [
      ['notes.txt', 'type', 'notes.txt is not an accepted file type.'],
      ['huge.png', 'size', 'huge.png is larger than 50 bytes.'],
      ['two.png', 'count', 'No more than 1 files can be uploaded.'],
    ] as const) {
      const row = refusedRow(name);
      expect(row.getAttribute('data-status'), name).toBe('rejected');
      expect(row.getAttribute('data-error'), name).toBe(code);
      expect(reason(row)!.textContent, name).toBe(why);
      expect(meta(row), name).toContain('Not accepted');
      // Never sent, so nothing to show the progress of and nothing to retry.
      expect(bar(row), name).toBeNull();
      expect(retryOf(row), name).toBeUndefined();
      expect(removeOf(row).getAttribute('aria-label'), name).toBe(`Remove ${name}`);
    }

    expect(refused.map((item) => item.error?.code)).toEqual(['type', 'size', 'count']);
    expect(instance.server.requests.map((each) => each.request.file.name)).toEqual(['one.png']);
    expect(message(part('size')).textContent).toBe('huge.png is larger than 50 bytes.');
    expect(picker(part('size')).getAttribute('aria-invalid')).toBe('true');
  });

  it('replaces rather than appends when it takes one file at a time', () => {
    @Component({
      selector: 'v-page',
      imports: [VFileUpload],
      render: compileTemplate(`
        <v-file-upload class="bound" :transport="server.transport" :multiple="false"></v-file-upload>
        <v-file-upload class="written" :transport="server.transport" multiple="false"></v-file-upload>
      `),
    })
    class Page {
      server = new Server();
    }

    const { instance, host } = show(Page);

    for (const name of ['bound', 'written']) {
      const part = host.querySelector<HTMLElement>(`.volt-file-upload:has(.${name})`)!;
      expect(picker(part).multiple, name).toBe(false);

      choose(picker(part), [file(`${name}-first.png`, 10)]);
      choose(picker(part), [file(`${name}-second.png`, 10)]);

      const listed = [...part.querySelectorAll('.volt-file-upload-name')].map((el) => el.textContent);
      expect(listed, name).toEqual([`${name}-second.png`]);
      expect(instance.server.for(`${name}-first.png`).request.signal.aborted, name).toBe(true);
    }
  });

  it('opens the picker from a press, Enter or Space on the zone, and from nothing else', () => {
    const opened = watchPicker();

    @Component({
      selector: 'v-page',
      imports: [VFileUpload],
      render: compileTemplate(`<v-file-upload :transport="server.transport"></v-file-upload>`),
    })
    class Page {
      server = new Server();
    }

    const { host } = show(Page);

    click(zone(host));
    expect(opened).toHaveBeenCalledTimes(1);
    expect(opened).toHaveBeenLastCalledWith(picker(host));

    // Both keys a button answers, cancelled so Space does not scroll the page
    // and Enter does not submit the form around it.
    expect(press(zone(host), 'Enter').defaultPrevented).toBe(true);
    expect(press(zone(host), ' ').defaultPrevented).toBe(true);
    expect(opened).toHaveBeenCalledTimes(3);

    // Neither another key nor a shortcut.
    expect(press(zone(host), 'a').defaultPrevented).toBe(false);
    expect(press(zone(host), 'Enter', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(opened).toHaveBeenCalledTimes(3);
  });

  it('marks a drag over the zone, and takes what is dropped on it', async () => {
    @Component({
      selector: 'v-page',
      imports: [VFileUpload],
      render: compileTemplate(`<v-file-upload :transport="server.transport"></v-file-upload>`),
    })
    class Page {
      server = new Server();
    }

    const { host } = show(Page);

    expect(dispatch(zone(host), drag('dragenter')).defaultPrevented).toBe(true);
    expect(zone(host).hasAttribute('data-dragging')).toBe(true);
    expect(field(host).hasAttribute('data-dragging')).toBe(true);
    // Cancelled, which is what makes the zone a drop target at all.
    expect(dispatch(zone(host), drag('dragover')).defaultPrevented).toBe(true);

    dispatch(zone(host), drag('dragleave'));
    expect(zone(host).hasAttribute('data-dragging')).toBe(false);

    dispatch(zone(host), drag('dragenter'));
    const drop = dispatch(zone(host), drag('drop', [file('beach.png', 10)]));
    // Cancelled, or the browser opens the file in place of the page.
    expect(drop.defaultPrevented).toBe(true);
    expect(zone(host).hasAttribute('data-dragging')).toBe(false);
    await settle();
    expect(rows(host)).toHaveLength(1);
  });

  it('refuses everything while disabled, and follows the signal it is bound to', () => {
    const opened = watchPicker();

    @Component({
      selector: 'v-page',
      imports: [VFileUpload],
      render: compileTemplate(
        `<v-file-upload :transport="server.transport" :disabled="off.get()"></v-file-upload>`,
      ),
    })
    class Page {
      server = new Server();
      off = new Signal.State(false);
    }

    const { instance, host } = show(Page);
    choose(picker(host), [file('beach.png', 10)]);
    const [row] = rows(host);

    instance.off.set(true);
    flushSync();

    // Unavailable, and still a tab stop that says so.
    expect(zone(host).getAttribute('aria-disabled')).toBe('true');
    expect(zone(host).getAttribute('tabindex')).toBe('0');
    expect(picker(host).disabled).toBe(true);
    for (const button of actions(row!)) expect(button.getAttribute('aria-disabled')).toBe('true');

    click(zone(host));
    expect(press(zone(host), 'Enter').defaultPrevented).toBe(false);
    expect(opened).not.toHaveBeenCalled();

    dispatch(zone(host), drag('dragenter'));
    expect(zone(host).hasAttribute('data-dragging')).toBe(false);

    click(removeOf(row!));
    expect(rows(host)).toHaveLength(1);

    choose(picker(host), [file('dunes.png', 10)]);
    expect(rows(host)).toHaveLength(1);

    instance.off.set(false);
    flushSync();
    expect(zone(host).hasAttribute('aria-disabled')).toBe(false);
    expect(picker(host).disabled).toBe(false);
    // The retry's own verdict stands once the upload's is taken away.
    expect(retryOf(row!)!.getAttribute('aria-disabled')).toBe('true');
    expect(removeOf(row!).hasAttribute('aria-disabled')).toBe(false);
    click(removeOf(row!));
    expect(rows(host)).toHaveLength(0);
  });

  it('reads `disabled` written on the tag the way it reads `multiple`', () => {
    const opened = watchPicker();

    @Component({
      selector: 'v-page',
      imports: [VFileUpload],
      render: compileTemplate(`
        <form>
          <v-file-upload class="bare" :transport="server.transport" name="a" disabled></v-file-upload>
          <v-file-upload class="said" :transport="server.transport" name="b" disabled="true"></v-file-upload>
          <v-file-upload class="not" :transport="server.transport" name="c" disabled="false"></v-file-upload>
        </form>
      `),
    })
    class Page {
      server = new Server();
    }

    const { instance, host } = show(Page);
    const part = (name: string) => host.querySelector<HTMLElement>(`.volt-file-upload:has(.${name})`)!;

    for (const name of ['bare', 'said']) {
      expect(zone(part(name)).getAttribute('aria-disabled'), name).toBe('true');
      expect(picker(part(name)).disabled, name).toBe(true);
    }

    // `"false"` is a string, and every string is truthy: read as it stands it
    // was an upload switched off by the one word that says it is not.
    const live = part('not');
    expect(zone(live).hasAttribute('aria-disabled')).toBe(false);
    expect(picker(live).disabled).toBe(false);
    click(zone(live));
    expect(opened).toHaveBeenCalledTimes(1);

    choose(picker(live), [file('beach.png', 10)]);
    instance.server.for('beach.png').resolve('f_1');
    return settle().then(() => {
      const row = rows(live)[0]!;
      expect(removeOf(row).hasAttribute('aria-disabled')).toBe(false);
      // A form posts what the upload finished with, as it would for any field
      // that is not disabled.
      expect(new FormData(host.querySelector('form')!).getAll('c')).toEqual(['f_1']);
      click(removeOf(row));
      expect(rows(live)).toHaveLength(0);
    });
  });

  it('shows the caller’s verdict and refuses the submit over it until the files change', () => {
    @Component({
      selector: 'v-page',
      imports: [VFileUpload],
      render: compileTemplate(`
        <form>
          <v-file-upload :ref="handle" :transport="server.transport" :prop-error="refused.get()"
                         maxSize="50"></v-file-upload>
        </form>
      `),
    })
    class Page {
      server = new Server();
      refused = new Signal.State('The album is full.');
      handle: VFileUpload | null = null;
    }

    const { instance, host } = show(Page);
    const form = host.querySelector('form')!;

    // Shown at once, and pushed into the picker, so the platform refuses too.
    expect(message(host).textContent).toBe('The album is full.');
    expect(message(host).getAttribute('data-state')).toBe('invalid');
    expect(picker(host).validationMessage).toBe('The album is full.');
    expect(form.checkValidity()).toBe(false);

    // A change in which files are there lets go of it, and the prop with it.
    // A field that has spoken judges every change after it, so what is said
    // now is its verdict on the files there now: one is still going up.
    choose(picker(host), [file('beach.png', 10)]);
    expect(instance.handle!.error.get()).toBe('');
    expect(message(host).textContent).toBe('Wait for the upload to finish.');
    expect(picker(host).validationMessage).not.toBe('The album is full.');

    // Said again about the files now there, it stays while they move on: a
    // byte arriving is not an edit.
    instance.refused.set('');
    flushSync();
    instance.refused.set('Only two photos a day.');
    flushSync();
    expect(message(host).textContent).toBe('Only two photos a day.');
    instance.server.for('beach.png').request.progress(5);
    flushSync();
    expect(message(host).textContent).toBe('Only two photos a day.');
    expect(picker(host).validationMessage).toBe('Only two photos a day.');

    // It comes ahead of a refusal of the upload's own, which is what is left
    // once it is taken back.
    instance.handle!.upload.add([file('huge.png', 100)]);
    flushSync();
    instance.refused.set('Still too many.');
    flushSync();
    expect(message(host).textContent).toBe('Still too many.');
    instance.refused.set('');
    flushSync();
    expect(message(host).textContent).toBe('huge.png is larger than 50 bytes.');
  });

  it('keeps a verdict the page sets in answer to the new list', () => {
    @Component({
      selector: 'v-page',
      imports: [VFileUpload],
      render: compileTemplate(
        `<v-file-upload :transport="server.transport" :onChange="checked"
                        :prop-error="refused.get()"></v-file-upload>`,
      ),
    })
    class Page {
      server = new Server();
      refused = new Signal.State('');
      /** A rule of the page's about the batch, checked whenever it changes. */
      checked = (items: readonly UploadItem[]) =>
        this.refused.set(items.length > 1 ? 'One photo per post.' : '');
    }

    const { host } = show(Page);

    // The letting go comes first, so the page's answer to the same change is
    // the one left standing.
    choose(picker(host), [file('beach.png', 10), file('dunes.png', 10)]);
    expect(message(host).textContent).toBe('One photo per post.');
    expect(picker(host).validationMessage).toBe('One photo per post.');

    click(removeOf(rows(host)[0]!));
    expect(message(host).textContent).not.toBe('One photo per post.');
  });

  it('keeps a verdict written straight into the component in answer to the new list', () => {
    @Component({
      selector: 'v-page',
      imports: [VFileUpload],
      render: compileTemplate(
        `<v-file-upload :ref="handle" :transport="server.transport" :onChange="checked"></v-file-upload>`,
      ),
    })
    class Page {
      server = new Server();
      handle: VFileUpload | null = null;
      checked = (items: readonly UploadItem[]) =>
        this.handle?.error.set(`${items.length} waiting for review.`);
    }

    const { instance, host } = show(Page);

    // A binding arrives a beat later than this, through the page's own
    // render, so it is a write like this one that the order is for.
    choose(picker(host), [file('beach.png', 10)]);
    expect(message(host).textContent).toBe('1 waiting for review.');
    choose(picker(host), [file('dunes.png', 10)]);
    expect(message(host).textContent).toBe('2 waiting for review.');
    expect(instance.handle!.error.get()).toBe('2 waiting for review.');
  });

  it('refuses a submit while a file is still going up, through the picker', async () => {
    @Component({
      selector: 'v-page',
      imports: [VFileUpload],
      render: compileTemplate(`
        <form><v-file-upload :transport="server.transport"></v-file-upload></form>
      `),
    })
    class Page {
      server = new Server();
    }

    const { instance, host } = show(Page);
    const form = host.querySelector('form')!;
    choose(picker(host), [file('beach.png', 10)]);

    const submit = new Event('submit', { bubbles: true, cancelable: true });
    form.dispatchEvent(submit);
    flushSync();
    expect(submit.defaultPrevented).toBe(true);
    expect(message(host).textContent).toBe('Wait for the upload to finish.');

    instance.server.for('beach.png').resolve('f_1');
    await settle();
    expect(message(host).textContent).toBe('');
  });

  it('posts each finished file’s reference under `name`, and never the files', async () => {
    @Component({
      selector: 'v-page',
      imports: [VFileUpload],
      render: compileTemplate(`
        <form>
          <v-file-upload :transport="server.transport" :name="field.get()" :disabled="off.get()"></v-file-upload>
        </form>
      `),
    })
    class Page {
      server = new Server();
      field = new Signal.State<string | undefined>('attachments');
      off = new Signal.State(false);
    }

    const { instance, host } = show(Page);
    const form = host.querySelector('form')!;
    const sent = () => new FormData(form).getAll('attachments');

    choose(picker(host), [
      file('beach.png', 10),
      file('dunes.png', 10),
      file('cliff.png', 10),
      file('quiet.png', 10),
      file('broken.png', 10),
    ]);
    expect(sent()).toEqual([]);

    // A string as it is, anything else as JSON, nothing for a transport that
    // answered nothing, and nothing for a file that never arrived.
    const { server } = instance;
    server.for('beach.png').resolve('f_1');
    server.for('dunes.png').resolve({ id: 2 });
    server.for('cliff.png').resolve(3);
    await settle();
    server.for('quiet.png').resolve(undefined);
    server.for('broken.png').reject(new Error('No.'));
    await settle();

    expect(sent()).toEqual(['f_1', '{"id":2}', '3']);
    expect(picker(host).hasAttribute('name')).toBe(false);
    expect(posted(host).every((input) => input.name === 'attachments')).toBe(true);

    // Taken out of the list, taken out of the form.
    click(removeOf(rows(host)[0]!));
    expect(sent()).toEqual(['{"id":2}', '3']);

    // A disabled upload posts nothing, as any disabled field does.
    instance.off.set(true);
    flushSync();
    expect(sent()).toEqual([]);
    instance.off.set(false);
    flushSync();

    // And without a name there is nothing to post under.
    instance.field.set('photos');
    flushSync();
    expect(new FormData(form).getAll('photos')).toEqual(['{"id":2}', '3']);
    instance.field.set(undefined);
    flushSync();
    expect(posted(host)).toHaveLength(0);
  });

  it('tells the page when the list changes shape, and when everything has finished', async () => {
    const changes: string[][] = [];
    const finished: string[][] = [];
    const describe = (items: readonly UploadItem[]) =>
      items.map((item) => `${item.file.name}:${item.status}`);

    @Component({
      selector: 'v-page',
      imports: [VFileUpload],
      render: compileTemplate(
        `<v-file-upload :transport="server.transport" maxSize="50" :onChange="changed"
                        :onComplete="done"></v-file-upload>`,
      ),
    })
    class Page {
      server = new Server();
      changed = (items: readonly UploadItem[]) => changes.push(describe(items));
      done = (items: readonly UploadItem[]) => finished.push(describe(items));
    }

    const { instance, host } = show(Page);
    expect(changes).toEqual([]);

    choose(picker(host), [file('beach.png', 10), file('huge.png', 100)]);
    expect(changes).toEqual([['beach.png:uploading', 'huge.png:rejected']]);

    // A byte arriving is not a change of shape.
    instance.server.for('beach.png').request.progress(5);
    flushSync();
    expect(changes).toHaveLength(1);
    expect(finished).toEqual([]);

    instance.server.for('beach.png').resolve('f_1');
    await settle();
    expect(changes.at(-1)).toEqual(['beach.png:success', 'huge.png:rejected']);
    expect(finished).toEqual([['beach.png:success', 'huge.png:rejected']]);
  });

  it('says when the files have finished, in the live region, once it is listening', async () => {
    @Component({
      selector: 'v-page',
      imports: [VFileUpload],
      render: compileTemplate(
        `<v-file-upload :transport="server.transport" :labels="wording"></v-file-upload>`,
      ),
    })
    class Page {
      server = new Server();
      wording: UploadLabels = { announceComplete: (total) => `${total} uploaded.` };
    }

    const { instance, host } = show(Page);
    choose(picker(host), [file('beach.png', 10)]);
    instance.server.for('beach.png').resolve('f_1');
    await settle();

    // A region that appears and speaks in the same breath announces nothing,
    // so the words wait until it has been on the page a moment.
    expect(live(host).textContent).toBe('');
    await new Promise((resolve) => setTimeout(resolve, 80));
    flushSync();
    expect(live(host).textContent).toBe('1 uploaded.');
  });

  it('speaks the page’s wording, and follows it when it changes', async () => {
    @Component({
      selector: 'v-page',
      imports: [VFileUpload],
      render: compileTemplate(
        `<v-file-upload :transport="server.transport" :labels="wording.get()"></v-file-upload>`,
      ),
    })
    class Page {
      server = new Server();
      wording = new Signal.State<UploadLabels>({
        remove: (item) => `Take ${item.file.name} away`,
        retry: (item) => `Send ${item.file.name} again`,
        status: (item) => (item.status === 'error' ? 'Did not arrive' : ''),
      });
    }

    const { instance, host } = show(Page);
    choose(picker(host), [file('beach.png', 10)]);
    instance.server.for('beach.png').reject(new Error('No.'));
    await settle();

    const [row] = rows(host);
    expect(meta(row!)).toBe('10 bytes · Did not arrive');
    expect(actions(row!)[0]!.getAttribute('aria-label')).toBe('Send beach.png again');
    expect(removeOf(row!).getAttribute('aria-label')).toBe('Take beach.png away');

    // A page that changes language reaches the rows already on screen.
    instance.wording.set({
      remove: (item) => `${item.file.name} entfernen`,
      status: () => '',
    });
    flushSync();
    expect(removeOf(row!).getAttribute('aria-label')).toBe('beach.png entfernen');
    expect(actions(row!)[0]!.getAttribute('aria-label')).toBe('Retry upload of beach.png');
    // An empty status leaves the size on its own.
    expect(meta(row!)).toBe('10 bytes');
  });

  it('draws the page’s own row from the `file` slot', async () => {
    @Component({
      selector: 'v-page',
      imports: [VFileUpload],
      render: compileTemplate(`
        <v-file-upload :transport="server.transport">
          <template :slot-file="{ file, progress, status, item, retry, remove }">
            <span class="mine-name">{ file.name }</span>
            <span class="mine-state">{ status }: { progress }%</span>
            <span class="mine-reason">{ item.error?.message ?? '' }</span>
            <button type="button" class="mine-retry" :click="retry()">Again</button>
            <button type="button" class="mine-remove" :click="remove()">Drop</button>
          </template>
        </v-file-upload>
      `),
    })
    class Page {
      server = new Server();
    }

    const { instance, host } = show(Page);
    choose(picker(host), [file('beach.png', 10)]);

    const [row] = rows(host);
    // The row is still the sheet's, carrying the state its rules read; what
    // is inside it is the page's.
    expect(row!.getAttribute('data-status')).toBe('uploading');
    expect(row!.querySelector('.volt-file-upload-head')).toBeNull();
    expect(row!.querySelector('.mine-name')!.textContent).toBe('beach.png');
    expect(row!.querySelector('.mine-state')!.textContent).toBe('uploading: 0%');

    // The names are live: the content follows its file without being rebuilt.
    const name = row!.querySelector('.mine-name');
    instance.server.for('beach.png').request.progress(5);
    flushSync();
    expect(row!.querySelector('.mine-state')!.textContent).toBe('uploading: 50%');

    instance.server.for('beach.png').reject(new Error('No.'));
    await settle();
    expect(row!.querySelector('.mine-state')!.textContent).toBe('error: 50%');
    expect(row!.querySelector('.mine-reason')!.textContent).toBe('No.');
    expect(row!.querySelector('.mine-name')).toBe(name);

    click(row!.querySelector<HTMLElement>('.mine-retry')!);
    expect(instance.server.requests).toHaveLength(2);
    expect(row!.getAttribute('data-status')).toBe('uploading');

    click(row!.querySelector<HTMLElement>('.mine-remove')!);
    expect(rows(host)).toHaveLength(0);
  });

  it('keeps the primitive within reach through `:ref`', () => {
    @Component({
      selector: 'v-page',
      imports: [VFileUpload],
      render: compileTemplate(
        `<v-file-upload :ref="handle" :transport="server.transport"></v-file-upload>`,
      ),
    })
    class Page {
      server = new Server();
      handle: VFileUpload | null = null;
    }

    const { instance, host } = show(Page);
    const upload = instance.handle!.upload;

    // Files added from outside — a paste handler, a "use last photo" button —
    // are listed and sent like any others.
    upload.add([file('beach.png', 10)]);
    flushSync();
    expect(rows(host)).toHaveLength(1);
    expect(instance.server.requests).toHaveLength(1);
    expect(upload.items()[0]!.status).toBe('uploading');

    upload.cancel(upload.items()[0]!.id);
    flushSync();
    expect(instance.server.requests[0]!.request.signal.aborted).toBe(true);
  });

  it('refuses a transport that is not a function, and an upload without one', () => {
    @Component({
      selector: 'v-page-written-transport',
      imports: [VFileUpload],
      render: compileTemplate(`<v-file-upload transport="/api/files"></v-file-upload>`),
    })
    class Written {}

    // A string would be called for the first file, and every file would then
    // be listed as failed for a reason about strings.
    expect(() => show(Written)).toThrow(/`transport` on <v-file-upload>/);
    expect(() => show(Written)).toThrow(/xhrTransport/);

    @Component({
      selector: 'v-page-no-transport',
      imports: [VFileUpload],
      render: compileTemplate(`<v-file-upload></v-file-upload>`),
    })
    class Missing {}

    expect(() => show(Missing)).toThrow(/<v-file-upload> needs a `transport`/);
  });

  it('switches off a failed file’s retry with the upload, and sends nothing from it', async () => {
    @Component({
      selector: 'v-page',
      imports: [VFileUpload],
      render: compileTemplate(`
        <v-file-upload class="drawn" :transport="server.transport" :disabled="off.get()"></v-file-upload>
        <v-file-upload class="own" :transport="server.transport" :disabled="off.get()">
          <template :slot-file="{ retry }">
            <button type="button" class="mine-retry" :click="retry()">Again</button>
          </template>
        </v-file-upload>
      `),
    })
    class Page {
      server = new Server();
      off = new Signal.State(false);
    }

    const { instance, host } = show(Page);
    const part = (name: string) => host.querySelector<HTMLElement>(`.volt-file-upload:has(.${name})`)!;
    choose(picker(part('drawn')), [file('beach.png', 10)]);
    choose(picker(part('own')), [file('dunes.png', 10)]);
    instance.server.for('beach.png').reject(new Error('No.'));
    instance.server.for('dunes.png').reject(new Error('No.'));
    await settle();

    // Live while the upload is: there is something to send again.
    const retry = retryOf(rows(part('drawn'))[0]!)!;
    expect(retry.hasAttribute('aria-disabled')).toBe(false);

    instance.off.set(true);
    flushSync();

    // The file can still be retried as far as the primitive knows, so it is
    // the upload being switched off that has to say so.
    expect(retry.getAttribute('aria-disabled')).toBe('true');
    click(retry);
    click(rows(part('own'))[0]!.querySelector<HTMLElement>('.mine-retry')!);
    expect(instance.server.requests).toHaveLength(2);
    expect(rows(host).map((row) => row.getAttribute('data-status'))).toEqual(['error', 'error']);

    instance.off.set(false);
    flushSync();
    expect(retry.hasAttribute('aria-disabled')).toBe(false);
    click(retry);
    expect(instance.server.requests).toHaveLength(3);
  });

  it('leaves focus where it was when it was not on the row being removed', () => {
    @Component({
      selector: 'v-page',
      imports: [VFileUpload],
      render: compileTemplate(`
        <input class="elsewhere">
        <v-file-upload :transport="server.transport"></v-file-upload>
      `),
    })
    class Page {
      server = new Server();
    }

    const { host } = show(Page);
    choose(picker(host), [file('beach.png', 10), file('dunes.png', 10), file('cliff.png', 10)]);

    // A pointer that removes a file need not take focus with it — Safari does
    // not focus a button it clicks — so wherever focus was is where it stays:
    // in a field elsewhere on the page, or on another row.
    const elsewhere = host.querySelector<HTMLInputElement>('.elsewhere')!;
    elsewhere.focus();
    click(removeOf(rows(host)[0]!));
    expect(rows(host)).toHaveLength(2);
    expect(document.activeElement).toBe(elsewhere);

    const other = removeOf(rows(host)[1]!);
    other.focus();
    click(removeOf(rows(host)[0]!));
    expect(rows(host)).toHaveLength(1);
    expect(document.activeElement).toBe(other);
  });

  it('posts nothing for a file whose transport answered with an empty string', async () => {
    @Component({
      selector: 'v-page',
      imports: [VFileUpload],
      render: compileTemplate(`
        <form><v-file-upload :transport="server.transport" name="attachments"></v-file-upload></form>
      `),
    })
    class Page {
      server = new Server();
    }

    const { instance, host } = show(Page);
    choose(picker(host), [file('beach.png', 10), file('dunes.png', 10)]);
    instance.server.for('beach.png').resolve('');
    instance.server.for('dunes.png').resolve('f_2');
    await settle();

    expect(rows(host).map((row) => row.getAttribute('data-status'))).toEqual(['success', 'success']);
    expect(new FormData(host.querySelector('form')!).getAll('attachments')).toEqual(['f_2']);
    // Carried by an input nobody sees: one per reference, and nothing else.
    expect(posted(host)).toHaveLength(1);
    expect(host.querySelectorAll('input:not([type="file"]):not([type="hidden"])')).toHaveLength(0);
  });

  it('reads a name, a label or a list of ids that is only spaces as not said at all', async () => {
    @Component({
      selector: 'v-page',
      imports: [VFileUpload],
      render: compileTemplate(`
        <form>
          <v-file-upload :transport="server.transport" label="   " aria-label="  " aria-labelledby=" "
                         aria-describedby="  note  " name="  "></v-file-upload>
          <p id="note">Shared with the team.</p>
        </form>
      `),
    })
    class Page {
      server = new Server();
    }

    const { instance, host } = show(Page);

    // Blank words fall back to the default ones, and a blank name to them.
    expect(words(host).textContent).toBe('Drop files here, or press to choose files');
    expect(zone(host).hasAttribute('aria-label')).toBe(false);
    expect(zone(host).hasAttribute('aria-labelledby')).toBe(false);
    expect(picker(host).getAttribute('aria-labelledby')).toBe(words(host).id);
    // A list of ids is written without the spaces round it.
    expect(zone(host).getAttribute('aria-describedby')).toBe(`${message(host).id} note`);

    // And a blank `name` posts nothing, rather than posting under "  ".
    choose(picker(host), [file('beach.png', 10)]);
    instance.server.for('beach.png').resolve('f_1');
    await settle();
    expect(posted(host)).toHaveLength(0);
    expect([...new FormData(host.querySelector('form')!).keys()]).toEqual([]);
  });

  it('draws a bar as finished only for a file that arrived, not one refused once it was sent', async () => {
    @Component({
      selector: 'v-page',
      imports: [VFileUpload],
      render: compileTemplate(`<v-file-upload :transport="server.transport"></v-file-upload>`),
    })
    class Page {
      server = new Server();
    }

    const { instance, host } = show(Page);
    choose(picker(host), [file('beach.png', 10), file('dunes.png', 10)]);
    const [refused, arrived] = rows(host);

    // Every byte of both goes up — which is where `xhrTransport` is when a
    // server answers 413 or 500 — and then one is refused.
    instance.server.for('beach.png').request.progress(10);
    instance.server.for('dunes.png').request.progress(10);
    instance.server.for('beach.png').reject(new Error('Upload failed with status 500'));
    instance.server.for('dunes.png').resolve('f_2');
    await settle();

    expect(refused!.getAttribute('data-status')).toBe('error');
    expect(arrived!.getAttribute('data-status')).toBe('success');
    // The bytes did all leave, and the bar says so in its length and its
    // value; it is the finished colour that would say the file arrived.
    expect(indicator(refused!).style.getPropertyValue('inline-size')).toBe('100%');
    expect(indicator(refused!).getAttribute('data-state')).not.toBe('complete');
    expect(indicator(arrived!).getAttribute('data-state')).toBe('complete');

    // Sent again, and arriving this time, it is drawn finished like any other.
    click(retryOf(refused!)!);
    instance.server.for('beach.png').request.progress(10);
    instance.server.for('beach.png').resolve('f_1');
    await settle();
    expect(indicator(refused!).getAttribute('data-state')).toBe('complete');
  });

  it('writes the bar’s value and its end on the indicator, as `<v-progress>` does', () => {
    @Component({
      selector: 'v-page',
      imports: [VFileUpload],
      render: compileTemplate(`<v-file-upload :transport="server.transport"></v-file-upload>`),
    })
    class Page {
      server = new Server();
    }

    const { instance, host } = show(Page);
    choose(picker(host), [file('beach.png', 10)]);
    const [row] = rows(host);
    expect(indicator(row!).getAttribute('data-value')).toBe('0');
    expect(indicator(row!).getAttribute('data-max')).toBe('100');

    instance.server.for('beach.png').request.progress(5);
    flushSync();
    expect(indicator(row!).getAttribute('data-value')).toBe('50');
    expect(bar(row!)!.getAttribute('aria-valuenow')).toBe('50');
  });
});

/**
 * The cascade a forced palette leaves, measured by the palette's own names.
 *
 * The pairs in `forced-colors.test.ts` ask only whether two states still
 * differ. A disabled zone whose words stayed `CanvasText` still differs from a
 * live one by its edge, and passes there — while the largest thing in the box,
 * the words, says it is available. What a reader is shown is asked here.
 */
describe('v-file-upload, once the palette is the user’s', () => {
  const forced = styledDocument({ forcedColors: true });
  afterAll(() => forced.close());

  /** The sheet as `harness.ts` installs it, with system colours as stand-ins. */
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
      `${rulesToCss(asTested(fileUploadStyles.rules))}\n` +
        wrap(FORCED_COLORS_QUERY, rulesToCss(asTested(fileUploadStyles.forcedColors), '  ')),
    );
  });

  const style = (element: Element): CSSStyleDeclaration =>
    element.ownerDocument.defaultView!.getComputedStyle(element);

  /** The field with its zone, as the primitive marks both. */
  const field = (on: Record<string, string> = {}): Element =>
    forced.mount({
      classes: ['volt-file-upload'],
      attributes: { 'data-state': 'valid', ...on },
      children: [
        {
          classes: ['volt-file-upload-zone'],
          attributes: { role: 'button', tabindex: '0', ...on },
          children: [{ tag: 'span', classes: ['volt-file-upload-label'] }],
        },
      ],
    });

  const EDGES = ['block-start', 'block-end', 'inline-start', 'inline-end'] as const;
  const edge = (element: Element, part: 'color' | 'width' | 'style', at = 'inline-start') =>
    style(element).getPropertyValue(`border-${at}-${part}`);

  it('says unavailable in `GrayText` across the whole zone, its words included, undimmed', () => {
    const live = field();
    const off = field({ 'aria-disabled': 'true', 'data-disabled': '' });
    const words = (root: Element) => root.querySelector('.volt-file-upload-label')!;
    const zoneOf = (root: Element) => root.querySelector('.volt-file-upload-zone')!;

    expect(style(words(live)).getPropertyValue('color')).toBe(standIn('CanvasText'));
    expect(style(zoneOf(live)).getPropertyValue('color')).toBe(standIn('CanvasText'));

    // The words are what a reader looks at, so they have to say it too: a
    // grey edge round words drawn at full contrast reads as available.
    expect(style(words(off)).getPropertyValue('color')).toBe(standIn('GrayText'));
    expect(style(zoneOf(off)).getPropertyValue('color')).toBe(standIn('GrayText'));
    for (const at of EDGES) expect(edge(zoneOf(off), 'color', at), at).toBe(standIn('GrayText'));
    expect(style(zoneOf(off)).getPropertyValue('opacity')).toBe('1');
  });

  it('marks a drag in `Highlight` and in a thicker edge, which no palette takes away', () => {
    const rest = field().querySelector('.volt-file-upload-zone')!;
    const over = field({ 'data-dragging': '' }).querySelector('.volt-file-upload-zone')!;
    for (const at of EDGES) {
      expect(edge(over, 'color', at), at).toBe(standIn('Highlight'));
      expect(Number.parseFloat(edge(over, 'width', at)), at).toBeGreaterThan(
        Number.parseFloat(edge(rest, 'width', at)),
      );
    }
  });

  it('draws a failed row and the field’s message with the alert’s dotted edge', () => {
    const row = (error?: string): Fixture => ({
      tag: 'li',
      classes: ['volt-file-upload-item'],
      attributes: { 'data-status': error ? 'error' : 'cancelled', ...(error ? { 'data-error': error } : {}) },
    });
    const failed = forced.mount(row('transport'));
    const cancelled = forced.mount(row());
    expect(edge(failed, 'style')).toBe('dotted');
    expect(edge(cancelled, 'style')).toBe('solid');
    expect(Number.parseFloat(edge(failed, 'width'))).toBeGreaterThan(
      Number.parseFloat(edge(cancelled, 'width')),
    );

    const message = forced.mount({
      tag: 'p',
      classes: ['volt-file-upload-error'],
      attributes: { role: 'alert', 'data-state': 'invalid' },
    });
    expect(edge(message, 'style')).toBe('dotted');
    expect(edge(message, 'color')).toBe(standIn('CanvasText'));
  });

  it('says a row’s button is unavailable in `GrayText`, undimmed', () => {
    const button = (on: Record<string, string> = {}) =>
      forced.mount({
        tag: 'button',
        classes: ['volt-file-upload-action'],
        attributes: { type: 'button', ...on },
      });
    expect(style(button()).getPropertyValue('color')).toBe(standIn('ButtonText'));
    const off = button({ 'aria-disabled': 'true' });
    expect(style(off).getPropertyValue('color')).toBe(standIn('GrayText'));
    expect(style(off).getPropertyValue('opacity')).toBe('1');
  });
});
