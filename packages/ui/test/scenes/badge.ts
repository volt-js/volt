import { compileTemplate } from '@voltdev/core/jit';
import { Component, Signal } from '@voltdev/core';
import { createBadge } from '@voltdev/primitives';
import { show, step, type Scene } from '../scene.ts';

/**
 * `badge.html` written out once per shape the sheet tells apart: a count on
 * a button's corner, a dot on another's, and a count with nothing around it,
 * which stands in line. The three tones are on three of them, since a tone and
 * a shape are drawn by rules that know nothing about each other.
 *
 * `data-tone` and `data-dot` are the component's, written here as it writes
 * them; everything else on each badge is the primitive's bag. A count a
 * component would hide without its primitive's help — no count, and no dot —
 * is left out: what the sheet sees there is the primitive's own `data-empty`,
 * which the count at zero reaches.
 */
@Component({
  selector: 'v-styled-badge',
  render: compileTemplate(`
    <div>
      <span class="volt-badge-anchor">
        <button type="button">Inbox</button>
        <span class="volt-badge" data-tone="danger" :spread="inbox.badgeProps()">{ inbox.text() }</span>
      </span>

      <span class="volt-badge-anchor">
        <button type="button">Ada</button>
        <span class="volt-badge" data-tone="accent" data-dot="" :spread="presence.badgeProps()"></span>
      </span>

      <span class="volt-badge-anchor">
        <span class="volt-badge" data-tone="neutral" :spread="drafts.badgeProps()">{ drafts.text() }</span>
      </span>
    </div>
  `),
})
class StyledBadge {
  unread = new Signal.State<number | null>(3);
  inbox = createBadge({ count: this.unread, describes: 'unread messages', max: 99 });
  presence = createBadge({ describes: 'Online' });
  drafts = createBadge({ defaultCount: 2, describes: 'drafts' });
}

export const scene: Scene = (look) => {
  const { unread } = show(StyledBadge);
  // A count, a dot and a count standing on its own, all showing.
  look();
  // Past the cap, which the text says and nothing is drawn differently for,
  // and then at zero, which is the badge still on the page and off the screen.
  step(() => unread.set(150));
  look();
  step(() => unread.set(0));
  look();
};
