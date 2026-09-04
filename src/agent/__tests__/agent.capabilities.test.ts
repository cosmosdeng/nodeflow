import { describe, expect, it } from 'vitest';
import { executeAgentRequest } from '../executor';
import { AGENT_PROTOCOL_VERSION, type AgentRequest } from '../types';
import { setAgentTestCommandsEnabled } from '../capabilities';

async function exec(type: string, payload?: unknown): Promise<{ success: boolean; data?: unknown; error?: { code?: string } }> {
  const req = { protocolVersion: AGENT_PROTOCOL_VERSION, requestId: 'cap', type, payload } as unknown as AgentRequest;
  const r = await executeAgentRequest(req);
  return { success: r.success, data: r.data, error: r.error };
}

describe('A-002 capability isolation(test.fixture 默认关闭)', () => {
  it('默认(未开启 test commands):reset/seedFixture → CAPABILITY_NOT_ENABLED', async () => {
    setAgentTestCommandsEnabled(false);
    const reset = await exec('reset');
    expect(reset.success).toBe(false);
    expect(reset.error?.code).toBe('CAPABILITY_NOT_ENABLED');
    const seed = await exec('seedFixture');
    expect(seed.success).toBe(false);
    expect(seed.error?.code).toBe('CAPABILITY_NOT_ENABLED');
  });

  it('Bridge enabled ≠ test enabled:普通命令仍然可用', async () => {
    setAgentTestCommandsEnabled(false);
    const ok = await exec('createParticipant', { name: '普通参与方', type: 'role' });
    expect(ok.success).toBe(true);
    const query = await exec('getGraphState');
    expect(query.success).toBe(true);
  });

  it('开启 test commands 后 reset/seedFixture 可用', async () => {
    setAgentTestCommandsEnabled(true);
    const reset = await exec('reset');
    expect(reset.success).toBe(true);
    const seed = await exec('seedFixture');
    expect(seed.success).toBe(true);
    const state = (await exec('getGraphState')).data as {
      nodes: unknown[];
      participants: unknown[];
      stages: unknown[];
    };
    expect(state.nodes).toHaveLength(10);
    expect(state.participants).toHaveLength(3);
    expect(state.stages).toHaveLength(3);
    // 再次关闭后恢复拒绝
    setAgentTestCommandsEnabled(false);
    const again = await exec('reset');
    expect(again.success).toBe(false);
    expect(again.error?.code).toBe('CAPABILITY_NOT_ENABLED');
  });
});
