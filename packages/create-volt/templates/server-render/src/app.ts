import { Component } from '@voltdev/core';
import { createRouter } from '@voltdev/router';
import { routes } from './routes.js';

export const router = createRouter({ routes });

/**
 * The root, and the only component `serverRender` needs to be told about.
 *
 * It is the default export because that is what the generated wiring imports
 * — one name, on both sides of the network, so the server render and the
 * client that attaches to it cannot disagree about what the page is.
 */
@Component({
  selector: 'v-app',
  templateUrl: './app.html',
})
export default class App {
  current(path: string): 'page' | undefined {
    return router.pathname() === path ? 'page' : undefined;
  }
}
