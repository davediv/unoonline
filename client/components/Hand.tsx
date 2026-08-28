/**
 * Your hand.
 *
 * Fanned along the bottom on anything with room, and a thumb-through snap
 * strip on a phone. Playable cards sit up and catch the live colour;
 * everything else is dimmed — but still clickable, because being told *why*
 * a card will not go is more useful than a dead rectangle.
 */

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { CardFace } from './Card';
import type { Card } from '../../shared/types';
import { cardLabel } from '../../shared/deck';

interface HandProps {
  /** Already in the order it should be drawn in. */
  cards: Card[];
  playable: string[];
  jumpIn: string[];
  compact: boolean;
  colorblind: boolean;
  dealing: boolean;
  onPlay: (cardId: string) => void;
  onRefuse: (card: Card) => void;
}

const CARD_WIDTH = 76;
const MIN_GAP = 26;
/** How far the outermost card hangs below the middle of the fan. */
const ARC_DEPTH = 16;
/** The strip the hand always occupies, so the table above it never shifts. */
const STRIP = 198;

export const Hand = memo(function Hand({
  cards,
  playable,
  jumpIn,
  compact,
  colorblind,
  dealing,
  onPlay,
  onRefuse,
}: HandProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const [selectedRaw, setSelected] = useState(0);
  const selected = Math.min(selectedRaw, Math.max(0, cards.length - 1));
  const playableIds = useMemo(() => new Set(playable), [playable]);
  const jumpInIds = useMemo(() => new Set(jumpIn), [jumpIn]);

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

  // Keeping selection here means hovering or arrowing through a hand does not
  // reconcile the table, opponents, piles, chat, and overlays around it.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const element = event.target as HTMLElement | null;
      if (element?.tagName === 'INPUT' || element?.tagName === 'TEXTAREA') return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      switch (event.key) {
        case 'ArrowRight':
          event.preventDefault();
          setSelected(Math.min(Math.max(0, cards.length - 1), selected + 1));
          break;
        case 'ArrowLeft':
          event.preventDefault();
          setSelected(Math.max(0, selected - 1));
          break;
        case 'Enter':
        case ' ': {
          if (element?.tagName === 'BUTTON' && !containerRef.current?.contains(element)) return;
          const card = cards[selected];
          if (!card) return;
          event.preventDefault();
          if (playableIds.has(card.id) || jumpInIds.has(card.id)) onPlay(card.id);
          else onRefuse(card);
          break;
        }
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cards, jumpInIds, onPlay, onRefuse, playableIds, selected]);

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
        const canPlay = playableIds.has(card.id);
        const canJump = jumpInIds.has(card.id);
        const live = canPlay || canJump;
        const isSelected = index === selected;
        const offset = index - middle;
        // Normalised so the arc is the same depth whether you hold three
        // cards or twenty — otherwise a big hand hangs off the screen.
        const across = middle > 0 ? offset / middle : 0;
        const arc = compact ? 0 : Math.abs(across) ** 1.8 * ARC_DEPTH;

        return (
          <HandCard
            key={card.id}
            card={card}
            index={index}
            canJump={canJump}
            live={live}
            selected={isSelected}
            compact={compact}
            colorblind={colorblind}
            dealing={dealing}
            arc={arc}
            rotation={compact ? 0 : offset * step}
            overlap={overlap}
            onSelect={setSelected}
            onPlay={onPlay}
            onRefuse={onRefuse}
          />
        );
      })}

      {cards.length === 0 && (
        <p className="py-8 text-sm text-chalk-faint">Your hand is empty.</p>
      )}
    </div>
  );
});

interface HandCardProps {
  card: Card;
  index: number;
  canJump: boolean;
  live: boolean;
  selected: boolean;
  compact: boolean;
  colorblind: boolean;
  dealing: boolean;
  arc: number;
  rotation: number;
  overlap: number;
  onSelect: (index: number) => void;
  onPlay: (cardId: string) => void;
  onRefuse: (card: Card) => void;
}

/** On selection changes React only revisits the old and new active cards. */
const HandCard = memo(
  function HandCard({
    card,
    index,
    canJump,
    live,
    selected,
    compact,
    colorblind,
    dealing,
    arc,
    rotation,
    overlap,
    onSelect,
    onPlay,
    onRefuse,
  }: HandCardProps) {
    return (
      <motion.button
        layout={dealing ? false : 'position'}
        initial={dealing ? { y: 160, opacity: 0, rotate: 0 } : false}
        animate={{
          y: arc - (selected ? 24 : live ? 8 : 0),
          // Dimming has to live here rather than in a class: Motion writes
          // opacity inline, and inline always wins.
          opacity: live ? 1 : 0.42,
          rotate: rotation,
          scale: selected ? 1.06 : 1,
        }}
        transition={{
          duration: 0.3,
          ease: [0.2, 0.9, 0.24, 1],
          delay: dealing ? Math.min(index * 0.045, 0.5) : 0,
        }}
        style={{
          marginInline: compact ? 0 : -overlap,
          zIndex: selected ? 50 : index,
          transformOrigin: 'bottom center',
          width: CARD_WIDTH,
        }}
        className={`shrink-0 rounded-xl ${live ? 'card-shadow-live' : 'card-shadow'} ${
          selected ? 'ring-2 ring-chalk ring-offset-2 ring-offset-transparent' : ''
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
        <span className="block">
          <CardFace card={card} colorblind={colorblind} className="w-full" />
        </span>
      </motion.button>
    );
  },
  (previous, next) =>
    previous.card.id === next.card.id &&
    previous.card.kind === next.card.kind &&
    previous.card.color === next.card.color &&
    previous.card.digit === next.card.digit &&
    previous.index === next.index &&
    previous.canJump === next.canJump &&
    previous.live === next.live &&
    previous.selected === next.selected &&
    previous.compact === next.compact &&
    previous.colorblind === next.colorblind &&
    previous.dealing === next.dealing &&
    previous.arc === next.arc &&
    previous.rotation === next.rotation &&
    previous.overlap === next.overlap &&
    previous.onSelect === next.onSelect &&
    previous.onPlay === next.onPlay &&
    previous.onRefuse === next.onRefuse,
);
