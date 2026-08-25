import { describe, expect, it } from 'vitest';
import type { FlowNode, Participant } from '../../types';
import { arrangeSwimlanes, computeSwimlaneBounds } from '../arrange';

const artist: Participant = { id: 'p1', name: 'Artist', type: 'person' };
const ai: Participant = { id: 'p2', name: 'AI Agent', type: 'ai-agent' };

function node(id: string, x: number, y: number, pid?: string): FlowNode {
  return {
    id,
    type: 'flow',
    position: { x, y },
    width: 100,
    height: 50,
    data: { label: id, description: '', actor: 'human', locked: false, inputs: [], outputs: [], participantId: pid },
  } as FlowNode;
}

const vp = { x: 0, y: 0, zoom: 1 };

describe('lib/arrange 泳道排列', () => {
  it('arrangeSwimlanes:只移动有 participant 的 node,未分配保持原位', () => {
    const nodes = [
      node('A', 0, 0, 'p1'),
      node('B', 200, 0, 'p2'),
      node('C', 400, 0), // 未分配
    ];
    const result = arrangeSwimlanes(nodes, [], [artist, ai], ['p1', 'p2'], 'horizontal');
    expect(result.has('A')).toBe(true);
    expect(result.has('B')).toBe(true);
    expect(result.has('C')).toBe(false); // 未分配不动
  });

  it('arrangeSwimlanes:不改 participantId,deterministic', () => {
    const nodes = [node('A', 0, 0, 'p1'), node('B', 0, 100, 'p1')];
    const a = arrangeSwimlanes(nodes, [], [artist], ['p1'], 'horizontal');
    const b = arrangeSwimlanes(nodes, [], [artist], ['p1'], 'horizontal');
    expect(a.get('A')).toEqual(b.get('A'));
    expect(a.get('B')).toEqual(b.get('B'));
    // 输入未被修改
    expect(nodes[0].data.participantId).toBe('p1');
  });

  it('arrangeSwimlanes:同一参与方节点排入同一 lane(纵向排列)', () => {
    const nodes = [node('A', 0, 0, 'p1'), node('B', 0, 0, 'p1')];
    const result = arrangeSwimlanes(nodes, [], [artist], ['p1'], 'horizontal');
    const a = result.get('A')!;
    const b = result.get('B')!;
    // 同一 lane,水平方向 x 不同,纵向 y 接近(横向布局:同层纵向堆叠)
    expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(200);
  });

  it('computeSwimlaneBounds:derived bounds,不修改输入', () => {
    const nodes = [node('A', 10, 20, 'p1')];
    const bounds = computeSwimlaneBounds(nodes, [artist], ['p1'], vp);
    expect(bounds).toHaveLength(1);
    expect(bounds[0].participantId).toBe('p1');
    expect(bounds[0].x).toBeLessThanOrEqual(10);
    expect(bounds[0].width).toBeGreaterThan(100);
    expect(nodes[0].position).toEqual({ x: 10, y: 20 }); // 输入未变
  });
});
