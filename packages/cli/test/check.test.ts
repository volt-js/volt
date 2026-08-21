/**
 * What `volt check` finds, and where it says it is.
 *
 * The whole feature stands or falls on the location: an error that points at
 * generated code is an error nobody can act on. So every case here asserts
 * three things — that the mistake is found, that the line is the line it is
 * written on, and that the column lands on the offending text itself. The
 * third is checked against the template line the checker carried back rather
 * than against a number this file worked out, so the test is wrong in the same
 * way a reader would be rather than in agreement with the implementation.
 *
 * The fixtures are real TypeScript projects under `fixtures/`, checked by the
 * real type checker. Nothing here is a stub.
 */

import { describe, expect, it, beforeAll } from 'vitest';
import { resolve } from 'node:path';
import { checkTemplates, formatDiagnostic, main, type CheckResult, type Cli } from '../src/index.js';
import type { TemplateDiagnostic } from '../src/check.js';

const FIXTURES = resolve(import.meta.dirname, 'fixtures');
const project = (name: string): string => resolve(FIXTURES, name, 'tsconfig.json');
const template = (name: string, file: string): string => resolve(FIXTURES, name, 'src', file);

/** Every finding in one template, in the order they are reported. */
function inFile(result: CheckResult, name: string, file: string): TemplateDiagnostic[] {
  return result.diagnostics.filter((d) => d.file === template(name, file));
}

/** The one finding on a line, insisting there is exactly one. */
function onLine(result: CheckResult, name: string, file: string, line: number): TemplateDiagnostic {
  const found = inFile(result, name, file).filter((d) => d.line === line);
  expect(found).toHaveLength(1);
  return found[0]!;
}

/**
 * The word the column points at, read out of the template line itself.
 *
 * This is the assertion that matters: a column is only right if the text at
 * it is the text the message is about.
 */
function pointsAt(d: TemplateDiagnostic): string {
  expect(d.source).not.toBeNull();
  return /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(d.source!.slice(d.column - 1))?.[0] ?? '';
}

describe('a template with mistakes in it', () => {
  let result: CheckResult;

  beforeAll(async () => {
    result = await checkTemplates({ project: project('errors'), cwd: FIXTURES });
  });

  it('catches a property the component does not have, at its own line and column', () => {
    const d = onLine(result, 'errors', 'unknown.html', 3);

    expect(d.file).toBe(template('errors', 'unknown.html'));
    expect(d.code).toBe('TS2339');
    expect(d.message).toContain("Property 'subtitle' does not exist on type 'Unknown'");
    expect(d.source).toBe('  <p>{ subtitle }</p>');
    expect(pointsAt(d)).toBe('subtitle');
  });

  it('follows a property path, and points at the member that is wrong', () => {
    const d = onLine(result, 'errors', 'unknown.html', 4);

    expect(d.message).toContain("Property 'nom' does not exist");
    // Not at `author`, which is fine, and not at the `{`.
    expect(pointsAt(d)).toBe('nom');
  });

  it("types a :for item from the collection, and uses that type inside the row", () => {
    const found = inFile(result, 'errors', 'loop.html');
    expect(found).toHaveLength(1);

    const d = found[0]!;
    // `rows` is a Signal.State<Row[]>, so the row variable is a `Row` — named
    // in the message, which is what says the type was inferred rather than
    // fallen back to `any`.
    expect(d.message).toBe("Property 'caption' does not exist on type 'Row'.");
    expect(d.line).toBe(4);
    expect(pointsAt(d)).toBe('caption');
  });

  it('leaves a row expression that does use the item correctly alone', () => {
    expect(inFile(result, 'errors', 'loop.html').map((d) => d.line)).not.toContain(3);
  });

  it('types $event by the name of the event it is handling', () => {
    const d = onLine(result, 'errors', 'events.html', 3);

    // `:click` is a PointerEvent, and the handler wants a KeyboardEvent.
    expect(d.message).toContain('PointerEvent');
    expect(d.message).toContain('KeyboardEvent');
    expect(pointsAt(d)).toBe('$event');
  });

  it('accepts the same handler under the event name that does match', () => {
    expect(inFile(result, 'errors', 'events.html').map((d) => d.line)).not.toContain(2);
  });

  it('makes an author narrow an event target rather than reaching through it', () => {
    const found = inFile(result, 'errors', 'events.html').filter((d) => d.line === 4);

    expect(found.map((d) => d.message)).toEqual([
      "'$event.target' is possibly 'null'.",
      "Property 'value' does not exist on type 'EventTarget'.",
    ]);
    expect(found.map(pointsAt)).toEqual(['$event', 'value']);
  });

  it('catches a signal rendered without .get(), and says so in its own words', () => {
    const d = onLine(result, 'errors', 'signals.html', 2);

    expect(d.code).toBe('volt/signal-read');
    expect(d.message).toContain('renders the signal itself');
    expect(d.message).toContain('`count.get()`');
    // The one on the same line that is not a signal is left alone.
    expect(pointsAt(d)).toBe('count');
  });

  it('catches a signal tested without .get() in a condition', () => {
    const d = onLine(result, 'errors', 'signals.html', 3);

    expect(d.code).toBe('volt/signal-read');
    expect(d.message).toContain('tests the signal itself');
    expect(pointsAt(d)).toBe('open');
  });

  it('catches a signal bound with :text as well as interpolated', () => {
    const d = onLine(result, 'errors', 'signals.html', 4);

    expect(d.code).toBe('volt/signal-read');
    expect(pointsAt(d)).toBe('count');
  });

  it('reports every template it was given, not the first that failed', () => {
    expect(result.templates).toBe(5);
    // Every fixture template has something to say, the suppressed one
    // included: it also holds a mistake nobody asked to be spared.
    expect(new Set(result.diagnostics.map((d) => d.file)).size).toBe(5);
  });
});

describe('a template with nothing wrong with it', () => {
  it('produces no diagnostics at all', async () => {
    const result = await checkTemplates({ project: project('clean'), cwd: FIXTURES });

    expect(result.diagnostics).toEqual([]);
    // A run that checked nothing would also report nothing.
    expect(result.templates).toBe(1);
    expect(result.unreadable).toBe(0);
    expect(result.ignored).toBe(0);
  });
});

describe('an expression the checker is told to leave alone', () => {
  let result: CheckResult;

  beforeAll(async () => {
    result = await checkTemplates({ project: project('errors'), cwd: FIXTURES });
  });

  it('spares the node the comment precedes, and counts what it spared', () => {
    expect(inFile(result, 'errors', 'ignored.html').map((d) => d.line)).not.toContain(3);
    expect(result.ignored).toBe(1);
  });

  it('spares that node only, so the next sibling is still checked', () => {
    const d = onLine(result, 'errors', 'ignored.html', 4);

    expect(d.message).toContain("Property 'alsoUntyped' does not exist");
  });
});

describe('what a person sees', () => {
  function record(): Cli & { out: string[]; err: string[] } {
    const out: string[] = [];
    const err: string[] = [];
    return { cwd: FIXTURES, out, err, write: (t) => out.push(t), fail: (t) => err.push(t) };
  }

  it('prints the template line under the message, with a caret on the column', async () => {
    const cli = record();
    const code = await main(['check', '--project', project('errors')], cli);

    expect(code).toBe(1);
    expect(cli.out.join('\n')).toContain(
      [
        'errors/src/unknown.html:3:8  error  TS2339',
        "  Property 'subtitle' does not exist on type 'Unknown'.",
        '',
        '  3 │   <p>{ subtitle }</p>',
        '    │        ^',
      ].join('\n'),
    );
  });

  it('says what it covered, and exits clean when there is nothing to say', async () => {
    const cli = record();
    const code = await main(['check', '--project', project('clean')], cli);

    expect(code).toBe(0);
    expect(cli.out.join('\n')).toContain('Checked 1 template. No errors.');
    expect(cli.err).toEqual([]);
  });

  it('counts the findings and the suppressions in one summary line', async () => {
    const cli = record();
    await main(['check', '--project', project('errors')], cli);

    expect(cli.out.join('\n')).toContain('Checked 5 templates. 10 errors. 1 finding ignored.');
  });

  it('keeps the caret under the column when the line is indented with tabs', () => {
    const line = formatDiagnostic(
      {
        file: '/p/t.html',
        line: 7,
        column: 4,
        code: 'TS2339',
        message: 'nope',
        source: '\t\t<p>{ x }</p>',
      },
      '/p',
    );

    // Three characters precede the column, two of them tabs, so the caret is
    // preceded by the same three — never by four spaces.
    expect(line).toContain('  7 │ \t\t<p>{ x }</p>\n    │ \t\t ^');
  });

  it('refuses a command it does not have, rather than checking anything', async () => {
    const cli = record();
    const code = await main(['lint'], cli);

    expect(code).toBe(1);
    expect(cli.err.join('\n')).toContain('Unknown command `lint`');
    expect(cli.out).toEqual([]);
  });

  it('separates a run that could not happen from a run that found nothing', async () => {
    const cli = record();
    const code = await main(['check', '--project', resolve(FIXTURES, 'nope/tsconfig.json')], cli);

    expect(code).toBe(2);
    expect(cli.out).toEqual([]);
  });
});
