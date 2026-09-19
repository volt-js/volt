/**
 * The token skipping, asserted directly.
 *
 * Every pass built on it is tested through a transform, which is where a
 * misread token shows up as a wrong build. Which `/` opens a regular
 * expression is decided here and nowhere else, though, and the inputs that
 * decide it are single lines — so they are given to the scan itself rather
 * than wrapped in a component for each one.
 */

import { describe, expect, it } from 'vitest';
import { findKeyword, isRegexStart } from '../src/scan.js';

/** Whether the first `/` in `code` is read as opening a regular expression. */
const opensRegex = (code: string): boolean => isRegexStart(code, code.indexOf('/'));

describe('a slash', () => {
  it('opens a regular expression where a value is expected', () => {
    expect(opensRegex('const re = /x/;')).toBe(true);
    expect(opensRegex('test(/x/)')).toBe(true);
    expect(opensRegex('return /x/.test(s);')).toBe(true);
    expect(opensRegex('a + /x/.source')).toBe(true);
  });

  it('divides after a value', () => {
    expect(opensRegex('width / 2')).toBe(false);
    expect(opensRegex('(a + b) / 2')).toBe(false);
    expect(opensRegex('xs[0] / 2')).toBe(false);
  });

  it('divides after a non-null assertion, and opens after a negation', () => {
    expect(opensRegex('box.width! / 2')).toBe(false);
    expect(opensRegex('sizes.get(key)! / 2')).toBe(false);
    expect(opensRegex('rows[0]! / 2')).toBe(false);

    expect(opensRegex('ok = !/x/.test(s)')).toBe(true);
    expect(opensRegex('ok = !!/x/.test(s)')).toBe(true);
    expect(opensRegex('return !/x/.test(s)')).toBe(true);
    expect(opensRegex('return!/x/.test(s)')).toBe(true);
    // No semicolon ends the first line, and the second still negates.
    expect(opensRegex('const a = b\n!/x/.test(s) && run()')).toBe(true);
  });

  it('divides after a postfix increment or decrement', () => {
    expect(opensRegex('i++ / 2')).toBe(false);
    expect(opensRegex('i-- / 2')).toBe(false);
  });
});

describe('a keyword looked for after a division', () => {
  // A division read as a regular expression runs to the next slash on its
  // line. When a backtick follows that, the rest of the module is read as a
  // template literal and nothing declared in it is found.
  it('is found past a non-null assertion that divides', () => {
    const code = 'const half = box.width! / 2, glob = `src/${x}`;\nexport class Counter {}';

    expect(findKeyword(code, 'export')).toEqual([code.indexOf('export')]);
  });

  it('is found past a postfix increment that divides', () => {
    const code = 'const n = i++ / 2; const p = `a/b`;\nexport class Counter {}';

    expect(findKeyword(code, 'export')).toEqual([code.indexOf('export')]);
  });
});
