/**
 * The way in.
 *
 * The hero is a real fan of the real card components — the first thing you
 * see is the thing you will be holding all game. Everything else on the
 * screen is quiet by comparison.
 */

import { memo, useEffect, useState } from 'react';
import { CardFace } from '../components/Card';
import { Avatar } from '../components/Avatar';
import { withBase } from '../../shared/base';
import {
  AVATAR_COUNT,
  CODE_ALPHABET,
  CODE_LENGTH,
  makeRoomCode,
  normalizeRoomCode,
  randomNickname,
} from '../../shared/room';
import { cryptoRng } from '../../shared/rng';
import type { Card } from '../../shared/types';
import { usePrefs } from '../lib/prefsContext';
import { play, unlockAudio } from '../lib/sound';

const HERO: Card[] = [
  { id: 'hero-1', kind: 'number', color: 'red', digit: 7 },
  { id: 'hero-2', kind: 'skip', color: 'blue', digit: null },
  { id: 'hero-3', kind: 'wild', color: null, digit: null },
  { id: 'hero-4', kind: 'reverse', color: 'green', digit: null },
  { id: 'hero-5', kind: 'draw2', color: 'yellow', digit: null },
];

interface RoomInfo {
  exists: boolean;
}

/** How long a room check made while typing is trusted when Join follows. */
const LOOKUP_TTL_MS = 30_000;

let lookedUp: { code: string; at: number; info: Promise<RoomInfo> } | null = null;

/**
 * Is there a room with this code? The answer is started as soon as the code
 * is complete and reused by Join, so the click does not wait on it. Only a
 * "yes" is kept: a code that did not exist is asked about again.
 */
function lookUpRoom(code: string): Promise<RoomInfo> {
  if (lookedUp && lookedUp.code === code && Date.now() - lookedUp.at < LOOKUP_TTL_MS) {
    return lookedUp.info;
  }
  const info = fetch(withBase(`/api/rooms/${code}`)).then(
    (response) => response.json() as Promise<RoomInfo>,
  );
  const entry = { code, at: Date.now(), info };
  lookedUp = entry;
  const forget = () => {
    if (lookedUp === entry) lookedUp = null;
  };
  info.then((answer) => {
    if (!answer.exists) forget();
  }, forget);
  return info;
}

interface LandingProps {
  onEnter: (code: string, options?: { create?: boolean }) => void;
  onPrepareRoom: () => void;
  notice?: string | null;
}

export function Landing({ onEnter, onPrepareRoom, notice }: LandingProps) {
  const { prefs, update } = usePrefs();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'join' | null>(null);
  const [problem, setProblem] = useState<string | null>(notice ?? null);
  const [pickingAvatar, setPickingAvatar] = useState(false);

  const name = prefs.name;

  // Check a complete code while the player is still reaching for Join.
  useEffect(() => {
    const clean = normalizeRoomCode(code);
    if (!clean) return;
    const id = window.setTimeout(() => {
      lookUpRoom(clean).catch(() => {
        // Join asks again and reports the failure.
      });
    }, 150);
    return () => window.clearTimeout(id);
  }, [code]);

  const ensureName = (): string => {
    if (name.trim()) return name.trim();
    const generated = randomNickname(cryptoRng);
    update({ name: generated });
    return generated;
  };

  // The room is made by the socket that joins it, so there is no request to
  // wait for here: pick a code and go. The one-in-a-billion code that is
  // already taken simply joins that room, like typing it in would.
  const createRoom = () => {
    unlockAudio();
    onPrepareRoom();
    ensureName();
    setProblem(null);
    play('join');
    onEnter(makeRoomCode(cryptoRng), { create: true });
  };

  const joinRoom = async () => {
    unlockAudio();
    const clean = normalizeRoomCode(code);
    if (!clean) {
      setProblem(`A room code is ${CODE_LENGTH} letters and numbers.`);
      return;
    }
    onPrepareRoom();
    ensureName();
    setProblem(null);
    setBusy('join');
    try {
      const info = await lookUpRoom(clean);
      if (!info.exists) {
        setProblem('No room with that code. Check the letters and try again.');
        setBusy(null);
        return;
      }
      play('join');
      onEnter(clean);
    } catch {
      setProblem('Could not reach the table. Check your connection.');
      setBusy(null);
    }
  };

  return (
    <main className="table-felt min-h-full w-full overflow-x-hidden">
      <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col items-center justify-center gap-8 px-5 py-10">
        {/* The fan: the same card components used in the game. */}
        <Hero colorblind={prefs.colorblind} />

        <header className="text-center">
          <h1 className="display text-6xl leading-none sm:text-7xl">UNO</h1>
          <p className="mt-2 text-sm text-chalk-dim">
            Make a room, send the code, play. Nothing to install.
          </p>
        </header>

        {/* Who you are at the table. */}
        <section className="w-full">
          <label htmlFor="nickname" className="mb-1.5 block text-xs font-semibold tracking-wide text-chalk-dim uppercase">
            Your name
          </label>
          <div className="flex gap-2">
            <input
              id="nickname"
              value={name}
              maxLength={16}
              placeholder={'Pick a name'}
              onChange={(event) => update({ name: event.target.value })}
              className="min-w-0 flex-1 rounded-xl border border-edge bg-raised px-4 py-3 text-base text-chalk placeholder:text-chalk-faint focus:border-chalk-dim focus:outline-none"
            />
            <button
              type="button"
              onClick={() => setPickingAvatar((open) => !open)}
              aria-expanded={pickingAvatar}
              className="flex items-center gap-2 rounded-xl border border-edge bg-raised px-3 py-2 text-sm text-chalk-dim transition hover:border-chalk-faint hover:text-chalk"
            >
              <Avatar index={prefs.avatar} size={30} />
              <span className="hidden sm:inline">Change</span>
            </button>
          </div>

          {pickingAvatar && (
            <div
              role="radiogroup"
              aria-label="Choose an avatar"
              className="rise mt-3 grid grid-cols-6 gap-2 rounded-xl border border-edge bg-raised/60 p-3"
            >
              {Array.from({ length: AVATAR_COUNT }, (_, index) => (
                <button
                  key={index}
                  role="radio"
                  aria-checked={prefs.avatar === index}
                  aria-label={`Avatar ${index + 1}`}
                  onClick={() => {
                    update({ avatar: index });
                    play('flip');
                  }}
                  className={`flex items-center justify-center rounded-lg p-1 transition ${
                    prefs.avatar === index ? 'bg-chalk/15 ring-2 ring-chalk' : 'hover:bg-chalk/5'
                  }`}
                >
                  <Avatar index={index} size={38} />
                </button>
              ))}
            </div>
          )}
        </section>

        <div className="w-full space-y-4">
          <button
            onClick={createRoom}
            disabled={busy !== null}
            className="display w-full rounded-xl bg-chalk px-5 py-4 text-lg text-felt transition hover:bg-white disabled:opacity-50"
          >
            Create room
          </button>

          <div className="flex items-center gap-3 text-xs tracking-wide text-chalk-faint uppercase">
            <span className="h-px flex-1 bg-edge" />
            or join with a code
            <span className="h-px flex-1 bg-edge" />
          </div>

          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void joinRoom();
            }}
          >
            <label htmlFor="code" className="sr-only">
              Room code
            </label>
            <input
              id="code"
              value={code}
              inputMode="text"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              maxLength={CODE_LENGTH}
              placeholder="------"
              onChange={(event) => {
                const next = event.target.value
                  .toUpperCase()
                  .split('')
                  .filter((character) => CODE_ALPHABET.includes(character))
                  .join('');
                setCode(next);
              }}
              className="tabular min-w-0 flex-1 rounded-xl border border-edge bg-raised px-4 py-3 text-center text-xl tracking-[0.4em] text-chalk uppercase placeholder:text-chalk-faint focus:border-chalk-dim focus:outline-none"
            />
            <button
              type="submit"
              disabled={busy !== null}
              className="rounded-xl border border-edge bg-raised px-5 py-3 font-semibold text-chalk transition hover:border-chalk-faint disabled:opacity-50"
            >
              {busy === 'join' ? 'Joining…' : 'Join'}
            </button>
          </form>

          {problem && (
            <p role="alert" className="rounded-lg border border-uno-red/40 bg-[#1b1216] px-3 py-2 text-sm text-chalk">
              {problem}
            </p>
          )}
        </div>

        <p className="text-center text-xs text-chalk-faint">
          Two to eight players. Add bots if you are short.
        </p>
      </div>
    </main>
  );
}

/** The decorative cards do not need to reconcile on every nickname keystroke. */
const Hero = memo(function Hero({ colorblind }: { colorblind: boolean }) {
  return (
    <div className="flex h-40 w-full items-center justify-center sm:h-52" aria-hidden="true">
      {HERO.map((card, index) => {
        const middle = (HERO.length - 1) / 2;
        const offset = index - middle;
        return (
          <div
            key={card.id}
            className="hero-card card-shadow -mx-4 w-20 rounded-xl sm:-mx-3 sm:w-24"
            style={{
              zIndex: HERO.length - Math.abs(offset),
              animationDelay: `${0.06 * index}s`,
              transform: `translateY(${Math.abs(offset) * 9}px) rotate(${offset * 9}deg)`,
            }}
          >
            <CardFace card={card} colorblind={colorblind} className="w-full" />
          </div>
        );
      })}
    </div>
  );
});
