/**
 * What happened, and what it cost everyone.
 *
 * Every hand is face up here — the round is over, so there is nothing left to
 * protect, and seeing what people were sitting on is half the fun.
 */

import { motion } from 'framer-motion';
import { CardFace } from './Card';
import { Avatar } from './Avatar';
import type { PublicRoom } from '../../shared/types';
import { handPoints } from '../../shared/deck';

interface ScoreboardProps {
  room: PublicRoom;
  youId: string | null;
  colorblind: boolean;
  onNextRound: () => void;
  onNewMatch: () => void;
  onLeave: () => void;
  connected: boolean;
}

export function Scoreboard({
  room,
  youId,
  colorblind,
  onNextRound,
  onNewMatch,
  onLeave,
  connected,
}: ScoreboardProps) {
  const result = room.result;
  if (!result) return null;

  const matchOver = room.phase === 'matchOver';
  const winner = room.players.find((player) => player.id === result.winnerId);
  const matchWinner = room.players.find((player) => player.id === room.matchWinnerId);
  const isHost = youId !== null && room.hostId === youId;
  const you = room.players.find((player) => player.id === youId);

  const ranked = [...room.players].sort((a, b) => b.score - a.score);
  const waiting = room.players.filter((player) => !player.isBot && player.connected && !player.ready);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.25 }}
      className="fixed inset-0 z-40 overflow-y-auto bg-felt-deep/90 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={matchOver ? 'Match over' : 'Round over'}
    >
      <div className="mx-auto w-full max-w-2xl px-5 py-8">
        <motion.header
          initial={{ y: 12, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.3, ease: [0.2, 0.9, 0.24, 1] }}
          className="mb-6 text-center"
        >
          <p className="text-xs font-semibold tracking-widest text-chalk-faint uppercase">
            {matchOver ? 'Match over' : `Round ${room.round}`}
          </p>
          <h2 className="display mt-1 text-4xl">
            {matchOver
              ? `${matchWinner?.name ?? 'Nobody'} wins`
              : `${winner?.name ?? 'Somebody'} went out`}
          </h2>
          <p className="tabular mt-1 text-sm text-chalk-dim">
            +{result.points} {result.points === 1 ? 'point' : 'points'} this round
          </p>
        </motion.header>

        {/* Running totals. */}
        <ol className="mb-6 space-y-2">
          {ranked.map((player, index) => {
            const gained = player.id === result.winnerId ? result.points : 0;
            return (
              <motion.li
                key={player.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.05 + index * 0.05, duration: 0.24 }}
                className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${
                  player.id === result.winnerId ? 'border-chalk/40 bg-chalk/5' : 'border-edge bg-raised'
                }`}
              >
                <span className="tabular w-5 text-center text-sm text-chalk-faint">{index + 1}</span>
                <Avatar index={player.avatar} size={34} />
                <span className="min-w-0 flex-1 truncate font-semibold text-chalk">
                  {player.name}
                  {player.id === youId && <span className="ml-1 text-chalk-faint">(you)</span>}
                </span>
                {gained > 0 && <span className="tabular text-sm text-uno-green">+{gained}</span>}
                <span className="tabular w-12 text-right text-lg font-bold text-chalk">{player.score}</span>
              </motion.li>
            );
          })}
        </ol>

        {/* Every hand, face up. */}
        <section className="mb-7">
          <h3 className="mb-3 text-sm font-semibold tracking-wide text-chalk-dim uppercase">
            What everyone was holding
          </h3>
          <div className="space-y-3">
            {room.players
              .filter((player) => (result.hands[player.id] ?? []).length > 0)
              .map((player) => {
                const cards = result.hands[player.id] ?? [];
                return (
                  <div key={player.id} className="rounded-xl border border-edge bg-raised p-3">
                    <div className="mb-2 flex items-center gap-2">
                      <Avatar index={player.avatar} size={24} />
                      <span className="flex-1 truncate text-sm font-semibold text-chalk">{player.name}</span>
                      <span className="tabular text-sm text-chalk-dim">
                        {result.handPoints[player.id] ?? handPoints(cards)} points
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {cards.map((card) => (
                        <CardFace key={card.id} card={card} colorblind={colorblind} className="w-9" />
                      ))}
                    </div>
                  </div>
                );
              })}
          </div>
        </section>

        <div className="space-y-2">
          {!you ? (
            <p className="rounded-xl border border-edge bg-raised px-4 py-3 text-center text-sm text-chalk-dim">
              You are watching. You can join when a seat opens for the next game.
            </p>
          ) : matchOver ? (
            isHost ? (
              <button
                onClick={onNewMatch}
                disabled={!connected}
                className="display w-full rounded-xl bg-chalk px-5 py-4 text-lg text-felt transition hover:bg-white disabled:opacity-50"
              >
                Play again
              </button>
            ) : (
              <p className="rounded-xl border border-edge bg-raised px-4 py-3 text-center text-sm text-chalk-dim">
                Waiting for the host to start another match.
              </p>
            )
          ) : (
            <>
              <button
                onClick={onNextRound}
                disabled={!connected || you?.ready === true}
                className="display w-full rounded-xl bg-chalk px-5 py-4 text-lg text-felt transition hover:bg-white disabled:opacity-50"
              >
                {you?.ready ? 'Waiting for the others…' : 'Next round'}
              </button>
              {waiting.length > 0 && (
                <p className="text-center text-xs text-chalk-faint">
                  Still to say yes: {waiting.map((player) => player.name).join(', ')}
                </p>
              )}
            </>
          )}

          <button
            onClick={onLeave}
            className="w-full rounded-xl border border-edge px-5 py-3 text-sm text-chalk-dim transition hover:border-chalk-faint hover:text-chalk"
          >
            Leave the table
          </button>
        </div>
      </div>
    </motion.div>
  );
}
