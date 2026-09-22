/**
 * Every template shape the compiler is known to emit markup for.
 *
 * Server rendering prints the same static bytes the client clones, so the
 * corpus is the thing that decides whether that claim is true: a construct
 * missing from here is a construct nobody proved byte-identical. Entries are
 * drawn from the tests across the workspace — core, primitives, the
 * benchmark — plus the cases those happen not to reach, so it stays a survey
 * of the emitter rather than of whatever was convenient to write.
 *
 * Templates a browser's parser would restructure are deliberately absent from
 * `CORPUS` and listed in `AMBIGUOUS` below instead. The two halves are kept
 * side by side because each is what makes the other mean anything: the corpus
 * is only evidence about the emitter if nothing in it is rebuilt on the way
 * in, and a rejection is only worth making if the markup really is rebuilt.
 */

export interface CorpusEntry {
  /** Stable name — it keys the baseline snapshot, so renaming one rewrites it. */
  name: string;
  template: string;
}

export const CORPUS: CorpusEntry[] = [
  // Static markup: the bytes that must survive untouched.
  { name: 'empty-element', template: `<div></div>` },
  { name: 'static-nested', template: `<div class="a"><span>hi</span></div>` },
  { name: 'static-deep', template: `<div class="card"><h2>Title</h2><p>Body</p></div>` },
  { name: 'attribute-quoting', template: `<div id=plain class="double" data-x='single'></div>` },
  { name: 'boolean-attribute', template: `<input type="checkbox" checked disabled>` },
  // The `alt=""` is not decoration in the test: an `<img>` with no `alt` at all
  // is a compile error, so every corpus entry that carries one has to answer.
  { name: 'void-tags', template: `<div><br><hr /><img src="x.png" alt=""><input></div>` },
  { name: 'entities', template: `<p>a &amp; b &lt; c &gt; d &nbsp;e</p>` },
  { name: 'bare-ampersand', template: `<p>Smith & Co, 5 < 6</p>` },
  { name: 'attribute-entities', template: `<a href="/a?x=1&y=2" title='He said "hi"'>go</a>` },
  { name: 'raw-text-pre', template: `<pre>line1\n  line2</pre>` },
  { name: 'textarea-raw-text', template: `<textarea>  keep   me  </textarea>` },
  { name: 'comment-dropped', template: `<div><!-- hidden -->visible</div>` },
  { name: 'comment-between-elements', template: `<div><b>a</b><!-- gap --><i>b</i></div>` },
  { name: 'multi-root-static', template: `<h1>a</h1><p>b</p>` },
  { name: 'text-then-element', template: `<div>lead <b>bold</b> tail</div>` },
  { name: 'unicode-text', template: `<p>café — 日本語 — 🎉</p>` },
  { name: 'self-closing-nonvoid', template: `<div><span /></div>` },
  { name: 'deep-nesting', template: `<a><b><c-x><d><e><f>deep</f></e></d></c-x></b></a>` },

  // SVG: cloned through a different wrapper, so it has its own byte path.
  {
    name: 'svg-static',
    template: `<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"></circle></svg>`,
  },
  {
    name: 'svg-dynamic-attr',
    template: `<svg viewBox="0 0 10 10"><circle :attr-r="r.get()"></circle></svg>`,
  },
  {
    name: 'svg-camelcase-tag',
    template: `<svg><linearGradient id="g"><stop offset="0"></stop></linearGradient></svg>`,
  },
  { name: 'svg-mixed-with-html', template: `<div><svg><rect></rect></svg><span>{ n.get() }</span></div>` },
  // A row and a branch inside an `<svg>` each compile to a block of their own,
  // whose markup is SVG while the block is not flagged as one. Every other SVG
  // entry has the `<svg>` at the block root, so this is the only shape where
  // the two gate helpers are handed markup their parse context disagrees with.
  {
    name: 'svg-for-in-group',
    template: `<svg viewBox="0 0 20 10"><g class="pts"><circle :for="p in points.get()" :key="p.id" :attr-cx="p.x" :attr-cy="p.y" r="2"></circle></g></svg>`,
  },
  {
    name: 'svg-if-branch',
    template: `<svg><circle :if="on.get()" :attr-r="r.get()"></circle><rect :else width="4" height="4"></rect></svg>`,
  },

  // Interpolation: markers, merged text, and the folding that removes them.
  { name: 'interpolation-only-child', template: `<span>{ count.get() }</span>` },
  { name: 'interpolation-mixed-text', template: `<p>Hello, { name.get() }! You have { count.get() } messages.</p>` },
  { name: 'interpolation-two-adjacent', template: `<p>{ a.get() }{ b.get() }</p>` },
  { name: 'interpolation-with-siblings', template: `<p>[{ v.get() }]<b>x</b></p>` },
  { name: 'interpolation-folded-constant', template: `<span>{ 2 + 3 }</span>` },
  { name: 'interpolation-folded-among-text', template: `<span>a{ 1 + 1 }b</span>` },
  { name: 'interpolation-at-root', template: `{ label.get() }` },
  { name: 'interpolation-root-with-sibling', template: `{ a.get() }<b>x</b>` },
  { name: 'interpolation-optional-chain', template: `<p>{ user.get()?.name ?? 'anonymous' }|{ n.get() > 2 ? 'big' : 'small' }</p>` },
  { name: 'interpolation-template-literal', template: '<p>{ `${name.get().toUpperCase()} (${count.get()})` }</p>' },
  { name: 'interpolation-globals', template: `<p>{ Math.max(1, n.get()) }|{ JSON.stringify(o.get()) }</p>` },
  { name: 'interpolation-escaped-brace', template: `<p>\\{ literal \\} { real.get() }</p>` },
  { name: 'interpolation-object-literal', template: `<p>{ JSON.stringify({ a: 1, b: 2 }) }</p>` },

  // Attribute-position bindings — zero-width in the client string, and the
  // reason attribute holes have to be recorded rather than inferred.
  { name: 'bind-prop', template: `<input :value="text.get()" :disabled="off.get()">` },
  { name: 'bind-attr-escape', template: `<div :attr-data-x="v.get()"></div>` },
  { name: 'bind-class-string', template: `<div :class="cls.get()"></div>` },
  { name: 'bind-class-object', template: `<div :class="{ danger: sel.get() === id, bold: on.get() }"></div>` },
  { name: 'bind-class-quoted-key', template: `<div :class="{ 'is-open': open.get() }"></div>` },
  { name: 'bind-class-array', template: `<div :class="[a.get(), b.get()]"></div>` },
  { name: 'bind-class-merged-with-static', template: `<div class="base pad" :class="{ danger: on.get() }"></div>` },
  { name: 'bind-style-object', template: `<div :style="{ color: color.get(), fontWeight: 'bold' }"></div>` },
  { name: 'bind-style-string', template: `<div style="color:red" :style="extra.get()"></div>` },
  // `:for` is the loop directive everywhere, so a label's `for` needs `:attr-`.
  { name: 'bind-must-use-attribute', template: `<label :attr-for="id.get()" :role="role.get()">x</label>` },
  { name: 'bind-spread', template: `<div :spread="props()"></div>` },
  { name: 'bind-ref', template: `<div :ref="root"></div>` },
  { name: 'bind-text-directive', template: `<div :text="body.get()"></div>` },
  { name: 'bind-html-directive', template: `<div :html="markup.get()"></div>` },
  { name: 'bind-many-on-one-element', template: `<a href="/x" class="c" :class="{ on: v.get() }" :style="s.get()" :title="t.get()" :ref="el" :click="go()">go</a>` },
  { name: 'bind-folded-constants', template: `<div :class="'btn'" :disabled="1 > 0">{ 2 + 3 }</div>` },
  { name: 'bind-folded-false-boolean', template: `<input disabled :disabled="false">` },
  { name: 'bind-folded-style', template: `<div :style="{ color: 'red' }"></div>` },
  { name: 'bind-folded-class-merges', template: `<div class="a" :class="'b'"></div>` },

  // Events: delegated, direct, guarded, and hoisted.
  { name: 'event-delegated', template: `<button :click="inc()">{ count.get() }</button>` },
  { name: 'event-direct', template: `<div :pointermove="track($event)"></div>` },
  { name: 'event-option-modifier', template: `<button :click.once="go()"></button>` },
  { name: 'event-guard-modifiers', template: `<form :submit.prevent.stop="save()"></form>` },
  { name: 'event-key-modifier', template: `<input :keydown.enter="go()">` },
  { name: 'event-explicit-on', template: `<v-thing :on-changed="handle($event)"></v-thing>` },
  { name: 'event-arrow-handler', template: `<button :click="() => record(3)">go</button>` },
  { name: 'event-several-types', template: `<div :click="a()" :keydown="b()" :wheel="c()"></div>` },

  // Two-way binding, one shape per control kind.
  { name: 'model-text', template: `<input :model="text">` },
  { name: 'model-checkbox', template: `<input type="checkbox" :model="on">` },
  { name: 'model-radio', template: `<input type="radio" value="a" :model="pick">` },
  { name: 'model-number', template: `<input type="number" :model="n">` },
  { name: 'model-modifiers', template: `<input :model.trim.lazy="text">` },
  { name: 'model-textarea', template: `<textarea :model="body"></textarea>` },
  {
    name: 'model-select',
    template: `<select :model="choice"><option value="a">A</option><option value="b">B</option></select>`,
  },
  { name: 'model-with-sibling', template: `<div><input :model="text"><span>{ text.get() }</span></div>` },

  // Conditionals.
  { name: 'if-alone', template: `<div><span :if="on.get()">yes</span></div>` },
  { name: 'if-else', template: `<div><v-a :if="first.get()"></v-a><v-b :else></v-b></div>` },
  {
    name: 'if-else-if-else',
    template: `<div><span :if="v.get() > 5">big</span><span :else-if="v.get() > 0">small</span><span :else>none</span></div>`,
  },
  {
    name: 'if-nested',
    template: `<div><section :if="outer.get()"><b :if="inner.get()">both</b><i :else>outer only</i></section><p :else>neither</p></div>`,
  },
  { name: 'if-sole-child-of-element', template: `<div><span :if="on.get()">only</span></div>` },
  { name: 'if-on-template', template: `<div><template :if="on.get()"><b>a</b><i>b</i></template></div>` },
  { name: 'if-at-root', template: `<span :if="on.get()">x</span>` },
  { name: 'if-between-statics', template: `<div><header>top</header><b :if="on.get()">mid</b><footer>end</footer></div>` },

  // Lists.
  { name: 'for-simple', template: `<ul><li :for="n in items.get()" :key="n">{ n }</li></ul>` },
  { name: 'for-with-index', template: `<ul><li :for="(item, i) in items.get()" :key="item">{ i }:{ item }</li></ul>` },
  { name: 'for-key-index', template: `<ul><li :for="item in items.get()" :key="$index">{ item.text }</li></ul>` },
  { name: 'for-destructured', template: `<ul><li :for="{ id, name } in rows.get()" :key="id">{ id }-{ name }</li></ul>` },
  { name: 'for-destructured-nested', template: `<ul><li :for="{ a: { b }, c: d = 1 } in rows.get()" :key="b">{ b }{ d }</li></ul>` },
  { name: 'for-destructured-array', template: `<ul><li :for="[a, b, ...rest] in pairs.get()" :key="a">{ a }{ b }{ rest.length }</li></ul>` },
  { name: 'for-destructured-rest', template: `<ul><li :for="{ id, ...rest } in rows.get()" :key="id">{ id }</li></ul>` },
  {
    name: 'for-nested',
    template: `<ul><li :for="group in groups.get()" :key="group.id"><span>{ group.id }</span><em :for="child in group.children" :key="child">{ child }</em></li></ul>`,
  },
  {
    name: 'for-row-with-if',
    template: `<ul><li :for="n in items.get()" :key="n"><b :if="n % 2 === 0">{ n } even</b><i :else>{ n } odd</i></li></ul>`,
  },
  { name: 'for-row-multi-root', template: `<dl><template :for="e in entries.get()" :key="e.id"><dt>{ e.term }</dt><dd>{ e.def }</dd></template></dl>` },
  { name: 'for-row-component', template: `<ul><v-item :for="n in items.get()" :key="n">n = { n }</v-item></ul>` },
  { name: 'for-two-lists-in-one-parent', template: `<div><ul class="a"><li :for="n in a.get()" :key="n">{ n }</li></ul><ul class="b"><li :for="n in b.get()" :key="n">{ n }</li></ul></div>` },
  { name: 'for-at-root', template: `<li :for="n in items.get()" :key="n">{ n }</li>` },
  { name: 'for-row-static', template: `<ul><li :for="n in items.get()" :key="n">static</li></ul>` },
  { name: 'for-inside-if', template: `<div><ul :if="on.get()"><li :for="n in items.get()" :key="n">{ n }</li></ul></div>` },
  {
    name: 'for-table-rows',
    template: `<table class="t"><tbody><tr :for="row in rows.get()" :key="row.id" :class="{ danger: row.id === sel.get() }"><td class="id">{ row.id }</td><td><a :click="select(row.id)">{ row.label }</a></td></tr></tbody></table>`,
  },

  // Components, slots and projection.
  { name: 'component-plain', template: `<div><v-child></v-child></div>` },
  { name: 'component-props', template: `<div><v-child :label="'count'" :n="value.get()" :onBumped="(v) => onBump(v)"></v-child></div>` },
  { name: 'component-static-attrs', template: `<div><v-real label="x" active></v-real></div>` },
  { name: 'component-spread', template: `<div><v-child :spread="props()"></v-child></div>` },
  // Two-way state between components is one signal both sides hold, passed as
  // an ordinary prop; `:model` on a component is an error.
  { name: 'component-signal-prop', template: `<div><v-field :value="name"></v-field></div>` },
  { name: 'component-ref', template: `<div><v-child :ref="child"></v-child></div>` },
  { name: 'component-pascal-case', template: `<div><MyWidget :n="1"></MyWidget></div>` },
  { name: 'component-with-children', template: `<v-card><h1 :slot-title>Hello</h1><p>Body content</p></v-card>` },
  { name: 'slot-default-and-named', template: `<div class="card"><header><slot name="title">Untitled</slot></header><main><slot></slot></main></div>` },
  { name: 'slot-no-fallback', template: `<div><slot></slot></div>` },
  { name: 'slot-with-props', template: `<div><slot name="row" :item="item.get()" :index="i.get()">none</slot></div>` },
  { name: 'slot-sole-child', template: `<li><slot></slot></li>` },
  // An outlet that draws what a caller wrote inside another component's tag,
  // which is how a table draws the template its column was given.
  { name: 'slot-from', template: `<td><slot :from="col" name="cell" :row="row">none</slot></td>` },

  // Portals reserve no slot, so they are the one construct that must leave the
  // surrounding markup exactly as if nothing had been written.
  { name: 'portal-default-target', template: `<div><span :portal>hello</span></div>` },
  { name: 'portal-selector-target', template: `<div><span :portal="'#elsewhere'">hi</span></div>` },
  { name: 'portal-between-siblings', template: `<div><b>a</b><span :portal>x</span><b>c</b></div>` },
  { name: 'portal-two-in-a-row', template: `<div><i :portal="'#x'">1</i><i :portal="'#x'">2</i></div>` },
  { name: 'portal-with-if', template: `<div><span :if="open.get()" :portal="'#elsewhere'">modal</span></div>` },
  { name: 'portal-component', template: `<div><v-dialog :portal></v-dialog></div>` },
  { name: 'portal-only-child', template: `<div><span :portal>{ n.get() }</span></div>` },
  { name: 'portal-on-template', template: `<div><template :portal><b>a</b><i>b</i></template></div>` },

  // Grouping templates contribute children but no element.
  { name: 'template-grouping', template: `<div><template><b>a</b><i>b</i></template></div>` },
  { name: 'template-at-root', template: `<template><b>a</b><i>b</i></template>` },

  // Whitespace handling decides real bytes, so both modes are represented.
  { name: 'whitespace-indented', template: `<div>\n  <span>a</span>\n  <span>b</span>\n</div>` },
  { name: 'whitespace-inline-space', template: `<div><b>a</b> <i>b</i></div>` },
  { name: 'whitespace-leading-trailing', template: `<div>  padded  </div>` },
  { name: 'whitespace-around-interpolation', template: `<div>\n  { a.get() }\n</div>` },

  // Shapes that stress path resolution rather than markup.
  { name: 'siblings-many-dynamic', template: `<div><a>{ a.get() }</a><b>{ b.get() }</b><c-x>{ c.get() }</c-x><d>{ d.get() }</d></div>` },
  { name: 'dedupe-identical-branches', template: `<div><p :if="a.get()"><b>same</b></p><p :else><b>same</b></p></div>` },
  { name: 'mixed-static-and-holes', template: `<section><h1>{ title.get() }</h1><p>static</p><ul><li :for="n in ns.get()" :key="n">{ n }</li></ul><footer :class="{ on: x.get() }">end</footer></section>` },
  {
    name: 'kitchen-sink',
    template: `<form :ref="form" class="f" :class="{ busy: busy.get() }" :submit.prevent="save()">
      <label :attr-for="id">Name</label>
      <input :ref="input" :model.trim="name" :disabled="busy.get()">
      <p :if="error.get()" class="err">{ error.get() }</p>
      <ul>
        <li :for="(tag, i) in tags.get()" :key="tag.id" :class="{ first: i === 0 }">
          <span>{ tag.label }</span>
          <button :click="remove(tag.id)">x</button>
        </li>
      </ul>
      <v-toast :portal :message="error.get()"></v-toast>
      <slot name="footer"><em>no footer</em></slot>
    </form>`,
  },
];

/**
 * Markup the HTML parser rebuilds, which the compiler therefore refuses.
 *
 * Every entry carries a binding *below* the element the parser relocates, and
 * that is the point of the fixture rather than decoration: the damage is not
 * "invalid HTML", it is a path resolved against a tree that never exists, so
 * the binding is what turns a rejection into something demonstrable. With the
 * rule removed the template compiles and the path checks in
 * `template-markup.test.ts` land on the wrong node — except where `parserGap`
 * says this environment cannot show it, and those entries are held to their
 * rejection instead, in both test files rather than only one.
 */
export interface AmbiguousEntry {
  /** Reads after "rejects", so it names the rebuild rather than the tag. */
  why: string;
  template: string;
  /** The message must name a remedy; this is the part that says which. */
  remedy: RegExp;
  /**
   * Why happy-dom cannot show this one, for the few insertion modes it does
   * not implement.
   *
   * These entries assert that the trees still *match* here, so the note
   * retires itself: when happy-dom grows the mode, the assertion fails and the
   * entry moves back to being proven rather than excused.
   */
  parserGap?: string;
}

/** happy-dom keeps table text where it is written; a browser moves it out. */
const NO_FOSTERED_TEXT =
  'happy-dom leaves text inside a table where it is written, so the move a browser makes is invisible here.';

/** happy-dom has no "in select" insertion mode, so nothing is discarded. */
const NO_SELECT_MODE =
  'happy-dom does not implement the "in select" insertion mode, so it keeps the element a browser drops.';

export const AMBIGUOUS: AmbiguousEntry[] = [
  {
    why: 'a row outside a section — the parser inserts the `<tbody>`',
    template: `<table><tr><td :class="c.get()">a</td></tr></table>`,
    remedy: /Write the `<tbody>` yourself/,
  },
  {
    why: 'a row with no table at all',
    template: `<div><tr><td :class="c.get()">a</td></tr></div>`,
    remedy: /must be inside/,
  },
  {
    why: 'a cell outside a row',
    template: `<table><tbody><td :class="c.get()">a</td></tbody></table>`,
    remedy: /Put the cell in a `<tr>`/,
  },
  {
    why: 'a header cell outside a row',
    template: `<table><tbody><th :class="c.get()">a</th></tbody></table>`,
    remedy: /Put the cell in a `<tr>`/,
  },
  {
    why: 'a column outside a colgroup',
    template: `<table><col :attr-span="n.get()"></table>`,
    remedy: /Put the column in a `<colgroup>`/,
  },
  {
    why: 'anything else inside a table, which is foster-parented out in front of it',
    template: `<table><div :class="c.get()">a</div></table>`,
    remedy: /moves it out in front of the table/,
  },
  {
    why: 'a wrapper around rows',
    template: `<table><tbody><div><tr><td :class="c.get()">a</td></tr></div></tbody></table>`,
    remedy: /cannot be a child of/,
  },
  {
    why: 'text directly inside a table',
    template: `<table>stray{ n.get() }</table>`,
    remedy: /moved out in front of the table/,
    parserGap: NO_FOSTERED_TEXT,
  },
  {
    why: 'text directly inside a row',
    template: `<table><tbody><tr>stray<td :class="c.get()">a</td></tr></tbody></table>`,
    remedy: /Put it in a `<td>` or `<th>`/,
    parserGap: NO_FOSTERED_TEXT,
  },
  {
    why: 'an interpolation directly inside a row',
    template: `<table><tbody><tr>{ label.get() }</tr></tbody></table>`,
    remedy: /Put it in a `<td>` or `<th>`/,
    parserGap: NO_FOSTERED_TEXT,
  },
  {
    why: 'a list item inside a list item',
    template: `<ul><li>a<li :class="c.get()">b</li></li></ul>`,
    remedy: /ends it rather than nesting in it/,
  },
  {
    why: 'a description term inside another',
    template: `<dl><dt>a<dt :class="c.get()">b</dt></dt></dl>`,
    remedy: /ends it rather than nesting in it/,
  },
  {
    why: 'a description inside a term',
    template: `<dl><dt>a<dd :class="c.get()">b</dd></dt></dl>`,
    remedy: /ends it rather than nesting in it/,
  },
  {
    why: 'an option inside an option',
    template: `<select><option>a<option :attr-value="v.get()">b</option></option></select>`,
    remedy: /ends it rather than nesting in it/,
  },
  {
    why: 'a block element inside a paragraph',
    template: `<p><div :class="c.get()">a</div></p>`,
    remedy: /ends the paragraph before it starts/,
  },
  {
    why: 'a list inside a paragraph',
    template: `<p><ul><li :class="c.get()">a</li></ul></p>`,
    remedy: /ends the paragraph before it starts/,
  },
  {
    why: 'a second paragraph inside a paragraph',
    template: `<p><p :class="c.get()">a</p></p>`,
    remedy: /ends the paragraph before it starts/,
  },
  {
    why: 'a wrapper inside a select, which is discarded outright',
    template: `<select><div><option :attr-value="v.get()">a</option></div></select>`,
    remedy: /discards it entirely/,
    parserGap: NO_SELECT_MODE,
  },
  {
    why: 'a label inside a select',
    template: `<select><option>a</option><span :class="c.get()">b</span></select>`,
    remedy: /discards it entirely/,
    parserGap: NO_SELECT_MODE,
  },
  {
    why: 'a wrapper inside an optgroup',
    template: `<optgroup><div :class="c.get()">a</div></optgroup>`,
    remedy: /discards it entirely/,
    parserGap: NO_SELECT_MODE,
  },
];
