import { Component, Prop, Signal, effect } from '@voltdev/core';
import { createAvatar, type Avatar, type AvatarProps } from '@voltdev/primitives';

declare const __VOLT_DEV__: boolean;

/** How big the box is: `sm`, `md` or `lg`. */
export type AvatarSize = 'sm' | 'md' | 'lg';

/** What the box is cut to: a circle, or a square with rounded corners. */
export type AvatarShape = 'circle' | 'square';

/**
 * A person's picture, with their initials behind it.
 *
 * ```html
 * <v-avatar :src="user.get().photo" :name="user.get().name"></v-avatar>
 * ```
 *
 * The picture when it loads; the initials while it loads, when it fails, and
 * when there is no picture at all. The two are stacked in one box, so the swap
 * moves nothing on the page.
 *
 * The `<img>` is on the page the whole time, even while nobody can see it,
 * because an image that is not in the document is never fetched. What decides
 * which of the two is seen is the image's `data-status`, which the sheet
 * reads; what decides which of the two is *heard* is the primitive, and it is
 * the part that is easy to get wrong. The name is said once. While the
 * initials are up they carry it, as `role="img"` with the name as their label
 * — "AL" is either spelled out or read as a word, and neither is who this is
 * — and the image beside them is `alt=""`. Once the picture has loaded the
 * initials are gone and the image's `alt` is the name. With no name at all
 * both are silent, because a blank picture of nobody in particular is
 * decoration.
 *
 * What a caller writes on the tag — a class, an id, a `data-*` — lands on the
 * box, which is the element their layout places: a row of overlapping avatars
 * is the page's CSS over these boxes, not a second tag. The box has no role,
 * because the element carrying the name changes as the picture loads, so the
 * three attributes that name or describe something are declared here rather
 * than left to land on it, and each is put on whichever element the primitive
 * named at the time.
 *
 * `:ref` reaches `avatar`, the primitive, for the status and everything else
 * this does not draw.
 */
@Component({ selector: 'v-avatar', templateUrl: './avatar.html' })
export class VAvatar {
  /** The picture. Empty, `null` or left off means there is none, and the initials stand alone. */
  @Prop() src = new Signal.State<string | null | undefined>(undefined);
  /** Who is pictured: what a reader hears, once, and what the initials are taken from. */
  @Prop() name = new Signal.State<string | null | undefined>(undefined);
  /** `sm`, `md` or `lg`. Default `md`. */
  @Prop() size = new Signal.State<AvatarSize>('md');
  /** `circle` or `square`. Default `circle`. */
  @Prop() shape = new Signal.State<AvatarShape>('circle');

  /**
   * What a reader hears in place of `name`, when the two should differ —
   * "Ada Lovelace (you)" over initials that are still Ada's.
   *
   * Declared rather than left to fall through to `:host`, which is the box: a
   * name there sits on an element with no role, where most screen readers
   * throw it away and the rest read it as well as the picture's own. Written
   * without `name`, it is the name, initials and all.
   */
  @Prop({ alias: 'aria-label' }) ariaLabel = new Signal.State<string | undefined>(undefined);
  /**
   * Id of the element that names the picture, where the page already says who
   * this is. Put beside the primitive's name on whichever element carries it,
   * where it wins; the name is what is heard if the reference finds nothing.
   * It needs `name` or `aria-label` for that reason, and without one it has
   * nowhere to go — see `reportUnnamedReference`.
   */
  @Prop({ alias: 'aria-labelledby' }) ariaLabelledBy = new Signal.State<string | undefined>(
    undefined,
  );
  /** Id of an element that says more — "online", "away" — put where the name is. */
  @Prop({ alias: 'aria-describedby' }) describedBy = new Signal.State<string | undefined>(
    undefined,
  );

  /**
   * The picture, which the primitive watches for `load` and `error`. A signal,
   * because it does not exist while this class is being built.
   */
  image = new Signal.State<Element | null>(null);

  /**
   * The primitive, built from the props above — which is why props have to be
   * there while a field initializes. Every option is an accessor over a
   * signal, so a picture or a name swapped later starts a new load and new
   * initials rather than being read once.
   *
   * It is not handed the fallback element. What that element tells it is only
   * whether the initials are up, and the primitive already knows that; what
   * it does not know is when the element will arrive, and on a server it never
   * does. The image goes quiet in `imageProps` instead, on the primitive's own
   * word that the initials are showing.
   */
  readonly avatar: Avatar = createAvatar({
    image: () => this.image.get(),
    src: () => this.src.get(),
    name: () => this.named(),
  });

  constructor() {
    if (__VOLT_DEV__) effect(() => this.reportUnnamedReference());
  }

  /**
   * The image's attributes: the primitive's, quiet while the initials are up,
   * and with the caller's words for the name once the image is the element
   * carrying it.
   *
   * Quiet on the strength of the initials being drawn, not of their element
   * having arrived. A server render has no elements, and markup that named
   * both would be read twice by everyone who met the page before a script ran
   * — and for good by anyone whose script never did. An empty `alt` from the
   * primitive, which is its word that there is no name, is left as it is.
   */
  imageProps(): AvatarProps {
    const props = this.avatar.imageProps();
    if (this.avatar.isFallbackVisible() || !props['alt']) return { ...props, alt: '' };
    return { ...props, alt: this.spoken() ?? props['alt'], ...this.references() };
  }

  /**
   * The initials' attributes, on the same terms: a fallback the primitive has
   * hidden stays hidden, and one it named is named in the caller's words.
   */
  fallbackProps(): AvatarProps {
    const props = this.avatar.fallbackProps();
    if (!props['aria-label']) return props;
    return { ...props, 'aria-label': this.spoken() ?? props['aria-label'], ...this.references() };
  }

  /** `aria-label` from the tag, when it says something. */
  private spoken(): string | undefined {
    return this.ariaLabel.get()?.trim() || undefined;
  }

  /**
   * Who is pictured: `name`, or `aria-label` without one.
   *
   * Trimmed before it is asked whether it is there, because the primitive
   * trims it: a `name` of spaces is no name to it, and has to be none here
   * too, or it would stand in front of an `aria-label` that says who this is
   * and leave the avatar silent.
   */
  private named(): string {
    return this.name.get()?.trim() || this.spoken() || '';
  }

  /** Only the references that were written: an absent one is not an attribute. */
  private references(): AvatarProps {
    const labelledBy = this.ariaLabelledBy.get();
    const describedBy = this.describedBy.get();
    return {
      ...(labelledBy ? { 'aria-labelledby': labelledBy } : {}),
      ...(describedBy ? { 'aria-describedby': describedBy } : {}),
    };
  }

  /**
   * A reference with no name beside it names nothing, so say so.
   *
   * With neither `name` nor `aria-label` the primitive takes the avatar for
   * decoration — the initials `aria-hidden`, the image `alt=""` — and a
   * reference put on either would be a label or a description on something
   * every screen reader has been told to skip. Making it speak would mean
   * overruling the primitive on who is pictured, which is the one thing it
   * exists to decide, so the reference is kept and the missing name is said
   * out loud instead.
   */
  private reportUnnamedReference(): void {
    const written = [
      ['aria-labelledby', this.ariaLabelledBy.get()],
      ['aria-describedby', this.describedBy.get()],
    ].filter((entry): entry is [string, string] => Boolean(entry[1]));
    if (written.length === 0 || typeof console === 'undefined') return;
    if (this.named()) return;

    const attributes = written.map(([attribute, id]) => `${attribute}="${id}"`).join(' and ');
    console.warn(
      `[volt] <v-avatar> was given ${attributes} and no name, so it is decoration and ` +
        `${written.length === 1 ? 'the reference goes' : 'the references go'} nowhere.\n` +
        '  Give it `name` as well — what a label falls back on, what a description ' +
        'describes, and what says there is someone pictured at all.',
    );
  }
}
