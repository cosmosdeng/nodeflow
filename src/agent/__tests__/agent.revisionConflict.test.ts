import { beforeEach, describe, expect, it } from 'vitest';
import { executeAgentRequest } from '../executor';
import { useGraphStore } from '../../store/graphStore';
import { AGENT_PROTOCOL_VERSION, type AgentRequest } from '../types';

const req = (over: Partial<AgentRequest> = {}): AgentRequest => ({
  protocolVersion: AGENT_PROTOCOL_VERSION,
  requestId: `t-${Math.random().toString(36).slice(2, 8)}`,
  type: 'createNode',
  payload: { label: 'N' },
  ...over,
});

describe('expectedRevision 乐观并发', () => {
  beforeEach(() => {
    useGraphStore.setState({
      nodes: [],
      edges: [],
      agentRevision: 0,
      past: [],
      future: [],
      allLocked: false,
      selected: null,
    });
  });

  it('revision 匹配时命令执行成功', async () => {
    const r = await executeAgentRequest(req({ expectedRevision: 0 }));
    expect(r.success).toBe(true);
    expect(useGraphStore.getState().nodes).toHaveLength(1);
  });

  it('revision 不匹配时返回 REVISION_CONFLICT 且不修改状态', async () => {
    useGraphStore.setState({ agentRevision: 5 });
    const r = await executeAgentRequest(req({ expectedRevision: 3 }));
    expect(r.success).toBe(false);
    expect(r.error?.code).toBe('REVISION_CONFLICT');
    expect(useGraphStore.getState().nodes).toHaveLength(0);
  });

  it('不带 expectedRevision 时保持 last-writer-wins(向后兼容)', async () => {
    useGraphStore.setState({ agentRevision: 9 });
    const r = await executeAgentRequest(req());
    expect(r.success).toBe(true);
  });

  it('查询忽略 expectedRevision 不匹配', async () => {
    useGraphStore.setState({ agentRevision: 2 });
    const r = await executeAgentRequest(req({ type: 'getNodes', payload: undefined, expectedRevision: 99 }));
    expect(r.success).toBe(true);
  });

  it('expectedRevision 非有限数字返回 INVALID_REQUEST', async () => {
    const r = await executeAgentRequest(req({ expectedRevision: Number.NaN }));
    expect(r.success).toBe(false);
    expect(r.error?.code).toBe('INVALID_REQUEST');
  });

  it('命令失败详情不回显完整 payload', async () => {
    const r = await executeAgentRequest(
      req({ type: 'updateNode', payload: { secret: 'do-not-leak', patch: { label: 'x' } } }),
    );
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.details ?? {})).not.toContain('do-not-leak');
  });
});
