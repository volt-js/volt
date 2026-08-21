/**
 * The command, driven the way a terminal drives it.
 *
 * `main` takes its I/O as an argument, so these are the real argument parsing,
 * the real prompts and the real writes — not a rehearsal. The only thing not
 * exercised is `cli.ts`, which does nothing but turn `process` into this.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main, type Cli } from '../src/index.js';

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function directory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'create-volt-'));
  temporary.push(path);
  return path;
}

interface Recorded extends Cli {
  readonly out: string[];
  readonly errors: string[];
}

/** A terminal that answers, or — with no answers — a pipe that cannot. */
function recorder(cwd: string, answers?: readonly string[]): Recorded {
  const out: string[] = [];
  const errors: string[] = [];
  const remaining = [...(answers ?? [])];

  return {
    cwd,
    out,
    errors,
    write: (text) => out.push(text),
    fail: (text) => errors.push(text),
    ...(answers
      ? { ask: async (_question: string, fallback: string) => remaining.shift() ?? fallback }
      : {}),
  };
}

describe('generating', () => {
  it('writes the project the template describes', async () => {
    const cwd = await directory();
    const cli = recorder(cwd);

    expect(await main(['app', '--template', 'minimal', '--yes'], cli)).toBe(0);

    const manifest = JSON.parse(await readFile(join(cwd, 'app/package.json'), 'utf8'));
    expect(manifest.name).toBe('app');
    expect(await readFile(join(cwd, 'app/src/app.ts'), 'utf8')).toContain('@Component');
    // The file npm would have stripped, under the name it has to land as.
    expect(await readFile(join(cwd, 'app/.gitignore'), 'utf8')).toContain('node_modules');
  });

  it('names the package after the directory, made legal', async () => {
    const cwd = await directory();
    expect(await main(['My App', '--yes'], recorder(cwd))).toBe(0);

    const manifest = JSON.parse(await readFile(join(cwd, 'My App/package.json'), 'utf8'));
    expect(manifest.name).toBe('my-app');
  });

  it('takes an explicit name over the directory', async () => {
    const cwd = await directory();
    expect(await main(['somewhere', '--name', 'chosen', '--yes'], recorder(cwd))).toBe(0);

    const manifest = JSON.parse(await readFile(join(cwd, 'somewhere/package.json'), 'utf8'));
    expect(manifest.name).toBe('chosen');
  });

  it('tells the reader what to run next', async () => {
    const cwd = await directory();
    const cli = recorder(cwd);
    await main(['app', '--yes'], cli);

    const said = cli.out.join('\n');
    expect(said).toContain('pnpm install');
    expect(said).toContain('pnpm dev');
  });
});

describe('refusing', () => {
  it('will not write into a directory that has something in it', async () => {
    const cwd = await directory();
    await mkdir(join(cwd, 'app'), { recursive: true });
    await writeFile(join(cwd, 'app/notes.txt'), 'mine');

    const cli = recorder(cwd);
    expect(await main(['app', '--yes'], cli)).toBe(1);
    expect(cli.errors.join('\n')).toContain('--force');
    // Untouched, which is the point of refusing.
    expect(await readFile(join(cwd, 'app/notes.txt'), 'utf8')).toBe('mine');
  });

  it('writes into it anyway when told to', async () => {
    const cwd = await directory();
    await mkdir(join(cwd, 'app'), { recursive: true });
    await writeFile(join(cwd, 'app/notes.txt'), 'mine');

    expect(await main(['app', '--yes', '--force'], recorder(cwd))).toBe(0);
    expect(await readFile(join(cwd, 'app/notes.txt'), 'utf8')).toBe('mine');
    expect(await readFile(join(cwd, 'app/package.json'), 'utf8')).toContain('"name": "app"');
  });

  /**
   * A repository someone has just `git init`-ed is empty as far as this is
   * concerned. Refusing it would mean the two commands cannot be run in the
   * order people actually run them.
   */
  it('counts a fresh git repository as empty', async () => {
    const cwd = await directory();
    await mkdir(join(cwd, 'app/.git'), { recursive: true });

    expect(await main(['app', '--yes'], recorder(cwd))).toBe(0);
  });

  it('rejects a name npm would reject, before anything is written', async () => {
    const cwd = await directory();
    const cli = recorder(cwd);

    expect(await main(['app', '--name', 'Not Valid', '--yes'], cli)).toBe(1);
    expect(cli.errors.join('\n')).toContain('--name');
    await expect(readFile(join(cwd, 'app/package.json'), 'utf8')).rejects.toThrow();
  });

  it('names the templates when asked for one that does not exist', async () => {
    const cli = recorder(await directory());
    expect(await main(['app', '--template', 'nope', '--yes'], cli)).toBe(1);
    expect(cli.errors.join('\n')).toContain('minimal');
  });

  /**
   * The gate that stops a project being generated that could not `pnpm
   * install` — see `PUBLISHED_PACKAGES`. The message has to say why, because
   * the alternative is a lockfile error several minutes later.
   */
  it('refuses a template whose packages are not on npm yet', async () => {
    const cli = recorder(await directory());
    expect(await main(['app', '--template', 'router-query', '--yes'], cli)).toBe(1);
    expect(cli.errors.join('\n')).toContain('not on npm yet');
  });
});

describe('asking', () => {
  it('takes the answers it is given', async () => {
    const cwd = await directory();
    const cli = recorder(cwd, ['chosen-directory']);

    expect(await main([], cli)).toBe(0);
    expect(
      JSON.parse(await readFile(join(cwd, 'chosen-directory/package.json'), 'utf8')).name,
    ).toBe('chosen-directory');
  });

  it('decides for itself when there is nobody to ask', async () => {
    const cwd = await directory();
    expect(await main([], recorder(cwd))).toBe(0);
    expect(await readFile(join(cwd, 'volt-app/package.json'), 'utf8')).toContain('"name": "volt-app"');
  });

  it('asks nothing at all with --yes', async () => {
    const cwd = await directory();
    const cli = recorder(cwd, ['never-read']);

    expect(await main(['--yes'], cli)).toBe(0);
    expect(await readFile(join(cwd, 'volt-app/package.json'), 'utf8')).toContain('"name": "volt-app"');
  });
});

describe('the incidental flags', () => {
  it('prints usage that lists every template', async () => {
    const cli = recorder(await directory());
    expect(await main(['--help'], cli)).toBe(0);

    const said = cli.out.join('\n');
    expect(said).toContain('minimal');
    // Said out loud, so nobody picks it and then cannot install it.
    expect(said).toContain('not published yet');
  });

  it('prints the version this package is on', async () => {
    const cli = recorder(await directory());
    expect(await main(['--version'], cli)).toBe(0);
    expect(cli.out.join('')).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('fails with usage on an argument it does not know', async () => {
    const cli = recorder(await directory());
    expect(await main(['--wat'], cli)).toBe(1);
    expect(cli.errors.join('\n')).toContain('Usage');
  });
});
