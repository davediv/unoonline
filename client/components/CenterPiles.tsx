/**
 * The middle of the table: the deck, the pile, which way play is going, and
 * — the thing this design is built around — the live colour, said in words.
 *
 * Naming the colour is the accessibility requirement and the signature at
 * once. A coloured dot would tell you less and look like everything else.
 */

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CardBack, CardFace, ColorGlyph } from './Card';
import type { Card, Color, PublicRoom } from '../../shared/types';
import { colorLabel } from '../../shared/deck';

interface CenterPilesProps {
  room: PublicRoom;
  colorblind: boolean;
  canDraw: boolean;
  onDraw: () => void;
  deckRef: (element: HTMLElement | null) => void;
  discardRef: (element: HTMLElement | null) => void;
}

/** A stable, card-specific tilt so the pile looks thrown down, not stacked. */
function tiltOf(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return ((hash % 17) - 8) * 1.1;
}

export function CenterPiles({
  room,
  colorblind,
  canDraw,
  onDraw,
  deckRef,
  discardRef,
}: CenterPilesProps) {
  const top = room.discardTop;
  const [buried, setBuried] = useState<Card[]>([]);
  const lastId = useRef<string | null>(null);

  // Keep a couple of previous cards under the top one, so the pile has depth.
  useEffect(() => {
    if (!top) return;
    if (lastId.current && lastId.current !== top.id) {
      const previous = lastId.current;
      setBuried((current) => [...current, { id: previous } as Card].slice(-2));
    }
    lastId.current = top.id;
  }, [top]);

  const color = room.activeColor;

  return (
    <div className="flex items-center justify-center gap-4 sm:gap-9">
      {/* Draw pile */}
      <div className="flex flex-col items-center gap-2">
        <button
          ref={deckRef as (element: HTMLButtonElement | null) => void}
          onClick={onDraw}
          disabled={!canDraw}
          aria-label={canDraw ? `Draw a card. ${room.drawCount} left in the deck.` : `Deck: ${room.drawCount} cards left`}
          className={`relative block w-24 transition sm:w-24 ${
            canDraw ? 'cursor-pointer hover:-translate-y-1' : 'cursor-default'
          }`}
        >
          {/* Two shadows under the top back, so it reads as a stack. */}
          <span className="absolute inset-0 translate-x-1 translate-y-1 opacity-45">
            <CardBack className="w-full" />
          </span>
          <span className="absolute inset-0 translate-x-0.5 translate-y-0.5 opacity-70">
            <CardBack className="w-full" />
          </span>
          <span className={`relative block ${canDraw ? 'card-shadow-lift' : 'card-shadow'}`}>
            <CardBack className="w-full" />
          </span>
          {canDraw && (
            <span className="absolute inset-0 rounded-xl ring-2 ring-chalk/70" aria-hidden="true" />
          )}
        </button>
        <span className="tabular text-xs text-chalk-dim">{room.drawCount} left</span>
      </div>

      {/* Discard pile */}
      <div className="flex flex-col items-center gap-2">
        <div ref={discardRef} className="relative w-24 sm:w-24">
          {buried.map((card, index) => (
            <span
              key={`${card.id}-${index}`}
              className="absolute inset-0 opacity-40"
              style={{ transform: `rotate(${tiltOf(card.id)}deg)` }}
              aria-hidden="true"
            >
              <CardBack className="w-full" />
            </span>
          ))}

          <AnimatePresence mode="popLayout" initial={false}>
            {top && (
              <motion.div
                key={top.id}
                initial={{ y: 70, scale: 0.86, rotate: -18, opacity: 0 }}
                animate={{ y: 0, scale: 1, rotate: tiltOf(top.id), opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.32, ease: [0.2, 0.9, 0.24, 1] }}
                className="card-shadow relative"
              >
                <CardFace card={top} colorblind={colorblind} className="w-full" />
              </motion.div>
            )}
          </AnimatePresence>

          {/* A pulse of the live colour whenever it changes. */}
          {color && (
            <motion.span
              key={color}
              className="pointer-events-none absolute -inset-4 rounded-2xl"
              style={{ background: `radial-gradient(circle, var(--live), transparent 68%)` }}
              initial={{ opacity: 0.5, scale: 0.9 }}
              animate={{ opacity: 0, scale: 1.3 }}
              transition={{ duration: 0.38, ease: [0.2, 0.9, 0.24, 1] }}
              aria-hidden="true"
            />
          )}
        </div>

        <ActiveColor color={color} colorblind={colorblind} />
      </div>

      {/* Which way play is going. */}
      <DirectionMark direction={room.direction} />
    </div>
  );
}

function ActiveColor({ color, colorblind }: { color: Color | null; colorblind: boolean }) {
  return (
    <div className="flex h-6 items-center gap-1.5" aria-live="polite">
      {color ? (
        <>
          {colorblind && (
            <svg viewBox="-8 -8 16 16" className="h-3.5 w-3.5" aria-hidden="true">
              <ColorGlyph color={color} size={13} fill="var(--live)" />
            </svg>
          )}
          <span
            className="tabular text-sm font-semibold tracking-[0.28em] uppercase"
            style={{ color: 'var(--live)' }}
          >
            {colorLabel(color)}
          </span>
        </>
      ) : (
        <span className="tabular text-sm tracking-[0.28em] text-chalk-faint uppercase">—</span>
      )}
    </div>
  );
}

function DirectionMark({ direction }: { direction: 1 | -1 }) {
  return (
    <motion.svg
      viewBox="0 0 64 64"
      className="h-10 w-10 shrink-0 sm:h-14 sm:w-14"
      animate={{ rotateY: direction === 1 ? 0 : 180 }}
      transition={{ duration: 0.36, ease: [0.2, 0.9, 0.24, 1] }}
      role="img"
      aria-label={direction === 1 ? 'Play is going clockwise' : 'Play is going anticlockwise'}
    >
      <title>{direction === 1 ? 'Clockwise' : 'Anticlockwise'}</title>
      <g fill="none" stroke="var(--live)" strokeWidth="4" strokeLinecap="round" opacity="0.85">
        <path d="M32 10 A22 22 0 0 1 54 32" />
        <path d="M32 54 A22 22 0 0 1 10 32" />
      </g>
      <g fill="var(--live)" opacity="0.85">
        <path d="M54 32 l-7 -6 l0 12 z" />
        <path d="M10 32 l7 6 l0 -12 z" />
      </g>
    </motion.svg>
  );
}
