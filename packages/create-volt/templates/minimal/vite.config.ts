import { defineConfig } from 'vite';
import { volt } from '@voltdev/vite-plugin';

export default defineConfig({
  // `volt()` does two things Vite cannot do on its own: lower TC39 standard
  // decorators, which no engine implements yet, and compile templates at
  // build time so the compiler never reaches the browser.
  plugins: [volt()],
  build: {
    target: 'esnext',
  },
});
