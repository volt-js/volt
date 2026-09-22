/**
 * The live demos on the component pages, built as one small Volt application.
 *
 * Each demo is a real component — a class, its template, its stylesheet —
 * compiled by the same plugin an application uses, so what a reader sees
 * running is what they would get. The page beneath each frame shows those
 * same files, included by VitePress at build time, so the code on the page and
 * the code in the frame cannot drift apart.
 *
 * They run in a frame rather than in the page, and the reason is the cascade.
 * `@voltdev/ui` puts every rule in a layer so that an application's own CSS
 * beats it without `!important`, and the documentation theme's base styles are
 * unlayered — so inside the page, `button { padding: 0 }` would beat every
 * styled button, and the demo would show a component nobody's application
 * looks like.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { volt } from '@voltdev/vite-plugin';
import { stylesheet } from '@voltdev/ui';

const here = import.meta.dirname;

/**
 * Write the styled layer to a file, the way its reference page tells an
 * application to: generated once, imported like any other stylesheet.
 */
function uiStylesheet(): Plugin {
  return {
    name: 'volt-docs:ui-stylesheet',
    buildStart() {
      const dir = resolve(here, '.generated');
      mkdirSync(dir, { recursive: true });
      writeFileSync(resolve(dir, 'volt-ui.css'), stylesheet());
    },
  };
}

export default defineConfig({
  root: here,
  // Served from the site's `public/` directory, so it is copied into the
  // built site as it stands and served beside the pages.
  base: './',
  plugins: [uiStylesheet(), volt()],
  build: {
    target: 'esnext',
    outDir: resolve(here, '../public/demos'),
    emptyOutDir: true,
  },
});
