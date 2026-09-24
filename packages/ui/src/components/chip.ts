import { Component, Prop, Signal, measureEffect, onCleanup } from '@voltdev/core';
import { createChip, type Chip, type ChipProps } from '@voltdev/primitives';

/** The hue a chip is drawn in. Emphasis only: it is never spoken. */
export type ChipTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

/**
 * A flag, as a tag is able to deliver one.
 *
 * Written bare it is on, and bound it is whatever it was bound to. Written as
 * an attribute it is a string, and every string is truthy — so
 * `removable="false"` was a chip drawing its button and answering Delete,
 * the one thing the caller had said not to do. Every string is on here but
 * `"false"`, which nobody writes meaning on.
 */
function flag(value: boolean): boolean {
  // Typed as a flag and handed a string all the same: the type is what the
  // tag promises, and an attribute is what it delivers.
  const written: unknown = value;
  return written !== false && written !== 'false' && written !== null && written !== undefined;
}

/**
 * A tag in a set: its words, and when it can be removed, a button that asks.
 *
 * ```html
 * <div class="tags">
 *   <v-chip :for="tag in tags.get()" :key="tag" removable :onRemove="() => drop(tag)">
 *     { tag }
 *   </v-chip>
 * </div>
 * ```
 *
 * The chip only asks. Delete, Backspace and the button all end in `onRemove`,
 * and taking the tag out of the page's list is the page's to do — a chip whose
 * `onRemove` does nothing stays where it is. What the chip does do first is
 * move focus, because the primitive does: to the chip after it, else the one
 * before, else the element holding them, so a keyboard user whose tag has
 * gone is left among the others rather than at the top of the document. Those
 * are found in the DOM, among the chip's siblings, so the chips of one set
 * belong in one element, each with a `:key`.
 *
 * A removable chip is the tab stop and the button never is — ten tags cost
 * ten Tab presses, not twenty — which is why the keys on the chip do the
 * button's job. A chip that cannot be removed is no tab stop at all, since a
 * stop with nothing to do is one more press between a keyboard user and the
 * next thing that does something; it can still be focused, because it is
 * where focus goes when the removable chip beside it is taken away. The button
 * is named after the chip, `Remove Ada`, from the words inside it, or from
 * `label` when those words are not a name: an avatar, an icon, a count.
 *
 * What a caller writes on the tag lands on the chip, the element that takes
 * focus and carries the primitive's props. It has no role of its own, so a
 * set written as a list gives each one `role="listitem"` there.
 */
@Component({ selector: 'v-chip', templateUrl: './chip.html' })
export class VChip {
  /**
   * Draw the button, and answer Delete and Backspace. Off by default: a tag
   * that can be taken away is the kind a page has to handle. Written bare —
   * `removable` — or bound; `removable="false"` is the false it says.
   *
   * Read once, while the fields initialize — plain, because the primitive is
   * built with it and a signal would promise a caller they could change it
   * later while the chip went on answering with what it was built with.
   */
  @Prop() removable = false;
  /**
   * Called when the chip asks to be removed, after focus has left it. Drop the
   * tag from your list and the chip goes; do nothing and it stays.
   */
  @Prop() onRemove?: () => void;
  /**
   * What the button is named after, when the words inside the chip do not
   * name it. Unset or empty, the words themselves.
   */
  @Prop() label = new Signal.State<string | undefined>(undefined);
  /** `sm`, or `md` for the size that sits beside a line of body text. */
  @Prop() size = new Signal.State<'sm' | 'md'>('md');
  /** The hue of the words and the edge. Emphasis: the words carry the meaning. */
  @Prop() tone = new Signal.State<ChipTone>('neutral');

  /** The chip, which is what the primitive finds its siblings from. */
  element = new Signal.State<Element | null>(null);
  /** Around the words, which the button's name is read from. */
  words = new Signal.State<Element | null>(null);

  /** The words' text, kept current for as long as it is what names the button. */
  private readonly text = new Signal.State('');

  /** `removable`, read as the flag it is however the tag spelled it. */
  private readonly removes = flag(this.removable);

  /**
   * The primitive, built from the props above — which is why props have to be
   * there while a field initializes.
   */
  readonly chip: Chip = createChip({
    chip: () => this.element.get(),
    label: () => this.label.get() || this.text.get(),
    removable: this.removes,
    focusable: this.removes,
    // Read when it is called, so a callback the page rebinds is the one heard.
    onRemove: () => this.onRemove?.(),
  });

  constructor() {
    // Only a chip with a button has a name to keep. Watched rather than read
    // once, because a tag renamed in place — `{ tag.name }` under a `:key`
    // that stays — changes a text node and nothing a signal could say, and a
    // button still named after the old words removes a tag nobody can see.
    // The measure lane is where a read of the DOM belongs; a server has none,
    // so there the name is `label`'s alone.
    if (!this.removes) return;

    let watching: Element | null = null;
    let observer: MutationObserver | null = null;
    onCleanup(() => observer?.disconnect());

    measureEffect(() => {
      // Nothing to watch while `label` names it, and the words are read again
      // the moment it stops.
      const words = this.label.get() ? null : this.words.get();
      if (words !== watching) {
        observer?.disconnect();
        observer = null;
        watching = words;
        const view = words?.ownerDocument.defaultView;
        if (words && view) {
          observer = new view.MutationObserver(() => this.read(words));
          observer.observe(words, { childList: true, characterData: true, subtree: true });
        }
      }
      if (words) this.read(words);
    });
  }

  /**
   * What the chip carries: the primitive's, and for a chip it leaves out of
   * the tab order, `tabindex="-1"`. The primitive moves focus to a neighbour
   * by calling `focus()` on it, which does nothing on an element that cannot
   * take focus — so without this, removing the chip beside a fixed one would
   * leave focus on a chip that is about to go, and then on `<body>`.
   */
  chipProps(): ChipProps {
    const own = this.chip.chipProps();
    return own['tabindex'] === undefined ? { ...own, tabindex: '-1' } : own;
  }

  private read(words: Element): void {
    this.text.set(words.textContent?.trim() ?? '');
  }
}
