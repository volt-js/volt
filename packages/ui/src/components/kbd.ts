import { Component, Prop, Signal } from '@voltdev/core';
import {
  createKbd,
  type Kbd,
  type KbdOptions,
  type KbdPart,
  type KbdPlatform,
  type KbdProps,
} from '@voltdev/primitives';

/**
 * The platform a caller named, refused when it is not one the primitive knows.
 *
 * The primitive tells the two apart by asking whether it was handed `apple`,
 * so anything else draws everywhere else's keys: `platform="mac"` is a Mac
 * page showing `Ctrl+K` and saying "Control K", with nothing anywhere to say
 * why. Refused here, while the prop is still the thing that is wrong.
 */
function platformOf(value: unknown): KbdPlatform | undefined {
  if (value === undefined || value === null) return undefined;
  if (value === 'apple' || value === 'other') return value;
  throw new Error(
    `[volt] \`platform\` on <v-kbd> is 'apple' or 'other', and \`${String(value)}\` is ` +
      'neither.\n  Leave it off to have it read from the browser.',
  );
}

/**
 * A keyboard shortcut, drawn as keycaps and said as words.
 *
 * ```html
 * Search with <v-kbd keys="mod+k"></v-kbd>.
 * ```
 *
 * That is `⌘ K` on an Apple platform and `Ctrl + K` everywhere else, and a
 * screen reader hears "Command k" or "Control k" — the primitive's names for
 * the keys, because `⌘` read aloud is "place of interest sign", or silence.
 * `mod` is the one word in `keys` that is not a `KeyboardEvent.key` name: it
 * is whichever modifier the platform uses for its own shortcuts, which is the
 * key a page almost always means and the one it cannot name without knowing
 * where it runs.
 *
 * The chord is an outer `<kbd>` with one `<kbd>` per key inside it, which is
 * how HTML spells a key combination. The outer one carries the primitive's
 * `role="img"` and the spoken name, and is what a caller's attributes land on:
 * it is the element a screen reader meets, so `aria-label` written on the tag
 * renames the shortcut and `lang` decides how its letters are upper-cased.
 * Everything inside is drawn and not read — `img` makes its content
 * presentational — and the separator between keys is `aria-hidden` on top of
 * that, so no reader that walks into the image anyway reads "plus" between
 * every pair of names.
 *
 * A letter is left in the case it was written and drawn as a capital by the
 * sheet: `mod+k` and `mod+K` are the same keycap. Upper-casing is a visual
 * convention and needs the language to be right, and `text-transform` has
 * one where `toUpperCase` does not.
 *
 * Nothing here takes focus or answers a key. A shortcut is text about the
 * keyboard, not a control on it; binding the chord to what it does is the
 * page's, and `aria-keyshortcuts` on the control it triggers is where a
 * screen reader looks for it.
 */
@Component({ selector: 'v-kbd', templateUrl: './kbd.html' })
export class VKbd {
  /**
   * The chord, in `KeyboardEvent.key` names joined by `+` — `Shift+Enter`,
   * `mod+k` — or as a list, which is how the plus key itself is written:
   * `['mod', '+']`. `mod` is Command on an Apple platform and Control
   * everywhere else. A name the primitive has no symbol for is drawn and said
   * as written.
   */
  @Prop() keys = new Signal.State<string | readonly string[] | null | undefined>(undefined);
  /**
   * Which platform's keys to draw: `apple` or `other`.
   *
   * Left off, the primitive reads it from the user agent, which a server does
   * not have — a server render draws `other` and a Mac replaces it when the
   * page attaches. Pass it, from the request's user agent, to make both sides
   * agree, and in a test or a page of documentation that shows one platform
   * whatever it is read on.
   *
   * Plain rather than a signal, because the primitive takes it once while this
   * field list initializes and picks its symbols and names from it there: a
   * signal would promise a caller they could change it later.
   */
  @Prop() platform?: KbdPlatform;
  /**
   * `md`, the default, for a shortcut in running text; `sm` for one beside a
   * menu item or in small print, where the text around it is smaller already.
   */
  @Prop() size = new Signal.State<'sm' | 'md'>('md');
  /**
   * The shortcut's spoken name, in place of the primitive's — for a page in a
   * language the locale does not cover, or a chord better said another way.
   *
   * Declared rather than left to fall through to `:host`, because the
   * primitive's bag names the chord too, on the same element, and two spreads
   * writing one attribute leave whichever ran last. Declared, it is merged
   * into that bag, and the caller's name is the one it carries.
   */
  @Prop({ alias: 'aria-label' }) ariaLabel = new Signal.State<string | undefined>(undefined);

  /**
   * The primitive, built from the props above — which is why props have to be
   * there while a field initializes.
   */
  readonly shortcut: Kbd = createKbd(this.options());

  /**
   * The chord as the primitive reads it, with `mod` made the platform's own
   * modifier.
   *
   * The string is split on `+` here, which is the primitive's own rule, so
   * that `mod` can be found in it; trimming each name and dropping empty ones
   * is left to the primitive, which does it for the list form too. The
   * platform is the primitive's, which is the one it draws the symbols of —
   * not the prop, which is unset whenever the primitive worked it out itself.
   */
  chord(): readonly string[] | null | undefined {
    const written = this.keys.get();
    if (written === null || written === undefined) return written;
    const modifier = this.shortcut.platform() === 'apple' ? 'Meta' : 'Control';
    return (typeof written === 'string' ? written.split('+') : written).map((name) =>
      name.trim() === 'mod' ? modifier : name,
    );
  }

  /**
   * What the chord carries: the primitive's, under the caller's name when
   * there is one.
   *
   * Only where the primitive names it at all. With no keys there is no role,
   * and ARIA prohibits naming an element that has none, so a caller's name on
   * an empty shortcut is dropped rather than written. An empty name is no
   * name — and so is one of blanks, which the accessible name computation
   * trims to nothing anyway — and the primitive's stands: a keycap image
   * called nothing is one a screen reader skips.
   */
  kbdProps(): KbdProps {
    const own = this.shortcut.kbdProps();
    const name = this.ariaLabel.get()?.trim();
    return name && own['aria-label'] !== undefined ? { ...own, 'aria-label': name } : own;
  }

  /**
   * What is drawn between two keys: nothing on an Apple platform, `+`
   * elsewhere.
   *
   * The primitive keeps its separator to itself and hands it out only inside
   * `text()`, joined between the keys. So it is read back out of there rather
   * than restated here, where a second copy of the default could drift from
   * the first.
   */
  separator(): string {
    const parts = this.shortcut.parts();
    if (parts.length < 2) return '';
    const text = this.shortcut.text();
    const keys = parts.reduce((length, part) => length + part.text.length, 0);
    const start = parts[0]!.text.length;
    return text.slice(start, start + (text.length - keys) / (parts.length - 1));
  }

  /**
   * `''` for a key that is a character rather than a named key — `k` rather
   * than `Enter` — which the sheet draws as a capital; nothing otherwise.
   *
   * `KeyboardEvent.key` names a character key by the character itself, so a
   * key drawn as its own name, and that name one character long, is one. The
   * space bar is not: its name is one character, and it is drawn as a word.
   */
  character(part: KbdPart): '' | undefined {
    return part.text === part.key && [...part.key].length === 1 ? '' : undefined;
  }

  /** What the primitive is built with. */
  private options(): KbdOptions {
    const platform = platformOf(this.platform);
    return {
      keys: () => this.chord(),
      ...(platform ? { platform } : {}),
    };
  }
}
