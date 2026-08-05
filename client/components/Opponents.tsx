/**
 * The other players, set around the far side of the table.
 *
 * Each seat shows a fan of card backs and a live count, and whoever is on
 * turn gets a ring in the live colour with the turn clock drawn around it.
 * On a phone the fans collapse to avatar chips.
 */

import { motion } from 'framer-motion';
import { Avatar } from './Avatar';
import { CardBack } from './Card';
import type { PublicPlayer, PublicRoom } from '../../shared/types';

const RING_RADIUS = 21;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

interface OpponentsProps {
  room: PublicRoom;
  youId: string | null;
  /** Server-aligned now, for the turn clock. */
  now: number;
  compact: boolean;
  registerSeat: (playerId: string, element: HTMLElement | null) => void;
}

export function Opponents({ room, youId, now, compact, registerSeat }: OpponentsProps) {
  // Seat order, starting from the player after you, so the table reads round.
  const youIndex = room.players.findIndex((player) => player.id === youId);
  const start = youIndex >= 0 ? youIndex : 0;
  const others: PublicPlayer[] = [];
  for (let step = 1; step < room.players.length; step++) {
    others.push(room.players[(start + step) % room.players.length]);
  }
  if (youIndex < 0) others.length = 0;
  const seats = youIndex < 0 ? room.players : others;

  const actorId = room.pending ? room.pending.playerId : room.players[room.turn]?.id;

  return (
    <div
      className={`flex w-full items-end justify-center gap-5 sm:gap-10 ${
        compact ? 'overflow-x-auto px-3' : 'flex-wrap px-4'
      }`}
    >
      {seats.map((player, index) => {
        // A gentle arc: the middle seats sit further back.
        const middle = (seats.length - 1) / 2;
        const spread = seats.length > 1 ? (index - middle) / Math.max(middle, 1) : 0;
        const lift = compact ? 0 : Math.round((1 - Math.abs(spread)) * 14);

        return (
          <Seat
            key={player.id}
            player={player}
            room={room}
            isActor={player.id === actorId}
            now={now}
            compact={compact}
            lift={lift}
            registerSeat={registerSeat}
          />
        );
      })}
    </div>
  );
}

function Seat({
  player,
  room,
  isActor,
  now,
  compact,
  lift,
  registerSeat,
}: {
  player: PublicPlayer;
  room: PublicRoom;
  isActor: boolean;
  now: number;
  compact: boolean;
  lift: number;
  registerSeat: (playerId: string, element: HTMLElement | null) => void;
}) {
  const timed = isActor && room.turnDeadline !== null && room.rules.turnTimer > 0;
  const remaining = timed ? Math.max(0, (room.turnDeadline as number) - now) : 0;
  const fraction = timed ? Math.min(1, remaining / (room.rules.turnTimer * 1000)) : 0;
  const urgent = timed && remaining < 5000;
  const onUno = room.uno?.playerId === player.id;

  // Five is enough to read as a hand; more just merges into the next seat.
  const fanned = Math.min(player.handCount, compact ? 0 : 5);

  return (
    <motion.div
      layout
      style={{ transform: `translateY(-${lift}px)` }}
      className="flex shrink-0 flex-col items-center gap-1"
    >
      {/* The fan of backs. Purely a picture of how many they hold. */}
      {fanned > 0 && (
        <div className="flex h-10 items-end justify-center" aria-hidden="true">
          {Array.from({ length: fanned }, (_, index) => {
            const middle = (fanned - 1) / 2;
            const offset = index - middle;
            return (
              <div
                key={index}
                className="-mx-1.5 w-6 origin-bottom"
                style={{ transform: `rotate(${offset * 8}deg) translateY(${Math.abs(offset) * 1.5}px)` }}
              >
                <CardBack className="w-full" />
              </div>
            );
          })}
        </div>
      )}

      <div className="relative" ref={(element) => registerSeat(player.id, element)}>
        <Avatar index={player.avatar} size={compact ? 38 : 46} />

        {/* Turn ring, and the clock drawn around it. */}
        {isActor && (
          <svg
            viewBox="0 0 48 48"
            className="pointer-events-none absolute inset-0 h-full w-full"
            aria-hidden="true"
          >
            <circle cx="24" cy="24" r={RING_RADIUS} fill="none" stroke="var(--live)" strokeWidth="3" opacity="0.9" />
            {timed && (
              <circle
                cx="24"
                cy="24"
                r={RING_RADIUS}
                fill="none"
                stroke={urgent ? '#e4322b' : '#f2f4f7'}
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray={RING_LENGTH}
                strokeDashoffset={RING_LENGTH * (1 - fraction)}
                transform="rotate(-90 24 24)"
              />
            )}
          </svg>
        )}

        {/* Card count, always a number rather than a guess at the fan. */}
        <span className="tabular absolute -right-1.5 -bottom-1 rounded-full border border-edge bg-felt px-1.5 py-px text-[11px] font-semibold text-chalk">
          {player.handCount}
        </span>

        {onUno && (
          <span className="display absolute -top-2 -left-2 rounded-md bg-uno-red px-1.5 py-0.5 text-[10px] tracking-tight text-white">
            {room.uno?.called ? 'UNO!' : '1'}
          </span>
        )}
      </div>

      <div className="flex max-w-24 flex-col items-center">
        <span
          className={`max-w-full truncate text-xs font-semibold ${
            isActor ? 'text-chalk' : 'text-chalk-dim'
          }`}
          title={player.name}
        >
          {player.name}
        </span>
        <span className="text-[10px] text-chalk-faint">
          {player.botControlled
            ? 'bot playing'
            : !player.connected
              ? 'away'
              : player.isBot
                ? player.botLevel
                : room.phase === 'playing'
                  ? `${player.score}`
                  : ''}
        </span>
      </div>
    </motion.div>
  );
}
