import { Component } from '../../volt.js';

// Declared but never exported, so a template restated in a file of its own
// has no way to name it.
@Component({ selector: 'v-hidden', templateUrl: './hidden.html' })
class Hidden {
  title = 'Hidden';
}

void Hidden;
