import { describe, expect, it } from 'vitest';
import { canConnect, createFlowEdge } from '../edge';

describe('lib/edge 连线领域', () => {
  it('createFlowEdge:默认空说明、无产物、随机 id', () => {
    const e = createFlowEdge('a', 'out_1', 'b', 'in_1');
    expect(e.source).toBe('a');
    expect(e.sourceHandle).toBe('out_1');
    expect(e.target).toBe('b');
    expect(e.targetHandle).toBe('in_1');
    expect(e.type).toBe('flow');
    expect(e.data).toEqual({ label: '', artifact: null });
    expect(e.id).toMatch(/^edge_/);
  });

  it('createFlowEdge:可覆盖 data 与显式 id', () => {
    const e = createFlowEdge('a', undefined, 'b', undefined, { label: '说明', artifact: null }, 'fixed');
    expect(e.id).toBe('fixed');
    expect(e.data?.label).toBe('说明');
    expect(e.sourceHandle).toBeUndefined();
  });

  it('canConnect:不同节点可连,同节点不可连', () => {
    expect(canConnect('a', 'b')).toBe(true);
    expect(canConnect('a', 'a')).toBe(false);
  });
});
