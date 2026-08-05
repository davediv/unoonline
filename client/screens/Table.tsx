/**
 * The table.
 *
 * Everything here is drawn from the last snapshot the Durable Object sent —
 * the client never decides what is legal, it just draws `room.moves`. The
 * events that came with the snapshot drive sound and the card flights.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { CardBack } from '../components/Card';
import { CARD_COLORS } from '../lib/colors';
import { Opponents } from '../components/Opponents';
import { CenterPiles } from '../components/CenterPiles';
import { Hand } from '../components/Hand';
import { ColorPicker, HandReveal, SwapPicker } from '../components/Overlays';
import { Scoreboard } from '../components/Scoreboard';
import { Chat } from '../components/Chat';
import { ChatIcon, ShapesIcon, SortIcon, SoundOffIcon, SoundOnIcon } from '../components/Icons';
import type { Card, Color, GameEvent, PublicRoom } from '../../shared/types';
import { sortHand } from '../../shared/deck';
import type { ChatMessage, ClientMessage } from '../../shared/protocol';
import { usePrefs } from '../lib/prefsContext';
import { useMediaQuery, useTicker } from '../lib/hooks';
import { play, setMuted, unlockAudio } from '../lib/sound';
import { burstConfetti } from '../lib/confetti';

interface TableProps {
  room: PublicRoom;
  youId: string | null;
  spectator: boolean;
  chat: ChatMessage[];
  events: GameEvent[];
  eventSeq: number;
  clockSkew: number;
  connectionNote: string | null;
  send: (message: ClientMessage) => void;
  onLeave: () => void;
}

interface Flight {
  id: number;
  from: DOMRect;
  to: DOMRect;
  delay: number;
}

let flightId = 0;

export function Table({
  room,
  youId,
  spectator,
  chat,
  events,
  eventSeq,
  clockSkew,
  connectionNote,
  send,
  onLeave,
}: TableProps) {
  const { prefs, update } = usePrefs();
  const reduced = useReducedMotion();
  const compact = !useMediaQuery('(min-width: 640px)');

  const [selectedRaw, setSelected] = useState(0);
  const [chatOpen, setChatOpen] = useState(false);
  const [seenChat, setSeenChat] = useState(0);
  const [reveal, setReveal] = useState<{ name: string; hand: Card[] } | null>(null);
  const [flights, setFlights] = useState<Flight[]>([]);
  const [dealing, setDealing] = useState(false);

  const seatEls = useRef(new Map<string, HTMLElement>());
  const deckEl = useRef<HTMLElement | null>(null);
  const handEl = useRef<HTMLDivElement | null>(null);

  const you = room.players.find((player) => player.id === youId) ?? null;
  const hand = useMemo(() => you?.hand ?? [], [you]);
  const ordered = useMemo(
    () => (prefs.sortHand ? sortHand(hand) : hand),
    [hand, prefs.sortHand],
  );
  // Clamped here rather than in an effect, so it can never point past the end.
  const selected = Math.min(selectedRaw, Math.max(0, ordered.length - 1));
  const moves = room.moves;
  const live = room.activeColor ? CARD_COLORS[room.activeColor] : '#5b6472';

  const timing = room.turnDeadline !== null;
  const tick = useTicker(timing, 100);
  const now = tick + clockSkew;

  const onTurn = you !== null && room.players[room.turn]?.id === youId;
  const owed = room.drawStack?.count ?? 0;

  /* ---------------------------------------------------------------- *
   * Events: sound, card flights, confetti
   * ---------------------------------------------------------------- */

  const spawnFlight = useCallback(
    (from: HTMLElement | null, to: HTMLElement | null, count: number) => {
      if (!from || !to || reduced) return;
      const fromBox = from.getBoundingClientRect();
      const toBox = to.getBoundingClientRect();
      const bits: Flight[] = [];
      for (let index = 0; index < Math.min(count, 4); index++) {
        bits.push({ id: ++flightId, from: fromBox, to: toBox, delay: index * 0.06 });
      }
      setFlights((current) => [...current, ...bits]);
    },
    [reduced],
  );

  useEffect(() => {
    if (eventSeq === 0) return;
    // Events arrive from the socket, which is exactly the external-system
    // case effects are for; the state updates below are the point of it.
    /* eslint-disable react-hooks/set-state-in-effect */
    for (const event of events) {
      switch (event.t) {
        case 'roundStart':
          play('shuffle');
          setDealing(true);
          window.setTimeout(() => setDealing(false), 900);
          break;

        case 'played': {
          play('slide');
          if (event.card.kind === 'skip' || event.card.kind === 'reverse') play('skip');
          if (event.card.kind === 'draw2' || event.card.kind === 'wild4') play('drawFour');
          break;
        }

        case 'drew': {
          play('flip');
          const target =
            event.playerId === youId ? handEl.current : (seatEls.current.get(event.playerId) ?? null);
          spawnFlight(deckEl.current, target, event.count);
          break;
        }

        case 'penalty': {
          const target =
            event.playerId === youId ? handEl.current : (seatEls.current.get(event.playerId) ?? null);
          spawnFlight(deckEl.current, target, event.count);
          break;
        }

        case 'skipped':
          play('skip');
          break;

        case 'reshuffled':
          play('shuffle');
          break;

        case 'unoCalled':
          play('uno');
          break;

        case 'unoCaught':
        case 'falseAccusation':
          play('deny');
          break;

        case 'challenged':
          play('drawFour');
          break;

        case 'handRevealed': {
          const owner = room.players.find((player) => player.id === event.playerId);
          setReveal({ name: owner?.name ?? 'They', hand: event.hand });
          break;
        }

        case 'roundOver':
          play('victory');
          if (event.result.winnerId === youId) burstConfetti();
          break;

        case 'turnStart':
          if (event.playerId === youId) play('tick');
          break;

        case 'playerJoined':
        case 'playerReconnected':
          play('join');
          break;

        default:
          break;
      }
    }
    /* eslint-enable react-hooks/set-state-in-effect */
    // Events are a stream keyed by `eventSeq`; re-running on room identity
    // would replay them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventSeq]);

  useEffect(() => {
    setMuted(prefs.muted);
  }, [prefs.muted]);

  // Unread is derived, and marked read when the panel is opened or closed —
  // no effect needed, and it cannot drift out of step with the list.
  const said = useMemo(() => chat.filter((message) => message.kind !== 'system').length, [chat]);
  const unread = chatOpen ? 0 : Math.max(0, said - seenChat);
  const setChatVisible = useCallback(
    (open: boolean) => {
      setSeenChat(said);
      setChatOpen(open);
    },
    [said],
  );

  /* ---------------------------------------------------------------- *
   * Actions
   * ---------------------------------------------------------------- */

  const act = useCallback(
    (message: ClientMessage) => {
      unlockAudio();
      send(message);
    },
    [send],
  );

  const playCard = useCallback(
    (cardId: string) => {
      const declareUno = hand.length === 2;
      act({ t: 'intent', intent: { type: 'PLAY_CARD', cardId, declareUno } });
    },
    [act, hand.length],
  );

  const refuse = useCallback((card: Card) => {
    play('deny');
    void card;
  }, []);

  /* ---------------------------------------------------------------- *
   * Keyboard play
   * ---------------------------------------------------------------- */

  useEffect(() => {
    const isTyping = (target: EventTarget | null) => {
      const element = target as HTMLElement | null;
      return element?.tagName === 'INPUT' || element?.tagName === 'TEXTAREA';
    };

    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event.target)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      switch (event.key) {
        case 'ArrowRight':
          event.preventDefault();
          setSelected((current) => Math.min(ordered.length - 1, current + 1));
          break;
        case 'ArrowLeft':
          event.preventDefault();
          setSelected((current) => Math.max(0, current - 1));
          break;
        case 'Enter':
        case ' ': {
          const card = ordered[selected];
          if (!card) return;
          event.preventDefault();
          if (moves.playable.includes(card.id) || moves.jumpIn.includes(card.id)) playCard(card.id);
          else refuse(card);
          break;
        }
        case 'd':
        case 'D':
          if (moves.canDraw) {
            event.preventDefault();
            act({ t: 'intent', intent: { type: 'DRAW' } });
          }
          break;
        case 'u':
        case 'U':
          if (moves.canCallUno) {
            event.preventDefault();
            act({ t: 'intent', intent: { type: 'CALL_UNO' } });
          }
          break;
        case 'c':
        case 'C':
          if (moves.catchTargetId) {
            event.preventDefault();
            act({ t: 'intent', intent: { type: 'CATCH_UNO', targetId: moves.catchTargetId } });
          }
          break;
        case 'Escape':
          setReveal(null);
          setChatVisible(false);
          break;
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ordered, selected, moves, act, playCard, refuse, setChatVisible]);

  /* ---------------------------------------------------------------- *
   * Render
   * ---------------------------------------------------------------- */

  const showScoreboard = room.phase === 'roundOver' || room.phase === 'matchOver';
  const secondsLeft =
    room.turnDeadline !== null ? Math.max(0, Math.ceil((room.turnDeadline - now) / 1000)) : null;

  return (
    <div
      className={`table-felt relative flex h-dvh w-full flex-col overflow-hidden transition-[padding] duration-200 ${
        chatOpen ? 'sm:pr-80' : ''
      }`}
      style={{ ['--live' as string]: live }}
    >
      {/* Top rail */}
      <header className="flex shrink-0 items-center gap-2 px-3 py-2 sm:px-4">
        <span className="tabular rounded-lg border border-edge bg-raised/70 px-2.5 py-1 text-sm tracking-[0.2em] text-chalk">
          {room.code}
        </span>
        {room.rules.matchMode === 'match' && (
          <span className="tabular hidden text-xs text-chalk-faint sm:inline">to {room.rules.targetScore}</span>
        )}
        {connectionNote && (
          <span className="rounded-lg border border-uno-yellow/40 px-2 py-1 text-xs text-uno-yellow">
            {connectionNote}
          </span>
        )}
        {spectator && (
          <span className="rounded-lg border border-edge px-2 py-1 text-xs text-chalk-dim">Watching</span>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          <RailButton
            label={prefs.muted ? 'Turn sound on' : 'Turn sound off'}
            onClick={() => {
              unlockAudio();
              update({ muted: !prefs.muted });
            }}
          >
            {prefs.muted ? <SoundOffIcon /> : <SoundOnIcon />}
          </RailButton>
          <RailButton
            label={prefs.colorblind ? 'Turn colour shapes off' : 'Turn colour shapes on'}
            pressed={prefs.colorblind}
            onClick={() => update({ colorblind: !prefs.colorblind })}
          >
            <ShapesIcon />
          </RailButton>
          <RailButton
            label={prefs.sortHand ? 'Stop sorting your hand' : 'Sort your hand'}
            pressed={prefs.sortHand}
            onClick={() => update({ sortHand: !prefs.sortHand })}
          >
            <SortIcon />
          </RailButton>
          <RailButton label="Open chat" onClick={() => setChatVisible(!chatOpen)}>
            <ChatIcon />
            {unread > 0 && (
              <span className="tabular absolute -top-1 -right-1 rounded-full bg-uno-red px-1 text-[10px] text-white">
                {unread}
              </span>
            )}
          </RailButton>
          <button
            onClick={onLeave}
            className="rounded-lg border border-edge px-2.5 py-1.5 text-xs text-chalk-dim transition hover:border-chalk-faint hover:text-chalk"
          >
            Leave
          </button>
        </div>
      </header>

      {/* The far side of the table */}
      <div className="shrink-0 pt-1 pb-2">
        <Opponents
          room={room}
          youId={youId}
          now={now}
          compact={compact}
          registerSeat={(id, element) => {
            if (element) seatEls.current.set(id, element);
            else seatEls.current.delete(id);
          }}
        />
      </div>

      {/* The middle */}
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4">
        <CenterPiles
          room={room}
          colorblind={prefs.colorblind}
          canDraw={moves.canDraw && !spectator}
          onDraw={() => act({ t: 'intent', intent: { type: 'DRAW' } })}
          deckRef={(element) => {
            deckEl.current = element;
          }}
          discardRef={() => {}}
        />

        <ActionBar
          room={room}
          onTurn={onTurn}
          owed={owed}
          spectator={spectator}
          secondsLeft={secondsLeft}
          onDraw={() => act({ t: 'intent', intent: { type: 'DRAW' } })}
          onPass={() => act({ t: 'intent', intent: { type: 'PASS' } })}
          onChallenge={() => act({ t: 'intent', intent: { type: 'CHALLENGE' } })}
          onUno={() => act({ t: 'intent', intent: { type: 'CALL_UNO' } })}
          onCatch={(targetId) => act({ t: 'intent', intent: { type: 'CATCH_UNO', targetId } })}
        />
      </div>

      {/* Your hand. `isolate` keeps the lifted card's z-index inside this
          section, so it cannot float over the scoreboard or a picker. */}
      <div ref={handEl} className="isolate shrink-0">
        {you ? (
          <Hand
            cards={ordered}
            playable={moves.playable}
            jumpIn={moves.jumpIn}
            selected={selected}
            compact={compact}
            colorblind={prefs.colorblind}
            dealing={dealing && !reduced}
            onSelect={setSelected}
            onPlay={playCard}
            onRefuse={refuse}
          />
        ) : (
          <p className="py-6 text-center text-sm text-chalk-faint">
            You are watching this one. Hands stay hidden.
          </p>
        )}
      </div>

      {/* Cards in the air */}
      <FlightLayer
        flights={flights}
        onDone={(id) => setFlights((current) => current.filter((flight) => flight.id !== id))}
      />

      <AnimatePresence>
        {moves.mustChooseColor && (
          <ColorPicker
            key="colour"
            colorblind={prefs.colorblind}
            onPick={(color: Color) => act({ t: 'intent', intent: { type: 'CHOOSE_COLOR', color } })}
          />
        )}
        {moves.mustChooseSwapTarget && (
          <SwapPicker
            key="swap"
            players={room.players.filter((player) => player.id !== youId)}
            onPick={(playerId) => act({ t: 'intent', intent: { type: 'CHOOSE_PLAYER', playerId } })}
          />
        )}
        {reveal && (
          <HandReveal
            key="reveal"
            name={reveal.name}
            hand={reveal.hand}
            colorblind={prefs.colorblind}
            onClose={() => setReveal(null)}
          />
        )}
        {showScoreboard && (
          <Scoreboard
            key="scores"
            room={room}
            youId={youId}
            colorblind={prefs.colorblind}
            onNextRound={() => act({ t: 'nextRound' })}
            onNewMatch={() => act({ t: 'newMatch' })}
            onLeave={onLeave}
          />
        )}
      </AnimatePresence>

      <Chat
        messages={chat}
        open={chatOpen}
        canTalk={!spectator}
        onClose={() => setChatVisible(false)}
        onSend={(text) => act({ t: 'chat', text })}
        onEmote={(index) => act({ t: 'emote', index })}
      />
    </div>
  );
}

function RailButton({
  children,
  label,
  onClick,
  pressed,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  pressed?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      className={`relative rounded-lg border px-2.5 py-1.5 text-sm transition ${
        pressed ? 'border-chalk bg-chalk/15 text-chalk' : 'border-edge text-chalk-dim hover:border-chalk-faint'
      }`}
    >
      {children}
    </button>
  );
}

function ActionBar({
  room,
  onTurn,
  owed,
  spectator,
  secondsLeft,
  onDraw,
  onPass,
  onChallenge,
  onUno,
  onCatch,
}: {
  room: PublicRoom;
  onTurn: boolean;
  owed: number;
  spectator: boolean;
  secondsLeft: number | null;
  onDraw: () => void;
  onPass: () => void;
  onChallenge: () => void;
  onUno: () => void;
  onCatch: (targetId: string) => void;
}) {
  const moves = room.moves;
  if (spectator) return null;

  return (
    <div className="flex min-h-14 flex-wrap items-center justify-center gap-2 px-3">
      <AnimatePresence mode="popLayout">
        {moves.canCallUno && (
          <Pop key="uno">
            <button
              onClick={onUno}
              className="display rounded-xl bg-uno-red px-7 py-3 text-xl text-white shadow-lg transition hover:brightness-110"
            >
              UNO!
            </button>
          </Pop>
        )}

        {moves.catchTargetId && (
          <Pop key="catch">
            <button
              onClick={() => onCatch(moves.catchTargetId as string)}
              className="display rounded-xl bg-uno-yellow px-6 py-3 text-lg text-[#3a2600] shadow-lg transition hover:brightness-110"
            >
              Catch!
            </button>
          </Pop>
        )}

        {moves.canChallenge && (
          <Pop key="challenge">
            <button
              onClick={onChallenge}
              className="rounded-xl border border-chalk px-5 py-3 font-semibold text-chalk transition hover:bg-chalk/10"
            >
              Challenge it
            </button>
          </Pop>
        )}

        {moves.canDraw && (
          <Pop key="draw">
            <button
              onClick={onDraw}
              className="rounded-xl border border-edge bg-raised px-5 py-3 font-semibold text-chalk transition hover:border-chalk-faint"
            >
              {owed > 0 ? `Take ${owed}` : 'Draw a card'}
            </button>
          </Pop>
        )}

        {moves.canPass && (
          <Pop key="pass">
            <button
              onClick={onPass}
              className="rounded-xl border border-edge bg-raised px-5 py-3 font-semibold text-chalk transition hover:border-chalk-faint"
            >
              Keep it
            </button>
          </Pop>
        )}
      </AnimatePresence>

      {onTurn && secondsLeft !== null && (
        <span className={`tabular text-sm ${secondsLeft <= 5 ? 'text-uno-red' : 'text-chalk-dim'}`}>
          {secondsLeft}s
        </span>
      )}

      {!onTurn && !moves.canCallUno && !moves.catchTargetId && room.phase === 'playing' && (
        <span className="text-sm text-chalk-faint">
          {room.players[room.turn]?.name ?? 'Somebody'} is thinking…
        </span>
      )}
    </div>
  );
}

function Pop({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.86, y: 8 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ duration: 0.2, ease: [0.2, 0.9, 0.24, 1] }}
    >
      {children}
    </motion.div>
  );
}

/** Card backs travelling from the deck to whoever just drew. */
function FlightLayer({ flights, onDone }: { flights: Flight[]; onDone: (id: number) => void }) {
  return (
    <div className="pointer-events-none fixed inset-0 z-20" aria-hidden="true">
      {flights.map((flight) => (
        <motion.div
          key={flight.id}
          className="absolute w-14"
          initial={{
            x: flight.from.left,
            y: flight.from.top,
            opacity: 1,
            scale: 1,
            rotate: 0,
          }}
          animate={{
            x: flight.to.left + flight.to.width / 2 - 28,
            y: flight.to.top,
            opacity: 0,
            scale: 0.5,
            rotate: 22,
          }}
          transition={{ duration: 0.36, delay: flight.delay, ease: [0.2, 0.9, 0.24, 1] }}
          onAnimationComplete={() => onDone(flight.id)}
          style={{ left: 0, top: 0 }}
        >
          <CardBack className="w-full" />
        </motion.div>
      ))}
    </div>
  );
}
