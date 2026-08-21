/**
 * Accessibility the compiler can prove from the template alone.
 *
 * Each rule is held to two things here, and the second is the one that decides
 * whether the rules survive contact with a real codebase: it fires on the case
 * it exists for, and it stays silent on the correct markup standing next to
 * it. `alt=""`, `aria-hidden` on an icon, `role="menuitem"` on a link and
 * `role="presentation"` on a decorative image are all correct, all one
 * character from something that is not, and all of them would be reported by a
 * rule written slightly too eagerly. A rule that fires on correct code teaches
 * people to switch the rules off, and takes the rest of them with it.
 *
 * Severity is asserted by which side of `compile` the finding comes out of:
 * certainly wrong throws, the way markup a parser would rebuild throws, and
 * usually wrong arrives in `warnings`.
 */

import { describe, expect, it } from 'vitest';
import {
  ARIA_ATTRIBUTES,
  CompilerError,
  compile,
  formatDiagnostic,
  type AriaAttribute,
  type CompileOptions,
} from '@voltdev/compiler';

/** The messages this template warns with, in source order. */
function warnings(template: string, options?: CompileOptions): string[] {
  return compile(template, options).warnings.map((w) => w.message);
}

/** A value of the kind an attribute takes, for the tests that drive the table. */
function sample(spec: AriaAttribute): string {
  switch (spec.kind) {
    case 'token':
    case 'tokens':
      return spec.values![0]!;
    case 'integer':
      return '2';
    case 'number':
      return '1.5';
    case 'idref':
    case 'idrefs':
      return 'target';
    default:
      return 'text';
  }
}

describe('an interactive listener on something no keyboard reaches', () => {
  it('reports a click handler on a plain element', () => {
    expect(warnings(`<div :click="select()">Pick</div>`)).toEqual([
      expect.stringContaining('`:click` on `<div>`, which no keyboard can reach'),
    ]);
  });

  it('names the remedy rather than the violation', () => {
    expect(warnings(`<span :keydown="go($event)">x</span>`)[0]).toContain(
      'Use `<button>` if it acts, `<a href>` if it navigates',
    );
  });

  it('stays quiet on elements that are already interactive', () => {
    expect(warnings(`<button :click="save()">Save</button>`)).toEqual([]);
    expect(warnings(`<a href="/next" :click="track($event)">Next</a>`)).toEqual([]);
    expect(warnings(`<summary :click="open()">More</summary>`)).toEqual([]);
    expect(warnings(`<label :click="focusInput()">Name</label>`)).toEqual([]);
  });

  it('stays quiet once the element says what it is', () => {
    expect(warnings(`<div role="button" tabindex="0" :click="select()">Pick</div>`)).toEqual([]);
  });

  it('stays quiet on events that are not how an element is operated', () => {
    // A splitter or a canvas listens on pointer events and is not a control;
    // reporting those is the false positive that gets the rules turned off.
    expect(warnings(`<div :pointerdown="startDrag($event)">handle</div>`)).toEqual([]);
    expect(warnings(`<div :mouseenter="preview()">card</div>`)).toEqual([]);
  });

  it('stays quiet when a spread may be carrying the role', () => {
    expect(warnings(`<div :spread="trigger.props()" :click="open()">Menu</div>`)).toEqual([]);
  });

  it('stays quiet when the role is bound rather than written', () => {
    expect(warnings(`<div :attr-role="role.get()" :click="select()">Pick</div>`)).toEqual([]);
  });

  it('stays quiet on an element the browser has already made editable', () => {
    // A contenteditable region takes focus and handles its own keys; the
    // listener is not what a keyboard needs in order to reach it.
    expect(warnings(`<div contenteditable="true" :click="edit()">Notes</div>`)).toEqual([]);
  });
});

describe('an <img> that says nothing about itself', () => {
  it('rejects an image with no alt at all', () => {
    expect(() => compile(`<img src="/ada.png">`)).toThrow(/`<img>` with no `alt`/);
  });

  it('says that an empty alt is the answer for decoration', () => {
    expect(() => compile(`<img src="/ada.png">`)).toThrow(
      /an empty alt is an answer, a missing one is\n  silence/,
    );
  });

  it('accepts an empty alt, which is how an image says it is decoration', () => {
    expect(warnings(`<img src="/rule.png" alt="">`)).toEqual([]);
  });

  it('accepts every other way of naming an image', () => {
    expect(warnings(`<img src="/ada.png" alt="Ada Lovelace">`)).toEqual([]);
    expect(warnings(`<img src="/ada.png" :alt="person.name">`)).toEqual([]);
    expect(warnings(`<img src="/ada.png" aria-label="Ada Lovelace">`)).toEqual([]);
    expect(warnings(`<h2 id="who">Ada</h2><img src="/ada.png" aria-labelledby="who">`)).toEqual([]);
    expect(warnings(`<img src="/rule.png" aria-hidden="true">`)).toEqual([]);
    expect(warnings(`<img src="/rule.png" role="presentation">`)).toEqual([]);
  });

  it('rejects an image whose aria-hidden does not hide it', () => {
    // `aria-hidden="false"` is not the attribute being absent: the image is in
    // the tree, announced, and still has nothing to say.
    expect(() => compile(`<img src="/ada.png" aria-hidden="false">`)).toThrow(
      /`<img>` with no `alt`/,
    );
  });

  it('accepts an image whose attributes arrive as a spread', () => {
    // What the spread carries is a runtime value, so the alt cannot be ruled
    // out — and this is the shape every image primitive is used through.
    expect(warnings(`<img :ref="image" :spread="avatar.imageProps()">`)).toEqual([]);
  });
});

describe('a <label> pointing at nothing', () => {
  it('reports a for that names no element in the template', () => {
    // Two findings about two elements, which is what a `for` resolving nowhere
    // costs: the label names nothing, and the control it was meant for is left
    // with no name of its own.
    expect(warnings(`<label for="email">Email</label><input id="name">`)).toEqual([
      expect.stringContaining('`<label for>` points at `email`, which no element'),
      expect.stringContaining('`<input>` has no accessible name'),
    ]);
  });

  it('names the near miss when there is one', () => {
    expect(warnings(`<label for="emial">Email</label><input id="email">`)[0]).toContain(
      'Did you mean `email`?',
    );
  });

  it('offers wrapping the control as the remedy that needs no id', () => {
    expect(warnings(`<label for="email">Email</label><input id="name">`)[0]).toContain(
      'Wrapping the control in the `<label>` needs no id at all',
    );
  });

  it('accepts a for that resolves, wherever the control is written', () => {
    expect(warnings(`<label for="email">Email</label><input id="email">`)).toEqual([]);
    expect(warnings(`<input id="email"><label for="email">Email</label>`)).toEqual([]);
  });

  it('accepts an id sitting on a component tag', () => {
    expect(warnings(`<label for="email">Email</label><v-text-field id="email"></v-text-field>`))
      .toEqual([]);
  });

  it('accepts a label that wraps its control', () => {
    expect(warnings(`<label>Email <input type="email"></label>`)).toEqual([]);
  });

  it('goes quiet once the template computes an id, since any of them could match', () => {
    expect(warnings(`<label for="email">Email</label><input :attr-id="fieldId.get()">`))
      .toEqual([]);
  });

  it('still names a near miss where a spread may be carrying ids', () => {
    // A `:spread` is how every primitive is consumed, so a template-wide
    // silence for one is most of this rule's reach. A computed id is built
    // from a counter or a field name and is never one edit from an id somebody
    // typed, so a near miss is a typo whatever the spread turns out to carry.
    expect(
      warnings(`<label for="emial">Email</label><input id="email"><img :spread="p()">`)[0],
    ).toContain('one edit from the `email` this template writes');
  });

  it('says nothing about a miss no near one explains, once a spread may carry an id', () => {
    expect(warnings(`<label for="email">Email</label><img :spread="p()">`)).toEqual([]);
  });
});

describe('a form control nothing names', () => {
  it('reports an input with no name by any route', () => {
    expect(warnings(`<form><input :model="email"></form>`)).toEqual([
      expect.stringContaining('`<input>` has no accessible name'),
    ]);
  });

  it('reports a select and a textarea the same way', () => {
    expect(warnings(`<select :model="n"><option>a</option></select>`)).toEqual([
      expect.stringContaining('`<select>` has no accessible name'),
    ]);
    expect(warnings(`<textarea :model="body"></textarea>`)).toEqual([
      expect.stringContaining('`<textarea>` has no accessible name'),
    ]);
  });

  it('warns rather than refusing, since a name can arrive from outside', () => {
    expect(() => compile(`<input :model="email">`)).not.toThrow();
  });

  it('names all the routes worth taking, and rules the placeholder out', () => {
    const message = warnings(`<input placeholder="Email">`)[0]!;
    expect(message).toContain('Wrap it in a `<label>`');
    expect(message).toContain('point a `<label for>` at its `id`');
    expect(message).toContain('`aria-label`');
    expect(message).toContain('A `placeholder` is not a name');
  });

  for (const [route, template] of [
    ['a wrapping label', `<label>Email <input :model="email"></label>`],
    ['a label further up', `<label>Email <span class="field"><input :model="e"></span></label>`],
    ['a label pointing at it', `<label for="email">Email</label><input id="email">`],
    ['a label written after it', `<input id="email"><label for="email">Email</label>`],
    ['aria-label', `<input aria-label="Email">`],
    ['a bound aria-label', `<input :aria-label="t('email')">`],
    ['aria-labelledby', `<span id="l">Email</span><input aria-labelledby="l">`],
    ['title', `<input title="Email">`],
  ] as const) {
    it(`accepts a control named by ${route}`, () => {
      expect(warnings(template)).toEqual([]);
    });
  }

  for (const [why, template] of [
    ['a spread may be carrying the name', `<input :spread="props()">`],
    ['the id is computed, so a label may resolve to it', `<input :attr-id="fieldId.get()">`],
    ['a label computes its for, so it may point here', `<label :attr-for="f()">E</label><input id="email">`],
    ['a label spreads, so its for is unknowable', `<label :spread="p()">E</label><input id="email">`],
    ['the type is computed and may be one that names itself', `<input :attr-type="kind()">`],
    ['a parent supplies the name around it', `<v-field><input :model="email"></v-field>`],
    ['it is hidden from the accessibility tree', `<input aria-hidden="true">`],
  ] as const) {
    it(`says nothing when ${why}`, () => {
      expect(warnings(template)).toEqual([]);
    });
  }

  for (const type of ['hidden', 'submit', 'reset', 'button', 'image'] as const) {
    it(`leaves type="${type}" alone, which is named by something else`, () => {
      expect(warnings(`<input type="${type}" value="Send">`)).toEqual([]);
    });
  }

  it('still reports a text input beside a self-naming one', () => {
    // The exemption is per input rather than per form, which is the way a
    // search box next to its submit button is usually written.
    expect(warnings(`<form><input :model="q"><input type="submit" value="Go"></form>`)).toEqual([
      expect.stringContaining('`<input>` has no accessible name'),
    ]);
  });

  it('does not let a wrapping label follow a control through a portal', () => {
    // The portal moves the control out of the label at runtime, so the label
    // it was written inside is not the label it renders inside.
    expect(
      warnings(`<label>Email <div :portal="host()"><input :model="e"></div></label>`),
    ).toEqual([expect.stringContaining('`<input>` has no accessible name')]);
  });

  it('leaves a button alone, which its own contents name', () => {
    expect(warnings(`<button>Send</button>`)).toEqual([]);
  });
});

describe('aria-* the vocabulary does not contain', () => {
  it('rejects a misspelled attribute and names the one meant', () => {
    expect(() => compile(`<button aria-lable="Close">x</button>`)).toThrow(
      /`aria-lable` is not an ARIA attribute — did you mean `aria-label`\?/,
    );
    expect(() => compile(`<div aria-labeledby="t">a</div><h2 id="t">T</h2>`)).toThrow(
      /did you mean `aria-labelledby`\?/,
    );
  });

  it('rejects an invented attribute, and says where a private one belongs', () => {
    expect(() => compile(`<div aria-sparkle="yes">a</div>`)).toThrow(
      /Remove it, or write `data-sparkle` if it is your own/,
    );
  });

  it('rejects a misspelling that is bound rather than written', () => {
    // The name is knowable even where the value is not, and a binding hides a
    // typo exactly as well as an attribute does.
    expect(() => compile(`<div :aria-lable="label.get()">a</div>`)).toThrow(
      /did you mean `aria-label`\?/,
    );
  });

  it('accepts the whole real vocabulary, including the deprecated members', () => {
    expect(warnings(`<div aria-roledescription="slide" aria-grabbed="false">a</div>`)).toEqual([]);
    // Driven over the table rather than a sample of it: a name dropped from
    // the vocabulary is a template that stops compiling, and two entries out
    // of fifty is a coin toss about which name that would be.
    for (const [name, spec] of Object.entries(ARIA_ATTRIBUTES)) {
      expect(
        warnings(`<div ${name}="${sample(spec)}"><span id="target">T</span></div>`),
        name,
      ).toEqual([]);
    }
  });

  it('leaves aria-* on a component tag alone, because it is a prop and not an attribute', () => {
    // Whether the component forwards it to the DOM at all is the component's
    // decision, so a name this vocabulary does not have may still be a prop
    // that one does. The rule is about markup, and this is not markup yet.
    expect(warnings(`<v-thing aria-lable="Close"></v-thing>`)).toEqual([]);
  });
});

describe('an aria-* value outside its enumeration', () => {
  it('rejects a value that is not in the enum, and lists the enum', () => {
    expect(() => compile(`<div aria-live="loud">a</div>`)).toThrow(
      /Write `assertive`, `off` or `polite`/,
    );
  });

  it('rejects the near-miss spellings of true and false', () => {
    expect(() => compile(`<button aria-expanded="yes">More</button>`)).toThrow(
      /`aria-expanded` does not take `yes`/,
    );
  });

  it('rejects a word where a number belongs', () => {
    expect(() => compile(`<div role="heading" aria-level="two">T</div>`)).toThrow(
      /`aria-level` takes an integer, not `two`/,
    );
  });

  it('rejects one bad token in a list of good ones', () => {
    expect(() => compile(`<div aria-relevant="additions rubbish">a</div>`)).toThrow(
      /`aria-relevant` does not take `rubbish`/,
    );
  });

  it('accepts every value the enum really has', () => {
    expect(warnings(`<div aria-live="polite" aria-atomic="true">a</div>`)).toEqual([]);
    expect(warnings(`<a href="/here" aria-current="page">Here</a>`)).toEqual([]);
    expect(warnings(`<button aria-pressed="mixed">Bold</button>`)).toEqual([]);
    expect(warnings(`<div aria-relevant="additions text">a</div>`)).toEqual([]);
    expect(warnings(`<div role="heading" aria-level="2">T</div>`)).toEqual([]);
    expect(warnings(`<div role="slider" aria-valuenow="0.5" tabindex="0">a</div>`)).toEqual([]);
    // Every member of every enum, because a value dropped from one is a
    // correct template that stops compiling and nothing else would say so.
    for (const [name, spec] of Object.entries(ARIA_ATTRIBUTES)) {
      for (const value of spec.values ?? []) {
        expect(warnings(`<div ${name}="${value}">a</div>`), `${name}="${value}"`).toEqual([]);
      }
    }
  });

  it('lists an enum as `a`, `b` or `c`, which every enum in the table is long enough for', () => {
    expect(() => compile(`<div aria-live="loud">a</div>`)).toThrow(
      /Write `assertive`, `off` or `polite`/,
    );
    // The message has no one-value form, so the table may not grow an enum
    // that would need one.
    for (const [name, spec] of Object.entries(ARIA_ATTRIBUTES)) {
      if (spec.values) expect(spec.values.length, name).toBeGreaterThan(1);
    }
  });

  it('leaves a bound value alone, since only the runtime knows it', () => {
    expect(warnings(`<button :aria-expanded="open.get()">More</button>`)).toEqual([]);
  });
});

describe('a reference to an id no template defines', () => {
  it('reports an aria-labelledby that resolves to nothing', () => {
    expect(warnings(`<div role="dialog" aria-labelledby="heading">a</div>`)).toEqual([
      expect.stringContaining('`aria-labelledby` points at `heading`, which no element'),
    ]);
  });

  it('names the near miss when there is one', () => {
    expect(warnings(`<h2 id="title">T</h2><div role="dialog" aria-labelledby="titel">a</div>`)[0])
      .toContain('Did you mean `title`?');
  });

  it('reports each missing id in a list separately', () => {
    expect(warnings(`<h2 id="a">A</h2><div aria-describedby="a b c">x</div>`)).toHaveLength(2);
  });

  it('accepts references that resolve, in either order', () => {
    expect(warnings(`<h2 id="t">T</h2><div role="dialog" aria-labelledby="t">a</div>`)).toEqual([]);
    expect(warnings(`<div role="dialog" aria-labelledby="t">a</div><h2 id="t">T</h2>`)).toEqual([]);
    expect(warnings(`<p id="a">A</p><p id="b">B</p><div aria-describedby="a b">x</div>`)).toEqual([]);
  });

  it('goes quiet once the template computes an id', () => {
    // A row's id is built per item, so nothing here can say which ids exist.
    expect(
      warnings(`<div aria-labelledby="row-3">x</div><p :for="r in rows.get()" :key="r.id" :attr-id="'row-' + r.id">{ r.label }</p>`),
    ).toEqual([]);
  });

  it('still names a near miss where a spread may be carrying ids', () => {
    expect(
      warnings(`<h2 id="title">T</h2><div aria-labelledby="titel">a</div><img :spread="p()">`)[0],
    ).toContain('Did you mean `title`?');
    expect(warnings(`<div aria-labelledby="nowhere">a</div><img :spread="p()">`)).toEqual([]);
  });
});

describe('a role that is not one', () => {
  it('rejects a misspelled role and names the one meant', () => {
    expect(() => compile(`<div role="buton" tabindex="0">Go</div>`)).toThrow(
      /`role="buton"` is not an ARIA role — did you mean `button`\?/,
    );
  });

  it('rejects an abstract role, which markup may never use', () => {
    expect(() => compile(`<div role="widget">a</div>`)).toThrow(/is not an ARIA role\./);
  });

  it('accepts a role from an ARIA module this compiler does not carry', () => {
    expect(warnings(`<p role="doc-subtitle">A history</p>`)).toEqual([]);
    expect(warnings(`<svg role="graphics-document"></svg>`)).toEqual([]);
  });

  it('accepts a module role on the element the module puts it on', () => {
    // DPUB's own idioms, on the tags the override table judges: doc-backlink
    // and doc-biblioref have `link` as a superclass and doc-toc has
    // `navigation`, so nothing is lost — and the superclass table is in a
    // vocabulary this compiler does not carry, so it cannot claim otherwise.
    expect(warnings(`<a href="/refs" role="doc-backlink">Back</a>`)).toEqual([]);
    expect(warnings(`<a href="/refs" role="doc-biblioref">[1]</a>`)).toEqual([]);
    expect(warnings(`<nav role="doc-toc"><a href="/a">A</a></nav>`)).toEqual([]);
    expect(warnings(`<main role="doc-chapter">a</main>`)).toEqual([]);
    expect(warnings(`<h2 role="doc-subtitle">A history</h2>`)).toEqual([]);
  });

  it('accepts a fallback chain, and reads every role in it', () => {
    expect(warnings(`<div role="doc-subtitle heading" aria-level="2">T</div>`)).toEqual([]);
    // A browser that does not know the first role falls through to the second,
    // so a name further along the chain is read and has to be one.
    expect(() => compile(`<div role="doc-subtitle headnig">T</div>`)).toThrow(
      /`role="headnig"` is not an ARIA role — did you mean `heading`\?/,
    );
  });
});

describe('a role that takes meaning away instead of adding it', () => {
  it('reports a button role on a link, which still navigates', () => {
    expect(warnings(`<a href="/save" role="button">Save</a>`)).toEqual([
      expect.stringContaining('`role="button"` on `<a>` replaces the link'),
    ]);
  });

  it('reports a link role on a button, which navigates nowhere', () => {
    expect(warnings(`<button role="link">Docs</button>`)).toEqual([
      expect.stringContaining('replaces the button'),
    ]);
  });

  it('reports a role that costs the page its landmarks', () => {
    expect(warnings(`<main role="region">a</main>`)[0]).toContain(
      'replaces the one `main` landmark a page gets',
    );
    expect(warnings(`<nav role="toolbar">a</nav>`)[0]).toContain(
      'replaces the navigation landmark',
    );
  });

  it('reports a role that costs the document an outline entry', () => {
    expect(warnings(`<h2 role="button" tabindex="0">Section</h2>`)[0]).toContain(
      'replaces the heading',
    );
  });

  it('rejects a presentational role on something a keyboard still focuses', () => {
    expect(() => compile(`<button role="presentation">x</button>`)).toThrow(
      /which a keyboard can still focus/,
    );
    expect(() => compile(`<a href="/x" role="none">x</a>`)).toThrow(
      /which a keyboard can still focus/,
    );
  });

  it('accepts a role that adds meaning the element did not have', () => {
    // Every one of these is the Authoring Practices' own pattern: the element
    // keeps doing what it did and gains a name for the part it plays.
    expect(warnings(`<a href="#panel" role="tab" aria-selected="true">One</a>`)).toEqual([]);
    expect(warnings(`<a href="/new" role="menuitem">New</a>`)).toEqual([]);
    expect(warnings(`<button role="switch" aria-checked="false">Wi-Fi</button>`)).toEqual([]);
    expect(warnings(`<button role="tab" aria-selected="false">Two</button>`)).toEqual([]);
    expect(warnings(`<button role="combobox" aria-expanded="false">Pick</button>`)).toEqual([]);
  });

  it('accepts a presentational role where it is the idiom', () => {
    expect(warnings(`<img src="/rule.png" alt="" role="presentation">`)).toEqual([]);
    // The tabs pattern: the list item carries nothing, the link is the tab.
    expect(warnings(`<ul role="tablist"><li role="presentation"><a href="#p" role="tab">One</a></li></ul>`))
      .toEqual([]);
  });

  it('accepts a role that only restates what the element already was', () => {
    expect(warnings(`<nav role="navigation">a</nav>`)).toEqual([]);
    expect(warnings(`<a href="/x" role="link">x</a>`)).toEqual([]);
  });

  it('accepts a role on an anchor that goes nowhere, which had no link to lose', () => {
    // `<a>` without `href` is a placeholder the accessibility tree ignores;
    // the role is the first thing it has been.
    expect(warnings(`<a role="button" tabindex="0" :click="save()">Save</a>`)).toEqual([]);
  });

  it('accepts a heading kept out of the outline on purpose', () => {
    // A visual heading that is not a section: the outline entry is exactly
    // what `role="presentation"` is there to give up.
    expect(warnings(`<h2 role="presentation">Filters</h2>`)).toEqual([]);
    expect(warnings(`<h3 role="none">Sort</h3>`)).toEqual([]);
  });
});

describe('a positive tabindex', () => {
  it('rejects it, because it reorders every page the component lands on', () => {
    expect(() => compile(`<div tabindex="1" role="button">Go</div>`)).toThrow(
      /`tabindex="1"` puts this element in front of the whole page/,
    );
  });

  it('accepts the two values that order nothing', () => {
    expect(warnings(`<div tabindex="0" role="button" :click="go()">Go</div>`)).toEqual([]);
    expect(warnings(`<div tabindex="-1" role="option">One</div>`)).toEqual([]);
  });
});

describe('nesting the ARIA content model forbids', () => {
  it('rejects a control inside a role whose contents become its name', () => {
    expect(() => compile(`<div role="option"><button :click="remove()">Remove</button></div>`))
      .toThrow(/`<button>` inside `role="option"`, which flattens everything in it to text/);
  });

  it('rejects a heading inside a button', () => {
    expect(() => compile(`<button :click="open()"><h2>Details</h2></button>`)).toThrow(
      /`<h2>` inside `<button>`, which flattens everything in it to text/,
    );
  });

  it('rejects a link inside a tab', () => {
    expect(() => compile(`<div role="tab"><a href="/docs">Docs</a></div>`)).toThrow(
      /flattens everything in it to text/,
    );
  });

  it('follows the nesting through a component, whose children still land inside', () => {
    expect(() => compile(`<div role="option"><v-badge><button>x</button></v-badge></div>`))
      .toThrow(/flattens everything in it to text/);
  });

  it('rejects an element that only its role makes a control', () => {
    // Nothing about a `<div>` is focusable, so the role is the whole reason
    // this is a control — and the whole reason the nesting is wrong.
    expect(() => compile(`<div role="option"><div role="button">Remove</div></div>`)).toThrow(
      /`<div>` inside `role="option"`, which flattens everything in it to text/,
    );
  });

  it('rejects a control the tag alone makes focusable', () => {
    // Named in the message, so the finding is about this element rather than
    // something further down that would have been reported anyway.
    expect(() => compile(`<div role="option"><select></select></div>`)).toThrow(
      /`<select>` inside `role="option"`, which flattens everything in it to text/,
    );
    expect(() => compile(`<div role="option"><textarea></textarea></div>`)).toThrow(
      /`<textarea>` inside `role="option"`/,
    );
    // A media element is only focusable once it has controls to operate.
    expect(() => compile(`<div role="option"><audio controls></audio></div>`)).toThrow(
      /`<audio>` inside `role="option"`/,
    );
    expect(() => compile(`<div role="option"><video controls></video></div>`)).toThrow(
      /`<video>` inside `role="option"`/,
    );
  });

  it('rejects a control inside an element that flattens without being told to', () => {
    // No role written anywhere: `<progress>`, `<meter>` and `<option>` each
    // announce their contents as their own name on their own.
    expect(() => compile(`<progress value="3" max="10"><button>Stop</button></progress>`)).toThrow(
      /`<button>` inside `<progress>`/,
    );
    expect(() => compile(`<meter value="3" max="10"><button>Stop</button></meter>`)).toThrow(
      /`<button>` inside `<meter>`/,
    );
    expect(() => compile(`<select><option><button>x</button></option></select>`)).toThrow(
      /`<button>` inside `<option>`/,
    );
    expect(warnings(`<progress value="3" max="10"><span>3 of 10</span></progress>`)).toEqual([]);
  });

  it('names making the two siblings as the remedy', () => {
    expect(() => compile(`<div role="option"><input type="checkbox"></div>`)).toThrow(
      /Make the two siblings — the control beside the `option`, not inside/,
    );
  });

  it('accepts the content these roles are built from', () => {
    expect(warnings(`<button :click="save()"><img src="/save.svg" alt=""><span>Save</span></button>`))
      .toEqual([]);
    expect(warnings(`<button><span aria-hidden="true">x</span> Close</button>`)).toEqual([]);
    expect(warnings(`<div role="option"><span class="badge">3</span> Ada</div>`)).toEqual([]);
    // Neither of these can be operated, so neither is a control caught in the
    // name: a media element without controls, and an input that renders none.
    expect(warnings(`<div role="option"><video></video> Clip</div>`)).toEqual([]);
    expect(warnings(`<div role="option"><input type="hidden"> Ada</div>`)).toEqual([]);
  });

  it('accepts a heading inside a link, which does not flatten its contents', () => {
    expect(warnings(`<a href="/post"><h2>Title</h2><p>Summary</p></a>`)).toEqual([]);
  });

  it('accepts controls inside a role that owns them', () => {
    expect(warnings(`<div role="listbox"><div role="option" tabindex="-1">a</div></div>`))
      .toEqual([]);
    expect(warnings(`<div role="toolbar"><button>a</button><button>b</button></div>`)).toEqual([]);
  });

  it('accepts a component inside, because its root element is unknowable here', () => {
    expect(warnings(`<button :click="save()"><v-icon name="save"></v-icon> Save</button>`))
      .toEqual([]);
  });

  it('leaves a portalled control to the container it lands in', () => {
    expect(warnings(`<button :click="open()">Open<span :portal><a href="/x">go</a></span></button>`))
      .toEqual([]);
  });
});

describe('an attribute written with no value', () => {
  it('rejects an empty aria-*, whichever kind it is', () => {
    // One answer across the kinds, or the same mistake is an error on
    // `aria-live` and silence on `aria-labelledby` for no reason anyone
    // reading the messages could reconstruct.
    for (const name of ['aria-live', 'aria-level', 'aria-labelledby', 'aria-relevant']) {
      expect(() => compile(`<div ${name}="">a</div>`)).toThrow(
        new RegExp(`\`${name}\` is written with no value`),
      );
    }
  });

  it('rejects the bare attribute, which sets nothing either', () => {
    // `<span aria-hidden>` reads as hidden and hides nothing: a browser takes
    // an empty value for an absent one, so the icon is still announced.
    expect(() => compile(`<span aria-hidden>x</span>`)).toThrow(
      /`aria-hidden` is written with no value/,
    );
  });

  it('accepts an empty role and an empty tabindex, which ask for nothing', () => {
    // `role=""` is HTML's own way of writing no role, and the tabindex rule is
    // about positive values only — neither is a state left half set.
    expect(warnings(`<div role="">a</div>`)).toEqual([]);
    expect(warnings(`<div role="  ">a</div>`)).toEqual([]);
    expect(warnings(`<div tabindex="">a</div>`)).toEqual([]);
  });

  it('quotes a tabindex the way it was written', () => {
    // Reformatting the value in the message is one more thing for the author
    // to fail to find in the file.
    expect(() => compile(`<div tabindex=" 2 " role="button">a</div>`)).toThrow(
      /`tabindex=" 2 "` puts this element in front of the whole page/,
    );
  });
});

describe('a caller that disagrees', () => {
  it('turns every refusal into a warning, and finishes the pass', () => {
    // The escape hatch a rule needs in order to be worth having: a finding
    // that is wrong about this template must not be a build nobody can run.
    expect(warnings(`<img src="/a.png"><div :click="go()">x</div>`, { a11y: 'warn' })).toEqual([
      expect.stringContaining('`<img>` with no `alt`'),
      expect.stringContaining('`:click` on `<div>`'),
    ]);
  });

  it('skips the pass entirely', () => {
    expect(warnings(`<img src="/a.png">`, { a11y: 'off' })).toEqual([]);
    expect(warnings(`<div :click="go()">x</div>`, { a11y: 'off' })).toEqual([]);
  });

  it('refuses by default, so the way out has to be asked for', () => {
    expect(() => compile(`<img src="/a.png">`)).toThrow(/`<img>` with no `alt`/);
  });
});

describe('when an error ends the pass', () => {
  it('carries out the warnings it had already found', () => {
    // Otherwise one refusal hides every softer finding in the template until
    // somebody fixes it, and then the next one hides the rest.
    try {
      compile(`<div :click="a()">x</div><img src="/y.png">`);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(CompilerError);
      expect((error as CompilerError).warnings.map((w) => w.message)).toEqual([
        expect.stringContaining('`:click` on `<div>`'),
      ]);
    }
  });
});

describe('where a finding points', () => {
  it('names the file and the line an error is on', () => {
    expect(() =>
      compile(`<div>\n  <img src="/ada.png">\n</div>`, { filename: 'src/card.html' }),
    ).toThrow(/src\/card\.html:2:3/);
  });

  it('gives a warning the same line an error would print', () => {
    const [warning] = compile(`<div>\n  <p :click="pick()">a</p>\n</div>`, {
      filename: 'src/card.html',
    }).warnings;
    expect(formatDiagnostic(warning!)).toMatch(
      /^\[volt:compiler\] `:click` on `<p>`.*\(src\/card\.html:2:6\)$/s,
    );
  });
});
