import { Component, Prop, Signal, effect, measureEffect, onCleanup } from '@voltdev/core';
import {
  createClipboard,
  createCode,
  useProvidedLocale,
  type Clipboard,
  type ClipboardLabels,
  type ClipboardProps,
  type Code,
  type CodeProps,
  type Locale,
} from '@voltdev/primitives';

declare const __VOLT_DEV__: boolean;

/** What the copy button says, and what is said once it has been pressed. */
export interface CodeWording {
  /** The button's name, and its words until it is pressed. Default "Copy code". */
  copy?: string;
  /**
   * Said once the code is on the clipboard, and shown on the button for as
   * long as that holds. Default the locale's `copied`, or "Copied".
   */
  copied?: string;
  /**
   * Said, interrupting, when the clipboard refused, and shown on the button
   * for as long as that holds. Default the locale's `copyFailed`, or "Could
   * not copy".
   */
  failed?: string;
}

/**
 * A flag, as a tag is able to deliver one.
 *
 * Written bare it is on, and bound it is whatever it was bound to. Written as
 * an attribute it is a string, and every string is truthy — so
 * `lineNumbers="false"` would number the lines it said not to. Every string
 * is on here but `"false"`, which nobody writes meaning on.
 */
function flag(value: unknown): boolean {
  return value !== false && value !== 'false' && value !== null && value !== undefined;
}

/**
 * Code, inline in a sentence or as a block of its own.
 *
 * ```html
 * <p>Call <v-code>Array.prototype.at</v-code> with a negative index.</p>
 *
 * <v-code block language="TypeScript" copyable lineNumbers>{ source }</v-code>
 * ```
 *
 * Inline, it is one `<code>`. A block is a `<pre>` around one, which becomes a
 * focusable, named region while — and only while — it has to be scrolled:
 * wider than its box, which the primitive measures, or taller than a height
 * the tag gave it, which this does. A scroll container a keyboard cannot
 * reach is code a keyboard user cannot read the end of, and a tab stop in
 * front of every snippet that fits is a Tab press that does nothing.
 *
 * What is drawn is what the tag holds, as it was written. Nothing here
 * highlights it: a highlighter's spans go inside the tag, where they are
 * drawn as they are and copied as the text they hold.
 *
 * What a caller writes on the tag lands on the element with the role: the
 * `<code>` of inline code, and the `<pre>` of a block, which is the region a
 * name belongs on and the box a class or a size is meant for. The copy button
 * and the line numbers are inside that box, so a block sized from the tag
 * carries them with it.
 */
@Component({ selector: 'v-code', templateUrl: './code.html' })
export class VCode {
  /**
   * A block of its own rather than a run of code inside a sentence. Written
   * bare — `block` — or bound; `block="false"` is the false it says.
   *
   * Read once, while the fields initialize — plain, because the primitive is
   * built with it and draws a block's props or an inline run's from then on: a
   * signal would promise a caller they could turn one into the other later.
   */
  @Prop() block = false;
  /**
   * The language the code is written in — `TypeScript`, `bash` — written to
   * `data-language` for a highlighter or a rule of your own to find, and said
   * in the name a block that scrolls is given.
   */
  @Prop() language = new Signal.State<string | null | undefined>(undefined);
  /**
   * The name a block that scrolls is announced by, in place of the
   * primitive's `Code, TypeScript` — the words a chat names a code part by, so
   * the same block is not called two things on one page.
   *
   * Only ever written while the `<pre>` has a role to carry it — the region's
   * while it scrolls, or one the caller wrote: a `<pre>` that fits is no
   * landmark, and ARIA prohibits naming an element with no role.
   */
  @Prop() label = new Signal.State<string | undefined>(undefined);
  /**
   * `label` in the platform's own spelling, declared rather than left to fall
   * through to `:host`.
   *
   * The primitive's bag names the region too, on the same element, and two
   * spreads writing one attribute leave whichever ran last; and while the
   * block fits, a name that fell through would sit on an element with no role
   * to carry it. Declared, it is merged into the bag at the moments the bag
   * names anything. Written as well as `label`, it is the one that wins: two
   * spellings of one name can only disagree by mistake, and the attribute is
   * the one written on the tag.
   */
  @Prop({ alias: 'aria-label' }) ariaLabel = new Signal.State<string | undefined>(undefined);
  /**
   * A role of the caller's own — `figure`, `term` — declared rather than left
   * to fall through to `:host`, for the reason `aria-label` is.
   *
   * The primitive writes a role on the same element: `code` on inline code,
   * and `region` on a block while it scrolls, which it takes away again once
   * the block fits. Two spreads writing one attribute leave whichever ran
   * last, and the one that takes its own away takes the caller's with it. So
   * the caller's is merged into the bag, where it stands in for the
   * primitive's: a block that scrolls is still a tab stop with a name, under
   * the role the caller chose. A block with a role of its own can carry a
   * name while it fits as well, so `label` is written then too.
   */
  @Prop() role = new Signal.State<string | undefined>(undefined);
  /**
   * Draw a button in the block's corner that puts the code on the clipboard,
   * says so through the page's live region, and shows that it did for two
   * seconds. A block only: a run of code in a sentence is copied with the
   * sentence.
   *
   * Not `copy`, which is the platform's clipboard event: bound on a tag,
   * `:copy` is a listener, and a component refuses one — so a prop of that
   * name could be written bare and never bound.
   */
  @Prop() copyable = new Signal.State(false);
  /**
   * Break long lines at the edge of the box rather than scroll to them. A
   * block only. A line that wraps is still one line, and is numbered once.
   */
  @Prop() wrap = new Signal.State(false);
  /**
   * Number the lines in a gutter. A block only. The numbers are list markers
   * counted by CSS, so nothing selects them and nothing copies them: the code
   * a reader copies is the code, without a column of digits down its side.
   */
  @Prop() lineNumbers = new Signal.State(false);
  /** The copy button's words, and what is said when it is pressed. */
  @Prop() labels = new Signal.State<CodeWording | undefined>(undefined);

  /** The `<pre>` of a block, which is what the primitive measures. */
  pre = new Signal.State<Element | null>(null);
  /** The `<code>` of a block, whose text is what is copied and numbered. */
  content = new Signal.State<Element | null>(null);

  /** `block`, read as the flag it is however the tag spelled it. */
  readonly isBlock = flag(this.block);

  /**
   * The primitive, built from the props above — which is why props have to be
   * there while a field initializes.
   */
  readonly code: Code = createCode({
    block: this.isBlock,
    pre: () => this.pre.get(),
    language: () => this.language.get(),
  });

  /**
   * What the copy button does, and the status it shows. Built for inline code
   * too, where nothing presses it, so that `:ref` finds the same fields on
   * every `<v-code>`.
   */
  readonly clipboard: Clipboard = createClipboard({
    // Read off the page at the moment of the copy rather than held, so the
    // text copied is the text on screen — after a highlighter rewrote it, or a
    // bound source changed under it.
    text: () => this.content.get()?.textContent ?? '',
    labels: this.spoken(),
  });

  /**
   * The provider's words for what the clipboard says, so that the button shows
   * the sentence that is announced. Only a provider is asked, as the clipboard
   * asks: neither word is a default the library ships.
   */
  private readonly locale: Locale | null = useProvidedLocale();

  /** The code's text, kept current for as long as its lines are numbered. */
  private readonly text = new Signal.State('');

  /**
   * Whether the block is taller than its box, and so scrolls down.
   *
   * The primitive measures across and nothing else, because a `<pre>` grows to
   * hold its lines — until a caller gives the tag a height, which is how a
   * long block is kept from running down the page. Then the block is a scroll
   * container like one that scrolls across, and one no keyboard can reach
   * holds lines a keyboard user cannot read. Measured here, the same way.
   */
  private readonly tall = new Signal.State(false);

  constructor() {
    if (__VOLT_DEV__ && !this.isBlock) {
      let reported = false;
      effect(() => {
        if (!reported) reported = this.reportBlockOnly();
      });
    }

    if (!this.isBlock) return;

    // Measured as the primitive measures across: the box for the height it
    // has, and the content for what has to fit in it, read once a frame
    // however many changes the frame brought. No observer is no layout — a
    // server, or a test document — and no tab stop, the conservative half of
    // the guess.
    measureEffect(() => {
      const pre = this.pre.get();
      const view = pre?.ownerDocument.defaultView;
      if (!pre || typeof view?.ResizeObserver !== 'function') return;

      const measure = (): void => this.tall.set(pre.scrollHeight > pre.clientHeight);
      measure();
      const resize = new view.ResizeObserver(measure);
      resize.observe(pre);
      let frame = 0;
      const content = new view.MutationObserver(() => {
        frame ||= view.requestAnimationFrame(() => {
          frame = 0;
          measure();
        });
      });
      content.observe(pre, { childList: true, characterData: true, subtree: true });
      onCleanup(() => {
        resize.disconnect();
        content.disconnect();
        view.cancelAnimationFrame(frame);
      });
    });

    // Watched rather than read once, because the content is the caller's: a
    // bound source that changes, or a highlighter that rewrites the spans
    // after mount, changes text nodes and nothing a signal could say — and a
    // gutter still counting the old lines numbers code that is not there. The
    // measure lane is where a read of the DOM belongs; a server has none, so
    // there the gutter is empty until the page attaches.
    let watching: Element | null = null;
    let observer: MutationObserver | null = null;
    onCleanup(() => observer?.disconnect());

    measureEffect(() => {
      const content = this.numbered() ? this.content.get() : null;
      if (content !== watching) {
        observer?.disconnect();
        observer = null;
        watching = content;
        const view = content?.ownerDocument.defaultView;
        if (content && view) {
          observer = new view.MutationObserver(() => this.read(content));
          observer.observe(content, { childList: true, characterData: true, subtree: true });
        }
      }
      if (content) this.read(content);
    });
  }

  /** Whether the block draws a copy button. */
  copies(): boolean {
    return this.isBlock && flag(this.copyable.get());
  }

  /** Whether the block's long lines wrap. */
  wraps(): boolean {
    return this.isBlock && flag(this.wrap.get());
  }

  /** Whether the block's lines are numbered. */
  numbered(): boolean {
    return this.isBlock && flag(this.lineNumbers.get());
  }

  /**
   * One entry per line drawn, for the gutter to put a number beside.
   *
   * Split where a `<pre>` breaks the line, which is at a newline and nowhere
   * else: CSS draws a carriage return as a space, so `\r\n` is one break and
   * a lone `\r` none. A newline at the very end ends the last line rather than
   * starting another, because a `<pre>` draws nothing after it — and code read
   * from a file almost always ends in one. No text is no lines rather than one
   * empty one, which is also what a server draws, where the text is not read
   * at all.
   */
  lines(): readonly string[] {
    const text = this.text.get();
    if (text === '') return [];
    const lines = text.split('\n');
    if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
    return lines;
  }

  /**
   * Whether the block is a region a keyboard can reach right now: wider than
   * its box, as the primitive measures, or taller than a height it was given.
   * `code.isScrollable()` is the first alone.
   */
  scrolls(): boolean {
    return this.code.isScrollable() || this.tall.get();
  }

  /**
   * What the `<pre>` carries: the primitive's bag, made a region while the
   * block scrolls either way, under the caller's name and role when there
   * are any.
   *
   * A name only while the element has a role to carry it — the region's, or
   * the caller's own: a `<pre>` that fits has none, and ARIA prohibits naming
   * an element that has none. An empty name is no name — and so is one of
   * blanks, which the accessible name computation trims to nothing anyway —
   * and the language's stands: a tab stop called nothing announces nothing
   * when it takes focus.
   */
  preProps(): CodeProps {
    const own = this.code.preProps();
    const role = this.role.get()?.trim();
    const region = this.scrolls();
    if (!region && !role) return own;

    const props: Record<string, string | boolean | undefined> = { ...own };
    const name = this.ariaLabel.get()?.trim() || this.label.get()?.trim();
    if (region) {
      props['tabindex'] = '0';
      props['role'] = 'region';
      props['aria-label'] = name || this.blockName(this.code.language());
    } else if (name) {
      props['aria-label'] = name;
    }
    if (role) props['role'] = role;
    return props;
  }

  /** What inline code's `<code>` carries: the primitive's bag, under the caller's role. */
  inlineProps(): CodeProps {
    const own = this.code.codeProps();
    const role = this.role.get()?.trim();
    return role ? { ...own, role } : own;
  }

  /**
   * What the copy button carries: the clipboard's bag, and a name that stays
   * put while the words on the button change.
   *
   * The clipboard announces the copy rather than relabelling the button,
   * because a name that changes under a screen reader's focus is read out
   * unreliably. So the words shown change and the name does not.
   */
  copyProps(): ClipboardProps & { readonly 'aria-label': string } {
    return { ...this.clipboard.triggerProps(), 'aria-label': this.copyName() };
  }

  /** The words on the copy button: what it does, or what it just did. */
  copyWords(): string {
    const status = this.clipboard.status();
    const words = this.spoken();
    if (status === 'copied') return this.said(words.copied, 'copied', 'Copied');
    if (status === 'failed') return this.said(words.failed, 'copyFailed', 'Could not copy');
    return this.copyName();
  }

  /** The copy button's name. An empty one is no name, and the default stands. */
  private copyName(): string {
    return this.labels.get()?.copy?.trim() || 'Copy code';
  }

  /**
   * What a block that scrolls down is called when the caller called it
   * nothing — the name the primitive gives one that scrolls across, which it
   * does not measure this one for: the locale's `codeBlockLanguage`, or
   * `Code, TypeScript`, and with no language its `codeBlock`, or `Code`. The
   * same words and keys, so one block is not called two things by which way
   * it scrolls, and the ones a chat names a code part by. Only a provider is
   * asked: neither key is a default the library ships, so the locale the
   * primitive would build without one answers with this English anyway.
   */
  private blockName(language: string): string {
    if (!language) return this.said(undefined, 'codeBlock', 'Code');
    return this.locale?.has('codeBlockLanguage')
      ? this.locale.t('codeBlockLanguage', { language })
      : `Code, ${language}`;
  }

  /**
   * A word the clipboard also says: the caller's, else the provider's, else
   * the English the clipboard falls back on — the same three, in the same
   * order, so what is shown is what is heard.
   */
  private said(given: string | undefined, key: string, fallback: string): string {
    if (given !== undefined) return given;
    return this.locale?.has(key) ? this.locale.t(key) : fallback;
  }

  /**
   * The clipboard's words, read through rather than handed over.
   *
   * The clipboard reads each one at the moment it speaks, so a getter is all it
   * takes for a signal to reach the announcement. Handing over the object
   * would freeze both at whatever they were when the block was built. A word
   * that is blank is no word, here as on the button: the clipboard would say
   * nothing, and the button would be an empty box.
   */
  private spoken(): ClipboardLabels {
    const labels = this.labels;
    return {
      get copied() {
        return labels.get()?.copied?.trim() || undefined;
      },
      get failed() {
        return labels.get()?.failed?.trim() || undefined;
      },
    };
  }

  private read(content: Element): void {
    this.text.set(content.textContent ?? '');
  }

  /**
   * A block's prop on inline code, said out loud.
   *
   * A copy button, wrapping and a gutter are all drawn inside a block's box,
   * and a run of code in a sentence has none; a name is a region's, and ARIA
   * prohibits naming `role="code"`. The prop is dropped, and without this
   * nothing anywhere says why. Said once, when it is first true.
   */
  private reportBlockOnly(): boolean {
    if (typeof console === 'undefined') return true;
    const asked = (
      [
        ['copyable', flag(this.copyable.get())],
        ['wrap', flag(this.wrap.get())],
        ['lineNumbers', flag(this.lineNumbers.get())],
        ['label', Boolean(this.label.get()?.trim())],
        ['aria-label', Boolean(this.ariaLabel.get()?.trim())],
      ] as const
    )
      .filter(([, on]) => on)
      .map(([name]) => `\`${name}\``);
    if (asked.length === 0) return false;
    console.warn(
      `[volt] ${asked.join(' and ')} on an inline <v-code> does nothing: a copy button, ` +
        'wrapping, line numbers and a name are all a block’s, and a run of code in a ' +
        'sentence is not one.\n' +
        '  Write `block` on the tag for code that stands on its own.',
    );
    return true;
  }
}
