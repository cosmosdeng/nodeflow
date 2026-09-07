/**
 * @cosmosdeng/nodeflow-mcp — 构建脚本。
 *
 * 产物:
 *   dist/cli.js   — CLI bin(stdio server),bundle 仓库内 MCP 源码,仅 external sdk/zod;
 *   dist/index.js — 库入口(re-export)。
 *
 * 原则:
 *   - 不复制 NodeFlow 源码:通过相对引用 bundle 仓库内 src/mcp + src/agent/types;
 *   - dist 自包含,运行时只依赖 @modelcontextprotocol/sdk 与 zod(见 package.json dependencies);
 *   - 绝不把 Electron / React / 整个 NodeFlow src 打进 dist。
 */
import { build } from 'esbuild';
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(__dirname, '..');
const rootDir = path.resolve(pkgDir, '..');
// 确保从根 node_modules 解析 esbuild(仓库内无 workspaces 时本脚本仍可运行)
void require.resolve('esbuild');

const common = {
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  sourcemap: false,
  // MCP server 源码经相对 import 从仓库 bundle 进来;两个 runtime 依赖保持 external
  external: ['@modelcontextprotocol/sdk', 'zod'],
  logLevel: 'info',
};

async function main() {
  mkdirSync(path.join(pkgDir, 'dist'), { recursive: true });

  await build({
    ...common,
    entryPoints: [path.join(pkgDir, 'src', 'cli.ts')],
    outfile: path.join(pkgDir, 'dist', 'cli.js'),
    banner: { js: '#!/usr/bin/env node' },
  });

  await build({
    ...common,
    entryPoints: [path.join(pkgDir, 'src', 'index.ts')],
    outfile: path.join(pkgDir, 'dist', 'index.js'),
  });

  copyFileSync(
    path.join(pkgDir, 'types', 'index.d.ts'),
    path.join(pkgDir, 'dist', 'index.d.ts'),
  );

  console.log(`[nodeflow-mcp] build ok -> ${path.join(pkgDir, 'dist')} (root=${rootDir})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
