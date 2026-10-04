import { Component } from '../../volt.js';

export interface Task {
  id: number;
  done: boolean;
}

/**
 * Hands its content literals: one written out, one chosen between two, and an
 * attribute. Each is exactly that string or number when the content renders.
 */
@Component({ selector: 'v-badge', templateUrl: './badge.html' })
export class Badge {
  tasks: Task[] = [];
}
