# Performance Audit — 2026-09-29

*Audited on 2026-09-29 at commit `06bab77` · Scope: entire app · Mode: static and production build analysis*
*Stack: React 19 client-rendered SPA, Vite 8, Tailwind 4, Cloudflare Worker with one SQLite-backed Durable Object per room and WebSocket updates · Slow-device view: estimated at 1.6 Mbps down and 4× CPU; no current rendered measurement*
*Previous audit: `docs/performance-audit-2026-09-28.md` (0 items carried over; PERF-01–11 are complete)*

Tick a box only after implementing and measuring its optimization. Build output was written to the gitignored `dist/` directory. No development server was started. Yesterday's production and local preview timings describe earlier commits and are not presented as timings for this commit.

## Summary

| Priority | Count |
|----------|------:|
| Critical | 0 |
| High | 0 |
| Medium | 1 |
| Low | 0 |

The prior audit addressed the large room-entry delays, cache policy, interaction feedback, reconnection, and redundant writes. Today's build and source scan found one remaining opportunity on the cold lobby path: the app waits for the game table and animation runtime before it can show the lobby. No new significant server, database, memory, or interaction bottleneck was supported by the available evidence.

## Baseline

### Key routes

| Route | TTFB | FCP | LCP | CLS | Long tasks | Requests | Transfer | Initial JS (gzip) |
|-------|------|-----|-----|-----|------------|----------|----------|-------------------|
| `/uno/` landing | unavailable | unavailable | unavailable | unavailable | unavailable | unavailable | unavailable | 68.4 KiB from the build |
| `/uno/r/CODE` cold link to lobby | unavailable | unavailable | unavailable | unavailable | unavailable | unavailable | unavailable | 125.0 KiB across all room-preloaded JS chunks |
| `/uno/r/CODE` active table | unavailable | unavailable | unavailable | unavailable | unavailable | unavailable | unavailable | 125.0 KiB across all JS chunks |

The cold-link lobby and active-table rows describe the code requested by `prepareRoom()` and `preloadRoomScreens()` (`client/App.tsx:24-29,61-62`; `client/roomScreens.ts:13-19`). The chunk total is a build measurement, not a browser transfer measurement. A first-time shared-link visitor without a saved name now sees `RoomIdentity` (`client/App.tsx:157-163`); the socket waits for identity confirmation, so that human decision time is excluded from any future route timing comparison.

### Key interactions

| Interaction | Route | Long tasks | Time to visible response | Requests triggered |
|-------------|-------|------------|--------------------------|--------------------|
| Create room → lobby | `/uno/` | unavailable | unavailable | WebSocket upgrade; static source check |
| Join by code → lobby | `/uno/` | unavailable | unavailable | room lookup and WebSocket upgrade; static source check |
| Shared link → lobby | `/uno/r/CODE` | unavailable | unavailable | WebSocket upgrade after identity, if needed; static source check |
| Start game → table | lobby | unavailable | unavailable | WebSocket intent; static source check |
| Play or draw a card | table | unavailable | unavailable | WebSocket intent; static source check |
| Send chat | table | unavailable | unavailable | WebSocket message; static source check |

### Bundle

`npm run build` passed at `06bab77`. Compressed sizes below are measured from `dist/client/assets` with gzip level 9 and shown in binary KiB. All JS chunks total **125.0 KiB gzip** (127,975 bytes); CSS totals **6.5 KiB gzip** (6,656 bytes). The Worker bundle is **20.5 KiB gzip** per Vite's build output.

| Chunk | Gzip | On the current path |
|-------|-----:|---------------------|
| `index-*.js` | 65.3 KiB | landing and room |
| `react-*.js` | 3.0 KiB | landing and room |
| `proxy-*.js` (Framer Motion runtime) | 37.7 KiB | room, including lobby |
| `Table-*.js` | 10.9 KiB | loaded before lobby is ready |
| `Lobby-*.js` | 2.8 KiB | room |
| `RoomShell-*.js` | 2.1 KiB | room |
| `AnimatePresence-*.js` | 1.9 KiB | room, including lobby toasts |
| `hooks-*.js`, `roomScreens-*.js` | 1.1 KiB | room |
| `index-*.css` | 6.5 KiB | landing and room |

The landing route's entry JS is **68.4 KiB gzip** (`index` + `react`). The room preloader currently requests **56.6 KiB** more JS, including **50.5 KiB** for `proxy`, `Table`, and `AnimatePresence`. The CSS is shared. There are no raster images or web fonts in the build.

### Server and slow-device view

Current TTFB, API latency, WebSocket timing, Core Web Vitals, request count, transferred bytes, and interaction timing are **unavailable** in static mode. The historical production URL in the prior audit was not used because deployment of the changes made since that audit is unverified; it cannot establish a baseline for this commit.

At 1.6 Mbps, **50.5 KiB gzip** takes about **0.26 s** to transfer if it occupies the link alone (`50.5 × 1024 × 8 / 1,600,000`). Parallel downloads and the WebSocket handshake can hide some or all of that time. The source scan found one bounded Durable Object storage key per room, at most eight players, no SQL query path, narrow timer subscriptions, and bounded chat history; no new server or memory recommendation is justified by this baseline.

## Recommendations

- [ ] **PERF-12 — Show the lobby before loading the table animation code** · Priority: **Medium** · Effort: M · Risk: Medium
  - **Issue:** `roomShell` in `client/App.tsx:24-29` resolves only after `preloadRoomScreens()` finishes both screens (`client/roomScreens.ts:13-19`). A cold lobby therefore waits for the unused `Table` chunk. `client/screens/Lobby.tsx:8,104-160` and `client/components/Toasts.tsx:6,23-44` import Framer Motion for player-row and toast animations, so the lobby also loads the 37.7 KiB animation runtime and 1.9 KiB `AnimatePresence` chunk.
  - **Why it matters:** a shared room link is a primary entry path. On a slow connection, bytes needed only for play compete with the lobby's code; JavaScript parsing and animation setup also occur before the lobby is visible. Yesterday's audit measured the animation runtime as the largest room-only chunk.
  - **Optimization:** make the lobby and RoomShell ready without waiting for `Table`; start the table download after the first lobby paint or during idle time, but load it immediately when the server's first room snapshot is already in a playing phase. Replace the lobby player-row and toast animations with equivalent CSS transitions and entry/exit behavior so Framer Motion remains table-only. Preserve the existing loading fallback and a ready table at game start.
  - **Expected impact:** remove up to **50.5 KiB gzip** from the code required before a cold lobby appears (measured build sizes: Table 10.9 + Framer Motion 37.7 + AnimatePresence 1.9 KiB), from 125.0 to about **74.5 KiB** of JS on that path. This is **0.26 s of transfer budget at 1.6 Mbps**, not a measured 0.26 s wall-time gain; overlap may reduce the actual saving. The extra CSS and any changed chunk boundaries must be included in the after measurement.
  - **Files:** `client/App.tsx`, `client/roomScreens.ts`, `client/RoomShell.tsx`, `client/screens/Lobby.tsx`, `client/components/Toasts.tsx`, `client/index.css`
  - **Depends on:** —
  - **Measure:** compare production-build gzip bytes required before the lobby can render, then use a browser on the same build and throttled connection to compare cold navigation → lobby visible and Start click → table visible. Verify the table prefetch does not add a visible Start delay and that toast/player-row animations and reduced-motion behavior remain equivalent.
  - **Before → After:** **125.0 KiB gzip** of room-preloaded JS → pending implementation and measurement. Cold lobby and Start timings are unavailable until a running build can be measured.

## Top 5

1. PERF-12 — move up to 50.5 KiB gzip of table-only code off the cold lobby's required download path.

## Quick Wins

None supported by the current evidence. PERF-12 spans the preloader and two visible animation patterns, so it needs a focused regression check.

## Larger Improvements

- PERF-12 — split lobby readiness from table readiness while keeping the table ready by Start.

## Risks If the Current State Is Kept

- Cold room links continue to require every table chunk before the lobby can render. The avoidable portion is up to 50.5 KiB gzip, or about 0.26 s of transfer budget on a 1.6 Mbps link before accounting for overlap and parsing.
- As table features and animations grow, lobby entry inherits their download and execution cost even though none of those features is visible in the lobby.

## Success Criteria Scorecard

| Route / interaction | Metric | Before | After | Target |
|---------------------|--------|--------|-------|--------|
| `/uno/` | Initial JS gzip | 68.4 KiB | | ≤ 200 KiB |
| `/uno/r/CODE` cold lobby | Required JS gzip before lobby | 125.0 KiB | | ≤ 80 KiB |
| `/uno/r/CODE` cold lobby | Navigation → lobby visible at slow 4G + 4× CPU | unavailable | | ≤ 1.4 s |
| `/uno/` | LCP / CLS | unavailable / unavailable | | ≤ 2.5 s / ≤ 0.1 |
| Create and join | Click → lobby visible | unavailable | | ≤ 1.1 s / ≤ 0.4 s |
| Start game | Click → table visible | unavailable | | ≤ 0.15 s |
| Play or draw | Interaction duration (INP when field data exists) | unavailable | | ≤ 0.2 s |
| Chat | Time to visible message | unavailable | | no perceptible lag |
