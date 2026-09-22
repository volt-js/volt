# Props, callbacks, and slots

## Passing data down

```ts
@Component({
  selector: 'v-badge',
  templateUrl: './badge.html',
})
export class Badge {
  @Prop() count = new Signal.State(0);
}
```

```html
<v-badge :count="unread.get()"></v-badge>
```

The binding stays live. When `unread` changes, the badge's text updates —
neither component re-renders, and no diff runs.

### Choosing a prop form

```ts
@Prop() a = new Signal.State(0);  // reactive; read as a.get()
@Prop() b = 0;                    // not reactive
```

Use the first whenever the parent can change the value after construction, the
second only for values that never change.

There is no third form that is reactive but reads like a plain property. A
property is reactive because it holds a signal, and nothing else — so
`{ a.get() }` in a template means exactly what it means in a method.

## Notifying the parent

A callback is just an input:

```ts
export class Editor {
  @Prop() onSaved?: (text: string) => void;

  save() {
    this.onSaved?.(this.text.get());
  }
}
```

```html
<v-editor :onSaved="(text) => persist(text)"></v-editor>
```

The child calls a function it was handed. No emitter, no
subscription, and nothing to tear down — which also means the callback is
fully typed end to end.

Only one parent can supply a given callback, which is the normal case. When
several places genuinely need to react to the same change, put the state in a
signal they all read rather than fanning a notification out.

## Two-way binding

`:model` on a component pairs a `modelValue` input with an
`update:modelValue` output:

```html
<v-text-field :model="name"></v-text-field>
```

## Slots

```html
<!-- v-card -->
<div class="card">
  <header><slot name="title">Untitled</slot></header>
  <main><slot></slot></main>
  <footer><slot name="actions"></slot></footer>
</div>
```

```html
<v-card>
  <h2 :slot-title>Settings</h2>

  <p>Body content goes to the default slot.</p>

  <template :slot-actions>
    <button :click="cancel()">Cancel</button>
    <button :click="save()">Save</button>
  </template>
</v-card>
```

A `<slot>`'s children are its fallback, rendered when nothing is projected.

Slot content is compiled in the **parent's** scope, so it reads the parent's
state and calls the parent's methods — exactly where it is written.

A slot can also hand its content values, which is how a component draws the
same markup once per row or per option and gives each one its own. The
component passes them on the `<slot>`, and the content names them:

```html
<!-- v-list -->
<li :for="item in items.get()" :key="item.id"><slot :item="item">{ item.name }</slot></li>
```

```html
<v-list :items="people.get()" :slot-default="{ item }">
  <b>{ item.name }</b> — { item.role }
</v-list>
```

See [what a slot passes back](../reference/template-syntax#what-a-slot-passes-back)
for named slots and the patterns the binding accepts.

## Component references

```html
<v-editor :ref="editor"></v-editor>
```

```ts
export class Page {
  editor: Editor | null = null;

  onMount() {
    this.editor?.focus();
  }
}
```

## When not to use props

Threading a value through several layers of props is a sign it should live
in a module or a context instead:

```ts
// store.ts
export const theme = new Signal.State<'light' | 'dark'>('light');
```

Any component can import and read it. Because signals track precisely, only
the components that actually read `theme` update when it changes — there is
no provider to re-render.
