/**
 * The room-only shell: connection lifecycle, lazy screen loading, and toasts.
 * It lives behind a dynamic import so the landing route does not pay for the
 * WebSocket client, game table, or animation runtime.
 */

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Toasts } from './components/Toasts';
import { toastText, useToasts } from './lib/toasts';
import { useRoom } from './lib/useRoom';
import { randomNickname } from '../shared/room';
import { cryptoRng } from '../shared/rng';

const loadLobby = () => import('./screens/Lobby');
const loadTable = () => import('./screens/Table');

const Lobby = lazy(() => loadLobby().then((module) => ({ default: module.Lobby })));
const Table = lazy(() => loadTable().then((module) => ({ default: module.Table })));

function preloadRoomScreens(): void {
  void Promise.all([loadLobby(), loadTable()]).catch(() => {
    // The lazy boundary remains the source of truth for an actual navigation.
  });
}

interface RoomShellProps {
  code: string;
  initialName: string;
  initialAvatar: number;
  onLeave: (message?: string) => void;
}

export default function RoomShell({
  code,
  initialName,
  initialAvatar,
  onLeave,
}: RoomShellProps) {
  const [{ name, avatar }] = useState(() => ({
    name: initialName.trim() || randomNickname(cryptoRng),
    avatar: initialAvatar,
  }));
  const { toasts, push, dismiss } = useToasts();
  /** Whether we were mid-reconnect, so "Back in." only fires after a drop. */
  const droppedRef = useRef(false);

  useEffect(preloadRoomScreens, []);

  const connection = useRoom(useMemo(() => ({ code, name, avatar }), [avatar, code, name]));
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

  const leave = useCallback(() => onLeave(), [onLeave]);
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
          onClick={leave}
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
      <Suspense fallback={<RoomScreenLoading code={code} />}>
        {room.phase === 'lobby' ? (
          <Lobby room={room} youId={youId} spectator={spectator} send={send} onLeave={leave} />
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
            onLeave={leave}
          />
        )}
      </Suspense>
      <Toasts toasts={toasts} onExpire={dismiss} />
    </>
  );
}

function RoomScreenLoading({ code }: { code: string }) {
  return (
    <main className="table-felt flex h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="tabular text-3xl tracking-[0.2em] text-chalk">{code}</p>
      <p className="text-sm text-chalk-dim">Laying out the cards…</p>
    </main>
  );
}
