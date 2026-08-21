/**
 * Motion, when the user has asked for less of it.
 *
 * `contract.test.ts` already refuses a literal duration anywhere in the sheet,
 * and says why in a comment: the preference is honoured once, by repointing
 * two tokens at zero, and a rule that writes `150ms` directly opts itself out
 * of that silently. What nothing checked is the other half — that repointing
 * them actually stops the motion. The mechanism was enforced and the outcome
 * was not, which is the same shape as a forced-colours rule that exists and
 * does nothing.
 *
 * `prefers-reduced-motion` is a stated accessibility requirement rather than a
 * preference about taste: for some users motion causes nausea and vertigo, and
 * an animation that runs anyway is not a cosmetic defect.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { componentStyles } from '../src/index.ts';
import { allFixtures } from './fixtures.ts';
import { styledDocument } from './harness.ts';

const TIMED = ['animation-duration', 'transition-duration'];

const normal = styledDocument();
const reduced = styledDocument({ reducedMotion: true });

afterAll(async () => {
  await Promise.all([normal.close(), reduced.close()]);
});

/** Every duration the fixture tree computes to, as written. */
function durations(dom: ReturnType<typeof styledDocument>, fixture: Parameters<typeof dom.mount>[0]): string[] {
  return [...dom.snapshot(dom.mount(fixture), TIMED).values()].filter((value) => value !== '');
}

/** A duration that is off, however the engine chose to spell zero. */
function isZero(value: string): boolean {
  return value.split(',').every((part) => /^0m?s$/.test(part.trim()));
}

describe('with no preference stated', () => {
  it('animates, or there would be nothing for the preference to turn off', () => {
    const moving = componentStyles.flatMap((component) =>
      allFixtures(component.name).flatMap((fixture) => durations(normal, fixture)),
    );
    expect(moving.some((value) => !isZero(value))).toBe(true);
  });
});

describe('with the preference stated', () => {
  for (const component of componentStyles) {
    it(`${component.name} stops moving`, () => {
      for (const fixture of allFixtures(component.name)) {
        for (const value of durations(reduced, fixture)) {
          expect(isZero(value), `${component.name} still animates for ${value}`).toBe(true);
        }
      }
    });
  }

  it('turns the tokens themselves off, which is the one place it is decided', () => {
    const root = reduced.window.document.documentElement;
    const style = reduced.window.getComputedStyle(root);
    for (const token of ['--volt-duration-fast', '--volt-duration-medium']) {
      expect(isZero(style.getPropertyValue(token).trim()), token).toBe(true);
    }
  });
});
