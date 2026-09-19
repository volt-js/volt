/**
 * The two gates the server-rendering design sets for reactivity lanes and
 * request isolation (`docs/design/ssr.md`, §4.2).
 *
 * One: two concurrent renders, with their promises deliberately resolved in
 * the opposite order to the one they started in, produce exactly what the same
 * two renders produce one after the other. Anything a request holds that is
 * really process-global shows up here as a difference — the lanes an effect is
 * drained from, the styles a page collected, the ids it minted.
 *
 * Two: a resource declared as a class field fetches once on a server, and a
 * client-only build fetches nothing, because the whole server render path is
 * compiled out of it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compileTemplate } from '@voltdev/core/jit';
import {
  Component,
  Prop,
  createId,
  createRequestScope,
  mount,
  requestStyles,
  runInRequest,
  settleRequest,
} from '@voltdev/core';
import { createResource, resetLocaleCaches, useLocale } from '@voltdev/primitives';

/**
 * The build flag, which the test config compiles to a live read of this global
 * so one file can render both sides.
 */
function serverBuild(on: boolean): void {
  (globalThis as { __VOLT_SERVER__?: boolean }).__VOLT_SERVER__ = on;
}

/** A fetch nobody answers until the test says so. */
const pending = new Map<string, (value: string) => void>();

function answerable(name: string): Promise<string> {
  return new Promise<string>((resolve) => pending.set(name, resolve));
}

function answer(name: string, value: string): void {
  const resolve = pending.get(name);
  if (!resolve) throw new Error(`nothing is waiting on ${name}`);
  pending.delete(name);
  resolve(value);
}

/** Everything one request produced, as one string to compare byte for byte. */
async function renderRequest(component: Parameters<typeof mount>[0]): Promise<string> {
  const scope = createRequestScope();
  const host = document.createElement('div');
  await settleRequest(scope, () => {
    mount(component, host);
  });
  const styles = runInRequest(scope, () =>
    [...requestStyles()].map(([selector, css]) => `${selector}{${css}}`).join(''),
  );
  return `${host.innerHTML}<!--styles-->${styles}`;
}

beforeEach(() => {
  serverBuild(true);
  pending.clear();
  resetLocaleCaches();
});

afterEach(() => {
  serverBuild(false);
  resetLocaleCaches();
});

// ---------------------------------------------------------------------------
// Gate one: concurrent renders match serial ones
// ---------------------------------------------------------------------------

@Component({
  selector: 'v-alpha',
  styles: '.alpha { color: red }',
  render: compileTemplate(`<i :id="id">{ label }</i>`),
})
class Alpha {
  @Prop() label = '';
  id = createId('alpha');
}

@Component({
  selector: 'v-beta',
  styles: '.beta { color: blue }',
  render: compileTemplate(`<b :id="id">{ label }</b>`),
})
class Beta {
  @Prop() label = '';
  id = createId('beta');
}

@Component({
  selector: 'v-alpha-page',
  styles: '.page { margin: 0 }',
  imports: [Alpha],
  render: compileTemplate(
    `<section :id="id" :lang="locale.code()">
       <div :if="answer.data() !== undefined"><v-alpha :label="answer.data()"></v-alpha></div>
     </section>`,
  ),
})
class AlphaPage {
  id = createId('page');
  locale = useLocale();
  answer = createResource(() => answerable('alpha'));
}

@Component({
  selector: 'v-beta-page',
  styles: '.page { margin: 0 }',
  imports: [Beta],
  render: compileTemplate(
    `<section :id="id" :lang="locale.code()">
       <div :if="answer.data() !== undefined">
         <v-beta :label="answer.data()"></v-beta><v-beta :label="answer.data()"></v-beta>
       </div>
     </section>`,
  ),
})
class BetaPage {
  id = createId('page');
  locale = useLocale();
  answer = createResource(() => answerable('beta'));
}

/** Let every queued microtask and the timer queue drain. */
const turn = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('two renders at once', () => {
  it('produce what the same two renders produce one after the other', async () => {
    const firstAlone = renderRequest(AlphaPage);
    await turn();
    answer('alpha', 'A');
    const alphaSerial = await firstAlone;

    const secondAlone = renderRequest(BetaPage);
    await turn();
    answer('beta', 'B');
    const betaSerial = await secondAlone;

    // The comparison below is only worth making if the renders waited for
    // their data at all.
    expect(alphaSerial).toContain('>A</i>');
    expect(betaSerial).toContain('>B</b>');

    // Both in the air, and answered in the opposite order: the second render's
    // data lands first, so its flush is the one that resumes first while the
    // first render's effects are already dirty.
    const alphaConcurrent = renderRequest(AlphaPage);
    const betaConcurrent = renderRequest(BetaPage);
    await turn();
    answer('beta', 'B');
    answer('alpha', 'A');
    const [alpha, beta] = await Promise.all([alphaConcurrent, betaConcurrent]);

    expect(alpha).toBe(alphaSerial);
    expect(beta).toBe(betaSerial);
  });

  it('each collect only their own styles', async () => {
    const alpha = renderRequest(AlphaPage);
    const beta = renderRequest(BetaPage);
    await turn();
    answer('beta', 'B');
    answer('alpha', 'A');
    const [alphaOut, betaOut] = await Promise.all([alpha, beta]);

    expect(alphaOut).toContain('.alpha');
    expect(alphaOut).not.toContain('.beta');
    expect(betaOut).toContain('.beta');
    expect(betaOut).not.toContain('.alpha');
  });
});

describe('the ambient locale', () => {
  @Component({
    selector: 'v-lang',
    render: compileTemplate(`<p :lang="locale.code()">body</p>`),
  })
  class Lang {
    locale = useLocale();
  }

  const documentLang = document.documentElement.getAttribute('lang');

  afterEach(() => {
    if (documentLang === null) document.documentElement.removeAttribute('lang');
    else document.documentElement.setAttribute('lang', documentLang);
  });

  it('belongs to the request, not to whichever request asked first', async () => {
    document.documentElement.setAttribute('lang', 'de');
    const first = await renderRequest(Lang);

    document.documentElement.setAttribute('lang', 'fr');
    const second = await renderRequest(Lang);

    expect(first).toContain('lang="de"');
    expect(second).toContain('lang="fr"');
  });
});

// ---------------------------------------------------------------------------
// Gate two: a resource in a class field
// ---------------------------------------------------------------------------

/** What every fetcher below has been asked for, in order. */
let asked: string[] = [];

@Component({
  selector: 'v-loader',
  render: compileTemplate(`<p>{ answer.data() ?? 'waiting' }</p>`),
})
class Loader {
  @Prop() query = 'unset';
  answer = createResource<string, string>(
    async ({ source }) => {
      asked.push(source);
      return `answered ${source}`;
    },
    { source: () => this.query },
  );
}

@Component({
  selector: 'v-loader-host',
  imports: [Loader],
  render: compileTemplate(`<v-loader query="books"></v-loader>`),
})
class LoaderHost {}

@Component({
  selector: 'v-typeahead',
  render: compileTemplate(`<p>{ answer.data() ?? 'waiting' }</p>`),
})
class Typeahead {
  answer = createResource(
    async () => {
      asked.push('typed');
      return 'answered typed';
    },
    // Written for a search box, where the wait exists to coalesce keystrokes.
    { debounce: 50, throttle: 50 },
  );
}

@Component({
  selector: 'v-flaky',
  render: compileTemplate(`<p>{ answer.data() ?? 'waiting' }</p>`),
})
class Flaky {
  answer = createResource<string>(
    async ({ attempt }) => {
      asked.push(`attempt ${attempt}`);
      if (attempt === 0) throw new Error('the gateway hiccuped');
      return 'answered on the second try';
    },
    // A schedule written for a phone on a bad connection, where waiting is
    // cheaper than asking again immediately.
    { retry: 1, retryDelay: () => 30_000 },
  );
}

@Component({
  selector: 'v-profile',
  render: compileTemplate(`<p>{ profile.data() ?? 'waiting' }</p>`),
})
class Profile {
  user = createResource(async () => {
    asked.push('user');
    return 'ada';
  });
  profile = createResource<string, string | undefined>(
    async ({ source }) => {
      asked.push(`profile of ${source}`);
      return `${source}'s profile`;
    },
    { source: () => this.user.data(), enabled: () => this.user.data() !== undefined },
  );
}

@Component({
  selector: 'v-asked-by-hand',
  render: compileTemplate(`<p>{ answer.status() }: { answer.data() ?? 'waiting' }</p>`),
})
class AskedByHand {
  answer = createResource(() => answerable('by hand'), { immediate: false });
  // Asked for during construction rather than left to the resource's own
  // effect — which is how a submit-driven resource, or a cache entry, fetches.
  started = this.answer.refetch();
}

describe('a resource declared as a class field', () => {
  beforeEach(() => {
    asked = [];
  });

  it('makes the render wait for a refetch it was asked for by hand', async () => {
    // An explicit fetch is still one the page needs: a render that finished
    // without it would ship the spinner in place of the answer.
    const html = renderRequest(AskedByHand);
    await turn();
    answer('by hand', 'answered by hand');

    expect(await html).toContain('<p>success: answered by hand</p>');
  });

  it('fetches exactly once on a server, and the render waits for the answer', async () => {
    const html = await renderRequest(LoaderHost);

    // Once, and for the prop assigned after construction — which is why the
    // trigger is a deferred effect, and why it had to become a lane of its own
    // rather than stop being deferred.
    expect(asked).toEqual(['books']);
    expect(html).toContain('<p>answered books</p>');
  });

  it('does not make a server wait out a debounce meant for keystrokes', async () => {
    // A wait the request does not know about is a page shipped without its
    // data: the render would finish before the timer fired.
    const html = await renderRequest(Typeahead);

    expect(asked).toEqual(['typed']);
    expect(html).toContain('<p>answered typed</p>');
  });

  it('does not make a server wait out a retry backoff meant for a bad connection', async () => {
    // Same argument as the debounce above, and the same failure if it is not
    // followed through: the wait happens inside `settleRequest`, so it is not
    // a page shipped without its data but a response holding its socket open
    // for half a minute.
    const html = await renderRequest(Flaky);

    expect(asked).toEqual(['attempt 0', 'attempt 1']);
    expect(html).toContain('<p>answered on the second try</p>');
  });

  it("waits for a resource whose source is another resource's data", async () => {
    // Two rounds of the settle loop, which is the whole reason it is a loop:
    // the second fetch does not exist until the first has answered.
    const html = await renderRequest(Profile);

    expect(asked).toEqual(['user', 'profile of ada']);
    expect(html).toContain("<p>ada's profile</p>");
  });

  it('fetches nothing in a client-only build, where the render is compiled out', async () => {
    serverBuild(false);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const scope = createRequestScope();

    await settleRequest(scope, () => {
      mount(LoaderHost, document.createElement('div'));
    });
    await turn();

    expect(asked).toEqual([]);
    expect(warn.mock.calls[0]?.[0]).toContain('client build');
    warn.mockRestore();
  });
});
