/**
 * Static DOM knowledge the compiler uses to resolve `:name` directives and to
 * decide what can be baked into markup at build time.
 */

/**
 * Standard DOM event names. A bare `:name` whose name appears here compiles to
 * an event listener; anything else becomes a property/attribute binding. Use
 * `:on-name` to force an event (custom events, component outputs) and
 * `:prop-name` / `:attr-name` to force the other direction.
 */
export const KNOWN_EVENTS = new Set([
  // Mouse / pointer
  'click', 'dblclick', 'mousedown', 'mouseup', 'mousemove', 'mouseenter', 'mouseleave',
  'mouseover', 'mouseout', 'contextmenu', 'wheel',
  'pointerdown', 'pointerup', 'pointermove', 'pointerenter', 'pointerleave',
  'pointerover', 'pointerout', 'pointercancel', 'gotpointercapture', 'lostpointercapture',
  // Touch
  'touchstart', 'touchend', 'touchmove', 'touchcancel',
  // Keyboard
  'keydown', 'keyup', 'keypress',
  // Form
  'input', 'change', 'submit', 'reset', 'invalid', 'search',
  'focus', 'blur', 'focusin', 'focusout', 'select',
  // Clipboard / drag
  'copy', 'cut', 'paste',
  'drag', 'dragstart', 'dragend', 'dragenter', 'dragleave', 'dragover', 'drop',
  // Media
  'play', 'pause', 'ended', 'volumechange', 'timeupdate', 'durationchange',
  'loadeddata', 'loadedmetadata', 'canplay', 'canplaythrough', 'seeking', 'seeked',
  'stalled', 'suspend', 'waiting', 'ratechange', 'emptied',
  // Loading / lifecycle
  'load', 'error', 'abort', 'beforeunload', 'unload',
  'scroll', 'scrollend', 'resize', 'toggle', 'close', 'cancel',
  // Animation / transition
  'animationstart', 'animationend', 'animationiteration', 'animationcancel',
  'transitionstart', 'transitionend', 'transitionrun', 'transitioncancel',
  // Misc
  'beforeinput', 'compositionstart', 'compositionupdate', 'compositionend',
  'securitypolicyviolation', 'slotchange', 'formdata',
]);

/** Every standard HTML element — used to tell DOM tags from components. */
export const HTML_TAGS = new Set([
  'a', 'abbr', 'address', 'area', 'article', 'aside', 'audio', 'b', 'base', 'bdi', 'bdo',
  'blockquote', 'body', 'br', 'button', 'canvas', 'caption', 'cite', 'code', 'col',
  'colgroup', 'data', 'datalist', 'dd', 'del', 'details', 'dfn', 'dialog', 'div', 'dl',
  'dt', 'em', 'embed', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2',
  'h3', 'h4', 'h5', 'h6', 'head', 'header', 'hgroup', 'hr', 'html', 'i', 'iframe', 'img',
  'input', 'ins', 'kbd', 'label', 'legend', 'li', 'link', 'main', 'map', 'mark', 'menu',
  'meta', 'meter', 'nav', 'noscript', 'object', 'ol', 'optgroup', 'option', 'output', 'p',
  'picture', 'pre', 'progress', 'q', 'rp', 'rt', 'ruby', 's', 'samp', 'script', 'search',
  'section', 'select', 'slot', 'small', 'source', 'span', 'strong', 'style', 'sub',
  'summary', 'sup', 'table', 'tbody', 'td', 'template', 'textarea', 'tfoot', 'th',
  'thead', 'time', 'title', 'tr', 'track', 'u', 'ul', 'var', 'video', 'wbr',
]);

export const SVG_TAGS = new Set([
  'svg', 'animate', 'animateMotion', 'animateTransform', 'circle', 'clipPath', 'defs',
  'desc', 'ellipse', 'feBlend', 'feColorMatrix', 'feComponentTransfer', 'feComposite',
  'feConvolveMatrix', 'feDiffuseLighting', 'feDisplacementMap', 'feDistantLight',
  'feDropShadow', 'feFlood', 'feFuncA', 'feFuncB', 'feFuncG', 'feFuncR', 'feGaussianBlur',
  'feImage', 'feMerge', 'feMergeNode', 'feMorphology', 'feOffset', 'fePointLight',
  'feSpecularLighting', 'feSpotLight', 'feTile', 'feTurbulence', 'filter',
  'foreignObject', 'g', 'image', 'line', 'linearGradient', 'marker', 'mask', 'metadata',
  'mpath', 'path', 'pattern', 'polygon', 'polyline', 'radialGradient', 'rect', 'set',
  'stop', 'switch', 'symbol', 'text', 'textPath', 'tspan', 'use', 'view',
]);

/**
 * Attributes with no matching IDL property, or whose property name differs
 * enough that writing the attribute is the only correct move.
 */
export const MUST_USE_ATTRIBUTE = new Set([
  'class', 'style', 'for', 'role', 'is', 'list', 'form', 'download', 'target',
  'colspan', 'rowspan', 'datetime', 'novalidate', 'formnovalidate',
  'contenteditable', 'spellcheck', 'draggable', 'translate',
]);

/** Attributes whose presence alone is meaningful — removed entirely when falsy. */
export const BOOLEAN_ATTRIBUTES = new Set([
  'allowfullscreen', 'async', 'autofocus', 'autoplay', 'checked', 'controls', 'default',
  'defer', 'disabled', 'formnovalidate', 'hidden', 'inert', 'ismap', 'itemscope', 'loop',
  'multiple', 'muted', 'nomodule', 'novalidate', 'open', 'playsinline', 'readonly',
  'required', 'reversed', 'selected',
]);

/** DOM property names that differ from their attribute spelling. */
export const ATTR_TO_PROP: Record<string, string> = {
  class: 'className',
  for: 'htmlFor',
  colspan: 'colSpan',
  rowspan: 'rowSpan',
  maxlength: 'maxLength',
  minlength: 'minLength',
  tabindex: 'tabIndex',
  readonly: 'readOnly',
  contenteditable: 'contentEditable',
  crossorigin: 'crossOrigin',
  datetime: 'dateTime',
  novalidate: 'noValidate',
  autocomplete: 'autocomplete',
  autofocus: 'autofocus',
};

/** Keyboard `.key` values addressable as `:keydown.enter` style modifiers. */
export const KEY_MODIFIERS: Record<string, string> = {
  enter: 'Enter',
  tab: 'Tab',
  esc: 'Escape',
  escape: 'Escape',
  space: ' ',
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  delete: 'Delete',
  backspace: 'Backspace',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
};

/**
 * Events attached once at the document and dispatched by walking up from the
 * target, instead of one listener per element.
 *
 * A thousand-row table with two handlers per row is two listeners rather than
 * two thousand. Only events that genuinely bubble are listed — `focus` and
 * `blur` do not, and media events are per-element by nature.
 */
export const DELEGATED_EVENTS = new Set([
  'click', 'dblclick', 'contextmenu', 'auxclick',
  'mousedown', 'mouseup',
  'pointerdown', 'pointerup',
  'keydown', 'keyup', 'keypress',
  'input', 'change', 'submit', 'reset', 'beforeinput',
  'focusin', 'focusout',
  'dragstart', 'dragend', 'dragenter', 'dragleave', 'drop',
  'copy', 'cut', 'paste',
]);

/**
 * Two kinds of event are deliberately absent from that list, and both were
 * once in it.
 *
 * **Events browsers force to be passive.** A `wheel`, `touchstart` or
 * `touchmove` listener registered on the document is passive whether or not it
 * asks to be, so `preventDefault()` inside it is discarded — silently, apart
 * from a console warning. Delegating them meant `:wheel.prevent` compiled to a
 * listener that could not prevent anything, because `prevent` is a guard
 * rather than a listener option and so never forced a direct listener. That
 * silently breaks the components most likely to want it: sliders adjusted by
 * wheel, number inputs, carousels, splitters and custom scrollers.
 *
 * **High-frequency events.** Delegation trades one listener per element for an
 * ancestor walk per event. That is a good trade for `click`, where a table may
 * carry a thousand handlers and a press fires once. It is a bad trade for
 * `pointermove` or `dragover`, where a drag has a single handler and fires
 * hundreds of events a second, each walking from target to document finding
 * nothing. `dragover` is doubly wrong to delegate: cancelling it is how a drop
 * target declares itself.
 *
 * Hover belongs in CSS, and a gesture should listen on the document only for
 * as long as the gesture lasts.
 *
 * Codegen consults this, so a name added here stops being delegated. It was
 * decorative until now — the two sets were kept disjoint by hand and nothing
 * checked, so adding a name had no effect and the next person had no way to
 * find that out except by testing the output.
 */
export const NEVER_DELEGATED = new Set([
  'wheel', 'mousewheel',
  'touchstart', 'touchmove',
  'mousemove', 'mouseover', 'mouseout',
  'pointermove', 'pointerover', 'pointerout',
  'dragover',
]);

export const SYSTEM_MODIFIERS = new Set(['ctrl', 'alt', 'shift', 'meta']);
export const EVENT_OPTION_MODIFIERS = new Set(['capture', 'once', 'passive']);
export const EVENT_GUARD_MODIFIERS = new Set(['stop', 'prevent', 'self']);

export function isComponentTag(tag: string): boolean {
  // PascalCase is unambiguous. A hyphen means custom element or component
  // selector; standard HTML has no hyphenated tags.
  if (/^[A-Z]/.test(tag)) return true;
  if (tag.includes('-')) return true;
  return false;
}

export function isKnownElement(tag: string): boolean {
  return HTML_TAGS.has(tag) || SVG_TAGS.has(tag.toLowerCase()) || SVG_TAGS.has(tag);
}

/**
 * Attribute and property names common enough that a `:` binding using one is
 * certainly deliberate.
 *
 * Used only to keep the typo check below from firing on real bindings: `:id`
 * is one character from `:if`, and `:form` one from `:for`. This does not have
 * to be exhaustive — a name missing from it is only checked for a near-miss
 * against a directive, and almost nothing legitimate is one edit away from one.
 */
export const COMMON_ATTRIBUTES = new Set([
  'id', 'title', 'lang', 'dir', 'role', 'tabindex', 'hidden', 'inert', 'slot', 'part',
  'name', 'value', 'type', 'placeholder', 'href', 'src', 'alt', 'srcset', 'sizes',
  'width', 'height', 'form', 'action', 'method', 'target', 'rel', 'download',
  'min', 'max', 'step', 'pattern', 'accept', 'autocomplete', 'inputmode', 'enterkeyhint',
  'rows', 'cols', 'wrap', 'span', 'colspan', 'rowspan', 'headers', 'scope',
  'checked', 'selected', 'disabled', 'readonly', 'required', 'multiple', 'open',
  'loading', 'decoding', 'fetchpriority', 'referrerpolicy', 'crossorigin',
  'poster', 'preload', 'controls', 'autoplay', 'loop', 'muted', 'playsinline',
  'draggable', 'spellcheck', 'translate', 'contenteditable', 'popover', 'popovertarget',
  'label', 'list', 'maxlength', 'minlength', 'size', 'start', 'reversed', 'datetime',
]);

/** Directive names a mistyped one is most likely aiming at. */
export const DIRECTIVE_NAMES = [
  'if', 'else-if', 'else', 'for', 'key', 'text', 'html', 'model', 'ref', 'slot',
  'portal', 'host', 'outlet', 'class', 'style', 'spread',
];

/** Edit distance, capped — anything past 1 is not a typo worth guessing at. */
export function isOneEditFrom(a: string, b: string): boolean {
  if (a === b) return false;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (long.length - short.length > 1) return false;

  if (short.length === long.length) {
    // One substitution, or one transposition of neighbours.
    let diff = -1;
    for (let i = 0; i < short.length; i++) {
      if (short[i] === long[i]) continue;
      if (diff !== -1) {
        return (
          diff === i - 1 && short[diff] === long[i] && short[i] === long[diff] &&
          short.slice(i + 1) === long.slice(i + 1)
        );
      }
      diff = i;
    }
    return diff !== -1;
  }

  // One insertion: the shorter must be the longer with a single character out.
  for (let i = 0; i < long.length; i++) {
    if (short === long.slice(0, i) + long.slice(i + 1)) return true;
  }
  return false;
}


/**
 * What an ARIA state or property accepts.
 *
 * Only two things are ever asked of an entry: whether the name exists at all,
 * and whether an authored literal is one of the values. So an enumerated
 * attribute carries its enum and everything else carries only the shape, which
 * is enough to tell an id reference from free text.
 */
export type AriaValueKind =
  /** Free text — nothing to check beyond the name. */
  | 'string'
  | 'integer'
  | 'number'
  /** One id, which some other element in the document must carry. */
  | 'idref'
  /** Space-separated ids, each of which must exist. */
  | 'idrefs'
  /** Exactly one of `values`. */
  | 'token'
  /** Any number of `values`, space-separated. */
  | 'tokens';

export interface AriaAttribute {
  kind: AriaValueKind;
  /** The enum, for `token` and `tokens`. */
  values?: readonly string[];
}

/**
 * Every ARIA state and property, with what it accepts.
 *
 * ARIA is a closed vocabulary — a name outside this table is read by nothing,
 * which is what makes `aria-labeledby` worth a compile error rather than a
 * lint someone gets round to. `aria-dropeffect` and `aria-grabbed` are
 * deprecated rather than absent, and are listed so that writing one is not
 * reported as a misspelling of something else.
 */
export const ARIA_ATTRIBUTES: Record<string, AriaAttribute> = {
  'aria-activedescendant': { kind: 'idref' },
  'aria-atomic': { kind: 'token', values: ['true', 'false'] },
  'aria-autocomplete': { kind: 'token', values: ['inline', 'list', 'both', 'none'] },
  'aria-braillelabel': { kind: 'string' },
  'aria-brailleroledescription': { kind: 'string' },
  'aria-busy': { kind: 'token', values: ['true', 'false'] },
  'aria-checked': { kind: 'token', values: ['true', 'false', 'mixed', 'undefined'] },
  'aria-colcount': { kind: 'integer' },
  'aria-colindex': { kind: 'integer' },
  'aria-colindextext': { kind: 'string' },
  'aria-colspan': { kind: 'integer' },
  'aria-controls': { kind: 'idrefs' },
  'aria-current': {
    kind: 'token',
    values: ['page', 'step', 'location', 'date', 'time', 'true', 'false'],
  },
  'aria-describedby': { kind: 'idrefs' },
  'aria-description': { kind: 'string' },
  'aria-details': { kind: 'idrefs' },
  'aria-disabled': { kind: 'token', values: ['true', 'false'] },
  'aria-dropeffect': {
    kind: 'tokens',
    values: ['copy', 'execute', 'link', 'move', 'none', 'popup'],
  },
  'aria-errormessage': { kind: 'idrefs' },
  'aria-expanded': { kind: 'token', values: ['true', 'false', 'undefined'] },
  'aria-flowto': { kind: 'idrefs' },
  'aria-grabbed': { kind: 'token', values: ['true', 'false', 'undefined'] },
  'aria-haspopup': {
    kind: 'token',
    values: ['false', 'true', 'menu', 'listbox', 'tree', 'grid', 'dialog'],
  },
  'aria-hidden': { kind: 'token', values: ['true', 'false', 'undefined'] },
  'aria-invalid': { kind: 'token', values: ['grammar', 'false', 'spelling', 'true'] },
  'aria-keyshortcuts': { kind: 'string' },
  'aria-label': { kind: 'string' },
  'aria-labelledby': { kind: 'idrefs' },
  'aria-level': { kind: 'integer' },
  'aria-live': { kind: 'token', values: ['assertive', 'off', 'polite'] },
  'aria-modal': { kind: 'token', values: ['true', 'false'] },
  'aria-multiline': { kind: 'token', values: ['true', 'false'] },
  'aria-multiselectable': { kind: 'token', values: ['true', 'false'] },
  'aria-orientation': { kind: 'token', values: ['horizontal', 'vertical', 'undefined'] },
  'aria-owns': { kind: 'idrefs' },
  'aria-placeholder': { kind: 'string' },
  'aria-posinset': { kind: 'integer' },
  'aria-pressed': { kind: 'token', values: ['true', 'false', 'mixed', 'undefined'] },
  'aria-readonly': { kind: 'token', values: ['true', 'false'] },
  'aria-relevant': { kind: 'tokens', values: ['additions', 'all', 'removals', 'text'] },
  'aria-required': { kind: 'token', values: ['true', 'false'] },
  'aria-roledescription': { kind: 'string' },
  'aria-rowcount': { kind: 'integer' },
  'aria-rowindex': { kind: 'integer' },
  'aria-rowindextext': { kind: 'string' },
  'aria-rowspan': { kind: 'integer' },
  'aria-selected': { kind: 'token', values: ['true', 'false', 'undefined'] },
  'aria-setsize': { kind: 'integer' },
  'aria-sort': { kind: 'token', values: ['ascending', 'descending', 'none', 'other'] },
  'aria-valuemax': { kind: 'number' },
  'aria-valuemin': { kind: 'number' },
  'aria-valuenow': { kind: 'number' },
  'aria-valuetext': { kind: 'string' },
};

/**
 * Roles an author may write.
 *
 * The abstract roles — `widget`, `composite`, `input`, `landmark` and the
 * rest — are deliberately absent: the specification forbids using them in
 * markup, so one appearing here is the same mistake as a misspelling.
 */
export const ARIA_ROLES = new Set([
  'alert', 'alertdialog', 'application', 'article', 'banner', 'blockquote', 'button',
  'caption', 'cell', 'checkbox', 'code', 'columnheader', 'combobox', 'comment',
  'complementary', 'contentinfo', 'definition', 'deletion', 'dialog', 'directory',
  'document', 'emphasis', 'feed', 'figure', 'form', 'generic', 'grid', 'gridcell',
  'group', 'heading', 'img', 'insertion', 'link', 'list', 'listbox', 'listitem', 'log',
  'main', 'mark', 'marquee', 'math', 'menu', 'menubar', 'menuitem', 'menuitemcheckbox',
  'menuitemradio', 'meter', 'navigation', 'none', 'note', 'option', 'paragraph',
  'presentation', 'progressbar', 'radio', 'radiogroup', 'region', 'row', 'rowgroup',
  'rowheader', 'scrollbar', 'search', 'searchbox', 'separator', 'slider', 'spinbutton',
  'status', 'strong', 'subscript', 'suggestion', 'superscript', 'switch', 'tab', 'table',
  'tablist', 'tabpanel', 'term', 'textbox', 'time', 'timer', 'toolbar', 'tooltip', 'tree',
  'treegrid', 'treeitem',
]);
