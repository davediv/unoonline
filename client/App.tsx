/**
 * Routing, preferences, and the shell around a room.
 *
 * Two routes: the way in, and a room at /r/CODE — which is the link you send
 * people, so it has to survive a cold page load and a refresh.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Landing } from './screens/Landing';
import { Lobby } from './screens/Lobby';
import { Table } from './screens/Table';
import { Toasts } from './components/Toasts';
import { toastText, useToasts } from './lib/toasts';
import { PrefsContext } from './lib/prefsContext';
import { loadPrefs, savePrefs, type Prefs } from './lib/prefs';
import { useRoom } from './lib/useRoom';
import { setMuted, unlockAudio } from './lib/sound';
import { BASE_URL, stripBase, withBase } from '../shared/base';
import { normalizeRoomCode, randomNickname } from '../shared/room';
import { cryptoRng } from '../shared/rng';

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

  useEffect(() => {
    savePrefs(prefs);
    setMuted(prefs.muted);
  }, [prefs]);

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
        <RoomShell key={code} code={code} onLeave={leaveRoom} />
      ) : (
        <Landing onEnter={enterRoom} notice={notice} />
      )}
    </PrefsContext.Provider>
  );
}

function RoomShell({ code, onLeave }: { code: string; onLeave: (message?: string) => void }) {
  const [prefsName] = useState(() => {
    const stored = loadPrefs();
    return stored.name.trim() || randomNickname(cryptoRng);
  });
  const stored = loadPrefs();
  const { toasts, push, dismiss } = useToasts();
  /** Whether we were mid-reconnect, so "Back in." only fires after a drop. */
  const droppedRef = useRef(false);

  const connection = useRoom(
    useMemo(
      () => ({ code, name: prefsName, avatar: stored.avatar }),
      [code, prefsName, stored.avatar],
    ),
  );

  const { status, room, chat, youId, spectator, error, pulse, clockSkew, send } = connection;

  // Every rejection the server sends becomes a sentence.
  useEffect(() => {
    if (!error) return;
    push(toastText(error.code, error.message));
    if (error.fatal) {
      const goodbye = toastText(error.code, error.message);
      window.setTimeout(() => onLeave(goodbye), 400);
    }
    // `seq` makes a repeat of the same error toast again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error?.seq]);

  // Losing the connection is worth saying out loud; so is getting it back.
  useEffect(() => {
    if (status === 'reconnecting') {
      push('Connection lost. Trying to get you back in.', 'warn');
    } else if (status === 'open' && droppedRef.current) {
      push('Back in.', 'info');
    }
    droppedRef.current = status === 'reconnecting';
    // Only on a change of connection state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const connectionNote =
    status === 'reconnecting' ? 'Reconnecting…' : status === 'connecting' ? 'Connecting…' : null;

  if (!room) {
    return (
      <main className="table-felt flex h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="tabular text-3xl tracking-[0.2em] text-chalk">{code}</p>
        <p className="text-sm text-chalk-dim">
          {status === 'reconnecting' ? 'Reconnecting to the table…' : 'Finding the table…'}
        </p>
        <button
          onClick={() => onLeave()}
          className="mt-2 rounded-lg border border-edge px-4 py-2 text-sm text-chalk-dim transition hover:border-chalk-faint hover:text-chalk"
        >
          Back
        </button>
        <Toasts toasts={toasts} onExpire={dismiss} />
      </main>
    );
  }

  return (
    <>
      {room.phase === 'lobby' ? (
        <Lobby
          room={room}
          youId={youId}
          spectator={spectator}
          send={send}
          onLeave={() => onLeave()}
        />
      ) : (
        <Table
          room={room}
          youId={youId}
          spectator={spectator}
          chat={chat}
          events={pulse.events}
          eventSeq={pulse.seq}
          clockSkew={clockSkew}
          connectionNote={connectionNote}
          send={send}
          onLeave={() => onLeave()}
        />
      )}
      <Toasts toasts={toasts} onExpire={dismiss} />
    </>
  );
}
