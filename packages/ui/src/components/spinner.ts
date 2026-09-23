import { Component, Prop, Signal } from '@voltdev/core';
import { createSpinner, type Spinner } from '@voltdev/primitives';

/**
 * A length of time a caller may have written as an attribute.
 *
 * `delay="0"` arrives as the string `'0'` and goes on into `setTimeout`, which
 * takes a string and a typo with it: `Number('half')` is `NaN`, a `NaN`
 * timeout fires on the next tick, and the spinner flashes on every response —
 * the one failure this component exists to prevent, arriving through the one
 * spelling that reads like it should work.
 *
 * `NaN` is not the only number that fires at once, which is why the test is
 * for a duration rather than for a number. `setTimeout` takes a `long`:
 * `Infinity` becomes zero on the way in, and a negative timeout is already
 * due. So `delay="Infinity"`, which reads as "never show it", and
 * `minDuration="-1"`, which reads as nothing at all, are both the same flash
 * as the typo — and both used to pass a check that only asked `Number.isNaN`.
 *
 * Emptiness is judged after the trim, because `Number` reads whitespace as
 * zero: `delay=" "` would otherwise be a spinner with no delay at all.
 */
function milliseconds(value: number | string, prop: string): number {
  const text = typeof value === 'number' ? value : value.trim();
  const parsed = text === '' ? Number.NaN : Number(text);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(
      `[volt] \`${prop}\` on <v-spinner> takes a number of milliseconds — a finite ` +
        `one, and not a negative one — and \`${String(value)}\` is not one.`,
    );
  }
  return parsed;
}

/**
 * A spinner: work is happening, and nobody knows how much.
 *
 * ```html
 * <v-spinner :loading="saving" label="Saving your draft"></v-spinner>
 * ```
 *
 * Three things, and the third is the one worth having a component for.
 *
 * **The ring** turns while the wait lasts, and is `aria-hidden`: a spinning
 * mark has no accessible name, and one read out of its markup is noise.
 *
 * **The words** are what a screen reader gets instead, in a polite live
 * region. They are not drawn — the ring is what everybody else has — so
 * `label` is heard and never seen.
 *
 * **The delay** is why the region is on the page from the start, empty, rather
 * than rendered when the wait begins. A screen reader announces what *changes*
 * inside a live region; a region that arrives already holding its message
 * announces nothing, in most readers, and the bug is invisible to everyone who
 * can see the screen. So `<v-spinner>` is written where the wait will be and
 * left there. Nothing is drawn and nothing is said for the first half second,
 * which is the other half of the same idea: a wait too short to read is a wait
 * too short to mention, and a mark that comes and goes inside 200ms reads as a
 * fault rather than as progress.
 *
 * The words exist only while the region may speak them, which is why they are
 * under `:if` rather than hidden with an attribute: what is announced is what
 * arrives in the region, so words that were there all along are words nobody
 * hears.
 *
 * What the user is waiting *for* is not in here. `aria-busy` belongs on the
 * thing being rebuilt, which is the caller's own markup; the region holds the
 * ring and the words and nothing else, because a live region announces
 * everything inside it every time any of it changes. That is one attribute
 * written where the content is, and `createSpinner`'s own `contentProps()` for
 * markup assembled around the primitive instead of around this tag.
 *
 * State is one signal both sides hold. Pass `loading` and it is yours to read
 * and write; pass nothing and the spinner owns it, and `:ref` reaches
 * `spinner.setLoading()`.
 */
@Component({ selector: 'v-spinner', templateUrl: './spinner.html' })
export class VSpinner {
  /** Your own signal, if whether the wait is on belongs to your component. */
  @Prop() loading?: Signal.State<boolean>;
  /**
   * The four below are what the primitive is built with, read once while this
   * field list initializes — plain, because a signal would promise a caller
   * they can change them later and the primitive would not hear it.
   */
  /** Where it starts, when the spinner owns its state. */
  @Prop() defaultLoading?: boolean;
  /**
   * How long the wait has to last before anything is drawn, in milliseconds.
   * Default 500. `0` draws at once, and flashes.
   */
  @Prop() delay?: number | string;
  /**
   * Once drawn, how long the ring stays up at least, in milliseconds.
   * Default 0 — the delay alone moves the flash rather than removing it, and
   * this is the half that removes it, at the price of holding real content
   * back for that long.
   */
  @Prop() minDuration?: number | string;
  /** Called with the state the wait moved to, when `setLoading` moves it. */
  @Prop() onLoadingChange?: (loading: boolean) => void;

  /**
   * What the wait is called, for the reader who cannot see the ring.
   *
   * Left off, it is the provided locale's word for loading, and `Loading…`
   * with no locale. Name the wait where the page has more than one thing to
   * wait for: "Loading results" and "Saving your draft" are worth the
   * sentence, and "Loading" twice on one page is not.
   *
   * A signal rather than an option handed to the primitive, which reads its
   * labels once: read here, a name bound to a signal follows what the page is
   * actually doing.
   */
  @Prop() label = new Signal.State<string | undefined>(undefined);
  /**
   * The same words in the platform's own spelling, and the reason this is
   * declared rather than left to fall through to `:host`.
   *
   * `:host` is the region, and a name on a live region is announced *instead
   * of* its contents in some screen readers — so `aria-label` written on the
   * tag would be the whole message lost, and lost in a way only a screen
   * reader user ever meets. Declared, it is not a host attribute: a caller who
   * reaches for the platform's spelling gets their words into the region,
   * which is what they meant by writing them.
   */
  @Prop({ alias: 'aria-label' }) ariaLabel = new Signal.State<string | undefined>(undefined);
  /**
   * What already names the wait, where something on the page does.
   *
   * The same interception as the one above, and for the more pressing half of
   * the same reason: `aria-labelledby` names a live region exactly as
   * `aria-label` does, and is announced *instead of* its contents in the same
   * screen readers. Undeclared it is a host attribute, so it would fall
   * through to `:host` — which is the region — and take the message with it.
   * One spelling of a name was intercepted and the other was left open, which
   * is the whole of the bug this prop exists to close.
   *
   * It cannot become the words the way `aria-label` does: they are in an
   * element this component has no business reading. So it goes onto the words
   * instead, where it names them and nothing can be lost — a reference that
   * resolves to nothing leaves the span's own text to stand, and either way
   * there is something in the region to announce.
   */
  @Prop({ alias: 'aria-labelledby' }) ariaLabelledBy = new Signal.State<string | undefined>(
    undefined,
  );
  /**
   * `sm`, `lg`, or nothing for the middle size.
   *
   * It lands on the ring rather than on the region, because the ring is what
   * is being sized: the same class and the same attribute draw the same mark
   * wherever a consumer writes them by hand.
   */
  @Prop() size = new Signal.State<'sm' | 'lg' | undefined>(undefined);

  /**
   * The live region.
   *
   * A signal rather than a plain field because the primitive watches it: the
   * element does not exist while this class is being built, and the wait
   * before words written into it are announced starts the moment it lands.
   */
  region = new Signal.State<Element | null>(null);

  /**
   * The primitive, built from the props above — which is why props have to be
   * there while a field initializes.
   */
  readonly spinner: Spinner = createSpinner({
    region: () => this.region.get(),
    ...(this.loading ? { loading: this.loading } : {}),
    ...(this.defaultLoading !== undefined ? { defaultLoading: this.defaultLoading } : {}),
    ...(this.delay !== undefined ? { delay: milliseconds(this.delay, 'delay') } : {}),
    ...(this.minDuration !== undefined
      ? { minDuration: milliseconds(this.minDuration, 'minDuration') }
      : {}),
    ...(this.onLoadingChange ? { onLoadingChange: this.onLoadingChange } : {}),
  });

  /**
   * What the region says, once it may say anything.
   *
   * The platform's spelling wins over the prop that means the same thing: two
   * spellings of one name can only disagree by mistake, and the attribute is
   * the one they wrote on the tag. With neither, the primitive's own localised
   * word stands.
   */
  words(): string {
    return this.ariaLabel.get() ?? this.label.get() ?? this.spinner.label();
  }
}
