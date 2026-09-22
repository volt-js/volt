import { defineConfig } from 'vitest/config';
import { volt } from '@voltdev/vite-plugin';

export default defineConfig({
  // The same plugin the application is built with, so a test runs the
  // component that ships rather than a differently-compiled copy of it.
  plugins: [volt()],
  test: {
    environment: 'happy-dom',
  },
});
