import { Component } from '@voltdev/core';
import { useRouter } from '@voltdev/router';

/**
 * The root, and the only component `serverRender` needs to be told about.
 *
 * It is the default export because that is what the generated wiring imports
 * — one name, on both sides of the network, so the server render and the
 * client that attaches to it cannot disagree about what the page is.
 *
 * The router is the one in scope, not one this module made. A server answers
 * many requests at once and makes a router for each, so a router created here
 * would be one page's location shown to every reader.
 */
@Component({
  selector: 'v-app',
  templateUrl: './app.html',
})
export default class App {
  private router = useRouter();

  current(path: string): 'page' | undefined {
    return this.router.pathname() === path ? 'page' : undefined;
  }
}
