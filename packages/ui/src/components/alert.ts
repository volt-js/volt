import { Component, Prop, Signal } from '@voltdev/core';
import { createAlert, type Alert, type AlertPriority, type AlertProps } from '@voltdev/primitives';

/** How serious the thing being said is. */
export type AlertSeverity = 'info' | 'success' | 'warning' | 'danger';

/**
 * The mark drawn beside the words, per severity.
 *
 * Shapes rather than colours, because colour is the channel a forced palette
 * spends first: four hues down the edge of the box come out of a user's
 * palette as one hue, and a glyph comes out of every palette as itself. The
 * sheet restates the severity in a border style for the same reason; this is
 * the half of it a reader sees without looking for a four-pixel edge.
 */
const GLYPHS: Readonly<Record<AlertSeverity, string>> = {
  info: 'i',
  success: '✓',
  warning: '!',
  danger: '✕',
};

/**
 * Which severities are worth interrupting for.
 *
 * `role="alert"` cuts a screen reader off mid-word, and a page that does that
 * for a confirmation teaches people to ignore it. Only danger has to be dealt
 * with now; the rest wait for a gap in the speech.
 */
function priorityFor(severity: AlertSeverity): AlertPriority {
  return severity === 'danger' ? 'assertive' : 'polite';
}

/**
 * An alert: something about the page itself, said where the reader already is.
 *
 * ```html
 * <v-alert severity="danger" title="Could not save" :open="failed" dismissible>
 *   The connection dropped. Nothing was lost.
 * </v-alert>
 * ```
 *
 * Not a toast. It sits in the layout it was written in, it stays until
 * something takes it away, and it never moves focus — which is why the words
 * go in a live region instead: `createAlert` owns that region's timing, and
 * the region is on the page from the moment the tag is, empty, so a message
 * written into it later arrives as a change inside a region rather than as a
 * region and a sentence in one mutation. The second of those announces
 * nothing in most screen readers, and is what this component exists to make
 * impossible to write by accident.
 *
 * That is also why there are two elements rather than one. `:host` and the
 * role are on the region, which is always there and has nothing drawn on it;
 * the box with the border, the mark and the words is inside it and comes and
 * goes. A caller's class, id and `data-*` land on the region, so a stylesheet
 * of their own reaches the element they can name.
 *
 * **Do not name it.** An `aria-label` on a live region is announced *instead
 * of* its contents in some screen readers, which for this one is the whole
 * message lost. Nothing here writes a name, and one written on the tag would
 * reach the region through `:host`.
 *
 * A message that has to be dealt with before anything else on the page is a
 * modal `alertdialog` — `<v-dialog>`, not this.
 */
@Component({ selector: 'v-alert', templateUrl: './alert.html' })
export class VAlert {
  /** Your own signal, when whether the alert is up belongs to your component. */
  @Prop() open?: Signal.State<boolean>;
  /**
   * The three below are what the primitive is built with, read once while this
   * field list initializes — plain, because a signal would promise a caller
   * they can change them later and the primitive would not hear it.
   */
  /**
   * Where it starts, when the alert owns its own state. Default true.
   *
   * The primitive starts closed, because most of its callers raise an alert
   * from code that has just failed. A tag written in markup is there because
   * the page put it there, and one that had to be opened before it said
   * anything would be a tag that looks broken.
   */
  @Prop() defaultOpen = true;
  /**
   * `assertive` interrupts whatever is being read; `polite` waits for a gap.
   * Default `assertive` for `danger` and `polite` for everything else.
   *
   * Fixed for the life of the alert, deliberately: `role` and `aria-live` are
   * not reliably re-read once a region exists, so an alert that had to change
   * its mind would need two regions rather than one option.
   */
  @Prop() priority?: AlertPriority;
  /**
   * Escape dismisses it, and only while focus is inside it. Default true.
   *
   * An alert is not a layer. One that swallowed the page's Escape would take
   * it from the dialog or the menu it sits in, so it joins the dismiss stack
   * as focus enters it and leaves as focus does.
   */
  @Prop() closeOnEscape = true;

  /** `info`, `success`, `warning` or `danger`. Drawn, and read for `priority`. */
  @Prop() severity = new Signal.State<AlertSeverity>('info');
  /** The line in bold over the words. Left out, the body is the whole message. */
  @Prop() title = new Signal.State<string | undefined>(undefined);
  /** Draw the control that takes the alert away. */
  @Prop() dismissible = new Signal.State(false);
  /**
   * What that control is called. Default the locale's word for it, then
   * `Dismiss` — a glyph has no accessible name of its own.
   */
  @Prop() dismissLabel = new Signal.State<string | undefined>(undefined);
  /** The words on the one thing to do about this. Blank draws no button. */
  @Prop() actionLabel = new Signal.State<string | undefined>(undefined);
  /** What pressing that button does. The alert stays up; see `press`. */
  @Prop() onAction?: () => void;
  @Prop() onOpenChange?: (open: boolean) => void;

  /** The live region, which the primitive watches for and announces through. */
  region = new Signal.State<Element | null>(null);

  /**
   * The primitive, built from the props above — which is why props have to be
   * there while a field initializes.
   */
  readonly alert: Alert = createAlert({
    region: () => this.region.get(),
    priority: this.priority ?? priorityFor(this.severity.get()),
    defaultOpen: this.defaultOpen,
    closeOnEscape: this.closeOnEscape,
    ...(this.open ? { open: this.open } : {}),
    ...(this.onOpenChange ? { onOpenChange: this.onOpenChange } : {}),
  });

  /**
   * The mark for the severity being drawn.
   *
   * A severity the type does not allow falls back to the one the sheet falls
   * back to, so a typo on the tag is an alert that looks like `info` rather
   * than an alert with a hole where its mark should be.
   */
  glyph(): string {
    return GLYPHS[this.severity.get()] ?? GLYPHS.info;
  }

  /**
   * The words on the action, when there are any.
   *
   * A method rather than the question written into the template twice: the
   * button is drawn only where there is a label to put on it, and a second
   * spelling of that is how a button comes to be drawn empty. Blank counts as
   * none, because a button with no accessible name inside a live region is one
   * a screen reader reaches in the middle of the announcement and can say
   * nothing about — and the gap where it should be is what shows the author
   * what they wrote.
   */
  action(): string | undefined {
    const label = this.actionLabel.get();
    return label === undefined || label.trim() === '' ? undefined : label;
  }

  /**
   * The dismiss control's attributes, with the name this was given where it
   * has one.
   *
   * One bag rather than a name written beside the spread: `:spread` reapplies
   * everything it carries whenever what it reads changes, and takes back what
   * the last object had, so a name next to it lasts only until something else
   * in the bag moves. Read here rather than handed to the primitive, which
   * reads its labels when it is built, so one bound to a signal follows it.
   *
   * Blank counts as none, for the reason `action()` gives: the glyph inside
   * the control is hidden from the reader, so `aria-label=""` is a button
   * with no accessible name at all, sitting in the middle of a live region.
   * A name that arrives empty — a translation that has not landed, a signal
   * still holding its initial value — falls back to the primitive's rather
   * than erasing the one it had.
   */
  dismissProps(): AlertProps {
    const name = this.dismissLabel.get();
    const props = this.alert.dismissProps();
    return name === undefined || name.trim() === '' ? props : { ...props, 'aria-label': name };
  }

  /**
   * Run the action, and leave the alert where it is.
   *
   * The opposite of the toast, on purpose. A toast is an announcement that
   * something happened and goes once its one action has been taken; an alert
   * is a statement about the page, and `Retry` does not make it untrue. The
   * page that knows whether the retry worked is the page that closes it —
   * through its own `open` signal, or `instance.alert.close()`.
   */
  press(): void {
    this.onAction?.();
  }
}
