/**
 * The modules `serverRender` generates, declared for the type-checker.
 *
 * They exist only while the Vite plugin is running, so nothing on disk
 * declares them and `tsc` has to be told. Each is described by what it
 * exports rather than by `any`: the server half is the deployable handler and
 * getting its shape wrong is the kind of mistake that only shows up at the
 * host.
 */
declare module 'virtual:volt/server' {
  /** The whole application, as one request in and one response out. */
  export function handler(request: Request): Promise<Response>;
}

declare module 'virtual:volt/client' {
  // Imported for its effect: it mounts the application, or attaches to what
  // the server sent. There is nothing to import from it.
}

declare module 'virtual:volt/shell' {
  /**
   * The page the server writes its render into: the client build's emitted
   * `index.html` in a build, this project's own under `pnpm dev`.
   */
  const shell: string;
  export default shell;
}
