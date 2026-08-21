/**
 * The `_rt` namespace a server build's templates are generated against, and
 * the writer they write into.
 *
 * A client build clones static markup and patches the clone; a server build
 * walks the same chunks and holes and writes bytes and values alternately —
 * see `markup.ts` in the compiler, which is where both come from. Nothing
 * here allocates a node, and nothing here mutates one: the cost of a render
 * is the bytes it produced plus whatever the values themselves cost to
 * serialize, which is why a ten-thousand-row page is a string builder's
 * problem rather than a tree's.
 *
 * What this stage deliberately has not got: hydration markers, ids, and a
 * state payload. Hydration's correctness is defined against the markup this
 * file produces, so it is written after this, not beside it.
 *
 * Reached from `renderToStaticMarkup` below, and from generated code — the
 * compiler defaults a server build's runtime module to `@voltdev/core/server`,
 * so a template compiled with `target: 'server'` imports exactly this.
 */

import {
  createRequestScope,
  createRoot,
  isSignal,
  runInRequest,
  settleRequest,
  type Dispose,
} from '@voltdev/reactivity';

import { renderComponent, requestStyles, type ComponentType } from './component.js';
import { normalizeClass, normalizeStyle, toDisplayString } from './dom.js';

// Everything generated code reaches that is not about writing bytes is the
// client's own helper, imported rather than reimplemented: a second spelling
// of `omit` is a second set of edge cases for one template to fall down
// between.
export { createComponent, slot } from './component.js';
export { omit, setRef, toDisplayString, withDefault, writeModel } from './dom.js';

// ---------------------------------------------------------------------------
// Escaping
// ---------------------------------------------------------------------------

/**
 * Escape a runtime value for text content.
 *
 * Deliberately **not** the compiler's `escapeHtmlText`, which leaves an
 * existing entity alone. That is right for authored template text, where
 * `&amp;` is how an author writes an ampersand, and wrong for a value, where
 * `Smith &amp; Co` is fifteen characters the page has to show — so it must be
 * written as `Smith &amp;amp; Co`. Anything else silently decodes one layer of
 * whatever the value carried, which is a value-injection bug for text that
 * arrived from a database.
 *
 * The scan exists so that a value with nothing to escape — the overwhelming
 * majority of them — is written through without allocating a copy of itself.
 */
function escapeText(value: string): string {
  let escaped = '';
  let last = 0;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    let entity: string;
    if (code === 38) entity = '&amp;';
    else if (code === 60) entity = '&lt;';
    else if (code === 62) entity = '&gt;';
    else continue;
    escaped += value.slice(last, i) + entity;
    last = i + 1;
  }
  return last === 0 ? value : escaped + value.slice(last);
}

/**
 * Escape a runtime value for a double-quoted attribute.
 *
 * The quote and the ampersand, matching the compiler's `escapeHtmlAttr` for
 * authored attributes — minus its entity exception, for the reason above. `<`
 * needs no escaping inside a quoted value and is left alone, so that one rule
 * covers the bytes whichever emitter wrote them.
 */
function escapeAttr(value: string): string {
  let escaped = '';
  let last = 0;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    let entity: string;
    if (code === 38) entity = '&amp;';
    else if (code === 34) entity = '&quot;';
    else continue;
    escaped += value.slice(last, i) + entity;
    last = i + 1;
  }
  return last === 0 ? value : escaped + value.slice(last);
}

// ---------------------------------------------------------------------------
// The writer
// ---------------------------------------------------------------------------

/** Content a portal wrote, and where it asked to be put. */
export interface PortalMarkup {
  /** The selector `:portal` named, or null for the document body. */
  target: string | null;
  html: string;
}

/**
 * Where a render's bytes go.
 *
 * One writer per render, holding one segment per place content lands: the
 * document the component was rendered into, plus one for each portal, in the
 * order they were declared. A portal is a segment rather than an escape hatch
 * because that is what it is on the client too — content declared here and
 * placed elsewhere — and because a document shell has to be able to put it
 * somewhere, which it cannot do if the bytes are already in the middle of the
 * page.
 *
 * Chunks rather than one accumulating string: a segment that can be handed out
 * a piece at a time is what streaming needs, and joining once at the end costs
 * a single flat allocation of the size of the answer.
 */
export class MarkupWriter {
  private readonly root: string[] = [];
  private readonly segments: { target: string | null; parts: string[] }[] = [];
  /** The segment being written; `portal` moves it and puts it back. */
  private parts: string[] = this.root;
  /**
   * Content held until the element's `>` has been written.
   *
   * Only `<textarea>` needs this, and it needs it because its value *is* its
   * content while `:model` is written where the attributes are. See `model`.
   */
  private pending: string | null = null;

  /** Static markup, exactly as the client's template string carries it. */
  raw(chunk: string): void {
    const held = this.pending;
    if (held !== null) {
      this.pending = null;
      // The chunk after an attribute hole opens with the `>` the compiler
      // pushed after it, so the content goes immediately behind that byte.
      const at = chunk.indexOf('>') + 1;
      this.parts.push(chunk.slice(0, at), held, chunk.slice(at));
      return;
    }
    this.parts.push(chunk);
  }

  /**
   * A dynamic child, where the client has a marker and `insert`.
   *
   * Mirrors `insertExpression`: only null and undefined write nothing, an
   * array writes its items in order, and everything else stringifies. It is
   * `String` rather than `toDisplayString` because that is what `insert` does
   * with an object, and the two sides must display the same thing.
   */
  child(value: unknown): void {
    let resolved = value;
    while (typeof resolved === 'function') resolved = (resolved as () => unknown)();
    if (resolved === null || resolved === undefined) return;
    if (Array.isArray(resolved)) {
      for (const item of resolved) this.child(item);
      return;
    }
    const text = escapeText(String(resolved));
    if (text) this.parts.push(text);
  }

  /** Everything between one element's tags, where the client has `bindText`. */
  text(value: unknown): void {
    const text = escapeText(toDisplayString(value));
    if (text) this.parts.push(text);
  }

  /**
   * The content of `<script>` or `<style>`, which is raw text.
   *
   * No escaping, because an entity inside raw text is not decoded — writing
   * `&amp;` there puts those five characters in the script. That leaves no way
   * to represent a closing tag, so a value carrying one is refused rather than
   * written: the alternative is markup that silently ends the element and
   * spills the rest of the value into the page as content.
   */
  rawText(tag: string, value: unknown): void {
    const text = toDisplayString(value);
    if (!text) return;
    if (text.toLowerCase().includes(`</${tag}`)) {
      throw new Error(
        `[volt] a value written into <${tag}> contains "</${tag}", which ends the element ` +
          'rather than appearing inside it. Raw text cannot be escaped — an entity there is ' +
          'not decoded — so the value has to be encoded by whatever produced it (for JSON, ' +
          'replacing "<" with "\\u003C").',
      );
    }
    this.parts.push(text);
  }

  /** `:html` — the value is markup, so it is written as it stands. */
  html(value: unknown): void {
    if (value === null || value === undefined) return;
    this.parts.push(String(value));
  }

  /**
   * One attribute, under the name it was authored with.
   *
   * Mirrors `setAttribute`: null, undefined and false remove an attribute on
   * the client, so here they write none; true writes the bare name, which is
   * how the compiler folds a static boolean attribute too.
   */
  attr(name: string, value: unknown): void {
    if (value === null || value === undefined || value === false) return;
    if (value === true) {
      this.parts.push(' ', name);
      return;
    }
    // Pushed in pieces rather than concatenated: the writer's currency is
    // chunks, and a joined string here would be an allocation per attribute
    // that the join at the end has to make again anyway.
    this.parts.push(' ', name, '="', escapeAttr(String(value)), '"');
  }

  /** A boolean attribute, which is present or absent and never valued. */
  boolAttr(name: string, value: unknown): void {
    if (value) this.parts.push(' ', name);
  }

  /** The one `class` an element can carry, folded and dynamic halves together. */
  classAttr(value: string): void {
    // Trimmed because the halves are composed with a separator each, so an
    // empty dynamic half leaves the separator behind.
    const text = value.trim();
    if (text) this.parts.push(' class="', escapeAttr(text), '"');
  }

  /** The one `style`, likewise. */
  styleAttr(value: string): void {
    if (value) this.parts.push(' style="', escapeAttr(value), '"');
  }

  /**
   * `:spread`, which can carry `class` and `style` as well as attributes, so
   * it is handed the two the directives already composed and writes all of it.
   *
   * A function value is skipped. On the client one is either a listener or a
   * callback prop; the client's own fallback writes the source text of a
   * function into an attribute, which is not markup anybody wants and is not
   * behaviour worth reproducing here.
   */
  spread(props: unknown, classValue: string, styleValue: string): void {
    let classes = classValue;
    let styles = styleValue;

    if (props && typeof props === 'object') {
      for (const [key, value] of Object.entries(props as Record<string, unknown>)) {
        if (typeof value === 'function') continue;
        if (key === 'class') {
          classes = `${classes} ${classText(value)}`;
          continue;
        }
        if (key === 'style') {
          styles = styleText(styles, value);
          continue;
        }
        this.attr(key, value);
      }
    }

    this.classAttr(classes);
    this.styleAttr(styles);
  }

  /**
   * `:model`, which on the client sets an IDL property and here has to write
   * whatever markup that property is restored from.
   *
   * Each control keeps its value somewhere else: an `<input>` in `value`, a
   * checkbox and a radio in `checked`, and a `<textarea>` in its content —
   * which is why the value is held rather than written, since `:model` is
   * written where the attributes are and the content comes after the `>`.
   *
   * A `<select>` is the exception, and it is a real gap rather than a
   * decision: its selection lives on the `<option>`, and by the time the value
   * is known the writer has already passed the place the options will be
   * written. Marking it needs a hole to come back to, which is what the
   * segment tree grows when hydration and streaming need one — see
   * `docs/reference/server.md`.
   */
  model(kind: string, tag: string, value: unknown, staticValue: string | null): void {
    const resolved = isSignal(value) ? value.get() : value;

    if (kind === 'checkbox') {
      this.boolAttr('checked', resolved);
      return;
    }
    if (kind === 'radio') {
      this.boolAttr('checked', toDisplayString(resolved) === staticValue);
      return;
    }
    if (kind === 'select') return;
    if (tag === 'textarea') {
      this.pending = escapeText(toDisplayString(resolved));
      return;
    }
    // A `value` written in the template is already in the static bytes, and a
    // tag carries one `value`: a second is discarded by every parser, so the
    // authored one stands.
    if (staticValue === null) this.attr('value', toDisplayString(resolved));
  }

  /**
   * `:portal` — content declared here and written somewhere else.
   *
   * The body of the portal writes through this same writer, because the slots
   * and components inside it closed over it; what changes for the length of
   * the call is which segment that writer is pointing at.
   */
  portal(target: unknown, build: () => void): void {
    let resolved = target;
    while (typeof resolved === 'function') resolved = (resolved as () => unknown)();

    if (resolved !== null && resolved !== undefined && typeof resolved !== 'string') {
      throw new Error(
        '[volt] a server render has no elements, so `:portal` needs a selector string or ' +
          'nothing at all — an element target can only be resolved in a browser.',
      );
    }

    const parts: string[] = [];
    // Recorded on the way in, so two portals into one container come out in
    // the order they were declared rather than the order they finished.
    this.segments.push({ target: resolved ?? null, parts });

    const previous = this.parts;
    this.parts = parts;
    try {
      build();
    } finally {
      this.parts = previous;
    }
  }

  /** The document's own markup. */
  toString(): string {
    return this.root.join('');
  }

  /** What the portals wrote, in the order they were declared. */
  portals(): PortalMarkup[] {
    return this.segments.map((segment) => ({
      target: segment.target,
      html: segment.parts.join(''),
    }));
  }
}

// ---------------------------------------------------------------------------
// Helpers generated code calls
// ---------------------------------------------------------------------------

/** `:portal`; see `MarkupWriter.portal`. */
export function portal(out: MarkupWriter, target: unknown, build: () => void): void {
  out.portal(target, build);
}

/**
 * The rows of a `:for`, normalised exactly as `each` normalises them.
 *
 * A server loop is a loop: rows are written once, so there is no key to
 * compute, no row to keep and no signal to update. What has to agree with the
 * client is only which items there are.
 */
export function items(list: unknown): unknown[] {
  if (Array.isArray(list)) return list;
  if (list === null || list === undefined) return [];
  return Array.from(list as Iterable<unknown>);
}

/** The class string the client's `classList` would end up holding. */
export function classText(value: unknown): string {
  return normalizeClass(value).join(' ');
}

/** The style attribute the client's `el.style` would end up holding. */
export function styleText(base: string, value: unknown): string {
  const merged = normalizeStyle(base);
  // Assigned over the base, because that is the order the client applies them
  // in: the template's own `style` is on the clone before the binding runs.
  Object.assign(merged, normalizeStyle(value));

  let out = '';
  for (const key of Object.keys(merged)) {
    out += `${out ? ';' : ''}${key}:${merged[key]}`;
  }
  return out;
}

// ---------------------------------------------------------------------------
// The consumer
// ---------------------------------------------------------------------------

/** Everything one render produced. */
export interface StaticMarkup {
  /** The component's own markup. */
  html: string;
  /**
   * What `:portal` wrote, which belongs somewhere this render does not reach.
   *
   * Handed back rather than inlined because inlining it would put content in
   * the middle of the page that the client appends to the body — and the two
   * trees have to agree.
   */
  portals: readonly PortalMarkup[];
  /**
   * The styles this request's components declared, by selector.
   *
   * Collected rather than injected: a server has no `document` to append a
   * `<style>` to, and the process-global "already injected" mark would give
   * the second request a page with none.
   */
  styles: ReadonlyMap<string, string>;
}

export interface RenderOptions {
  /** Props for the root component, as a parent would pass them. */
  props?: Record<string, unknown> | null;
}

/**
 * Render a component to markup, with no hydration of any kind.
 *
 * The first consumer of the writer above, and for now the only one: an email,
 * a feed, a PDF source — output nothing is going to attach to. `renderToString`
 * and streaming are a walk over the same segments and come after hydration,
 * because what they add is identity and ordering, both of which are defined
 * against these bytes.
 *
 * The render is one synchronous walk inside a request scope, and the request
 * is settled before this returns, so a resource that fetched still gets waited
 * for. What it does **not** do is put late data into bytes that are already
 * written: a value is serialized once, where it stood when the walk passed it.
 * Rendering data that arrives after the walk is what async boundaries are for,
 * and they arrive with streaming.
 */
export async function renderToStaticMarkup(
  component: ComponentType<unknown>,
  options: RenderOptions = {},
): Promise<StaticMarkup> {
  if (!__VOLT_SERVER__) {
    throw new Error(
      '[volt] renderToStaticMarkup needs a server build. Templates are compiled for one side ' +
        'or the other, and a client build emits render functions that clone markup rather ' +
        'than write it — @voltdev/vite-plugin decides this per environment.',
    );
  }

  const writer = new MarkupWriter();
  const scope = createRequestScope();
  let dispose: Dispose = () => {};

  await settleRequest(scope, () => {
    // A root of its own, so every effect the walk created — a dynamic prop is
    // a render effect even here — is owned by this request and disposed with
    // it, rather than left observing a tree nobody will look at again.
    createRoot((disposeRoot) => {
      dispose = disposeRoot;
      renderComponent(component, writer, options.props ?? null);
    });
  });

  const styles = runInRequest(scope, () => new Map(requestStyles()));
  runInRequest(scope, dispose);

  return { html: writer.toString(), portals: writer.portals(), styles };
}
