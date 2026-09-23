import { compileTemplate } from '@voltdev/core/jit';
import { Component, Signal } from '@voltdev/core';
import { createPagination } from '@voltdev/primitives';
import { show, type Scene } from '../scene.ts';

/** Ten pages, which is enough for the primitive to leave some out. */
const ITEMS = 100;

/**
 * `pagination.html` in its button form, without first and last.
 *
 * The sheet selects on classes and on the state the primitive writes, never
 * on the element or on which control it is, so the link form and the two
 * extra controls `showFirstLast` adds reach no rule these do not.
 */
@Component({
  selector: 'v-styled-pagination',
  render: compileTemplate(`
    <nav class="volt-pagination" :spread="pager.navProps()">
      <ul :ref="list" class="volt-pagination-list" :spread="pager.listProps()">
        <li class="volt-pagination-item">
          <button type="button" class="volt-pagination-control" :spread="pager.controlProps('previous')">‹</button>
        </li>

        <li :for="entry in pager.pages()" :key="entry.key" class="volt-pagination-item">
          <span :if="entry.type === 'ellipsis'" class="volt-pagination-ellipsis"
                :spread="pager.ellipsisProps()">…</span>
          <button :else type="button" class="volt-pagination-page" :spread="pager.pageProps(entry.page)">{ entry.page }</button>
        </li>

        <li class="volt-pagination-item">
          <button type="button" class="volt-pagination-control" :spread="pager.controlProps('next')">›</button>
        </li>
      </ul>

      <p class="volt-pagination-status" :spread="pager.statusProps()">{ pager.announcement() }</p>
    </nav>
  `),
})
class StyledPagination {
  list = new Signal.State<Element | null>(null);
  pager = createPagination({ list: () => this.list.get(), total: () => ITEMS });
}

export const scene: Scene = (look) => {
  show(StyledPagination);
  // The first page holds every state the sheet draws at once: the page
  // itself and the others, the ellipsis for the pages left out, and a control
  // at each end, the one going back dead and the one going forward live. A
  // middle page and the last one are these again, in other places.
  look();
};
