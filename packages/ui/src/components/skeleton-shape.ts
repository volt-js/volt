import { Component, Prop, Signal } from '@voltdev/core';
import type { SkeletonShape } from './skeleton.js';

/**
 * One box of a placeholder, for a placeholder made of more than one kind.
 *
 * `<v-skeleton>` draws its own boxes from `shape` and `count`, which covers a
 * paragraph and an avatar. A card is neither: it is a circle, then two lines,
 * then a block, and no pair of props describes that. So the placeholder is a
 * slot, and this is what goes in it.
 *
 * ```html
 * <v-skeleton :loading="pending">
 *   <template :slot-placeholder>
 *     <v-skeleton-shape shape="circle" width="2.5rem"></v-skeleton-shape>
 *     <v-skeleton-shape shape="text"></v-skeleton-shape>
 *     <v-skeleton-shape shape="text" data-trailing></v-skeleton-shape>
 *   </template>
 *   <article>…</article>
 * </v-skeleton>
 * ```
 *
 * It registers with nothing and needs no skeleton around it, because a box has
 * no behaviour to coordinate — which is also why it may be written anywhere a
 * shape is wanted, and why it hides itself from a reader rather than trusting
 * the placeholder it is usually inside to have done it.
 */
@Component({ selector: 'v-skeleton-shape', templateUrl: './skeleton-shape.html' })
export class VSkeletonShape {
  /** Which shape this box is. */
  @Prop() shape = new Signal.State<SkeletonShape>('text');
  /** Any CSS length — `12rem`, `60%`. A circle's diameter. */
  @Prop() width = new Signal.State<string | undefined>(undefined);
  /** Any CSS length, likewise. A circle takes its height from `width`. */
  @Prop() height = new Signal.State<string | undefined>(undefined);
}
