/**
 * The lobby: who is at the table, and how you want to play.
 *
 * Rule copy says what the rule does, not what it is called in a rulebook —
 * these are house rules, and half of them are argued about every game.
 */

import { motion } from 'framer-motion';
import { Avatar } from '../components/Avatar';
import { CardBack } from '../components/Card';
import { withBase } from '../../shared/base';
import type { BotLevel, PublicRoom, RuleSet, TurnTimer } from '../../shared/types';
import type { ClientMessage } from '../../shared/protocol';
import { MAX_PLAYERS } from '../../shared/engine';
import { useCopy } from '../lib/hooks';
import { play } from '../lib/sound';

interface LobbyProps {
  room: PublicRoom;
  youId: string | null;
  spectator: boolean;
  connected: boolean;
  send: (message: ClientMessage) => void;
  onLeave: () => void;
}

interface Toggle {
  key: keyof RuleSet;
  label: string;
  blurb: string;
}

const TOGGLES: Toggle[] = [
  { key: 'challenge', label: 'Challenge', blurb: 'Call out a Wild Draw Four you think was a bluff.' },
  { key: 'stacking', label: 'Stacking', blurb: 'Answer a Draw Two with a Draw Two. The pile keeps growing.' },
  { key: 'jumpIn', label: 'Jump-in', blurb: 'Holding the exact same card? Play it out of turn.' },
  { key: 'sevenZero', label: '7-0', blurb: 'A 7 swaps hands with someone. A 0 passes every hand along.' },
  { key: 'drawToMatch', label: 'Draw to match', blurb: 'Keep drawing until something is playable.' },
];

const TIMERS: Array<{ value: TurnTimer; label: string }> = [
  { value: 0, label: 'Off' },
  { value: 15, label: '15s' },
  { value: 30, label: '30s' },
  { value: 60, label: '60s' },
];

export function Lobby({ room, youId, spectator, connected, send, onLeave }: LobbyProps) {
  const [copied, copy] = useCopy();
  const isHost = youId !== null && room.hostId === youId;
  const you = room.players.find((player) => player.id === youId);
  const humans = room.players.filter((player) => !player.isBot);
  const link = `${location.origin}${withBase(`/r/${room.code}`)}`;
  const enough = room.players.length >= 2;
  const everyoneReady = room.players.every((player) => player.isBot || player.ready);

  const addBot = (level: BotLevel) => {
    play('join');
    send({ t: 'addBot', level });
  };

  return (
    <main className="table-felt min-h-full w-full">
      <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-6 px-5 py-8">
        <header className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold tracking-widest text-chalk-faint uppercase">Room</p>
            <h1 className="tabular text-4xl leading-tight tracking-[0.18em] text-chalk">{room.code}</h1>
          </div>
          <button
            onClick={onLeave}
            className="rounded-lg border border-edge px-3 py-2 text-sm text-chalk-dim transition hover:border-chalk-faint hover:text-chalk"
          >
            Leave
          </button>
        </header>

        <section>
          <button
            onClick={() => {
              copy(link);
              play('flip');
            }}
            className="flex w-full items-center gap-3 rounded-xl border border-edge bg-raised px-4 py-3 text-left transition hover:border-chalk-faint"
          >
            <span className="min-w-0 flex-1 truncate text-sm text-chalk-dim">{link}</span>
            <span className="shrink-0 text-sm font-semibold text-chalk">{copied ? 'Copied' : 'Copy link'}</span>
          </button>
          <p className="mt-1.5 text-xs text-chalk-faint">
            Send that to your friends, or read out the code.
          </p>
        </section>

        <section inert={!connected} className={!connected ? 'opacity-55' : undefined}>
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold tracking-wide text-chalk-dim uppercase">
              Players
            </h2>
            <span className="tabular text-xs text-chalk-faint">
              {room.players.length} / {MAX_PLAYERS}
            </span>
          </div>

          <ul className="space-y-2">
            {room.players.map((player) => (
              <motion.li
                layout
                key={player.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.22 }}
                className="flex items-center gap-3 rounded-xl border border-edge bg-raised px-3 py-2.5"
              >
                <Avatar index={player.avatar} size={38} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-semibold text-chalk">{player.name}</span>
                    {player.id === room.hostId && (
                      <span className="rounded-md bg-chalk/15 px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-chalk uppercase">
                        Host
                      </span>
                    )}
                    {player.isBot && (
                      <span className="rounded-md border border-edge px-1.5 py-0.5 text-[10px] tracking-wider text-chalk-dim uppercase">
                        {player.botLevel}
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-chalk-faint">
                    {player.isBot ? 'Bot' : player.ready ? 'Ready' : 'Not ready yet'}
                  </span>
                </div>

                {player.id === youId && (
                  <button
                    onClick={() => {
                      play('flip');
                      send({ t: 'ready', ready: !player.ready });
                    }}
                    aria-pressed={player.ready}
                    className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${
                      player.ready
                        ? 'bg-uno-green text-white'
                        : 'border border-edge text-chalk-dim hover:border-chalk-faint hover:text-chalk'
                    }`}
                  >
                    {player.ready ? 'Ready' : "I'm ready"}
                  </button>
                )}

                {isHost && player.id !== youId && (
                  <button
                    onClick={() => send({ t: 'removePlayer', playerId: player.id })}
                    aria-label={`Remove ${player.name}`}
                    className="rounded-lg border border-edge px-2.5 py-2 text-sm text-chalk-faint transition hover:border-uno-red/60 hover:text-chalk"
                  >
                    ✕
                  </button>
                )}
              </motion.li>
            ))}

            {room.players.length === 0 && (
              <li className="rounded-xl border border-dashed border-edge px-4 py-6 text-center text-sm text-chalk-faint">
                Nobody has sat down yet.
              </li>
            )}
          </ul>

          {isHost && room.players.length < MAX_PLAYERS && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-xs tracking-wide text-chalk-faint uppercase">Add a bot</span>
              {(['easy', 'normal', 'hard'] as const).map((level) => (
                <button
                  key={level}
                  onClick={() => addBot(level)}
                  className="rounded-lg border border-edge bg-raised px-3 py-1.5 text-sm text-chalk-dim capitalize transition hover:border-chalk-faint hover:text-chalk"
                >
                  {level}
                </button>
              ))}
            </div>
          )}
        </section>

        <section inert={!connected} className={!connected ? 'opacity-55' : undefined}>
          <h2 className="mb-2 text-sm font-semibold tracking-wide text-chalk-dim uppercase">
            House rules {!isHost && <span className="text-chalk-faint normal-case">— the host sets these</span>}
          </h2>

          <div className="divide-y divide-edge overflow-hidden rounded-xl border border-edge bg-raised">
            {TOGGLES.map((toggle) => {
              const on = room.rules[toggle.key] === true;
              return (
                <label
                  key={toggle.key}
                  className={`flex items-center gap-3 px-4 py-3 ${isHost ? 'cursor-pointer' : ''}`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-chalk">{toggle.label}</span>
                    <span className="block text-xs text-chalk-faint">{toggle.blurb}</span>
                  </span>
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={on}
                    disabled={!isHost}
                    onChange={(event) => {
                      play('flip');
                      send({ t: 'rules', patch: { [toggle.key]: event.target.checked } });
                    }}
                  />
                  <span
                    aria-hidden="true"
                    className={`relative h-6 w-11 shrink-0 rounded-full transition ${
                      on ? 'bg-uno-green' : 'bg-edge'
                    } ${isHost ? '' : 'opacity-50'}`}
                  >
                    <span
                      className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
                        on ? 'left-[1.375rem]' : 'left-0.5'
                      }`}
                    />
                  </span>
                </label>
              );
            })}

            <div className="px-4 py-3">
              <span className="block text-sm font-semibold text-chalk">Turn timer</span>
              <span className="mb-2 block text-xs text-chalk-faint">
                How long a turn lasts before it draws and passes on.
              </span>
              <div className="flex gap-2">
                {TIMERS.map((timer) => (
                  <button
                    key={timer.value}
                    disabled={!isHost}
                    onClick={() => send({ t: 'rules', patch: { turnTimer: timer.value } })}
                    aria-pressed={room.rules.turnTimer === timer.value}
                    className={`tabular flex-1 rounded-lg border px-2 py-1.5 text-sm transition ${
                      room.rules.turnTimer === timer.value
                        ? 'border-chalk bg-chalk/15 text-chalk'
                        : 'border-edge text-chalk-dim hover:border-chalk-faint disabled:hover:border-edge'
                    } disabled:opacity-50`}
                  >
                    {timer.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="px-4 py-3">
              <span className="block text-sm font-semibold text-chalk">Length</span>
              <span className="mb-2 block text-xs text-chalk-faint">
                One round, or keep playing until somebody reaches 500.
              </span>
              <div className="flex gap-2">
                {(
                  [
                    { value: 'single', label: 'Single round' },
                    { value: 'match', label: 'Play to 500' },
                  ] as const
                ).map((mode) => (
                  <button
                    key={mode.value}
                    disabled={!isHost}
                    onClick={() => send({ t: 'rules', patch: { matchMode: mode.value } })}
                    aria-pressed={room.rules.matchMode === mode.value}
                    className={`flex-1 rounded-lg border px-2 py-1.5 text-sm transition ${
                      room.rules.matchMode === mode.value
                        ? 'border-chalk bg-chalk/15 text-chalk'
                        : 'border-edge text-chalk-dim hover:border-chalk-faint disabled:hover:border-edge'
                    } disabled:opacity-50`}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        <div className="mt-auto space-y-2 pt-2">
          {!connected && (
            <p role="status" className="rounded-xl border border-uno-yellow/40 px-4 py-3 text-center text-sm text-uno-yellow">
              Reconnecting. Room actions will return when you are back in.
            </p>
          )}
          {spectator ? (
            <p className="rounded-xl border border-edge bg-raised px-4 py-3 text-center text-sm text-chalk-dim">
              {room.players.length >= MAX_PLAYERS
                ? 'You are watching. The table is full; you can join when a seat opens.'
                : 'You are watching. You will be seated when the next game opens.'}
            </p>
          ) : isHost ? (
            <button
              onClick={() => send({ t: 'start' })}
              disabled={!connected || !enough || !everyoneReady}
              className="display w-full rounded-xl bg-chalk px-5 py-4 text-lg text-felt transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              Start game
            </button>
          ) : (
            <p className="rounded-xl border border-edge bg-raised px-4 py-3 text-center text-sm text-chalk-dim">
              Waiting for {room.players.find((p) => p.id === room.hostId)?.name ?? 'the host'} to start.
            </p>
          )}

          {isHost && !enough && (
            <p className="text-center text-xs text-chalk-faint">
              Two players minimum. Add a bot to fill a seat.
            </p>
          )}
          {isHost && enough && !everyoneReady && (
            <p className="text-center text-xs text-chalk-faint">
              Waiting on {humans.filter((p) => !p.ready).map((p) => p.name).join(', ')}.
            </p>
          )}
          {you && !you.ready && !isHost && (
            <p className="text-center text-xs text-chalk-faint">Hit ready when you are.</p>
          )}
        </div>

        <div className="pointer-events-none flex justify-center opacity-20" aria-hidden="true">
          <CardBack className="w-16" />
        </div>
      </div>
    </main>
  );
}
