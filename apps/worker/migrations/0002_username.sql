-- W8 用户名账号：better-auth username 插件在 user 表上的两个字段
-- （登录别名 username 全局唯一；displayUsername 保大小写的展示名）
-- 注意：ALTER TABLE ADD COLUMN 不支持 IF NOT EXISTS——幂等性由执行方保证
-- （D1 走 wrangler d1 migrations 的执行账本；Node runner 见 sqlite.ts 的 _migrations 表）

ALTER TABLE user ADD COLUMN username TEXT;
ALTER TABLE user ADD COLUMN display_username TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS user_username_idx ON user (username);
