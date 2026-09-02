import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // 测试直连引擎源码（避免依赖 engine dist 未重建导致测到旧版）；
      // 对外发布契约仍由 test:contract 走真实打包产物验证
      '@mud/ecs-engine': new URL('../engine/src/index.ts', import.meta.url).pathname,
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      exclude: ['node_modules/', 'dist/'],
    },
  },
});
