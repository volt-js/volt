import { Component, Signal } from '@voltdev/core';
import type { UploadItem, UploadStatus, UploadTransport } from '@voltdev/primitives';
import { VButton, VFileUpload } from '@voltdev/ui/components';

/** How long the pretend server takes over each eighth of a file. */
const TICK = 150;

/** What the compact row says about a file that is not on its way. */
const WORDS: Readonly<Record<Exclude<UploadStatus, 'uploading'>, string>> = {
  pending: 'Waiting',
  success: 'Done',
  error: 'Failed',
  cancelled: 'Cancelled',
  rejected: 'Not a photo',
};

@Component({
  selector: 'v-expense-claim',
  templateUrl: './file-upload.html',
  styleUrl: './file-upload.scss',
  imports: [VButton, VFileUpload],
})
export class ExpenseClaim {
  /** Files the pretend connection has dropped once, so their retry goes through. */
  private dropped = new Set<string>();
  /** Every file sent, to drop every third one on its first try. */
  private sent = 0;

  /**
   * A server that is not there: the bytes go nowhere, at a believable pace.
   *
   * Every third file loses its connection halfway on its first try, so there
   * is a retry to press, and every file that arrives is answered with an id —
   * which is what the form posts under `name`, since the bytes have already
   * gone.
   */
  send: UploadTransport = (request) =>
    new Promise((resolve, reject) => {
      const total = request.body.size;
      const doomed = !this.dropped.has(request.item.id) && ++this.sent % 3 === 0;
      if (doomed) this.dropped.add(request.item.id);
      let loaded = 0;

      const tick = (): void => {
        loaded = Math.min(total, loaded + Math.max(total / 8, 1));
        request.progress(loaded);
        if (doomed && loaded >= total / 2) {
          reject(new Error('The connection dropped. Try again.'));
          return;
        }
        if (loaded >= total) {
          resolve(`receipt-${request.item.id.split('-').at(-1)}`);
          return;
        }
        timer = setTimeout(tick, TICK);
      };

      let timer = setTimeout(tick, TICK);
      request.signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          reject(new Error('Cancelled'));
        },
        { once: true },
      );
    });

  /** What the last submit carried, so the demo says whether it went. */
  result = new Signal.State('');
  /** How many receipts are up so far, from `onComplete`. */
  done = new Signal.State('Nothing uploaded yet.');

  finished = (items: readonly UploadItem[]): void => {
    const arrived = items.filter((item) => item.status === 'success').length;
    this.done.set(
      items.length === 0 ? 'Nothing uploaded yet.' : `${arrived} of ${items.length} uploaded.`,
    );
  };

  /**
   * The list changed shape: a receipt arrived, left, or moved on.
   *
   * A claim's note is about the receipts it was made with, so it goes the
   * moment they change. And a removal is not an upload finishing — nothing
   * calls `onComplete` for one — so with nothing left on its way the count is
   * taken again here, rather than standing at a number the list no longer has.
   */
  changed = (items: readonly UploadItem[]): void => {
    this.result.set('');
    if (!items.some((item) => item.status === 'uploading' || item.status === 'pending')) {
      this.finished(items);
    }
  };

  /** Where a file is, in the compact row's own words. */
  state(status: UploadStatus, progress: number): string {
    if (status === 'uploading') return `${Math.round(progress)}%`;
    return WORDS[status];
  }

  /**
   * Whether a retry has anything to send. The button stays on the row either
   * way, unavailable when not: one that went the moment it was pressed would
   * drop focus to the top of the page, which is why the default row keeps its
   * own the same way.
   */
  retryable(status: UploadStatus): boolean {
    return status === 'error' || status === 'cancelled';
  }

  /**
   * The upload refuses the submit while a file is still going up or has
   * failed, so this hears only a form that is ready — and reads what it posts,
   * which is the server's ids rather than the files.
   */
  claim = (event: SubmitEvent): void => {
    event.preventDefault();
    const ids = new FormData(event.target as HTMLFormElement).getAll('receipts');
    this.result.set(ids.length > 0 ? `Claimed with ${ids.join(', ')}.` : 'Claimed with no receipts.');
  };
}
