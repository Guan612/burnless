-- W6 局外闭环初始化：better-auth 表（drizzle/better-auth 官方 sqlite schema）+ 游戏档案表
-- 时间列统一存毫秒整数（游戏表）；better-auth 表由 drizzle timestamp 模式自管，别手碰

-- ===== better-auth 核心表 =====
CREATE TABLE IF NOT EXISTS user (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  email_verified INTEGER NOT NULL DEFAULT 0,
  image TEXT,
  is_anonymous INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS session (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS account (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  access_token TEXT,
  refresh_token TEXT,
  access_token_expires_at INTEGER,
  refresh_token_expires_at INTEGER,
  scope TEXT,
  id_token TEXT,
  password TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS verification (
  id TEXT PRIMARY KEY,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS session_user_id_idx ON session (user_id);
CREATE INDEX IF NOT EXISTS account_user_id_idx ON account (user_id);

-- ===== 游戏档案（queries 模块契约，字段见 shared/src/db/queries.ts） =====
CREATE TABLE IF NOT EXISTS seasons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at INTEGER NOT NULL,
  ended_at INTEGER
);

CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,            -- better-auth user id
  name TEXT NOT NULL,
  rating INTEGER NOT NULL DEFAULT 500,
  matches INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS match_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id TEXT NOT NULL REFERENCES players(id),
  match_id TEXT NOT NULL,
  score INTEGER NOT NULL,
  revenue INTEGER NOT NULL,
  reputation INTEGER NOT NULL,
  grade_key TEXT NOT NULL,
  rating_after INTEGER NOT NULL,
  season_id INTEGER NOT NULL REFERENCES seasons(id),
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS match_results_player_idx ON match_results (player_id, created_at);

CREATE TABLE IF NOT EXISTS unlocks (
  player_id TEXT NOT NULL REFERENCES players(id),
  item_id TEXT NOT NULL,           -- 目录在 shared 代码里（COLLECTION），不建表防漂移
  unlocked_at INTEGER NOT NULL,
  PRIMARY KEY (player_id, item_id)
);
