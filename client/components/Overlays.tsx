/**
 * The three moments the game stops and waits for you: naming a colour,
 * choosing who to swap hands with, and looking at a hand you challenged.
 */

import { useRef } from 'react';
import { motion } from 'framer-motion';
import { CardFace, ColorGlyph } from './Card';
import { CARD_COLORS } from '../lib/colors';
import { Avatar } from './Avatar';
import type { Card, Color, PublicPlayer } from '../../shared/types';
import { COLORS } from '../../shared/types';
import { colorLabel } from '../../shared/deck';
import { useModalFocus } from '../lib/modalFocus';

function Sheet({ children, label, disabled = false }: { children: React.ReactNode; label: string; disabled?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useModalFocus(ref);
  return (
    <motion.div
      ref={ref}
      tabIndex={-1}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      className="fixed inset-0 z-40 flex items-end justify-center bg-felt-deep/80 p-4 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={label}
    >
      <motion.div
        initial={{ y: 24, scale: 0.98 }}
        animate={{ y: 0, scale: 1 }}
        transition={{ duration: 0.24, ease: [0.2, 0.9, 0.24, 1] }}
        className="w-full max-w-sm rounded-2xl border border-edge bg-raised p-5 shadow-2xl"
      >
        {disabled && <p role="status" className="mb-3 text-sm text-uno-yellow">Reconnecting. Choices will return shortly.</p>}
        {children}
      </motion.div>
    </motion.div>
  );
}

export function ColorPicker({
  colorblind,
  onPick,
  disabled,
}: {
  colorblind: boolean;
  onPick: (color: Color) => void;
  disabled?: boolean;
}) {
  return (
    <Sheet label="Choose a colour" disabled={disabled}>
      <h2 className="display mb-1 text-xl">Name a colour</h2>
      <p className="mb-4 text-sm text-chalk-dim">Play carries on in whichever you pick.</p>
      <div className="grid grid-cols-2 gap-3">
        {COLORS.map((color, index) => (
          <motion.button
            key={color}
            disabled={disabled}
            onClick={() => onPick(color)}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.035, duration: 0.2 }}
            className="flex items-center justify-center gap-2 rounded-xl py-6 text-base font-bold text-white transition hover:brightness-110"
            style={{ background: CARD_COLORS[color] }}
          >
            {colorblind && (
              <svg viewBox="-9 -9 18 18" className="h-4 w-4" aria-hidden="true">
                <ColorGlyph color={color} size={15} fill="#ffffff" />
              </svg>
            )}
            {colorLabel(color)}
          </motion.button>
        ))}
      </div>
    </Sheet>
  );
}

export function SwapPicker({
  players,
  onPick,
  disabled,
}: {
  players: PublicPlayer[];
  onPick: (playerId: string) => void;
  disabled?: boolean;
}) {
  return (
    <Sheet label="Choose a player to swap hands with" disabled={disabled}>
      <h2 className="display mb-1 text-xl">Swap hands with</h2>
      <p className="mb-4 text-sm text-chalk-dim">You take theirs, they take yours.</p>
      <ul className="space-y-2">
        {players.map((player) => (
          <li key={player.id}>
            <button
              disabled={disabled}
              onClick={() => onPick(player.id)}
              className="flex w-full items-center gap-3 rounded-xl border border-edge px-3 py-2.5 text-left transition hover:border-chalk-faint"
            >
              <Avatar index={player.avatar} size={34} />
              <span className="min-w-0 flex-1 truncate font-semibold text-chalk">{player.name}</span>
              <span className="tabular text-sm text-chalk-dim">{player.handCount} cards</span>
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

export function HandReveal({
  name,
  hand,
  colorblind,
  onClose,
}: {
  name: string;
  hand: Card[];
  colorblind: boolean;
  onClose: () => void;
}) {
  return (
    <Sheet label={`${name}'s hand`}>
      <h2 className="display mb-1 text-xl">{name}&rsquo;s hand</h2>
      <p className="mb-4 text-sm text-chalk-dim">Only you are seeing this.</p>
      <div className="mb-4 flex flex-wrap justify-center gap-1.5">
        {hand.map((card) => (
          <CardFace key={card.id} card={card} colorblind={colorblind} className="w-12" />
        ))}
        {hand.length === 0 && <p className="text-sm text-chalk-faint">Nothing left.</p>}
      </div>
      <button
        onClick={onClose}
        className="w-full rounded-xl border border-edge py-3 font-semibold text-chalk transition hover:border-chalk-faint"
      >
        Close
      </button>
    </Sheet>
  );
}
