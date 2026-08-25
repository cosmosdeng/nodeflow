import { describe, expect, it } from 'vitest';
import type { FlowEdge, FlowNode, Stage, Annotation } from '../../types';
import { validateGraph, isGraphValid } from '../graphValidation';

function node(id: string, data: Partial<FlowNode['data']> = {}, extra?: Partial<FlowNode>): FlowNode {
  return {
    id,
    type: 'flow',
    position: { x: 0, y: 0 },
    data: {
      label: id,
      actor: 'machine',
      locked: false,
      inputs: [],
      outputs: [],
      ...data,
    },
    ...extra,
  } as FlowNode;
}

function edge(id: string, source: string, sourceHandle: string, target: string, targetHandle: string): FlowEdge {
  return { id, source, sourceHandle, target, targetHandle, type: 'flow', data: { label: '', artifact: null } } as FlowEdge;
}

describe('P4-02 Graph Validation', () => {
  it('空 Graph 合法', () => {
    const r = validateGraph({ nodes: [], edges: [] });
    expect(r.valid).toBe(true);
    expect(r.issues).toHaveLength(0);
  });

  it('单 Node 合法', () => {
    const r = validateGraph({ nodes: [node('A')], edges: [] });
    expect(r.valid).toBe(true);
  });

  it('多 Node + 正常 Edge 合法', () => {
    const A = node('A', { outputs: [{ id: 'out1', name: 'o' }] });
    const B = node('B', { inputs: [{ id: 'in1', name: 'i' }] });
    const r = validateGraph({
      nodes: [A, B],
      edges: [edge('e1', 'A', 'out1', 'B', 'in1')],
    });
    expect(r.valid).toBe(true);
  });

  it('悬空 Edge(source 不存在)不合法', () => {
    const r = validateGraph({
      nodes: [node('B', { inputs: [{ id: 'in1', name: 'i' }] })],
      edges: [edge('e1', 'GHOST', 'out1', 'B', 'in1')],
    });
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.kind === 'edge')).toBe(true);
  });

  it('重复 Node ID 不合法', () => {
    const r = validateGraph({ nodes: [node('A'), node('A')], edges: [] });
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.kind === 'id')).toBe(true);
  });

  it('重复 Edge ID 不合法', () => {
    const A = node('A', { outputs: [{ id: 'out1', name: 'o' }] });
    const B = node('B', { inputs: [{ id: 'in1', name: 'i' }] });
    const r = validateGraph({
      nodes: [A, B],
      edges: [edge('e1', 'A', 'out1', 'B', 'in1'), edge('e1', 'A', 'out1', 'B', 'in1')],
    });
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.kind === 'id')).toBe(true);
  });

  it('Edge 引用不存在的端口不合法', () => {
    const A = node('A', { outputs: [{ id: 'out1', name: 'o' }] });
    const B = node('B', { inputs: [{ id: 'in1', name: 'i' }] });
    // targetHandle 引用不存在的 inX
    const r = validateGraph({
      nodes: [A, B],
      edges: [edge('e1', 'A', 'out1', 'B', 'inX')],
    });
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.kind === 'handle')).toBe(true);
  });

  it('Composite:child 存在时合法', () => {
    const A = node('A');
    const comp = node('G', { composite: { expanded: true, childIds: ['A'] } });
    const r = validateGraph({ nodes: [A, comp], edges: [] });
    expect(r.valid).toBe(true);
  });

  it('Composite:引用不存在的 child 不合法', () => {
    const comp = node('G', { composite: { expanded: true, childIds: ['GHOST'] } });
    const r = validateGraph({ nodes: [comp], edges: [] });
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.kind === 'composite')).toBe(true);
  });

  it('Composite:包含自己不合法', () => {
    const comp = node('G', { composite: { expanded: true, childIds: ['G'] } });
    const r = validateGraph({ nodes: [comp], edges: [] });
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.kind === 'composite')).toBe(true);
  });

  it('Stage:引用不存在的节点不合法', () => {
    const stage: Stage = { id: 's1', name: '阶段', x: 0, y: 0, width: 100, height: 100, nodeIds: ['GHOST'] };
    const r = validateGraph({ nodes: [node('A')], edges: [], stages: [stage] });
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.kind === 'stage')).toBe(true);
  });

  it('Annotation:引用不存在的连线不合法', () => {
    const annot: Annotation = {
      id: 'an1',
      title: 't',
      content: '',
      collapsed: false,
      target: { kind: 'edge', edgeId: 'GHOST_EDGE' },
    };
    const r = validateGraph({ nodes: [node('A')], edges: [], annotations: [annot] });
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.kind === 'annotation')).toBe(true);
  });

  it('Gateway:type 合法且结构完整时合法', () => {
    const gw = node('GW', {
      gateway: { type: 'exclusive' },
      inputs: [{ id: 'in_1', name: '入' }],
      outputs: [{ id: 'out_1', name: '分支1' }, { id: 'out_2', name: '分支2' }],
    });
    const r = validateGraph({ nodes: [gw], edges: [] });
    expect(r.valid).toBe(true);
  });

  it('Gateway:type 非法不合法', () => {
    const gw = node('GW', {
      gateway: { type: 'evil' as never },
      inputs: [{ id: 'in_1', name: '入' }],
      outputs: [{ id: 'out_1', name: '分支1' }],
    });
    const r = validateGraph({ nodes: [gw], edges: [] });
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.kind === 'gateway')).toBe(true);
  });

  it('Gateway:无输出分支不合法', () => {
    const gw = node('GW', {
      gateway: { type: 'parallel' },
      inputs: [{ id: 'in_1', name: '入' }],
      outputs: [],
    });
    const r = validateGraph({ nodes: [gw], edges: [] });
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.kind === 'gateway')).toBe(true);
  });

  it('cid: handle 可解析时合法,不可解析时不合法', () => {
    const A = node('A', { outputs: [{ id: 'out1', name: 'o' }] });
    const B = node('B', { inputs: [{ id: 'in1', name: 'i' }] });
    // 合法 cid: handle(指向存在的 A)
    const ok = validateGraph({
      nodes: [A, B],
      edges: [edge('e1', 'A', 'cid:A:out1', 'B', 'in1')],
    });
    expect(ok.valid).toBe(true);
    // 非法 cid: handle(指向不存在的 GHOST)
    const bad = validateGraph({
      nodes: [A, B],
      edges: [edge('e1', 'A', 'cid:GHOST:out1', 'B', 'in1')],
    });
    expect(bad.valid).toBe(false);
    expect(bad.issues.some((i) => i.kind === 'handle')).toBe(true);
  });

  it('isGraphValid 便捷判断', () => {
    expect(isGraphValid({ nodes: [node('A')], edges: [] })).toBe(true);
    expect(isGraphValid({ nodes: [], edges: [edge('e1', 'GHOST', 'o', 'A', 'i')] })).toBe(false);
  });
});
