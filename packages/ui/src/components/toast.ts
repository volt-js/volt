import { Component, Prop, Signal, onCleanup, requestState } from '@voltdev/core';
import {
  createToaster,
  type Toast,
  type ToastDismissReason,
  type ToastProps,
  type Toaster,
} from '@voltdev/primitives';

/** One thing to do about a toast, drawn as a button beside the close. */
export interface ToastAction {
  /** The words on the button. */
  label: string;
  /** What pressing it does. The toast goes down once it has run. */
  onPress: () => void;
}

/** What `<v-toaster>` draws for each toast it is handed. */
export interface ToastMessage {
  /** The line in bold — the message itself, for a toast that is one line. */
  title: string;
  /** The line under it, when the title is not the whole of it. */
  description?: string;
  /** The one action worth offering while the toast is up. */
  action?: ToastAction;
}

/**
 * The toasters mounted right now, oldest first.
 *
 * `requestState` rather than a module-level array, which is the same thing in
 * a browser and a bug on a server: one process assembles many pages at once
 * there, interleaved at every `await`, and a single slot would hand one
 * request's toaster to another request's `toaster()` call. This is one list
 * per page in a browser and one list per request on a server, and neither side
 * has to know which it is.
 */
const MOUNTED: unique symbol = Symbol('volt.ui.toasters');

function mounted(): VToaster[] {
  return requestState<VToaster[]>(MOUNTED, () => []);
}

/**
 * The toaster on the page, for code with no component around it.
 *
 * ```ts
 * import { toaster } from '@voltdev/ui/components';
 *
 * toaster().add({ title: 'Saved' }, { type: 'success' });
 * ```
 *
 * The primitive itself, not a raise function wrapped around it: `add`,
 * `update`, `dismiss`, `dismissAll` and the queue are `createToaster`'s own,
 * so there is no second surface to keep in step and nothing a caller has to
 * drop down a layer to reach.
 *
 * The one mounted last answers, and the one before it answers again when that
 * one goes — which is what makes a toaster inside a route or a dialog behave
 * the way it reads. Two regions announcing at once is a design mistake rather
 * than a feature, and this cannot fix it; it only says which of them a raise
 * with no region named reaches.
 *
 * With none mounted this throws rather than dropping the message, because the
 * failure it stands for is a `<v-toaster>` nobody wrote — and a call that
 * quietly does nothing turns that into a bug report from a user about a save
 * that said nothing.
 */
export function toaster(): Toaster<ToastMessage> {
  const last = mounted().at(-1);
  if (!last) {
    throw new Error(
      '[volt] `toaster()` was called with no <v-toaster> mounted, so there is no region to ' +
        'announce through.\n' +
        '  Write `<v-toaster></v-toaster>` once, in the markup that stays up for the whole ' +
        'application — a layout or a shell, not a page that comes and goes.',
    );
  }
  return last.toaster;
}

/**
 * A number a caller may have written as an attribute.
 *
 * `max="1"` and `duration="0"` arrive as strings, and both are read as numbers
 * by the primitive: `Number.isFinite('2000')` is `false`, so a duration
 * written on the tag made every toast sticky, and a string `max` is only
 * compared correctly by accident. `Infinity` is a value both props take, so
 * what is refused is what is not a number at all — a typo there leaves a
 * toaster that shows nothing, or one whose toasts never leave.
 *
 * Emptiness is judged after the trim rather than before it, because `Number`
 * reads whitespace as zero: `max=" "` was a toaster that showed nothing and
 * `duration=" "` was toasts that never left — the two failures this refusal
 * exists to prevent, arriving through the one spelling it let past.
 */
function numeric(value: number | string, prop: string): number {
  const text = typeof value === 'number' ? value : value.trim();
  const parsed = text === '' ? Number.NaN : Number(text);
  if (Number.isNaN(parsed)) {
    throw new Error(
      `[volt] \`${prop}\` on <v-toaster> takes a number, and \`${String(value)}\` is not one.`,
    );
  }
  return parsed;
}

/**
 * A toaster: the region short messages appear in, and the way to raise one.
 *
 * ```html
 * <v-toaster></v-toaster>
 * ```
 *
 * ```ts
 * import { toaster } from '@voltdev/ui/components';
 *
 * toaster().add({ title: 'Project saved' }, { type: 'success' });
 * toaster().add({
 *   title: 'Message deleted',
 *   action: { label: 'Undo', onPress: () => restore() },
 * }, { duration: 0 });
 * ```
 *
 * **How a caller reaches it** is the only question this component has that the
 * others do not, and it is worth the paragraph. A toast is raised where the
 * thing worth saying happened: a fetch wrapper, a store, a route guard, a
 * retry that finally worked. None of those is a component, which rules out the
 * two ways every other component here is reached:
 *
 *   - `:ref` on the tag reaches this instance, and `instance.toaster` is the
 *     whole primitive — that stays true, because it is the rule. What it
 *     cannot do is reach the save that failed four modules away without a
 *     reference threaded through every one of them, which is the plumbing a
 *     component is supposed to save rather than impose.
 *   - Context reaches what is written *inside* the tag. A toaster has nothing
 *     inside it: the region is a leaf, and its contents arrive from calls. A
 *     context provided here would be visible to nobody.
 *
 * So the raise comes from the module: `toaster()` answers with the primitive
 * of the toaster that is mounted, and a caller imports one function instead of
 * holding a reference. The register that costs is kept in `requestState`, so
 * it is per page in a browser and per request on a server rather than global.
 *
 * The region portals to `<body>`, which is not cosmetic. A modal dialog makes
 * every other child of `<body>` inert, and an inert subtree is out of the
 * accessibility tree — a toast raised from inside a dialog and announced from
 * a region nested anywhere else is a toast nobody hears. `:host` is on that
 * region, so a class or a `data-*` written on the tag reaches the element the
 * toasts are actually in.
 *
 * Each toast is its own live region, announced where the user already is, and
 * focus never moves to one. F6 is the way in from the keyboard — nothing links
 * to a toast, so without it the action inside one is unreachable — and Escape
 * puts focus back where it came from. That is all the primitive's; what is
 * here is the markup, the classes, and the words.
 */
@Component({ selector: 'v-toaster', templateUrl: './toast.html' })
export class VToaster {
  /**
   * The four below are what the primitive is built with, read once while this
   * field list initializes — plain, because a signal would promise a caller
   * they can change them later and the primitive would not hear it.
   */
  /** How many are on screen at once. The rest wait their turn. */
  @Prop() max: number | string = 3;
  /** How long one stays up, in milliseconds. `0` keeps it up until dismissed. */
  @Prop() duration: number | string = 5000;
  /** The key that moves focus to the region, matched with no modifier held. */
  @Prop() hotkey?: string | ((event: KeyboardEvent) => boolean);
  /** Called with each toast as it goes, and why it went. */
  @Prop() onDismiss?: (toast: Toast<ToastMessage>, reason: ToastDismissReason) => void;

  /**
   * The region's accessible name, for an application that calls them something
   * else — or a second language.
   *
   * Left off, the primitive names it: its locale's word for notifications, and
   * `Notifications` where the locale has none.
   */
  @Prop() label = new Signal.State<string | undefined>(undefined);
  /**
   * The same name in the platform's own spelling, and the reason it is
   * declared rather than left to fall through to `:host`.
   *
   * The region's props are spread onto the element `:host` also writes to, and
   * `:spread` reapplies every entry of its bag whenever anything it reads
   * changes — the pause attribute flips under a pointer — so an `aria-label`
   * written on the tag would survive the first render and be overwritten by
   * the first hover. A declared prop is never a host attribute, so writing it
   * down is what puts the caller's name into the bag instead of under it.
   */
  @Prop({ alias: 'aria-label' }) ariaLabel = new Signal.State<string | undefined>(undefined);
  /**
   * What a close button is called. The primitive's default is the locale's
   * word, then `Close notification`.
   */
  @Prop() closeLabel = new Signal.State<string | undefined>(undefined);

  /** The element the toasts are drawn in, which the primitive watches for. */
  region = new Signal.State<Element | null>(null);

  /**
   * The primitive, built from the props above — which is why props have to be
   * there while a field initializes.
   */
  readonly toaster: Toaster<ToastMessage> = createToaster<ToastMessage>({
    region: () => this.region.get(),
    max: numeric(this.max, 'max'),
    duration: numeric(this.duration, 'duration'),
    ...(this.hotkey !== undefined ? { hotkey: this.hotkey } : {}),
    ...(this.onDismiss ? { onDismiss: this.onDismiss } : {}),
  });

  constructor() {
    const open = mounted();
    open.push(this);
    onCleanup(() => {
      const at = open.indexOf(this);
      if (at >= 0) open.splice(at, 1);
    });
  }

  /**
   * The region's attributes: the primitive's bag, with the name this was given
   * where it has one.
   *
   * One bag rather than a spread and an attribute beside it, for the reason
   * `ariaLabel` gives — `:spread` clears and rewrites what it carries, so a
   * name written next to it lasts until the first pause. The name is read here
   * rather than handed to the primitive, which reads its options once, so one
   * bound to a signal follows it.
   *
   * What the caller wrote in ARIA wins over the prop that says the same thing:
   * two spellings of one name can only disagree by mistake, and the attribute
   * is the one on the tag.
   */
  regionProps(): ToastProps {
    const name = this.ariaLabel.get() ?? this.label.get();
    const props = this.toaster.regionProps();
    return name === undefined ? props : { ...props, 'aria-label': name };
  }

  /** The close button's bag, named the same way. */
  closeProps(): ToastProps {
    const name = this.closeLabel.get();
    const props = this.toaster.closeProps();
    return name === undefined ? props : { ...props, 'aria-label': name };
  }

  /** Whether a toast has a second line. */
  described(toast: Toast<ToastMessage>): boolean {
    return Boolean(toast.data().description);
  }

  /**
   * The words on a toast's action, when it carries one.
   *
   * A method rather than the question written into the template twice: the
   * button is drawn only where there is a label to put on it, and a second
   * spelling of that is how a button comes to be drawn empty.
   *
   * Blank counts as none, which is the whole point of asking here rather than
   * for `action` itself. A button drawn from `label: ''` has no accessible
   * name, and it is drawn inside a live region — so a screen reader reaches
   * an unnamed button in the middle of the announcement, while the author who
   * wrote the blank sees a button-shaped gap and nothing to tell them why.
   * Dropping it shows that author the mistake at once, on the one screen they
   * are looking at.
   */
  actionLabel(toast: Toast<ToastMessage>): string | undefined {
    const label = toast.data().action?.label;
    return label === undefined || label.trim() === '' ? undefined : label;
  }

  /**
   * Take a toast down, and run the action that was pressed.
   *
   * A toast is an announcement that something happened, and its action is the
   * one thing to do about it. Once that is done the announcement is stale —
   * and a toast left up with a button that has already been pressed invites
   * pressing it again, which for an undo is a second undo.
   *
   * Down first, then the action, because the action may be the next thing to
   * announce: raised under this toast's own id it becomes this toast, and a
   * dismissal waiting its turn behind it would take the result down with the
   * announcement it replaced.
   */
  press(toast: Toast<ToastMessage>): void {
    const action = toast.data().action;
    toast.dismiss();
    action?.onPress();
  }
}
