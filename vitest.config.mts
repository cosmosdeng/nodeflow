import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * 测试分两个 project:
 * - logic:纯逻辑(lib / store / agent / domain / mcp)沿用 **node** 环境,保持原有 500 用例的速度;
 * - components:组件(.test.tsx)用 **jsdom** 环境,并加载 React Flow 所需的浏览器 API mock。
 */
export default defineConfig({
  plugins: [react()],
  test: {
    projects: [
      {
        test: {
          name: 'logic',
          include: ['src/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'components',
          include: ['src/**/*.test.tsx'],
          environment: 'jsdom',
          setupFiles: ['./src/test/setup.ts'],
        },
      },
    ],
  },
});
