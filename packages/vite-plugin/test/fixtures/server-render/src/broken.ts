import { Component } from '@voltdev/core';

/** A page whose construction fails, for the overlay test to point at. */
@Component({ selector: 'v-broken', templateUrl: './broken.html' })
export class Broken {
  constructor() {
    fail();
  }
}
function fail(): never { throw new Error('broken on purpose'); }
