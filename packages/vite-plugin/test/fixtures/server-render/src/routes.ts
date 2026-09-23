import { defineRoutes } from '@voltdev/router';
import { currentPlan } from './api.js';
import { Broken } from './broken.js';
import { Home } from './home.js';
import { Pricing } from './pricing.js';
import { Shell } from './shell.js';

export const routes = defineRoutes([
  {
    path: '/',
    component: Shell,
    children: [
      { index: true, component: Home },
      { path: 'pricing', component: Pricing, loader: () => currentPlan() },
      { path: 'broken', component: Broken },
    ],
  },
]);
