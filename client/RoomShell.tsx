/**
 * The room-only shell: screens, toasts, and what to say about the connection.
 * It lives behind a dynamic import so the landing route does not pay for the
 * game table or the animation runtime. The connection itself is opened by
 * `App` before this chunk arrives, so the socket and the download overlap.
 */

import { Suspense, useCallback, useEffect, useRef } from 'react';
import { Toasts } from './components/Toasts';
import { toastText, useToasts } from './lib/toasts';
import type { RoomConnection } from './lib/useRoom';
import { lobby, table } from './roomScreens';

const Lobby = lobby.Component;
const Table = table.Component;

interface RoomShellProps {
  code: string;
  connection: RoomConnection;
  onLeave: (message?: string) => void;
}

export default function RoomShell({ code, connection, onLeave }: RoomShellProps) {
  const { toasts, push, dismiss } = useToasts();
  /** Whether we were mid-reconnect, so "Back in." only fires after a drop. */
  const droppedRef = useRef(false);

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
