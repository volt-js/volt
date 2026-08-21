/**
 * The executable. Everything it does is turn `process` into a `Cli` and hand
 * it to `main`, so that the command's behaviour is testable without a
 * terminal, a subprocess or a temporary shell.
 */

import { createInterface } from 'node:readline/promises';
import { main } from './index.js';

/**
 * Questions are asked only when both ends of the conversation are a terminal.
 * Piped input is a script, and a script that is stopped by a prompt it cannot
 * see has hung rather than failed.
 */
const interactive = process.stdin.isTTY === true && process.stdout.isTTY === true;

const ask = interactive
  ? async (question: string, fallback: string): Promise<string> => {
      const readline = createInterface({ input: process.stdin, output: process.stdout });
      try {
        const answer = await readline.question(`${question} (${fallback}): `);
        return answer.trim() === '' ? fallback : answer;
      } finally {
        readline.close();
      }
    }
  : undefined;

process.exitCode = await main(process.argv.slice(2), {
  cwd: process.cwd(),
  write: (text) => console.log(text),
  fail: (text) => console.error(text),
  ...(ask ? { ask } : {}),
});
