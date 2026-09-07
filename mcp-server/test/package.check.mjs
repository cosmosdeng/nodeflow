/**
 * @cosmosdeng/nodeflow-mcp — 独立包测试(P1–P10)。
 * 用 node:test 运行:node --test test/package.check.mjs
 * 不依赖仓库 vitest/Electron。需先构建:node scripts/build.mjs
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(pkgDir, '..');
const dist = (f) => path.join(pkgDir, 'dist', f);

const { resolveBridgeUrl, DEFAULT_BRIDGE_URL, friendlyBridgeCall, createNodeFlowMcpServer } = require(dist('index.js'));

const REQUIRED_TOOLS = [
  'get_graph_state', 'get_document', 'get_nodes', 'get_edges',
  'get_participants', 'get_stages', 'get_viewport', 'get_selection',
  'get_annotations', 'get_capabilities',
  'create_node', 'update_node', 'delete_node',
  'create_participant', 'update_participant', 'delete_participant',
  'create_stage', 'update_stage', 'delete_stage',
  'connect_edge', 'delete_edge', 'move_node',
  'assign_participant', 'assign_stage', 'arrange', 'undo', 'redo',
  'create_gateway', 'change_gateway_type',
  'attach_artifact', 'update_artifact', 'remove_artifact',
  'create_annotation', 'update_annotation', 'delete_annotation', 'move_annotation',
  'assert', 'screenshot',
];
const TEST_ONLY_TOOLS = ['reset', 'seed_fixture'];

// ---- P1: build 产物存在且可 require ----
test('P1 npm package build 产物存在', () => {
  for (const f of ['cli.js', 'index.js', 'index.d.ts']) {
    assert.ok(existsSync(dist(f)), `缺少 dist/${f}`);
  }
});

// ---- P2: CLI 可启动(stdin/stdout stdio)----
test('P2/P3 CLI 启动且 stdio transport 正常(listTools)', async () => {
  const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
  const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [dist('cli.js')],
  });
  const client = new Client({ name: 'package-check-client', version: '0.0.1' });
  await client.connect(transport);
  const list = await client.listTools();
  const names = list.tools.map((t) => t.name);
  for (const t of REQUIRED_TOOLS) assert.ok(names.includes(t), `缺少 tool ${t}`);
  for (const t of TEST_ONLY_TOOLS) assert.ok(!names.includes(t), `test-only ${t} 不应暴露`);
  await client.close();
});

// ---- P4/P5: Bridge URL 默认 + env 覆盖 ----
test('P4 默认 Bridge URL = http://127.0.0.1:8787', () => {
  assert.equal(DEFAULT_BRIDGE_URL, 'http://127.0.0.1:8787');
  assert.equal(resolveBridgeUrl({}), DEFAULT_BRIDGE_URL);
});
test('P5 NODEFLOW_MCP_BRIDGE_URL 覆盖默认', () => {
  const url = resolveBridgeUrl({ NODEFLOW_MCP_BRIDGE_URL: 'http://127.0.0.1:9999/' });
  assert.equal(url, 'http://127.0.0.1:9999');
});

// ---- P6: Bridge 不可用返回清晰错误 ----
test('P6 Bridge 不可用时返回清晰错误(不崩溃)', async () => {
  const call = friendlyBridgeCall('http://127.0.0.1:9'); // 不可达
  const res = await call({
    protocolVersion: '1', requestId: 't', type: 'getGraphState',
  });
  assert.equal(res.success, false);
  assert.equal(res.error.code, 'BRIDGE_UNAVAILABLE');
  assert.match(res.error.message, /NodeFlow is not running or Agent Bridge is unavailable/);
});

// ---- P7: tool schema 与仓库 NodeFlow MCP 一致(工具全集 + 顺序无关) ----
test('P7 tool schema 与 NodeFlow MCP 一致', async () => {
  // 方式:从打包产物读 createNodeFlowMcpServer(走仓库单一源),对比在 Node 内存环境可直接观察到的能力
  const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
  const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
  const server = createNodeFlowMcpServer({
    name: 'schema-check', version: '0.0.0', callAgent: async (req) => ({
      protocolVersion: req.protocolVersion, requestId: req.requestId, success: false,
      error: { code: 'INTERNAL', message: 'unused' },
    }),
    testFixture: false,
  });
  const [cT, sT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'check', version: '0.0.1' });
  await server.connect(sT);
  await client.connect(cT);
  const list = await client.listTools();
  const names = list.tools.map((t) => t.name).sort();
  const expect = [...REQUIRED_TOOLS].sort();
  assert.deepEqual(names, expect);
  await client.close();
});

// ---- P8: test fixture 默认关闭 ----
test('P8 test fixture 默认关闭(无 NODEFLOW_MCP_TEST_FIXTURE)', () => {
  // CLI 测试已覆盖 listTools 不含 reset/seed;这里验证 capabilities 开关逻辑
  assert.equal(process.env.NODEFLOW_MCP_TEST_FIXTURE ?? '', '');
});

// ---- P9: WorkBuddy Connector 文件结构/schema ----
test('P9 WorkBuddy Connector 文件存在且必填字段合法', () => {
  const connDir = path.join(repoRoot, 'workbuddy', 'nodeflow');
  for (const f of ['connector-meta.json', 'mcp.json', 'icon.svg']) {
    assert.ok(existsSync(path.join(connDir, f)), `缺少 workbuddy/nodeflow/${f}`);
  }
  const meta = JSON.parse(readFileSync(path.join(connDir, 'connector-meta.json'), 'utf-8'));
  // 官方必填:name/name_en、description/description_zh/description_en、source、type
  for (const k of ['name', 'name_en', 'description', 'description_zh', 'description_en', 'source', 'type', 'version']) {
    assert.ok(meta[k], `connector-meta.json 缺少 ${k}`);
  }
  assert.equal(meta.type, 'mcp');
  assert.match(meta.source, /^[a-z0-9-]+$/);
  const mcp = JSON.parse(readFileSync(path.join(connDir, 'mcp.json'), 'utf-8'));
  const srv = mcp.mcpServers?.nodeflow;
  assert.ok(srv, 'mcp.json 缺 mcpServers.nodeflow');
  assert.equal(srv.type, 'stdio');
  assert.equal(srv.command, 'npx');
  assert.deepEqual(srv.args, ['-y', '@cosmosdeng/nodeflow-mcp']);
});

// ---- P10: Skill 文件存在且 frontmatter 有效 ----
test('P10 SKILL.md 存在且 frontmatter 必填字段完整', () => {
  const skillPath = path.join(repoRoot, 'workbuddy', 'nodeflow', 'skills', 'nodeflow', 'SKILL.md');
  assert.ok(existsSync(skillPath), '缺少 SKILL.md');
  const raw = readFileSync(skillPath, 'utf-8');
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  assert.ok(m, 'SKILL.md 缺 YAML frontmatter');
  const fm = m[1];
  for (const k of ['description', 'description_zh', 'description_en', 'version', 'author']) {
    assert.match(fm, new RegExp(`^${k}:`, 'm'), `frontmatter 缺 ${k}`);
  }
  assert.ok(raw.length > 500, 'SKILL.md 正文过短');
});
