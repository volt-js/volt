import { Component } from '../../../volt.js';

export interface Cell {
  label: string;
}

/**
 * Outside the project the check runs over, the way a package in
 * `node_modules` is: the page reaches it through `../types`, and only the
 * declaration map there leads back to this file and its template.
 */
@Component({ selector: 'v-table', templateUrl: './table.html' })
export class Table {
  cells: Cell[] = [];
}
