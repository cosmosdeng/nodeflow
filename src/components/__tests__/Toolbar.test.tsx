import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import { useGraphStore } from '../../store/graphStore';
import { confirmDialogAsync } from '../../lib/dialog';
import type { FlowNode, GraphDocument, GraphSnapshot } from '../../types';
import Toolbar from '../Toolbar';

// 新建项目 / 清空画布走确认对话框;只替换这一个函数,其余导出保持真实实现
vi.mock('../../lib/dialog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/dialog')>();
  return { ...actual, confirmDialogAsync: vi.fn() };
});

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
  createDocument: S.createDocument,
  clearGraph: S.clearGraph,
  saveDocument: S.saveDocument,
  closeDocument: S.closeDocument,
  exportJson: S.exportJson,
  serializeProject: S.serializeProject,
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
let createDocument = vi.fn();
let clearGraph = vi.fn();
let saveDocument = vi.fn();
let closeDocument = vi.fn();
let exportJson = vi.fn();
let serializeProject = vi.fn();

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
  createDocument = vi.fn();
  clearGraph = vi.fn();
  saveDocument = vi.fn();
  closeDocument = vi.fn();
  exportJson = vi.fn();
  serializeProject = vi.fn(() => '{}');
  vi.mocked(confirmDialogAsync).mockClear();
  vi.mocked(confirmDialogAsync).mockResolvedValue(true);
  useGraphStore.setState({
    nodes: [makeNode('n1', '脚本撰写')],
    edges: [],
    selected: null,
    past: [],
    future: [],
    annotations: [],
    allLocked: false,
    arrangePending: false,
    // 保存 / 关闭项目需要当前文档存在,否则菜单项的处理函数会直接早退
    documents: [{ id: 'd1', name: '测试项目', nodes: [], edges: [] }] as unknown as GraphDocument[],
    activeDocumentId: 'd1',
    dirty: false,
    undo,
    redo,
    addNode,
    setEdgeStyle,
    setTheme,
    toggleLockAll,
    groupSelected,
    toggleAllAnnotations,
    runSmartArrange,
    createDocument,
    clearGraph,
    saveDocument,
    closeDocument,
    exportJson,
    serializeProject,
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

describe('Toolbar 文件菜单与确认流程', () => {
  // 菜单是「点文件 → 一级菜单 → 点导入/导出 → 二级菜单」两层结构
  async function openFileMenu() {
    renderToolbar();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /文件/ }));
    });
  }

  it('点击「文件」展开一级菜单', async () => {
    renderToolbar();
    expect(screen.queryByRole('button', { name: /新建项目/ })).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /文件/ }));
    });
    expect(screen.getByRole('button', { name: /新建项目/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /保存项目/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /导入/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /导出/ })).toBeInTheDocument();
  });

  it('新建项目:确认后调用 createDocument', async () => {
    vi.mocked(confirmDialogAsync).mockResolvedValue(true);
    await openFileMenu();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /新建项目/ }));
    });
    await waitFor(() => expect(createDocument).toHaveBeenCalledTimes(1));
  });

  it('新建项目:取消后不调用 createDocument', async () => {
    vi.mocked(confirmDialogAsync).mockResolvedValue(false);
    await openFileMenu();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /新建项目/ }));
    });
    expect(confirmDialogAsync).toHaveBeenCalledTimes(1);
    expect(createDocument).not.toHaveBeenCalled();
  });

  it('清空画布:确认后调用 clearGraph', async () => {
    vi.mocked(confirmDialogAsync).mockResolvedValue(true);
    await openFileMenu();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /清空画布/ }));
    });
    await waitFor(() => expect(clearGraph).toHaveBeenCalledTimes(1));
  });

  it('演示模式锁定时新建项目 / 清空画布禁用', async () => {
    useGraphStore.setState({ allLocked: true });
    await openFileMenu();
    expect(screen.getByRole('button', { name: /新建项目/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /清空画布/ })).toBeDisabled();
  });

  it('保存项目:序列化当前编辑状态并下载文件', async () => {
    await openFileMenu();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /保存项目/ }));
    });
    // 「保存项目」是把包含撤销历史的整体 projects 下载走,走的是 serializeProject
    expect(serializeProject).toHaveBeenCalledTimes(1);
    expect(saveDocument).not.toHaveBeenCalled();
  });

  it('关闭项目:确认后调用 closeDocument', async () => {
    await openFileMenu();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /关闭项目/ }));
    });
    expect(confirmDialogAsync).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(closeDocument).toHaveBeenCalledTimes(1));
  });

  it('导入二级菜单:点「导入」后出现 JSON 导入项', async () => {
    await openFileMenu();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /导入/ }));
    });
    expect(screen.getByRole('button', { name: /导入 JSON/ })).toBeInTheDocument();
  });

  it('导出二级菜单:点「导出」后出现 JSON / JPG / PDF 与幅面选项', async () => {
    await openFileMenu();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /导出/ }));
    });
    expect(screen.getByRole('button', { name: /导出 JSON/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /导出 JPG/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /导出 PDF/ })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /幅面:/ }).length).toBeGreaterThan(0);
  });

  it('导出 JSON 菜单项触发 exportJson', async () => {
    await openFileMenu();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /导出/ }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /导出 JSON/ }));
    });
    expect(exportJson).toHaveBeenCalledTimes(1);
  });
});
