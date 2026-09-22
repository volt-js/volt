/**
 * The page every demo frame loads: `?d=<name>&theme=light|dark`.
 *
 * One page rather than one per demo, so a new demo is a directory and nothing
 * else — `<name>/<name>.ts` exporting the component, beside its template.
 * Each demo is still its own chunk, so a frame loads only the demo it shows.
 */
import './.generated/volt-ui.css';
import './demo.scss';
import { isComponent, mount, type ComponentType } from '@voltdev/core';

const params = new URLSearchParams(location.search);
const name = params.get('d') ?? '';

/** Light or dark, following the documentation's own switch. */
function applyTheme(theme: string | null): void {
  document.documentElement.dataset['theme'] = theme === 'dark' ? 'dark' : 'light';
}

applyTheme(params.get('theme'));
window.addEventListener('message', (event: MessageEvent) => {
  const data = event.data as { type?: string; theme?: string } | null;
  if (data?.type === 'volt-demo-theme') applyTheme(data.theme ?? null);
});

/** Tell the frame how tall the demo is, whenever that changes. */
function reportHeight(): void {
  const height = Math.ceil(document.documentElement.getBoundingClientRect().height);
  parent.postMessage({ type: 'volt-demo-size', name, height }, '*');
}

const demos = import.meta.glob<Record<string, unknown>>('./*/*.ts');
const load = demos[`./${name}/${name}.ts`];
const app = document.querySelector('#app')!;

if (!load) {
  app.textContent = `No demo called "${name}".`;
} else {
  const module = await load();
  const component = Object.values(module).find(isComponent) as ComponentType<unknown> | undefined;
  if (component) mount(component, app);
  else app.textContent = `The demo "${name}" exports no component.`;
}

new ResizeObserver(reportHeight).observe(document.body);
reportHeight();
