/**
 * When a prop is there.
 *
 * A prop used to land after the constructor returned, so a field initializer
 * — which is where Volt tells you to do your setup — saw the default and never
 * the value. Every component built over a primitive hits that: the primitive
 * is made in a field, and what it is made with is a prop.
 *
 * `@Prop` is a field initializer now, so the field takes the value as it is
 * made, and a field declared after it sees what the parent passed.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { compileTemplate } from '@voltdev/core/jit';
import { Component, Prop, Signal, defineComponent, flushSync, initProp, mount } from '@voltdev/core';

let unmount: (() => void) | null = null;

afterEach(() => {
  unmount?.();
  unmount = null;
  document.body.innerHTML = '';
});

function show<T>(component: new () => T): { instance: T; host: HTMLElement } {
  const host = document.createElement('div');
  document.body.append(host);
  const handle = mount(component, host);
  unmount = handle.unmount;
  flushSync();
  return { instance: handle.instance as T, host };
}

describe('a prop while the fields are being made', () => {
  it('is what a field built from it is built with', () => {
    @Component({ selector: 'v-greet', render: compileTemplate(`<b>{ greeting }</b>`) })
    class Greet {
      @Prop() name = 'nobody';
      // The shape every component over a primitive has: something made in a
      // field, out of a prop.
      greeting = `Hello, ${this.name}.`;
    }

    @Component({
      selector: 'v-page',
      imports: [Greet],
      render: compileTemplate(`<v-greet name="Ada"></v-greet>`),
    })
    class Page {}

    expect(show(Page).host.querySelector('b')!.textContent).toBe('Hello, Ada.');
  });

  it('is in the signal a field reads at construction', () => {
    @Component({ selector: 'v-count', render: compileTemplate(`<b>{ doubledAtBirth }</b>`) })
    class Count {
      @Prop() start = new Signal.State(0);
      // Read now, not lazily: this is the value the field was built from.
      doubledAtBirth = this.start.get() * 2;
    }

    @Component({
      selector: 'v-page',
      imports: [Count],
      render: compileTemplate(`<v-count :start="21"></v-count>`),
    })
    class Page {}

    const { host } = show(Page);
    expect(host.querySelector('b')!.textContent).toBe('42');
  });

  it('keeps a dynamic prop live after the field has taken it', () => {
    @Component({ selector: 'v-label', render: compileTemplate(`<b>{ caption.get() }</b>`) })
    class Label {
      @Prop() caption = new Signal.State('');
      firstSeen = this.caption.get();
    }

    @Component({
      selector: 'v-page',
      imports: [Label],
      render: compileTemplate(`<v-label :caption="word.get()"></v-label>`),
    })
    class Page {
      word = new Signal.State('one');
    }

    const { instance, host } = show(Page);
    expect(host.querySelector('b')!.textContent).toBe('one');

    instance.word.set('two');
    flushSync();
    expect(host.querySelector('b')!.textContent).toBe('two');
  });

  it('leaves the default alone where the parent passed nothing', () => {
    @Component({ selector: 'v-plain', render: compileTemplate(`<b>{ label }</b>`) })
    class Plain {
      @Prop() label = 'default';
      copy = this.label;
    }

    @Component({
      selector: 'v-page',
      imports: [Plain],
      render: compileTemplate(`<v-plain></v-plain>`),
    })
    class Page {}

    expect(show(Page).host.querySelector('b')!.textContent).toBe('default');
  });

  it('is still a class a test can construct with new', () => {
    @Component({ selector: 'v-alone', render: compileTemplate(`<b>{ label }</b>`) })
    class Alone {
      @Prop() label = 'default';
    }

    expect(new Alone().label).toBe('default');
  });
});

/**
 * The same thing, for a build that resolved the decorator away.
 *
 * `@voltdev/vite-plugin` knows every prop name before the browser does, so it
 * deletes `@Prop` and registers the names itself — and what it leaves in the
 * field's place is a call to `initProp`. These are the two halves that have to
 * agree: what the decorator installs, and what the plugin writes instead. A
 * build where they disagreed would be one where components work in tests and
 * hand their primitives defaults in production.
 */
describe('a prop whose decorator a build resolved away', () => {
  /** What the plugin emits for `@Prop() label = 'default'`. */
  class Lowered {
    label = initProp<string>(this, 'label', 'default');
    shouted = this.label.toUpperCase();
  }
  defineComponent(
    Lowered as never,
    { selector: 'v-lowered', render: compileTemplate(`<b>{ shouted }</b>`) },
    [{ property: 'label' }],
  );

  /** And for `@Prop({ alias: 'for' }) htmlFor = ''`. */
  class Aliased {
    htmlFor = initProp<string>(this, 'htmlFor', '');
  }
  defineComponent(
    Aliased as never,
    { selector: 'v-aliased', render: compileTemplate(`<b>{ htmlFor }</b>`) },
    [{ property: 'htmlFor', alias: 'for' }],
  );

  it('takes what the parent passed while the field initializes', () => {
    @Component({
      selector: 'v-page',
      imports: [Lowered as never],
      render: compileTemplate(`<v-lowered label="written"></v-lowered>`),
    })
    class Page {}

    // `shouted` was built from `label` in the next field along, so this is the
    // prop having been there already — the default would have said DEFAULT.
    expect(show(Page).host.querySelector('b')!.textContent).toBe('WRITTEN');
  });

  it('keeps its own default where the parent wrote nothing', () => {
    @Component({
      selector: 'v-page',
      imports: [Lowered as never],
      render: compileTemplate(`<v-lowered></v-lowered>`),
    })
    class Page {}

    expect(show(Page).host.querySelector('b')!.textContent).toBe('DEFAULT');
  });

  it('has the value in its own signal, where the field is one', () => {
    class Counted {
      count = initProp(this, 'count', new Signal.State(0));
      /** Read at construction, as a primitive built in a field would. */
      started = this.count.get();
    }
    defineComponent(
      Counted as never,
      { selector: 'v-counted', render: compileTemplate(`<b>{ started }</b>`) },
      [{ property: 'count' }],
    );

    @Component({
      selector: 'v-page',
      imports: [Counted as never],
      render: compileTemplate(`<v-counted :count="count.get()"></v-counted>`),
    })
    class Page {
      count = new Signal.State(7);
    }

    expect(show(Page).host.querySelector('b')!.textContent).toBe('7');
  });

  it('is the parent’s own signal, where the field only holds one', () => {
    // The shape every controlled component has: the page keeps the state and
    // the child is handed the signal itself, to read and to write.
    class Controlled {
      open = initProp<Signal.State<boolean> | undefined>(this, 'open', undefined);
      /** What a primitive built in the next field would have been given. */
      answered = this.open?.get() ?? 'nothing';
    }
    defineComponent(
      Controlled as never,
      { selector: 'v-controlled', render: compileTemplate(`<b>{ answered }</b>`) },
      [{ property: 'open' }],
    );

    @Component({
      selector: 'v-page',
      imports: [Controlled as never],
      render: compileTemplate(`<v-controlled :open="open"></v-controlled>`),
    })
    class Page {
      open = new Signal.State(true);
    }

    expect(show(Page).host.querySelector('b')!.textContent).toBe('true');
  });

  it('reads the name the parent writes, which an alias may rename', () => {
    @Component({
      selector: 'v-page',
      imports: [Aliased as never],
      render: compileTemplate(`<v-aliased for="surname"></v-aliased>`),
    })
    class Page {}

    expect(show(Page).host.querySelector('b')!.textContent).toBe('surname');
  });
});
