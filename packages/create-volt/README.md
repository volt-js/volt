# create-volt

Scaffold a [Volt](https://voltjs.dev) project: the Vite plugin configured, a
component, its template, a stylesheet, and a test that passes.

```bash
pnpm create @voltdev/volt my-app
cd my-app
pnpm install
pnpm dev
```

> **Not on npm yet.** The command above is what runs it once it is released.
> Until then, from a checkout of the [Volt repository](https://github.com/volt-js/volt),
> after `pnpm build`: `node packages/create-volt/bin/create-volt.js my-app`.

## Templates

| Template | What you get |
| --- | --- |
| `minimal` | One component, its template, a stylesheet and a test. |
| `router-query` | Nested routes and a shared server-state cache. |
| `server-render` | Server rendering, per-route rendering modes and server functions, from `volt({ serverRender: true })`. |

Pick one up front with `--template`, or answer the prompt.

```bash
pnpm create @voltdev/volt my-app --template minimal
```

A template is only offered when everything it installs is on npm. `router-query`
needs `@voltdev/router` and `@voltdev/query`, and `start` needs those and
`@voltdev/server`, none of which have shipped yet — the CLI says so rather than
generating a project that cannot install.

## Options

| Option | |
| --- | --- |
| `-t, --template <id>` | Which template to start from |
| `--name <name>` | Package name. Defaults to the directory name, made legal |
| `--force` | Write into a directory that is not empty |
| `-y, --yes` | Take every default; ask nothing |
| `-h, --help` | Show usage |
| `-v, --version` | Print the version |

Nothing is asked when stdin is not a terminal, so this is safe to run from a
script or a CI job.

## What the generated project can do

`pnpm dev`, `pnpm build`, `pnpm preview`, `pnpm test`, `pnpm typecheck` — all
working from the first commit, before anything has been written.

## Versions

The generated `package.json` is not checked in anywhere; it is built from a
single table that restates what the Volt workspace itself is on, and a test
fails the moment the two disagree. A project scaffolded today is on the same
versions as the framework that scaffolded it.
