/**
 * Code: the markup it is measured in, and the state changes that have to stay
 * visible when the palette is taken away.
 *
 * See `../fixtures.ts` for what belongs in a pair and what does not.
 *
 * The copy button's "Copied" has no pair. The status it comes from settles a
 * tick after the press, and the sheet draws nothing from it: the button's
 * words change instead, and words are what every palette keeps.
 */

import type { ComponentFixtures } from '../fixtures.ts';
import type { Fixture } from '../harness.ts';

/** A run of code inside a sentence, as the primitive leaves it. */
const inline = (attributes: Record<string, string> = {}): Fixture => ({
  tag: 'code',
  classes: ['volt-code'],
  attributes: { role: 'code', ...attributes },
});

/** The words of the sentence around it, which nothing styles. */
const prose: Fixture = { tag: 'span' };

/** The copy button, as the clipboard and the component leave it. */
const button = ({ focus = false, hover = false } = {}): Fixture => ({
  tag: 'button',
  classes: ['volt-code-copy'],
  attributes: {
    type: 'button',
    'aria-label': 'Copy code',
    'data-state': 'idle',
    ...(hover ? { 'data-hover': '' } : {}),
  },
  focus,
});

/** The gutter over the code, with a row per line. */
const gutter = (count: number): Fixture => ({
  tag: 'span',
  classes: ['volt-code-lines'],
  attributes: { 'aria-hidden': 'true' },
  children: Array.from({ length: count }, () => ({
    tag: 'span',
    classes: ['volt-code-line'],
    children: [{ tag: 'span', classes: ['volt-code-line-text'] }],
  })),
});

interface Shape {
  /** Wider than the box, which is when the primitive makes it a named tab stop. */
  readonly scrolls?: boolean;
  readonly focus?: boolean;
  readonly wrap?: boolean;
  readonly lines?: number;
  readonly copy?: Fixture;
}

/** A block, with what the primitive and the markup write on its `<pre>`. */
const block = ({ scrolls = false, focus = false, wrap = false, lines, copy }: Shape = {}): Fixture => ({
  tag: 'pre',
  classes: ['volt-code-block'],
  attributes: {
    'data-block': '',
    'data-language': 'TypeScript',
    ...(scrolls ? { tabindex: '0', role: 'region', 'aria-label': 'Code, TypeScript' } : {}),
    ...(wrap ? { 'data-wrap': '' } : {}),
    ...(lines === undefined ? {} : { 'data-line-numbers': '' }),
  },
  focus,
  children: [
    {
      tag: 'code',
      classes: ['volt-code-content'],
      attributes: { role: 'code', 'data-language': 'TypeScript' },
    },
    ...(lines === undefined ? [] : [gutter(lines)]),
    ...(copy ? [copy] : []),
  ],
});

export const fixtures: ComponentFixtures = {
  states: [
    // Where the code starts and the sentence resumes. `rm -rf` in a line of
    // prose is two words a reader has to know not to read as English, and the
    // tint that marks them is the first thing a forced palette takes.
    { state: 'code', off: prose, on: inline() },
    // The block a keyboard is scrolling. The arrow keys move whatever has
    // focus, so a reader who cannot see which block that is cannot know which
    // one the next press moves.
    { state: 'focus', off: block({ scrolls: true }), on: block({ scrolls: true, focus: true }) },
    // Which control the next Enter presses.
    { state: 'copy focus', off: button(), on: button({ focus: true }) },
    // What a press will land on, which was a tint and has to become an edge.
    { state: 'copy hover', off: button(), on: button({ hover: true }) },
  ],
  extra: [
    inline({ 'data-language': 'bash' }),
    block(),
    block({ wrap: true }),
    block({ lines: 3 }),
    block({ scrolls: true, lines: 2, copy: button() }),
    block({ wrap: true, lines: 4, copy: button({ hover: true }) }),
  ],
};
