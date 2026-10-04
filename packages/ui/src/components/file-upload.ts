import { Component, Prop, Signal, effect } from '@voltdev/core';
import {
  VISUALLY_HIDDEN_INPUT_STYLE,
  createFileUpload,
  useLocale,
  type FileUpload,
  type FileUploadLabels,
  type FileUploadProps,
  type Locale,
  type UploadItem,
  type UploadStatus,
  type UploadTransport,
} from '@voltdev/primitives';

const { untrack } = Signal.subtle;

/**
 * The primitive's wording, and the one thing a row says that the primitive
 * does not: where its file is.
 */
export interface UploadLabels extends FileUploadLabels {
  /**
   * The words after a file's size. Default `Waiting`, the percentage while it
   * goes up, `Uploaded`, `Failed`, `Cancelled`, and `Not accepted` for a file
   * refused before it was sent. An empty string leaves the size on its own.
   */
  status?: (item: UploadItem) => string;
}

/** One file the transport has finished with, and what a form posts for it. */
export interface PostedFile {
  readonly id: string;
  readonly value: string;
}

/** Where a file is, in English, for the states a word is enough for. */
const STATUS: Readonly<Record<Exclude<UploadStatus, 'uploading'>, string>> = {
  pending: 'Waiting',
  success: 'Uploaded',
  error: 'Failed',
  cancelled: 'Cancelled',
  rejected: 'Not accepted',
};

/**
 * A file upload: the whole lifecycle, not a picker.
 *
 * ```html
 * <v-file-upload
 *   :transport="send"
 *   accept="image/*"
 *   :maxSize="5_000_000"
 *   label="Drop photos here, or press to choose"
 *   description="PNG or JPEG, up to 5 MB each."
 *   :onComplete="done"
 * ></v-file-upload>
 * ```
 *
 * `createFileUpload` owns the behaviour — the queue, the refusals, the
 * requests, the retries, the ARIA — and this owns the markup: a drop zone with
 * the words inside it, a native `<input type="file">` beside it, a line of
 * help and the field's message under it, and a row per file with its size,
 * where it is, its own progress bar, its reason for failing, and a button to
 * retry it and one to remove it.
 *
 * The native input is not decoration. It is what carries the field's
 * validity, so a form around this refuses a submit while a file is still
 * going up or has failed, and it is the only thing on any platform that opens
 * the file picker — the zone opens it by clicking the input. It is hidden
 * inline, the way every primitive that keeps a native control hides one,
 * rather than with `display: none`: a control that refuses a submit has to
 * have somewhere to show why. It is out of the tab order because the zone is
 * a tab stop already, and a second stop on a control nobody can see is one a
 * keyboard user lands on and cannot account for; it stays in the
 * accessibility tree, which is where its invalid state is said.
 *
 * What a caller writes on the tag lands on the zone. It is the element
 * carrying `role="button"`, the one a keyboard reaches and the one a reader
 * sees, so it is the one a class, an id or a `data-*` means. The three ARIA
 * attributes the component has an opinion about are props below rather than
 * left to fall through, because the primitive writes a name and a description
 * on the same element, and two bags writing one attribute is the caller's
 * losing whichever order they land in.
 *
 * The rows are drawn from the primitive's queue, refusals included. A file
 * that silently fails to appear is the worst answer to "why isn't my photo
 * uploading", so a refused file is a row with a reason under it, listed beside
 * the files that were taken.
 */
@Component({ selector: 'v-file-upload', templateUrl: './file-upload.html' })
export class VFileUpload {
  /**
   * Everything from here to `onError` is what the primitive is built with,
   * read once while this field list initializes — plain, because a signal
   * would promise a caller they can change it later and the primitive would
   * never hear it. The callbacks are the exception: each is read when it is
   * called, so a page that rebinds one is the page that hears.
   */
  /**
   * How the bytes leave the page: `xhrTransport`, `fetchTransport`, or a
   * function of your own that takes a request and returns a promise.
   * Required, and refused at once when it is not a function: an upload with
   * nowhere to send its files is a list that never moves.
   */
  @Prop({ required: true }) transport!: UploadTransport;
  /** The `accept` syntax — `.png,image/*`. Checked again on every file that comes back. */
  @Prop() accept?: string;
  /** More than one file at a time. Default true. `:multiple="false"` replaces rather than appends. */
  @Prop() multiple = true;
  /** In bytes. A bigger file is listed as refused, and never sent. */
  @Prop() maxSize?: number;
  /** Across the whole list, not per drop. A file past it is listed as refused. */
  @Prop() maxFiles?: number;
  /**
   * Called with the whole list when it changes: a file added, removed, or
   * moved from one state to another. Not on every byte — read
   * `upload.items()` through `:ref` for that.
   */
  @Prop() onChange?: (items: readonly UploadItem[]) => void;
  /** Every upload has finished, one way or another. */
  @Prop() onComplete?: (items: readonly UploadItem[]) => void;
  /**
   * Something went wrong with one file: the upload failed, or the file was
   * refused before it was sent. `item.error.code` says which.
   */
  @Prop() onError?: (item: UploadItem) => void;

  /**
   * The words in the zone.
   *
   * Left out, the zone says what the primitive would have named it —
   * `labels.dropZone`, or its own English. Whatever is here, or in the
   * default slot in its place, is the zone's name and the input's label as
   * well, so what a reader hears on the control is what they see in the box.
   */
  @Prop() label = new Signal.State<string | undefined>(undefined);
  /** The line under the zone, shown whether or not the field is valid. */
  @Prop() description = new Signal.State('');
  /**
   * Your own verdict on the files, when they are wrong for a reason the
   * upload cannot see — a server that refused the whole batch, say.
   *
   * Pushed into the input as its custom validity, so a form refuses the
   * submit for the reason under the zone, and shown ahead of any reason of
   * the upload's own. Empty takes it back. Adding or removing a file lets go
   * of it, as an edit lets go of any field's verdict — the files it was about
   * are not the files there now — and this prop is cleared with it, so what
   * you read back agrees. A file moving on, or a byte arriving, is not an
   * edit and keeps it. What is bound here is written in whenever it changes,
   * so the same words a second time are a change only if your own value was
   * cleared in between.
   *
   * Bound as `:prop-error`: `error` is a DOM event's name as well, and
   * `:error` on any tag is read as a listener for it. Written out —
   * `error="…"` — it is a prop like any other.
   */
  @Prop() error = new Signal.State('');
  /**
   * Refuse drops, the picker, the keys, and every row's buttons.
   *
   * `aria-disabled` on the zone rather than the attribute, so it keeps its
   * place in the tab order and answers "unavailable" to whoever reaches it.
   * The inputs take the platform's own `disabled`, so a form around this
   * posts nothing for it.
   */
  @Prop() disabled = new Signal.State(false);
  /**
   * What a form around this posts each finished file's reference as.
   *
   * The files themselves never go with the form: the transport has already
   * sent them, so the primitive leaves the file input unnamed, and naming it
   * would post every byte a second time. What goes instead is what the
   * transport resolved with, once per file that finished — a string as it
   * is, a number or a flag as its digits or word, anything else as JSON — so
   * the server that took the bytes hands back an id and the form submits the
   * ids. A transport that resolved with nothing, or with an empty string,
   * gives the form nothing to post for that file. Have the transport resolve
   * with exactly what the form should carry: `xhrTransport`'s `parse` is the
   * place to pick the id out of a response.
   */
  @Prop() name = new Signal.State<string | undefined>(undefined);
  /**
   * Your wording: what the buttons on a row are called, what a row says about
   * where its file is, why a file was refused, and what the live region says.
   *
   * A signal, and read through to the primitive rather than handed over: it
   * reads its wording on every use, so a page that changes language reaches
   * the rows already on screen. The exceptions are a bar's name, which the
   * primitive settles when the bar is made, and a reason a file was refused
   * or failed, which is written into the file the moment it happens.
   */
  @Prop() labels = new Signal.State<UploadLabels | undefined>(undefined);

  /**
   * Names the zone, in the platform's own spelling, instead of its words.
   *
   * Declared rather than left to `:host` because the primitive names the zone
   * itself, and a second bag writing the same attribute is one of the two
   * silently winning. It names the input as well, which the words would
   * otherwise have named.
   */
  @Prop({ alias: 'aria-label' }) ariaLabel = new Signal.State<string | undefined>(undefined);
  /** Names the zone and the input from elsewhere on the page. A reference outranks a name. */
  @Prop({ alias: 'aria-labelledby' }) labelledBy = new Signal.State<string | undefined>(undefined);
  /** Ids of anything else that describes it. Added to the field's own two, not instead of them. */
  @Prop({ alias: 'aria-describedby' }) describedBy = new Signal.State<string | undefined>(
    undefined,
  );

  /**
   * The parts the primitive watches, as elements.
   *
   * Signals rather than plain fields because none of them exists while this
   * class is being built, and the ids and the references between them are
   * written the moment each does.
   */
  input = new Signal.State<Element | null>(null);
  zone = new Signal.State<Element | null>(null);
  content = new Signal.State<Element | null>(null);
  descriptionEl = new Signal.State<Element | null>(null);
  errorEl = new Signal.State<Element | null>(null);
  live = new Signal.State<Element | null>(null);

  /**
   * The page's language, for a file's size and how far it has come.
   *
   * Resolved once, while this field list initializes, because that is where a
   * provider is in scope. The locale itself is live.
   */
  readonly locale: Locale = useLocale();

  /**
   * The primitive, built from the props above — which is why props have to be
   * there while a field initializes.
   */
  readonly upload: FileUpload = createFileUpload({
    input: () => this.input.get(),
    dropZone: () => this.zone.get(),
    liveRegion: () => this.live.get(),
    // The words in the zone are the field's label: the input is labelled by
    // them. A `<span>` rather than a `<label>`, because a label inside the
    // zone would open the picker on its own and the zone would open it again.
    label: () => this.content.get(),
    description: () => this.descriptionEl.get(),
    errorMessage: () => this.errorEl.get(),
    disabled: () => this.isDisabled(),
    labels: readThrough(this.labels),
    transport: ownTransport(this.transport),
    multiple: flag(this.multiple, true),
    ...(this.accept !== undefined ? { accept: this.accept } : {}),
    ...(numeric(this.maxSize) !== undefined ? { maxSize: numeric(this.maxSize) } : {}),
    ...(numeric(this.maxFiles) !== undefined ? { maxFiles: numeric(this.maxFiles) } : {}),
    onComplete: (items) => this.onComplete?.(items),
    onItemError: (item) => this.onError?.(item),
    // A refusal is an error about a file as much as a failed request is, and
    // a caller listening for one wants both. Reported from here rather than
    // `onReject`, which is told about the file before the row for it exists.
    onFilesAdded: (added) => {
      for (const item of added) if (item.status === 'rejected') this.onError?.(item);
    },
  });

  constructor() {
    // Created in this order on purpose: effects woken by the same change run
    // in the order they were made, and each of these has to see what the one
    // before it did.

    // A change in which files are there lets go of the caller's message, as
    // the field has already let go of it — before `onChange` runs, so a
    // message written into `error` in answer to the new list is the one that
    // stays. One bound to it arrives later, through the page's own render,
    // and stays whatever the order. The first run only notes where the list
    // starts.
    let present: string | undefined;
    effect(() => {
      const files = this.upload
        .items()
        .map((item) => item.id)
        .join(' ');
      const before = present;
      present = files;
      if (before === undefined || before === files) return;
      untrack(() => {
        if (this.error.get() !== '') this.error.set('');
      });
    });

    // The list, when a file arrives, leaves or moves on. A byte arriving
    // replaces the item too, and a caller mirroring the list into a store
    // would otherwise be told about every one of them.
    let shape = '';
    effect(() => {
      const items = this.upload.items();
      const now = items.map((item) => `${item.id}:${item.status}`).join(' ');
      if (now === shape) return;
      shape = now;
      untrack(() => this.onChange?.(items));
    });

    // The caller's verdict reaches the field the way a refusal does, through
    // custom validity, so it is on screen and refuses the submit at once. The
    // primitive writes the same validity whenever its list changes, a byte
    // arriving included, so this runs on every change of the list as well —
    // made after the primitive's own effect, it runs after it and has the
    // last word. It waits for the input, since a verdict measured against no
    // control comes back valid and would be lost. Untracked, because
    // settling the field reads its own signals.
    effect(() => {
      const message = said(this.error.get());
      const items = this.upload.items();
      if (!this.input.get()) return;
      const refused = items.find((item) => item.status === 'rejected' || item.status === 'error');
      untrack(() => this.upload.field.setCustomValidity(message ?? refused?.error?.message ?? ''));
    });
  }

  /**
   * What the zone carries: the primitive's bag, with the three names merged
   * into it rather than written beside it.
   *
   * `:spread` rewrites the element whenever what it reads changes, so an
   * attribute applied next to it — by a second spread, which is what `:host`
   * is — is an attribute one of the two silently wins. Merging here makes the
   * outcome the same whatever order they run in.
   *
   * The zone is named by its contents unless somebody names it outright. The
   * primitive writes a name of its own for a zone it assumes has no words;
   * this one has words, and a name written over them would be read out
   * instead — the words on screen and the words a reader hears would then
   * differ the moment either changed. A reference outranks a name, as it does
   * wherever one is computed, so the two are never written together.
   *
   * Entries that say nothing are left out rather than written as `undefined`,
   * which `:spread` reads as "take that attribute away" — and an attribute the
   * caller wrote on the tag is on this element too.
   */
  zoneProps(): FileUploadProps {
    const own: Record<string, string | boolean | undefined> = { ...this.upload.dropZoneProps() };
    delete own['aria-label'];
    return present({ ...own, ...this.naming(own['aria-describedby'], undefined) });
  }

  /**
   * What the input carries: the primitive's bag, hidden, out of the tab
   * order, and named the way the zone is.
   *
   * Entries that say nothing are left out here too, for a different reason:
   * `accept` is a property on an input, and the primitive's bag carries it
   * whether or not it was given one — so an upload with no `accept` would be
   * assigned `undefined`, which the property keeps as the word "undefined":
   * a filter nobody asked for, handed to a picker to make what it will of.
   */
  inputProps(): FileUploadProps {
    const own = this.upload.inputProps();
    return present({
      ...own,
      ...this.naming(own['aria-describedby'], own['aria-labelledby']),
      tabindex: '-1',
      style: VISUALLY_HIDDEN_INPUT_STYLE,
    });
  }

  /**
   * What the words in the zone carry: the field's id for its label, and not
   * the `for` that comes with it, which means nothing on a `<span>`.
   */
  labelProps(): FileUploadProps {
    const { for: _for, ...own } = this.upload.labelProps();
    return own;
  }

  /**
   * The name and description a caller's ARIA gives one of the two controls,
   * over what the field gave it.
   *
   * A description is added to the field's rather than replacing it: the help
   * and the message under the zone describe it whatever else on the page also
   * does, and they come first because a screen reader reads them in the order
   * they are named. An id nobody has chosen yet is an empty string, and is
   * read as unsaid rather than as a reference to nothing.
   */
  naming(
    described: string | boolean | undefined,
    labelled: string | boolean | undefined,
  ): FileUploadProps {
    const named = said(this.ariaLabel.get());
    const from = said(this.labelledBy.get());
    const descriptions = [described, this.describedBy.get()]
      .map(said)
      .filter((id): id is string => id !== undefined)
      .join(' ');
    return {
      'aria-label': from ? undefined : named,
      'aria-labelledby': from ?? (named ? undefined : said(labelled)),
      'aria-describedby': descriptions || undefined,
    };
  }

  /**
   * The words in the zone, when nothing was written in their place: the
   * caller's `labels.dropZone`, or the primitive's own wording, so a zone with
   * no words of its own still says something.
   */
  words(): string {
    return said(this.label.get()) ?? said(this.upload.dropZoneProps()['aria-label']) ?? '';
  }

  /**
   * The message under the zone: the first of them.
   *
   * One line rather than the list, because the platform takes one string too —
   * so the sentence a reader is given is the same sentence the browser refused
   * the submit over.
   */
  message(): string {
    return this.upload.field.messages()[0] ?? '';
  }

  /**
   * What a form around this posts: one entry per file the transport finished
   * with, and nothing at all without a `name`. See `name`.
   */
  posted(): readonly PostedFile[] {
    if (said(this.name.get()) === undefined) return [];
    return this.upload.items().flatMap((item) => {
      if (item.status !== 'success') return [];
      const value = reference(item.response);
      return value === undefined ? [] : [{ id: item.id, value }];
    });
  }

  /**
   * Whether the transport is carrying this file: it was taken. Such a row has
   * a bar and a retry button; a refused file never will.
   */
  carried(item: UploadItem): boolean {
    return item.status !== 'rejected';
  }

  /**
   * A row's bar, on the progress sheet's own indicator.
   *
   * The primitive hands over the bar's root — the role, the value, the state —
   * and nothing for the indicator inside it, whose children are presentational
   * anyway. The sheet draws the finished bar in a second colour by the state
   * on the indicator, so the root's state is written there as well, in the
   * shape `createProgress` writes it.
   *
   * With one exception. The bar measures bytes sent, and a request can send
   * every byte and still be refused: `xhrTransport` reports the whole body
   * before a server answers 413 or 500. That file's bar is full, rightly, but
   * the second colour says the file arrived, beside a row that says it failed.
   * So `complete` is kept for a file that did arrive, and a full bar for one
   * that did not is drawn in the ordinary fill.
   */
  indicatorProps(item: UploadItem): FileUploadProps {
    const root = this.upload.itemProgressProps(item);
    const sentNotArrived = root['data-state'] === 'complete' && item.status !== 'success';
    return {
      'data-state': sentNotArrived ? 'loading' : root['data-state'],
      'data-value': root['data-value'],
      'data-max': root['aria-valuemax'],
    };
  }

  /**
   * How far a row's bar has come, as a width.
   *
   * Written inline because it is a number, and the sheet holds no numbers a
   * value could be one of.
   */
  fill(item: UploadItem): Record<string, string> {
    return { 'inline-size': `${item.progress}%` };
  }

  /** The line under a file's name: its size, and where it is. */
  meta(item: UploadItem): string {
    const size = this.locale.format.bytes(item.total);
    const where = this.where(item);
    return where ? `${size} · ${where}` : size;
  }

  /** Where a file is, in the caller's words or the default ones. */
  where(item: UploadItem): string {
    const own = this.labels.get()?.status?.(item);
    if (own !== undefined) return own;
    if (item.status === 'uploading') return this.locale.format.percent(item.progress / 100);
    return STATUS[item.status];
  }

  /** Why a file failed, or nothing. */
  reason(item: UploadItem): string {
    return item.error?.message ?? '';
  }

  /**
   * A row's retry button: the primitive's bag, and unavailable while the
   * upload is.
   *
   * It stays on the row whatever the file's state, unavailable when there is
   * nothing to retry, because a button that went the moment it was pressed
   * would drop focus to the top of the page.
   */
  retryProps(item: UploadItem): FileUploadProps {
    return { ...this.upload.retryProps(item), ...this.off() };
  }

  /** A row's remove button, on the same terms. */
  removeProps(item: UploadItem): FileUploadProps {
    return { ...this.upload.removeProps(item), ...this.off() };
  }

  /**
   * What a disabled upload adds to a row's buttons.
   *
   * The primitive leaves them working, and a field that refuses new files but
   * lets its old ones be taken away or sent again has not been disabled. Only
   * added: nothing at all while the upload is live, so the primitive's own
   * `aria-disabled` on a retry with nothing to retry stands.
   */
  off(): FileUploadProps {
    return this.isDisabled() ? { 'aria-disabled': 'true' } : {};
  }

  /**
   * Whether the upload is switched off, however the tag said so.
   *
   * Bound, `disabled` is whatever it was bound to. Written, it is a string,
   * and `disabled="false"` — the one word that says it is not — would be
   * truthy, switching off the zone, the picker and every row. So it is read
   * the way `multiple` is: written bare or as any word but `"false"`, it is on.
   */
  isDisabled(): boolean {
    return flag(this.disabled.get(), false);
  }

  /** Send a failed or cancelled file again. The primitive refuses anything else. */
  retry(item: UploadItem): void {
    if (untrack(() => this.isDisabled())) return;
    this.upload.retry(item.id);
  }

  /**
   * Take a file out of the list, cancelling it if it is on its way.
   *
   * The row goes with it, and so would focus, to the top of the page, when it
   * was on one of the row's buttons. It is put on the zone instead, which is
   * where the next thing anyone does with this upload starts.
   */
  remove(item: UploadItem): void {
    if (untrack(() => this.isDisabled())) return;
    for (let node = document.activeElement; node; node = node.parentElement) {
      if (node.getAttribute('data-id') !== item.id) continue;
      const zone = this.zone.get();
      if (zone instanceof HTMLElement) zone.focus();
      break;
    }
    this.upload.remove(item.id);
  }
}

/**
 * The caller's transport, refused when it is not one.
 *
 * Markup has no way to write a function: `transport="/api/files"` hands over
 * a string, which the primitive would call for the first file and fail inside
 * a request — every file would then be listed as failed, for a reason about
 * a string not being a function, and nothing would name the tag that caused
 * it. Refused here instead, while the prop is still the thing that is wrong.
 *
 * A transport left out is refused here too. `required` says so as well, but
 * that is checked once the fields have initialized, and the primitive is one
 * of them.
 */
function ownTransport(value: unknown): UploadTransport {
  if (typeof value === 'function') return value as UploadTransport;
  // An options object handed over in place of what `xhrTransport` makes from
  // one is as likely as a URL, and `[object Object]` would name neither.
  const given = typeof value === 'string' ? `the string "${value}"` : `a value of type ${typeof value}`;
  const what =
    value === undefined
      ? '[volt] <v-file-upload> needs a `transport`: how the files leave the page.\n'
      : `[volt] \`transport\` on <v-file-upload> is how the files leave the page, and ${given} ` +
        'is not one.\n';
  throw new Error(
    what +
      "  Bind a function: `:transport=\"send\"`, with `send = xhrTransport({ url: '/api/files' })`, " +
      '`fetchTransport`, or one of your own that takes a request and returns a promise.',
  );
}

/**
 * The caller's wording, read through on every use.
 *
 * The primitive keeps the object it is handed and reads a key off it each
 * time it needs the words, so an object that answers from the signal is all
 * it takes for a change of wording to reach everything already on screen.
 */
function readThrough(labels: Signal.State<UploadLabels | undefined>): FileUploadLabels {
  return new Proxy({} as FileUploadLabels, {
    get: (_, key) => (labels.get() as Record<PropertyKey, unknown> | undefined)?.[key],
  });
}

/**
 * What a form posts for one finished file, from what its transport resolved
 * with: a string as it is, a number or a flag spelled out, and anything else
 * as JSON. Nothing, an empty string, or a value JSON cannot spell is nothing
 * to post.
 */
function reference(response: unknown): string | undefined {
  if (response === undefined || response === null || response === '') return undefined;
  if (typeof response === 'string') return response;
  if (typeof response === 'number' || typeof response === 'boolean' || typeof response === 'bigint') {
    return String(response);
  }
  try {
    return JSON.stringify(response) ?? undefined;
  } catch {
    return undefined;
  }
}

/** What a caller actually wrote, or nothing at all if it came to nothing. */
function said(value: string | boolean | undefined): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

/** A bag with the entries that say nothing taken out. */
function present(props: FileUploadProps): FileUploadProps {
  return Object.fromEntries(Object.entries(props).filter(([, value]) => value !== undefined));
}

/**
 * A number, however the caller wrote it.
 *
 * `:maxSize="5000000"` arrives as a number and `maxSize="5000000"` as its
 * spelling. The primitive is typed for a number, and is handed one whichever
 * way the tag spelled it. A spelling that is not a number, or an attribute
 * written with nothing after it, is no limit at all.
 */
function numeric(value: number | string | boolean | null | undefined): number | undefined {
  if (typeof value === 'number') return Number.isNaN(value) ? undefined : value;
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * A switch, however the caller wrote it.
 *
 * `multiple="false"` is the string `'false'`, which is truthy, and was asking
 * for the opposite of what it would get. Every other word is on — written
 * bare, `"true"`, or `disabled="disabled"` the way HTML spells it — and left
 * out it is the fallback.
 */
function flag(value: boolean | string | null | undefined, fallback: boolean): boolean {
  if (value === false || value === 'false') return false;
  if (value === null || value === undefined) return fallback;
  return true;
}
