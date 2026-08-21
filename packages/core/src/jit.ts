/**
 * In-browser template compilation.
 *
 * Components are authored with `templateUrl`, which `@voltdev/vite-plugin`
 * resolves and compiles at build time. This entry is the escape hatch for the
 * cases where there is no build step — tests, playgrounds, REPLs — and it
 * makes the cost explicit: importing it pulls the compiler in.
 *
 *   import { compileTemplate } from '@voltdev/core/jit';
 *
 *   @Component({
 *     selector: 'v-greeting',
 *     render: compileTemplate(`<p>Hello, { name.get() }.</p>`),
 *   })
 *   export class Greeting {
 *     name = new Signal.State('world');
 *   }
 */

import { compile } from '@voltdev/compiler';
import type { RenderFn } from './component.js';
import * as runtime from './runtime.js';
import * as server from './server.js';

/**
 * Compile template source into a render function.
 *
 * The generated code closes over the runtime namespace and imports nothing,
 * which is what lets the same compiler output run here through `new Function`
 * and as a module at build time.
 *
 * Which side it is compiled for is the build's answer, never the caller's —
 * the same rule `@voltdev/vite-plugin` follows for a template it compiles
 * ahead of time. A component written once therefore clones markup in the
 * browser and writes bytes on the server, with nothing in its source saying
 * which; a client build drops the server namespace with the branch that
 * reaches it.
 */
export function compileTemplate(source: string, filename = 'template'): RenderFn {
  const target = __VOLT_SERVER__ ? 'server' : 'client';
  const { body } = compile(source, { filename, runtime: '_rt', target });
  const factory = new Function('_rt', body) as (rt: unknown) => RenderFn;
  return factory(__VOLT_SERVER__ ? server : runtime);
}

export { compile } from '@voltdev/compiler';
