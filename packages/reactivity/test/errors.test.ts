/**
 * Where a thrown error goes.
 *
 * The scope tree is the route: an error walks up from the scope that produced
 * it until a scope says it is a boundary. Nothing about that route is new
 * structure — these tests are as much about what the scope chain already meant
 * as about the channel laid over it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createRoot,
  disposeScope,
  effect,
  flushSync,
  getScope,
  onCleanup,
  onError,
  raiseError,
  setErrorReporter,
  type ErrorReport,
  type Scope,
} from '@voltdev/reactivity';

afterEach(() => {
  setErrorReporter(null);
  vi.restoreAllMocks();
});

/** The console is the fallback, so silencing it is how a test reads it. */
function silenceConsole() {
  return vi.spyOn(console, 'error').mockImplementation(() => {});
}

describe('the route to a boundary', () => {
  it('takes an effect error to the nearest boundary rather than the console', () => {
    const console = silenceConsole();
    const boom = new Error('boom');
    const seen: unknown[] = [];

    const dispose = createRoot((d) => {
      onError((error) => void seen.push(error));
      effect(() => {
        throw boom;
      });
      return d;
    });
    flushSync();

    expect(seen).toEqual([boom]);
    expect(console).not.toHaveBeenCalled();
    dispose();
  });

  it('hands the boundary the scope that produced the error', () => {
    silenceConsole();
    let produced: Scope | null = null;
    let inside: Scope | null = null;

    const dispose = createRoot((d) => {
      onError((_error, scope) => {
        produced = scope;
      });
      effect(() => {
        inside = getScope();
        throw new Error('boom');
      });
      return d;
    });
    flushSync();

    expect(inside).not.toBeNull();
    expect(produced).toBe(inside);
    dispose();
  });

  it('stops at the first boundary and leaves the one above it alone', () => {
    silenceConsole();
    const outer: unknown[] = [];
    const inner: unknown[] = [];
    const boom = new Error('boom');

    const dispose = createRoot((d) => {
      onError((error) => void outer.push(error));
      createRoot(() => {
        onError((error) => void inner.push(error));
        effect(() => {
          throw boom;
        });
      });
      return d;
    });
    flushSync();

    expect(inner).toEqual([boom]);
    expect(outer).toEqual([]);
    dispose();
  });

  it('does not carry an error across to a sibling subtree', () => {
    silenceConsole();
    const sibling: unknown[] = [];

    const dispose = createRoot((d) => {
      createRoot(() => {
        onError((error) => void sibling.push(error));
      });
      createRoot(() => {
        effect(() => {
          throw new Error('boom');
        });
      });
      return d;
    });
    flushSync();

    expect(sibling).toEqual([]);
    dispose();
  });

  it('reaches the console when nothing above declares itself a boundary', () => {
    const console = silenceConsole();
    const boom = new Error('boom');

    const dispose = createRoot((d) => {
      effect(() => {
        throw boom;
      });
      return d;
    });
    flushSync();

    expect(console).toHaveBeenCalledWith(expect.stringContaining('Uncaught error'), boom);
    dispose();
  });

  it('takes an error from a cleanup as well as from a run', () => {
    silenceConsole();
    const boom = new Error('cleanup');
    const seen: unknown[] = [];

    const dispose = createRoot((d) => {
      onError((error) => void seen.push(error));
      createRoot(() => {
        onCleanup(() => {
          throw boom;
        });
      });
      return d;
    });
    flushSync();
    dispose();

    expect(seen).toEqual([boom]);
  });

  it('warns rather than silently registering a boundary with no scope', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    onError(() => {});
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('outside a reactive scope'));
  });
});

describe('what a boundary decides', () => {
  it('swallows by returning', () => {
    const console = silenceConsole();

    const dispose = createRoot((d) => {
      onError(() => {});
      effect(() => {
        throw new Error('boom');
      });
      return d;
    });
    flushSync();

    expect(console).not.toHaveBeenCalled();
    dispose();
  });

  it('sends the error on by throwing it', () => {
    silenceConsole();
    const outer: unknown[] = [];
    const boom = new Error('boom');

    const dispose = createRoot((d) => {
      onError((error) => void outer.push(error));
      createRoot(() => {
        onError((error) => {
          throw error;
        });
        effect(() => {
          throw boom;
        });
      });
      return d;
    });
    flushSync();

    expect(outer).toEqual([boom]);
    dispose();
  });

  it('may send a different error on than the one it was given', () => {
    silenceConsole();
    const outer: unknown[] = [];
    const translated = new Error('could not load the profile');

    const dispose = createRoot((d) => {
      onError((error) => void outer.push(error));
      createRoot(() => {
        onError(() => {
          throw translated;
        });
        effect(() => {
          throw new Error('404');
        });
      });
      return d;
    });
    flushSync();

    expect(outer).toEqual([translated]);
    dispose();
  });

  it('sends an error raised while it is recovering to the boundary above', () => {
    silenceConsole();
    const above: unknown[] = [];
    const fromCleanup = new Error('cleanup');
    let failing: Scope | null = null;

    const dispose = createRoot((d) => {
      onError((error) => void above.push(error));
      createRoot(() => {
        // What recovery does: tear the failed subtree down. A cleanup in it
        // throws, and that must not come back round to this boundary.
        onError(() => disposeScope(failing!));
        createRoot(() => {
          failing = getScope();
          onCleanup(() => {
            throw fromCleanup;
          });
          effect(() => {
            throw new Error('boom');
          });
        });
      });
      return d;
    });
    flushSync();

    expect(above).toEqual([fromCleanup]);
    dispose();
  });
});

describe('the global hook', () => {
  it('sees errors a boundary swallowed as well as ones nothing took', () => {
    silenceConsole();
    const reports: ErrorReport[] = [];
    setErrorReporter((report) => void reports.push(report));

    const handled = new Error('handled');
    const unhandled = new Error('unhandled');

    const dispose = createRoot((d) => {
      createRoot(() => {
        onError(() => {});
        effect(() => {
          throw handled;
        });
      });
      createRoot(() => {
        effect(() => {
          throw unhandled;
        });
      });
      return d;
    });
    flushSync();

    expect(reports.map((report) => report.error)).toEqual([handled, unhandled]);
    expect(reports.map((report) => report.handled)).toEqual([true, false]);
    dispose();
  });

  it('takes over from the console', () => {
    const console = silenceConsole();
    setErrorReporter(() => {});

    const dispose = createRoot((d) => {
      effect(() => {
        throw new Error('boom');
      });
      return d;
    });
    flushSync();

    expect(console).not.toHaveBeenCalled();
    dispose();
  });

  it('names the scope that produced the error, and no component outside one', () => {
    silenceConsole();
    const reports: ErrorReport[] = [];
    setErrorReporter((report) => void reports.push(report));
    let inside: Scope | null = null;

    const dispose = createRoot((d) => {
      effect(() => {
        inside = getScope();
        throw new Error('boom');
      });
      return d;
    });
    flushSync();

    expect(reports).toHaveLength(1);
    expect(reports[0]!.scope).toBe(inside);
    expect(reports[0]!.component).toBeNull();
    expect(reports[0]!.props).toBeNull();
    dispose();
  });

  it('does not let a reporter that throws take the flush down with it', () => {
    const console = silenceConsole();
    const boom = new Error('boom');
    setErrorReporter(() => {
      throw new Error('the reporter is broken too');
    });

    const dispose = createRoot((d) => {
      effect(() => {
        throw boom;
      });
      return d;
    });
    expect(() => flushSync()).not.toThrow();

    // The error that mattered still gets out, by the route the reporter was
    // meant to replace.
    expect(console).toHaveBeenCalledWith(expect.stringContaining('Uncaught error'), boom);
    dispose();
  });
});

describe('raising an error from outside the effect system', () => {
  it('travels the same route as one an effect threw', () => {
    silenceConsole();
    const seen: unknown[] = [];
    const boom = new Error('boom');

    const dispose = createRoot((d) => {
      onError((error) => void seen.push(error));
      const inner = createRoot((dd) => {
        raiseError(boom, getScope());
        return dd;
      });
      inner();
      return d;
    });

    expect(seen).toEqual([boom]);
    dispose();
  });
});
