# @voltdev/testing

Test a Volt component the way it is used: mount it, find things by role and
name, drive them with real event sequences, and take it away again with
nothing left behind.

```bash
pnpm add -D @voltdev/testing@alpha
```

> **Not on npm yet.** The command above is what installs it once it is released.
> Until then it works from a checkout of the [Volt repository](https://github.com/volt-js/volt) —
> see [what is on npm](https://voltjs.dev/guide/getting-started#what-is-on-npm).

```ts
import { afterEach, expect, it } from 'vitest';
import { cleanup, click, render } from '@voltdev/testing';

afterEach(cleanup);

it('counts', () => {
  const view = render(Counter);

  click(view.getByRole('button', { name: 'Add one' }));
  expect(view.getByRole('status').textContent).toBe('1');

  view.unmount();
  expect(view.leakedEffects()).toBe(0);
});
```

## Queries go through the accessibility tree

There is no `getByTestId`, no query by class and none by tag. A component
library's regressions are semantic — an option that stopped exposing
`role="option"`, a button whose label went missing, a dialog left in the DOM
after it closed — and every one of them survives a query written against
markup. Asking for the button named "Save" fails exactly when a user could no
longer find the button named "Save".

`view.container` is there for the cases that genuinely are about markup.

## Interactions are real event sequences

`click()` dispatches `pointerdown`, `mousedown`, the focus move, `pointerup`,
`mouseup` and `click`, flushing the scheduler between each. `press()` raises
the click a browser raises from Enter and Space — and at the point the browser
raises it, which is the difference between catching a double-toggle and not.

Two rules follow the platform rather than convenience: an `aria-disabled`
control receives every event, because it is the widget's job to ignore them
and a helper that refused to dispatch would make every "a disabled item does
nothing" test vacuous; a control with the `disabled` attribute receives none,
because a browser delivers none.

## Nothing leaked

`leakedEffects()` asks the scheduler what it is still watching, so an effect
that outlived its component is a failed assertion rather than something
noticed in production. `installClock().pending()` does the same for timers.

## Fake timers cooperate with the scheduler

```ts
const clock = installClock();
typeText(view.getByRole('textbox', { name: 'Search' }), 'cat');
await clock.advance(200);        // debounce elapsed, effects flushed, DOM settled
clock.uninstall();
```

The clock fakes `setTimeout`, `setInterval`, `requestAnimationFrame`,
`Date.now` and `performance.now`, and never `queueMicrotask` or `Promise`.
Volt coalesces every update onto a microtask, so a fake-timer implementation
that replaces the microtask queue takes the scheduler's flush with it —
`await tick()` stops resolving and nothing renders, with no error anywhere.

Playwright fixtures and axe assertions are not here yet; both want a real
browser rather than a DOM emulation.

> **Pre-alpha.** Published under the `alpha` tag; the API is still moving.

Documentation: [voltjs.dev](https://voltjs.dev)
