import { describe, expect, it } from 'vitest';
import type { FlowEdge, FlowNode } from '../../types';
import { computeLevels, computeLayout } from '../layout';

function node(id: string, pos: { x: number; y: number }): FlowNode {
  return {
    id,
    type: 'flow',
    position: pos,
    measured: { width: 100, height: 50 },
    data: {
      label: id,
      description: '',
      actor: 'machine',
      locked: false,
      inputs: [],
      outputs: [],
    },
  } as FlowNode;
}

function edge(id: string, source: string, target: string): FlowEdge {
  return {
    id,
    source,
    sourceHandle: 'out',
    target,
    targetHandle: 'in',
    type: 'flow',
    data: { label: '', artifact: null },
  } as FlowEdge;
}

describe('computeLevels 拓扑分层', () => {
  it('链式依赖 A→B→C 分层为 0,1,2', () => {
    const nodes = [node('A', { x: 0, y: 0 }), node('B', { x: 0, y: 0 }), node('C', { x: 0, y: 0 })];
    const edges = [edge('e1', 'A', 'B'), edge('e2', 'B', 'C')];
    const levels = computeLevels(nodes, edges);
    expect(levels.get('A')).toBe(0);
    expect(levels.get('B')).toBe(1);
    expect(levels.get('C')).toBe(2);
  });

  it('多个前驱取最长路径', () => {
    // A、B 都连到 C,A 又连到 D,D 连到 C → C 的最长路径来自 A→D→C
    const nodes = [node('A', { x: 0, y: 0 }), node('B', { x: 0, y: 0 }), node('C', { x: 0, y: 0 }), node('D', { x: 0, y: 0 })];
    const edges = [edge('e1', 'A', 'C'), edge('e2', 'B', 'C'), edge('e3', 'A', 'D'), edge('e4', 'D', 'C')];
    const levels = computeLevels(nodes, edges);
    expect(levels.get('A')).toBe(0);
    expect(levels.get('B')).toBe(0);
    expect(levels.get('D')).toBe(1);
    expect(levels.get('C')).toBe(2); // A→D→C 路径最长
  });

  it('环状依赖不死循环,给出层级', () => {
    const nodes = [node('A', { x: 0, y: 0 }), node('B', { x: 0, y: 0 })];
    const edges = [edge('e1', 'A', 'B'), edge('e2', 'B', 'A')];
    const levels = computeLevels(nodes, edges);
    expect(levels.has('A')).toBe(true);
    expect(levels.has('B')).toBe(true);
  });
});

describe('computeLayout 自动布局', () => {
  it('横向布局:链式节点从左到右分层排列', () => {
    const nodes = [node('A', { x: 0, y: 0 }), node('B', { x: 0, y: 0 }), node('C', { x: 0, y: 0 })];
    const edges = [edge('e1', 'A', 'B'), edge('e2', 'B', 'C')];
    const layout = computeLayout(nodes, edges, 'horizontal');
    // A 在层0,B 层1,C 层2 → x 递增
    expect(layout.get('A')!.x).toBeLessThan(layout.get('B')!.x);
    expect(layout.get('B')!.x).toBeLessThan(layout.get('C')!.x);
    // 同层节点 y 相同(单节点层)
    expect(layout.get('A')!.y).toBe(0);
    expect(layout.get('B')!.y).toBe(0);
  });

  it('竖向布局:链式节点从上到下分层排列', () => {
    const nodes = [node('A', { x: 0, y: 0 }), node('B', { x: 0, y: 0 }), node('C', { x: 0, y: 0 })];
    const edges = [edge('e1', 'A', 'B'), edge('e2', 'B', 'C')];
    const layout = computeLayout(nodes, edges, 'vertical');
    expect(layout.get('A')!.y).toBeLessThan(layout.get('B')!.y);
    expect(layout.get('B')!.y).toBeLessThan(layout.get('C')!.y);
  });

  it('同层多节点沿垂直方向排开,不重叠', () => {
    const nodes = [node('A', { x: 0, y: 0 }), node('B', { x: 0, y: 0 }), node('C', { x: 0, y: 0 })];
    // 无连线 → 都在层0,横向布局时沿 y 堆叠
    const layout = computeLayout(nodes, [], 'horizontal');
    const ys = nodes.map((n) => layout.get(n.id)!.y);
    // y 依次递增且间距 ≥ 节点高(50)+vGap(40)=90
    expect(ys[1] - ys[0]).toBeGreaterThanOrEqual(90);
    expect(ys[2] - ys[1]).toBeGreaterThanOrEqual(90);
  });
});
