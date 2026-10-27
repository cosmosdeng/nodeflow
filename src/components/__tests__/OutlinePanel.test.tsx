import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import { useGraphStore } from '../../store/graphStore';
import type { FlowNode } from '../../types';
import OutlinePanel from '../OutlinePanel';

const REAL = { setSelected: useGraphStore.getState().setSelected };

let setSelected = vi.fn();

function makeNode(id: string, label: string, participantId?: string): FlowNode {
  return {
    id,
    type: 'flow',
    position: { x: 0, y: 0 },
    data: {
      label,
      description: '',
      actor: 'human',
      inputs: [],
      outputs: [],
      participantId: participantId ?? null,
      stageId: null,
    },
  } as unknown as FlowNode;
}

beforeEach(() => {
  setSelected = vi.fn();
  useGraphStore.setState({
    nodes: [makeNode('n1', '脚本撰写'), makeNode('n2', '分镜设计')],
    edges: [],
    selected: null,
    participants: [],
    stages: [],
    allLocked: false,
    setSelected,
  });
});

afterEach(() => {
  useGraphStore.setState(REAL);
});

/** 组件用 useReactFlow() 取 setCenter,必须包 ReactFlowProvider */
function renderPanel(onClose = vi.fn()) {
  return render(
    <ReactFlowProvider>
      <OutlinePanel onClose={onClose} />
    </ReactFlowProvider>,
  );
}

describe('OutlinePanel', () => {
  it('无节点时显示空态引导', () => {
    useGraphStore.setState({ nodes: [] });
    renderPanel();
    expect(screen.getByText(/画布上还没有节点/)).toBeInTheDocument();
  });

  it('列出所有节点并显示节点总数', () => {
    renderPanel();
    expect(screen.getByText('大纲 · 2 个节点')).toBeInTheDocument();
    expect(screen.getByText('脚本撰写')).toBeInTheDocument();
    expect(screen.getByText('分镜设计')).toBeInTheDocument();
  });

  it('搜索可过滤节点,无匹配时显示提示', () => {
    renderPanel();
    fireEvent.change(screen.getByPlaceholderText('搜索节点…'), { target: { value: '分镜' } });
    expect(screen.getByText('分镜设计')).toBeInTheDocument();
    expect(screen.queryByText('脚本撰写')).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('搜索节点…'), { target: { value: '不存在' } });
    expect(screen.getByText('没有匹配的节点')).toBeInTheDocument();
  });

  it('点击列表项选中该节点', () => {
    renderPanel();
    fireEvent.click(screen.getByText('分镜设计'));
    expect(setSelected).toHaveBeenCalledWith({ kind: 'node', id: 'n2' });
  });

  it('搜索时容忍缺失 description 字段的节点(旧项目文件导入场景)', () => {
    // 回归:过滤直接对 description 调 toLowerCase,字段缺失会整块崩溃
    // 仅缺失 description(其余字段齐全,保证能正常渲染)
    const legacy = {
      ...makeNode('n1', '脚本撰写'),
      data: { label: '脚本撰写', actor: 'human', inputs: [], outputs: [] },
    } as unknown as FlowNode;
    useGraphStore.setState({ nodes: [legacy] });
    renderPanel();
    expect(() => {
      fireEvent.change(screen.getByPlaceholderText('搜索节点…'), { target: { value: '脚本' } });
    }).not.toThrow();
    expect(screen.getByText('脚本撰写')).toBeInTheDocument();
  });

  it('按执行主体分组时显示分组标题', () => {
    renderPanel();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'actor' } });
    expect(screen.getByText(/人工节点/)).toBeInTheDocument();
  });

  it('点击关闭按钮触发 onClose', () => {
    const onClose = vi.fn();
    renderPanel(onClose);
    fireEvent.click(screen.getByTitle('关闭大纲'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
