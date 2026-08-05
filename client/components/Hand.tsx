/**
 * Your hand.
 *
 * Fanned along the bottom on anything with room, and a thumb-through snap
 * strip on a phone. Playable cards sit up and catch the live colour;
 * everything else is dimmed — but still clickable, because being told *why*
 * a card will not go is more useful than a dead rectangle.
 */

import { useLayoutEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { CardFace } from './Card';
import type { Card } from '../../shared/types';
import { cardLabel } from '../../shared/deck';

interface HandProps {
  /** Already in the order it should be drawn in. */
  cards: Card[];
  playable: string[];
  jumpIn: string[];
  selected: number;
  compact: boolean;
  colorblind: boolean;
  dealing: boolean;
  onSelect: (index: number) => void;
  onPlay: (cardId: string) => void;
  onRefuse: (card: Card) => void;
}

const CARD_WIDTH = 76;
const MIN_GAP = 26;
/** How far the outermost card hangs below the middle of the fan. */
const ARC_DEPTH = 16;
/** The strip the hand always occupies, so the table above it never shifts. */
const STRIP = 198;

export function Hand({
  cards,
  playable,
  jumpIn,
  selected,
  compact,
  colorblind,
  dealing,
  onSelect,
  onPlay,
  onRefuse,
}: HandProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    setWidth(element.clientWidth);
    return () => observer.disconnect();
  }, []);

  // How much of each card is visible, given how many there are to fit.
  const gap =
    cards.length > 1
      ? Math.max(MIN_GAP, Math.min(52, (width - CARD_WIDTH - 24) / (cards.length - 1)))
      : CARD_WIDTH;
  const overlap = compact ? 0 : (CARD_WIDTH - gap) / 2;
  const step = cards.length > 1 ? Math.min(6.5, 46 / cards.length) : 0;
  const middle = (cards.length - 1) / 2;

  return (
    <div
      ref={containerRef}
      role="group"
      aria-label={`Your hand, ${cards.length} ${cards.length === 1 ? 'card' : 'cards'}`}
      className={
        compact
          ? 'snap-strip flex w-full items-end gap-2 overflow-x-auto px-[38%] pt-6 pb-5'
          : 'flex w-full items-end justify-center px-4 pb-9'
      }
      style={compact ? undefined : { height: STRIP }}
    >
      {cards.map((card, index) => {
        const canPlay = playable.includes(card.id);
        const canJump = jumpIn.includes(card.id);
        const live = canPlay || canJump;
        const isSelected = index === selected;
        const offset = index - middle;
        // Normalised so the arc is the same depth whether you hold three
        // cards or twenty — otherwise a big hand hangs off the screen.
        const across = middle > 0 ? offset / middle : 0;
        const arc = compact ? 0 : Math.abs(across) ** 1.8 * ARC_DEPTH;

        return (
          <motion.button
            key={card.id}
            layout={!dealing}
            initial={dealing ? { y: 160, opacity: 0, rotate: 0 } : false}
            animate={{
              y: arc - (isSelected ? 24 : live ? 8 : 0),
              // Dimming has to live here rather than in a class: Motion writes
              // opacity inline, and inline always wins.
              opacity: live ? 1 : 0.42,
              rotate: compact ? 0 : offset * step,
              scale: isSelected ? 1.06 : 1,
            }}
            transition={{
              duration: 0.3,
              ease: [0.2, 0.9, 0.24, 1],
              delay: dealing ? Math.min(index * 0.045, 0.5) : 0,
            }}
            style={{
              marginInline: compact ? 0 : -overlap,
              zIndex: isSelected ? 50 : index,
              transformOrigin: 'bottom center',
              width: CARD_WIDTH,
            }}
            className={`shrink-0 rounded-xl ${live ? 'card-shadow-lift' : 'card-shadow'} ${
              isSelected ? 'ring-2 ring-chalk ring-offset-2 ring-offset-transparent' : ''
            }`}
            onMouseEnter={() => onSelect(index)}
            onFocus={() => onSelect(index)}
            onClick={() => {
              onSelect(index);
              if (live) onPlay(card.id);
              else onRefuse(card);
            }}
            aria-label={`${cardLabel(card)}${canJump ? ', can jump in' : live ? '' : ', not playable'}`}
            aria-disabled={!live}
          >
            <span
              className="block transition-[filter] duration-200"
              style={{
                filter: live
                  ? 'drop-shadow(0 0 9px color-mix(in oklab, var(--live) 45%, transparent))'
                  : 'saturate(0.5)',
              }}
            >
              <CardFace card={card} colorblind={colorblind} className="w-full" />
            </span>
          </motion.button>
        );
      })}

      {cards.length === 0 && (
        <p className="py-8 text-sm text-chalk-faint">Your hand is empty.</p>
      )}
    </div>
  );
}
