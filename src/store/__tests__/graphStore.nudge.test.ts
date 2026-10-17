import { describe, expect, it, beforeEach, vi } from 'vitest';
import type { FlowNode } from '../../types';

// mock localStorage(Node 环境无 localStorage)
const storage = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => storage.set(k, v),
  removeItem: (k: string) => storage.delete(k),
  clear: () => storage.clear(),
  key: (i: number) => [...storage.keys()][i] ?? null,
  get length() {
    return storage.size;
  },
});

import { useGraphStore } from '../graphStore';
import { setLastNudgeAt } from '../runtimeFlags';

function makeNode(id: string, x: number, y: number, selected = false): FlowNode {
  return {
    id,
    type: 'flow',
    position: { x, y },
    selected,
    data: { label: id, actor: 'machine', locked: false, inputs: [], outputs: [] },
  } as unknown as FlowNode;
}

/** 重置为「一个选中节点 A + 空历史」的干净状态 */
function seed(selected = true): void {
  useGraphStore.setState({
    nodes: [makeNode('A', 100, 100, selected)],
    edges: [],
    past: [],
    future: [],
    allLocked: false,
  });
  // 跨用例隔离:清空键盘微调的合并窗口时间戳
  setLastNudgeAt(0);
}

const posOf = (id: string) => useGraphStore.getState().nodes.find((n) => n.id === id)!.position;
const pastLen = () => useGraphStore.getState().past.length;

describe('nudgeSelectedNodes(键盘微调)', () => {
  beforeEach(() => seed());

  it('按方向键移动选中节点', () => {
    useGraphStore.getState().nudgeSelectedNodes(10, 0);
    expect(posOf('A')).toEqual({ x: 110, y: 100 });
  });

  it('移动纳入历史栈:撤销可还原到移动前', () => {
    useGraphStore.getState().nudgeSelectedNodes(10, 10);
    expect(posOf('A')).toEqual({ x: 110, y: 110 });
    expect(pastLen()).toBeGreaterThan(0);

    useGraphStore.getState().undo();
    expect(posOf('A')).toEqual({ x: 100, y: 100 });
  });

  it('合并窗口内连续移动只占一条历史', () => {
    const st = useGraphStore.getState();
    st.nudgeSelectedNodes(10, 0);
    st.nudgeSelectedNodes(10, 0);
    st.nudgeSelectedNodes(10, 0);
    expect(posOf('A')).toEqual({ x: 130, y: 100 });
    expect(pastLen()).toBe(1);

    // 一次撤销即回到移动前,而不是回到上一次微调后
    useGraphStore.getState().undo();
    expect(posOf('A')).toEqual({ x: 100, y: 100 });
  });

  it('超出合并窗口的移动各自记录历史', () => {
    const st = useGraphStore.getState();
    st.nudgeSelectedNodes(10, 0, -1); // mergeWindowMs < 0 → 每次都打快照
    st.nudgeSelectedNodes(10, 0, -1);
    expect(pastLen()).toBe(2);
  });

  it('无选中节点时不移动、不留历史', () => {
    seed(false);
    useGraphStore.getState().nudgeSelectedNodes(10, 0);
    expect(posOf('A')).toEqual({ x: 100, y: 100 });
    expect(pastLen()).toBe(0);
  });

  it('演示锁定(allLocked)下不移动', () => {
    useGraphStore.setState({ allLocked: true });
    useGraphStore.getState().nudgeSelectedNodes(10, 0);
    expect(posOf('A')).toEqual({ x: 100, y: 100 });
    expect(pastLen()).toBe(0);
  });
});
