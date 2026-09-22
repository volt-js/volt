/**
 * The rules the whole sheet has to obey, checked by walking it.
 *
 * These are the promises that are properties of every rule rather than of any
 * one of them, and the reason the styles are data: a colour written as a
 * literal, a class no rule selects on, or a component that forgot forced
 * colours is a grep away from being missed and one loop away from being
 * caught.
 */

import { describe, expect, it } from 'vitest';
import {
  componentStyles,
  contractProperties,
  tokenNames,
  type ComponentStyles,
  type Rule,
} from '../src/index.ts';
import { SYSTEM_COLORS } from './harness.ts';

/** Properties whose value is a colour, and so has to come from somewhere. */
const COLOR_PROPERTIES = new Set([
  'color',
  'background-color',
  'border-color',
  'border-block-start-color',
  'border-block-end-color',
  'border-inline-start-color',
  'border-inline-end-color',
  'outline-color',
  'text-decoration-color',
  'caret-color',
  'fill',
  'stroke',
]);

const SYSTEM_COLOR_NAMES = new Set(SYSTEM_COLORS);

/**
 * Shorthands that reset properties they do not name. A consumer overriding
 * `background-image` should not find that a `background` here already threw
 * it away, and the sheet should not be able to do that to itself either.
 */
const BANNED_SHORTHANDS = new Set([
  'all',
  'animation',
  'background',
  'border',
  'border-block',
  'border-block-end',
  'border-block-start',
  'border-bottom',
  'border-image',
  'border-inline',
  'border-inline-end',
  'border-inline-start',
  'border-left',
  'border-right',
  'border-top',
  'columns',
  'flex',
  'flex-flow',
  'font',
  'gap',
  'grid',
  'grid-area',
  'grid-column',
  'grid-row',
  'grid-template',
  'inset',
  'inset-block',
  'inset-inline',
  'list-style',
  'margin',
  'margin-block',
  'margin-inline',
  'mask',
  'offset',
  'outline',
  'overflow',
  'padding',
  'padding-block',
  'padding-inline',
  'place-content',
  'place-items',
  'place-self',
  'text-decoration',
  'transition',
]);

const NON_COLOR_KEYWORDS = new Set(['transparent', 'currentColor', 'none', 'inherit']);

function classesIn(selector: string): string[] {
  return [...selector.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((match) => match[1] as string);
}

function tokensIn(value: string): string[] {
  return [...value.matchAll(/var\((--[\w-]+)/g)].map((match) => match[1] as string);
}

function allRules(component: ComponentStyles): Rule[] {
  return [...component.rules, ...component.forcedColors];
}

function each(callback: (component: ComponentStyles) => void): void {
  for (const component of componentStyles) callback(component);
}

describe('every component', () => {
  it('selects only on classes it declares', () => {
    each((component) => {
      const declared = new Set(Object.values(component.classes));
      for (const rule of allRules(component)) {
        for (const used of classesIn(rule.selector)) {
          expect(declared, `${component.name}: ${rule.selector}`).toContain(used);
        }
      }
    });
  });

  it('has a rule for every class it declares', () => {
    each((component) => {
      const selected = new Set(allRules(component).flatMap((rule) => classesIn(rule.selector)));
      for (const [part, className] of Object.entries(component.classes)) {
        expect(selected, `${component.name}.${part}`).toContain(className);
      }
    });
  });

  it('selects with classes, attributes and pseudo-classes only', () => {
    each((component) => {
      for (const rule of allRules(component)) {
        expect(rule.selector, component.name).not.toContain('#');
        // A pseudo-element is a part the generated markup cannot restructure,
        // and the consumer owning their markup is the whole distribution
        // model.
        expect(rule.selector, component.name).not.toContain('::');

        for (const list of rule.selector.split(',')) {
          for (const compound of list.trim().split(/\s+|>|\+|~/).filter(Boolean)) {
            expect(compound.startsWith('.'), `${component.name}: ${compound}`).toBe(true);
          }
        }
      }
    });
  });

  it('writes longhands, never a shorthand that resets what it does not name', () => {
    each((component) => {
      for (const rule of allRules(component)) {
        for (const property of Object.keys(rule.declarations)) {
          expect(BANNED_SHORTHANDS, `${component.name}: ${rule.selector}`).not.toContain(property);
        }
      }
    });
  });

  it('never reaches for !important', () => {
    each((component) => {
      for (const rule of allRules(component)) {
        for (const value of Object.values(rule.declarations)) {
          expect(value, `${component.name}: ${rule.selector}`).not.toContain('!important');
        }
      }
    });
  });

  it('takes every colour from the semantic layer', () => {
    each((component) => {
      for (const rule of component.rules) {
        for (const [property, value] of Object.entries(rule.declarations)) {
          if (!COLOR_PROPERTIES.has(property)) continue;
          if (NON_COLOR_KEYWORDS.has(value)) continue;

          expect(value, `${component.name}: ${rule.selector} { ${property} }`).toMatch(
            /^var\(--volt-(color|focus-ring-color)[\w-]*\)$/,
          );
        }
      }
    });
  });

  it('takes every shadow from an elevation role', () => {
    each((component) => {
      for (const rule of component.rules) {
        const value = rule.declarations['box-shadow'];
        if (value === undefined || value === 'none') continue;
        // A shadow read straight from the primitive ramp is one that stays
        // where it was when a theme repoints the role.
        expect(value, `${component.name}: ${rule.selector}`).toMatch(
          /^var\(--volt-elevation-[\w-]+\)$/,
        );
      }
    });
  });

  it('takes every forced-colours colour from the forced palette', () => {
    each((component) => {
      for (const rule of component.forcedColors) {
        for (const [property, value] of Object.entries(rule.declarations)) {
          if (!COLOR_PROPERTIES.has(property)) continue;
          if (NON_COLOR_KEYWORDS.has(value)) continue;

          expect(
            SYSTEM_COLOR_NAMES,
            `${component.name}: ${rule.selector} { ${property} }`,
          ).toContain(value);
        }
      }
    });
  });

  it('names only tokens the sheet defines', () => {
    each((component) => {
      const values = [
        ...allRules(component).flatMap((rule) => Object.values(rule.declarations)),
        ...component.keyframes.flatMap((frames) =>
          frames.steps.flatMap((step) => Object.values(step.declarations)),
        ),
      ];

      for (const value of values) {
        for (const token of tokensIn(value)) {
          // Either something this package defines, or something a primitive
          // writes and `contract.ts` names as such. A `var()` naming neither
          // resolves to nothing and fails without saying so.
          const known = tokenNames.has(token) || contractProperties.has(token);
          expect(known, `${component.name}: ${value} names ${token}`).toBe(true);
        }
      }
    });
  });

  it('times every animation and transition with a duration token', () => {
    each((component) => {
      for (const rule of allRules(component)) {
        for (const property of ['transition-duration', 'animation-duration']) {
          const value = rule.declarations[property];
          if (value === undefined) continue;
          // Literal durations are how a component ends up ignoring
          // `prefers-reduced-motion`: the preference is honoured once, by
          // repointing these two tokens at zero.
          expect(value, `${component.name}: ${rule.selector}`).toMatch(
            /^var\(--volt-duration-(fast|medium)\)$/,
          );
        }
      }
    });
  });

  it('animates only with keyframes of its own', () => {
    each((component) => {
      const declared = new Set(component.keyframes.map((frames) => frames.name));
      for (const rule of allRules(component)) {
        const name = rule.declarations['animation-name'];
        if (name === undefined) continue;
        // The generator copies one component at a time, so a name defined in
        // a file the consumer did not take resolves to nothing.
        expect(declared, `${component.name}: ${rule.selector}`).toContain(name);
      }
    });
  });

  it('ends an entry animation, and starts an exit, where the rule has the element', () => {
    each((component) => {
      const keyframes = new Map(component.keyframes.map((frames) => [frames.name, frames]));
      for (const rule of component.rules) {
        const name = rule.declarations['animation-name'];
        const state = /\[data-state='(open|closed)'\]$/.exec(rule.selector);
        if (name === undefined || !state) continue;

        const resting = component.rules.find(
          (other) => other.selector === rule.selector.slice(0, state.index),
        );
        const step = keyframes
          .get(name)
          ?.steps.find((each) => each.offset === (state[1] === 'open' ? 'to' : 'from'));

        // An animation's value beats a rule's, and these fill forwards, so a
        // property that ends anywhere but where the rule has it stays there: a
        // dialog centred with `translate` and animated to `translate: 0 0`
        // comes to rest with its corner where its middle should be.
        for (const [property, value] of Object.entries(step?.declarations ?? {})) {
          const rest = resting?.declarations[property];
          if (rest === undefined) continue;
          expect(value, `${component.name}: ${name} { ${property} }`).toBe(rest);
        }
      }
    });
  });

  it('never holds an open element at a size a primitive measured once', () => {
    each((component) => {
      const keyframes = new Map(component.keyframes.map((frames) => [frames.name, frames]));
      for (const rule of component.rules) {
        const name = rule.declarations['animation-name'];
        if (name === undefined || !rule.selector.endsWith("[data-state='open']")) continue;

        const end = keyframes.get(name)?.steps.find((each) => each.offset === 'to');
        const measured = Object.values(end?.declarations ?? {})
          .flatMap(tokensIn)
          .some((token) => contractProperties.has(token));
        if (!measured) continue;

        // Filling forwards would keep the measurement for as long as the
        // element is open, and clip whatever grows inside it afterwards.
        expect(rule.declarations['animation-fill-mode'], `${component.name}: ${name}`).toBe(
          'backwards',
        );
      }
    });
  });

  it('states what forced colours has to be told', () => {
    each((component) => {
      expect(component.forcedColors.length, component.name).toBeGreaterThan(0);
    });
  });
});

describe('the registry', () => {
  it('names each component once, and every keyframe once across all of them', () => {
    const names = componentStyles.map((component) => component.name);
    expect(new Set(names).size).toBe(names.length);

    const keyframes = componentStyles.flatMap((component) =>
      component.keyframes.map((frames) => frames.name),
    );
    expect(new Set(keyframes).size).toBe(keyframes.length);
    for (const name of keyframes) expect(name.startsWith('volt-')).toBe(true);
  });

  it('holds the fourteen components styled so far', () => {
    expect(componentStyles.map((component) => component.name)).toEqual([
      'accordion',
      'button',
      'checkbox',
      'dialog',
      'field',
      'menu',
      'popover',
      'radio-group',
      'select',
      'switch',
      'table',
      'tabs',
      'toast',
      'tooltip',
    ]);
  });
});
