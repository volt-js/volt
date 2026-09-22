/**
 * The markup each component is measured in, and the state changes that have
 * to stay visible when the palette is taken away.
 *
 * A pair belongs here when the difference between its two sides is something
 * a user has to be able to see — checked from unchecked, selected from
 * unselected, this severity from that one. A difference that is only emphasis
 * does not: a ghost button is allowed to look like a plain one once the
 * palette is the user's, and pretending otherwise would only add a rule that
 * says nothing.
 *
 * `test/forced-colors.test.ts` requires an entry here for every component in
 * the registry, so a seventh component cannot arrive without one.
 *
 * The pointer is `data-hover`, which the harness's copy of the sheet reads in
 * place of `:hover` — happy-dom never matches the real thing.
 */

import type { Fixture } from './harness.ts';

export interface StatePair {
  readonly state: string;
  readonly off: Fixture;
  readonly on: Fixture;
}

export interface ComponentFixtures {
  readonly states: readonly StatePair[];
  /** Shapes with no pair of their own, for the sweeps that walk every part. */
  readonly extra?: readonly Fixture[];
}

/**
 * One file per component, found rather than listed: a component is two files
 * in `src/` and one here, and none of the three is a file somebody else is
 * also editing. `forced-colors.test.ts` still requires an entry for every
 * component in the registry, so one cannot arrive without its states.
 */
const FILES = import.meta.glob<{ fixtures: ComponentFixtures }>('./fixtures/*.ts', {
  eager: true,
});

export const fixtures: Readonly<Record<string, ComponentFixtures>> = Object.fromEntries(
  Object.entries(FILES).map(([path, module]) => [
    path.slice(path.lastIndexOf('/') + 1, -'.ts'.length),
    module.fixtures,
  ]),
);

/** Every fixture a component declares, in one list. */
export function allFixtures(name: string): readonly Fixture[] {
  const entry = fixtures[name];
  if (!entry) return [];
  return [...entry.states.flatMap((pair) => [pair.off, pair.on]), ...(entry.extra ?? [])];
}
