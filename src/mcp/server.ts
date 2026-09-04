/**
 * NodeFlow MCP Adapter — Server。
 *
 * 架构:MCP Tool → Agent Interface command(信封)→ Local Bridge(127.0.0.1)→ Store。
 * MCP 层不复制任何 NodeFlow 业务逻辑;只负责:
 *   1) 把 Tool 参数映射成 AgentRequest(结构校验);
 *   2) 调用注入的 AgentCall(默认 HTTP Bridge);
 *   3) 把 AgentResponse 转成 MCP 可消费的 content。
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  AGENT_PROTOCOL_VERSION,
  type AgentCommandResult,
  type AgentRequest,
  type AgentResponse,
} from '../agent/types';
import { toolSchemas, type ToolName } from './schemas';
import type { AgentCall } from './bridge';

const RID = () => `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

export interface NodeFlowMcpServerOptions {
  callAgent: AgentCall;
  /** 名称/版本(MCP serverInfo) */
  name?: string;
  version?: string;
  /** test.fixture 是否开启(默认 false);开启后才注册 reset/seed_fixture。 */
  testFixture?: boolean;
}

const TEST_ONLY_TOOLS: ReadonlySet<string> = new Set(['reset', 'seed_fixture']);

const caps = (testFixture: boolean) => ({
  'graph.read': true,
  'graph.write': true,
  'graph.assert': true,
  'graph.screenshot': true,
  'test.fixture': testFixture,
});

/** 注册全部 normal tools;test-only tools 仅在 testFixture=true 时注册。 */
export function createNodeFlowMcpServer(opts: NodeFlowMcpServerOptions): McpServer {
  const testFixture = opts.testFixture === true;
  const server = new McpServer(
    { name: opts.name ?? 'nodeflow-mcp', version: opts.version ?? '0.4.0' },
    { capabilities: { tools: {}, resources: {} } },
  );

  const register = (
    name: ToolName,
    description: string,
    handler: (args: Record<string, unknown>) => Promise<unknown>,
  ) => {
    // SDK 泛型签名无法表达"异构 shape 集合",此处仅通过结构接口适配,运行时不做任何跳过
    const reg = server as unknown as {
      registerTool(
        name: string,
        config: { description?: string; inputSchema?: unknown },
        cb: (args: Record<string, unknown>) => Promise<unknown>,
      ): unknown;
    };
    reg.registerTool(
      name,
      {
        description,
        inputSchema: toolSchemas[name],
      },
      async (args: Record<string, unknown>) => {
        const result = await handler(args ?? {});
        if (isMcpResult(result)) return result;
        return textResult(result);
      },
    );
  };

  const isMcpResult = (v: unknown): v is { content: unknown[] } =>
    typeof v === 'object' && v !== null && Array.isArray((v as { content?: unknown }).content);

  const invoke = async (type: string, payload?: unknown): Promise<AgentResponse> => {
    const req: AgentRequest = {
      protocolVersion: AGENT_PROTOCOL_VERSION,
      requestId: RID(),
      type: type as AgentRequest['type'],
      payload,
    };
    return opts.callAgent(req);
  };

  const guarded = async (
    agentType: string,
    payload: unknown,
  ): Promise<{ success: true; data: unknown } | { success: false; error: AgentResponse['error'] }> => {
    const res = await invoke(agentType, payload);
    if (res.success) return { success: true as const, data: res.data };
    return { success: false as const, error: res.error };
  };

  const mutation = async (agentType: string, args: Record<string, unknown>) => {
    const out = await guarded(agentType, args);
    if (!out.success) return toolError(out.error);
    const cmd = (out.data ?? {}) as Partial<AgentCommandResult>;
    return {
      success: true,
      previousRevision: cmd.previousRevision,
      revision: cmd.newRevision,
      ...(cmd.result ?? {}),
    };
  };

  // ---- Observe ----
  const observe = (agentType: string) => async (_args: Record<string, unknown>) => {
    const out = await guarded(agentType, {});
    if (!out.success) return toolError(out.error);
    return out.data;
  };

  register('get_graph_state', '获取 NodeFlow 完整 Graph State(含 revision/nodes/edges/participants/stages/viewport/selection)', observe('getGraphState'));
  register('get_document', '获取当前文档信息', observe('getDocument'));
  register('get_nodes', '获取节点 DTO 列表', observe('getNodes'));
  register('get_edges', '获取连线 DTO 列表', observe('getEdges'));
  register('get_participants', '获取参与方列表', observe('getParticipants'));
  register('get_stages', '获取阶段列表', observe('getStages'));
  register('get_viewport', '获取画布视口', observe('getViewport'));
  register('get_selection', '获取当前选中项', observe('getSelection'));
  register('get_annotations', '获取注释列表', observe('getAnnotations'));
  register('get_capabilities', '获取 MCP/Agent 可用能力(含 test.fixture)', async () => caps(testFixture));

  // ---- Act ----
  register('create_node', '创建节点(label 必填;x/y 可选定位)', async (a) => {
    const payload: Record<string, unknown> = { label: a.label };
    if (a.description !== undefined) payload.description = a.description;
    if (a.x !== undefined && a.y !== undefined) payload.position = { x: a.x, y: a.y };
    return mutation('createNode', payload);
  });
  register('update_node', '更新节点 label/description', async (a) => {
    const patch: Record<string, unknown> = {};
    if (a.label !== undefined) patch.label = a.label;
    if (a.description !== undefined) patch.description = a.description;
    return mutation('updateNode', { nodeId: a.nodeId, patch });
  });
  register('delete_node', '删除节点', (a) => mutation('deleteNode', { nodeId: a.nodeId }));
  register('create_participant', '创建参与方', (a) => mutation('createParticipant', a));
  register('update_participant', '更新参与方', (a) => mutation('updateParticipant', { id: a.id, patch: { name: a.name, type: a.type } }));
  register('delete_participant', '删除参与方', (a) => mutation('deleteParticipant', { id: a.id }));
  register('create_stage', '创建阶段(Stage)', (a) => mutation('createStage', a));
  register('update_stage', '更新阶段名', (a) => mutation('updateStage', { id: a.id, patch: { name: a.name } }));
  register('delete_stage', '删除阶段', (a) => mutation('deleteStage', { id: a.id }));
  register('connect_edge', '在两节点间创建连线(默认 out_1→in_1)', (a) => mutation('connectNodes', a));
  register('delete_edge', '删除连线', (a) => mutation('deleteEdge', { id: a.id }));
  register('move_node', '移动节点到(x,y)(一次原子历史)', (a) =>
    mutation('moveNode', { nodeId: a.nodeId, position: { x: a.x, y: a.y } }),
  );
  register('assign_participant', '把节点分配给参与方(语义,不自动重排)', (a) =>
    mutation('assignParticipant', { nodeId: a.nodeId, participantId: a.participantId }),
  );
  register('assign_stage', '把节点归入阶段(语义,不自动重排)', (a) =>
    mutation('assignStage', { nodeId: a.nodeId, stageId: a.stageId }),
  );
  register('arrange', '执行与工具栏一致的 Smart Arrange', () => mutation('arrange', {}));
  register('undo', '撤销一次(与 GUI 同一 history)', () => mutation('undo', {}));
  register('redo', '重做一次', () => mutation('redo', {}));

  // ---- Phase D:Gateway / Artifact / Annotation ----
  register('create_gateway', '创建 BPMN 网关(exclusive/parallel/inclusive)', (a) => {
    const payload: Record<string, unknown> = { type: a.type };
    if (a.x !== undefined && a.y !== undefined) payload.position = { x: a.x, y: a.y };
    return mutation('createGateway', payload);
  });
  register('change_gateway_type', '切换网关类型', (a) =>
    mutation('changeGatewayType', { nodeId: a.nodeId, type: a.type }),
  );
  register('attach_artifact', '给连线挂载中间产物(Artifact)', (a) => mutation('attachArtifact', a));
  register('update_artifact', '更新连线中间产物', (a) => mutation('updateArtifact', a));
  register('remove_artifact', '移除连线中间产物', (a) => mutation('removeArtifact', a));
  register('create_annotation', '创建注释(挂到 node/edge/stage/canvas/artifact)', (a) => {
    const target: Record<string, unknown> = { kind: a.targetKind };
    if (a.nodeId !== undefined) target.nodeId = a.nodeId;
    if (a.edgeId !== undefined) target.edgeId = a.edgeId;
    if (a.stageId !== undefined) target.stageId = a.stageId;
    if (a.tabId !== undefined) target.tabId = a.tabId;
    const payload: Record<string, unknown> = { target };
    if (a.title !== undefined) payload.title = a.title;
    if (a.content !== undefined) payload.content = a.content;
    if (a.x !== undefined && a.y !== undefined) payload.position = { x: a.x, y: a.y };
    return mutation('createAnnotation', payload);
  });
  register('update_annotation', '更新注释标题/内容', (a) =>
    mutation('updateAnnotation', { id: a.id, title: a.title, content: a.content }),
  );
  register('delete_annotation', '删除注释', (a) => mutation('deleteAnnotation', { id: a.id }));
  register('move_annotation', '移动注释到(x,y)', (a) =>
    mutation('moveAnnotation', { id: a.id, position: { x: a.x, y: a.y } }),
  );

  // ---- Verify ----
  register('assert', '执行 NodeFlow 语义/几何断言,返回 {passed,actual,expected}', async (a) => {
    const out = await guarded('assert', a);
    if (!out.success) {
      // 断言失败是结构化业务结果:透传给 MCP,不吞掉
      const details = out.error?.details && typeof out.error.details === 'object'
        ? (out.error.details as { result?: unknown }).result
        : null;
      return { passed: false, assertion: a.type, result: details ?? out.error };
    }
    return out.data;
  });

  // ---- See ----
  register('screenshot', '获取画布/窗口 PNG(base64)', async (a) => {
    const target = a.target === 'window' ? 'getWindowScreenshot' : 'getCanvasScreenshot';
    const out = await guarded(target, {});
    if (!out.success) return toolError(out.error);
    const shot = out.data as { format: string; mimeType: string; data: string; width: number; height: number };
    return {
      content: [{ type: 'image', data: shot.data, mimeType: shot.mimeType }],
    };
  });

  // ---- test.fixture(仅显式开启) ----
  if (testFixture) {
    register('reset', '重置测试图(空文档,test-only)', () => mutation('reset', {}));
    register('seed_fixture', '加载确定性测试图(3 参与方/3 阶段/10 节点/边,test-only)', () => mutation('seedFixture', {}));
  }

  return server;
}

function toolError(error: AgentResponse['error']) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          code: error?.code ?? 'COMMAND_FAILED',
          message: error?.message ?? 'Agent 调用失败',
          details: error?.details ?? null,
        }),
      },
    ],
    isError: true,
  };
}

function textResult(data: unknown) {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] };
}
