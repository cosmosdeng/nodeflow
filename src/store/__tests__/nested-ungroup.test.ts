import { describe, expect, it, beforeEach, vi } from 'vitest';
import type { FlowNode } from '../../types';

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
    data: { label: id, actor: 'machine', locked: false, inputs: [], outputs: [], ...data },
    ...extra,
  } as FlowNode;
}

beforeEach(() => {
  store.clear();
  useGraphStore.setState({ nodes: [], edges: [], past: [], future: [], selected: null, allLocked: false });
});

describe('嵌套组合解除编组:连线还原', () => {
  it('内层组合 A 的输出连线在解除外层 X 后应保留', () => {
    // P1 有输出,P2 无;R 有输入
    const P1 = node('P1', { actor: 'machine', outputs: [{ id: 'out1', name: '出' }] }, { position: { x: 0, y: 0 } });
    const P2 = node('P2', { actor: 'machine' }, { position: { x: 0, y: 200 } });
    const R = node('R', { actor: 'human', inputs: [{ id: 'in1', name: '入' }] }, { position: { x: 400, y: 0 } });
    useGraphStore.setState({ nodes: [P1, P2, R], edges: [], selected: null });

    // 1. 编组 P1,P2 → A
    useGraphStore.setState((s) => ({
      nodes: s.nodes.map((n) => (n.id === 'P1' || n.id === 'P2' ? { ...n, selected: true } : n)),
    }));
    const A = useGraphStore.getState().groupSelected();
    expect(A).toBeTruthy();

    // 2. A 塌缩,连线 A.out1 → R.in1(指向 A 聚合端口)
    const compA = useGraphStore.getState().nodes.find((n) => n.id === A);
    expect(compA?.data?.composite?.expanded).toBe(false);
    // A 的聚合输出(来自 P1.out1)
    expect(compA?.data?.outputs?.length).toBe(1);
    const aggOut = compA!.data!.outputs![0].id; // 应为 cid:P1:out1
    useGraphStore.getState().onConnect({
      source: A!,
      sourceHandle: aggOut,
      target: 'R',
      targetHandle: 'in1',
    } as never);

    // 3. 编组 A + 一个辅助节点 Q → X
    const Q = node('Q', { actor: 'human', inputs: [{ id: 'in_q', name: '入Q' }] }, { position: { x: 100, y: 300 } });
    useGraphStore.setState((s) => ({ nodes: [...s.nodes, { ...Q, selected: false }] }));
    useGraphStore.setState((s) => ({
      nodes: s.nodes.map((n) => (n.id === A || n.id === 'Q' ? { ...n, selected: true } : { ...n, selected: false })),
    }));
    const X = useGraphStore.getState().groupSelected();
    expect(X).toBeTruthy();
    expect(X).not.toBe(A);

    // 4. 解除 X → A 应独立,且 A→R 连线应保留
    useGraphStore.getState().ungroup(X!);
    const s = useGraphStore.getState();
    // X 被删除,A 存在且独立
    expect(s.nodes.find((n) => n.id === X)).toBeUndefined();
    const aNode = s.nodes.find((n) => n.id === A);
    expect(aNode).toBeTruthy();
    // A 的输出连线应保留:A 的 sourceHandle 指向 A 的聚合端口或 P1
    const aOutEdges = s.edges.filter((e) => e.source === A || e.source === 'P1');
    console.log('A 的输出连线数:', aOutEdges.length, JSON.stringify(aOutEdges.map((e) => ({ src: e.source, sh: e.sourceHandle, t: e.target }))));
    expect(aOutEdges.length).toBeGreaterThan(0);
  });
});
