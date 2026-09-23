/**
 * The design tokens, in the two layers the taxonomy calls for.
 *
 * Primitive tokens are raw values with no meaning attached — a palette, a type
 * scale, a spacing ramp. Semantic tokens name a role and point at a primitive.
 * Components only ever reference the semantic layer for colour, which is what
 * makes re-theming a matter of repointing a handful of roles instead of
 * hunting through every rule for the blue that happened to be a border.
 *
 * The naming contract is part of the public API: `--volt-<category>-<name>`,
 * lowercase, hyphen-separated. Renaming one is a breaking change, which is the
 * point — a token nobody can rely on is not a contract.
 *
 * Values are literal here rather than composed with `color-mix()` or `oklch()`
 * so that the emitted sheet stays readable and diffable when a consumer copies
 * it into their own repository, and so that a generated theme is a table of
 * strings rather than a computation someone has to re-run.
 */

export type TokenTable = Readonly<Record<string, string>>;

/**
 * Raw values. Nothing here says where it may be used, and components must not
 * reach for the palette entries directly — see `semanticTokens`.
 */
export const primitiveTokens: TokenTable = {
  // Palette. One neutral ramp plus an accent and the three status hues; a
  // wider ramp is a theme's business, not a default set's.
  '--volt-palette-white': '#ffffff',
  '--volt-palette-neutral-50': '#f6f7f9',
  '--volt-palette-neutral-100': '#eceef2',
  '--volt-palette-neutral-200': '#dcdfe6',
  '--volt-palette-neutral-400': '#99a1b0',
  '--volt-palette-neutral-600': '#5a6373',
  '--volt-palette-neutral-900': '#161a20',
  '--volt-palette-accent-100': '#dce8fd',
  '--volt-palette-accent-500': '#2f6feb',
  '--volt-palette-accent-600': '#1e56c2',
  '--volt-palette-danger-100': '#fde3e1',
  '--volt-palette-danger-500': '#d92d20',
  '--volt-palette-danger-600': '#b32218',
  '--volt-palette-success-500': '#167f4a',
  '--volt-palette-warning-500': '#b25a09',
  '--volt-palette-scrim': 'rgb(22 26 32 / 0.55)',

  // Type scale.
  '--volt-font-family-sans':
    "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  '--volt-font-size-1': '0.75rem',
  '--volt-font-size-2': '0.875rem',
  '--volt-font-size-3': '1rem',
  '--volt-font-size-4': '1.125rem',
  '--volt-font-weight-regular': '400',
  '--volt-font-weight-medium': '500',
  '--volt-font-weight-semibold': '600',
  '--volt-line-height-tight': '1.25',
  '--volt-line-height-normal': '1.5',

  // Spacing, named by multiples of 0.25rem so the arithmetic is visible in the
  // name and there is no question what sits between -2 and -4.
  '--volt-space-1': '0.25rem',
  '--volt-space-2': '0.5rem',
  '--volt-space-3': '0.75rem',
  '--volt-space-4': '1rem',
  '--volt-space-5': '1.25rem',
  '--volt-space-6': '1.5rem',
  '--volt-space-8': '2rem',
  '--volt-space-12': '3rem',
  '--volt-space-20': '5rem',
  '--volt-space-80': '20rem',
  '--volt-space-120': '30rem',

  '--volt-radius-1': '0.25rem',
  '--volt-radius-2': '0.5rem',
  '--volt-radius-full': '62.5rem',

  '--volt-border-width-1': '1px',
  '--volt-border-width-2': '2px',
  '--volt-border-width-4': '4px',

  '--volt-shadow-1': '0 1px 2px rgb(22 26 32 / 0.08)',
  '--volt-shadow-2': '0 8px 24px rgb(22 26 32 / 0.16)',

  '--volt-opacity-disabled': '0.55',

  // Stacking. Two values rather than a scale: everything this package puts
  // over the page is either an overlay or a notification above one, and a
  // number a consumer cannot read out of the token table is a number they
  // cannot coordinate their own layers with.
  '--volt-z-index-overlay': '1000',
  '--volt-z-index-toast': '1100',

  '--volt-duration-fast': '120ms',
  '--volt-duration-medium': '200ms',
  // What repeats rather than what transitions. A spinner's turn, a skeleton's
  // pulse and an indeterminate bar's sweep are all measured against how long a
  // reader will watch them, not against how long a control takes to answer a
  // press — timed at 200ms a turn is five revolutions a second, which reads as
  // a strobing blur rather than as work being done.
  '--volt-duration-slow': '800ms',
  '--volt-easing-standard': 'cubic-bezier(0.2, 0, 0, 1)',
};

/**
 * Roles. Every value is a single `var()` at a primitive, so a brand swaps the
 * palette and every component follows; a theme that needs to break the link
 * for one role redefines that role instead.
 *
 * `on-` names the foreground guaranteed to be legible on the surface of the
 * same name, which is the pairing forced-colors mode also works in.
 */
export const semanticTokens: TokenTable = {
  '--volt-color-surface': 'var(--volt-palette-white)',
  '--volt-color-surface-sunken': 'var(--volt-palette-neutral-50)',
  '--volt-color-surface-hover': 'var(--volt-palette-neutral-100)',
  '--volt-color-surface-scrim': 'var(--volt-palette-scrim)',
  '--volt-color-on-surface': 'var(--volt-palette-neutral-900)',
  '--volt-color-on-surface-muted': 'var(--volt-palette-neutral-600)',

  '--volt-color-border': 'var(--volt-palette-neutral-200)',
  '--volt-color-border-strong': 'var(--volt-palette-neutral-400)',

  '--volt-color-accent': 'var(--volt-palette-accent-500)',
  '--volt-color-accent-hover': 'var(--volt-palette-accent-600)',
  '--volt-color-accent-muted': 'var(--volt-palette-accent-100)',
  '--volt-color-on-accent': 'var(--volt-palette-white)',

  '--volt-color-danger': 'var(--volt-palette-danger-500)',
  '--volt-color-danger-hover': 'var(--volt-palette-danger-600)',
  '--volt-color-danger-muted': 'var(--volt-palette-danger-100)',
  '--volt-color-on-danger': 'var(--volt-palette-white)',

  '--volt-color-success': 'var(--volt-palette-success-500)',
  '--volt-color-warning': 'var(--volt-palette-warning-500)',
  '--volt-color-info': 'var(--volt-palette-accent-500)',

  '--volt-focus-ring-color': 'var(--volt-color-accent)',
  '--volt-focus-ring-width': 'var(--volt-border-width-2)',
  '--volt-focus-ring-offset': 'var(--volt-border-width-2)',

  '--volt-disabled-opacity': 'var(--volt-opacity-disabled)',

  '--volt-elevation-raised': 'var(--volt-shadow-1)',
  '--volt-elevation-overlay': 'var(--volt-shadow-2)',
};

/**
 * What `prefers-reduced-motion: reduce` changes.
 *
 * Zero rather than a token pointing at zero, because this is not a role
 * anybody themes. Zero and not "very fast": `createPresence` asks the element
 * whether anything is actually animating and releases the node synchronously
 * when the answer is no, so a zero duration removes the wait entirely instead
 * of shortening it.
 */
export const reducedMotionTokens: TokenTable = {
  '--volt-duration-fast': '0ms',
  '--volt-duration-medium': '0ms',
  '--volt-duration-slow': '0ms',
};

/**
 * Every token name the sheet defines.
 *
 * Built inside a call marked pure, for the reason `ComponentStyles` gives in
 * `css.ts`: left at module level, the two `Object.keys` calls would keep both
 * tables in every bundle that imported anything from the package.
 */
export const tokenNames: ReadonlySet<string> = /* @__PURE__ */ (() =>
  new Set([...Object.keys(primitiveTokens), ...Object.keys(semanticTokens)]))();

/** The `:root` block, primitives first so the semantic layer reads top-down. */
export function tokensCss(indent = ''): string {
  const inner = `${indent}  `;
  const lines = [...Object.entries(primitiveTokens), ...Object.entries(semanticTokens)].map(
    ([name, value]) => `${inner}${name}: ${value};`,
  );
  return `${indent}:root {\n${lines.join('\n')}\n${indent}}`;
}
