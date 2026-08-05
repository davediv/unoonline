Build a complete, polished, real-time multiplayer UNO game for the browser, deployed entirely on Cloudflare. Friends join with a room code and play live. This is a private project for me and my friends, not a published product. I want a finished thing, not a prototype: no TODOs, no stubbed functions, no placeholder assets.

### 1. Architecture (Cloudflare-native)

- **One Worker** serves everything: the static client via the **Workers Assets** binding, plus the `/api/*` and `/ws` routes. Single `wrangler deploy`, single origin, no CORS.
- **One Durable Object instance per room.** `env.ROOM.idFromName(roomCode)` — the DO *is* the game. It owns the deck, the shuffle, every player's hand, and the turn order. All game state lives in DO memory, persisted to DO storage after each mutation so a DO eviction mid-game doesn't lose the round.
- **Native WebSockets, not Socket.IO** (Socket.IO does not run on Workers). Use `WebSocketPair` in the DO and the **WebSocket Hibernation API** — `state.acceptWebSocket(server, [tags])` with `webSocketMessage`, `webSocketClose`, `webSocketError` handlers — so an idle room costs nothing while players are thinking. Attach each socket's `playerId` as a serialized attachment so identity survives hibernation.
- **DO Alarms, not `setTimeout`.** Timers won't survive hibernation. Use `state.storage.setAlarm()` for the turn clock, the UNO catch window, bot move delays, and room cleanup (delete the room 10 minutes after the last player leaves). Keep a single "next deadline" alarm and re-arm it on wake.
- **The DO is fully authoritative.** Clients send *intents* only — `PLAY_CARD`, `DRAW`, `CALL_UNO`, `CATCH_UNO`, `CHOOSE_COLOR`, `CHALLENGE`. The DO validates every one against current state and ignores or rejects anything illegal. Never trust a client for legality, turn order, or randomness.
- **Anti-cheat, non-negotiable:** the DO never sends a hand to anyone but its owner. Build a `serializeFor(playerId)` function that returns your own hand in full and only `handCount` for everyone else, and route *every* broadcast through it. Shuffle with `crypto.getRandomValues` (Fisher–Yates), never `Math.random`.
- **Client:** React + TypeScript + Vite + Tailwind CSS, Framer Motion for animation. Built to `dist/` and served by the Assets binding.
- **Rules engine is a pure, dependency-free TypeScript module** in `/shared` — Web-standard APIs only, no Node built-ins — imported by both the DO and the test suite. Types shared by client and server live here too so they can't drift.
- Layout: `/client`, `/worker`, `/shared`, root `wrangler.jsonc`. `npm run dev` runs `wrangler dev` with the Vite client proxied so hot reload works against a local DO.

### 2. Deck (108 cards — get this exactly right)

Four colors (red, yellow, green, blue), each containing:
- One `0`, two each of `1`–`9` (19 cards)
- Two Skip, two Reverse, two Draw Two (6 cards)

25 per color = 100, plus 4 Wild and 4 Wild Draw Four = **108 total**. Assert this in a unit test.

### 3. Rules engine (implement all of it)

**Setup:** deal 7 cards each; flip the top card to start the discard pile. If the flip is a Wild Draw Four, return it to the deck, reshuffle, flip again. If it's a Wild, the first player chooses the color. If Skip, the first player is skipped. If Reverse, direction flips and play starts the other way around. If Draw Two, the first player draws 2 and is skipped.

**Playability:** a card is legal if it matches the active color, matches the top card's number/symbol, or is a Wild.

**Turn flow:** play one legal card, or draw one from the deck. If the drawn card is playable the player may immediately play it or keep it and end the turn.

**Action cards:**
- *Skip* — next player loses their turn.
- *Reverse* — flips direction. **With exactly 2 players, Reverse acts as a Skip** (the player goes again).
- *Draw Two* — next player draws 2 and forfeits their turn.
- *Wild* — player chooses the active color.
- *Wild Draw Four* — player chooses the color; next player draws 4 and is skipped. Legal to play only if the player holds no card matching the **current active color** (Wilds and number matches don't count).

**Challenge rule (toggleable, default ON):** the target of a Wild Draw Four may challenge. The DO reveals the challenged hand *to the challenger only*. Illegal play → the player who played it draws 4 instead. Legal play → the challenger draws 6.

**Deck exhaustion:** when the draw pile empties, keep the top discard and reshuffle the rest of the discard pile into a new draw pile. If both are empty and a player must draw, they draw nothing and play continues.

**Calling UNO:** on playing their second-to-last card, a player must hit the UNO button within a 3-second window (DO alarm). Any opponent may hit "Catch!" during that window — a successful catch forces 2 penalty cards, a false accusation costs the accuser 2. Resolve the race server-side by message arrival order in the DO; the DO is single-threaded, so first message wins cleanly.

**Round & match end:** a round ends when a hand empties. That player scores all opponents' remaining cards — numbers at face value, Skip/Reverse/Draw Two at 20, Wild/Wild Draw Four at 50. First to 500 wins the match. A "single round" mode is selectable in the lobby.

**House-rule toggles in the lobby** (host-only, all default OFF unless noted):
- **Stacking** — Draw Two on Draw Two and Wild Draw Four on Wild Draw Four, accumulating down the line.
- **Jump-in** — any player holding an exact match (same color *and* value) may play it out of turn; play resumes from them.
- **7-0** — a 7 swaps hands with a chosen player, a 0 rotates all hands in the direction of play.
- **Draw-to-match** — keep drawing until you draw something playable.
- **Challenge rule** — ON.
- **Turn timer** — off / 15s / 30s / 60s. On alarm expiry the DO auto-draws and passes.

### 4. Screens & UX

**Landing:** logo, "Create Room" and "Join Room" (6-character code, uppercase, no ambiguous `0/O/1/I`), nickname field with a random funny default, avatar picker (12 code-generated SVG avatars).

**Lobby:** shareable room link with copy button, player list with ready toggles, host badge, rule toggles editable by host only, "Add Bot" button, Start disabled below 2 players.

**Table — this is where the polish lives:** opponents arranged around the top and sides with avatar, name, fanned card backs and a live count, plus a glowing ring and countdown arc on whoever's turn it is. Your hand fanned along the bottom: playable cards raised and softly glowing, unplayable ones dimmed and non-clickable. Center holds the draw pile with its remaining count, the discard pile, a large active-color indicator that tints the whole table, and a direction arrow that animates on Reverse. UNO and Catch buttons appear contextually.

**Post-round:** scoreboard revealing every remaining hand, points scored this round, running match totals, "Next Round" ready-check.

### 5. Bots

Three difficulties, running inside the DO, driven by alarms with a randomized 1–2.5s "thinking" delay so a room of two humans still feels full.
- *Easy:* random legal move.
- *Normal:* prefers action cards against the next player, hoards Wilds, picks its most-held color.
- *Hard:* counts discarded cards, tracks which colors opponents have passed on, dumps high-value cards when someone is close to going out, times its Wild Draw Four.

Bots call UNO reliably and catch missed UNOs on Normal and Hard.

### 6. Polish requirements

- **Animation:** staggered card flight on the deal, an arcing play to the discard pile with slight rotation, opponents' cards flying to their avatars, a pulse when the active color changes, confetti on a round win. Nothing over 400ms — it has to stay fast.
- **Sound:** card slide, flip, shuffle, skip whoosh, draw-four thud, UNO call, victory sting. Web Audio API or CC0 assets. Mute toggle persisted in `localStorage`.
- **Cards:** original SVGs drawn in code — bold color fields, white oval, thick numerals, high-contrast symbols.
- **Responsive:** fully playable on a phone in portrait. Narrow screens turn the hand into a horizontally scrollable snap strip and collapse opponents into compact avatar chips.
- **Accessibility:** every card exposes color *and* symbol as text, a colorblind mode adds a shape glyph per color, full keyboard play (arrows to select, Enter to play, D to draw, U for UNO), visible focus rings, `prefers-reduced-motion` disables the flight animations.
- **Chat** with a 6-emote quick bar, plus system messages narrating each move ("Maya played Red 7", "Sam was skipped").
- **Reconnection:** a dropped client rejoins its seat within 60s using a session token in `sessionStorage` and gets a full state snapshot. Past that, a bot takes over the seat for the rest of the round.
- **Spectators:** anyone joining mid-game watches with all hands hidden.
- **Errors:** friendly toasts for bad room code, room full, game already started, connection lost with auto-retry and backoff. Never a raw stack trace, never a silent failure.

### 7. Cloudflare config & delivery

- `wrangler.jsonc` with the Assets binding, the Durable Object binding, and a `migrations` entry using **`new_sqlite_classes`** for the Room class (required on the free plan).
- `compatibility_date` set to something recent with `nodejs_compat` only if actually needed — prefer Web-standard APIs so it isn't.
- A `README.md` covering local dev, `wrangler deploy`, and how to attach a custom domain.
- Vitest unit tests on the rules engine covering: 108-card deck composition, Reverse with 2 players, Wild Draw Four legality plus both challenge outcomes, reshuffle on deck exhaustion, stacking math, jump-in ordering, the UNO catch race, and scoring totals. Use `@cloudflare/vitest-pool-workers` for the DO integration tests.

Work in this order: shared types → rules engine with its tests passing → the Durable Object and WebSocket protocol → client screens → animation, sound, accessibility. **Show me the rules engine and its passing tests before you build any UI** so I can verify the logic first.
