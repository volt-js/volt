/**
 * `volt` — the command line.
 *
 * The command is a function of its arguments and an I/O object, exactly as in
 * `create-volt`, so a test drives the real thing rather than a rehearsal of
 * it. `cli.ts` is the only file here that knows `process` exists.
 *
 * There is one command, and it is the one that cannot live in the Vite plugin:
 * type-checking template expressions needs a type checker, and the transform
 * has none — oxc strips types without ever checking them. See `check.ts`.
 */

import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { checkTemplates } from './check.js';
import { formatReport } from './report.js';

export { checkTemplates, display } from './check.js';
export type { CheckOptions, CheckResult, TemplateDiagnostic } from './check.js';
export { formatDiagnostic, formatReport } from './report.js';

export interface Cli {
  readonly cwd: string;
  /** Ordinary output, findings included — they are the answer, not a failure. */
  write(text: string): void;
  /** The command itself going wrong. */
  fail(text: string): void;
}

function usage(): string {
  return [
    "Type-check the expressions in every component's template.",
    '',
    'Usage',
    '  volt check [options]',
    '',
    'Options',
    '  -p, --project <path>  tsconfig to check. Defaults to ./tsconfig.json',
    '  -h, --help            Show this',
    '  -v, --version         Print the version',
    '',
  ].join('\n');
}

async function version(): Promise<string> {
  // Beside the built entry as it is beside the source: `dist/index.js` and
  // `src/index.ts` are both one level under the package root.
  const manifest = resolve(import.meta.dirname, '../package.json');
  const { version: value } = JSON.parse(await readFile(manifest, 'utf8')) as { version: string };
  return value;
}

export async function main(argv: readonly string[], cli: Cli): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: {
        project: { type: 'string', short: 'p' },
        help: { type: 'boolean', short: 'h', default: false },
        version: { type: 'boolean', short: 'v', default: false },
      },
    });
  } catch (error) {
    cli.fail(error instanceof Error ? error.message : String(error));
    cli.fail(usage());
    return 1;
  }

  const { values, positionals } = parsed;
  if (values.help) {
    cli.write(usage());
    return 0;
  }
  if (values.version) {
    cli.write(await version());
    return 0;
  }

  const command = positionals[0];
  if (command === undefined) {
    cli.fail(usage());
    return 1;
  }
  if (command !== 'check') {
    cli.fail(`Unknown command \`${command}\`.`);
    cli.fail(usage());
    return 1;
  }

  return check(values.project, cli);
}

async function check(project: string | undefined, cli: Cli): Promise<number> {
  const config = resolve(cli.cwd, project ?? 'tsconfig.json');

  let result;
  try {
    result = await checkTemplates({ project: config, cwd: cli.cwd });
  } catch (error) {
    // A project that does not load, a checker that will not start: the run
    // produced no answer, which is not the same as producing a clean one.
    cli.fail(`[volt:check] ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }

  // Relative to where the command was run, which is where the paths it prints
  // have to be typed back in.
  cli.write(formatReport(result, cli.cwd));
  return result.diagnostics.length === 0 ? 0 : 1;
}
