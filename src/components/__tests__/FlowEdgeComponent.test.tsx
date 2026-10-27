import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ReactFlow, ReactFlowProvider, type Edge, type Node } from '@xyflow/react';
import { useGraphStore } from '../../store/graphStore';
import type { FlowEdge, FlowNode } from '../../types';
import FlowEdgeComponent from '../FlowEdgeComponent';
import FlowNodeComponent from '../FlowNodeComponent';

const edgeTypes = { flow: FlowEdgeComponent };
const nodeTypes = { flow: FlowNodeComponent };

const REAL = {
  setSelected: useGraphStore.getState().setSelected,
  setArtifact: useGraphStore.getState().setArtifact,
};
let setSelected = vi.fn();
let setArtifact = vi.fn();

function makeNode(id: string, label: string, x: number): Node {
  return {
    id,
    type: 'flow',
    position: { x, y: 0 },
    // 测试环境无真实布局,直接给出已测量尺寸,否则 React Flow 认为节点未完成初始化而不渲染连线
    measured: { width: 230, height: 120 },
    data: {
      label,
      description: '',
      actor: 'human',
      locked: false,
      inputs: [{ id: 'in_1', name: '输入' }],
      outputs: [{ id: 'out_1', name: '输出' }],
    },
  } as unknown as Node;
}

function makeEdge(patch: Partial<FlowEdge> = {}): Edge {
  return {
    id: 'e1',
    source: 'n1',
    target: 'n2',
    type: 'flow',
    sourceHandle: 'out_1',
    targetHandle: 'in_1',
    data: { label: '脚本交付', artifact: null },
    ...patch,
  } as unknown as Edge;
}

function renderFlow(edge: Edge) {
  return render(
    <ReactFlowProvider>
      <ReactFlow
        nodes={[makeNode('n1', '脚本撰写', 0), makeNode('n2', '分镜设计', 400)]}
        edges={[edge]}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView={false}
      />
    </ReactFlowProvider>,
  );
}

beforeEach(() => {
  setSelected = vi.fn();
  setArtifact = vi.fn();
  useGraphStore.setState({
    nodes: [
      {
        id: 'n1',
        type: 'flow',
        position: { x: 0, y: 0 },
        data: { label: '脚本撰写', description: '', actor: 'human', locked: false, inputs: [], outputs: [] },
      } as unknown as FlowNode,
      {
        id: 'n2',
        type: 'flow',
        position: { x: 400, y: 0 },
        data: { label: '分镜设计', description: '', actor: 'human', locked: false, inputs: [], outputs: [] },
      } as unknown as FlowNode,
    ],
    edges: [],
    annotations: [],
    selected: null,
    allLocked: false,
    setSelected,
    setArtifact,
  });
});

afterEach(() => {
  useGraphStore.setState(REAL);
});

describe('FlowEdgeComponent', () => {
  it('渲染出连线路径(path 有 d 且两端连到节点端口)', () => {
    const { container } = renderFlow(makeEdge());
    const path = container.querySelector('.react-flow__edge-path');
    expect(path).not.toBeNull();
    expect(path!.getAttribute('d')).toBeTruthy();
  });

  it('渲染连线说明文字', () => {
    renderFlow(makeEdge({ data: { label: '脚本交付', artifact: null } }));
    expect(screen.getByText('脚本交付')).toBeInTheDocument();
  });

  it('有中间产物时渲染产物 chip', () => {
    renderFlow(
      makeEdge({
        data: {
          label: '脚本交付',
          artifact: { id: 'a1', kind: 'document', label: '分镜脚本', description: '' },
        },
      }),
    );
    expect(screen.getByText('分镜脚本')).toBeInTheDocument();
  });

  it('无产物时渲染「添加中间产物」按钮', () => {
    renderFlow(makeEdge({ data: { label: '', artifact: null } }));
    expect(screen.getByTitle('添加中间产物')).toBeInTheDocument();
  });

  it('点击连线说明选中该连线', () => {
    renderFlow(makeEdge());
    fireEvent.click(screen.getByText('脚本交付'));
    expect(setSelected).toHaveBeenCalledWith({ kind: 'edge', id: 'e1' });
  });

  it('演示模式锁定时添加产物按钮禁用', () => {
    useGraphStore.setState({ allLocked: true });
    const { container } = renderFlow(makeEdge({ data: { label: '', artifact: null } }));
    // 节点上也有 title 含「演示模式已锁定」的按钮,这里按连线专属类名精确定位
    const btn = container.querySelector('.nf-add-artifact')!;
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('title', '演示模式已锁定');
  });

  it('解锁时可点击添加产物按钮创建产物', () => {
    const { container } = renderFlow(makeEdge({ data: { label: '', artifact: null } }));
    fireEvent.click(container.querySelector('.nf-add-artifact')!);
    expect(setArtifact).toHaveBeenCalledTimes(1);
  });
});
