/**
 * One place for the sentences that have nowhere to appear.
 *
 * A sort order changed, a filter matched nine rows, a value was copied, the
 * date grid moved to another month, a message arrived. Every one of those is
 * an event a sighted user reads off the screen and a screen-reader user is
 * told about or misses entirely, and none of them has a natural piece of
 * markup to live in — the sentence exists only to be announced.
 *
 * `feedback.ts` already owns the rule this rests on: a live region has to be
 * on the page *before* the words are, because a screen reader announces what
 * changes inside a region rather than what a region arrives holding. What it
 * does not own is sharing. Each of its components mounts a region of its own,
 * which is right for a component that renders a message a user can also see,
 * and wrong for an event that renders nothing: a page with a sort header, a
 * pager and a copy button would grow three regions, and three regions that
 * speak at once clip each other.
 *
 * So there are exactly two regions per document — polite and assertive,
 * because politeness is fixed when a region is created and cannot be changed
 * afterwards — mounted on first use and kept for the life of the page, which
 * is the shape that pays the timing delay once instead of on every message.
 *
 * Nothing here renders. A component calls `announce` and returns props as
 * usual; the region is not its markup and not its consumer's.
 */

/**
 * Long enough for the region to be observed before anything is written into
 * it, and short enough that the sentence still belongs to the action that
 * caused it. Matches `feedback.ts`, which arrived at it for the same reason.
 */
const REGION_READY_DELAY = 50;

/**
 * How long a sentence stays in the region before it is cleared.
 *
 * It has to be cleared. A region still holding the last sentence is read out
 * again by some screen readers when focus enters it, and it makes an identical
 * later message indistinguishable from the one already there.
 */
const CLEAR_AFTER = 7000;

export type AnnouncePriority = 'polite' | 'assertive';

export interface AnnounceOptions {
  /**
   * `polite` waits for a pause, which is what almost everything wants.
   * `assertive` interrupts whatever is being read, and is for the cases where
   * carrying on would waste the user's time — an error that stopped the thing
   * they asked for.
   */
  priority?: AnnouncePriority;
  /** Milliseconds before the sentence is cleared. */
  clearAfter?: number;
}

interface Region {
  element: Element;
  /**
   * Two children, written to alternately.
   *
   * A screen reader announces a *change*, and setting a text node to the
   * string it already holds is not one — so announcing "3 results" twice in a
   * row would be heard once. Swapping which of two children carries the words
   * makes the second announcement a real mutation.
   */
  slots: [Element, Element];
  next: 0 | 1;
  ready: boolean;
  pending: { message: string; clearAfter: number } | null;
  clearTimer: ReturnType<typeof setTimeout> | null;
}

const regions = new WeakMap<Document, Partial<Record<AnnouncePriority, Region>>>();

/**
 * Off the screen but not out of the accessibility tree.
 *
 * `display: none` and `visibility: hidden` remove a region from the tree
 * entirely and it announces nothing; a zero size with `overflow: hidden` and
 * a clip is the shape that stays announceable.
 */
const HIDDEN =
  'position:absolute;width:1px;height:1px;margin:-1px;padding:0;' +
  'overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0';

function regionFor(document: Document, priority: AnnouncePriority): Region {
  const byPriority = regions.get(document) ?? {};
  const existing = byPriority[priority];
  if (existing && existing.element.isConnected) return existing;

  const element = document.createElement('div');
  // The role and the `aria-live` say the same thing deliberately: the role is
  // what older assistive technology reads, the attribute is what the rest do.
  element.setAttribute('role', priority === 'assertive' ? 'alert' : 'status');
  element.setAttribute('aria-live', priority);
  // The region speaks whole sentences, so a partial update should still be
  // read as one. And it carries no name: `aria-label` on a live region is
  // announced *instead of* its contents in some screen readers, which for a
  // message region loses the message.
  element.setAttribute('aria-atomic', 'true');
  element.setAttribute('data-volt-announcer', priority);
  element.setAttribute('style', HIDDEN);

  const slots: [Element, Element] = [document.createElement('div'), document.createElement('div')];
  for (const slot of slots) element.append(slot);
  document.body.append(element);

  const region: Region = { element, slots, next: 0, ready: false, pending: null, clearTimer: null };

  // The words wait for the region rather than the region for the words. A
  // message announced in the same mutation that created the region is not
  // announced at all, which is the failure this whole module exists to avoid.
  setTimeout(() => {
    region.ready = true;
    if (region.pending !== null) {
      const { message, clearAfter } = region.pending;
      region.pending = null;
      write(region, message, clearAfter);
    }
  }, REGION_READY_DELAY);

  byPriority[priority] = region;
  regions.set(document, byPriority);
  return region;
}

function write(region: Region, message: string, clearAfter: number): void {
  const slot = region.slots[region.next];
  const other = region.slots[region.next === 0 ? 1 : 0];
  other.textContent = '';
  slot.textContent = message;
  region.next = region.next === 0 ? 1 : 0;

  if (region.clearTimer !== null) clearTimeout(region.clearTimer);
  region.clearTimer = setTimeout(() => {
    for (const each of region.slots) each.textContent = '';
    region.clearTimer = null;
  }, clearAfter);
}

/**
 * Say something that has no place on the screen.
 *
 * Safe to call from anywhere a component runs, including before the page has
 * settled: the first call mounts the region and the sentence follows it. An
 * empty message is ignored rather than clearing the region, because "announce
 * nothing" is almost always a value that failed to arrive.
 */
export function announce(message: string, options: AnnounceOptions = {}): void {
  // No document is a server render, and an announcement is a client event by
  // construction: it says that something just changed for someone watching.
  // This package guards the server this way throughout rather than reaching
  // for the build flag, which only `@voltdev/core` and its consumers define.
  if (message === '' || typeof document === 'undefined') return;

  const region = regionFor(document, options.priority ?? 'polite');
  if (!region.ready) {
    // Only the last one. A burst before the region is ready is a burst nobody
    // could have heard in order anyway, and reading all of them would bury the
    // one that is still true.
    region.pending = { message, clearAfter: options.clearAfter ?? CLEAR_AFTER };
    return;
  }
  write(region, message, options.clearAfter ?? CLEAR_AFTER);
}

/**
 * Forget the regions for this document.
 *
 * One page keeps its regions for its lifetime, so this exists for tests, where
 * many documents' worth of announcements share one global and a region left
 * behind would make the next case pass on the last one's sentence.
 */
export function resetAnnouncer(): void {
  if (typeof document === 'undefined') return;
  const byPriority = regions.get(document);
  if (!byPriority) return;
  for (const region of Object.values(byPriority)) {
    if (region?.clearTimer !== null && region?.clearTimer !== undefined) {
      clearTimeout(region.clearTimer);
    }
    region?.element.remove();
  }
  regions.delete(document);
}
