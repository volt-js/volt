/**
 * The module a server function reaches for, and nothing else does.
 *
 * Every name here is a marker: if any of them turns up in the client bundle,
 * the stripping did not take the module out of the graph — which is the half
 * of the claim that stripping a body alone does not buy.
 */

export const CONNECTION_STRING = 'postgres://volt:hunter2@db.internal/todos';

export const db = {
  insert(text: string): { id: string } {
    return { id: `todo_${text.length}_via_${CONNECTION_STRING.length}` };
  },
};
