/**
 * @voltdev/grid
 *
 * A virtualized data grid.
 *
 * Separate from @voltdev/primitives because of its size, but deliberately not
 * self-sufficient: virtualization, collection and roving focus belong to the
 * shared primitives even while the grid is their only consumer. A private copy
 * here would have to be reconciled later with combobox, tree and select.
 *
 * Volt's reactivity suits this well. A cell owns its own binding, so changing
 * one value writes one text node and nothing around it re-renders — and that
 * survives a sort and a filter, which are derived views over the caller's rows
 * rather than anything this package stores or reorders.
 */

export {
  createGrid,
  GRID_CELL_ATTRIBUTE,
  GRID_RESIZER_ATTRIBUTE,
  HEADER_ROW,
  type Grid,
  type GridCell,
  type GridColumn,
  type GridColumnView,
  type GridOptions,
  type GridProps,
  type GridPropValue,
  type GridRow,
  type GridSortDescriptor,
} from './grid.js';

export type { GridSort, GridSortDirection } from './sort.js';

/**
 * Grouping and editing are layers over `createGrid` rather than parts of it.
 * Grouping hands the grid a longer collection with the group headers in it;
 * editing hands the caller a change and never writes a row. Both are documented
 * where they are defined.
 */
export {
  createGrouping,
  GRID_GROUP_ATTRIBUTE,
  type GridAggregateKind,
  type GridAggregation,
  type GridGroupNode,
  type GridGroupSpec,
  type GridGrouping,
  type GridGroupingOptions,
  type GridGroupedRow,
} from './group.js';

export {
  createCellEditing,
  GRID_EDITOR_ATTRIBUTE,
  type GridCellEditing,
  type GridCellEditingOptions,
  type GridEditChange,
  type GridEditSession,
  type GridEditor,
} from './edit.js';

export type {
  GridFilter,
  GridNumberFilter,
  GridNumberOperator,
  GridSetFilter,
  GridTextFilter,
  GridTextOperator,
} from './filter.js';

export type {
  GridCellRange,
  GridCellRangeBounds,
  GridCellSelectionMode,
  GridRowKey,
  GridRowSelectionMode,
} from './selection.js';

/**
 * The corners of a range as the two spans it covers.
 *
 * Exported because a consumer painting a range's border needs to know which
 * cell is on which edge, and deriving that from the anchor and focus by hand is
 * the kind of arithmetic that comes out inverted when the range is dragged
 * upwards.
 */
export { rangeBounds, rangeContains } from './selection.js';

export const VERSION = '0.1.0-alpha.1';
