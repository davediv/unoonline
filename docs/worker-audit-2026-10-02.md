# Workers CPU Audit — 2026-10-02

*Audited on 2026-10-02 at commit `6fced5d` · Worker: `unoonline` · Scope: entire Worker and `Room` Durable Object · Mode: local CPU microbenchmarks + static review; production unavailable*
*Runtime: plain fetch handler, Vite/React client SPA, hibernating SQLite-backed DO · compatibility_date `2026-08-05` · no compatibility flags · assets via Worker first · bindings `ASSETS`, `ROOM`*
*Previous audit: `docs/worker-audit-2026-09-29.md` — all 8 open IDs carried forward; no new standalone findings.*

Tick an item only after implementation, local measurement and behavior verification. Source implementation follows the selected recommendations below; no deployment is performed. The prior audit commit is the only commit after the prior audited source revision; the request paths remain unchanged.

## Summary

| Priority | Count | Needs decision | Local estimated saving on affected path |
|---|---:|---:|---|
| Critical | 2 | 1 | 0.447 ms parsing per rejected 1 MiB chat frame; ~1.024 ms/clone at 3,200 versus 32 records |
| High | 1 | 1 | All entry-script CPU on bypassed asset requests; unmeasured |
| Medium | 4 | 1 | Frame reuse ~0.057 ms/sync with 20 watchers; crypto draw loop ~0.113 ms/shuffle; lobby clone ~0.009 ms/start; join write CPU unknown |
| Low | 1 | 0 | Two RNG calls per valid named fresh join |

**Total saving per request, CPU-ms/day and monthly cost are unavailable.** Different savings affect different event types; summing them would invent a traffic mix and double-count some work. Production p50/p99, route shares, room spectator counts, and event frequencies remain unknown. Three items need a decision; WRK-04 was previously incorrectly labeled safe when removing its sync broadcast.

## Baseline

### Sources and configuration

- One Worker: `wrangler.jsonc:7-74`, entry `worker/index.ts`, routes `parebaik.com/uno` and `parebaik.com/uno/*`, preview workers.dev enabled. Assets have SPA fallback, `ASSETS`, `run_worker_first: true`. `ROOM` maps to class `Room`, migration `v1` uses SQLite. Observability and source-map upload enabled. No `limits`, placement, cron, queue, KV, D1, R2, service, AI or Hyperdrive bindings; no `nodejs_compat`.
- npm/package-lock; installed Wrangler 4.118.0, build Vite 8.2.0, benchmark Node v24.21.0. `npm run build` passed; outputs stay in ignored `dist` and `node_modules/.tmp`. Wrangler dry-run used the freshly generated `dist/unoonline/wrangler.json` and temporary output only.
- `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are unset (values never printed). The user selected code and local microbenchmark estimates; this audit records that baseline only. No authenticated API query or production mutation was made. Intended seven-day window: 2026-09-25 through 2026-10-02.
- No running URL was supplied and no dev server was started. Existing unrelated or internal listeners were excluded. Local HTTP timing, response parity and workerd inspector profiling are unavailable. No production URL was used to substitute for this unverified build.
- Independent read-only reviews covered lifecycle/middleware, computation, bundle/startup and caching/offloading. Key files read: `worker/index.ts`, `worker/room.ts`, `shared/engine.ts`, `shared/bots.ts`, `shared/rng.ts`, `shared/deck.ts`, `shared/room.ts`, `shared/protocol.ts`, `shared/types.ts`, `client/lib/useRoom.ts`, Worker/test/build configuration and previous audit.

### Production (last 7 days)

| Worker | Requests/day | CPU p50 | CPU p75 | CPU p99 | Errors/day | CPU-ms/day | Est. cost/month |
|---|---|---|---|---|---|---|---|
| `unoonline` | unavailable | unavailable | unavailable | unavailable | unavailable | unavailable | unavailable |
| `Room` event invocations | unavailable | unavailable | unavailable | unavailable | unavailable | unavailable | unavailable |

Use invocation logs with URL/event type for attribution; Worker-wide GraphQL aggregates do not establish individual route CPU. Validate the account's current GraphQL schema before querying quantiles; the tutorial's example is not a guaranteed CPU field contract. A median × invocation count is not total CPU. Obtain an aggregate CPU sum or a valid mean × count.

Billing distinction: [Workers Standard pricing](https://developers.cloudflare.com/workers/platform/pricing/) currently includes 30 million CPU-ms/month, then $0.02 per additional million CPU-ms. [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) meters active wall-clock duration, requests and storage; most recommendations execute inside `Room`, so their CPU reductions cannot be converted using the entry Worker's CPU rate. Savings need actual duration, plan, thresholds and traffic data. Existing hibernation and runtime auto-response already avoid idle application ping work.

The [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) distinguish CPU from I/O wait and document 10 ms HTTP CPU on Free and a 30-second default on Paid (up to 5 minutes). This does not prove which plan applies here or establish DO-specific limits. No limit increase is recommended.

### Hot-route candidates and work model

These are structural candidates, not verified top traffic. Their shares and total CPU are unknown; numeric values isolate pure JS and exclude I/O.

| Route/event | Share | Ordered work and measured component | Local wall median | Response bytes |
|---|---|---|---|---|
| `GET /uno/`, `/uno/r/:code`, `/uno/assets/*` | unknown | URL/base/routing → rewritten asset Request → `ASSETS.fetch` → header wrapper on hashes (`worker/index.ts:34-104`); no SSR | unavailable | unavailable |
| `POST /uno/api/rooms` | unknown | route → six code RNG draws → DO RPC (up to 8 attempts) → response JSON (`:107-119`) | unavailable | unavailable |
| `GET /uno/api/rooms/:code` | unknown | route regex/code validation → DO RPC → small JSON (`:52-55,121-129`) | unavailable | unavailable |
| `GET /uno/ws` upgrade | unknown | upgrade/code check → DO fetch → seat resolution/welcome → schedule/persist/alarm → sync (`worker/room.ts:173-235`); ~0.003–0.004 ms/view projection + stringify | unavailable | unavailable |
| DO game message | unknown | rate check → parse → pure intent clone/dispatch → narration/timers/persist → per-socket sync (`:288-332,832-896`); clone ~0.065 ms at 32 records | unavailable | unavailable |
| DO chat / alarm | unknown | chat parse/cleanup → persist → compact v2 frame or legacy projection; alarm due timer dispatch → game/bot intent → commit (`:549-553,614-650,843-864`) | unavailable | unavailable |

No global auth/session verification middleware, SSR/markdown/highlighting, compression, JS hash/crypto library, parse/stringify proxy, personalized shared cache, heavyweight server dependency, or cross-service pass-through was found. Player hand projections remain private. Cacheable static responses already stream asset bodies; room API is `no-store`. Sharing personalized player snapshots is not recommended. Queues/Workflows would change game authority/ordering and are not justified by the current evidence.

### Bundle & startup

`npm run build` and installed `wrangler deploy --dry-run --config dist/unoonline/wrangler.json --outdir <scratch>/worker-bundle` passed. [Wrangler bundling docs](https://developers.cloudflare.com/workers/wrangler/bundling/) support dry-run inspection.

- Bundle: **74,607 B raw / 20,838 B gzip (level 9)**. Prior report: 74,607 B / 20,794 B; unchanged raw size, 44 B gzip difference, not an optimization or a measured runtime regression. Toolchain/environment reproducibility was not established.
- Wrangler reports 11 asset files and the expected ROOM/ASSETS bindings. Client React/Motion/Tailwind are separate bundles; the entry bundle has local Worker/shared modules and platform imports. No source map emitted in dry-run despite upload enabled, so numeric contributor ranking unavailable.
- Module scope initializes small constants, regex and function exports. Constructor sets native ping auto-response and restores one stored room on wake (`worker/room.ts:113-130`). Startup CPU is unmeasured; no heavyweight module initialization found.

### Local CPU microbenchmarks

Scratch: `/tmp/uno-worker-audit-2026-10-02-yKhfcN/`. Installed esbuild bundled the actual shared engine/RNG/helpers for Node; no packages installed. `bench.mjs` ran with `node --cpu-prof --cpu-prof-dir=<scratch>` and `process.cpuUsage()` (user + system). Figures are medians of five batches after warmup. Fixture: seeded eight-player game with all 108 cards represented; pass records are synthetic duplicate memberships. Retained output prevents unused-result elimination. Node V8 is not workerd; CPU profiles and scripts remain temporary and are not deployment artifacts.

| Operation | CPU ms/call | Iterations/batch |
|---|---:|---:|
| Room clone, 32 records / 8,783 B JSON | 0.064612 | 2,000 |
| Room clone, 320 records / 18,431 B JSON | 0.159994 | 2,000 |
| Room clone, 3,200 records / 114,911 B JSON | 1.088200 | 2,000 |
| Player projection + sync stringify | 0.003991 | 10,000 |
| Spectator projection + sync stringify | 0.002974 | 10,000 |
| Rejected PLAY intent (clones before rejection) | 0.065204 | 2,000 |
| Parse 1 MiB chat text | 0.447306 | 500 |
| Existing crypto RNG, 107 draws | 0.113250 | 2,000 |
| Synthetic buffered RNG, 107 draws | 0.000734 | 2,000 |
| Complete seeded 8-player startMatch (including fixture creation) | 0.025567 | 2,000 |
| Clone 8-player lobby, 1,677 B JSON (`bench-extra.mjs`) | 0.009131 | 10,000 |
| 1 spectator frame, original / synthetic reuse | 0.002975 / 0.003013 | 10,000 |
| 5 spectator frames, original / synthetic reuse | 0.014812 / 0.003012 | 10,000 |
| 20 spectator frames, original / synthetic reuse | 0.059558 / 0.003048 | 10,000 |

Candidate reuse and buffered RNG exist only in scratch. They do not prove complete handler saving or parity. No standalone repeated RNG microbenchmark was used for nickname savings, because batching changes its independent saving.

### Behavior parity set

Unavailable without a supplied running build URL. Before source implementation, capture HTTP status, content-type, cache-control and normalized body hash for home, SPA room, known/missing assets, room lookup and redirects. Capture WebSocket welcome/sync/chat/error sequences for player and spectator v1/v2, promotion, reconnection and private events using installed Worker tests. No HTTP or WebSocket parity pass is claimed by this audit.

## Recommendations

- [ ] **WRK-01 — Bound incoming WebSocket frame work** · Priority: **Critical** · Impact: High under oversized input · Effort: S · Risk: Medium · Decision required: **Yes**
  - *Carried over from 2026-09-29; verified against current source.*
  - **Issue:** `worker/room.ts:288-309,549-553` parses every text frame and runs a global regex over the full chat text before keeping 160 characters. Every socket can send up to 40 frames per three-second local rate window (`worker/room.ts:93-95,948-957`). Input size is not capped in application code. Applies to DO WebSocket messages; malicious-size traffic share is unknown.
  - **Why CPU-intensive:** Parsing a 1 MiB-text frame cost 0.447 ms in the local Node benchmark, before chat cleanup. Work scales with message length; the output does not.
  - **Optimization:** Choose a protocol maximum, check raw frame length before parsing, and reject oversized frames consistently. Example:
    ```ts
    // before
    message = JSON.parse(raw) as ClientMessage;
    // after, if a 4,096 UTF-16-code-unit protocol cap is approved
    if (raw.length > MAX_FRAME_CHARS) { this.send(ws, tooLargeMessage); return; }
    message = JSON.parse(raw) as ClientMessage;
    ```
  - **Expected CPU saving:** About 0.447 ms of JSON parsing per rejected 1 MiB-text frame on Node, plus avoided string scanning; larger inputs save more. CPU-ms/day = oversized frames/day × measured saving after implementation. Normal valid frames should be unchanged.
  - **Files:** `worker/room.ts`, `worker/room.test.ts`, `shared/protocol.ts` if the cap is shared.
  - **Depends on:** —
  - **Decision:** A 4,096 UTF-16-code-unit raw text cap, recommended as ample for the current 160-character chat and small intent payloads, versus a UTF-8 byte limit or another maximum. `raw.length` is constant-time but counts UTF-16 code units, not bytes; document this explicitly. A byte-oriented guard must avoid scanning/allocating the entire rejected payload. Oversized frames currently receive normal parsing/truncation, so rejection changes that edge-case response and needs product approval.
  - **Measure:** local 1 MiB parse/cleanup benchmark; Worker CPU p99 and limit exceptions after deploy; verify normal chat, Unicode, older v1 clients, and rate-limit responses.
  - **Cost/day:** unavailable: production event counts and deployed CPU are unknown. DO savings must be modeled with DO active duration/storage billing, not the Worker CPU-ms rate.
  - **Before → After:** pending; all candidate numbers above are benchmarks, not implemented changes.

- [x] **WRK-02 — Stop duplicate pass-record growth** · Priority: **Critical** · Impact: Medium, rising with round length · Effort: S · Risk: Low · Decision required: No · done 2026-10-03
  - *Carried over from 2026-09-29; verified against current source.*
  - **Issue:** `shared/engine.ts:678-680` appends the same `(playerId, color)` pair on every qualifying draw. `shared/bots.ts:241-244` only checks whether a pair exists. With at most eight seats and four colors, unique pairs cap at 32, while current records can grow without bound in a long round. Applies to game intents, bot alarms, state clone, and DO persistence; traffic share unknown.
  - **Why CPU-intensive:** Every subsequent successful intent clones the entire array (`shared/engine.ts:65-66,356`), each persisted room contains it (`worker/room.ts:867-875`), and hard bots scan it. Fresh local measurements: 32 records = 0.064612 ms / 8,783 B state JSON; 320 = 0.159994 ms / 18,431 B; 3,200 = 1.088200 ms / 114,911 B. The record colors use the actual red/yellow/green/blue values. Synthetic repetition models long rounds, not observed traffic.
  - **Optimization:** Preserve the membership semantics while recording each pair once:
    ```ts
    // before
    if (s.activeColor) s.passRecord.push({ playerId, color: s.activeColor });
    // after
    if (s.activeColor && !s.passRecord.some(r => r.playerId === playerId && r.color === s.activeColor))
      s.passRecord.push({ playerId, color: s.activeColor });
    ```
  - **Expected CPU saving:** Input/round-length dependent. For short rounds, the extra 0–32-item check may cost more than it saves; for long rounds it bounds clone, persistence serialization, and bot scan work. Avoiding 3,168 duplicates saves about 1.024 ms per subsequent clone in the synthetic long-round fixture; 320 versus 32 saves about 0.095 ms. Append deduplication only bounds new rounds: existing persisted duplicates remain until reset unless separately normalized. Recommend bounding new records first, with existing-state normalization evaluated in implementation. CPU-ms/day requires long-round frequency.
  - **Files:** `shared/engine.ts`, `shared/engine.test.ts`.
  - **Depends on:** —
  - **Measure:** compare repeated-draw state size, clone CPU, bot decision CPU, and Worker/DO CPU p99; verify bot decisions and public snapshots unchanged.
  - **Cost/day:** unavailable: production event counts and deployed CPU are unknown. DO savings must be modeled with DO active duration/storage billing, not the Worker CPU-ms rate.
  - **Before → After:** Actual before/after engine run: 3,200 successful draws on a two-seat, exhausted-deck fixture produced 3,200 → 2 records, state JSON 100,097 → 959 B, and subsequent clone CPU 1.130489 → 0.006862 ms (median five × 2,000 clones, Node V8). Player/spectator projections matched; all 128 shared tests passed including duplicate draw/color/purity regression, plus lint and typecheck/build. Formatting check unavailable (no formatter configured). New rounds are bounded; legacy persisted duplicates are intentionally left until reset. Scratch: bench-pass.mjs.

- [ ] **WRK-03 — Let matching static assets bypass the Worker** · Priority: **High** · Impact: Unknown until asset request share is measured · Effort: L · Risk: High · Decision required: **Yes**
  - *Carried over from 2026-09-29; verified against current source.*
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
  - **Cost/day:** unavailable: production route counts and entry-script CPU are unknown. Workers CPU pricing and direct-asset invocation changes apply to this item.
  - **Before → After:** pending; all candidate numbers above are benchmarks, not implemented changes.

- [ ] **WRK-04 — Decide spectator-join sync behavior before skipping commit** · Priority: **Medium** · Impact: Unknown · Effort: S · Risk: Medium · Decision required: **Yes**
  - *Carried over from 2026-09-29; corrected behavior assessment.*
  - **Issue:** Existing-room spectator joins welcome the newcomer and then run `commit` (`worker/room.ts:226-235,832-838`), which schedules, persists, and broadcasts a sync to every socket. Share of joins is unknown.
  - **Why CPU-intensive:** Repeats room persistence and projection/stringify per socket when game state is unchanged. Fresh view benchmark: ~0.003–0.004 ms/view, excluding storage/framing.
  - **Optimization:** Option A preserves every sync frame and only avoids demonstrably redundant persistence/scheduling for an unchanged existing room. Option B skips the entire commit and broadcasts. Proposed Option A shape:
    ```ts
    // before
    await this.commit(events, now);
    // after, with complete existing-room/no-change predicate
    if (unchangedExistingSpectatorJoin) this.sendSync([], [], now);
    else await this.commit(events, now);
    ```
  - **Expected CPU saving:** Option A: one scheduling/persistence pass, CPU unmeasured. Option B additionally removes ~0.003–0.004 ms per connected view. Neither is an established workerd saving; storage wait is not CPU. CPU-ms/day requires qualifying joins/day.
  - **Decision:** **Recommended: A**, preserving the current welcome + sync and existing clients' clock updates (`client/lib/useRoom.ts:190-196`). B visibly changes the wire stream and clock updates. Never skip initialization for `create=1&spectate=1`; retain cleanup timer setup. Existing cleanup deadlines are not extended on spectator join (`worker/room.ts:817-823`).
  - **Files:** `worker/room.ts`, `worker/room.test.ts`.
  - **Depends on:** —
  - **Measure:** storage/timer operation counts, complete welcome/sync frame sequences and timestamps, initialization/promotion cases, DO CPU and active duration after deploy.
  - **Before → After:** pending; no source changed.

- [x] **WRK-05 — Reuse one spectator sync frame per commit** · Priority: **Medium** · Impact: Unknown · Effort: M · Risk: Medium · Decision required: No · done 2026-10-03
  - *Carried over from 2026-09-29; verified against current source.*
  - **Issue:** `worker/room.ts:882-896,927-929` builds a viewer-specific snapshot and JSON string for every socket. All spectators have the same `viewerId: null` and event visibility, so their state sync bytes can be identical. There is no seat cap for spectators; player views must remain separate.
  - **Optimization:** Lazily create one serialized spectator frame within each `sendSync` call and send that exact string to spectators; keep existing per-player projection and filtering. Example:
    ```ts
    // before, each spectator
    this.send(socket, { t: 'sync', room: serializeFor(state, null, now), events: visible });
    // after, one value scoped to this commit
    spectatorFrame ??= JSON.stringify({ t: 'sync', room: serializeFor(state, null, now), events: visible });
    socket.send(spectatorFrame);
    ```
  - **Expected CPU saving:** `(spectators - 1) × ~0.002974 ms` per sync in the eight-player Node benchmark, plus per-socket event-filter savings if shared; no demonstrated saving with one spectator. Synthetic frame reuse measured 5 watchers: 0.014812 → 0.003012 ms; 20 watchers: 0.059558 → 0.003048 ms. This isolates projection/stringification; excludes event filtering, attachment reads and WebSocket sending. Both v1/v2 use the same game sync, but `commitChat` has different protocol shapes (`worker/room.ts:843-864`); do not share a full sync with compact v2 chat. Preserve send exception handling. CPU-ms/day needs spectator count and state transitions/day.
  - **Files:** `worker/room.ts`, `worker/room.test.ts`.
  - **Depends on:** —
  - **Measure:** CPU benchmark at 1/5/20 spectators; byte-for-byte frame comparison, especially private events and promoted spectators; DO CPU by WebSocket event after deploy.
  - **Cost/day:** unavailable: production event counts and deployed CPU are unknown. DO savings must be modeled with DO active duration/storage billing, not the Worker CPU-ms rate.
  - **Before → After:** Extracted actual sendSync/send methods before/after with event filtering: 1 spectator 0.004672 → 0.004552 ms, 5 spectators 0.022129 → 0.004298 ms, 20 spectators 0.068325 → 0.003521 ms (Node CPU medians, five × 10,000 broadcasts). Exact mixed player/spectator frame bytes and closed-socket continuation matched. Real workerd integration verifies equal v1/v2 spectator bytes, hidden hands, and recipient-only private events; all 27 Worker tests passed, plus lint and typecheck/build. Corrected existing privacy assertion to compare complete quoted card IDs rather than substrings inside UUIDs. Chat paths unchanged. Scratch: bench-sync.mjs.

- [x] **WRK-06 — Buffer crypto words for shuffles** · Priority: **Medium** · Impact: Low to Medium · Effort: S · Risk: Medium · Decision required: No · done 2026-10-03
  - *Carried over from 2026-09-29; verified against current source.*
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
  - **Expected CPU saving:** A synthetic Node CPU benchmark of 107 draws was **0.113250 → 0.000734 ms**, or ~0.112516 ms per shuffle loop; complete round savings and workerd CPU are unverified. CPU-ms/day = shuffles/day × confirmed saving.
  - **Files:** `shared/rng.ts`, `shared/rng` or deck tests.
  - **Depends on:** —
  - **Measure:** same 107-draw CPU benchmark, random bounds/distribution and rejection tests, start-round parity invariants, DO alarm/round CPU after deploy. Exact random card order is intentionally nondeterministic.
  - **Cost/day:** unavailable: production event counts and deployed CPU are unknown. DO savings must be modeled with DO active duration/storage billing, not the Worker CPU-ms rate.
  - **Before → After:** Actual exported RNG: 107 draws 0.105753 → 0.006970 ms; full 8-player crypto startMatch 0.139815 → 0.029834 ms (Node CPU median five × 5,000, fixture setup outside timed loop). Buffer is 256 words / 1 KiB, lazily refilled from the same native cryptographic source; rejection limit unchanged. Tests cover crossing refill during rejection, no draw for max=1, batch consumption, and integer/range bounds. All 131 shared and 27 workerd tests plus lint and typecheck/build passed. Random exact deck order intentionally nondeterministic; seeded engine and wire privacy invariants passed. Scratch: bench-rng.mjs.

- [ ] **WRK-07 — Remove redundant room clone on round setup** · Priority: **Medium** · Impact: Low to Medium · Effort: M · Risk: Medium · Decision required: No
  - *Carried over from 2026-09-29; verified against current source.*
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
  - **Expected CPU saving:** One clone per successful round setup. Fresh eight-player lobby clone: ~0.009131 ms, versus complete seeded `startMatch` ~0.025567 ms. The previous report used a dealt-room clone to estimate lobby-start saving; that overestimated this path. Next-round states include remaining cards and result hands, so must be measured separately before claiming their saving. CPU-ms/day needs round starts/day.
  - **Files:** `shared/engine.ts`, `shared/engine.test.ts`.
  - **Depends on:** —
  - **Measure:** `startMatch`/`startNextRound` CPU benchmark and full game-engine parity tests; DO CPU on round-start events after deploy.
  - **Cost/day:** unavailable: production event counts and deployed CPU are unknown. DO savings must be modeled with DO active duration/storage billing, not the Worker CPU-ms rate.
  - **Before → After:** pending; all candidate numbers above are benchmarks, not implemented changes.

- [ ] **WRK-08 — Avoid unused nickname randomness** · Priority: **Low** · Impact: Low · Effort: S · Risk: Low · Decision required: No
  - *Carried over from 2026-09-29; verified against current source.*
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
  - **Cost/day:** unavailable: production event counts and deployed CPU are unknown. DO savings must be modeled with DO active duration/storage billing, not the Worker CPU-ms rate.
  - **Before → After:** pending; all candidate numbers above are benchmarks, not implemented changes.


## Action Plan

### High impact / Low effort — do first

- WRK-02 — bound new pass records; verify membership behavior and long-round clone saving.
- WRK-01 — choose size semantics and rejection behavior before limiting frames.

### High impact / Medium–High effort

- WRK-03 — obtain route CPU/counts before prototyping asset-layout changes.
- WRK-05 — reuse spectator frames if room watcher counts justify it; maintain per-player privacy.

### Low impact

- WRK-06 — bounded crypto draw buffering; strongest measured safe synthetic candidate.
- WRK-07 — remove one redundant clone with realistic round-start/next-round fixtures.
- WRK-08 — lazy nickname fallback; benchmark after WRK-06 to avoid counting the same RNG benefit twice.
- WRK-04 — preserve broadcasts while avoiding redundant work, or explicitly approve fewer sync frames.

### Architectural changes

- WRK-03 — re-root assets and choose Worker bypass paths; requires full redirect/SPA/cache/404 parity.

## Needs Your Decision

- WRK-01: recommend a 4,096 UTF-16-code-unit text-frame cap with a consistent oversized-frame error; alternative byte semantics/limit requires a different bounded guard.
- WRK-03: retain prefix bridge until production data supports a selective Worker-first asset prototype.
- WRK-04: recommend preserving sync broadcasts (A), then measure scheduling/persistence removal; skipping all broadcasts (B) changes clock-update behavior.
- User selected the safe set: WRK-02, WRK-05, WRK-06, WRK-07, WRK-08, sequentially, each measured and committed separately. Implementation proceeds sequentially with one measured commit per selected item.

## Risks If the Current State Is Kept

- Oversized frames scan/parse content that is mostly discarded; the local rate guard does not bound per-frame work.
- Duplicate pass records increase cloning, persisted size and bot-view copy/lookup work as a round lengthens. Legacy records need separate consideration.
- Spectator projection work scales with connected watcher count. Static invocation costs depend on browser caching and traffic mix.
- No production evidence currently establishes CPU-limit exceptions or dollar savings; prioritize operations and acquire logs rather than claim a p50 or bill reduction.

## Success Criteria Scorecard

Audit-only: After columns remain pending. Local baseline values are references, not implemented results.

| Worker / route | Metric | Before (production) | After (local / estimated) | After (production, post-deploy) |
|---|---|---|---|---|
| `unoonline` | CPU p50 / p75 / p99 | unavailable | pending | pending |
| `unoonline` | requests/day / errors/day | unavailable | pending | pending |
| `unoonline` | CPU-ms/day / monthly CPU cost | unavailable | pending | pending |
| `Room` | event counts / CPU distribution / active duration / cost | unavailable | pending | pending |
| static routes | invocation share / script CPU | unavailable | pending | pending |
| room intents | clone 32 / 3,200 records | unavailable (local baseline 0.065 / 1.088 ms) | pending | pending |
| room sync | 20 spectator projections | unavailable (local baseline 0.060 ms) | pending | pending |
| shuffle | 107 crypto draws | unavailable (local baseline 0.113 ms) | pending | pending |
| startMatch | lobby clone | unavailable (local baseline 0.009 ms) | pending | pending |
| `unoonline` | raw / gzip-9 bundle | unavailable (local baseline 74,607 / 20,838 B) | pending | pending |

## Post-deploy Verification

- [ ] Before implementation, obtain 7 days of entry Worker and DO CPU/event/route counts, errors, aggregate CPU and actual billing dimensions.
- [ ] Before implementation, capture parity for the current running build and required protocol fixtures.
- [ ] 24–48 h after authorized deployment, compare production CPU p50/p99, valid CPU-ms/day and DO active duration at comparable traffic mix; fill the scorecard.
- [ ] Confirm error rate and CPU-limit exceptions unchanged or lower.
- [ ] If WRK-03 lands, record asset invocation/cache share and verify redirect/SPA/missing-chunk behavior.
- [ ] Spot-check HTTP parity and WebSocket private-hand/event isolation, legacy v1 and compact v2 messages.

## Workflow Status

Phases 1–6 complete with production/URL limitations disclosed. Phase 7 in progress on selected WRK-02/05/06/07/08; final Phase 8 checks pending. No deployment performed. Notification and final summary are reported in the assistant response.
