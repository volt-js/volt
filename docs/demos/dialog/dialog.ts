import { Component, Signal } from '@voltdev/core';
import { VButton, VDialog } from '@voltdev/ui/components';

@Component({
  selector: 'v-delete-project',
  templateUrl: './dialog.html',
  imports: [VButton, VDialog],
})
export class DeleteProject {
  open = new Signal.State(false);
  deleted = new Signal.State(false);

  show = (): void => this.open.set(true);
  hide = (): void => this.open.set(false);

  remove = (): void => {
    this.deleted.set(true);
    this.open.set(false);
  };
}
