import { mount, provideOutlet } from '@voltdev/core';
import { provideRouter } from '@voltdev/router';
import { router } from './router.js';
import { Shell } from './shell.js';
import './styles.scss';

const root = document.querySelector('#app');
if (!root) throw new Error('No #app to mount into');

// The application mounts its own root; the router fills the outlet in it. The
// two providers go in `setup` because the scope the shell renders in is
// created inside `mount` — provided out here they would reach nothing.
mount(Shell, root, {
  setup: () => {
    provideRouter(router);
    provideOutlet(router.outletAt(0));
  },
});

// Matches the current URL and starts listening. Awaited, so the first paint
// has its loaders and its data already in place.
await router.start();
