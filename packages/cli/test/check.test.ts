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
import { basename, resolve } from 'node:path';
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

/**
 * What a scoped slot hands its content is written on the component's own
 * outlet — `<slot name="row" :row="person">` — so that is where its type comes
 * from: the outlet's expressions, restated against the component that writes
 * them.
 */
describe('content a scoped slot is handed', () => {
  let result: CheckResult;

  beforeAll(async () => {
    result = await checkTemplates({ project: project('slots'), cwd: FIXTURES });
  });

  const lines = (file: string): number[] => inFile(result, 'slots', file).map((d) => d.line);

  it("types each name by what the component's outlet passes", () => {
    const d = onLine(result, 'slots', 'page.html', 5);

    // `Person` in the message is what says the name was typed from the outlet
    // rather than declared `any`, which would have accepted the typo.
    expect(d.message).toBe("Property 'nmae' does not exist on type 'Person'.");
    expect(pointsAt(d)).toBe('nmae');
  });

  it('leaves a name rendered bare alone when what it holds is a value', () => {
    expect(lines('page.html')).not.toContain(4);
    expect(lines('page.html')).not.toContain(6);
  });

  it('still catches a signal the slot hands over, rendered without .get()', () => {
    const d = onLine(result, 'slots', 'page.html', 7);

    expect(d.code).toBe('volt/signal-read');
    expect(d.message).toContain('`total.get()`');
    expect(pointsAt(d)).toBe('total');
  });

  it('follows a declaration map from a package back to the template beside its source', () => {
    const d = onLine(result, 'slots', 'page.html', 11);

    expect(d.message).toBe("Property 'lable' does not exist on type 'Cell'. Did you mean 'label'?");
    expect(pointsAt(d)).toBe('lable');
  });

  it("reads a declaration map's sources under the root it names", () => {
    // `"sourceRoot": "../src/"`, `"sources": ["tile.ts"]`: the source is the
    // two together, and either alone names a file that is not there.
    const d = onLine(result, 'slots', 'page.html', 34);

    expect(d.message).toBe("Property 'size' does not exist on type 'string'.");
    expect(pointsAt(d)).toBe('size');
  });

  it('types a slot filled by several elements by the one pattern any of them names', () => {
    // The `<i>` names no pattern, and renders with the `<b>`'s all the same:
    // its `row` is the slot's, not a member the page lacks.
    const d = onLine(result, 'slots', 'page.html', 35);

    expect(d.message).toBe("Property 'nmae' does not exist on type 'Person'.");
    expect(pointsAt(d)).toBe('nmae');
  });

  it('types what the default slot passes, named on the tag itself', () => {
    const d = onLine(result, 'slots', 'page.html', 13);

    expect(d.message).toBe("Property 'size' does not exist on type 'string'.");
    expect(pointsAt(d)).toBe('size');
  });

  it('says nothing about names from a component it cannot find', () => {
    // `<v-mystery>` is in no `imports`, so what its slot passes is unknown and
    // typed `any` — and an `any` is no evidence of a signal.
    expect(lines('page.html')).not.toContain(15);
  });

  it('never reads an any or an unknown as a signal', () => {
    expect(lines('page.html')).not.toContain(17);
    expect(lines('page.html')).not.toContain(18);
  });

  it('still catches a real signal rendered bare beside them', () => {
    const d = onLine(result, 'slots', 'page.html', 19);

    expect(d.code).toBe('volt/signal-read');
    expect(pointsAt(d)).toBe('count');
  });

  it('types a :for on the element filling a slot inside what the slot passed', () => {
    const d = onLine(result, 'slots', 'page.html', 20);

    // `tag` is a string only because the loop reads the slot's `row`, a
    // Person; the page has no `row` of its own to read instead.
    expect(d.message).toBe("Property 'size' does not exist on type 'string'.");
    expect(pointsAt(d)).toBe('size');
  });

  it("reads a tag's own props and :for where the tag is written, outside its pattern", () => {
    // The page's `name` is a number and the slot's a string: each line is
    // clean only if the props see the one and the content the other.
    expect(lines('page.html')).not.toContain(21);
    expect(lines('page.html')).not.toContain(22);
  });

  it("reads a named slot's content outside the tag's own pattern", () => {
    // The caption is the page's `name`, a number; only the default content
    // is handed the frame's string.
    expect(lines('page.html')).not.toContain(24);
  });

  it('never reads a never as a signal', () => {
    // A row of a list declared `[]` is `never`, and `[never]` extends
    // anything, a signal included.
    expect(lines('page.html')).not.toContain(23);
  });

  it("leaves a generic component's own parameters any, and types the rest of what it passes", () => {
    // `item` is a `T`, which only the tag's `items` decides. Read at its bound,
    // `unknown`, it would report `item.name` on a row the page knows is a
    // Person; `count` is a number whatever `T` is, so it is still checked.
    const d = onLine(result, 'slots', 'page.html', 26);

    expect(d.message).toBe("Property 'size' does not exist on type 'number'.");
    expect(pointsAt(d)).toBe('size');
  });

  it('hands over a value as the conditions around the outlet narrowed it', () => {
    // `<v-pages>` passes a page only from the arm where the entry is one, a
    // link only from the arm after it, and an error only where there is one.
    // Read without the conditions, each is the whole union, or possibly
    // undefined, and content that renders cleanly is reported.
    expect(lines('page.html')).not.toContain(29);
    expect(lines('page.html')).not.toContain(31);

    // The link is named as the `:else` left it, which is what says the arms
    // before it were read.
    const d = onLine(result, 'slots', 'page.html', 30);
    expect(d.message).toBe(`Property 'number' does not exist on type '{ kind: "link"; href: string; }'.`);
    expect(pointsAt(d)).toBe('number');
  });

  it('narrows what the slot passed by the content’s own :if chain', () => {
    // A name with a real type is one an `:if` has to narrow, or every arm is
    // read as the whole union. Only the `:else` arm's page number is wrong:
    // by then the entry can only be a gap.
    const d = onLine(result, 'slots', 'page.html', 32);

    expect(d.message).toBe(`Property 'number' does not exist on type '{ kind: "gap"; }'.`);
    expect(d.column).toBe(d.source!.lastIndexOf('number') + 1);
  });

  it("narrows a row by an :if in the component's own template the same way", () => {
    expect(lines('pages.html')).toEqual([]);
  });

  it('hands over a literal as that literal, not the wider type it would widen to', () => {
    // `<v-badge>` passes `task.done ? 'done' : 'todo'`, `2` and `tone="calm"`,
    // and the content renders exactly those. Widened to `string` and `number`,
    // as a function's inferred return widens them, a record keyed by the two
    // states and parameters of those literals would each refuse them; the
    // one mistake left names the states, which says they were kept.
    const d = onLine(result, 'slots', 'page.html', 36);

    expect(d.message.split('\n')[0]).toBe(`Property 'size' does not exist on type '"done" | "todo"'.`);
    expect(pointsAt(d)).toBe('size');
  });

  it('reads the deferred form of imports, under the name the module gave the class', () => {
    const d = onLine(result, 'slots', 'lazy.html', 2);

    expect(d.message).toBe("Property 'nmae' does not exist on type 'Person'.");
    expect(pointsAt(d)).toBe('nmae');
  });

  it('finds a default-exported component by the name its class was declared with', () => {
    const d = onLine(result, 'slots', 'lazy.html', 5);

    expect(d.message).toBe("Property 'size' does not exist on type 'string'.");
    expect(pointsAt(d)).toBe('size');
  });

  it('reads a component whose template does not parse as passing anything, and goes on', () => {
    // `<v-broken>`'s template is reported once, as its own; a page filling
    // its slot is still checked, its names `any` rather than the check gone.
    expect(inFile(result, 'slots', 'broken.html').map((d) => d.code)).toEqual([
      'volt/template-syntax',
    ]);
    expect(lines('page.html')).not.toContain(37);
  });

  it("types content filling a slot inside an outlet's fallback", () => {
    // `<v-shelf>` binds what a slot passes nowhere but in what its own outlet
    // draws when nobody filled it, which is still a template that needs its
    // component's `imports` read.
    const d = onLine(result, 'slots', 'shelf.html', 1);

    expect(d.message).toBe("Property 'nmae' does not exist on type 'Person'.");
    expect(pointsAt(d)).toBe('nmae');
  });

  it("types a template by its own component's imports, never a neighbour's", () => {
    // `Bare` lists nothing, and sits in the same module as a component that
    // lists `<v-rows>`: its names stay `any`, so the same typo says nothing.
    expect(lines('bare.html')).toEqual([]);
  });

  it('reports nothing else, in the pages or in the components they fill', () => {
    expect(
      result.diagnostics.map((d) => `${basename(d.file)}:${d.line}:${d.code}`),
    ).toEqual([
      'broken.html:1:volt/template-syntax',
      'lazy.html:2:TS2339',
      'lazy.html:5:TS2339',
      'page.html:5:TS2339',
      'page.html:7:volt/signal-read',
      'page.html:11:TS2551',
      'page.html:13:TS2339',
      'page.html:19:volt/signal-read',
      'page.html:20:TS2339',
      'page.html:26:TS2339',
      'page.html:30:TS2339',
      'page.html:32:TS2339',
      'page.html:34:TS2339',
      'page.html:35:TS2339',
      'page.html:36:TS2339',
      'shelf.html:1:TS2339',
    ]);
    expect(result.templates).toBe(10);
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
