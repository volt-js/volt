import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'Volt',
  description:
    'A TypeScript UI framework: class components, ":"-prefixed templates, TC39 signals, no virtual DOM.',
  lang: 'en-US',
  cleanUrls: true,
  lastUpdated: true,

  head: [['link', { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }]],

  // Absolute URLs in the sitemap, and canonical links on every page.
  sitemap: { hostname: 'https://voltjs.dev' },

  // Maintainer notes that live next to the docs but are not part of them.
  srcExclude: ['DEPLOY.md', 'design/**'],

  themeConfig: {
    logo: { light: '/logo.svg', dark: '/logo-dark.svg' },
    nav: [
      { text: 'Guide', link: '/guide/introduction' },
      { text: 'Reference', link: '/reference/template-syntax' },
      { text: 'Components', link: '/reference/primitives' },
    ],

    // Grouped by what a reader is trying to do rather than by package: a page
    // about routing sits beside the cache and the server functions it is used
    // with, not in an alphabetical list of fifteen names.
    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'Introduction', link: '/guide/introduction' },
          { text: 'Getting started', link: '/guide/getting-started' },
          { text: 'Components', link: '/guide/components' },
          { text: 'Reactivity', link: '/guide/reactivity' },
          { text: 'Templates', link: '/guide/templates' },
          { text: 'Lists and conditionals', link: '/guide/lists-and-conditionals' },
          { text: 'Props, callbacks, slots', link: '/guide/composition' },
        ],
      },
      {
        text: 'Core',
        items: [
          { text: 'Template syntax', link: '/reference/template-syntax' },
          { text: 'Reactivity API', link: '/reference/reactivity' },
          { text: 'Component API', link: '/reference/component' },
          { text: 'Developer tools', link: '/reference/devtools' },
        ],
      },
      {
        text: 'Rendering',
        items: [
          { text: 'Server rendering', link: '/reference/server' },
          { text: 'The serverRender option', link: '/reference/server-render' },
        ],
      },
      {
        text: 'Routing and data',
        items: [
          { text: 'Router', link: '/reference/router' },
          { text: 'Query cache', link: '/reference/query' },
          { text: 'Server functions', link: '/reference/server-functions' },
        ],
      },
      {
        text: 'Components',
        items: [
          {
            text: 'Primitives',
            link: '/reference/primitives',
            items: [
              { text: 'Overlays', link: '/reference/primitives-overlays' },
              { text: 'Forms', link: '/reference/primitives-forms' },
              { text: 'Selection and dates', link: '/reference/primitives-selection' },
              { text: 'Collections and navigation', link: '/reference/primitives-collections' },
              { text: 'Display and feedback', link: '/reference/primitives-display' },
              { text: 'Data and locale', link: '/reference/primitives-data' },
            ],
          },
          { text: 'Components and the sheet', link: '/reference/ui' },
          { text: 'Form components', link: '/reference/ui-forms' },
          { text: 'Overlay components', link: '/reference/ui-overlays' },
          { text: 'Navigation components', link: '/reference/ui-navigation' },
          { text: 'Data components', link: '/reference/ui-data' },
          { text: 'Data grid', link: '/reference/grid' },
          { text: 'Rich-text editor', link: '/reference/editor' },
        ],
      },
      {
        text: 'Tooling',
        items: [
          { text: 'Vite plugin', link: '/reference/vite-plugin' },
          { text: 'create-volt', link: '/reference/create-volt' },
          { text: 'The volt command', link: '/reference/cli' },
          { text: 'Editor support', link: '/reference/volar' },
          { text: 'Testing', link: '/reference/testing' },
        ],
      },
      {
        text: 'Internals',
        items: [
          { text: 'How the compiler works', link: '/guide/compiler' },
          { text: 'Design decisions', link: '/guide/design-decisions' },
          { text: 'Error codes', link: '/e/' },
        ],
      },
    ],

    search: { provider: 'local' },

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2026 Hardik Viradiya',
    },
  },

  markdown: {
    theme: { light: 'github-light', dark: 'github-dark' },
  },
});
