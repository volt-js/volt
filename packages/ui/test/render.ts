/**
 * Compile a component's real template, the way a build would.
 *
 * These components hold their markup in `.html` files, which is the only way
 * Volt allows. A build compiles those; this suite has no build, so it reads
 * the same file and registers the render function the plugin would have
 * written, leaving everything else about the component as it is — its
 * selector, its props, and the class itself.
 */
import { defineComponent, getComponentConfig, type ComponentType } from '@voltdev/core';
import { compileTemplate } from '@voltdev/core/jit';

import buttonHtml from '../src/components/button.html?raw';
import dialogHtml from '../src/components/dialog.html?raw';
import optionHtml from '../src/components/option.html?raw';
import selectHtml from '../src/components/select.html?raw';
import tableHtml from '../src/components/table.html?raw';
import tableColumnHtml from '../src/components/table-column.html?raw';
import { VButton } from '../src/components/button.js';
import { VDialog } from '../src/components/dialog.js';
import { VOption } from '../src/components/option.js';
import { VSelect } from '../src/components/select.js';
import { VTable } from '../src/components/table.js';
import { VTableColumn } from '../src/components/table-column.js';

const TEMPLATES: ReadonlyArray<readonly [ComponentType<unknown>, string]> = [
  [VButton as ComponentType<unknown>, buttonHtml],
  [VDialog as ComponentType<unknown>, dialogHtml],
  [VSelect as ComponentType<unknown>, selectHtml],
  [VOption as ComponentType<unknown>, optionHtml],
  [VTable as ComponentType<unknown>, tableHtml],
  [VTableColumn as ComponentType<unknown>, tableColumnHtml],
];

let compiled = false;

/** Give every component its compiled template, once per run. */
export function compileComponents(): void {
  if (compiled) return;
  compiled = true;

  for (const [component, html] of TEMPLATES) {
    const config = getComponentConfig(component)!;
    defineComponent(
      component,
      { ...config, render: compileTemplate(html, config.selector) },
      propsOf(component),
    );
  }
}

/** The props the class declared, kept across the re-registration. */
function propsOf(component: ComponentType<unknown>): { property: string; alias: string }[] {
  const metadata = (component as { [Symbol.metadata]?: Record<symbol, unknown> })[Symbol.metadata];
  const props = metadata
    ? (Object.getOwnPropertySymbols(metadata)
        .map((key) => metadata[key])
        .find(Array.isArray) as { property: string; alias: string }[] | undefined)
    : undefined;
  return props ?? [];
}

export { VButton, VDialog, VOption, VSelect, VTable, VTableColumn };
