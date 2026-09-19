/**
 * Drag and drop, driven through real mounted components.
 *
 * The behaviour worth asserting is the part that is usually missing: the whole
 * keyboard map, what the live region says at each step, the index a drop
 * reports once the source has been taken out of the list, and the refusals —
 * a press that was a scroll, a node dropped into its own children, a key that
 * belongs to the drag reaching the dialog behind it.
 *
 * happy-dom gives every element a zero rect, so the pointer tests lay the page
 * out by hand. That is a fair trade: it makes the geometry the test is about
 * explicit rather than incidental.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compileTemplate } from '@voltdev/core/jit';
import { Component, Signal, flushSync, mount } from '@voltdev/core';
import {
  DRAG_CONTAINER_ATTRIBUTE,
  DRAG_HANDLE_ATTRIBUTE,
  DRAG_ITEM_ATTRIBUTE,
  createDragDrop,
  type DragDrop,
  type DragDropOptions,
  type DragEndReason,
  type DropEvent,
  type DropTarget,
} from '../src/drag-drop.js';
import { createLocaleProvider } from '../src/i18n.js';

let host: HTMLElement;
let mounted: { unmount(): void }[] = [];
/** Handed to whichever component the test mounts, since decorators run once. */
let boardOptions: Partial<DragDropOptions> = {};
let drops: DropEvent[] = [];
let ends: DragEndReason[] = [];

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  host = document.querySelector('#app')!;
  boardOptions = {};
  drops = [];
  ends = [];
});

afterEach(() => {
  for (const handle of mounted) handle.unmount();
  mounted = [];
  flushSync();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

/** Two connected lists, the live region, and the instructions items point at. */
@Component({
  selector: 'v-board',
  render: compileTemplate(`
    <div :ref="root"
         :pointerdown="dnd.onPointerDown($event)"
         :keydown="dnd.onKeyDown($event)">
      <ul class="todo" :spread="dnd.containerProps({ id: 'todo', label: 'Todo' })">
        <li :for="item in todo.get()" :key="item" tabindex="0"
            :style="{ transform: dnd.transformFor(item) }"
            :spread="dnd.itemProps({ id: item, disabled: item === 'Sway' })">{ item }</li>
      </ul>
      <ul class="done" :spread="dnd.containerProps({ id: 'done', label: 'Done' })">
        <li :for="item in done.get()" :key="item" tabindex="0"
            :spread="dnd.itemProps({ id: item })">{ item }</li>
      </ul>
      <div class="live" :spread="dnd.liveRegionProps()">{ dnd.announcement() }</div>
      <p class="instructions" :spread="dnd.instructionsProps()">{ dnd.instructions() }</p>
    </div>
  `),
})
class Board {
  root = new Signal.State<Element | null>(null);
  todo = new Signal.State(['Kite', 'Grace', 'Sway']);
  done = new Signal.State<string[]>([]);

  dnd: DragDrop = createDragDrop({
    root: () => this.root.get(),
    onDrop: (event) => {
      drops.push(event);
      this.apply(event);
    },
    onDragEnd: (reason) => ends.push(reason),
    ...boardOptions,
  });

  /** Move the item for real, so the tests see what a consumer would. */
  apply({ source, target }: DropEvent) {
    const lists: Record<string, Signal.State<string[]>> = { todo: this.todo, done: this.done };
    const from = lists[source.containerId];
    const to = lists[target.containerId];
    if (!from || !to) return;

    const next = from.get().filter((id) => id !== source.itemId);
    if (from === to) {
      next.splice(target.index, 0, source.itemId);
      from.set(next);
      return;
    }
    const arrived = [...to.get()];
    arrived.splice(target.index, 0, source.itemId);
    from.set(next);
    to.set(arrived);
  }
}

/** A tree: a collection nested inside one of its own items. */
@Component({
  selector: 'v-tree',
  render: compileTemplate(`
    <div :ref="root"
         :pointerdown="dnd.onPointerDown($event)"
         :keydown="dnd.onKeyDown($event)">
      <ul class="root" :spread="dnd.containerProps({ id: 'root', label: 'Files' })">
        <li class="folder" tabindex="0"
            :spread="dnd.itemProps({ id: 'work', label: 'Work', dropsOn: true })">
          <span class="handle" :spread="dnd.handleProps({ label: 'Reorder Work' })">::</span>
          <ul class="inner" :spread="dnd.containerProps({ id: 'work-children', label: 'Work' })">
            <li class="leaf" tabindex="0" :spread="dnd.itemProps({ id: 'notes', label: 'Notes' })">n</li>
          </ul>
        </li>
        <li class="other" tabindex="0"
            :spread="dnd.itemProps({ id: 'home', label: 'Home', dropsOn: true })">h</li>
      </ul>
      <div class="live" :spread="dnd.liveRegionProps()">{ dnd.announcement() }</div>
    </div>
  `),
})
class Tree {
  root = new Signal.State<Element | null>(null);
  dnd: DragDrop = createDragDrop({
    root: () => this.root.get(),
    onDrop: (event) => drops.push(event),
    onDragEnd: (reason) => ends.push(reason),
    ...boardOptions,
  });
}

/** One list inside a scrolling pane, for the auto-scroll and boundary tests. */
@Component({
  selector: 'v-pane',
  render: compileTemplate(`
    <div :ref="root"
         :pointerdown="dnd.onPointerDown($event)"
         :keydown="dnd.onKeyDown($event)">
      <div class="scroller" style="overflow-y: auto">
        <ul class="list" :spread="dnd.containerProps({ id: 'list', label: 'List' })">
          <li :for="item in items.get()" :key="item" tabindex="0"
              :spread="dnd.itemProps({ id: item })">{ item }</li>
        </ul>
      </div>
    </div>
  `),
})
class Pane {
  root = new Signal.State<Element | null>(null);
  items = new Signal.State(['one', 'two', 'three']);
  dnd: DragDrop = createDragDrop({
    root: () => this.root.get(),
    onDrop: (event) => drops.push(event),
    onDragEnd: (reason) => ends.push(reason),
    ...boardOptions,
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function track<T extends { unmount(): void }>(handle: T): T {
  mounted.push(handle);
  return handle;
}

function setRect(el: Element, x: number, y: number, width: number, height: number) {
  el.getBoundingClientRect = () => new DOMRect(x, y, width, height);
}

/** Lay every list out in its own 100px column, with 50px rows. */
function layout() {
  let column = 0;
  for (const list of document.querySelectorAll<HTMLElement>('ul')) {
    setRect(list, column, 0, 100, 300);
    [...list.children].forEach((item, index) => setRect(item, column, index * 50, 100, 50));
    column += 100;
  }
}

function board(options: Partial<DragDropOptions> = {}) {
  boardOptions = options;
  const handle = track(mount(Board, host));
  flushSync();
  layout();

  return {
    handle,
    dnd: (handle.instance as Board).dnd,
    item: (id: string) => host.querySelector<HTMLElement>(`[${DRAG_ITEM_ATTRIBUTE}="${id}"]`)!,
    list: (id: string) => host.querySelector<HTMLElement>(`[${DRAG_CONTAINER_ATTRIBUTE}="${id}"]`)!,
    said: () => host.querySelector('.live')!.textContent,
    todo: () => (handle.instance as Board).todo.get(),
    done: () => (handle.instance as Board).done.get(),
  };
}

function tree(options: Partial<DragDropOptions> = {}) {
  boardOptions = options;
  const handle = track(mount(Tree, host));
  flushSync();
  layout();

  return {
    dnd: (handle.instance as Tree).dnd,
    node: (selector: string) => host.querySelector<HTMLElement>(selector)!,
    said: () => host.querySelector('.live')!.textContent,
  };
}

function key(el: Element, k: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
  el.dispatchEvent(event);
  flushSync();
  return event;
}

function pointer(
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  el: Element,
  x: number,
  y: number,
  init: PointerEventInit = {},
) {
  el.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      isPrimary: true,
      button: 0,
      pointerId: 1,
      pointerType: 'mouse',
      clientX: x,
      clientY: y,
      ...init,
    }),
  );
  flushSync();
}

/** Press, then travel far enough to be a drag rather than a click. */
function startPointerDrag(el: Element, x: number, y: number, init: PointerEventInit = {}) {
  pointer('pointerdown', el, x, y, init);
  pointer('pointermove', el, x, y + 10, init);
}

async function frames(count = 2) {
  for (let i = 0; i < count; i++) {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
  }
  flushSync();
}

/** Let the queued microtasks — including the focus restore — run. */
async function settle() {
  flushSync();
  await Promise.resolve();
  await Promise.resolve();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('what assistive technology is told', () => {
  it('describes an item without claiming a role or a tab stop', () => {
    const { item } = board();
    const kite = item('Kite');

    expect(kite.getAttribute('aria-roledescription')).toBe('draggable');
    // The component this composes into owns the role and the roving tab stop:
    // a tree item, a grid row and a tab are all draggable and none is a button.
    expect(kite.hasAttribute('role')).toBe(false);
    expect(kite.getAttribute('tabindex')).toBe('0');
    // Otherwise the native drag starts on any image or link in the row and
    // fights the pointer drag for the same gesture.
    expect(kite.getAttribute('draggable')).toBe('false');
  });

  it('points every item at one set of instructions', () => {
    const { item } = board();
    const instructions = host.querySelector('.instructions')!;

    expect(instructions.id).not.toBe('');
    expect(item('Kite').getAttribute('aria-describedby')).toBe(instructions.id);
    expect(instructions.textContent).toContain('Space');
    expect(instructions.textContent).toContain('Escape');
  });

  it('omits the description when no instructions were rendered', () => {
    @Component({
      selector: 'v-bare',
      render: compileTemplate(
        `<div :ref="root"><ul :spread="dnd.containerProps({ id: 'l' })">` +
          `<li :spread="dnd.itemProps({ id: 'x' })">x</li></ul></div>`,
      ),
    })
    class Bare {
      root = new Signal.State<Element | null>(null);
      dnd = createDragDrop({ root: () => this.root.get() });
    }

    track(mount(Bare, host));
    flushSync();
    // A dangling aria-describedby is worse than none: both leave the item
    // undescribed, but the dangling one hides the mistake.
    expect(host.querySelector('li')!.hasAttribute('aria-describedby')).toBe(false);
  });

  it('points the items at instructions that are rendered after them, and away again', () => {
    @Component({
      selector: 'v-late-instructions',
      render: compileTemplate(
        `<div :ref="root"><ul :spread="dnd.containerProps({ id: 'l' })">` +
          `<li :spread="dnd.itemProps({ id: 'x' })">x</li></ul>` +
          `<p :if="shown.get()" :spread="dnd.instructionsProps()">{ dnd.instructions() }</p></div>`,
      ),
    })
    class Late {
      root = new Signal.State<Element | null>(null);
      shown = new Signal.State(false);
      dnd = createDragDrop({ root: () => this.root.get() });
    }

    const handle = track(mount(Late, host));
    flushSync();
    const li = host.querySelector('li')!;
    expect(li.hasAttribute('aria-describedby')).toBe(false);

    // Behind an `:if`, the instructions arrive long after the root did.
    (handle.instance as Late).shown.set(true);
    flushSync();
    expect(li.getAttribute('aria-describedby')).toBe(host.querySelector('p')!.id);

    // And a reference to an element that has gone is the dangling one this
    // check exists to avoid.
    (handle.instance as Late).shown.set(false);
    flushSync();
    expect(li.hasAttribute('aria-describedby')).toBe(false);
  });

  it('composes into a computed, like every other props getter', () => {
    @Component({
      selector: 'v-merged-instructions',
      render: compileTemplate(
        `<div :ref="root"><ul :spread="dnd.containerProps({ id: 'l' })">` +
          `<li :spread="dnd.itemProps({ id: 'x' })">x</li></ul>` +
          `<p :spread="described.get()">{ dnd.instructions() }</p></div>`,
      ),
    })
    class Merged {
      root = new Signal.State<Element | null>(null);
      dnd = createDragDrop({ root: () => this.root.get() });
      // Merging a class onto a set of props is the ordinary thing to do with
      // them, and a computed has to stay pure — so a getter that wrote on the
      // way past would throw here instead of describing anything.
      described = new Signal.Computed(() => ({
        ...this.dnd.instructionsProps(),
        class: 'sr-only',
      }));
    }

    track(mount(Merged, host));
    flushSync();

    const instructions = host.querySelector('p')!;
    expect(instructions.className).toBe('sr-only');
    expect(host.querySelector('li')!.getAttribute('aria-describedby')).toBe(instructions.id);
  });

  it('lets every string be replaced, including the role description', () => {
    const { item, said, dnd } = board({
      labels: {
        item: '',
        instructions: 'Leertaste hebt an.',
        lifted: (drag) => `Aufgenommen: ${drag.itemLabel}`,
      },
    });

    expect(item('Kite').hasAttribute('aria-roledescription')).toBe(false);
    expect(host.querySelector('.instructions')!.textContent).toBe('Leertaste hebt an.');

    dnd.lift('Kite');
    flushSync();
    expect(said()).toBe('Aufgenommen: Kite');
  });

  it('speaks the language of a catalogue that has translated the drag', () => {
    @Component({
      selector: 'v-german-list',
      render: compileTemplate(`
        <div :ref="root" :keydown="dnd.onKeyDown($event)">
          <ul :spread="dnd.containerProps({ id: 'l', label: 'Liste' })">
            <li :for="item in items" :key="item" tabindex="0"
                :spread="dnd.itemProps({ id: item, dropsOn: item === 'b' })">
              <span :spread="dnd.handleProps()">{ item }</span>
            </li>
          </ul>
          <div class="live" :spread="dnd.liveRegionProps()">{ dnd.announcement() }</div>
          <p class="instructions" :spread="dnd.instructionsProps()">{ dnd.instructions() }</p>
        </div>
      `),
    })
    class GermanList {
      locale = createLocaleProvider({
        defaultLocale: 'de-DE',
        messages: {
          draggable: 'verschiebbar',
          dragHandle: 'Griff',
          dragInstructions: 'Leertaste hebt an.',
          dragLifted: '{item} aufgenommen. Element {position} von {total} in {container}.',
          dragMoved: '{item} ist jetzt Element {position} von {total} in {container}.',
          dragMovedOn: '{item} auf {target} ablegen.',
          dragDroppedOn: '{item} auf {target} abgelegt.',
          dragCancelled: 'Abgebrochen. {item} ist zurück.',
        },
      });
      root = new Signal.State<Element | null>(null);
      items = ['a', 'b', 'c'];
      dnd = createDragDrop({ root: () => this.root.get() });
    }

    const handle = track(mount(GermanList, host));
    flushSync();
    const dnd = (handle.instance as GermanList).dnd;
    const a = host.querySelector<HTMLElement>(`[${DRAG_ITEM_ATTRIBUTE}="a"]`)!;
    const said = () => host.querySelector('.live')!.textContent;

    expect(a.getAttribute('aria-roledescription')).toBe('verschiebbar');
    expect(a.querySelector('span')!.getAttribute('aria-roledescription')).toBe('Griff');
    expect(host.querySelector('.instructions')!.textContent).toBe('Leertaste hebt an.');

    key(a, ' ');
    expect(said()).toBe('a aufgenommen. Element 1 von 3 in Liste.');
    key(a, 'ArrowDown');
    expect(said()).toBe('a auf b ablegen.');
    key(a, 'ArrowDown');
    expect(said()).toBe('a ist jetzt Element 2 von 3 in Liste.');
    key(a, 'ArrowUp');
    key(a, ' ');
    expect(said()).toBe('a auf b abgelegt.');

    // A key the catalogue leaves out is still said, in English.
    dnd.lift('a');
    flushSync();
    key(a, 'ArrowDown');
    key(a, 'ArrowDown');
    key(a, ' ');
    expect(said()).toBe('Dropped a. Item 2 of 3 in Liste.');
  });

  it('announces through an assertive region that is read whole', () => {
    board();
    const live = host.querySelector('.live')!;
    expect(live.getAttribute('role')).toBe('status');
    // Polite would read the position three arrow presses after the user left
    // it, which is worse than saying nothing.
    expect(live.getAttribute('aria-live')).toBe('assertive');
    expect(live.getAttribute('aria-atomic')).toBe('true');
  });

  it('names a handle and marks it as the thing that drags', () => {
    const handle = tree().node('.handle');
    expect(handle.hasAttribute(DRAG_HANDLE_ATTRIBUTE)).toBe(true);
    expect(handle.getAttribute('aria-label')).toBe('Reorder Work');
    expect(handle.getAttribute('aria-roledescription')).toBe('drag handle');
  });
});

describe('the keyboard drag', () => {
  it('lifts on Space and says where the item is', () => {
    const { item, said, dnd } = board();
    const kite = item('Kite');
    kite.focus();

    const event = key(kite, ' ');
    expect(dnd.isDragging()).toBe(true);
    expect(dnd.mode()).toBe('keyboard');
    // Space would otherwise scroll the list out from under the drag.
    expect(event.defaultPrevented).toBe(true);
    expect(said()).toBe('Picked up Kite. Item 1 of 3 in Todo.');
    expect(kite.hasAttribute('data-dragging')).toBe(true);
  });

  it('leaves Space alone when the item cannot be picked up', () => {
    const { item, dnd } = board();
    // `Sway` is disabled, and the host still wants Space for its own selection.
    const event = key(item('Sway'), ' ');
    expect(dnd.isDragging()).toBe(false);
    expect(event.defaultPrevented).toBe(false);
  });

  it('ignores a modified Space, which is a shortcut and not a lift', () => {
    const { item, dnd } = board();
    key(item('Kite'), ' ', { ctrlKey: true });
    expect(dnd.isDragging()).toBe(false);
  });

  it('moves one position per arrow press and reports the index after removal', () => {
    const { item, said, dnd } = board();
    const kite = item('Kite');
    key(kite, ' ');

    key(kite, 'ArrowDown');
    // Kite came out of the list first, so landing after Grace is index 1 —
    // the off-by-one every sortable list gets wrong.
    expect(dnd.target()).toMatchObject({ containerId: 'todo', itemId: 'Sway', position: 'before', index: 1 });
    expect(said()).toBe('Kite is now item 2 of 3 in Todo.');
  });

  it('counts positions over disabled items too', () => {
    const { item, dnd } = board();
    const kite = item('Kite');
    key(kite, ' ');
    key(kite, 'ArrowDown');
    key(kite, 'ArrowDown');

    // Sway is disabled: it cannot be picked up, but it still holds its place,
    // or the index would not be an index into the consumer's array.
    expect(dnd.target()?.index).toBe(2);
  });

  it('does not wrap at the ends', () => {
    const { item, dnd } = board();
    const kite = item('Kite');
    key(kite, ' ');
    key(kite, 'End');
    expect(dnd.target()?.index).toBe(2);

    key(kite, 'ArrowDown');
    // Wrapping would move the item the whole length of the list on a press
    // that promised one step.
    expect(dnd.target()?.index).toBe(2);

    key(kite, 'Home');
    expect(dnd.target()?.index).toBe(0);
    key(kite, 'ArrowUp');
    expect(dnd.target()?.index).toBe(0);
  });

  it('crosses to the connected collection sideways', () => {
    const { item, said, dnd } = board();
    const kite = item('Kite');
    key(kite, ' ');

    key(kite, 'ArrowRight');
    expect(dnd.target()).toMatchObject({ containerId: 'done', itemId: null, index: 0 });
    expect(said()).toBe('Kite is now item 1 of 1 in Done.');

    key(kite, 'ArrowLeft');
    expect(dnd.target()?.containerId).toBe('todo');
  });

  it('swaps the sideways keys under dir="rtl"', () => {
    const { item, dnd } = board();
    host.setAttribute('dir', 'rtl');
    const kite = item('Kite');
    key(kite, ' ');

    key(kite, 'ArrowLeft');
    expect(dnd.target()?.containerId).toBe('done');
    host.removeAttribute('dir');
  });

  it('drops on Space, reports it once, and puts the item where it said', async () => {
    const view = board();
    const kite = view.item('Kite');
    key(kite, ' ');
    key(kite, 'ArrowDown');
    key(kite, ' ');

    expect(drops).toHaveLength(1);
    expect(drops[0]).toMatchObject({ mode: 'keyboard' });
    expect(drops[0]!.target.index).toBe(1);
    expect(ends).toEqual(['drop']);
    expect(view.todo()).toEqual(['Grace', 'Kite', 'Sway']);
    expect(view.said()).toBe('Dropped Kite. Item 2 of 3 in Todo.');
    expect(view.dnd.isDragging()).toBe(false);

    await settle();
  });

  it('follows the item to its new place with focus', async () => {
    const view = board();
    const kite = view.item('Kite');
    kite.focus();
    key(kite, ' ');
    key(kite, 'ArrowDown');
    key(kite, ' ');
    await settle();

    // The element the drag started on may not have survived the re-render, so
    // the item is found again by id.
    expect(document.activeElement?.getAttribute(DRAG_ITEM_ATTRIBUTE)).toBe('Kite');
    expect(view.todo()).toEqual(['Grace', 'Kite', 'Sway']);
  });

  it('cancels on Escape and puts nothing anywhere', () => {
    const view = board();
    const kite = view.item('Kite');
    key(kite, ' ');
    key(kite, 'ArrowDown');
    key(kite, 'Escape');

    expect(drops).toHaveLength(0);
    expect(ends).toEqual(['cancel']);
    expect(view.todo()).toEqual(['Kite', 'Grace', 'Sway']);
    expect(view.said()).toBe('Cancelled. Kite is back where it started.');
    expect(view.dnd.target()).toBeNull();
  });

  it('keeps Escape away from the layer the list is inside', () => {
    const { item, dnd } = board();
    const kite = item('Kite');
    key(kite, ' ');

    const seen: string[] = [];
    // Dismissal listens exactly like this: on the document, and capturing.
    const dismissal = () => seen.push('dismissed');
    document.addEventListener('keydown', dismissal, true);
    key(kite, 'Escape');

    document.removeEventListener('keydown', dismissal, true);
    // One press cancels the drag. It must not also close the dialog around it
    // and leave the drag running underneath.
    expect(seen).toEqual([]);
    expect(dnd.isDragging()).toBe(false);
  });

  it('swallows Tab rather than leaving a lifted item behind', () => {
    const { item, dnd } = board();
    const kite = item('Kite');
    key(kite, ' ');
    const event = key(kite, 'Tab');

    expect(event.defaultPrevented).toBe(true);
    expect(dnd.isDragging()).toBe(true);
  });

  it('ends a keyboard drag when the user reaches for the pointer', () => {
    const { item, dnd } = board();
    const kite = item('Kite');
    key(kite, ' ');

    // There is no pointer to let go of, so a press anywhere puts the item down.
    // The alternative is an item left lifted with nothing able to drop it.
    pointer('pointerdown', document.body, 400, 400);
    expect(dnd.isDragging()).toBe(false);
    expect(ends).toEqual(['cancel']);
    expect(drops).toHaveLength(0);
  });

  it('refuses to lift what it cannot find or cannot move', () => {
    const { item, dnd } = board();
    expect(dnd.lift('Nothing')).toBe(false);
    expect(dnd.lift(item('Sway'))).toBe(false);
    expect(dnd.lift(null)).toBe(false);
    expect(dnd.isDragging()).toBe(false);
  });

  it('reports every target change, and the drop that follows, once each', () => {
    const seen: (string | null)[] = [];
    const { item } = board({ onDragOver: (target) => seen.push(target?.itemId ?? null) });
    const kite = item('Kite');

    key(kite, ' ');
    key(kite, 'ArrowDown');
    // Pressing into the end of the list twice changes nothing, and must not be
    // announced twice either.
    key(kite, 'End');
    key(kite, 'End');
    key(kite, ' ');

    expect(seen).toEqual(['Grace', 'Sway', 'Sway']);
  });

  it('marks the target for the drop indicator, before and after', () => {
    const { item, list, dnd } = board();
    const kite = item('Kite');
    key(kite, ' ');
    key(kite, 'ArrowDown');

    expect(item('Sway').getAttribute('data-drop-position')).toBe('before');
    expect(item('Grace').hasAttribute('data-drop-position')).toBe(false);
    expect(list('todo').hasAttribute('data-drop-target')).toBe(true);

    key(kite, 'End');
    expect(item('Sway').getAttribute('data-drop-position')).toBe('after');
    expect(dnd.indicator()).toMatchObject({ position: 'after', y: 150, width: 100, height: 0 });
  });
});

describe('dropping onto an item', () => {
  it('offers on as a step of its own between before and after', () => {
    const { dnd, node, said } = tree();
    const notes = node('.leaf');

    // Notes lives in the nested collection; sideways moves it out to the list
    // that collection sits in.
    dnd.lift(notes);
    key(notes, 'ArrowLeft');
    expect(dnd.target()?.containerId).toBe('root');

    const seen: string[] = [];
    for (let i = 0; i < 5; i++) {
      const target = dnd.target();
      seen.push(`${target?.itemId}:${target?.position}`);
      if (i < 4) key(notes, 'ArrowDown');
    }

    // Re-parenting needs a step of its own, or the only way to say "into this
    // folder" would be a pointer.
    expect(seen).toEqual(['work:before', 'work:on', 'home:before', 'home:on', 'home:after']);

    key(notes, 'ArrowUp');
    expect(said()).toBe('Drop Notes on Home.');
  });

  it('reports an on drop with no index, because nothing was inserted', () => {
    const { dnd, node } = tree();
    const notes = node('.leaf');

    dnd.lift(notes);
    key(notes, 'ArrowLeft');
    key(notes, 'ArrowDown');
    key(notes, 'ArrowDown');
    key(notes, 'ArrowDown');
    key(notes, ' ');

    expect(drops[0]!.target).toMatchObject({
      containerId: 'root',
      itemId: 'home',
      position: 'on',
      index: -1,
    });
  });

  it('refuses to drop a node into its own subtree', () => {
    const { dnd, node } = tree();
    const work = node('.folder');
    dnd.lift(work);

    const reachable = new Set<string | null>();
    for (let i = 0; i < 8; i++) {
      reachable.add(dnd.target()?.containerId ?? null);
      key(work, 'ArrowDown');
      key(work, 'ArrowRight');
    }

    // Losing a subtree into itself is the classic way to lose a subtree.
    expect(reachable.has('work-children')).toBe(false);
    expect(reachable).toContain('root');
  });
});

describe('a collection that hides some of its items', () => {
  /** Four items, the first of them kept in the DOM but not displayed. */
  @Component({
    selector: 'v-filtered',
    render: compileTemplate(`
      <div :ref="root" :keydown="dnd.onKeyDown($event)">
        <ul class="list" :spread="dnd.containerProps({ id: 'list', label: 'List' })">
          <li :for="item in items.get()" :key="item" tabindex="0"
              :style="{ display: item === 'a' ? 'none' : undefined }"
              :spread="dnd.itemProps({ id: item })">{ item }</li>
        </ul>
        <div class="live" :spread="dnd.liveRegionProps()">{ dnd.announcement() }</div>
      </div>
    `),
  })
  class Filtered {
    root = new Signal.State<Element | null>(null);
    items = new Signal.State(['a', 'b', 'c', 'd']);
    dnd = createDragDrop({ root: () => this.root.get(), onDrop: (event) => drops.push(event) });
  }

  it('counts the hidden items in the target index, as it does in the source index', () => {
    const handle = track(mount(Filtered, host));
    flushSync();
    const dnd = (handle.instance as Filtered).dnd;
    const c = host.querySelector<HTMLElement>(`[${DRAG_ITEM_ATTRIBUTE}="c"]`)!;
    const said = () => host.querySelector('.live')!.textContent;

    key(c, ' ');
    // c is third in the array, whatever is showing, and a lift starts in the
    // gap it already occupies — so dropping straight away changes nothing.
    expect(dnd.source()?.index).toBe(2);
    expect(dnd.target()).toMatchObject({ itemId: 'd', position: 'before', index: 2 });
    // What is said counts what a reader can see: b, c and d.
    expect(said()).toBe('Picked up c. Item 2 of 3 in List.');

    key(c, 'ArrowUp');
    expect(dnd.target()).toMatchObject({ itemId: 'b', position: 'before', index: 1 });
    expect(said()).toBe('c is now item 1 of 3 in List.');

    // `splice(2, 1)` then `splice(1, 0, c)`: before b, which is where the line
    // was drawn, and still after the hidden a.
    key(c, ' ');
    expect(drops[0]!.source.index).toBe(2);
    expect(drops[0]!.target.index).toBe(1);
  });
});

describe('validation and refusal', () => {
  it('skips rejected positions with the arrows rather than stopping on them', () => {
    const { item, dnd } = board({
      // Nothing may go last.
      canDrop: (target: DropTarget) => !(target.containerId === 'todo' && target.index === 2),
    });
    const kite = item('Kite');
    key(kite, ' ');
    key(kite, 'End');

    expect(dnd.target()?.index).toBe(1);
  });

  it('will not lift an item canDrag refuses', () => {
    const { item, dnd } = board({ canDrag: () => false });
    key(item('Kite'), ' ');
    expect(dnd.isDragging()).toBe(false);
  });

  it('locks nothing when the drag it refused never started', () => {
    const { item, dnd } = board({ canDrag: () => false });
    const kite = item('Kite');
    startPointerDrag(kite, 50, 25);

    expect(dnd.isDragging()).toBe(false);
    // A refused drag has no end to undo anything at, so it must take nothing:
    // otherwise the page stays unselectable for the rest of the session.
    expect(document.body.style.userSelect).not.toBe('none');
    expect(kite.hasPointerCapture(1)).toBe(false);
  });

  it('turns a drop with nowhere to go into a cancel', () => {
    const { item, dnd } = board({ canDrop: () => false });
    const kite = item('Kite');
    key(kite, ' ');

    expect(dnd.target()).toBeNull();
    expect(key(kite, ' ')).toBeTruthy();
    expect(drops).toHaveLength(0);
    expect(ends).toEqual(['cancel']);
  });

  it('says so when there is nowhere to drop', () => {
    const view = board({ canDrop: (target: DropTarget) => target.containerId !== 'done' });
    const kite = view.item('Kite');
    key(kite, ' ');
    key(kite, 'ArrowRight');
    // The move is refused, so the target stays put rather than going quiet.
    expect(view.dnd.target()?.containerId).toBe('todo');
  });

  it('skips a collection that takes no drops', () => {
    @Component({
      selector: 'v-locked',
      render: compileTemplate(
        `<div :ref="root" :keydown="dnd.onKeyDown($event)">` +
          `<ul :spread="dnd.containerProps({ id: 'a' })">` +
          `<li tabindex="0" :spread="dnd.itemProps({ id: 'x' })">x</li></ul>` +
          `<ul :spread="dnd.containerProps({ id: 'b', dropDisabled: true })">` +
          `<li tabindex="0" :spread="dnd.itemProps({ id: 'y' })">y</li></ul></div>`,
      ),
    })
    class Locked {
      root = new Signal.State<Element | null>(null);
      dnd = createDragDrop({ root: () => this.root.get() });
    }

    const handle = track(mount(Locked, host));
    flushSync();
    const dnd = (handle.instance as Locked).dnd;
    const x = host.querySelector<HTMLElement>('li')!;

    dnd.lift(x);
    key(x, 'ArrowRight');
    flushSync();
    expect(dnd.target()?.containerId).toBe('a');
  });
});

describe('the pointer drag', () => {
  it('waits for travel before treating a press as a drag', () => {
    const { item, dnd } = board();
    const kite = item('Kite');

    pointer('pointerdown', kite, 50, 25);
    pointer('pointermove', kite, 51, 26);
    // A click is a press that moved a pixel; starting a drag on it makes every
    // list item impossible to click.
    expect(dnd.isDragging()).toBe(false);

    pointer('pointermove', kite, 50, 40);
    expect(dnd.isDragging()).toBe(true);
    expect(dnd.mode()).toBe('pointer');
  });

  it('ignores the secondary button and a second finger', () => {
    const { item, dnd } = board();
    const kite = item('Kite');

    startPointerDrag(kite, 50, 25, { button: 2 });
    expect(dnd.isDragging()).toBe(false);

    startPointerDrag(kite, 50, 25, { isPrimary: false, pointerId: 7 });
    expect(dnd.isDragging()).toBe(false);
  });

  it('captures the pointer so the drag survives leaving the handle', () => {
    const { item } = board();
    const kite = item('Kite');
    startPointerDrag(kite, 50, 25);
    expect(kite.hasPointerCapture(1)).toBe(true);

    pointer('pointerup', kite, 50, 25);
    expect(kite.hasPointerCapture(1)).toBe(false);
  });

  it('only drags from the handle when the item declares one', () => {
    const { dnd, node } = tree();

    startPointerDrag(node('.folder'), 50, 10);
    // The rest of the row stays available for selection, links and buttons.
    expect(dnd.isDragging()).toBe(false);

    startPointerDrag(node('.handle'), 50, 10);
    expect(dnd.isDragging()).toBe(true);
  });

  it('resolves the half of the row the pointer is in', () => {
    const { item, dnd } = board();
    const kite = item('Kite');
    startPointerDrag(kite, 50, 25);

    // Grace occupies y 50..100.
    pointer('pointermove', kite, 50, 60);
    expect(dnd.target()).toMatchObject({ itemId: 'Grace', position: 'before', index: 0 });

    pointer('pointermove', kite, 50, 90);
    expect(dnd.target()).toMatchObject({ itemId: 'Grace', position: 'after', index: 1 });
  });

  it('gives an item that takes children its middle half', () => {
    const { dnd, node } = tree();
    const notes = node('.leaf');
    // Home is the second row of the root list, y 50..100, so its first
    // quarter ends at 62.5 and its last begins at 87.5.
    startPointerDrag(notes, 150, 10);

    pointer('pointermove', notes, 50, 55);
    expect(dnd.target()).toMatchObject({ itemId: 'home', position: 'before' });

    pointer('pointermove', notes, 50, 65);
    expect(dnd.target()).toMatchObject({ itemId: 'home', position: 'on', index: -1 });

    pointer('pointermove', notes, 50, 85);
    expect(dnd.target()).toMatchObject({ itemId: 'home', position: 'on', index: -1 });

    pointer('pointermove', notes, 50, 95);
    expect(dnd.target()).toMatchObject({ itemId: 'home', position: 'after' });
  });

  it('takes a different share for on when asked to', () => {
    const { dnd, node } = tree({ onZoneRatio: 1 / 3 });
    const notes = node('.leaf');
    startPointerDrag(notes, 150, 10);

    // A third at each end now means before or after, so the points that were
    // on under the default are not.
    pointer('pointermove', notes, 50, 65);
    expect(dnd.target()).toMatchObject({ itemId: 'home', position: 'before' });

    pointer('pointermove', notes, 50, 75);
    expect(dnd.target()).toMatchObject({ itemId: 'home', position: 'on' });

    pointer('pointermove', notes, 50, 85);
    expect(dnd.target()).toMatchObject({ itemId: 'home', position: 'after' });
  });

  it('draws a highlight over the whole item for an on drop, not a line', () => {
    const { dnd, node } = tree();
    const notes = node('.leaf');

    startPointerDrag(notes, 150, 10);
    pointer('pointermove', notes, 50, 75);
    expect(dnd.indicator()).toMatchObject({ position: 'on', x: 0, y: 50, width: 100, height: 50 });

    pointer('pointermove', notes, 50, 55);
    // An insertion line has no thickness of its own; the consumer decides how
    // it is drawn either side of that edge.
    expect(dnd.indicator()).toMatchObject({ position: 'before', y: 50, height: 0 });
  });

  it('announces what a pointer drag is doing too', () => {
    const view = board();
    const kite = view.item('Kite');
    startPointerDrag(kite, 50, 25);
    // A screen reader user with a pointer, a trackpad or a head mouse gets the
    // same commentary a keyboard drag does.
    expect(view.said()).toContain('Picked up Kite');

    pointer('pointermove', kite, 50, 90);
    expect(view.said()).toBe('Kite is now item 2 of 3 in Todo.');
  });

  it('forgets the offset once the drag is over', () => {
    const { item, dnd } = board();
    const kite = item('Kite');
    startPointerDrag(kite, 50, 25);
    pointer('pointermove', kite, 50, 80);
    expect(dnd.offset().y).toBe(55);

    pointer('pointerup', kite, 50, 80);
    // A stale offset would leave the row translated after it had been put back
    // into the list at its new index.
    expect(dnd.offset()).toEqual({ x: 0, y: 0 });
    expect(dnd.transformFor('Kite')).toBeUndefined();
  });

  it('carries an item into another collection', () => {
    const view = board();
    const kite = view.item('Kite');
    startPointerDrag(kite, 50, 25);

    // The Done list is the second column, and it is empty.
    pointer('pointermove', kite, 150, 40);
    expect(view.dnd.target()).toMatchObject({ containerId: 'done', itemId: null, index: 0 });

    pointer('pointerup', kite, 150, 40);
    expect(view.todo()).toEqual(['Grace', 'Sway']);
    expect(view.done()).toEqual(['Kite']);
  });

  it('treats a release over nothing as a cancel', () => {
    const view = board();
    const kite = view.item('Kite');
    startPointerDrag(kite, 50, 25);

    pointer('pointermove', kite, 500, 500);
    expect(view.dnd.target()).toBeNull();

    pointer('pointerup', kite, 500, 500);
    // The missing indicator was saying this: there was nowhere to put it.
    expect(drops).toHaveLength(0);
    expect(ends).toEqual(['cancel']);
    expect(view.todo()).toEqual(['Kite', 'Grace', 'Sway']);
  });

  it('cancels on Escape and on the platform taking the gesture away', () => {
    const view = board();
    let kite = view.item('Kite');
    startPointerDrag(kite, 50, 25);
    key(kite, 'Escape');
    expect(view.dnd.isDragging()).toBe(false);
    expect(ends).toEqual(['cancel']);

    kite = view.item('Kite');
    startPointerDrag(kite, 50, 25);
    pointer('pointercancel', kite, 50, 25);
    expect(view.dnd.isDragging()).toBe(false);
    expect(ends).toEqual(['cancel', 'cancel']);
  });

  it('leaves the arrows alone while the pointer is driving', () => {
    const view = board();
    const kite = view.item('Kite');
    startPointerDrag(kite, 50, 25);
    const before = view.dnd.target();

    key(kite, 'ArrowDown');
    // Two things moving one target at once is worse than either.
    expect(view.dnd.target()).toEqual(before);
  });

  it('stops the page selecting text under the drag, and puts it back', () => {
    const { item } = board();
    const kite = item('Kite');
    startPointerDrag(kite, 50, 25);
    expect(document.body.style.userSelect).toBe('none');

    pointer('pointerup', kite, 50, 25);
    expect(document.body.style.userSelect).not.toBe('none');
  });

  it('offsets only along the locked axis', () => {
    const { item, dnd } = board({ axis: 'y' });
    const kite = item('Kite');
    pointer('pointerdown', kite, 50, 25);
    pointer('pointermove', kite, 90, 65);

    expect(dnd.offset()).toEqual({ x: 0, y: 40 });
    expect(dnd.transformFor('Kite')).toBe('translate(0px, 40px)');
    expect(dnd.transformFor('Grace')).toBeUndefined();
    // The transform is what the documented `:style` binding spreads, and only
    // the dragged row gets one.
    expect(item('Kite').style.transform).toBe('translate(0px, 40px)');
    expect(item('Grace').style.transform).toBe('');
  });

  it('keeps the item inside its boundary', () => {
    const holder = document.createElement('div');
    host.append(holder);
    setRect(holder, 0, 0, 100, 200);

    const { item, dnd } = board({ boundary: () => holder });
    const kite = item('Kite');
    // Kite's box is y 0..50, so it can fall 150px and rise none.
    pointer('pointerdown', kite, 50, 25);
    pointer('pointermove', kite, 50, 925);
    expect(dnd.offset().y).toBe(150);

    pointer('pointermove', kite, 50, -75);
    expect(dnd.offset().y).toBe(0);
  });
});

describe('touch', () => {
  it('does not drag until the press has been held', () => {
    vi.useFakeTimers();
    const { item, dnd } = board({ touchDelay: 250 });
    const kite = item('Kite');

    pointer('pointerdown', kite, 50, 25, { pointerType: 'touch' });
    vi.advanceTimersByTime(200);
    flushSync();
    expect(dnd.isDragging()).toBe(false);

    vi.advanceTimersByTime(60);
    flushSync();
    expect(dnd.isDragging()).toBe(true);
  });

  it('gives the gesture up to a scroll', () => {
    vi.useFakeTimers();
    const { item, dnd } = board({ touchDelay: 250, touchTolerance: 5 });
    const kite = item('Kite');

    pointer('pointerdown', kite, 50, 25, { pointerType: 'touch' });
    // A finger that travels during the hold was scrolling the list, not
    // pulling a row out of it.
    pointer('pointermove', kite, 50, 60, { pointerType: 'touch' });
    vi.advanceTimersByTime(400);
    flushSync();

    expect(dnd.isDragging()).toBe(false);
  });

  it('drags a finger that stayed put', () => {
    vi.useFakeTimers();
    const { item, dnd } = board({ touchDelay: 250 });
    const kite = item('Kite');

    pointer('pointerdown', kite, 50, 25, { pointerType: 'touch' });
    pointer('pointermove', kite, 52, 27, { pointerType: 'touch' });
    vi.advanceTimersByTime(300);
    flushSync();
    expect(dnd.isDragging()).toBe(true);
  });
});

describe('auto-scroll', () => {
  function pane(options: Partial<DragDropOptions> = {}) {
    boardOptions = options;
    const handle = track(mount(Pane, host));
    flushSync();

    const scroller = host.querySelector<HTMLElement>('.scroller')!;
    setRect(scroller, 0, 0, 100, 100);
    Object.defineProperty(scroller, 'scrollHeight', { value: 600, configurable: true });
    Object.defineProperty(scroller, 'clientHeight', { value: 100, configurable: true });
    layout();
    // The list is taller than its pane, which is the case worth scrolling.
    setRect(host.querySelector('.list')!, 0, 0, 100, 600);

    return { scroller, dnd: (handle.instance as Pane).dnd, item: () => host.querySelector('li')! };
  }

  it('scrolls the nearest scrollable ancestor near its edge', async () => {
    const { scroller, item } = pane({ autoScrollThreshold: 30, autoScrollSpeed: 10 });
    startPointerDrag(item(), 50, 10);

    pointer('pointermove', item(), 50, 95);
    await frames(2);
    expect(scroller.scrollTop).toBeGreaterThan(0);
  });

  it('stays still away from the edges, and stops when the drag ends', async () => {
    const { scroller, item } = pane({ autoScrollThreshold: 30, autoScrollSpeed: 10 });
    startPointerDrag(item(), 50, 10);

    pointer('pointermove', item(), 50, 50);
    await frames(2);
    expect(scroller.scrollTop).toBe(0);

    pointer('pointermove', item(), 50, 95);
    await frames(2);
    const scrolled = scroller.scrollTop;
    expect(scrolled).toBeGreaterThan(0);

    pointer('pointerup', item(), 50, 95);
    await frames(2);
    expect(scroller.scrollTop).toBe(scrolled);
  });

  it('can be turned off', async () => {
    const { scroller, item } = pane({ autoScroll: false });
    startPointerDrag(item(), 50, 10);
    pointer('pointermove', item(), 50, 99);
    await frames(2);
    expect(scroller.scrollTop).toBe(0);
  });

  it('scrolls the page near the bottom of the window, not of the document', async () => {
    const { item } = board({ autoScrollThreshold: 30, autoScrollSpeed: 10 });
    // Nothing around the lists scrolls, so the page does: a window 600 tall
    // over a document of 3000, whose root element's box runs far below it.
    const page = document.documentElement;
    const stubbed = ['scrollHeight', 'clientHeight', 'clientWidth', 'getBoundingClientRect'];
    Object.defineProperty(page, 'scrollHeight', { value: 3000, configurable: true });
    Object.defineProperty(page, 'clientHeight', { value: 600, configurable: true });
    Object.defineProperty(page, 'clientWidth', { value: 800, configurable: true });
    setRect(page, 0, 0, 800, 3000);

    try {
      const kite = item('Kite');
      startPointerDrag(kite, 50, 25);
      pointer('pointermove', kite, 50, 590);
      await frames(2);
      expect(page.scrollTop).toBeGreaterThan(0);
    } finally {
      pointer('pointerup', item('Kite'), 50, 590);
      for (const name of stubbed) delete (page as unknown as Record<string, unknown>)[name];
      page.scrollTop = 0;
    }
  });

  it('brings the target of a keyboard drag into view, which no pointer is there to do', () => {
    const { dnd } = pane();
    const items = [...host.querySelectorAll<HTMLElement>('li')];
    const revealed: [string | null, ScrollIntoViewOptions][] = [];
    for (const el of items) {
      el.scrollIntoView = (options) => {
        revealed.push([el.textContent, options as ScrollIntoViewOptions]);
      };
    }

    key(items[0]!, ' ');
    // Lifted where it already is, which is where the reader is looking.
    expect(revealed).toEqual([]);

    key(items[0]!, 'ArrowDown');
    expect(dnd.target()).toMatchObject({ itemId: 'three', position: 'before' });
    key(items[0]!, 'End');
    expect(dnd.target()).toMatchObject({ itemId: 'three', position: 'after' });

    // The smallest scroll that shows it, so a target already on screen moves
    // nothing.
    const nearest = { block: 'nearest', inline: 'nearest' };
    expect(revealed).toEqual([
      ['three', nearest],
      ['three', nearest],
    ]);
  });

  it('leaves the scrolling of a pointer drag to the pointer', () => {
    const { item } = pane();
    const revealed = vi.fn();
    for (const el of host.querySelectorAll<HTMLElement>('li')) el.scrollIntoView = revealed;

    startPointerDrag(item(), 50, 10);
    pointer('pointermove', item(), 50, 120);
    expect(revealed).not.toHaveBeenCalled();
  });
});

describe('a collection that runs across', () => {
  @Component({
    selector: 'v-tabs',
    render: compileTemplate(`
      <div :ref="root"
           :pointerdown="dnd.onPointerDown($event)"
           :keydown="dnd.onKeyDown($event)">
        <div class="strip" :spread="dnd.containerProps({ id: 'tabs', label: 'Tabs' })">
          <button :for="tab in tabs.get()" :key="tab" :spread="dnd.itemProps({ id: tab })">{ tab }</button>
        </div>
      </div>
    `),
  })
  class Tabs {
    root = new Signal.State<Element | null>(null);
    tabs = new Signal.State(['one', 'two', 'three']);
    dnd = createDragDrop({
      root: () => this.root.get(),
      orientation: 'horizontal',
      onDrop: (event) => drops.push(event),
    });
  }

  function tabs() {
    const handle = track(mount(Tabs, host));
    flushSync();
    const strip = host.querySelector('.strip')!;
    setRect(strip, 0, 0, 300, 40);
    [...strip.children].forEach((tab, i) => setRect(tab, i * 100, 0, 100, 40));
    return {
      dnd: (handle.instance as Tabs).dnd,
      tab: (id: string) => host.querySelector<HTMLElement>(`[${DRAG_ITEM_ATTRIBUTE}="${id}"]`)!,
    };
  }

  it('splits a tab left and right rather than top and bottom', () => {
    const { dnd, tab } = tabs();
    const one = tab('one');
    startPointerDrag(one, 10, 20);

    // `two` runs from x 100 to x 200.
    pointer('pointermove', one, 120, 20);
    expect(dnd.target()).toMatchObject({ itemId: 'two', position: 'before', index: 0 });

    pointer('pointermove', one, 180, 20);
    expect(dnd.target()).toMatchObject({ itemId: 'two', position: 'after', index: 1 });
    expect(dnd.indicator()).toMatchObject({ x: 200, y: 0, width: 0, height: 40 });
  });

  it('moves along the strip with the horizontal arrows', () => {
    const { dnd, tab } = tabs();
    const one = tab('one');
    dnd.lift(one);

    key(one, 'ArrowRight');
    expect(dnd.target()?.index).toBe(1);
    // Down would move to another strip, and there is only this one.
    key(one, 'ArrowDown');
    expect(dnd.target()?.index).toBe(1);

    key(one, 'ArrowLeft');
    expect(dnd.target()?.index).toBe(0);
  });
});

describe('where focus lands', () => {
  it('can be left exactly where the user put it', async () => {
    const view = board({ restoreFocus: 'none' });
    const kite = view.item('Kite');
    kite.focus();
    key(kite, ' ');
    key(kite, 'ArrowDown');
    key(kite, ' ');
    await settle();

    // The moved row was re-rendered elsewhere, so focus fell to the body and
    // was deliberately left there.
    expect(document.activeElement?.getAttribute(DRAG_ITEM_ATTRIBUTE)).not.toBe('Kite');
  });

  it('falls back to the collection when the item did not survive', async () => {
    const view = board({ restoreFocus: 'container' });
    const kite = view.item('Kite');
    kite.focus();
    key(kite, ' ');
    key(kite, ' ');
    await settle();

    expect(document.activeElement).toBe(view.list('todo'));
    // A list is not focusable on its own, so `focus()` alone would have done
    // nothing at all in a real browser.
    expect(view.list('todo').getAttribute('tabindex')).toBe('-1');
  });
});

describe('a target owned from outside', () => {
  it('takes the drop from the signal it was given', () => {
    const target = new Signal.State<DropTarget | null>(null);
    const view = board({ target });
    const kite = view.item('Kite');
    key(kite, ' ');

    // A tree that has just auto-expanded a folder redirects the drop like this.
    target.set({ containerId: 'done', itemId: null, position: 'before', index: 0 });
    flushSync();
    expect(view.dnd.target()?.containerId).toBe('done');

    key(kite, ' ');
    expect(drops[0]!.target.containerId).toBe('done');
    expect(view.done()).toEqual(['Kite']);
  });
});

describe('teardown', () => {
  it('lets go of the page when unmounted mid-drag', () => {
    const { item, handle } = board();
    const kite = item('Kite');
    startPointerDrag(kite, 50, 25);
    expect(document.body.style.userSelect).toBe('none');

    handle.unmount();
    flushSync();

    expect(document.body.style.userSelect).not.toBe('none');
    expect(kite.hasPointerCapture(1)).toBe(false);
    // The window listener has to go with it, or the next Escape anywhere on the
    // page is swallowed by a drag nobody can see.
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    document.body.dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(false);
  });
});
