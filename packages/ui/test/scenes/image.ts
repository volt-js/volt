import { compileTemplate } from '@voltdev/core/jit';
import { Component, Signal } from '@voltdev/core';
import { createImage } from '@voltdev/primitives';
import { show, step, type Scene } from '../scene.ts';

/**
 * `image.html` twice — a picture with a size of its own, and one with only a
 * shape — with the primitive's own props where the component adds the
 * caller's names. The sheet reads none of those, so the picture of what it
 * selects on is the same.
 */
@Component({
  selector: 'v-styled-image',
  render: compileTemplate(`
    <div>
      <span class="volt-image" :spread="cover.boxProps()">
        <img :ref="coverElement" class="volt-image-picture" :attr-data-fit="fit.get()"
             :spread="cover.imageProps()">
        <span :if="cover.isLoading()" class="volt-image-placeholder" aria-hidden="true"></span>
        <span :if="cover.hasError()" class="volt-image-error">The picture did not load.</span>
      </span>
      <span class="volt-image" :spread="view.boxProps()">
        <img :ref="viewElement" class="volt-image-picture" data-fit="cover"
             :spread="view.imageProps()">
        <span :if="view.isLoading()" class="volt-image-placeholder" aria-hidden="true"></span>
        <span :if="view.hasError()" class="volt-image-error">The picture did not load.</span>
      </span>
    </div>
  `),
})
class StyledImage {
  coverElement = new Signal.State<Element | null>(null);
  viewElement = new Signal.State<Element | null>(null);
  /** Signals, as `<v-image>` holds its props, so the scene can move each one. */
  src = new Signal.State<string | null>('/cover.jpg');
  fit = new Signal.State('cover');
  cover = createImage({
    image: () => this.coverElement.get(),
    src: () => this.src.get(),
    alt: () => 'The first edition, in green cloth',
    width: 1200,
    height: 800,
  });
  /** A shape and no size: the box that takes its width from its container. */
  view = createImage({
    image: () => this.viewElement.get(),
    src: () => '/harbour.jpg',
    alt: () => 'The harbour at dawn',
    aspectRatio: '16 / 9',
  });
}

export const scene: Scene = (look) => {
  const { src, fit } = show(StyledImage);
  // The events a browser sends the `<img>` when it is done. happy-dom fetches
  // no images, so it sends neither, and a scene waiting for one would look at
  // the placeholder forever.
  const picture = (index: number) => document.querySelectorAll('.volt-image-picture')[index]!;
  const [cover, view] = [() => picture(0), () => picture(1)];

  // Loading: the placeholder up, beneath a picture with nothing yet to paint.
  look();
  // Loaded: the picture, the placeholder gone and the box's fill with it.
  step(() => cover().dispatchEvent(new Event('load')));
  look();
  // Letterboxed rather than cropped, which the component writes and the
  // primitive has no say in.
  step(() => fit.set('contain'));
  look();
  // A new picture that fails: hidden, and the message in its place.
  step(() => src.set('/missing.jpg'));
  step(() => cover().dispatchEvent(new Event('error')));
  look();
  // No picture at all.
  step(() => src.set(null));
  look();
  // The box with only a shape, failed: no width of its own to keep, and the
  // message under a picture folded to nothing.
  step(() => view().dispatchEvent(new Event('error')));
  look();
};
