/**
 * Routing, preferences, and the shell around a room.
 *
 * Two routes: the way in, and a room at /r/CODE — which is the link you send
 * people, so it has to survive a cold page load and a refresh.
 */

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Landing } from './screens/Landing';
import { PrefsContext } from './lib/prefsContext';
import { loadPrefs, savePrefs, type Prefs } from './lib/prefs';
import { setMuted, unlockAudio } from './lib/sound';
import { BASE_URL, stripBase, withBase } from '../shared/base';
import { normalizeRoomCode } from '../shared/room';

const loadRoomShell = () => import('./RoomShell');
const RoomShell = lazy(loadRoomShell);

/** Start room-only code while the create/join request is already in flight. */
function prepareRoom(): void {
  void Promise.all([
    loadRoomShell(),
    import('./screens/Lobby'),
    import('./screens/Table'),
  ]).catch(() => {
    // Opportunistic: React.lazy will surface a real load failure if we enter.
  });
}

function codeFromPath(): string | null {
  // The app is served under /uno, so that comes off before the route is read.
  const path = stripBase(location.pathname);
  const match = path?.match(/^\/r\/([^/]+)\/?$/);
  return match ? normalizeRoomCode(match[1]) : null;
}

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
        <Suspense fallback={<RoomLoading code={code} onLeave={leaveRoom} />}>
          <RoomShell
            key={code}
            code={code}
            initialName={prefs.name}
            initialAvatar={prefs.avatar}
            onLeave={leaveRoom}
          />
        </Suspense>
      ) : (
        <Landing onEnter={enterRoom} onPrepareRoom={prepareRoom} notice={notice} />
      )}
    </PrefsContext.Provider>
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
