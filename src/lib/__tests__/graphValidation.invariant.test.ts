import { describe, expect, it } from 'vitest';
import type { FlowEdge, FlowNode, Stage, Annotation } from '../../types';
import { validateGraph } from '../graphValidation';

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

function stage(id: string, nodeIds: string[]): Stage {
  return { id, name: id, x: 0, y: 0, width: 100, height: 100, nodeIds };
}

function annot(id: string, target: Annotation['target']): Annotation {
  return { id, title: id, content: '', collapsed: false, target };
}

describe('P4-03 Graph Invariant Tests', () => {
  it('Nested Composite 结构合法(子组合 + 普通节点)', () => {
    // B 是普通节点,GC 是包含 B 的组合,GE 是包含 GC 的外层组合
    const B = node('B');
    const GC = node('GC', { composite: { expanded: false, childIds: ['B'] } });
    const GE = node('GE', { composite: { expanded: false, childIds: ['GC'] } });
    const r = validateGraph({ nodes: [B, GC, GE], edges: [] });
    expect(r.valid).toBe(true);
    expect(r.issues).toHaveLength(0);
  });

  it('Nested Composite:子组合引用不存在的节点不合法', () => {
    const GC = node('GC', { composite: { expanded: false, childIds: ['GHOST'] } });
    const GE = node('GE', { composite: { expanded: false, childIds: ['GC'] } });
    const r = validateGraph({ nodes: [GC, GE], edges: [] });
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.kind === 'composite')).toBe(true);
  });

  it('Composite:重复 child 发出 warning 但不算 error', () => {
    const A = node('A');
    const comp = node('G', { composite: { expanded: true, childIds: ['A', 'A'] } });
    const r = validateGraph({ nodes: [A, comp], edges: [] });
    // 重复 child 是 warning(结构不合法但不应阻断)
    expect(r.issues.some((i) => i.kind === 'composite' && i.severity === 'warning')).toBe(true);
    expect(r.valid).toBe(true);
  });

  it('组合展开 / 塌缩两种状态结构都合法', () => {
    const A = node('A', { outputs: [{ id: 'out1', name: 'o' }] });
    const B = node('B', { inputs: [{ id: 'in1', name: 'i' }] });
    const compExpanded = node('G1', { composite: { expanded: true, childIds: ['A', 'B'] } });
    const compCollapsed = node('G2', { composite: { expanded: false, childIds: ['A', 'B'] } });
    const r = validateGraph({ nodes: [A, B, compExpanded, compCollapsed], edges: [] });
    expect(r.valid).toBe(true);
  });

  it('Edge 两端都为悬空(引用不存在节点)不合法', () => {
    const r = validateGraph({
      nodes: [node('A')],
      edges: [edge('e1', 'GHOST_SRC', 'out1', 'GHOST_TGT', 'in1')],
    });
    expect(r.valid).toBe(false);
    expect(r.issues.filter((i) => i.kind === 'edge')).toHaveLength(2);
  });

  it('Edge 指向非网关节点的输入输出端口必须存在(网关聚合端口除外)', () => {
    // 普通节点 A 无输出端口,但连线用了 out1 → 应报 handle 错误
    const A = node('A');
    const B = node('B', { inputs: [{ id: 'in1', name: 'i' }] });
    const r = validateGraph({
      nodes: [A, B],
      edges: [edge('e1', 'A', 'out1', 'B', 'in1')],
    });
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.kind === 'handle')).toBe(true);
  });

  it('Stage:多个 Stage 引用同一节点是允许的(warning 级别不强制)', () => {
    // 规范说一节点只属一个域,但 validation 只检查引用存在
    const A = node('A');
    const r = validateGraph({
      nodes: [A],
      edges: [],
      stages: [stage('s1', ['A']), stage('s2', ['A'])],
    });
    // 引用都存在 → 合法
    expect(r.valid).toBe(true);
  });

  it('Annotation:node target 存在时合法,不存在时不合法', () => {
    const A = node('A');
    const ok = validateGraph({
      nodes: [A],
      edges: [],
      annotations: [annot('an1', { kind: 'node', nodeId: 'A' })],
    });
    expect(ok.valid).toBe(true);
    const bad = validateGraph({
      nodes: [A],
      edges: [],
      annotations: [annot('an2', { kind: 'node', nodeId: 'GHOST' })],
    });
    expect(bad.valid).toBe(false);
    expect(bad.issues.some((i) => i.kind === 'annotation')).toBe(true);
  });

  it('Annotation:canvas 归属 main 合法,归属不存在的组合发出 warning', () => {
    const r = validateGraph({
      nodes: [node('A')],
      edges: [],
      annotations: [annot('an1', { kind: 'canvas', tabId: 'main' }), annot('an2', { kind: 'canvas', tabId: 'GHOST_COMP' })],
    });
    // main 合法;GHOST_COMP 是 warning,不阻断
    expect(r.valid).toBe(true);
    expect(r.issues.some((i) => i.kind === 'annotation' && i.severity === 'warning')).toBe(true);
  });

  it('cid: 嵌套 handle(多层聚合端口)可解析', () => {
    const B = node('B', { inputs: [{ id: 'in1', name: 'i' }] });
    // 外层组合 GE 的聚合端口引用子组合 GC 的节点 B:cid:GC:cid:B:in1
    const r = validateGraph({
      nodes: [B, node('GC'), node('GE')],
      edges: [edge('e1', 'GE', 'cid:GC:cid:B:in1', 'B', 'in1')],
    });
    // 嵌套 cid 路径末节点 B 存在 → 合法
    expect(r.valid).toBe(true);
  });

  it('重复 Stage ID / Annotation ID 不合法', () => {
    const A = node('A');
    const r = validateGraph({
      nodes: [A],
      edges: [],
      stages: [stage('s1', []), stage('s1', [])],
      annotations: [annot('an1', { kind: 'node', nodeId: 'A' }), annot('an1', { kind: 'node', nodeId: 'A' })],
    });
    expect(r.valid).toBe(false);
    const idIssues = r.issues.filter((i) => i.kind === 'id');
    expect(idIssues.length).toBeGreaterThanOrEqual(2); // stage + annotation 各一个
  });

  it('普通节点端口 id 重复发出 warning', () => {
    const A = node('A', { inputs: [{ id: 'in1', name: 'a' }, { id: 'in1', name: 'b' }] });
    const r = validateGraph({ nodes: [A], edges: [] });
    expect(r.issues.some((i) => i.kind === 'node' && i.severity === 'warning')).toBe(true);
    expect(r.valid).toBe(true);
  });

  it('空节点列表 + 空连线:合法', () => {
    expect(validateGraph({ nodes: [], edges: [] }).valid).toBe(true);
  });

  it('大量节点与连线:全部合法引用时不产生 error', () => {
    const n = 20;
    const nodes: FlowNode[] = [];
    const edges: FlowEdge[] = [];
    for (let i = 0; i < n; i++) {
      nodes.push(node(`N${i}`, { inputs: [{ id: 'in1', name: 'i' }], outputs: [{ id: 'out1', name: 'o' }] }));
      if (i > 0) edges.push(edge(`e${i}`, `N${i - 1}`, 'out1', `N${i}`, 'in1'));
    }
    const r = validateGraph({ nodes, edges });
    expect(r.valid).toBe(true);
  });
});
