/**
 * Alerts, skeletons, spinners and empty states, driven through real mounted
 * components.
 *
 * The one thing every test here is really about is timing: a live region that
 * arrives holding its message announces nothing, and every one of these four
 * components exists to stop a consumer writing that. So the assertions are
 * mostly about what is in the DOM *before* the words are, what carries
 * `aria-busy` and what must not, and where focus lands when a message the user
 * was standing on is taken away.
 *
 * Timers are faked throughout, so "waited fifty milliseconds" is exact rather
 * than flaky, and `Date.now()` moves with them — which is what the minimum
 * on-screen arithmetic is measured against.
 */
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { build as viteBuild } from 'vite';
import { compileTemplate } from '@voltdev/core/jit';
import { Component, Signal, flushSync, mount } from '@voltdev/core';
import {
  createAlert,
  createDeferredVisibility,
  createEmptyState,
  createLiveRegionTiming,
  createSkeleton,
  createSpinner,
  type AlertOptions,
  type EmptyStateOptions,
  type SkeletonOptions,
  type SpinnerOptions,
} from '../src/feedback.ts';
import { createLocaleProvider } from '../src/i18n.ts';
import { createDismiss } from '../src/dismiss.ts';

let host: HTMLElement;
let mounted: { unmount(): void }[] = [];

function track<T extends { unmount(): void }>(handle: T): T {
  mounted.push(handle);
  return handle;
}

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '<div id="app"></div>';
  host = document.querySelector('#app') as HTMLElement;
});

afterEach(() => {
  for (const handle of mounted) handle.unmount();
  mounted = [];
  flushSync();
  vi.useRealTimers();
});

/** Settle first — a timer nothing has started yet cannot fire — then run. */
function advance(ms: number) {
  flushSync();
  vi.advanceTimersByTime(ms);
  flushSync();
}

function key(el: Element, k: string, init: KeyboardEventInit = {}) {
  el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...init }));
  flushSync();
}

// ---------------------------------------------------------------------------
// Alert
// ---------------------------------------------------------------------------

/** Options read by the component's field initialiser, so each test can vary them. */
let alertOptions: Omit<AlertOptions, 'region'> = {};

/**
 * The shape a consumer reaches for first: the region comes and goes with the
 * alert. It is the harder of the two cases, because the region has to be on the
 * page before the sentence is, and here they would otherwise arrive together.
 */
@Component({
  selector: 'v-alert',
  render: compileTemplate(`
    <div>
      <button class="raise" :click="alert.open()">save</button>
      <div :if="alert.isPresent()" class="region" :ref="region" :spread="alert.rootProps()">
        <p class="message" :if="alert.isMessageVisible()" :spread="alert.messageProps()">
          <span class="text">Could not save</span>
          <button class="dismiss" :spread="alert.dismissProps()">x</button>
        </p>
      </div>
    </div>
  `),
})
class Failure {
  region = new Signal.State<Element | null>(null);
  alert = createAlert({ region: () => this.region.get(), ...alertOptions });
}

/** The shape this library recommends: the region is there from the start. */
@Component({
  selector: 'v-alert-static',
  render: compileTemplate(`
    <div>
      <button class="raise" :click="alert.open()">save</button>
      <div class="region" :ref="region" :spread="alert.rootProps()">
        <p class="message" :if="alert.isMessageVisible()" :spread="alert.messageProps()">saved</p>
      </div>
    </div>
  `),
})
class StaticRegion {
  region = new Signal.State<Element | null>(null);
  alert = createAlert({ region: () => this.region.get(), ...alertOptions });
}

/** A consumer who ignores `isMessageVisible()` entirely. */
@Component({
  selector: 'v-alert-eager',
  render: compileTemplate(`
    <div :if="alert.isPresent()" class="region" :ref="region" :spread="alert.rootProps()">
      <p class="message" :spread="alert.messageProps()">Could not save</p>
    </div>
  `),
})
class EagerMessage {
  region = new Signal.State<Element | null>(null);
  alert = createAlert({ region: () => this.region.get(), defaultOpen: true, ...alertOptions });
}

function setupAlert(options: Omit<AlertOptions, 'region'> = {}, component = Failure) {
  alertOptions = options;
  const handle = track(mount(component, host));
  const instance = handle.instance as Failure;
  return {
    alert: instance.alert,
    raise: () => host.querySelector('.raise') as HTMLElement,
    region: () => host.querySelector('.region'),
    message: () => host.querySelector('.message'),
    dismiss: () => host.querySelector('.dismiss') as HTMLElement,
  };
}

afterEach(() => {
  alertOptions = {};
});

describe('alert: the region exists before the words', () => {
  it('renders the region empty first, and the message a task later', () => {
    const { raise, region, message } = setupAlert();

    raise().click();
    flushSync();

    // The whole component in one assertion: a screen reader announces changes
    // inside a region, so the region has to be there to be changed.
    expect(region()).not.toBeNull();
    expect(region()!.getAttribute('role')).toBe('alert');
    expect(message()).toBeNull();

    advance(50);
    expect(message()).not.toBeNull();
    expect(message()!.textContent).toContain('Could not save');
  });

  it('does not make an already-mounted region wait', () => {
    const { raise, message } = setupAlert({}, StaticRegion);
    // The region has been on the page since mount, so it settled long ago.
    advance(50);

    raise().click();
    flushSync();
    // No advance: the message itself is the mutation, and delaying it here
    // would only make the announcement late.
    expect(message()).not.toBeNull();
  });

  it('hides a message the consumer rendered unconditionally', () => {
    // Nobody reads `isMessageVisible()` in this template, so the props have to
    // carry the same rule — out of the accessibility tree as well as off the
    // screen, since a message read early is a message read into silence.
    alertOptions = {};
    track(mount(EagerMessage, host));
    flushSync();

    const message = () => host.querySelector('.message') as HTMLElement;
    expect(message().hasAttribute('hidden')).toBe(true);

    advance(50);
    expect(message().hasAttribute('hidden')).toBe(false);
  });

  it('re-arms the wait each time a removed region comes back', () => {
    const { alert, raise, message } = setupAlert();

    raise().click();
    advance(50);
    expect(message()).not.toBeNull();

    alert.close();
    flushSync();
    expect(message()).toBeNull();

    alert.open();
    flushSync();
    // The region is a new node, so it is new to the accessibility tree too.
    expect(message()).toBeNull();
    advance(50);
    expect(message()).not.toBeNull();
  });

  it('honours an announce delay of zero for a region that never leaves', () => {
    const { raise, message } = setupAlert({ announceDelay: 0 }, StaticRegion);
    raise().click();
    flushSync();
    expect(message()).not.toBeNull();
  });
});

describe('alert: what assistive technology is told', () => {
  it('is an assertive alert by default', () => {
    const { raise, region } = setupAlert();
    raise().click();
    flushSync();

    const el = region()!;
    // Both, deliberately: the role satisfies the specification and some
    // assistive technology honours only the explicit attribute.
    expect(el.getAttribute('role')).toBe('alert');
    expect(el.getAttribute('aria-live')).toBe('assertive');
    // Read whole on every change: half a sentence is worse than a repeat.
    expect(el.getAttribute('aria-atomic')).toBe('true');
    expect(el.getAttribute('data-priority')).toBe('assertive');
  });

  it('is a polite status when asked, with the role changed to match', () => {
    const { raise, region, alert } = setupAlert({ priority: 'polite' });
    raise().click();
    flushSync();

    expect(alert.priority()).toBe('polite');
    expect(region()!.getAttribute('role')).toBe('status');
    expect(region()!.getAttribute('aria-live')).toBe('polite');
  });

  it('never names the region', () => {
    const { raise, region } = setupAlert();
    raise().click();
    flushSync();

    // A name on a live region is announced instead of its contents in some
    // screen readers, which for a message region is the message lost.
    expect(region()!.hasAttribute('aria-label')).toBe(false);
    expect(region()!.hasAttribute('aria-labelledby')).toBe(false);
    // And nothing that would tell a screen reader to hold its tongue.
    expect(region()!.hasAttribute('aria-busy')).toBe(false);
  });

  it('writes the presence state for CSS to animate against', () => {
    const { alert, raise, region } = setupAlert();
    raise().click();
    flushSync();
    expect(region()!.getAttribute('data-state')).toBe('open');
    expect(alert.state()).toBe('open');
  });
});

describe('alert: dismissing', () => {
  it('labels the dismiss control and gives it button semantics', () => {
    const { raise, dismiss } = setupAlert();
    raise().click();
    advance(50);

    const el = dismiss();
    expect(el.getAttribute('aria-label')).toBe('Dismiss');
    // Covering both elements at once: the role is the only thing that makes a
    // <div> announce as a button, `type` the only thing stopping a <button>
    // submitting the form around it.
    expect(el.getAttribute('role')).toBe('button');
    expect(el.getAttribute('type')).toBe('button');
    expect(el.getAttribute('tabindex')).toBe('0');
  });

  it('takes an overridden label', () => {
    const { raise, dismiss } = setupAlert({ labels: { dismiss: 'Verwerfen' } });
    raise().click();
    advance(50);
    expect(dismiss().getAttribute('aria-label')).toBe('Verwerfen');
  });

  it('closes on a press, once', () => {
    const onOpenChange = vi.fn();
    const { raise, dismiss, region } = setupAlert({ onOpenChange });
    raise().click();
    advance(50);

    dismiss().click();
    flushSync();
    expect(region()).toBeNull();
    expect(onOpenChange).toHaveBeenNthCalledWith(1, true);
    expect(onOpenChange).toHaveBeenNthCalledWith(2, false);
    expect(onOpenChange).toHaveBeenCalledTimes(2);
  });

  it('leaves Enter and Space alone on a real button', () => {
    const { raise, dismiss, region } = setupAlert();
    raise().click();
    advance(50);

    // The browser turns both into a click of its own; acting here as well
    // would dismiss twice for one press.
    key(dismiss(), 'Enter');
    key(dismiss(), ' ');
    expect(region()).not.toBeNull();
  });

  it('activates a dismiss control that is not a button', () => {
    @Component({
      selector: 'v-alert-span',
      render: compileTemplate(`
        <div class="region" :ref="region" :spread="alert.rootProps()">
          <span class="dismiss" :spread="alert.dismissProps()">x</span>
        </div>
      `),
    })
    class SpanDismiss {
      region = new Signal.State<Element | null>(null);
      alert = createAlert({ region: () => this.region.get(), defaultOpen: true });
    }

    const handle = track(mount(SpanDismiss, host));
    const alert = (handle.instance as SpanDismiss).alert;
    const el = host.querySelector('.dismiss') as HTMLElement;
    flushSync();

    key(el, 'Enter');
    expect(alert.isOpen()).toBe(false);

    alert.open();
    flushSync();
    key(el, ' ');
    expect(alert.isOpen()).toBe(false);

    // A modified key is a shortcut, not an activation.
    alert.open();
    flushSync();
    key(el, 'Enter', { ctrlKey: true });
    expect(alert.isOpen()).toBe(true);
  });

  it('closes on Escape from inside', () => {
    const { raise, dismiss, region } = setupAlert();
    raise().click();
    advance(50);

    // A key press comes from wherever focus is, so focus goes in first — a
    // separate task from the press, as it always is in a browser.
    dismiss().focus();
    flushSync();
    key(dismiss(), 'Escape');
    expect(region()).toBeNull();
  });

  it('closes only itself on Escape when it sits inside an open dialog', () => {
    @Component({
      selector: 'v-dialog-alert',
      render: compileTemplate(`
        <div class="dialog" :ref="dialog">
          <input class="field">
          <div class="region" :ref="region" :spread="alert.rootProps()">
            <p :if="alert.isMessageVisible()" :spread="alert.messageProps()">
              Could not save
              <button class="dismiss" :spread="alert.dismissProps()">x</button>
            </p>
          </div>
        </div>
      `),
    })
    class DialogWithAlert {
      dialog = new Signal.State<Element | null>(null);
      region = new Signal.State<Element | null>(null);
      dialogOpen = new Signal.State(true);
      // The layer a dialog registers, from the stack every overlay shares.
      layer = createDismiss(
        () => this.dialog.get(),
        () => this.dialogOpen.set(false),
        { outsidePointer: false },
      );
      alert = createAlert({ region: () => this.region.get(), defaultOpen: true });
    }

    const handle = track(mount(DialogWithAlert, host));
    const instance = handle.instance as DialogWithAlert;
    advance(50);

    const field = host.querySelector('.field') as HTMLInputElement;
    field.focus();
    const dismiss = host.querySelector('.dismiss') as HTMLElement;
    dismiss.focus();
    flushSync();

    // One press, one layer: the alert the reader is standing in goes, and the
    // dialog around it stays.
    key(dismiss, 'Escape');
    expect(instance.alert.isOpen()).toBe(false);
    expect(instance.dialogOpen.get()).toBe(true);
    expect(document.activeElement).toBe(field);

    // With focus back in the dialog, the next press is the dialog's.
    key(field, 'Escape');
    expect(instance.dialogOpen.get()).toBe(false);
  });

  it('leaves a press outside to the dialog it sits in, while focus is in the alert', () => {
    @Component({
      selector: 'v-dialog-alert-press',
      render: compileTemplate(`
        <div>
          <div class="dialog" :ref="dialog">
            <div class="region" :ref="region" :spread="alert.rootProps()">
              <p :if="alert.isMessageVisible()" :spread="alert.messageProps()">
                Could not save
                <button class="dismiss" :spread="alert.dismissProps()">x</button>
              </p>
            </div>
          </div>
          <div class="page">the page behind the dialog</div>
        </div>
      `),
    })
    class LightDialogWithAlert {
      dialog = new Signal.State<Element | null>(null);
      region = new Signal.State<Element | null>(null);
      dialogOpen = new Signal.State(true);
      // A dialog that closes when the page behind it is pressed.
      layer = createDismiss(
        () => this.dialog.get(),
        () => this.dialogOpen.set(false),
      );
      alert = createAlert({ region: () => this.region.get(), defaultOpen: true });
    }

    const handle = track(mount(LightDialogWithAlert, host));
    const instance = handle.instance as LightDialogWithAlert;
    advance(50);
    (host.querySelector('.dismiss') as HTMLElement).focus();
    flushSync();

    // The alert is on the stack while focus is in it, for Escape alone. A
    // press is not its to take, so the one beneath still hears it.
    const page = host.querySelector('.page') as HTMLElement;
    page.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    page.dispatchEvent(new Event('pointerup', { bubbles: true }));
    flushSync();
    expect(instance.dialogOpen.get()).toBe(false);
    expect(instance.alert.isOpen()).toBe(true);
  });

  it('does not take Escape from the rest of the page', () => {
    const { raise, region } = setupAlert();
    raise().click();
    advance(50);

    // An alert is not a layer. Listening on the document would take Escape
    // from the dialog or the menu the alert happens to be sitting in.
    key(document.body, 'Escape');
    expect(region()).not.toBeNull();
  });

  it('honours closeOnEscape: false', () => {
    const { raise, dismiss, region } = setupAlert({ closeOnEscape: false });
    raise().click();
    advance(50);

    dismiss().focus();
    flushSync();
    key(dismiss(), 'Escape');
    expect(region()).not.toBeNull();
  });

  it('gives focus back when the control it was on is taken away', () => {
    const { raise, dismiss } = setupAlert();
    raise().focus();
    raise().click();
    advance(50);

    dismiss().focus();
    expect(document.activeElement).toBe(dismiss());

    dismiss().click();
    flushSync();
    // Otherwise focus falls to <body> and a keyboard user is dropped at the
    // top of the document with no way back to what they were doing.
    expect(document.activeElement).toBe(raise());
  });

  it('leaves focus alone when the alert never held it', () => {
    const { alert, raise } = setupAlert();
    raise().focus();
    raise().click();
    advance(50);

    alert.close();
    flushSync();
    expect(document.activeElement).toBe(raise());
  });
});

describe('alert: control from outside', () => {
  it('follows a signal the consumer owns', () => {
    const open = new Signal.State(false);
    const { message } = setupAlert({ open }, StaticRegion);
    advance(50);

    open.set(true);
    flushSync();
    expect(message()).not.toBeNull();

    open.set(false);
    flushSync();
    expect(message()).toBeNull();
  });

  it('reports its own changes without reporting a no-op', () => {
    const onOpenChange = vi.fn();
    const { alert } = setupAlert({ onOpenChange });

    alert.close();
    expect(onOpenChange).not.toHaveBeenCalled();

    alert.toggle();
    flushSync();
    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(true);
  });
});

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

let skeletonOptions: Omit<SkeletonOptions, 'region'> = {};

@Component({
  selector: 'v-skeleton',
  render: compileTemplate(`
    <div>
      <div class="content" :spread="skeleton.contentProps()">
        <div class="placeholder" :if="skeleton.isVisible()" :spread="skeleton.placeholderProps()">
          <span class="line"></span>
          <a class="deep" href="#x">focusable</a>
        </div>
        <p class="real" :if="isLoaded()">the article</p>
      </div>
      <div class="status" :ref="region" :spread="skeleton.statusProps()">
        <span class="message" :if="skeleton.isMessageVisible()"
              :spread="skeleton.messageProps()">{ skeleton.message() }</span>
      </div>
    </div>
  `),
})
class Article {
  region = new Signal.State<Element | null>(null);
  skeleton = createSkeleton({ region: () => this.region.get(), ...skeletonOptions });

  isLoaded() {
    return !this.skeleton.isLoading();
  }
}

function setupSkeleton(options: Omit<SkeletonOptions, 'region'> = {}) {
  skeletonOptions = options;
  const handle = track(mount(Article, host));
  const instance = handle.instance as Article;
  return {
    skeleton: instance.skeleton,
    content: () => host.querySelector('.content') as HTMLElement,
    placeholder: () => host.querySelector('.placeholder'),
    real: () => host.querySelector('.real'),
    status: () => host.querySelector('.status') as HTMLElement,
    message: () => host.querySelector('.message'),
  };
}

afterEach(() => {
  skeletonOptions = {};
});

describe('skeleton: what is read and what is not', () => {
  it('keeps the placeholder out of the accessibility tree and out of the tab order', () => {
    const { placeholder } = setupSkeleton({ defaultLoading: true });
    flushSync();

    const el = placeholder() as HTMLElement;
    // A dozen empty boxes read as a dozen empty boxes.
    expect(el.getAttribute('aria-hidden')).toBe('true');
    // And `aria-hidden` alone would leave the link inside reachable by Tab and
    // nameless when it got there, which is worse than either problem alone.
    expect(el.hasAttribute('inert')).toBe(true);
  });

  it('marks the content busy while it is being replaced, and only then', () => {
    const { skeleton, content } = setupSkeleton({ defaultLoading: true });
    flushSync();
    expect(content().getAttribute('aria-busy')).toBe('true');

    skeleton.setLoading(false);
    flushSync();
    // Not `aria-busy="false"`: absent is the same thing and one fewer lie to
    // keep in step.
    expect(content().hasAttribute('aria-busy')).toBe(false);
  });

  it('never puts aria-busy on the live region itself', () => {
    const { status } = setupSkeleton({ defaultLoading: true });
    flushSync();

    // On a live region `aria-busy` means "do not announce me yet", which would
    // silence the one sentence the placeholder has to offer.
    expect(status().hasAttribute('aria-busy')).toBe(false);
    expect(status().getAttribute('role')).toBe('status');
    expect(status().getAttribute('aria-live')).toBe('polite');
    expect(status().getAttribute('aria-atomic')).toBe('true');
  });

  it('announces one sentence instead of the wall, once the region has settled', () => {
    const { message } = setupSkeleton({ defaultLoading: true });
    flushSync();
    expect(message()).toBeNull();

    advance(50);
    expect(message()!.textContent).toBe('Loading…');
  });

  it('does not gate a message when it was given no region to time', () => {
    @Component({
      selector: 'v-skeleton-bare',
      render: compileTemplate(`
        <span class="message" :if="skeleton.isMessageVisible()">{ skeleton.message() }</span>
      `),
    })
    class Bare {
      skeleton = createSkeleton({ defaultLoading: true });
    }

    track(mount(Bare, host));
    flushSync();
    // Nothing to observe, so the gate opens: hiding a message the consumer
    // did render would be the worse failure of the two, and the only one
    // nobody sighted would ever notice.
    expect(host.querySelector('.message')!.textContent).toBe('Loading…');
  });

  it('says nothing at all when nothing was ever loading', () => {
    const { skeleton, message } = setupSkeleton();
    advance(50);

    // "Loaded" about a page that never loaded is a lie a screen reader repeats
    // as fact.
    expect(skeleton.message()).toBe('');
    expect(message()).toBeNull();
  });

  it('announces the finish, and takes overridden words for both', () => {
    const { skeleton, message } = setupSkeleton({
      defaultLoading: true,
      labels: { loading: 'Chargement…', loaded: 'Chargé' },
    });
    advance(50);
    expect(message()!.textContent).toBe('Chargement…');

    skeleton.setLoading(false);
    flushSync();
    expect(message()!.textContent).toBe('Chargé');
  });

  it('can be told to keep quiet about the finish', () => {
    const { skeleton, message } = setupSkeleton({
      defaultLoading: true,
      labels: { loaded: '' },
    });
    advance(50);

    skeleton.setLoading(false);
    flushSync();
    expect(message()).toBeNull();
  });
});

describe('skeleton: when the placeholder is worth showing', () => {
  it('is up immediately by default, because it is the layout', () => {
    const { placeholder, real } = setupSkeleton({ defaultLoading: true });
    flushSync();
    // Delaying a skeleton shows a blank hole and then a jump, which is worse
    // than the flash it would have avoided.
    expect(placeholder()).not.toBeNull();
    expect(real()).toBeNull();
  });

  it('never appears at all when the wait is shorter than its delay', () => {
    const { skeleton, placeholder } = setupSkeleton({ defaultLoading: true, delay: 200 });
    advance(150);
    expect(placeholder()).toBeNull();

    skeleton.setLoading(false);
    advance(1000);
    expect(placeholder()).toBeNull();
    expect(skeleton.state()).toBe('idle');
  });

  it('says nothing about a wait too short to have shown', () => {
    const { skeleton, message } = setupSkeleton({ defaultLoading: true, delay: 300 });
    advance(100);
    // The placeholder is being held back, so the words are too: a wait too
    // short to show is a wait too short to mention.
    expect(skeleton.message()).toBe('');
    expect(message()).toBeNull();

    skeleton.setLoading(false);
    advance(1000);
    // And no "Loaded" about a load nobody was shown.
    expect(skeleton.message()).toBe('');
    expect(message()).toBeNull();
  });

  it('speaks once the placeholder is up, and again when it is done', () => {
    const { skeleton, message } = setupSkeleton({ defaultLoading: true, delay: 300 });
    advance(300);
    expect(skeleton.isVisible()).toBe(true);
    advance(50);
    expect(message()!.textContent).toBe('Loading…');

    skeleton.setLoading(false);
    flushSync();
    expect(message()!.textContent).toBe('Loaded');

    // A second wait, too short to show, says nothing — not even a repeat of
    // the "Loaded" the first one earned.
    skeleton.setLoading(true);
    advance(100);
    expect(message()).toBeNull();
    skeleton.setLoading(false);
    advance(1000);
    expect(message()).toBeNull();
  });

  it('reports the wait it is sitting out, on the elements as well', () => {
    const { skeleton, content, placeholder } = setupSkeleton({
      defaultLoading: true,
      delay: 200,
    });
    flushSync();
    expect(skeleton.state()).toBe('delayed');
    // CSS gets the same three states the component reasons in.
    expect(content().getAttribute('data-state')).toBe('delayed');

    advance(200);
    expect(skeleton.state()).toBe('visible');
    expect(placeholder()!.getAttribute('data-state')).toBe('visible');
  });

  it('stays up for its minimum once it is up', () => {
    const { skeleton, placeholder } = setupSkeleton({ defaultLoading: true, minDuration: 300 });
    advance(100);
    expect(placeholder()).not.toBeNull();

    // The response landed after 100ms. Pulling the placeholder now is the
    // flash the minimum exists to prevent.
    skeleton.setLoading(false);
    advance(150);
    expect(placeholder()).not.toBeNull();

    advance(60);
    expect(placeholder()).toBeNull();
  });

  it('does not restart the minimum when loading resumes underneath it', () => {
    const { skeleton, placeholder } = setupSkeleton({ defaultLoading: true, minDuration: 300 });
    advance(100);

    skeleton.setLoading(false);
    advance(50);
    skeleton.setLoading(true);
    advance(50);
    expect(placeholder()).not.toBeNull();

    skeleton.setLoading(false);
    // 200ms in, and the placeholder went up at 0: 100ms of the minimum left.
    advance(120);
    expect(placeholder()).toBeNull();
  });
});

describe('skeleton: state ownership', () => {
  it('follows a signal the consumer owns', () => {
    const loading = new Signal.State(true);
    const { placeholder } = setupSkeleton({ loading });
    flushSync();
    expect(placeholder()).not.toBeNull();

    loading.set(false);
    flushSync();
    expect(placeholder()).toBeNull();
  });

  it('reports changes it makes itself, and not the ones that change nothing', () => {
    const onLoadingChange = vi.fn();
    const { skeleton } = setupSkeleton({ defaultLoading: true, onLoadingChange });

    skeleton.setLoading(true);
    expect(onLoadingChange).not.toHaveBeenCalled();

    skeleton.setLoading(false);
    expect(onLoadingChange).toHaveBeenCalledExactlyOnceWith(false);
  });
});

// ---------------------------------------------------------------------------
// Spinner
// ---------------------------------------------------------------------------

let spinnerOptions: Omit<SpinnerOptions, 'region'> = {};

@Component({
  selector: 'v-spinner',
  render: compileTemplate(`
    <div class="content" :spread="spinner.contentProps()">
      <div class="region" :ref="region" :spread="spinner.rootProps()">
        <span class="indicator" :if="spinner.isVisible()" :spread="spinner.indicatorProps()"></span>
        <span class="label" :if="spinner.isMessageVisible()"
              :spread="spinner.labelProps()">{ spinner.label() }</span>
      </div>
    </div>
  `),
})
class Busy {
  region = new Signal.State<Element | null>(null);
  spinner = createSpinner({ region: () => this.region.get(), ...spinnerOptions });
}

function setupSpinner(options: Omit<SpinnerOptions, 'region'> = {}) {
  spinnerOptions = options;
  const handle = track(mount(Busy, host));
  const instance = handle.instance as Busy;
  return {
    spinner: instance.spinner,
    content: () => host.querySelector('.content') as HTMLElement,
    region: () => host.querySelector('.region') as HTMLElement,
    indicator: () => host.querySelector('.indicator'),
    label: () => host.querySelector('.label'),
  };
}

afterEach(() => {
  spinnerOptions = {};
});

describe('spinner: not flashing', () => {
  it('shows nothing for the first half second', () => {
    const { indicator } = setupSpinner({ defaultLoading: true });
    advance(499);
    expect(indicator()).toBeNull();

    advance(1);
    expect(indicator()).not.toBeNull();
  });

  it('never appears for a response that beats the delay', () => {
    const { spinner, indicator, label } = setupSpinner({ defaultLoading: true });
    advance(200);

    spinner.setLoading(false);
    advance(2000);
    // The flicker of a spinner that comes and goes reads as a fault, and a
    // wait too short to show is a wait too short to mention.
    expect(indicator()).toBeNull();
    expect(label()).toBeNull();
  });

  it('stays up for its minimum once it is up', () => {
    const { spinner, indicator } = setupSpinner({
      defaultLoading: true,
      delay: 100,
      minDuration: 400,
    });
    advance(100);
    expect(indicator()).not.toBeNull();

    spinner.setLoading(false);
    advance(200);
    expect(indicator()).not.toBeNull();

    advance(250);
    expect(indicator()).toBeNull();
  });

  it('can be asked for no delay at all', () => {
    const { indicator } = setupSpinner({ defaultLoading: true, delay: 0 });
    flushSync();
    expect(indicator()).not.toBeNull();
  });
});

describe('spinner: what assistive technology is told', () => {
  it('is a polite status region that is never named', () => {
    const { region } = setupSpinner({ defaultLoading: true });
    advance(500);

    expect(region().getAttribute('role')).toBe('status');
    expect(region().getAttribute('aria-live')).toBe('polite');
    expect(region().getAttribute('aria-atomic')).toBe('true');
    // A name would be announced instead of the label inside it.
    expect(region().hasAttribute('aria-label')).toBe(false);
    // And `aria-busy` here would silence the region entirely.
    expect(region().hasAttribute('aria-busy')).toBe(false);
  });

  it('hides the graphic and lets the words carry the meaning', () => {
    const { indicator, label } = setupSpinner({ defaultLoading: true });
    advance(500);

    // A spinning ring has no accessible name, and an SVG announced by its
    // markup is noise.
    expect(indicator()!.getAttribute('aria-hidden')).toBe('true');
    expect(label()!.textContent).toBe('Loading…');
  });

  it('takes an overridden label', () => {
    const { spinner, label } = setupSpinner({
      defaultLoading: true,
      labels: { loading: 'Enregistrement…' },
    });
    advance(500);
    expect(spinner.label()).toBe('Enregistrement…');
    expect(label()!.textContent).toBe('Enregistrement…');
  });

  it('marks what is being waited for busy, not the region', () => {
    const { spinner, content } = setupSpinner({ defaultLoading: true });
    flushSync();
    // Busy from the start, even while the spinner is still sitting out its
    // delay: the wait is real whether or not it is drawn yet.
    expect(content().getAttribute('aria-busy')).toBe('true');

    spinner.setLoading(false);
    advance(1000);
    expect(content().hasAttribute('aria-busy')).toBe(false);
  });

  it('waits for the region before writing the label into it', () => {
    // A region mounted with the page settles long before anything loads, so
    // the label is held only by the spinner's own delay — this asserts the two
    // gates are both there by making the announce delay the longer of them.
    const { label } = setupSpinner({ defaultLoading: true, delay: 0, announceDelay: 200 });
    advance(50);
    expect(label()).toBeNull();

    advance(200);
    expect(label()).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

let emptyOptions: Partial<EmptyStateOptions> = {};

@Component({
  selector: 'v-results',
  render: compileTemplate(`
    <div>
      <ul class="list" :ref="list" :spread="empty.collectionProps()">
        <li :for="row in rows.get()" :key="row" data-volt-item class="row">{ row }</li>
      </ul>
      <div class="region" :ref="region" :spread="empty.rootProps()">
        <p class="message" :if="empty.isMessageVisible()"
           :spread="empty.messageProps()">{ empty.message() }</p>
      </div>
    </div>
  `),
})
class Results {
  rows = new Signal.State<string[]>([]);
  query = new Signal.State('');
  list = new Signal.State<Element | null>(null);
  region = new Signal.State<Element | null>(null);

  empty = createEmptyState({
    collection: () => this.list.get(),
    region: () => this.region.get(),
    count: () => this.rows.get().length,
    query: () => this.query.get(),
    ...emptyOptions,
  });
}

function setupEmpty(options: Partial<EmptyStateOptions> = {}) {
  emptyOptions = options;
  const handle = track(mount(Results, host));
  const instance = handle.instance as Results;
  return {
    instance,
    empty: instance.empty,
    list: () => host.querySelector('.list') as HTMLElement,
    region: () => host.querySelector('.region') as HTMLElement,
    message: () => host.querySelector('.message'),
    rows: () => host.querySelectorAll('.row').length,
  };
}

afterEach(() => {
  emptyOptions = {};
});

describe('empty state: linked to the collection it describes', () => {
  it('points the collection at the message, and only while there is one', () => {
    const { instance, list, region, empty } = setupEmpty();
    advance(50);

    expect(empty.isEmpty()).toBe(true);
    expect(list().getAttribute('aria-describedby')).toBe(region().id);

    instance.rows.set(['Ada']);
    flushSync();
    // A description pointing at an element that now says nothing describes
    // nothing; one pointing at an id that has left the page is worse, because
    // it hides the fact that the description has gone.
    expect(list().hasAttribute('aria-describedby')).toBe(false);
    expect(empty.status()).toBe('filled');
  });

  it('leaves the collection on the page when it empties', () => {
    const { instance, list } = setupEmpty();
    instance.rows.set(['Ada', 'Grace']);
    flushSync();
    expect(list()).not.toBeNull();

    instance.rows.set([]);
    flushSync();
    // An empty list is still a list, and "list, 0 items" is information. A
    // template that swaps the list out for the message takes that away.
    expect(list()).not.toBeNull();
    expect(list().getAttribute('data-empty')).toBe('');
  });

  it('announces the emptiness through a region that was already there', () => {
    const { instance, message } = setupEmpty();
    instance.rows.set(['Ada']);
    advance(50);
    expect(message()).toBeNull();

    // Filtering a list to nothing is a change a sighted user sees and a screen
    // reader user is told about only if something announces it.
    instance.rows.set([]);
    flushSync();
    expect(message()).not.toBeNull();
    expect(message()!.textContent).toBe('Nothing here yet.');
  });

  it('holds the first message back until the region has settled', () => {
    const { message } = setupEmpty();
    flushSync();
    // Empty from the very first paint: region and sentence would otherwise
    // arrive in the same mutation and announce nothing.
    expect(message()).toBeNull();

    advance(50);
    expect(message()).not.toBeNull();
  });

  it('hides a message the consumer rendered unconditionally', () => {
    @Component({
      selector: 'v-results-eager',
      render: compileTemplate(`
        <div>
          <ul class="list" :ref="list" :spread="empty.collectionProps()"></ul>
          <div class="region" :ref="region" :spread="empty.rootProps()">
            <p class="message" :spread="empty.messageProps()">{ empty.message() }</p>
          </div>
        </div>
      `),
    })
    class Eager {
      list = new Signal.State<Element | null>(null);
      region = new Signal.State<Element | null>(null);
      empty = createEmptyState({
        collection: () => this.list.get(),
        region: () => this.region.get(),
        count: () => 0,
      });
    }

    track(mount(Eager, host));
    flushSync();
    const message = () => host.querySelector('.message') as HTMLElement;
    expect(message().hasAttribute('hidden')).toBe(true);

    advance(50);
    expect(message().hasAttribute('hidden')).toBe(false);
  });

  it('is a polite status region, unnamed', () => {
    const { region } = setupEmpty();
    advance(50);
    expect(region().getAttribute('role')).toBe('status');
    expect(region().getAttribute('aria-live')).toBe('polite');
    expect(region().getAttribute('aria-atomic')).toBe('true');
    expect(region().hasAttribute('aria-label')).toBe(false);
  });
});

describe('empty state: what it says', () => {
  it('distinguishes nothing yet from nothing matching', () => {
    const { instance, empty, message } = setupEmpty();
    advance(50);
    expect(message()!.textContent).toBe('Nothing here yet.');

    instance.query.set('ada');
    flushSync();
    // Two different sentences because they call for two different actions:
    // create something, or search for something else.
    expect(empty.message()).toBe('No results for “ada”.');
  });

  it('ignores a query that is only whitespace', () => {
    const { instance, empty } = setupEmpty();
    instance.query.set('   ');
    flushSync();
    expect(empty.message()).toBe('Nothing here yet.');
  });

  it('takes overridden words for both', () => {
    const { instance, empty } = setupEmpty({
      labels: {
        empty: 'Noch nichts hier.',
        noResults: (query) => `Keine Treffer für ${query}.`,
      },
    });
    flushSync();
    expect(empty.message()).toBe('Noch nichts hier.');

    instance.query.set('ada');
    flushSync();
    expect(empty.message()).toBe('Keine Treffer für ada.');
  });

  it('says nothing when the collection is not empty', () => {
    const { instance, empty } = setupEmpty();
    instance.rows.set(['Ada']);
    flushSync();
    expect(empty.message()).toBe('');
  });
});

describe('empty state: still loading is not empty', () => {
  it('holds the message and marks the collection busy', () => {
    const loading = new Signal.State(true);
    const { empty, list, message } = setupEmpty({ loading: () => loading.get() });
    advance(50);

    // "No results" before the results arrive is the bug this exists to stop.
    expect(empty.status()).toBe('loading');
    expect(empty.isEmpty()).toBe(false);
    expect(message()).toBeNull();
    expect(list().getAttribute('aria-busy')).toBe('true');
    expect(list().hasAttribute('aria-describedby')).toBe(false);

    loading.set(false);
    flushSync();
    expect(list().hasAttribute('aria-busy')).toBe(false);
    expect(message()).not.toBeNull();
  });
});

describe('empty state: counting from the DOM', () => {
  it('watches the collection when it is not told the count', async () => {
    @Component({
      selector: 'v-dom-count',
      render: compileTemplate(`
        <ul class="list" :ref="list" :spread="empty.collectionProps()">
          <li :for="row in rows.get()" :key="row" data-volt-item class="row">{ row }</li>
        </ul>
      `),
    })
    class Counted {
      rows = new Signal.State<string[]>(['Ada']);
      list = new Signal.State<Element | null>(null);
      empty = createEmptyState({ collection: () => this.list.get() });
    }

    const handle = track(mount(Counted, host));
    const instance = handle.instance as Counted;
    flushSync();
    expect(instance.empty.count()).toBe(1);

    instance.rows.set([]);
    flushSync();
    // The DOM is not reactive on its own, so the count is mirrored into a
    // signal by a MutationObserver, which delivers on a microtask.
    await Promise.resolve();
    flushSync();
    expect(instance.empty.count()).toBe(0);
    expect(instance.empty.isEmpty()).toBe(true);
  });

  it('counts disabled items too', async () => {
    @Component({
      selector: 'v-disabled-count',
      render: compileTemplate(`
        <ul class="list" :ref="list">
          <li data-volt-item data-disabled>Ada</li>
        </ul>
      `),
    })
    class WithDisabled {
      list = new Signal.State<Element | null>(null);
      empty = createEmptyState({ collection: () => this.list.get() });
    }

    const handle = track(mount(WithDisabled, host));
    flushSync();
    await Promise.resolve();
    // Emptiness is about what is there, not about what can be reached.
    expect((handle.instance as WithDisabled).empty.count()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// The two rules on their own
// ---------------------------------------------------------------------------

describe('createLiveRegionTiming', () => {
  it('opens only once its region has been in the document for a task', () => {
    @Component({
      selector: 'v-timing',
      render: compileTemplate(`
        <div><div :if="show.get()" class="region" :ref="region"></div></div>
      `),
    })
    class Timed {
      show = new Signal.State(false);
      region = new Signal.State<Element | null>(null);
      timing = createLiveRegionTiming(() => this.region.get());
    }

    const handle = track(mount(Timed, host));
    const instance = handle.instance as Timed;
    flushSync();
    expect(instance.timing.isReady()).toBe(false);

    instance.show.set(true);
    flushSync();
    expect(instance.timing.isReady()).toBe(false);

    advance(50);
    expect(instance.timing.isReady()).toBe(true);

    // Gone again, so the next region is new to the accessibility tree too.
    instance.show.set(false);
    flushSync();
    expect(instance.timing.isReady()).toBe(false);
  });

  it('stays shut for a region that was never put in the document', () => {
    @Component({
      selector: 'v-detached',
      render: compileTemplate(`<div></div>`),
    })
    class Detached {
      region = new Signal.State<Element | null>(document.createElement('div'));
      timing = createLiveRegionTiming(() => this.region.get());
    }

    const handle = track(mount(Detached, host));
    advance(50);
    expect((handle.instance as Detached).timing.isReady()).toBe(false);
  });
});

describe('createDeferredVisibility', () => {
  it('is a straight pass-through with no delay and no minimum', () => {
    @Component({ selector: 'v-plain', render: compileTemplate(`<div></div>`) })
    class Plain {
      active = new Signal.State(false);
      visibility = createDeferredVisibility(() => this.active.get());
    }

    const handle = track(mount(Plain, host));
    const instance = handle.instance as Plain;
    flushSync();
    expect(instance.visibility.isVisible()).toBe(false);

    instance.active.set(true);
    flushSync();
    expect(instance.visibility.isVisible()).toBe(true);
    expect(instance.visibility.state()).toBe('visible');

    instance.active.set(false);
    flushSync();
    expect(instance.visibility.state()).toBe('idle');
  });
});

// ---------------------------------------------------------------------------
// Words from the locale
// ---------------------------------------------------------------------------

describe('the words each component says by default', () => {
  @Component({
    selector: 'v-feedback-de',
    render: compileTemplate(`
      <div>
        <div class="alert" :ref="region" :spread="alert.rootProps()">
          <button class="dismiss" :spread="alert.dismissProps()">x</button>
        </div>
        <ul :ref="list"></ul>
      </div>
    `),
  })
  class German {
    locale = createLocaleProvider({
      defaultLocale: 'de-DE',
      messages: {
        dismiss: 'Schließen',
        loading: 'Wird geladen…',
        loaded: 'Geladen',
        emptyState: 'Noch nichts hier.',
        noResultsFor: 'Keine Treffer für „{query}“.',
      },
    });
    region = new Signal.State<Element | null>(null);
    list = new Signal.State<Element | null>(null);
    query = new Signal.State('');
    alert = createAlert({ region: () => this.region.get(), defaultOpen: true });
    skeleton = createSkeleton({ defaultLoading: true });
    spinner = createSpinner();
    empty = createEmptyState({
      collection: () => this.list.get(),
      count: () => 0,
      query: () => this.query.get(),
    });
  }

  it('comes from the locale provider when it has them', () => {
    const handle = track(mount(German, host));
    const instance = handle.instance as German;
    flushSync();

    // A provider that translates the page should not leave the alert's
    // dismiss control, the loading words and the empty state in English.
    expect(host.querySelector('.dismiss')!.getAttribute('aria-label')).toBe('Schließen');
    expect(instance.spinner.label()).toBe('Wird geladen…');
    expect(instance.skeleton.message()).toBe('Wird geladen…');
    expect(instance.empty.message()).toBe('Noch nichts hier.');

    instance.query.set('Ada');
    expect(instance.empty.message()).toBe('Keine Treffer für „Ada“.');

    instance.skeleton.setLoading(false);
    flushSync();
    expect(instance.skeleton.message()).toBe('Geladen');
  });

  it('keeps the English for anything the catalogue leaves out', () => {
    const { alert, dismiss, raise } = setupAlert();
    raise().click();
    advance(50);
    expect(dismiss().getAttribute('aria-label')).toBe('Dismiss');
    expect(alert.isOpen()).toBe(true);
  });
});

describe('what these cost an application that does not translate', () => {
  beforeEach(() => vi.useRealTimers());

  it('leaves the locale out of the bundle, with no provider for it to ask', async () => {
    // Without a provider the only catalogue there is holds the defaults, and
    // they say what the English here says. Building a locale for that put the
    // whole of it into every bundle with an alert, a skeleton, a spinner or an
    // empty state in it.
    const result = await viteBuild({
      configFile: false,
      logLevel: 'silent',
      build: {
        write: false,
        target: 'esnext',
        minify: false,
        rollupOptions: { external: [/^@voltdev\//] },
        lib: { entry: resolve(import.meta.dirname, '../src/feedback.ts'), formats: ['es'] },
      },
    });
    const [bundle] = Array.isArray(result) ? result : [result];
    const code = bundle && 'output' in bundle ? bundle.output[0].code : '';

    for (const name of ['createAlert', 'createSkeleton', 'createSpinner', 'createEmptyState']) {
      expect(code).toMatch(new RegExp(`function ${name}\\b`));
    }
    expect(code).not.toMatch(/function createLocale\b/);
  });
});
