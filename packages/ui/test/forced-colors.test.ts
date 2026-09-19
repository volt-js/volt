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
import { allFixtures, fixtures } from './fixtures.ts';
import {
  differences,
  REPLACED,
  standIn,
  styledDocument,
  type Fixture,
  type StyledDocument,
} from './harness.ts';

/**
 * The channels a difference can live in. Colour is included deliberately: a
 * forced palette does not flatten every colour to one, and `Highlight` against
 * `ButtonFace` is a perfectly good distinction — it is *silent* reliance on a
 * colour that has no forced counterpart that this is looking for.
 *
 * Every edge is measured in both spellings. A browser treats
 * `border-inline-start-style` and `border-left-style` as one property in a
 * left-to-right page; happy-dom keeps them apart, and `border-style` and
 * `border-width` write only the physical four there.
 */
const PROPERTIES = [
  'color',
  'background-color',
  'border-block-start-color',
  'border-block-end-color',
  'border-inline-start-color',
  'border-inline-end-color',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'border-block-start-width',
  'border-block-end-width',
  'border-inline-start-width',
  'border-inline-end-width',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'border-block-start-style',
  'border-block-end-style',
  'border-inline-start-style',
  'border-inline-end-style',
  'border-top-style',
  'border-right-style',
  'border-bottom-style',
  'border-left-style',
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

// The pairs above cannot see what follows: `differences` skips a colour the
// palette replaces, and both of these are about which colour that will be.

/** Each edge as happy-dom keeps it, which is apart from its other spelling. */
const EDGES = [
  'block-start',
  'block-end',
  'inline-start',
  'inline-end',
  'top',
  'right',
  'bottom',
  'left',
];

/** An edge with no width set is `medium`, as it is in a browser. */
function drawn(style: CSSStyleDeclaration, line: string): boolean {
  const kind = style.getPropertyValue(`${line}-style`);
  const width = Number.parseFloat(style.getPropertyValue(`${line}-width`));
  return !['', 'none', 'hidden'].includes(kind) && width !== 0;
}

/** Computed in whichever of the two documents the element was mounted into. */
function computed(element: Element): CSSStyleDeclaration {
  return element.ownerDocument.defaultView!.getComputedStyle(element);
}

function elementsOf(dom: StyledDocument, fixture: Fixture): Element[] {
  const root = dom.mount(fixture);
  return [root, ...root.querySelectorAll('*')];
}

describe('nothing hidden with `transparent` shows once the palette is the user’s', () => {
  // A forced palette paints a transparent edge, outline or text like any other
  // colour: the edge an inactive tab keeps clear in the ordinary palette comes
  // back as a line nobody drew. So what is meant not to show there is either
  // taken away by its style, as that edge is, or given the system colour it
  // sits on, as an unchecked box's mark is.
  for (const name of Object.keys(fixtures)) {
    it(name, () => {
      const shown: string[] = [];
      for (const fixture of allFixtures(name)) {
        for (const element of elementsOf(forced, fixture)) {
          const style = computed(element);
          const lines = [...EDGES.map((edge) => `border-${edge}`), 'outline'].filter((line) =>
            drawn(style, line),
          );
          const colours = ['color', ...lines.map((line) => `${line}-color`)];
          for (const property of colours) {
            if (style.getPropertyValue(property) !== 'transparent') continue;
            shown.push(`${element.className} ${property}`);
          }
        }
      }
      expect(shown).toEqual([]);
    });
  }
});

describe('a floating panel keeps an edge once the palette is the user’s', () => {
  it('draws one round every element that casts a shadow, in a colour apart from its fill', () => {
    const panels = new Set<string>();
    const unedged: string[] = [];

    for (const component of componentStyles) {
      for (const fixture of allFixtures(component.name)) {
        const before = elementsOf(plain, fixture);
        const after = elementsOf(forced, fixture);
        for (const [index, element] of before.entries()) {
          const shadow = computed(element).getPropertyValue('box-shadow');
          if (shadow === '' || shadow === 'none') continue;
          panels.add(component.name);

          // The palette paints no shadow, and the border is what is left to
          // tell the panel from the page. Its colour has to be one the sheet
          // named, or the palette picks it, and not the fill's own, or there
          // is nothing to see.
          const panel = after[index] as Element;
          const values = forced.snapshot(panel, [
            ...EDGES.map((edge) => `border-${edge}-color`),
            'background-color',
          ]);
          const style = computed(panel);
          const fill = values.get('0:background-color');
          for (const [physical, logical] of [
            ['top', 'block-start'],
            ['bottom', 'block-end'],
            ['left', 'inline-start'],
            ['right', 'inline-end'],
          ] as const) {
            const edged = [physical, logical].some((edge) => {
              const colour = values.get(`0:border-${edge}-color`);
              return drawn(style, `border-${edge}`) && colour !== REPLACED && colour !== fill;
            });
            if (!edged) unedged.push(`${element.className} ${physical}`);
          }
        }
      }
    }

    // Every panel the sheet floats, so that a document that stopped computing
    // shadows cannot pass this by finding none.
    expect([...panels].sort()).toEqual(['dialog', 'menu', 'popover', 'toast', 'tooltip']);
    expect(unedged).toEqual([]);
  });
});

describe('the selected tab, once the palette is the user’s', () => {
  it('keeps its edge beside the panels, in `Highlight`, in either orientation', () => {
    for (const [orientation, edge] of [
      ['horizontal', 'block-end'],
      ['vertical', 'inline-end'],
    ] as const) {
      const tab = forced.mount({
        tag: 'button',
        classes: ['volt-tabs-tab'],
        attributes: { 'data-state': 'active', 'data-orientation': orientation },
      });
      const style = computed(tab);
      expect(drawn(style, `border-${edge}`), orientation).toBe(true);
      const colour = style.getPropertyValue(`border-${edge}-color`);
      expect(colour, orientation).toBe(standIn('Highlight'));
    }
  });
});
