/**
 * Sorting, as a view over rows the caller still owns.
 *
 * The rows handed to a grid are not the grid's. A caller may hold references
 * to them, render the same objects somewhere else, or be given the same array
 * back by their own store — so nothing here writes to the array it is given,
 * and nothing here copies a row. `slice().sort()` produces a new array of the
 * *same* objects, which is also what lets an identity-keyed `:for` reuse a
 * row's elements when a re-sort happens to leave it where it was.
 *
 * A sort is a list of terms rather than one term, because a grid that can only
 * sort by a single column cannot answer "by department, then by salary" — and
 * because the second term is what makes the first deterministic when it ties.
 *
 * Nothing here knows what a column is. The grid resolves a saved sort against
 * its column list and hands the accessors down, which keeps this module a pure
 * function of its arguments and testable without a DOM.
 */

export type GridSortDirection = 'ascending' | 'descending';

/**
 * One column's place in the sort order.
 *
 * Named by column id rather than by index, and holding no functions, so the
 * whole sort is a plain value a consumer can put in a URL, a saved view or
 * local storage and hand straight back.
 */
export interface GridSort {
  readonly columnId: string;
  readonly direction: GridSortDirection;
}

/** A sort entry resolved against the column it names. */
export interface GridSortTerm<T> {
  readonly direction: GridSortDirection;
  /** The key rows are compared by. */
  readonly value: (row: T) => unknown;
  /**
   * A comparator over whole rows, always written ascending — the direction is
   * applied to whatever it returns. Used instead of `value` when present.
   */
  readonly compare?: (a: T, b: T) => number;
}

/**
 * Whether a value is one a reader would call empty.
 *
 * The empty string counts, because a column showing a formatted value renders
 * a missing one as nothing at all, and a reader sorting that column is asking
 * about the values they can see. So do `NaN` and a `Date` holding it: neither
 * is ordered against anything, and a comparator that let one through would
 * call it equal to every other value — which entitles the engine's sort to
 * scramble the whole array rather than just the one row. As a blank it sorts
 * last in both directions, which is also what a reader reversing the sort is
 * owed: the largest values first, not the one that is not a value at all.
 */
function isBlank(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    value === '' ||
    Number.isNaN(value) ||
    (value instanceof Date && Number.isNaN(value.getTime()))
  );
}

/**
 * Order two values of whatever type a column's accessor produced.
 *
 * Typed comparisons first, because the fallback is text and text orders 10
 * before 9. Mixed types fall through to text deliberately: a column holding
 * both is a column whose data is not what its author thought, and an arbitrary
 * but stable order is more useful than a throw.
 */
function compareValues(
  a: unknown,
  b: unknown,
  compareText: (a: string, b: string) => number,
): number {
  // Neither is NaN, nor an invalid `Date`: both are blanks, and never get here.
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'bigint' && typeof b === 'bigint') return a < b ? -1 : a > b ? 1 : 0;
  if (typeof a === 'boolean' && typeof b === 'boolean') return (a ? 1 : 0) - (b ? 1 : 0);
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  return compareText(String(a), String(b));
}

/**
 * A new array of the same rows, in the order the terms ask for.
 *
 * Returns the array it was given when there is nothing to sort, so that a grid
 * with no sort holds the caller's own array by identity and every downstream
 * memo sees that nothing changed.
 *
 * `compareText` is threaded in rather than reached for, because
 * `String#localeCompare` with no argument sorts in the *runtime's* locale: a
 * page set to Swedish would put ö next to o instead of after z, and Turkish
 * would run ı and i together when they are separate letters. The grid passes
 * its locale's collator.
 */
export function sortRows<T>(
  rows: readonly T[],
  terms: readonly GridSortTerm<T>[],
  compareText: (a: string, b: string) => number,
): readonly T[] {
  if (terms.length === 0 || rows.length < 2) return rows;

  return rows.slice().sort((a, b) => {
    for (const term of terms) {
      if (term.compare) {
        const result = term.compare(a, b);
        if (result !== 0) return term.direction === 'descending' ? -result : result;
        continue;
      }

      const left = term.value(a);
      const right = term.value(b);

      // Blanks sort last in both directions, before the direction is applied.
      // Reversing a sort is a request to see the largest values first, not a
      // request to be shown the rows that have no value at all.
      const leftBlank = isBlank(left);
      if (leftBlank !== isBlank(right)) return leftBlank ? 1 : -1;
      // Both blank: this term has nothing to say, so the next one decides.
      if (leftBlank) continue;

      const result = compareValues(left, right, compareText);
      if (result !== 0) return term.direction === 'descending' ? -result : result;
    }
    // Rows the terms cannot separate keep their source order, because
    // `Array#sort` is stable. That is what makes a second click on a second
    // column a refinement of the first rather than a reshuffle.
    return 0;
  });
}

/** Whether two sort orders say the same thing, so an unchanged one is silent. */
export function sameSort(a: readonly GridSort[], b: readonly GridSort[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i]!.columnId !== b[i]!.columnId || a[i]!.direction !== b[i]!.direction) return false;
  }
  return true;
}

/**
 * The next state of one column in the cycle a header click walks.
 *
 * Ascending, then descending, then nothing — `null` being the third state
 * rather than a return to ascending, because a grid that cannot be put back
 * into its source order has lost information the reader may want back.
 */
export function nextDirection(current: GridSortDirection | null): GridSortDirection | null {
  if (current === null) return 'ascending';
  return current === 'ascending' ? 'descending' : null;
}
