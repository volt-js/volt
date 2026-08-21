/**
 * What the template alone proves about the accessibility of the DOM it builds.
 *
 * The primitives are held to the WAI-ARIA Authoring Practices; nothing holds
 * the `<div :click="select()">` an application author writes to anything. The
 * compiler already rejects a misspelled directive and a `:for` without
 * `:key` — this is that mechanism pointed at a class of bug that stays
 * invisible until somebody tries to use the page with a keyboard.
 *
 * Every rule here decides from markup and nothing else. Two whole categories
 * are therefore absent: anything that needs to know what a bound value is at
 * runtime, and anything about colour. A rule that fires on correct code is
 * worse than no rule, because the first thing it teaches is how to switch the
 * rules off — so wherever the template stops being able to tell (a `:spread`,
 * a component's root element, an id the template computes), the check goes
 * quiet rather than guessing.
 *
 * Severity follows the rest of the compiler: certainly wrong throws, the way
 * markup a parser would rebuild throws, and usually wrong is collected as a
 * warning. Both name what to write instead. And a caller can disagree: a rule
 * with no way out is one a project escapes by forking the compiler, so
 * `a11y: 'warn'` keeps the build moving while still reporting everything, and
 * `a11y: 'off'` skips the pass.
 */

import type {
  AttributeNode,
  ElementNode,
  RootNode,
  TemplateChildNode,
} from './ast.js';
import {
  ARIA_ATTRIBUTES,
  ARIA_ROLES,
  isOneEditFrom,
  type AriaAttribute,
} from './dom-info.js';
import { CompilerError } from './parser.js';

export interface Diagnostic {
  /** What is wrong, and what to write instead. */
  message: string;
  loc: { line: number; column: number };
  filename?: string;
}

/** The line an error prints, so a warning reads like one. */
export function formatDiagnostic(d: Diagnostic): string {
  const where = d.filename
    ? `${d.filename}:${d.loc.line}:${d.loc.column}`
    : `${d.loc.line}:${d.loc.column}`;
  return `[volt:compiler] ${d.message} (${where})`;
}

/**
 * What a rule that would refuse a template is allowed to do.
 *
 * `error` is the default and the one that means anything. `warn` is for the
 * case no rule survives without — a finding that is wrong about this template,
 * on a deadline — and downgrades every refusal rather than making a project
 * choose between editing correct markup and losing the other seven rules.
 */
export type A11ySeverity = 'error' | 'warn' | 'off';

export interface A11yOptions {
  filename?: string;
  a11y?: A11ySeverity;
}

/**
 * Events whose whole purpose is to operate the element.
 *
 * Pointer and drag events are deliberately out: a splitter listening on
 * `:pointerdown` is a gesture surface rather than a control, and reporting it
 * would be the false positive that gets the rules turned off.
 */
const ACTIVATION_EVENTS = new Set(['click', 'dblclick', 'keydown', 'keyup', 'keypress']);

/** Roles whose contents the accessibility tree flattens into the name. */
const FLATTENS_CONTENT = new Set([
  'button', 'checkbox', 'img', 'menuitemcheckbox', 'menuitemradio', 'meter', 'option',
  'progressbar', 'radio', 'scrollbar', 'slider', 'switch', 'tab',
]);

/** Roles that make an element a control in its own right. */
const CONTROL_ROLES = new Set([
  'button', 'checkbox', 'combobox', 'gridcell', 'link', 'menuitem', 'menuitemcheckbox',
  'menuitemradio', 'option', 'radio', 'scrollbar', 'searchbox', 'slider', 'spinbutton',
  'switch', 'tab', 'textbox', 'treeitem',
]);

/**
 * Roles an element carries without anyone writing one.
 *
 * Only the tags whose implicit role decides something here: one that flattens
 * what is inside it, or a heading. `<select>`, `<textarea>` and `<input>` are
 * absent because anything focusable is reached by `isFocusable` before its
 * role is asked for, and `<img>` because a void element has no contents to
 * flatten.
 */
const IMPLICIT_ROLES: Record<string, string> = {
  button: 'button',
  h1: 'heading', h2: 'heading', h3: 'heading', h4: 'heading', h5: 'heading', h6: 'heading',
  meter: 'meter',
  option: 'option',
  progress: 'progressbar',
};

/**
 * Elements whose own role is worth more than one written over it, with the
 * roles that leave that worth intact.
 *
 * An allow-list rather than a deny-list, because the question is not whether a
 * role is unusual but whether the element still does something the new role
 * denies. `role="menuitem"` on `<a href>` is the Authoring Practices' own menu
 * pattern and keeps the link; `role="button"` on the same element leaves a
 * thing that navigates, opens in a new tab, and announces that it does
 * neither.
 */
interface Override {
  tags: string[];
  needsHref?: boolean;
  keeps: string[];
  lost: string;
  why: string;
  remedy: string;
}

const OVERRIDES: Override[] = [
  {
    tags: ['a', 'area'],
    needsHref: true,
    keeps: ['link', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'tab', 'treeitem', 'option'],
    lost: 'the link',
    why:
      'The element still navigates, and still offers "open in new tab" from the\n' +
      '  context menu, while announcing itself as something that does neither.',
    remedy:
      'Use `<button>` if it acts on this page, and leave it a link if it goes\n' +
      '  somewhere.',
  },
  {
    tags: ['button'],
    keeps: [
      'button', 'checkbox', 'combobox', 'gridcell', 'menuitem', 'menuitemcheckbox',
      'menuitemradio', 'option', 'radio', 'switch', 'tab', 'treeitem',
    ],
    lost: 'the button',
    why:
      'The element navigates nowhere, so anyone who follows what the role says and\n' +
      '  expects a new page gets none.',
    remedy: 'Use `<a href>` if it navigates, and leave it a button if it acts.',
  },
  {
    tags: ['main'],
    keeps: ['main'],
    lost: 'the one `main` landmark a page gets',
    why:
      'Skip-to-content and landmark navigation both look for it by role, and now\n' +
      '  find nothing.',
    remedy: 'Put the role on an element inside `<main>` and leave the landmark alone.',
  },
  {
    tags: ['nav'],
    keeps: ['navigation'],
    lost: 'the navigation landmark',
    why: 'Landmark navigation lists this region by role, and now skips it.',
    remedy: 'Put the role on an element inside `<nav>` and leave the landmark alone.',
  },
  {
    tags: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
    keeps: ['heading', 'presentation', 'none', 'tab', 'treeitem', 'menuitem'],
    lost: 'the heading',
    why:
      'The document outline loses this entry, so navigating by heading goes\n' +
      '  straight past the section it opens.',
    remedy: 'Put the role on an element inside the heading.',
  },
];

interface Context {
  warnings: Diagnostic[];
  severity: A11ySeverity;
  /** Every id the template writes out literally. */
  ids: Set<string>;
  /**
   * The template computes an id somewhere, so an element carries one this file
   * never writes — which id it lands on is a runtime fact. What survives that
   * is in `missingId`.
   */
  idsUnknowable: boolean;
  /** Every id a `<label for>` in this template claims. */
  labelTargets: Set<string>;
  /**
   * A `<label>` here carries a `for` this file never writes, so the control it
   * names is a runtime fact and no control carrying an id can be called
   * unnamed.
   */
  labelTargetsUnknowable: boolean;
  filename: string | undefined;
}

/** What an element is nested inside that flattens it away, if anything. */
interface Flattened {
  role: string;
  /** How to name the ancestor: its role if written, otherwise its tag. */
  holder: string;
}

/** What encloses an element, where being enclosed changes what it proves. */
interface Ancestry {
  /** The nearest ancestor whose role flattens its contents, if any. */
  flattened: Flattened | null;
  /** Inside a `<label>`, which names whatever control it wraps. */
  labelled: boolean;
  /**
   * Inside a component's tag, so this markup is projected into a template this
   * file cannot see — where a `<label>` may already be waiting for it.
   */
  projected: boolean;
}

/** Enclosed by nothing: the root of the template, and where a portal lands. */
const UNENCLOSED: Ancestry = { flattened: null, labelled: false, projected: false };

export function checkAccessibility(root: RootNode, options: A11yOptions = {}): Diagnostic[] {
  if (options.a11y === 'off') return [];

  const ctx: Context = {
    warnings: [],
    severity: options.a11y ?? 'error',
    ids: new Set(),
    idsUnknowable: false,
    labelTargets: new Set(),
    labelTargetsUnknowable: false,
    filename: options.filename,
  };
  collectReferences(root.children, ctx);
  try {
    walk(root.children, UNENCLOSED, ctx);
  } catch (e) {
    // Both severities come out of one pass, so an error ending it would take
    // every warning found before it — and those are about other elements.
    if (e instanceof CompilerError) e.warnings = ctx.warnings;
    throw e;
  }
  return ctx.warnings;
}

/**
 * Every id in the template, and every id a `<label for>` claims, gathered
 * before any of it is checked.
 *
 * A `for` or an `aria-labelledby` may name an element written further down, or
 * one sitting on a component's tag, so the set has to be complete before the
 * first reference to it is judged. A control is judged against the labels on
 * both sides of it, which is the same problem pointed the other way.
 */
function collectReferences(nodes: TemplateChildNode[], ctx: Context): void {
  for (const node of nodes) {
    if (node.type !== 'element' && node.type !== 'slot-outlet') continue;
    const isLabel = node.type === 'element' && node.tag.toLowerCase() === 'label';
    for (const a of node.attrs) {
      const name = a.name.toLowerCase();
      if (name === 'id' && a.value) ctx.ids.add(a.value);
      if (isLabel && name === 'for' && a.value?.trim()) ctx.labelTargets.add(a.value.trim());
    }
    for (const d of node.directives) {
      const binds = (name: string) =>
        (d.kind === 'prop' || d.kind === 'attr') && d.name.toLowerCase() === name;
      if (binds('id') || d.kind === 'spread') ctx.idsUnknowable = true;
      if (isLabel && (binds('for') || d.kind === 'spread')) ctx.labelTargetsUnknowable = true;
    }
    collectReferences(node.children, ctx);
  }
}

function walk(nodes: TemplateChildNode[], within: Ancestry, ctx: Context): void {
  for (const node of nodes) {
    // Projected content is someone else's markup, but a slot's fallback
    // renders right here and keeps this context.
    if (node.type === 'slot-outlet') {
      walk(node.children, within, ctx);
      continue;
    }
    if (node.type !== 'element') continue;

    // A portalled element lands in a container this template knows nothing
    // about, so nothing above it here is above it there.
    if (node.directives.some((d) => d.kind === 'portal')) {
      walk(node.children, UNENCLOSED, ctx);
      continue;
    }

    // A component's root element is in another module and a `<template>`
    // contributes no element — but what either renders still lands inside
    // whatever encloses it here. An `aria-*` written on a component tag is a
    // prop rather than an attribute, and whether it reaches the DOM at all is
    // that component's decision, so nothing here can call one wrong.
    if (node.isComponent || node.isTemplate) {
      // Children of a component tag are projected into its slot, so what
      // encloses them at the far end is markup this file has never seen.
      walk(node.children, node.isComponent ? { ...within, projected: true } : within, ctx);
      continue;
    }

    check(node, within, ctx);
    walk(node.children, descend(node, within), ctx);
  }
}

/** What the children of an element are enclosed by, given what encloses it. */
function descend(node: ElementNode, within: Ancestry): Ancestry {
  return {
    flattened: flattensContent(node) ?? within.flattened,
    labelled: within.labelled || node.tag.toLowerCase() === 'label',
    projected: within.projected,
  };
}

function check(node: ElementNode, within: Ancestry, ctx: Context): void {
  const tag = node.tag.toLowerCase();
  const flattened = within.flattened;
  if (flattened) rule(() => checkFlattened(node, tag, flattened, ctx));
  rule(() => checkAria(node, ctx));
  rule(() => checkRole(node, tag, ctx));
  rule(() => checkTabindex(node, ctx));
  rule(() => checkImageAlt(node, tag, ctx));
  rule(() => checkLabelFor(node, tag, ctx));
  rule(() => checkControlName(node, tag, within, ctx));
  rule(() => checkListener(node, tag, ctx));
}

// ---------------------------------------------------------------------------
// aria-*
// ---------------------------------------------------------------------------

function checkAria(node: ElementNode, ctx: Context): void {
  // A bound `aria-*` hides a misspelling exactly as well as a written one, and
  // the name is knowable either way even where the value is not.
  for (const d of node.directives) {
    if (d.kind !== 'prop' && d.kind !== 'attr') continue;
    const name = d.name.toLowerCase();
    if (name.startsWith('aria-')) ariaSpec(name, d, ctx);
  }

  for (const attr of node.attrs) {
    const name = attr.name.toLowerCase();
    if (!name.startsWith('aria-')) continue;
    checkAriaValue(name, ariaSpec(name, attr, ctx), attr, ctx);
  }
}

function ariaSpec(name: string, at: Located, ctx: Context): AriaAttribute {
  const spec = ARIA_ATTRIBUTES[name];
  if (spec) return spec;

  const meant = Object.keys(ARIA_ATTRIBUTES).find((known) => isOneEditFrom(name, known));
  fail(
    meant
      ? `\`${name}\` is not an ARIA attribute — did you mean \`${meant}\`?\n` +
          '  Nothing reads the name as written, so the state it was meant to carry is\n' +
          '  absent rather than wrong.'
      : `\`${name}\` is not an ARIA attribute, and nothing reads it.\n` +
          '  ARIA is a closed vocabulary, so an invented name is inert.\n' +
          `  Remove it, or write \`data-${name.slice(5)}\` if it is your own.`,
    at,
    ctx,
  );
}

function checkAriaValue(
  name: string,
  spec: AriaAttribute,
  attr: AttributeNode,
  ctx: Context,
): void {
  const raw = attr.value ?? '';

  // Written with nothing in it, whichever kind it is. A browser reads an empty
  // value as an absent attribute, so `aria-hidden` alone hides nothing and
  // `aria-labelledby=""` names nothing — one answer here is what stops the
  // kinds disagreeing about the same mistake.
  if (raw.trim() === '') {
    fail(
      `\`${name}\` is written with no value.\n` +
        '  An empty value is read as an absent one, so the state this was there to set\n' +
        '  stays at the default the element already had.\n' +
        `  Give it a value, or bind it with \`:${name}\` if the value is computed.`,
      attr,
      ctx,
    );
  }

  switch (spec.kind) {
    case 'token': {
      if (spec.values!.includes(raw.trim().toLowerCase())) return;
      fail(
        `\`${name}\` does not take \`${raw}\`.\n` +
          '  A value outside the enumeration is ignored, which leaves the state unset\n' +
          '  rather than wrong — the harder of the two to notice.\n' +
          `  Write ${list(spec.values!)}.`,
        attr,
        ctx,
      );
      return;
    }

    case 'tokens': {
      const bad = raw
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean)
        .find((v) => !spec.values!.includes(v));
      if (!bad) return;
      fail(
        `\`${name}\` does not take \`${bad}\`.\n` +
          `  Write ${list(spec.values!)}, separated by spaces.`,
        attr,
        ctx,
      );
      return;
    }

    case 'integer':
    case 'number': {
      const pattern = spec.kind === 'integer' ? /^[+-]?\d+$/ : /^[+-]?(\d+\.?\d*|\.\d+)$/;
      if (pattern.test(raw.trim())) return;
      fail(
        `\`${name}\` takes ${spec.kind === 'integer' ? 'an integer' : 'a number'}, ` +
          `not \`${raw}\`.\n` +
          `  Write \`${name}="1"\`, or bind it with \`:${name}\` if it is computed.`,
        attr,
        ctx,
      );
      return;
    }

    case 'idref':
    case 'idrefs': {
      for (const id of raw.trim().split(/\s+/).filter(Boolean)) {
        if (ctx.ids.has(id)) continue;
        const message = missingId(`\`${name}\``, id, ctx);
        if (message) warn(message, attr, ctx);
      }
      return;
    }
  }
}

/**
 * The one message both kinds of id reference share, or nothing to say.
 *
 * A reference nothing resolves is dropped in silence, and the commonest cause
 * by far is a single character — so a near miss is named where there is one.
 *
 * Where the template computes an id somewhere, some element carries one this
 * file never writes and a reference matching none of the written ids may still
 * resolve, so the check goes quiet. A near miss is what survives that: a
 * computed id is built from a counter or a field name, never from something
 * one edit away from an id somebody typed, so the miss is a typo either way.
 * Without this the two rules are off for any template using a primitive,
 * because a `:spread` is how every primitive is consumed.
 */
function missingId(what: string, id: string, ctx: Context): string | null {
  const near = [...ctx.ids].find((known) => isOneEditFrom(id, known));
  if (ctx.idsUnknowable && !near) return null;

  return (
    (ctx.idsUnknowable
      ? `${what} points at \`${id}\`, one edit from the \`${near}\` this template writes.\n`
      : `${what} points at \`${id}\`, which no element in this template carries.\n`) +
    '  An id reference resolves exactly or not at all, so what it was there to\n' +
    '  supply is missing rather than wrong.\n' +
    (near
      ? `  Did you mean \`${near}\`?`
      : `  Give the element it means \`id="${id}"\`, or point this at one that exists.`)
  );
}

// ---------------------------------------------------------------------------
// role
// ---------------------------------------------------------------------------

/**
 * A role from DPUB-ARIA or Graphics-ARIA, which this compiler does not carry.
 *
 * The prefix is enough: the alternative to accepting `doc-subtitle` unread is
 * rejecting it, and a rule that rejects a real role is the one that gets the
 * whole set switched off.
 */
function isModuleRole(role: string): boolean {
  return role.startsWith('doc-') || role.startsWith('graphics-');
}

function checkRole(node: ElementNode, tag: string, ctx: Context): void {
  const attr = attrOf(node, 'role');
  // `role=""` is HTML's own way of writing no role, and asks for nothing —
  // unlike an empty `aria-*`, which was written to set something and does not.
  if (!attr?.value?.trim()) return;

  // A space-separated value is a fallback chain: the first role a browser
  // knows is the one it uses, so every one of them has to be knowable.
  const roles = attr.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  for (const role of roles) {
    if (ARIA_ROLES.has(role) || isModuleRole(role)) continue;
    const meant = [...ARIA_ROLES].find((known) => isOneEditFrom(role, known));
    fail(
      `\`role="${role}"\` is not an ARIA role${meant ? ` — did you mean \`${meant}\`?` : '.'}\n` +
        '  An unknown role is discarded and the element keeps whatever role its tag\n' +
        '  already gave it, so the markup claims a semantic the page does not have.' +
        (meant ? '' : '\n  Remove it, or write the role the element really has.'),
      attr,
      ctx,
    );
  }

  const role = roles[0]!;

  if ((role === 'presentation' || role === 'none') && isFocusable(node, tag)) {
    fail(
      `\`role="${role}"\` on \`<${tag}>\`, which a keyboard can still focus.\n` +
        '  A browser ignores a presentational role on anything focusable, so the role\n' +
        '  is inert and the element goes on announcing itself.\n' +
        '  Remove the role, or make the element something that is not focusable.',
      attr,
      ctx,
    );
  }

  // A module role's superclasses live in a vocabulary this compiler does not
  // carry, and the modules' own idioms keep what the element had: doc-backlink
  // and doc-biblioref are links, doc-toc is a navigation. Judging them against
  // a table written from the core roles reports correct DPUB markup as a
  // mistake, on exactly the elements the module exists for.
  if (isModuleRole(role)) return;

  for (const entry of OVERRIDES) {
    if (!entry.tags.includes(tag)) continue;
    if (entry.needsHref && !has(node, 'href')) continue;
    if (entry.keeps.includes(role)) continue;
    warn(
      `\`role="${role}"\` on \`<${tag}>\` replaces ${entry.lost}.\n` +
        `  ${entry.why}\n` +
        `  ${entry.remedy}`,
      attr,
      ctx,
    );
  }
}

// ---------------------------------------------------------------------------
// tabindex
// ---------------------------------------------------------------------------

function checkTabindex(node: ElementNode, ctx: Context): void {
  const attr = attrOf(node, 'tabindex');
  const written = attr?.value ?? '';
  const value = written.trim();
  if (!/^\+?\d+$/.test(value) || Number(value) <= 0) return;

  fail(
    // Quoted as written: a message that silently reformats what it is
    // reporting is one the author has to search for twice.
    `\`tabindex="${written}"\` puts this element in front of the whole page.\n` +
      '  A positive tabindex is a document-wide ordering rather than a local one:\n' +
      '  every element without one now comes after it, on every page this component\n' +
      '  appears on.\n' +
      '  Write `tabindex="0"` to be focusable where it stands, and move the element if\n' +
      '  it has to come earlier.',
    attr!,
    ctx,
  );
}

// ---------------------------------------------------------------------------
// <img>
// ---------------------------------------------------------------------------

function checkImageAlt(node: ElementNode, tag: string, ctx: Context): void {
  if (tag !== 'img') return;
  // A spread may be carrying the alt, and what it carries is a runtime value.
  if (node.directives.some((d) => d.kind === 'spread')) return;
  if (has(node, 'alt') || has(node, 'aria-label') || has(node, 'aria-labelledby')) return;
  if (attrOf(node, 'aria-hidden')?.value === 'true') return;
  const role = attrOf(node, 'role')?.value?.trim().toLowerCase();
  if (role === 'presentation' || role === 'none') return;

  fail(
    '`<img>` with no `alt`.\n' +
      '  An image with no alternative is announced as its file name, which is worse\n' +
      '  than either saying something or saying nothing.\n' +
      '  Write what the image says. If it says nothing the text beside it does not\n' +
      '  already say, write `alt=""` — an empty alt is an answer, a missing one is\n' +
      '  silence.',
    node,
    ctx,
  );
}

// ---------------------------------------------------------------------------
// <label for>
// ---------------------------------------------------------------------------

function checkLabelFor(node: ElementNode, tag: string, ctx: Context): void {
  if (tag !== 'label') return;
  const attr = attrOf(node, 'for');
  const target = attr?.value?.trim();
  if (!target || ctx.ids.has(target)) return;

  const message = missingId('`<label for>`', target, ctx);
  if (!message) return;
  warn(
    `${message}\n` +
      '  A label attached to nothing gives its control no name and moves no focus when\n' +
      '  it is clicked. Wrapping the control in the `<label>` needs no id at all.',
    attr!,
    ctx,
  );
}

// ---------------------------------------------------------------------------
// A control nothing names
// ---------------------------------------------------------------------------

/**
 * Controls whose name cannot come from what is written inside them.
 *
 * `<button>` and `<a>` are deliberately absent: their contents are their name,
 * so a rule about the routes below would report every correct one of them.
 */
const NAMED_FROM_OUTSIDE = new Set(['input', 'select', 'textarea']);

/**
 * Input types that arrive already named, whatever labels the page has.
 *
 * A button-like input is named by its `value` and falls back to the browser's
 * own word for it, `hidden` renders nothing at all, and `image` is named by
 * `alt` — which is the `<img>` rule's question rather than this one's.
 */
const SELF_NAMING_INPUTS = new Set(['submit', 'reset', 'button', 'image', 'hidden']);

/**
 * A form control with no accessible name by any of the four routes to one.
 *
 * A control with no name is announced as its type and nothing else, so what to
 * type into it has to be inferred from whatever was read out before it, and
 * voice control has no words to reach it by. The routes are a `<label>` around
 * it, a `<label for>` pointing at its id, `aria-label`, and `aria-labelledby`;
 * `title` names it too, badly enough that nothing here recommends it and
 * plainly enough that it is not reported.
 *
 * This is the rule with the most ways to be wrong about a correct control, so
 * every one of them ends the check rather than being guessed at: a `:spread`
 * may be carrying any of the four, a computed `id` may be the one a label
 * points at, a computed `type` may be one of the self-naming ones, and markup
 * written inside a component's tag is projected into a template this file
 * cannot see, where the `<label>` around it may be waiting. What is left is a
 * control this template alone shows to be unreachable by all four routes.
 */
function checkControlName(
  node: ElementNode,
  tag: string,
  within: Ancestry,
  ctx: Context,
): void {
  if (!NAMED_FROM_OUTSIDE.has(tag)) return;
  if (within.labelled || within.projected) return;
  if (node.directives.some((d) => d.kind === 'spread')) return;
  if (has(node, 'aria-label') || has(node, 'aria-labelledby') || has(node, 'title')) return;
  if (attrOf(node, 'aria-hidden')?.value === 'true') return;

  if (tag === 'input') {
    if (bound(node, 'type')) return;
    const type = (attrOf(node, 'type')?.value ?? 'text').trim().toLowerCase();
    if (SELF_NAMING_INPUTS.has(type)) return;
  }

  // Carrying no id at all settles it: `for` resolves exactly or not at all, so
  // no label anywhere reaches a control that has nothing to be pointed at.
  if (bound(node, 'id')) return;
  const id = attrOf(node, 'id')?.value?.trim();
  if (id && (ctx.labelTargets.has(id) || ctx.labelTargetsUnknowable)) return;

  warn(
    `\`<${tag}>\` has no accessible name.\n` +
      '  A control nothing names is announced as its type alone, so what belongs in it\n' +
      '  is left to be guessed from whatever was read out before it, and voice control\n' +
      '  has no words to reach it by.\n' +
      '  Wrap it in a `<label>`, point a `<label for>` at its `id`, or name it with\n' +
      '  `aria-label`. A `placeholder` is not a name — it is gone the moment somebody\n' +
      '  types.',
    node,
    ctx,
  );
}

// ---------------------------------------------------------------------------
// Listeners
// ---------------------------------------------------------------------------

function checkListener(node: ElementNode, tag: string, ctx: Context): void {
  const listener = node.directives.find(
    (d) => d.kind === 'event' && ACTIVATION_EVENTS.has(d.name),
  );
  if (!listener) return;
  if (isInteractive(node, tag)) return;
  // Each of these is the author having already answered the question, and a
  // spread may be carrying any of them.
  if (has(node, 'role') || has(node, 'tabindex') || has(node, 'contenteditable')) return;
  if (node.directives.some((d) => d.kind === 'spread')) return;

  warn(
    `\`${listener.rawName}\` on \`<${tag}>\`, which no keyboard can reach.\n` +
      '  A pointer finds this element and nothing else does: it takes no focus, so the\n' +
      '  handler is unreachable from a keyboard and the element is announced as plain\n' +
      '  text.\n' +
      '  Use `<button>` if it acts, `<a href>` if it navigates, or say what it is with\n' +
      '  a `role` and `tabindex="0"` and handle the keys yourself.',
    listener,
    ctx,
  );
}

// ---------------------------------------------------------------------------
// Nesting the ARIA content model forbids
// ---------------------------------------------------------------------------

/**
 * The role an element carries here, written or implied.
 *
 * The attribute-dependent roles — a link only with `href`, a checkbox only
 * with `type` — are deliberately not worked out. Every element they would
 * describe is focusable, and `isFocusable` is asked first by both callers, so
 * computing them decides nothing and only invites the two to disagree.
 */
function effectiveRole(node: ElementNode, tag: string): string | null {
  const written = attrOf(node, 'role')?.value?.trim().toLowerCase().split(/\s+/)[0];
  if (written && ARIA_ROLES.has(written)) return written;
  return IMPLICIT_ROLES[tag] ?? null;
}

function flattensContent(node: ElementNode): Flattened | null {
  const tag = node.tag.toLowerCase();
  const role = effectiveRole(node, tag);
  if (!role || !FLATTENS_CONTENT.has(role)) return null;
  return {
    role,
    holder: attrOf(node, 'role')?.value ? `\`role="${role}"\`` : `\`<${tag}>\``,
  };
}

function checkFlattened(
  node: ElementNode,
  tag: string,
  flattened: Flattened,
  ctx: Context,
): void {
  const role = effectiveRole(node, tag);

  if (role === 'heading') {
    fail(
      `\`<${tag}>\` inside ${flattened.holder}, which flattens everything in it to text.\n` +
        `  A \`${flattened.role}\` announces its contents as its own name, so the heading\n` +
        '  is not in the outline and navigating by heading never reaches it.\n' +
        '  Style a `<span>` to look like a heading, or move the heading outside.',
      node,
      ctx,
    );
  }

  if (!isFocusable(node, tag) && !(role && CONTROL_ROLES.has(role))) return;

  fail(
    `\`<${tag}>\` inside ${flattened.holder}, which flattens everything in it to text.\n` +
      `  A \`${flattened.role}\` announces its contents as its own name, so a control in\n` +
      '  here is read out as part of that name and cannot be operated on its own.\n' +
      `  Make the two siblings — the control beside the \`${flattened.role}\`, not inside\n` +
      '  it.',
    node,
    ctx,
  );
}

// ---------------------------------------------------------------------------
// What an element is
// ---------------------------------------------------------------------------

function attrOf(node: ElementNode, name: string): AttributeNode | undefined {
  return node.attrs.find((a) => a.name.toLowerCase() === name);
}

/** Written out or bound — either way the element has it when it renders. */
function has(node: ElementNode, name: string): boolean {
  return node.attrs.some((a) => a.name.toLowerCase() === name) || bound(node, name);
}

/** Bound rather than written, so what it ends up being is a runtime fact. */
function bound(node: ElementNode, name: string): boolean {
  return node.directives.some(
    (d) => (d.kind === 'prop' || d.kind === 'attr') && d.name.toLowerCase() === name,
  );
}

/** Reachable and operable from a keyboard with nothing added. */
function isFocusable(node: ElementNode, tag: string): boolean {
  const tabindex = attrOf(node, 'tabindex')?.value?.trim();
  if (tabindex !== undefined && /^\+?\d+$/.test(tabindex)) return true;

  switch (tag) {
    case 'button':
    case 'select':
    case 'textarea':
    case 'summary':
    case 'iframe':
      return true;
    case 'input':
      return (attrOf(node, 'type')?.value ?? 'text').trim().toLowerCase() !== 'hidden';
    case 'a':
    case 'area':
      return has(node, 'href');
    case 'audio':
    case 'video':
      return has(node, 'controls');
    default:
      return false;
  }
}

/** Focusable, or operated by being clicked — a `<label>` forwards its click. */
function isInteractive(node: ElementNode, tag: string): boolean {
  return isFocusable(node, tag) || tag === 'label' || tag === 'option' || tag === 'details';
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

interface Located {
  loc: { line: number; column: number };
}

/** Every enum in the table has two members or more, so there is no lone one. */
function list(values: readonly string[]): string {
  const quoted = values.map((v) => `\`${v}\``);
  return `${quoted.slice(0, -1).join(', ')} or ${quoted[quoted.length - 1]}`;
}

function warn(message: string, at: Located, ctx: Context): void {
  ctx.warnings.push({ message, loc: at.loc, filename: ctx.filename });
}

/**
 * Ends the rule that found something, not the pass.
 *
 * Under `a11y: 'warn'` a refusal still has to unwind the rule that raised it —
 * every one of them is written expecting `fail` never to return — while the
 * rules after it go on running, which is the whole point of the mode.
 */
const STOP = Symbol('volt:a11y:stop');

function rule(run: () => void): void {
  try {
    run();
  } catch (e) {
    if (e !== STOP) throw e;
  }
}

function fail(message: string, at: Located, ctx: Context): never {
  if (ctx.severity === 'warn') {
    warn(message, at, ctx);
    throw STOP;
  }
  throw new CompilerError(message, at.loc, undefined, ctx.filename);
}
