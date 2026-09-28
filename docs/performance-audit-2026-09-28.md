# Performance Audit — 2026-09-28

*Audited on 2026-09-28 at commit `e607dca` · Scope: entire app · Mode: live (https://parebaik.com/uno/)*
*Stack: React 19.2 SPA (client-rendered), Vite 8 (Rolldown), Tailwind 4, framer-motion 13; one Cloudflare Worker serving assets through the `ASSETS` binding (`run_worker_first`) plus `/api/*` and `/ws`; one SQLite-backed Durable Object per room with WebSocket hibernation · Slow-device view: Playwright + CDP throttling (4× CPU, 150 ms RTT, 1.6 Mbps down), no Lighthouse installed*
*Previous audit: none*

Tick a box when its optimization is implemented and measured. The checkbox is the single source of truth for that item; the sections after the list only reference IDs.

**How it was measured.** Production matches the audited commit (the hashed file names served live equal a local `npm run build`). Rendered numbers come from `playwright-cli` scripts against production from Jakarta (Cloudflare colo CGK): the standard load probe, plus in-page timeline marks (WebSocket constructor/open/first message, `MutationObserver` on the loading texts and the lobby/table controls) and CDP `Performance.getMetrics` for main-thread time. Room flows use throwaway rooms that were left and clean themselves up. Medians of 3 runs unless stated. **CDP network emulation does not throttle WebSocket traffic**, so on a real slow-4G link every socket handshake is ~3 round trips (≈ 450 ms) longer than the "slow" numbers below.

## Summary

| Priority | Count |
|----------|-------|
| Critical | 1 |
| High | 4 |
| Medium | 5 |
| Low | 1 |

The landing page is already lean (68 KB gz of JS, LCP 168 ms on desktop and 812 ms on slow 4G, no long tasks), and in-game interactions stay free of long tasks even at 4× CPU. The time goes into **getting into a room**. Every create, join, cold room link and game start pays a fixed ~300 ms React Suspense hold per lazily loaded screen, even when the chunk is already downloaded. After that come a waterfall of round trips and hashed assets that are revalidated on every visit.

## Baseline

### Key Routes
| Route | TTFB | FCP | LCP | CLS | Long tasks (ms) | Requests | Transfer (KB) | Initial JS (KB gz) |
|-------|------|-----|-----|-----|-----------------|----------|---------------|--------------------|
| `/uno/`, desktop, cold | 60 ms | 168 ms | 168 ms | 0 | 0 | 10 | 79 | 68.4 |
| `/uno/`, desktop, repeat visit | 52 ms | 156 ms | 156 ms | 0 | 0 | 10 (6 × 304) | 2 | 68.4 |
| `/uno/`, slow 4G + 4× CPU, cold | 57 ms¹ | 812 ms | 812 ms | 0 | 0 | 10 | 79 | 68.4 |
| `/uno/`, slow 4G + 4× CPU, repeat visit | 53 ms¹ | 392 ms | 392 ms | 0 | 0 | 10 (6 × 304) | 2 | 68.4 |
| `/uno/r/CODE` cold link → lobby, desktop | 119 ms | 276 ms | lobby visible **977 ms** | 0 | 0 | 16 | 140 | 126.0 |
| `/uno/r/CODE` cold link → lobby, slow 4G + 4× CPU | 129 ms | 988 ms | lobby visible **1,930 ms** | 0 | 87 | 16 | 140 | 126.0 |

¹ CDP's latency emulation is not reflected in the navigation entry's TTFB; `curl` from the same machine measures 113–162 ms for the HTML (see Server).

The lobby and table are text and inline-SVG screens that the LCP observer did not report on room links, so "lobby visible" is the time until the lobby's controls are in the DOM.

### Key Interactions
| Interaction | Route | Long tasks (ms) | Time to visible response | Requests triggered |
|-------------|-------|-----------------|--------------------------|--------------------|
| Create room → lobby (desktop) | `/uno/` | 0 | **1,645 ms** (1,336 / 1,645 / 1,784) | POST `/api/rooms` + 6 chunks + WS |
| Create room → lobby (slow 4G + 4×) | `/uno/` | 0 | **1,545 ms** (1,522 / 1,545 / 1,661) | same |
| Join by code → lobby (desktop) | `/uno/` | 0 | **816 ms** (814 / 816 / 832) | GET `/api/rooms/:code` + 6 chunks + WS |
| Join by code → lobby (slow 4G + 4×) | `/uno/` | 0 | **1,092 ms** (1,080 / 1,092 / 1,108) | same |
| Start game → table | lobby | 0 | **401 ms** desktop, **402 ms** slow | 1 WS message |
| Play a card → card leaves hand | table | 0 | **95 ms** desktop (n = 6), **124 ms** slow (n = 7) | 1 WS message |
| Draw a card → card arrives | table | 0 | 65–283 ms desktop, 121 ms slow | 1 WS message |
| Opponent / bot move (incoming `sync`) | table | 0 | per frame at 4× CPU: **20.5 ms script, 16.0 ms style, 2.2 ms layout, 5.6 layouts** (21 frames / 30 s) | — |
| Toast shown during bot play | table | 0 | stays **> 12.5 s** across 9 frames (designed: 3.6 s) | — |

Worst single event-timing entry during card play is 40 ms (INP proxy). The idle table at 4× CPU costs 37 ms of main-thread time per 10 s.

**Where the room-entry time goes** (in-page marks relative to the click, desktop, run 3):

```
create:  click 0 → POST done 893 → "Preparing the table…" 898 ─300 ms hold─ RoomShell 1199 → WS new 1200
         → WS open 1339 → welcome 1340 → "Laying out the cards…" 1340 ─305 ms hold─ lobby 1645
join:    click 0 → GET done 66 → "Preparing…" 71 ─303 ms hold─ RoomShell 374 → WS new 378 → welcome 507
         → "Laying out…" 509 ─305 ms hold─ lobby 814
start:   click 0 → "Laying out the cards…" 92 ─309 ms hold─ table 401
cold link (slow 4G): HTML 251 → entry JS 866 → RoomShell 1143 → framer-motion 1345 → WS new 1372
         → WS open 1587 → welcome 1603 → "Laying out…" 1608 ─322 ms hold─ lobby 1930
```

### Bundle
Production build (`npm run build`, writes to the ignored `dist/`):

| Chunk | Raw | gzip | brotli | Loaded on |
|-------|-----|------|--------|-----------|
| `index-*.js` (react-dom, App, Landing) | 192.1 KB | 60.3 KB | 52.3 KB | every route |
| `sound-*.js` (Card, Avatar, deck helpers, synth) | 12.2 KB | 3.9 KB | 3.5 KB | every route |
| `room-*.js` (react, jsx-runtime, room codes) | 8.5 KB | 3.4 KB | 3.0 KB | every route |
| `prefs-*.js`, `rolldown-runtime-*.js` | 1.4 KB | 0.8 KB | 0.7 KB | every route |
| `index-*.css` | 31.9 KB | 6.6 KB | 5.8 KB | every route |
| `proxy-*.js` (framer-motion) | 120.8 KB | 38.7 KB | 34.8 KB | room (RoomShell, via `Toasts`) |
| `Table-*.js` | 32.0 KB | 9.9 KB | 8.9 KB | room |
| `RoomShell-*.js` | 8.3 KB | 3.5 KB | 3.1 KB | room |
| `Lobby-*.js` | 8.8 KB | 2.7 KB | 2.4 KB | room |
| `AnimatePresence-*.js`, `hooks-*.js` | 5.7 KB | 2.8 KB | 2.4 KB | room |

The landing route ships 68.4 KB gz of JS and 6.6 KB gz of CSS; a room adds 57.6 KB gz, 38.7 KB of which is framer-motion. The rules engine (`shared/engine.ts`, `bots.ts`, `narrate.ts`) is not in the client bundle. There are no web fonts or raster images, and no duplicated modules across chunks. The Worker bundle is 71.2 KB (20.0 KB gz).

### Server
`curl` from Jakarta (CGK), 3 samples, median:

| Request | TTFB | Total | Size |
|---------|------|-------|------|
| `GET /uno/` | 133 ms | 133 ms | 412 B (gzip) |
| `GET /uno/r/CODE` | 113 ms | 113 ms | 412 B |
| `GET /uno/assets/index-*.js` | 120 ms | 123 ms | 60.8 KB (br) |
| `GET /uno/assets/proxy-*.js` | 125 ms | 127 ms | 40.4 KB (br) |
| `GET /uno/api/rooms/BCDF` (bad code, no DO) | 104 ms | 104 ms | 36 B |
| `GET /uno/api/rooms/:code` (existing room, browser, warm connection) | — | 66–71 ms | — |
| `POST /uno/api/rooms` (browser, n = 13) | — | **median 754 ms**, min 594, max **9,797 ms** | 317 B |
| WS upgrade to an already-warm room DO (browser) | — | 125–230 ms | — |

Headers: every hashed asset is served `Cache-Control: public, max-age=0, must-revalidate` (`cf-cache-status: MISS`). Brotli is on for assets. WebSocket `permessage-deflate` is negotiated. A missing hashed asset, such as `/uno/assets/RoomShell-OLDHASH.js`, returns **200 `text/html`** (the SPA fallback). WebSocket frames: `welcome` ≈ 1.05 KB, `sync` median ≈ 2.0 KB and max 2.6 KB (uncompressed JSON).

## Recommendations

- [x] **PERF-01 — Render preloaded screens without React's 300 ms Suspense hold** · Priority: **Critical** · Effort: S · Risk: Low · done 2026-09-29
  - **Issue:** `React.lazy` only calls its loader the first time it renders, so a screen whose chunk is already downloaded still suspends once. React 19 then holds the reveal until at least 300 ms after the fallback was committed (`FALLBACK_THROTTLE_MS`). Three lazy screens sit on the hot path: RoomShell (`client/App.tsx:16-17`, `client/App.tsx:101-110`), then Lobby and Table (`client/RoomShell.tsx:14-18`, `client/RoomShell.tsx:100-117`). The holds were measured on every flow: "Preparing the table…" lasts 300–303 ms, and "Laying out the cards…" lasts 305–322 ms before the lobby and 309 ms before the table. The socket is opened inside RoomShell (`client/RoomShell.tsx:49`), so the first hold also delays the WebSocket.
  - **Why it matters:** this is pure waiting on the two most important transitions in the app: getting into a room, and every player seeing the table when a game starts. It is the same ~0.3–0.6 s on the fastest and the slowest device, so it dominates on good connections (join: 600 of 816 ms).
  - **Optimization:** add a small `preloadable(loader)` helper that remembers the module once its loader resolves. The component it returns renders the resolved module synchronously, and falls back to `React.lazy` + `Suspense` only while the chunk is genuinely still loading. Use it for RoomShell, Lobby and Table, with the existing `prepareRoom`/`preloadRoomScreens` calling its `preload()`. The chunk split and every fallback stay as they are.
  - **Expected impact (measured holds):**
    - Create → lobby: −605 ms (1,645 → ~1,040 ms).
    - Join → lobby: −605 ms (816 → ~210 ms).
    - Start game → table: −310 ms (401 → ~90 ms).
    - Cold room link → lobby: −305 ms (977 → ~670 ms desktop; 1,930 → ~1,610 ms slow 4G).
  - **Files:** `client/App.tsx`, `client/RoomShell.tsx`, new `client/lib/preloadable.tsx`
  - **Depends on:** —
  - **Measure:** Playwright timeline marks, median of 3: click → `lobby` for create and join, click → `table` for Start game, and nav → `lobby` for a cold link. With preloaded chunks, "Preparing the table…" and "Laying out the cards…" should no longer appear.
  - **Before → After:** local production build (`vite preview`), median of 3.
    - Desktop: create → lobby 672 → **135 ms**, join → lobby 678 → **130 ms**, Start game → table 323 → **22 ms**. Loading fallbacks seen on create/join/start: 3/3 → 0/3.
    - Slow 4G + 4× CPU: Start game → table 357 → **92 ms**.
    - Unchanged locally: slow create 1,268 → 1,272 ms and slow join 1,306 → 1,337 ms. The local preview serves framer-motion uncompressed (120 KB), so RoomShell is still genuinely downloading when the local POST returns; the post-welcome hold is gone (welcome → lobby ~300 → 15–45 ms). In production the chunks finish before the 754 ms POST.
    - Cold link 715 → 691 ms (1 of 3 runs avoided the hold). Its Lobby chunk still races the `welcome` frame; PERF-03 moves the preload to boot.

- [ ] **PERF-02 — Cache hashed assets for a year and 404 missing ones** · Priority: **High** · Effort: S · Risk: Low
  - **Issue:** `worker/index.ts:68-72` returns the `ASSETS` response unchanged, so every content-hashed file under `/uno/assets/` carries `public, max-age=0, must-revalidate`. `_headers` cannot fix this because `run_worker_first` is on (`wrangler.jsonc:49-50`). Measured on a repeat visit: 6 × 304 on `/uno/` alone. A room link adds two more dependent tiers (RoomShell + framer-motion, then Lobby/Table). A missing hashed file, such as a chunk from the previous deploy, comes back as `index.html` with a 200.
  - **Why it matters:** returning players, which is most of a friends' game, pay one round trip per tier before any code runs: about 150 ms each on slow 4G. Each revalidation is also a billed Worker invocation. Serving HTML for a JS URL is what makes a stale tab fail hard (see PERF-06), and it must never be cached as immutable.
  - **Optimization:** for paths under `/assets/`:
    - If the `ASSETS` answer is the HTML fallback, return `404` with `no-store`.
    - Otherwise set `Cache-Control: public, max-age=31536000, immutable` on 200 and 304 responses.
    
    `index.html`, SPA routes and the favicon keep their current revalidating headers.
  - **Expected impact:** repeat visits drop from 6 revalidations to 0 on `/uno/`. On slow 4G that is −1 round trip (≈ −150 ms; repeat LCP 392 → ~240 ms, estimated), and −2 more tiers on a room link (≈ −300 ms, estimated). About 12 fewer Worker invocations per returning session.
  - **Files:** `worker/index.ts`
  - **Depends on:** —
  - **Measure:**
    - `curl -sI <origin>/uno/assets/<hash>.js | grep -i cache-control` shows `immutable`.
    - `curl -s -o /dev/null -w '%{http_code} %{content_type}' <origin>/uno/assets/missing.js` returns `404`.
    - The Playwright repeat-visit probe counts 304s on `/uno/`: 6 → 0.
  - **Before → After:** <filled in when implemented>

- [ ] **PERF-03 — Open the socket and fetch every room chunk as soon as a room URL boots** · Priority: **High** · Effort: M · Risk: Medium
  - **Issue:** `useRoom` lives in RoomShell (`client/RoomShell.tsx:49`), so on a cold link or a refresh the WebSocket only opens after the entry chunk, then RoomShell plus framer-motion (38.7 KB gz, pulled in by `Toasts`), then a render. Lobby and Table only start downloading when RoomShell mounts (`client/RoomShell.tsx:20-24`, `client/RoomShell.tsx:47`). Measured on slow 4G: entry JS done 882 ms → `new WebSocket` 1,372 ms → Lobby chunk 1,568 ms. On desktop: entry 217 ms → socket 542 ms.
  - **Why it matters:** the room link is what people send each other, and it is the slowest route (1.93 s to the lobby on slow 4G). The socket handshake is the longest single step on real mobile links, and it runs after the JS instead of alongside it.
  - **Optimization:**
    - Call `useRoom` from `App`, keyed by the room code and `null` on Landing, and pass the connection into RoomShell as a prop.
    - Move the fallback nickname there too.
    - When `codeFromPath()` finds a code at boot, call `prepareRoom()` at module start, so RoomShell, Lobby, Table and framer-motion download in one tier while the socket connects.
    - The socket, token and reconnect logic stay the same.
  - **Expected impact:** after PERF-01, cold link → lobby drops about −300 ms on desktop (~670 → ~360 ms) and about −250 ms on slow 4G (~1,610 → ~1,360 ms, now limited by the framer-motion download). On a real slow-4G link the ~450 ms socket handshake overlaps the JS download entirely (estimated). The entry chunk grows by about 1 KB gz.
  - **Files:** `client/App.tsx`, `client/RoomShell.tsx`, `client/lib/useRoom.ts`
  - **Depends on:** PERF-01
  - **Measure:** Playwright cold-link timeline, median of 3, desktop and slow: nav → `wsNew` and nav → `lobby`.
  - **Before → After:** <filled in when implemented>

- [ ] **PERF-04 — Stop incoming frames from restarting the toast timer** · Priority: **High** · Effort: S · Risk: Low
  - **Issue:** `useToasts` returns a new `push` and `dismiss` on every render (`client/lib/toasts.ts:52-58`). RoomShell passes `dismiss` as `onExpire` (`client/RoomShell.tsx:118`), and each `ToastRow`'s timer effect depends on it (`client/components/Toasts.tsx:27-30`). Every RoomShell render therefore clears and restarts the 3.6 s timer, and RoomShell renders on every WebSocket frame. Each row is also a framer `layout` element, so it is re-measured on each of those renders.
  - **Why it matters:** measured live, a "Back in." toast stayed on screen for more than 12.5 s across 9 bot moves instead of 3.6 s. Toasts are `pointer-events-auto` and sit over the header rail (`client/components/Toasts.tsx:13`, `client/components/Toasts.tsx:39`), so Leave and Chat are covered for as long as other players keep moving.
  - **Optimization:** wrap `push` and `dismiss` in `useCallback` (`setToasts` is already stable), and wrap `Toasts` in `memo`.
  - **Expected impact:** toast lifetime during play drops from > 12.5 s to 3.6 s (measured), with zero toast layout measurements per incoming frame.
  - **Files:** `client/lib/toasts.ts`, `client/components/Toasts.tsx`
  - **Depends on:** —
  - **Measure:** Playwright: during a bot game, drop the socket, then time the `role=status` "Back in." toast until it is hidden while frames keep arriving.
  - **Before → After:** <filled in when implemented>

- [ ] **PERF-05 — Warm the join path before the click** · Priority: **High** · Effort: S · Risk: Low
  - **Issue:** Join sends `GET /api/rooms/:code` only on submit (`client/screens/Landing.tsx:68-93`). The room chunks (57.6 KB gz) also start only on click (`client/App.tsx:20-28`, called from `client/screens/Landing.tsx:75`). On slow 4G the GET takes 193–224 ms and framer-motion lands at ~525 ms, so the socket cannot start before ~540 ms (join → lobby 1,092 ms).
  - **Why it matters:** joining a friend's room is the second most common entry. After PERF-01, the remaining slow-4G join time is mostly these two waits, both of which could have finished while the player was typing the code.
  - **Optimization:**
    - Prefetch the room chunks once Landing is idle (`requestIdleCallback`, with a ~1.5 s timeout), skipping this when `navigator.connection.saveData` is set.
    - When the code field holds six valid characters, start the existence check (debounced ~150 ms). On submit, reuse the result if the code is unchanged and the answer is under ~30 s old; otherwise fetch as today.
    - The same inline "No room with that code" error is shown, and the API is unchanged.
  - **Expected impact:** after PERF-01, join → lobby on slow 4G drops from ~780 ms to ~250 ms (estimated: chunks and check both done at click, leaving only the socket handshake). About −70 ms on desktop (the measured GET).
  - **Files:** `client/App.tsx`, `client/screens/Landing.tsx`
  - **Depends on:** PERF-01
  - **Measure:** Playwright join timeline (a second browser context joins an existing room), median of 3, desktop and slow: click → `lobby`, and click → `wsNew`.
  - **Before → After:** <filled in when implemented>

- [ ] **PERF-06 — Recover from stale chunks after a deploy instead of going blank** · Priority: **Medium** · Effort: S · Risk: Low
  - **Issue:** there is no error boundary and no `vite:preloadError` handler anywhere in `client/`. A tab loaded before a deploy still references the old hashed chunks. On Create or Join, `import('./RoomShell-<old>.js')` fails (today it even receives HTML), `React.lazy` throws, and the page goes blank.
  - **Why it matters:** every deploy blanks the primary action for anyone who had the game open, with no way back except a manual reload.
  - **Optimization:** in `client/main.tsx`, listen for `vite:preloadError` and reload once, guarded by a `sessionStorage` flag so a real outage cannot loop. The URL is already `/uno/r/CODE` by then, so the reload lands in the room.
  - **Expected impact:** a blank page becomes one automatic reload (≈ 0.2–1 s) that ends in the room.
  - **Files:** `client/main.tsx`
  - **Depends on:** PERF-02
  - **Measure:** Playwright: route the first `RoomShell-*.js` request to a 404, click Create, then assert the lobby appears after exactly one reload (before: `#root` stays empty).
  - **Before → After:** <filled in when implemented>

- [ ] **PERF-07 — Cut the work each incoming frame does on the table** · Priority: **Medium** · Effort: M · Risk: Medium
  - **Issue:** each `sync` frame replaces `room` with a new object from `JSON.parse` (`client/lib/useRoom.ts:147-149`) and moves `clockSkew` by a few ms, so almost the whole table re-renders on every move:
    - Table re-derives `hand` and `ordered` (`client/screens/Table.tsx:77-82`).
    - Table passes the whole `room` to Opponents, CenterPiles and ActionBar (`client/screens/Table.tsx:381-441`).
    - `Seat` is not memoized (`client/components/Opponents.tsx:28-74`), and it is a `motion.div layout` without `layoutDependency` (`client/components/Opponents.tsx:99-103`), so framer-motion reads layout on every render. The same goes for the ActionBar `Pop` (`client/screens/Table.tsx:628-640`) and the hand cards (`client/components/Hand.tsx:191-200`).
    
    Measured at 4× CPU: 20.5 ms script, 16.0 ms style and 2.2 ms layout per opponent frame, with 5.6 forced layouts per frame. There are no long tasks.
  - **Why it matters:** there is no visible lag today, but bot moves arrive every 1–2.5 s. On a low-end phone this is the steady background cost that competes with the card animations and with the player's own taps.
  - **Optimization:**
    - Share the unchanged parts of the incoming room with the previous one (a structural-sharing merge before `setRoom`).
    - Only update `clockSkew` when it moves by more than 250 ms.
    - Pass narrow props instead of `room`, and `memo` `Seat`.
    - Give each `layout` element a `layoutDependency` keyed on what actually moves its box (seat order and fan size, visible action buttons, card order and overlap).
  - **Expected impact:** about −50% script per frame (20.5 → ~10 ms at 4× CPU, estimated) and 5.6 → ≤ 2 layouts per frame. Nothing visible changes at today's load; this is headroom for slow devices.
  - **Files:** `client/lib/useRoom.ts`, `client/screens/Table.tsx`, `client/components/Opponents.tsx`, `client/components/Hand.tsx`
  - **Depends on:** PERF-03
  - **Measure:** CDP `Performance.getMetrics` over a 30 s bot game at 4× CPU: `ScriptDuration`, `RecalcStyleDuration` and `LayoutCount`, each divided by the number of `sync` frames.
  - **Before → After:** <filled in when implemented>

- [ ] **PERF-08 — Show a card or draw as pending the moment it is tapped** · Priority: **Medium** · Effort: M · Risk: Medium
  - **Issue:** tapping a card only sends the intent (`client/components/Hand.tsx:218-222` → `client/screens/Table.tsx:221-227`). Nothing changes locally until the next `sync` removes the card. The deck and action buttons stay live meanwhile, and the sound waits for the server's echo. Measured click → card leaves hand: median 95 ms on desktop and 124 ms at 4× CPU, from Jakarta to a nearby room. A room's Durable Object sits near whoever created it, so a friend on slow 4G or on another continent adds 150–300 ms of round trip to every tap. Double taps in that window come back as error toasts (`no_such_card`, `already_drew`).
  - **Why it matters:** playing a card is the core interaction. INP looks green (≤ 40 ms event duration) while the felt response is a full network round trip.
  - **Optimization:**
    - On tap, put the card (or the deck) into a pending state straight away: a CSS transform/opacity lift and `aria-busy`.
    - Ignore further play and draw input until the next `sync` or `error`, or 1.5 s.
    - Game state is not predicted: the server's frame still decides.
  - **Expected impact:** the first visible response to a tap moves from 95–124 ms plus round trip to the next frame (≤ 30 ms, estimated), and duplicate-intent error toasts go away.
  - **Files:** `client/components/Hand.tsx`, `client/components/CenterPiles.tsx`, `client/screens/Table.tsx`
  - **Depends on:** PERF-07
  - **Measure:** Playwright over 6 turns, median: `pointerdown` → first animation frame in which the tapped card carries the pending state, plus click → card removed (should be unchanged).
  - **Before → After:** <filled in when implemented>

- [ ] **PERF-09 — Detect dead sockets and reconnect as soon as the network is back** · Priority: **Medium** · Effort: M · Risk: Medium
  - **Issue:**
    - The client pings every 25 s but never checks for the pong (`client/lib/useRoom.ts:57`, `client/lib/useRoom.ts:123-126`, `client/lib/useRoom.ts:179-180`).
    - There are no `online` or `visibilitychange` listeners.
    - Backoff grows to 8 s plus up to 25% jitter (`client/lib/useRoom.ts:192-197`).
    - The retry counter resets on `open` rather than on `welcome` (`client/lib/useRoom.ts:121`).
    
    After a Wi-Fi ↔ cellular switch or a phone waking, the socket can stay "open" but dead, the table freezes, and taps are dropped silently (`client/lib/useRoom.ts:223-228`).
  - **Why it matters:** on mobile, "the game froze" is the slowest experience there is, and nothing tells the player or recovers it.
  - **Optimization:**
    - Treat a missing pong within 10 s of a ping as a dead socket: close it and reconnect.
    - On `online`, and when the page becomes visible, ping immediately and cut any pending backoff short.
    - Reset the backoff on `welcome`.
    
    Pings are still answered by `setWebSocketAutoResponse`, so the room stays hibernated.
  - **Expected impact:** dead-socket detection goes from unbounded to ≤ 35 s passively and ~10 s after wake or `online`. Recovery once the network returns goes from up to ~10 s of backoff to one handshake (~0.2–0.5 s, estimated).
  - **Files:** `client/lib/useRoom.ts`
  - **Depends on:** PERF-03
  - **Measure:** Playwright:
    - Close the socket 5 times to reach the 8 s backoff, dispatch `online`, and time until the next `new WebSocket`.
    - Swallow pongs, and time until the forced reconnect.
  - **Before → After:** <filled in when implemented>

- [ ] **PERF-10 — Create the room during the WebSocket upgrade** · Priority: **Medium** · Effort: M · Risk: Medium
  - **Issue:** Create is two serial trips:
    1. `POST /api/rooms` (`client/screens/Landing.tsx:56`, `worker/index.ts:76-88`). Median 754 ms (n = 13), max 9.8 s, dominated by the first `idFromName` access creating a new Durable Object.
    2. A separate WebSocket handshake to that now-warm object: 125–230 ms measured, about 3 round trips on a real mobile link.
    
    Separately, a room created by `POST` that nobody joins is never cleaned up, because `createIfAbsent` never arms the cleanup alarm (`worker/room.ts:130-135`).
  - **Why it matters:** creating a room is the first thing every group does, and after PERF-01 it is still the slowest click in the app (~1 s).
  - **Optimization:**
    - Accept `GET /ws?create=1`: the Worker runs the same `createIfAbsent` retry loop and forwards the upgrade to the new room's object.
    - The client reads the code from `welcome.room.code`, then calls `pushState` and `saveToken`.
    - Keep `POST /api/rooms` for already-open tabs.
    - Also arm cleanup in `createIfAbsent`.
  - **Expected impact:** create → lobby −125–230 ms (measured handshake; about −450 ms on real slow 4G, estimated), and no more orphaned rooms.
  - **Files:** `worker/index.ts`, `worker/room.ts`, `worker/room.test.ts`, `client/App.tsx`, `client/screens/Landing.tsx`, `client/lib/useRoom.ts`
  - **Depends on:** PERF-03
  - **Measure:** Playwright create timeline, median of 3: click → `lobby`.
  - **Before → After:** <filled in when implemented>

- [ ] **PERF-11 — Skip Durable Object writes that change nothing** · Priority: **Low** · Effort: S · Risk: Low
  - **Issue:**
    - Every commit awaits `storage.put` and then `setAlarm` or `deleteAlarm` before broadcasting (`worker/room.ts:751-758`, `worker/room.ts:683-690`), even when the alarm time is unchanged. In games without a turn timer, nearly every move pays a `deleteAlarm` write.
    - `webSocketClose` and `webSocketError` both call `dropSocket` (`worker/room.ts:500-508`). A single disconnect can therefore commit and broadcast twice.
  - **Why it matters:** storage writes are billed per row (100k per day on the free plan), and each one is a serial step before the frame goes out.
  - **Optimization:**
    - Remember the armed alarm time and skip identical `setAlarm` and `deleteAlarm` calls.
    - Return early from `dropSocket` for a player already marked disconnected.
  - **Expected impact:** storage rows written per move drop from 2 to 1 in timerless games (source-level), with one fewer serial storage call before each broadcast (under a few ms, estimated).
  - **Files:** `worker/room.ts`, `worker/room.test.ts`
  - **Depends on:** PERF-10
  - **Measure:** a worker test that spies on `ctx.storage` and counts writes per `PLAY_CARD` and per disconnect, before and after.
  - **Before → After:** <filled in when implemented>

## Top 5
1. PERF-01: remove the 300 ms Suspense hold on room entry and game start (−0.3 to −0.6 s on every create, join, link and start).
2. PERF-03: open the socket and fetch all room chunks as soon as a room URL boots (cold links about −0.3 s).
3. PERF-05: prefetch room chunks and check the code while it is typed (join on slow 4G ~780 → ~250 ms).
4. PERF-02: immutable caching for hashed assets, and real 404s for missing ones (−1 to −3 round trips on repeat visits).
5. PERF-04: stop incoming frames from restarting the toast timer (a toast covering Leave and Chat for 12.5+ s drops to 3.6 s).

## Quick Wins
- PERF-01: `preloadable()` helper for RoomShell, Lobby and Table.
- PERF-02: a year-long immutable `Cache-Control` and a 404 guard on `/assets/*` in the Worker.
- PERF-04: `useCallback` for toast `push` and `dismiss`.
- PERF-05: idle chunk prefetch and a code check while typing.

## Larger Improvements
- PERF-03: move the room connection up to `App` so the socket and the chunks start at boot.
- PERF-07: structural sharing of room frames, narrow props, and `layoutDependency` on layout-animated elements.
- PERF-08: pending state on tap for cards and the deck.
- PERF-09: heartbeat watchdog plus `online` and `visibilitychange` reconnects.
- PERF-10: create the room during the WebSocket upgrade.

## Risks If the Current State Is Kept
- Every create, join, cold link and game start keeps a fixed 0.3–0.6 s of waiting that no network or device upgrade removes. It is most noticeable on fast connections, where it is most of the wait.
- Returning mobile players keep paying revalidation round trips on every visit. Each one is a billed Worker request, and on the free plan exceeding the request quota returns 429 for the whole app, static assets included.
- Each deploy blanks Create and Join for anyone who had the page open.
- Mobile network switches can freeze a table indefinitely with no indication, and taps are dropped silently in the meantime.
- Players far from the room's Durable Object (it sits near the creator) feel their full round trip on every card, and double taps turn into error toasts.
- Durable Object storage writes run at about 2 rows per move against a 100k/day free quota (roughly 80–200 full matches a day). Rooms created but never joined accumulate forever.
- Per-frame re-render cost grows with player count (up to 8 seats), with chat history, and with low-end devices, although it is still well under the long-task threshold today.

## Out-of-Scope Observations
Not performance, noted while auditing:
- `/uno/index.html` answers with a 307 to `/`, which leaves the mount point and lands on the other Worker.
- Unlayered `.card-shadow` / `.card-shadow-live` (`client/index.css:100-112`) likely override the `ring-2` box-shadow on the selected hand card (`client/components/Hand.tsx:213-215`), so the selection ring may never paint (from reading the code, not verified visually).
- `dealing` is set in an effect after the new hand has mounted with `initial={false}` (`client/screens/Table.tsx:114-118`), so the deal stagger may not play (from reading the code, not verified).

## Success Criteria Scorecard

| Route / Interaction | Metric | Before | After | Target |
|---------------------|--------|--------|-------|--------|
| `/uno/` | LCP, desktop, cold | 168 ms | | ≤ 2.5 s |
| `/uno/` | LCP, slow 4G + 4× CPU, cold | 812 ms | | ≤ 2.5 s |
| `/uno/` | Revalidations on a repeat visit | 6 × 304 | | 0 |
| `/uno/` | Initial JS (gz) | 68.4 KB | | ≤ 200 KB |
| `/uno/` | CLS | 0 | | ≤ 0.1 |
| `/uno/r/CODE` cold | nav → lobby visible, desktop | 977 ms | | ≤ 600 ms |
| `/uno/r/CODE` cold | nav → lobby visible, slow 4G + 4× CPU | 1,930 ms | | ≤ 1,400 ms |
| Create room | click → lobby, desktop | 1,645 ms | | ≤ 1,100 ms |
| Join by code | click → lobby, desktop | 816 ms | | ≤ 250 ms |
| Join by code | click → lobby, slow 4G + 4× CPU | 1,092 ms | | ≤ 400 ms |
| Start game | click → table | 401 ms | | ≤ 150 ms |
| Play a card | worst event duration (INP proxy) | 40 ms | | ≤ 200 ms |
| Play a card | click → card leaves hand | 95 ms | | ≤ 200 ms |
| Opponent move | script per frame at 4× CPU | 20.5 ms | | ≤ 10 ms |
| Opponent move | long tasks | 0 | | 0 |
| Toast during play | time on screen | > 12.5 s | | 3.6 s |
