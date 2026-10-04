/**
 * `<v-password-input>`, driven the way a page drives it.
 *
 * The behaviour is `createPasswordInput`'s and `createFormField`'s, and is
 * tested where it lives. What is tested here is the shell: that what a caller
 * writes on the tag reaches the box rather than the row around it or the
 * toggle beside it, that the parts are really tied to one another, that the
 * toggle is out of the form's way and in step with the field, that every state
 * the sheet's rules select on is written on the element those rules name, and
 * that nothing about the primitive is out of reach.
 */
import { compileComponents } from './render.js';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Window } from 'happy-dom';
import { Component, Signal, flushSync, mount } from '@voltdev/core';
import { compileTemplate } from '@voltdev/core/jit';
import { renderToStaticMarkup } from '@voltdev/core/server';
import template from '../src/components/password-input.html?raw';
import { FORCED_COLORS_QUERY, rulesToCss, tokensCss, wrap, type Rule } from '../src/index.ts';
import { passwordInputStyles } from '../src/sheet/password-input.ts';
import { SYSTEM_COLORS, standIn } from './harness.ts';
import { VPasswordInput } from '../src/components/password-input.js';

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

const field = (host: HTMLElement): HTMLElement => host.querySelector('.volt-field')!;
const row = (host: HTMLElement): HTMLElement => host.querySelector('.volt-password-input')!;
const label = (host: HTMLElement): HTMLLabelElement => host.querySelector('label')!;
const box = (host: HTMLElement): HTMLInputElement => host.querySelector('input')!;
const toggle = (host: HTMLElement): HTMLButtonElement =>
  host.querySelector('.volt-password-input-toggle')!;
const status = (host: HTMLElement): HTMLElement =>
  host.querySelector('.volt-password-input-status')!;
const hint = (host: HTMLElement): HTMLElement => host.querySelector('.volt-field-description')!;
const error = (host: HTMLElement): HTMLElement => host.querySelector('.volt-field-error')!;

/** An edit as the user makes it: the box first, then the event it fires. */
function type(el: HTMLInputElement, text: string): void {
  el.value = text;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

/** A press, as a pointer or the platform's own Enter and Space deliver one. */
function press(el: Element): void {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  flushSync();
}

/** Leaving the field. `blur` does not bubble, so it is sent where it lands. */
function leave(el: Element): void {
  el.dispatchEvent(new Event('blur'));
  flushSync();
}

/** A submit as a press on the button makes it, so it can be refused. */
function submit(form: HTMLFormElement): boolean {
  const event = new Event('submit', { bubbles: true, cancelable: true });
  form.dispatchEvent(event);
  flushSync();
  return !event.defaultPrevented;
}

describe('v-password-input', () => {
  it('is a label, a box, a toggle, a line of help, a message and a live region, tied together', () => {
    @Component({
      selector: 'v-page',
      imports: [VPasswordInput],
      render: compileTemplate(
        `<v-password-input class="mine" id="pw" name="password" label="Password"
                           description="At least eight characters."></v-password-input>`,
      ),
    })
    class Page {}

    const { host } = show(Page);

    // What the caller wrote lands on the box: it is the control, and the row
    // and the toggle beside it are nobody's business but the sheet's.
    expect([...box(host).classList].sort()).toEqual(['mine', 'volt-field-control']);
    expect(field(host).classList.contains('mine')).toBe(false);
    expect(row(host).classList.contains('mine')).toBe(false);
    expect(toggle(host).classList.contains('mine')).toBe(false);

    // One id, used by every part that refers to the box.
    expect(box(host).id).toBe('pw');
    expect(label(host).getAttribute('for')).toBe('pw');
    expect(toggle(host).getAttribute('aria-controls')).toBe('pw');
    expect(label(host).textContent).toBe('Password');
    expect(box(host).name).toBe('password');
    expect(box(host).getAttribute('aria-labelledby')).toBe(label(host).id);
    expect(hint(host).textContent).toBe('At least eight characters.');
    expect(box(host).getAttribute('aria-describedby')).toBe(`${hint(host).id} ${error(host).id}`);

    // Hidden to start with, and the two things the primitive says about that.
    expect(box(host).type).toBe('password');
    expect(box(host).hasAttribute('data-revealed')).toBe(false);
    expect(toggle(host).getAttribute('aria-label')).toBe('Show password');
    expect(toggle(host).textContent).toBe('Show password');
    expect(toggle(host).getAttribute('data-state')).toBe('hidden');
    expect(toggle(host).hasAttribute('aria-pressed')).toBe(false);
    expect(status(host).getAttribute('role')).toBe('status');
    expect(status(host).getAttribute('aria-live')).toBe('polite');
    expect(status(host).textContent).toBe('Password hidden');

    // A password is not a word: none of the help a text box asks for.
    expect(box(host).getAttribute('autocomplete')).toBe('current-password');
    expect(box(host).getAttribute('spellcheck')).toBe('false');
    expect(box(host).getAttribute('autocapitalize')).toBe('off');

    // The message line is on the page while there is no message, so the live
    // region is one a screen reader was already watching.
    expect(error(host).getAttribute('role')).toBe('alert');
    expect(error(host).textContent).toBe('');
  });

  it('lands what the caller writes on the tag on the box, and nowhere else', () => {
    @Component({
      selector: 'v-page12',
      imports: [VPasswordInput],
      render: compileTemplate(
        `<v-password-input class="mine" id="secret" aria-label="Account password"
                           title="Case matters" data-testid="pw"></v-password-input>`,
      ),
    })
    class Page12 {}

    const { host } = show(Page12);
    const others = [field(host), row(host), toggle(host), label(host), status(host)];

    expect(box(host).classList.contains('mine')).toBe(true);
    expect(box(host).id).toBe('secret');
    expect(box(host).getAttribute('aria-label')).toBe('Account password');
    expect(box(host).getAttribute('title')).toBe('Case matters');
    expect(box(host).getAttribute('data-testid')).toBe('pw');
    for (const other of others) {
      expect(other.classList.contains('mine')).toBe(false);
      expect(other.id).not.toBe('secret');
      expect(other.hasAttribute('title')).toBe(false);
      expect(other.hasAttribute('data-testid')).toBe(false);
    }
    // The toggle keeps the name the primitive gave it: the caller named the box.
    expect(toggle(host).getAttribute('aria-label')).toBe('Show password');
    expect(toggle(host).getAttribute('aria-controls')).toBe('secret');
    expect(label(host).getAttribute('for')).toBe('secret');
  });

  it('renders something every one of the sheet’s rules selects, in some state', () => {
    @Component({
      selector: 'v-page13',
      imports: [VPasswordInput],
      render: compileTemplate(
        `<v-password-input :ref="handle" label="Password" :disabled="off.get()"></v-password-input>`,
      ),
    })
    class Page13 {
      handle: VPasswordInput | null = null;
      off = new Signal.State(false);
    }

    const { instance, host } = show(Page13);
    // The pointer and keyboard focus are not driven here; what is asked is
    // whether the classes and attributes around them are ones this renders.
    const unmatched = new Set(
      [...passwordInputStyles.rules, ...passwordInputStyles.forcedColors].map((rule) =>
        rule.selector.replaceAll(':hover', '').replaceAll(':focus-visible', ''),
      ),
    );
    const look = (): void => {
      for (const selector of unmatched) if (host.querySelector(selector)) unmatched.delete(selector);
    };

    look();
    instance.handle!.password.show();
    flushSync();
    look();
    instance.off.set(true);
    flushSync();
    look();
    instance.handle!.password.hide();
    flushSync();
    look();

    expect([...unmatched]).toEqual([]);
  });

  it('shows the password on a press, and says so twice over', () => {
    @Component({
      selector: 'v-page',
      imports: [VPasswordInput],
      render: compileTemplate(`<v-password-input label="Password"></v-password-input>`),
    })
    class Page {}

    const { host } = show(Page);

    // The toggle names the box it acts on, by the id the field made for it.
    expect(box(host).id).not.toBe('');
    expect(toggle(host).getAttribute('aria-controls')).toBe(box(host).id);

    press(toggle(host));
    expect(box(host).type).toBe('text');
    expect(box(host).getAttribute('data-revealed')).toBe('');
    // The name a screen reader reads next time it lands on the toggle, and the
    // words a sighted user reads, which are the same words...
    expect(toggle(host).getAttribute('aria-label')).toBe('Hide password');
    expect(toggle(host).textContent).toBe('Hide password');
    expect(toggle(host).getAttribute('data-state')).toBe('revealed');
    // ...and the region that speaks at the moment of the press.
    expect(status(host).textContent).toBe('Password shown');

    press(toggle(host));
    expect(box(host).type).toBe('password');
    expect(toggle(host).getAttribute('aria-label')).toBe('Show password');
    expect(toggle(host).getAttribute('data-state')).toBe('hidden');
    expect(status(host).textContent).toBe('Password hidden');
  });

  it('keeps the toggle out of the form’s submit path', () => {
    const submits: Event[] = [];

    @Component({
      selector: 'v-page',
      imports: [VPasswordInput],
      render: compileTemplate(`
        <form :submit="record($event)">
          <v-password-input label="Password" name="password" defaultValue="hunter2"></v-password-input>
          <button class="go">Sign in</button>
        </form>
      `),
    })
    class Page {
      record = (event: Event): void => {
        event.preventDefault();
        submits.push(event);
      };
    }

    const { host } = show(Page);
    const form = host.querySelector('form')!;

    // A real `<button type="button">`: Enter and Space on it are the
    // platform's own, the primitive adds no keyboard of its own, and a press
    // is never a submit.
    expect(toggle(host)).toBeInstanceOf(HTMLButtonElement);
    expect(toggle(host).type).toBe('button');
    expect(toggle(host).tabIndex).toBe(0);
    press(toggle(host));
    expect(submits).toHaveLength(0);
    expect(box(host).type).toBe('text');

    // A press on a button that does submit is heard, so the silence above is
    // the toggle's doing and not this document's.
    press(host.querySelector('.go')!);
    expect(submits).toHaveLength(1);
    expect((submits[0] as SubmitEvent).submitter).toBe(host.querySelector('.go'));

    // Nothing of the toggle's goes with the form: the box is the one control.
    expect([...new FormData(form).entries()]).toEqual([['password', 'hunter2']]);
  });

  it('follows a revealed signal, and writes a press back into it', () => {
    const heard: boolean[] = [];

    @Component({
      selector: 'v-page',
      imports: [VPasswordInput],
      render: compileTemplate(
        `<v-password-input label="Password" :revealed="shown" :onRevealedChange="hear"></v-password-input>`,
      ),
    })
    class Page {
      shown = new Signal.State(false);
      hear = (revealed: boolean): void => void heard.push(revealed);
    }

    const { instance, host } = show(Page);
    expect(box(host).type).toBe('password');

    instance.shown.set(true);
    flushSync();
    expect(box(host).type).toBe('text');
    expect(toggle(host).getAttribute('data-state')).toBe('revealed');
    // Driven from outside, so nobody pressed anything and nothing is reported.
    expect(heard).toEqual([]);

    press(toggle(host));
    expect(instance.shown.get()).toBe(false);
    expect(box(host).type).toBe('password');
    expect(heard).toEqual([false]);
  });

  it('starts revealed when told to', () => {
    @Component({
      selector: 'v-page',
      imports: [VPasswordInput],
      render: compileTemplate(`<v-password-input label="Password" defaultRevealed></v-password-input>`),
    })
    class Page {}

    const { host } = show(Page);
    expect(box(host).type).toBe('text');
    expect(toggle(host).getAttribute('aria-label')).toBe('Hide password');
    expect(status(host).textContent).toBe('Password shown');
  });

  it('takes the wording it is given, in the name, the words and the announcement', () => {
    @Component({
      selector: 'v-page',
      imports: [VPasswordInput],
      render: compileTemplate(`
        <form>
          <v-password-input label="Password" name="password" required :labels="wording"></v-password-input>
        </form>
      `),
    })
    class Page {
      wording = {
        show: 'Reveal',
        hide: 'Conceal',
        shown: 'Now visible',
        hidden: 'Now hidden',
        valueMissing: 'Type your password.',
      };
    }

    const { host } = show(Page);
    const form = host.querySelector('form')!;

    expect(toggle(host).getAttribute('aria-label')).toBe('Reveal');
    // The words follow the name, so a renamed toggle reads as it is named.
    expect(toggle(host).textContent).toBe('Reveal');
    expect(status(host).textContent).toBe('Now hidden');

    press(toggle(host));
    expect(toggle(host).getAttribute('aria-label')).toBe('Conceal');
    expect(toggle(host).textContent).toBe('Conceal');
    expect(status(host).textContent).toBe('Now visible');

    // The same `labels` carries the field's wording, since the one object is
    // the primitive's.
    expect(submit(form)).toBe(false);
    expect(error(host).textContent).toBe('Type your password.');
  });

  it('draws an icon pair in the toggle slot, and hands it the state', () => {
    @Component({
      selector: 'v-page2',
      imports: [VPasswordInput],
      render: compileTemplate(`
        <v-password-input label="Password">
          <template :slot-toggle="{ revealed }">
            <span class="icon" aria-hidden="true">
              <svg :if="!revealed" class="eye" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /></svg>
              <svg :else class="eye-off" viewBox="0 0 24 24"><path d="M4 20 20 4" /></svg>
            </span>
          </template>
        </v-password-input>
      `),
    })
    class Page2 {}

    const { host } = show(Page2);
    const drawn = (): string[] =>
      [...toggle(host).querySelectorAll('svg')].map((svg) => svg.getAttribute('class')!);

    // The half for the state it starts in, from the first frame, and the
    // default words gone: the slot is filled.
    expect(drawn()).toEqual(['eye']);
    expect(toggle(host).textContent?.trim()).toBe('');
    // The name is still the primitive's: an icon is not a name.
    expect(toggle(host).getAttribute('aria-label')).toBe('Show password');

    press(toggle(host));
    expect(drawn()).toEqual(['eye-off']);
    expect(toggle(host).getAttribute('aria-label')).toBe('Hide password');

    press(toggle(host));
    expect(drawn()).toEqual(['eye']);
  });

  it('reads `defaultRevealed` written as the attribute `"false"` as off', () => {
    @Component({
      selector: 'v-page',
      imports: [VPasswordInput],
      render: compileTemplate(
        `<v-password-input :ref="handle" label="Password" defaultRevealed="false"></v-password-input>`,
      ),
    })
    class Page {
      handle: VPasswordInput | null = null;
    }

    const { instance, host } = show(Page);
    expect(box(host).type).toBe('password');
    // A flag, not the string the attribute delivered.
    expect(instance.handle!.password.isRevealed()).toBe(false);
  });

  it('is a tab stop after the box, and keeps the caret where it was when the box has focus', async () => {
    @Component({
      selector: 'v-page',
      imports: [VPasswordInput],
      render: compileTemplate(
        `<v-password-input :ref="handle" label="Password" defaultValue="hunter22"></v-password-input>`,
      ),
    })
    class Page {
      handle: VPasswordInput | null = null;
    }

    const { instance, host } = show(Page);

    // Reached by Tab from the box, in the order the two are drawn.
    expect(box(host).compareDocumentPosition(toggle(host)) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(toggle(host).tabIndex).toBe(0);
    expect(toggle(host).hasAttribute('tabindex')).toBe(false);

    // A reveal from a shortcut, with the user halfway through correcting the
    // box: the selection comes back once the type has changed under it, which
    // it can only do if the primitive was handed the box this draws.
    box(host).focus();
    box(host).setSelectionRange(2, 5);
    instance.handle!.password.toggle();
    flushSync();
    // What some engines do to a box whose type has just changed.
    box(host).setSelectionRange(8, 8);
    await Promise.resolve();
    expect(box(host).type).toBe('text');
    expect([box(host).selectionStart, box(host).selectionEnd]).toEqual([2, 5]);
  });

  it('takes the toggle out of use with the field, and never for read-only', () => {
    @Component({
      selector: 'v-page',
      imports: [VPasswordInput],
      render: compileTemplate(
        `<v-password-input label="Password" :disabled="off.get()" :readOnly="locked.get()"></v-password-input>`,
      ),
    })
    class Page {
      off = new Signal.State(false);
      locked = new Signal.State(false);
    }

    const { instance, host } = show(Page);
    expect(box(host).disabled).toBe(false);
    expect(toggle(host).disabled).toBe(false);

    // Disabled is the platform's own attribute on both: the field is not part
    // of the form, and a toggle a keyboard could still reach would show a
    // password nobody can edit.
    instance.off.set(true);
    flushSync();
    expect(box(host).disabled).toBe(true);
    expect(box(host).getAttribute('aria-disabled')).toBe('true');
    expect(toggle(host).disabled).toBe(true);
    expect(toggle(host).matches(':disabled')).toBe(true);

    instance.off.set(false);
    flushSync();
    expect(toggle(host).disabled).toBe(false);

    // A value that cannot be edited can still be looked at.
    instance.locked.set(true);
    flushSync();
    expect(box(host).readOnly).toBe(true);
    expect(box(host).getAttribute('aria-readonly')).toBe('true');
    expect(toggle(host).disabled).toBe(false);
    press(toggle(host));
    expect(box(host).type).toBe('text');
  });

  it('follows a label and a requirement bound to signals', () => {
    @Component({
      selector: 'v-page',
      imports: [VPasswordInput],
      render: compileTemplate(`
        <form>
          <v-password-input name="password" :label="words.get()" :required="needed.get()"></v-password-input>
        </form>
      `),
    })
    class Page {
      words = new Signal.State('Password');
      needed = new Signal.State(false);
    }

    const { instance, host } = show(Page);
    const form = host.querySelector('form')!;

    expect(label(host).textContent).toBe('Password');
    expect(box(host).required).toBe(false);
    expect(submit(form)).toBe(true);

    instance.words.set('Account password');
    instance.needed.set(true);
    flushSync();
    expect(label(host).textContent).toBe('Account password');
    expect(box(host).required).toBe(true);
    expect(box(host).getAttribute('aria-required')).toBe('true');
    expect(field(host).hasAttribute('data-required')).toBe(true);
    expect(submit(form)).toBe(false);

    instance.needed.set(false);
    flushSync();
    expect(box(host).required).toBe(false);
  });

  it('says a verdict that arrived while the field was out of use, once it is back', () => {
    @Component({
      selector: 'v-page',
      imports: [VPasswordInput],
      render: compileTemplate(`
        <form>
          <v-password-input label="Password" name="password" defaultValue="hunter2"
                            :disabled="busy.get()" :readOnly="locked.get()"
                            :prop-error="refused.get()"></v-password-input>
        </form>
      `),
    })
    class Page {
      busy = new Signal.State(false);
      locked = new Signal.State(false);
      refused = new Signal.State('');
    }

    const { instance, host } = show(Page);
    const form = host.querySelector('form')!;

    // The page takes the field out of use while it asks, hears back while it
    // still is — a pause before the next attempt — and then hands it back.
    // The verdict stands, so it has to reach the screen and the control, or
    // the next submit goes through the platform on a password the page has
    // already refused.
    instance.busy.set(true);
    flushSync();
    instance.refused.set('That is not the password for this account.');
    flushSync();
    expect(error(host).textContent).toBe('');

    instance.busy.set(false);
    flushSync();
    expect(error(host).textContent).toBe('That is not the password for this account.');
    expect(box(host).getAttribute('aria-invalid')).toBe('true');
    expect(box(host).validationMessage).toBe('That is not the password for this account.');

    // Read-only is out of use in the same way, and comes back the same way.
    instance.refused.set('');
    flushSync();
    instance.locked.set(true);
    flushSync();
    instance.refused.set('Locked for a minute.');
    flushSync();
    expect(error(host).textContent).toBe('');
    instance.locked.set(false);
    flushSync();
    expect(error(host).textContent).toBe('Locked for a minute.');
    expect(submit(form)).toBe(false);
  });

  it('writes every state the sheet’s rules select on', async () => {
    let answer: (message: string | undefined) => void = () => {};

    @Component({
      selector: 'v-page',
      imports: [VPasswordInput],
      render: compileTemplate(`
        <v-password-input label="Password" validateOn="blur" :validate="check"></v-password-input>
      `),
    })
    class Page {
      check = (): Promise<string | undefined> =>
        new Promise<string | undefined>((resolve) => {
          answer = resolve;
        });
    }

    const { host } = show(Page);
    const state = (): string | null => box(host).getAttribute('data-state');

    // The field's states, on the field's control.
    expect(state()).toBe('valid');
    type(box(host), 'correct horse');
    leave(box(host));
    expect(state()).toBe('pending');
    expect(box(host).getAttribute('aria-busy')).toBe('true');

    answer('Too easy to guess.');
    await vi.waitUntil(() => state() === 'invalid');
    expect(box(host).getAttribute('aria-invalid')).toBe('true');
    expect(error(host).textContent).toBe('Too easy to guess.');
    expect(field(host).getAttribute('data-state')).toBe('invalid');

    // The toggle's own, which the sheet draws over.
    expect(toggle(host).getAttribute('data-state')).toBe('hidden');
    press(toggle(host));
    expect(toggle(host).getAttribute('data-state')).toBe('revealed');
  });

  it('forwards every option the primitive takes once', () => {
    @Component({
      selector: 'v-page',
      imports: [VPasswordInput],
      render: compileTemplate(`
        <form>
          <v-password-input label="New password" id="new" name="new" autoComplete="new-password"
                            placeholder="At least eight characters" :minLength="8" :maxLength="64"
                            pattern="[^\\s]+" defaultValue="hunter22"></v-password-input>
        </form>
      `),
    })
    class Page {}

    const { host } = show(Page);
    const form = host.querySelector('form')!;

    expect(box(host).id).toBe('new');
    expect(box(host).name).toBe('new');
    expect(box(host).getAttribute('autocomplete')).toBe('new-password');
    expect(box(host).getAttribute('placeholder')).toBe('At least eight characters');
    expect(box(host).getAttribute('minlength')).toBe('8');
    expect(box(host).getAttribute('maxlength')).toBe('64');
    expect(box(host).getAttribute('pattern')).toBe('[^\\s]+');

    expect(box(host).value).toBe('hunter22');
    type(box(host), 'hunter2');
    form.reset();
    flushSync();
    // A reset restores the control's default, and the field follows it.
    expect(box(host).value).toBe('hunter22');
  });

  it('follows a value bound to a signal, and reports every edit', () => {
    const seen: string[] = [];

    @Component({
      selector: 'v-page',
      imports: [VPasswordInput],
      render: compileTemplate(
        `<v-password-input label="Password" :value="secret" :onValueChange="record"></v-password-input>`,
      ),
    })
    class Page {
      secret = new Signal.State('hunter2');
      record = (value: string): void => void seen.push(value);
    }

    const { instance, host } = show(Page);
    expect(box(host).value).toBe('hunter2');
    expect(box(host).hasAttribute('data-empty')).toBe(false);

    instance.secret.set('correct horse');
    flushSync();
    expect(box(host).value).toBe('correct horse');

    type(box(host), 'correct horse battery');
    expect(instance.secret.get()).toBe('correct horse battery');
    expect(seen).toEqual(['correct horse battery']);

    // Revealing keeps the value: only the type of the box changes.
    press(toggle(host));
    expect(box(host).value).toBe('correct horse battery');
    expect(instance.secret.get()).toBe('correct horse battery');

    type(box(host), '');
    expect(box(host).getAttribute('data-empty')).toBe('');
  });

  it('validates when it was told to, and again when it was told to', () => {
    @Component({
      selector: 'v-page',
      imports: [VPasswordInput],
      render: compileTemplate(`
        <v-password-input label="Password" validateOn="blur" revalidateOn="blur"
                          :validate="check"></v-password-input>
      `),
    })
    class Page {
      check = (value: string | null): string | undefined =>
        (value ?? '').length >= 8 ? undefined : 'Eight characters at least.';
    }

    const { host } = show(Page);
    const state = (): string | null => box(host).getAttribute('data-state');

    type(box(host), 'short');
    expect(state()).toBe('valid');

    leave(box(host));
    expect(state()).toBe('invalid');
    expect(error(host).textContent).toBe('Eight characters at least.');

    // `revalidateOn="blur"`, so the correction does not clear it until the
    // user leaves again.
    type(box(host), 'long enough');
    expect(state()).toBe('invalid');

    leave(box(host));
    expect(state()).toBe('valid');
    expect(error(host).textContent).toBe('');
  });

  it('shows a message it is handed, and refuses the submit for it', () => {
    @Component({
      selector: 'v-page',
      imports: [VPasswordInput],
      render: compileTemplate(`
        <form>
          <v-password-input label="Password" name="password" defaultValue="hunter2"
                            :prop-error="refused.get()"></v-password-input>
        </form>
      `),
    })
    class Page {
      refused = new Signal.State('');
    }

    const { instance, host } = show(Page);
    const form = host.querySelector('form')!;

    expect(submit(form)).toBe(true);
    expect(error(host).textContent).toBe('');

    // Shown at once, and pushed into the control: the platform refuses the
    // submit for the reason on screen.
    instance.refused.set('That is not the password for this account.');
    flushSync();
    expect(error(host).textContent).toBe('That is not the password for this account.');
    expect(box(host).getAttribute('aria-invalid')).toBe('true');
    expect(box(host).getAttribute('data-state')).toBe('invalid');
    expect(box(host).validity.customError).toBe(true);
    expect(submit(form)).toBe(false);

    // Taken back by the caller, without an edit in between.
    instance.refused.set('');
    flushSync();
    expect(error(host).textContent).toBe('');
    expect(box(host).getAttribute('data-state')).toBe('valid');
    expect(box(host).validity.customError).toBe(false);
    expect(submit(form)).toBe(true);
  });

  it('lets go of the message on the next edit, and says it again once it has changed', () => {
    @Component({
      selector: 'v-page3',
      imports: [VPasswordInput],
      render: compileTemplate(`
        <form>
          <v-password-input :ref="handle" label="Password" name="password"
                            defaultValue="hunter2" :prop-error="refused.get()"></v-password-input>
        </form>
      `),
    })
    class Page3 {
      handle: VPasswordInput | null = null;
      refused = new Signal.State('Wrong password.');
    }

    const { instance, host } = show(Page3);
    const form = host.querySelector('form')!;
    expect(error(host).textContent).toBe('Wrong password.');
    expect(submit(form)).toBe(false);

    // A message that survived every correction would be a form nobody could
    // submit — so the edit takes it out of the platform, and off the screen
    // with it under the default `revalidateOn`. The prop is what the page
    // bound, and stays so: the component has no business writing over it.
    type(box(host), 'hunter3');
    expect(error(host).textContent).toBe('');
    expect(box(host).validity.customError).toBe(false);
    expect(instance.handle!.error.get()).toBe('Wrong password.');
    expect(submit(form)).toBe(true);

    // The same words again are no change, and say nothing...
    instance.refused.set('Wrong password.');
    flushSync();
    expect(error(host).textContent).toBe('');

    // ...until the bound value has been cleared in between, which is what a
    // page that clears it as an attempt starts has done anyway.
    instance.refused.set('');
    flushSync();
    instance.refused.set('Wrong password.');
    flushSync();
    expect(error(host).textContent).toBe('Wrong password.');
    expect(submit(form)).toBe(false);
  });

  it('says a refusal that arrives with the box emptied, whichever is set first', () => {
    @Component({
      selector: 'v-page7',
      imports: [VPasswordInput],
      render: compileTemplate(`
        <form>
          <v-password-input label="Password" name="password" :value="secret"
                            :prop-error="refused.get()"></v-password-input>
        </form>
      `),
    })
    class Page7 {
      secret = new Signal.State('hunter2');
      refused = new Signal.State('');
    }

    const { instance, host } = show(Page7);
    const form = host.querySelector('form')!;

    // A failed sign-in that clears the box: the write into the box is an edit
    // to the field, and it must not take the refusal that came with it away.
    instance.secret.set('');
    instance.refused.set('That is not the password for this account.');
    flushSync();
    expect(box(host).value).toBe('');
    expect(error(host).textContent).toBe('That is not the password for this account.');
    expect(box(host).validity.customError).toBe(true);
    expect(submit(form)).toBe(false);

    type(box(host), 'hunter3');
    instance.refused.set('');
    flushSync();
    expect(error(host).textContent).toBe('');

    instance.refused.set('Still not it.');
    instance.secret.set('');
    flushSync();
    expect(box(host).value).toBe('');
    expect(error(host).textContent).toBe('Still not it.');
    expect(box(host).validity.customError).toBe(true);
  });

  it('does not bring back a message an edit let go of when the field changes state', () => {
    @Component({
      selector: 'v-page8',
      imports: [VPasswordInput],
      render: compileTemplate(`
        <form>
          <v-password-input label="Password" name="password" revalidateOn="blur"
                            :readOnly="locked.get()" :disabled="off.get()"
                            :prop-error="refused.get()"></v-password-input>
        </form>
      `),
    })
    class Page8 {
      locked = new Signal.State(false);
      off = new Signal.State(false);
      refused = new Signal.State('Wrong password.');
    }

    const { instance, host } = show(Page8);
    expect(box(host).validity.customError).toBe(true);

    type(box(host), 'hunter3');
    expect(box(host).validity.customError).toBe(false);

    // Neither is the page saying anything new about the value.
    for (const flag of [instance.locked, instance.off]) {
      flag.set(true);
      flushSync();
      flag.set(false);
      flushSync();
    }
    expect(box(host).validity.customError).toBe(false);

    leave(box(host));
    expect(error(host).textContent).toBe('');
  });

  it('does not bring back a message a reset let go of when the field changes state', () => {
    @Component({
      selector: 'v-page10',
      imports: [VPasswordInput],
      render: compileTemplate(`
        <form>
          <v-password-input label="Password" name="password" :value="secret"
                            :disabled="off.get()" :prop-error="refused.get()"></v-password-input>
        </form>
      `),
    })
    class Page10 {
      // Emptied, as a failed sign-in leaves it — so the reset below puts back
      // the text that is already there, and nothing about the value moves.
      secret = new Signal.State('');
      off = new Signal.State(false);
      refused = new Signal.State('Wrong password.');
    }

    const { instance, host } = show(Page10);
    const form = host.querySelector('form')!;
    expect(error(host).textContent).toBe('Wrong password.');

    // A reset forgets everything the field held, the refusal with it.
    form.reset();
    flushSync();
    expect(error(host).textContent).toBe('');
    expect(box(host).validity.customError).toBe(false);

    // Out of use and back says nothing new about the value.
    instance.off.set(true);
    flushSync();
    instance.off.set(false);
    flushSync();
    expect(error(host).textContent).toBe('');
    expect(box(host).validity.customError).toBe(false);
    expect(submit(form)).toBe(true);
  });

  it('does not bring back a message the page’s own write into the box let go of', () => {
    @Component({
      selector: 'v-page16',
      imports: [VPasswordInput],
      render: compileTemplate(`
        <form>
          <v-password-input label="Password" name="password" :value="secret"
                            :disabled="off.get()" :prop-error="refused.get()"></v-password-input>
        </form>
      `),
    })
    class Page16 {
      secret = new Signal.State('hunter2');
      off = new Signal.State(false);
      refused = new Signal.State('Wrong password.');
    }

    const { instance, host } = show(Page16);
    const form = host.querySelector('form')!;
    expect(error(host).textContent).toBe('Wrong password.');
    expect(box(host).validity.customError).toBe(true);

    // The page writes new text into the box itself — a password it generated,
    // say. That is an edit with no event, and the field lets go of the
    // refusal, which was about the old text.
    instance.secret.set('hunter3');
    flushSync();
    expect(box(host).value).toBe('hunter3');
    expect(box(host).validity.customError).toBe(false);

    // Out of use and back says nothing new about the value.
    instance.off.set(true);
    flushSync();
    instance.off.set(false);
    flushSync();
    expect(error(host).textContent).toBe('');
    expect(box(host).validity.customError).toBe(false);
    expect(submit(form)).toBe(true);
  });

  it('keeps a message standing through a reset that was called off', () => {
    @Component({
      selector: 'v-page14',
      imports: [VPasswordInput],
      render: compileTemplate(`
        <form>
          <v-password-input label="Password" name="password" :value="secret"
                            :disabled="off.get()" :prop-error="refused.get()"></v-password-input>
        </form>
      `),
    })
    class Page14 {
      secret = new Signal.State('');
      off = new Signal.State(false);
      refused = new Signal.State('Wrong password.');
    }

    const { instance, host } = show(Page14);
    const form = host.querySelector('form')!;
    // Called off ahead of every listener on the form, the field's included.
    host.addEventListener('reset', (event) => event.preventDefault(), true);

    // Nothing was put back, so the field holds what it held.
    form.reset();
    flushSync();
    expect(error(host).textContent).toBe('Wrong password.');

    // A submit while the field is out of use judges nothing, and takes the
    // message off the screen; back in use, it is said again.
    instance.off.set(true);
    flushSync();
    submit(form);
    expect(error(host).textContent).toBe('');
    instance.off.set(false);
    flushSync();
    expect(error(host).textContent).toBe('Wrong password.');
    expect(box(host).validity.customError).toBe(true);
  });

  // The `change` a blur commits, or the `input` a password manager fires as it
  // fills in the password the box already holds: the field lets go on the
  // event, not on the text, and so does what keeps the message standing.
  it.each(['change', 'input'])(
    'does not bring back a message an edit event let go of when the text did not move (%s)',
    (kind) => {
      @Component({
        selector: 'v-page11',
        imports: [VPasswordInput],
        render: compileTemplate(`
          <form>
            <v-password-input label="Password" name="password" defaultValue="hunter2"
                              :readOnly="locked.get()" :prop-error="refused.get()"></v-password-input>
          </form>
        `),
      })
      class Page11 {
        locked = new Signal.State(false);
        refused = new Signal.State('Wrong password.');
      }

      const { instance, host } = show(Page11);
      const form = host.querySelector('form')!;
      expect(error(host).textContent).toBe('Wrong password.');

      box(host).dispatchEvent(new Event(kind, { bubbles: true }));
      flushSync();
      expect(box(host).value).toBe('hunter2');
      expect(error(host).textContent).toBe('');
      expect(box(host).validity.customError).toBe(false);

      instance.locked.set(true);
      flushSync();
      instance.locked.set(false);
      flushSync();
      expect(error(host).textContent).toBe('');
      expect(submit(form)).toBe(true);
    },
  );

  it('tells the platform at once, and the screen when `revalidateOn` says so', () => {
    @Component({
      selector: 'v-page6',
      imports: [VPasswordInput],
      render: compileTemplate(`
        <form>
          <v-password-input :ref="handle" label="Password" name="password" required
                            revalidateOn="blur" :prop-error="refused.get()"></v-password-input>
        </form>
      `),
    })
    class Page6 {
      handle: VPasswordInput | null = null;
      refused = new Signal.State('');
    }

    const { instance, host } = show(Page6);
    const form = host.querySelector('form')!;
    const messages = (): readonly string[] => instance.handle!.password.field.messages();

    expect(submit(form)).toBe(false);
    const missing = messages()[0]!;
    expect(missing).not.toBe('');

    // Added after what the platform found, whose wording is already in the
    // user's language; the screen shows the first of them.
    instance.refused.set('Wrong password.');
    flushSync();
    expect(messages()).toEqual([missing, 'Wrong password.']);
    expect(error(host).textContent).toBe(missing);
    expect(box(host).validity.customError).toBe(true);

    // The edit: the platform lets go now, so the next submit is not refused
    // on the old value's account. What the screen showed stays until the next
    // blur, as any verdict does under `revalidateOn="blur"`.
    type(box(host), 'h');
    expect(box(host).validity.customError).toBe(false);
    expect(messages()).toEqual([missing, 'Wrong password.']);

    leave(box(host));
    expect(messages()).toEqual([]);
    expect(error(host).textContent).toBe('');
  });

  it('draws a label and a line of help written as markup, and follows words that change', () => {
    @Component({
      selector: 'v-page4',
      imports: [VPasswordInput],
      render: compileTemplate(`
        <v-password-input :description="help.get()">
          <template :slot-label>Password <abbr title="required">*</abbr></template>
        </v-password-input>
      `),
    })
    class Page4 {
      help = new Signal.State('At least eight characters.');
    }

    const { instance, host } = show(Page4);

    expect(label(host).querySelector('abbr')?.getAttribute('title')).toBe('required');
    expect(label(host).textContent).toContain('Password');
    expect(hint(host).textContent).toBe('At least eight characters.');
    // Still the elements the field points at, whatever was written into them.
    expect(box(host).getAttribute('aria-labelledby')).toBe(label(host).id);
    expect(box(host).getAttribute('aria-describedby')).toContain(hint(host).id);

    instance.help.set('Letters, numbers and symbols.');
    flushSync();
    expect(hint(host).textContent).toBe('Letters, numbers and symbols.');
  });

  it('draws a line of help written as markup, as the element the box is described by', () => {
    @Component({
      selector: 'v-page',
      imports: [VPasswordInput],
      render: compileTemplate(`
        <v-password-input label="Password">
          <template :slot-description>See the <a href="/rules">password rules</a>.</template>
        </v-password-input>
      `),
    })
    class Page {}

    const { host } = show(Page);

    expect(hint(host).querySelector('a')?.getAttribute('href')).toBe('/rules');
    expect(hint(host).textContent).toBe('See the password rules.');
    expect(box(host).getAttribute('aria-describedby')).toBe(`${hint(host).id} ${error(host).id}`);
  });

  it('adds what the caller says about the box to what the field says', () => {
    @Component({
      selector: 'v-page',
      imports: [VPasswordInput],
      render: compileTemplate(`
        <span id="heading">Sign in</span>
        <span id="rules">Case matters.</span>
        <v-password-input label="Password" aria-labelledby="heading"
                          :aria-describedby="extra.get()"></v-password-input>
      `),
    })
    class Page {
      extra = new Signal.State('rules');
    }

    const { instance, host } = show(Page);

    expect(box(host).getAttribute('aria-labelledby')).toBe('heading');
    expect(box(host).getAttribute('aria-describedby')).toBe(
      `${hint(host).id} ${error(host).id} rules`,
    );

    instance.extra.set('');
    flushSync();
    expect(box(host).getAttribute('aria-describedby')).toBe(`${hint(host).id} ${error(host).id}`);
  });

  it('follows a name from elsewhere bound to a signal, and takes its label back after', () => {
    @Component({
      selector: 'v-page15',
      imports: [VPasswordInput],
      render: compileTemplate(`
        <span id="heading">Sign in</span>
        <v-password-input label="Password" :aria-labelledby="from.get()"></v-password-input>
      `),
    })
    class Page15 {
      from = new Signal.State<string | undefined>(undefined);
    }

    const { instance, host } = show(Page15);
    expect(box(host).getAttribute('aria-labelledby')).toBe(label(host).id);

    // Named from the page after the first frame: the field's own reference
    // stands down for it then, not only when it was there from the start.
    instance.from.set('heading');
    flushSync();
    expect(box(host).getAttribute('aria-labelledby')).toBe('heading');

    // And comes back when what is bound comes to nothing.
    instance.from.set('  ');
    flushSync();
    expect(box(host).getAttribute('aria-labelledby')).toBe(label(host).id);
  });

  it('lets a name the caller wrote be the name the box has, and takes its label back after', () => {
    @Component({
      selector: 'v-page',
      imports: [VPasswordInput],
      render: compileTemplate(
        `<v-password-input label="Password" :aria-label="named.get()"></v-password-input>`,
      ),
    })
    class Page {
      named = new Signal.State<string | undefined>('Account password');
    }

    const { instance, host } = show(Page);

    // The field's reference would outrank the words, so it stands down; the
    // `for` stays, so a press on the words still puts the caret in the box.
    expect(box(host).getAttribute('aria-label')).toBe('Account password');
    expect(box(host).hasAttribute('aria-labelledby')).toBe(false);
    expect(label(host).getAttribute('for')).toBe(box(host).id);

    instance.named.set(undefined);
    flushSync();
    expect(box(host).hasAttribute('aria-label')).toBe(false);
    expect(box(host).getAttribute('aria-labelledby')).toBe(label(host).id);
  });

  it('is a password box again before a form is sent, for a page that hides it on submit', () => {
    const sent: string[] = [];

    @Component({
      selector: 'v-page9',
      imports: [VPasswordInput],
      render: compileTemplate(`
        <form :submit="send($event)">
          <v-password-input :ref="handle" label="Password" name="password"
                            defaultRevealed></v-password-input>
          <button class="go">Sign in</button>
        </form>
      `),
    })
    class Page9 {
      handle: VPasswordInput | null = null;
      send = (event: Event): void => {
        this.handle!.password.hide();
        flushSync();
        // What the browser would read once this returns and the form goes.
        sent.push((event.currentTarget as HTMLFormElement).querySelector('input')!.type);
        event.preventDefault();
      };
    }

    const { host } = show(Page9);
    expect(box(host).type).toBe('text');

    press(host.querySelector('.go')!);
    expect(sent).toEqual(['password']);
  });

  it('hands the primitive itself to whoever needs more than this offers', () => {
    @Component({
      selector: 'v-page5',
      imports: [VPasswordInput],
      render: compileTemplate(
        `<v-password-input :ref="handle" label="Password" :maxLength="12"></v-password-input>`,
      ),
    })
    class Page5 {
      handle: VPasswordInput | null = null;
    }

    const { instance, host } = show(Page5);
    const password = instance.handle!.password;

    expect(password.isRevealed()).toBe(false);
    expect(password.remaining()).toBe(12);

    password.show();
    flushSync();
    expect(box(host).type).toBe('text');
    expect(password.isRevealed()).toBe(true);

    password.setValue('hunter2');
    flushSync();
    expect(box(host).value).toBe('hunter2');
    expect(password.remaining()).toBe(5);

    password.field.setCustomValidity('Used before.');
    flushSync();
    expect(error(host).textContent).toBe('Used before.');

    password.hide();
    password.clear();
    flushSync();
    expect(box(host).type).toBe('password');
    expect(box(host).value).toBe('');
  });
});

describe('the toggle, once the palette is the user’s', () => {
  /**
   * The entry's rules in a document whose palette is forced, built as
   * `harness.ts` builds the whole sheet: unlayered, the pointer as
   * `data-hover`, and each system colour as a stand-in happy-dom keeps.
   */
  function forcedDocument(): Window {
    const dom = new Window({ settings: { device: { forcedColors: 'active' } } });
    const copy = (rules: readonly Rule[]): Rule[] =>
      rules.map((rule) => ({
        selector: rule.selector.replaceAll(':hover', '[data-hover]'),
        declarations: Object.fromEntries(
          Object.entries(rule.declarations).map(([property, value]) => [
            property,
            SYSTEM_COLORS.includes(value) ? standIn(value) : value,
          ]),
        ),
      }));
    const style = dom.document.createElement('style');
    style.textContent = [
      tokensCss(),
      rulesToCss(copy(passwordInputStyles.rules)),
      wrap(FORCED_COLORS_QUERY, rulesToCss(copy(passwordInputStyles.forcedColors), '  ')),
    ].join('\n\n');
    dom.document.head.append(style);
    return dom;
  }

  it('keeps the revealed pair together under the pointer', async () => {
    const dom = forcedDocument();
    const button = dom.document.createElement('button');
    button.className = 'volt-password-input-toggle';
    button.setAttribute('data-state', 'revealed');
    button.setAttribute('data-hover', '');
    dom.document.body.append(button);

    // The pointer's rule outranks the revealed one, and a fill of its own
    // there would leave the words in the colour of the button behind them.
    const style = dom.getComputedStyle(button);
    expect(style.getPropertyValue('background-color')).toBe(standIn('Highlight'));
    expect(style.getPropertyValue('color')).toBe(standIn('HighlightText'));
    expect(style.getPropertyValue('text-decoration-line')).toBe('underline');

    await dom.happyDOM.close();
  });

  /** A toggle in the forced document, and what it computes to there. */
  const look = (dom: Window, attributes: Record<string, string>, focus = false) => {
    const button = dom.document.createElement('button');
    button.className = 'volt-password-input-toggle';
    for (const [name, value] of Object.entries(attributes)) button.setAttribute(name, value);
    button.append(attributes['data-state'] === 'revealed' ? 'Hide password' : 'Show password');
    dom.document.body.append(button);
    if (focus) button.focus();
    const style = dom.getComputedStyle(button);
    const read = (property: string): string => style.getPropertyValue(property);
    return {
      adjust: read('forced-color-adjust'),
      fill: read('background-color'),
      text: read('color'),
      ring: read('outline-color'),
      edges: ['block-start', 'block-end', 'inline-start', 'inline-end'].map((edge) =>
        read(`border-${edge}-color`),
      ),
    };
  };

  const REVEALED = { 'data-state': 'revealed' };
  const HIDDEN = { 'data-state': 'hidden' };

  it('keeps the words on a revealed toggle from being painted over', async () => {
    // Left under the palette, Chrome paints a backplate of `Canvas` behind
    // every run of text, and its `HighlightText` is that same colour in the
    // dark scheme and the light: the toggle that hides the password again
    // would be a `Highlight` box with a blank where `Hide password` was.
    // Opting out hands back the backplate, and with it the words. happy-dom
    // paints nothing, so what is asked is the opt-out itself.
    const dom = forcedDocument();
    expect(look(dom, REVEALED).adjust).toBe('none');
    expect(look(dom, { ...REVEALED, 'data-hover': '' }).adjust).toBe('none');
    // Hidden stays under the palette, which chooses its colours.
    expect(look(dom, HIDDEN).adjust).not.toBe('none');
    await dom.happyDOM.close();
  });

  it('names every colour a revealed toggle paints from the palette', async () => {
    // Out from under the palette, nothing replaces a colour the forced rules
    // forget: the accent's hover shade on the edge, or the brand's focus
    // ring, would be drawn as written, in a palette the user chose so that
    // it would not be.
    const dom = forcedDocument();
    const palette = new Set(SYSTEM_COLORS.map(standIn));
    const shapes = {
      revealed: look(dom, REVEALED),
      hovered: look(dom, { ...REVEALED, 'data-hover': '' }),
      unavailable: look(dom, { ...REVEALED, disabled: '' }),
    };
    for (const [name, shape] of Object.entries(shapes)) {
      for (const colour of [shape.fill, shape.text, ...shape.edges]) {
        expect(palette, `${name}: ${colour}`).toContain(colour);
      }
    }
    expect(shapes.hovered.edges).toEqual(Array(4).fill(standIn('Highlight')));
    expect(look(dom, REVEALED, true).ring).toBe(standIn('Highlight'));
    await dom.happyDOM.close();
  });
});

describe('the field, written by a server', () => {
  const serverBuild = (on: boolean): void => {
    (globalThis as { __VOLT_SERVER__?: boolean }).__VOLT_SERVER__ = on;
  };
  beforeAll(() => serverBuild(true));
  afterAll(() => serverBuild(false));

  it('writes every attribute once, the toggle’s type among them', async () => {
    @Component({ selector: 'v-password-input', render: compileTemplate(template, 'v-password-input') })
    class ServerPasswordInput extends VPasswordInput {}

    @Component({
      selector: 'v-page-server',
      imports: [ServerPasswordInput],
      render: compileTemplate(`
        <form>
          <v-password-input class="mine" label="Password" name="password" disabled
                            defaultRevealed></v-password-input>
        </form>
      `),
    })
    class Page {}

    const { html } = await renderToStaticMarkup(Page);

    // Written twice, the second is a parse error the browser drops, and a
    // page that validates its markup is told about it on every field.
    for (const tag of html.match(/<[a-z][^>]*>/g) ?? []) {
      const names = [...tag.matchAll(/\s([^\s="'>/]+)(?==|\s|\/?>)/g)].map((match) => match[1]);
      expect(names.filter((name, at) => names.indexOf(name) !== at), tag).toEqual([]);
    }
    const buttons = html.match(/<button[^>]*>/g) ?? [];
    expect(buttons).toHaveLength(1);
    // Still a button that never submits, before any script has attached.
    expect(buttons[0]).toMatch(/\stype="button"/);
    expect(buttons[0]).toMatch(/\sdisabled[\s>=]/);
  });
});
