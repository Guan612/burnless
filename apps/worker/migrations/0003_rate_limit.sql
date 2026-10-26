-- better-auth 限流落库（storage='database' 需要的计数表，见 src/db/auth-schema.ts rateLimit）：
-- Workers 多 isolate 下默认的内存限流各算各的，落 D1 才是全局一致计数。
-- 过期行由 better-auth 顺带清理（deleteExpiredRows），无需 cron。

CREATE TABLE IF NOT EXISTS rate_limit (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  count INTEGER NOT NULL,
  last_request INTEGER NOT NULL
);
