import { beforeEach, describe, expect, it } from 'vitest';
import { executeAgentRequest } from '../executor';
import { AGENT_PROTOCOL_VERSION, type AgentAssertionResult, type AgentGraphState, type AgentRequestType } from '../types';
import { useGraphStore } from '../../store/graphStore';
import { setAgentTestCommandsEnabled } from '../capabilities';

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

async function state(): Promise<AgentGraphState> {
  const r = await act('getGraphState');
  return r.data as AgentGraphState;
}

function assertResult(r: AgentTestResult): AgentAssertionResult | undefined {
  return r.data as AgentAssertionResult | undefined;
}

describe('Agent Interface — assertions(A8)', () => {
  beforeEach(async () => {
    setAgentTestCommandsEnabled(true);
    useGraphStore.setState({ agentRevision: 0, past: [], future: [] });
    const res = await act('reset');
    if (!res.success) throw new Error(`reset failed: ${JSON.stringify(res.error)}`);
    const seed = await act('seedFixture');
    if (!seed.success) throw new Error(`seedFixture failed: ${JSON.stringify(seed.error)}`);
    await act('arrange');
  });

  function byLabel(s: AgentGraphState, label: string) {
    const n = s.nodes.find((x) => x.label === label);
    if (!n) throw new Error(`missing ${label}`);
    return n;
  }

  it('语义断言:节点存在 / 参与方语义 / 阶段语义', async () => {
    const s = await state();
    const node = byLabel(s, 'Node 01');
    const participant = s.participants[0];

    const r1 = await act('assert', { type: 'assertNodeExists', nodeId: node.id });
    expect(assertResult(r1)?.passed).toBe(true);

    const r2 = await act('assert', {
      type: 'assertParticipantAssignment',
      nodeId: node.id,
      participantId: participant.id,
    });
    expect(r2.success).toBe(true);
    expect(assertResult(r2)?.passed).toBe(true);

    const stage = s.stages[0];
    const r3 = await act('assert', { type: 'assertStageAssignment', nodeId: node.id, stageId: stage.id });
    expect(assertResult(r3)?.passed).toBe(true);

    // 失败断言:结构化返回,不抛无结构异常
    const bad = await act('assert', {
      type: 'assertParticipantAssignment',
      nodeId: node.id,
      participantId: 'nope',
    });
    expect(bad.success).toBe(false);
    expect(bad.error?.code).toBe('ASSERT_NOT_PASSED');
  });

  it('几何断言:语义归属正确但几何不在目标带时失败(几何 ≠ 语义)', async () => {
    const s = await state();
    const n01 = byLabel(s, 'Node 01');
    const p1 = s.participants[0].id;
    const s1 = s.stages[0].id;
    const p2 = s.participants[1].id;
    const s2 = s.stages[1].id;

    // 语义正确
    const semP = await act('assert', { type: 'assertParticipantAssignment', nodeId: n01.id, participantId: p1 });
    expect(assertResult(semP)?.passed).toBe(true);
    const semS = await act('assert', { type: 'assertStageAssignment', nodeId: n01.id, stageId: s1 });
    expect(assertResult(semS)?.passed).toBe(true);

    // 几何:Node01 在 P1/S1 带内
    const insideP = await act('assert', { type: 'assertNodeInsideParticipant', nodeId: n01.id, participantId: p1 });
    expect(assertResult(insideP)?.passed).toBe(true);
    const insideS = await act('assert', { type: 'assertNodeInsideStage', nodeId: n01.id, stageId: s1 });
    expect(assertResult(insideS)?.passed).toBe(true);

    // 语义没变,但问“它是否几何落在其它带(P2/S2)” → 失败
    const geoBadP = await act('assert', {
      type: 'assertNodeInsideParticipant',
      nodeId: n01.id,
      participantId: p2,
    });
    expect(geoBadP.success).toBe(false);
    expect(geoBadP.error?.code).toBe('ASSERT_NOT_PASSED');

    const geoBadS = await act('assert', { type: 'assertNodeInsideStage', nodeId: n01.id, stageId: s2 });
    expect(geoBadS.success).toBe(false);
    expect(geoBadS.error?.code).toBe('ASSERT_NOT_PASSED');
  });

  it('band 可见性 / 顺序断言', async () => {
    const s = await state();
    const visP = await act('assert', { type: 'assertBandVisible', axis: 'participant' });
    expect(assertResult(visP)?.passed).toBe(true);
    const visS = await act('assert', { type: 'assertBandVisible', axis: 'stage' });
    expect(assertResult(visS)?.passed).toBe(true);
    const orderP = await act('assert', {
      type: 'assertBandOrder',
      axis: 'participant',
      expectedIds: s.participants.map((p) => p.id),
    });
    expect(assertResult(orderP)?.passed).toBe(true);
    const orderS = await act('assert', {
      type: 'assertBandOrder',
      axis: 'stage',
      expectedIds: s.stages.map((st) => st.id),
    });
    expect(assertResult(orderS)?.passed).toBe(true);
  });

  it('位置断言 assertNodePosition', async () => {
    const s = await state();
    const n = byLabel(s, 'Node 03');
    const r = await act('assert', { type: 'assertNodePosition', nodeId: n.id, x: n.position.x, y: n.position.y });
    expect(assertResult(r)?.passed).toBe(true);
    const bad = await act('assert', { type: 'assertNodePosition', nodeId: n.id, x: 999999 });
    expect(bad.success).toBe(false);
    expect(bad.error?.code).toBe('ASSERT_NOT_PASSED');
  });
});
