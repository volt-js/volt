// @vitest-environment node
//
// A browser's `Request` drops `cookie`, which is the header a guard reads. The
// render runs on a server, so that is the `Request` it has to be right against.

/**
 * A server function called while a page is being rendered on the server.
 *
 * On the server the lowering leaves the real method behind, so a component
 * that calls one during a render calls it directly — no POST, no handler, and
 * so none of the `withRequest` the handler wraps a call in. What stands in for
 * it is the render's `around`, entered for every synchronous span of the
 * render and nowhere else, and a server that wraps `resolve()` the same way
 * for the loaders that run before it.
 *
 * What the request is *not* visible to is as much the claim as what it is:
 * the continuation of a promise runs while the request waits, interleaved with
 * every other request in the process, and a guard there has to refuse — it
 * would otherwise be reading whichever request happened to be in flight.
 */
import { describe, expect, it } from 'vitest';

/** The build flag, which the test config compiles to a live read of this global. */
(globalThis as { __VOLT_SERVER__?: boolean }).__VOLT_SERVER__ = true;

const { Component, createContext, dataEffect, hydratable, provideContext, trackRequestData, useContext } =
  await import('@voltdev/core');
const { compileTemplate } = await import('@voltdev/core/jit');
const { renderToString } = await import('@voltdev/core/server');
const { createResource } = await import('@voltdev/primitives');
const { createRouter, defineRoutes } = await import('@voltdev/router');
// From the package's own entry: a server render wraps itself in this, so an
// application calling a renderer by hand has to be able to reach it.
const { guard, withRequest } = await import('../src/index.js');

const session = (request: Request): string | null => request.headers.get('cookie');

/** Every request a guard was shown, in the order it was shown them. */
let shown: string[] = [];

/**
 * What the server half of a `@Server()` lowering leaves behind: the method as
 * written, guard first and awaited, which is the only shape the build accepts.
 */
class Account {
  async plan(): Promise<string> {
    const user = await guard(session);
    shown.push(user);
    return 'team';
  }

  async seats(plan: string): Promise<number> {
    const user = await guard(session);
    shown.push(user);
    return plan === 'team' ? 10 : 1;
  }

  async invoice(seats: number): Promise<string> {
    const user = await guard(session);
    shown.push(user);
    return `${user}: ${seats} seats`;
  }
}

const account = new Account();

function requestFrom(user: string): Request {
  return new Request('https://app.test/pricing', { headers: { cookie: user } });
}

/** The state payload a page carries, as the client will read it. */
function payload(state: string): unknown {
  const json = /<script[^>]*>(.*)<\/script>/s.exec(state)?.[1];
  return json === undefined ? null : JSON.parse(json);
}

async function page(
  ...args: Parameters<typeof renderToString>
): Promise<{ html: string; state: string }> {
  const rendered = await renderToString(...args);
  if (rendered.status !== 200) throw rendered.error;
  return rendered;
}

const refused = (error: unknown): string => `refused: ${(error as Error).message}`;

describe('a server function called from a constructor', () => {
  @Component({ selector: 'v-plan', render: compileTemplate(`<p>{ plan.get() }</p>`) })
  class Plan {
    plan = hydratable<string | null>('plan', () => null);
    constructor() {
      // Called while the page builds: the guard reads the request synchronously,
      // inside the build span.
      trackRequestData(
        account.plan().then(
          (plan) => this.plan.set(plan),
          (error: unknown) => this.plan.set(refused(error)),
        ),
      );
    }
  }

  it('reaches the guard with the request the page is for', async () => {
    shown = [];
    const request = requestFrom('ada');

    const rendered = await page(Plan, { around: (run) => withRequest(request, run) });

    expect(shown).toEqual(['ada']);
    // The answer arrives after the walk wrote this element, so it reaches the
    // client through the payload — not through bytes already written. A value
    // that has to be in the markup comes from a route's loader, which runs
    // before the walk starts.
    expect(payload(rendered.state)).toEqual({ plan: 'team' });
    expect(rendered.html).not.toContain('team');
  });

  it('is refused when nothing made the request visible', async () => {
    shown = [];

    const rendered = await page(Plan);

    expect(shown).toEqual([]);
    expect(payload(rendered.state)).toEqual({
      plan: expect.stringMatching(/^refused: .*outside the first statement/s),
    });
  });
});

describe('a server function called in a later round', () => {
  it('reaches the guard when the call waited for another one to answer', async () => {
    // A waterfall written the way a component writes one: each resource's
    // source is the previous one's answer, so the second call starts in the
    // flush after the first answer lands — settle round two — and the third in
    // round three.
    @Component({ selector: 'v-billing', render: compileTemplate(`<p>billing</p>`) })
    class Billing {
      plan = createResource(() => account.plan());
      seats = createResource(({ source }) => account.seats(source!), {
        source: () => this.plan.data(),
        enabled: () => this.plan.data() !== undefined,
      });
      invoice = createResource(({ source }) => account.invoice(source!), {
        source: () => this.seats.data(),
        enabled: () => this.seats.data() !== undefined,
        data: hydratable<string | undefined>('invoice', () => undefined),
      });
    }

    shown = [];
    const request = requestFrom('grace');

    const rendered = await page(Billing, { around: (run) => withRequest(request, run) });

    expect(shown).toEqual(['grace', 'grace', 'grace']);
    expect(payload(rendered.state)).toEqual({ invoice: 'grace: 10 seats' });
  });

  it('is refused from the continuation of another call, which runs between spans', async () => {
    // The limit of the mechanism, stated as a test so that it is not claimed
    // for more. A `.then` runs while the request is waiting on its data, which
    // is outside every span `around` wraps and is also where another request's
    // continuation may run next — so the guard refuses rather than guess, and
    // the refusal says where the second call belongs instead.
    @Component({ selector: 'v-chained', render: compileTemplate(`<p>chained</p>`) })
    class Chained {
      seats = hydratable<number | string | null>('seats', () => null);
      constructor() {
        trackRequestData(
          account
            .plan()
            .then((plan) => account.seats(plan))
            .then(
              (seats) => this.seats.set(seats),
              (error: unknown) => this.seats.set(refused(error)),
            ),
        );
      }
    }

    shown = [];
    const rendered = await page(Chained, {
      around: (run) => withRequest(requestFrom('ada'), run),
    });

    // The first call was inside the build; the second was not.
    expect(shown).toEqual(['ada']);
    expect(payload(rendered.state)).toEqual({
      seats: expect.stringMatching(/refused: .*resource whose source\s+is that answer/s),
    });
  });
});

describe('a route loader that calls a server function', () => {
  @Component({ selector: 'v-route-page', render: compileTemplate(`<p>page</p>`) })
  class RoutePage {}

  const table = defineRoutes([
    {
      path: '/',
      component: RoutePage,
      loader: () => account.plan(),
      children: [
        {
          path: 'pricing',
          // Lazy, so the loader starts beside the chunk rather than after it.
          component: async () => RoutePage,
          loader: () => account.seats('team'),
        },
      ],
    },
  ]);

  it('reaches the guard when resolve() runs inside the request', async () => {
    shown = [];
    const router = createRouter({ routes: table });
    const request = requestFrom('ada');

    const result = await withRequest(request, () => router.resolve(request.url));

    expect(result.status).toBe('completed');
    // Both depths, not only the first: every loader of the branch is started
    // before `resolve()` yields, which is the only reason one synchronous
    // wrapper covers all of them.
    expect(shown).toEqual(['ada', 'ada']);
  });

  it('is refused when resolve() runs outside it', async () => {
    shown = [];
    const router = createRouter({ routes: table });

    const result = await router.resolve('https://app.test/pricing');

    expect(result.status).toBe('failed');
    expect(result.status === 'failed' && (result.error as Error).message).toMatch(
      /outside the first statement/,
    );
    expect(shown).toEqual([]);
  });
});

describe('two renders in flight at once', () => {
  it('each show the guard their own request, round after round', async () => {
    const Who = createContext('nobody');
    /** Which page asked, paired with the request its guard was shown. */
    const pairs: string[] = [];
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));

    class Steps {
      async step(n: number, page: string): Promise<number> {
        const user = await guard(session);
        pairs.push(`${page} saw ${user}`);
        // Ada's first answer is held until grace's page has finished, so every
        // one of grace's rounds runs while ada's render is waiting — and ada's
        // second and third run after grace's spans have all come and gone.
        if (page === 'ada' && n === 0) await held;
        return n + 1;
      }
    }
    const steps = new Steps();

    @Component({ selector: 'v-interleaved', render: compileTemplate(`<p>{ who }</p>`) })
    class Interleaved {
      who = useContext(Who);
      n = hydratable('steps', () => 0);
      constructor() {
        dataEffect(() => {
          const n = this.n.get();
          if (n === 3) return;
          trackRequestData(steps.step(n, this.who).then((next) => this.n.set(next)));
        });
      }
    }

    const render = (user: string) =>
      page(Interleaved, {
        setup: () => provideContext(Who, user),
        around: (run) => withRequest(requestFrom(user), run),
      });

    const adaPage = render('ada');
    const gracePage = await render('grace');
    release();
    const adaPageDone = await adaPage;

    expect(pairs).toEqual([
      'ada saw ada',
      'grace saw grace',
      'grace saw grace',
      'grace saw grace',
      'ada saw ada',
      'ada saw ada',
    ]);
    expect(payload(adaPageDone.state)).toEqual({ steps: 3 });
    expect(payload(gracePage.state)).toEqual({ steps: 3 });
    expect(adaPageDone.html).toContain('ada');
    expect(gracePage.html).toContain('grace');
  });

  it('leave no request behind once they have answered', async () => {
    @Component({ selector: 'v-leftover', render: compileTemplate(`<p>x</p>`) })
    class Leftover {
      constructor() {
        void account.plan().catch(() => {});
      }
    }

    await page(Leftover, { around: (run) => withRequest(requestFrom('ada'), run) });

    // Held in the guard's own slot for the length of a span and put back, never
    // in request state — which, outside a request scope, is the process's, and
    // a request left there would be the next caller's.
    expect(() => guard(session)).toThrow(/outside the first statement/);
  });
});
