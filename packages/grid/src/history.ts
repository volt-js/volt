/**
 * Undo and redo, over changes the grid never makes.
 *
 * `createCellEditing` ends an edit by handing the caller a change, and nothing
 * in this package writes a row — so history cannot undo by writing one either.
 * It is instead the road a change takes to the caller's store: a commit, an
 * undo and a redo are each handed to `apply`, and only what `apply` says it
 * took is recorded. A write the server refused never reaches the undo stack,
 * and an undo the server refused leaves its step where it was, to be tried
 * again. Recording first and hoping would leave a Ctrl+Z that "undoes" a value
 * nobody holds.
 *
 *   class People {
 *     // `edits` and not `history`: a template reads `history` as the browser's own.
 *     edits = createEditHistory<Person>({
 *       grid: () => this.table,
 *       rows: () => this.people.get(),
 *       getRowKey: (person) => person.id,
 *       editing: () => this.editing,
 *       apply: async (step) => {
 *         if (!(await this.api.save(step.changes))) return false;
 *         for (const change of step.changes) this.store.write(change.item, change.columnId, change.value);
 *         return true;
 *       },
 *     });
 *     editing = createCellEditing<Person>({
 *       grid: () => this.table,
 *       editors: () => EDITORS,
 *       onCommit: (change) => void this.edits.commit(change),
 *     });
 *     onKey(event: KeyboardEvent) {
 *       if (!this.editing.onKeyDown(event) && !this.edits.onKeyDown(event)) this.table.onKeyDown(event);
 *     }
 *   }
 *
 *   <button :disabled="!edits.canUndo()" :click="edits.undo()">Undo</button>
 *   <button :disabled="!edits.canRedo()" :click="edits.redo()">Redo</button>
 *
 * **One `apply`, for every direction.** The function that writes a commit is
 * the one that writes its undo, because an undo *is* a commit of the values a
 * change replaced. A caller with two writers has two places to keep in step
 * with the server, and a history that recorded changes the caller applied on
 * their own would record an undo, too, the moment the same function was used
 * for both — turning every Ctrl+Z into a new change and emptying redo.
 *
 * **Held by key, never by place.** A step names each cell by its row's key and
 * its column's id, and is resolved against the rows as they are when it is
 * applied: a re-sort between the edit and its undo moves the row, and a place
 * would undo whichever row slid into it. The key comes from this layer's own
 * `getRowKey` over the row the change names, not from the grid — a grid given
 * none keys its rows by place, and a history that trusted that key would lose
 * its rows to the first sort. A row a filter hides still exists, so its change
 * is still undone; a row gone from the data is skipped, and `onSkip` is told.
 *
 * **One step per gesture.** A paste of forty cells is one entry, undone and
 * redone whole, because that is what the reader did: forty Ctrl+Zs to take back
 * one paste is a paste nobody dares make.
 *
 * **One step at a time.** Steps are applied in the order they were asked for,
 * each once the one before has settled. Two undos pressed while a save is in
 * flight are two undos of two different steps rather than two of the same one,
 * a commit made during an undo lands after it rather than beside it, and two
 * writes to one cell cannot reach the server in the wrong order. An `apply`
 * that answers at once — a store in memory — is never kept waiting: the queue
 * is only a queue while something is still out.
 *
 * The keyboard, while the grid has focus and no editor is open:
 *
 *   Ctrl + Z, Cmd + Z                undo
 *   Ctrl + Shift + Z, Cmd + Shift + Z redo
 *   Ctrl + Y                          redo
 *
 * Ctrl+Y and not Cmd+Y, because on a Mac Cmd+Y is the browser's history. Keys
 * pressed in a text control inside the grid — an editor, a filter box in the
 * header — are left to it: Ctrl+Z there is the text's own undo. A checkbox or
 * a select has no undo of its own, and one in a cell is usually how that
 * cell's change was made, so Ctrl+Z there is this one.
 *
 * **It reads no cell.** Nothing here calls a column's accessor: a step holds
 * the values it was given, and an undo hands back `previous` rather than asking
 * the cell what it holds. So undoing a change costs what committing it did —
 * the caller writes one signal, and one text node changes.
 */

import { Signal } from '@voltdev/core';
import { announce, useLocale, type Locale, type MessageValues } from '@voltdev/primitives';
import type { GridCellEditing, GridEditChange } from './edit.js';
import type { Grid, GridCell } from './grid.js';
import type { GridRowKey } from './selection.js';

const { untrack } = Signal.subtle;

/**
 * Steps kept when no depth is given.
 *
 * Enough that a reader who has been working for a while can walk back through
 * it; few enough that a history of large pastes does not become the biggest
 * thing on the page.
 */
const DEFAULT_DEPTH = 100;

/** Shared, so an empty stack is the same value every time it is emptied. */
const EMPTY: readonly GridHistoryEntry[] = [];

/** Why a step is being applied: a change being made, or one being taken back or made again. */
export type GridHistoryKind = 'commit' | 'undo' | 'redo';

/**
 * What history needs of a change it is handed: the row it was made to, the
 * cell, and the value either side of it.
 *
 * The part of a `GridEditChange` that outlives the moment it was made. Its
 * `rowKey` and `rowIndex` are left behind on purpose — the key is worked out
 * again from `item` with this layer's own `getRowKey`, and a place in the view
 * stops being true at the next sort.
 */
export type GridHistoryChange<T> = Pick<
  GridEditChange<T>,
  'item' | 'columnId' | 'previous' | 'value'
>;

/**
 * One cell of a step, as history holds it: by key, and never the row itself.
 *
 * Not the row object, because a store that replaces rather than writes hands
 * back a new one for every change, and a step that held the old one would undo
 * into an object nothing renders — and would keep it alive for as long as the
 * step was kept.
 */
export interface GridHistoryRecord {
  readonly rowKey: GridRowKey;
  readonly columnId: string;
  /** What the cell held before the change. */
  readonly previous: unknown;
  /** What the change made it. */
  readonly value: unknown;
}

/** A recorded step: every cell one gesture changed, in the order it changed them. */
type GridHistoryEntry = readonly GridHistoryRecord[];

/**
 * What `apply` is asked to write.
 *
 * Each change is a `GridEditChange` resolved against the rows as they are now:
 * `item` is the row that holds the key today, which a store that replaces rows
 * will have made a different object from the one the edit was made to, and
 * `rowIndex` is where that row sits in the view now — or -1 where a filter
 * hides it, since a hidden row still exists and is still written to. For an
 * undo, `previous` and `value` are the recorded ones the other way round, and
 * the changes come in reverse, so that a cell a step wrote twice ends up as it
 * was before either.
 */
export interface GridHistoryStep<T> {
  readonly kind: GridHistoryKind;
  readonly changes: readonly GridEditChange<T>[];
}

/** What `createEditHistory` is given. */
export interface GridEditHistoryOptions<T> {
  /**
   * The grid the changes are made in.
   *
   * A function for the reason every layer takes one: the grid is usually a
   * field declared alongside this one. Used for where a row sits in the view
   * and to move the cursor for a keyboard undo — never to find a row, which
   * `rows` does.
   */
  grid: () => Grid<T> | null | undefined;
  /**
   * The rows — the same ones the grid is given.
   *
   * Every row, and not the view: a row a filter hides still exists and its
   * change is still undone, where the grid's view would call it gone. Read
   * once per change to the data, into an index by key, so an undo costs a
   * lookup and not a scan.
   */
  rows: () => readonly T[];
  /**
   * What identifies a row — the same as the grid's `getRowKey`.
   *
   * Required here where the grid defaults it to the index. An index names a
   * different row after every sort, and outliving a sort is what a history
   * that holds rows by key is for.
   */
  getRowKey: (row: T) => GridRowKey;
  /**
   * Write a step to the store the rows came from, and say whether it took.
   *
   * The only way history changes a value. Return — or resolve — `true` once
   * the change is written and `false` where it was refused, and only a `true`
   * records anything. Refuse by returning `false` rather than throwing: a
   * throw is not a refusal but an error, and is handed back through the
   * promise that asked for the step.
   */
  apply: (step: GridHistoryStep<T>) => boolean | Promise<boolean>;
  /**
   * The editing layer, where the grid has one.
   *
   * While a cell is open the keys belong to its editor, and undo and redo are
   * refused from anywhere: an undo that changed the cell being edited would
   * leave the session holding a value the cell no longer had, and its commit
   * would report a change from something that was not there.
   *
   * That refuses a step asked for while the cell is open, and nothing more. A
   * step already handed to a slow `apply` when the cell was opened still lands
   * under it, and the edit then commits from the value the cell opened with.
   */
  editing?: () => GridCellEditing<T> | null | undefined;
  /**
   * How many steps to keep. Default 100. A whole number of none or more; the
   * oldest step goes when a new one would pass it. Zero keeps nothing, and
   * still hands every commit to `apply`.
   */
  depth?: number;
  /**
   * Told which changes of a step were left out because the data no longer
   * holds their row — before the rest are handed to `apply`, or instead of it
   * where nothing is left. A step with nothing left is dropped: it can never
   * be undone, and keeping it would spend a Ctrl+Z doing nothing every time it
   * came round.
   */
  onSkip?: (skipped: readonly GridHistoryRecord[], kind: GridHistoryKind) => void;
  /**
   * The sentence announced when an undo or redo has been applied, given how
   * many cells it changed. Return an empty string to say nothing.
   *
   * Defaulted, as the grid's own sentences are, because an undo's only other
   * evidence is a value changing — somewhere a screen-reader user may not be.
   * The locale's `gridUndone` or `gridRedone`, `{n}` the count, or English
   * where the catalogue has neither.
   */
  announcement?: (kind: 'undo' | 'redo', count: number) => string;
}

/** Undo and redo for one grid, and the keys that drive them. */
export interface GridEditHistory<T> {
  /**
   * Whether there is a step to undo, and nothing refusing it — for a toolbar
   * to follow. False while an editor is open.
   */
  canUndo(): boolean;
  /** Whether there is a step to redo, and nothing refusing it. */
  canRedo(): boolean;
  /**
   * Hand a change to `apply`, and record it once `apply` says it took. Many
   * changes are one step — the cells of a paste.
   *
   * Clears redo when it is recorded: a new change makes a different future
   * from the one the undone steps belonged to. A change that leaves its value
   * as it was is dropped, and resolves `false` with nothing applied.
   *
   * Resolves whether the change was applied.
   */
  commit(change: GridHistoryChange<T> | readonly GridHistoryChange<T>[]): Promise<boolean>;
  /**
   * Hand the last step's inverse to `apply`, and move it to redo once `apply`
   * says it took. Resolves whether it did — false, too, where there was
   * nothing to undo or an editor was open.
   */
  undo(): Promise<boolean>;
  /** Hand the last undone step to `apply` again, and move it back once it took. */
  redo(): Promise<boolean>;
  /**
   * Forget every step, and every change still on its way.
   *
   * For when the data is replaced wholesale — a reload, another record — and
   * the changes kept name rows that meant something else. A commit asked for
   * before the clear is still handed to `apply` when its turn comes, since the
   * caller asked for the write, but is not recorded: its undo would put back
   * a value from the data that was replaced.
   */
  clear(): void;
  /**
   * The history keyboard. Wire it after the editing layer's `onKeyDown` and
   * before the grid's.
   */
  onKeyDown(event: KeyboardEvent): boolean;
}

/** Where a keyboard step was asked for, so the cursor can follow it only if the reader is still there. */
interface Origin {
  readonly element: Element;
  /** What held focus as the key was pressed, which a scroll can take out of the document. */
  readonly focused: Element;
  readonly rowKey: GridRowKey | undefined;
  readonly column: number;
}

interface Job {
  readonly run: () => boolean | Promise<boolean>;
  readonly resolve: (applied: boolean) => void;
  readonly reject: (error: unknown) => void;
}

interface Resolved<T> {
  readonly changes: GridEditChange<T>[];
  readonly applied: GridHistoryRecord[];
  readonly skipped: GridHistoryRecord[];
}

/**
 * Undo and redo over the changes the editing and clipboard layers hand back.
 *
 * Call it where a component's fields are initialised, as the grid is: it reads
 * the nearest locale for what it says aloud.
 */
export function createEditHistory<T>(options: GridEditHistoryOptions<T>): GridEditHistory<T> {
  const depth = wholeDepth(options.depth);
  // Read where the component's fields are initialised, as the grid reads it:
  // the nearest locale is a property of where this was created.
  const locale = useLocale();
  const announcement =
    options.announcement ??
    ((kind: 'undo' | 'redo', count: number): string => describeStep(locale, kind, count));

  const undoStack = new Signal.State<readonly GridHistoryEntry[]>(EMPTY);
  const redoStack = new Signal.State<readonly GridHistoryEntry[]>(EMPTY);

  const grid = (): Grid<T> | null => options.grid() ?? null;

  const editorOpen = (): boolean => (options.editing?.()?.session() ?? null) !== null;

  /**
   * Every row by its key, rebuilt only when the data changes.
   *
   * The rows and not the view: a filter hides a row without it ceasing to be,
   * and a lookup in the view would skip an undo the reader can bring back by
   * clearing the filter. Kept as a computed rather than scanned per step, so a
   * store that writes a cell's signal — and so leaves the array alone — pays
   * for the index once, however many steps go by.
   */
  const byKey = new Signal.Computed<ReadonlyMap<GridRowKey, T>>(() => {
    const index = new Map<GridRowKey, T>();
    for (const row of options.rows()) {
      const key = options.getRowKey(row);
      // The first of two rows sharing a key is the one the grid's own lookup
      // finds, and a step should land where the reader would look for it.
      if (!index.has(key)) index.set(key, row);
    }
    return index;
  });

  /**
   * Where each row sits in the view, by the row itself.
   *
   * By identity and not by the grid's key, because the grid's key may be its
   * index — and an index key looked up with this layer's key would find some
   * other row, or none. Rebuilt when the view changes, and only when a step
   * asks for it.
   */
  const places = new Signal.Computed<ReadonlyMap<T, number>>(() => {
    const table = grid();
    const index = new Map<T, number>();
    if (table === null) return index;
    const count = table.rowCount();
    for (let row = 0; row < count; row++) {
      const item = table.rowAt(row);
      if (item !== undefined && !index.has(item)) index.set(item, row);
    }
    return index;
  });

  const canUndo = new Signal.Computed(() => undoStack.get().length > 0 && !editorOpen());
  const canRedo = new Signal.Computed(() => redoStack.get().length > 0 && !editorOpen());

  /**
   * A step's records as changes to the rows that hold their keys now.
   *
   * `applied` keeps the step's own order whatever the direction, since it is
   * what goes on the other stack and has to be read the same way next time.
   */
  const resolve = (entry: GridHistoryEntry, kind: GridHistoryKind): Resolved<T> => {
    const rows = byKey.get();
    const at = places.get();
    const changes: GridEditChange<T>[] = [];
    const applied: GridHistoryRecord[] = [];
    const skipped: GridHistoryRecord[] = [];
    const backwards = kind === 'undo';
    for (const record of entry) {
      if (!rows.has(record.rowKey)) {
        skipped.push(record);
        continue;
      }
      const item = rows.get(record.rowKey) as T;
      applied.push(record);
      changes.push({
        item,
        rowKey: record.rowKey,
        rowIndex: at.get(item) ?? -1,
        columnId: record.columnId,
        previous: backwards ? record.value : record.previous,
        value: backwards ? record.previous : record.value,
      });
    }
    // Last written, first put back: a cell a step wrote twice then ends as it
    // was before either write, not as the first one left it.
    if (backwards) changes.reverse();
    return { changes, applied, skipped };
  };

  /** Onto the top of a stack, the oldest step going where there are too many. */
  const push = (stack: Signal.State<readonly GridHistoryEntry[]>, entry: GridHistoryEntry): void => {
    if (depth === 0) return;
    const entries = [...stack.get(), entry];
    stack.set(entries.length > depth ? entries.slice(entries.length - depth) : entries);
  };

  /**
   * Off the top of a stack, if it is still there.
   *
   * Steps run one at a time, so the step being settled is the top of its stack
   * unless `clear` ran while `apply` was out — and a cleared history is not
   * one to put it back into.
   */
  const pop = (stack: Signal.State<readonly GridHistoryEntry[]>, entry: GridHistoryEntry): boolean => {
    const entries = stack.get();
    if (entries.at(-1) !== entry) return false;
    stack.set(entries.length === 1 ? EMPTY : entries.slice(0, -1));
    return true;
  };

  /**
   * Runs `then` once `apply` has said yes, now or when it answers.
   *
   * Untracked either way without asking for it: now is inside the job, which
   * runs untracked, and later is a promise callback, which nothing tracks.
   */
  const settle = (
    outcome: boolean | Promise<boolean>,
    then: () => void,
  ): boolean | Promise<boolean> => {
    if (typeof outcome === 'boolean') {
      if (outcome) then();
      return outcome;
    }
    // Adopted rather than called, so a thenable from anywhere is waited on and
    // an `apply` that forgot to return anything is a refusal, not a TypeError.
    return Promise.resolve(outcome).then((applied) => {
      if (applied !== true) return false;
      then();
      return true;
    });
  };

  const queue: Job[] = [];
  let running = false;
  /**
   * How many times the history has been cleared. A commit remembers the one
   * it was asked for in, and is recorded only if it is still that one when
   * `apply` says yes.
   */
  let era = 0;

  /**
   * Run steps one at a time, in the order they were asked for.
   *
   * A step that settles at once is run at once, inside the call that asked
   * for it, so a store in memory sees no queue at all. Only a step whose
   * `apply` returned a promise holds the rest back until it settles.
   */
  const drain = (): void => {
    while (!running) {
      const job = queue.shift();
      if (job === undefined) return;
      // Held across a synchronous `apply` as well, so an `apply` that asks for
      // a step of its own queues it behind itself rather than running it in
      // the middle.
      running = true;
      let outcome: boolean | Promise<boolean>;
      try {
        outcome = untrack(job.run);
      } catch (error) {
        running = false;
        job.reject(error);
        continue;
      }
      if (typeof outcome === 'boolean') {
        running = false;
        job.resolve(outcome);
        continue;
      }
      outcome.then(
        (applied) => {
          running = false;
          job.resolve(applied);
          drain();
        },
        (error: unknown) => {
          running = false;
          job.reject(error);
          drain();
        },
      );
    }
  };

  const enqueue = (run: () => boolean | Promise<boolean>): Promise<boolean> =>
    new Promise<boolean>((resolve, reject) => {
      queue.push({ run, resolve, reject });
      drain();
    });

  const commit = (
    change: GridHistoryChange<T> | readonly GridHistoryChange<T>[],
  ): Promise<boolean> => {
    const list = isList(change) ? change : [change];
    const entry: GridHistoryRecord[] = [];
    for (const each of list) {
      // Not a change, as `createCellEditing` has it. A step of nothing but
      // these would spend a Ctrl+Z on a value nobody would see move.
      if (Object.is(each.previous, each.value)) continue;
      entry.push({
        rowKey: options.getRowKey(each.item),
        columnId: each.columnId,
        previous: each.previous,
        value: each.value,
      });
    }
    if (entry.length === 0) return Promise.resolve(false);

    // Taken now, not when its turn comes: a commit queued before a clear and
    // run after it names rows of the data the clear was for.
    const asked = era;
    return enqueue(() => {
      const { changes, applied, skipped } = resolve(entry, 'commit');
      if (skipped.length > 0) options.onSkip?.(skipped, 'commit');
      if (changes.length === 0) return false;
      return settle(options.apply({ kind: 'commit', changes }), () => {
        if (asked !== era) return;
        redoStack.set(EMPTY);
        push(undoStack, applied.length === entry.length ? entry : applied);
      });
    });
  };

  /**
   * Put the cursor on the first cell a keyboard step is about to change.
   *
   * Moved as the step is handed to `apply`, not once `apply` answers. The grid
   * reads a cursor against the view as it last rendered, and carries it with
   * its row when the view changes: a cursor put there before the write goes
   * wherever the write's re-sort takes that row, where one put there after it
   * — before the grid has caught up — would be read against the old order and
   * land on a stranger. It also puts a reader waiting on a slow save on the
   * cell whose value is about to change.
   *
   * Only if the reader is still where they pressed the key — focus in the
   * grid, the cursor on the same row and column — because a step that waited
   * its turn behind a save would otherwise drag back a reader who has moved
   * on. Focus nowhere still counts as in the grid when the element that held
   * it has left the document: scrolling the body takes the focused cell out of
   * the window, and focus with it, without the reader going anywhere — the
   * grid judges its own cursor the same way.
   *
   * The first cell is the one nearest the top of the view and then the left,
   * which for a paste is its corner; a step whose rows a filter hides leaves
   * the cursor alone, since there is no cell to put it on.
   */
  const follow = (origin: Origin | null, changes: readonly GridEditChange<T>[]): void => {
    const table = grid();
    if (origin === null || table === null) return;
    const page = origin.element.ownerDocument;
    const focused = page.activeElement;
    // The cell gone and the grid still here: a grid taken out of the page
    // took its cells with it, and is no grid to put a cursor in.
    const scrolledAway =
      (focused === null || focused === page.body) &&
      origin.element.isConnected &&
      !origin.focused.isConnected;
    if (!origin.element.contains(focused) && !scrolledAway) return;
    const cursor = table.activeCell();
    if (cursor.column !== origin.column || keyAt(table, cursor.row) !== origin.rowKey) return;

    let target: GridCell | null = null;
    for (const change of changes) {
      const row = change.rowIndex;
      const column = table.columnIndex(change.columnId);
      if (row < 0 || column < 0) continue;
      if (target === null || row < target.row || (row === target.row && column < target.column)) {
        target = { row, column };
      }
    }
    if (target !== null) table.focusCell(target);
  };

  const keyAt = (table: Grid<T>, row: number): GridRowKey | undefined => {
    const item = table.rowAt(row);
    return item === undefined ? undefined : options.getRowKey(item);
  };

  /**
   * Undo or redo the top step — decided when its turn comes, not when it was
   * asked for, so that two presses while a save is out take back two steps.
   *
   * Refused at once while an editor is open, and not only when its turn comes.
   * Queued, it would run once the editor had closed, and whether a step asked
   * for with a cell open ran at all would turn on how slow the save ahead of
   * it was.
   */
  const step = (kind: 'undo' | 'redo', origin: Origin | null): Promise<boolean> => {
    if (untrack(editorOpen)) return Promise.resolve(false);
    return enqueue(() => {
      // Asked again here, because a step that waited behind a save may find a
      // cell open by the time its turn comes.
      if (editorOpen()) return false;
      const from = kind === 'undo' ? undoStack : redoStack;
      const to = kind === 'undo' ? redoStack : undoStack;
      const entries = from.get();
      const entry = entries.at(-1);
      if (entry === undefined) return false;

      const { changes, applied, skipped } = resolve(entry, kind);
      if (skipped.length > 0) options.onSkip?.(skipped, kind);
      if (changes.length === 0) {
        pop(from, entry);
        return false;
      }
      follow(origin, changes);
      return settle(options.apply({ kind, changes }), () => {
        if (!pop(from, entry)) return;
        // Only what was written goes across. A cell whose row had gone was not
        // undone, and redoing it — should a row under that key come back —
        // would write a value over one this step never changed.
        push(to, applied.length === entry.length ? entry : applied);
        announce(announcement(kind, changes.length));
      });
    });
  };

  return {
    canUndo: () => canUndo.get(),
    canRedo: () => canRedo.get(),
    commit,
    undo: () => step('undo', null),
    redo: () => step('redo', null),
    clear: () => {
      era++;
      undoStack.set(EMPTY);
      redoStack.set(EMPTY);
    },

    onKeyDown: (event) => {
      const kind = shortcut(event);
      if (kind === null) return false;
      // The control's own undo, for the text in it. An editor's, a filter box's
      // in the header: taking the key would undo a cell while the reader meant
      // the word they just typed.
      if (ownsItsUndo(event.target)) return false;
      if (untrack(editorOpen)) return false;

      const table = grid();
      const element = event.currentTarget instanceof Element ? event.currentTarget : null;
      let origin: Origin | null = null;
      if (table !== null && element !== null) {
        const cursor = untrack(() => table.activeCell());
        origin = {
          element,
          focused: event.target instanceof Element ? event.target : element,
          rowKey: untrack(() => keyAt(table, cursor.row)),
          column: cursor.column,
        };
      }
      // Claimed with nothing to undo too. The key means this grid's undo while
      // the grid has focus, whether or not there is anything left to take back.
      event.preventDefault();
      // Nothing awaits a key. A refusal is `false`, which needs no handling; an
      // `apply` that throws surfaces as any unhandled rejection does.
      void step(kind, origin);
      return true;
    },
  };
}

/**
 * The history shortcut an event is, if it is one.
 *
 * Alt is never part of it: Ctrl+Alt is AltGr on many keyboards, and types
 * characters.
 */
function shortcut(event: KeyboardEvent): 'undo' | 'redo' | null {
  if (event.altKey || (!event.ctrlKey && !event.metaKey)) return null;
  const letter = shortcutLetter(event);
  if (letter === 'z') return event.shiftKey ? 'redo' : 'undo';
  if (letter === 'y' && event.ctrlKey && !event.shiftKey) return 'redo';
  return null;
}

/**
 * The Latin letter a key means in a shortcut.
 *
 * The character where it is a Latin letter, so a layout that puts Z somewhere
 * else — German, French — still undoes with the key marked Z. Where it is a
 * letter of another script, the physical key, because a Russian or Greek
 * keyboard's Z key types я or ζ and is still the undo key there, as it is for
 * the text fields on the same page. Never for anything that is not a letter:
 * Dvorak types a semicolon where QWERTY has Z, and Ctrl+; is not an undo.
 */
function shortcutLetter(event: KeyboardEvent): string | null {
  if (!LETTER.test(event.key)) return null;
  if (LATIN_LETTER.test(event.key)) return event.key.toLowerCase();
  return LETTER_BY_KEY_CODE.get(event.code) ?? null;
}

const LETTER = /^\p{L}$/u;
const LATIN_LETTER = /^\p{Script=Latin}$/u;

/** The letters a shortcut here is made with, by the physical key a Latin layout types them on. */
const LETTER_BY_KEY_CODE: ReadonlyMap<string, string> = new Map([
  ['KeyZ', 'z'],
  ['KeyY', 'y'],
]);

/**
 * The input types that take no typed text, and so keep no undo of their own.
 * The clipboard layer keeps the same list, for the same question about copy.
 */
const NON_TEXT_INPUTS: ReadonlySet<string> = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'hidden',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
]);

/** Whether keys pressed here belong to a control with an undo of its own: one that takes typed text. */
function ownsItsUndo(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement) return true;
  return target instanceof HTMLInputElement && !NON_TEXT_INPUTS.has(target.type);
}

function isList<C>(value: C | readonly C[]): value is readonly C[] {
  return Array.isArray(value);
}

/**
 * The depth as a whole number of steps, and never fewer than none.
 *
 * NaN is taken as no depth given, because the arithmetic it would otherwise
 * feed compares false with everything and keeps every step for ever.
 */
function wholeDepth(depth: number | undefined): number {
  if (depth === undefined || Number.isNaN(depth)) return DEFAULT_DEPTH;
  return Math.max(0, Math.floor(depth));
}

/**
 * A sentence history says aloud: the locale's catalogue where it has the key,
 * then English — as the grid's own are, and for the same reason: no catalogue
 * the library ships has ever heard of a grid.
 */
function said(locale: Locale, key: string, english: string, values?: MessageValues): string {
  return locale.has(key) ? locale.t(key, values) : english;
}

/**
 * How many cells went back, or forward again.
 *
 * The count and not the cells: a paste undone is forty values, and reading
 * them out would bury the one fact the reader asked for — that it happened.
 */
function describeStep(locale: Locale, kind: 'undo' | 'redo', n: number): string {
  const done = kind === 'undo' ? 'undone' : 'redone';
  const english = n === 1 ? `Change ${done}` : `${n} changes ${done}`;
  return said(locale, kind === 'undo' ? 'gridUndone' : 'gridRedone', english, { n });
}
