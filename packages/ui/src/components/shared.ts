/**
 * Declarations more than one component repeats, and the reasons they repeat.
 *
 * These are spread into each component's own rules rather than emitted as a
 * shared class. The CLI hands a consumer one component at a time, and a rule
 * living in another component's file is a dependency their copy would carry
 * without being able to see it.
 */

import type { Declarations } from '../css.js';

/**
 * Only what a pointer press has no business triggering.
 *
 * `:focus-visible` rather than `:focus`, so a mouse press does not leave a
 * ring behind, and `outline` rather than a border or a shadow, because an
 * outline is the one focus indicator forced-colors mode keeps drawing.
 */
export const focusRing: Declarations = {
  'outline-width': 'var(--volt-focus-ring-width)',
  'outline-style': 'solid',
  'outline-color': 'var(--volt-focus-ring-color)',
  'outline-offset': 'var(--volt-focus-ring-offset)',
};

/** The ring's colour has to come out of the forced palette, not the brand. */
export const forcedFocusRing: Declarations = {
  'outline-color': 'Highlight',
};

export const disabledLook: Declarations = {
  opacity: 'var(--volt-disabled-opacity)',
  cursor: 'not-allowed',
};

/**
 * Forced colours has its own word for unavailable — `GrayText` — and dimming
 * on top of it only muddies a palette the user chose for contrast, so the
 * opacity is handed back.
 */
export const forcedDisabled: Declarations = {
  color: 'GrayText',
  'border-color': 'GrayText',
  opacity: '1',
};

/**
 * What a surface floating over the page needs restating in forced colours.
 *
 * Elevation is a shadow, and shadows are not painted in forced-colors mode:
 * without this the panel and the page behind it become one flat surface with
 * no edge between them. A border says the same thing in a channel the forced
 * palette keeps.
 */
export const forcedPanel: Declarations = {
  'box-shadow': 'none',
  'border-width': 'var(--volt-border-width-1)',
  'border-style': 'solid',
  'border-color': 'CanvasText',
};

/**
 * Everything that is not disabled, in either of the two ways a control can
 * be: the platform's `disabled`, and the `aria-disabled` the primitives use
 * where a control has to stay reachable by keyboard.
 */
export const ENABLED = `:not(:disabled):not([aria-disabled='true'])`;

/** Both of them, for the rule that draws the disabled look. */
export function disabledSelector(base: string): string {
  return `${base}:disabled, ${base}[aria-disabled='true']`;
}

/**
 * A transition over the named properties.
 *
 * The duration is always a token, never a literal: `prefers-reduced-motion`
 * is honoured once, by repointing `--volt-duration-*` at zero, instead of by
 * every component remembering a media query of its own.
 */
export function transition(properties: string, duration = 'fast'): Declarations {
  return {
    'transition-property': properties,
    'transition-duration': `var(--volt-duration-${duration})`,
    'transition-timing-function': 'var(--volt-easing-standard)',
  };
}

/** An entry or exit animation, on the same terms as `transition`. */
export function animation(name: string, duration = 'medium'): Declarations {
  return {
    'animation-name': name,
    'animation-duration': `var(--volt-duration-${duration})`,
    'animation-timing-function': 'var(--volt-easing-standard)',
    'animation-fill-mode': 'both',
  };
}
