/**
 * The other players, set around the far side of the table.
 *
 * Each seat shows a fan of card backs and a live count, and whoever is on
 * turn gets a ring in the live colour with the turn clock drawn around it.
 * On a phone the fans collapse to avatar chips.
 */

import { memo, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Avatar } from './Avatar';
import { CardBack } from './Card';
import { useTicker } from '../lib/hooks';
import type { Phase, PublicPlayer, TurnTimer, UnoWindow } from '../../shared/types';

const RING_RADIUS = 21;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

/**
 * Only the parts of the room the seats draw, so a frame that changes
 * something else — the pile, your hand — does not re-render them.
 */
interface OpponentsProps {
  players: PublicPlayer[];
  turn: number;
  /** A pending choice (a colour, a swap) is who the table is waiting on. */
  pendingPlayerId: string | null;
  uno: UnoWindow | null;
  turnDeadline: number | null;
  turnTimer: TurnTimer;
  phase: Phase;
  youId: string | null;
  /** Server clock minus the browser clock. */
  clockSkew: number;
  compact: boolean;
  registerSeat: (playerId: string, element: HTMLElement | null) => void;
}

/** Five is enough to read as a hand; more just merges into the next seat. */
function fanOf(player: PublicPlayer, compact: boolean): number {
  return Math.min(player.handCount, compact ? 0 : 5);
}

function statusOf(player: PublicPlayer, phase: Phase): string {
  if (player.botControlled) return 'bot playing';
  if (!player.connected) return 'away';
  if (player.isBot) return player.botLevel;
  return phase === 'playing' ? `${player.score}` : '';
}

export const Opponents = memo(function Opponents({
  players,
  turn,
  pendingPlayerId,
  uno,
  turnDeadline,
  turnTimer,
  phase,
  youId,
  clockSkew,
  compact,
  registerSeat,
}: OpponentsProps) {
  // Seat order, starting from the player after you, so the table reads round.
  const youIndex = players.findIndex((player) => player.id === youId);
  const start = youIndex >= 0 ? youIndex : 0;
  const others: PublicPlayer[] = [];
  for (let step = 1; step < players.length; step++) {
    others.push(players[(start + step) % players.length]);
  }
  if (youIndex < 0) others.length = 0;
  const seats = youIndex < 0 ? players : others;

  const actorId = pendingPlayerId ?? players[turn]?.id;

  // Seats share one row, so any seat changing size moves the others. Each
  // seat re-measures for its layout animation only when this changes, rather
  // than on every frame the room sends.
  const layoutKey = seats
    .map((player) => `${player.id}:${fanOf(player, compact)}:${player.name}:${statusOf(player, phase)}`)
    .join('|');

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
            isActor={player.id === actorId}
            uno={uno?.playerId === player.id ? uno : null}
            turnDeadline={turnDeadline}
            turnTimer={turnTimer}
            phase={phase}
            clockSkew={clockSkew}
            compact={compact}
            lift={lift}
            layoutKey={layoutKey}
            registerSeat={registerSeat}
          />
        );
      })}
    </div>
  );
});

const Seat = memo(function Seat({
  player,
  isActor,
  uno,
  turnDeadline,
  turnTimer,
  phase,
  clockSkew,
  compact,
  lift,
  layoutKey,
  registerSeat,
}: {
  player: PublicPlayer;
  isActor: boolean;
  /** The UNO window, when it is this player's. */
  uno: UnoWindow | null;
  turnDeadline: number | null;
  turnTimer: TurnTimer;
  phase: Phase;
  clockSkew: number;
  compact: boolean;
  lift: number;
  layoutKey: string;
  registerSeat: (playerId: string, element: HTMLElement | null) => void;
}) {
  const fanned = fanOf(player, compact);
  const playerId = player.id;
  const seatRef = useCallback(
    (element: HTMLElement | null) => registerSeat(playerId, element),
    [playerId, registerSeat],
  );

  return (
    <motion.div
      layout
      layoutDependency={layoutKey}
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

      <div className="relative" ref={seatRef}>
        <Avatar index={player.avatar} size={compact ? 38 : 46} />

        {/* Turn ring, and the clock drawn around it. */}
        {isActor && (
          <TurnRing deadline={turnDeadline} durationSeconds={turnTimer} clockSkew={clockSkew} />
        )}

        {/* Card count, always a number rather than a guess at the fan. */}
        <span className="tabular absolute -right-1.5 -bottom-1 rounded-full border border-edge bg-felt px-1.5 py-px text-[11px] font-semibold text-chalk">
          {player.handCount}
        </span>

        {uno && (
          <span className="display absolute -top-2 -left-2 rounded-md bg-uno-red px-1.5 py-0.5 text-[10px] tracking-tight text-white">
            {uno.called ? 'UNO!' : '1'}
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
        <span className="text-[10px] text-chalk-faint">{statusOf(player, phase)}</span>
      </div>
    </motion.div>
  );
});

/** Only this tiny SVG updates every 100ms; the seats and card fans stay put. */
function TurnRing({
  deadline,
  durationSeconds,
  clockSkew,
}: {
  deadline: number | null;
  durationSeconds: number;
  clockSkew: number;
}) {
  const timed = deadline !== null && durationSeconds > 0;
  const now = useTicker(timed, 100) + clockSkew;
  const remaining = timed ? Math.max(0, deadline - now) : 0;
  const fraction = timed ? Math.min(1, remaining / (durationSeconds * 1000)) : 0;
  const urgent = timed && remaining < 5000;

  return (
    <svg
      viewBox="0 0 48 48"
      className="pointer-events-none absolute inset-0 h-full w-full"
      aria-hidden="true"
    >
      <circle
        cx="24"
        cy="24"
        r={RING_RADIUS}
        fill="none"
        stroke="var(--live)"
        strokeWidth="3"
        opacity="0.9"
      />
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
  );
}
