/**
 * The wire format for what crosses the server-function boundary.
 *
 * `JSON.stringify` is not it, and fails in the wrong direction — silently — in
 * three ways that all matter here:
 *
 *   - `undefined` vanishes from an object and becomes `null` in an array
 *   - `NaN` and `Infinity` become `null`
 *   - a class instance is flattened to its own enumerable fields, which is
 *     exactly how a database row or a `User` carrying a password hash crosses
 *     a boundary nobody meant to open
 *
 * The first two are corruption, the third is a leak. So this encoder tags what
 * JSON cannot carry and *refuses* what must not travel: a value whose
 * prototype is neither `Object.prototype` nor `null` does not cross, and the
 * refusal names the path to it, because "cannot serialize" without a path is a
 * message you have to bisect a response to act on.
 *
 * `Serializable` in `types.ts` says the same thing to the type checker, which
 * is where an author meets it. This is the half that still holds when the
 * value came back from a driver typed `any`.
 */

/**
 * The one key this format reserves. Kept short because every tagged value
 * pays for it twice, and a user object that really has this key is escaped
 * rather than refused — see `escape` below.
 */
const TAG = '$v';

export class WireError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WireError';
  }
}

/** `a.b[0].c`, built as the walk descends so a refusal can name the field. */
function step(path: string, key: string | number): string {
  return typeof key === 'number' ? `${path}[${key}]` : path ? `${path}.${key}` : key;
}

function refuse(what: string, path: string, value: unknown): never {
  const at = path ? ` at ${path}` : '';
  throw new WireError(
    `[volt] ${what}${at} cannot cross a @Server() boundary: ${describe(value)}.\n` +
      '  Only strings, numbers, booleans, null, undefined, bigints, Dates,\n' +
      '  arrays and plain objects are serialized. Map the value to a plain\n' +
      '  object whose type says exactly what leaves the server.',
  );
}

function describe(value: unknown): string {
  if (typeof value === 'function') return 'a function';
  if (typeof value === 'symbol') return 'a symbol';
  const name = (value as object).constructor?.name;
  return name ? `an instance of ${name}` : 'an object with an unexpected prototype';
}

/**
 * A value the format carries verbatim as an object.
 *
 * `null` prototypes are included because a `Object.create(null)` record is a
 * dictionary by intent, which is the one shape people reach for precisely to
 * avoid prototype surprises.
 */
function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Encode `value` into something `JSON.stringify` carries without loss.
 *
 * `what` names the side of the call for the refusal message — "an argument",
 * "the return value" — since the two fail for different reasons and are fixed
 * in different files.
 */
export function toWire(value: unknown, what: string): unknown {
  return encode(value, what, '', new Set());
}

function encode(value: unknown, what: string, path: string, seen: Set<object>): unknown {
  if (value === null) return null;

  switch (typeof value) {
    case 'string':
    case 'boolean':
      return value;
    case 'number':
      // JSON turns all three into `null`, so a rate of `Infinity` arrives as
      // zero-ish rather than as an error anyone can see.
      return Number.isFinite(value) ? value : { [TAG]: ['f', String(value)] };
    case 'undefined':
      return { [TAG]: ['u'] };
    case 'bigint':
      return { [TAG]: ['n', value.toString()] };
    case 'function':
    case 'symbol':
      refuse(what, path, value);
  }

  const object = value as object;
  if (seen.has(object)) {
    throw new WireError(
      `[volt] ${what}${path ? ` at ${path}` : ''} contains a cycle, which no HTTP ` +
        'response can carry. Send the identifier of the referenced value instead.',
    );
  }
  seen.add(object);
  try {
    if (object instanceof Date) {
      // An invalid Date stringifies to `null` through JSON and to "Invalid
      // Date" through `String`, so neither round-trips; refusing is the only
      // answer that reaches the author.
      if (Number.isNaN(object.getTime())) {
        throw new WireError(
          `[volt] ${what}${path ? ` at ${path}` : ''} is an invalid Date.`,
        );
      }
      return { [TAG]: ['d', object.toISOString()] };
    }
    if (Array.isArray(object)) {
      return object.map((item, index) => encode(item, what, step(path, index), seen));
    }
    if (!isPlainObject(object)) refuse(what, path, object);

    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(object)) {
      out[key] = encode(item, what, step(path, key), seen);
    }
    // A user object that happens to hold exactly the reserved key is wrapped
    // rather than refused: the format's own escape hatch, so no application
    // has to know the key exists.
    return TAG in out && Object.keys(out).length === 1 ? { [TAG]: ['o', out] } : out;
  } finally {
    seen.delete(object);
  }
}

/**
 * Rebuild what `toWire` encoded.
 *
 * Every refusal here is about a body that did not come from a Volt client —
 * which, for a public endpoint, is the normal case rather than the exception.
 */
export function fromWire(value: unknown, what: string): unknown {
  if (value === null || typeof value !== 'object') return value;

  if (Array.isArray(value)) return value.map((item) => fromWire(item, what));

  const record = value as Record<string, unknown>;
  const tagged = record[TAG];
  if (!Array.isArray(tagged) || Object.keys(record).length !== 1) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(record)) out[key] = fromWire(item, what);
    return out;
  }

  const [tag, payload] = tagged as [unknown, unknown];
  switch (tag) {
    case 'u':
      return undefined;
    case 'd':
      return new Date(payload as string);
    case 'n':
      return BigInt(payload as string);
    case 'f':
      return Number(payload);
    case 'o': {
      // The wrapper *is* the escape, so the object inside it is already the
      // user's. Handing it back to `fromWire` whole would let it be read as a
      // tag a second time, and `{ $v: ['u'] }` — a legal application value —
      // would arrive as `undefined`. Only its members are decoded.
      const out: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(payload as Record<string, unknown>)) {
        out[key] = fromWire(item, what);
      }
      return out;
    }
    default:
      throw new WireError(`[volt] ${what} carries an unknown tag ${JSON.stringify(tag)}.`);
  }
}
