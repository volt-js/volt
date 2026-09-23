/**
 * What a grid can have selected.
 *
 * Two selections, not one, because they answer different questions. A *row*
 * selection is "these records, act on them" — it survives sorting, filtering
 * and scrolling, and it is what a bulk-action bar reads. A *cell range* is
 * "this rectangle, look at it" — it is a region of the grid as currently
 * arranged, and it means nothing once the arrangement changes.
 *
 * That difference is why rows are held by key and cells by index. A row's key
 * still names the same record after a re-sort has moved it four hundred places;
 * a range's corners name positions, and the rows that used to be between them
 * are now somewhere else entirely. So the grid follows a row selection through
 * a re-sort and drops a range at it. Columns are another matter: every one is
 * named by an id, so a range whose columns still sit together in the order they
 * had is carried to wherever a change to the column list put them.
 */

import type { GridCell } from './grid.js';

/**
 * What identifies a row for selection — whatever `getRowKey` returns.
 *
 * Selection by key rather than by index is the whole reason a selection made
 * before a sort still means something after one. A grid left on the default
 * key, which is the row's index, cannot do that: give `getRowKey` before
 * turning row selection on.
 */
export type GridRowKey = string | number;

/**
 * `single` holds at most one row. `multiple` holds any number, and is the mode
 * that puts `aria-multiselectable` on the grid.
 */
export type GridRowSelectionMode = 'none' | 'single' | 'multiple';

/** `range` turns on the keyboard-driven rectangle. */
export type GridCellSelectionMode = 'none' | 'range';

/**
 * A rectangle of cells, kept as the two corners the user made rather than as
 * normalized bounds.
 *
 * The anchor is where Shift was first held and the focus is where the cursor
 * has reached, and keeping them apart is what lets a range be dragged back
 * through its own anchor and come out the other side — normalized bounds would
 * have forgotten which corner was pinned.
 */
export interface GridCellRange {
  readonly anchor: GridCell;
  readonly focus: GridCell;
}

/** A range as the two inclusive spans it covers. */
export interface GridCellRangeBounds {
  readonly fromRow: number;
  readonly toRow: number;
  readonly fromColumn: number;
  readonly toColumn: number;
}

export function rangeBounds(range: GridCellRange): GridCellRangeBounds {
  return {
    fromRow: Math.min(range.anchor.row, range.focus.row),
    toRow: Math.max(range.anchor.row, range.focus.row),
    fromColumn: Math.min(range.anchor.column, range.focus.column),
    toColumn: Math.max(range.anchor.column, range.focus.column),
  };
}

export function rangeContains(range: GridCellRange, row: number, column: number): boolean {
  const bounds = rangeBounds(range);
  return (
    row >= bounds.fromRow &&
    row <= bounds.toRow &&
    column >= bounds.fromColumn &&
    column <= bounds.toColumn
  );
}

/** Whether two ranges cover the same cells from the same corner. */
export function sameRange(a: GridCellRange | null, b: GridCellRange | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.anchor.row === b.anchor.row &&
    a.anchor.column === b.anchor.column &&
    a.focus.row === b.focus.row &&
    a.focus.column === b.focus.column
  );
}

/** Whether two key sets hold the same keys, so an unchanged selection is silent. */
export function sameKeys(a: ReadonlySet<GridRowKey>, b: ReadonlySet<GridRowKey>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const key of a) if (!b.has(key)) return false;
  return true;
}
