import { describe, expect, it } from 'vitest';
import { compile } from '@voltdev/compiler';
import { DELEGATED_EVENTS, NEVER_DELEGATED } from '../src/dom-info.js';

/** Compile and return just the generated body, for readable snapshots. */
function gen(template: string): string {
  return compile(template).body;
}

/** The messages this template warns with, in source order. */
function warnings(template: string): string[] {
  return compile(template).warnings.map((w) => w.message);
}

describe('generated code shape', () => {
  it('emits a hoisted template and navigates to the marker', () => {
    expect(gen(`<span>{ count.get() }</span>`)).toMatchInlineSnapshot(`
      "const _tmpl0 = _rt.template("<span></span>");

      return function render(_ctx) {
        return (() => {
          const _el1 = _tmpl0();
          _rt.bindText(_el1, () => (_rt.toDisplayString(_ctx.count.get())));
          return _el1;
        })();
      };"
    `);
  });

  it('bakes fully static markup with no effects at all', () => {
    const result = compile(`<div class="a"><span>hi</span></div>`);
    expect(result.stats.effects).toBe(0);
    expect(result.templates).toEqual(['<div class="a"><span>hi</span></div>']);
  });

  it('folds constant bindings into the markup', () => {
    const result = compile(`<div :class="'btn'" :disabled="1 > 0">{ 2 + 3 }</div>`);
    expect(result.templates[0]).toBe('<div class="btn" disabled="">5</div>');
    expect(result.stats.effects).toBe(0);
    expect(result.stats.foldedBindings).toBe(3);
  });

  it('reuses one hoisted template for identical markup', () => {
    const result = compile(`
      <div>
        <p :if="a.get()"><b>same</b></p>
        <p :else><b>same</b></p>
      </div>
    `);
    expect(result.stats.dedupedTemplates).toBeGreaterThan(0);
  });

  it('walks siblings instead of restarting from the root', () => {
    const code = gen(`<div><a>{ x.get() }</a><b>{ y.get() }</b></div>`);
    // The second element is reached from the first, not from the root again.
    expect(code).toContain('.nextSibling');
    expect(code.match(/firstChild/g)?.length).toBeLessThanOrEqual(3);
  });

  it('prefixes free identifiers but leaves loop bindings and globals alone', () => {
    const code = gen(`<ul><li :for="item in items.get()" :key="item.id">{ Math.max(item.n, 0) }</li></ul>`);
    expect(code).toContain('_ctx.items.get()');
    expect(code).toContain('Math.max(');
    expect(code).not.toContain('_ctx.Math');
    // The loop binding resolves to its accessor, never to component scope.
    expect(code).toContain('item().n');
    expect(code).not.toMatch(/_ctx\.item\b/);
  });
});

describe(':class object literals compile to per-class toggles', () => {
  it('splits static keys into independent toggles', () => {
    const code = gen(`<div :class="{ danger: sel.get() === id, bold: on.get() }"></div>`);
    expect(code).toContain('_rt.bindClassToggle(_el1, "danger", () => (_ctx.sel.get() === _ctx.id))');
    expect(code).toContain('_rt.bindClassToggle(_el1, "bold", () => (_ctx.on.get()))');
    // No object is built, so nothing has to be normalised at runtime.
    expect(code).not.toContain('bindClass(');
  });

  it('accepts string-literal keys, including ones needing quoting', () => {
    const code = gen(`<div :class="{ 'is-open': open.get() }"></div>`);
    expect(code).toContain('_rt.bindClassToggle(_el1, "is-open", () => (_ctx.open.get()))');
  });

  it('counts the split in compile stats', () => {
    const { stats } = compile(`<div :class="{ a: x.get(), b: y.get() }"></div>`);
    expect(stats.classToggles).toBe(2);
  });

  for (const [why, expression] of [
    ['a plain string', `cls.get()`],
    ['an array', `[a.get(), b.get()]`],
    ['a spread', `{ ...base.get(), a: x.get() }`],
    ['a computed key', `{ [name.get()]: true }`],
    ['a key holding two classes', `{ 'a b': x.get() }`],
    ['duplicate keys', `{ a: x.get(), a: y.get() }`],
  ] as const) {
    it(`keeps the general binding for ${why}`, () => {
      const code = gen(`<div :class="${expression}"></div>`);
      expect(code).toContain('_rt.bindClass(');
      expect(code).not.toContain('bindClassToggle');
    });
  }
});

describe('event delegation is limited to events it suits', () => {
  it('delegates a click, which many elements have and which fires once', () => {
    expect(gen(`<button :click="go()"></button>`)).toContain('_rt.delegate(');
  });

  for (const [why, event] of [
    ['browsers force document wheel listeners to be passive', 'wheel'],
    ['and document touch listeners too', 'touchstart'],
    ['and touchmove', 'touchmove'],
  ] as const) {
    it(`uses a direct listener for :${event}, because ${why}`, () => {
      const code = gen(`<div :${event}.prevent="go()"></div>`);
      // Delegated, this would compile to a listener whose preventDefault is
      // discarded — the bug is silent apart from a console warning.
      expect(code).toContain('_rt.on(');
      expect(code).not.toContain('_rt.delegate(');
    });
  }

  for (const event of ['pointermove', 'mousemove', 'dragover', 'mouseover'] as const) {
    it(`uses a direct listener for :${event}, which fires too often to walk the tree`, () => {
      const code = gen(`<div :${event}="go()"></div>`);
      expect(code).toContain('_rt.on(');
      expect(code).not.toContain('_rt.delegate(');
    });
  }

  it('still lets an explicit listener option force a direct listener', () => {
    expect(gen(`<button :click.once="go()"></button>`)).toContain('_rt.on(');
  });

  // The cases above name the events one at a time, so a name added to
  // NEVER_DELEGATED and to DELEGATED_EVENTS both would sit there contradicting
  // itself and nothing would notice. Drive the whole set instead. That the
  // resulting listener can genuinely cancel is proved where a listener can
  // actually run: packages/core/test/event-delegation.test.ts.
  it('holds every name it says it never delegates to that', () => {
    for (const name of NEVER_DELEGATED) {
      expect(DELEGATED_EVENTS.has(name), `${name} is in both lists`).toBe(false);
      // Assert what the set actually promises — that nothing here is
      // delegated — rather than that a direct listener is emitted. A name the
      // parser does not know as an event compiles to a property binding, which
      // is equally not delegated; asserting `_rt.on(` instead made the test
      // satisfiable by removing a name from the set, which is what happened to
      // `mousewheel`.
      expect(gen(`<div :${name}="go()"></div>`), `:${name}`).not.toContain('_rt.delegate(');
    }
  });
});

describe('the event types a page must listen for before it hydrates', () => {
  const names = (template: string) => compile(template).delegatedEventNames;

  it('reports the type a delegated handler needs', () => {
    expect(names(`<button :click="go()">x</button>`)).toEqual(['click']);
  });

  it('leaves out one that compiles to a listener on the element', () => {
    // `delegate` installs the document listener itself; a direct listener is
    // attached with the element and needs nothing installed ahead of it.
    expect(names(`<div :wheel="go()"></div>`)).toEqual([]);
    expect(names(`<button :click.once="go()"></button>`)).toEqual([]);
  });

  it('reports each type once, however many handlers ask for it', () => {
    expect(
      names(`<ul><li :for="n in ns.get()" :key="n" :click="pick(n)"><b :click="go()">x</b></li></ul>`),
    ).toEqual(['click']);
  });

  it('reports several types in a stable order', () => {
    expect(names(`<div :keydown="a()" :click="b()" :focusin="c()"></div>`)).toEqual([
      'click', 'focusin', 'keydown',
    ]);
  });

  it('leaves out a component output, which is not a DOM event at all', () => {
    expect(names(`<v-thing :on-changed="handle($event)"></v-thing>`)).toEqual([]);
  });
});

describe('how wide one `:for` row is', () => {
  const rows = (template: string) => compile(template).rowRootCounts;

  it('is one for a row that is a single element', () => {
    expect(rows(`<ul><li :for="n in ns.get()" :key="n">{ n }</li></ul>`)).toEqual([1]);
  });

  it('counts the roots of a multi-root row', () => {
    expect(
      rows(`<dl><template :for="e in es.get()" :key="e.id"><dt>{ e.term }</dt><dd>{ e.def }</dd></template></dl>`),
    ).toEqual([2]);
  });

  it('stays fixed when the dynamic parts are inside a root', () => {
    // The row is one `<li>` whatever the condition does inside it, so server
    // markup needs nothing marking where the row ends.
    expect(
      rows(`<ul><li :for="n in ns.get()" :key="n"><b :if="n > 1">big</b><i :else>small</i></li></ul>`),
    ).toEqual([1]);
  });

  it('is unknown when a conditional sits at the row root', () => {
    expect(
      rows(`<dl><template :for="e in es.get()" :key="e.id"><dt :if="e.on">{ e.term }</dt><dd>x</dd></template></dl>`),
    ).toEqual([null]);
  });

  it('is unknown for a component row, whose root element belongs to another module', () => {
    expect(rows(`<ul><v-item :for="n in ns.get()" :key="n"></v-item></ul>`)).toEqual([null]);
  });

  it('records the containing loop before the one nested in it', () => {
    // Two rows of different widths, so the order is what is being asserted
    // rather than something both entries happen to agree on.
    expect(
      rows(`<dl><template :for="g in gs.get()" :key="g.id"><dt>{ g.name }</dt><dd><em :for="c in g.cs" :key="c">{ c }</em></dd></template></dl>`),
    ).toEqual([2, 1]);
  });

  it('is empty for a template with no list at all', () => {
    expect(rows(`<div>{ n.get() }</div>`)).toEqual([]);
  });
});

describe('a tag one character away from a real element', () => {
  for (const [written, meant] of [
    ['dvi', 'div'], ['spam', 'span'], ['buton', 'button'], ['sectoin', 'section'],
    ['inupt', 'input'], ['iamge', 'image'], ['sgv', 'svg'],
  ] as const) {
    it(`reports <${written}> and names <${meant}>`, () => {
      expect(warnings(`<div><${written}></${written}></div>`)).toEqual([
        expect.stringContaining(`\`<${written}>\` is not an element — did you mean \`<${meant}>\`?`),
      ]);
    });
  }

  it('warns rather than refusing, since the markup emitted is what was written', () => {
    expect(() => gen(`<dvi></dvi>`)).not.toThrow();
  });

  it('offers the hyphen as the way to say a tag is deliberate', () => {
    expect(warnings(`<dvi></dvi>`)[0]).toContain('give it a hyphen if the tag really is a custom');
  });

  it('points at the line the tag is written on', () => {
    const found = compile(`<div>\n  <p>ok</p>\n  <dvi></dvi>\n</div>`).warnings;
    expect(found).toHaveLength(1);
    expect(found[0]!.loc.line).toBe(3);
  });

  for (const markup of [
    '<div></div>', '<span></span>', '<section></section>', '<template></template>',
    '<slot></slot>', '<br>', '<wbr>',
  ]) {
    it(`leaves ${markup} alone`, () => {
      expect(warnings(`<div>${markup}</div>`)).toEqual([]);
    });
  }

  it('leaves SVG alone, camelCase and all', () => {
    expect(warnings(`<svg><clipPath><circle></circle></clipPath><text>x</text></svg>`))
      .toEqual([]);
  });

  it('still finds a near miss inside an svg', () => {
    expect(warnings(`<svg><crcle></crcle></svg>`)[0]).toContain('did you mean `<circle>`');
  });

  it('leaves components and custom elements alone', () => {
    // `isComponentTag` claims both, so neither is ever measured against the
    // tables — which is what keeps a design system's own tag names out of this.
    expect(warnings(`<div><VChart></VChart><v-chart></v-chart><my-el></my-el></div>`))
      .toEqual([]);
  });

  for (const tag of ['d', 'q', 'mi']) {
    it(`says nothing about <${tag}>, too short for a near miss to mean anything`, () => {
      // Every one- and two-letter tag is one edit from several real ones, so a
      // near miss among them names an element nobody had in mind.
      expect(warnings(`<div><${tag}></${tag}></div>`)).toEqual([]);
    });
  }

  it('starts looking at three characters', () => {
    // The length that counts is the tag as written, not the one suggested.
    expect(warnings(`<div><ol2></ol2></div>`)[0]).toContain('did you mean `<ol>`');
  });

  it('says nothing about a tag no near miss explains', () => {
    // An invented tag is deliberate often enough, and is visible the first time
    // the page is opened. A typo is the one that survives review.
    expect(warnings(`<div><flexbox></flexbox></div>`)).toEqual([]);
  });

  it('says nothing inside <math>, which Volt does not render at all', () => {
    // Every tag in there is unknown here, and `mi` is one edit from `<i>` —
    // so the suggestion would be about an element the author never meant.
    expect(warnings(`<math><mi>x</mi><mrow><msqrt></msqrt></mrow></math>`)).toEqual([]);
  });

  it('finds one however deeply it is nested', () => {
    expect(warnings(`<div><ul><li><secton></secton></li></ul></div>`)[0])
      .toContain('did you mean `<section>`');
  });
});

describe('a mistyped directive is an error, not a property', () => {
  for (const [written, meant] of [
    ['iff', 'if'], ['clas', 'class'], ['kay', 'key'], ['styel', 'style'],
    ['slto', 'slot-<name>'], ['fro', 'for'], ['refe', 'ref'], ['modle', 'model'],
  ] as const) {
    it(`rejects :${written} and names :${meant}`, () => {
      // Without this it becomes a property binding: `:iff="open"` sets a
      // property called `iff` and the element renders unconditionally, with
      // nothing wrong in the output to notice.
      expect(() => gen(`<div :${written}="x"></div>`)).toThrow(
        new RegExp(`Unknown directive .:${written}.*did you mean .:${meant.replace(/[<>]/g, '.')}`),
      );
    });
  }

  for (const name of ['id', 'form', 'value', 'title', 'name', 'type', 'step', 'size'] as const) {
    it(`leaves :${name} alone, though it is one edit from a directive`, () => {
      expect(() => gen(`<div :${name}="x"></div>`)).not.toThrow();
    });
  }

  it('takes :prop-* as the way to insist', () => {
    expect(() => gen(`<div :prop-iff="x"></div>`)).not.toThrow();
  });

  it('does not second-guess a hyphenated or component binding', () => {
    expect(() => gen(`<div :data-iff="x"></div>`)).not.toThrow();
    expect(() => gen(`<v-thing :iffy="x"></v-thing>`)).not.toThrow();
  });
});

describe('message keys a template asks for', () => {
  const keys = (template: string) => compile(template).messageKeys;

  it('collects a literal key from an interpolation', () => {
    expect(keys(`<p>{ t('close') }</p>`)).toEqual(['close']);
  });

  it('collects one reached through an object', () => {
    expect(keys(`<p>{ locale.t('save') }</p>`)).toEqual(['save']);
  });

  it('collects from attributes and directives too', () => {
    expect(keys(`<b :title="t('remove')" :if="t('x')">{ t('y') }</b>`).sort()).toEqual([
      'remove', 'x', 'y',
    ]);
  });

  it('collects a key passed with parameters', () => {
    expect(keys(`<p>{ t('pageOf', { n: 1, m: 9 }) }</p>`)).toEqual(['pageOf']);
  });

  it('reports each key once', () => {
    expect(keys(`<p>{ t('a') }{ t('a') }{ t('a') }</p>`)).toEqual(['a']);
  });

  it('leaves a computed key alone rather than guessing', () => {
    // Legitimate and unknowable here. The cost is that such a message cannot be
    // tree-shaken, which is the right trade for the rare case.
    expect(keys(`<p>{ t(whichever) }</p>`)).toEqual([]);
  });

  it('is empty for a template that says nothing', () => {
    expect(keys(`<p>plain</p>`)).toEqual([]);
  });
});

describe('filling a slot', () => {
  it('names the slot in the directive, and binds what it passes', () => {
    const body = gen(`<v-rows><template :slot-row="{ row, index }">{ row.name }{ index }</template></v-rows>`);
    // The content is a function of the slot's props, and each bound name reads
    // through to the outlet's getter rather than to a value copied once.
    expect(body).toMatch(/"row":\s*\(_slotProps\d*\)\s*=>/);
    expect(body).toMatch(/const row = \(\) => \(\(_slotProps\d*\)\?\.row\);/);
    expect(body).toMatch(/const index = \(\) => \(\(_slotProps\d*\)\?\.index\);/);
  });

  it('fills a slot that passes nothing, with no function parameter', () => {
    expect(gen(`<v-card><h1 :slot-title>Hello</h1></v-card>`)).toMatch(/"title":\s*\(\)\s*=>/);
  });

  it('binds the whole bag under one name', () => {
    expect(gen(`<v-rows><b :slot-row="scope">{ scope.index }</b></v-rows>`)).toMatch(
      /const scope = \(\) => _slotProps\d*;/,
    );
  });

  it('refuses the old spelling, and says what replaced it', () => {
    expect(() => gen(`<v-card><h1 :slot="'title'">Hello</h1></v-card>`)).toThrow(
      /`:slot` names its slot in the directive now[\s\S]*`:slot-title`/,
    );
    // The value was never really an expression: `:slot="title"` named the same
    // slot as `:slot="'title'"`, so both are answered the same way.
    expect(() => gen(`<v-card><h1 :slot="title">Hello</h1></v-card>`)).toThrow(/`:slot-title`/);
  });

  it('refuses a slot with no name', () => {
    expect(() => gen(`<v-card><h1 :slot-="x">Hello</h1></v-card>`)).toThrow(
      /`:slot-` needs a slot name/,
    );
  });

  it('refuses two patterns for one slot', () => {
    expect(() =>
      gen(
        `<v-rows><b :slot-row="{ row }">{ row.a }</b><i :slot-row="{ row }">{ row.b }</i></v-rows>`,
      ),
    ).toThrow(/binds what the slot passes twice/);
  });

  it('refuses a slot directive on an element, which has no slot to fill', () => {
    expect(() => gen(`<div :slot-row="{ row }">{ row.a }</div>`)).toThrow(
      /fills a slot of the component it is written inside/,
    );
  });

  it('refuses a named slot on the component tag, where only the default is written', () => {
    expect(() => gen(`<v-rows :slot-row="{ row }">{ row.a }</v-rows>`)).toThrow(
      /names a slot of the component around it/,
    );
  });

  it('refuses a pattern that is not one', () => {
    expect(() => gen(`<v-rows><b :slot-row="row +">x</b></v-rows>`)).toThrow(/is not a pattern/);
  });
});

describe('a name one edit from a directive, on a component', () => {
  it('is a prop, because a component has props a guess cannot know', () => {
    // `modal` is an option of createDialog, `mode` of a router route, `styles`
    // of a component's own config. Each is one edit from a directive.
    for (const name of ['modal', 'mode', 'styles', 'form', 'stile']) {
      expect(() => gen(`<v-dialog :${name}="x"></v-dialog>`)).not.toThrow();
    }
  });

  it('is still a typo on an element, where the props are the platform’s', () => {
    expect(() => gen(`<div :modle="x"></div>`)).toThrow(/did you mean .:model/);
  });
});

describe('`:text` and `:html` on a component', () => {
  it('are props, named by the word itself', () => {
    // A component has no content of its own to write — its template does — so
    // there is nothing else they could mean here.
    expect(gen(`<v-tip :text="label.get()"></v-tip>`)).toContain(
      'get "text"() { return _ctx.label.get(); }',
    );
    expect(gen(`<v-tip :html="body"></v-tip>`)).toContain('get "html"()');
  });

  it('are the same prop the static form has always passed', () => {
    // The trap this closes: a component whose prop can be written but never
    // bound, because one of the two spellings was an error.
    expect(gen(`<v-tip text="fallback"></v-tip>`)).toContain('"text": "fallback"');
  });

  it('still write an element’s content, where the tag is an element', () => {
    expect(gen(`<p :text="label.get()"></p>`)).toContain('bindText');
  });
});

describe('a directive that means nothing on a component', () => {
  it('says so, rather than being dropped', () => {
    expect(() => gen(`<v-card :host></v-card>`)).toThrow(/is the component, not its element/);
  });

  it('answers `:model` on a component with the one signal both sides hold', () => {
    expect(() => gen(`<v-field :model="name"></v-field>`)).toThrow(
      /Two-way state is one signal both sides hold[\s\S]*:value="name"/,
    );
  });
});

/**
 * Four things a template could say that meant nothing, and said it quietly.
 *
 * Each of these compiled, rendered a page, and left out what was asked for —
 * which is the worst answer a compiler can give, because the author has no
 * reason to look. None of them can be made to work: an outlet is a position,
 * a `<template>` is not an element, a prop is one value, and a slot outlet's
 * `from` already names the component to draw from.
 */
describe('a template that asks for something impossible', () => {
  it('refuses structure on an outlet, and says where it goes instead', () => {
    expect(() => gen(`<div><slot :if="on.get()">f</slot></div>`)).toThrow(
      /`:if` on a `<slot>` decides nothing[\s\S]*<template :if/,
    );
    expect(() => gen(`<div><slot :for="x in xs" :key="x"></slot></div>`)).toThrow(
      /`:for` on a `<slot>` decides nothing/,
    );
  });

  it('refuses `:host` on a `<template>`, which produces no element', () => {
    expect(() => gen(`<template :host><b>x</b></template>`)).toThrow(/is not an element/);
  });

  it('refuses a prop written out and bound, since one would be lost', () => {
    expect(() => gen(`<v-tip text="a" :text="b"></v-tip>`)).toThrow(
      /<v-tip> is given `text` twice/,
    );
    expect(() => gen(`<v-tip label="a" :label="b"></v-tip>`)).toThrow(/given `label` twice/);
  });

  it('composes `class` and `style`, which are the two that can both be meant', () => {
    const code = gen(`<v-tip class="wide" :class="{ busy }"></v-tip>`);
    expect(code).toContain('get "class"()');
  });

  it('refuses `data-volt-outlet`, the DOM search `:outlet` replaced', () => {
    // The worst kind of stale template: it compiles, it renders, and the child
    // route it was marking is simply not on the page.
    expect(() => gen(`<div><main data-volt-outlet></main></div>`)).toThrow(
      /`data-volt-outlet` was a DOM search[\s\S]*<main :outlet><\/main>/,
    );
  });

  it('refuses a written-out `from` on an outlet, which is an expression', () => {
    expect(() => gen(`<div><slot from="col" name="cell"></slot></div>`)).toThrow(
      /names the component whose content to draw[\s\S]*:from="col"/,
    );
    expect(() => gen(`<div><slot :from="a" :from="b"></slot></div>`)).toThrow(
      /names one component, and this outlet names two/,
    );
  });
});

