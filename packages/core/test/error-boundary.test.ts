/**
 * Error boundaries, end to end.
 *
 * A boundary is a scope that declares itself one, so nothing here is a new
 * kind of tree: a component's error travels the same parent chain its
 * disposal does. What `errorBoundary` adds is the recovery — the failed
 * subtree is disposed before the fallback is built, and retrying builds it
 * again from its inputs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compileTemplate } from '@voltdev/core/jit';
import {
  Component,
  Prop,
  Signal,
  createRoot,
  errorBoundary,
  flushSync,
  mount,
  onCleanup,
  onError,
  renderEffect,
  setErrorReporter,
  tick,
  type ErrorReport,
  type OnMount,
} from '@voltdev/core';
// The entry compiled output reaches: a boundary is written against the same
// runtime a template is generated against.
import { createComponent, insert, on } from '@voltdev/core/runtime';

let host: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  host = document.querySelector('#app')!;
});

afterEach(() => {
  setErrorReporter(null);
  vi.restoreAllMocks();
});

/** Nothing here should reach the console; silencing it is how that is read. */
function silenceConsole() {
  return vi.spyOn(console, 'error').mockImplementation(() => {});
}

/** A component that throws from its template when told to. */
@Component({ selector: 'v-fragile', render: compileTemplate(`<span>{ text() }</span>`) })
class Fragile {
  @Prop() fail = new Signal.State(false);

  text(): string {
    if (this.fail.get()) throw new Error('boom');
    return 'fine';
  }
}

describe('replacing a failed subtree', () => {
  it('shows the fallback when the subtree throws while it is being built', () => {
    silenceConsole();
    const failing = new Signal.State(true);

    @Component({
      selector: 'v-page',
      imports: [Fragile],
      render: (ctx) => {
        const el = document.createElement('div');
        insert(
          el,
          errorBoundary(
            () =>
              createComponent(
                ctx,
                'v-fragile',
                {
                  get fail() {
                    return failing.get();
                  },
                },
                null,
                null,
              ),
            { fallback: (error) => `broken: ${(error as Error).message}` },
          ),
        );
        return el;
      },
    })
    class Page {}

    mount(Page, host);

    expect(host.textContent).toBe('broken: boom');
  });

  it('shows the fallback when the subtree throws long after it was built', () => {
    silenceConsole();
    const failing = new Signal.State(false);

    @Component({
      selector: 'v-page',
      imports: [Fragile],
      render: (ctx) => {
        const el = document.createElement('div');
        insert(
          el,
          errorBoundary(
            () =>
              createComponent(
                ctx,
                'v-fragile',
                {
                  get fail() {
                    return failing.get();
                  },
                },
                null,
                null,
              ),
            { fallback: () => 'broken' },
          ),
        );
        return el;
      },
    })
    class Page {}

    mount(Page, host);
    expect(host.textContent).toBe('fine');

    failing.set(true);
    flushSync();

    expect(host.textContent).toBe('broken');
  });

  it('disposes everything below before the fallback mounts', () => {
    silenceConsole();
    const failing = new Signal.State(false);
    const order: string[] = [];
    let clicks = 0;
    const button = document.createElement('button');

    createRoot(() => {
      insert(
        host,
        errorBoundary(
          () => {
            onCleanup(() => order.push('cleanup'));
            on(button, 'click', () => clicks++);
            renderEffect(() => {
              if (failing.get()) throw new Error('boom');
            });
            return button;
          },
          {
            fallback: () => {
              order.push('fallback');
              return 'broken';
            },
          },
        ),
      );
    });
    flushSync();

    button.dispatchEvent(new Event('click'));
    expect(clicks).toBe(1);

    failing.set(true);
    flushSync();

    expect(host.textContent).toBe('broken');
    // Cleanups first, and the listener with them: the button is detached from
    // the document by now, but a handler that survived teardown would still
    // answer a synthetic event.
    expect(order).toEqual(['cleanup', 'fallback']);
    button.dispatchEvent(new Event('click'));
    expect(clicks).toBe(1);
  });

  it('builds the subtree again from its inputs when retried', () => {
    silenceConsole();
    const failing = new Signal.State(true);
    let built = 0;
    let retry: (() => void) | null = null;

    @Component({ selector: 'v-counted', render: compileTemplate(`<span>{ text() }</span>`) })
    class Counted {
      @Prop() fail = new Signal.State(false);

      constructor() {
        built++;
      }

      text(): string {
        if (this.fail.get()) throw new Error('boom');
        return `built ${built}`;
      }
    }

    @Component({
      selector: 'v-page',
      imports: [Counted],
      render: (ctx) => {
        const el = document.createElement('div');
        insert(
          el,
          errorBoundary(
            () =>
              createComponent(
                ctx,
                'v-counted',
                {
                  get fail() {
                    return failing.get();
                  },
                },
                null,
                null,
              ),
            {
              fallback: (_error, again) => {
                retry = again;
                return 'broken';
              },
            },
          ),
        );
        return el;
      },
    })
    class Page {}

    mount(Page, host);
    expect(host.textContent).toBe('broken');
    expect(built).toBe(1);

    failing.set(false);
    retry!();
    flushSync();

    // A second instance, constructed from scratch: a component holds no render
    // state, which is the whole reason retrying is allowed to mean this.
    expect(built).toBe(2);
    expect(host.textContent).toBe('built 2');
  });
});

describe('what the boundary decides', () => {
  it('swallows when it is told about the error and offers no fallback', () => {
    const console = silenceConsole();
    const seen: unknown[] = [];
    const failing = new Signal.State(false);

    createRoot(() => {
      insert(
        host,
        errorBoundary(
          () => {
            renderEffect(() => {
              if (failing.get()) throw new Error('boom');
            });
            return 'content';
          },
          { onError: (error) => void seen.push(error) },
        ),
      );
    });
    flushSync();

    failing.set(true);
    flushSync();

    expect(seen).toHaveLength(1);
    expect(host.textContent).toBe('content');
    expect(console).not.toHaveBeenCalled();
  });

  it('sends the error to the boundary above when its handler throws', () => {
    silenceConsole();

    createRoot(() => {
      insert(
        host,
        errorBoundary(
          () =>
            errorBoundary(
              () => {
                throw new Error('boom');
              },
              {
                onError: (error) => {
                  throw error;
                },
                fallback: () => 'inner',
              },
            ),
          { fallback: () => 'outer' },
        ),
      );
    });
    flushSync();

    expect(host.textContent).toBe('outer');
  });

  it('sends a fallback that throws to the boundary above rather than looping', () => {
    silenceConsole();

    createRoot(() => {
      insert(
        host,
        errorBoundary(
          () =>
            errorBoundary(
              () => {
                throw new Error('boom');
              },
              {
                fallback: () => {
                  throw new Error('the fallback is broken too');
                },
              },
            ),
          { fallback: (error) => `outer: ${(error as Error).message}` },
        ),
      );
    });
    flushSync();

    expect(host.textContent).toBe('outer: the fallback is broken too');
  });

  it('keeps two boundaries in the same template apart', () => {
    silenceConsole();
    const left = new Signal.State(false);
    const right = new Signal.State(false);

    const fragile = (failing: Signal.State<boolean>) => () => {
      renderEffect(() => {
        if (failing.get()) throw new Error('boom');
      });
      return 'ok';
    };

    const first = host.appendChild(document.createElement('span'));
    const second = host.appendChild(document.createElement('span'));

    createRoot(() => {
      insert(first, errorBoundary(fragile(left), { fallback: () => 'left broken' }));
      insert(second, errorBoundary(fragile(right), { fallback: () => 'right broken' }));
    });
    flushSync();
    expect(host.textContent).toBe('okok');

    left.set(true);
    flushSync();

    // Both were declared while the same scope was current, so a boundary that
    // did not take a scope of its own would have replaced the other.
    expect(first.textContent).toBe('left broken');
    expect(second.textContent).toBe('ok');

    right.set(true);
    flushSync();
    expect(second.textContent).toBe('right broken');
  });
});

describe('a component as its own boundary', () => {
  it('catches its own subtree and no wider', () => {
    const console = silenceConsole();
    const seen: unknown[] = [];

    @Component({ selector: 'v-boom', render: compileTemplate(`<span>{ boom() }</span>`) })
    class Boom {
      boom(): string {
        throw new Error('boom');
      }
    }

    @Component({
      selector: 'v-guard',
      imports: [Boom],
      render: compileTemplate(`<div><v-boom></v-boom></div>`),
    })
    class Guard {
      constructor() {
        onError((error) => void seen.push(error));
      }
    }

    @Component({
      selector: 'v-page',
      imports: [Guard, Boom],
      render: compileTemplate(`<div><v-guard></v-guard><v-boom></v-boom></div>`),
    })
    class Page {}

    mount(Page, host);

    // One of the two failures is the guard's own child; the other is its
    // sibling, and belongs to nothing the guard owns.
    expect(seen).toHaveLength(1);
    expect(console).toHaveBeenCalledTimes(1);
  });
});

describe('the global hook', () => {
  it('names the component, its props and its scope', () => {
    silenceConsole();
    const reports: ErrorReport[] = [];
    setErrorReporter((report) => void reports.push(report));

    @Component({
      selector: 'v-page',
      imports: [Fragile],
      render: (ctx) => {
        const el = document.createElement('div');
        insert(
          el,
          errorBoundary(() => createComponent(ctx, 'v-fragile', { fail: true }, null, null), {
            fallback: () => 'broken',
          }),
        );
        return el;
      },
    })
    class Page {}

    mount(Page, host);

    expect(reports).toHaveLength(1);
    expect(reports[0]!.error).toBeInstanceOf(Error);
    expect(reports[0]!.component).toBeInstanceOf(Fragile);
    expect(reports[0]!.props).toEqual({ fail: true });
    expect(reports[0]!.scope).not.toBeNull();
    // A boundary dealt with it, and the application still hears about it.
    expect(reports[0]!.handled).toBe(true);
  });

  it('reports an error from a component that has no boundary above it', () => {
    const console = silenceConsole();
    const reports: ErrorReport[] = [];
    setErrorReporter((report) => void reports.push(report));

    @Component({
      selector: 'v-page',
      imports: [Fragile],
      render: compileTemplate(`<div><v-fragile :fail="true"></v-fragile></div>`),
    })
    class Page {}

    mount(Page, host);

    expect(reports).toHaveLength(1);
    expect(reports[0]!.handled).toBe(false);
    expect(reports[0]!.component).toBeInstanceOf(Fragile);
    // The reporter took over from the console rather than joining it.
    expect(console).not.toHaveBeenCalled();
  });
});

describe('lifecycle', () => {
  it('takes an error thrown from onMount to the boundary too', async () => {
    silenceConsole();

    @Component({ selector: 'v-late', render: compileTemplate(`<span>mounted</span>`) })
    class Late implements OnMount {
      onMount(): void {
        throw new Error('late');
      }
    }

    @Component({
      selector: 'v-page',
      imports: [Late],
      render: (ctx) => {
        const el = document.createElement('div');
        insert(
          el,
          errorBoundary(() => createComponent(ctx, 'v-late', null, null, null), {
            fallback: (error) => `broken: ${(error as Error).message}`,
          }),
        );
        return el;
      },
    })
    class Page {}

    mount(Page, host);
    expect(host.textContent).toBe('mounted');

    // `onMount` runs in a microtask of its own, by which time the call that
    // created it has returned and nothing on the stack could answer for it.
    await tick();
    flushSync();

    expect(host.textContent).toBe('broken: late');
  });
});
