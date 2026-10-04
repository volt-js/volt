import { Component } from '../../volt.js';

/** The default export, which the checker hands back as a class named `default`. */
@Component({ selector: 'v-tag', templateUrl: './tag.html' })
export default class Tag {
  label = 'new';
}
