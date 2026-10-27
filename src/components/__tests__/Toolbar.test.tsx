import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import { useGraphStore } from '../../store/graphStore';
import type { FlowNode, GraphSnapshot } from '../../types';
import Toolbar from '../Toolbar';

const S = useGraphStore.getState();
const REAL = {
  undo: S.undo,
  redo: S.redo,
  addNode: S.addNode,
  setEdgeStyle: S.setEdgeStyle,
  setTheme: S.setTheme,
  toggleLockAll: S.toggleLockAll,
  groupSelected: S.groupSelected,
  toggleAllAnnotations: S.toggleAllAnnotations,
  runSmartArrange: S.runSmartArrange,
};

let undo = vi.fn();
let redo = vi.fn();
let addNode = vi.fn();
let setEdgeStyle = vi.fn();
let setTheme = vi.fn();
let toggleLockAll = vi.fn();
let groupSelected = vi.fn();
let toggleAllAnnotations = vi.fn();
let runSmartArrange = vi.fn();

/** 组件只关心 past/future 的**长度**,内容用最小合法快照即可 */
function emptySnap(): GraphSnapshot {
  return { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, at: Date.now() } as unknown as GraphSnapshot;
}

function makeNode(id: string, label: string, selected = false): FlowNode {
  return {
    id,
    type: 'flow',
    position: { x: 0, y: 0 },
    selected,
    data: { label, description: '', actor: 'human', locked: false, inputs: [], outputs: [] },
  } as unknown as FlowNode;
}

function renderToolbar(overrides: Partial<Record<'onToggleOutline', () => void>> = {}) {
  const props = {
    showOutline: true,
    showProperties: true,
    showHistory: true,
    showSemantic: true,
    onToggleOutline: vi.fn(),
    onToggleProperties: vi.fn(),
    onToggleHistory: vi.fn(),
    onToggleSemantic: vi.fn(),
    ...overrides,
  };
  const utils = render(
    <ReactFlowProvider>
      <Toolbar {...props} />
    </ReactFlowProvider>,
  );
  return { ...utils, props };
}

beforeEach(() => {
  undo = vi.fn();
  redo = vi.fn();
  addNode = vi.fn(() => 'new');
  setEdgeStyle = vi.fn();
  setTheme = vi.fn();
  toggleLockAll = vi.fn();
  groupSelected = vi.fn();
  toggleAllAnnotations = vi.fn();
  runSmartArrange = vi.fn();
  useGraphStore.setState({
    nodes: [makeNode('n1', '脚本撰写')],
    edges: [],
    selected: null,
    past: [],
    future: [],
    annotations: [],
    allLocked: false,
    arrangePending: false,
    undo,
    redo,
    addNode,
    setEdgeStyle,
    setTheme,
    toggleLockAll,
    groupSelected,
    toggleAllAnnotations,
    runSmartArrange,
  });
});

afterEach(() => {
  useGraphStore.setState(REAL);
});

describe('Toolbar', () => {
  it('渲染出主要操作按钮', () => {
    renderToolbar();
    expect(screen.getByRole('button', { name: /撤销/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /重做/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /添加节点/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /自动排列/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /组合节点/ })).toBeInTheDocument();
  });

  it('无历史时撤销/重做禁用', () => {
    renderToolbar();
    expect(screen.getByRole('button', { name: /撤销/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /重做/ })).toBeDisabled();
  });

  it('有历史时点击撤销 / 重做调用对应 action', () => {
    useGraphStore.setState({ past: [emptySnap()], future: [emptySnap()] });
    renderToolbar();
    fireEvent.click(screen.getByRole('button', { name: /撤销/ }));
    fireEvent.click(screen.getByRole('button', { name: /重做/ }));
    expect(undo).toHaveBeenCalledTimes(1);
    expect(redo).toHaveBeenCalledTimes(1);
  });

  it('点击「添加节点」调用 addNode', () => {
    renderToolbar();
    fireEvent.click(screen.getByRole('button', { name: /添加节点/ }));
    expect(addNode).toHaveBeenCalledTimes(1);
  });

  it('点击「自动排列」调用 runSmartArrange', () => {
    renderToolbar();
    fireEvent.click(screen.getByRole('button', { name: /自动排列/ }));
    expect(runSmartArrange).toHaveBeenCalledTimes(1);
  });

  it('组合按钮:选中不足 2 个节点时禁用,选中 2 个后可点', () => {
    useGraphStore.setState({ nodes: [makeNode('n1', 'A', true)] });
    renderToolbar();
    expect(screen.getByRole('button', { name: /组合节点/ })).toBeDisabled();

    // 渲染后更新 store 必须用 act 包裹,否则组件尚未重渲染就点击
    act(() => {
      useGraphStore.setState({ nodes: [makeNode('n1', 'A', true), makeNode('n2', 'B', true)] });
    });
    fireEvent.click(screen.getByRole('button', { name: /组合节点/ }));
    expect(groupSelected).toHaveBeenCalledTimes(1);
  });

  it('切换连线风格 / 配色调用对应 action', () => {
    renderToolbar();
    fireEvent.click(screen.getByTitle(/切换连线风格/));
    fireEvent.click(screen.getByTitle('切换画布配色'));
    expect(setEdgeStyle).toHaveBeenCalledTimes(1);
    expect(setTheme).toHaveBeenCalledTimes(1);
  });

  it('点击锁定按钮调用 toggleLockAll', () => {
    renderToolbar();
    fireEvent.click(screen.getByTitle(/演示模式/));
    expect(toggleLockAll).toHaveBeenCalledTimes(1);
  });

  it('无注释时注释按钮禁用;有注释时可一键展开/收起', () => {
    renderToolbar();
    const btn = screen.getByTitle('一键展开 / 收起所有注释');
    expect(btn).toBeDisabled();

    act(() => {
      useGraphStore.setState({
        annotations: [
          { id: 'an1', target: { kind: 'canvas', tabId: 'main' }, title: 't', content: 'c', collapsed: false },
        ],
      });
    });
    fireEvent.click(btn);
    expect(toggleAllAnnotations).toHaveBeenCalledTimes(1);
  });

  it('面板切换按钮回调各自的 toggle', () => {
    const { props } = renderToolbar();
    fireEvent.click(screen.getByRole('button', { name: /大纲/ }));
    fireEvent.click(screen.getByRole('button', { name: /属性/ }));
    fireEvent.click(screen.getByRole('button', { name: /历史/ }));
    fireEvent.click(screen.getByRole('button', { name: /语义/ }));
    expect(props.onToggleOutline).toHaveBeenCalledTimes(1);
    expect(props.onToggleProperties).toHaveBeenCalledTimes(1);
    expect(props.onToggleHistory).toHaveBeenCalledTimes(1);
    expect(props.onToggleSemantic).toHaveBeenCalledTimes(1);
  });

  it('演示模式锁定时操作按钮全部禁用', () => {
    useGraphStore.setState({ allLocked: true, past: [emptySnap()], future: [emptySnap()] });
    renderToolbar();
    expect(screen.getByRole('button', { name: /撤销/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /重做/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /添加节点/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /自动排列/ })).toBeDisabled();
  });
});
