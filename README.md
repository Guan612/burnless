# 不烧心 / Burnless

像素风 2.5D 多人对战经营 H5 游戏。一条小吃街三个摊：用**良心食材**赚口碑复利，还是用**科技与狠活**赚快钱——然后被同行举报、被监管罚款？

> 在线试玩：**https://burnless.20020612.xyz** （手机横屏 / 桌面均可，匿名进站即玩）

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Guan612/burnless)

- 🍢 **一局 8 分钟**：进货（良心/狠活灵魂抉择）→ 定价 → 应对随机事件（人潮/突查/顾客验货）
- 🔥 **明牌博弈**：所有人的烧心值全局可见——等对手烧心值最高时举报他
- 🤖 **Bot 补位**：三种策略人设（良心型/平衡型/投机型）兼当新手教学，快速匹配不等人
- 🏆 **局外成长**：段位分（赛季软重置）+ 纯外观收集
- 🇨🇳 梗是皮，机制是核：「良心 vs 狠活」的博弈即使梗过气依然成立

[English README](./README_EN.md)

## 技术栈

全栈 TypeScript monorepo（pnpm workspaces）：

| 模块 | 技术 |
|------|------|
| `apps/web` | Vite 8 + React 19（React Compiler）+ TanStack Router/Query + PixiJS 8 |
| `apps/worker` | Cloudflare Workers + Hono 4 + Durable Objects（一局一 DO，服务器权威）+ D1 + Cron |
| `apps/server-node` | 自部署逃生舱：同一套 Hono 路由跑 Node + `ws` + better-sqlite3 |
| `packages/shared` | 确定性模拟核心 + 协议类型 + RoomActor 纯类 + i18n + SQL/queries 模块 |
| `packages/sprites` | 像素素材生成器（Canvas 代码化生成图集与色板，零位图资产） |

几个值得一看的设计：

- **确定性模拟**：固定步长 0.1s + 注入 seed，同 seed 同操作序列 ⇒ 逐字节一致的结果（单测断言）。客户端零预测压力，服务器权威。
- **RoomActor 纯类**：模拟循环/bot/结算全部写成无 runtime 依赖的纯类（时钟注入），Cloudflare DO 与 Node 适配器都只是它的 WebSocket 壳——业务代码一行不改。
- **素材代码化**：画面与音效全部程序化生成（Canvas 像素图集 + WebAudio 合成音色表），仓库零二进制资产、零版权负担。
- **同源类型贯通**：Hono/zod 类型 → 前后端共用；对局协议一条 union 服务回声房与对局房。

## 快速开始（开发）

```bash
pnpm install

# 终端 1：Workers + DO + D1（首次前先 pnpm --filter @burnless/web build，assets 目录需要存在）
pnpm dev:worker    # http://localhost:8787

# 终端 2：前端（推荐入口，/api 与 /ws 已代理到 8787）
pnpm dev:web       # http://localhost:5173
```

| 命令 | 作用 |
| --- | --- |
| `pnpm build` | 全量构建 |
| `pnpm typecheck` | 各包 tsc 严格检查 |
| `pnpm test` | Vitest（模拟确定性 / 房间内核 / DB 适配器 / 平衡守护） |
| `pnpm balance` | 数值平衡跑批报告（`BALANCE_SEEDS=1000 pnpm balance` 跑大批） |
| `pnpm smoke` / `pnpm smoke:match` | WS 端到端冒烟（需 `wrangler dev` 运行中） |
| `pnpm smoke:node` | Node 逃生舱冒烟（自建临时库与服务，无需预启动） |
| `pnpm gen:types` | 绑定变更后重新生成 `worker-configuration.d.ts` |

## 部署路径 1：Cloudflare（主推，免费额度内零成本）

### 一键部署（推荐）

点上面的按钮 → 授权 GitHub → Cloudflare 把仓库克隆进你的账号，按 `apps/worker/wrangler.jsonc`
自动开通 D1 / Durable Objects（并改写 `database_id`），随后自动构建部署。你只需要：

1. 设置页按提示填 secrets（清单见 `apps/worker/.dev.vars.example`）：`BETTER_AUTH_SECRET` **必填**
   （`openssl rand -base64 32` 生成，缺失则无法建立会话、进站即挂）；`GITHUB_*` / `RESEND_API_KEY`
   可选，不填则相应功能隐藏。
2. 部署完成得到一个 `*.workers.dev` 地址，直接开玩——D1 建表随部署自动执行
   （deploy script 内置 `wrangler d1 migrations apply DB --remote`），无需手工迁移。
3. 大陆访问 workers.dev 受限：在 CF 控制台 Worker → Settings → Domains & Routes 绑自有域名即可。

### 手动部署

```bash
# 1. 登录 + 创建 D1（database_id 填进 apps/worker/wrangler.jsonc）
wrangler login
wrangler d1 create burnless
wrangler d1 migrations apply DB --remote --config apps/worker/wrangler.jsonc   # 应用 apps/worker/migrations/ 全部迁移

# 2. secrets
wrangler secret put BETTER_AUTH_SECRET --config apps/worker/wrangler.jsonc
# 可选：GitHub OAuth 绑定（回调地址 https://<你的域名>/api/auth/callback/github）
wrangler secret put GITHUB_CLIENT_ID --config apps/worker/wrangler.jsonc
wrangler secret put GITHUB_CLIENT_SECRET --config apps/worker/wrangler.jsonc
# 可选：找回密码/补绑邮箱发信（Resend）
wrangler secret put RESEND_API_KEY --config apps/worker/wrangler.jsonc

# 3. 部署（web 产物 + worker 一起）
pnpm deploy
```

部署默认开 `*.workers.dev` 域名；自有域名在 CF 控制台 Worker → Settings → Domains & Routes 绑定
（需已接入 Cloudflare zone），五分钟出实例。
`.github/workflows/ci.yml` 在 push / PR 时跑 typecheck + test + build 质量门禁；线上部署走
Cloudflare Workers Builds（CF 控制台把仓库关联到 Worker，每次 push 自动构建部署）。

## 部署路径 2：Node 自部署（逃生舱，完全脱离 Cloudflare）

```bash
pnpm --filter @burnless/web build          # 静态产物给 server-node 托管
pnpm --filter @burnless/server-node build
cd apps/server-node

# 环境变量（均有默认值）：PORT=8787 BURNLESS_DB=./data/burnless.sqlite ASSETS_DIR=../web/dist
BETTER_AUTH_SECRET=$(openssl rand -base64 32) \
GITHUB_CLIENT_ID=xxx GITHUB_CLIENT_SECRET=xxx \
node dist/server.mjs                       # http://localhost:8787
```

- 迁移启动时自动执行（与 worker 共用 `apps/worker/migrations`，幂等）；
- 房间 = 进程内 `Map<roomId, RoomActor>`，结算走同一份 queries（better-sqlite3 执行器）；
- 也可开发模式跑：`pnpm dev:node`（tsx watch）。

## 免费额度账本（Cloudflare）

| 项目 | 用量估算 | 免费额度 | 结论 |
|------|----------|----------|------|
| DO 活跃时长 | 一局 10 分钟 ≈ 75 GB-s | ~13,000 GB-s/天 | ≈ 每天 170+ 场 |
| Workers 请求 | 局内 wss 消息 + REST | 10 万次/天 | 展示期绰绰有余 |
| D1 写入 | 仅局末结算落库 | 10 万行/天 | 无压力 |

## 架构

```
浏览器   Vite SPA：React + TanStack Router（类型安全路由）
         + TanStack Query（大厅/排位/收藏数据层）
         + PixiJS（3/4 俯视街道渲染）+ DOM UI（面板/按钮/列表）
              │ wss: intents ↑ / events ↓（服务器权威，秒级 tick）
Workers  ├─ Hono：REST（healthz / auth / 档案 / 排位 / 匹配）
         ├─ MatchMaker DO（全局单例：30s 匹配窗口 / 私房邀请码）
         ├─ MatchRoom DO（一局一 DO：确定性模拟 + bot AI + 结算落库 + 广播）
         ├─ D1：玩家档案 / 对局记录 / 段位 / 解锁 / better-auth 四表
         ├─ Cron Trigger：赛季滚动（4 周一季 + 段位软重置）
         └─ 静态资源托管（SPA fallback，/api /ws 强制先走 worker）
共享层   packages/shared：协议类型 + 确定性模拟 + RoomActor 纯类 + queries
Node 逃生舱  apps/server-node：同一套 Hono 路由 + ws + better-sqlite3
```

关键原则：**服务器权威**（客户端只发 intent）、**确定性模拟放 shared**（可单机跑/搬进 DO/回放）、**秒级同步**（决策策略型不需要每帧状态）。

## License

[AGPL-3.0](./LICENSE)（代码）。像素素材与音效均为运行时代码生成，随仓库同许可发布——AGPL 要求：任何人通过网络提供服务（包括本游戏的服务端），须向其用户提供对应源代码。完整计划与决策记录见 [PLAN.md](./PLAN.md)。
