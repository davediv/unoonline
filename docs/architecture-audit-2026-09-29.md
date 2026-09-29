# Architecture & UX Audit — 2026-09-29

*Audited on 2026-09-29 at commit `182802e` · Scope: entire app · Live walkthrough: no (the process on port 5173 belongs to another project; no browser surface was available)*
*Previous audit: none*

Tick a box when its recommendation is implemented. The checkbox is the single source of truth for that item; the sections after the list only reference IDs.

## Summary

| Priority | Count |
|----------|------:|
| Critical | 1 |
| High | 4 |
| Medium | 2 |
| Low | 0 |

This is a source audit. Responsive layout, focus behavior, redirects, and live room transitions still need a walkthrough in this app's own running instance. The source paths below are evidence of implementation behavior, not measurements of users.

## Current State

### Sitemap

```text
/uno/                 → create or join a room; entry from the site or Leave
/uno/r/:code          → one shareable room route; entry from Create, Join, or a shared link
  room.phase=lobby    → share link, set rules, ready, start; no separate URL
  room.phase=playing  → table, chat, game actions; no separate URL
  roundOver/matchOver → scoreboard overlay; no separate URL
other /uno/* paths    → landing screen without changing the URL
```

`client/App.tsx:38-42,119-146` defines the two client views. `client/RoomShell.tsx:76-96` selects lobby or table by room phase; `client/screens/Table.tsx:502-512` displays the result overlay. `worker/index.ts:61-73` serves client routes through the asset fallback. There are no orphan feature routes or duplicate pages in this small route tree.

### Navigation

- The landing screen has Create room and a Join form (`client/screens/Landing.tsx:203-254`).
- The lobby has Leave, Copy link, player controls, house rules, and Start game (`client/screens/Lobby.tsx:64-91,93-183,185-315`).
- The table has room code, utility controls, chat, and Leave in its top rail; action buttons occupy the center (`client/screens/Table.tsx:343-449`).
- The scoreboard provides Next round or Play again and Leave (`client/components/Scoreboard.tsx:130-166`).
- There is no global navigation, footer, breadcrumb, or in-page tab set. That is appropriate for a short, single-purpose game. Mobile uses the same route structure and controls, with a scrollable card hand and bottom chat sheet (`client/components/Hand.tsx:147-158`, `client/components/Chat.tsx:32-41`).
- Browser Back and Forward are handled in `client/App.tsx:92-100`; entering and leaving a room both push history entries in `client/App.tsx:119-131`.

### Primary Flows

1. **Create:** choose name/avatar → Create room → socket creates room → lobby → add bot or invite others → each human marks Ready → host starts → table (`client/screens/Landing.tsx:93-110`, `client/screens/Lobby.tsx:133-180,283-315`, `worker/room.ts:387-407`).
2. **Join by code:** enter six-character code → room lookup → room route → lobby if space is available; otherwise spectate (`client/screens/Landing.tsx:112-136`, `worker/room.ts:249-272`).
3. **Join by link:** load `/uno/r/:code` → connect immediately with saved name or generated nickname → lobby or spectator view (`client/App.tsx:38-53,164-172`, `worker/room.ts:238-272`). There is no identity step on this path.
4. **Play:** lobby → table → legal actions from server snapshot → round scoreboard → Next round, or match scoreboard → host returns group to lobby (`client/RoomShell.tsx:76-94`, `client/screens/Table.tsx:433-512`, `client/components/Scoreboard.tsx:130-166`, `worker/room.ts:410-454`).
5. **Spectate:** late arrival sees hidden hands → result overlay → promised next game. The same socket retains spectator identity after reset, so that promise has no completion path (`client/screens/Lobby.tsx:283-287`, `worker/room.ts:249-255,312-315,433-454`).

## Recommendations

- [x] **AR-01 — Give spectators a path into the next game** · done 2026-09-29 · Priority: **Critical** · Effort: L
  - **Issue:** The lobby promises spectators a seat next game (`client/screens/Lobby.tsx:283-287`), but the server assigns a spectator socket `playerId: null` and never promotes it at round or match transitions (`worker/room.ts:249-255,312-315,410-454`). The scoreboard also offers spectators a Next round button whose message is rejected (`client/components/Scoreboard.tsx:145-152`, `worker/room.ts:312-315`).
  - **Why it matters:** A late guest who waits as instructed cannot join play without leaving and reconnecting at the right time.
  - **Recommendation:** Define a capacity-aware spectator queue and promote waiting sockets into available seats when the next game opens; keep them informed when the room is full. Until promotion, show a waiting state instead of player-only round controls. Cover lobby, round, match, reconnect, and full-room cases in worker tests.
  - **Expected benefit:** The watch-to-play promise becomes a reliable route into the core task.
  - **Files:** `worker/room.ts`, `client/screens/Lobby.tsx`, `client/components/Scoreboard.tsx`, `client/RoomShell.tsx`, `worker/room.test.ts`
  - **Depends on:** —

- [x] **AR-02 — Let shared-link guests set their identity before joining** · done 2026-09-29 · Priority: **High** · Effort: M
  - **Issue:** `/uno/r/:code` immediately constructs `Room` with the saved name or a random nickname (`client/App.tsx:38-53,164-172`); the name/avatar inputs exist only on the landing route (`client/screens/Landing.tsx:151-201`).
  - **Why it matters:** A first-time guest cannot choose how they appear before occupying a seat, and changing the landing preference later does not rename that seat.
  - **Recommendation:** On a cold shared-link visit without a saved identity, keep the room code in the URL and show a compact name/avatar entry step before opening the socket. Preserve direct reconnect for visitors with an existing room token.
  - **Expected benefit:** Guests enter a shared room with an identity they recognize, without losing the link or their seat on reconnect.
  - **Files:** `client/App.tsx`, `client/screens/RoomIdentity.tsx`
  - **Depends on:** —

- [x] **AR-03 — Make disconnected game actions visibly unavailable** · done 2026-09-29 · Priority: **High** · Effort: M
  - **Issue:** `useRoom.send` silently drops messages unless the socket is open (`client/lib/useRoom.ts:309-314`), while the table still renders actions from the last snapshot during reconnect (`client/RoomShell.tsx:55-94`, `client/screens/Table.tsx:433-465`). A draw even enters a temporary pending state after the dropped send (`client/screens/Table.tsx:236-256`).
  - **Why it matters:** Players can tap a legal-looking action and receive no result, especially during a timed turn.
  - **Recommendation:** Pass connection availability into lobby, table, and scoreboard controls. Disable server actions while reconnecting, present a persistent status near the actions, and restore interaction from the fresh room snapshot after reconnect.
  - **Expected benefit:** Players know when an action can reach the room and do not mistake a dropped tap for a completed move.
  - **Files:** `client/RoomShell.tsx`, `client/screens/Lobby.tsx`, `client/screens/Table.tsx`, `client/components/Scoreboard.tsx`, `client/components/Overlays.tsx`, `client/lib/useRoom.ts`
  - **Depends on:** —

- [x] **AR-04 — Put the host's Ready step next to Start game** · done 2026-09-29 · Priority: **High** · Effort: S
  - **Issue:** The host must mark themselves Ready in the player list (`client/screens/Lobby.tsx:133-148`), while Start game is below the entire house-rules section and remains disabled until everyone is ready (`client/screens/Lobby.tsx:185-315`). The status can merely say it is waiting on the host's own name.
  - **Why it matters:** A host who has already invited a friend or added a bot can reach a disabled primary action without seeing the required self-action.
  - **Recommendation:** Place a host Ready control beside Start, or make the disabled-state guidance link/focus the existing Ready control. Keep the server's ready requirement intact.
  - **Expected benefit:** The create-to-play path explains its next step where the host tries to advance.
  - **Files:** `client/screens/Lobby.tsx`
  - **Depends on:** —

- [x] **AR-05 — Keep keyboard focus within active game dialogs** · done 2026-09-29 · Priority: **High** · Effort: M
  - **Issue:** Colour, swap, reveal, and result layers declare modal dialogs (`client/components/Overlays.tsx:14-35`, `client/components/Scoreboard.tsx:43-52`), but have no focus containment or restoration. The hand's window-level arrow handler remains active when a modal has focus (`client/components/Hand.tsx:115-145`).
  - **Why it matters:** Keyboard and screen-reader users can reach controls behind a game decision, lose their place, or change a hidden hand selection while choosing an option.
  - **Recommendation:** Use a shared dialog focus pattern with initial focus, containment, background inertness, and focus restoration. Scope hand shortcuts to the active table and pause them during modal decisions.
  - **Expected benefit:** Dialogs operate as the single active step in the flow for keyboard and assistive-technology users.
  - **Files:** `client/components/Overlays.tsx`, `client/components/Scoreboard.tsx`, `client/components/Hand.tsx`, `client/screens/Table.tsx`, `client/lib/modalFocus.ts`
  - **Depends on:** —

- [x] **AR-06 — Make leaving a room a stable history transition** · done 2026-09-29 · Priority: **Medium** · Effort: S
  - **Issue:** Leave pushes the landing URL on top of the room entry (`client/App.tsx:119-131`), so Back after Leave returns to that same room and starts the connection again (`client/App.tsx:92-100,135-146`).
  - **Why it matters:** A player who deliberately leaves can unexpectedly rejoin through ordinary browser navigation; repeated leave/back cycles also stack entries.
  - **Recommendation:** Replace the current room history entry when Leave is explicit, while retaining normal Back/Forward navigation for a room entered from the landing screen. Verify direct-link and create flows.
  - **Expected benefit:** Leave behaves like a completed exit rather than a temporary screen change.
  - **Files:** `client/App.tsx`
  - **Depends on:** —

- [ ] **AR-07 — Give unknown room URLs an explicit recovery path** · Priority: **Medium** · Effort: S
  - **Issue:** Invalid room codes and all other `/uno/*` paths render the landing screen while leaving the unrecognized URL in the address bar (`client/App.tsx:38-53,133-146`; `worker/index.ts:61-73`). A valid-shaped but closed room is eventually sent back with a notice (`client/RoomShell.tsx:30-40`), so malformed paths behave inconsistently.
  - **Why it matters:** A mistyped or stale link appears to have succeeded enough to load the app, but the URL still suggests a room and refresh repeats the ambiguity.
  - **Recommendation:** Normalize or replace invalid room paths with `/uno/` and show a clear invalid-link notice; give other unknown paths a small recovery view or redirect. Keep valid room deep links reloadable.
  - **Expected benefit:** Broken links lead users to a known starting point with a reason they can act on.
  - **Files:** `client/App.tsx`, `worker/index.ts`
  - **Depends on:** —

## Top 5

1. AR-01 — Complete the promised spectator-to-player path.
2. AR-02 — Let guests from shared links choose an identity.
3. AR-03 — Stop presenting dropped actions as available during reconnect.
4. AR-04 — Expose the host's Ready step next to Start.
5. AR-05 — Make game dialogs contain and restore keyboard focus.

## Quick Wins

- AR-04 — Put host readiness beside the primary action.

## Larger Architectural Improvements

- AR-01 — Model spectator promotion and capacity at the room boundary.
- AR-02 — Add an entry step without breaking room deep links or token-based reconnects.
- AR-03 — Carry connection availability through room screens and actions.
- AR-05 — Share one keyboard-safe modal interaction pattern.

## Risks If the Current Structure Is Kept

- Late guests may wait for a promised seat that never arrives, and a full room provides no useful next action.
- Guests from shared links may take seats under random names that are hard for friends to identify.
- Connection drops and modal keyboard handling can make active turns feel unreliable or inaccessible.
- The host's start gate and ambiguous history/invalid URLs can repeatedly interrupt otherwise short flows.

## Recommended Information Architecture

The current two-route information architecture is sound; no new section or deeper route hierarchy is recommended. The improvements belong in entry, room-state transitions, and controls within those routes.
