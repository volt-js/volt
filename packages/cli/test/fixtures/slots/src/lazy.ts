import { Component } from '../../volt.js';
import { Rows as People } from './rows.js';
import Label from './tag.js';

/**
 * Two components in one module, and only the second lists `<v-rows>`: what
 * each template is typed by comes from its own `imports`, never its
 * neighbour's.
 */
@Component({ selector: 'v-bare', templateUrl: './bare.html' })
export class Bare {}

/** The deferred form, under a name of the module's own choosing. */
@Component({
  selector: 'v-lazy',
  templateUrl: './lazy.html',
  imports: () => [People, Label],
})
export class Lazy {}
