/**
 * The classes a component writes, against the classes the sheet draws.
 *
 * A component's template names its classes literally — `class="volt-button"` —
 * because that is what the markup of a component is, and because a consumer
 * hand-writing the same markup writes the same words. The cost of naming them
 * twice is that they can drift: a sheet that renames a part leaves a component
 * drawing nothing, and a component that invents a class leaves a rule that
 * never runs. Neither shows up as a failure anywhere else, because both halves
 * are perfectly consistent with themselves.
 *
 * So every `volt-` class in every template has to be one the sheet declares,
 * and the check runs over the real `.html` files rather than a list.
 */
import { describe, expect, it } from 'vitest';
import { classes } from '../src/index.ts';

const TEMPLATES = import.meta.glob<string>('../src/components/*.html', {
  query: '?raw',
  import: 'default',
  eager: true,
});

/** Every class name the sheet has a part for. */
const declared = new Set(
  Object.values(classes).flatMap((component) => Object.values(component as Record<string, string>)),
);

/** Every `volt-` class written in a template's `class` attributes. */
function used(html: string): string[] {
  const names: string[] = [];
  for (const match of html.matchAll(/\sclass="([^"]*)"/g)) {
    for (const name of match[1]!.split(/\s+/)) {
      if (name.startsWith('volt-')) names.push(name);
    }
  }
  return names;
}

describe('the classes a component writes', () => {
  it('has templates to check, so an empty pass cannot be a passing one', () => {
    expect(Object.keys(TEMPLATES).length).toBeGreaterThan(3);
  });

  for (const [path, html] of Object.entries(TEMPLATES)) {
    it(`${path.slice(path.lastIndexOf('/') + 1)} names only parts the sheet declares`, () => {
      for (const name of used(html)) {
        expect(declared, `${path} writes ${name}`).toContain(name);
      }
    });
  }
});
