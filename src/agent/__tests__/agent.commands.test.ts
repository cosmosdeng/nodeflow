import { beforeEach, describe, expect, it } from 'vitest';
import { executeAgentRequest } from '../executor';
import {
  AGENT_PROTOCOL_VERSION,
  type AgentCommandResult,
  type AgentGraphState,
  type AgentRequest,
  type AgentRequestType,
} from '../types';
import { useGraphStore } from '../../store/graphStore';

interface AgentTestResult {
  success: boolean;
  data?: unknown;
  error?: { code?: string; message?: string };
}

async function act(type: AgentRequestType, payload?: unknown): Promise<AgentTestResult> {
  const r = await executeAgentRequest({
    protocolVersion: AGENT_PROTOCOL_VERSION,
    requestId: `r-${Math.random().toString(36).slice(2, 8)}`,
    type,
    payload,
  });
  return { success: r.success, data: r.data, error: r.error };
}

function raw(type: string, payload?: unknown): AgentRequest {
  return { protocolVersion: AGENT_PROTOCOL_VERSION, requestId: 'x', type, payload } as unknown as AgentRequest;
}

async function state(): Promise<AgentGraphState> {
  const r = await act('getGraphState');
  return r.data as AgentGraphState;
}

function cr(r: AgentTestResult): AgentCommandResult | undefined {
  return r.data as AgentCommandResult | undefined;
}

describe('Agent Interface — protocol', () => {
  it('协议版本不匹配 → 结构化 INVALID_REQUEST', async () => {
    const resp = await executeAgentRequest({
      protocolVersion: '999',
      requestId: 'x1',
      type: 'getGraphState',
    });
    expect(resp.success).toBe(false);
    expect(resp.error?.code).toBe('INVALID_REQUEST');
  });

  it('非法 payload → INVALID_PAYLOAD', async () => {
    const resp = await executeAgentRequest({
      protocolVersion: AGENT_PROTOCOL_VERSION,
      requestId: 'x2',
      type: 'createNode',
      payload: { position: { x: 'a', y: 1 } },
    });
    expect(resp.success).toBe(false);
    expect(resp.error?.code).toBe('INVALID_PAYLOAD');
  });

  it('未知 command → 结构化错误,不崩溃', async () => {
    const resp = await executeAgentRequest(raw('frobnicate', {}));
    expect(resp.success).toBe(false);
    expect(resp.error).toBeTruthy();
  });
});

describe('Agent Interface — seed fixture & commands', () => {
  beforeEach(async () => {
    useGraphStore.setState({ agentRevision: 0, past: [], future: [] });
    const res = await act('reset');
    if (!res.success) throw new Error(`reset failed: ${JSON.stringify(res.error)}`);
    const seed = await act('seedFixture');
    if (!seed.success) throw new Error(`seedFixture failed: ${JSON.stringify(seed.error)}`);
  });

  it('A1 observe:fixture 确定性(3 参与方 / 3 阶段 / 10 节点 / 边存在)', async () => {
    const s = await state();
    expect(s.participants).toHaveLength(3);
    expect(s.stages).toHaveLength(3);
    expect(s.nodes).toHaveLength(10);
    expect(s.edges.length).toBeGreaterThanOrEqual(5);
  });

  it('A2 create:createParticipant / createStage / createNode 后状态变化且 revision 前进', async () => {
    const before = await state();
    const p = await act('createParticipant', { name: '测试参与方', type: 'software' });
    const st = await act('createStage', { name: '测试阶段' });
    const n = await act('createNode', { label: '新节点', position: { x: 10, y: 10 } });
    expect(p.success).toBe(true);
    expect(st.success).toBe(true);
    expect(n.success).toBe(true);
    const after = await state();
    expect(after.participants.length).toBe(before.participants.length + 1);
    expect(after.stages.length).toBe(before.stages.length + 1);
    expect(after.nodes.length).toBe(before.nodes.length + 1);
    expect(after.revision).toBeGreaterThan(before.revision);
  });

  it('A3 semantic assignment:assignParticipant/assignStage 更新语义并一次 Undo 还原', async () => {
    const s0 = await state();
    const node = s0.nodes.find((x) => x.label === 'Node 08')!;
    expect(node.participantId).toBeNull();
    expect(node.stageId).toBeNull();
    const pid = s0.participants[0].id;
    const sid = s0.stages[1].id;

    const r1 = await act('assignParticipant', { nodeId: node.id, participantId: pid });
    expect(cr(r1)?.newRevision).toBe((cr(r1)?.previousRevision ?? 0) + 1);
    let s1 = await state();
    expect(s1.nodes.find((x) => x.id === node.id)!.participantId).toBe(pid);

    const r2 = await act('assignStage', { nodeId: node.id, stageId: sid });
    expect(cr(r2)?.newRevision).toBe((cr(r2)?.previousRevision ?? 0) + 1);
    s1 = await state();
    expect(s1.nodes.find((x) => x.id === node.id)!.stageId).toBe(sid);

    // assignStage 单条 Undo:只回退 stage,participant 保持
    await act('undo');
    s1 = await state();
    expect(s1.nodes.find((x) => x.id === node.id)!.participantId).toBe(pid);
    expect(s1.nodes.find((x) => x.id === node.id)!.stageId).toBeNull();

    // 再 Undo:回退 participant 到 free
    await act('undo');
    s1 = await state();
    expect(s1.nodes.find((x) => x.id === node.id)!.participantId).toBeNull();

    // Redo ×2 恢复
    await act('redo');
    s1 = await state();
    expect(s1.nodes.find((x) => x.id === node.id)!.participantId).toBe(pid);
    await act('redo');
    s1 = await state();
    expect(s1.nodes.find((x) => x.id === node.id)!.stageId).toBe(sid);
  });

  it('A4 move:moveNode 修改 position;一次 Undo 还原', async () => {
    const s0 = await state();
    const node = s0.nodes.find((x) => x.label === 'Node 05')!;
    const target = { x: 1200, y: 800 };
    const r = await act('moveNode', { nodeId: node.id, position: target });
    expect(r.success).toBe(true);
    expect(cr(r)?.newRevision).toBe((cr(r)?.previousRevision ?? 0) + 1);
    let s1 = await state();
    expect(s1.nodes.find((x) => x.id === node.id)!.position).toEqual(target);
    await act('undo');
    s1 = await state();
    expect(s1.nodes.find((x) => x.id === node.id)!.position).not.toEqual(target);
    await act('redo');
    s1 = await state();
    expect(s1.nodes.find((x) => x.id === node.id)!.position).toEqual(target);
  });

  it('A5 arrange:调用现有 runSmartArrange,语义不变,一次 Undo 还原', async () => {
    const before = await state();
    const r = await act('arrange');
    expect(r.success).toBe(true);
    const after = await state();
    const moved = after.nodes.filter((n) => {
      const b = before.nodes.find((m) => m.id === n.id)!;
      return Math.abs(b.position.x - n.position.x) > 0.01 || Math.abs(b.position.y - n.position.y) > 0.01;
    });
    expect(moved.length).toBeGreaterThan(0);
    for (const n of after.nodes) {
      expect(before.nodes.find((m) => m.id === n.id)!.participantId).toBe(n.participantId);
      expect(before.nodes.find((m) => m.id === n.id)!.stageId).toBe(n.stageId);
    }
    await act('undo');
    const restored = await state();
    const same = restored.nodes.every((n) => {
      const b = before.nodes.find((m) => m.id === n.id)!;
      return Math.abs(b.position.x - n.position.x) < 0.01 && Math.abs(b.position.y - n.position.y) < 0.01;
    });
    expect(same).toBe(true);
  });
});
