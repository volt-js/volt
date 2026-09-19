/**
 * Resource, driven both directly and through a real mounted component.
 *
 * There is no keyboard map here — a resource has no interaction of its own —
 * so what the mounted half asserts instead is the live-region wiring: that the
 * polite region exists before it has anything to say, that the content is
 * marked busy only while it is being rebuilt, and that a failure reaches an
 * assertive region without emptying the list behind it.
 *
 * The direct half goes after the things that are usually wrong rather than the
 * things that usually work: responses arriving out of order, a fetcher that
 * ignores its abort signal, a retry that outlives the query it was retrying, a
 * debounce that survives disposal, and a response landing on top of an
 * optimistic update.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compileTemplate } from '@voltdev/core/jit';
import { Component, Signal, createRoot, flushSync, mount } from '@voltdev/core';
import {
  createResource,
  exponentialBackoff,
  type ResourceOptions,
  type ResourceRequest,
  type ResourceStatus,
} from '../src/async.js';
import { createLocale } from '../src/i18n.js';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

let disposers: (() => void)[] = [];
let mounted: { unmount(): void }[] = [];
let host: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  host = document.querySelector('#app') as HTMLElement;
});

afterEach(() => {
  for (const handle of mounted) handle.unmount();
  mounted = [];
  for (const dispose of disposers) dispose();
  disposers = [];
  flushSync();
  vi.useRealTimers();
});

/** Build something inside a scope the test tears down afterwards. */
function withScope<T>(build: () => T): T {
  let value!: T;
  createRoot((dispose) => {
    disposers.push(dispose);
    value = build();
  });
  // The first run of a user effect is deferred, so nothing is in flight until
  // the queue drains — which is exactly what a component's first paint does.
  flushSync();
  return value;
}

function track<T extends { unmount(): void }>(handle: T): T {
  mounted.push(handle);
  return handle;
}

/** A promise resolved by hand, so an in-flight request can be held open. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * Let the promise chain and the scheduler catch up.
 *
 * The write path is `await fetcher` → signal writes → effect flush, and a
 * retry adds a turn for the backoff, so a single microtask is never enough.
 */
async function settle(turns = 8): Promise<void> {
  for (let i = 0; i < turns; i++) {
    await Promise.resolve();
    flushSync();
  }
}

/**
 * Fake only the clock and `setTimeout`.
 *
 * Volt's scheduler coalesces onto `queueMicrotask`; faking that would stop
 * effects running at all, and the tests flush synchronously anyway.
 */
function useClock(): void {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
}

async function advance(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
  await settle();
}

// ---------------------------------------------------------------------------
// The shape of one call
// ---------------------------------------------------------------------------

describe('the shape of one call', () => {
  it('is loading from creation and success once the data lands', async () => {
    const gate = deferred<string>();
    const resource = withScope(() => createResource(() => gate.promise));

    expect(resource.status()).toBe('loading');
    expect(resource.isLoading()).toBe(true);
    expect(resource.data()).toBeUndefined();

    gate.resolve('hello');
    await settle();

    expect(resource.status()).toBe('success');
    expect(resource.data()).toBe('hello');
    expect(resource.error()).toBeUndefined();
  });

  it('stays idle until asked when immediate is off', async () => {
    const fetcher = vi.fn(() => 'value');
    const resource = withScope(() => createResource(fetcher, { immediate: false }));
    await settle();

    expect(fetcher).not.toHaveBeenCalled();
    expect(resource.status()).toBe('idle');

    await resource.refetch();
    await settle();
    expect(resource.data()).toBe('value');
  });

  it('starts in success when given initial data', () => {
    const resource = withScope(() =>
      createResource(() => 'fetched', { initialData: 'server', immediate: false }),
    );
    // A template branching on status must not show a spinner over data it has.
    expect(resource.status()).toBe('success');
    expect(resource.data()).toBe('server');
  });

  it('records a failure without rejecting out of refetch', async () => {
    const resource = withScope(() =>
      createResource(() => {
        throw new Error('nope');
      }),
    );
    await settle();

    expect(resource.status()).toBe('error');
    expect(resource.isError()).toBe(true);
    expect((resource.error() as Error).message).toBe('nope');

    // refetch is called from templates and handlers where nothing awaits it,
    // so rejecting would produce an unhandled rejection rather than a state.
    await expect(resource.refetch()).resolves.toBeUndefined();
  });

  it('keeps the last good data through a later failure', async () => {
    let succeed = true;
    const resource = withScope(() =>
      createResource(() => {
        if (!succeed) throw new Error('dropped');
        return 'good';
      }),
    );
    await settle();
    expect(resource.data()).toBe('good');

    succeed = false;
    await resource.refetch();
    await settle();

    // A list that empties itself on a dropped connection loses work the user
    // could still be reading.
    expect(resource.status()).toBe('error');
    expect(resource.data()).toBe('good');
  });

  it('reports success and final failure through the callbacks', async () => {
    const onSuccess = vi.fn();
    const onError = vi.fn();
    let succeed = true;

    const resource = withScope(() =>
      createResource(
        () => {
          if (!succeed) throw new Error('down');
          return 'ok';
        },
        { onSuccess, onError },
      ),
    );
    await settle();
    expect(onSuccess).toHaveBeenCalledWith('ok');
    expect(onError).not.toHaveBeenCalled();

    succeed = false;
    await resource.refetch();
    await settle();
    expect(onError).toHaveBeenCalledTimes(1);
    expect((onError.mock.calls[0]?.[0] as Error).message).toBe('down');
  });
});

// ---------------------------------------------------------------------------
// Out-of-order responses
// ---------------------------------------------------------------------------

describe('a superseded request stops holding its caller', () => {
  it('lets go of a fetcher that never answers, once something supersedes it', async () => {
    // Dropping a superseded response and not waiting for one are different
    // things. A fetcher that ignores its signal — or a promise nothing ever
    // settles — used to hold `refetch()` open for ever, and with it anything
    // that awaited it. Here the fetcher never settles at all.
    const source = new Signal.State('a');
    const resource = withScope(() =>
      createResource(() => new Promise<string>(() => {}), { source: () => source.get() }),
    );

    const held = resource.refetch();
    source.set('b');

    // Resolves rather than hanging. The race is against a timer so a
    // regression fails this test rather than the whole file.
    const raced = await Promise.race([
      held.then(() => 'let go'),
      new Promise((resolve) => setTimeout(() => resolve('still holding'), 500)),
    ]);
    expect(raced).toBe('let go');
  });

  it('lets go when the fetcher supersedes itself before it returns', async () => {
    // The signal is aborted *before* anything starts listening for the abort:
    // `fetcher(...)` is evaluated before the listener is attached, and `mutate`
    // stops the request synchronously. A listener added to an already-aborted
    // signal never fires, so an `aborted` check is the only thing that answers
    // this case — and a local mutation from inside a fetcher is the one way a
    // caller can reach it.
    let resource: { refetch(): Promise<unknown>; mutate(next: string): void } | null = null;
    let calls = 0;

    resource = withScope(() =>
      createResource<string>(() => {
        // Not on the first call: the resource fetches as it is created, and
        // the binding below has not been assigned yet then.
        if (++calls > 1) resource!.mutate('written locally');
        return new Promise<string>(() => {});
      }),
    );

    const raced = await Promise.race([
      resource.refetch().then(() => 'let go'),
      new Promise((resolve) => setTimeout(() => resolve('still holding'), 500)),
    ]);
    expect(raced).toBe('let go');
  });
});

describe('a superseded response cannot win', () => {
  it('drops a slow earlier response that lands after a fast later one', async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const source = new Signal.State('ca');
    let call = 0;

    const resource = withScope(() =>
      createResource(() => (++call === 1 ? first.promise : second.promise), {
        source: () => source.get(),
      }),
    );

    source.set('cat');
    await settle();

    second.resolve('cat results');
    await settle();
    first.resolve('ca results');
    await settle();

    // The single commonest combobox defect: results for "ca" landing under the
    // word "cat" and reading as a backend bug.
    expect(resource.data()).toBe('cat results');
    expect(resource.status()).toBe('success');
  });

  it('drops it even when the fetcher never looks at its abort signal', async () => {
    const gates = [deferred<string>(), deferred<string>()];
    const signals: AbortSignal[] = [];
    let call = 0;
    const source = new Signal.State('a');

    const resource = withScope(() =>
      createResource(
        (request: ResourceRequest<string, string>) => {
          signals.push(request.signal);
          // Deliberately ignores the signal, as a fetcher reading from cache
          // or from a service worker does.
          return gates[call++]!.promise;
        },
        { source: () => source.get() },
      ),
    );

    source.set('b');
    await settle();

    gates[1]!.resolve('b');
    await settle();
    gates[0]!.resolve('a');
    await settle();

    // Abort is a request to stop, not a promise that nothing arrives; the
    // generation check is what actually makes this safe.
    expect(signals[0]?.aborted).toBe(true);
    expect(resource.data()).toBe('b');
  });

  it('drops a superseded failure, so a stale error never appears over good data', async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    let call = 0;
    const source = new Signal.State('a');

    const resource = withScope(() =>
      createResource(() => (++call === 1 ? first.promise : second.promise), {
        source: () => source.get(),
      }),
    );

    source.set('b');
    await settle();
    second.resolve('b results');
    await settle();

    first.reject(new Error('the abandoned request failed'));
    await settle();

    expect(resource.status()).toBe('success');
    expect(resource.error()).toBeUndefined();
    expect(resource.data()).toBe('b results');
  });

  it('orders two refetches by which was asked for last, not which answered first', async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    let call = 0;

    const resource = withScope(() =>
      createResource(() => (++call === 1 ? first.promise : second.promise), {
        immediate: false,
      }),
    );

    const a = resource.refetch();
    const b = resource.refetch();

    second.resolve('second');
    first.resolve('first');
    await settle();

    expect(resource.data()).toBe('second');
    // The superseded call resolves undefined rather than with data nobody
    // should act on.
    await expect(a).resolves.toBeUndefined();
    await expect(b).resolves.toBe('second');
  });

  it('aborts the previous request when a new one starts', async () => {
    const reasons: unknown[] = [];
    const source = new Signal.State(1);

    withScope(() =>
      createResource(
        (request: ResourceRequest<number, number>) =>
          new Promise<number>(() => {
            request.signal.addEventListener('abort', () => reasons.push(request.signal.reason));
          }),
        { source: () => source.get() },
      ),
    );
    await settle();

    source.set(2);
    await settle();

    expect(reasons).toHaveLength(1);
    // A DOMException named AbortError, so consumer code checking for the name
    // fetch would have used keeps working.
    expect((reasons[0] as DOMException).name).toBe('AbortError');
  });
});

// ---------------------------------------------------------------------------
// The dependency accessor
// ---------------------------------------------------------------------------

describe('the dependency accessor', () => {
  it('refetches when the source changes', async () => {
    const source = new Signal.State('a');
    const fetcher = vi.fn((request: ResourceRequest<string, string>) => `got ${request.source}`);
    const resource = withScope(() => createResource(fetcher, { source: () => source.get() }));

    await settle();
    expect(resource.data()).toBe('got a');

    source.set('b');
    await settle();
    expect(resource.data()).toBe('got b');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('treats an equal source as the same request', async () => {
    const page = new Signal.State(1);
    // Read by the source and no part of the question — the unrelated re-run a
    // derived source sees all the time.
    const tick = new Signal.State(0);
    const fetcher = vi.fn(() => 'page');
    withScope(() =>
      createResource(fetcher, {
        // A derived source builds a fresh object on every read, so without an
        // equals every unrelated render would refetch.
        source: () => ({ page: page.get(), tick: tick.get() }),
        equals: (a, b) => a.page === b.page,
      }),
    );
    await settle();
    expect(fetcher).toHaveBeenCalledTimes(1);

    tick.set(1);
    await settle();
    expect(fetcher).toHaveBeenCalledTimes(1);

    page.set(2);
    await settle();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('refetches for an unequal object source without an equals, which is the trap', async () => {
    const tick = new Signal.State(0);
    const fetcher = vi.fn(() => 'page');
    withScope(() => createResource(fetcher, { source: () => ({ page: 1, tick: tick.get() }) }));
    await settle();

    tick.set(1);
    await settle();
    // Object.is on two fresh literals is false. Documented, and the reason
    // `equals` exists.
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('hands the fetcher the previous data, so a page can append', async () => {
    const page = new Signal.State(1);
    const resource = withScope(() =>
      createResource<number[], number>(
        (request) => [...(request.previous ?? []), request.source],
        { source: () => page.get() },
      ),
    );
    await settle();

    page.set(2);
    await settle();
    page.set(3);
    await settle();

    expect(resource.data()).toEqual([1, 2, 3]);
  });

  it('does not fetch while disabled, and asks once enabled', async () => {
    const on = new Signal.State(false);
    const fetcher = vi.fn(() => 'value');
    const resource = withScope(() =>
      createResource(fetcher, { source: () => 1, enabled: () => on.get() }),
    );
    await settle();
    expect(fetcher).not.toHaveBeenCalled();
    expect(resource.status()).toBe('idle');

    on.set(true);
    await settle();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(resource.data()).toBe('value');
  });

  it('abandons an in-flight request when it is disabled, and drops the spinner', async () => {
    const on = new Signal.State(true);
    const gate = deferred<string>();
    let aborted = false;

    const resource = withScope(() =>
      createResource(
        (request: ResourceRequest<string, undefined>) => {
          request.signal.addEventListener('abort', () => {
            aborted = true;
          });
          return gate.promise;
        },
        { enabled: () => on.get() },
      ),
    );
    expect(resource.status()).toBe('loading');

    on.set(false);
    await settle();
    expect(aborted).toBe(true);
    // A spinner still turning after the thing it was waiting for was cancelled
    // is the bug this prevents.
    expect(resource.status()).toBe('idle');

    gate.resolve('late');
    await settle();
    expect(resource.data()).toBeUndefined();
  });

  it('asks again for the same source once re-enabled', async () => {
    const on = new Signal.State(true);
    const fetcher = vi.fn(() => 'value');
    withScope(() =>
      createResource(fetcher, { source: () => 'constant', enabled: () => on.get() }),
    );
    await settle();
    expect(fetcher).toHaveBeenCalledTimes(1);

    on.set(false);
    await settle();
    on.set(true);
    await settle();

    // The cancelled request is forgotten rather than remembered as answered,
    // so the same query is asked again instead of waiting forever.
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('still runs an explicit refetch while disabled', async () => {
    const fetcher = vi.fn(() => 'value');
    const resource = withScope(() => createResource(fetcher, { enabled: () => false }));
    await settle();
    expect(fetcher).not.toHaveBeenCalled();

    await resource.refetch();
    await settle();
    expect(resource.data()).toBe('value');
  });

  it('does not cancel that refetch when something re-renders while still disabled', async () => {
    const source = new Signal.State('a');
    const gate = deferred<string>();
    const resource = withScope(() =>
      createResource(() => gate.promise, { source: () => source.get(), enabled: () => false }),
    );

    const pending = resource.refetch();
    expect(resource.status()).toBe('loading');

    // Only the change *into* disabled cancels. Cancelling on every run while
    // disabled would make an unrelated re-render kill a request the consumer
    // asked for by hand — which is the one thing `enabled` does not gate.
    source.set('b');
    await settle();
    expect(resource.status()).toBe('loading');

    gate.resolve('value');
    await settle();
    await expect(pending).resolves.toBe('value');
    expect(resource.data()).toBe('value');
  });
});

// ---------------------------------------------------------------------------
// Debounce and throttle
// ---------------------------------------------------------------------------

describe('debounce and throttle', () => {
  beforeEach(useClock);

  it('collapses a burst of keystrokes into one request for the last of them', async () => {
    const source = new Signal.State('c');
    const fetcher = vi.fn((request: ResourceRequest<string, string>) => request.source);
    withScope(() => createResource(fetcher, { source: () => source.get(), debounce: 200 }));

    source.set('ca');
    flushSync();
    source.set('cat');
    flushSync();

    await advance(199);
    expect(fetcher).not.toHaveBeenCalled();

    await advance(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0].source).toBe('cat');
  });

  it('does not debounce an explicit refetch', async () => {
    const fetcher = vi.fn(() => 'value');
    const resource = withScope(() => createResource(fetcher, { debounce: 300 }));
    expect(fetcher).not.toHaveBeenCalled();

    void resource.refetch();
    // A Retry button that appears to do nothing for 300ms reads as broken.
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('sends the first change at once under throttle, and the last at the window end', async () => {
    const source = new Signal.State(0);
    const fetcher = vi.fn((request: ResourceRequest<number, number>) => request.source);
    withScope(() => createResource(fetcher, { source: () => source.get(), throttle: 100 }));

    // Unlike debounce, the leading change is not delayed.
    expect(fetcher).toHaveBeenCalledTimes(1);

    source.set(1);
    flushSync();
    source.set(2);
    flushSync();
    expect(fetcher).toHaveBeenCalledTimes(1);

    await advance(99);
    expect(fetcher).toHaveBeenCalledTimes(1);

    await advance(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    // The intermediate value is dropped; the latest one never is.
    expect(fetcher.mock.calls[1]?.[0].source).toBe(2);
  });

  it('waits for whichever of the two is longer', async () => {
    const source = new Signal.State('a');
    const fetcher = vi.fn((request: ResourceRequest<string, string>) => request.source);
    withScope(() =>
      createResource(fetcher, { source: () => source.get(), debounce: 50, throttle: 200 }),
    );

    await advance(50);
    expect(fetcher).toHaveBeenCalledTimes(1);

    source.set('b');
    flushSync();
    await advance(50);
    // Debounce alone would have gone by now; the throttle window has not shut.
    expect(fetcher).toHaveBeenCalledTimes(1);

    await advance(150);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('cancels a pending debounce when the scope is disposed', async () => {
    const fetcher = vi.fn(() => 'value');
    createRoot((dispose) => {
      createResource(fetcher, { debounce: 100 });
      disposers.push(dispose);
    });
    flushSync();

    disposers.pop()?.();
    await advance(500);

    // A timer that outlives its component fires into a torn-down scope.
    expect(fetcher).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Retry
// ---------------------------------------------------------------------------

describe('retry', () => {
  beforeEach(useClock);

  it('tries again the given number of times and then gives up', async () => {
    const fetcher = vi.fn(() => {
      throw new Error('boom');
    });
    const onError = vi.fn();
    const resource = withScope(() =>
      createResource(fetcher, { retry: 2, retryDelay: () => 10, onError }),
    );

    await settle();
    expect(fetcher).toHaveBeenCalledTimes(1);
    await advance(10);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await advance(10);

    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(resource.status()).toBe('error');
    // One report, for the failure that was final.
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('does not retry by default', async () => {
    const fetcher = vi.fn(() => {
      throw new Error('boom');
    });
    withScope(() => createResource(fetcher));
    await advance(60_000);

    // A POST that may have half-succeeded must not be repeated by a library
    // that cannot know it was a POST.
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('numbers the delays from one and passes the error to the schedule', async () => {
    const retryDelay = vi.fn((_attempt: number, _error: unknown) => 10);
    withScope(() =>
      createResource(
        () => {
          throw new Error('boom');
        },
        { retry: 2, retryDelay },
      ),
    );

    await settle();
    await advance(10);
    await advance(10);

    expect(retryDelay.mock.calls.map((call) => call[0])).toEqual([1, 2]);
    expect((retryDelay.mock.calls[0]?.[1] as Error).message).toBe('boom');
  });

  it('stops when the predicate says this failure will not change', async () => {
    const fetcher = vi.fn(() => {
      throw new Error('404');
    });
    const shouldRetry = vi.fn(() => false);
    const resource = withScope(() =>
      createResource(fetcher, { retry: 3, retryDelay: () => 10, shouldRetry }),
    );

    await advance(100);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(shouldRetry).toHaveBeenCalledTimes(1);
    expect(resource.status()).toBe('error');
  });

  it('clears the previous error while the next attempt is in flight', async () => {
    let call = 0;
    const gates = [deferred<string>(), deferred<string>()];
    const resource = withScope(() =>
      createResource(() => gates[call++]!.promise, { retry: 1, retryDelay: () => 50 }),
    );

    gates[0]!.reject(new Error('first'));
    await settle();

    // Still loading, and with nothing shown that says it failed — a retry that
    // runs underneath the last error message is a UI saying two things at once.
    expect(resource.status()).toBe('loading');
    expect(resource.error()).toBeUndefined();
    expect(resource.attempt()).toBe(0);

    await advance(50);
    expect(resource.attempt()).toBe(1);
    expect(resource.announcement()).toBe('Retrying…');

    gates[1]!.resolve('recovered');
    await settle();
    expect(resource.status()).toBe('success');
    expect(resource.data()).toBe('recovered');
  });

  it('does not report an error for a retry that eventually succeeds', async () => {
    const onError = vi.fn();
    let call = 0;
    const resource = withScope(() =>
      createResource(
        () => {
          if (++call < 3) throw new Error('flaky');
          return 'settled';
        },
        { retry: 3, retryDelay: () => 5, onError },
      ),
    );

    await advance(5);
    await advance(5);

    expect(resource.data()).toBe('settled');
    expect(onError).not.toHaveBeenCalled();
  });

  it('abandons a backoff when the source moves on, and never resumes it', async () => {
    const source = new Signal.State('a');
    const fetcher = vi.fn((request: ResourceRequest<string, string>) => {
      if (request.source === 'a') throw new Error('boom');
      return request.source;
    });
    const resource = withScope(() =>
      createResource(fetcher, {
        source: () => source.get(),
        retry: 3,
        retryDelay: () => 1000,
      }),
    );
    await settle();
    expect(fetcher).toHaveBeenCalledTimes(1);

    source.set('b');
    await settle();
    expect(resource.data()).toBe('b');

    await advance(5000);
    // Two calls, not five: the abandoned query does not keep retrying in the
    // background and cannot come back to overwrite the answer.
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(resource.data()).toBe('b');
    expect(resource.status()).toBe('success');
  });

  it('cancels a backoff on disposal', async () => {
    const fetcher = vi.fn(() => {
      throw new Error('boom');
    });
    let dispose!: () => void;
    createRoot((d) => {
      dispose = d;
      createResource(fetcher, { retry: 5, retryDelay: () => 20 });
    });
    flushSync();
    await settle();
    expect(fetcher).toHaveBeenCalledTimes(1);

    dispose();
    await advance(500);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('doubles the default backoff, caps it, and keeps it inside the jitter band', () => {
    for (const [attempt, ceiling] of [
      [1, 300],
      [2, 600],
      [3, 1200],
    ] as const) {
      const delay = exponentialBackoff(attempt);
      // Jitter spreads correlated failures out; the band is half the ceiling
      // to the ceiling, so only the bounds are assertable.
      expect(delay).toBeGreaterThanOrEqual(ceiling / 2);
      expect(delay).toBeLessThanOrEqual(ceiling);
    }
    expect(exponentialBackoff(50)).toBeLessThanOrEqual(30_000);
  });
});

// ---------------------------------------------------------------------------
// Mutating and cancelling
// ---------------------------------------------------------------------------

describe('mutating and cancelling', () => {
  it('writes data locally, from a value or an updater', async () => {
    const resource = withScope(() => createResource<string[], undefined>(() => ['server']));
    await settle();

    resource.mutate(['local']);
    flushSync();
    expect(resource.data()).toEqual(['local']);

    resource.mutate((previous) => [...(previous ?? []), 'appended']);
    flushSync();
    expect(resource.data()).toEqual(['local', 'appended']);
  });

  it('discards a response already on the wire when it mutates over it', async () => {
    const gate = deferred<string>();
    const resource = withScope(() => createResource(() => gate.promise));

    resource.mutate('optimistic');
    flushSync();
    expect(resource.data()).toBe('optimistic');
    expect(resource.status()).toBe('success');

    gate.resolve('server');
    await settle();

    // The response left before the edit, so it carries the value the user just
    // changed. Letting it land would silently undo them.
    expect(resource.data()).toBe('optimistic');
  });

  it('returns to idle when the data is cleared', async () => {
    const resource = withScope(() => createResource(() => 'value'));
    await settle();

    resource.mutate(undefined);
    flushSync();
    // Not "success at holding nothing".
    expect(resource.status()).toBe('idle');
    expect(resource.data()).toBeUndefined();
  });

  it('clears a standing error, because the data is now known', async () => {
    const resource = withScope(() =>
      createResource<string, undefined>(() => {
        throw new Error('boom');
      }),
    );
    await settle();
    expect(resource.status()).toBe('error');

    resource.mutate('known');
    flushSync();
    expect(resource.error()).toBeUndefined();
    expect(resource.errorMessage()).toBe('');
  });

  it('abort leaves the data alone and puts the status back where it was', async () => {
    const gate = deferred<string>();
    const resource = withScope(() =>
      createResource(() => gate.promise, { initialData: 'cached' }),
    );
    expect(resource.status()).toBe('loading');

    resource.abort();
    flushSync();
    expect(resource.status()).toBe('success');
    expect(resource.data()).toBe('cached');

    gate.resolve('late');
    await settle();
    expect(resource.data()).toBe('cached');
  });

  it('abort with nothing to fall back on goes idle', async () => {
    const resource = withScope(() => createResource(() => deferred<string>().promise));
    resource.abort();
    flushSync();
    expect(resource.status()).toBe('idle');
    await settle();
  });
});

// ---------------------------------------------------------------------------
// Streaming
// ---------------------------------------------------------------------------

describe('streaming a partial answer', () => {
  it('publishes chunks while the request is still open', async () => {
    const gate = deferred<string>();
    let emit!: (chunk: string) => void;

    const resource = withScope(() =>
      createResource<string, undefined>((request) => {
        emit = (chunk) => request.push((previous) => (previous ?? '') + chunk);
        return gate.promise;
      }),
    );

    emit('Hel');
    emit('lo');
    flushSync();

    expect(resource.data()).toBe('Hello');
    // Still in flight: a stream that reported success halfway would take the
    // spinner down while text was still arriving.
    expect(resource.status()).toBe('loading');

    gate.resolve('Hello, world');
    await settle();
    expect(resource.data()).toBe('Hello, world');
    expect(resource.status()).toBe('success');
  });

  it('ignores a chunk from a stream that has been superseded', async () => {
    const gates = [deferred<string>(), deferred<string>()];
    const pushes: ((value: string) => void)[] = [];
    let call = 0;
    const source = new Signal.State('a');

    const resource = withScope(() =>
      createResource<string, string>(
        (request) => {
          pushes.push((value) => request.push(value));
          return gates[call++]!.promise;
        },
        { source: () => source.get() },
      ),
    );

    source.set('b');
    await settle();
    gates[1]!.resolve('second');
    await settle();

    pushes[0]?.('leaked from the abandoned stream');
    flushSync();

    expect(resource.data()).toBe('second');
  });

  it('shows a retried attempt what the failed one had already pushed', async () => {
    useClock();
    const seen: (string | undefined)[] = [];
    let call = 0;

    withScope(() =>
      createResource<string, undefined>(
        (request) => {
          seen.push(request.previous);
          request.push('chunk');
          if (++call === 1) throw new Error('dropped mid-stream');
          return 'done';
        },
        { retry: 1, retryDelay: () => 10 },
      ),
    );
    await settle();
    await advance(10);

    // The retry can tell a resumable stream from a restarting one by what it
    // is handed plus `attempt`; nothing here decides that for it.
    expect(seen).toEqual([undefined, 'chunk']);
  });
});

// ---------------------------------------------------------------------------
// Externally owned state
// ---------------------------------------------------------------------------

describe('state owned from outside', () => {
  it('reads and writes a supplied data signal', async () => {
    const store = new Signal.State<string | undefined>(undefined);
    const resource = withScope(() => createResource(() => 'fetched', { data: store }));
    await settle();
    expect(store.get()).toBe('fetched');

    store.set('written elsewhere');
    flushSync();
    expect(resource.data()).toBe('written elsewhere');
  });

  it('lets the supplied data signal win over initialData', () => {
    const store = new Signal.State<string | undefined>('from the store');
    const resource = withScope(() =>
      createResource(() => 'fetched', {
        data: store,
        initialData: 'ignored',
        immediate: false,
      }),
    );
    expect(resource.data()).toBe('from the store');
    expect(resource.status()).toBe('success');
  });

  it('drives a shared status signal, so one shell can watch many resources', async () => {
    const shared = new Signal.State<ResourceStatus>('idle');
    const gate = deferred<string>();
    withScope(() => createResource(() => gate.promise, { status: shared }));

    expect(shared.get()).toBe('loading');
    gate.resolve('done');
    await settle();
    expect(shared.get()).toBe('success');
  });

  it('takes a supplied status out of loading when its scope goes mid-request', async () => {
    const status = new Signal.State<ResourceStatus>('idle');
    const store = new Signal.State<string | undefined>(undefined);
    const withData = new Signal.State<ResourceStatus>('idle');
    const gate = deferred<string>();

    let dispose!: () => void;
    createRoot((end) => {
      dispose = end;
      createResource(() => gate.promise, { status });
      createResource(() => gate.promise, { status: withData, data: store, immediate: false }).refetch();
      store.set('held');
    });
    flushSync();
    expect(status.get()).toBe('loading');
    expect(withData.get()).toBe('loading');

    // Both signals outlive the component that wrote them. Left at `loading`,
    // each is a spinner nothing will ever take down — the bug `abort` exists
    // to prevent, reached by unmounting instead.
    dispose();
    expect(status.get()).toBe('idle');
    expect(withData.get()).toBe('success');

    gate.resolve('late');
    await settle();
    expect(status.get()).toBe('idle');
    expect(store.get()).toBe('held');
  });

  it('leaves a shared status alone when the resource that goes never fetched', () => {
    const shared = new Signal.State<ResourceStatus>('idle');
    const gate = deferred<string>();

    let disposeIdle!: () => void;
    let idle!: ReturnType<typeof createResource<string, undefined>>;
    createRoot((end) => {
      disposeIdle = end;
      idle = createResource(() => 'never asked for', { status: shared, immediate: false });
    });
    withScope(() => createResource(() => gate.promise, { status: shared }));
    flushSync();
    expect(shared.get()).toBe('loading');

    // The spinner is the other resource's, which is still waiting. One that
    // has nothing in flight has nothing to cancel, by hand or by unmounting.
    idle.abort();
    expect(shared.get()).toBe('loading');
    disposeIdle();
    expect(shared.get()).toBe('loading');
  });
});

// ---------------------------------------------------------------------------
// Disposal
// ---------------------------------------------------------------------------

describe('cleanup on disposal', () => {
  it('aborts what is in flight', async () => {
    let reason: unknown;
    const gate = deferred<string>();

    createRoot((dispose) => {
      createResource((request: ResourceRequest<string, undefined>) => {
        request.signal.addEventListener('abort', () => {
          reason = request.signal.reason;
        });
        return gate.promise;
      });
      disposers.push(dispose);
    });
    flushSync();

    disposers.pop()?.();
    expect((reason as DOMException).name).toBe('AbortError');
  });

  it('writes nothing when a response lands after the scope has gone', async () => {
    const gate = deferred<string>();
    let resource!: ReturnType<typeof createResource<string, undefined>>;

    createRoot((dispose) => {
      resource = createResource(() => gate.promise);
      disposers.push(dispose);
    });
    flushSync();
    disposers.pop()?.();

    gate.resolve('late');
    await settle();

    // Disposal cancelled it, so it is back to having nothing rather than
    // claiming the success the late answer would have been.
    expect(resource.data()).toBeUndefined();
    expect(resource.status()).toBe('idle');
  });
});

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

describe('the strings a user hears', () => {
  it('says nothing on success by default', async () => {
    const resource = withScope(() => createResource(() => 'value'));
    expect(resource.announcement()).toBe('Loading…');

    await settle();
    // Search-as-you-type would otherwise say "Loaded" after every keystroke,
    // over the count the combobox itself announces.
    expect(resource.announcement()).toBe('');
  });

  it('takes an override for every one of them', async () => {
    useClock();
    let call = 0;
    const gates = [deferred<string>(), deferred<string>()];
    const resource = withScope(() =>
      createResource(() => gates[call++]!.promise, {
        retry: 1,
        retryDelay: () => 10,
        labels: { loading: 'Chargement…', retrying: 'Nouvel essai…', success: 'Chargé' },
      }),
    );
    expect(resource.announcement()).toBe('Chargement…');

    gates[0]!.reject(new Error('boom'));
    await settle();
    // Held open, so the second attempt can be observed in flight rather than
    // only in the state it left behind.
    await advance(10);
    expect(resource.announcement()).toBe('Nouvel essai…');

    gates[1]!.resolve('value');
    await settle();
    expect(resource.announcement()).toBe('Chargé');
  });

  it('never puts the thrown message in front of a user by default', async () => {
    const resource = withScope(() =>
      createResource<string, undefined>(() => {
        throw new Error('ECONNREFUSED postgres://prod-db-3:5432');
      }),
    );
    await settle();

    // The thrown message is written for whoever wrote the server, and names
    // tables, hosts and stack frames.
    expect(resource.errorMessage()).toBe('Something went wrong.');
    expect(resource.errorMessage()).not.toContain('prod-db-3');
  });

  it('hands the thrown value to the function form, for a consumer who maps them', async () => {
    const resource = withScope(() =>
      createResource<string, undefined>(
        () => {
          throw new Response(null, { status: 404 });
        },
        {
          labels: {
            error: (error) =>
              error instanceof Response && error.status === 404
                ? 'No results for that search.'
                : 'Something went wrong.',
          },
        },
      ),
    );
    await settle();
    expect(resource.errorMessage()).toBe('No results for that search.');
  });

  it('reads a label each time it speaks, so one written as a getter follows the locale', () => {
    const locale = createLocale({ defaultLocale: 'en-GB' });
    const ui = mountList(() => new Promise<string[]>(() => {}), {
      labels: {
        get loading() {
          return locale.t('loading');
        },
      },
    });
    expect(ui.live().textContent).toBe('Loading…');

    // A value computed once would go on speaking the language the page started
    // in; the region is subscribed to the catalogue through the getter.
    locale.setMessages({ loading: 'Chargement…' });
    locale.setLocale('fr-FR');
    flushSync();
    expect(ui.live().textContent).toBe('Chargement…');
  });

  it('has no error message when there is no error', () => {
    const resource = withScope(() => createResource(() => 'value', { immediate: false }));
    expect(resource.errorMessage()).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Through a real component
// ---------------------------------------------------------------------------

const LIST_TEMPLATE = `
  <div>
    <input class="query" :value="query.get()" :input="query.set($event.target.value)">
    <p class="live" :spread="results.statusProps()">{ results.announcement() }</p>
    <ul class="list" :spread="results.contentProps()">
      <li :for="item of results.data() ?? []" :key="item">{ item }</li>
    </ul>
    <p :if="results.isError()" class="error" :spread="results.errorProps()">{ results.errorMessage() }</p>
    <button class="refetch" :click="results.refetch()">Retry</button>
  </div>
`;

type ListOptions = Omit<ResourceOptions<string[], string>, 'source'>;

function mountList(
  fetcher: (request: ResourceRequest<string[], string>) => string[] | Promise<string[]>,
  options: ListOptions = {},
) {
  @Component({ selector: 'v-async-list', render: compileTemplate(LIST_TEMPLATE) })
  class AsyncList {
    query = new Signal.State('');
    results = createResource<string[], string>(fetcher, {
      source: () => this.query.get(),
      ...options,
    });
  }

  const handle = track(mount(AsyncList, host));
  flushSync();

  const find = (selector: string) => host.querySelector(selector) as HTMLElement;
  return {
    instance: handle.instance as AsyncList,
    live: () => find('.live'),
    list: () => find('.list'),
    error: () => host.querySelector('.error'),
    items: () => [...host.querySelectorAll('li')].map((li) => li.textContent),
    type(value: string) {
      const input = find('input.query') as HTMLInputElement;
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      flushSync();
    },
  };
}

describe('what assistive technology is told', () => {
  it('renders the polite region before it has anything to say', () => {
    const ui = mountList(() => ['a'], { immediate: false });

    // A live region only announces changes to text inside a region that was
    // already in the document; one that appears with its message says nothing.
    const live = ui.live();
    expect(live).not.toBeNull();
    expect(live.getAttribute('role')).toBe('status');
    expect(live.getAttribute('aria-live')).toBe('polite');
    // The message is one sentence that replaces the last; half of it is worse
    // than a repeat.
    expect(live.getAttribute('aria-atomic')).toBe('true');
    expect(live.getAttribute('data-status')).toBe('idle');
    expect(live.textContent).toBe('');
  });

  it('never puts aria-busy on the live region itself', async () => {
    const gate = deferred<string[]>();
    const ui = mountList(() => gate.promise);

    // On a live region aria-busy means "do not announce me yet", which would
    // silence the very message this region carries.
    expect(ui.live().hasAttribute('aria-busy')).toBe(false);
    expect(ui.live().textContent).toBe('Loading…');

    gate.resolve(['done']);
    await settle();
    expect(ui.live().hasAttribute('aria-busy')).toBe(false);
  });

  it('marks the content busy only while it is being rebuilt', async () => {
    const gate = deferred<string[]>();
    const ui = mountList(() => gate.promise);

    expect(ui.list().getAttribute('aria-busy')).toBe('true');
    expect(ui.list().getAttribute('data-status')).toBe('loading');

    gate.resolve(['alpha', 'beta']);
    await settle();

    // Absent, not "false": a screen reader should read the settled list with
    // nothing qualifying it.
    expect(ui.list().hasAttribute('aria-busy')).toBe(false);
    expect(ui.list().getAttribute('data-status')).toBe('success');
    expect(ui.items()).toEqual(['alpha', 'beta']);
  });

  it('interrupts with an assertive region on failure, without emptying the list', async () => {
    let succeed = true;
    const ui = mountList(() => {
      if (!succeed) throw new Error('ECONNRESET');
      return ['alpha', 'beta'];
    });
    await settle();
    expect(ui.error()).toBeNull();

    succeed = false;
    (host.querySelector('.refetch') as HTMLElement).click();
    await settle();

    const alert = ui.error();
    expect(alert).not.toBeNull();
    // The user is most likely still looking at what caused it, and a polite
    // message waits behind whatever else is queued.
    expect(alert?.getAttribute('role')).toBe('alert');
    expect(alert?.getAttribute('aria-live')).toBe('assertive');
    expect(alert?.getAttribute('aria-atomic')).toBe('true');
    expect(alert?.textContent).toBe('Something went wrong.');

    // The polite region stays quiet, so the failure is announced once.
    expect(ui.live().textContent).toBe('');
    expect(ui.items()).toEqual(['alpha', 'beta']);
    expect(ui.list().getAttribute('data-status')).toBe('error');
  });

  it('searches as the user types, and paints the last query even when it answers first', async () => {
    useClock();
    const gates = new Map<string, ReturnType<typeof deferred<string[]>>>();
    const ui = mountList(
      (request) => {
        const gate = deferred<string[]>();
        gates.set(request.source, gate);
        return gate.promise;
      },
      { enabled: () => true, debounce: 100, immediate: false },
    );

    ui.type('ca');
    ui.type('cat');
    await advance(99);
    expect(gates.size).toBe(0);

    await advance(1);
    // One request for the burst, and for the word actually typed.
    expect([...gates.keys()]).toEqual(['cat']);

    ui.type('cats');
    await advance(100);
    expect([...gates.keys()]).toEqual(['cat', 'cats']);

    gates.get('cats')?.resolve(['cats: 12 results']);
    await settle();
    gates.get('cat')?.resolve(['cat: 400 results']);
    await settle();

    // The list under the word "cats" must be the list for "cats".
    expect(ui.items()).toEqual(['cats: 12 results']);
    expect(ui.list().getAttribute('data-status')).toBe('success');
  });

  it('stops the requests when the component unmounts mid-search', async () => {
    const aborted: string[] = [];
    const ui = mountList((request) => {
      request.signal.addEventListener('abort', () => aborted.push(request.source));
      return new Promise<string[]>(() => {});
    });
    ui.type('cat');
    await settle();

    for (const handle of mounted) handle.unmount();
    mounted = [];
    flushSync();

    expect(aborted).toContain('cat');
  });
});
