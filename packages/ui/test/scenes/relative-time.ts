import { compileTemplate } from '@voltdev/core/jit';
import { Component, Signal } from '@voltdev/core';
import { createRelativeTime, type RelativeTimeProps } from '@voltdev/primitives';
import { show, step, type Scene } from '../scene.ts';

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
const WEEK = 7 * DAY;

/**
 * `relative-time.html`, with the primitive's bag spread on the `<time>` and
 * its `title` written apart from it, the way the component writes it.
 *
 * The threshold and the date past it are the component's, so they are written
 * out here as it decides them, at their defaults: a week, and the day without
 * the hour. The tooltip is the primitive's exact moment, dropped where it
 * would repeat the text — which these defaults never make it do, so the one
 * way here for the sheet's one rule to stop matching is the primitive's own:
 * a stamp with no date, which it writes nothing on.
 */
@Component({
  selector: 'v-styled-relative-time',
  render: compileTemplate(`
    <time class="volt-relative-time" :spread="bag()" :attr-title="tooltip()">{ shown() }</time>
  `),
})
class StyledRelativeTime {
  date = new Signal.State<Date | null>(new Date(Date.now() - 3 * MINUTE));
  stamp = createRelativeTime({ date: () => this.date.get() });

  past(): boolean {
    const target = this.stamp.date();
    this.stamp.unit();
    return target !== null && Math.abs(target.getTime() - Date.now()) >= WEEK;
  }

  bag(): RelativeTimeProps {
    const { title: _, ...rest } = this.stamp.timeProps();
    return rest;
  }

  shown(): string {
    const target = this.stamp.date();
    if (!target) return '';
    return this.past()
      ? new Intl.DateTimeFormat(undefined, { dateStyle: 'long' }).format(target)
      : this.stamp.text();
  }

  tooltip(): string | null {
    const exact = this.stamp.absolute();
    return exact === '' || exact === this.shown() ? null : exact;
  }
}

export const scene: Scene = (look) => {
  const { date } = show(StyledRelativeTime);
  // Minutes ago: the words, with the exact moment a hover away.
  look();
  // A month ago: the date itself, with its hour still behind it.
  step(() => date.set(new Date(Date.now() - 30 * DAY)));
  look();
  // Not known yet: an empty `<time>`, which the primitive writes nothing on.
  step(() => date.set(null));
  look();
};
