/// <reference types="@cloudflare/vitest-pool-workers/types" />

/**
 * Gives `cloudflare:test` the same `Env` the Worker sees, so integration
 * tests get typed bindings.
 */
declare module 'cloudflare:test' {
  // Intentionally empty: this exists only to point ProvidedEnv at Env.
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface ProvidedEnv extends Env {}
}
