/**
 * Where the app is mounted.
 *
 * The game lives at parebaik.com/uno, not at the root of the domain —
 * parebaik.com/* belongs to a different Worker. Every URL the project builds
 * goes through here: Vite's `base`, the Worker's routing, the client's fetch
 * and WebSocket calls, and the room links people paste to their friends.
 *
 * Set it to '' to serve from the root of a domain again; nothing else has to
 * change.
 */
export const BASE_PATH = '/uno';

/** The same thing with the trailing slash Vite's `base` wants. */
export const BASE_URL = `${BASE_PATH}/`;

/** '/api/rooms' -> '/uno/api/rooms'. */
export function withBase(path: string): string {
  return `${BASE_PATH}${path}`;
}

/**
 * The path as the app sees it, with the mount point taken off — so the Worker
 * and the router can be written as if the app owned the whole domain.
 *
 * Returns null when the request is not under the mount point at all, which is
 * how the Worker knows to redirect rather than serve.
 */
export function stripBase(pathname: string): string | null {
  if (!BASE_PATH) return pathname;
  if (pathname === BASE_PATH) return '/';
  if (pathname.startsWith(BASE_URL)) return pathname.slice(BASE_PATH.length);
  return null;
}
