/**
 * Slices going into documents: the rule that joins one in, and the fitting
 * that makes one join.
 *
 * A slice is a fragment cut open at its edges (node.ts has the class). Putting
 * one between two positions is three different questions, and this file
 * answers them in layers, each on the one below.
 *
 * **The join rule** — `joinSlice`, which is what `ReplaceStep.apply` is. The
 * slice's open start is joined onto the node `from` is in, its open end onto
 * the node `to` is in, and everything between is replaced. That is only
 * defined when the open depths make up the difference between the two ends:
 * `$from.depth - openStart` must equal `$to.depth - openEnd`, which is the
 * depth at which the slice's closed content sits. Deleting from the middle of
 * one paragraph to the middle of the next is the empty slice at equal depths,
 * and the two halves join into the first paragraph; pasting "the end of one
 * paragraph and the start of another" is a slice open by one at each end, and
 * each half joins the text it lands beside. Each joined node keeps the type of
 * the node on the left, and is checked against the schema as it is rebuilt, so
 * the rule refuses — with a reason — rather than produce a document the schema
 * forbids: a join between nodes that share no content, depths that do not line
 * up, a slice open deeper than the position it goes into.
 *
 * **The fitting rule** — `fitSlice`, for a slice that does not line up. A paste
 * is the common case: a list pasted into the middle of a paragraph is open by
 * three at each end and lands at depth one. Fitting walks the slice's content
 * from the left and places each node at the deepest open position that will
 * take it, closing the open nodes it moves out of — filling them where the
 * schema requires a child — wrapping it where it can only go inside something
 * (a list item in a list, bare text in a paragraph), opening it further when
 * only its content fits, and dropping it when nothing will take it at all.
 * What is after `to` is then joined back on at the deepest level the content
 * after it can follow what was placed. The result is a slice that lines up,
 * which the join rule applies. This is ProseMirror's `Fitter`, in this model's
 * terms.
 *
 * It stops short of ProseMirror in one place, and says so: when the last
 * placed block is still open and the text after `to` sits at a different
 * depth, that text stays in its own block rather than being pulled up into the
 * last pasted one. Pulling it up moves content the replacement does not cover,
 * and a step that moves content without collapsing every position inside it
 * is a different step — ProseMirror's `ReplaceAroundStep` — which this change
 * layer does not have.
 *
 * **The placing rule** — `placeSlice`, which is what a paste asks for. Fitting
 * alone would pour a pasted heading's text into the paragraph the caret is in,
 * even when that paragraph is empty and the heading could simply replace it.
 * So when the selection covers whole blocks, the replaced range is widened
 * over them and the slice is tried closed down to each of its depths, starting
 * from its first `defining` block — a list item, a heading — so structure the
 * schema calls defining is put in whole wherever there is room for it.
 */

import { contentMatchAt } from './content.js';
import type { ContentMatch } from './content.js';
import { Mark, type Attrs } from './mark.js';
import { Fragment, Node, Slice } from './node.js';
import { resolve } from './position.js';
import type { ResolvedPos } from './position.js';
import type { NodeType } from './schema.js';
import type { StepResult } from './step.js';

/**
 * A join refused partway down the tree, thrown so the recursion need not carry
 * a result at every level, and turned back into a refusal at the top. It never
 * escapes this file.
 */
class Refused extends Error {}

/**
 * Apply a slice between two positions under the join rule, or say why not.
 *
 * Positions outside the document throw, as they do everywhere else: a step
 * written for some other document is not a refusal of this one.
 */
export function joinSlice(doc: Node, from: number, to: number, slice: Slice): StepResult {
  const $from = resolve(doc, from);
  const $to = resolve(doc, to);

  if (!wellFormed(slice)) return { ok: false, reason: malformed };
  if (slice.openStart > $from.depth) {
    return {
      ok: false,
      reason: `the slice is open ${slice.openStart} deep, deeper than position ${from} it goes into`,
    };
  }
  if ($from.depth - slice.openStart !== $to.depth - slice.openEnd) {
    return {
      ok: false,
      reason:
        `a slice open ${slice.openStart} and ${slice.openEnd} deep cannot join ends at depths ` +
        `${$from.depth} and ${$to.depth}; fitSlice finds one that can`,
    };
  }

  try {
    return { ok: true, doc: replaceOuter($from, $to, slice, 0) };
  } catch (error) {
    if (error instanceof Refused) return { ok: false, reason: error.message };
    throw error;
  }
}

const malformed = 'the slice says it is open deeper than its content goes';

/** Whether a slice's content goes as deep as its open depths say it is cut. */
function wellFormed(slice: Slice): boolean {
  return opensAsDeep(slice.content, slice.openStart, 'start') && opensAsDeep(slice.content, slice.openEnd, 'end');
}

function opensAsDeep(fragment: Fragment, depth: number, side: 'start' | 'end'): boolean {
  let content = fragment;
  for (let i = 0; i < depth; i++) {
    const node = side === 'start' ? content.firstChild : content.lastChild;
    if (!node || node.isLeaf) return false;
    content = node.content;
  }
  return true;
}

/**
 * Descend while both ends are inside the same child and the slice's content
 * still sits lower down; that child is the only thing rebuilt at this level.
 */
function replaceOuter($from: ResolvedPos, $to: ResolvedPos, slice: Slice, depth: number): Node {
  const index = $from.index(depth);
  const node = $from.node(depth);
  if (index === $to.index(depth) && depth < $from.depth - slice.openStart) {
    const inner = replaceOuter($from, $to, slice, depth + 1);
    return node.copy(node.content.replaceChild(index, inner));
  }
  if (slice.content.size === 0) return close(node, replaceTwoWay($from, $to, depth));
  if (slice.openStart === 0 && slice.openEnd === 0 && $from.depth === depth && $to.depth === depth) {
    const content = $from.parent.content;
    return close(
      $from.parent,
      content.cut(0, $from.parentOffset).append(slice.content).append(content.cut($to.parentOffset)),
    );
  }
  const { start, end } = sliceAlong(slice, $from);
  return close(node, replaceThreeWay($from, start, end, $to, depth));
}

/** Rebuild a node with new content, refusing content its type forbids. */
function close(node: Node, content: Fragment): Node {
  if (!node.type.validContent(content)) throw new Refused(`${node.type.name} cannot hold that content`);
  return node.copy(content);
}

function checkJoin(main: Node, sub: Node): void {
  if (!sub.type.compatibleContent(main.type)) {
    throw new Refused(`a ${sub.type.name} cannot be joined onto a ${main.type.name}`);
  }
}

/** The node at `depth` on the left of a join, once it is known the right one can join it. */
function joinable($before: ResolvedPos, $after: ResolvedPos, depth: number): Node {
  const node = $before.node(depth);
  checkJoin(node, $after.node(depth));
  return node;
}

/**
 * The children of the node at `depth` between two positions, each whole —
 * except text cut by a position at this very depth, which is cut. A child the
 * position is deeper inside is the one being joined, and is not added here.
 */
function addRange($start: ResolvedPos | null, $end: ResolvedPos | null, depth: number, target: Node[]): void {
  const node = ($end ?? $start)!.node(depth);
  let startIndex = 0;
  const endIndex = $end ? $end.index(depth) : node.childCount;
  if ($start) {
    startIndex = $start.index(depth);
    if ($start.depth > depth) {
      startIndex++;
    } else if ($start.textOffset) {
      target.push($start.nodeAfter!);
      startIndex++;
    }
  }
  for (let i = startIndex; i < endIndex; i++) target.push(node.child(i));
  if ($end && $end.depth === depth && $end.textOffset) target.push($end.nodeBefore!);
}

/** Content at `depth` with the range between the two positions taken out, the two sides joined. */
function replaceTwoWay($from: ResolvedPos, $to: ResolvedPos, depth: number): Fragment {
  const content: Node[] = [];
  addRange(null, $from, depth, content);
  if ($from.depth > depth) {
    const type = joinable($from, $to, depth + 1);
    content.push(close(type, replaceTwoWay($from, $to, depth + 1)));
  }
  addRange($to, null, depth, content);
  return Fragment.from(content);
}

/**
 * Content at `depth` with the slice — resolved as `$start`..`$end` in a
 * document of its own — put between the two positions, its open sides joined
 * onto what is either side.
 */
function replaceThreeWay(
  $from: ResolvedPos,
  $start: ResolvedPos,
  $end: ResolvedPos,
  $to: ResolvedPos,
  depth: number,
): Fragment {
  const openStart = $from.depth > depth ? joinable($from, $start, depth + 1) : null;
  const openEnd = $to.depth > depth ? joinable($end, $to, depth + 1) : null;

  const content: Node[] = [];
  addRange(null, $from, depth, content);
  if (openStart && openEnd && $start.index(depth) === $end.index(depth)) {
    checkJoin(openStart, openEnd);
    content.push(close(openStart, replaceThreeWay($from, $start, $end, $to, depth + 1)));
  } else {
    if (openStart) content.push(close(openStart, replaceTwoWay($from, $start, depth + 1)));
    addRange($start, $end, depth, content);
    if (openEnd) content.push(close(openEnd, replaceTwoWay($end, $to, depth + 1)));
  }
  addRange($to, null, depth, content);
  return Fragment.from(content);
}

/**
 * The slice set inside copies of `$along`'s ancestors, so its two ends can be
 * resolved at the same depths as the positions they join — the walk above
 * then reads both sides with one set of arithmetic.
 */
function sliceAlong(slice: Slice, $along: ResolvedPos): { start: ResolvedPos; end: ResolvedPos } {
  const extra = $along.depth - slice.openStart;
  let node = $along.node(extra).copy(slice.content);
  for (let i = extra - 1; i >= 0; i--) node = $along.node(i).copy(Fragment.from(node));
  return {
    start: resolve(node, slice.openStart + extra),
    end: resolve(node, node.content.size - slice.openEnd - extra),
  };
}

/** A replacement that lines up, or why none was found. */
export type FitResult =
  | { readonly ok: true; readonly from: number; readonly to: number; readonly slice: Slice }
  | { readonly ok: false; readonly reason: string };

/**
 * A replacement of `from`..`to` that puts `slice`'s content in under the join
 * rule, closing, wrapping, opening or dropping what does not line up as given.
 *
 * A slice the join rule already accepts is returned untouched: fitting only
 * ever changes a slice the rule would refuse. The range returned can be wider
 * than the one asked for, when what is left after `to` is joined on from the
 * end of the block it was in rather than from inside it.
 */
export function fitSlice(doc: Node, from: number, to: number, slice: Slice): FitResult {
  if (!wellFormed(slice)) return { ok: false, reason: malformed };
  if (from === to && slice.size === 0) return { ok: false, reason: 'there is nothing to replace' };
  if (joinSlice(doc, from, to, slice).ok) return { ok: true, from, to, slice };
  return new Fitter(resolve(doc, from), resolve(doc, to), slice).fit();
}

/** One open node on the right edge of what has been placed, and what it may take next. */
interface Frontier {
  readonly type: NodeType;
  match: ContentMatch;
}

/** Where some of the unplaced content can go, and what has to be put in first. */
interface Fittable {
  readonly sliceDepth: number;
  readonly frontierDepth: number;
  readonly parent: Node | null;
  readonly inject: Fragment | null;
  readonly wrap: readonly NodeType[] | null;
}

/**
 * The placing walk.
 *
 * `frontier` is the stack of open nodes along the right edge of what has been
 * placed so far — it starts as the path to `$from` and moves forward as
 * content goes in. `placed` is that content, open on the left exactly as deep
 * as `$from` and on the right as deep as the frontier. `unplaced` is what is
 * left of the slice. Each round places what it can, and when nothing of the
 * slice's first open node fits anywhere it either opens that node further,
 * so its content can be tried, or drops it.
 */
class Fitter {
  private readonly frontier: Frontier[] = [];
  private placed: Fragment = Fragment.empty;
  private unplaced: Slice;
  /** Whether there was anything to put in, and whether any of it went. */
  private readonly hadContent: boolean;
  private placedAny = false;

  constructor(
    private readonly $from: ResolvedPos,
    private readonly $to: ResolvedPos,
    unplaced: Slice,
  ) {
    this.unplaced = unplaced;
    this.hadContent = unplaced.size > 0;
    for (let i = 0; i <= $from.depth; i++) {
      const node = $from.node(i);
      this.frontier.push({ type: node.type, match: contentMatchAt(node, $from.indexAfter(i)) });
    }
    for (let i = $from.depth; i > 0; i--) this.placed = Fragment.from($from.node(i).copy(this.placed));
  }

  private get depth(): number {
    return this.frontier.length - 1;
  }

  fit(): FitResult {
    while (this.unplaced.size > 0) {
      const fittable = this.findFittable();
      if (fittable) this.placeNodes(fittable);
      else if (!this.openMore()) this.dropNode();
    }

    const $to = this.close(this.$to);
    if (!$to) return { ok: false, reason: 'what follows the range cannot follow what was put in it' };

    // The outer nodes both ends are open into are the same nodes the document
    // already has there, so they are dropped from the slice rather than joined
    // onto themselves.
    let content = this.placed;
    let openStart = this.$from.depth;
    let openEnd = $to.depth;
    while (openStart > 0 && openEnd > 0 && content.childCount === 1) {
      content = content.firstChild!.content;
      openStart--;
      openEnd--;
    }

    // A slice all of whose content was dropped is refused even over a range:
    // a paste of nothing that fits is not a deletion of what it was pasted
    // over.
    const slice = new Slice(content, openStart, openEnd);
    if ((this.hadContent && !this.placedAny) || (slice.size === 0 && this.$from.pos === this.$to.pos)) {
      return { ok: false, reason: 'the slice has nothing that fits here' };
    }
    return { ok: true, from: this.$from.pos, to: $to.pos, slice };
  }

  /**
   * The shallowest piece of the slice's left edge that some open node will
   * take, searching from the deepest open node outwards.
   *
   * The first pass takes only what fits as it is, or after nodes the schema
   * can create to go before it; the second allows wrapping. Wrapping is the
   * last resort because it adds structure the paste did not have.
   */
  private findFittable(): Fittable | null {
    for (let pass = 1; pass <= 2; pass++) {
      for (let sliceDepth = this.unplaced.openStart; sliceDepth >= 0; sliceDepth--) {
        let fragment: Fragment;
        let parent: Node | null = null;
        if (sliceDepth > 0) {
          parent = contentAt(this.unplaced.content, sliceDepth - 1).firstChild!;
          fragment = parent.content;
        } else {
          fragment = this.unplaced.content;
        }
        const first = fragment.firstChild;

        for (let frontierDepth = this.depth; frontierDepth >= 0; frontierDepth--) {
          const { type, match } = this.frontier[frontierDepth]!;
          if (pass === 1) {
            if (first) {
              if (match.matchType(first.type)) return { sliceDepth, frontierDepth, parent, inject: null, wrap: null };
              const inject = match.fillBefore(Fragment.from(first), false);
              if (inject) return { sliceDepth, frontierDepth, parent, inject, wrap: null };
            } else if (parent && type.compatibleContent(parent.type)) {
              return { sliceDepth, frontierDepth, parent, inject: null, wrap: null };
            }
          } else if (first) {
            const wrap = match.findWrapping(first.type);
            if (wrap) return { sliceDepth, frontierDepth, parent, inject: null, wrap };
          }
          // The slice's own node fits here, so its content belongs inside it
          // rather than further out.
          if (parent && match.matchType(parent.type)) break;
        }
      }
    }
    return null;
  }

  /** Treat the slice's first open node as open one level deeper, so its content is tried. */
  private openMore(): boolean {
    const { content, openStart, openEnd } = this.unplaced;
    const inner = contentAt(content, openStart);
    if (inner.childCount === 0 || inner.firstChild!.isLeaf) return false;
    const atEnd = inner.size + openStart >= content.size - openEnd;
    this.unplaced = new Slice(content, openStart + 1, Math.max(openEnd, atEnd ? openStart + 1 : 0));
    return true;
  }

  /** Give up on the slice's first node at its open depth: nothing will take it or its content. */
  private dropNode(): void {
    const { content, openStart, openEnd } = this.unplaced;
    const inner = contentAt(content, openStart);
    if (inner.childCount <= 1 && openStart > 0) {
      const openAtEnd = content.size - openStart <= openStart + inner.size;
      this.unplaced = new Slice(dropFromFragment(content, openStart - 1, 1), openStart - 1, openAtEnd ? openStart - 1 : openEnd);
    } else {
      this.unplaced = new Slice(dropFromFragment(content, openStart, 1), openStart, openEnd);
    }
  }

  /**
   * Move as many of the nodes at `sliceDepth` as fit into the open node at
   * `frontierDepth`, closing the open nodes below it first and opening any
   * wrappers.
   */
  private placeNodes({ sliceDepth, frontierDepth, parent, inject, wrap }: Fittable): void {
    while (this.depth > frontierDepth) this.closeFrontierNode();
    if (wrap) for (const type of wrap) this.openFrontierNode(type);

    const depth = this.depth;
    const slice = this.unplaced;
    const fragment = parent ? parent.content : slice.content;
    const openStart = slice.openStart - sliceDepth;
    const { type } = this.frontier[depth]!;
    let { match } = this.frontier[depth]!;
    const add: Node[] = [];
    if (inject) {
      inject.forEach((node) => add.push(node));
      match = match.matchFragment(inject)!;
    }

    // How many levels of the last node taken are open at the slice's end:
    // zero is the node itself, negative is none.
    let openEndCount = fragment.size + sliceDepth - (slice.content.size - slice.openEnd);
    let taken = 0;
    let lastAdded: Node | null = null;
    while (taken < fragment.childCount) {
      const next = fragment.child(taken);
      const matches = match.matchType(next.type);
      if (!matches) break;
      taken++;
      // An open node with nothing in it brings nothing, and would only leave
      // an empty block behind.
      if (taken > 1 || openStart === 0 || next.content.size > 0) {
        match = matches;
        lastAdded = closeNodeStart(
          next.mark(type.allowedMarks(next.marks)),
          taken === 1 ? openStart : 0,
          taken === fragment.childCount ? openEndCount : -1,
        );
        add.push(lastAdded);
      }
    }
    const toEnd = taken === fragment.childCount;
    if (!toEnd) openEndCount = -1;
    if (add.length > 0) this.placedAny = true;

    this.placed = addToFragment(this.placed, depth, Fragment.from(add));
    this.frontier[depth]!.match = match;

    // The slice's node was the same type as the open one and is now used up:
    // its end was not open, so neither is the frontier's.
    if (toEnd && openEndCount < 0 && parent && parent.type === this.frontier[this.depth]!.type && this.frontier.length > 1) {
      this.closeFrontierNode();
    }

    // The nodes left open at the end become the new frontier. They are read
    // from what was placed, which has had its start closed, so their content
    // is a valid start for their type.
    if (lastAdded && taken === fragment.childCount) {
      let node: Node = lastAdded;
      for (let i = 0; i < openEndCount; i++) {
        this.frontier.push({ type: node.type, match: matchAfter(node) });
        node = node.lastChild!;
      }
    }

    this.unplaced = !toEnd
      ? new Slice(dropFromFragment(slice.content, sliceDepth, taken), slice.openStart, slice.openEnd)
      : sliceDepth === 0
        ? Slice.empty
        : new Slice(
            dropFromFragment(slice.content, sliceDepth - 1, 1),
            sliceDepth - 1,
            openEndCount < 0 ? slice.openEnd : sliceDepth - 1,
          );
  }

  /**
   * The deepest level at which what follows `$to` can follow what was placed,
   * with every level above it able to end where it is.
   *
   * `move` is where the replacement then ends: `$to` itself, or — when `$to`
   * is at the very end of the nodes below that level — after them, so those
   * now-empty nodes go with the replacement rather than being left behind.
   */
  private findCloseLevel($to: ResolvedPos): { depth: number; fit: Fragment; move: ResolvedPos } | null {
    scan: for (let i = Math.min(this.depth, $to.depth); i >= 0; i--) {
      const { match, type } = this.frontier[i]!;
      const dropInner = i < $to.depth && $to.end(i + 1) === $to.pos + ($to.depth - (i + 1));
      const fit = contentAfterFits($to, i, type, match, dropInner);
      if (!fit) continue;
      for (let d = i - 1; d >= 0; d--) {
        const outer = this.frontier[d]!;
        const matches = contentAfterFits($to, d, outer.type, outer.match, true);
        if (!matches || matches.childCount > 0) continue scan;
      }
      return { depth: i, fit, move: dropInner ? resolve($to.doc, $to.after(i + 1)) : $to };
    }
    return null;
  }

  /** Close the frontier down to where `$to` joins, then open it back up along `$to`'s path. */
  private close($to: ResolvedPos): ResolvedPos | null {
    const level = this.findCloseLevel($to);
    if (!level) return null;

    while (this.depth > level.depth) this.closeFrontierNode();
    if (level.fit.childCount > 0) this.placed = addToFragment(this.placed, level.depth, level.fit);
    const $end = level.move;
    for (let d = level.depth + 1; d <= $end.depth; d++) {
      const node = $end.node(d);
      const add = node.type.contentMatch.fillBefore(node.content, true, $end.index(d)) ?? Fragment.empty;
      this.openFrontierNode(node.type, node.attrs, add);
    }
    return $end;
  }

  /** Open a node of `type` at the frontier, unchecked — it is open, so it is not finished yet. */
  private openFrontierNode(type: NodeType, attrs: Attrs | null = null, content: Fragment = Fragment.empty): void {
    const top = this.frontier[this.depth]!;
    top.match = top.match.matchType(type) ?? top.match;
    const node = new Node(type, attrs ?? type.defaultAttrs, content, Mark.none);
    this.placed = addToFragment(this.placed, this.depth, Fragment.from(node));
    this.frontier.push({ type, match: type.contentMatch.matchFragment(content) ?? type.contentMatch });
  }

  /** Close the innermost open node, adding what its type requires at its end. */
  private closeFrontierNode(): void {
    const open = this.frontier.pop()!;
    const add = open.match.fillBefore(Fragment.empty, true);
    if (add && add.childCount > 0) this.placed = addToFragment(this.placed, this.frontier.length, add);
  }
}

/** The match after a node's own content, or its start when that content is not a valid start. */
function matchAfter(node: Node): ContentMatch {
  return node.type.contentMatch.matchFragment(node.content) ?? node.type.contentMatch;
}

function dropFromFragment(fragment: Fragment, depth: number, count: number): Fragment {
  if (depth === 0) return Fragment.from(fragment.content.slice(count));
  const first = fragment.firstChild!;
  return fragment.replaceChild(0, first.copy(dropFromFragment(first.content, depth - 1, count)));
}

function addToFragment(fragment: Fragment, depth: number, content: Fragment): Fragment {
  if (depth === 0) return fragment.append(content);
  const last = fragment.lastChild!;
  return fragment.replaceChild(fragment.childCount - 1, last.copy(addToFragment(last.content, depth - 1, content)));
}

/** The content `depth` levels down the first-child edge of a fragment. */
function contentAt(fragment: Fragment, depth: number): Fragment {
  let content = fragment;
  for (let i = 0; i < depth; i++) content = content.firstChild!.content;
  return content;
}

/**
 * A node whose start was cut open, with what its type requires at the start
 * put back — and at the end too, when its end was not open either.
 */
function closeNodeStart(node: Node, openStart: number, openEnd: number): Node {
  if (openStart <= 0) return node;
  let content = node.content;
  if (openStart > 1) {
    content = content.replaceChild(
      0,
      closeNodeStart(content.firstChild!, openStart - 1, content.childCount === 1 ? openEnd - 1 : 0),
    );
  }
  content = (node.type.contentMatch.fillBefore(content) ?? Fragment.empty).append(content);
  if (openEnd <= 0) {
    const after = node.type.contentMatch.matchFragment(content)?.fillBefore(Fragment.empty, true);
    if (after) content = content.append(after);
  }
  return node.copy(content);
}

/**
 * What would have to go before the content after `$to` at `depth` for it to
 * follow `match` in a node of `type`, or null when nothing would do.
 */
function contentAfterFits(
  $to: ResolvedPos,
  depth: number,
  type: NodeType,
  match: ContentMatch,
  open: boolean,
): Fragment | null {
  const node = $to.node(depth);
  const index = open ? $to.indexAfter(depth) : $to.index(depth);
  if (index === node.childCount && !type.compatibleContent(node.type)) return null;
  const fit = match.fillBefore(node.content, true, index);
  if (!fit) return null;
  for (let i = index; i < node.childCount; i++) if (!type.allowsMarks(node.child(i).marks)) return null;
  return fit;
}

/**
 * A replacement for a selection from `from` to `to` that puts `slice` in the
 * way a paste should: whole where the selection covers whole blocks and the
 * slice's first block is one the schema calls defining, fitted otherwise.
 *
 * Every candidate is checked against the join rule before it is returned, so
 * a result is always one a `ReplaceStep` will take.
 */
export function placeSlice(doc: Node, from: number, to: number, slice: Slice): FitResult {
  if (!wellFormed(slice)) return { ok: false, reason: malformed };
  if (slice.size === 0) return fitSlice(doc, from, to, slice);

  const $from = resolve(doc, from);
  const $to = resolve(doc, to);
  if (fitsTrivially($from, $to, slice)) return { ok: true, from, to, slice };

  // Depths at which the selection covers a whole node, which the replacement
  // may be widened to replace. A negative depth means "from the start of that
  // node to `to`", widening only the left side.
  const targetDepths = coveredDepths($from, $to);
  if (targetDepths[targetDepths.length - 1] === 0) targetDepths.pop();
  let preferredTarget = -($from.depth + 1);
  targetDepths.unshift(preferredTarget);
  for (let d = $from.depth, pos = $from.pos - 1; d > 0; d--, pos--) {
    if ($from.node(d).type.spec.defining) break;
    if (targetDepths.includes(d)) preferredTarget = d;
    else if ($from.before(d) === pos) targetDepths.splice(1, 0, -d);
  }
  const preferredTargetIndex = targetDepths.indexOf(preferredTarget);

  const leftNodes: Node[] = [];
  let preferredDepth = slice.openStart;
  for (let content = slice.content, i = 0; ; i++) {
    const node = content.firstChild!;
    leftNodes.push(node);
    if (i === slice.openStart) break;
    content = node.content;
  }

  // Back up over defining blocks at the top of the slice, so a list item or a
  // heading is tried whole before its text is.
  for (let d = preferredDepth - 1; d >= 0; d--) {
    const leftNode = leftNodes[d]!;
    const defining = leftNode.type.spec.defining === true;
    if (defining && !leftNode.sameMarkup($from.node(Math.abs(preferredTarget) - 1))) preferredDepth = d;
    else if (defining || !leftNode.type.isTextblock) break;
  }

  for (let j = slice.openStart; j >= 0; j--) {
    const openDepth = (j + preferredDepth + 1) % (slice.openStart + 1);
    const insert = leftNodes[openDepth];
    if (!insert) continue;
    for (let i = 0; i < targetDepths.length; i++) {
      let targetDepth = targetDepths[(i + preferredTargetIndex) % targetDepths.length]!;
      let expand = true;
      if (targetDepth < 0) {
        expand = false;
        targetDepth = -targetDepth;
      }
      const parent = $from.node(targetDepth - 1);
      const index = $from.index(targetDepth - 1);
      if (!canReplaceWith(parent, index, insert)) continue;
      const fit = checked(
        doc,
        fitSlice(
          doc,
          $from.before(targetDepth),
          expand ? $to.after(targetDepth) : to,
          new Slice(closeFragment(slice.content, 0, slice.openStart, openDepth, null), openDepth, slice.openEnd),
        ),
      );
      if (fit.ok) return fit;
    }
  }

  // Nothing went in whole: fit the slice as it is, widening the range over
  // each covered block in turn until something goes.
  let start = from;
  let end = to;
  let last: FitResult = { ok: false, reason: 'the slice has nothing that fits here' };
  for (let i = targetDepths.length - 1; i >= 0; i--) {
    last = checked(doc, fitSlice(doc, start, end, slice));
    if (last.ok) return last;
    const depth = targetDepths[i]!;
    if (depth < 0) continue;
    start = $from.before(depth);
    end = $to.after(depth);
  }
  return last;
}

/** A fit the join rule takes, or a refusal saying why it did not. */
function checked(doc: Node, fit: FitResult): FitResult {
  if (!fit.ok) return fit;
  const result = joinSlice(doc, fit.from, fit.to, fit.slice);
  return result.ok ? fit : { ok: false, reason: result.reason };
}

function fitsTrivially($from: ResolvedPos, $to: ResolvedPos, slice: Slice): boolean {
  if (slice.openStart > 0 || slice.openEnd > 0 || !$from.sameParent($to)) return false;
  const content = $from.parent.content;
  return $from.parent.type.validContent(
    content.cut(0, $from.parentOffset).append(slice.content).append(content.cut($to.parentOffset)),
  );
}

/** The depths, deepest first, at which the range covers the whole content of a node. */
function coveredDepths($from: ResolvedPos, $to: ResolvedPos): number[] {
  const result: number[] = [];
  const minDepth = Math.min($from.depth, $to.depth);
  for (let d = minDepth; d >= 0; d--) {
    const start = $from.start(d);
    if (start < $from.pos - ($from.depth - d) || $to.end(d) > $to.pos + ($to.depth - d)) break;
    if (
      start === $to.start(d) ||
      (d === $from.depth &&
        d === $to.depth &&
        $from.parent.inlineContent &&
        $to.parent.inlineContent &&
        d > 0 &&
        $to.start(d - 1) === start - 1)
    ) {
      result.push(d);
    }
  }
  return result;
}

/** Whether `node` could go in before `parent`'s child at `index`, with the rest still valid after it. */
function canReplaceWith(parent: Node, index: number, node: Node): boolean {
  const start = contentMatchAt(parent, index).matchType(node.type);
  const end = start?.matchFragment(parent.content, index);
  return end !== null && end !== undefined && end.validEnd && parent.type.allowsMarks(node.marks);
}

/**
 * A fragment whose left edge, open `oldOpen` deep, is closed down to
 * `newOpen`: each node on the edge below that is given what its type requires
 * at its start and end.
 */
function closeFragment(fragment: Fragment, depth: number, oldOpen: number, newOpen: number, parent: Node | null): Fragment {
  let content = fragment;
  if (depth < oldOpen) {
    const first = content.firstChild!;
    content = content.replaceChild(0, first.copy(closeFragment(first.content, depth + 1, oldOpen, newOpen, first)));
  }
  if (depth > newOpen && parent) {
    const match = contentMatchAt(parent, 0);
    const start = (match.fillBefore(content) ?? Fragment.empty).append(content);
    const end = match.matchFragment(start)?.fillBefore(Fragment.empty, true);
    content = end ? start.append(end) : start;
  }
  return content;
}
