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
 * The markers are the writer's: `openHole`/`closeHole` delimit every dynamic
 * child, so a hydration walk can step over a hole whose width only this side
 * knows. Both consumers therefore write the same bytes, which is what §3.5 of
 * `docs/design/ssr.md` means by the segment tree being the primitive —
 * `renderToStaticMarkup` is the walk with nothing attached to it,
 * `renderToString` the same walk with the state payload the client adopts, and
 * `renderToStream` in `stream.ts` the same walk again with the shell handed
 * over the moment it is written instead of when the slowest query answers.
 *
 * Reached from `renderToStaticMarkup` below, and from generated code — the
 * compiler defaults a server build's runtime module to `@voltdev/core/server`,
 * so a template compiled with `target: 'server'` imports exactly this.
 */

import {
  createRequestScope,
  createRoot,
  isSignal,
  onError,
  runInRequest,
  settleRequest,
  type Dispose,
} from '@voltdev/reactivity';

import { renderComponent, requestStyles, type ComponentType } from './component.js';
import { endsItsElement, needsServerBuild, voltError } from './diagnostics.js';
import { normalizeClass, normalizeStyle, toDisplayString } from './dom.js';
import { registeredState, STATE_ATTRIBUTE } from './state.js';

// Everything generated code reaches that is not about writing bytes is the
// client's own helper, imported rather than reimplemented: a second spelling
// of `omit` is a second set of edge cases for one template to fall down
// between. `defineComponent` is what the plugin lowers every `@Component` to,
// and in a server build it imports it from here — without it, no decorated
// component could be built for the server at all.
export { outlet } from './outlet.js';
export { renderComponent } from './component.js';
export {
  createComponent,
  slot,
  defineComponent,
  initProp,
  hostAttrsOf,
  withSpread,
} from './component.js';
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
export function escapeAttr(value: string): string {
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

/**
 * The brand an async boundary carries, and the only thing this module knows
 * about one.
 *
 * A boundary is a value in a dynamic-child position — `{ this.body }` — so the
 * writer is where it is met, and the writer is on the wrong side of the
 * dependency to own it: everything about waiting, ordering and out-of-order
 * flush lives in `stream.ts`, which imports this. What is left here is a brand
 * whose value is the function that writes the placeholder, so `child` can hand
 * itself over and be done. A render with no stream ever installed still meets
 * boundaries — `renderToString` does — and that function is what decides a
 * fallback is all such a render can show.
 */
export const BOUNDARY = Symbol('volt.boundary');

/** What a boundary's brand holds; see `boundary` in `stream.ts`. */
export type BoundaryClaim = (out: MarkupWriter) => void;

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
  private readonly root: Part[] = [];
  private readonly segments: { target: string | null; parts: Part[] }[] = [];
  /** The segment being written; `portal` moves it and puts it back. */
  private parts: Part[] = this.root;
  /**
   * Whether any region has been opened, which is the only thing that can put
   * an array inside the chunk list.
   *
   * Kept so the common page pays nothing for a facility it never used: with no
   * region open the chunks are flat and `join` is the same single allocation
   * it always was, and the recursive walk below is only reached by a page that
   * actually declared somewhere replaceable.
   */
  private nested = false;
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
   * The two comments delimiting a dynamic child, where the client has `<!>`.
   *
   * The marker the client clones is one node; what is written here is however
   * many nodes the value came to. Hydration walks the tree by counting
   * siblings, so it needs somewhere to step *to* — and it needs to know which
   * of the nodes it is standing among belong to the hole, since those are the
   * ones a later update replaces and the ones the block filling the hole
   * claims for itself.
   *
   * Pushed straight rather than through `raw`, because these are the writer's
   * own bytes rather than the compiler's chunk, and because the held content
   * `raw` exists to place belongs behind an element's `>` rather than behind
   * a delimiter.
   */
  openHole(): void {
    this.parts.push('<!--[-->');
  }

  closeHole(): void {
    this.parts.push('<!--]-->');
  }

  /**
   * A comment the stream's own machinery reads, rather than the compiler's.
   *
   * Straight onto the segment for the reason the delimiters are: these are the
   * writer's bytes, and the content `raw` holds back belongs behind an
   * element's `>` rather than behind a marker. `text` is never a runtime
   * value — the only caller is `stream.ts`, writing a boundary id it minted
   * itself — so there is nothing here for a `-->` to escape from.
   */
  comment(text: string): void {
    this.parts.push('<!--', text, '-->');
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
    // Before `String`, because a boundary stringifies to nothing anybody wants
    // and because this is the position it is declared in: a hole is what it
    // fills, whether with a fallback now or with an answer later.
    //
    // Read rather than tested with `in`. A value reaching a hole is whatever
    // the application put there, including a proxy whose `has` trap answers
    // every question `true` — so the question asked is the one with an answer
    // that cannot be faked into a crash: is there a function here to call.
    const claim = (resolved as { [BOUNDARY]?: BoundaryClaim })[BOUNDARY];
    if (typeof claim === 'function') {
      claim(this);
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
      throw endsItsElement(
        tag,
        `a value written into <${tag}>`,
        'the value has to be encoded by whatever produced it (for JSON, replacing "<" with ' +
          '"\\u003C")',
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

    // One object, or several to apply in order: an element can carry both its
    // own `:spread` and the `:host` attributes its caller wrote, and a class
    // in either has to reach the one attribute composed here.
    for (const one of Array.isArray(props) ? (props as unknown[]) : [props]) {
      if (!one || typeof one !== 'object') continue;
      for (const [key, value] of Object.entries(one as Record<string, unknown>)) {
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
      throw voltError(
        'V0302',
        { target: typeof resolved },
        __VOLT_DEV__ &&
          'a server render has no elements, so `:portal` needs a selector string or ' +
            'nothing at all — an element target can only be resolved in a browser.',
      );
    }

    const parts: Part[] = [];
    // Recorded on the way in, so two portals into one container come out in
    // the order they were declared rather than the order they finished.
    this.segments.push({ target: resolved ?? null, parts });
    this.write(parts, build);
  }

  /**
   * A stretch of markup that can still be rewritten after it was written.
   *
   * The chunks a region writes go into a list of their own, spliced into the
   * segment at the position the region was declared, so replacing it is
   * emptying that list rather than finding and cutting out a range of the
   * enclosing one. That distinction is the whole reason this exists: an error
   * raised by an effect three flushes later arrives when the bytes after the
   * region have long since been written, and a region that were merely a
   * remembered index could only ever be truncated back to while it was still
   * the tail.
   */
  region(): Part[] {
    const parts: Part[] = [];
    this.nested = true;
    this.parts.push(parts);
    return parts;
  }

  /** Write into a region: on the way in, and again to replace what it holds. */
  write(region: Part[], build: () => void): void {
    const previous = this.parts;
    this.parts = region;
    try {
      build();
    } finally {
      this.parts = previous;
    }
  }

  /**
   * Discard what a region wrote and put something else in its place.
   *
   * Discarding is unconditional, and it matters most when there is nothing to
   * put back: a walk that threw halfway through a region may have left an
   * element open, and half a region is not markup a browser can be handed.
   */
  rewrite(region: Part[], build: () => void): void {
    region.length = 0;
    this.write(region, build);
  }

  private join(parts: Part[]): string {
    if (!this.nested) return (parts as string[]).join('');
    const flat: string[] = [];
    collect(parts, flat);
    return flat.join('');
  }

  /** The document's own markup. */
  toString(): string {
    return this.join(this.root);
  }

  /** What the portals wrote, in the order they were declared. */
  portals(): PortalMarkup[] {
    return this.segments.map((segment) => ({
      target: segment.target,
      html: this.join(segment.parts),
    }));
  }
}

/** One chunk of a segment: bytes, or a region holding chunks of its own. */
export type Part = string | Part[];

function collect(parts: Part[], out: string[]): void {
  for (const part of parts) {
    if (typeof part === 'string') out.push(part);
    else collect(part, out);
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
  /**
   * What to do inside this render's own scope, before the component is built.
   *
   * The only place a per-request provider can be installed: the scope a render
   * runs in is created in here, so anything provided outside it is provided to
   * nothing — and on a server "outside it" is shared by every request in
   * flight, which is the other half of why this exists.
   */
  setup?: () => void;
  /**
   * Wraps every synchronous span of the render: the build, and each flush.
   *
   * For an ambient that must not outlive a span — the request a server
   * function's `guard` reads, which a server passes as
   * `around: (run) => withRequest(request, run)`. A span is where the tree
   * starts its work: a constructor, a data effect in any round, a late chunk
   * being written. The continuation of a promise the render is waiting on runs
   * between spans, interleaved with other requests', and is not covered.
   */
  around?: <T>(run: () => T) => T;
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
    throw needsServerBuild('renderToStaticMarkup');
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
      options.setup?.();
      renderComponent(component, writer, options.props ?? null);
    });
  }, options.around);

  const styles = runInRequest(scope, () => new Map(requestStyles()));
  runInRequest(scope, dispose);

  return { html: writer.toString(), portals: writer.portals(), styles };
}

// ---------------------------------------------------------------------------
// The state payload
// ---------------------------------------------------------------------------

/**
 * Escape a JSON document so that it is inert inside a `<script>` element.
 *
 * A serializer that writes into a page is a security boundary, and this is the
 * boundary. Script content is *raw text*: the parser decodes no entities in
 * it, so there is nothing to escape with — the only lever is that JSON's own
 * `\uXXXX` escape means the same character to `JSON.parse` and a different
 * byte to the HTML tokenizer.
 *
 * `<` is the whole attack surface and so it is the whole rule. It is what
 * starts `</script>`, which ends the element and spills the rest of the value
 * into the page as markup; it is what starts `<!--`, which puts the tokenizer
 * into script-data-escaped state, where a later `</script>` no longer closes
 * anything and the rest of the document is swallowed; and it is what starts a
 * nested `<script`, which is the other half of that same trap. Escaping the
 * character all three begin with closes all three, and needs no case folding
 * or lookahead to be sure it did.
 *
 * U+2028 and U+2029 are escaped because they are line terminators to a
 * JavaScript parser and ordinary characters to a JSON one. They are harmless
 * where this payload stands today, and stop being harmless the moment anything
 * copies the document into a JS literal — a bundler inlining it, an inline
 * boot record, streaming's own `__VOLT__.push`. Paying for them here is two
 * scans; discovering it later is a syntax error in production.
 *
 * A lone surrogate needs no rule of its own: `JSON.stringify` is well-formed
 * and writes one as `\udXXX`, so what reaches the page is always encodable.
 */
export function escapeJsonForScript(json: string): string {
  return json
    .replaceAll('<', '\\u003C')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
}

/**
 * Refuse the values `JSON.stringify` would carry wrongly rather than not at all.
 *
 * Silence is the failure mode worth spending code on. `NaN` becomes `null`, a
 * `bigint` throws a message naming nothing, and a hole in an array becomes a
 * `null` the client then indexes into — each of which reaches the browser as
 * data that is merely *different* from what the server rendered, which is the
 * one class of hydration bug nothing downstream can detect.
 *
 * `undefined` as an object property is the exception, and it is not laxity:
 * JSON drops the key, and reading a missing property gives `undefined` on the
 * client exactly as it did on the server. The same value inside an array is
 * refused, because there the drop is a `null` in a position that had a hole.
 *
 * Written as a `function` rather than an arrow so that `this` is the object or
 * array holding the value, which is the only way to tell those two apart.
 */
function refuseWhatJsonWouldCorrupt(this: unknown, key: string, value: unknown): unknown {
  const inArray = Array.isArray(this);
  const kind = typeof value;

  if (value === undefined || kind === 'function' || kind === 'symbol') {
    if (value === undefined && !inArray) return value;
    throw voltError(
      'V0402',
      { key, kind: value === undefined ? 'undefined' : kind },
      __VOLT_DEV__ &&
        `hydration state cannot carry ${value === undefined ? 'undefined' : `a ${kind}`}` +
          `${key === '' ? '' : ` at "${key}"`}. JSON ${inArray ? 'writes it as null' : 'drops it'}, ` +
          'so the client would start from a value the server never rendered.',
    );
  }
  if (kind === 'number' && !Number.isFinite(value)) {
    throw voltError(
      'V0402',
      { key, kind: String(value) },
      __VOLT_DEV__ &&
        `hydration state cannot carry ${String(value)}${key === '' ? '' : ` at "${key}"`}: ` +
          'JSON writes it as null, and null is a value the client would read as real.',
    );
  }
  if (kind === 'bigint') {
    throw voltError(
      'V0402',
      { key, kind },
      __VOLT_DEV__ &&
        `hydration state cannot carry a bigint${key === '' ? '' : ` at "${key}"`}. ` +
          'Send it as a string and parse it back, until the wire format that carries one lands.',
    );
  }
  return value;
}

/** Options every emitter of the payload takes, because a page under CSP needs them. */
export interface StateScriptOptions {
  /**
   * The `nonce` of the page's `script-src` policy.
   *
   * First-class rather than something a caller splices in afterwards, because
   * the failure without it is silent: the element is dropped by the browser,
   * every signal starts at its default, and the page still renders — so what a
   * missing nonce looks like is server rendering having quietly stopped
   * paying for itself, on the production deployment that has a CSP and not on
   * the development one that does not.
   */
  nonce?: string;
}

/**
 * The one `<script>` a shell carries its state in.
 *
 * `type="application/json"` rather than a script that assigns an object
 * literal, for two reasons that both get better as a page gets bigger:
 * `JSON.parse` is markedly faster than a parse-as-program of the same bytes,
 * and this element is data — nothing in it can execute however it was built,
 * so a value that reached the page from a database cannot become a program.
 * The escaping above is what keeps it *inside* the element; the type is what
 * makes escaping the only thing that has to hold.
 *
 * Empty when there is nothing to carry, so a page with no hydratable state
 * ships no element rather than an empty one.
 */
export function stateScript(
  values: Record<string, unknown>,
  options: StateScriptOptions = {},
): string {
  const json = stateJson(values);
  if (json === '') return '';
  const nonce = options.nonce === undefined ? '' : ` nonce="${escapeAttr(options.nonce)}"`;
  return `<script type="application/json" ${STATE_ATTRIBUTE}${nonce}>${json}</script>`;
}

/**
 * The state object, serialized and made inert, or the empty string for nothing.
 *
 * Split out from `stateScript` because streaming needs the same bytes in a
 * different element: the shell carries its state as data in a
 * `type="application/json"` script, and everything that arrives after the shell
 * has to be pushed into a queue instead, since the element the shell wrote has
 * long since been parsed. Two escapings for one payload would be two things to
 * keep right, and the second one is always the one that rots.
 */
export function stateJson(values: Record<string, unknown>): string {
  // Assembled per key rather than in one `JSON.stringify`, so a refusal can
  // name the value it came from. A replacer only ever sees a property name,
  // and "cannot carry undefined at items[2]" without saying which piece of
  // state owns `items` is a message you bisect a page to act on.
  let body = '';
  for (const key of Object.keys(values)) {
    const value = values[key];
    // A key still holding `undefined` is left out entirely rather than written
    // as null. That is the honest encoding of "the server has nothing for
    // this": it costs no bytes, `wasHydrated` comes back false on the client,
    // and whatever would have fetched still does.
    if (value === undefined) continue;
    let json: string;
    try {
      json = JSON.stringify(value, refuseWhatJsonWouldCorrupt);
    } catch (cause) {
      throw Object.assign(
        voltError(
          'V0401',
          { key },
          __VOLT_DEV__ &&
            `the hydration state for ${JSON.stringify(key)} could not be serialized: ` +
              `${cause instanceof Error ? cause.message : String(cause)}`,
        ),
        { cause },
      );
    }
    body += `${body === '' ? '' : ','}${JSON.stringify(key)}:${json}`;
  }

  return body === '' ? '' : escapeJsonForScript(`{${body}}`);
}

// ---------------------------------------------------------------------------
// renderToString
// ---------------------------------------------------------------------------

/** A render that finished, and everything the caller needs to answer with it. */
export interface RenderedPage extends StaticMarkup {
  status: 200;
  error: null;
  /**
   * The `<script type="application/json">` carrying initial signal state, or
   * the empty string when this page has none.
   *
   * Handed over as an element rather than as an object for the same reason
   * `portals` is handed over separately: only the caller knows where the end
   * of its body is, and the payload has to be parsed after the markup it
   * belongs to has been.
   */
  state: string;
}

/** A render that threw, with nothing of it written out. */
export interface FailedPage {
  status: 500;
  error: unknown;
  /**
   * Always null, and typed that way so the compiler makes the caller look.
   *
   * There is no partial page here on purpose. The walk buffered its bytes, so
   * a throw halfway through it discards them and the status line has not been
   * sent — which is the whole reason this ships before streaming, where the
   * same throw arrives after the headers and there is nothing left to say.
   */
  html: null;
}

export type PageRender = RenderedPage | FailedPage;

// The third consumer of the writer, re-exported from here because this is the
// module a server build already resolves: `@voltdev/core/server` is where the
// generated templates, the two buffered renders and the streaming one all
// live, and splitting the streaming entry point off would mean a caller had to
// know which of two modules a boundary belongs to.
export { boundary, errorBoundary, renderToStream } from './stream.js';
export type {
  Boundary,
  BoundaryOptions,
  ErrorBoundaryOptions,
  StreamOptions,
} from './stream.js';

export interface StringRenderOptions extends RenderOptions, StateScriptOptions {}

/**
 * Render a page that is going to hydrate.
 *
 * The same walk `renderToStaticMarkup` makes, over the same segments — §3.5 of
 * the design record puts it that way deliberately: the segment tree is the
 * primitive and this is a second consumer of the finished one, not a second
 * emitter. What it adds is the two things a page needs in order to be taken
 * over rather than merely looked at. The markup carries the hole delimiters
 * the hydrate emit steps by, which is the writer's doing and is why the bytes
 * are the same bytes. And the state every hydratable signal came to hold is
 * collected after the request settled and written as one script element, so
 * the client starts from the values the markup was rendered from instead of
 * from defaults it has already painted over.
 *
 * A failure is returned rather than thrown. Not for the sake of a nicer API:
 * it is the one capability this has and streaming does not, and it disappears
 * the moment the first byte is flushed. Everything the walk wrote before the
 * throw is discarded with the writer, so there is no half-written page to send
 * by accident, and `status` is the answer — 200 or 500 — rather than something
 * the caller has to infer from an exception it might not have caught.
 *
 * A build that is not a server build still throws, because that is not a
 * request failing. It is the wrong bundle, it will fail identically for every
 * request, and answering 500 to each of them would hide it.
 */
export async function renderToString(
  component: ComponentType<unknown>,
  options: StringRenderOptions = {},
): Promise<PageRender> {
  if (!__VOLT_SERVER__) {
    throw needsServerBuild('renderToString');
  }

  const writer = new MarkupWriter();
  const scope = createRequestScope();
  let dispose: Dispose = () => {};
  /**
   * The first error nothing below took responsibility for.
   *
   * Not every failure reaches the `catch`. An effect that throws is caught by
   * the scheduler and put into the error channel instead, which on a server
   * means `console.error` and a page that is missing whatever that binding was
   * going to write — a 200 with a hole in it, which is the one answer worse
   * than a 500. A boundary on the render's own root is where that error
   * surfaces: it is per-render, so two requests cannot see each other's, and
   * it sits above every boundary the page declares, so anything an application
   * chose to recover from never arrives here at all.
   */
  const failure: { error: unknown; failed: boolean } = { error: null, failed: false };

  try {
    await settleRequest(scope, () => {
      createRoot((disposeRoot) => {
        dispose = disposeRoot;
        onError((error) => {
          if (!failure.failed) {
            failure.failed = true;
            failure.error = error;
          }
        });
        options.setup?.();
        renderComponent(component, writer, options.props ?? null);
      });
    }, options.around);

    // Thrown rather than returned from here, so that the one `catch` below is
    // the only place a failed render is turned into an answer.
    if (failure.failed) throw failure.error;

    // Both read inside the request, because both live in it: the styles this
    // request's components asked for, and the slots its signals registered.
    // Serializing is inside the `try` as well — a value JSON would corrupt is
    // a page that cannot be sent, and it is the caller's 500 like any other.
    const state = runInRequest(scope, () =>
      stateScript(Object.fromEntries([...registeredState()].map(([k, v]) => [k, v.get()])), options),
    );
    const styles = runInRequest(scope, () => new Map(requestStyles()));

    return {
      status: 200,
      error: null,
      html: writer.toString(),
      portals: writer.portals(),
      styles,
      state,
    };
  } catch (error) {
    return { status: 500, error, html: null };
  } finally {
    // In the `finally` because a request that threw still owns effects, and a
    // failed render that leaves them observing is a leak per failed request —
    // which is the shape of leak that only appears once something is going
    // wrong in production.
    runInRequest(scope, dispose);
  }
}
