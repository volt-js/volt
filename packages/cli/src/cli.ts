/**
 * The executable. Everything it does is turn `process` into a `Cli` and hand
 * it to `main`, so that the command's behaviour is testable without a
 * terminal, a subprocess or a temporary shell.
 */

import { main } from './index.js';

process.exitCode = await main(process.argv.slice(2), {
  cwd: process.cwd(),
  write: (text) => console.log(text),
  fail: (text) => console.error(text),
});
