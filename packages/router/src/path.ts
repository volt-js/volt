/**
 * Path patterns — parsed once, matched many times, and typed.
 *
 * A pattern is a sequence of `/`-separated segments:
 *
 *   users              a literal
 *   :id                one segment, captured as `id`
 *   :page?             the same, but the segment may be absent
 *   *                  the rest of the path, captured as `*`
 *   *file              the rest of the path, captured as `file`
 *
 * That is the whole syntax. There is no regular-expression form and no
 * per-segment constraint, because both push the decision "does this URL belong
 * to this route" into a place the type system cannot read — and the param
 * types here are derived from the pattern string itself, so the pattern has to
 * stay something a template literal type can take apart.
 *
 * Matching never backtracks. An optional segment consumes a path segment
 * exactly when doing so still leaves enough segments for everything required
 * after it, which is decidable from a count rather than by trying and undoing.
 * A splat may only be last, for the same reason: anywhere else it makes the
 * split ambiguous, and the ambiguity would have to be resolved by a rule
 * nobody remembers.
 */

/** Matched parameters. Always strings — a URL has no other type. */
export type Params = Readonly<Record<string, string>>;

// ---------------------------------------------------------------------------
// Types derived from the pattern string
// ---------------------------------------------------------------------------

type SegmentParam<S extends string> = S extends `:${infer Name}?`
  ? Name
  : S extends `:${infer Name}`
    ? Name
    : S extends '*'
      ? '*'
      : S extends `*${infer Name}`
        ? Name
        : never;

type SegmentOptionalParam<S extends string> = S extends `:${infer Name}?` ? Name : never;

type OverSegments<P extends string, Of extends string> = P extends `${infer Head}/${infer Rest}`
  ? OverSegments<Head, Of> | OverSegments<Rest, Of>
  : Of extends 'all'
    ? SegmentParam<P>
    : SegmentOptionalParam<P>;

/** Every parameter a pattern captures, as a union of names. */
export type ParamNames<P extends string> = OverSegments<P, 'all'>;

/** Just the ones written `:name?`, which become optional keys. */
type OptionalParamNames<P extends string> = OverSegments<P, 'optional'>;

/**
 * What matching a pattern yields.
 *
 * Optional segments are optional keys rather than `string | undefined`, so
 * `params.id` on a required parameter needs no narrowing at all.
 */
export type PathParams<P extends string> = {
  [K in Exclude<ParamNames<P>, OptionalParamNames<P>>]: string;
} & {
  [K in OptionalParamNames<P>]?: string;
};

/**
 * What building a URL from a pattern needs.
 *
 * Numbers are accepted because an id usually is one, and `String(id)` at every
 * call site is noise the type system can absorb instead.
 */
export type ParamInput<P extends string> = {
  [K in Exclude<ParamNames<P>, OptionalParamNames<P>>]: string | number;
} & {
  [K in OptionalParamNames<P>]?: string | number;
};

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export type PatternSegment =
  | { readonly kind: 'static'; readonly value: string }
  | { readonly kind: 'param'; readonly name: string; readonly optional: boolean }
  | { readonly kind: 'splat'; readonly name: string };

/**
 * Specificity, compared position by position rather than summed.
 *
 * A total is the obvious implementation and is wrong in a way that is hard to
 * see: with static=10 and dynamic=3, `/:a/:b/:c/:d` outranks `/settings`, so a
 * deep dynamic branch quietly steals a literal URL. Comparing the first
 * segment where two patterns disagree makes "a literal beats a placeholder"
 * true at the position it happens, whatever surrounds it.
 */
const SPECIFICITY = { static: 3, param: 2, optional: 1, splat: 0 } as const;

function rank(segment: PatternSegment): number {
  if (segment.kind === 'static') return SPECIFICITY.static;
  if (segment.kind === 'splat') return SPECIFICITY.splat;
  return segment.optional ? SPECIFICITY.optional : SPECIFICITY.param;
}

/** Split a pattern into segments, dropping the empty ones a `//` or a trailing `/` leaves. */
export function parsePattern(pattern: string): PatternSegment[] {
  const segments: PatternSegment[] = [];

  for (const raw of pattern.split('/')) {
    if (raw === '') continue;

    if (raw.startsWith(':')) {
      const optional = raw.endsWith('?');
      const name = raw.slice(1, optional ? -1 : undefined);
      if (__VOLT_DEV__ && name === '') {
        throw new Error(`[volt] Route pattern "${pattern}" has a ':' with no parameter name.`);
      }
      segments.push({ kind: 'param', name, optional });
      continue;
    }

    if (raw.startsWith('*')) {
      segments.push({ kind: 'splat', name: raw.slice(1) || '*' });
      continue;
    }

    segments.push({ kind: 'static', value: raw });
  }

  if (__VOLT_DEV__) {
    const splat = segments.findIndex((segment) => segment.kind === 'splat');
    if (splat !== -1 && splat !== segments.length - 1) {
      throw new Error(
        `[volt] Route pattern "${pattern}" puts a splat before its last segment. ` +
          `A splat matches the rest of the path, so nothing can follow it.`,
      );
    }
  }

  return segments;
}

/**
 * Order two patterns, most specific first.
 *
 * Where one is a prefix of the other the longer one wins: it says everything
 * the shorter one says and more.
 */
export function compareSpecificity(
  a: readonly PatternSegment[],
  b: readonly PatternSegment[],
): number {
  const shared = Math.min(a.length, b.length);
  for (let i = 0; i < shared; i++) {
    const difference = rank(b[i]!) - rank(a[i]!);
    if (difference !== 0) return difference;
  }
  return b.length - a.length;
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/** Split a pathname into the segments a pattern is matched against. */
export function splitPathname(pathname: string): string[] {
  return pathname.split('/').filter((part) => part !== '');
}

/**
 * `/USERS/` and `/users` are the same route; keeping both would double every
 * pattern in the table for no gain. Case is left alone — outside the host a
 * URL is case-sensitive, and a router that quietly disagrees makes two URLs
 * that serve the same page, which is the thing canonical links exist to undo.
 */
export function normalizePathname(pathname: string): string {
  let end = pathname.length;
  while (end > 1 && pathname[end - 1] === '/') end--;
  const trimmed = pathname.slice(0, end);
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

/** Strip the slashes on both ends, so patterns join without doubling them. */
export function trimSlashes(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && value[start] === '/') start++;
  while (end > start && value[end - 1] === '/') end--;
  return value.slice(start, end);
}

/** How many path segments still have to be there after position `i`. */
function minimumAfter(segments: readonly PatternSegment[]): number[] {
  const required = new Array<number>(segments.length + 1).fill(0);
  for (let i = segments.length - 1; i >= 0; i--) {
    const segment = segments[i]!;
    const own = segment.kind === 'splat' || (segment.kind === 'param' && segment.optional) ? 0 : 1;
    required[i] = own + required[i + 1]!;
  }
  return required;
}

/** What one pattern segment captured, or null for a literal. */
export type SegmentCapture = { readonly name: string; readonly value: string } | null;

export interface SegmentWalk {
  /** How many path segments each pattern segment consumed, in order. */
  readonly consumed: readonly number[];
  /**
   * What each pattern segment captured, positionally.
   *
   * Kept beside the merged params because two routes in one branch may use the
   * same parameter name, and the merged view can only hold the winner — while
   * each route still has to report what it itself matched.
   */
  readonly captures: readonly SegmentCapture[];
  readonly params: Params;
}

/**
 * Walk `segments` over `path`, consuming all of it.
 *
 * Returns null when the pattern cannot cover the path exactly — a router that
 * matched a prefix would render a page for a URL with unexplained junk on the
 * end of it.
 */
export function walkSegments(
  segments: readonly PatternSegment[],
  path: readonly string[],
): SegmentWalk | null {
  const required = minimumAfter(segments);
  const consumed: number[] = [];
  const captures: SegmentCapture[] = [];
  const params: Record<string, string> = {};
  let at = 0;

  const capture = (name: string, value: string): void => {
    params[name] = value;
    captures.push({ name, value });
  };

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]!;
    const remaining = path.length - at;

    if (segment.kind === 'splat') {
      capture(segment.name, path.slice(at).map(decodeSegment).join('/'));
      consumed.push(remaining);
      at = path.length;
      continue;
    }

    if (segment.kind === 'param' && segment.optional) {
      // Take the segment only if what follows still fits. Greedy is safe here
      // precisely because that test is exact, so there is nothing to undo.
      if (remaining > required[i + 1]!) {
        capture(segment.name, decodeSegment(path[at]!));
        at += 1;
        consumed.push(1);
      } else {
        captures.push(null);
        consumed.push(0);
      }
      continue;
    }

    if (at >= path.length) return null;

    if (segment.kind === 'static') {
      if (path[at] !== segment.value) return null;
      captures.push(null);
    } else {
      capture(segment.name, decodeSegment(path[at]!));
    }
    at += 1;
    consumed.push(1);
  }

  return at === path.length ? { consumed, captures, params } : null;
}

/**
 * A percent-escape that is not valid UTF-8 throws rather than decoding, and a
 * malformed URL is a bad request rather than a crash — so the raw segment is
 * the honest fallback.
 */
function decodeSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

// ---------------------------------------------------------------------------
// Building
// ---------------------------------------------------------------------------

/**
 * Fill a pattern in, which is the only place a URL should be assembled.
 *
 * Every value is percent-encoded, so a name with a slash in it cannot invent a
 * path segment — the bug that turns a search box into a way to navigate
 * anywhere. A splat is the exception and keeps its slashes, since matching one
 * captured them.
 */
export function buildPath(
  pattern: string,
  params: Readonly<Record<string, string | number>> = {},
): string {
  const parts: string[] = [];

  for (const segment of parsePattern(pattern)) {
    if (segment.kind === 'static') {
      parts.push(segment.value);
      continue;
    }

    const value = params[segment.name];
    if (value === undefined || value === '') {
      if (segment.kind === 'splat' || segment.optional) continue;
      throw new Error(`[volt] Cannot build "${pattern}": no value for ":${segment.name}".`);
    }

    const encoded = String(value);
    parts.push(
      segment.kind === 'splat'
        ? encoded.split('/').map(encodeURIComponent).join('/')
        : encodeURIComponent(encoded),
    );
  }

  return `/${parts.join('/')}`;
}
