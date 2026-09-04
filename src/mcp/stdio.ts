/**
 * NodeFlow MCP Adapter — stdio 入口。
 *
 * 用法:
 *   NODEFLOW_MCP_BRIDGE_URL=http://127.0.0.1:8787 \
 *   [NODEFLOW_MCP_TEST_FIXTURE=1] \
 *   bun src/mcp/stdio.ts
 *
 * 只连 localhost NodeFlow Agent Bridge;不监听公网/不执行 shell/不访问任意文件系统。
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createNodeFlowMcpServer } from './server';
import { httpBridgeCall } from './bridge';

const bridgeUrl = process.env.NODEFLOW_MCP_BRIDGE_URL ?? 'http://127.0.0.1:8787';
const testFixture = process.env.NODEFLOW_MCP_TEST_FIXTURE === '1';

async function main(): Promise<void> {
  const server = createNodeFlowMcpServer({
    name: 'nodeflow-mcp',
    version: '0.4.0',
    callAgent: httpBridgeCall(bridgeUrl),
    testFixture,
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((e) => {
  console.error(`[nodeflow-mcp] fatal: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
