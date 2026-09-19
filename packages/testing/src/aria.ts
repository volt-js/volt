/**
 * Role and accessible name — the two things a screen reader announces, and the
 * two things a test should be looking for.
 *
 * A query written against a class name or a `data-testid` passes for as long
 * as the markup keeps that hook, including after the widget has stopped being
 * a button, lost its label, or been hidden from the accessibility tree. A
 * query written against role and name fails exactly when the semantics break,
 * which is the point of testing a component library at all.
 *
 * This is the accessible name computation as far as an application's own
 * markup exercises it: `aria-labelledby`, `aria-label`, the host language's
 * own labelling (a `<label>`, an `alt`, a `<legend>`, a `<caption>`), name
 * from content where the role allows it, then `title` and `placeholder`.
 * Deliberately not implemented: CSS-generated content, which happy-dom does
 * not lay out anyway, and the rule that an embedded control inside a `<label>`
 * contributes its *value* to the name — `<label>Age <input value="41"></label>`
 * is "Age" here rather than "Age 41", because a test asking for the field
 * called "Age" should keep finding it after someone types.
 */

/**
 * Tag to role, for the tags whose role does not depend on anything else.
 * The conditional ones — `a`, `img`, `input`, `select`, `th`, `section`,
 * `header`, `footer` — are decided in `implicitRole`.
 */
const IMPLICIT_ROLES: Readonly<Record<string, string>> = {
  article: 'article',
  aside: 'complementary',
  button: 'button',
  datalist: 'listbox',
  dd: 'definition',
  details: 'group',
  dfn: 'term',
  dialog: 'dialog',
  dt: 'term',
  fieldset: 'group',
  figure: 'figure',
  form: 'form',
  h1: 'heading',
  h2: 'heading',
  h3: 'heading',
  h4: 'heading',
  h5: 'heading',
  h6: 'heading',
  hr: 'separator',
  li: 'listitem',
  main: 'main',
  menu: 'list',
  meter: 'meter',
  nav: 'navigation',
  ol: 'list',
  optgroup: 'group',
  option: 'option',
  output: 'status',
  p: 'paragraph',
  progress: 'progressbar',
  search: 'search',
  table: 'table',
  tbody: 'rowgroup',
  td: 'cell',
  textarea: 'textbox',
  tfoot: 'rowgroup',
  thead: 'rowgroup',
  tr: 'row',
  ul: 'list',
};

/**
 * `<input type>` to role, as a browser's accessibility tree exposes it.
 *
 * `null` is a type with no ARIA role at all: a colour well and the date and
 * time pickers are exposed as widgets of their own that no role names, and a
 * hidden input is not exposed. A type missing from the table — misspelt, or
 * one the host language does not know — is a text field, because that is what
 * an `<input>` falls back to.
 */
const INPUT_ROLES: Readonly<Record<string, string | null>> = {
  button: 'button',
  checkbox: 'checkbox',
  color: null,
  date: null,
  'datetime-local': null,
  email: 'textbox',
  // Rendered as, and exposed as, the button that opens the file chooser.
  file: 'button',
  hidden: null,
  image: 'button',
  month: null,
  number: 'spinbutton',
  // A text field whose characters are not read out. ARIA has no role for
  // that difference, and a browser exposes it as a textbox.
  password: 'textbox',
  radio: 'radio',
  range: 'slider',
  reset: 'button',
  search: 'searchbox',
  submit: 'button',
  tel: 'textbox',
  text: 'textbox',
  time: null,
  url: 'textbox',
  week: null,
};

/** `<input>` types that are edited by typing, rather than clicked or dragged. */
const TEXT_INPUT_TYPES = new Set([
  'text',
  'search',
  'url',
  'tel',
  'email',
  'password',
  'number',
  'date',
  'month',
  'week',
  'time',
  'datetime-local',
]);

/**
 * Roles whose name may come from the element's own text.
 *
 * This is what makes `<button>Save</button>` findable as "Save" while
 * `<div role="region">Save</div>` is not: a region has to be named
 * deliberately, and taking its name from whatever it contains would make every
 * landmark on the page answer to its first paragraph.
 */
const NAME_FROM_CONTENT = new Set([
  'button',
  'cell',
  'checkbox',
  'columnheader',
  'gridcell',
  'heading',
  'link',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'radio',
  'row',
  'rowheader',
  'switch',
  'tab',
  'tooltip',
  'treeitem',
]);

/** Landmark scoping: `<header>` is a banner only outside these. */
const SECTIONING = new Set(['article', 'aside', 'main', 'nav', 'section']);

const tagOf = (element: Element): string => element.tagName.toLowerCase();

/** Collapse runs of whitespace, the way a name is compared and announced. */
export function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * The role this element exposes: whatever `role` says, or the one the tag
 * carries on its own.
 */
export function getRole(element: Element): string | null {
  // A token list falls back to the first token the platform understands; only
  // the first is ever produced by anything in this library, so it is the one
  // that is read.
  const explicit = element.getAttribute('role')?.trim().split(/\s+/)[0];
  if (explicit) return explicit;
  return implicitRole(element);
}

function implicitRole(element: Element): string | null {
  const tag = tagOf(element);

  switch (tag) {
    case 'a':
    case 'area':
      // Without `href` it is not a link, and a test that finds one anyway
      // would be hiding the reason keyboard users cannot reach it.
      return element.hasAttribute('href') ? 'link' : 'generic';
    case 'img':
      // `alt=""` is the author saying the image carries no information, which
      // takes it out of the tree rather than leaving it unnamed.
      return element.getAttribute('alt') === '' ? 'presentation' : 'img';
    case 'input': {
      const type = (element.getAttribute('type') ?? 'text').toLowerCase();
      const role = Object.hasOwn(INPUT_ROLES, type) ? (INPUT_ROLES[type] ?? null) : 'textbox';
      // A text field with a suggestion list announces as a combobox, which is
      // the same widget `createCombobox` builds out of `<div>`s — a search
      // field included. `list` does not apply to a password field.
      const suggests = role === 'searchbox' || (role === 'textbox' && type !== 'password');
      return suggests && element.hasAttribute('list') ? 'combobox' : role;
    }
    case 'select':
      return isListSelect(element) ? 'listbox' : 'combobox';
    case 'th':
      return element.getAttribute('scope') === 'row' ? 'rowheader' : 'columnheader';
    case 'section':
      // A region has to be named to be one; an unnamed `<section>` is a
      // grouping element and nothing more.
      return hasExplicitLabel(element) ? 'region' : 'generic';
    case 'header':
      return closestSectioning(element) ? 'generic' : 'banner';
    case 'footer':
      return closestSectioning(element) ? 'generic' : 'contentinfo';
    case 'div':
    case 'span':
      return 'generic';
    default:
      return IMPLICIT_ROLES[tag] ?? null;
  }
}

/**
 * Whether a `<select>` is drawn as a list — `multiple`, or a `size` above one —
 * rather than as a drop-down. It decides the role and what a press on an
 * option does, and asking it in one place keeps those two from disagreeing.
 */
export function isListSelect(element: Element): boolean {
  return element.hasAttribute('multiple') || Number(element.getAttribute('size') ?? '1') > 1;
}

function closestSectioning(element: Element): Element | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    if (SECTIONING.has(tagOf(node))) return node;
  }
  return null;
}

/**
 * Whether the author named this element, by any of the attributes that name a
 * container. `title` is one of them: it is the last thing the name computation
 * reads, but a section with nothing else is named by it.
 */
function hasExplicitLabel(element: Element): boolean {
  return (
    element.hasAttribute('aria-label') ||
    element.hasAttribute('aria-labelledby') ||
    element.hasAttribute('title')
  );
}

/**
 * Whether the accessibility tree contains this element at all.
 *
 * `aria-hidden`, `hidden`, `inert` and `display: none` are asked of every
 * ancestor, because that is where they are usually set — a closed popover
 * hides its whole subtree from one node, a modal makes the page behind it
 * inert from the top, and `display` does not inherit, so a child of a
 * `display: none` container still computes a display of its own.
 *
 * `visibility` is the exception, and is read from this element alone: it does
 * inherit, so the computed value already accounts for every ancestor, and a
 * descendant is allowed to set `visibility: visible` and come back. Walking up
 * for it would hide exactly the element that opted back in — which is the
 * "visually hidden but announced" pattern every skip link is built from.
 */
export function isAccessibilityHidden(element: Element): boolean {
  const view = element.ownerDocument.defaultView;
  if (view?.getComputedStyle(element).visibility === 'hidden') return true;

  for (let node: Element | null = element; node; node = node.parentElement) {
    if (node.getAttribute('aria-hidden') === 'true') return true;
    if (node.hasAttribute('hidden') || node.hasAttribute('inert')) return true;
    if (view?.getComputedStyle(node).display === 'none') return true;
  }
  return false;
}

interface NameContext {
  /** Guards the cycle `aria-labelledby` makes trivially easy to write. */
  visited: Set<Element>;
  /**
   * Set while computing part of a larger name — a referenced element, or a
   * descendant. Inside one, every element contributes its text regardless of
   * role, and `aria-labelledby` is not followed a second time.
   */
  inherited: boolean;
}

/** The name assistive technology would announce for this element. */
export function getAccessibleName(element: Element): string {
  return normalizeText(computeName(element, { visited: new Set(), inherited: false }));
}

function computeName(element: Element, context: NameContext): string {
  if (context.visited.has(element)) return '';
  context.visited.add(element);

  if (!context.inherited) {
    const labelledBy = element.getAttribute('aria-labelledby');
    if (labelledBy) {
      const root = element.ownerDocument;
      const named = labelledBy
        .split(/\s+/)
        .map((id) => root.getElementById(id))
        .filter((target): target is HTMLElement => target !== null)
        // A referenced element is read even when it is hidden: pointing at a
        // `hidden` span is a documented way to name a control.
        .map((target) => computeName(target, { visited: context.visited, inherited: true }))
        .join(' ');
      if (normalizeText(named)) return named;
    }
  }

  const label = element.getAttribute('aria-label');
  if (label && normalizeText(label)) return label;

  const native = hostLanguageName(element, context);
  if (normalizeText(native)) return native;

  if (context.inherited || NAME_FROM_CONTENT.has(getRole(element) ?? '')) {
    const content = contentName(element, context);
    if (normalizeText(content)) return content;
  }

  const title = element.getAttribute('title');
  if (title && normalizeText(title)) return title;

  // Last, and only for a field with nothing else: a placeholder is a hint, and
  // a control named only by one is a control that loses its name as soon as
  // anything is typed into it.
  return element.getAttribute('placeholder') ?? '';
}

function hostLanguageName(element: Element, context: NameContext): string {
  switch (tagOf(element)) {
    case 'input':
      return inputName(element as HTMLInputElement, context);
    case 'textarea':
    case 'select':
      return labelName(element, context);
    case 'img':
    case 'area':
      return element.getAttribute('alt') ?? '';
    case 'fieldset':
      return childName(element, 'legend', context);
    case 'table':
      return childName(element, 'caption', context);
    case 'figure':
      return childName(element, 'figcaption', context);
    case 'svg':
      return childName(element, 'title', context);
    case 'optgroup':
      return element.getAttribute('label') ?? '';
    default:
      return '';
  }
}

function inputName(element: HTMLInputElement, context: NameContext): string {
  const type = (element.getAttribute('type') ?? 'text').toLowerCase();

  if (type === 'button' || type === 'submit' || type === 'reset') {
    const value = element.getAttribute('value');
    if (value) return value;
    // What the browser itself supplies, and localizes. A test asserting on
    // these is asserting on the user's locale, which is why every button worth
    // querying carries its own value.
    if (type === 'submit') return 'Submit';
    if (type === 'reset') return 'Reset';
    return '';
  }

  if (type === 'image') return element.getAttribute('alt') || 'Submit';

  return labelName(element, context);
}

/** The text of the `<label>`s pointing at this control. */
function labelName(element: Element, context: NameContext): string {
  const labels: Element[] = [];

  const id = element.getAttribute('id');
  if (id) {
    for (const label of element.ownerDocument.querySelectorAll('label')) {
      if (label.getAttribute('for') === id) labels.push(label);
    }
  }

  const wrapping = element.closest('label');
  if (wrapping && !labels.includes(wrapping)) labels.push(wrapping);

  return labels
    .map((label) => contentName(label, context, element))
    .filter((text) => normalizeText(text))
    .join(' ');
}

function childName(element: Element, tag: string, context: NameContext): string {
  for (const child of element.children) {
    if (tagOf(child) === tag) return computeName(child, { ...context, inherited: true });
  }
  return '';
}

/**
 * The element's own text, with each descendant contributing whatever *it* is
 * named — so an icon button labelled by an `aria-label` on the icon reads as
 * that label rather than as nothing.
 */
function contentName(element: Element, context: NameContext, skip?: Element): string {
  let text = '';

  for (const node of element.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent ?? '';
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;

    const child = node as Element;
    if (child === skip || isAccessibilityHidden(child)) continue;
    // Spaces between elements, because `<span>Save</span><span>all</span>` is
    // announced as two words.
    text += ` ${computeName(child, { visited: context.visited, inherited: true })} `;
  }

  return text;
}

/**
 * Whether typing into this element is something the platform would accept.
 *
 * Asked of the `type` property rather than the attribute: the property is the
 * type the field actually is, so a type the host language does not know reads
 * as the text field it falls back to, as it does for the role.
 */
export function isTextField(element: Element): boolean {
  const tag = tagOf(element);
  if (tag === 'textarea') return true;
  if (tag !== 'input') return false;
  return TEXT_INPUT_TYPES.has((element as HTMLInputElement).type);
}
