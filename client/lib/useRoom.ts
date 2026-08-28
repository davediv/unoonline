/**
 * The connection to a room.
 *
 * One socket, owned by a ref so React's strict-mode double render cannot open
 * two. State arrives whole — the client never computes game state itself, it
 * only draws whatever the Durable Object last sent, which is why a hacked
 * client cannot desync itself into an advantage.
 *
 * A dropped connection retries with backoff, replaying the session token so
 * the same seat and the same hand come back.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { withBase } from '../../shared/base';
import type { GameEvent, PublicRoom } from '../../shared/types';
import type { ChatMessage, ClientMessage, ServerMessage } from '../../shared/protocol';
import { clearToken, loadToken, saveToken } from './prefs';

export type ConnectionStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface RoomError {
  code: string;
  message: string;
  fatal: boolean;
  /** Bumps on every error so the same message can be toasted twice. */
  seq: number;
}

/** A batch of events, with a counter so effects fire once per batch. */
export interface EventPulse {
  seq: number;
  events: GameEvent[];
}

export interface JoinOptions {
  code: string;
  name: string;
  avatar: number;
  spectate?: boolean;
}

export interface RoomConnection {
  status: ConnectionStatus;
  room: PublicRoom | null;
  chat: ChatMessage[];
  youId: string | null;
  spectator: boolean;
  error: RoomError | null;
  pulse: EventPulse;
  /** Server clock minus ours, so countdowns agree with the DO. */
  clockSkew: number;
  send: (message: ClientMessage) => void;
  leave: () => void;
}

const MAX_BACKOFF_MS = 8000;
const PING_INTERVAL_MS = 25_000;
const CHAT_LIMIT = 120;

export function useRoom(options: JoinOptions | null): RoomConnection {
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [room, setRoom] = useState<PublicRoom | null>(null);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [youId, setYouId] = useState<string | null>(null);
  const [spectator, setSpectator] = useState(false);
  const [error, setError] = useState<RoomError | null>(null);
  const [pulse, setPulse] = useState<EventPulse>({ seq: 0, events: [] });
  const [clockSkew, setClockSkew] = useState(0);

  const socketRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const pingRef = useRef<number | null>(null);
  const stoppedRef = useRef(false);
  const seqRef = useRef(0);
  const errorSeqRef = useRef(0);

  const key = options ? `${options.code}|${options.name}|${options.avatar}|${options.spectate}` : '';

  const cleanup = useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    if (pingRef.current !== null) window.clearInterval(pingRef.current);
    timerRef.current = null;
    pingRef.current = null;
    const socket = socketRef.current;
    socketRef.current = null;
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close(1000, 'leaving');
      }
    }
  }, []);

  useEffect(() => {
    if (!options) return;
    stoppedRef.current = false;

    const connect = () => {
      if (stoppedRef.current) return;
      setStatus(retryRef.current === 0 ? 'connecting' : 'reconnecting');

      const params = new URLSearchParams({
        room: options.code,
        name: options.name,
        avatar: String(options.avatar),
        v: '2',
      });
      if (options.spectate) params.set('spectate', '1');
      const token = loadToken(options.code);
      if (token) params.set('token', token);

      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const socket = new WebSocket(`${protocol}//${location.host}${withBase('/ws')}?${params}`);
      socketRef.current = socket;

      socket.onopen = () => {
        retryRef.current = 0;
        setStatus('open');
        pingRef.current = window.setInterval(() => {
          // Answered by the runtime itself, so the room stays hibernated.
          if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ t: 'ping' }));
        }, PING_INTERVAL_MS);
      };

      socket.onmessage = (event) => {
        let message: ServerMessage;
        try {
          message = JSON.parse(event.data as string) as ServerMessage;
        } catch {
          return;
        }

        switch (message.t) {
          case 'welcome':
            saveToken(options.code, message.token);
            setYouId(message.youId);
            setSpectator(message.spectator);
            setRoom(message.room);
            setChat(message.chat);
            setClockSkew(message.room.now - Date.now());
            break;

          case 'sync':
            setRoom(message.room);
            setClockSkew(message.room.now - Date.now());
            if (message.chat && message.chat.length > 0) {
              setChat((previous) => [...previous, ...(message.chat ?? [])].slice(-CHAT_LIMIT));
            }
            if (message.events.length > 0) {
              seqRef.current += 1;
              setPulse({ seq: seqRef.current, events: message.events });
            }
            break;

          case 'chat':
            if (message.messages.length > 0) {
              setChat((previous) => [...previous, ...message.messages].slice(-CHAT_LIMIT));
            }
            break;

          case 'error':
            errorSeqRef.current += 1;
            setError({
              code: message.code,
              message: message.message,
              fatal: message.fatal === true,
              seq: errorSeqRef.current,
            });
            if (message.fatal) {
              stoppedRef.current = true;
              if (message.code === 'no_such_room') clearToken(options.code);
            }
            break;

          case 'pong':
            break;
        }
      };

      socket.onclose = () => {
        if (pingRef.current !== null) window.clearInterval(pingRef.current);
        pingRef.current = null;
        if (stoppedRef.current) {
          setStatus('closed');
          return;
        }
        setStatus('reconnecting');
        // 0.5s, 1s, 2s, 4s, 8s, with a little jitter so a room full of
        // players does not all reconnect on the same tick.
        const attempt = retryRef.current++;
        const backoff = Math.min(MAX_BACKOFF_MS, 500 * 2 ** attempt);
        const jitter = backoff * 0.25 * Math.random();
        timerRef.current = window.setTimeout(connect, backoff + jitter);
      };

      socket.onerror = () => {
        // `onclose` always follows, and that is where the retry lives.
      };
    };

    connect();
    return () => {
      stoppedRef.current = true;
      cleanup();
    };
    // `key` collapses the join options into one dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, cleanup]);

  const send = useCallback((message: ClientMessage) => {
    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }, []);

  const leave = useCallback(() => {
    stoppedRef.current = true;
    cleanup();
    setStatus('closed');
  }, [cleanup]);

  return useMemo(
    () => ({ status, room, chat, youId, spectator, error, pulse, clockSkew, send, leave }),
    [status, room, chat, youId, spectator, error, pulse, clockSkew, send, leave],
  );
}
