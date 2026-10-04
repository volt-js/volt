import { Component, Signal } from '@voltdev/core';
import { VRating } from '@voltdev/ui/components';

@Component({
  selector: 'v-review',
  templateUrl: './rating.html',
  styleUrl: './rating.scss',
  imports: [VRating],
})
export class Review {
  /** The page holds the score, so the line under the stars reads the same signal. */
  stay = new Signal.State<number | null>(null);

  /** What a screen reader hears for each star in place of `3 of 5`. */
  stars = (value: number): string => `${value} ${value === 1 ? 'star' : 'stars'}`;

  /** The average from every review so far, which nobody here can change. */
  average = 4.5;

  said(): string {
    const score = this.stay.get();
    return score === null ? 'Not rated yet.' : `You gave it ${this.stars(score)}.`;
  }
}
