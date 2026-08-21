import { Component, Signal } from '../../volt.js';

export interface Book {
  id: number;
  title: string;
  authors: string[];
}

@Component({ selector: 'v-catalogue', templateUrl: './catalogue.html' })
export class Catalogue {
  books = new Signal.State<Book[]>([]);
  query = new Signal.State('');
  open = new Signal.State(false);
  heading = 'Catalogue';

  select(id: number): void {
    void id;
  }

  search(event: Event): void {
    // The template has no cast, so narrowing an event target is the method's
    // job. That is the shape the checker pushes an author towards.
    this.query.set(event.target instanceof HTMLInputElement ? event.target.value : '');
  }

  press(event: KeyboardEvent): void {
    void event.key;
  }
}
