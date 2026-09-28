/**
 * Routing, preferences, and the shell around a room.
 *
 * Two routes: the way in, and a room at /r/CODE — which is the link you send
 * people, so it has to survive a cold page load and a refresh.
 */

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Landing } from './screens/Landing';
import { PrefsContext } from './lib/prefsContext';
import { loadPrefs, savePrefs, type Prefs } from './lib/prefs';
import { preloadable } from './lib/preloadable';
import { setMuted, unlockAudio } from './lib/sound';
import { useRoom } from './lib/useRoom';
import { BASE_URL, stripBase, withBase } from '../shared/base';
import { normalizeRoomCode, randomNickname } from '../shared/room';
import { cryptoRng } from '../shared/rng';

/**
 * RoomShell counts as loaded only once both of its screens are too, so the
 * lobby and the table never suspend on the way in.
 */
const roomShell = preloadable(() =>
  Promise.all([
    import('./RoomShell'),
    import('./roomScreens').then((screens) => screens.preloadRoomScreens()),
  ]).then(([module]) => module.default),
);
const RoomShell = roomShell.Component;

/** Start room-only code while the create/join request is already in flight. */
function prepareRoom(): void {
  void roomShell.preload().catch(() => {
    // Opportunistic: React.lazy will surface a real load failure if we enter.
  });
}

function codeFromPath(): string | null {
  // The app is served under /uno, so that comes off before the route is read.
  const path = stripBase(location.pathname);
  const match = path?.match(/^\/r\/([^/]+)\/?$/);
  return match ? normalizeRoomCode(match[1]) : null;
}

// Arriving on a room link: fetch the room's code alongside the socket, which
// `Room` opens on its first render, rather than one after the other.
if (codeFromPath()) prepareRoom();

export default function App() {
  const [prefs, setPrefs] = useState<Prefs>(() => loadPrefs());
  const [code, setCode] = useState<string | null>(() => codeFromPath());
  const [notice, setNotice] = useState<string | null>(null);
  const prefsRef = useRef(prefs);

  useEffect(() => {
    prefsRef.current = prefs;
  }, [prefs]);

  // Typing a nickname should not synchronously write localStorage after every
  // key. Keep the state immediate, persist the settled value, and flush when
  // the page is being left.
  useEffect(() => {
    const id = window.setTimeout(() => savePrefs(prefs), 200);
    return () => window.clearTimeout(id);
  }, [prefs]);

  useEffect(() => setMuted(prefs.muted), [prefs.muted]);

  useEffect(() => {
    const flush = () => savePrefs(prefsRef.current);
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, []);

  // On the way in, fetch the room's code once the page has settled, so Create
  // and Join do not wait on it. Not when the browser asks to save data.
  useEffect(() => {
    if (code) return;
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    if (connection?.saveData) return;
    // Safari has no requestIdleCallback.
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(prepareRoom, { timeout: 1500 });
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(prepareRoom, 1500);
    return () => window.clearTimeout(id);
  }, [code]);

  // Back and forward should move between the landing page and a room.
  useEffect(() => {
    const onPop = () => setCode(codeFromPath());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // The first real gesture is what lets audio start.
  useEffect(() => {
    const once = () => unlockAudio();
    window.addEventListener('pointerdown', once, { once: true });
    window.addEventListener('keydown', once, { once: true });
    return () => {
      window.removeEventListener('pointerdown', once);
      window.removeEventListener('keydown', once);
    };
  }, []);

  const update = useCallback((patch: Partial<Prefs>) => {
    setPrefs((current) => ({ ...current, ...patch }));
  }, []);

  const store = useMemo(() => ({ prefs, update }), [prefs, update]);

  const enterRoom = useCallback((next: string) => {
    setNotice(null);
    history.pushState({}, '', withBase(`/r/${next}`));
    setCode(next);
  }, []);

  const leaveRoom = useCallback((message?: string) => {
    history.pushState({}, '', BASE_URL);
    setCode(null);
    setNotice(message ?? null);
  }, []);

  return (
    <PrefsContext.Provider value={store}>
      {code ? (
        <Room
          key={code}
          code={code}
          initialName={prefs.name}
          initialAvatar={prefs.avatar}
          onLeave={leaveRoom}
        />
      ) : (
        <Landing onEnter={enterRoom} onPrepareRoom={prepareRoom} notice={notice} />
      )}
    </PrefsContext.Provider>
  );
}

interface RoomProps {
  code: string;
  initialName: string;
  initialAvatar: number;
  onLeave: (message?: string) => void;
}

/**
 * One visit to one room. The connection opens here, in the entry chunk, so on
 * a room link the socket is already connecting while RoomShell downloads.
 * Keyed by code, so leaving or switching rooms starts from nothing.
 */
function Room({ code, initialName, initialAvatar, onLeave }: RoomProps) {
  const [{ name, avatar }] = useState(() => ({
    name: initialName.trim() || randomNickname(cryptoRng),
    avatar: initialAvatar,
  }));
  const connection = useRoom(useMemo(() => ({ code, name, avatar }), [avatar, code, name]));

  // A plain loading screen, not a Suspense fallback, while the chunk is on its
  // way: React keeps a fallback up for at least 300 ms once it has shown one.
  const [ready, setReady] = useState(roomShell.isLoaded);
  useEffect(() => {
    if (ready) return;
    let live = true;
    const settle = () => {
      if (live) setReady(true);
    };
    roomShell.preload().then(settle, settle);
    return () => {
      live = false;
    };
  }, [ready]);

  if (!ready) return <RoomLoading code={code} onLeave={onLeave} />;
  return (
    <Suspense fallback={<RoomLoading code={code} onLeave={onLeave} />}>
      <RoomShell code={code} connection={connection} onLeave={onLeave} />
    </Suspense>
  );
}

function RoomLoading({ code, onLeave }: { code: string; onLeave: () => void }) {
  return (
    <main className="table-felt flex h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="tabular text-3xl tracking-[0.2em] text-chalk">{code}</p>
      <p className="text-sm text-chalk-dim">Preparing the table…</p>
      <button
        onClick={onLeave}
        className="mt-2 rounded-lg border border-edge px-4 py-2 text-sm text-chalk-dim transition hover:border-chalk-faint hover:text-chalk"
      >
        Back
      </button>
    </main>
  );
}
