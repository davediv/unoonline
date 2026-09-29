# Workers CPU Audit — 2026-09-29

*Audited on 2026-09-29 at commit `b7e2e5f` · Worker: `unoonline` · Scope: entire Worker and `Room` Durable Object · Mode: local microbenchmarks + static scan; production CPU unavailable*
*Runtime: plain fetch handler, client-rendered Vite/React SPA, hibernating Durable Object · compatibility_date `2026-08-05` · no compatibility flags · assets served through Worker first · bindings `ASSETS`, `ROOM`*
*Previous Worker CPU audit: none*

Tick a box only after implementing the item, measuring it locally, and checking behavior. Production numbers belong in the post-deploy column.

## Summary

| Priority | Count | Needs decision | Expected saving |
|---|---:|---:|---|
| Critical | 2 | 1 | Input-size dependent; traffic unknown |
| High | 1 | 1 | All script CPU on bypassed static requests; traffic unknown |
| Medium | 4 | 0 | Per-event savings below; traffic unknown |
| Low | 1 | 0 | Two random draws per named join |

**Total CPU-ms/day and cost saving cannot be estimated** without production invocation counts and CPU measurements. The numbers below are local Node V8 CPU measurements or operation counts, not Worker CPU observations. This audit makes no claim that production p50 or total CPU will fall by a stated amount.

## Baseline

### Sources and configuration

- `wrangler.jsonc:7-62`: one `unoonline` Worker, `worker/index.ts` entry, `/uno` and `/uno/*` zone routes, `workers_dev`, `run_worker_first: true`, `ASSETS`, SQLite-backed `Room` Durable Object, and observability enabled. No `limits`, placement, cron, Queue, KV, D1, R2, or service bindings. The built config in `dist/unoonline/wrangler.json` points to `dist/client` and has no `nodejs_compat` flag.
- `worker/index.ts:34-74`: URL parse → base strip → socket/API route or asset fetch. No middleware chain or SSR. `worker/room.ts:113-130` restores one stored room on DO wake; native WebSocket auto-response handles idle pings. `worker/room.ts:832-896` persists and broadcasts game changes. Client assets are built separately; React, Framer Motion, and Tailwind do not enter the Worker bundle.
- The only listener found at `localhost:5173` belonged to `/Users/div/Desktop/project/balloons-house`; it was excluded. No running URL for this build was supplied. The historical production TTFB in `docs/performance-audit-2026-09-28.md` predates this commit and measures wall time, not CPU.
- The user chose Cloudflare API metrics if credentials were set. `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` were **unset** in this shell, so no API query was made. The deployed build/revision and Workers Logs access were not verified. Route shares, production CPU, errors, CPU-limit exceptions, and requests/day are unknown.

### Production (last 7 days)

| Worker | Requests/day | CPU p50 | CPU p75 | CPU p99 | Errors/day | CPU-ms/day | Est. cost/month |
|---|---|---|---|---|---|---|---|
| `unoonline` | unavailable | unavailable | unavailable | unavailable | unavailable | unavailable | unavailable |
| `Room` DO invocations | unavailable | unavailable | unavailable | unavailable | unavailable | unavailable | unavailable |

Cloudflare's [Workers Analytics GraphQL tutorial](https://developers.cloudflare.com/analytics/graphql-api/tutorials/querying-workers-metrics/) documents request sums and CPU quantiles; [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/) can attribute invocation CPU to URLs and event types. Obtain a seven-day baseline for both the entry Worker and DO, with route/event counts. Do not multiply a median by request count to invent CPU-ms/day. The [current Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) lists $0.02 per additional million CPU-ms on Standard after the included 30 million CPU-ms/month; account plan and actual total usage are unknown, so no dollar estimate is valid.

### Hot-route candidates and work model

No request mix is available, so these are **candidates**, not verified highest-traffic paths. I/O time is excluded from the CPU estimates.

| Route/event | Share | Ordered JavaScript work | Local wall | Response size |
|---|---|---|---|---|
| `GET /uno/`, `/uno/r/:code`, `/uno/assets/*` | unknown | URL parse → base strip → route check → cloned asset Request → `ASSETS.fetch` → hashed response header wrap where applicable (`worker/index.ts:34-104`) | unavailable | unavailable |
| `POST /uno/api/rooms` | unknown | URL parse → code generation → DO RPC → response JSON (`worker/index.ts:107-119`) | unavailable | unavailable |
| `GET /uno/api/rooms/:code` | unknown | URL parse → regex/code check → DO RPC → response JSON (`worker/index.ts:52-55,121-129`) | unavailable | unavailable |
| `GET /uno/ws` upgrade | unknown | URL parse/code check → DO fetch → seat resolution → welcome projection → persist/alarm check → broadcast (`worker/index.ts:131-142`, `worker/room.ts:173-235`) | unavailable | unavailable |
| DO WebSocket message | unknown | rate check → JSON parse → dispatch → state clone for intents → persist → per-socket projection/stringify (`worker/room.ts:288-332,832-896`, `shared/engine.ts:352-360`) | unavailable | unavailable |
| DO alarm | unknown | due timer scan → game/bot operation → persist → per-socket projection/stringify (`worker/room.ts:614-650`) | unavailable | unavailable |

### Bundle, startup, and local CPU

`npm run build` passed. Installed Wrangler 4.118.0 successfully ran `deploy --dry-run --outdir` against the generated Vite deployment config, writing only under `/tmp/uno-worker-audit-2026-09-29-qfsErE/worker-bundle`. The Worker is **74,607 B raw / 20,794 B gzip -9**. Wrangler reported 11 assets and `ROOM`/`ASSETS` bindings. No source map was emitted, so contributor analysis was unavailable. Module scope has static constants and functions; the DO constructor's auto-response setup and storage restore run on wake, not every request. No large server dependency or polyfill was found.

Scratch benchmarks ran with Node v26.8.2 using `process.cpuUsage()` and a representative eight-player state with 56 dealt cards, remaining deck, and 32 pass records. The Node V8 runtime is **not workerd**, and these are CPU estimates rather than production measurements:

| Pure operation | CPU ms/call | Samples |
|---|---:|---:|
| `serializeFor` + `JSON.stringify`, player | 0.003122 | 20,000 |
| `serializeFor` + `JSON.stringify`, spectator | 0.002126 | 20,000 |
| `structuredClone` of room | 0.112546 | 20,000 |
| Rejected `applyIntent` that still clones | 0.123175 | 20,000 |
| `JSON.parse` of 1 MB chat frame | 0.357323 | 1,000 |
| Original crypto RNG, 107 draws | 0.115889 | 5,000 sequences |
| Synthetic 256-word buffered RNG, 107 draws | 0.007962 | 5,000 sequences |

The RNG comparison measures only random draws, not a complete round. Scratch scripts and a Node CPU profile remain outside the repository. Neither local HTTP timing nor a behavior parity capture was possible for this build. Before implementing an item, run this build locally and capture status, `content-type`, `cache-control`, body hash, and WebSocket frame behavior for the affected paths.

## Recommendations

- [ ] **WRK-01 — Bound incoming WebSocket frame work** · Priority: **Critical** · Impact: High under oversized input · Effort: S · Risk: Medium · Decision required: **Yes**
  - **Issue:** `worker/room.ts:288-309,549-553` parses every text frame and runs a global regex over the full chat text before keeping 160 characters. Every socket can send up to 40 frames per three-second local rate window (`worker/room.ts:93-95,948-957`). Input size is not capped in application code. Applies to DO WebSocket messages; malicious-size traffic share is unknown.
  - **Why CPU-intensive:** Parsing a 1 MB frame cost 0.357 ms in the local Node benchmark, before chat cleanup. Work scales with message length; the output does not.
  - **Optimization:** Choose a protocol maximum, check raw frame length before parsing, and reject oversized frames consistently. Example:
    ```ts
    // before
    message = JSON.parse(raw) as ClientMessage;
    // after, if a 4 KiB protocol cap is approved
    if (raw.length > MAX_FRAME_CHARS) { this.send(ws, tooLargeMessage); return; }
    message = JSON.parse(raw) as ClientMessage;
    ```
  - **Expected CPU saving:** About 0.357 ms of JSON parsing per rejected 1 MB frame on Node, plus avoided string scanning; larger inputs save more. CPU-ms/day = oversized frames/day × measured saving after implementation. Normal valid frames should be unchanged.
  - **Files:** `worker/room.ts`, `worker/room.test.ts`, `shared/protocol.ts` if the cap is shared.
  - **Depends on:** —
  - **Decision:** A 4 KiB raw text cap, recommended as ample for the current 160-character chat and small intent payloads, versus another protocol limit. Oversized frames currently receive normal parsing/truncation, so rejection changes that edge-case response and needs product approval.
  - **Measure:** local 1 MB parse/cleanup benchmark; Worker CPU p99 and limit exceptions after deploy; verify normal chat, Unicode, older v1 clients, and rate-limit responses.
  - **Before → After:** pending.

- [ ] **WRK-02 — Stop duplicate pass-record growth** · Priority: **Critical** · Impact: Medium, rising with round length · Effort: S · Risk: Low · Decision required: No
  - **Issue:** `shared/engine.ts:678-680` appends the same `(playerId, color)` pair on every qualifying draw. `shared/bots.ts:241-244` only checks whether a pair exists. With at most eight seats and four colors, unique pairs cap at 32, while current records can grow without bound in a long round. Applies to game intents, bot alarms, state clone, and DO persistence; traffic share unknown.
  - **Why CPU-intensive:** Every subsequent successful intent clones the entire array (`shared/engine.ts:65-66,356`), each persisted room contains it (`worker/room.ts:867-875`), and hard bots scan it. The measured eight-player clone with 32 records costs 0.113 ms; long-round cost will be higher.
  - **Optimization:** Preserve the membership semantics while recording each pair once:
    ```ts
    // before
    if (s.activeColor) s.passRecord.push({ playerId, color: s.activeColor });
    // after
    if (s.activeColor && !s.passRecord.some(r => r.playerId === playerId && r.color === s.activeColor))
      s.passRecord.push({ playerId, color: s.activeColor });
    ```
  - **Expected CPU saving:** Input/round-length dependent. For short rounds, the extra 0–32-item check may cost more than it saves; for long rounds it bounds clone, persistence serialization, and bot scan work. Benchmark realistic 32/320/3,200-record states before selecting implementation. CPU-ms/day requires long-round frequency.
  - **Files:** `shared/engine.ts`, `shared/engine.test.ts`.
  - **Depends on:** —
  - **Measure:** compare repeated-draw state size, clone CPU, bot decision CPU, and Worker/DO CPU p99; verify bot decisions and public snapshots unchanged.
  - **Before → After:** pending.

- [ ] **WRK-03 — Let matching static assets bypass the Worker** · Priority: **High** · Impact: Unknown until asset request share is measured · Effort: L · Risk: High · Decision required: **Yes**
  - **Issue:** `wrangler.jsonc:39-50` sets `run_worker_first: true` for all `/uno` requests because the built manifest is rooted at `/`, whereas browser paths are `/uno/*`. Every static request traverses `worker/index.ts:34-104`. Hashed assets already receive immutable browser caching; repeat visits may generate few invocations.
  - **Why CPU-intensive:** Even a static hit runs routing JS, allocates URL/Request/header objects, and wraps the response. Static asset traffic share and actual script CPU are unknown.
  - **Optimization:** Re-root the deployment asset manifest under `/uno`, use selective Worker-first patterns for API/WebSocket and any needed SPA behavior, and express immutable headers for directly served hashes. Preserve unknown-chunk 404 and `/uno/r/:code` fallback. Conceptual config:
    ```jsonc
    // before
    "run_worker_first": true
    // after, only once /uno assets and behavior are proven equivalent
    "run_worker_first": ["/uno/api/*", "/uno/ws"]
    ```
  - **Expected CPU saving:** All Worker script CPU on each bypassed static request; numeric ms/request and CPU-ms/day need Workers Logs route samples and a parity prototype. Direct asset requests may also stop counting as Worker invocations under Cloudflare's [asset billing rules](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/). Do not treat this as ready from a config toggle alone.
  - **Files:** `wrangler.jsonc`, `vite.config.ts`, `worker/index.ts`, deployment asset/header generation, asset tests.
  - **Depends on:** —
  - **Decision:** Keep the current prefix bridge, or approve an asset-layout and routing change. Recommend the latter only if logs show static requests contribute material Worker CPU and a local/prod parity test proves the same responses.
  - **Measure:** per-path Worker invocation count and CPU before/after, bundle/build output, status/header/body hashes for HTML, assets, SPA routes, missing chunks, and redirects.
  - **Before → After:** pending.

- [ ] **WRK-04 — Skip a no-op commit on spectator join** · Priority: **Medium** · Impact: Unknown · Effort: S · Risk: Medium · Decision required: No
  - **Issue:** An existing-room spectator join receives its welcome, then `worker/room.ts:226-235` calls `commit` with no events and no room-state change. `commit` schedules timers, rewrites the full room, checks the alarm, and sends a fresh sync to every socket (`worker/room.ts:832-839,882-896`). Current join/spectator share is unknown.
  - **Optimization:** Track whether this connection created or changed room state; when it did not, return after welcome. Preserve `create=1` room initialization and any waiting-spectator promotion flow.
    ```ts
    // before
    await this.commit(events, now);
    // after (only for an existing room and unchanged spectator join)
    if (roomChanged) await this.commit(events, now);
    ```
  - **Expected CPU saving:** One timer scan, one full persistence operation, and one projection/frame per existing socket per qualifying join. Node projection/stringify estimate: ~0.002–0.003 ms × socket count, excluding storage and runtime framing. CPU-ms/day needs spectator-join count.
  - **Files:** `worker/room.ts`, `worker/room.test.ts`.
  - **Depends on:** —
  - **Measure:** count storage writes and frames in integration tests; benchmark projection path; compare join welcome and subsequent frames exactly; measure DO CPU p50 after deploy.
  - **Before → After:** pending.

- [ ] **WRK-05 — Reuse one spectator sync frame per commit** · Priority: **Medium** · Impact: Unknown · Effort: M · Risk: Medium · Decision required: No
  - **Issue:** `worker/room.ts:882-896,927-929` builds a viewer-specific snapshot and JSON string for every socket. All spectators have the same `viewerId: null` and event visibility, so their state sync bytes can be identical. There is no seat cap for spectators; player views must remain separate.
  - **Optimization:** Lazily create one serialized spectator frame within each `sendSync` call and send that exact string to spectators; keep existing per-player projection and filtering. Example:
    ```ts
    // before, each spectator
    this.send(socket, { t: 'sync', room: serializeFor(state, null, now), events: visible });
    // after, one value scoped to this commit
    spectatorFrame ??= JSON.stringify({ t: 'sync', room: serializeFor(state, null, now), events: visible });
    socket.send(spectatorFrame);
    ```
  - **Expected CPU saving:** `(spectators - 1) × ~0.002126 ms` per sync in the eight-player Node benchmark, plus per-socket event-filter savings if shared; zero with one spectator. CPU-ms/day needs spectator count and state transitions/day.
  - **Files:** `worker/room.ts`, `worker/room.test.ts`.
  - **Depends on:** —
  - **Measure:** CPU benchmark at 1/5/20 spectators; byte-for-byte frame comparison, especially private events and promoted spectators; DO CPU by WebSocket event after deploy.
  - **Before → After:** pending.

- [ ] **WRK-06 — Buffer crypto words for shuffles** · Priority: **Medium** · Impact: Low to Medium · Effort: S · Risk: Medium · Decision required: No
  - **Issue:** `shared/rng.ts:23-34` allocates a one-word array and calls `crypto.getRandomValues` for each random integer. `shared/deck.ts:74-82` uses 107 draws for a 108-card initial shuffle (`shared/engine.ts:211`). Most messages do not shuffle.
  - **Optimization:** Refill a bounded `Uint32Array(256)` when exhausted and keep the same rejection-sampling limit, cryptographic source, and integer range. Example:
    ```ts
    // before, inside each draw
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    // after, only when exhausted
    if (offset === words.length) { crypto.getRandomValues(words); offset = 0; }
    const value = words[offset++];
    ```
  - **Expected CPU saving:** A synthetic Node CPU benchmark of 107 draws was **0.115889 → 0.007962 ms**, or ~0.108 ms per shuffle loop; complete round savings and workerd CPU are unverified. CPU-ms/day = shuffles/day × confirmed saving.
  - **Files:** `shared/rng.ts`, `shared/rng` or deck tests.
  - **Depends on:** —
  - **Measure:** same 107-draw CPU benchmark, random bounds/distribution and rejection tests, start-round parity invariants, DO alarm/round CPU after deploy. Exact random card order is intentionally nondeterministic.
  - **Before → After:** pending.

- [ ] **WRK-07 — Remove redundant room clone on round setup** · Priority: **Medium** · Impact: Low to Medium · Effort: M · Risk: Medium · Decision required: No
  - **Issue:** `shared/engine.ts:286-305` clones room state, then `startRound` clones it again at `shared/engine.ts:190-191`. Only start/next-round paths are affected. The larger `applyIntent` path also clones before dispatch (`shared/engine.ts:352-360`), but preserving atomic failure behavior makes a general refactor riskier.
  - **Optimization:** Pass a private mutable draft into round setup after exactly one clone; retain the exported pure `startRound` behavior.
    ```ts
    // before
    const base = clone(state);
    return startRound(base, startIndex, ctx); // clones again
    // after
    const base = clone(state);
    return startRoundDraft(base, startIndex, ctx); // private, mutates base
    ```
  - **Expected CPU saving:** Approximately one room clone per round start, ~0.113 ms for the representative eight-player Node state; actual round-start state size and Worker CPU may differ. CPU-ms/day needs round starts/day.
  - **Files:** `shared/engine.ts`, `shared/engine.test.ts`.
  - **Depends on:** —
  - **Measure:** `startMatch`/`startNextRound` CPU benchmark and full game-engine parity tests; DO CPU on round-start events after deploy.
  - **Before → After:** pending.

- [ ] **WRK-08 — Avoid unused nickname randomness** · Priority: **Low** · Impact: Low · Effort: S · Risk: Low · Decision required: No
  - **Issue:** `worker/room.ts:254-257` eagerly calls `randomNickname(cryptoRng)` as the `cleanName` fallback even when a valid name is supplied, causing two unnecessary crypto draws (`shared/room.ts:41-45`). Applies to new WebSocket joins with names; share unknown.
  - **Optimization:** Clean once and generate a random fallback only when the cleaned result would be empty; preserve `cleanName` rules and generated-name behavior.
    ```ts
    // before
    const name = cleanName(rawName, randomNickname(cryptoRng));
    // after
    const name = cleanName(rawName, '');
    const finalName = name || randomNickname(cryptoRng);
    ```
  - **Expected CPU saving:** Two cryptographic draws per valid named join; likely below 0.01 ms/join, unmeasured, and possibly absorbed by WRK-06.
  - **Files:** `worker/room.ts`, `worker/room.test.ts`.
  - **Depends on:** WRK-06 only if benchmarking the independent saving after RNG buffering.
  - **Measure:** named-join RNG-call count and local CPU benchmark; exact welcome-name parity; DO CPU on upgrades after deploy.
  - **Before → After:** pending.

## Action Plan

### High impact / Low effort — do first

- WRK-01 — decide the maximum frame size, then bound parse work.
- WRK-02 — deduplicate pass records if long-round benchmarking confirms a net saving.
- WRK-04 — remove unchanged spectator-join commit after checking frame parity.

### High impact / Medium–High effort

- WRK-03 — prototype direct asset serving only after production route CPU shows material static cost.
- WRK-05 — reuse spectator frames if rooms commonly have multiple watchers.

### Low impact

- WRK-06 — buffer shuffle randomness; microbenchmarked, infrequent path.
- WRK-07 — remove one clone per round start.
- WRK-08 — generate nickname only when needed.

### Architectural changes

- WRK-03 changes the deployment asset layout and which requests reach the Worker; it needs a separate routing decision and full parity check.

## Needs Your Decision

- **WRK-01:** Select an incoming WebSocket frame cap. Recommend 4 KiB for the current protocol, with an explicit oversized-frame error. This changes the response to oversized inputs.
- **WRK-03:** Keep the current prefix bridge or authorize a selective Worker-first asset layout. Recommend a prototype only if production route counts and CPU justify it.

## Risks If the Current State Is Kept

- Oversized frames can spend CPU parsing and scanning content that will be truncated to 160 chat characters. Application code currently has no size guard before parse.
- Repeated pass records can grow throughout a long round, raising clone, storage, and bot lookup work even though only pair membership is used.
- Spectator joins and broadcasts scale with socket count. Without spectator counts and CPU logs, their cost cannot be ranked against static asset routing or game-engine work.

## Success Criteria Scorecard

| Worker / route | Metric | Before (production) | After (local / estimated) | After (production, post-deploy) |
|---|---|---|---|---|
| `unoonline` | CPU p50 / p99 | unavailable | pending | pending |
| `unoonline` | requests/day, errors/day | unavailable | pending | pending |
| `unoonline` | CPU-ms/day, estimated cost/month | unavailable | pending | pending |
| `Room` DO | CPU p50 / p99, CPU-ms/day | unavailable | pending | pending |
| static routes | Worker invocations and CPU/request | unavailable | pending | pending |
| WS messages / alarms | DO CPU/request | unavailable | pending | pending |
| `unoonline` | bundle gzip | unavailable | 20,794 B baseline | pending |

## Post-deploy Verification

- [ ] Before implementation, capture seven days of Worker and DO CPU p50/p75/p99, actual aggregate CPU-ms/day or a valid sum, requests/events per day, errors, and per-route/event logs.
- [ ] Before implementation, run this build locally and save status, `content-type`, `cache-control`, body hash, and representative WebSocket frames for the affected paths.
- [ ] 24–48 hours after deploy, enter production CPU p50/p99 and CPU-ms/day above at a comparable traffic mix.
- [ ] Confirm error rate and CPU-limit exceptions are unchanged or lower.
- [ ] Confirm static asset invocation counts, cache behavior, and 404/SPA behavior if WRK-03 lands.
- [ ] Spot-check the parity set and private-hand isolation in production.

## Sources

- [Cloudflare Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [Cloudflare Workers Analytics GraphQL example](https://developers.cloudflare.com/analytics/graphql-api/tutorials/querying-workers-metrics/)
- [Cloudflare Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)
- [Cloudflare static asset routing and `run_worker_first`](https://developers.cloudflare.com/workers/static-assets/binding/)
- [Cloudflare Wrangler dry-run bundling](https://developers.cloudflare.com/workers/wrangler/bundling/)
