import { router } from './router.js';
import './styles.scss';

const root = document.querySelector('#app');
if (!root) throw new Error('No #app to mount into');

// Matches the current URL, mounts it, and starts listening. Awaited, so the
// first paint has its loaders and its data already in place.
await router.start(root);
