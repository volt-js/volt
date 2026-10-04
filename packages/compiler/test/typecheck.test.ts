/**
 * The type-check block: the second emit, the one `tsc` reads.
 *
 * What it produces end to end — real diagnostics at real template columns —
 * is covered where the real type checker is, in `@voltdev/cli`. What is here
 * is the part that cannot be seen from there: the table tying the block's
 * characters back to the template's, and how far a `<!-- volt-ignore -->`
 * reaches.
 */

import { describe, expect, it } from 'vitest';
import { generateTypeCheckBlock, parse } from '@voltdev/compiler';
import type { ComponentSource, TemplateSpan } from '@voltdev/compiler';

function block(
  template: string,
  className = 'Widget',
  components?: Record<string, ComponentSource>,
) {
  return generateTypeCheckBlock(parse(template, { comments: true }), {
    className,
    ...(components ? { components: new Map(Object.entries(components)) } : {}),
  });
}

/** The block without the position markers, for reading a restatement plainly. */
const plain = (code: string) => code.replaceAll(/\/\*@volt:\d+\*\//g, '');

const shape = (spans: TemplateSpan[]) =>
  spans.map((s) => ({ exp: s.exp, ignored: s.ignored, marks: s.marks.length }));

describe('tying the block back to the template', () => {
  it('marks every name it resolved against the instance', () => {
    const { spans, code } = block('<p>{ user.name }</p>');

    expect(spans).toHaveLength(1);
    const [span] = spans;
    // Two names, two marks: the one that became `_ctx.user` and the property
    // after it, which is what a diagnostic about `name` has to point at.
    expect(span!.marks.map((m) => m.source)).toEqual([0, 5]);
    expect(code.slice(span!.start, span!.end)).toContain('_ctx.');
  });

  it('reads a mark back out of the text it wrote it into', () => {
    const { spans, code } = block('<p>{ user.name }</p>');

    for (const mark of spans[0]!.marks) {
      expect(code.slice(mark.at, mark.at + mark.length)).toBe(
        spans[0]!.exp.slice(mark.source, mark.source + mark.length),
      );
    }
  });

  it('drops every mark for an expression whose text forges one', () => {
    // A template string can contain anything, this included. Trusting it
    // would put a column derived from the literal into a diagnostic.
    const forged = block(`<p>{ label('/*@volt:99*/x') }</p>`);
    const honest = block(`<p>{ label('x') }</p>`);

    expect(forged.spans[0]!.marks).toEqual([]);
    expect(honest.spans[0]!.marks).toHaveLength(1);
  });
});

describe('an expression the template asks to be left alone', () => {
  it('covers the node the comment precedes, its own children included', () => {
    const { spans } = block(
      `<div>
         <!-- volt-ignore -->
         <b :class="risky">{ inside }</b>
         <i>{ after }</i>
       </div>`,
    );

    expect(shape(spans)).toEqual([
      { exp: 'risky', ignored: true, marks: 1 },
      { exp: 'inside', ignored: true, marks: 1 },
      { exp: 'after', ignored: false, marks: 1 },
    ]);
  });

  it('is still restated, so the row it opens keeps typing the row', () => {
    const { spans, code } = block(
      `<ul><!-- volt-ignore --><li :for="row in rows" :key="row.id">{ row.label }</li></ul>`,
    );

    // The loop is emitted whether or not anyone wants to hear about it: the
    // item's type is what the rest of the row is checked against.
    expect(code).toContain('for (const row of (');
    expect(spans.every((s) => s.ignored)).toBe(true);
  });

  it('does not reach past the list it was written in', () => {
    const { spans } = block(`<div><p>{ inner }</p><!-- volt-ignore --></div><span>{ next }</span>`);

    expect(shape(spans)).toEqual([
      { exp: 'inner', ignored: false, marks: 1 },
      { exp: 'next', ignored: false, marks: 1 },
    ]);
  });

  it('covers an :else branch when the comment sits in front of that branch', () => {
    const { spans } = block(
      `<div>
         <p :if="a">{ b }</p>
         <!-- volt-ignore -->
         <p :else>{ c }</p>
       </div>`,
    );

    expect(shape(spans)).toEqual([
      { exp: 'a', ignored: false, marks: 1 },
      { exp: 'b', ignored: false, marks: 1 },
      { exp: 'c', ignored: true, marks: 1 },
    ]);
  });

  it('means the word and not a comment that mentions it', () => {
    const { spans } = block(`<div><!-- see volt-ignore in the docs --><p>{ x }</p></div>`);

    expect(spans[0]!.ignored).toBe(false);
  });
});

/**
 * An `:if` chain is control flow, and what it narrows is what its arms read:
 * `{ entry.number }` under `:if="entry.kind === 'page'"` reads a page.
 */
describe('a chain of conditions', () => {
  const flat = (code: string) => plain(code).replaceAll(/\s+/g, ' ');

  it('tests each arm around what it reads, the next arm inside what it ruled out', () => {
    const code = flat(
      block(`<p :if="a.kind === 'x'">{ a.x }</p><p :else-if="a.kind === 'y'">{ a.y }</p><p :else>{ a.z }</p>`)
        .code,
    );

    // The condition is still the expression the rule reads, and is tested a
    // second time, unmapped, around its arm.
    expect(code).toContain(
      "__volt_read(_ctx.a.kind === 'x', 0); if (_ctx.a.kind === 'x') { __volt_read(_ctx.a.x, 0); } " +
        "else { __volt_read(_ctx.a.kind === 'y', 0); if (_ctx.a.kind === 'y') { __volt_read(_ctx.a.y, 0); } " +
        'else { { __volt_read(_ctx.a.z, 0); } } }',
    );
  });

  it('maps each condition once, and spares the arm a comment is written before', () => {
    const { spans } = block(
      `<div><p :if="a">{ b }</p><!-- volt-ignore --><p :else-if="c">{ d }</p><p :else>{ e }</p></div>`,
    );

    expect(shape(spans)).toEqual([
      { exp: 'a', ignored: false, marks: 1 },
      { exp: 'b', ignored: false, marks: 1 },
      { exp: 'c', ignored: true, marks: 1 },
      { exp: 'd', ignored: true, marks: 1 },
      { exp: 'e', ignored: false, marks: 1 },
    ]);
  });

  it('still hands a comment after the chain to the node that follows it', () => {
    const { spans } = block(`<div><p :if="a">x</p><!-- volt-ignore --><i>{ after }</i></div>`);

    expect(shape(spans)).toEqual([
      { exp: 'a', ignored: false, marks: 1 },
      { exp: 'after', ignored: true, marks: 1 },
    ]);
  });

  it('tests nothing with a condition that does not parse, and still reads every arm', () => {
    // The condition is reported once, where it is read as an expression. The
    // test around its arm leaves the arm reachable instead of failing the
    // block, and with it every template the check was asked about.
    const { code, errors, spans } = block(`<div><p :if="a **">{ b }</p><p :else>{ c }</p></div>`);

    expect(errors).toHaveLength(1);
    expect(spans.map((s) => s.exp)).toEqual(['b', 'c']);
    expect(plain(code)).toContain('if (null! as boolean) {');
  });

  it('leaves a chain unjoined where an arm reads its condition in a scope of its own', () => {
    // A `:for` on an arm, or a pattern binding what a slot passes: the
    // condition is read inside that scope, so it cannot be tested around it,
    // and the arms after it cannot be the `else` of a test inside it.
    const looped = flat(block(`<p :if="a" :for="x in xs" :key="x">{ x }</p><p :else>{ b }</p>`).code);
    const filling = flat(
      block(`<v-rows><b :slot-row="{ row }" :if="row.ok">{ row }</b><i :slot-row :else>y</i></v-rows>`).code,
    );

    expect(looped).not.toContain('if (_ctx.a)');
    expect(looped).not.toContain('else {');
    // Inside the scope, the arm is still tested around what it reads.
    expect(filling).toContain('{ const { row }: any = {} as any; __volt_read(row.ok, 0); if (row.ok) {');
    expect(filling).not.toContain('else {');
  });
});

describe('the block itself', () => {
  it('declares only the helpers the body reached for', () => {
    const display = block('<p>{ x }</p>').code;
    const handler = block('<button :click="go()"></button>').code;

    expect(display).toContain('__volt_read');
    expect(display).not.toContain('__volt_handler');
    expect(handler).toContain('__volt_handler');
    expect(handler).not.toContain('__volt_read');
  });

  it('takes the instance from the class rather than naming its type', () => {
    // `InstanceType` refuses an abstract class and a generic one needs its
    // arguments; `typeof` survives both.
    expect(block('<p>{ x }</p>', 'AbstractCard').code).toContain(
      'const _ctx = null! as __VoltInstance<typeof AbstractCard>;',
    );
  });

  it('reports an expression that does not parse instead of emitting it', () => {
    const { errors, spans } = block('<p>{ a ** }</p>');

    expect(errors).toHaveLength(1);
    expect(errors[0]!.loc.line).toBe(1);
    expect(spans).toEqual([]);
  });
});

describe('content that fills a slot', () => {
  it('declares what the pattern binds, so the content checks against its own component', () => {
    const code = plain(
      block(`<v-rows><template :slot-row="{ row, index }">{ row.name }{ index }</template></v-rows>`)
        .code,
    );
    expect(code).toContain('const { row, index }');
    expect(code).toContain('row.name');
  });

  it('still checks everything else in that content against the component', () => {
    const code = plain(
      block(`<v-rows><template :slot-row="{ row }">{ row.name }{ ttile }</template></v-rows>`).code,
    );
    // `ttile` is the component's to have or not; the checker restates it as
    // the member access it is, so the real checker reports the typo.
    expect(code).toContain('_ctx.ttile');
    expect(code).not.toContain('_ctx.row');
  });

  it('binds one pattern for every element filling its slot, wherever it is written', () => {
    // Codegen gathers a slot's elements first and binds the one pattern for
    // all of them, so the element without it reads the same names — before
    // the one that names them as much as after.
    const { code, spans } = block(
      `<v-rows><i :slot-row :if="row.ok">{ row.id }</i><b :slot-row="{ row }">{ row.name }</b>` +
        `<p>{ row }</p></v-rows>`,
    );

    expect(spans.map((s) => plain(code.slice(s.start, s.end)))).toEqual([
      'row.ok',
      'row.id',
      'row.name',
      // Default content is no part of the slot, and has no `row` of its own.
      '_ctx.row',
    ]);
  });

  it('reports a pattern that does not parse once, without failing the block', () => {
    // Its sibling filling the same slot is read as written; the pattern is the
    // one mistake, reported where it is written.
    const { errors } = block(`<v-rows><b :slot-row="{ row ">{ row }</b><i :slot-row>{ row }</i></v-rows>`);

    expect(errors.map((e) => e.loc.column)).toEqual([23]);
  });

  it('binds the pattern around a :for on the element that fills the slot', () => {
    // Rendered, the element is the slot's content, `:for` and all, so the
    // loop can draw from what the slot passed.
    const code = plain(
      block(`<v-rows><li :for="tag in row.tags" :key="tag" :slot-row="{ row }">{ row.name }{ tag }</li></v-rows>`)
        .code,
    );

    expect(code).not.toContain('_ctx.row');
    expect(code.indexOf('const { row }')).toBeGreaterThan(-1);
    expect(code.indexOf('const { row }')).toBeLessThan(code.indexOf('for (const tag of (row.tags)'));
  });

  it("binds a tag's own pattern for its content alone", () => {
    // The tag's props and its `:for` are read where the tag is written; only
    // what is written inside it is the default slot's content.
    const looped = plain(
      block(`<v-frame :for="x in xs" :key="x" :title="name" :slot-default="{ name }">{ name }{ x }</v-frame>`)
        .code,
    );
    const single = plain(block(`<v-frame :title="name" :slot-default="{ name }">{ name }</v-frame>`).code);

    for (const code of [looped, single]) {
      expect(code).toContain('__volt_expr(_ctx.name);');
      expect(code).toContain('__volt_read(name, 0);');
      expect(code.indexOf('__volt_expr(_ctx.name);')).toBeLessThan(code.indexOf('const { name }'));
    }
    expect(looped.indexOf('for (const x of (_ctx.xs)')).toBeLessThan(looped.indexOf('const { name }'));
  });

  it("leaves a named slot's content outside the tag's own pattern", () => {
    // The pattern binds what the default slot passes, for the default
    // content; the header is another slot's, rendered without it.
    const { code, spans } = block(
      `<v-list :slot-default="{ item }"><!-- volt-ignore --><h2 :slot-header>{ item }</h2>` +
        `<p>{ item }</p></v-list>`,
    );
    const printed = (span: TemplateSpan) => plain(code.slice(span.start, span.end));

    // And the comment still spares the header it precedes, and nothing else.
    expect(spans.map((s) => `${printed(s)} ${s.ignored ? 'spared' : 'checked'}`).sort()).toEqual([
      '_ctx.item spared',
      'item checked',
    ]);
  });

  it('lets the comment reach that named slot across text written between them', () => {
    // Text is never what a comment spares, so it hands the comment on — here
    // as everywhere else in a template — whichever reading of the tag's
    // children it is skipped by.
    const spaced = block(
      `<v-list :slot-default="{ item }">{ item }<!-- volt-ignore --> <h2 :slot-header>{ head }</h2></v-list>`,
    );
    const worded = block(
      `<v-list :slot-default="{ item }">{ item }<!-- volt-ignore --> Note: <h2 :slot-header>{ head }</h2></v-list>`,
    );

    for (const { spans } of [spaced, worded]) {
      expect(shape(spans)).toEqual([
        { exp: 'item', ignored: false, marks: 1 },
        { exp: 'head', ignored: true, marks: 1 },
      ]);
    }
  });
});

/**
 * A component says what a scoped slot hands its content on its own outlet,
 * `<slot name="row" :row="person">`, so that is where the names' types come
 * from: the outlet's expressions, restated against the component that writes
 * them, inside whatever `:for` it sits in.
 */
describe('what a slot hands its content, typed from the outlet', () => {
  const rows = (outlet: string): Record<string, ComponentSource> => ({
    'v-rows': { className: 'Rows', root: parse(outlet) },
  });
  const filled = `<v-rows><template :slot-row="{ row, note }">{ row.name }</template></v-rows>`;

  it("restates the outlet against the component's own class", () => {
    const code = plain(
      block(
        filled,
        'Widget',
        rows(
          `<li :for="person in people" :key="person.id">` +
            `<slot name="row" :row="person" note="static"></slot></li>`,
        ),
      ).code,
    );

    expect(code).not.toContain(': any');
    expect(code).toContain('__VoltInstance<typeof Rows>');
    expect(code).toContain('for (const person of (');
    expect(code).toContain('"row": __volt_pass(person)');
    expect(code).toContain('"note": __volt_pass("static")');
  });

  it('maps none of the restated outlet back to the template being checked', () => {
    // A mistake in the outlet is the component's, reported when its own
    // template is checked; here only the content is this template's.
    const { spans } = block(filled, 'Widget', rows(`<slot name="row" :row="nope.deep"></slot>`));

    expect(spans.map((s) => s.exp)).toEqual(['row.name']);
  });

  it('takes the default slot from an outlet with no name', () => {
    const code = plain(
      block(`<v-rows :slot-default="{ label }">{ label }</v-rows>`, 'Widget', {
        'v-rows': { className: 'Rows', root: parse(`<p><slot :label="title"></slot></p>`) },
      }).code,
    );

    expect(code).toContain('"label": __volt_pass(__volt_host.title)');
  });

  it("finds an outlet written in another outlet's fallback", () => {
    // What a slot draws when nobody filled it can pass something itself.
    const code = plain(
      block(filled, 'Widget', rows(`<slot name="header"><slot name="row" :row="first"></slot></slot>`)).code,
    );

    expect(code).toContain('return { "row": __volt_pass(__volt_host.first) };');
  });

  it("declares a :for's index for the outlet that hands it over", () => {
    const code = plain(
      block(
        filled,
        'Widget',
        rows(
          `<li :for="(person, i) in people" :key="person.id">` +
            `<slot name="row" :row="person" :note="i"></slot></li>`,
        ),
      ).code,
    );

    expect(code.replaceAll(/\s+/g, ' ')).toContain(
      'for (const person of (__volt_host.people) ?? []) { const i: number = 0; ' +
        'return { "row": __volt_pass(person), "note": __volt_pass(i) }; }',
    );
  });

  it("binds a tag's own pattern around the outlets in its default content", () => {
    // `<v-rows>` draws its rows from what its scroller hands its default
    // content; `visible` there is the scroller's, not a member of `Rows`.
    const code = plain(
      block(
        filled,
        'Widget',
        rows(`<v-scroller :slot-default="{ visible }"><slot name="row" :row="visible[0]"></slot></v-scroller>`),
      ).code,
    );

    expect(code).toContain('return { "row": __volt_pass(visible[0]) };');
    expect(code).not.toContain('__volt_host.visible');
  });

  it('restates an outlet in the scopes it renders in, a slot it fills around its :for', () => {
    // `<v-rows>` draws its rows inside a scroller of its own, from what the
    // scroller's slot passes: `visible` there is the scroller's, not a member
    // of `Rows`.
    const code = plain(
      block(
        filled,
        'Widget',
        rows(
          `<v-scroller><li :for="person in visible" :key="person.id" :slot-default="{ visible }">` +
            `<slot name="row" :row="person"></slot></li></v-scroller>`,
        ),
      ).code,
    );

    expect(code).not.toContain('__volt_host.visible');
    expect(code.indexOf('const { visible }: any')).toBeGreaterThan(-1);
    expect(code.indexOf('const { visible }: any')).toBeLessThan(
      code.indexOf('for (const person of (visible) ?? [])'),
    );
  });

  it('binds the one pattern a sibling names around an outlet in a fill that names none', () => {
    // Codegen binds a slot's pattern for every element filling it, so the
    // `<i>` reads the scroller's `visible` whichever side of the `<b>` it is
    // written on. Read as a member of `Rows` instead, a `visible` the class
    // happens to have would type the row as something it never is.
    for (const fills of [
      `<b :slot-default="{ visible }">{ visible.length }</b><i :slot-default><slot name="row" :row="visible[0]"></slot></i>`,
      `<i :slot-default><slot name="row" :row="visible[0]"></slot></i><b :slot-default="{ visible }">{ visible.length }</b>`,
    ]) {
      const code = plain(block(filled, 'Widget', rows(`<v-scroller>${fills}</v-scroller>`)).code);

      expect(code).not.toContain('__volt_host.visible');
      expect(code).toContain('const { visible }: any');
    }
  });

  it('keeps each value it passes as the literal it is, the way a const would', () => {
    // A function's inferred return widens `'done'` to `string` and `2` to
    // `number`; the slot hands its content the literal. The helper's
    // parameter, bounded by a union with primitives in it, is what keeps one.
    const { code } = block(
      filled,
      'Widget',
      rows(`<slot name="row" :row="done ? 'done' : 'todo'" :level="2" note="static"></slot>`),
    );

    expect(plain(code)).toContain(
      `return { "note": __volt_pass("static"), "row": __volt_pass(__volt_host.done ? 'done' : 'todo'), ` +
        `"level": __volt_pass(2) };`,
    );
    expect(code).toContain(
      'const __volt_pass = null! as <T extends {} | null | undefined | void>(value: T) => T;',
    );
    // Declared only where something is passed.
    expect(block(filled).code).not.toContain('__volt_pass');
  });

  it('types around what in an outlet does not parse, rather than failing the block', () => {
    // A mistake in the component's template is that template's to report
    // when it is checked itself; here it only leaves what it touches `any`.
    const outlets = {
      condition: `<template :if="a **"><slot name="row" :row="first"></slot></template>`,
      prop: `<slot name="row" :row="first **" :note="x"></slot>`,
      pattern: `<v-scroller :slot-default="{ visible "><slot name="row" :row="visible[0]"></slot></v-scroller>`,
      sibling:
        `<v-scroller><b :slot-default="{ visible ">x</b>` +
        `<i :slot-default><slot name="row" :row="visible[0]"></slot></i></v-scroller>`,
    };

    for (const outlet of Object.values(outlets)) {
      const { errors, spans } = block(filled, 'Widget', rows(outlet));
      expect(errors).toEqual([]);
      expect(spans.map((s) => s.exp)).toEqual(['row.name']);
    }
    expect(plain(block(filled, 'Widget', rows(outlets.prop)).code)).toContain(
      '"row": __volt_pass(null! as any), "note": __volt_pass(__volt_host.x)',
    );
  });

  it("restates an outlet in a named slot's content outside the tag's own pattern", () => {
    // The scroller's pattern binds its default content; the header is its
    // own slot's, where `people` is still the member of `Rows`.
    const code = plain(
      block(
        filled,
        'Widget',
        rows(
          `<v-scroller :slot-default="{ people }"><b :slot-header>` +
            `<slot name="row" :row="people[0]"></slot></b><i>{ people }</i></v-scroller>`,
        ),
      ).code,
    );

    expect(code).toContain('"row": __volt_pass(__volt_host.people[0])');
  });

  it('restates an outlet under the conditions around it, a chain as one statement', () => {
    // A component narrows a value before it hands it over — structure goes
    // around an outlet, never on it — and the content is only ever handed the
    // narrowed value. An arm with no outlet still rules itself out of the
    // arms after it.
    const code = plain(
      block(
        filled,
        'Widget',
        rows(
          `<li :for="person in people" :key="person.id"><b :if="person.gone">gone</b>` +
            `<template :else-if="person.away"><slot name="row" :row="person.away"></slot></template>` +
            `<template :else><slot name="row" :row="person"></slot></template></li>`,
        ),
      ).code,
    );

    expect(code.replaceAll(/\s+/g, ' ')).toContain(
      'for (const person of (__volt_host.people) ?? []) { ' +
        'if (person.gone) { } else if (person.away) { return { "row": __volt_pass(person.away) }; } ' +
        'else { return { "row": __volt_pass(person) }; } }',
    );
  });

  it('restates a lone condition the same way, and none where nothing is under it', () => {
    // Inside content filling a slot, the arm is the slot's, and read alone.
    const filling = plain(
      block(
        filled,
        'Widget',
        rows(
          `<v-scroller><template :slot-default="{ visible }" :if="visible.length">` +
            `<slot name="row" :row="visible[0]"></slot></template></v-scroller>`,
        ),
      ).code,
    );
    const empty = plain(
      block(filled, 'Widget', rows(`<p :if="busy">…</p><slot name="row" :row="first"></slot>`)).code,
    );

    expect(filling.replaceAll(/\s+/g, ' ')).toContain(
      'if (visible.length) { return { "row": __volt_pass(visible[0]) }; }',
    );
    expect(empty).not.toContain('if (__volt_host.busy)');
  });

  it("reads a generic component with each of its type parameters any", () => {
    // What the parameters are is decided by the tag's props, which nothing
    // here follows; their bound, `unknown`, would refuse every use of them.
    const outlet = parse(`<slot name="row" :row="items[0]"></slot>`);
    const generic = plain(
      block(filled, 'Widget', {
        'v-rows': { className: 'Rows', root: outlet, typeParameters: 2 },
      }).code,
    );
    const plainClass = plain(
      block(filled, 'Widget', { 'v-rows': { className: 'Rows', root: outlet } }).code,
    );

    expect(generic).toContain('__VoltInstance<typeof Rows<any, any>>');
    expect(plainClass).toContain('__VoltInstance<typeof Rows>;');
  });

  it('declares the names any when nothing says what the slot passes', () => {
    const unknownTag = plain(block(filled).code);
    const noOutlet = plain(block(filled, 'Widget', rows(`<slot name="other" :x="y"></slot>`)).code);
    // An outlet with `:from` draws a different tag's content, so it says
    // nothing about this tag's own slot of the same name.
    const drawnElsewhere = plain(
      block(filled, 'Widget', rows(`<slot :from="col" name="row" :row="r"></slot>`)).code,
    );

    for (const code of [unknownTag, noOutlet, drawnElsewhere]) {
      expect(code).toContain('const { row, note }: any');
    }
  });
});

describe('the signal-read rule', () => {
  it('asks whether the type is any before asking whether it is a signal', () => {
    // `[any] extends [Signal]` holds, so without this every `any` rendered
    // bare would be reported as a signal.
    expect(block('<p>{ x }</p>').code).toContain('0 extends 1 & T ? 0 :');
  });

  it('asks whether the type is never as well', () => {
    // `[never] extends [Signal]` holds for the same reason: a row of a list
    // declared `[]`, typed `never[]`, rendered bare is not a signal either.
    expect(block('<p>{ x }</p>').code).toContain('[T] extends [never] ? 0 :');
  });
});

/**
 * `:text` on a component tag is a prop, so the display rule has no business
 * with it.
 *
 * The rule exists because `{ count }` where `count` is a signal renders
 * `[object Object]`. A prop handed a signal is the opposite: it is how a
 * caller gives a child something to read and write, and marking that as a
 * mistake would report the controlled shape this framework is built on.
 */
describe('the display rule, on a component', () => {
  const rules = (template: string): (string | undefined)[] =>
    block(template).spans.map((span) => span.check?.rule);

  it('checks what an element renders', () => {
    expect(rules('<p :text="label"></p>')).toContain('display');
  });

  it('leaves a prop of a component alone', () => {
    expect(rules('<v-tip :text="label"></v-tip>')).not.toContain('display');
    expect(rules('<v-tip :html="body"></v-tip>')).not.toContain('display');
  });

  it('still checks what a component renders inside itself', () => {
    expect(rules('<v-tip><p :text="label"></p></v-tip>')).toContain('display');
  });
});
