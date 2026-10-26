# Burnless / 不烧心

A pixel-art 2.5D multiplayer hawker-management brawler in the browser. Three stalls share one night-market street: grind **honest ingredients** for compounding reputation, or rake in fast money with **"tech & hard labor" (科技与狠活)** — until rivals report you and the inspector comes.

> Play now: **https://burnless.20020612.xyz** (desktop or mobile-landscape, anonymous join, no signup)

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Guan612/burnless)

- 🍢 **8-minute matches**: restock (the honest-vs-shady soul decision) → price → react to random events (surges, snap inspections, customer spot-checks)
- 🔥 **Open-information bluffing**: everyone's heartburn meter is public — report your rival when it peaks
- 🤖 **Bot fill-ins**: three persona strategies (honest / balanced / shady) double as the tutorial; quick match never waits
- 🏆 **Meta progression**: seasonal rating (soft reset) + cosmetic-only collection
- The meme is the skin, the mechanics are the core: the honest-vs-shady standoff outlives any meme

[中文 README](./README.md)

## Stack

Full-stack TypeScript monorepo (pnpm workspaces):

| Module | Tech |
|--------|------|
| `apps/web` | Vite 8 + React 19 (React Compiler) + TanStack Router/Query + PixiJS 8 |
| `apps/worker` | Cloudflare Workers + Hono 4 + Durable Objects (one DO per match, server-authoritative) + D1 + Cron |
| `apps/server-node` | Self-host escape hatch: same Hono routes on Node + `ws` + better-sqlite3 |
| `packages/shared` | Deterministic sim core + protocol types + RoomActor pure classes + i18n + SQL/queries module |
| `packages/sprites` | Pixel asset generator (Canvas-coded atlas & palette — zero bitmap assets) |

Design highlights:

- **Deterministic simulation**: fixed 0.1s step + injected seed — same seed & same inputs ⇒ byte-identical results (unit-tested). Server-authoritative, zero client prediction.
- **RoomActor pure classes**: the match loop, bots, and settlement are runtime-free pure classes (injected clock). The Cloudflare DO and the Node adapter are both just thin WebSocket shells — zero gameplay code duplication.
- **Assets as code**: visuals *and* sound are generated at runtime (Canvas pixel atlas + WebAudio synth voices). No binary assets, no licensing burden.
- **End-to-end types**: Hono/zod schemas shared across REST, WS parsing, and frontend inference.

## Quick start (dev)

```bash
pnpm install

# Terminal 1: Workers + DO + D1 (run `pnpm --filter @burnless/web build` first so the assets dir exists)
pnpm dev:worker    # http://localhost:8787

# Terminal 2: web (recommended entry; /api and /ws proxy to 8787)
pnpm dev:web       # http://localhost:5173
```

| Command | Purpose |
| --- | --- |
| `pnpm build` | Build everything |
| `pnpm typecheck` | Strict tsc per package |
| `pnpm test` | Vitest (sim determinism / room kernels / DB adapters / balance guards) |
| `pnpm balance` | Balance batch report (`BALANCE_SEEDS=1000 pnpm balance` for large runs) |
| `pnpm smoke` / `pnpm smoke:match` | WS end-to-end smoke (needs `wrangler dev` running) |
| `pnpm smoke:node` | Node escape-hatch smoke (spins up its own temp DB & server) |

## Deploy path 1: Cloudflare (recommended — free tier, zero cost)

### One-click deploy (recommended)

Click the button above → authorize GitHub → Cloudflare clones the repo into your account,
provisions D1 / Durable Objects per `apps/worker/wrangler.jsonc` (rewriting the `database_id`),
then builds and deploys. All you do:

1. Fill in the secrets at the setup prompt (checklist in `apps/worker/.dev.vars.example`):
   `BETTER_AUTH_SECRET` is **required** (generate with `openssl rand -base64 32` — sessions fail
   without it); `GITHUB_*` / `RESEND_API_KEY` are optional and hide their features when unset.
2. You get a `*.workers.dev` URL when done — play immediately. D1 tables are created as part of
   the deploy (the deploy script runs `wrangler d1 migrations apply DB --remote`), no manual SQL.
3. workers.dev is unreachable from mainland China: bind your own domain under
   Worker → Settings → Domains & Routes in the CF dashboard.

### Manual deploy

```bash
# 1. login + create D1 (fill the database_id into apps/worker/wrangler.jsonc)
wrangler login
wrangler d1 create burnless
wrangler d1 migrations apply DB --remote --config apps/worker/wrangler.jsonc   # applies apps/worker/migrations/

# 2. secrets
wrangler secret put BETTER_AUTH_SECRET --config apps/worker/wrangler.jsonc
# optional GitHub OAuth linking (callback: https://<your-domain>/api/auth/callback/github)
wrangler secret put GITHUB_CLIENT_ID --config apps/worker/wrangler.jsonc
wrangler secret put GITHUB_CLIENT_SECRET --config apps/worker/wrangler.jsonc
# optional: password-reset / email-link mail delivery (Resend)
wrangler secret put RESEND_API_KEY --config apps/worker/wrangler.jsonc

# 3. deploy (web build + worker together)
pnpm deploy
```

The deploy serves a `*.workers.dev` URL by default; bind your own domain under
Worker → Settings → Domains & Routes in the CF dashboard (zone must be on Cloudflare).
`.github/workflows/ci.yml` runs typecheck + test + build as a quality gate on push / PR;
production deploys go through Cloudflare Workers Builds (link the repo to the Worker in the
CF dashboard — every push builds and deploys automatically).

## Deploy path 2: Node self-host (escape hatch — no Cloudflare at all)

```bash
pnpm --filter @burnless/web build
pnpm --filter @burnless/server-node build
cd apps/server-node

# env (all have defaults): PORT=8787 BURNLESS_DB=./data/burnless.sqlite ASSETS_DIR=../web/dist
BETTER_AUTH_SECRET=$(openssl rand -base64 32) \
node dist/server.mjs               # http://localhost:8787
```

- Migrations run automatically on boot (shared with the worker, idempotent).
- Rooms live in an in-process `Map<roomId, RoomActor>`; settlement uses the same queries module (better-sqlite3 executor).
- Dev mode: `pnpm dev:node` (tsx watch).

## Free-tier ledger (Cloudflare)

| Resource | Estimate | Free tier | Verdict |
|----------|----------|-----------|---------|
| DO duration | one 10-min match ≈ 75 GB-s | ~13,000 GB-s/day | ≈ 170+ matches/day |
| Worker requests | in-match wss + REST | 100k/day | plenty for a showcase |
| D1 writes | settlement only | 100k rows/day | no pressure |

## License

[AGPL-3.0](./LICENSE) (code). Pixel art and sound are generated by runtime code and ship under the same license — AGPL requires anyone offering this game as a network service to provide its corresponding source. Full plan & decision log: [PLAN.md](./PLAN.md).
