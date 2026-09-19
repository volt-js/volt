/**
 * Finding elements by role and name.
 *
 * Half of what is asserted here is the failure: a query that cannot find
 * anything has to say what it did find, because "found no button named Save"
 * on its own sends you to read the component rather than the one line of
 * markup that changed.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { getAllByRole, getByRole, queryAllByRole, queryByRole } from '../src/queries.ts';

beforeEach(() => {
  document.body.innerHTML = '';
});

const markup = (html: string): HTMLElement => {
  document.body.innerHTML = html;
  return document.body;
};

describe('by role', () => {
  it('finds every match in document order', () => {
    const root = markup('<button>One</button><div role="button">Two</div><a href="/x">Three</a>');
    expect(queryAllByRole(root, 'button').map((el) => el.textContent)).toEqual(['One', 'Two']);
  });

  it('narrows by accessible name', () => {
    const root = markup('<button>Save</button><button>Cancel</button>');
    expect(getByRole(root, 'button', { name: 'Cancel' }).textContent).toBe('Cancel');
  });

  it('matches a name in full, so a prefix does not find the wrong control', () => {
    const root = markup('<button>Save as…</button>');
    // The trap this rule exists for: a substring match would hand back "Save
    // as…" for `name: 'Save'` and the test would pass against the wrong button.
    expect(queryByRole(root, 'button', { name: 'Save' })).toBeNull();
    expect(getByRole(root, 'button', { name: 'Save as…' })).toBeTruthy();
    expect(getByRole(root, 'button', { name: /^save/i }).textContent).toBe('Save as…');
  });

  it('tests a global or sticky pattern against every name from the start', () => {
    const root = markup('<button>Save</button><button>Save</button><button>Save</button>');
    const global = /save/gi;
    const sticky = /Save/y;

    // `test()` on a pattern with either flag resumes from where its last match
    // ended, so asking it once per element would find every other one — and
    // the query would leave the caller's pattern part way through a string.
    expect(queryAllByRole(root, 'button', { name: global })).toHaveLength(3);
    expect(queryAllByRole(root, 'button', { name: sticky })).toHaveLength(3);
    expect(global.lastIndex).toBe(0);
    expect(sticky.lastIndex).toBe(0);
  });

  it('ignores the whitespace a template puts in the markup', () => {
    const root = markup('<button>\n   Save\n   changes\n  </button>');
    expect(getByRole(root, 'button', { name: 'Save changes' })).toBeTruthy();
  });

  it('filters by ARIA state', () => {
    const root = markup(
      '<div role="option" aria-selected="true">A</div>' +
        '<div role="option" aria-selected="false">B</div>',
    );
    expect(getByRole(root, 'option', { selected: true }).textContent).toBe('A');
    expect(getByRole(root, 'option', { selected: false }).textContent).toBe('B');
    expect(queryAllByRole(root, 'option')).toHaveLength(2);
  });

  it('reads a native control state from the control rather than from the markup', () => {
    const root = markup(
      '<input id="a" type="checkbox" aria-label="Ship"><input id="b" type="checkbox" aria-label="Draft">',
    );
    const ship = root.querySelector<HTMLInputElement>('#a')!;
    ship.checked = true;

    // Nothing in the markup changed — `checked` is a property, and an
    // attribute-only match would find neither box and quietly agree with a
    // test asserting the wrong thing.
    expect(ship.getAttribute('aria-checked')).toBeNull();
    expect(getByRole(root, 'checkbox', { checked: true })).toBe(ship);
    expect(getByRole(root, 'checkbox', { checked: false }).id).toBe('b');

    ship.indeterminate = true;
    expect(queryByRole(root, 'checkbox', { checked: true })).toBeNull();
  });

  it('reads a native option the same way', () => {
    const root = markup('<select multiple><option id="a">A</option><option id="b">B</option></select>');
    root.querySelector<HTMLOptionElement>('#b')!.selected = true;

    expect(getByRole(root, 'option', { selected: true }).id).toBe('b');
  });

  it('lets an explicit ARIA attribute win over the native property', () => {
    const root = markup('<input type="checkbox" aria-label="Ship" aria-checked="mixed">');
    const box = root.querySelector<HTMLInputElement>('input')!;
    box.checked = true;

    // The author said mixed; a screen reader announces mixed.
    expect(queryByRole(root, 'checkbox', { checked: true })).toBeNull();
  });

  it('leaves out what the accessibility tree leaves out', () => {
    const root = markup(
      '<button>Visible</button>' +
        '<div aria-hidden="true"><button>Portalled away</button></div>' +
        '<div style="display:none"><button>Closed</button></div>',
    );
    expect(queryAllByRole(root, 'button').map((el) => el.textContent)).toEqual(['Visible']);
    expect(queryAllByRole(root, 'button', { hidden: true })).toHaveLength(3);
  });

  it('scopes to the element it is given', () => {
    markup('<div id="panel"><button>Inside</button></div><button>Outside</button>');
    const panel = document.querySelector<HTMLElement>('#panel')!;
    expect(queryAllByRole(panel, 'button')).toHaveLength(1);
  });
});

describe('when there is nothing to find', () => {
  it('queryBy returns null and getBy throws', () => {
    const root = markup('<button>Save</button>');
    expect(queryByRole(root, 'button', { name: 'Delete' })).toBeNull();
    expect(queryAllByRole(root, 'menuitem')).toEqual([]);
    expect(() => getByRole(root, 'button', { name: 'Delete' })).toThrow(/Found no button/);
    expect(() => getAllByRole(root, 'menuitem')).toThrow(/Found no menuitem/);
  });

  it('names the state it was looking for', () => {
    const root = markup('<div role="tab" aria-selected="false">Files</div>');
    expect(() => getByRole(root, 'tab', { name: 'Files', selected: true })).toThrow(
      /named "Files", selected: true/,
    );
  });

  it('lists what the document does contain', () => {
    const root = markup(
      '<div><button>Save</button><div role="tab">Files</div><span>plain</span></div>',
    );
    let message = '';
    try {
      getByRole(root, 'menuitem');
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain('button');
    expect(message).toContain('"Save"');
    expect(message).toContain('tab');
    // A `<span>` has no semantics to have got wrong, and listing every one of
    // them would bury the two lines above.
    expect(message).not.toContain('generic');
  });

  it('stops listing after a while rather than printing a whole page', () => {
    const root = markup(
      Array.from({ length: 25 }, (_, i) => `<button>Button ${i}</button>`).join(''),
    );
    let message = '';
    try {
      getByRole(root, 'menuitem');
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain('"Button 19"');
    expect(message).not.toContain('"Button 20"');
    expect(message).toContain('… and 5 more');
  });

  it('says so when nothing at all exposes a role', () => {
    const root = markup('<div><span>text</span></div>');
    expect(() => getByRole(root, 'button')).toThrow(/Nothing in the document exposes a role/);
  });
});

describe('when several match', () => {
  it('getBy and queryBy both refuse to guess, and name the candidates', () => {
    const root = markup('<button>Save</button><button>Cancel</button>');
    expect(() => getByRole(root, 'button')).toThrow(/Found 2 elements/);
    expect(() => queryByRole(root, 'button')).toThrow(/Found 2 elements/);

    let message = '';
    try {
      getByRole(root, 'button');
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('button "Save"');
    expect(message).toContain('button "Cancel"');
  });

  it('getAllBy is how several are asked for', () => {
    const root = markup('<button>Save</button><button>Cancel</button>');
    expect(getAllByRole(root, 'button')).toHaveLength(2);
  });
});
