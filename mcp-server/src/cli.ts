/**
 * NodeFlow MCP — 独立 npm 包 CLI(stdin/stdout stdio server)。
 *
 * 架构:
 *   WorkBuddy / MCP client ──stdio──► 本 CLI ──HTTP/JSON──► NodeFlow Agent Bridge(127.0.0.1)
 *
 * 原则:
 *   - stdout 只输出 MCP protocol;一切日志走 stderr;
 *   - 默认连 http://127.0.0.1:8787,可用 NODEFLOW_MCP_BRIDGE_URL 覆盖;
 *   - test.fixture 默认关闭(NODEFLOW_MCP_TEST_FIXTURE=1 才注册 reset/seed_fixture)。
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createNodeFlowMcpServer } from '../../src/mcp/server';
import { resolveBridgeUrl } from './env';
import { friendlyBridgeCall } from './friendly';

const VERSION = '0.4.0-next.2';

function log(msg: string): void {
  // 只写 stderr,绝不污染 stdout(stdio MCP protocol)。
  process.stderr.write(`[nodeflow-mcp] ${msg}\n`);
}

async function main(): Promise<void> {
  const bridgeUrl = resolveBridgeUrl(process.env);
  const testFixture = process.env.NODEFLOW_MCP_TEST_FIXTURE === '1';
  if (testFixture) log('NODEFLOW_MCP_TEST_FIXTURE=1: 注册 test-only tools(reset/seed_fixture)');

  const server = createNodeFlowMcpServer({
    name: 'nodeflow-mcp',
    version: VERSION,
    callAgent: friendlyBridgeCall(bridgeUrl),
    testFixture,
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((e) => {
  log(`fatal: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
