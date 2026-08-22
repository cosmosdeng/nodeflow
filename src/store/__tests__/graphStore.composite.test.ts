import { describe, expect, it, beforeEach, vi } from 'vitest';
import type { FlowNode } from '../../types';

// mock localStorage(Node 环境无 localStorage)
const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => store.set(k, v),
  removeItem: (k: string) => store.delete(k),
  clear: () => store.clear(),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() {
    return store.size;
  },
});

import { useGraphStore } from '../graphStore';

function node(id: string, data: Partial<FlowNode['data']>, extra?: Partial<FlowNode>): FlowNode {
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

// 构造一条链:A.out → B.in, B.out → C.in
function buildChain() {
  const A = node('A', { actor: 'human', outputs: [{ id: 'out1', name: '出' }] }, { position: { x: 0, y: 0 } });
  const B = node('B', { actor: 'machine', inputs: [{ id: 'in1', name: '入' }], outputs: [{ id: 'out1', name: '出' }] }, { position: { x: 300, y: 0 } });
  const C = node('C', { actor: 'human', inputs: [{ id: 'in1', name: '入' }] }, { position: { x: 600, y: 0 } });
  const edges = [
    { id: 'e1', source: 'A', sourceHandle: 'out1', target: 'B', targetHandle: 'in1', type: 'flow' as const, data: { label: '', artifact: null } },
    { id: 'e2', source: 'B', sourceHandle: 'out1', target: 'C', targetHandle: 'in1', type: 'flow' as const, data: { label: '', artifact: null } },
  ];
  return { A, B, C, edges };
}

beforeEach(() => {
  store.clear();
  useGraphStore.setState({
    nodes: [],
    edges: [],
    past: [],
    future: [],
    selected: null,
    allLocked: false,
  });
});

describe('组合节点塌缩 / 展开(状态机)', () => {
  it('编组 A,B 后塌缩:隐藏子孙,外部连线改写到组合聚合端口', () => {
    const { A, B, C, edges } = buildChain();
    useGraphStore.setState({
      nodes: [
        { ...A, selected: true },
        { ...B, selected: true },
        { ...C, selected: false },
      ],
      edges,
      selected: null,
    });

    const groupId = useGraphStore.getState().groupSelected();
    expect(groupId).toBeTruthy();

    const s = useGraphStore.getState();
    const comp = s.nodes.find((n) => n.id === groupId);
    expect(comp).toBeTruthy();
    // A、B 被隐藏,组合节点塌缩
    expect(s.nodes.find((n) => n.id === 'A')?.hidden).toBe(true);
    expect(s.nodes.find((n) => n.id === 'B')?.hidden).toBe(true);
    expect(comp?.data?.composite?.expanded).toBe(false);
    // e1(A→B) 为内部连线 → hidden;e2(B→C) 改写为指向组合
    const e1 = s.edges.find((e) => e.id === 'e1');
    const e2 = s.edges.find((e) => e.id === 'e2');
    expect(e1?.hidden).toBe(true);
    expect(e2?.source).toBe(groupId);
    expect(e2?.sourceHandle).toContain('cid:');
  });

  it('展开(切换)后恢复子节点显示,外部连线还原到子节点', () => {
    const { A, B, C, edges } = buildChain();
    useGraphStore.setState({
      nodes: [
        { ...A, selected: true },
        { ...B, selected: true },
        { ...C, selected: false },
      ],
      edges,
      selected: null,
    });
    const groupId = useGraphStore.getState().groupSelected();
    expect(groupId).toBeTruthy();

    // 展开组合
    useGraphStore.getState().toggleComposite(groupId!);
    const s = useGraphStore.getState();
    const comp = s.nodes.find((n) => n.id === groupId);
    expect(comp?.data?.composite?.expanded).toBe(true);
    expect(s.nodes.find((n) => n.id === 'A')?.hidden).toBe(false);
    // e2 还原:source 应为 B
    const e2 = s.edges.find((e) => e.id === 'e2');
    expect(e2?.source).toBe('B');
    expect(e2?.sourceHandle).toBe('out1');
  });

  it('解除编组后连线正确还原(删除组合节点)', () => {
    const { A, B, C, edges } = buildChain();
    useGraphStore.setState({
      nodes: [
        { ...A, selected: true },
        { ...B, selected: true },
        { ...C, selected: false },
      ],
      edges,
      selected: null,
    });
    const groupId = useGraphStore.getState().groupSelected();
    expect(groupId).toBeTruthy();

    useGraphStore.getState().ungroup(groupId!);
    const s = useGraphStore.getState();
    // 组合节点被删除,A、B 恢复可见
    expect(s.nodes.find((n) => n.id === groupId)).toBeUndefined();
    expect(s.nodes.find((n) => n.id === 'A')?.hidden).toBe(false);
    expect(s.nodes.find((n) => n.id === 'B')?.hidden).toBe(false);
    // e1 内部连线恢复显示,e2 还原到 B
    const e1 = s.edges.find((e) => e.id === 'e1');
    const e2 = s.edges.find((e) => e.id === 'e2');
    expect(e1?.hidden).toBe(false);
    expect(e2?.source).toBe('B');
    expect(e2?.sourceHandle).toBe('out1');
  });
});
