import {
  Component,
  Prop,
  Signal,
  createId,
  effect,
  isSignal,
  isWritableSignal,
} from '@voltdev/core';
import {
  createBadge,
  focusableWithin,
  type Badge,
  type BadgeLabels,
  type BadgeProps,
} from '@voltdev/primitives';

/** Replaced by the build; `true` where there is none, which is a test run. */
declare const __VOLT_DEV__: boolean;

const { untrack } = Signal.subtle;

/** How loud a badge is. */
export type BadgeTone = 'neutral' | 'accent' | 'danger';

/**
 * What `count` can be handed: a number, your own signal, or the string an
 * attribute delivers — `count="3"` arrives as `'3'`.
 */
export type BadgeCount =
  | number
  | string
  | null
  | undefined
  | Signal.State<number | null>
  | Signal.Computed<number | null>;

/**
 * A count, as a tag is able to deliver one.
 *
 * A string that is a number is that number, which is the only thing `count="3"`
 * could have been asking for. Anything else is handed on as it is, for the
 * primitive to refuse the way it already refuses `NaN` — as no count at all,
 * rather than a badge reading "NaN unread messages".
 */
function countOf(value: unknown): number | null {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') return Number(value);
  return null;
}

/**
 * The cap, as a tag is able to deliver one. Default 99.
 *
 * A corner has room for two digits and a plus, and no more: a badge reading
 * 1204 is wider than the icon it sits on. `:max="Infinity"` takes the cap away.
 * A string that is not a number takes it away too, rather than capping at
 * `NaN`, which no count is ever greater than.
 */
function capOf(value: number | string | undefined): number {
  if (value === undefined || value === '') return 99;
  const number = Number(value);
  return Number.isNaN(number) ? Number.POSITIVE_INFINITY : number;
}

/**
 * A flag, as a tag is able to deliver one.
 *
 * Written bare it is on, and bound it is whatever it was bound to. Written as
 * an attribute it is a string, and the primitive takes only `true` for on — so
 * `showZero="true"` would have been off. Every string is on here but
 * `"false"`, which nobody writes meaning on.
 */
function flag(value: boolean): boolean {
  // Typed as a flag and handed a string all the same: the type is what the
  // tag promises, and an attribute is what it delivers.
  const written: unknown = value;
  return written !== false && written !== 'false' && written !== null && written !== undefined;
}

/**
 * A list of ids with this badge's taken out, and put back at the end when
 * there is one to put back. Every other id in it is the caller's, and stays.
 */
function describedBy(
  list: string | null,
  remove: string | null,
  add: string | null,
): string | null {
  const ids = (list ?? '').split(/\s+/).filter((id) => id !== '' && id !== remove && id !== add);
  if (add !== null) ids.push(add);
  return ids.length > 0 ? ids.join(' ') : null;
}

/**
 * The control's `aria-describedby` set to the list, or removed when the list
 * is empty. Left alone when it already says so: this runs on every focus into
 * the content, and an attribute rewritten with its own value is still a
 * change to everything watching the tree.
 */
function write(control: Element, list: string | null): void {
  if (control.getAttribute('aria-describedby') === list) return;
  if (list === null) control.removeAttribute('aria-describedby');
  else control.setAttribute('aria-describedby', list);
}

/**
 * The count the primitive holds, read through whatever the tag was handed.
 *
 * `createBadge` takes one `Signal.State` when it is built and reads it for the
 * rest of its life. A tag is handed a number, a string or a signal of the
 * caller's own — `:count="unread.get()"`, `count="3"`, `:count="unread"` — and
 * `@Prop` keeps the tag's own signal and writes whatever arrives into it, so
 * that signal can end up holding another one. Handed to the primitive as it
 * is, a caller's signal would reach `Number.isFinite` and come out as no count
 * at all: a badge that never shows, and nothing raised anywhere to say why.
 *
 * So the primitive is given this instead: a state whose value is whatever the
 * tag holds, unwrapped, and whose writes go where the count lives — into the
 * caller's signal when they handed one over, so that `setCount` through `:ref`
 * moves the page's own count, and into the tag's otherwise.
 */
class CountThrough extends Signal.State<number | null> {
  readonly #given: Signal.State<BadgeCount>;

  constructor(given: Signal.State<BadgeCount>) {
    super(null);
    this.#given = given;
  }

  override get(): number | null {
    const value = this.#given.get();
    return countOf(isSignal(value) ? value.get() : value);
  }

  override set(next: number | null): void {
    const value = untrack(() => this.#given.get());
    if (isWritableSignal(value)) value.set(next);
    else this.#given.set(next);
  }
}

/**
 * A count or a status marker, drawn on the corner of what it is about.
 *
 * ```html
 * <v-badge :count="unread" describes="unread messages">
 *   <v-button>Inbox</v-button>
 * </v-badge>
 * ```
 *
 * Written around the content it annotates, it sits on that content's top
 * inline-end corner — the right in a left-to-right page, the left in a
 * right-to-left one. Written with nothing inside, it stands in line where it
 * was written.
 *
 * `createBadge` is what makes it more than a red circle. The digits are drawn
 * and hidden: the badge is `role="img"`, named with the count and the words
 * `describes` gives it, so a reader hears "3 unread messages" rather than a
 * bare 3, and "More than 99 unread messages" rather than "ninety-nine plus".
 * Past `max` the badge reads `99+`, and at zero it goes away unless
 * `showZero` says zero is worth showing.
 *
 * ## The control it counts for
 *
 * The badge is drawn beside the content, not inside it, so it is not part of
 * a button's name — and a keyboard user moving from control to control never
 * lands on the badge, which takes no focus. They would reach Inbox and never
 * hear that anything was waiting in it. So the first control inside the
 * content is described by the badge: its id is added to that control's
 * `aria-describedby`, beside whatever the caller put there, for as long as
 * the badge is showing. Tab to the button and a reader says "Inbox, button,
 * 3 unread messages". The badge also stays where it is in the reading order,
 * as a line of help text beside a field does, so reading the page line by
 * line finds it too.
 *
 * The control is looked for when the badge mounts, whenever the count moves,
 * and whenever anything inside the content takes focus. The last is what
 * finds a control the first two cannot: one under an `:if` that was not there
 * yet, or one in a panel that was shut when the badge mounted — a tab stop
 * the search passes over, since a hidden control is not one — and nothing a
 * signal says changes when the panel opens. Focus is the moment the
 * description is heard, so it is the moment the search is worth running
 * again.
 *
 * ## `:host`
 *
 * On the badge: the element carrying the role and the name, and the one part
 * of this a caller cannot otherwise reach. The content around it is the
 * caller's own markup already, and the box holding the two is layout.
 */
@Component({ selector: 'v-badge', templateUrl: './badge.html' })
export class VBadge {
  /**
   * What is counted: a number, or your own signal of one — `:count="unread"`,
   * `:count="unread.get()"` and `count="3"` all work, and all three follow
   * what they were given. `null` is no count, and draws nothing unless `dot`
   * is set, when it is a status dot rather than a count.
   */
  @Prop() count = new Signal.State<BadgeCount>(null);
  /**
   * A dot instead of the digits.
   *
   * With a count, the dot follows it — gone at zero, there past it — and the
   * name still says the number, so nothing a reader hears changes. With none,
   * the dot is a status, shown for as long as this is set and named by
   * `describes` alone, which is why a dot with no `describes` is nothing at
   * all to a screen reader.
   */
  @Prop() dot = new Signal.State(false);
  /**
   * `danger`, `accent` or `neutral`. Default `danger` for a count, which is a
   * pile of things waiting, and `accent` for a status dot with none, which
   * says something is so rather than that something is wrong.
   */
  @Prop() tone = new Signal.State<BadgeTone | undefined>(undefined);
  /**
   * The badge's id. Default one of its own.
   *
   * Declared rather than left to `:host`, because the badge is described by
   * its id: written on the tag alone it would land on the badge after the
   * control had been pointed at another.
   */
  @Prop() id = new Signal.State<string | undefined>(undefined);
  /**
   * Names the badge outright, in place of the name the count and `describes`
   * make.
   *
   * Declared rather than left to `:host`, because the primitive writes
   * `aria-label` itself: two bags writing one attribute is the caller's losing,
   * whichever lands last. A name given here is fixed, so it says no number —
   * `describes` is almost always what was meant.
   */
  @Prop({ alias: 'aria-label' }) ariaLabel = new Signal.State<string | undefined>(undefined);

  /**
   * The four below are what the primitive is built with, read once while this
   * field list initializes — plain, because a signal would promise a caller
   * they can change them later and the primitive would not hear it.
   */
  /**
   * What the number counts — `unread messages`. The primitive makes it the
   * name, after the count: "3 unread messages".
   */
  @Prop() describes?: string;
  /** Past this the badge reads `99+`, and is named "More than 99 …". Default 99. */
  @Prop() max?: number | string;
  /** Stay on screen at zero, reading `0`. Default false. Written bare — `showZero` — or bound. */
  @Prop() showZero = false;
  /**
   * Your wording for the name. The default does not pluralise — "1 unread
   * messages" — because the plural depends on the language and the noun, and
   * neither is knowable from a string; supply `count` here to say both forms.
   */
  @Prop() labels?: BadgeLabels;

  /** The box around the content and the badge, which is where the control is looked for. */
  anchor = new Signal.State<Element | null>(null);

  /**
   * The primitive, built from the props above — which is why props have to be
   * there while a field initializes.
   */
  readonly badge: Badge = createBadge({
    count: new CountThrough(this.count),
    max: capOf(this.max),
    showZero: flag(this.showZero),
    ...(this.describes !== undefined ? { describes: this.describes } : {}),
    ...(this.labels ? { labels: this.labels } : {}),
  });

  /** The id the badge carries when it is given none. */
  private readonly minted = createId('volt-badge');

  /** The control this badge last described, and the id it wrote there. */
  private described: Element | null = null;
  private written: string | null = null;

  constructor() {
    if (__VOLT_DEV__) this.reportUnnamed();
    // After the render lane, which is the earliest the content's elements
    // exist to be looked through. It looks again every time the count moves,
    // and the anchor's `focusin` looks for the cases neither of those sees.
    effect(() => this.describe());
  }

  /**
   * Whether the badge is on screen.
   *
   * The primitive's answer for a count. Without one, the primitive calls the
   * badge a status whose own words are the message — and here the words
   * inside the tag are the content being annotated, not the badge's, so a
   * badge with no count is only a dot, and only while `dot` says so.
   */
  shown(): boolean {
    return this.badge.count() === null ? this.dot.get() : this.badge.isVisible();
  }

  /** The digits, or nothing for a dot or a badge that is not showing. */
  text(): string {
    return this.shown() && !this.dot.get() ? this.badge.text() : '';
  }

  /** What the sheet colours it with: the tone asked for, or the one its kind defaults to. */
  toneOf(): BadgeTone {
    return this.tone.get() ?? (this.badge.count() === null ? 'accent' : 'danger');
  }

  /** The id the control is described by: the one given, or the one minted here. */
  badgeId(): string {
    return this.id.get() ?? this.minted;
  }

  /**
   * The primitive's attributes, with what this component knows and it does
   * not.
   *
   * One bag rather than attributes beside a spread: `:spread` takes back what
   * its last object carried and this one does not, so an `aria-hidden` written
   * next to it would be removed the next time the primitive's bag stopped
   * carrying one.
   */
  badgeProps(): BadgeProps {
    const props: Record<string, string | boolean | undefined> = { ...this.badge.badgeProps() };
    if (this.dot.get()) props['data-dot'] = '';
    if (!this.shown()) {
      // A badge the primitive would show — a status, as it sees one — that
      // this one does not. Hidden the way the primitive hides one at zero, and
      // named nothing, since there is nothing on screen to name. The two are
      // left out rather than set to `undefined`: `role` is a property the
      // element reflects, a spread writes a property as it is given, and
      // `undefined` would land as the word. A key the bag stops carrying is
      // one the spread takes back.
      delete props['role'];
      delete props['aria-label'];
      return { ...props, 'aria-hidden': 'true', 'data-empty': '' };
    }
    const name = this.ariaLabel.get();
    return name ? { ...props, role: 'img', 'aria-label': name } : props;
  }

  /**
   * Add this badge's id to the control's `aria-describedby` while it shows,
   * and take it out while it does not. What the caller wrote there stays.
   *
   * Run by the effect in the constructor, and by the anchor on every focus
   * into the content — which is why it is cheap when nothing has changed: one
   * query over the content, and no write the control does not need.
   */
  describe(): void {
    const control = this.control();
    const id = this.shown() ? this.badgeId() : null;

    if (control !== this.described) {
      // A control this no longer describes gives back what it was lent.
      const previous = this.described;
      if (previous) {
        write(previous, describedBy(previous.getAttribute('aria-describedby'), this.written, null));
      }
      this.described = control;
      this.written = null;
    }
    if (!control) return;

    write(control, describedBy(control.getAttribute('aria-describedby'), this.written, id));
    this.written = id;
  }

  /**
   * The first thing inside the content that takes focus.
   *
   * A tab stop, not the content's first element: a caller who hands the badge
   * a card hands it a `<div>`, and a description on that is one no keyboard
   * ever reaches. `focusableWithin` is the package's one answer to where
   * focus lands, so it answers here too. Content with nothing focusable — an
   * avatar, an icon — has no control to describe, and the badge beside it in
   * the reading order is how it is heard. The badge itself is in the anchor
   * and is never the answer: nothing a tag can carry makes it a tab stop.
   */
  private control(): Element | null {
    const anchor = this.anchor.get();
    if (!anchor) return null;
    return focusableWithin(anchor)[0] ?? null;
  }

  /**
   * A badge with nothing to say what it counts, said out loud.
   *
   * The name is the whole of what a reader gets, and without `describes` a
   * count is named with its digits alone — the "Inbox 3" this component
   * exists to prevent — and a dot with no count is named nothing at all, a
   * mark on the page that a screen reader passes over as if it were not there.
   */
  private reportUnnamed(): void {
    if (typeof console === 'undefined') return;
    if (this.describes || this.labels || untrack(() => this.ariaLabel.get())) return;
    console.warn(
      '[volt] <v-badge> was not told what it counts, so a screen reader hears only the ' +
        'number — or, for a dot, nothing at all.\n' +
        '  Write the words the digits stand for: describes="unread messages".',
    );
  }
}
