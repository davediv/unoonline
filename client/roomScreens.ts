/**
 * The two screens a room shows. They live apart from RoomShell so the entry
 * chunk can have them ready by the time RoomShell renders: a screen that is
 * already loaded renders straight away instead of flashing a fallback.
 */

import { preloadable } from './lib/preloadable';

export const lobby = preloadable(() => import('./screens/Lobby').then((module) => module.Lobby));
export const table = preloadable(() => import('./screens/Table').then((module) => module.Table));

/** Settles once both screens are loaded, or failed to; never rejects. */
export function preloadRoomScreens(): Promise<void> {
  return Promise.all([lobby.preload(), table.preload()]).then(
    () => undefined,
    // The lazy boundary in RoomShell remains the source of truth for a
    // screen that really will not load.
    () => undefined,
  );
}
