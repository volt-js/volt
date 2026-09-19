/**
 * Role and accessible name, against plain markup.
 *
 * These are the two computations every query in this package rests on, so they
 * are tested directly rather than only through the queries: a wrong role makes
 * `getByRole` fail with a message about the query, and the actual mistake is
 * one layer down.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  getAccessibleName,
  getRole,
  isAccessibilityHidden,
  isTextField,
  normalizeText,
} from '../src/aria.ts';

beforeEach(() => {
  document.body.innerHTML = '';
});

function markup(html: string): HTMLElement {
  document.body.innerHTML = html;
  return document.body;
}

const at = (selector: string): Element => document.querySelector(selector)!;

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

describe('role', () => {
  it('prefers what the author wrote', () => {
    markup('<button role="tab">Files</button>');
    expect(getRole(at('button'))).toBe('tab');
  });

  it('reads the first token of a role list, the way the platform does', () => {
    markup('<div role="  switch  checkbox ">x</div>');
    expect(getRole(at('div'))).toBe('switch');
  });

  it('falls back to the tag', () => {
    markup('<button>a</button><ul><li>b</li></ul><h2>c</h2><textarea></textarea>');
    expect(getRole(at('button'))).toBe('button');
    expect(getRole(at('ul'))).toBe('list');
    expect(getRole(at('li'))).toBe('listitem');
    expect(getRole(at('h2'))).toBe('heading');
    expect(getRole(at('textarea'))).toBe('textbox');
  });

  it('makes an anchor a link only when it can be followed', () => {
    markup('<a href="/x" id="real">go</a><a id="fake">go</a>');
    expect(getRole(at('#real'))).toBe('link');
    expect(getRole(at('#fake'))).toBe('generic');
  });

  it('reads the input type', () => {
    markup(
      '<input id="t"><input id="c" type="checkbox"><input id="n" type="number">' +
        '<input id="r" type="range"><input id="s" type="submit"><input id="h" type="hidden">',
    );
    expect(getRole(at('#t'))).toBe('textbox');
    expect(getRole(at('#c'))).toBe('checkbox');
    expect(getRole(at('#n'))).toBe('spinbutton');
    expect(getRole(at('#r'))).toBe('slider');
    expect(getRole(at('#s'))).toBe('button');
    expect(getRole(at('#h'))).toBeNull();
  });

  it('gives an input the role a browser exposes it with, and none where ARIA has none', () => {
    markup(
      '<input id="pw" type="password"><input id="file" type="file"><input id="odd" type="nonsense">' +
        '<input id="color" type="color"><input id="date" type="date"><input id="time" type="time">' +
        '<input id="local" type="datetime-local"><input id="month" type="month">' +
        '<input id="week" type="week">',
    );
    // What a browser's tree says: a password field is a text field whose
    // characters are not read out, and a file input is the button that opens
    // the chooser. A type the host language does not know is a text field.
    expect(getRole(at('#pw'))).toBe('textbox');
    expect(getRole(at('#file'))).toBe('button');
    expect(getRole(at('#odd'))).toBe('textbox');
    // A colour well and the date and time pickers are exposed as widgets of
    // their own that no ARIA role names, so there is no role to find them by —
    // and calling them text boxes would let a test ask for one by a role no
    // screen reader announces.
    for (const id of ['#color', '#date', '#time', '#local', '#month', '#week']) {
      expect(getRole(at(id)), id).toBeNull();
    }
  });

  it('makes any field that takes suggestions a combobox, a search field included', () => {
    markup(
      '<datalist id="dl"><option value="a"></option></datalist>' +
        '<input id="s" type="search"><input id="sl" type="search" list="dl">' +
        '<input id="tl" list="dl"><input id="pl" type="password" list="dl">',
    );
    expect(getRole(at('#s'))).toBe('searchbox');
    expect(getRole(at('#sl'))).toBe('combobox');
    expect(getRole(at('#tl'))).toBe('combobox');
    // `list` does not apply to a password field, so it stays what it was.
    expect(getRole(at('#pl'))).toBe('textbox');
  });

  it('takes a decorative image out of the tree and leaves an informative one in', () => {
    markup('<img id="a" alt=""><img id="b" alt="A cat">');
    expect(getRole(at('#a'))).toBe('presentation');
    expect(getRole(at('#b'))).toBe('img');
  });

  it('makes a section a region only once it is named', () => {
    markup('<section id="a">x</section><section id="b" aria-label="Filters">y</section>');
    expect(getRole(at('#a'))).toBe('generic');
    expect(getRole(at('#b'))).toBe('region');
  });

  it('counts a title as the name that makes a section a region', () => {
    // A `title` is a name — the name computation here takes it, and a browser
    // exposes the section as a region called by it — so the role has to agree,
    // or the landmark is one a test can name and cannot find.
    markup('<section id="a" title="Filters">x</section>');
    expect(getRole(at('#a'))).toBe('region');
    expect(getAccessibleName(at('#a'))).toBe('Filters');
  });

  it('scopes banner and contentinfo to the page', () => {
    markup('<header id="page">a</header><article><header id="card">b</header></article>');
    expect(getRole(at('#page'))).toBe('banner');
    expect(getRole(at('#card'))).toBe('generic');
  });
});

// ---------------------------------------------------------------------------
// Accessible name
// ---------------------------------------------------------------------------

describe('accessible name', () => {
  it('collapses whitespace, because that is how it is announced', () => {
    expect(normalizeText('  Save\n   all  ')).toBe('Save all');
    markup('<button>\n  Save\n  all\n</button>');
    expect(getAccessibleName(at('button'))).toBe('Save all');
  });

  it('follows aria-labelledby before anything else', () => {
    markup('<span id="t">Delete</span><button aria-label="Ignored" aria-labelledby="t">x</button>');
    expect(getAccessibleName(at('button'))).toBe('Delete');
  });

  it('joins several labelledby targets in the order given', () => {
    markup(
      '<span id="a">Delete</span><span id="b">file</span>' +
        '<button aria-labelledby="b a">x</button>',
    );
    expect(getAccessibleName(at('button'))).toBe('file Delete');
  });

  it('reads a labelledby target that is hidden', () => {
    markup('<span id="t" hidden>Close</span><button aria-labelledby="t">×</button>');
    expect(getAccessibleName(at('button'))).toBe('Close');
  });

  it('stops a reference cycle rather than following it round', () => {
    // Naming the button reads the group it points at, and naming the group
    // reads what it contains — the button among it. Nothing may contribute to
    // the name being computed for it.
    markup('<div id="total">Total <button id="clear" aria-labelledby="total">7</button></div>');
    expect(getAccessibleName(at('#clear'))).toBe('Total');

    // The same cycle through the host language, and the one that recurses
    // without end: each label names the other's field.
    markup('<label for="b">First <input id="a"></label><label for="a">Second <input id="b"></label>');
    expect(() => getAccessibleName(at('#a'))).not.toThrow();
  });

  it('falls back to aria-label, then to content', () => {
    markup('<button aria-label="Close dialog">×</button><button id="c">Save</button>');
    expect(getAccessibleName(at('button'))).toBe('Close dialog');
    expect(getAccessibleName(at('#c'))).toBe('Save');
  });

  it('takes a name from content only where the role allows it', () => {
    markup('<div role="button" id="b">Save</div><div role="region" id="r">Save</div>');
    expect(getAccessibleName(at('#b'))).toBe('Save');
    expect(getAccessibleName(at('#r'))).toBe('');
  });

  it('reads an icon button labelled on the icon', () => {
    markup('<button><svg aria-label="Trash"></svg></button>');
    expect(getAccessibleName(at('button'))).toBe('Trash');
  });

  it('names a field from its label, wrapping or by id', () => {
    markup(
      '<label for="a">Email</label><input id="a">' +
        '<label>Password <input id="b"></label>' +
        '<textarea id="c"></textarea><label for="c">Notes</label>',
    );
    expect(getAccessibleName(at('#a'))).toBe('Email');
    expect(getAccessibleName(at('#b'))).toBe('Password');
    expect(getAccessibleName(at('#c'))).toBe('Notes');
  });

  it('keeps a field named after something is typed into it', () => {
    markup('<label>Age <input id="a"></label>');
    (at('#a') as HTMLInputElement).value = '41';
    expect(getAccessibleName(at('#a'))).toBe('Age');
  });

  it('reads the host language name for the tags that carry one', () => {
    markup(
      '<img id="i" alt="A cat"><fieldset id="f"><legend>Size</legend></fieldset>' +
        '<table id="t"><caption>Rows</caption></table>' +
        '<figure id="g"><figcaption>Fig 1</figcaption></figure>' +
        '<input id="s" type="submit"><input id="v" type="submit" value="Send">',
    );
    expect(getAccessibleName(at('#i'))).toBe('A cat');
    expect(getAccessibleName(at('#f'))).toBe('Size');
    expect(getAccessibleName(at('#t'))).toBe('Rows');
    expect(getAccessibleName(at('#g'))).toBe('Fig 1');
    expect(getAccessibleName(at('#s'))).toBe('Submit');
    expect(getAccessibleName(at('#v'))).toBe('Send');
  });

  it('uses title, then placeholder, only when there is nothing better', () => {
    markup('<input id="t" title="Search"><input id="p" placeholder="Search"><input id="b" title="T" placeholder="P">');
    expect(getAccessibleName(at('#t'))).toBe('Search');
    expect(getAccessibleName(at('#p'))).toBe('Search');
    expect(getAccessibleName(at('#b'))).toBe('T');
  });

  it('leaves out content hidden from the tree', () => {
    markup('<button>Save<span aria-hidden="true"> (⌘S)</span></button>');
    expect(getAccessibleName(at('button'))).toBe('Save');
  });
});

// ---------------------------------------------------------------------------
// Hidden
// ---------------------------------------------------------------------------

describe('hidden from the accessibility tree', () => {
  it('reads aria-hidden and hidden, including from an ancestor', () => {
    markup(
      '<div aria-hidden="true"><button id="a">a</button></div>' +
        '<div hidden><button id="b">b</button></div>' +
        '<button id="c">c</button>',
    );
    expect(isAccessibilityHidden(at('#a'))).toBe(true);
    expect(isAccessibilityHidden(at('#b'))).toBe(true);
    expect(isAccessibilityHidden(at('#c'))).toBe(false);
  });

  it('leaves out an inert subtree, which a browser takes out of the tree', () => {
    markup(
      '<div inert><button id="a">a</button></div><button id="b" inert>b</button>' +
        '<button id="c">c</button>',
    );
    // Markup that relies on `inert` alone — no `aria-hidden` beside it — is
    // what a screen reader cannot reach, and a query that found it would let
    // a test press something no user can.
    expect(isAccessibilityHidden(at('#a'))).toBe(true);
    expect(isAccessibilityHidden(at('#b'))).toBe(true);
    expect(isAccessibilityHidden(at('#c'))).toBe(false);
  });

  it('walks up for display, which does not inherit', () => {
    markup('<div style="display:none"><button id="a">a</button></div>');
    expect(isAccessibilityHidden(at('#a'))).toBe(true);
  });

  it('lets a descendant turn visibility back on', () => {
    markup(
      '<div style="visibility:hidden">' +
        '<button id="a">a</button>' +
        '<button id="b" style="visibility:visible">b</button>' +
        '</div>',
    );
    // The whole point of the split: `visibility` inherits, so the computed
    // value is the answer, and #b opted back in.
    expect(isAccessibilityHidden(at('#a'))).toBe(true);
    expect(isAccessibilityHidden(at('#b'))).toBe(false);
  });
});

describe('text fields', () => {
  it('knows what can be typed into', () => {
    markup(
      '<textarea id="a"></textarea><input id="b"><input id="c" type="email">' +
        '<input id="d" type="checkbox"><input id="e" type="range"><div id="f"></div>',
    );
    expect(isTextField(at('#a'))).toBe(true);
    expect(isTextField(at('#b'))).toBe(true);
    expect(isTextField(at('#c'))).toBe(true);
    expect(isTextField(at('#d'))).toBe(false);
    expect(isTextField(at('#e'))).toBe(false);
    expect(isTextField(at('#f'))).toBe(false);
  });
});
