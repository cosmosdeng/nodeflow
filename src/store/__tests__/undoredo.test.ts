import { beforeEach, describe, expect, it } from 'vitest';
import { useGraphStore } from '../graphStore';
import type { FlowNode } from '../../types';

/**
 * P4-05 Undo / Redo Tests
 *
 * 验证 S0 → Action → S1 → Undo → S0 与 S0 → Action → S1 → Undo → Redo → S1。
 * 覆盖 Node / Edge / Composite / Gateway / Stage / Annotation / Copy-Paste。
 *
 * 约束(按 P4 规范):不重写 History、不改 Undo/Redo UI、不改快捷键。
 */

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

beforeEach(() => {
  useGraphStore.setState({
    nodes: [],
    edges: [],
    stages: [],
    annotations: [],
    past: [],
    future: [],
    selected: null,
    viewport: { x: 0, y: 0, zoom: 1 },
  });
});

function nodeIds(): string[] {
  return useGraphStore.getState().nodes.map((n) => n.id).sort();
}

describe('P4-05 Undo / Redo', () => {
  it('addNode:undo 删除新节点,redo 恢复', () => {
    const st = useGraphStore.getState();
    st.markHistory(); // S0
    const newId = st.addNode({ label: 'X' }, { x: 10, y: 10 });
    expect(useGraphStore.getState().nodes).toHaveLength(1); // S1
    useGraphStore.getState().undo();
    expect(useGraphStore.getState().nodes).toHaveLength(0); // 回到 S0
    useGraphStore.getState().redo();
    expect(useGraphStore.getState().nodes).toHaveLength(1); // 回到 S1
    expect(useGraphStore.getState().nodes[0].id).toBe(newId);
  });

  it('deleteNode:undo 恢复被删节点', () => {
    useGraphStore.setState({ nodes: [node('A')] });
    const st = useGraphStore.getState();
    st.markHistory(); // S0 含 A
    st.deleteNode('A');
    expect(useGraphStore.getState().nodes).toHaveLength(0); // S1
    useGraphStore.getState().undo();
    expect(nodeIds()).toEqual(['A']); // 回到 S0
  });

  it('deleteNode:undo 同时恢复被删节点的连线', () => {
    const A = node('A', { outputs: [{ id: 'out1', name: 'o' }] });
    const B = node('B', { inputs: [{ id: 'in1', name: 'i' }] });
    useGraphStore.setState({
      nodes: [A, B],
      edges: [{ id: 'e1', source: 'A', sourceHandle: 'out1', target: 'B', targetHandle: 'in1', type: 'flow', data: { label: '', artifact: null } }],
    });
    const st = useGraphStore.getState();
    st.markHistory(); // S0 含 A、B、e1
    st.deleteNode('A');
    const s1 = useGraphStore.getState();
    expect(s1.nodes).toHaveLength(1); // A 被删
    expect(s1.edges).toHaveLength(0); // e1 随 A 被删
    useGraphStore.getState().undo();
    const s0 = useGraphStore.getState();
    expect(s0.nodes).toHaveLength(2);
    expect(s0.edges).toHaveLength(1); // e1 恢复
  });

  it('groupSelected:undo 解除编组,redo 重新编组', () => {
    const A = node('A', {}, { selected: true });
    const B = node('B', {}, { selected: true });
    useGraphStore.setState({ nodes: [A, B] });
    const st = useGraphStore.getState();
    st.markHistory(); // S0
    const groupId = st.groupSelected();
    expect(groupId).toBeTruthy(); // S1 含组合
    useGraphStore.getState().undo();
    // 回到 S0:无组合节点
    expect(useGraphStore.getState().nodes.some((n) => n.data.composite)).toBe(false);
    useGraphStore.getState().redo();
    // 回到 S1:有组合节点
    expect(useGraphStore.getState().nodes.some((n) => n.data.composite)).toBe(true);
  });

  it('addStage / deleteStage:undo/redo 往返', () => {
    const st = useGraphStore.getState();
    st.markHistory(); // S0
    const stageId = st.addStage(0, 0, 300, 200);
    expect(useGraphStore.getState().stages).toHaveLength(1); // S1
    useGraphStore.getState().undo();
    expect(useGraphStore.getState().stages).toHaveLength(0); // 回到 S0
    useGraphStore.getState().redo();
    expect(useGraphStore.getState().stages).toHaveLength(1); // 回到 S1
    expect(useGraphStore.getState().stages[0].id).toBe(stageId);
  });

  it('addAnnotation / deleteAnnotation:undo/redo 往返', () => {
    useGraphStore.setState({ nodes: [node('A')] });
    const st = useGraphStore.getState();
    st.markHistory(); // S0
    const anId = st.addAnnotation({ kind: 'node', nodeId: 'A' });
    expect(useGraphStore.getState().annotations).toHaveLength(1); // S1
    useGraphStore.getState().undo();
    expect(useGraphStore.getState().annotations).toHaveLength(0); // 回到 S0
    useGraphStore.getState().redo();
    expect(useGraphStore.getState().annotations).toHaveLength(1); // 回到 S1
    expect(useGraphStore.getState().annotations[0].id).toBe(anId);
  });

  it('copy/paste:粘贴后 undo 移除粘贴节点,redo 恢复', () => {
    useGraphStore.setState({
      nodes: [node('A', {}, { selected: true })],
      selected: { kind: 'node', id: 'A' },
    });
    const st = useGraphStore.getState();
    const copied = st.copySelection();
    expect(copied).toBe(1);
    st.markHistory(); // S0 含 A
    const pasted = st.pasteClipboard();
    expect(pasted).toBe(1); // S1 含 A + 粘贴副本
    expect(useGraphStore.getState().nodes).toHaveLength(2);
    useGraphStore.getState().undo();
    expect(useGraphStore.getState().nodes).toHaveLength(1); // 回到 S0(只有 A)
    useGraphStore.getState().redo();
    expect(useGraphStore.getState().nodes).toHaveLength(2); // 回到 S1
  });

  it('连续多次操作后可全部 undo 回到起点', () => {
    // addNode 内部已 markHistory,无需手动记录
    const st = useGraphStore.getState();
    st.addNode({ label: 'N1' });
    st.addNode({ label: 'N2' });
    st.addNode({ label: 'N3' });
    expect(useGraphStore.getState().nodes).toHaveLength(3);
    // 全部 undo
    useGraphStore.getState().undo();
    useGraphStore.getState().undo();
    useGraphStore.getState().undo();
    expect(useGraphStore.getState().nodes).toHaveLength(0); // 回到起点
  });
});
