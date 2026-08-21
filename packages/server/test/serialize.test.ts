// @vitest-environment node

/**
 * The wire format, and the two different jobs it has.
 *
 * Outbound it is a gate: a database row does not cross a `@Server()` boundary
 * unless its type says it may, and the runtime half of that rule is a refusal
 * for anything whose prototype is not `Object.prototype`. Inbound it is a
 * parser for a body that did not come from a Volt client, which for a public
 * endpoint is the normal case rather than the exception.
 *
 * `JSON.stringify` is neither. It fails silently in both directions, which is
 * what most of the round trips below are about.
 */

import { describe, expect, it } from 'vitest';
import { fromWire, toWire, WireError } from '../src/serialize.js';

/** Encode, go through JSON as a response really does, and decode. */
function roundTrip(value: unknown): unknown {
  return fromWire(JSON.parse(JSON.stringify(toWire(value, 'the return value'))), 'the return value');
}

describe('what JSON alone would have corrupted', () => {
  it('keeps `undefined` in an object rather than dropping the key', () => {
    expect(roundTrip({ a: 1, b: undefined })).toEqual({ a: 1, b: undefined });
    expect(Object.keys(roundTrip({ a: 1, b: undefined }) as object)).toEqual(['a', 'b']);
  });

  it('keeps `undefined` in an array rather than turning it into null', () => {
    expect(roundTrip([1, undefined, 3])).toEqual([1, undefined, 3]);
  });

  it('keeps the three numbers JSON turns into null', () => {
    // A rate of `Infinity` arriving as zero-ish is a corruption nobody sees.
    expect(roundTrip([Number.NaN, Infinity, -Infinity])).toEqual([Number.NaN, Infinity, -Infinity]);
  });

  it('keeps a Date a Date rather than a string', () => {
    const now = new Date('2026-08-19T06:00:00.000Z');
    const back = roundTrip({ at: now }) as { at: Date };

    expect(back.at).toBeInstanceOf(Date);
    expect(back.at.getTime()).toBe(now.getTime());
  });

  it('keeps a bigint, which JSON refuses outright', () => {
    expect(roundTrip({ id: 9007199254740993n })).toEqual({ id: 9007199254740993n });
  });

  it('leaves everything JSON already carried alone', () => {
    const value = { a: 'x', b: 1, c: true, d: null, e: [1, 'two', { f: false }] };
    expect(roundTrip(value)).toEqual(value);
  });

  it('carries an object that happens to hold the reserved key', () => {
    // The format's own escape hatch, so no application has to know the key
    // exists in order not to collide with it.
    expect(roundTrip({ $v: 'mine' })).toEqual({ $v: 'mine' });
    expect(roundTrip({ $v: ['u'] })).toEqual({ $v: ['u'] });
  });
});

describe('what must not cross the boundary', () => {
  class Row {
    id = 1;
    passwordHash = 'argon2id$...';
    save(): void {}
  }

  it('refuses a class instance, which is how a row leaks', () => {
    // `JSON.stringify` would flatten this to its own enumerable fields — id and
    // the hash — and nobody would find out until the hash was in a response.
    expect(() => toWire(new Row(), 'the return value')).toThrow(WireError);
    expect(() => toWire(new Row(), 'the return value')).toThrow(/an instance of Row/);
  });

  it('names the path to it, so the refusal does not have to be bisected', () => {
    expect(() => toWire({ page: { rows: [{ row: new Row() }] } }, 'the return value')).toThrow(
      /at page\.rows\[0\]\.row/,
    );
  });

  it('names which side of the call it was, since the two are fixed in different files', () => {
    expect(() => toWire(new Row(), 'an argument')).toThrow(/an argument .*cannot cross/);
  });

  it('refuses a function and a symbol', () => {
    expect(() => toWire({ onDone: () => {} }, 'the return value')).toThrow(/a function/);
    expect(() => toWire({ key: Symbol('k') }, 'the return value')).toThrow(/a symbol/);
  });

  it('refuses a Map and a Set rather than sending an empty object', () => {
    expect(() => toWire(new Map([['a', 1]]), 'the return value')).toThrow(/an instance of Map/);
    expect(() => toWire(new Set([1]), 'the return value')).toThrow(/an instance of Set/);
  });

  it('carries a null-prototype record, which is a dictionary by intent', () => {
    const record = Object.assign(Object.create(null) as Record<string, number>, { a: 1 });
    expect(roundTrip(record)).toEqual({ a: 1 });
  });

  it('refuses a cycle, which no HTTP response can carry', () => {
    const node: Record<string, unknown> = { name: 'a' };
    node.self = node;

    expect(() => toWire(node, 'the return value')).toThrow(/contains a cycle/);
  });

  it('allows the same object twice when it is not a cycle', () => {
    const shared = { id: 1 };
    expect(roundTrip({ a: shared, b: shared })).toEqual({ a: { id: 1 }, b: { id: 1 } });
  });

  it('refuses an invalid Date, which round-trips as neither a date nor an error', () => {
    expect(() => toWire({ at: new Date('nonsense') }, 'the return value')).toThrow(
      /is an invalid Date/,
    );
  });

  it('says what is allowed, since the remedy is to write the shape out', () => {
    expect(() => toWire(new Row(), 'the return value')).toThrow(
      /Map the value to a plain\s+object whose type says exactly what leaves the server/,
    );
  });
});

describe('a body that did not come from a Volt client', () => {
  it('refuses a tag the format does not have', () => {
    expect(() => fromWire({ $v: ['x', 1] }, 'an argument')).toThrow(/unknown tag "x"/);
  });

  it('reads a tagged object only when the tag is the whole of it', () => {
    // Otherwise `{ $v: [...], id: 1 }` would decode as a tag and lose `id`.
    expect(fromWire({ $v: ['u'], id: 1 }, 'an argument')).toEqual({ $v: ['u'], id: 1 });
  });

  it('leaves a plain payload plain', () => {
    expect(fromWire({ a: [1, { b: 'c' }] }, 'an argument')).toEqual({ a: [1, { b: 'c' }] });
  });
});
