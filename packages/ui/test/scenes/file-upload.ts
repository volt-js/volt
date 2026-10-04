import { compileTemplate } from '@voltdev/core/jit';
import { Component, Signal } from '@voltdev/core';
import { createFileUpload, type UploadTransport } from '@voltdev/primitives';
import { clear, show, step, type Scene } from '../scene.ts';

/**
 * `file-upload.html`, with the primitive's own bags where the component
 * merges the caller's names into them and strips what a `<span>` cannot use.
 * The sheet reads none of those, so the picture of what it selects on is the
 * same. The bar's indicator carries the bar's state, as the component writes
 * it there, and the width the component writes inline is left out, since no
 * rule selects on it.
 */
@Component({
  selector: 'v-styled-file-upload',
  render: compileTemplate(`
    <div class="volt-file-upload" :spread="upload.rootProps()">
      <div :ref="zone" class="volt-file-upload-zone" :spread="upload.dropZoneProps()"
           :click="upload.open()" :keydown="upload.onKeyDown($event)"
           :dragenter="upload.onDragEnter($event)" :dragover="upload.onDragOver($event)"
           :dragleave="upload.onDragLeave($event)" :drop="upload.onDrop($event)">
        <span :ref="words" class="volt-file-upload-label" :spread="upload.labelProps()">Drop photos here</span>
      </div>
      <input :ref="input" :spread="upload.inputProps()" :change="upload.onInputChange($event)">
      <p :ref="hint" class="volt-file-upload-description" :spread="upload.descriptionProps()">Up to 50 bytes each.</p>
      <p :ref="error" class="volt-file-upload-error" :spread="upload.errorMessageProps()">{ upload.field.messages()[0] ?? '' }</p>
      <ul :if="upload.items().length > 0" class="volt-file-upload-list" role="list">
        <li :for="item in upload.items()" :key="item.id" class="volt-file-upload-item" :spread="upload.itemProps(item)">
          <div class="volt-file-upload-head">
            <span class="volt-file-upload-name">{ item.path }</span>
            <span class="volt-file-upload-meta">{ item.status }</span>
            <span class="volt-file-upload-actions">
              <button :if="item.status !== 'rejected'" class="volt-file-upload-action"
                      :spread="upload.retryProps(item)" :click="upload.retry(item.id)">↻</button>
              <button class="volt-file-upload-action" :spread="upload.removeProps(item)"
                      :click="upload.remove(item.id)">×</button>
            </span>
          </div>
          <div :if="item.status !== 'rejected'" class="volt-progress" :spread="upload.itemProgressProps(item)">
            <div class="volt-progress-track">
              <div class="volt-progress-indicator" :attr-data-state="upload.itemProgressProps(item)['data-state']"></div>
            </div>
          </div>
          <p :if="item.error" class="volt-file-upload-reason">{ item.error.message }</p>
        </li>
      </ul>
      <div :ref="live" class="volt-file-upload-status" :spread="upload.liveRegionProps()">{ upload.announcement() }</div>
    </div>
  `),
})
class StyledFileUpload {
  zone = new Signal.State<Element | null>(null);
  words = new Signal.State<Element | null>(null);
  input = new Signal.State<Element | null>(null);
  hint = new Signal.State<Element | null>(null);
  error = new Signal.State<Element | null>(null);
  live = new Signal.State<Element | null>(null);
  /** A signal, as `<v-file-upload>` holds its `disabled` prop. */
  off = new Signal.State(false);

  /** A request that never answers, so a file taken stays on its way. */
  send: UploadTransport = () => new Promise(() => {});

  upload = createFileUpload({
    input: () => this.input.get(),
    dropZone: () => this.zone.get(),
    liveRegion: () => this.live.get(),
    label: () => this.words.get(),
    description: () => this.hint.get(),
    errorMessage: () => this.error.get(),
    disabled: () => this.off.get(),
    transport: (request) => this.send(request),
    maxSize: 50,
  });
}

/**
 * A drag event carrying files.
 *
 * happy-dom drops `dataTransfer` from a `DragEvent`'s init, and lists a
 * file's type among `types` where a browser lists `Files` — so the carrier is
 * written onto the event the way a browser would have filled it in.
 */
function drag(type: string, files: readonly File[] = []): DragEvent {
  const data = new DataTransfer();
  for (const file of files) data.items.add(file);
  const event = new DragEvent(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', {
    value: { types: ['Files'], files: data.files, items: data.items, dropEffect: 'none' },
  });
  return event;
}

export const scene: Scene = (look) => {
  const { upload, off } = show(StyledFileUpload);
  const zone = document.querySelector<HTMLElement>('.volt-file-upload-zone')!;

  // At rest: the zone, its words, the help, and the message with nothing in it.
  look();

  // A drag over the zone, which the primitive marks on the zone itself.
  step(() => zone.dispatchEvent(drag('dragenter')));
  look();
  step(() => zone.dispatchEvent(drag('dragleave')));

  // A file taken and on its way, beside one refused for its size: the row
  // with a bar and a retry that has nothing to retry yet, the row with a
  // reason and no bar, and the field's message saying why.
  step(() =>
    upload.add([
      new File([new Uint8Array(10)], 'small.png', { type: 'image/png' }),
      new File([new Uint8Array(100)], 'large.png', { type: 'image/png' }),
    ]),
  );
  look();

  // Out of use, which the zone says for itself.
  step(() => off.set(true));
  look();

  clear();
};
