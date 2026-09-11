# create-volt

`create-volt` generates a new project from one of three templates.

::: warning Not on npm yet
`@voltdev/create-volt` is not published, so `pnpm create volt` does not work
yet. From a checkout of the Volt repository it runs as below, and it can
generate the `minimal` template today. The other two are built and tested but
refused, for the reason given [under availability](#availability).
:::

```bash
# from a checkout of the Volt repository, after `pnpm build`
node packages/create-volt/bin/create-volt.js my-app --template minimal
```

Once it is published this becomes `pnpm create volt my-app`.

## Options

```
create-volt [directory] [options]
```

| Option | Description |
|---|---|
| `directory` | Where to write the project. Asked for, or `volt-app` |
| `-t`, `--template <id>` | Which template. Asked for, or `minimal` |
| `--name <name>` | The package name. Defaults to the directory's name |
| `--force` | Write into a directory that is not empty |
| `-y`, `--yes` | Take every default and ask nothing |
| `-h`, `--help` | Show the usage, with each template and whether it is available |
| `-v`, `--version` | Print the version |

Questions are asked only when both ends of the conversation are a terminal.
Piped input is a script, and a script stopped by a prompt it cannot see has hung
rather than failed — so without a terminal, or with `--yes`, every default is
taken and nothing is asked.

A directory that already has files in it is refused unless `--force` is given,
and a name npm would reject is refused before anything is written.

## The templates

Every template ships the same toolchain — the Vite plugin, TypeScript, Vite,
Vitest, happy-dom and Sass — because a project that cannot run its own test is
not a starting point. Each comes with a test in `src/app.test.ts`, and the
generated project has `pnpm dev`, `pnpm test`, `pnpm typecheck` and `pnpm build`.

Each template is type-checked as generated, and every file carrying a
`@Server()` method is run through the build's server-function pass, so a
template cannot fail on a user's first `vite build` for a reason a test could
have seen.

### `minimal`

One component, its template, a stylesheet and a test. `vite.config.ts` has
`volt()` and nothing else.

```
index.html  src/main.ts  src/app.ts  src/app.html  src/app.scss
src/styles.scss  src/app.test.ts  vite.config.ts  vitest.config.ts
tsconfig.json  README.md  .gitignore
```

### `router-query`

Nested routes and a shared server-state cache: a shell with an outlet and a
navigation, a list of users and a user page reached by `/users/:id`, with the
data behind them in [the query cache](./query). Uses
[`@voltdev/router`](./router) and `@voltdev/query`.

### `start`

[Start mode](./start): server rendering, per-route rendering modes and server
functions, wired by one line of configuration — `volt({ start: true })`.

Its three routes use all three modes: a home page built once, a pricing page
rendered per request with the value the server settled on carried to the client
in the page, and a dashboard the server does not render at all. A template that
demonstrated only server rendering would demonstrate half of the promise; the
point is that the choice survives route by route.

`server.ts` is the deployable entry — a `(Request) => Promise<Response>` with no
`node:` import, which is the shape an edge host expects. `src/volt-start.d.ts`
declares the two virtual modules the plugin generates, so the project
type-checks without the plugin running. Delete `start: true` and it becomes an
ordinary client-rendered project with nothing else to change.

**It does not run as a server yet.** Its dev server renders every page in the
browser, its build produces the client alone, and its server entry cannot load
its router on a server — see [the status of start mode](./start).

## Availability

A template can only be generated if every Volt package it depends on is on npm.
Today that is `@voltdev/core` and `@voltdev/vite-plugin`, so:

| Template | Needs | Generated today |
|---|---|---|
| `minimal` | core, vite-plugin | Yes |
| `router-query` | core, vite-plugin, router, query | No |
| `start` | core, vite-plugin, router, query, server | No |

The refusal is deliberate and applies from a checkout too. The generated project
lives outside the Volt repository, so its `pnpm install` resolves from npm — and
a project that cannot install is worse than no project, because it fails after
the reader has already chosen it. So `--help` marks the unavailable templates,
the interactive chooser leaves them out, and naming one with `--template` is
refused with the packages it is waiting for.

The list is `PUBLISHED_PACKAGES` in `src/versions.ts`: the packages a template
can name that the release workflow publishes. (The release also publishes
`@voltdev/reactivity` and `@voltdev/compiler`, which no template names — they
arrive with core and the plugin.) When a package is released, adding it there is
the whole change, and the templates that needed it become available.

Until then, `router-query` and `start` are best read in the repository, under
`packages/create-volt/templates/`, and tried from inside it, where every package
resolves from the workspace.

## What it writes

The template's files, with two changes. `__PROJECT_NAME__` is replaced by the
project name everywhere it appears — the page title, the README, the heading.
And `gitignore` is written as `.gitignore`: npm strips a `.gitignore` out of a
published package, so the template has to store it under another name.

`package.json` is generated rather than copied, with every dependency pinned to
the version range this release of `create-volt` was tested against.

## What it does not do

- **It does not install dependencies.** It prints the command, so the choice of
  package manager and the moment the network is used stay the reader's.
- **It does not initialise git.**
- **There is no way to add a template.** The three are part of the package; a
  template from a URL or a local directory is not supported.
