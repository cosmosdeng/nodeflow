import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useGraphStore } from '../../store/graphStore';
import type { FlowEdge, FlowNode, GraphSnapshot } from '../../types';
import HistoryPanel from '../HistoryPanel';

// 组件层只验证「交互 → 调用 action」,undo/redo/jumpTo 的真实行为由 store 层测试覆盖。
// 这里先把原始 action 存下来,用例内替换成 spy,用完恢复,避免污染其他用例。
const REAL = {
  undo: useGraphStore.getState().undo,
  redo: useGraphStore.getState().redo,
  jumpTo: useGraphStore.getState().jumpTo,
};

function makeSnap(nodeCount: number): GraphSnapshot {
  const nodes = Array.from({ length: nodeCount }, (_, i) => ({
    id: `h${i}`,
    type: 'flow',
    position: { x: 0, y: 0 },
    data: { label: `历史节点${i}`, actor: 'human', inputs: [], outputs: [] },
  })) as unknown as FlowNode[];
  return {
    nodes,
    edges: [] as FlowEdge[],
    viewport: { x: 0, y: 0, zoom: 1 },
    at: Date.now(),
  } as unknown as GraphSnapshot;
}

function makeNode(id: string): FlowNode {
  return {
    id,
    type: 'flow',
    position: { x: 0, y: 0 },
    data: { label: `当前${id}`, actor: 'human', inputs: [], outputs: [] },
  } as unknown as FlowNode;
}

let undo = vi.fn();
let redo = vi.fn();
let jumpTo = vi.fn();

beforeEach(() => {
  undo = vi.fn();
  redo = vi.fn();
  jumpTo = vi.fn();
  useGraphStore.setState({
    nodes: [makeNode('a')],
    edges: [],
    past: [],
    future: [],
    allLocked: false,
    undo,
    redo,
    jumpTo,
  });
});

afterEach(() => {
  useGraphStore.setState(REAL);
});

describe('HistoryPanel', () => {
  it('无历史时显示空态,且撤销/重做不可用', () => {
    render(<HistoryPanel onClose={() => {}} />);
    expect(screen.getByText(/还没有历史记录/)).toBeInTheDocument();
    expect(screen.getByText(/可在此回溯任意步骤/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /撤销/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /重做/ })).toBeDisabled();
  });

  it('有历史时显示步数,点击撤销调用 store undo', () => {
    useGraphStore.setState({ past: [makeSnap(2)], future: [] });
    render(<HistoryPanel onClose={() => {}} />);
    expect(screen.getByText(/历史记录 · 1 步/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /撤销/ }));
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it('有可重做记录时显示「未来」区,点击重做调用 store redo', () => {
    useGraphStore.setState({ past: [], future: [makeSnap(3)] });
    render(<HistoryPanel onClose={() => {}} />);
    expect(screen.getByText('未来 (可重做)')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /重做/ }));
    expect(redo).toHaveBeenCalledTimes(1);
  });

  it('点击过去条目可回溯到该步骤(jumpTo)', () => {
    useGraphStore.setState({ past: [makeSnap(2)], future: [] });
    render(<HistoryPanel onClose={() => {}} />);
    // 历史条目是 div(非 button),按文本定位
    fireEvent.click(screen.getByText('2 节点 · 0 连线'));
    expect(jumpTo).toHaveBeenCalledTimes(1);
  });

  it('演示模式锁定时撤销/重做按钮禁用', () => {
    useGraphStore.setState({ past: [makeSnap(2)], future: [makeSnap(3)], allLocked: true });
    render(<HistoryPanel onClose={() => {}} />);
    expect(screen.getByRole('button', { name: /撤销/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /重做/ })).toBeDisabled();
  });

  it('点击关闭按钮触发 onClose', () => {
    const onClose = vi.fn();
    render(<HistoryPanel onClose={onClose} />);
    fireEvent.click(screen.getByTitle('关闭历史面板'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
