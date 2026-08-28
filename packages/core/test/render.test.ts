/**
 * End-to-end: template source -> compiler -> DOM runtime -> real nodes,
 * driven through the public component API.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { compileTemplate } from '@voltdev/core/jit';
import { Component, Prop, Signal, effect, flushSync, mount, onCleanup,
  needsHydration,
} from '@voltdev/core';

let host: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  host = document.querySelector('#app')!;
});

/** Mount, returning the host's HTML for convenient assertions. */
function render(component: Parameters<typeof mount>[0]) {
  const handle = mount(component, host);
  return {
    handle,
    get html() {
      return host.innerHTML;
    },
    click(selector: string) {
      host.querySelector<HTMLElement>(selector)!.click();
      flushSync();
    },
  };
}

describe('static templates', () => {
  it('renders plain markup', () => {
    @Component({ selector: 'v-static', render: compileTemplate(`<h1 class="title">Hello</h1>`) })
    class Static {}

    expect(render(Static).html).toBe('<h1 class="title">Hello</h1>');
  });

  it('renders nested elements and collapses insignificant whitespace', () => {
    @Component({
      selector: 'v-nested',
      render: compileTemplate(`
        <div class="card">
          <h2>Title</h2>
          <p>Body</p>
        </div>
      `),
    })
    class Nested {}

    expect(render(Nested).html).toBe('<div class="card"><h2>Title</h2><p>Body</p></div>');
  });
});

describe('interpolation', () => {
  it('renders a signal and updates it in place', () => {
    @Component({ selector: 'v-count', render: compileTemplate(`<span>{ count.get() }</span>`) })
    class Counter {
      count = new Signal.State(1);
    }

    const view = render(Counter);
    expect(view.html).toBe('<span>1</span>');

    const instance = view.handle.instance as Counter;
    const textNode = host.querySelector('span')!.firstChild;

    instance.count.set(2);
    flushSync();
    expect(view.html).toBe('<span>2</span>');
    // The text node is patched, not replaced.
    expect(host.querySelector('span')!.firstChild).toBe(textNode);
  });

  it('folds a constant expression into the markup at build time', () => {
    @Component({ selector: 'v-const', render: compileTemplate(`<span>{ 2 + 3 }</span>`) })
    class Constant {}

    expect(render(Constant).html).toBe('<span>5</span>');
  });

  it('mixes static text with dynamic parts', () => {
    @Component({
      selector: 'v-mixed',
      render: compileTemplate(`<p>Hello, { name.get() }! You have { count.get() } messages.</p>`),
    })
    class Mixed {
      name = new Signal.State('Ada');
      count = new Signal.State(3);
    }

    const view = render(Mixed);
    expect(view.html).toBe('<p>Hello, Ada! You have 3 messages.</p>');

    (view.handle.instance as Mixed).count.set(4);
    flushSync();
    expect(view.html).toBe('<p>Hello, Ada! You have 4 messages.</p>');
  });
});

describe('bindings', () => {
  it('binds properties and drops falsy boolean attributes', () => {
    @Component({
      selector: 'v-bind',
      render: compileTemplate(`<input :value="text.get()" :disabled="off.get()">`),
    })
    class Bound {
      text = new Signal.State('hi');
      off = new Signal.State(false);
    }

    const view = render(Bound);
    const input = host.querySelector('input')!;
    expect(input.value).toBe('hi');
    expect(input.disabled).toBe(false);

    (view.handle.instance as Bound).off.set(true);
    flushSync();
    expect(input.disabled).toBe(true);
  });

  it('merges a dynamic class without discarding static classes', () => {
    @Component({
      selector: 'v-class',
      render: compileTemplate(`<div class="base" :class="{ active: on.get() }"></div>`),
    })
    class Classed {
      on = new Signal.State(false);
    }

    const view = render(Classed);
    const div = host.querySelector('div')!;
    expect(div.className).toBe('base');

    (view.handle.instance as Classed).on.set(true);
    flushSync();
    expect(div.classList.contains('base')).toBe(true);
    expect(div.classList.contains('active')).toBe(true);

    (view.handle.instance as Classed).on.set(false);
    flushSync();
    expect(div.classList.contains('base')).toBe(true);
    expect(div.classList.contains('active')).toBe(false);
  });

  it('binds styles from an object', () => {
    @Component({
      selector: 'v-style',
      render: compileTemplate(`<div :style="{ color: color.get(), fontWeight: 'bold' }"></div>`),
    })
    class Styled {
      color = new Signal.State('red');
    }

    const view = render(Styled);
    const div = host.querySelector('div')!;
    expect(div.style.color).toBe('red');
    expect(div.style.fontWeight).toBe('bold');

    (view.handle.instance as Styled).color.set('blue');
    flushSync();
    expect(div.style.color).toBe('blue');
  });

  it('hides an element with :style without removing it', () => {
    // There is no `:show` directive — toggling display is a style binding,
    // and an empty string lets the stylesheet decide the visible value.
    @Component({
      selector: 'v-show',
      render: compileTemplate(
        `<div :style="{ display: visible.get() ? '' : 'none' }">x</div>`,
      ),
    })
    class Shown {
      visible = new Signal.State(true);
    }

    const view = render(Shown);
    const div = host.querySelector('div')!;
    expect(div.style.display).toBe('');

    (view.handle.instance as Shown).visible.set(false);
    flushSync();
    expect(div.style.display).toBe('none');
    expect(host.querySelector('div')).toBe(div);
  });
});

describe('events', () => {
  it('handles :click as an inline statement', () => {
    @Component({
      selector: 'v-click',
      render: compileTemplate(`<button :click="inc()">{ count.get() }</button>`),
    })
    class Clicker {
      count = new Signal.State(0);
      inc() {
        this.count.set(this.count.get() + 1);
      }
    }

    const view = render(Clicker);
    expect(view.html).toBe('<button>0</button>');
    view.click('button');
    expect(view.html).toBe('<button>1</button>');
  });

  it('passes $event to inline handlers', () => {
    const seen: string[] = [];

    @Component({
      selector: 'v-event',
      render: compileTemplate(`<button :click="record($event.type)"></button>`),
    })
    class Recorder {
      record(type: string) {
        seen.push(type);
      }
    }

    render(Recorder).click('button');
    expect(seen).toEqual(['click']);
  });

  it('applies event modifiers', () => {
    const inner = vi.fn();
    const outer = vi.fn();

    @Component({
      selector: 'v-modifiers',
      render: compileTemplate(`
        <div :click="outer()">
          <button :click.stop="inner()"></button>
        </div>
      `),
    })
    class Modified {
      inner = inner;
      outer = outer;
    }

    render(Modified).click('button');
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
  });

  it('removes listeners when the component unmounts', () => {
    const spy = vi.fn();

    @Component({ selector: 'v-cleanup', render: compileTemplate(`<button :click="spy()"></button>`) })
    class Cleanup {
      spy = spy;
    }

    const view = render(Cleanup);
    const button = host.querySelector('button')!;
    view.handle.unmount();

    button.click();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe(':if', () => {
  it('renders and swaps branches', () => {
    @Component({
      selector: 'v-if',
      render: compileTemplate(`
        <div>
          <span :if="value.get() > 5">big</span>
          <span :else-if="value.get() > 0">small</span>
          <span :else>none</span>
        </div>
      `),
    })
    class Conditional {
      value = new Signal.State(10);
    }

    const view = render(Conditional);
    const instance = view.handle.instance as Conditional;
    expect(view.html).toContain('big');

    instance.value.set(3);
    flushSync();
    expect(view.html).toContain('small');
    expect(view.html).not.toContain('big');

    instance.value.set(-1);
    flushSync();
    expect(view.html).toContain('none');
  });

  it('disposes the effects of a branch it leaves', () => {
    const cleanup = vi.fn();

    @Component({ selector: 'v-child', render: compileTemplate(`<span>{ label.get() }</span>`) })
    class Child {
      @Prop() label = new Signal.State('x');
      // Teardown sits beside the setup it undoes.
      #cleanup = onCleanup(cleanup);
    }

    @Component({
      selector: 'v-parent',
      render: compileTemplate(`<div><v-child :if="show.get()"></v-child></div>`),
      imports: [Child],
    })
    class Parent {
      show = new Signal.State(true);
    }

    const view = render(Parent);
    expect(cleanup).not.toHaveBeenCalled();

    (view.handle.instance as Parent).show.set(false);
    flushSync();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});

describe(':for', () => {
  it('renders a list and keeps keyed rows on reorder', () => {
    @Component({
      selector: 'v-list',
      render: compileTemplate(`
        <ul>
          <li :for="item in items.get()" :key="item.id">{ item.text }</li>
        </ul>
      `),
    })
    class List {
      items = new Signal.State([
        { id: 1, text: 'a' },
        { id: 2, text: 'b' },
        { id: 3, text: 'c' },
      ]);
    }

    const view = render(List);
    expect(host.querySelectorAll('li')).toHaveLength(3);
    expect(view.html).toContain('<li>a</li><li>b</li><li>c</li>');

    const [first, second, third] = [...host.querySelectorAll('li')];

    // Reverse: the same three elements must be reused, just reordered.
    (view.handle.instance as List).items.set([
      { id: 3, text: 'c' },
      { id: 2, text: 'b' },
      { id: 1, text: 'a' },
    ]);
    flushSync();

    const reordered = [...host.querySelectorAll('li')];
    expect(reordered).toEqual([third, second, first]);
    expect(view.html).toContain('<li>c</li><li>b</li><li>a</li>');
  });

  it('exposes a reactive index', () => {
    @Component({
      selector: 'v-indexed',
      render: compileTemplate(`<ul><li :for="(item, i) in items.get()" :key="item">{ i }:{ item }</li></ul>`),
    })
    class Indexed {
      items = new Signal.State(['a', 'b']);
    }

    const view = render(Indexed);
    expect(view.html).toContain('<li>0:a</li><li>1:b</li>');

    // 'a' moves to index 1; its row is reused but the index binding updates.
    (view.handle.instance as Indexed).items.set(['b', 'a']);
    flushSync();
    expect(view.html).toContain('<li>0:b</li><li>1:a</li>');
  });

  it('adds and removes rows', () => {
    @Component({
      selector: 'v-grow',
      render: compileTemplate(`<ul><li :for="n in items.get()" :key="n">{ n }</li></ul>`),
    })
    class Grow {
      items = new Signal.State([1, 2]);
    }

    const view = render(Grow);
    const instance = view.handle.instance as Grow;

    instance.items.set([1, 2, 3]);
    flushSync();
    expect(host.querySelectorAll('li')).toHaveLength(3);

    instance.items.set([2]);
    flushSync();
    expect(host.querySelectorAll('li')).toHaveLength(1);
    expect(view.html).toContain('<li>2</li>');

    instance.items.set([]);
    flushSync();
    expect(host.querySelectorAll('li')).toHaveLength(0);
  });

  it('supports destructuring bindings', () => {
    @Component({
      selector: 'v-destructure',
      render: compileTemplate(`<ul><li :for="{ id, name } in rows.get()" :key="id">{ id }-{ name }</li></ul>`),
    })
    class Destructured {
      rows = new Signal.State([{ id: 1, name: 'one' }]);
    }

    expect(render(Destructured).html).toContain('<li>1-one</li>');
  });
});

describe('components', () => {
  it('passes inputs reactively and calls back through a callback prop', () => {
    @Component({
      selector: 'v-child',
      render: compileTemplate(`<button :click="bump()">{ label.get() }:{ n.get() }</button>`),
    })
    class Child {
      @Prop() label = new Signal.State('');
      @Prop() n = new Signal.State(0);
      // A component notifies its parent by calling a function it was given.
      @Prop() onBumped?: (value: number) => void;

      bump() {
        this.onBumped?.(this.n.get() + 1);
      }
    }

    @Component({
      selector: 'v-parent',
      render: compileTemplate(`
        <div>
          <v-child :label="'count'" :n="value.get()" :onBumped="(v) => onBump(v)"></v-child>
        </div>
      `),
      imports: [Child],
    })
    class Parent {
      value = new Signal.State(1);
      onBump(next: number) {
        this.value.set(next);
      }
    }

    const view = render(Parent);
    expect(view.html).toContain('count:1');

    view.click('button');
    expect(view.html).toContain('count:2');
  });

  it('keeps `this` correct when a callback prop is a bare method reference', () => {
    @Component({
      selector: 'v-child',
      render: compileTemplate(`<button :click="fire()">go</button>`),
    })
    class Child {
      @Prop() onPing?: (value: number) => void;
      fire() {
        this.onPing?.(1);
      }
    }

    @Component({
      selector: 'v-parent',
      imports: [Child],
      // No arrow — the natural thing to write. The method must still run with
      // the parent as `this`, not the child.
      render: compileTemplate(`<div><v-child :onPing="record"></v-child></div>`),
    })
    class Parent {
      seen: number[] = [];
      record(value: number) {
        this.seen.push(value);
      }
    }

    const view = render(Parent);
    view.click('button');
    expect((view.handle.instance as Parent).seen).toEqual([1]);
  });

  it('explains that :on-* does not apply to a component', () => {
    @Component({ selector: 'v-child', render: compileTemplate(`<span>x</span>`) })
    class Child {}

    @Component({
      selector: 'v-parent',
      imports: [Child],
      render: compileTemplate(`<div><v-child :on-bumped="noop()"></v-child></div>`),
    })
    class Parent {
      noop() {}
    }

    expect(() => render(Parent)).toThrow(/Pass a callback instead: `:onBumped/);
  });

  it('projects content into slots', () => {
    @Component({
      selector: 'v-card',
      render: compileTemplate(`
        <div class="card">
          <header><slot name="title">Untitled</slot></header>
          <main><slot></slot></main>
        </div>
      `),
    })
    class Card {}

    @Component({
      selector: 'v-page',
      render: compileTemplate(`
        <v-card>
          <h1 :slot="'title'">Hello</h1>
          <p>Body content</p>
        </v-card>
      `),
      imports: [Card],
    })
    class Page {}

    const html = render(Page).html;
    expect(html).toContain('<h1>Hello</h1>');
    expect(html).toContain('<p>Body content</p>');
  });

  it('falls back to slot content when nothing is projected', () => {
    @Component({
      selector: 'v-card',
      render: compileTemplate(`<div><slot name="title">Untitled</slot></div>`),
    })
    class Card {}

    @Component({ selector: 'v-page', render: compileTemplate(`<v-card></v-card>`), imports: [Card] })
    class Page {}

    expect(render(Page).html).toContain('Untitled');
  });
});

describe('lifecycle', () => {
  it('a field effect sees props, and onCleanup tears down', () => {
    const order: string[] = [];

    @Component({ selector: 'v-life', render: compileTemplate(`<span>{ value.get() }</span>`) })
    class Life {
      @Prop() seed = new Signal.State('default');
      value = new Signal.State('initial');

      // Deferred, so the prop has landed by the time this runs.
      #sync = effect(() => {
        order.push(`effect:${this.seed.get()}`);
        this.value.set(`from ${this.seed.get()}`);
      });

      #bye = onCleanup(() => order.push('cleanup'));
    }

    @Component({
      selector: 'v-host',
      imports: [Life],
      render: compileTemplate(`<div><v-life :seed="'prop'"></v-life></div>`),
    })
    class Host {}

    const view = render(Host);
    // The effect ran once, with the prop rather than the field default.
    expect(order).toEqual(['effect:prop']);
    expect(view.html).toContain('from prop');

    view.handle.unmount();
    expect(order).toEqual(['effect:prop', 'cleanup']);
  });

  it('onMount runs once the DOM is in the document', async () => {
    let seenInDocument: boolean | null = null;

    @Component({ selector: 'v-mounted', render: compileTemplate(`<p>hi</p>`) })
    class Mounted {
      onMount() {
        seenInDocument = document.body.contains(host.querySelector('p'));
      }
    }

    render(Mounted);
    expect(seenInDocument).toBeNull();   // deferred past render

    await new Promise<void>((r) => queueMicrotask(r));
    expect(seenInDocument).toBe(true);
  });
});

describe('two-way binding', () => {
  it(':model syncs an input with a signal', () => {
    @Component({
      selector: 'v-model',
      render: compileTemplate(`<div><input :model="text"><span>{ text.get() }</span></div>`),
    })
    class Modelled {
      text = new Signal.State('a');
    }

    const view = render(Modelled);
    const input = host.querySelector('input')!;
    expect(input.value).toBe('a');

    input.value = 'b';
    input.dispatchEvent(new Event('input'));
    flushSync();

    expect((view.handle.instance as Modelled).text.get()).toBe('b');
    expect(view.html).toContain('<span>b</span>');
  });
});

describe('component resolution', () => {
  it('resolves only through the using component\'s imports', () => {
    @Component({ selector: 'v-child', render: compileTemplate(`<span>child</span>`) })
    class Child {}

    @Component({
      selector: 'v-parent',
      imports: [Child],
      render: compileTemplate(`<div><v-child></v-child></div>`),
    })
    class Parent {}

    expect(render(Parent).html).toContain('<span>child</span>');
  });

  it('throws naming the tag and the component that used it', () => {
    @Component({
      selector: 'v-orphan',
      render: compileTemplate(`<div><VMissing></VMissing></div>`),
    })
    class Orphan {}

    // There is no global registry to fall back on, so this cannot resolve.
    expect(() => render(Orphan)).toThrow(/Unknown component <VMissing> used by Orphan/);
  });

  it('does not leak a component between unrelated parents', () => {
    @Component({ selector: 'v-shared', render: compileTemplate(`<i>shared</i>`) })
    class Shared {}

    @Component({
      selector: 'v-knows',
      imports: [Shared],
      render: compileTemplate(`<div><v-shared></v-shared></div>`),
    })
    class Knows {}

    @Component({
      selector: 'v-does-not',
      render: compileTemplate(`<div><v-shared></v-shared></div>`),
    })
    class DoesNot {}

    expect(render(Knows).html).toContain('<i>shared</i>');

    document.body.innerHTML = '<div id="app"></div>';
    host = document.querySelector('#app')!;
    // Mounting `Knows` first must not make `v-shared` visible to anyone else.
    expect(() => render(DoesNot)).toThrow(/Unknown component/);
  });

  it('renders a genuinely defined custom element', () => {
    customElements.define('my-widget', class extends HTMLElement {});

    @Component({
      selector: 'v-host',
      render: compileTemplate(`<div><my-widget></my-widget></div>`),
    })
    class Host {}

    expect(render(Host).html).toContain('<my-widget>');
  });

  it('throws for a hyphenated tag that is neither imported nor defined', () => {
    @Component({
      selector: 'v-typo',
      render: compileTemplate(`<div><v-buton></v-buton></div>`),
    })
    class Typo {}

    // Volt selectors are hyphenated too, so a missing import must not be
    // mistaken for a web component and silently render nothing.
    expect(() => render(Typo)).toThrow(/Unknown component <v-buton> used by Typo/);
  });
});

describe(':class object bindings', () => {
  it('toggles a class without disturbing the template\'s own classes', () => {
    @Component({
      selector: 'v-cls',
      render: compileTemplate(`<div class="base pad" :class="{ danger: on.get() }"></div>`),
    })
    class Cls {
      on = new Signal.State(false);
    }

    const handle = mount(Cls, host);
    const el = host.querySelector('div')!;
    expect([...el.classList].sort()).toEqual(['base', 'pad']);

    (handle.instance as Cls).on.set(true);
    flushSync();
    expect([...el.classList].sort()).toEqual(['base', 'danger', 'pad']);

    (handle.instance as Cls).on.set(false);
    flushSync();
    expect([...el.classList].sort()).toEqual(['base', 'pad']);
  });

  it('keeps several classes independent', () => {
    @Component({
      selector: 'v-multi',
      render: compileTemplate(`<div :class="{ a: x.get(), b: y.get() }"></div>`),
    })
    class Multi {
      x = new Signal.State(true);
      y = new Signal.State(false);
    }

    const handle = mount(Multi, host);
    const el = host.querySelector('div')!;
    expect([...el.classList].sort()).toEqual(['a']);

    (handle.instance as Multi).y.set(true);
    flushSync();
    expect([...el.classList].sort()).toEqual(['a', 'b']);

    (handle.instance as Multi).x.set(false);
    flushSync();
    expect([...el.classList].sort()).toEqual(['b']);
  });

  it('treats any truthy value as present, matching the object form', () => {
    @Component({
      selector: 'v-truthy',
      render: compileTemplate(`<div :class="{ on: v.get() }"></div>`),
    })
    class Truthy {
      v = new Signal.State<unknown>(0);
    }

    const handle = mount(Truthy, host);
    const el = host.querySelector('div')!;
    const inst = handle.instance as Truthy;

    expect(el.classList.contains('on')).toBe(false);
    for (const truthy of ['x', 1, {}, []]) {
      inst.v.set(truthy);
      flushSync();
      expect(el.classList.contains('on'), `${JSON.stringify(truthy)}`).toBe(true);
      inst.v.set(null);
      flushSync();
      expect(el.classList.contains('on')).toBe(false);
    }
  });

  it('still supports string and array forms', () => {
    @Component({
      selector: 'v-str',
      render: compileTemplate(`<div :class="cls.get()"></div>`),
    })
    class Str {
      cls = new Signal.State('one two');
    }

    const handle = mount(Str, host);
    const el = host.querySelector('div')!;
    expect([...el.classList].sort()).toEqual(['one', 'two']);

    (handle.instance as Str).cls.set('two three');
    flushSync();
    expect([...el.classList].sort()).toEqual(['three', 'two']);
  });
});

describe('whether a component has anything to attach', () => {
  it('says yes for a component the build never answered for', () => {
    // A component compiled without the plugin — a test, a playground — has no
    // answer recorded. Guessing "no" there would turn its page into markup
    // that never wakes up, so unknown is treated as yes.
    @Component({ selector: 'v-unanswered', render: compileTemplate(`<p>x</p>`) })
    class Unanswered {}

    expect(needsHydration(Unanswered)).toBe(true);
  });

  it('says no only when the build said so', () => {
    // What `@voltdev/vite-plugin` writes beside `render`, from the compiler's
    // own answer about the template.
    @Component({
      selector: 'v-static',
      render: compileTemplate(`<p>x</p>`),
      needsHydration: false,
    })
    class Static {}

    expect(needsHydration(Static)).toBe(false);
  });
});
