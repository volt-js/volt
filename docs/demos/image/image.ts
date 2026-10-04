import { Component, Signal } from '@voltdev/core';
import { VButton, VImage, VSkeletonShape } from '@voltdev/ui/components';

/**
 * A picture drawn inline, so the frame has something that loads without a
 * network: an `<img>` treats a `data:` URL exactly as it treats a fetched one.
 * Wide, so a square box has something to crop and something to letterbox.
 */
function valley(): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800">` +
    `<rect width="1200" height="800" fill="#f6d8a8"/>` +
    `<circle cx="840" cy="300" r="110" fill="#fbeed0"/>` +
    `<path d="M0 520c180-90 360-120 560-60s420 40 640-50v390H0z" fill="#6f9a5b"/>` +
    `<path d="M0 640c240-80 520-90 760-30s320 20 440-20v210H0z" fill="#3f6b3a"/>` +
    `<path d="M560 800c40-90 90-150 160-190" stroke="#d9c08a" stroke-width="18" fill="none"/>` +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** A path nothing answers, which is what a picture that fails looks like. */
const MISSING = '/pictures/no-such-picture.jpg';

@Component({
  selector: 'v-gallery',
  templateUrl: './image.html',
  styleUrl: './image.scss',
  imports: [VButton, VImage, VSkeletonShape],
})
export class Gallery {
  readonly valley = valley();
  readonly missing = MISSING;

  /** The first picture, which the button breaks and mends. */
  photo = new Signal.State<string>(this.valley);

  broken(): boolean {
    return this.photo.get() === MISSING;
  }

  toggle = (): void => {
    this.photo.set(this.broken() ? this.valley : MISSING);
  };
}
