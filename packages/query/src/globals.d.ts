/**
 * Build-time flag separating a server build from a client one.
 *
 * `@voltdev/vite-plugin` defines this in every Volt build — `true` for an SSR
 * build, `false` otherwise — so a client bundle drops the server's flushing,
 * request scoping and lifecycle gating outright rather than shipping code no
 * browser will ever reach.
 *
 * Unlike `__VOLT_DEV__`, behaviour depends on this: on the server a queued
 * microtask fires at the first `await`, with whatever request happens to be
 * current, so the gates guarded here are what keep one render out of
 * another's output.
 */
declare const __VOLT_SERVER__: boolean;
