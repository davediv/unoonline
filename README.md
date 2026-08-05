# UNO

Real-time multiplayer UNO for the browser, running entirely on Cloudflare.
Make a room, send the code, play.

One Worker serves the whole thing: the built client through the Assets
binding, plus `/api/*` and `/ws`. One origin, one `wrangler deploy`, no CORS.

---

## Getting it running

```bash
npm install
npm run dev
```

`npm run dev` starts Vite with the Cloudflare plugin, which runs
`worker/index.ts` inside workerd behind the same origin — so `/ws` and
`/api/*` behave in development exactly as they do in production, against a
real local Durable Object, while the client still hot-reloads.

Open the URL it prints, hit **Create room**, and open the room link in a
second window (or a private window) to be two players. Or add bots.

```bash
npm test          # rules engine, in Node
npm run test:worker   # Durable Object, inside workerd
npm run test:all      # both
npm run build     # type-check everything, then build client + worker
npm run lint
```

## Deploying

```bash
npm run deploy    # build, then wrangler deploy
```

`vite build` writes `dist/client` (the assets) and `dist/uno` (the Worker plus
a generated `wrangler.json` with the assets directory filled in). `wrangler
deploy` from the project root picks that generated config up automatically.

The first deploy creates the `Room` Durable Object namespace from the `v1`
migration in `wrangler.jsonc`. It uses `new_sqlite_classes`, which is the
storage backend available on the free plan.

### Putting it on your own domain

1. Add the domain (or a subdomain) to your Cloudflare account as a zone, and
   point its nameservers at Cloudflare.
2. In the dashboard: **Workers & Pages → uno → Settings → Domains & Routes →
   Add → Custom domain**, and enter e.g. `uno.example.com`. Cloudflare creates
   the DNS record and the certificate for you.

Or declare it in `wrangler.jsonc` and let deploys manage it:

```jsonc
"routes": [{ "pattern": "uno.example.com", "custom_domain": true }]
```

WebSockets work over the custom domain with no extra configuration.

---

## How it is put together

```
shared/    the rules engine and every type both sides use
worker/    the Worker entry and the Room Durable Object
client/    React + Vite + Tailwind
```

**One Durable Object per room.** `env.ROOM.idFromName(code)` — the DO *is* the
game. It owns the deck, the shuffle, every hand and the turn order, keeps it
in memory, and writes it to DO storage after every mutation, so an eviction
mid-round loses nothing.

**Clients send intents, never state.** `PLAY_CARD`, `DRAW`, `PASS`,
`CHOOSE_COLOR`, `CHOOSE_PLAYER`, `CALL_UNO`, `CATCH_UNO`, `CHALLENGE`. The DO
validates each one and answers a rejection privately to whoever tried it.

**Nobody is ever sent a hand that is not theirs.** Every outbound frame goes
through `serializeFor(state, viewerId)`, which returns your hand in full and
nothing but a count for everyone else. The draw pile is never serialized at
all, and the "was that Wild Draw Four a bluff" flag is stripped. There are
tests that serialize a state and assert that no other player's card id appears
anywhere in the payload — over the wire, not just in the projection.

**Shuffling is `crypto.getRandomValues`,** rejection-sampled so the modulo does
not bias low cards. `Math.random` appears nowhere in the project.

**Sockets hibernate.** `state.acceptWebSocket()` with the identity attached via
`serializeAttachment`, so a room full of people thinking costs nothing.
Keepalive pings are answered by the runtime itself through
`setWebSocketAutoResponse`, so they do not wake the room either.

**Every deadline is an alarm,** because timers do not survive hibernation: the
turn clock, the 3-second UNO window, bot thinking delays, the 60-second
reconnect grace, and deleting an empty room after ten minutes. They are held
as a list and collapsed into a single `setAlarm()` at the nearest one.

**Bots play from the same projection you do.** `botView()` hands them
`serializeFor(...)` plus the two things everyone at the table can genuinely
see — the discard pile and who has drawn rather than follow a colour. They
cannot read a hidden hand or the bluff flag even by accident, and there is a
test that says so.

---

## The rules

Standard UNO, 108 cards: per colour one 0, two each of 1–9, two Skip, two
Reverse, two Draw Two; plus four Wild and four Wild Draw Four.

A few calls worth knowing about:

- **Wild Draw Four.** With the challenge rule **on**, you may play it whatever
  you are holding — bluffing is the point, and the challenge settles it. With
  the challenge rule **off** there is nothing to settle it, so the "no card of
  the active colour" restriction is enforced when you play. A successful
  challenge makes the bluffer draw and the challenger keeps their turn; a
  failed one costs the challenger the cards plus two, and their turn.
- **Reverse with two players** acts as a Skip: play comes straight back to you.
- **A starting Reverse** flips the direction and play starts the other way
  round — which, with two players, lands on the other seat.
- **A Draw Two or Wild Draw Four played as the winning card** still makes the
  next player draw, and those cards count against them. That is the official
  rule; the game would otherwise end a couple of points light.
- **A Wild Draw Four played onto a stack** is not challengeable: the stacking
  rule is what allowed it, so there is no bluff to punish.
- **The UNO window** opens when a play fully resolves — after the colour
  picker, not before it, so choosing a colour does not eat your three seconds.
- **The catch race** is settled by message arrival order. The DO is
  single-threaded, so whoever's message lands first simply runs first: call
  UNO before the catch arrives and the accuser takes two instead.

House rules, all off by default except the challenge rule: stacking, jump-in,
7-0, draw-to-match, a 15/30/60 second turn timer, and single round or first
to 500.

---

## Playing it

- **Keyboard:** ← → to move along your hand, Enter to play, **D** to draw,
  **U** for UNO, **C** to catch, Escape to close what is open.
- **Colour shapes** in the top rail adds a shape per colour (circle, triangle,
  square, diamond) for anyone who cannot rely on hue. Every card also reads its
  colour and value as text to a screen reader.
- **`prefers-reduced-motion`** switches off the card flights and the deal.
- **Reconnecting:** a dropped player has 60 seconds to come back to their seat
  and their hand, using a token in `sessionStorage`. After that a bot finishes
  the round for them, and hands the seat straight back when they return.
- **Watching:** anyone arriving mid-game watches with every hand hidden, and
  is dealt in when the next game starts.

Sound is synthesised with the Web Audio API — there are no audio files to
ship. The mute toggle is remembered in `localStorage`.
