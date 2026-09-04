import { beforeEach, describe, expect, it } from 'vitest';
import { executeAgentRequest } from '../executor';
import { AGENT_PROTOCOL_VERSION, type AgentCommandResult, type AgentRequest } from '../types';
import { useGraphStore } from '../../store/graphStore';
import { setAgentTestCommandsEnabled } from '../capabilities';

const rev = () => useGraphStore.getState().agentRevision;

async function exec(type: string, payload?: unknown): Promise<{ success: boolean; data?: unknown; error?: { code?: string } }> {
  const req = { protocolVersion: AGENT_PROTOCOL_VERSION, requestId: 'rev', type, payload } as unknown as AgentRequest;
  const r = await executeAgentRequest(req);
  return { success: r.success, data: r.data, error: r.error };
}

function resetStore(): void {
  useGraphStore.setState({
    agentRevision: 0,
    past: [],
    future: [],
    nodes: [],
    edges: [],
    participants: [],
    stages: [],
    participantOrder: [],
    stageOrder: [],
    arrangePending: false,
  });
}

describe('A-001 unified agentRevision(统一 Graph Runtime revision)', () => {
  beforeEach(() => {
    setAgentTestCommandsEnabled(true);
    resetStore();
  });

  it('Agent mutation 推进 revision', async () => {
    const r0 = rev();
    await exec('createNode', { label: 'AI 创建', position: { x: 0, y: 0 } });
    expect(rev()).toBeGreaterThan(r0);
  });

  it('GUI mutation(直接 Store Action)推进 revision', () => {
    const r0 = rev();
    useGraphStore.getState().addParticipant('GUI 参与方', 'role');
    expect(rev()).toBeGreaterThan(r0);
  });

  it('GUI Undo / Redo 各推进一次', () => {
    const g = useGraphStore.getState();
    g.addParticipant('A', 'role');
    const r1 = rev();
    expect(r1).toBeGreaterThan(0);
    g.undo();
    const r2 = rev();
    expect(r2).toBeGreaterThan(r1);
    g.redo();
    const r3 = rev();
    expect(r3).toBeGreaterThan(r2);
  });

  it('Query 不推进 revision', async () => {
    const r0 = rev();
    await exec('getGraphState');
    expect(rev()).toBe(r0);
  });

  it('失败 command 不推进 revision', async () => {
    const r0 = rev();
    const bad = await exec('frobnicate', {});
    expect(bad.success).toBe(false);
    expect(rev()).toBe(r0);
  });

  it('外部 Human+AI:第二次 observe 能通过 revision 发现变化', async () => {
    const r1 = rev();
    // Human 在 GUI 修改(直接 store action)
    useGraphStore.getState().addParticipant('Human 改动', 'department');
    const r2 = rev();
    expect(r2).toBeGreaterThan(r1);
    const observe = await exec('getGraphState');
    const state = observe.data as { revision: number };
    expect(state.revision).toBe(r2);
    expect(state.revision).toBeGreaterThan(r1);
  });

  it('语义不变的成功 command(assign 同值)不推进 revision', async () => {
    await exec('createParticipant', { name: 'P', type: 'role' });
    const res = await exec('createNode', { label: 'N', position: { x: 0, y: 0 } });
    const nodeId = (await exec('getNodes')).data as { id: string }[];
    const pid = (await exec('getParticipants')).data as { id: string }[];
    const before = rev();
    const c1 = await exec('assignParticipant', { nodeId: nodeId[0].id, participantId: pid[0].id });
    const afterFirst = (c1.data as AgentCommandResult).newRevision;
    expect(afterFirst).toBeGreaterThan(before);
    const c2 = await exec('assignParticipant', { nodeId: nodeId[0].id, participantId: pid[0].id });
    const result2 = c2.data as AgentCommandResult;
    expect(result2.newRevision).toBe(result2.previousRevision);
    void res;
  });

  it('agentRevision 不写入持久化导出', () => {
    const json = useGraphStore.getState().exportJson();
    expect(json).not.toContain('agentRevision');
  });
});
