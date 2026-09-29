/**
 * The two screens a room shows. They live apart from RoomShell so the entry
 * chunk can have the lobby ready by the time RoomShell renders. The table is
 * prefetched after the lobby paints, and immediately for an active game link.
 */

import { preloadable } from './lib/preloadable';

export const lobby = preloadable(() => import('./screens/Lobby').then((module) => module.Lobby));
export const table = preloadable(() => import('./screens/Table').then((module) => module.Table));
