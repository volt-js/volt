/**
 * What a person actually sees when they run `volt check`.
 *
 * The whole point of the check is that a mistake in a template is reported at
 * the template, so the report prints the template line and underlines the
 * column. A location alone would be a claim; the line under the caret is the
 * claim being shown.
 *
 * Nothing here colours anything. The same text is read in a terminal and in a
 * CI log, and the second one is where it matters most.
 */

import { display, type CheckResult, type TemplateDiagnostic } from './check.js';

/** One finding, as a location line, a message, and the source under a caret. */
export function formatDiagnostic(diagnostic: TemplateDiagnostic, root: string): string {
  const where = `${display(diagnostic.file, root)}:${diagnostic.line}:${diagnostic.column}`;
  const lines = [`${where}  error  ${diagnostic.code}`];
  for (const line of diagnostic.message.split('\n')) lines.push(`  ${line}`);

  if (diagnostic.source !== null) {
    const gutter = ' '.repeat(String(diagnostic.line).length);
    lines.push(
      '',
      `  ${diagnostic.line} │ ${diagnostic.source}`,
      `  ${gutter} │ ${caret(diagnostic.source, diagnostic.column)}`,
    );
  }
  return lines.join('\n');
}

/**
 * Spaces up to the column, then the caret.
 *
 * Built from the source line rather than from the column alone, so that a tab
 * in the template advances the caret by a tab and the two lines stay aligned
 * however wide the terminal renders one.
 */
function caret(source: string, column: number): string {
  let out = '';
  for (let i = 0; i < column - 1 && i < source.length; i++) {
    out += source[i] === '\t' ? '\t' : ' ';
  }
  return `${out}^`;
}

/** The whole run: every finding, then one line saying what was covered. */
export function formatReport(result: CheckResult, root: string): string {
  const parts = result.diagnostics.map((d) => formatDiagnostic(d, root));
  parts.push(summary(result));
  return parts.join('\n\n');
}

function summary(result: CheckResult): string {
  const errors = result.diagnostics.length;
  const sentences = [
    `Checked ${count(result.templates, 'template')}.`,
    errors === 0 ? 'No errors.' : `${count(errors, 'error')}.`,
  ];
  // Said out loud, because a suppression nobody is reminded of is one that
  // outlives the reason it was written for.
  if (result.ignored > 0) sentences.push(`${count(result.ignored, 'finding')} ignored.`);
  return sentences.join(' ');
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}
