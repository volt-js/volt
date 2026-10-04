import { Component } from '../../volt.js';

export type Entry = { kind: 'gap' } | { kind: 'page'; number: number } | { kind: 'link'; href: string };

export interface Upload {
  id: number;
  error?: string;
}

/**
 * Hands its slots only what a condition let through, the way structure is
 * written around an outlet: what each slot passes is the value as the
 * condition narrowed it.
 */
@Component({ selector: 'v-pages', templateUrl: './pages.html' })
export class Pages {
  entries: Entry[] = [];
  uploads: Upload[] = [];
}
