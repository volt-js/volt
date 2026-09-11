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
import { createRouter, defineRoutes, routeData, type LoaderArgs } from '@voltdev/router';

const routes = defineRoutes([
  {
    path: '/',
    component: Shell,
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
await router.start(document.querySelector('#app')!);
```

A layout renders its child wherever it puts an outlet, and keeps its instance,
its state and its DOM while the child changes:

```html
<nav>…</nav>
<div data-volt-outlet></div>
```

A route reads its own loader's result and its own parameters, each on its own
signal — a component showing `:tab` is not woken when `:id` changes:

```ts
class UserPage {
  user = routeData<User>();
  tab = () => router.param('tab');
}
```

Links are ordinary anchors. `<a href="/users/7">` previews in the status bar,
opens in a new tab on middle-click and is followed by a crawler; the router
intercepts only the plain left-click that would otherwise reload the page.

> **Pre-alpha.** Published under the `alpha` tag; the API is still moving.

Documentation: [voltjs.dev](https://voltjs.dev)
