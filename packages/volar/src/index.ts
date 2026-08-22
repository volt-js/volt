/**
 * Editor support for Volt templates, as a Volar language plugin.
 *
 * What a host has to do with this: build an index, point it at the project,
 * create the plugin, and hand it to whichever Volar integration it is —
 * a language server, a tsserver plugin, or a test.
 *
 *     const index = createTemplateIndex();
 *     await index.scan(projectRoot);
 *     const plugin = createVoltLanguagePlugin({
 *       index,
 *       toFileName: (uri) => uri.fsPath,
 *       fromFileName: (file) => URI.file(file),
 *     });
 *
 * and then, whenever a `.ts` file changes, `plugin.moduleChanged(language,
 * file, text)` so a component that has just started pointing at a template is
 * noticed.
 */

export { createTemplateIndex, exportedName } from './templates.js';
export type { ComponentBinding, TemplateIndex, TemplateIndexOptions } from './templates.js';

export { generateTemplateModule } from './virtual.js';
export type { GeneratedTemplate } from './virtual.js';

export { createVoltLanguagePlugin, textSnapshot } from './plugin.js';
export type {
  VoltLanguagePlugin,
  VoltLanguagePluginOptions,
  VoltVirtualCode,
} from './plugin.js';
