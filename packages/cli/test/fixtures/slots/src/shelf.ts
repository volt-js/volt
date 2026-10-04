import { Component } from '../../volt.js';
import { Rows } from './rows.js';

/**
 * Fills a slot of `<v-rows>` only in its own outlet's fallback, which is then
 * the one place its template binds what a slot passes.
 */
@Component({ selector: 'v-shelf', templateUrl: './shelf.html', imports: [Rows] })
export class Shelf {}
