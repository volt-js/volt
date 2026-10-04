import { Component } from '../../volt.js';

/**
 * A generic child. What its rows are is up to whoever writes the tag, through
 * `items`, so a name its outlet types by `T` can only be `any` to the content.
 */
@Component({ selector: 'v-list', templateUrl: './list.html' })
export class List<T, K = string> {
  items: T[] = [];
  keys: K[] = [];
}
