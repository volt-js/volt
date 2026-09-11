/**
 * The error codes, held to the things that make a code worth having.
 *
 * A production error carries a code and a link to `voltjs.dev/e/<code>`, and
 * the page behind that link is generated from the source by the extraction this
 * test shares with the documentation build. So these are the promises the link
 * makes, checked at the source rather than trusted:
 *
 * **A code names one failure.** V0401 once named two — a portal target and a
 * hydration-state serialisation — because a code was picked for one without
 * searching for it. A report grouping by code merged them, and the link sent
 * both to one page. The test that would have caught it is simple: a code is
 * thrown from one module.
 *
 * **Every sentence is guarded where it is written.** Four component messages
 * were passed without `__VOLT_DEV__ &&`. None of them reached a production
 * bundle — each throw already sat inside a development-only check, so the
 * minifier removed it whole — but that is a property of the code around the
 * call, and it stops holding the day one of those checks is made in
 * production too. The guard at the call site is what keeps a sentence out
 * whatever its surroundings become, so it is required at every one.
 *
 * **The page says the right thing about production.** Whether a code can be
 * thrown by a production build at all is asked of a real one; a check that
 * exists only in development gets a page saying so, rather than a description
 * of a production error nobody will ever see.
 *
 * **There is a sentence at all**, and a family it belongs to.
 */
import { describe, expect, it } from 'vitest';
import { errorCodes, FAMILIES, renderErrorPage } from '../../../docs/.vitepress/error-codes.js';

const codes = errorCodes();

describe('every error code', () => {
  it('is found, so the rest of this file is checking something', () => {
    expect(codes.length).toBeGreaterThan(10);
  });

  it.each(codes.map((c) => [c.code, c] as const))('%s names one failure', (_, code) => {
    const modules = new Set(code.sites.map((site) => `${site.package}/${site.file}`));
    expect([...modules], `${code.code} is thrown from more than one module`).toHaveLength(1);
  });

  it.each(codes.map((c) => [c.code, c] as const))('%s guards its sentence at every call site', (_, code) => {
    expect(code.stripped, `${code.code} passes its message without __VOLT_DEV__ &&`).toBe(true);
  });

  it.each(codes.map((c) => [c.code, c] as const))('%s has a sentence and a family', (_, code) => {
    expect(code.message.length, `${code.code} has no development message`).toBeGreaterThan(10);
    expect(code.message).not.toContain('undefined');
    expect(Object.values(FAMILIES)).toContain(code.family);
  });

  it('knows which codes a production build can throw', () => {
    const byCode = new Map(codes.map((c) => [c.code, c]));
    // A check that production does not make, and a failure it has to report.
    // One of each, so an extraction that called everything one or the other —
    // a build that forgot to define the flag — is caught.
    expect(byCode.get('V0208')?.inProduction).toBe(false);
    expect(byCode.get('V0212')?.inProduction).toBe(true);
  });

  it('describes a production error only for a code production can throw', () => {
    for (const code of codes) {
      const page = renderErrorPage(code);
      if (code.inProduction) expect(page).toContain(`[volt] ${code.code} `);
      else expect(page).toContain('never appears in a production error');
    }
  });

  it('renders a page for each, which is what the link in a production error opens', () => {
    for (const code of codes) {
      const page = renderErrorPage(code);
      expect(page).toContain(`# ${code.code}`);
      expect(page).toContain(code.family);
    }
  });
});
