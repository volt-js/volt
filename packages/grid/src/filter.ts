/**
 * Filters, as a predicate compiled once rather than interpreted per row.
 *
 * A filter is a plain value — a discriminated union with no functions in it —
 * for the same reason a sort is: it has to survive a round trip through a URL,
 * a saved view or a server. What it is *not* is something to interpret inside
 * the row loop. A hundred thousand rows against a text filter would lower-case
 * the same needle a hundred thousand times, build the same `Set` for a set
 * filter a hundred thousand times, and re-branch on the operator every row.
 * `compileFilter` does all of that once and hands back a predicate.
 *
 * Compiling is also where "this filter is not really a filter" is decided. An
 * empty text box, a number filter with no number in it yet, a range missing
 * its upper bound: these are the states a filter UI spends most of its life
 * in, and every one of them must produce `null` rather than a predicate that
 * happens to match everything — because the grid uses "no active filters" to
 * hand back the caller's own array by identity, and a predicate that matches
 * everything would still allocate a copy and invalidate every memo below it.
 *
 * Nothing here mutates or even sees the rows. The grid applies the predicates.
 */

export type GridTextOperator =
  | 'contains'
  | 'notContains'
  | 'equals'
  | 'notEquals'
  | 'startsWith'
  | 'endsWith';

export type GridNumberOperator =
  | 'equals'
  | 'notEquals'
  | 'greaterThan'
  | 'greaterThanOrEqual'
  | 'lessThan'
  | 'lessThanOrEqual'
  | 'between';

export interface GridTextFilter {
  readonly type: 'text';
  readonly value: string;
  /** Default `contains`. */
  readonly operator?: GridTextOperator;
  /**
   * Default false. Case folding is locale-aware — the grid passes its own —
   * because Turkish I and dotless ı are different letters and the invariant
   * fold runs them together.
   */
  readonly caseSensitive?: boolean;
}

export interface GridNumberFilter {
  readonly type: 'number';
  readonly value: number;
  /** Default `equals`. */
  readonly operator?: GridNumberOperator;
  /** The upper bound of a `between`, inclusive. Ignored by every other operator. */
  readonly to?: number;
}

export interface GridSetFilter {
  readonly type: 'set';
  /**
   * The values a row may hold to be kept, compared the way a `Set` compares.
   *
   * An empty list keeps nothing, which is what "no categories are ticked"
   * means on the checkbox list this exists to drive. A caller who wants
   * everything removes the filter rather than emptying it.
   */
  readonly values: readonly unknown[];
}

export type GridFilter = GridTextFilter | GridNumberFilter | GridSetFilter;

/** How a value reads once a filter has to treat it as text. */
export type TextFold = (text: string) => string;

/** A value as a filter sees it. Absent is empty, not the string "undefined". */
export function asText(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

/**
 * A filter as a predicate over one column's value, or `null` if it filters
 * nothing.
 */
export function compileFilter(filter: GridFilter, fold: TextFold): ((value: unknown) => boolean) | null {
  switch (filter.type) {
    case 'text': {
      if (filter.value === '') return null;
      const cased = filter.caseSensitive === true;
      const needle = cased ? filter.value : fold(filter.value);
      const read = (value: unknown): string => {
        const text = asText(value);
        return cased ? text : fold(text);
      };
      switch (filter.operator ?? 'contains') {
        case 'contains':
          return (value) => read(value).includes(needle);
        case 'notContains':
          return (value) => !read(value).includes(needle);
        case 'equals':
          return (value) => read(value) === needle;
        case 'notEquals':
          return (value) => read(value) !== needle;
        case 'startsWith':
          return (value) => read(value).startsWith(needle);
        case 'endsWith':
          return (value) => read(value).endsWith(needle);
      }
      // Unreachable for a well-typed operator, and the honest answer for one
      // that arrived from a saved view written by an older version.
      return null;
    }

    case 'number': {
      const { value } = filter;
      if (typeof value !== 'number' || Number.isNaN(value)) return null;
      const operator = filter.operator ?? 'equals';
      const upper = filter.to;
      if (operator === 'between') {
        if (typeof upper !== 'number' || Number.isNaN(upper)) return null;
        const low = Math.min(value, upper);
        const high = Math.max(value, upper);
        return (candidate) => {
          const number = toNumber(candidate);
          return number !== null && number >= low && number <= high;
        };
      }
      return (candidate) => {
        const number = toNumber(candidate);
        if (number === null) return false;
        switch (operator) {
          case 'equals':
            return number === value;
          case 'notEquals':
            return number !== value;
          case 'greaterThan':
            return number > value;
          case 'greaterThanOrEqual':
            return number >= value;
          case 'lessThan':
            return number < value;
          case 'lessThanOrEqual':
            return number <= value;
          default:
            return false;
        }
      };
    }

    case 'set': {
      // Built once. The alternative is a linear scan of the ticked categories
      // for every row, which is the shape that makes a set filter over a
      // hundred distinct values quadratic.
      const allowed = new Set(filter.values);
      return (value) => allowed.has(value);
    }
  }
}

/**
 * The words a quick filter is looking for, folded ready to match.
 *
 * Split on whitespace and required *all*, because a reader typing two words
 * into one box means both — "smith london" should find the Smith in London and
 * not every Smith and every Londoner.
 */
export function quickFilterTerms(text: string, fold: TextFold): readonly string[] {
  const folded = fold(text).trim();
  if (folded === '') return EMPTY_TERMS;
  return folded.split(/\s+/);
}

const EMPTY_TERMS: readonly string[] = [];

/**
 * Whether a row's folded cell texts satisfy every term.
 *
 * A term may match in any column, and different terms may match in different
 * ones. Matching against the columns separately rather than against them
 * joined is deliberate: joining lets a term straddle two columns and match
 * text that appears nowhere on the row.
 */
export function matchesQuickFilter(texts: readonly string[], terms: readonly string[]): boolean {
  for (const term of terms) {
    let found = false;
    for (const text of texts) {
      if (text.includes(term)) {
        found = true;
        break;
      }
    }
    if (!found) return false;
  }
  return true;
}

/**
 * A value as a number filter sees it.
 *
 * A numeric column whose accessor returns strings is common enough — it is
 * what a value straight out of JSON looks like — that refusing to compare one
 * would make the number filter silently match nothing. An empty string is not
 * zero, which is the trap `Number('')` sets.
 */
function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isNaN(value) ? null : value;
  if (typeof value === 'bigint') return Number(value);
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}
