# 《不烧心》计划与执行文档

> 像素风 2.5D 多人对战经营 H5 游戏 · 基于「不烧心」梗 · 全栈 Cloudflare 免费额度 · 开源技术展示项目
>
> 本文档是项目唯一事实来源（single source of truth），所有决策以本文档为准，变更需同步更新此处。

## 0. 项目定位

- **性质**：开源技术展示项目（个人独立开发 + AI 辅助编码），不商业化、不做内购。
- **题材**：「不烧心」梗——出自 2026 年前后短视频平台批量生成的 AI 市井短剧（小吃摊、早点铺题材，主角用好料不偷工减料，顾客「吃不烧心」），引申为**靠谱、实在、不坑人**。梗是皮，机制是核：即使梗过气，「良心 vs 狠活」的博弈依然成立。
- **一句话卖点**：一条像素小吃街，三个摊主抢生意——用良心赚慢钱，还是用科技与狠活赚快钱然后被举报？
- **约束**：尽可能只使用 Cloudflare 免费额度；全栈 TypeScript。
- **自部署**：开源使用者既能一键部署到自己的 Cloudflare 账号，也能走 Node 适配器完全脱离 CF（§3.4）。

## 1. 已定决策总表（2026-10-24 grill 会议定稿）

| # | 分支 | 决策 | 备注 |
|---|------|------|------|
| 1 | 核心结构 | 短局对战制：5~10 分钟一局，3 摊位（1 真人 + 2 bot 起步，上限 3~6 人） | 局末结算入赛季 |
| 2 | 操作循环 | 决策策略型：进货 / 定价 / 升级 / 应对事件，菜自动制作 | 无动作小游戏，跨端友好 |
| 3 | 对抗形式 | 间接经济战：抢客、比价、刷差评、举报狠活触发市场监管 | 无直接破坏对抗 |
| 4 | 分发渠道 | H5 网页直达（自有域名 + Cloudflare），不做小游戏平台 | 接受国内 150~300ms 延迟 |
| 5 | 凑人机制 | 快速匹配 + bot 补位 + 好友私房 | bot 兼当新手教学 |
| 6 | 局外成长 | 段位（梗味命名）+ 收集（菜谱 / 摊位装饰） | 轻 meta，无数值膨胀 |
| 7 | 灵魂机制 | 个人烧心值：良心食材 vs 科技狠活的每局实时博弈 | 详见 §2.2 |
| 8 | 前端架构 | Vite SPA：React + TanStack Router + TanStack Query + PixiJS + DOM UI | **仅用 TanStack 客户端库，不用 TanStack Start**（SSR 无收益，DO/WS 横竖手写） |
| 9 | 后端架构 | 裸 Workers：Hono v4.13 元数据接口 + Durable Objects 实时层 + D1 + Cron | 一局 = 一个 MatchRoom DO；Hono 依赖清单见 §3.1 |
| 10 | 美术管线 | HTML/Canvas 代码化生成像素素材，共享色板常量 | 有机物（小人/火焰）可混 AI 生成兜底 |
| 11 | 团队周期 | 独立开发，6~8 周 MVP | 竖切片优先，红线见 §5 |
| 12 | 变现 / 开源 | 无变现。建议 MIT（代码）+ CC-BY（素材） | 价值在展示 |
| 13 | 自部署 | 两级：一键部署到自己 CF 账号（主推，免费额度零成本）+ `apps/server-node` 适配器（W7-8，完全脱离 CF） | W1 预埋两条缝，见 §3.4 |
| 14 | 横竖屏 | 横屏优先，等距街道一屏尽收；竖屏打开显示旋转引导页，不做竖屏适配 | 桌面端一等公民，符合开发者受众 |
| 15 | 游戏语言 | i18n 键值表脚手架从 W1 建，MVP 仅中文表 | 英文表留给社区/后续，翻译后患归零 |
| 16 | 仓库名 | `burnless`（游戏标题《不烧心 / Burnless》），包 scope `@burnless/*` | |
| 17 | 顾客模型 | 类型化多因子效用：四型顾客按价格/口碑/排队/烧心传闻加权选摊 + 回头客记忆 + 种子随机 | 详见 §2.5 |
| 18 | 局内节奏 | 随机事件驱动，不设固定早/午/晚阶段；同局共享 RNG 事件流保公平 + 基础缓升客流打底 | 详见 §2.5 |
| 19 | 身份与进度 | better-auth：匿名登录起步即玩，可升级 GitHub OAuth / 邮箱；Workers + D1 官方适配 | 取代自研会话与继续码 |
| 20 | 艺术视角 | **星露谷物语式 3/4 俯视**（16px 方格地砖 + 正面立面），取代最初的等距方案（2026-10-25 用户拍板） | 素材成本减半，交互命中判断变矩形 |
| 21 | 性能策略 | **React Compiler 接管全部细粒度性能优化**（2026-10-25 用户拍板）：业务代码禁手写 useMemo/useCallback/React.memo | vite babel 插件 `babel-plugin-react-compiler`；TanStack Router 同日以**文件路由**落地（`src/routes/`），`?match=` 迁移为类型化 search 参数 |
| 22 | 音效方案 | **WebAudio 程序化合成**，不引 CC0 音效包（2026-10-25 W7 拍板）：决策 #10「素材代码化」的音效版——零下载零版权、仓库自包含，色板换音色表 | `apps/web/src/game/sfx.ts`；SimEvent.kind → 音色一一对应 |

## 2. 游戏设计

### 2.1 一局长什么样

星露谷式 3/4 俯视像素小吃街（#20），3 个摊位（MVP 品类锁定**烧烤摊**单品类、1 真人 + 2 bot 起步，后续版本再扩品类），NPC 顾客带偏好实时流动。一局 8 分钟（可在 5~10 内调），玩家循环做三件事：

1. **进货**：每轮补货时在「良心食材 / 科技狠活」之间选择——每局的灵魂抉择。
2. **定价**：低价抢客、高价宰客，价格影响顾客选择与口碑。
3. **应对事件**：被对手举报、市场监管抽检、给对手刷差评、顾客验货等突发事件。

局末按 **营收 + 口碑** 加权结算，换算段位分与收集货币。

### 2.2 烧心机制（核心）

- **良心食材**：成本高、出餐慢，但积累口碑 → 回头客复利（回头客容忍提价）。
- **科技狠活**：成本便宜、出餐快、单件利润高，但每单积累**烧心值**。
- **烧心值后果**：顾客流失加速；烧心值高时被对手**举报** → 触发市场监管抽检 → 罚款 / 停业整顿数秒；玩家可花成本「自证清白」。
- **明牌博弈**：所有玩家的烧心值全局可见——举报时机（等对手烧心值最高时举报）就是博弈来源。
- 对称地，纯良心路线也有慢启动风险：前期营收落后，靠中后期回头客追回。

### 2.3 Bot AI

决策策略型下 bot 用简单策略树即可：按难度档在「良心型 / 投机型 / 平衡型」三种预设策略上加随机扰动；事件响应（被举报时自证概率）随难度调整。bot 行为同时是新手教学的活教材。

### 2.4 局外系统

- **段位**：大排档学徒 → 街头老手 → 街区扛把子 → 不烧心大师（命名可再调）。
- **收集**：局内赚钱解锁菜谱与摊位装饰，纯外观，不带局内数值。
- **身份与进度**：better-auth（决策 #19）——匿名登录起步即玩，玩家想保进度时升级绑定 GitHub OAuth（受众是开发者）或邮箱；段位与收集跟账号走，换设备不丢。

### 2.5 顾客模型与局内节奏（第二轮拷问定稿）

- **顾客决策（#17）**：类型化多因子效用——顾客分四型：价格敏感（学生）、口碑敏感（大爷）、时效敏感（上班族）、随机（游客）；选摊时按价格、口碑、排队长度、烧心值传闻四因子加权效用 + 种子随机扰动；在哪家吃过好料会变回头客（忠诚度记忆）。四条策略线（定价/口碑/排队/烧心）由此互相咬合；因子权重是 W3~W5 的调参主战场。
- **局内节奏（#18）**：随机事件驱动，不设固定阶段——人潮、突查风波、网红探店等梗味事件制造主要起伏，重玩性高、更贴市井烟火气；保留一条基础缓升客流曲线打底，避免事件空窗期街道冷场。
- **公平性**：同局三家共享同一条 RNG 事件流（同局同种子）；全局事件（人潮/检查风波）三家同享，摊位事件同流不同籽——三家事件分布一致，公平性由确定性模拟天然保证。
- **横竖屏（#14）**：横屏优先，街道一屏尽收；竖屏打开显示精心设计的旋转引导页（不做竖屏适配）。

## 3. 技术架构

```
浏览器   Vite SPA：React + TanStack Router（类型安全路由）
         + TanStack Query（大厅/排位/收藏数据层）
         + PixiJS（等距街道渲染）+ DOM UI（面板/按钮/列表）
              │ wss: intents ↑ / events ↓（服务器权威，秒级 tick）
Workers  ├─ Hono：REST 元数据（排位榜、档案、收集）
         ├─ 静态资源托管（SPA）
         ├─ MatchMaker DO（全局单例：匹配队列 / 私房邀请码）
         ├─ MatchRoom DO（一局一 DO：确定性模拟 + bot AI + 结算 + WebSocket 广播）
         ├─ D1：游客档案 / 对局记录 / 段位 / 解锁
         ├─ Cron Trigger：赛季结算
         └─ R2：素材图集（可选，也可构建期内联）
共享层   packages/shared：协议类型 + 确定性模拟核心
         （客户端预测与服务端模拟共用同一份代码——本身就是展示点）
```

关键原则：

- **服务器权威**：客户端只发 intent（进货/改价/举报），模拟全部在 MatchRoom DO 内运行，事件广播给所有客户端。
- **确定性模拟放 shared 包**：同一份模拟代码可单机跑（W3 单机可玩）也可搬进 DO（W4），也方便回放与测试。
- **同步频率低**：决策策略型只需秒级事件同步，不需要每帧状态，DO 毫无压力。

### 3.1 Hono 技术栈明细（2026-10-25 W1 实装确认，锁定 v4.13）

> 版本勘误：v5 目前仅 RC（`next` tag），npm 稳定版为 v4.13.x——锁 `^4.13.0`，v5 正式发布后再评估升级。

- **用**：`hono`（v5，路由/中间件/Context，`c.env` 直连 Workers 绑定）、`@hono/zod-validator` + `zod`（校验，schema 放 packages/shared，REST 与 WS 消息解析共用）、`hono/client`（`hc` 端到端类型 RPC，接 TanStack Query 的 queryFn）、`hono/testing`（`testClient` 单测）、`better-auth`（身份：匿名插件起步 + GitHub OAuth/邮箱升级，官方有 Workers + D1 接入指南，挂载于 `/api/auth/*`，Node 逃生舱同样可用）、内置 `logger`/`secure-headers`/`etag`。
- **不用**：ORM（D1 裸 prepared statement：`prepare().bind().all<T>()` 驱动式 API，schema 管理走 `wrangler d1 migrations`；若 W6 查询复杂度上来，可增量引入 Drizzle ORM，它对 D1 一等支持）、`hono/jsx`（无 SSR）、自研 JWT/cookie 会话（由 better-auth 承担）、`@hono/cloudflare-workers` 的 `upgradeWebSocket`（DO 内用原生 `WebSocketPair`）。
- **边界**：Hono 只在 Worker 边缘层（REST + `/ws` 升级转发 + 静态资源兜底）；MatchRoom DO 内部逻辑裸写。
- **类型贯通**：`export type AppType`（worker）→ `hc<AppType>`（web，仅类型导入）；zod schema（shared）同时服务 REST 校验、WS 解析和前端类型推导。
- **备忘**：同源部署无需 CORS（避开 upgradeWebSocket + CORS 的 immutable headers 坑）；锁版本前先读 v5 迁移指南。

### 3.2 免费额度账本（上线前以官网现行额度复核）

| 项目 | 用量估算 | 免费额度 | 结论 |
|------|----------|----------|------|
| DO 活跃时长 | 一局 10 分钟 ≈ 75 GB-s | ~13,000 GB-s/天 | ≈ 每天 170+ 场，够 |
| Workers 请求 | 局内 wss 消息 + REST | 10 万次/天 | 展示期绰绰有余 |
| D1 写入 | 仅局末结算落库 | 10 万行/天 | 无压力 |

把「一局游戏的 Cloudflare 成本」写进 README——本身就是最好的技术展示素材。

### 3.3 仓库结构（pnpm workspaces monorepo）

```
oder-game/
├─ apps/web/          # Vite SPA 客户端
├─ apps/worker/       # Workers：Hono + DO + Cron（主部署目标）
├─ apps/server-node/  # 自部署适配器：Hono on Node/Bun + ws + better-sqlite3（W7-8）
├─ packages/shared/   # 协议类型 + 确定性模拟核心 + RoomActor 纯类
├─ packages/sprites/  # 素材生成器（Canvas 脚本 → 图集 + 色板常量）
└─ PLAN.md            # 本文档
```

CI：GitHub Actions → 测试 → `wrangler deploy`。双语 README，面向中文开发者社区首发（掘金 / V2EX / 即刻）。

### 3.4 自部署设计（决策 #13）

**两级自部署**：

- **主路径**：任何人一键部署到自己的 Cloudflare 账号（`wrangler deploy` 或 Deploy Button，免费额度内零成本、零运维，五分钟出实例）。
- **逃生舱**：`apps/server-node`——同一套 Hono 路由跑在 Node/Bun、`ws` 做 WebSocket、`better-sqlite3` 跑同一份 SQL 迁移，供完全脱离 Cloudflare 的部署者（VPS/Docker）。

**W1 起预埋的两条缝**（保证逃生舱是 +2~3 天的适配，不是重写）：

1. **`RoomActor` 纯类**：模拟循环、bot、intent 处理、局内计时全部写成无 runtime 依赖的纯类（时钟/调度器注入），放 `packages/shared`。DO 与 Node 适配器都只是它的 WebSocket 壳，业务代码一行不改。
2. **queries 模块**：全部 SQL 收进一个模块，面向 DB 适配接口编写（D1 与 better-sqlite3 各一份实现，迁移文件共用）；路由层禁止散写 `c.env.DB.prepare`。

CF 特有依赖的等价物对照：DO（房间宿主）→ 进程内 `Map<roomId, RoomActor>` + `ws`；D1 → `better-sqlite3`；Workers Assets + Cron → 任意静态服务器 + 系统 cron。

## 4. 里程碑与执行清单

> 竖切片优先：先让核心循环单机可玩，再搬上服务器。每周末对照验收标准打勾。

### W1 链路通 ✅（2026-10-25 完成，验收待域名）
- [x] pnpm monorepo 骨架（`@burnless/*`：apps/web、apps/worker、packages/shared）
- [x] i18n locales 脚手架（键值文案表，MVP 仅中文，#15）
- [x] MatchRoom DO WebSocket 回声房：浏览器连上 → 发消息 → 收回显（含多客户端广播、历史快照、非法帧守卫）
- [x] 预埋自部署缝：回声房按「RoomActor 纯类 + DO 壳」结构写（决策 #13 的前置条件）
- [x] Hono `/api/healthz` + 静态资源托管（SPA fallback 深路由验证通过）
- [x] GitHub Actions：push 主分支自动 `wrangler deploy`（工作流文件就绪，待 GitHub 仓库 + `CLOUDFLARE_API_TOKEN` secret）
- [x] 本地端到端验收：healthz 82ms / WS echo 冒烟 `pnpm smoke` / 非法房间 ID 400
- [x] **验收**：自有域名上手机和电脑都能打开页面并连上 wss 回声房 → 已部署 `burnless.20020612.xyz`（电脑端生产实测通过；手机端待用户随手验一下）

**W1 踩坑记录**（对开源读者有用，发布时进 README）：
1. pnpm 11 的构建脚本白名单是 `pnpm-workspace.yaml` 里的 `allowBuilds: {esbuild: true, workerd: true}`（旧写法 `package.json` 的 `pnpm.onlyBuiltDependencies` 已废弃不读）。
2. Windows 上杀 `wrangler dev` 经常只杀死 node 代理层，workerd 会变成孤儿；**同端口多个 workerd 同时 LISTEN 时请求会被随机分给死实例、表现为永久挂起**。清场：按命令行匹配杀 wrangler 的 node 链 + `taskkill //F //IM workerd.exe`。
3. 最新 runtime 类型已移除非休眠的 `state.accept()`，非休眠 accept 用 `server.accept()`（WebSocket 自身方法）；休眠模式才是 `state.acceptWebSocket()`。W1 用后者语义（内存态房间，断光即释放），W4 评估休眠 + 快照。
4. DO 类必须从 entrypoint 显式 `export`，否则 wrangler 报 "not exported in your entrypoint" 且请求静默挂起。
5. 绑定类型不再手写 Env：`wrangler types` 生成 `worker-configuration.d.ts`（含完整 runtime 类型），改 wrangler.jsonc 后需重跑 `pnpm gen:types`。
6. vite dev 默认绑 IPv6 `::1`：`curl 127.0.0.1:5173` 会被拒（exit 7），用 `localhost` 或 `[::1]` 访问。
7. 像素引擎的教训：`Uint8ClampedArray` 用浮点索引读返回 `undefined`（写入静默丢弃），所有绘制 API 必须入口处统一 `Math.floor` + `Number.isFinite` 守卫，否则 NaN 会无声传播成"随机消失的 sprite"。
8. W3 实测发现：被遮挡/后台的 webview 会被 Chromium 重度节流（rAF 暂停、定时器 ~1Hz），页面 `visibilityState` 仍是 visible。游戏循环必须用**墙钟追帧**（`update((now-last)/1000)`，单次封顶 1s 防跳变），否则玩家切后台回来对局时间全丢。
9. 节流环境下 React 快照最多滞后一个渲染周期，自动化测试点按钮会掉进"陈旧 UI 竞态"（弹窗已关、点击被模拟器静默拒绝）。页内 MutationObserver/原子 evaluate 才可靠；改 `packages/shared` 源码后若页面行为没变，先删 `apps/web/node_modules/.vite` 重启 vite 再怀疑代码。

### W2 画面立起来 ✅（2026-10-25 完成，视角改为星露谷式 #20）
- [x] PixiJS 街道渲染（星露谷式 3/4 俯视：三摊位 + 街道 + 剪影楼 + 灯光氛围，横屏一屏尽收）
- [x] 竖屏旋转引导页（纯 CSS media query，🍢 动画，#14）
- [x] 素材生成管线：`pnpm sprites` 一键生成图集（18 帧）+ 色板常量；`pnpm preview` 合成街景预览图供美术验收
- [x] NPC 顾客流动（8 人三频段游走 + 影子 + y 排序遮挡 + 双帧行走）
- [x] **验收**：浏览器实测 125~159 FPS（要求 60），NPC 位移前后截图对比确认；回声房标签回归通过

### W3 核心循环单机可玩 ✅（2026-10-25 机制完成，红线等待用户玩法判定）
- [x] 模拟核心（packages/shared/sim）：四型顾客 × 四因子效用选摊（#17）、良心/狠活进货抉择、实时定价、自动出餐（狠活先卖）、营收、口碑、烧心值、断货流失、回头客回流、随机事件流（人潮/监管抽检/顾客验货，#18）、结算公式（营收 + 口碑×8 + 梗味评级）
- [x] 确定性模拟：固定步长 0.1s + 注入 seed，6 个模拟测试全绿（含同 seed 逐字节一致、烧心超标必罚、整局跑完）
- [x] DOM UI：左上 HUD（钱包/倒计时/口碑/烧心值/库存）+ 底部定价滑条 + 进货决策弹窗（12s 窗口可跳过）+ 事件 toast 流 + 局末结算弹窗；文案全走 locales 表
- [x] 浏览器实测：HUD 走表、进货→库存→出餐→营收全链路打通（¥100 进 30 串良心，库存 28 卖出中）
- [ ] **验收（红线）**：「良心 vs 狠活」的取舍有真实纠结感 —— 交给用户试玩判定；调参全部在 `packages/shared/src/sim/balance.ts`
- [x] 此周前不做任何多人功能

### W4 上服务器 ✅（2026-10-25 完成）
- [x] 模拟核心多座位化后搬进 MatchRoom DO，服务器权威（每摊独立钱包/库存/口碑/烧心/进货周期；未认领座位走脚本对手，W5 换 bot）
- [x] intent 协议 + 事件广播（协议 v2：`intent`/`snap`/`events`/`match_welcome`/`resume`；逐座位个性化快照，事件按座位分流，明牌烧心值全局可见）
- [x] 断线重连（seatToken 续座：刷新/断网重进拿回原座位与全部状态；无效令牌自动降级开新座兜底服务器重启）
- [x] DO tick 用内存 setInterval 驱动（1s 一拍），对局内存态、全员断线照常跑到结算
- [x] 进货数量改为按钱包余额（上限 200 串）：卖得多→赚得多→进得多，断货变成「自己少进」的真实后果
- [x] 进货弹窗 UX：滑条全宽居中 + 全良心/半掺/全狠活刻度 + 良心/狠活实时拆分行（用户验收反馈）
- [x] `pnpm smoke:match` 对局房冒烟（入座→改价→重连续座）
- [x] TanStack Router 以文件路由落地（`/` 街道 + `/echo` 回声房），`?match=` 升级为类型化 search 参数；URL 无参时自动恢复本会话最近对局
- [x] React Compiler 启用（决策 #21），业务代码零手写性能函数
- [x] **验收**：双标签页（模拟双设备）打同一局 `?match=verify-w4`，一方刷新页面价格/钱包/库存原样保留、单连接稳定 🟢

**W4 踩坑记录**（接 W1 记录续编）：
10. **DO 里别用 storage alarm 驱动高频 tick**：WebSocket 升级 fetch 里 `await storage.getAlarm/setAlarm` 与每秒的 `alarm()` 互抢 SQLite 写锁 → `SQLITE_BUSY` 把 101 升级打挂 → 客户端闪断循环。内存态对局直接 `setInterval`（PartyKit 同款做法），升级路径零存储操作。
11. **WS 客户端的 `connecting` 状态回调绝不能当断线处理**：同步回调触发了「每次连接 → 误判断线 → 1s 后重连」的风暴（实测 941 次升级、🟡🟢 交替闪烁）。重连状态机只认真正的 `close` 事件。
12. **React key 用服务器事件 id 会在多路连接/重连竞态下撞车**：同 id 重复渲染出幽灵 toast 越积越多。客户端发 uid 做 key + 按事件 id 单调去重。
13. **同端口孤儿 workerd 会再现**（W1 #2 的变体）：杀 workerd 后存活的 wrangler node 会把它重新拉起；清场必须连 wrangler 的 node/cmd/sh 进程链一起杀，再核对 `netstat` 只剩一个 LISTEN。
14. **workerd 不认纯 JS 定时器的「存活」**：全员断线 ~10s 后 DO 连状态带 setInterval 一起被驱逐，「对局照常跑到结算」只在至少一条连接存活时成立（W6 实测挂机局没落库才定位）；真挂机续命要 storage alarm + 状态快照。
15. **assets 的 SPA fallback 会绕过 worker**：`not_found_handling: single-page-application` 下导航型请求直接喂 index.html，连 WebSocket 升级都可能被截（表现为 200 HTML 而非 101）。`run_worker_first: ["/api/*", "/ws/*"]` 解决；另外日志里的 "not_found_handling behavior" 也可能来自 worker 自己的 `ASSETS.fetch` 兜底（catch-all），排查时先看路由是否漏写。

### W5 对战活起来 ✅（2026-10-25 完成）
- [x] Bot AI 三档策略（§2.3）：老王=良心型 / 张记=平衡型 / 胖子=投机型；策略树 + 随机扰动全走同局 RNG（确定性不破），bot 有完整经济（错峰进货/动态定价/自证/举报/刷差评），真人认领即接管摊位
- [x] 主动博弈动作（明牌博弈 #7 的双人版）：**举报**（冷却 45s，触发目标抽检；落空扣自己口碑）、**自证清白**（¥25 压 45 烧心值，烧心值≥30 才可用）、**刷差评**（¥15，20% 被抓现行）；同局共享 RNG 事件流 + 基础缓升客流曲线（#18）
- [x] 局末结算：三方全结算（营收 + 口碑×8，梗味评级），bot 也计分
- [x] 客户端动作条：自证 / 逐对手举报与刷差评按钮，冷却秒数与余额实时禁用；新事件 toast（report_hit / report_clean / smear_done / smear_caught / self_verified）
- [x] **部署生产**：`burnless.20020612.xyz`（自定义域 + `workers_dev: false`）；生产 healthz + 对局 wss 入座/改价实测通过（握手后动作秒级回包）
- [x] 依赖基线对齐 npm 最新（2026-10-25）：Vite 8.3（Rolldown 内核）+ @vitejs/plugin-react 6 + Vitest 5 + TypeScript 7 + React 19.3 + PixiJS 8.22；TanStack 全家桶 / wrangler / babel-plugin-react-compiler 已是最新
- [x] **验收**：和 2 个 bot 打一局完整对战，举报博弈成立（命中→目标罚款停业；落空→自己口碑受损，双向反馈可玩）

### W6 局外闭环 ✅（2026-10-25 完成）
- [x] D1 + queries 模块（决策 #13 缝 #2）：全部 SQL 收进 shared/src/db/queries.ts，DbAdapter 接口 + D1 执行器（worker）+ better-sqlite3 执行器（测试/Node 逃生舱）共用同一份迁移；表：players / match_results / unlocks / seasons + better-auth 四表
- [x] better-auth（#19）：匿名登录起步即玩（D1 + drizzle 适配），/api/me 返回档案；GitHub OAuth / 邮箱升级留 W7（secret 已备）
- [x] 段位：rating = 旧分 60% + 单局综合分 40%，档位沿用梗味评级；对局结束由 DO 落库并回填结算快照（段位分 old → after 直接展示）；赛季 4 周一季 + Cron 日检滚动（软重置 = 500 + (旧分−500)×0.5）
- [x] MatchMaker DO：快速匹配（30s 窗口凑人，不齐 bot 补位）+ 私房 6 位邀请码（房间号即邀请码）
- [x] 大厅 / 排位榜 / 收藏页（TanStack Router 文件路由 + Query）：档案卡、快速匹配、私房创建/加入、Top 20、收藏阈值解锁（纯外观）
- [x] 路由重构：/match/:matchId 承载对局，?match= 旧链接自动重定向；进对局前等匿名会话就绪（首条 hello 带身份，结算必落库）
- [x] 踩坑：assets 的 SPA fallback 会把「导航型请求」直接喂 index.html 绕过 worker——`run_worker_first: ["/api/*", "/ws/*"]` 强制 /api、/ws 先走 worker；重写 index.ts 时丢了 /ws 路由导致全场 WS 200-HTML（冒烟脚本 1 分钟定位）
- [x] **验收**：点开链接 → 匿名注册（自动）→ 大厅档案卡 → 快速匹配/私房 → 对局 → 结算落库 + 段位变化 → 排行榜可见，全程无死链（本地全流程过：真机完整一局跑完，结算弹窗「段位分 500 → 300」、排行榜首条「摊主pm6S（你）大排档学徒 300 · 1 场」；生产 API/身份/匹配/对局 wss 逐项验证）

### W7 打磨 ✅（2026-10-25 完成）
- [x] **音效**（决策 #22）：WebAudio 程序化合成 18 种音色（SimEvent.kind 一一映射 + 卖串进账音 + 入座音），全局 🔊/🔇 开关（localStorage 持久化，首手势解锁 AudioContext）
- [x] **手机端适配专项**：viewport 禁双击缩放 + dvh 兜底 iOS 地址栏；触屏热区≥44px（动作条/弹窗按钮/滑条拇指自绘加大）；画布 touch-action:none；**短横屏沉浸式对局页**（用户反馈二轮打磨：页头页脚隐藏、街景全屏、HUD 改顶部横排、动作条单行横向滚动、控制条通栏贴底、悬浮快捷条[←/⛶全屏/🔊]、对局号 chip 让位）——浏览器实测 812×375 / 667×375 / 桌面回归 / 竖屏旋转引导；低端设备降级（触屏或核少 → 分辨率 1.5x + NPC 8→5）
- [x] **数值平衡**（`pnpm balance` harness 落数据，见下）：罚款抽奖 0.2/s → 0.05/s（原「每步 2%」写法实际 18%/秒，过线即秒罚）、烧心/串 2.5 → 1.4（让自证循环算得过账）、**出餐改为按库存占比抽**（原 LIFO「狠活先卖」库存滚雪球，「半掺」实际吃成全狠活——滑条承诺与实际出餐一致了）。跑批结果：正经打法梯度 全良心 1984 > 半掺 1393 > 狠活会自证 1116（极差 1.78×，判定带 <2.2 达标），狠活摆烂 676 + 场均罚 23 次（惩罚路径成立）；狠活卖点=出餐量最高（223 串 vs 良心 176）走量赚钱，代价口碑归零。**W3 红线「真实纠结感」仍以用户试玩判定为准**——残余的良心优势（口碑×8 结算复利）是否压得太死，等用户手感反馈再微调
- [x] 平衡 harness 进 CI：全 bot 三策略 + 真人四脚本（含摆烂路径专项断言）同 seed 配对跑批，退化（某打法被饿死/分数极差超标）直接红
- [x] **GitHub OAuth 绑定**（W6 留）：worker socialProviders 按 secrets 存在性启用；/api/me 回 `providers`（能力位）+ `linked`（已绑列表）；大厅档案行「🐙 绑定 GitHub」（匿名→linkSocial 升级，段位/收藏跟账号走）；生产待用户 `wrangler secret put GITHUB_CLIENT_ID/SECRET`（README 有步骤，回调 `<origin>/api/auth/callback/github`）。邮箱升级明确推迟（受众开发者，GitHub 足够）
- [x] **apps/server-node 自部署逃生舱**（决策 #13 两缝兑现）：Hono on Node（@hono/node-server）+ `ws`（noServer + upgrade 分流）+ better-sqlite3 跑同一份迁移与 SQL 常量；RoomActor/MatchActor 纯类一行未改，进程内 `Map<roomId, NodeRoom>` 代替 DO，赛季滚动用 6h 定时器代替 Cron；better-auth 复用同一份 drizzle schema。`pnpm smoke:node` 冒烟全绿（healthz/回声/快速匹配/对局入座）+ tsx dev 模式实测
- [x] **双语 README**（中/EN 分文件）+ 架构图 + 免费额度账本 + 双部署路径指引（CF 一键 / Node 自部署）
- [x] **部署生产**：`burnless.20020612.xyz` 版本 87bdda33，healthz /api/me / 首页 + 静音按钮实测通过
- [ ] **验收（红线）**：陌生人不经解释点开链接能玩懂 —— 交给用户判定（建议手机横屏真实走一遍）

**W7 踩坑记录**（接 W4 记录续编）：
16. **「每步概率」的写法会骗人**：`rng() < 0.02 * dt * 10` 在 dt=0.1 的固定步长下就是每步 2%、每秒 ~18%，烧心过线后中位 3.5s 必挨罚——狠活被打成陷阱。概率参数必须以真实秒率命名（`riskFineChancePerS`）并按 `rate * dt` 消费，调参才可读可控。
17. **LIFO 出餐 + 每班过量进货会让「掺比」失真**：柜台压着上一班的货，进货滑条的良心占比和实际卖出占比完全脱节（bot 买 50% 良心实卖 10%）。改成按库存占比抽签出餐，滑条语义才成立。
18. **esbuild 打 ESM 包遇 CJS 依赖（ws）的动态 require**：`Dynamic require of "events"` → banner 桥 `createRequire(import.meta.url)`；但 banner 里的引号在 Windows cmd 会被吃掉，**必须走 esbuild JS API（build.mjs）而不是 CLI 拼参数**。
19. **IAB 自动化里注入式点击会整体失灵**（locator.click 与 cua.click 都超时、元素无遮挡、React 事件链正常）——此时用 `evaluate(() => el.click())` 走合成事件即可继续验证；代价是没有 isTrusted 手势，AudioContext 解锁路径测不到（真人点击无此问题）。
20. **杀 wrangler dev 后残余链会自动重拉 workerd**（W4 #13 变体）：清场只杀 workerd 没用，必须沿 npx→cmd→node 链整条杀干净再核对端口；且杀完的 wrangler 残骸可能处于「进程活着但请求挂死」状态（curl 超时），直接整链重来。
21. **手机横屏不能拿桌面布局硬塞**：竖排 HUD + 折行动作条 + 页头页脚在小横屏（375px 高）里把场景挤成一条。对局页要按「全屏游戏」设计——沉浸式隐藏页框、HUD 横排贴顶、操作压成上下两条、溢出走横向滚动（`flex-shrink:0` + `white-space:nowrap`，否则子项被压成竖排文字）。

## 5. 风险与预案

| 风险 | 等级 | 预案 |
|------|------|------|
| 程序化美术「呆」：顾客小人、火焰、菜品纯代码难画可爱 | 高 | 像素风宽容度高；有机物局部混 AI 生成或手修，色板常量保统一 |
| 国内访问 Cloudflare 延迟波动 | 中 | 决策型可容忍；文档如实标注；workers.dev 国内不可用，必须自有域名 |
| 梗过气 | 中 | 机制为核梗为皮；快速 MVP 本身就是解法 |
| 烂尾 | 中 | 竖切片顺序 + W3 红线；每周验收标准可打勾 |
| TanStack 库 + Vite 组合的小坑 | 低 | 仅用成熟客户端库，无 SSR/框架适配层 |

## 6. 开放问题（不阻塞 W1，按推荐值先行）

| 问题 | 推荐值 | 状态 |
|------|--------|------|
| 仓库 / 英文名 | `burnless`（游戏名《不烧心》），包 scope `@burnless/*` | ✅ 已定（#16） |
| 自有域名 | 需尽快购买（部署链路依赖它），`.dev`/`.io` 均可 | ✅ 已定：`20020612.xyz`（账号内 active zone），游戏走 `burnless.20020612.xyz` |
| 音效方案 | ~~freesound / kenney CC0 音效包拼接~~ → WebAudio 程序化合成 | ✅ 已定：程序化合成（决策 #22，W7 实装） |
| 赛季时长 | MVP 固定 4 周一季，Cron 结算 | ✅ 已定（W6） |
| 结算公式权重 | 营收 60% + 口碑 40% 起步 | ✅ 已定：score = 营收 + 口碑×8（W5） |

---

*最后更新：2026-10-25 · 决策来源：grill 拷问会议两轮 + W2~W7 中途拍板（22 项分支闭环）· W1 ✅ W2 ✅ W3 ✅（红线待用户判定）W4 ✅ W5 ✅ W6 ✅ W7 ✅（验收红线待用户判定；W8 余项：发布文案 + 掘金/V2EX/即刻 发帖）*
