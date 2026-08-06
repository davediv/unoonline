/**
 * The one Worker. It serves the built client through the Assets binding and
 * handles the two dynamic routes:
 *
 *   POST /api/rooms        create a room, get a code back
 *   GET  /api/rooms/:code  is that code real, and can I sit down?
 *   GET  /ws?room=CODE     upgrade to that room's Durable Object
 *
 * Single origin, so there is no CORS anywhere in this project.
 *
 * Those paths are written as if the app owned the whole domain. It does not —
 * it is mounted at /uno (see shared/base.ts) — so the mount point comes off
 * the front of every request before anything below looks at it.
 */

import { Room } from './room';
import { stripBase, withBase } from '../shared/base';
import { makeRoomCode, normalizeRoomCode } from '../shared/room';
import { cryptoRng } from '../shared/rng';

export { Room };

/** How many times to retry if a generated code is already in use. */
const CODE_ATTEMPTS = 8;

const json = (body: unknown, status = 200): Response =>
  Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = stripBase(url.pathname);

    // Reached outside the mount point — the workers.dev preview URL, or a bare
    // /unosomething. The app only exists under /uno, so send them there.
    if (path === null) {
      return Response.redirect(`${url.origin}${withBase(url.pathname)}${url.search}`, 302);
    }

    if (path === '/ws') {
      return handleSocket(request, env, url);
    }

    if (path === '/api/rooms' && request.method === 'POST') {
      return createRoom(env);
    }

    const lookup = path.match(/^\/api\/rooms\/([^/]+)$/);
    if (lookup && request.method === 'GET') {
      return roomInfo(env, decodeURIComponent(lookup[1]));
    }

    if (path.startsWith('/api/')) {
      return json({ error: 'not_found', message: 'No such endpoint.' }, 404);
    }

    // Anything else is the client, and the two halves of its life differ.
    //
    // Deployed, the Assets binding holds the built files at the root of its own
    // manifest (/assets/…), so it is asked for the stripped path — and answers
    // an unknown one with index.html, which is how /uno/r/CODE survives a
    // refresh. In `npm run dev` the binding is the Vite dev server, which
    // already serves everything under `base` and redirects what is not, so the
    // request goes through exactly as it arrived.
    if (import.meta.env.DEV) {
      return env.ASSETS.fetch(request);
    }
    const assetUrl = new URL(path + url.search, url.origin);
    return env.ASSETS.fetch(new Request(assetUrl, request));
  },
} satisfies ExportedHandler<Env>;

async function createRoom(env: Env): Promise<Response> {
  for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
    const code = makeRoomCode(cryptoRng);
    const stub = env.ROOM.get(env.ROOM.idFromName(code));
    if (await stub.createIfAbsent(code)) {
      return json({ code });
    }
  }
  return json(
    { error: 'no_code_available', message: 'Could not find a free room code. Try again.' },
    503,
  );
}

async function roomInfo(env: Env, raw: string): Promise<Response> {
  const code = normalizeRoomCode(raw);
  if (!code) {
    return json({ exists: false, reason: 'bad_code' });
  }
  const stub = env.ROOM.get(env.ROOM.idFromName(code));
  const info = await stub.info();
  return json({ code, ...info });
}

function handleSocket(request: Request, env: Env, url: URL): Promise<Response> | Response {
  if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
    return new Response('Expected a WebSocket upgrade.', { status: 426 });
  }
  const code = normalizeRoomCode(url.searchParams.get('room') ?? '');
  if (!code) {
    return new Response('Bad room code.', { status: 400 });
  }
  // Same code, same Durable Object, anywhere in the world.
  const stub = env.ROOM.get(env.ROOM.idFromName(code));
  return stub.fetch(request);
}
