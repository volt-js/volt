// @vitest-environment node

/**
 * Where a server function gets its identity from.
 *
 * The rule is absolute: authentication is read from the request, never from a
 * parameter. `guard` is the only route from a body to the `Request`, and it is
 * open for the length of the method's synchronous prologue and no longer —
 * which is why the build refuses a guard written anywhere but first. These are
 * the runtime half of that; the build half is in
 * `packages/vite-plugin/test/server-functions.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import { guard, withRequest } from '../src/guard.js';
import { Unauthorized } from '../src/errors.js';

const request = (headers: Record<string, string> = {}): Request =>
  new Request('https://app.test/_volt/x', { method: 'POST', headers });

describe('what a guard is handed', () => {
  it('is the request that made the call', async () => {
    const incoming = request({ cookie: 'session=abc' });

    const seen = await withRequest(incoming, () =>
      guard((r) => ({ same: r === incoming, cookie: r.headers.get('cookie') })),
    );

    expect(seen).toEqual({ same: true, cookie: 'session=abc' });
  });

  it('accepts a check that has to go and look something up', async () => {
    const subject = await withRequest(request({ authorization: 'Bearer t' }), () =>
      guard(async (r) => {
        await Promise.resolve();
        return { id: r.headers.get('authorization') };
      }),
    );

    expect(subject).toEqual({ id: 'Bearer t' });
  });
});

describe('a check that does not produce a caller', () => {
  it('denies rather than letting `undefined` flow into the body', async () => {
    // A session lookup that misses returns nothing. Closing in that direction
    // is the difference between a refusal and an undefined user id reaching a
    // query.
    for (const answer of [null, undefined, false]) {
      await expect(withRequest(request(), () => guard(() => answer))).rejects.toBeInstanceOf(
        Unauthorized,
      );
    }
  });

  it('lets through the falsy values that are real subjects', async () => {
    // `0` and `''` are answers, not absences: a numeric user id of zero is a
    // user, and refusing it would be a lockout nobody could diagnose.
    expect(await withRequest(request(), () => guard(() => 0))).toBe(0);
    expect(await withRequest(request(), () => guard(() => ''))).toBe('');
  });

  it('keeps the status of an error the check raised itself', async () => {
    // A lookup that went and failed: the realistic shape, and the one a body
    // meets through `await`.
    await expect(
      withRequest(request(), () =>
        guard(async () => {
          await Promise.resolve();
          throw new Unauthorized('expired');
        }),
      ),
    ).rejects.toMatchObject({ status: 401, message: 'expired' });
  });

  it('propagates a check that throws before it returns anything at all', () => {
    // Synchronously, because `check` is called synchronously — the request is
    // only reachable there. Inside a body it is an `await` either way, so the
    // difference is invisible to everything but a caller that skipped the
    // `await` the build insists on.
    expect(() =>
      withRequest(request(), () =>
        guard(() => {
          throw new Unauthorized('expired');
        }),
      ),
    ).toThrow(Unauthorized);
  });
});

describe('the window the request is visible in', () => {
  it('closes as soon as the prologue has run', async () => {
    let late: (() => Promise<unknown>) | undefined;
    await withRequest(request(), () => {
      late = () => guard(() => 'anyone');
    });

    // Past the prologue another call may be the one in flight, so a guard here
    // would authorize against somebody else's cookies. It refuses instead.
    expect(late).toBeDefined();
    expect(() => late!()).toThrow(/outside the first statement/);
  });

  it('says which shape to write instead', () => {
    let message = '';
    try {
      void guard(() => 'anyone');
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain('const user = await guard(session);');
    expect(message).toContain('reachable synchronously only');
  });

  it('restores the outer request when one server function calls another', async () => {
    const outer = request({ cookie: 'outer' });
    const inner = request({ cookie: 'inner' });

    // All within one prologue, which is the only place this can happen: a
    // server function is free to call another one directly, and the inner call
    // must not leave the outer without a request. Clearing rather than
    // restoring would make the second guard below refuse.
    const [before, nested, after] = await withRequest(outer, () => {
      const first = guard((r) => r.headers.get('cookie'));
      const middle = withRequest(inner, () => guard((r) => r.headers.get('cookie')));
      const last = guard((r) => r.headers.get('cookie'));
      return Promise.all([first, middle, last]);
    });

    expect({ before, nested, after }).toEqual({
      before: 'outer',
      nested: 'inner',
      after: 'outer',
    });
  });

  it('takes the request away again even when the body threw', () => {
    expect(() =>
      withRequest(request(), () => {
        throw new Error('no');
      }),
    ).toThrow('no');

    expect(() => guard(() => 'anyone')).toThrow(/outside the first statement/);
  });
});
