/**
 * The table.
 *
 * Everything here is drawn from the last snapshot the Durable Object sent —
 * the client never decides what is legal, it just draws `room.moves`. The
 * events that came with the snapshot drive sound and the card flights.
 */

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
import type { Card, Color, GameEvent, LegalMoves, Phase, PublicRoom } from '../../shared/types';
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
  connected: boolean;
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
const ignoreElementRef = () => {};
/** How long a draw waits for the table to answer before the deck settles back. */
const DRAW_PENDING_TIMEOUT_MS = 1500;

export function Table({
  room,
  youId,
  spectator,
  chat,
  events,
  eventSeq,
  clockSkew,
  connectionNote,
  connected,
  send,
  onLeave,
}: TableProps) {
  const { prefs, update } = usePrefs();
  const reduced = useReducedMotion();
  const compact = !useMediaQuery('(min-width: 640px)');

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
  const moves = room.moves;
  const live = room.activeColor ? CARD_COLORS[room.activeColor] : '#5b6472';

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
      if (!connected) return;
      unlockAudio();
      send(message);
    },
    [connected, send],
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

  // A draw answers the tap at once as well: the deck and the button show it is
  // on its way, and further draws wait until what you can do changes (the
  // room keeps `moves` identical otherwise), or until the timeout if refused.
  const [drawSent, setDrawSent] = useState<LegalMoves | null>(null);
  const drawPending = drawSent !== null && drawSent === moves;
  useEffect(() => {
    if (!drawSent) return;
    const id = window.setTimeout(() => setDrawSent(null), DRAW_PENDING_TIMEOUT_MS);
    return () => window.clearTimeout(id);
  }, [drawSent]);
  const latestMoves = useRef({ moves, drawPending });
  useLayoutEffect(() => {
    latestMoves.current = { moves, drawPending };
  });

  const draw = useCallback(() => {
    if (!connected) return;
    const now = latestMoves.current;
    if (now.drawPending) return;
    setDrawSent(now.moves);
    act({ t: 'intent', intent: { type: 'DRAW' } });
  }, [act, connected]);
  const pass = useCallback(() => act({ t: 'intent', intent: { type: 'PASS' } }), [act]);
  const challenge = useCallback(
    () => act({ t: 'intent', intent: { type: 'CHALLENGE' } }),
    [act],
  );
  const callUno = useCallback(
    () => act({ t: 'intent', intent: { type: 'CALL_UNO' } }),
    [act],
  );
  const catchUno = useCallback(
    (targetId: string) => act({ t: 'intent', intent: { type: 'CATCH_UNO', targetId } }),
    [act],
  );
  const registerSeat = useCallback((id: string, element: HTMLElement | null) => {
    if (element) seatEls.current.set(id, element);
    else seatEls.current.delete(id);
  }, []);
  const registerDeck = useCallback((element: HTMLElement | null) => {
    deckEl.current = element;
  }, []);
  const finishFlight = useCallback((id: number) => {
    setFlights((current) => current.filter((flight) => flight.id !== id));
  }, []);
  const closeChat = useCallback(() => setChatVisible(false), [setChatVisible]);
  const sendChat = useCallback((text: string) => act({ t: 'chat', text }), [act]);
  const sendEmote = useCallback((index: number) => act({ t: 'emote', index }), [act]);

  /* ---------------------------------------------------------------- *
   * Keyboard play
   * ---------------------------------------------------------------- */

  useEffect(() => {
    const isTyping = (target: EventTarget | null) => {
      const element = target as HTMLElement | null;
      return element?.tagName === 'INPUT' || element?.tagName === 'TEXTAREA';
    };

    const onKey = (event: KeyboardEvent) => {
      if (document.querySelector('[aria-modal="true"]') && event.key !== 'Escape') return;
      if (isTyping(event.target)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      switch (event.key) {
        case 'd':
        case 'D':
          if (moves.canDraw) {
            event.preventDefault();
            draw();
          }
          break;
        case 'u':
        case 'U':
          if (moves.canCallUno) {
            event.preventDefault();
            callUno();
          }
          break;
        case 'c':
        case 'C':
          if (moves.catchTargetId) {
            event.preventDefault();
            catchUno(moves.catchTargetId);
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
  }, [moves, draw, callUno, catchUno, setChatVisible]);

  /* ---------------------------------------------------------------- *
   * Render
   * ---------------------------------------------------------------- */

  const showScoreboard = room.phase === 'roundOver' || room.phase === 'matchOver';
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
          players={room.players}
          turn={room.turn}
          pendingPlayerId={room.pending?.playerId ?? null}
          uno={room.uno}
          turnDeadline={room.turnDeadline}
          turnTimer={room.rules.turnTimer}
          phase={room.phase}
          youId={youId}
          clockSkew={clockSkew}
          compact={compact}
          registerSeat={registerSeat}
        />
      </div>

      {/* The middle */}
      <div inert={!connected} className={`flex min-h-0 flex-1 flex-col items-center justify-center gap-4 ${connected ? '' : 'opacity-55'}`}>
        <CenterPiles
          discardTop={room.discardTop}
          drawCount={room.drawCount}
          activeColor={room.activeColor}
          direction={room.direction}
          colorblind={prefs.colorblind}
          canDraw={moves.canDraw && !spectator}
          drawPending={drawPending}
          onDraw={draw}
          deckRef={registerDeck}
          discardRef={ignoreElementRef}
        />

        <ActionBar
          moves={moves}
          phase={room.phase}
          thinkingName={room.players[room.turn]?.name ?? 'Somebody'}
          onTurn={onTurn}
          owed={owed}
          drawPending={drawPending}
          spectator={spectator}
          turnDeadline={room.turnDeadline}
          clockSkew={clockSkew}
          onDraw={draw}
          onPass={pass}
          onChallenge={challenge}
          onUno={callUno}
          onCatch={catchUno}
        />
      </div>

      {/* Your hand. `isolate` keeps the lifted card's z-index inside this
          section, so it cannot float over the scoreboard or a picker. */}
      <div ref={handEl} inert={!connected} className={`isolate shrink-0 ${connected ? '' : 'opacity-55'}`}>
        {you ? (
          <Hand
            cards={ordered}
            playable={moves.playable}
            jumpIn={moves.jumpIn}
            compact={compact}
            colorblind={prefs.colorblind}
            dealing={dealing && !reduced}
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
        onDone={finishFlight}
      />

      <AnimatePresence>
        {moves.mustChooseColor && (
          <ColorPicker
            key="colour"
            colorblind={prefs.colorblind}
            disabled={!connected}
            onPick={(color: Color) => act({ t: 'intent', intent: { type: 'CHOOSE_COLOR', color } })}
          />
        )}
        {moves.mustChooseSwapTarget && (
          <SwapPicker
            key="swap"
            players={room.players.filter((player) => player.id !== youId)}
            disabled={!connected}
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
            connected={connected}
          />
        )}
      </AnimatePresence>

      <Chat
        messages={chat}
        open={chatOpen}
        canTalk={!spectator && connected}
        onClose={closeChat}
        onSend={sendChat}
        onEmote={sendEmote}
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

const ActionBar = memo(function ActionBar({
  moves,
  phase,
  thinkingName,
  onTurn,
  owed,
  drawPending,
  spectator,
  turnDeadline,
  clockSkew,
  onDraw,
  onPass,
  onChallenge,
  onUno,
  onCatch,
}: {
  moves: LegalMoves;
  phase: Phase;
  thinkingName: string;
  onTurn: boolean;
  owed: number;
  drawPending: boolean;
  spectator: boolean;
  turnDeadline: number | null;
  clockSkew: number;
  onDraw: () => void;
  onPass: () => void;
  onChallenge: () => void;
  onUno: () => void;
  onCatch: (targetId: string) => void;
}) {
  if (spectator) return null;

  const counting = onTurn && turnDeadline !== null;
  const thinking = !onTurn && !moves.canCallUno && !moves.catchTargetId && phase === 'playing';
  // The buttons share a centred row, so they only move when what is in the
  // row changes — not on every frame that re-renders the bar.
  const layoutKey = [
    moves.canCallUno,
    Boolean(moves.catchTargetId),
    moves.canChallenge,
    moves.canDraw,
    moves.canPass,
    owed,
    counting,
    thinking && thinkingName,
  ].join('|');

  return (
    <div className="flex min-h-14 flex-wrap items-center justify-center gap-2 px-3">
      <AnimatePresence mode="popLayout">
        {moves.canCallUno && (
          <Pop key="uno" layoutKey={layoutKey}>
            <button
              onClick={onUno}
              className="display rounded-xl bg-uno-red px-7 py-3 text-xl text-white shadow-lg transition hover:brightness-110"
            >
              UNO!
            </button>
          </Pop>
        )}

        {moves.catchTargetId && (
          <Pop key="catch" layoutKey={layoutKey}>
            <button
              onClick={() => onCatch(moves.catchTargetId as string)}
              className="display rounded-xl bg-uno-yellow px-6 py-3 text-lg text-[#3a2600] shadow-lg transition hover:brightness-110"
            >
              Catch!
            </button>
          </Pop>
        )}

        {moves.canChallenge && (
          <Pop key="challenge" layoutKey={layoutKey}>
            <button
              onClick={onChallenge}
              className="rounded-xl border border-chalk px-5 py-3 font-semibold text-chalk transition hover:bg-chalk/10"
            >
              Challenge it
            </button>
          </Pop>
        )}

        {moves.canDraw && (
          <Pop key="draw" layoutKey={layoutKey}>
            <button
              onClick={onDraw}
              aria-busy={drawPending || undefined}
              className={`rounded-xl border border-edge bg-raised px-5 py-3 font-semibold text-chalk transition hover:border-chalk-faint ${
                drawPending ? 'opacity-60' : ''
              }`}
            >
              {owed > 0 ? `Take ${owed}` : 'Draw a card'}
            </button>
          </Pop>
        )}

        {moves.canPass && (
          <Pop key="pass" layoutKey={layoutKey}>
            <button
              onClick={onPass}
              className="rounded-xl border border-edge bg-raised px-5 py-3 font-semibold text-chalk transition hover:border-chalk-faint"
            >
              Keep it
            </button>
          </Pop>
        )}
      </AnimatePresence>

      {counting && <TurnCountdown deadline={turnDeadline} clockSkew={clockSkew} />}

      {thinking && <span className="text-sm text-chalk-faint">{thinkingName} is thinking…</span>}
    </div>
  );
});

function TurnCountdown({ deadline, clockSkew }: { deadline: number; clockSkew: number }) {
  const now = useTicker(true, 250) + clockSkew;
  const secondsLeft = Math.max(0, Math.ceil((deadline - now) / 1000));
  return (
    <span className={`tabular text-sm ${secondsLeft <= 5 ? 'text-uno-red' : 'text-chalk-dim'}`}>
      {secondsLeft}s
    </span>
  );
}

function Pop({ children, layoutKey }: { children: React.ReactNode; layoutKey: string }) {
  return (
    <motion.div
      layout
      layoutDependency={layoutKey}
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
