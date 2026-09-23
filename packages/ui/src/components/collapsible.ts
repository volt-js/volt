import { Component, Prop, Signal } from '@voltdev/core';
import {
  createCollapsible,
  type Collapsible,
  type CollapsibleOptions,
  type DisclosureProps,
} from '@voltdev/primitives';

/**
 * The caller's own signal, refused when it is not one.
 *
 * `<details open>` is how the platform spells a disclosure that starts open,
 * and it is the first thing anyone who knows it writes here. That hands `open`
 * a `true`, which the primitive keeps as its state and later calls `.get()`
 * on — a `TypeError` raised inside an effect, far from the tag and naming
 * nothing that leads back to it. Refused while the prop is still the thing
 * that is wrong, and pointed at `defaultOpen`, which is how starting open is
 * spelled here.
 */
function ownSignal(open: unknown): Signal.State<boolean> {
  const candidate = open as Partial<Signal.State<boolean>> | null | undefined;
  if (typeof candidate?.get === 'function' && typeof candidate.set === 'function') {
    return open as Signal.State<boolean>;
  }
  // A derived signal reads like one and passes until the first press, when the
  // trigger writes to it from inside the primitive. It is not a `<details
  // open>` either, so it is told what it is rather than that.
  if (typeof candidate?.get === 'function') {
    throw new Error(
      '[volt] `open` on <v-collapsible> was handed a signal that cannot be written to, ' +
        'and the trigger opens and closes the section by writing to it.\n' +
        '  Pass the `Signal.State` a derived signal is computed from, or hold a ' +
        '`new Signal.State(false)` of your own and pass that: `:open="mine"`.',
    );
  }
  throw new Error(
    `[volt] \`open\` on <v-collapsible> takes a signal your component holds, and ` +
      `\`${String(open)}\` is not one.\n` +
      '  `<details open>` is spelled `defaultOpen` here. To drive it, hold a ' +
      '`new Signal.State(false)` and pass that: `:open="mine"`.',
  );
}

/**
 * One section that opens and closes: a trigger, and the panel it shows.
 *
 * ```html
 * <v-collapsible label="Delivery details">
 *   <p>Everything ordered before four leaves the same day.</p>
 * </v-collapsible>
 * ```
 *
 * An accordion is a stack of these sharing one piece of state, and this is the
 * one on its own: the same primitive underneath, the same measured height to
 * animate to, and an accordion's type and spacing, with a marker that turns
 * added because a lone section has no rules around it to say it is one. What
 * it does not have is a heading — a lone disclosure is a button in the flow of
 * the page, not an entry in its outline. A section that has to be found by
 * heading is `<v-accordion collapsible>` with one item.
 *
 * The trigger's words are `label`. For a trigger that is more than a line of
 * text, write the `trigger` slot, which keeps the content of the tag meaning
 * the panel:
 *
 * ```html
 * <v-collapsible>
 *   <template :slot-trigger>In the parcel <span class="count">3 items</span></template>
 *   <ul>…</ul>
 * </v-collapsible>
 * ```
 *
 * What a caller writes on the tag lands on the trigger. It is the element with
 * a role — the button carrying `aria-expanded` — so `aria-label` written there
 * names the control, and `.mine[data-state='open']` selects on the element
 * that says whether it is open. An `id` written there is the trigger's too,
 * and a panel the trigger names — a `region` — is named after it. `lang` and
 * `dir` are the exceptions: they describe the text rather than the control,
 * so they go on the element around the trigger and the panel, and a section
 * marked as another language is marked as one all the way down.
 *
 * A closed panel is not in the page. Its content is built when it opens and
 * thrown away when it closes, so state that has to outlive a close belongs in
 * a signal of yours. A panel that is closing stays until its animation has
 * finished, which is what makes the collapse animatable at all.
 */
@Component({ selector: 'v-collapsible', templateUrl: './collapsible.html' })
export class VCollapsible {
  /** Your own signal, when whether it is open belongs to your component. */
  @Prop() open?: Signal.State<boolean>;
  /**
   * The three below are what the primitive is *built* with, read once while
   * this field list initializes — plain, because a signal would promise a
   * caller they can change them later while the section went on answering
   * with what it was built with.
   */
  /** Open from the start, when the section owns its state. */
  @Prop() defaultOpen = false;
  /**
   * Give the panel `role="region"`, and a name to be listed under. Off by
   * default, as the primitive has it: a lone disclosure is rarely worth a
   * landmark, and landmarks that name nothing in particular make the landmark
   * list harder to use, not easier. Off, the panel has no role and so takes no
   * name either — ARIA prohibits naming an element with none.
   */
  @Prop() region = false;
  /**
   * Called with where the section moved to when the trigger or a call on the
   * primitive moved it — never for a write to your own signal, which you hear
   * about where you wrote it, and never for `defaultOpen`.
   */
  @Prop() onOpenChange?: (open: boolean) => void;

  /** The trigger's words, when they are a line of text; otherwise fill `trigger`. */
  @Prop() label = new Signal.State('');
  /**
   * Names the panel's landmark, for when the trigger's words do not name it
   * well: the name is what the landmark list reads out. Only with `region` —
   * a panel that is not a landmark is not named at all. Unset, the trigger
   * names it.
   */
  @Prop() panelLabel = new Signal.State<string | undefined>(undefined);
  /**
   * Refuse the trigger, and say so.
   *
   * `aria-disabled` rather than the `disabled` attribute, so the trigger keeps
   * its place in the tab order and can still be reached and read. The refusal
   * is the primitive's, so your own signal can still move a section that is
   * off.
   */
  @Prop() disabled = new Signal.State(false);
  /**
   * The trigger's own id, for a link, a test or a `for` to find it by.
   *
   * Declared rather than left to fall through to `:host`, because the
   * primitive writes an id on the trigger too — it is what the panel is named
   * by — and two spreads writing one attribute leave whichever ran last, which
   * was the primitive's. Declared, the caller's is the one the trigger carries,
   * and a `region` is named after it. Unset or empty, the primitive's stands in.
   */
  @Prop() id = new Signal.State<string | undefined>(undefined);
  /**
   * The language the section is written in.
   *
   * Declared rather than left to fall through to `:host`, which is the
   * trigger: the tag is the whole section, and a language written on it is
   * the language of the panel as much as of the words that open it. On the
   * trigger alone the panel went on in the page's — read out in the wrong
   * voice, hyphenated and spell-checked by the wrong rules. Written on the
   * element around both instead, which each inherits it from.
   *
   * Bound as an attribute rather than the property, which would write an
   * unset one as the language "undefined". An empty one is written as given:
   * HTML reads `lang=""` as a language nobody knows, not as the page's.
   */
  @Prop() lang = new Signal.State<string | undefined>(undefined);
  /**
   * Which way the section's text runs — on the element around the trigger and
   * the panel, for the reason `lang` is: under `dir="rtl"` written on the
   * trigger alone, the words opening the section ran one way and the section
   * they opened the other.
   */
  @Prop() dir = new Signal.State<string | undefined>(undefined);

  /** The panel while it is in the page, which is what the primitive measures. */
  content = new Signal.State<Element | null>(null);

  /**
   * The primitive, built from the props above — which is why props have to be
   * there while a field initializes.
   */
  readonly collapsible: Collapsible = createCollapsible(this.options());

  /** What the trigger carries: the primitive's, under the caller's id when there is one. */
  triggerProps(): DisclosureProps {
    const own = this.collapsible.triggerProps();
    return { ...own, id: this.id.get() || own['id'] };
  }

  /**
   * What the panel carries: the primitive's, named only when it is a landmark,
   * and then by the id the trigger actually has.
   *
   * Unnamed otherwise. Without `region` the panel is a `<div>` with no role,
   * and ARIA prohibits naming one: a conformance checker refuses the markup
   * and a screen reader has nothing to read the name out as. The primitive
   * names the panel either way, so the name is taken back here, where the
   * element is chosen. Asked of the role the primitive wrote rather than of
   * `region`, which is plain: a later write to it changes neither.
   *
   * Named, it is by the trigger's id — the primitive names it by the id it
   * minted, and a trigger wearing the caller's would leave that pointing at
   * nothing — unless `panelLabel` names it instead.
   */
  contentProps(): DisclosureProps {
    const own = this.collapsible.contentProps();
    if (own['role'] === undefined) {
      const { 'aria-label': _label, 'aria-labelledby': _labelledBy, ...unnamed } = own;
      return unnamed;
    }
    const labelledBy = own['aria-labelledby'];
    if (labelledBy === undefined) return own;
    return { ...own, 'aria-labelledby': this.id.get() || labelledBy };
  }

  /** What the primitive is built with. */
  private options(): CollapsibleOptions {
    const panelLabel = this.panelLabel;
    return {
      content: () => this.content.get(),
      disabled: () => this.disabled.get(),
      defaultOpen: this.defaultOpen,
      region: this.region,
      // A getter, because the primitive reads the name each time it writes the
      // panel's attributes and a string handed over here would be the one it
      // kept. An empty one is no name, and falls back to the trigger.
      labels: {
        get content() {
          return panelLabel.get() || undefined;
        },
      },
      ...(this.open !== undefined ? { open: ownSignal(this.open) } : {}),
      ...(this.onOpenChange ? { onOpenChange: this.onOpenChange } : {}),
    };
  }
}
