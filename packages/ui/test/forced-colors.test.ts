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
 * A palette that keeps two states apart can still lose the words on them:
 * Chrome paints a backplate of `Canvas` behind every run of text left under
 * it. So every fixture's words are read as Chrome would draw them, too, and
 * the harness that reads them is held to what Chrome was seen to do at the
 * end of this file.
 *
 * `fixtures.ts` has said since it was written that this file requires an entry
 * for every component in the registry "so a seventh component cannot arrive
 * without one". The file did not exist, so nothing did. It does now, and the
 * registry check below is the part that keeps that sentence true.
 */

import { afterAll, describe, expect, it } from 'vitest';
import { componentStyles, type ComponentStyles } from '../src/index.ts';
import { allFixtures, fixtures } from './fixtures.ts';
import {
  differences,
  REPLACED,
  standIn,
  styledDocument,
  SYSTEM_COLORS,
  unreadableOn,
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

describe('no words are lost to the backplate once the palette is the user’s', () => {
  // Chrome paints `Canvas` behind every run of text left under the palette,
  // whatever fill is behind it, and its `HighlightText` is that same colour: a
  // filled control with its words in `HighlightText` shows the fill with a box
  // in the page's colour where the words were. Taking the control out from
  // under the palette is the fix, and that is the other half asked here — that
  // what is out paints nothing but the palette's own colours.
  for (const component of componentStyles) {
    it(component.name, () => {
      const faults = new Set<string>();
      for (const fixture of allFixtures(component.name)) {
        const root = forced.mount(fixture);
        for (const fault of forced.unreadableWords(root)) faults.add(fault);
        for (const fault of forced.unforcedColours(root)) faults.add(fault);
        // Every element left in the document is one more for each later
        // computed style to cascade through.
        root.remove();
      }
      expect([...faults]).toEqual([]);
    });
  }

  /** Whether a fixture, or anything inside it, carries words. */
  const worded = (fixture: Fixture): boolean =>
    (fixture.text ?? '') !== '' || (fixture.children ?? []).some(worded);

  it('has words to read in the fixtures of every component that writes any', () => {
    // Without them the sweep above reads nothing and passes, which is how a
    // primary button whose label Chrome painted over shipped with every test
    // green. A rating draws its stars and writes nothing. The other three
    // write words their fixtures do not carry yet; each leaves this list when
    // its fixtures are given the words its template writes.
    const wordless = componentStyles
      .map((component) => component.name)
      .filter((name) => !allFixtures(name).some(worded));
    expect(wordless).toEqual(['code', 'image', 'number-input', 'rating']);
  });
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
    expect([...panels].sort()).toEqual([
      'dialog',
      'menu',
      'popover',
      'select',
      'toast',
      'tooltip',
    ]);
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

describe('the switch, once the palette is the user’s', () => {
  /** A length in pixels, whichever unit the sheet wrote it in. */
  const px = (value: string): number =>
    value.endsWith('rem') ? Number.parseFloat(value) * 16 : (Number.parseFloat(value) || 0);

  it('keeps the thumb flush at the end of a track whose ring has thickened', () => {
    // Which way a switch is set survives this mode as the distance the thumb
    // has travelled, and as a ring round the track that doubles in width —
    // and the second of those eats into the first, because the track is a
    // border box. The sheet hands back the padding to pay for it. If the two
    // ever stop cancelling, the thumb of a switch that is on overflows the
    // track it is meant to come to rest inside, and only a user with a forced
    // palette ever sees it.
    const control = forced.mount({
      classes: ['volt-switch'],
      attributes: { 'data-state': 'checked' },
      children: [{ classes: ['volt-switch-track'], children: [{ classes: ['volt-switch-thumb'] }] }],
    });
    const track = computed(control.querySelector('.volt-switch-track')!);
    const thumb = computed(control.querySelector('.volt-switch-thumb')!);

    const edges = (property: string): number =>
      ['inline-start', 'inline-end', 'left', 'right']
        .map((edge) => px(track.getPropertyValue(`${property}-${edge}${property === 'padding' ? '' : '-width'}`)))
        .reduce((total, value) => total + value, 0);

    const inner = px(track.getPropertyValue('inline-size')) - edges('border') - edges('padding');
    expect(inner).toBe(
      px(thumb.getPropertyValue('inline-size')) +
        px(thumb.getPropertyValue('margin-inline-start')),
    );
  });
});

/**
 * A sheet written the way the package's are, for holding the harness to what
 * Chrome does. Each shape the tests below mount was drawn in Chrome, with this
 * sheet, forced colours emulated and the light scheme preferred and then the
 * dark: whether each run of words left any ink in the screenshot — for words
 * nobody is shown, whether words drawn beneath them did — and the colours
 * Chrome computed, are what these tests say.
 */
const modelStyles: ComponentStyles = {
  name: 'model',
  classes: {},
  keyframes: [],
  rules: [
    {
      selector: '.model-brand',
      declarations: {
        'background-color': 'var(--volt-color-accent)',
        color: 'var(--volt-color-on-accent)',
      },
    },
    { selector: '.model-hidden', declarations: { display: 'none' } },
    { selector: '.model-unseen', declarations: { visibility: 'hidden' } },
    {
      selector: '.model-edged',
      declarations: {
        'border-block-start-style': 'solid',
        'border-block-start-width': 'var(--volt-border-width-1)',
        'border-block-start-color': 'var(--volt-color-border)',
      },
    },
    {
      selector: '.model-unedged',
      declarations: { 'border-block-start-color': 'var(--volt-color-border)' },
    },
    { selector: '.model-shadowed', declarations: { 'box-shadow': 'var(--volt-elevation-overlay)' } },
    { selector: '.model-row', declarations: { display: 'flex' } },
    { selector: '.model-inline-row', declarations: { display: 'inline-flex' } },
    { selector: '.model-atom', declarations: { display: 'inline-block' } },
  ],
  forcedColors: [
    {
      selector: '.model-selected',
      declarations: { 'background-color': 'Highlight', color: 'HighlightText' },
    },
    {
      selector: '.model-inverse',
      declarations: { 'background-color': 'CanvasText', color: 'Canvas' },
    },
    {
      selector: '.model-legible',
      declarations: { 'background-color': 'Highlight', color: 'CanvasText' },
    },
    // An unchecked box's mark: there, and meant not to show.
    { selector: '.model-blank', declarations: { 'background-color': 'Field', color: 'Field' } },
    { selector: '.model-out', declarations: { 'forced-color-adjust': 'none' } },
    // Put back under the palette, inside something that was taken out.
    { selector: '.model-back', declarations: { 'forced-color-adjust': 'auto' } },
    // A shortcut's `+`, which takes the colour of the line it sits in.
    { selector: '.model-inherit', declarations: { color: 'inherit' } },
    // Words in each system colour in turn, on no fill of their own.
    ...SYSTEM_COLORS.map((name) => ({
      selector: `.model-in-${name}`,
      declarations: { color: name },
    })),
  ],
};

describe('the palette as Chrome paints it', () => {
  const model = styledDocument({ forcedColors: true, extraSheets: [modelStyles] });
  afterAll(() => model.close());

  const unreadable = (fixture: Fixture): string[] => model.unreadableWords(model.mount(fixture));
  const unforced = (fixture: Fixture): string[] => model.unforcedColours(model.mount(fixture));
  /** Words taken out from under the palette, inside an element that is not. */
  const outInside = (outer: string): Fixture => ({
    classes: [outer],
    children: [{ classes: ['model-out'], text: 'Save' }],
  });

  it('loses words in just the system colours its palettes make the colour of the backplate', () => {
    // Chrome's backplate is `Canvas`, and in its palettes four colours are
    // `Canvas` itself in both schemes; `MarkText` is too in the dark, and
    // `SelectedItemText` in the light, where `Mark` is yellow on white.
    const lost = SYSTEM_COLORS.filter(
      (name) => unreadable({ classes: [`model-in-${name}`], text: 'Aa' }).length > 0,
    );
    expect(lost).toEqual([
      'ButtonFace',
      'Canvas',
      'Field',
      'HighlightText',
      'Mark',
      'MarkText',
      'SelectedItemText',
    ]);
    expect(unreadableOn('HighlightText')).toEqual(['light', 'dark']);
    expect(unreadableOn('MarkText')).toEqual(['dark']);
    expect(unreadableOn('Highlight')).toEqual([]);
  });

  it('hides words in the colour of the backplate it paints behind them, whatever the fill', () => {
    // On a `Highlight` fill, the words become a box in the page's colour.
    expect(unreadable({ classes: ['model-selected'], text: 'Save' })).toHaveLength(1);
    expect(unreadable({ classes: ['model-inverse'], text: '3' })).toHaveLength(1);
    // Inherited is no different: the words are where the colour lands.
    expect(
      unreadable({ classes: ['model-selected'], children: [{ tag: 'span', text: 'Save' }] }),
    ).toHaveLength(1);
    // An input's value is a run of text like any other.
    expect(unreadable({ tag: 'input', classes: ['model-selected'], text: 'Save' })).toHaveLength(1);
    // A fill with nothing written on it loses nothing.
    expect(unreadable({ classes: ['model-selected'] })).toEqual([]);
  });

  it('reads words in a colour drawn for `Canvas` on any fill', () => {
    expect(unreadable({ classes: ['model-legible'], text: 'Save' })).toEqual([]);
    // A colour of the sheet's own is the palette's to replace, and it
    // replaces it with one drawn for the backplate.
    expect(unreadable({ classes: ['model-brand'], text: 'Save' })).toEqual([]);
  });

  it('paints no backplate behind words taken out from under the palette', () => {
    expect(unreadable({ classes: ['model-selected', 'model-out'], text: 'Save' })).toEqual([]);
    expect(
      unreadable({ tag: 'input', classes: ['model-selected', 'model-out'], text: 'Save' }),
    ).toEqual([]);
    // The property is inherited, by everything inside.
    expect(
      unreadable({
        classes: ['model-out'],
        children: [{ classes: ['model-selected'], children: [{ tag: 'b', text: 'B' }] }],
      }),
    ).toEqual([]);
  });

  it('reads words out from under the palette against the fill behind them', () => {
    // No backplate there: the words sit on whatever is drawn behind them, and
    // only the pair the palette keeps for that fill is sure to stand apart.
    expect(unreadable({ classes: ['model-selected', 'model-out'], text: 'Save' })).toEqual([]);
    // `CanvasText` on `Highlight` is 1.86:1 in the light palette and 2.41:1
    // in the dark.
    expect(unreadable(outInside('model-legible'))).toHaveLength(1);
    // With no fill, the page's `Canvas` is behind them.
    expect(
      unreadable({ classes: ['model-out', 'model-in-HighlightText'], text: 'Save' }),
    ).toHaveLength(1);
    const [fault] = unreadable(outInside('model-legible'));
    expect(fault).toContain('model: `.model-legible`');
    expect(fault).toContain('CanvasText on Highlight');
  });

  it('reads only the words somebody is shown', () => {
    expect(
      unreadable({
        classes: ['model-hidden'],
        children: [{ classes: ['model-selected'], text: 'Save' }],
      }),
    ).toEqual([]);
    expect(unreadable({ classes: ['model-selected', 'model-unseen'], text: 'Save' })).toEqual([]);
    // Words in the colour of their own fill were hidden by the sheet before
    // the backplate hid them again.
    expect(unreadable({ classes: ['model-blank'], text: '✓' })).toEqual([]);
  });

  it('lets the box that lays a line out decide whether the line has a backplate', () => {
    // The backplate is painted for a line, by the box that lays the line out:
    // words in an inline element taken out from under the palette are on it
    // all the same when the block round them is not.
    const inline = (classes: string[]): Fixture => ({ tag: 'span', classes, text: 'Save' });
    expect(
      unreadable({ classes: ['model-selected'], children: [inline(['model-out'])] }),
    ).toHaveLength(1);
    // Put back under it, inside a block that is out, they get none.
    expect(
      unreadable({ classes: ['model-selected', 'model-out'], children: [inline(['model-back'])] }),
    ).toEqual([]);
    // A flex item lays out lines of its own, whatever the row round it says.
    expect(
      unreadable({ classes: ['model-selected', 'model-row'], children: [inline(['model-out'])] }),
    ).toEqual([]);
    expect(
      unreadable({
        tag: 'span',
        classes: ['model-selected', 'model-out', 'model-inline-row'],
        children: [inline(['model-back'])],
      }),
    ).toHaveLength(1);
  });

  it('shows the backplate of the line an inline box sits in through it, unless it is filled', () => {
    // An inline-block lays out lines of its own and sits in a line of its
    // parent's as well, whose backplate runs from the first words in it to
    // the last. Between words, the box is behind it: out from under the
    // palette and filled, it covers the backplate; unfilled, its words are
    // on it.
    const atom = (classes: string[]): Fixture => ({
      tag: 'span',
      classes: ['model-atom', 'model-out', ...classes],
      text: 'Save',
    });
    const press: Fixture = { tag: 'span', text: 'Press' };
    const now: Fixture = { tag: 'span', text: 'now' };
    const unfilled = atom(['model-in-HighlightText']);
    expect(unreadable({ classes: ['model-legible'], children: [press, unfilled, now] })).toHaveLength(1);
    expect(unreadable({ children: [press, atom(['model-selected']), now] })).toEqual([]);
    // At the end of the line, or alone in it, the backplate stops short of it.
    expect(unreadable({ classes: ['model-legible'], children: [press, unfilled] })).toEqual([]);
    expect(unreadable({ classes: ['model-legible'], children: [unfilled] })).toEqual([]);
  });

  it('paints a backplate for a line whose words nobody is shown, over what is beneath it', () => {
    // Words hidden with `visibility` still make the line they are laid out
    // on, and Chrome still paints that line's backplate: a box of `Canvas`
    // over whatever shares the room, as code does beneath a gutter whose
    // rows hold its lines unseen so that each number lands beside its line.
    const unseen: Fixture = { tag: 'span', classes: ['model-unseen'], text: 'let a = 1;' };
    expect(unreadable({ children: [unseen] })).toHaveLength(1);
    expect(unreadable({ tag: 'ol', children: [{ tag: 'li', children: [unseen] }] })).toHaveLength(1);
    // The line is the block's, so taking the words alone out changes nothing.
    expect(
      unreadable({ children: [{ ...unseen, classes: ['model-unseen', 'model-out'] }] }),
    ).toHaveLength(1);
    // Taking the block out does, and so does hiding the block itself.
    expect(unreadable({ classes: ['model-out'], children: [unseen] })).toEqual([]);
    expect(
      unreadable({
        tag: 'ol',
        classes: ['model-out'],
        children: [{ tag: 'li', children: [unseen] }],
      }),
    ).toEqual([]);
    expect(
      unreadable({ classes: ['model-unseen'], children: [{ tag: 'span', text: 'let a = 1;' }] }),
    ).toEqual([]);
    const [fault] = unreadable({ children: [unseen] });
    expect(fault).toContain('model: `.model-unseen`');
    expect(fault).toContain('“let a = 1;”');
    expect(fault).toContain('forced-color-adjust: none');
  });

  it('reads words in `inherit` in the colour they inherit', () => {
    // happy-dom computes the keyword as the value, and hands the keyword down;
    // Chrome computes the parent's colour, so these are `HighlightText`.
    const plus: Fixture = { classes: ['model-inherit'], text: '+' };
    expect(unreadable({ classes: ['model-selected'], children: [plus] })).toHaveLength(1);
    expect(
      unreadable({
        classes: ['model-selected'],
        children: [{ classes: ['model-inherit'], children: [{ tag: 'span', text: '+' }] }],
      }),
    ).toHaveLength(1);
    // Out from under the palette, the pair is whole, and the palette's own.
    expect(unreadable({ classes: ['model-selected', 'model-out'], children: [plus] })).toEqual([]);
    expect(unforced({ classes: ['model-selected', 'model-out'], children: [plus] })).toEqual([]);
  });

  it('names the sheet, the rule and the fix', () => {
    const [fault] = unreadable({
      classes: ['model-selected'],
      children: [{ tag: 'span', text: 'Save' }],
    });
    expect(fault).toContain('model: `.model-selected`');
    expect(fault).toContain('“Save”');
    expect(fault).toContain('HighlightText');
    expect(fault).toContain('forced-color-adjust: none');
  });

  it('keeps the colours of an element out from under the palette', () => {
    const snapshot = (fixture: Fixture): Map<string, string> =>
      model.snapshot(model.mount(fixture), ['color', 'background-color']);
    expect([...snapshot({ classes: ['model-brand'] }).values()]).toEqual([REPLACED, REPLACED]);
    // Chrome draws these as the sheet wrote them, not as the reader's palette.
    for (const value of snapshot({ classes: ['model-brand', 'model-out'] }).values()) {
      expect(value).not.toBe(REPLACED);
    }
    const inside = snapshot({ classes: ['model-out'], children: [{ classes: ['model-brand'] }] });
    for (const value of inside.values()) expect(value).not.toBe(REPLACED);
  });

  it('holds an element out from under the palette, and all inside it, to the palette’s colours', () => {
    expect(unforced({ classes: ['model-selected', 'model-out'], text: 'Save' })).toEqual([]);
    expect(unforced({ classes: ['model-brand', 'model-out'], text: 'Save' })).toHaveLength(2);
    expect(
      unforced({ classes: ['model-selected', 'model-out'], children: [{ classes: ['model-edged'] }] }),
    ).toHaveLength(1);
    // An edge with no style is not drawn, so its colour is not painted.
    expect(
      unforced({ classes: ['model-selected', 'model-out'], children: [{ classes: ['model-unedged'] }] }),
    ).toEqual([]);
    // The palette takes every shadow away, except from what has left it.
    expect(unforced({ classes: ['model-selected', 'model-out', 'model-shadowed'] })).toHaveLength(1);
    // Under the palette, a colour of the sheet's own is the palette's problem.
    expect(unforced({ classes: ['model-brand'], text: 'Save' })).toEqual([]);
  });

  it('holds words out from under the palette to the colour they inherit from outside', () => {
    // An element under the palette hands down the colour the sheet gave it,
    // not the one the palette drew it in: a system colour stays one, and the
    // brand's comes through as the brand's.
    expect(unforced(outInside('model-legible'))).toEqual([]);
    expect(unforced(outInside('model-brand'))).toHaveLength(1);
    // Words in no colour of anybody's get the page's initial one: in Chrome's
    // dark palette, black words on a black page.
    expect(unforced({ classes: ['model-out'], text: 'Save' })).toHaveLength(1);
  });

  it('names the rule that took it out, and the fix', () => {
    const [fault] = unforced({ classes: ['model-brand', 'model-out'] });
    expect(fault).toContain('model: `.model-out`');
    expect(fault).toContain('background-color');
    expect(fault).toContain('system colour');
  });

  it('asks only a document with the palette on', () => {
    const element = plain.mount({ classes: ['volt-button'], text: 'Save' });
    expect(() => plain.unreadableWords(element)).toThrow(/palette/);
    expect(() => plain.unforcedColours(element)).toThrow(/palette/);
  });
});
