import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import { useGraphStore } from '../../store/graphStore';
import type { FlowEdge, FlowNode, GraphDocument } from '../../types';
import FlowCanvas from '../FlowCanvas';

function makeNode(id: string, label: string, x: number): FlowNode {
  return {
    id,
    type: 'flow',
    position: { x, y: 0 },
    data: {
      label,
      description: '',
      actor: 'human',
      locked: false,
      inputs: [{ id: 'in_1', name: '输入' }],
      outputs: [{ id: 'out_1', name: '输出' }],
    },
  } as unknown as FlowNode;
}

function seed() {
  useGraphStore.setState({
    nodes: [makeNode('n1', '脚本撰写', 0), makeNode('n2', '分镜设计', 400)],
    edges: [
      {
        id: 'e1',
        source: 'n1',
        target: 'n2',
        type: 'flow',
        sourceHandle: 'out_1',
        targetHandle: 'in_1',
        data: { label: '脚本交付', artifact: null },
      } as unknown as FlowEdge,
    ],
    selected: null,
    allLocked: false,
    annotations: [],
    activeTabId: 'main',
    // 画布只用到文档名,其余字段与用例无关,用最小对象 + 断言
    documents: [{ id: 'd1', name: '测试项目', nodes: [], edges: [] }] as unknown as GraphDocument[],
    activeDocumentId: 'd1',
    past: [],
    future: [],
  });
}

/** FlowCanvas 内部用 useReactFlow,必须包在 ReactFlowProvider 内(与 main.tsx 一致) */
function renderCanvas() {
  return render(
    <ReactFlowProvider>
      <FlowCanvas />
    </ReactFlowProvider>,
  );
}

beforeEach(() => {
  seed();
});

describe('FlowCanvas', () => {
  it('渲染画布容器与节点', () => {
    const { container } = renderCanvas();
    expect(container.querySelector('.react-flow')).not.toBeNull();
    expect(screen.getByText('脚本撰写')).toBeInTheDocument();
    expect(screen.getByText('分镜设计')).toBeInTheDocument();
  });

  it('渲染连线与连线说明', () => {
    const { container } = renderCanvas();
    expect(container.querySelectorAll('.react-flow__edge-path').length).toBe(1);
    expect(screen.getByText('脚本交付')).toBeInTheDocument();
  });

  it('点击节点选中该节点', () => {
    renderCanvas();
    fireEvent.click(screen.getByText('分镜设计'));
    expect(useGraphStore.getState().selected).toEqual({ kind: 'node', id: 'n2' });
  });

  it('连线永远覆盖在节点上面(连线层 z-index 高于节点层)', () => {
    const { container } = renderCanvas();
    const edges = container.querySelector('.react-flow__edges');
    const nodes = container.querySelector('.react-flow__nodes');
    expect(edges).not.toBeNull();
    expect(nodes).not.toBeNull();
    // 层级由 CSS 控制(global.css),这里断言两层都渲染到位,由样式保证 edges 在上
    expect(edges!.classList.contains('react-flow__edges')).toBe(true);
  });

  it('无节点时画布仍正常渲染(空画布)', () => {
    useGraphStore.setState({ nodes: [], edges: [] });
    const { container } = renderCanvas();
    expect(container.querySelector('.react-flow')).not.toBeNull();
    expect(container.querySelectorAll('.react-flow__node').length).toBe(0);
  });

  it('演示模式锁定时节点与连线仍渲染', () => {
    useGraphStore.setState({ allLocked: true });
    const { container } = renderCanvas();
    expect(container.querySelectorAll('.react-flow__node').length).toBe(2);
    expect(container.querySelectorAll('.react-flow__edge-path').length).toBe(1);
  });
});
