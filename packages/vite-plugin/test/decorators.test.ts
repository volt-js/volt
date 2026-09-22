/**
 * Build-time lowering of `@Component` and `@Prop`.
 *
 * The pass rewrites source without parsing it, so most of what matters here is
 * that it reads unusual-but-valid TypeScript correctly, and that when it is
 * unsure it declines rather than guesses — a wrong rewrite is a broken build,
 * whereas declining only costs bundle size.
 */
import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { transform as esbuildTransform } from 'esbuild';
import { volt } from '../src/index.js';

type TransformHook = (
  this: { error(message: string): never; addWatchFile(file: string): void },
  code: string,
  id: string,
) => Promise<{ code: string } | null> | { code: string } | null;

const FIXTURE_ID = resolve(import.meta.dirname, 'fixtures/component.ts');

async function lower(code: string): Promise<string | null> {
  const decorators = volt().find((p) => p.name === 'volt:decorators')!;
  const hook = decorators.transform as unknown as TransformHook;
  const context = {
    error(message: string): never {
      throw new Error(message);
    },
    addWatchFile() {},
  };
  const result = await hook.call(context, code, FIXTURE_ID);
  return result ? result.code : null;
}

/**
 * Run the lowered module and report what it registered.
 *
 * This is the check that matters: the emitted call has to name the real class
 * binding and carry the config and props through intact.
 *
 * The lowered output is still TypeScript — stripping types is Vite's job, not
 * this pass's — so it goes through esbuild first, exactly as it would in a
 * real build. Decorators are already gone by then, which is the whole point.
 */
async function registrations(code: string) {
  const output = (await lower(code))!;
  const stripped = await esbuildTransform(output, {
    loader: 'ts',
    target: 'es2022',
    tsconfigRaw: { compilerOptions: { useDefineForClassFields: true } },
  });

  // Rewrite module syntax away so the body can run inside `new Function`.
  const body = stripped.code
    .replaceAll(/^import[^\n]*\n/gm, '')
    .replaceAll(/\bexport default (?=class)/g, '')
    .replaceAll(/\bexport (?=class|const|let|var|function)/g, '');

  const calls: { target: unknown; config: Record<string, unknown>; props: unknown[] }[] = [];
  const define = (target: unknown, config: Record<string, unknown>, props: unknown[] = []) => {
    calls.push({ target, config, props });
    return target;
  };

  const Signal = { State: class {} };
  const render = () => null;
  // What the runtime's `initProp` does when no parent passed anything: hand
  // the field its own initializer back.
  const prop = (_instance: unknown, _property: string, initial: unknown) => initial;
  new Function('__volt_define', '__volt_prop', 'Signal', '__volt_render_0', body)(
    define,
    prop,
    Signal,
    render,
  );
  return calls;
}

const SIMPLE = `
@Component({ selector: 'v-counter', render: __volt_render_0 })
export class Counter {
  @Prop() start = new Signal.State(0);
  count = new Signal.State(0);
  bump() { this.count.set(this.count.get() + 1); }
}
`;

describe('lowering', () => {
  it('removes both decorators and registers the class instead', async () => {
    const output = (await lower(SIMPLE))!;

    expect(output).not.toContain('@Component');
    expect(output).not.toContain('@Prop');
    expect(output).toContain('__volt_define(Counter,');
    expect(output).toContain(
      'import { defineComponent as __volt_define, initProp as __volt_prop }',
    );
    // The class keeps its export and its members.
    expect(output).toContain('export class Counter');
    // The initializer is kept, wrapped in what the decorator would have done:
    // taken what the parent passed while the field was initializing.
    expect(output).toContain('start = __volt_prop(this, "start", ( new Signal.State(0)))');
  });

  it('emits no decorator runtime — that is the entire point', async () => {
    const output = (await lower(SIMPLE))!;
    // esbuild's lowering is recognisable by these helpers.
    expect(output).not.toContain('__decorateElement');
    expect(output).not.toContain('__decoratorStart');
    expect(output).not.toContain('__runInitializers');
  });

  it('registers the class with its config and props', async () => {
    const calls = await registrations(SIMPLE);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.config['selector']).toBe('v-counter');
    expect(calls[0]!.props).toEqual([{ property: 'start' }]);
    expect(typeof calls[0]!.target).toBe('function');
    expect((calls[0]!.target as { name: string }).name).toBe('Counter');
  });

  it('passes prop options through verbatim', async () => {
    const calls = await registrations(`
      @Component({ selector: 'v-x' })
      export class X {
        @Prop({ alias: 'max-n', required: true }) maxN = 0;
        @Prop() plain = 1;
      }
    `);

    expect(calls[0]!.props).toEqual([
      { property: 'maxN', alias: 'max-n', required: true },
      { property: 'plain' },
    ]);
  });

  it('omits the props argument when a component declares none', async () => {
    const output = (await lower(`
      @Component({ selector: 'v-x' })
      export class X { a = 1; }
    `))!;
    expect(output).toContain('__volt_define(X, { selector: \'v-x\' });');
  });

  it('handles several components in one module', async () => {
    const calls = await registrations(`
      @Component({ selector: 'v-a' })
      export class A { @Prop() a = 1; }

      @Component({ selector: 'v-b' })
      export class B { @Prop() b = 2; }
    `);

    expect(calls.map((c) => c.config['selector'])).toEqual(['v-a', 'v-b']);
    expect(calls[1]!.props).toEqual([{ property: 'b' }]);
  });

  it('reads a class with type parameters and a brace-bearing heritage clause', async () => {
    const calls = await registrations(`
      class Base<T> { }

      @Component({ selector: 'v-g' })
      export class G<T extends { id: number }> extends Base<() => void> implements Thing {
        @Prop() item!: T;
      }
    `);

    expect(calls[0]!.config['selector']).toBe('v-g');
    expect(calls[0]!.props).toEqual([{ property: 'item' }]);
  });

  it('keeps a default export working', async () => {
    const output = (await lower(`
      @Component({ selector: 'v-d' })
      export default class D { @Prop() a = 1; }
    `))!;
    expect(output).toContain('export default class D');
    expect(output).toContain('__volt_define(D,');
  });

  it('accepts fields whose names collide with modifiers', async () => {
    const calls = await registrations(`
      @Component({ selector: 'v-m' })
      export class M {
        @Prop() get = 1;
        @Prop() set = 2;
        @Prop() accessor = 3;
        @Prop() static = 4;
      }
    `);

    expect(calls[0]!.props).toEqual([
      { property: 'get' },
      { property: 'set' },
      { property: 'accessor' },
      { property: 'static' },
    ]);
  });

  it('accepts TypeScript member modifiers before the field', async () => {
    const calls = await registrations(`
      @Component({ selector: 'v-mod' })
      export class Mod {
        @Prop() readonly a = 1;
        @Prop() declare b: number;
        @Prop() override c = 3;
      }
    `);

    expect(calls[0]!.props.map((p) => (p as { property: string }).property)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });
});

describe('shapes it refuses to rewrite', () => {
  it('rejects @Prop on an accessor, naming the signal form instead', async () => {
    await expect(
      lower(`
        @Component({ selector: 'v-a' })
        export class A { @Prop() accessor label = 'x'; }
      `),
    ).rejects.toThrow(/@Prop applies to a field, not accessor \(label\)[\s\S]*no hidden reactivity/);
  });

  it('rejects @Prop on a getter', async () => {
    await expect(
      lower(`
        @Component({ selector: 'v-a' })
        export class A { @Prop() get label() { return 1; } }
      `),
    ).rejects.toThrow(/not getter \(label\)/);
  });

  it('rejects @Prop on a static member', async () => {
    await expect(
      lower(`
        @Component({ selector: 'v-a' })
        export class A { @Prop() static label = 1; }
      `),
    ).rejects.toThrow(/cannot be used on a static member \(label\)/);
  });

  it('rejects @Prop on a method', async () => {
    await expect(
      lower(`
        @Component({ selector: 'v-a' })
        export class A { @Prop() handle() {} }
      `),
    ).rejects.toThrow(/not a method \(handle\)/);
  });

  it('rejects @Prop on a private field', async () => {
    await expect(
      lower(`
        @Component({ selector: 'v-a' })
        export class A { @Prop() #secret = 1; }
      `),
    ).rejects.toThrow(/private field \(#secret\)/);
  });
});

describe('falling back to esbuild', () => {
  it('hands the file over when a decorator belongs to someone else', async () => {
    const output = (await lower(`
      @Injectable()
      export class Service {}

      @Component({ selector: 'v-a' })
      export class A { @Prop() a = 1; }
    `))!;

    // esbuild lowered it, so the decorators are gone but so is our fast path.
    expect(output).not.toContain('__volt_define');
    expect(output).toContain('__decorateElement');
  });

  it('hands the file over for a @Prop outside any component', async () => {
    const output = (await lower(`
      export class Plain { @Prop() a = 1; }

      @Component({ selector: 'v-a' })
      export class A {}
    `))!;

    expect(output).not.toContain('__volt_define');
  });

  it('hands the file over for an anonymous default export', async () => {
    const output = (await lower(`
      @Component({ selector: 'v-a' })
      export default class {}
    `))!;

    expect(output).not.toContain('__volt_define');
  });

  it('leaves a file with no decorators completely alone', async () => {
    expect(await lower(`export const a = 1; // nothing @ all here\n`)).toBeNull();
    expect(await lower(`/** @param x - a thing */\nexport function f(x) { return x; }\n`)).toBeNull();
  });
});

describe('scanning', () => {
  it('ignores decorator-looking text in strings, comments and templates', async () => {
    const calls = await registrations(`
      // @Component({ selector: 'commented-out' })
      /* @Prop() ignored = 1; */
      const s = '@Component({ selector: "in-a-string" })';
      const t = \`@Prop() also ignored \${1 + 1}\`;

      @Component({ selector: 'v-real' })
      export class Real { @Prop() a = 1; }
    `);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.config['selector']).toBe('v-real');
  });

  it('is not derailed by a regex literal containing quotes or braces', async () => {
    const calls = await registrations(`
      const quoted = /['"]/g;
      const braced = /[{}]/g;
      const divided = (4 + 2) / 2;

      @Component({ selector: 'v-re' })
      export class Re { @Prop() a = 1; }
    `);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.config['selector']).toBe('v-re');
  });

  it('ignores a @Prop written inside a method body', async () => {
    const calls = await registrations(`
      @Component({ selector: 'v-b' })
      export class B {
        @Prop() real = 1;
        run() { const s = "@Prop() fake = 2"; return s; }
      }
    `);

    expect(calls[0]!.props).toEqual([{ property: 'real' }]);
  });
});

/**
 * A prop is what the parent passed, from the moment the field exists.
 *
 * `@Prop` is a field initializer: it returns what the parent wrote, or the
 * field's own default when they wrote nothing. Lowering it away has to keep
 * that, because a component built on a primitive hands its props to that
 * primitive in a field — so a build that let props land after the constructor
 * would build every primitive out of defaults, and a dialog handed the page's
 * `open` signal would sit there owning one of its own.
 */
describe('what the lowered field does', () => {
  /** Run a lowered class and report every `initProp` call it made. */
  async function initialized(code: string, create = 'new Thing()') {
    const output = (await lower(code))!;
    const stripped = await esbuildTransform(output, {
      loader: 'ts',
      target: 'es2022',
      tsconfigRaw: { compilerOptions: { useDefineForClassFields: true } },
    });
    const body = stripped.code
      .replaceAll(/^import[^\n]*\n/gm, '')
      .replaceAll(/\bexport (?=class|const|let|var|function)/g, '')
      .concat(`\nreturn ${create};`);

    const seen: { property: string; initial: unknown; self: unknown }[] = [];
    const prop = (self: unknown, property: string, initial: unknown) => {
      seen.push({ property, initial, self });
      return initial;
    };
    const Signal = { State: class {} };
    const instance = new Function(
      '__volt_define',
      '__volt_prop',
      'Signal',
      '__volt_render_0',
      body,
    )(() => undefined, prop, Signal, () => null);

    const taken = seen.map(({ property, initial, self }) => ({
      property,
      initial,
      sameInstance: self === instance,
    }));
    return { taken, instance: instance as Record<string, unknown> };
  }

  it('asks the runtime for the value, naming itself and its property', async () => {
    const { taken } = await initialized(`
@Component({ selector: 'v-thing', render: __volt_render_0 })
export class Thing {
  @Prop() count = 7;
}
`);
    expect(taken).toEqual([{ property: 'count', initial: 7, sameInstance: true }]);
  });

  it('asks for one it was given no default for', async () => {
    const { taken } = await initialized(`
@Component({ selector: 'v-thing', render: __volt_render_0 })
export class Thing {
  @Prop() open?: { get(): boolean };
}
`);
    expect(taken).toEqual([{ property: 'open', initial: undefined, sameInstance: true }]);
  });

  it('has the value before the next field is built, which is the whole point', async () => {
    const { instance } = await initialized(`
@Component({ selector: 'v-thing', render: __volt_render_0 })
export class Thing {
  @Prop() label = 'fallback';
  shouted = this.label.toUpperCase();
}
`);
    expect(instance['shouted']).toBe('FALLBACK');
  });

  it('keeps a callback prop, whose type carries an arrow of its own', async () => {
    const { taken } = await initialized(`
@Component({ selector: 'v-thing', render: __volt_render_0 })
export class Thing {
  @Prop() onDone?: (value: number) => void;
  @Prop() format: (value: number) => string = (value) => String(value);
}
`);
    expect(taken.map((each) => each.property)).toEqual(['onDone', 'format']);
    expect(typeof taken[1]!.initial).toBe('function');
  });

  it('declines a declaration spread over lines rather than guessing at it', async () => {
    const output = (await lower(`
@Component({ selector: 'v-thing', render: __volt_render_0 })
export class Thing {
  @Prop() tone:
    | 'quiet'
    | 'loud' = 'quiet';
}
`))!;
    // esbuild's own lowering, which runs the decorators for real: correct, and
    // only larger. What must never happen is a rewrite this pass guessed at.
    expect(output).toContain('__decorateElement');
    expect(output).not.toContain('__volt_prop');
  });
});

