/**
 * Every error code the framework throws, read out of its source.
 *
 * A production build strips the sentence from an error and keeps a code and a
 * link — `https://voltjs.dev/e/V0208` — to the sentence it is not carrying. The
 * pages behind those links are generated from here, at docs build time, rather
 * than written by hand, so a code added to the source has a page the day it is
 * added and a message reworded in the source is reworded on the page.
 *
 * The sentence shown is the development message itself. Each is evaluated with
 * its variables standing in as named holes, so `<${selector}> has no prop
 * "${key}".` reads as `<‹selector›> has no prop "‹key›".` — the exact text a
 * development build prints, with the parts that depend on the program marked.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildSync, transformSync } from 'esbuild';

export interface ErrorSite {
  readonly package: string;
  readonly file: string;
  readonly line: number;
}

export interface ErrorCode {
  readonly code: string;
  readonly family: string;
  /** The development message, with the parts that depend on the program as ‹holes›. */
  readonly message: string;
  /** The fields a production error carries in `detail`. */
  readonly detail: readonly string[];
  readonly sites: readonly ErrorSite[];
  /** Whether every site guards its sentence with `__VOLT_DEV__ &&`. */
  readonly stripped: boolean;
  /**
   * Whether a production build can throw it at all.
   *
   * Many codes are authoring mistakes — a prop that does not exist, an event on
   * a component — which are reported while developing and not checked in a
   * shipped build, so the whole throw is removed with the check. Those codes
   * never appear in a production error, and a page that described what
   * production carries for them would be describing nothing.
   */
  readonly inProduction: boolean;
}

/** One family per hundred, which is how the codes were allocated. */
export const FAMILIES: Readonly<Record<string, string>> = {
  '01': 'Build and environment',
  '02': 'Components',
  '03': 'Server markup',
  '04': 'Hydration state',
  '05': 'Streaming',
  '06': 'DOM runtime',
};

/** The repository root, found by walking up from `from`. */
export function repositoryRoot(from: string = process.cwd()): string {
  let at = resolve(from);
  for (;;) {
    if (existsSync(join(at, 'packages', 'core', 'src'))) return at;
    const up = resolve(at, '..');
    if (up === at) throw new Error(`no Volt repository above ${from}`);
    at = up;
  }
}

function sources(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) found.push(...sources(path));
    else if (path.endsWith('.ts') && !path.endsWith('.d.ts')) found.push(path);
  }
  return found;
}

/**
 * The arguments of a call starting at `open` (the index of its `(`), split at
 * top-level commas. Strings, template literals and nested brackets are stepped
 * over, so a comma inside any of them does not split.
 */
function argumentsAt(code: string, open: number): { args: string[]; end: number } {
  const args: string[] = [];
  let depth = 0;
  let start = open + 1;
  let i = open;
  const skipString = (at: number, quote: string): number => {
    let j = at + 1;
    while (j < code.length && code[j] !== quote) {
      if (code[j] === '\\') j++;
      j++;
    }
    return j;
  };
  const skipTemplate = (at: number): number => {
    let j = at + 1;
    while (j < code.length && code[j] !== '`') {
      if (code[j] === '\\') {
        j += 2;
        continue;
      }
      if (code[j] === '$' && code[j + 1] === '{') {
        let inner = 1;
        j += 2;
        while (j < code.length && inner > 0) {
          if (code[j] === '{') inner++;
          else if (code[j] === '}') inner--;
          else if (code[j] === '`') j = skipTemplate(j);
          else if (code[j] === "'" || code[j] === '"') j = skipString(j, code[j]!);
          if (inner > 0) j++;
        }
      }
      j++;
    }
    return j;
  };
  for (; i < code.length; i++) {
    const ch = code[i]!;
    if (ch === "'" || ch === '"') {
      i = skipString(i, ch);
      continue;
    }
    if (ch === '`') {
      i = skipTemplate(i);
      continue;
    }
    if (ch === '(' || ch === '{' || ch === '[') depth++;
    else if (ch === ')' || ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) {
        args.push(code.slice(start, i).trim());
        return { args: args.filter((a) => a !== ''), end: i };
      }
    } else if (ch === ',' && depth === 1) {
      args.push(code.slice(start, i).trim());
      start = i + 1;
    }
  }
  throw new Error(`unterminated call at ${open}`);
}

/** The keys of an object literal's top level — `{ tag, event: name }` → tag, event. */
function keysOf(literal: string): string[] {
  const body = literal.trim().replace(/^\{/, '').replace(/\}$/, '');
  if (body.trim() === '') return [];
  const { args } = argumentsAt(`(${body})`, 0);
  return args.map((entry) => entry.split(':')[0]!.trim()).filter((key) => /^\w+$/.test(key));
}

/**
 * A stand-in for any value a message interpolates.
 *
 * Reading a property gives a stand-in named by the path read; calling one gives
 * back the thing it was read from, so `name.charAt(0).toUpperCase()` renders as
 * `‹name›`. Converting one to a string gives the last name on its path in
 * guillemets — `‹selector›` for `resolved.config.selector`, because the path is
 * how the framework reaches the value and the last name is what the reader
 * knows it as. It is truthy, so a message's `suggestion ? … : …` renders the
 * branch that says the most.
 */
function hole(label: string, parent?: string): unknown {
  const target = function () {};
  return new Proxy(target, {
    get(_, key) {
      if (key === Symbol.toPrimitive || key === 'toString' || key === 'valueOf' || key === 'toJSON') {
        return () => `‹${label.slice(label.lastIndexOf('.') + 1)}›`;
      }
      if (typeof key === 'symbol') return undefined;
      return hole(`${label}.${key}`, label);
    },
    apply() {
      return hole(parent ?? label);
    },
  });
}

/** The globals a message may genuinely call. Every other free name is a hole. */
const BUILTINS = new Set(['String', 'Number', 'Boolean', 'JSON', 'Object', 'Array', 'Error', 'Math', 'Date', 'Symbol', 'undefined']);

/** The development sentence, evaluated with every free variable as a hole. */
function render(expression: string): string {
  const scope = new Proxy(
    {},
    {
      // An allow-list rather than "whatever is not a global", because a message
      // interpolating `name` would otherwise get `window.name` — empty — in a
      // browser-shaped environment, and lose its hole.
      has: (_, key) => typeof key === 'string' && !BUILTINS.has(key),
      get: (_, key) => (typeof key === 'string' ? hole(key) : undefined),
    },
  );
  // The source is TypeScript and a message can carry a cast, so the types are
  // stripped first. As an export rather than a bare expression: a statement
  // made only of string literals has no effect, and esbuild drops it entirely.
  const js = transformSync(`export default (${expression});`, { loader: 'ts' })
    .code.trim()
    .replace(/^export default\s*/, '')
    .replace(/;$/, '');
  // Sloppy mode on purpose: `with` is the one construct that hands every free
  // name in an arbitrary expression to a scope object.
  const evaluate = new Function('scope', `with (scope) { return ${js}; }`) as (
    scope: object,
  ) => unknown;
  // `${name.charAt(0).toUpperCase()}${name.slice(1)}` is one word built from
  // one name, and reads as one hole.
  return String(evaluate(scope)).replace(/(‹[^›]+›)\1+/g, '$1');
}

/**
 * The codes a production build of the runtime can throw, found by building one.
 *
 * Asked of real bundles rather than of the source, because whether a throw
 * survives depends on everything around it — a `__VOLT_DEV__` branch it sits
 * in, a function only called under one — and the minifier is the authority on
 * what that leaves. A client build and a server build, since some codes are
 * thrown only on one side.
 */
export function productionCodes(root: string = repositoryRoot()): Set<string> {
  const core = join(root, 'packages', 'core', 'src');
  const reactivity = join(root, 'packages', 'reactivity', 'src');
  const found = new Set<string>();
  for (const server of [false, true]) {
    const result = buildSync({
      stdin: {
        contents:
          "export * from '@voltdev/core';\n" +
          "export * as runtime from '@voltdev/core/runtime';\n" +
          "export * as server from '@voltdev/core/server';\n",
        resolveDir: root,
        loader: 'ts',
      },
      bundle: true,
      write: false,
      format: 'esm',
      target: 'esnext',
      minify: true,
      alias: {
        '@voltdev/reactivity/signals': join(reactivity, 'signals.ts'),
        '@voltdev/reactivity': join(reactivity, 'index.ts'),
        '@voltdev/compiler': join(root, 'packages', 'compiler', 'src', 'index.ts'),
        '@voltdev/core/runtime': join(core, 'runtime.ts'),
        '@voltdev/core/server': join(core, 'server.ts'),
        '@voltdev/core': join(core, 'index.ts'),
      },
      define: { __VOLT_DEV__: 'false', __VOLT_DIAGNOSTICS__: 'true', __VOLT_SERVER__: String(server) },
      logLevel: 'silent',
    });
    for (const match of result.outputFiles[0]!.text.matchAll(/V\d{4}/g)) found.add(match[0]);
  }
  return found;
}

export function errorCodes(root: string = repositoryRoot()): ErrorCode[] {
  const shipped = productionCodes(root);
  const byCode = new Map<string, { message: string; detail: string[]; sites: ErrorSite[]; stripped: boolean }>();

  const packages = join(root, 'packages');
  for (const name of readdirSync(packages)) {
    const src = join(packages, name, 'src');
    if (!existsSync(src)) continue;
    for (const file of sources(src)) {
      const code = readFileSync(file, 'utf8');
      for (const match of code.matchAll(/\bvoltError\(\s*'(V\d{4})'/g)) {
        const open = match.index! + match[0].indexOf('(');
        const { args } = argumentsAt(code, open);
        const [, detail = '{}', prose = ''] = args;
        const guarded = /^__VOLT_DEV__\s*&&/.test(prose);
        const expression = prose.replace(/^__VOLT_DEV__\s*&&/, '').trim();
        const site: ErrorSite = {
          package: `@voltdev/${name}`,
          file: file.slice(src.length + 1),
          line: code.slice(0, match.index).split('\n').length,
        };

        const entry = byCode.get(match[1]!) ?? {
          message: expression ? render(expression) : '',
          detail: detail.trim().startsWith('{') ? keysOf(detail) : [],
          sites: [],
          stripped: true,
        };
        entry.sites.push(site);
        entry.stripped &&= guarded;
        byCode.set(match[1]!, entry);
      }
    }
  }

  return [...byCode]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, entry]) => ({
      code,
      family: FAMILIES[code.slice(1, 3)] ?? 'Other',
      inProduction: shipped.has(code),
      ...entry,
    }));
}

/** The page behind `https://voltjs.dev/e/<code>`. */
export function renderErrorPage(error: ErrorCode): string {
  const where = [...new Set(error.sites.map((site) => `${site.package} (${site.file})`))];
  const fields = error.detail.map((key) => `${key}=‹${key}› `).join('');
  const production = error.inProduction
    ? [
        'The sentence above is not in a production bundle — it would cost every',
        'application the bytes of every message whether or not it ever failed. What',
        'a production build keeps is the code, what failed, and the link to this page,',
        'so the same error there reads:',
        '',
        '```',
        `[volt] ${error.code} ${fields}https://voltjs.dev/e/${error.code}`,
        '```',
        '',
        error.detail.length > 0
          ? `and carries \`code\` (\`'${error.code}'\`) and \`detail\` (\`{ ${error.detail.join(', ')} }\`) as fields,`
          : `and carries \`code\` (\`'${error.code}'\`) as a field,`,
        'so a reporter can group by them without reading the text. See',
        '[Errors](/reference/component#errors) for how an error is shaped, and the',
        '`diagnostics` option of [the Vite plugin](/reference/vite-plugin) for a build',
        'that wants only the code.',
      ]
    : [
        'A production build does not make this check. It catches a mistake while the',
        'program is being written, and the check is removed from a production bundle',
        'along with its sentence — so this code never appears in a production error.',
        'What the mistake does there instead depends on the mistake, which is the',
        'reason to fix it when development reports it.',
      ];
  const lines = [
    `# ${error.code}`,
    '',
    `**${error.family}** · thrown by ${where.map((w) => `\`${w}\``).join(', ')}`,
    '',
    'A development build says:',
    '',
    ...error.message.split('\n').map((line) => `> ${line.replace(/\|/g, '\\|')}`),
    '',
    'The parts in ‹guillemets› are filled in from your program when it happens.',
    '',
    '## In a production build',
    '',
    ...production,
    '',
    '[Every error code](/e/)',
    '',
  ];
  return lines.join('\n');
}
