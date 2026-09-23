/**
 * What a template turns into, asserted as data.
 *
 * `renderProject` returns the whole project in memory, so the expected tree is
 * written out in full rather than sampled. A file that quietly stops being
 * generated is the failure this is here to catch, and a spot-check of three
 * paths would not catch it.
 */
import { describe, expect, it } from 'vitest';
import { PROJECT_NAME_TOKEN, projectManifest, renderProject } from '../src/scaffold.js';
import { TEMPLATES, findTemplate, type TemplateDefinition } from '../src/templates.js';
import { VERSIONS } from '../src/versions.js';

const template = (id: string): TemplateDefinition => {
  const found = findTemplate(id);
  if (!found) throw new Error(`no template ${id}`);
  return found;
};

const render = (id: string, name = 'my-app'): Promise<Map<string, string>> =>
  renderProject({ name, template: template(id) });

describe('the minimal template', () => {
  it('generates exactly this tree', async () => {
    expect([...(await render('minimal')).keys()]).toEqual([
      '.gitignore',
      'README.md',
      'index.html',
      'package.json',
      'src/app.html',
      'src/app.scss',
      'src/app.test.ts',
      'src/app.ts',
      'src/main.ts',
      'src/styles.scss',
      'tsconfig.json',
      'vite.config.ts',
      'vitest.config.ts',
    ]);
  });
});

describe('the router-query template', () => {
  it('generates exactly this tree', async () => {
    expect([...(await render('router-query')).keys()]).toEqual([
      '.gitignore',
      'README.md',
      'index.html',
      'package.json',
      'src/api.ts',
      'src/app.test.ts',
      'src/cache.ts',
      'src/home.html',
      'src/home.ts',
      'src/main.ts',
      'src/router.ts',
      'src/shell.html',
      'src/shell.scss',
      'src/shell.ts',
      'src/styles.scss',
      'src/user.html',
      'src/user.scss',
      'src/user.ts',
      'src/users.html',
      'src/users.scss',
      'src/users.ts',
      'tsconfig.json',
      'vite.config.ts',
      'vitest.config.ts',
    ]);
  });

  it('wires the router and the cache together', async () => {
    const files = await render('router-query');
    expect(files.get('src/router.ts')).toContain('createRouter');
    // The outlet is what makes a layout a layout; without it the router
    // throws on the first navigation into a child route.
    expect(files.get('src/shell.html')).toContain(':outlet');
  });
});

describe('the server-render template', () => {
  it('turns the mode on in one line, and nothing else configures it', async () => {
    const files = await render('server-render');
    // The claim the template exists to make: the wiring is one option, not a
    // page of setup a reader has to keep in their head.
    expect(files.get('vite.config.ts')).toContain('volt({ serverRender: true })');
  });

  it('says where each route is rendered, all three ways', async () => {
    const routes = files_(await render('server-render'), 'src/routes.ts');
    // A template that demonstrated only server rendering would demonstrate
    // half of it. The point is that the choice survives per route.
    expect(routes).toContain("mode: 'ssg'");
    expect(routes).toContain("mode: 'ssr'");
    expect(routes).toContain("mode: 'csr'");
  });

  it('ships a deployable entry that is a Request in and a Response out', async () => {
    const files = await render('server-render');
    const server = files_(files, 'server.ts');
    expect(server).toContain("from 'virtual:volt/server'");
    expect(server).toContain('export default { fetch: handler }');
    // No `node:` *import* — the file says the words in a comment explaining
    // why, so the assertion has to be about the import and not the string.
    // This is what makes it deployable to an edge runtime, and it is the same
    // claim `renderPath` enforces as the project grows.
    expect(server).not.toMatch(/from\s+['"]node:/);
    expect(server).not.toMatch(/import\s*\(\s*['"]node:/);
    // Nothing to hand it: the page it renders into is the client build's own,
    // which the plugin serves. A shell imported here was the source page, and
    // its script is a file the build does not produce.
    expect(server).not.toContain('setShell');
    expect(server).not.toContain('?raw');
  });

  it('finds its router in scope rather than making one at module scope', async () => {
    // A module-scope router on a server is one page's location shown to every
    // request in flight.
    const app = files_(await render('server-render'), 'src/app.ts');
    expect(app).toContain('useRouter()');
    expect(app).not.toContain('createRouter');
  });

  it('gets the pricing page its data from a loader, which is in place before the render', async () => {
    // A fetch started while rendering answers after the bytes it would have
    // filled are written; a loader answers before the first one.
    const files = await render('server-render');
    expect(files_(files, 'src/routes.ts')).toContain('loader: () => currentPlan()');
    const pricing = files_(files, 'src/pricing.ts');
    expect(pricing).toContain('routeData<string>()');
    expect(pricing).not.toContain('constructor');
  });

  it('reaches the generated client through its own entry', async () => {
    const files = await render('server-render');
    expect(files.get('index.html')).toContain('/src/main.ts');
    expect(files_(files, 'src/main.ts')).toContain("'virtual:volt/client'");
  });

  it('declares the virtual modules, so the project type-checks without the plugin running', async () => {
    const files = await render('server-render');
    const types = files_(files, 'src/volt-server-render.d.ts');
    expect(types).toContain("declare module 'virtual:volt/server'");
    expect(types).toContain("declare module 'virtual:volt/client'");
    expect(types).toContain("declare module 'virtual:volt/shell'");
    expect(types).not.toContain('setShell');
  });
});

describe('every template', () => {
  it.each(TEMPLATES)('$id ships a test, an entry point and a page', async ({ id }) => {
    const files = await render(id);
    expect(files.has('src/app.test.ts')).toBe(true);
    expect(files.has('src/main.ts')).toBe(true);
    expect(files.has('index.html')).toBe(true);
  });

  it.each(TEMPLATES)('$id leaves no unreplaced token behind', async ({ id }) => {
    for (const [path, contents] of await render(id, 'chosen-name')) {
      expect(contents, path).not.toContain(PROJECT_NAME_TOKEN);
    }
  });

  it.each(TEMPLATES)('$id puts the project name in the page title', async ({ id }) => {
    const files = await render(id, 'chosen-name');
    expect(files.get('index.html')).toContain('<title>chosen-name</title>');
  });

  /**
   * Stored as `gitignore` and written as `.gitignore`: npm strips a
   * `.gitignore` out of a published tarball, so the template cannot keep one
   * under its real name.
   */
  it.each(TEMPLATES)('$id renames its ignore file on the way out', async ({ id }) => {
    const files = await render(id);
    expect(files.has('.gitignore')).toBe(true);
    expect(files.has('gitignore')).toBe(false);
  });

  it.each(TEMPLATES)('$id renders identically twice', async ({ id }) => {
    expect([...(await render(id))]).toEqual([...(await render(id))]);
  });
});

describe('the generated manifest', () => {
  it('takes every version from VERSIONS', () => {
    for (const definition of TEMPLATES) {
      const manifest = JSON.parse(projectManifest({ name: 'my-app', template: definition }));
      const declared = { ...manifest.dependencies, ...manifest.devDependencies };

      for (const [name, range] of Object.entries(declared)) {
        expect(range, `${definition.id} pins ${name}`).toBe(
          VERSIONS[name as keyof typeof VERSIONS],
        );
      }
    }
  });

  it('is private, so a stray publish cannot happen', () => {
    const manifest = JSON.parse(projectManifest({ name: 'my-app', template: template('minimal') }));
    expect(manifest.private).toBe(true);
    expect(manifest.name).toBe('my-app');
  });

  it('gives the project the four commands its README promises', () => {
    const manifest = JSON.parse(projectManifest({ name: 'my-app', template: template('minimal') }));
    expect(Object.keys(manifest.scripts)).toEqual(
      expect.arrayContaining(['dev', 'build', 'test', 'typecheck']),
    );
  });
});

/** A file the template must have, read out with a message when it does not. */
function files_(files: Map<string, string>, path: string): string {
  const contents = files.get(path);
  if (contents === undefined) {
    throw new Error(`the template has no ${path} — it has ${[...files.keys()].sort().join(', ')}`);
  }
  return contents;
}
