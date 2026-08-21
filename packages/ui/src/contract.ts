/**
 * Custom properties a primitive writes and a rule here may read.
 *
 * Not tokens, and deliberately not in `tokens.ts`: a token is a value this
 * package decides and a theme may repoint, while these are values a primitive
 * measures at runtime and sets on an element. `--volt-collapsible-height` is
 * whatever that panel's content happens to be tall, which is not a design
 * decision anybody could make in advance.
 *
 * They are named here for the same reason the class names and `data-` states
 * are restated in each component file: this package does not import
 * `@voltdev/primitives`, it restates the contract between them. A rule
 * reading a property that no primitive writes resolves to nothing and fails
 * silently, so the check that a `var()` names something real has to know about
 * these as well as about tokens — and this is the list that tells it, rather
 * than an exception that would let any name through.
 *
 * Adding one is a coupling to a specific primitive's behaviour. Say which.
 */
export const contractProperties: ReadonlySet<string> = new Set([
  /**
   * The measured height of a collapsible's content, in pixels with a unit.
   * Written by `createDisclosure` and `createAccordion` in
   * `@voltdev/primitives`, which measure `scrollHeight` in the measure lane
   * and publish it as `COLLAPSIBLE_HEIGHT_PROPERTY`. There is no height to
   * animate to without it: `auto` does not interpolate.
   */
  '--volt-collapsible-height',
]);
