import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import tanstackRouter from '@tanstack/router-plugin/vite'

export default defineConfig({
  // 顺序约定：router 插件先于 react 插件，先生成 routeTree 再过 babel
  plugins: [
    tanstackRouter(),
    react({
      babel: {
        // React Compiler 接管细粒度性能优化（决策 #21）：业务代码禁手写 useMemo/useCallback
        plugins: [['babel-plugin-react-compiler', {}]],
      },
    }),
  ],
  server: {
    proxy: {
      '/api': 'http://localhost:8787',
      '/ws': { target: 'http://localhost:8787', ws: true },
    },
  },
})
