/**
 * What survives the palette being taken away.
 *
 * `forced-colors: active` replaces every colour a sheet chose with one from
 * the user's, and it does so without telling the sheet which of its colours
 * were carrying meaning. A checked box drawn only in accent blue and an
 * unchecked one drawn only in grey become the same box. So every state pair in
 * `fixtures.ts` is mounted twice here — once with the ordinary palette and
 * once with a forced one — and the pair has to still compute differently in
 * both. A rule that restates the difference in a channel the forced palette
 * keeps (a border, an outline, a weight, a system colour with its own name) is
 * what makes that true, and this is the check that it was written.
 *
 * `fixtures.ts` has said since it was written that this file requires an entry
 * for every component in the registry "so a seventh component cannot arrive
 * without one". The file did not exist, so nothing did. It does now, and the
 * registry check below is the part that keeps that sentence true.
 */

import { afterAll, describe, expect, it } from 'vitest';
import { componentStyles } from '../src/index.ts';
import { fixtures } from './fixtures.ts';
import { differences, styledDocument, type StyledDocument } from './harness.ts';

/**
 * The channels a difference can live in. Colour is included deliberately: a
 * forced palette does not flatten every colour to one, and `Highlight` against
 * `ButtonFace` is a perfectly good distinction — it is *silent* reliance on a
 * colour that has no forced counterpart that this is looking for.
 */
const PROPERTIES = [
  'color',
  'background-color',
  'border-block-start-color',
  'border-block-end-color',
  'border-inline-start-color',
  'border-inline-end-color',
  'border-block-start-width',
  'border-block-end-width',
  'border-inline-start-width',
  'border-inline-end-width',
  'border-block-start-style',
  'border-block-end-style',
  'outline-color',
  'outline-width',
  'outline-style',
  'text-decoration-line',
  'font-weight',
  'opacity',
  'visibility',
  'display',
  // Presence is an animation, not a static state: `createPresence` keeps the
  // node mounted while the exit keyframes run, so open and closed differ by
  // which animation is on them rather than by anything already applied.
  'animation-name',
  'animation-duration',
];

const plain = styledDocument();
const forced = styledDocument({ forcedColors: true });

afterAll(async () => {
  await Promise.all([plain.close(), forced.close()]);
});

/** Whether the two sides of a pair compute to anything different at all. */
function pairDiffers(dom: StyledDocument, pair: { off: unknown; on: unknown }): Map<string, unknown> {
  const off = dom.snapshot(dom.mount(pair.off as never), PROPERTIES);
  const on = dom.snapshot(dom.mount(pair.on as never), PROPERTIES);
  return differences(off, on);
}

describe('the registry and the fixtures agree', () => {
  it('has fixtures for every component that ships', () => {
    const styled = componentStyles.map((component) => component.name).sort();
    expect(Object.keys(fixtures).sort()).toEqual(styled);
  });

  it('gives every component at least one state that has to stay visible', () => {
    for (const [name, entry] of Object.entries(fixtures)) {
      expect(entry.states.length, `${name} declares no state pairs`).toBeGreaterThan(0);
    }
  });
});

describe('every state stays visible when the palette is the user’s', () => {
  for (const [name, entry] of Object.entries(fixtures)) {
    for (const pair of entry.states) {
      // Both halves, because a pair that is identical under the ordinary
      // palette would pass the forced check for the wrong reason — there would
      // be no state there to lose.
      it(`${name}: ${pair.state} differs before the palette is forced`, () => {
        expect([...pairDiffers(plain, pair).keys()]).not.toHaveLength(0);
      });

      it(`${name}: ${pair.state} still differs once it is`, () => {
        const changed = pairDiffers(forced, pair);
        expect(
          [...changed.keys()],
          `${name}/${pair.state} is drawn only in colours the forced palette flattens`,
        ).not.toHaveLength(0);
      });
    }
  }
});
