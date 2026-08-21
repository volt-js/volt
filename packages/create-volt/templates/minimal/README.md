# __PROJECT_NAME__

A [Volt](https://voltjs.dev) application: class components, `:`-prefixed
templates, TC39 signals, and no virtual DOM.

```bash
pnpm install
pnpm dev
```

| Command | What it does |
| --- | --- |
| `pnpm dev` | Vite dev server, with templates and Sass hot-reloading |
| `pnpm build` | Production build into `dist/` |
| `pnpm preview` | Serve that build |
| `pnpm test` | Vitest, in happy-dom |
| `pnpm typecheck` | TypeScript, no emit |

## The files

```
index.html          the page; loads src/main.ts
src/main.ts         mounts the root component
src/app.ts          the component class
src/app.html        its template — everything dynamic starts with `:`
src/app.scss        its styles, compiled at build time
src/app.test.ts     mounts it, presses a button, asserts on the DOM
src/styles.scss     page-level styles
```

`@voltdev/vite-plugin` is not optional: it lowers the standard decorators no
engine implements yet, and compiles every template at build time so the
compiler never ships to the browser.

## Next

- [Templates](https://voltjs.dev/reference/template-syntax) — the `:` syntax in full
- [Reactivity](https://voltjs.dev/guide/reactivity) — signals, computeds, effects
- [Components](https://voltjs.dev/guide/components) — props, callbacks, lifecycle
