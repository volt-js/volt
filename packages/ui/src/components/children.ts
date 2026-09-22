import { Signal, measureEffect, onCleanup } from '@voltdev/core';

/**
 * The children that registered with a tag, in the order they are drawn in.
 *
 * A component written inside another — a column in a table, an option in a
 * select — finds its parent through context and registers with it while its
 * fields initialize. That is the order the children are *built* in, which is
 * the order they were written, until a `:for` among them grows: a child
 * written after the loop was built before the loop's new children, and
 * registered before them.
 *
 * Their elements land correctly regardless, because placing them is the DOM's
 * job. So once the DOM has been written this asks it. The measure lane is
 * where a read of the DOM belongs, and a write from it comes back through the
 * render lane in the same flush, so nothing is ever painted out of order.
 *
 * A server has no measure lane and needs none: nothing is added to a page it
 * has already rendered, so registration order is the order there.
 */
export class TagChildren<T> {
  /** Every child that has registered, in the order they are drawn. */
  readonly all = new Signal.State<readonly T[]>([]);

  /**
   * @param parent    The element the children's own elements are placed in.
   * @param elementOf Where a child put the element that marks its place.
   */
  constructor(
    private readonly parent: () => Element | null,
    private readonly elementOf: (child: T) => Element | null,
  ) {
    measureEffect(() => this.reorder());
  }

  /** Called by a child while it initializes; it leaves when its scope does. */
  add(child: T): void {
    this.all.set([...this.all.get(), child]);
    onCleanup(() => this.remove(child));
  }

  remove(child: T): void {
    this.all.set(this.all.get().filter((each) => each !== child));
  }

  private reorder(): void {
    const children = this.all.get();
    const parent = this.parent();
    if (!parent || children.length < 2) return;

    const order = [...parent.children];
    const sorted = [...children].sort((a, b) => {
      const left = this.elementOf(a);
      const right = this.elementOf(b);
      const at = left ? order.indexOf(left) : -1;
      const to = right ? order.indexOf(right) : -1;
      // An element that is not in the parent yet says nothing about where its
      // child goes, so the pair keeps the order it had.
      return at < 0 || to < 0 ? 0 : at - to;
    });
    if (sorted.some((child, at) => child !== children[at])) this.all.set(sorted);
  }
}
