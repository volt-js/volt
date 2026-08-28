/**
 * Volt's component layer: Angular-shaped classes, TC39 standard decorators,
 * and no dependency injection.
 *
 *   @Component({
 *     selector: 'v-counter',
 *     templateUrl: './counter.html',
 *   })
 *   export class Counter {
 *     @Prop() start = new Signal.State(0);
 *     @Prop() onChanged?: (value: number) => void;
 *
 *     count = new Signal.State(0);
 *
 *     increment() {
 *       this.count.set(this.count.get() + 1);
 *       this.onChanged?.(this.count.get());
 *     }
 *   }
 *
 * A component class is instantiated exactly once per mounted instance. Its
 * methods are never re-run to produce a view — the template's bindings own
 * their own nodes and update independently.
 */

import {
  attachOwner,
  createRoot,
  createScope,
  currentRequest,
  flushSync,
  getScope,
  isSignal,
  isWritableSignal,
  onCleanup,
  raiseError,
  renderEffect,
  requestState,
  runWithScope,
  type Dispose,
  type Scope,
} from '@voltdev/reactivity';
// See `dom.ts` for why the framework's own modules take the lowered spelling.
import { State as StateSignal, untrack } from '@voltdev/reactivity/signals';

import {
  attachComponent,
  enterComponent,
  exitComponent,
  install as installDevtools,
  removeComponent,
} from './devtools.js';
import { voltError } from './diagnostics.js';
import { hydrate as hydrateInto, insert } from './dom.js';
import { enterPosition, exitPosition } from './ids.js';

// `Symbol.metadata` is stage-3 and missing from current engines. Without it
// the decorator transform quietly skips attaching metadata to the class, so it
// must exist before any decorated class is evaluated.
(Symbol as { metadata?: symbol }).metadata ??= Symbol('Symbol.metadata');

const PROPS = Symbol.for('volt.props');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A compiled template.
 *
 * A client build's render returns the DOM it built; a server build's writes
 * into the markup writer handed to it as `out` and returns nothing. One type,
 * because the two are the same template compiled for the two sides and every
 * call site here forwards whatever it was given.
 */
export type RenderFn = (ctx: unknown, out?: unknown) => unknown;

export interface ComponentType<T = unknown> {
  new (): T;
  readonly name: string;
}

export interface ComponentConfig {
  /** Tag this component answers to in a template, e.g. `v-counter`. */
  selector: string;

  /**
   * Path to an `.html` file holding the template, relative to this file.
   *
   * The preferred form: a real `.html` file gets syntax highlighting,
   * formatting and Emmet, none of which a template literal does. Resolved and
   * compiled at build time by `@voltdev/vite-plugin`, which also watches the
   * file so edits hot-reload.
   */
  templateUrl?: string;

  /**
   * A pre-compiled render function.
   *
   * Normally filled in by `@voltdev/vite-plugin` from `templateUrl`. Supply it
   * directly with `compileTemplate()` from `@voltdev/core/jit` when there is no
   * build step — tests and playgrounds.
   */
  render?: RenderFn;

  /**
   * Whether this component's template has anything to attach in a browser.
   *
   * Filled in by `@voltdev/vite-plugin` beside `render`, from the compiler's
   * own answer — a template that only clones a hoisted string and hands it
   * back has no binding, no listener, no block and no child to construct, so
   * a page made only of components like it needs no JavaScript at all.
   *
   * Absent means unknown, and unknown is treated as "yes". Reporting a
   * dynamic component as static ships a page that does not work, which is a
   * much worse failure than shipping JavaScript nobody needed.
   */
  needsHydration?: boolean;

  /** Path(s) to CSS files, relative to this file. Inlined at build time. */
  styleUrl?: string;
  styleUrls?: string[];

  /** Component-scoped CSS, injected once per component. */
  styles?: string | string[];

  /**
   * Components this template is allowed to reference.
   *
   * A function form defers evaluation, which is what mutually recursive
   * components need: `imports: () => [Other]` where a plain array would read
   * `Other` before its class binding exists. A component never needs to list
   * itself — self-recursion resolves automatically.
   */
  imports?: ComponentType<unknown>[] | (() => ComponentType<unknown>[]);
}

export interface PropOptions {
  /** Template-facing name, when it differs from the property name. */
  alias?: string;
  required?: boolean;
}

/** A prop as handed to `defineComponent` — what `@Prop` records per field. */
export interface PropDefinition {
  property: string;
  /** Template-facing name. Defaults to `property`. */
  alias?: string;
  required?: boolean;
}

interface PropDef {
  property: string;
  alias: string;
  required: boolean;
}

interface ResolvedConfig {
  config: ComponentConfig;
  propsByAlias: Map<string, PropDef>;
  stylesInjected: boolean;
  /** Lazily resolved once, since a function form must not run per instance. */
  resolvedImports?: ComponentType<unknown>[];
}

/**
 * The only lifecycle hook.
 *
 * Setup belongs in field initializers: a `Signal.Computed` for derived state,
 * an `effect` for work with side effects — both see props, because a computed
 * is lazy and an effect's first run is deferred. Teardown belongs in
 * `onCleanup`, beside the setup it undoes.
 *
 * What none of those can do is touch DOM that is in the document, which is
 * what this is for: focus, measurement, handing an element to a library.
 */
export interface OnMount {
  onMount(): void;
}

interface LifecycleHooks {
  onMount?: () => void;
}

export type SlotMap = Record<string, (props?: Record<string, unknown>) => unknown>;

// ---------------------------------------------------------------------------
// Registries
// ---------------------------------------------------------------------------

const CONFIGS = new WeakMap<ComponentType<unknown>, ResolvedConfig>();
const RENDERERS = new WeakMap<ComponentType<unknown>, RenderFn>();
const SLOTS = new WeakMap<object, SlotMap | null>();

// ---------------------------------------------------------------------------
// Metadata helpers
// ---------------------------------------------------------------------------

type MetadataRecord = Record<symbol, unknown>;

/**
 * Append to a metadata list, giving the subclass its own copy first.
 *
 * Decorator metadata inherits through the prototype chain, so appending
 * directly would push a subclass's members into the base class's array and
 * corrupt it for every other subclass.
 */
function appendMetadata<T>(metadata: MetadataRecord, key: symbol, value: T): void {
  if (!Object.hasOwn(metadata, key)) {
    const inherited = metadata[key] as T[] | undefined;
    metadata[key] = inherited ? [...inherited] : [];
  }
  (metadata[key] as T[]).push(value);
}

function readMetadata<T>(metadata: MetadataRecord | undefined, key: symbol): T[] {
  return (metadata?.[key] as T[] | undefined) ?? [];
}

// ---------------------------------------------------------------------------
// Decorators
// ---------------------------------------------------------------------------

/**
 * Register a class as a component without decorator syntax.
 *
 * This is what `@Component` reduces to, and what `@voltdev/vite-plugin` emits
 * directly: knowing every prop at build time, it can drop both decorators from
 * the output rather than shipping a decorator runtime to evaluate them. Hand
 * calls are supported but rarely worth writing.
 */
export function defineComponent<T extends ComponentType<unknown>>(
  target: T,
  config: ComponentConfig,
  props?: readonly PropDefinition[] | null,
): T {
  if (__VOLT_DEV__ && !config.selector) {
    throw voltError(
      'V0201',
      { cls: target.name || '(anonymous)' },
      `@Component on ${target.name || '(anonymous class)'} needs a selector.`,
    );
  }

  const propsByAlias = new Map<string, PropDef>();
  if (props) {
    for (const def of props) {
      propsByAlias.set(def.alias ?? def.property, {
        property: def.property,
        alias: def.alias ?? def.property,
        required: def.required ?? false,
      });
    }
  }

  CONFIGS.set(target, { config, propsByAlias, stylesInjected: false });
  return target;
}

/**
 * Mark a class as a component.
 *
 * Runs after every member decorator, so the metadata it reads is complete.
 */
export function Component(config: ComponentConfig) {
  return function decorateComponent<T extends ComponentType<unknown>>(
    target: T,
    context: ClassDecoratorContext,
  ): T {
    if (context.kind !== 'class') {
      throw voltError('V0202', {}, __VOLT_DEV__ && '@Component can only be applied to a class.');
    }
    const metadata = context.metadata as MetadataRecord | undefined;
    return defineComponent(target, config, readMetadata<PropDef>(metadata, PROPS));
  };
}

/**
 * Declare something the parent passes in.
 *
 * Covers both data and callbacks — a component notifies its parent by calling
 * a function it was given, so there is no separate event channel.
 *
 *   `@Prop() n = new Signal.State(0)`      parent writes call `.set()` — reactive
 *   `@Prop() n = 0`                        plain assignment — not reactive
 *   `@Prop() onDone?: (v: T) => void`      a callback the child invokes
 *
 * A prop is reactive because it holds a signal, never because the decorator
 * rewrote the property behind your back. That is why `accessor` is rejected:
 * it would make `{ label }` a tracked read while looking like a plain field,
 * which is the one thing Volt's reactivity does not do.
 */
export function Prop(options: PropOptions = {}) {
  return function decorateProp(_target: undefined, context: ClassFieldDecoratorContext): void {
    const kind = (context as { kind: string }).kind;
    const name = String((context as { name?: unknown }).name);

    if (kind !== 'field') {
      throw voltError(
        'V0203',
        { prop: name, kind },
        __VOLT_DEV__ &&
          `@Prop applies to a field, not ${kind} (${name}).` +
            (kind === 'accessor'
              ? '\n  Volt has no hidden reactivity — a property is reactive because it' +
                '\n  holds a signal, never because a decorator rewrote it:' +
                `\n    @Prop() ${name} = new Signal.State(...);   // reactive — read ${name}.get()` +
                `\n    @Prop() ${name} = ...;                     // constant`
              : ''),
      );
    }
    if (context.static) {
      throw voltError(
        'V0204',
        { prop: name },
        __VOLT_DEV__ && `@Prop cannot be used on a static member (${name}).`,
      );
    }
    if (typeof context.name === 'symbol') {
      throw voltError(
        'V0205',
        {},
        __VOLT_DEV__ && '@Prop cannot be used on a symbol-named property.',
      );
    }

    const property = context.name;
    appendMetadata<PropDef>(context.metadata as MetadataRecord, PROPS, {
      property,
      alias: options.alias ?? property,
      required: options.required ?? false,
    });
  };
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

export function getComponentConfig(
  component: ComponentType<unknown>,
): ComponentConfig | undefined {
  return CONFIGS.get(component)?.config;
}

export function isComponent(value: unknown): value is ComponentType<unknown> {
  return typeof value === 'function' && CONFIGS.has(value as ComponentType<unknown>);
}

/**
 * Resolve a tag against the using component's `imports`, and nowhere else.
 *
 * There is no global registry: a template can only reference what its own
 * component declares. That keeps the dependency visible in the source and
 * lets a bundler see it, at the cost of listing each import once.
 */
function resolveComponent(parentCtx: unknown, tag: string): ComponentType<unknown> | null {
  const parentClass = (parentCtx as { constructor?: ComponentType<unknown> } | null)
    ?.constructor;
  if (!parentClass) return null;

  const resolved = CONFIGS.get(parentClass);
  if (!resolved) return null;

  // A component always resolves itself. Recursion cannot be expressed through
  // `imports` — the class binding does not exist yet when its own decorator
  // runs — and a tree or menu rendering itself is ordinary enough that it
  // should not need a workaround.
  //
  // Matching is on the selector alone. A class name would be a second way to
  // name the same thing, and it does not survive minification: a bundler that
  // mangles top-level names would silently stop resolving those tags.
  if (resolved.config.selector === tag) return parentClass;

  const imports = (resolved.resolvedImports ??= resolveImports(resolved.config.imports));
  for (const candidate of imports) {
    const candidateConfig = CONFIGS.get(candidate);
    if (candidateConfig?.config.selector === tag) return candidate;
  }

  return null;
}

function resolveImports(
  imports: ComponentConfig['imports'],
): ComponentType<unknown>[] {
  if (!imports) return [];
  return typeof imports === 'function' ? imports() : imports;
}

function getRenderFn(component: ComponentType<unknown>, resolved: ResolvedConfig): RenderFn {
  const cached = RENDERERS.get(component);
  if (cached) return cached;

  const { config } = resolved;
  let render: RenderFn;

  if (config.render) {
    render = config.render;
  } else if (typeof config.templateUrl === 'string') {
    // Reaching here means the build-time pass did not run: `templateUrl` is
    // read from disk, which the browser cannot do. A production bundle was
    // built by the plugin by definition, so only the short form ships.
    throw voltError(
      'V0206',
      { cls: component.name, url: String(config.templateUrl) },
      __VOLT_DEV__ &&
        `${component.name} declares templateUrl "${config.templateUrl}", which is ` +
          'resolved at build time. Add @voltdev/vite-plugin to your Vite config, or supply ' +
          "`render` directly using compileTemplate() from '@voltdev/core/jit'.",
    );
  } else {
    render = () => null;
  }

  RENDERERS.set(component, render);
  return render;
}

const REQUEST_STYLES = Symbol('volt.styles');

/**
 * The styles this request has collected, by selector, in the order they were
 * first asked for.
 *
 * A server cannot use the process-global "already injected" mark a browser
 * uses: the first request would take every component's styles and every
 * request after it would be sent a page with none. Collecting rather than
 * injecting is also the only thing available — there is no `document` to
 * append to, and the markup these belong in has not been written yet.
 */
export function requestStyles(): ReadonlyMap<string, string> {
  return requestState(REQUEST_STYLES, () => new Map<string, string>());
}

function injectStyles(resolved: ResolvedConfig): void {
  const request = currentRequest();
  if (request) {
    const text = styleText(resolved);
    // A Map keyed by selector is its own record of what has been seen, so a
    // request needs no second flag to dedupe against.
    if (text) (requestStyles() as Map<string, string>).set(resolved.config.selector, text);
    return;
  }

  if (resolved.stylesInjected) return;
  resolved.stylesInjected = true;

  const text = styleText(resolved);
  if (text && typeof document !== 'undefined') {
    const el = document.createElement('style');
    el.setAttribute('data-volt', resolved.config.selector);
    el.textContent = text;
    document.head.appendChild(el);
  }
}

function styleText(resolved: ResolvedConfig): string {
  const { styles } = resolved.config;
  if (!styles) return '';
  const text = Array.isArray(styles) ? styles.join('\n') : styles;
  return text.trim() ? text : '';
}

// ---------------------------------------------------------------------------
// Instantiation
// ---------------------------------------------------------------------------

/**
 * Find the declared prop a mistyped name most likely meant.
 *
 * Compares with case and separators removed, which catches the kebab-cased
 * spelling of a camelCase prop as well as ordinary capitalisation slips.
 */
function closestProp(name: string, declared: string[]): string | undefined {
  const normalise = (s: string) => s.toLowerCase().replaceAll(/[^a-z0-9]/g, '');
  const target = normalise(name);
  return declared.find((candidate) => normalise(candidate) === target);
}

/**
 * Report a name that matches no declared prop.
 *
 * Volt has no fall-through for undeclared attributes, so such a name can only
 * be a mistake — and silently doing nothing is the worst way to report one.
 * The commonest is a kebab-cased spelling of a camelCase prop.
 */
function reportUnknownProp(key: string, resolved: ResolvedConfig): never {
  const declared = [...resolved.propsByAlias.keys()];
  const suggestion = closestProp(key, declared);
  throw voltError(
    'V0208',
    { selector: resolved.config.selector, prop: key },
    `<${resolved.config.selector}> has no prop "${key}".` +
      (suggestion ? ` Did you mean "${suggestion}"?` : '') +
      (declared.length ? ` Declared props: ${declared.join(', ')}.` : ' It declares no props.'),
  );
}

function checkRequiredProps(
  props: Record<string, unknown> | null,
  resolved: ResolvedConfig,
): void {
  for (const def of resolved.propsByAlias.values()) {
    if (def.required && !(props && Object.hasOwn(props, def.alias))) {
      throw voltError(
        'V0209',
        { selector: resolved.config.selector, prop: def.alias },
        `<${resolved.config.selector}> requires the prop "${def.alias}".`,
      );
    }
  }
}

function applyProps(
  instance: Record<string, unknown>,
  props: Record<string, unknown> | null,
  resolved: ResolvedConfig,
): void {
  if (props) {
    for (const key of Object.keys(props)) {
      if (key === '__ref') continue;

      const def = resolved.propsByAlias.get(key);
      if (!def) {
        if (__VOLT_DEV__) reportUnknownProp(key, resolved);
        continue;
      }

      const property = def.property;
      const descriptor = Object.getOwnPropertyDescriptor(props, key);
      const current = instance[property];

      if (isWritableSignal(current)) {
        // A getter means the parent's expression is dynamic, so keep it live.
        if (descriptor?.get) {
          renderEffect(() => current.set(props[key]));
        } else {
          current.set(props[key]);
        }
        continue;
      }

      if (descriptor?.get) {
        renderEffect(() => {
          instance[property] = props[key];
        });
      } else {
        instance[property] = props[key];
      }
    }
  }

  if (__VOLT_DEV__) checkRequiredProps(props, resolved);
}

interface InstantiateOptions {
  props?: Record<string, unknown> | null;
  slots?: SlotMap | null;
  /** The markup writer, on a server. Undefined in a browser, which has none. */
  out?: unknown;
}

function instantiate(
  component: ComponentType<unknown>,
  options: InstantiateOptions = {},
): unknown {
  const resolved = CONFIGS.get(component);
  if (!resolved) {
    throw voltError(
      'V0207',
      { cls: component.name },
      __VOLT_DEV__ && `${component.name} is not decorated with @Component.`,
    );
  }

  injectStyles(resolved);

  // Everything this component mints an id from belongs to its own position in
  // the tree — including the ids its field initializers ask for, which is why
  // the frame opens before construction rather than around the render.
  const previousPosition = enterPosition();
  // A scope per instance, opened before construction for the same reason: a
  // field initializer's effects belong to the class that declares them, not to
  // its parent. It is also what an error has to travel through — a component
  // that declares itself a boundary catches its own subtree and no wider, and
  // a report can name the component an effect five levels down belongs to,
  // because the walk up from that effect passes through this scope.
  const scope = createScope();
  const handle = __VOLT_DEV__
    ? enterComponent(
        component.name,
        resolved.config.selector,
        resolved.propsByAlias.values(),
        scope,
      )
    : null;
  try {
    return runWithScope(scope, () => {
      const instance = new component() as Record<string, unknown> & LifecycleHooks;
      SLOTS.set(instance, options.slots ?? null);
      attachOwner(scope, {
        component: instance,
        props: () => currentProps(instance, resolved),
      });

      if (__VOLT_DEV__ && handle) {
        attachComponent(handle, instance);
        // The scope that owns the instance is the one that disposes it, so the
        // tools hear that it is gone from the same place the runtime does.
        onCleanup(() => removeComponent(handle));
      }

      applyProps(instance, options.props ?? null, resolved);

      const render = getRenderFn(component, resolved);
      const dom = render(instance, options.out);

      // Not queued at all on a server, rather than queued and then ignored: a
      // microtask fires at the first `await`, and the render awaits its data,
      // so declining to wait for this one would not stop it running.
      if (!__VOLT_SERVER__ && instance.onMount) {
        // Deferred so the node is in the document by the time this runs — and
        // caught, because by then the call that created it has returned and
        // there is nothing left on the stack that could answer for it. The
        // scope is captured rather than read, for the same reason.
        queueMicrotask(() => {
          try {
            instance.onMount!();
          } catch (err) {
            raiseError(err, scope);
          }
        });
      }

      const ref = options.props?.['__ref'];
      if (typeof ref === 'function') (ref as (value: unknown) => void)(instance);

      return dom;
    });
  } finally {
    if (__VOLT_DEV__ && handle) exitComponent(handle);
    exitPosition(previousPosition);
  }
}

/**
 * A component's props as it currently holds them, signals unwrapped.
 *
 * Asked for by an error report and nowhere else, which is why it is a function
 * on the owner rather than a snapshot taken at construction: reading every
 * prop of every component that ever mounts, to describe the few that fail,
 * would be the wrong trade entirely.
 */
function currentProps(
  instance: Record<string, unknown>,
  resolved: ResolvedConfig,
): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  for (const def of resolved.propsByAlias.values()) {
    const value = instance[def.property];
    props[def.alias] = isSignal(value) ? untrack(() => (value as { get(): unknown }).get()) : value;
  }
  return props;
}

// ---------------------------------------------------------------------------
// Lazy components
// ---------------------------------------------------------------------------

export interface LazyOptions {
  /** Rendered while the chunk is in flight. */
  fallback?: () => unknown;
  /**
   * Rendered if the chunk fails to load, given the error and a way to try
   * again. Worth supplying: the commonest cause in production is a deploy
   * that removed the chunk a still-open tab is asking for.
   */
  error?: (error: unknown, retry: () => void) => unknown;
}

interface LazyRecord {
  loader: () => Promise<unknown>;
  options: LazyOptions;
  component: StateSignal<ComponentType<unknown> | null>;
  failure: StateSignal<unknown>;
  inFlight: Promise<void> | null;
}

const LAZY = new WeakMap<ComponentType<unknown>, LazyRecord>();

/**
 * How a lazy placeholder renders, installed by `lazy` rather than named
 * directly by the code that needs it.
 *
 * Every application reaches `createComponent`, and a call to
 * `createLazyComponent` from inside it makes that function — and the loader,
 * the retry and the two signals behind it, about 500 B of an app bundle —
 * reachable from the entry point whether or not anything is ever lazy. A
 * bundler cannot tell the difference and has to ship it to everyone. Assigning
 * the binding from `lazy` instead moves the decision into the import graph: an
 * application that never calls `lazy` never mentions the only function that
 * assigns this, so the whole path drops out. Measured on `examples/counter` in
 * `bundle-composition.test.ts`.
 */
let renderLazy: ((record: LazyRecord, props: Record<string, unknown> | null, slots: SlotMap | null) => unknown) | null =
  null;

/**
 * A component fetched on first use, so it lands in its own chunk.
 *
 *   const Chart = lazy('v-chart', () => import('./chart.js'), {
 *     fallback: () => 'Loading…',
 *   });
 *
 *   @Component({ selector: 'v-page', imports: [Chart], templateUrl: './page.html' })
 *
 * The selector is given here rather than read from the component, because a
 * template mentioning `<v-chart>` has to resolve it before the chunk that
 * defines it exists. Everything else is unchanged: it goes in `imports` and is
 * written in a template like any other component.
 */
export function lazy<T = unknown>(
  selector: string,
  loader: () => Promise<ComponentType<T> | { default: ComponentType<T> }>,
  options: LazyOptions = {},
): ComponentType<T> {
  const placeholder = class LazyComponent {} as unknown as ComponentType<unknown>;
  defineComponent(placeholder, { selector });
  renderLazy = createLazyComponent;

  LAZY.set(placeholder, {
    loader: loader as () => Promise<unknown>,
    options,
    component: new StateSignal<ComponentType<unknown> | null>(null),
    failure: new StateSignal<unknown>(undefined),
    inFlight: null,
  });

  return placeholder as unknown as ComponentType<T>;
}

/**
 * Start fetching a lazy component before it is rendered.
 *
 * What a router calls on hover or on route match, so the chunk is already
 * there when the view mounts. Safe to call repeatedly — the load happens once.
 */
export function preload(component: ComponentType<unknown>): Promise<void> {
  const record = LAZY.get(component);
  return record ? startLoad(record) : Promise.resolve();
}

function startLoad(record: LazyRecord): Promise<void> {
  record.inFlight ??= Promise.resolve()
    .then(record.loader)
    .then((module) => {
      // Accept a module namespace or the component itself, so both
      // `import('./x.js')` and a loader returning the class work.
      const resolved =
        module && typeof module === 'object' && 'default' in module
          ? (module as { default: ComponentType<unknown> }).default
          : (module as ComponentType<unknown>);
      record.component.set(resolved);
    })
    .catch((error: unknown) => {
      record.failure.set(error ?? new Error('[volt] lazy component failed to load'));
    });

  return record.inFlight;
}

/**
 * A lazy component renders as an accessor rather than nodes.
 *
 * `insert` already treats a function as a reactive source, so the placeholder,
 * the loaded component and a failure all flow through the same path that any
 * other changing value would — no separate suspension machinery, and no
 * compiler support.
 */
function createLazyComponent(
  record: LazyRecord,
  props: Record<string, unknown> | null,
  slots: SlotMap | null,
): unknown {
  void startLoad(record);

  return () => {
    const failure = record.failure.get();
    if (failure !== undefined) {
      const retry = () => {
        record.inFlight = null;
        record.failure.set(undefined);
        void startLoad(record);
      };
      return record.options.error?.(failure, retry) ?? null;
    }

    const component = record.component.get();
    if (!component) return record.options.fallback?.() ?? null;

    return instantiate(component, { props, slots });
  };
}

/**
 * Called by compiled templates for every component tag.
 *
 * A hyphenated tag that resolves to nothing is treated as a real custom
 * element rather than an error, so web components work without registration.
 */
export function createComponent(
  parentCtx: unknown,
  tag: string,
  props: Record<string, unknown> | null,
  events: Record<string, unknown> | null,
  slots: SlotMap | null,
  /**
   * The markup writer, on a server: one object for the whole render, passed
   * down so a child's template writes into the page its parent is writing.
   */
  out?: unknown,
): unknown {
  const component = resolveComponent(parentCtx, tag);
  if (component) {
    const lazyRecord = LAZY.get(component);
    // A record only exists because `lazy` created it, and creating one is what
    // assigns `renderLazy`, so reaching here with it unset is impossible.
    if (lazyRecord) return renderLazy!(lazyRecord, props, slots);

    if (__VOLT_DEV__ && events) {
      // Components have no event channel: a parent passes a function in as an
      // ordinary input and the child calls it. Purely an authoring mistake, so
      // it is reported while developing and ignored in a shipped build.
      const name = Object.keys(events)[0] ?? '';
      throw voltError(
        'V0210',
        { tag, event: name },
        `<${tag}> is a component, so \`:on-${name}\` does not apply. ` +
          `Pass a callback instead: \`:on${name.charAt(0).toUpperCase()}${name.slice(1)}="..."\`, ` +
          `declared on the child as a @Prop.`,
      );
    }
    return instantiate(component, { props, slots, out });
  }

  // Volt selectors are hyphenated too, so "has a hyphen" cannot distinguish a
  // web component from a forgotten import. The platform's own registry can:
  // a real custom element has to be defined to work at all.
  if (tag.includes('-') && globalThis.customElements?.get(tag)) {
    return createCustomElement(tag, props, events, slots);
  }

  throw voltError(
    'V0211',
    { tag },
    __VOLT_DEV__ &&
      `Unknown component <${tag}>` +
        ((parentCtx as { constructor?: { name: string } } | null)?.constructor?.name
          ? ` used by ${(parentCtx as { constructor: { name: string } }).constructor.name}`
          : '') +
        `. Add it to that component's \`imports\`` +
        (tag.includes('-')
          ? ', or define it as a custom element before the component mounts.'
          : '.'),
  );
}

function createCustomElement(
  tag: string,
  props: Record<string, unknown> | null,
  events: Record<string, unknown> | null,
  slots: SlotMap | null,
): Node {
  const el = document.createElement(tag);

  if (props) {
    for (const key of Object.keys(props)) {
      if (key === '__ref') continue;
      const descriptor = Object.getOwnPropertyDescriptor(props, key);
      if (descriptor?.get) {
        renderEffect(() => applyCustomElementProp(el, key, props[key]));
      } else {
        applyCustomElementProp(el, key, props[key]);
      }
    }
  }

  if (events) {
    for (const [name, handler] of Object.entries(events)) {
      if (typeof handler !== 'function') continue;
      el.addEventListener(name, handler as EventListener);
      onCleanup(() => el.removeEventListener(name, handler as EventListener));
    }
  }

  const defaultSlot = slots?.['default'];
  if (defaultSlot) insert(el, defaultSlot());

  return el;
}

function applyCustomElementProp(el: Element, name: string, value: unknown): void {
  if (name in el) {
    (el as unknown as Record<string, unknown>)[name] = value;
  } else if (value === null || value === undefined || value === false) {
    el.removeAttribute(name);
  } else {
    el.setAttribute(name, value === true ? '' : String(value));
  }
}

/** Called by compiled templates for `<slot>`. */
export function slot(
  ctx: unknown,
  name: string,
  props: Record<string, unknown> | null,
  fallback: (() => unknown) | null,
): unknown {
  const slots = SLOTS.get(ctx as object);
  const render = slots?.[name];
  if (render) return render(props ?? undefined);
  return fallback ? fallback() : null;
}

// ---------------------------------------------------------------------------
// Bootstrapping
// ---------------------------------------------------------------------------

export interface MountHandle {
  /** Tear the component down and clear the host element. */
  unmount(): void;
  /** The component instance, for tests and imperative access. */
  instance: unknown;
}

/**
 * The root of a server render: instantiate `component` and let its template
 * write into `out`.
 *
 * `mount` is the same question answered for a browser — build the DOM and put
 * it in a host. There is no host here and nothing to insert, because the
 * template writes its own bytes as it walks; what this adds over calling the
 * render function directly is everything `mount` also does not skip: props,
 * styles, the component's position for its ids, and the lifecycle gate.
 *
 * Called by `renderToStaticMarkup`, which owns the request scope this runs in.
 */
export function renderComponent(
  component: ComponentType<unknown>,
  out: unknown,
  props: Record<string, unknown> | null = null,
): void {
  instantiate(component, { props, out });
}

/**
 * Mount a component into the document. The returned handle disposes every
 * effect the component created, so nothing is left observing after unmount.
 */
export function mount(
  component: ComponentType<unknown>,
  target: Element | string,
): MountHandle {
  const host = typeof target === 'string' ? document.querySelector(target) : target;
  if (!host) {
    throw voltError(
      'V0212',
      { target: String(target) },
      __VOLT_DEV__ && `Mount target not found: ${String(target)}`,
    );
  }

  let dispose: Dispose = () => {};
  let instance: unknown = null;

  createRoot((disposeRoot) => {
    dispose = disposeRoot;
    const resolved = CONFIGS.get(component);
    if (!resolved) {
      throw voltError(
        'V0207',
        { cls: component.name },
        __VOLT_DEV__ && `${component.name} is not decorated with @Component.`,
      );
    }

    // Capture the instance without a second construction.
    insert(
      host,
      instantiate(component, {
        props: { __ref: (value: unknown) => (instance = value) },
      }),
    );
  });

  // Effects are deferred, so without this the tree handed back would not yet
  // reflect them — a component whose setup runs in a field effect would paint
  // its placeholder first.
  flushSync();

  return {
    instance,
    unmount() {
      dispose();
      host.textContent = '';
    },
  };
}

/**
 * Attach a component to markup a server already wrote.
 *
 * `mount` and this are siblings rather than one function with a flag, and the
 * bundle is the reason. A flag would put the hydration walk on `mount`'s own
 * path, where no bundler can drop it — every client-only application would
 * carry it, which measured at about 2 kB of the counter example's 24. Two
 * entries let an application that never server-renders reference the one it
 * uses and ship neither the walk nor the claim.
 *
 * Which one an application calls is decided by the same thing that decides
 * whether its templates *claim* nodes or *create* them: how it was compiled.
 * `hydrate` on the Vite plugin, which `start` turns on. A host that happens to
 * have children is not evidence either way — a `csr` route's mount point is
 * empty on a server-rendered site, and a shell with a spinner in it is not.
 */
export function hydrate(
  component: ComponentType<unknown>,
  target: Element | string,
): MountHandle {
  const host = typeof target === 'string' ? document.querySelector(target) : target;
  if (!host) {
    throw voltError(
      'V0212',
      { target: String(target) },
      __VOLT_DEV__ && `Mount target not found: ${String(target)}`,
    );
  }

  let dispose: Dispose = () => {};
  let instance: unknown = null;

  createRoot((disposeRoot) => {
    dispose = disposeRoot;
    const resolved = CONFIGS.get(component);
    if (!resolved) {
      throw voltError(
        'V0207',
        { cls: component.name },
        __VOLT_DEV__ && `${component.name} is not decorated with @Component.`,
      );
    }

    // The same entry a hole uses, given the whole host: the root of a page is
    // a container whose children are the block's with no marker in front of
    // them, which is the shape `hInsert` already handles.
    hydrateInto(host, () =>
      instantiate(component, {
        props: { __ref: (value: unknown) => (instance = value) },
      }),
    );
  });

  flushSync();

  return {
    instance,
    unmount() {
      dispose();
      host.textContent = '';
    },
  };
}

/**
 * Does rendering this component in a browser have anything to do?
 *
 * `true` unless the build said otherwise. A component compiled without the
 * plugin — a test, a playground — has no answer recorded, and guessing "no"
 * there would turn every such page into markup that never wakes up.
 */
export function needsHydration(component: ComponentType<unknown>): boolean {
  return CONFIGS.get(component)?.config.needsHydration !== false;
}

export { getScope, runWithScope, type Scope };

// Installed from here rather than from the package entry so that the tools are
// already listening whichever module an application reached first —
// `@voltdev/core` and `@voltdev/core/runtime` both pass through this one. The
// whole statement, and everything it would install, is gone from a production
// build.
if (__VOLT_DEV__) installDevtools();
