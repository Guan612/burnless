// esbuild JS API 打包（banner 引号在 Windows cmd 下会被吃掉，所以不走 CLI）
import { build } from 'esbuild'

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: 'dist/server.mjs',
  external: ['better-sqlite3'],
  banner: {
    // ESM 产物里的 CJS 依赖（ws 等）动态 require 内置模块：桥接 createRequire
    js: `import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);`,
  },
})
console.log('[build] dist/server.mjs done')
