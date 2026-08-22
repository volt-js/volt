/**
 * @voltdev/testing
 *
 * Test a Volt component the way it is used: mount it, drive it through its
 * accessibility surface, assert, and take it away again with nothing left
 * behind.
 *
 *   import { afterEach, expect, it } from 'vitest';
 *   import { cleanup, click, render } from '@voltdev/testing';
 *
 *   afterEach(cleanup);
 *
 *   it('counts', () => {
 *     const view = render(Counter);
 *     click(view.getByRole('button', { name: 'Add one' }));
 *     expect(view.getByRole('status').textContent).toBe('1');
 *
 *     view.unmount();
 *     expect(view.leakedEffects()).toBe(0);
 *   });
 *
 * Three things shape everything here.
 *
 * **Queries go through the accessibility tree.** There is no `getByTestId`,
 * no query by class and none by tag. A component library's regressions are
 * semantic — an option that stopped exposing `role="option"`, a button whose
 * label went missing, a dialog left in the DOM after it closed — and every one
 * of them survives a query written against markup. Asking for the button named
 * "Save" fails exactly when a user could no longer find the button named
 * "Save".
 *
 * **Interactions are real event sequences.** `click()` dispatches what a
 * browser dispatches, in the order a browser dispatches it, including the
 * focus move on `mousedown` and the click a browser raises from Enter or
 * Space. Calling a handler directly proves only that the handler works.
 *
 * **The scheduler is cooperated with, never replaced.** `settle()` drains
 * pending promises and effects; `installClock()` fakes the wall clock and the
 * task timers while leaving the microtask queue — which is where Volt's flush
 * lives — completely alone.
 *
 * Not here, and deliberately: Playwright fixtures and axe assertions, both of
 * which want a real browser rather than a DOM emulation.
 */

export { cleanup, render, type RenderResult } from './render.js';

export {
  getAllByRole,
  getByRole,
  queryAllByRole,
  queryByRole,
  type RoleQueryOptions,
} from './queries.js';

export {
  getAccessibleName,
  getRole,
  isAccessibilityHidden,
  isTextField,
  normalizeText,
} from './aria.js';

export {
  blur,
  clear,
  click,
  focus,
  hover,
  press,
  typeText,
  unhover,
} from './interact.js';

export {
  dialogHarness,
  dialogIsOpen,
  disclosureHarness,
  listboxHarness,
  menuHarness,
  tabsHarness,
  type DialogHarness,
  type DisclosureHarness,
  type HarnessOptions,
  type ListboxHarness,
  type MenuHarness,
  type TabsHarness,
} from './harness.js';

export { liveEffectCount, settle } from './scheduler.js';

export { installClock, type ClockOptions, type FakeClock } from './clock.js';
