import { Component } from '@voltdev/core';
import { router } from './router.js';

/** The layout every route renders inside, and the only thing that outlives a navigation. */
@Component({
  selector: 'v-shell',
  templateUrl: './shell.html',
  styleUrl: './shell.scss',
})
export class Shell {
  /** `loading` from the moment a navigation starts until it has rendered. */
  navigating = (): boolean => router.status() === 'loading';

  /** Marks the current tab for the accessibility tree, not just for the eye. */
  current(path: string): 'page' | undefined {
    return router.pathname() === path ? 'page' : undefined;
  }
}
