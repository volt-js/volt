import { Component } from '../../../volt.js';

/** A second package component, whose declaration map names its source through `sourceRoot`. */
@Component({ selector: 'v-tile', templateUrl: './tile.html' })
export class Tile {
  caption = 'Tile';
}
