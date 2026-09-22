import { Component, Signal } from '@voltdev/core';
import { createDialog } from '@voltdev/primitives';

@Component({ selector: 'v-delete-project', templateUrl: './dialog.html' })
export class DeleteProject {
  trigger = new Signal.State<Element | null>(null);
  content = new Signal.State<Element | null>(null);
  deleted = new Signal.State(false);

  dialog = createDialog({
    trigger: () => this.trigger.get(),
    content: () => this.content.get(),
  });

  remove(): void {
    this.deleted.set(true);
    this.dialog.close();
  }
}
