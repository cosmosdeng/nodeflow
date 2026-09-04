import { beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createNodeFlowMcpServer } from '../server';
import { executeAgentRequest } from '../../agent/executor';
import { setAgentTestCommandsEnabled } from '../../agent/capabilities';
import { AGENT_PROTOCOL_VERSION, type AgentRequest } from '../../agent/types';

const agent = (type: string, payload?: unknown) =>
  executeAgentRequest({
    protocolVersion: AGENT_PROTOCOL_VERSION,
    requestId: `t-${Math.random().toString(36).slice(2, 7)}`,
    type: type as AgentRequest['type'],
    payload,
  });

interface ContentLike {
  type?: string;
  text?: string;
}

interface ResultLike {
  content: ContentLike[];
  isError?: boolean;
}

function textData(r: ResultLike): unknown {
  const t = r.content.find((c) => c.type === 'text');
  if (!t?.text) return null;
  try {
    return JSON.parse(t.text);
  } catch {
    return t.text;
  }
}

async function makePair(testFixture: boolean) {
  const server = createNodeFlowMcpServer({
    name: 'nodeflow-mcp-test',
    version: '0.0.0-test',
    callAgent: (req) => executeAgentRequest(req),
    testFixture,
  });
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.1' });
  await server.connect(serverT);
  await client.connect(clientT);
  return { server, client };
}

describe('NodeFlow MCP Adapter — normal capabilities', () => {
  let client: Client;

  beforeEach(async () => {
    setAgentTestCommandsEnabled(true);
    const pair = await makePair(true);
    client = pair.client;
    await executeAgentRequest({
      protocolVersion: AGENT_PROTOCOL_VERSION,
      requestId: 'setup-reset',
      type: 'reset',
    });
    await executeAgentRequest({
      protocolVersion: AGENT_PROTOCOL_VERSION,
      requestId: 'setup-seed',
      type: 'seedFixture',
    });
  });

  it('listTools 暴露核心语义工具(含 test-only,因开启 fixture)', async () => {
    const list = await client.listTools();
    const names = list.tools.map((t) => t.name);
    for (const expected of [
      'get_graph_state',
      'create_node',
      'move_node',
      'assign_participant',
      'assign_stage',
      'arrange',
      'undo',
      'redo',
      'assert',
      'screenshot',
      'get_capabilities',
      'reset',
      'seed_fixture',
    ]) {
      expect(names).toContain(expected);
    }
  });

  it('observe:get_graph_state 返回 revision 与节点/参与方/阶段', async () => {
    const r = (await client.callTool({ name: 'get_graph_state', arguments: {} })) as unknown as ResultLike;
    const data = textData(r) as { revision: number; nodes: unknown[]; participants: unknown[]; stages: unknown[] };
    expect(data.nodes.length).toBeGreaterThanOrEqual(10);
    expect(data.participants.length).toBe(3);
    expect(data.stages.length).toBe(3);
    expect(typeof data.revision).toBe('number');
  });

  it('mutation:create_node(用返回 nodeId 续链)→ assign → arrange,revision 递增', async () => {
    const before = (textData((await client.callTool({ name: 'get_graph_state', arguments: {} })) as unknown as ResultLike) as { revision: number }).revision;

    const create = textData((await client.callTool({
      name: 'create_node',
      arguments: { label: 'MCP 新节点', x: 10, y: 10 },
    })) as unknown as ResultLike) as { success: boolean; revision: number; nodeId: string };
    expect(create.success).toBe(true);
    expect(typeof create.nodeId).toBe('string');
    expect(create.revision).toBeGreaterThan(before);

    // AI 直接用上一步返回值继续,无需回查猜测
    const parts = (textData((await client.callTool({ name: 'get_participants', arguments: {} })) as unknown as ResultLike) as { id: string }[]);
    const stages = (textData((await client.callTool({ name: 'get_stages', arguments: {} })) as unknown as ResultLike) as { id: string }[]);
    const assignP = textData((await client.callTool({ name: 'assign_participant', arguments: { nodeId: create.nodeId, participantId: parts[0].id } })) as unknown as ResultLike) as { success: boolean; revision: number };
    expect(assignP.success).toBe(true);
    const assignS = textData((await client.callTool({ name: 'assign_stage', arguments: { nodeId: create.nodeId, stageId: stages[0].id } })) as unknown as ResultLike) as { success: boolean; revision: number };
    expect(assignS.success).toBe(true);
    const arrange = textData((await client.callTool({ name: 'arrange', arguments: {} })) as unknown as ResultLike) as { success: boolean; revision: number };
    expect(arrange.success).toBe(true);
    expect(arrange.revision).toBeGreaterThan(assignS.revision);

    const after = (textData((await client.callTool({ name: 'get_graph_state', arguments: {} })) as unknown as ResultLike) as { revision: number }).revision;
    expect(after).toBe(arrange.revision);
  });

  it('query 不推进 revision', async () => {
    const r1 = (textData((await client.callTool({ name: 'get_graph_state', arguments: {} })) as unknown as ResultLike) as { revision: number }).revision;
    await client.callTool({ name: 'get_participants', arguments: {} });
    await client.callTool({ name: 'get_stages', arguments: {} });
    const r2 = (textData((await client.callTool({ name: 'get_graph_state', arguments: {} })) as unknown as ResultLike) as { revision: number }).revision;
    expect(r2).toBe(r1);
  });

  it('human mutation:直接 store action 修改后,MCP observe 能看到 revision 变化', async () => {
    const { executeAgentRequest: _unused } = await import('../../agent/executor');
    void _unused;
    const before = (textData((await client.callTool({ name: 'get_graph_state', arguments: {} })) as unknown as ResultLike) as { revision: number }).revision;
    // Human/GUI 侧:直接走 store action(模拟 GUI mutation)
    const { useGraphStore } = await import('../../store/graphStore');
    useGraphStore.getState().addParticipant('Human GUI 改动', 'department');
    const after = (textData((await client.callTool({ name: 'get_graph_state', arguments: {} })) as unknown as ResultLike) as { revision: number }).revision;
    expect(after).toBeGreaterThan(before);
  });

  it('断言与错误模型:无效输入/结构错误结构化返回', async () => {
    const missing = await client.callTool({ name: 'move_node', arguments: { nodeId: 'x' } });
    const asRes = missing as unknown as ResultLike;
    expect(asRes.isError ?? false).toBe(true);

    const badAssert = await client.callTool({
      name: 'assert',
      arguments: { type: 'assertNodeExists', nodeId: 'not-exist' },
    });
    const assertRes = badAssert as unknown as ResultLike;
    const data = textData(assertRes) as { passed?: boolean };
    expect(data.passed).toBe(false);
  });

  it('screenshot 工具存在(canvas 调用在无 DOM 环境返回结构化错误)', async () => {
    const r = (await client.callTool({ name: 'screenshot', arguments: { target: 'canvas' } })) as unknown as ResultLike;
    // node 环境无 DOM:应为结构化错误而非崩溃;真实 E2E 中返回 image
    expect(r.isError ?? false).toBe(true);
  });

  it('Phase D 工具:gateway/artifact/annotation 经 Agent 映射可用', async () => {
    const list = await client.listTools();
    const names = list.tools.map((t) => t.name);
    for (const expected of ['create_gateway', 'change_gateway_type', 'attach_artifact', 'create_annotation', 'update_annotation', 'get_annotations']) {
      expect(names).toContain(expected);
    }

    const gw = textData((await client.callTool({ name: 'create_gateway', arguments: { type: 'exclusive', x: 5, y: 5 } })) as unknown as ResultLike) as { gatewayId: string; success: boolean };
    expect(gw.success).toBe(true);
    expect(gw.gatewayId).toBeTruthy();
    const cg = textData((await client.callTool({ name: 'change_gateway_type', arguments: { nodeId: gw.gatewayId, type: 'inclusive' } })) as unknown as ResultLike) as { success: boolean };
    expect(cg.success).toBe(true);

    const s = textData((await client.callTool({ name: 'get_graph_state', arguments: {} })) as unknown as ResultLike) as {
      nodes: { id: string; label: string }[];
    };
    const a = s.nodes.find((x) => x.label === 'Node 01')!;
    const b = s.nodes.find((x) => x.label === 'Node 06')!;
    const e = textData((await client.callTool({ name: 'connect_edge', arguments: { source: a.id, target: b.id } })) as unknown as ResultLike) as { edgeId: string };
    const art = textData((await client.callTool({ name: 'attach_artifact', arguments: { edgeId: e.edgeId, kind: 'video', label: '片段' } })) as unknown as ResultLike) as { success: boolean; artifactId: string };
    expect(art.success).toBe(true);
    expect(art.artifactId).toBeTruthy();

    const ann = textData((await client.callTool({ name: 'create_annotation', arguments: { targetKind: 'node', nodeId: a.id, title: '说明', content: '正文' } })) as unknown as ResultLike) as { success: boolean; annotationId: string };
    expect(ann.success).toBe(true);
    expect(ann.annotationId).toBeTruthy();

    const nodes = textData((await client.callTool({ name: 'get_nodes', arguments: {} })) as unknown as ResultLike) as {
      id: string; isGateway: boolean; gatewayType: string | null;
    }[];
    const gwDto = nodes.find((n) => n.id === gw.gatewayId)!;
    expect(gwDto.isGateway).toBe(true);
    expect(gwDto.gatewayType).toBe('inclusive');
  });
});

describe('NodeFlow MCP Adapter — test.fixture 默认不暴露', () => {
  it('testFixture=false 时 reset/seed_fixture 不出现在 tools;get_capabilities 为 false', async () => {
    const pair = await makePair(false);
    const list = await pair.client.listTools();
    const names = list.tools.map((t) => t.name);
    expect(names).not.toContain('reset');
    expect(names).not.toContain('seed_fixture');
    expect(names).toContain('get_capabilities');
    const r = (await pair.client.callTool({ name: 'get_capabilities', arguments: {} })) as unknown as ResultLike;
    const caps = textData(r) as { 'test.fixture'?: boolean };
    expect(caps['test.fixture']).toBe(false);
  });
});
