import { compileTemplate } from '@voltdev/core/jit';
import { Component, Signal } from '@voltdev/core';
import { createClipboard, createCode } from '@voltdev/primitives';
import { clear, show, step, type Scene } from '../scene.ts';

/**
 * `code.html`, both shapes of it, with the primitive's props spread on each.
 *
 * Nothing between the tags inside the `<pre>`, as there is nothing in the
 * component's: a `<pre>` keeps the whitespace written in it, and the
 * indentation of a template would be drawn as code.
 *
 * Which of the three a block draws is held here as signals, standing in for
 * the component's props; the gutter's lines are read from the source the
 * block holds, where the component reads them from the page.
 */
@Component({
  selector: 'v-styled-code',
  render: compileTemplate(`
    <div>
      <p>Call <code class="volt-code" :spread="inline.codeProps()">Array.prototype.at</code> with a
        negative index.</p>

      <pre :ref="pre" class="volt-code-block"
           :attr-data-wrap="wrap.get() ? '' : undefined"
           :attr-data-line-numbers="numbered.get() ? '' : undefined"
           :spread="sample.preProps()"
      ><code class="volt-code-content" :spread="sample.codeProps()">{ source }</code><span
           :if="numbered.get()" class="volt-code-lines" aria-hidden="true"
      ><span :for="line in lines()" :key="$index" class="volt-code-line"
      ><span class="volt-code-line-text">{ line }</span></span></span><button
           :if="copies.get()" class="volt-code-copy" aria-label="Copy code"
           :spread="clipboard.triggerProps()"
      >{ clipboard.isCopied() ? 'Copied' : 'Copy code' }</button></pre>
    </div>
  `),
})
class StyledCode {
  source = 'const total = items\n  .map((item) => item.price)\n  .reduce((sum, price) => sum + price, 0);\n';

  pre = new Signal.State<Element | null>(null);
  wrap = new Signal.State(false);
  numbered = new Signal.State(false);
  copies = new Signal.State(false);

  inline = createCode({ language: () => 'JavaScript' });
  sample = createCode({ block: true, pre: () => this.pre.get(), language: () => 'TypeScript' });
  clipboard = createClipboard({ text: () => this.source });

  lines(): readonly string[] {
    const lines = this.source.split('\n');
    if (lines[lines.length - 1] === '') lines.pop();
    return lines;
  }
}

export const scene: Scene = (look) => {
  // Inline and a plain block first, then a block taking on each of the three
  // things it can be asked for, which are rules of their own on the `<pre>`
  // and on the parts the last two put inside it. The region a block becomes
  // while it scrolls has no rule but the focus ring, which is not a state a
  // scene drives.
  const code = show(StyledCode);
  look();
  step(() => code.wrap.set(true));
  look();
  step(() => code.numbered.set(true));
  look();
  step(() => code.copies.set(true));
  look();
  clear();
};
