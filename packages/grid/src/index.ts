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
 * one value writes one text node and nothing around it re-renders.
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
} from './grid.js';

export const VERSION = '0.1.0';
