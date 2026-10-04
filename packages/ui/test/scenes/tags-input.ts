import { compileTemplate } from '@voltdev/core/jit';
import { Component, Signal } from '@voltdev/core';
import { createTagsInput } from '@voltdev/primitives';
import { clear, show, step, type Scene } from '../scene.ts';

/**
 * `tags-input.html`, with the primitive's own bags on the box and the text
 * input where the component merges the caller's names into them, and the
 * remove buttons drawn on signals of the scene's own where the component
 * asks whether the field is disabled or read-only. The sheet reads none of
 * those, so the picture of what it selects on is the same.
 *
 * The one thing the component changes that the sheet does read is kept:
 * `aria-readonly` off the box, which is a `group` and may not say it, and
 * `data-readonly` on it instead.
 */
@Component({
  selector: 'v-styled-tags-input',
  render: compileTemplate(`
    <form>
      <div class="volt-field" :spread="tags.fieldProps()">
        <label class="volt-field-label" :ref="label" :spread="tags.labelProps()">Topics</label>
        <div :ref="box" class="volt-field-control volt-tags-input" :spread="boxProps()">
          <div :ref="row" class="volt-tags-input-list" :spread="tags.listProps()">
            <span :for="(tag, index) in tags.tags()" :key="tag" class="volt-chip volt-tags-input-tag"
                  :spread="tags.tagProps(index)" :keydown="tags.onTagKeyDown($event, index)">
              <span class="volt-chip-label">{ tag }</span>
              <button :if="!off.get() && !locked.get()" class="volt-chip-remove" :spread="tags.removeProps(index)"
                      :click="tags.removeAt(index)">×</button>
            </span>
          </div>
          <input :ref="control" class="volt-tags-input-input" :spread="tags.inputProps()"
                 :keydown="tags.onKeyDown($event)" :paste="tags.onPaste($event)" :blur="tags.onBlur()">
        </div>
        <input :for="(tag, index) in tags.tags()" :key="tag" :spread="tags.hiddenInputProps(index)">
        <p class="volt-field-description" :ref="hint" :spread="tags.descriptionProps()">Up to three.</p>
        <p class="volt-field-error" :ref="error" :spread="tags.errorMessageProps()">{ tags.field.messages()[0] ?? '' }</p>
        <p class="volt-tags-input-status" :spread="tags.statusProps()">{ tags.statusText() }</p>
      </div>
    </form>
  `),
})
class StyledTagsInput {
  label = new Signal.State<Element | null>(null);
  box = new Signal.State<Element | null>(null);
  row = new Signal.State<Element | null>(null);
  control = new Signal.State<Element | null>(null);
  hint = new Signal.State<Element | null>(null);
  error = new Signal.State<Element | null>(null);
  /** A signal, as `<v-tags-input>` holds its `disabled` prop, so the field can be taken out of use. */
  off = new Signal.State(false);
  /** And its `readOnly`, so it can be made read-only. */
  locked = new Signal.State(false);
  tags = createTagsInput({
    input: () => this.control.get(),
    list: () => this.row.get(),
    root: () => this.box.get(),
    label: () => this.label.get(),
    description: () => this.hint.get(),
    errorMessage: () => this.error.get(),
    name: 'topic',
    max: 3,
    disabled: () => this.off.get(),
    readOnly: () => this.locked.get(),
  });

  /** As `VTagsInput.boxProps` leaves the box, less the caller's names. */
  boxProps(): Record<string, string | boolean | undefined> {
    const { 'aria-readonly': readOnly, ...own } = this.tags.rootProps();
    return { ...own, 'data-readonly': readOnly === 'true' || undefined };
  }
}

export const scene: Scene = (look) => {
  const { tags } = show(StyledTagsInput);
  // Empty: the box, the empty row and the caret.
  look();
  // A row of tags, one of them the row's stop.
  step(() => {
    tags.add('design');
    tags.add('rust');
  });
  look();
  // Refused for being there already, which marks the tag it collided with.
  step(() => tags.add('Rust'));
  look();
  // Full, which the primitive marks on the box and the text input.
  step(() => tags.add('go'));
  look();
  // Refused for a reason of the page's, which the field draws on the box.
  step(() => tags.field.setCustomValidity('Pick topics from the list.'));
  look();
  clear();

  // Out of use, which the field answers with no verdict at all — so it is a
  // pass of its own rather than a step after the refusal.
  const other = show(StyledTagsInput);
  step(() => other.tags.add('design'));
  step(() => other.off.set(true));
  look();
  clear();

  // Read-only: the tags are there to read, and the box is marked for it.
  const locked = show(StyledTagsInput);
  step(() => locked.tags.add('design'));
  step(() => locked.locked.set(true));
  look();
};
