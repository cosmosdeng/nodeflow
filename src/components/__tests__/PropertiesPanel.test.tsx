import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useGraphStore } from '../../store/graphStore';
import type { FlowEdge, FlowNode } from '../../types';
import PropertiesPanel from '../PropertiesPanel';

function makeNode(id: string, label: string): FlowNode {
  return {
    id,
    type: 'flow',
    position: { x: 0, y: 0 },
    data: { label, actor: 'human', description: '', locked: false, inputs: [], outputs: [] },
  } as unknown as FlowNode;
}

/** 播种:两个节点 + 一条连线(带中间产物) */
function seedGraph(): void {
  useGraphStore.setState({
    nodes: [makeNode('n1', '脚本撰写'), makeNode('n2', '分镜设计')],
    edges: [
      {
        id: 'e1',
        source: 'n1',
        target: 'n2',
        type: 'flow',
        data: {
          label: '脚本交付',
          artifact: { id: 'a1', kind: 'document', label: '分镜脚本', description: '' },
        },
      } as unknown as FlowEdge,
    ],
    selected: null,
    allLocked: false,
    past: [],
    future: [],
  });
}

describe('PropertiesPanel', () => {
  beforeEach(() => {
    seedGraph();
  });

  it('未选中时显示引导空态', () => {
    render(<PropertiesPanel onClose={() => {}} />);
    expect(screen.getByText('属性')).toBeInTheDocument();
    expect(screen.getByText(/在画布中选中一个节点、连线或中间产物/)).toBeInTheDocument();
  });

  it('选中节点 → 显示节点属性,并读出节点名称 / 描述', () => {
    useGraphStore.setState({ selected: { kind: 'node', id: 'n1' } });
    render(<PropertiesPanel onClose={() => {}} />);
    expect(screen.getByText('节点属性')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('节点名称')).toHaveValue('脚本撰写');
  });

  it('选中连线 → 显示连线属性,并展示起止节点', () => {
    useGraphStore.setState({ selected: { kind: 'edge', id: 'e1' } });
    render(<PropertiesPanel onClose={() => {}} />);
    expect(screen.getByText('连线属性')).toBeInTheDocument();
    expect(screen.getByText('脚本撰写')).toBeInTheDocument();
    expect(screen.getByText('分镜设计')).toBeInTheDocument();
  });

  it('选中中间产物 → 显示中间产物属性', () => {
    useGraphStore.setState({ selected: { kind: 'artifact', edgeId: 'e1' } });
    render(<PropertiesPanel onClose={() => {}} />);
    expect(screen.getByText('中间产物属性')).toBeInTheDocument();
    expect(screen.getByText('分镜脚本')).toBeInTheDocument();
  });

  it('修改节点名称:失焦时提交并写回 store', () => {
    useGraphStore.setState({ selected: { kind: 'node', id: 'n1' } });
    render(<PropertiesPanel onClose={() => {}} />);
    const input = screen.getByPlaceholderText('节点名称');
    fireEvent.change(input, { target: { value: '改写后的节点' } });
    fireEvent.blur(input);
    const n1 = useGraphStore.getState().nodes.find((n) => n.id === 'n1');
    expect(n1?.data.label).toBe('改写后的节点');
  });

  it('执行主体按钮切换 actor(人 → 机器)', () => {
    useGraphStore.setState({ selected: { kind: 'node', id: 'n1' } });
    render(<PropertiesPanel onClose={() => {}} />);
    // 「人工 / 机器 / 人机协同」三个按钮;无障碍名含图标 alt + 文本,故用正则匹配
    fireEvent.click(screen.getByRole('button', { name: /机器/ }));
    const n1 = useGraphStore.getState().nodes.find((n) => n.id === 'n1');
    expect(n1?.data.actor).toBe('machine');
  });

  it('演示模式全局锁定时:字段只读并显示锁定提示', () => {
    useGraphStore.setState({ selected: { kind: 'node', id: 'n1' }, allLocked: true });
    render(<PropertiesPanel onClose={() => {}} />);
    expect(screen.getByPlaceholderText('节点名称')).toBeDisabled();
    expect(screen.getByText('🔒 演示模式已锁定全部内容,此处只读')).toBeInTheDocument();
  });

  it('节点自身锁定时显示「解锁」按钮,点击可解锁', () => {
    useGraphStore.setState({
      selected: { kind: 'node', id: 'n1' },
      nodes: [{ ...makeNode('n1', '脚本撰写'), data: { ...makeNode('n1', '').data, locked: true } } as FlowNode],
    });
    render(<PropertiesPanel onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: '解锁' }));
    const n1 = useGraphStore.getState().nodes.find((n) => n.id === 'n1');
    expect(n1?.data.locked).toBe(false);
  });

  it('点击面板关闭按钮触发 onClose', () => {
    const onClose = vi.fn();
    render(<PropertiesPanel onClose={onClose} />);
    fireEvent.click(screen.getByTitle('关闭属性面板'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
