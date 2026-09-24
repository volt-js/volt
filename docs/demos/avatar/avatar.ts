import { Component, Signal } from '@voltdev/core';
import { VAvatar, VButton } from '@voltdev/ui/components';

/**
 * A picture drawn inline, so the frame has something that loads without a
 * network: an `<img>` treats a `data:` URL exactly as it treats a fetched one.
 */
function portrait(skin: string, hair: string, shirt: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<rect width="64" height="64" fill="#e9eef6"/>` +
    `<path d="M8 64c2-15 12-22 24-22s22 7 24 22z" fill="${shirt}"/>` +
    `<circle cx="32" cy="27" r="13" fill="${skin}"/>` +
    `<path d="M19 26c0-9 6-15 13-15s13 6 13 15c-4-5-9-7-13-7s-9 2-13 7z" fill="${hair}"/>` +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** A path nothing answers, which is what a picture that fails looks like. */
const MISSING = '/avatars/no-such-picture.png';

@Component({
  selector: 'v-people',
  templateUrl: './avatar.html',
  styleUrl: './avatar.scss',
  imports: [VAvatar, VButton],
})
export class People {
  readonly ama = portrait('#8d5a3b', '#2b1d16', '#2f6feb');

  /** The first picture, which the button breaks and mends. */
  photo = new Signal.State<string>(this.ama);

  readonly team = [
    { name: 'Ama Mensah', photo: this.ama },
    { name: 'Grace Hopper', photo: undefined },
    { name: 'Tomás Ruiz', photo: portrait('#e0b38c', '#6b4226', '#167f4a') },
    { name: 'Alan Turing', photo: MISSING },
    { name: 'Mei Chen', photo: undefined },
  ];

  broken(): boolean {
    return this.photo.get() === MISSING;
  }

  toggle = (): void => {
    this.photo.set(this.broken() ? this.ama : MISSING);
  };
}
