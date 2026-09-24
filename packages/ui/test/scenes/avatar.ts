import { compileTemplate } from '@voltdev/core/jit';
import { Component, Signal } from '@voltdev/core';
import { createAvatar } from '@voltdev/primitives';
import { show, step, type Scene } from '../scene.ts';

/**
 * `avatar.html`, with the primitive's own props where the component puts its
 * own `alt` and the caller's words for the name over them. The sheet reads
 * none of those, so the picture of what it selects on is the same.
 */
@Component({
  selector: 'v-styled-avatar',
  render: compileTemplate(`
    <span class="volt-avatar" :spread="avatar.rootProps()" :attr-data-size="size.get()"
          :attr-data-shape="shape.get()">
      <img :ref="image" class="volt-avatar-image" :spread="avatar.imageProps()">
      <span :if="avatar.isFallbackVisible()" class="volt-avatar-fallback"
            :spread="avatar.fallbackProps()">{ avatar.initials() }</span>
    </span>
  `),
})
class StyledAvatar {
  image = new Signal.State<Element | null>(null);
  /** Signals, as `<v-avatar>` holds its props, so the scene can move each one. */
  src = new Signal.State<string | null>('/ada.png');
  size = new Signal.State('md');
  shape = new Signal.State('circle');
  avatar = createAvatar({
    image: () => this.image.get(),
    src: () => this.src.get(),
    name: () => 'Ada Lovelace',
  });
}

export const scene: Scene = (look) => {
  const { src, size, shape } = show(StyledAvatar);
  // The events a browser sends the `<img>` when it is done. happy-dom fetches
  // no images, so it sends neither, and a scene waiting for one would look at
  // the initials forever.
  const image = () => document.querySelector('.volt-avatar-image')!;

  // Loading: the initials up, the picture on the page and not yet seen.
  look();
  // Loaded: the picture, and the initials gone.
  step(() => image().dispatchEvent(new Event('load')));
  look();
  // A new picture that fails, which is the initials again, for good this time.
  step(() => src.set('/missing.png'));
  step(() => image().dispatchEvent(new Event('error')));
  look();
  // No picture at all.
  step(() => src.set(null));
  look();

  // The two sizes either side of the default, and the square, which the
  // component writes and the primitive has no say in. Each is a box whatever
  // the status, so one pass of them in one status reaches every rule.
  step(() => size.set('sm'));
  look();
  step(() => {
    size.set('lg');
    shape.set('square');
  });
  look();
};
