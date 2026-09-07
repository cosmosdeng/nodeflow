/**
 * NodeFlow MCP — 独立 npm 包公共入口。
 *
 * 注意:
 * - 运行时产物(dist/)由 scripts/build.mjs 用 esbuild 从仓库 src/ 单一源打包而来;
 * - 本文件只做 re-export,不复制任何 NodeFlow 业务逻辑。
 */
export { createNodeFlowMcpServer } from '../../src/mcp/server';
export { httpBridgeCall } from '../../src/mcp/bridge';
export { toolSchemas } from '../../src/mcp/schemas';
export { DEFAULT_BRIDGE_URL, resolveBridgeUrl } from './env';
export { friendlyBridgeCall } from './friendly';
