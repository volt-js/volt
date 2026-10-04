# @voltdev/volar

A [Volar](https://volarjs.dev) language plugin for Volt templates. Given an
`.html` file that some component's `templateUrl` points at, it restates the
template's expressions as TypeScript typed against that component's class, and
gives Volar a table saying which characters of the restatement came from which
characters of the template. Completion, hover, go-to-definition, rename and
errors inside the template are then the TypeScript service answering against
the restatement, with every answer mapped back. It is a library for an editor
integration to load: no extension, language server or tsserver plugin ships
with it yet, and until one does, [`volt check`](https://www.npmjs.com/package/@voltdev/cli)
is how a template's expressions get checked.

```bash
pnpm add @voltdev/volar@alpha @volar/language-core
```

> **Not on npm yet.** The command above is what installs it once it is released.
> Until then it works from a checkout of the [Volt repository](https://github.com/volt-js/volt) —
> see [what is on npm](https://voltjs.dev/guide/getting-started#what-is-on-npm).

`@volar/language-core` is a peer dependency: the integration loading the plugin
already has a copy, and the plugin uses that one rather than bringing its own.
The package runs in Node 22 or later, as an editor's language server does.

A host builds an index of which class owns which template, creates the plugin
over it, and hands the plugin to its Volar integration:

```ts
import { createTemplateIndex, createVoltLanguagePlugin } from '@voltdev/volar';

const index = createTemplateIndex();
await index.scan('/work/my-app/src');

const plugin = createVoltLanguagePlugin<string>({
  index,
  toFileName: (scriptId) => scriptId,
  fromFileName: (fileName) => fileName,
});
```

`T` is whatever the integration identifies a script by — a path in tsserver, a
URI in a language server — and the two functions translate between that and a
path on disk. When a `.ts` file changes, the host calls
`plugin.moduleChanged(language, file, text)`, so a component that has just
started pointing at a template is noticed.

> **Pre-alpha.** Published under the `alpha` tag; the API is still moving.

Documentation: [voltjs.dev/reference/volar](https://voltjs.dev/reference/volar)
