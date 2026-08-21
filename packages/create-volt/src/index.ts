/**
 * `create-volt` — a new Volt project, running in one command.
 *
 * The whole command is a function of its arguments and an I/O object, so a
 * test drives the real thing rather than a rehearsal of it: the same code
 * decides what to generate whether the answers came from a terminal or from
 * flags. `cli.ts` is the only part that knows about `process`.
 */

import { basename, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import {
  isValidProjectName,
  isWritableDirectory,
  renderProject,
  toProjectName,
  writeProject,
} from './scaffold.js';
import {
  DEFAULT_TEMPLATE,
  findTemplate,
  templateDependencies,
  TEMPLATES,
  type TemplateDefinition,
} from './templates.js';
import { unpublishedDependencies } from './versions.js';

export interface Cli {
  readonly cwd: string;
  /** Ordinary output. */
  write(text: string): void;
  /** Anything that went wrong. */
  fail(text: string): void;
  /**
   * Ask a question, or be absent.
   *
   * Absent is not an error state — it is a pipe, a CI job or `--yes`, all of
   * which mean "decide without me". Every question here therefore has an
   * answer that works when nobody is there to give one.
   */
  readonly ask?: (question: string, fallback: string) => Promise<string>;
}

/** A template that could be installed today. See `PUBLISHED_PACKAGES`. */
function isOffered(template: TemplateDefinition): boolean {
  return unpublishedDependencies(templateDependencies(template)).length === 0;
}

function usage(): string {
  const templates = TEMPLATES.map(
    (template) =>
      `  ${template.id.padEnd(14)}${template.summary}${isOffered(template) ? '' : ' (not published yet)'}`,
  ).join('\n');

  return [
    'Scaffold a Volt project.',
    '',
    'Usage',
    '  pnpm create @voltdev/volt [directory] [options]',
    '',
    'Options',
    '  -t, --template <id>  Which template to start from',
    '      --name <name>    Package name. Defaults to the directory name',
    '      --force          Write into a directory that is not empty',
    '  -y, --yes            Take every default; ask nothing',
    '  -h, --help           Show this',
    '  -v, --version        Print the version',
    '',
    'Templates',
    templates,
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

/** The chooser, for a terminal. Only templates an install could resolve. */
async function chooseTemplate(cli: Cli, ask: Cli['ask']): Promise<TemplateDefinition> {
  const offered = TEMPLATES.filter(isOffered);
  const fallback = offered[0] ?? (findTemplate(DEFAULT_TEMPLATE) as TemplateDefinition);
  // Nothing to choose between is not a question worth asking.
  if (!ask || offered.length < 2) return fallback;

  cli.write('Which template?');
  for (const [index, template] of offered.entries()) {
    cli.write(`  ${index + 1}) ${template.id.padEnd(14)}${template.summary}`);
  }

  const answer = (await ask('Template', '1')).trim();
  const byNumber = offered[Number(answer) - 1];
  return byNumber ?? offered.find((template) => template.id === answer) ?? fallback;
}

export async function main(argv: readonly string[], cli: Cli): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: {
        template: { type: 'string', short: 't' },
        name: { type: 'string' },
        force: { type: 'boolean', default: false },
        yes: { type: 'boolean', short: 'y', default: false },
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

  // `--yes` means the same as having nobody to ask, so both paths below are
  // the one path that has to work.
  const ask = values.yes ? undefined : cli.ask;

  const directory =
    positionals[0] ?? (ask ? (await ask('Project directory', 'volt-app')).trim() : 'volt-app');
  const target = resolve(cli.cwd, directory === '' ? 'volt-app' : directory);
  const name = values.name ?? toProjectName(basename(target));

  if (!isValidProjectName(name)) {
    cli.fail(
      `"${name}" is not a usable package name. Pass one with --name: lower case, ` +
        'no spaces, and nothing npm would reject.',
    );
    return 1;
  }

  let template: TemplateDefinition;
  if (values.template === undefined) {
    template = await chooseTemplate(cli, ask);
  } else {
    const named = findTemplate(values.template);
    if (!named) {
      cli.fail(
        `No template called "${values.template}". Available: ` +
          `${TEMPLATES.map((each) => each.id).join(', ')}.`,
      );
      return 1;
    }
    template = named;
  }

  const missing = unpublishedDependencies(templateDependencies(template));
  if (missing.length > 0) {
    cli.fail(
      `The ${template.id} template needs ${missing.join(' and ')}, which ` +
        `${missing.length > 1 ? 'are' : 'is'} not on npm yet — the generated project ` +
        'could not install. Use another template, or work from a checkout of the Volt ' +
        'repository, where these packages are available from the workspace.',
    );
    return 1;
  }

  if (!values.force && !(await isWritableDirectory(target))) {
    cli.fail(`${target} is not empty. Pass --force to write into it anyway.`);
    return 1;
  }

  try {
    await writeProject(target, await renderProject({ name, template }));
  } catch (error) {
    cli.fail(`Could not write the project: ${error instanceof Error ? error.message : error}`);
    return 1;
  }

  const where = target === cli.cwd ? '.' : directory;
  cli.write('');
  cli.write(`Created ${name} in ${target} from the ${template.id} template.`);
  cli.write('');
  cli.write('Next:');
  if (where !== '.') cli.write(`  cd ${where}`);
  cli.write('  pnpm install');
  cli.write('  pnpm dev');
  cli.write('');
  cli.write('Also there: pnpm test, pnpm typecheck, pnpm build.');
  cli.write('');

  return 0;
}

export { renderProject, projectManifest, writeProject } from './scaffold.js';
export { TEMPLATES, findTemplate, type TemplateDefinition } from './templates.js';
export { VERSIONS } from './versions.js';
