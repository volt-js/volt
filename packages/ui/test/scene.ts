/**
 * What a scene is given to drive a primitive through its states.
 *
 * `primitives.test.ts` holds every rule in the sheet against markup a real
 * primitive rendered, and a scene is how a component gets there: it mounts the
 * documented markup with the primitive's props spread onto it, walks it through
 * every state its rules distinguish, and calls `look` in each. A component's
 * scene lives in `scenes/<name>.ts` beside the others, so adding a component is
 * adding a file rather than editing one everybody else is also editing.
 */
import { flushSync, mount } from '@voltdev/core';

/** Walk the component through its states, calling `look` in each. */
export type Scene = (look: () => void) => void;

/** Every component a scene mounted, taken down between passes and after each test. */
export const mounted: { unmount(): void }[] = [];

/** Mount a component where the test put its host, and let it settle. */
export function show<T>(component: new () => T): T {
  const handle = mount(component, document.querySelector('#app')!);
  mounted.push(handle);
  flushSync();
  return handle.instance as T;
}

/** Change something, and let everything it touched settle before looking. */
export function step(action: () => void): void {
  action();
  flushSync();
}

/** Take down everything mounted so far, for a scene's next pass. */
export function clear(): void {
  for (const handle of mounted.splice(0)) handle.unmount();
  flushSync();
}
