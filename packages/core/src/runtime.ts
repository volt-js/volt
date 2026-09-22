/**
 * The `_rt` namespace compiled templates are generated against.
 *
 * Codegen emits calls like `_rt.template(...)` and `_rt.insert(...)` and never
 * imports anything else, which is what lets the same generated code run both
 * as a build-time module and through `new Function` at runtime.
 */

export * from './dom.js';
export {
  createComponent,
  slot,
  defineComponent,
  initProp,
  hostAttrs,
  withSpread,
  lazy,
  preload,
} from './component.js';
