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
import type { TemplateSpan } from '@voltdev/compiler';

function block(template: string, className = 'Widget') {
  return generateTypeCheckBlock(parse(template, { comments: true }), { className });
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
