import { defineConfig } from 'vite';
import { volt } from '@voltdev/vite-plugin';

/**
 * One-effect-per-row codegen, off unless asked for.
 *
 * An environment variable rather than a second config, because the two builds
 * have to be identical in every other respect for the comparison between them
 * to mean anything — and two files drift.
 */
const groupRowBindings = process.env['VOLT_GROUP_ROWS'] === '1';

export default defineConfig({
  plugins: [volt({ groupRowBindings })],
  build: { target: 'esnext' },
});
