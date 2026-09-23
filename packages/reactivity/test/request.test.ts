/**
 * The request scope: what one server request keeps to itself, and what the
 * driver that settles it promises about the data it waits for.
 *
 * `lanes.test.ts` covers which effects a server runs. This covers the other
 * half — the state those effects reach for, and the loop that keeps flushing
 * until they stop asking for anything.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  Signal,
  createRequestScope,
  currentRequest,
  dataEffect,
  flushSync,
  renderEffect,
  requestState,
  runInRequest,
  settleRequest,
  trackRequestData,
} from '../src/index.js';

/**
 * The build flag, which the test config compiles to a live read of this global
 * so one file can render both sides.
 */
function serverBuild(on: boolean): void {
  (globalThis as { __VOLT_SERVER__?: boolean }).__VOLT_SERVER__ = on;
}

afterEach(() => {
  serverBuild(false);
  flushSync();
});

describe('settling a request', () => {
  it('is not taken down by data that rejects', async () => {
    serverBuild(true);
    const status = new Signal.State('loading');
    const seen: string[] = [];
    const scope = createRequestScope();

    await settleRequest(scope, () => {
      renderEffect(() => {
        seen.push(status.get());
      });
      // What a resource hands over: a promise that writes the state its
      // markup shows and then rejects, because the failure is still the
      // caller's to see. The request's job is to wait for it, not to adopt it.
      trackRequestData(
        Promise.reject(new Error('gateway')).catch((error: unknown) => {
          status.set('error');
          throw error;
        }),
      );
    });

    expect(seen).toEqual(['loading', 'error']);
  });

  it('gives up on a request that asks for more data every time an answer lands', async () => {
    serverBuild(true);
    const round = new Signal.State(0);
    const scope = createRequestScope();

    // A resource that re-arms itself never reaches quiescence, and an
    // unbounded loop turns that into a request that answers nothing at all —
    // no error, no page, a connection held until something upstream gives up.
    await expect(
      settleRequest(scope, () => {
        dataEffect(() => {
          const n = round.get();
          trackRequestData(Promise.resolve().then(() => round.set(n + 1)));
        });
      }),
    ).rejects.toThrow(/still asking for data/);
  });
});

describe('what a request wraps around its passes', () => {
  /**
   * A second ambient in the shape `withRequest` has: visible while `run` runs,
   * and put back afterwards, so what a test reads outside it is the truth.
   */
  function ambient(): { around: <T>(run: () => T) => T; read: () => string | null } {
    let visible: string | null = null;
    return {
      around: (run) => {
        const previous = visible;
        visible = 'the request';
        try {
          return run();
        } finally {
          visible = previous;
        }
      },
      read: () => visible,
    };
  }

  it('is entered for the build and for every flush, however many rounds the data takes', async () => {
    serverBuild(true);
    const { around, read } = ambient();
    const round = new Signal.State(0);
    const seen: string[] = [];
    const scope = createRequestScope();

    await settleRequest(
      scope,
      () => {
        seen.push(`build: ${read()}`);
        // A waterfall: each answer is the source of the next request, so the
        // request for round two can only start in the flush after round one's
        // answer has landed — and the one for round three after that.
        dataEffect(() => {
          const n = round.get();
          seen.push(`round ${n}: ${read()}`);
          if (n === 3) return;
          trackRequestData(
            Promise.resolve().then(() => {
              seen.push(`answer ${n}: ${read()}`);
              round.set(n + 1);
            }),
          );
        });
      },
      around,
    );

    // Every pass that can start a call is inside it. The continuations are not,
    // and cannot be: they run while the request waits, interleaved with every
    // other request in the process, which is exactly where nothing may be
    // visible.
    expect(seen).toEqual([
      'build: the request',
      'round 0: the request',
      'answer 0: null',
      'round 1: the request',
      'answer 1: null',
      'round 2: the request',
      'answer 2: null',
      'round 3: the request',
    ]);
    expect(read()).toBeNull();
  });

  it('is entered inside the request, so what it runs still finds the request scope', async () => {
    serverBuild(true);
    const scope = createRequestScope();
    const inside: boolean[] = [];

    await settleRequest(
      scope,
      () => {},
      (run) => {
        inside.push(currentRequest() === scope);
        return run();
      },
    );

    expect(inside).toEqual([true, true]);
  });
});

describe('data a request is waiting for', () => {
  it('is collected on a server', () => {
    serverBuild(true);
    const scope = createRequestScope();
    const work = Promise.resolve();

    runInRequest(scope, () => trackRequestData(work));

    expect(scope.pending).toEqual([work]);
  });

  it('is not collected on a client, where nothing is ever going to drain it', () => {
    serverBuild(false);
    const scope = createRequestScope();

    // `runInRequest` is exported to both sides, but `settleRequest` — the only
    // thing that empties this — is compiled out of a client build. Collecting
    // there is an array that grows for as long as the scope is alive.
    runInRequest(scope, () => trackRequestData(Promise.resolve()));

    expect(scope.pending).toEqual([]);
  });
});

describe('a request-scoped slot', () => {
  it('is built once even when what it holds is `undefined`', () => {
    const key = Symbol('volt.test.slot');
    const scope = createRequestScope();
    let built = 0;

    const read = (): unknown =>
      requestState(key, () => {
        built++;
        return undefined;
      });

    runInRequest(scope, () => {
      read();
      read();
    });

    // `undefined` is a legitimate thing for a slot to hold — "this request has
    // no locale of its own" — and the contract is one construction per
    // request, not one per read: what builds the value may cost something, or
    // may be the thing that reads the document.
    expect(built).toBe(1);
  });

  it('belongs to the request that read it', () => {
    const key = Symbol('volt.test.slot');
    const slot = (): Map<string, number> => requestState(key, () => new Map<string, number>());
    const first = createRequestScope();
    const second = createRequestScope();

    runInRequest(first, () => slot().set('a', 1));

    expect(runInRequest(second, slot).size).toBe(0);
    expect(runInRequest(first, slot).size).toBe(1);
  });

  it('is kept by nothing on a server when no request is current', () => {
    // A route loader, a promise continuation, a module's top level: on a
    // server each runs for some request without being inside it. Kept in the
    // process, what the first of them filed is what every later one reads —
    // one reader's locale, ids or registered signals in another's page.
    serverBuild(true);
    const key = Symbol('volt.test.slot');
    const slot = (): Map<string, string> => requestState(key, () => new Map<string, string>());

    slot().set('user', 'ada');

    expect(slot().get('user')).toBeUndefined();
    expect(runInRequest(createRequestScope(), slot).size).toBe(0);
  });

  it('is kept by the page in a browser, which is the only request there is', () => {
    const key = Symbol('volt.test.slot');
    const slot = (): Map<string, string> => requestState(key, () => new Map<string, string>());

    slot().set('user', 'ada');

    expect(slot().get('user')).toBe('ada');
  });
});
