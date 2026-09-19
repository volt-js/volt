/**
 * A subtree the framework does not own.
 *
 * A canvas, a map, a video player, a text editor surface: each draws its own
 * DOM and is ruined by anything else touching it. Every framework handles this
 * badly, and the workarounds are always its own escape hatches — memoise this,
 * do not re-render that, hold a ref and hope.
 *
 * Volt starts from a better position, because there is no re-render to
 * suppress: nothing was ever going to rebuild the subtree. What was missing is
 * the *declaration* — a boundary that says the region is the author's, and a
 * lifetime the author does not have to remember to end.
 *
 *   class Viewer {
 *     host = new Signal.State<Element | null>(null);
 *     page = new Signal.State(1);
 *
 *     island = createIsland({
 *       host: () => this.host.get(),
 *       setup: (el) => new Scene(el),
 *     });
 *
 *     constructor() {
 *       // One signal, one operation. Not a redraw.
 *       this.island.sync(
 *         () => this.page.get(),
 *         (page, scene) => scene.goTo(page),
 *       );
 *     }
 *   }
 *
 *   <div :ref="host" :spread="island.hostProps()"></div>
 *
 * **The synchronisation is the point.** `sync` is one effect per declared
 * relationship, so a signal changing runs one applier and touches one object
 * in the scene. The dependency graph already knows which signal changed; all
 * the island adds is what to do about it. A document viewer with a thousand
 * annotations selects one by writing one property, which is the case this
 * exists for and the case a redraw-on-change design cannot serve.
 *
 * **It never draws on a server.** `setup` runs from a user effect, and a
 * server build's flush stops after the data lane — so the host element is
 * emitted with nothing inside it, which is exactly right: the island's content
 * does not exist until a client draws it. That is not a check written here; it
 * is the scheduler's shape, and it cannot be got wrong by forgetting.
 *
 * **Teardown is the scope's.** Whatever `setup` returns as a disposer, and
 * whatever it registers with `onCleanup`, runs when the component goes — so
 * "the island leaked because nobody called `destroy()`" is not reachable.
 */

import { Signal, effect, onCleanup } from '@voltdev/core';

/** Marks the element an island owns, for tooling and for the eye. */
export const ISLAND_ATTRIBUTE = 'data-volt-island';

export type IslandTeardown = () => void;

export interface IslandOptions<T> {
  /** The element the island owns. Everything inside it is the author's. */
  host: () => Element | null | undefined;
  /**
   * Draw it. Called once, on the client, with the host element — and again
   * only if `host` changes to another element. Signals it reads are not
   * tracked; `sync` is how a change reaches the island.
   *
   * Return the object the island is *about* — the scene, the player, the
   * editor — and `sync` will hand it to every applier. Return a function
   * instead and it is treated as the teardown; return nothing and `onCleanup`
   * is the way to register one.
   */
  setup: (host: Element) => T | IslandTeardown | void;
  /**
   * Called if `setup` throws, so a failed island is a reported failure rather
   * than an empty box. Without one the error is left to the error channel.
   */
  onError?: (error: unknown) => void;
}

export interface IslandProps {
  readonly [key: string]: string | undefined;
}

export interface Island<T> {
  /**
   * What `setup` returned, or null before it has run, on a server, and when it
   * returned a teardown or nothing — in which case `sync` has nothing to apply
   * to.
   */
  instance(): T | null;
  /** Whether the island has been drawn. False on a server, always. */
  isReady(): boolean;
  /**
   * Route one signal to one operation inside the island.
   *
   * `read` is tracked; `apply` is not, so an applier may read and write the
   * island's own state without making itself a dependency. Applied once when
   * the island becomes ready, and on every change after that.
   */
  sync<V>(read: () => V, apply: (value: V, instance: T) => void): void;
  hostProps(): IslandProps;
}

export function createIsland<T>(options: IslandOptions<T>): Island<T> {
  /**
   * What the island drew, or null while it has drawn nothing.
   *
   * Boxed, because being drawn and having an object to show for it are two
   * facts: a `setup` that returns only its teardown, or nothing, has still put
   * its content in the host.
   */
  const drawn = new Signal.State<{ readonly instance: T | null } | null>(null);
  const instance = (): T | null => drawn.get()?.instance ?? null;

  effect(() => {
    const host = options.host();
    // Not merely present: an element that is not in the document has no box to
    // draw into, and a canvas sized against it comes out zero by zero.
    if (!host?.isConnected) return;

    let teardown: IslandTeardown | undefined;
    let made: T | null = null;
    try {
      // Untracked, so the island is drawn once. A scene reads its initial
      // state as it is built, and tracking that would make every later change
      // to it tear the scene down and draw it again — which is what `sync` is
      // for instead. Only `host` above is a reason to draw again.
      const created = Signal.subtle.untrack(() => options.setup(host));
      if (typeof created === 'function') {
        teardown = created as IslandTeardown;
      } else if (created !== undefined) {
        made = created as T;
      }
    } catch (error) {
      if (options.onError === undefined) throw error;
      options.onError(error);
      return;
    }
    drawn.set({ instance: made });

    onCleanup(() => {
      teardown?.();
      // Cleared after the teardown rather than before, so an applier that runs
      // during it still has the object it is applying to.
      drawn.set(null);
    });
  });

  return {
    instance,
    isReady: () => drawn.get() !== null,

    sync(read, apply) {
      effect(() => {
        // Read before the guard, always. Returning early on a not-yet-ready
        // island without reading would leave this effect with no dependency on
        // the signal, and it would never run again once the island appeared.
        const value = read();
        const current = instance();
        if (current === null) return;
        // Untracked, so an applier reaching into the scene — which may well
        // read signals of its own — does not enrol them as reasons to run
        // again. What this effect depends on is `read`, and nothing else.
        Signal.subtle.untrack(() => apply(value, current));
      });
    },

    hostProps: () => ({ [ISLAND_ATTRIBUTE]: '' }),
  };
}
