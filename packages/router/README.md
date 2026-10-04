# @voltdev/router

Routing for Volt. Nested routes and layouts that stay mounted, parameters
typed from the route table, and a navigation that finishes loading before
anything on screen moves.

```bash
pnpm add @voltdev/router@alpha
```

> **Not on npm yet.** The command above is what installs it once it is released.
> Until then it works from a checkout of the [Volt repository](https://github.com/volt-js/volt) —
> see [what is on npm](https://voltjs.dev/guide/getting-started#what-is-on-npm).

```ts
// router.ts
import { createRouter, defineRoutes, type LoaderArgs } from '@voltdev/router';
import { Home } from './home.js';

export const routes = defineRoutes([
  {
    path: '/',
    children: [
      { index: true, component: Home },
      {
        path: 'users/:id',
        component: () => import('./user.js'),
        loader: ({ params, signal }: LoaderArgs<'/users/:id'>) =>
          fetch(`/api/users/${params.id}`, { signal }).then((r) => r.json()),
      },
    ],
  },
]);

export const router = createRouter({ routes });
```

The application mounts its own root, and the router fills the outlet in it:

```ts
// main.ts
import { mount, provideOutlet } from '@voltdev/core';
import { provideRouter } from '@voltdev/router';
import { router } from './router.js';
import { Shell } from './shell.js';

mount(Shell, '#app', {
  setup: () => {
    provideRouter(router);
    provideOutlet(router.outletAt(0));
  },
});

await router.start();
```

A layout marks where its child goes with `:outlet`, and keeps its instance,
its state and its DOM while the child changes:

```html
<nav>…</nav>
<main :outlet></main>
```

A route reads its own loader's result and its own parameters, each on its own
signal — a component showing `:id` is not woken when only another parameter
changes:

```ts
import { Component } from '@voltdev/core';
import { routeData } from '@voltdev/router';
import { router } from './router.js';

@Component({ selector: 'v-user', templateUrl: './user.html' })
export class User {
  user = routeData<{ name: string }>();
  id = () => router.param('id');
}
```

Links are ordinary anchors. `<a href="/users/7">` previews in the status bar,
opens in a new tab on middle-click and is followed by a crawler; the router
intercepts only the plain left-click that would otherwise reload the page.

> **Pre-alpha.** Published under the `alpha` tag; the API is still moving.

Documentation: [voltjs.dev/reference/router](https://voltjs.dev/reference/router)
