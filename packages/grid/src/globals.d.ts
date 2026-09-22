/**
 * Build-time flag separating developer diagnostics from shipped code.
 *
 * `@voltdev/vite-plugin` defines this in every Volt build — `true` while
 * developing and testing, `false` for a production bundle — so a minifier
 * removes each `if (__VOLT_DEV__)` block outright. That is what keeps Volt's
 * long, explanatory error messages out of production bundles without giving
 * them up during development.
 *
 * Anything inside such a block must be a diagnostic only. Behaviour a correct
 * program depends on has to sit outside it, because in production the block
 * does not exist.
 */
declare const __VOLT_DEV__: boolean;
