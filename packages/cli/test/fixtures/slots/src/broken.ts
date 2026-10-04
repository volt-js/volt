import { Component } from '../../volt.js';

/**
 * A component whose template does not parse, as one does halfway through an
 * edit: reported once, as its own, while what its slot passes is `any`.
 */
@Component({ selector: 'v-broken', templateUrl: './broken.html' })
export class Broken {
  label = 'Broken';
}
