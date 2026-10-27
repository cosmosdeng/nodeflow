import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ReactFlowProvider, type NodeProps } from '@xyflow/react';
import { useGraphStore } from '../../store/graphStore';
import type { FlowNode, FlowNodeData } from '../../types';
import FlowNodeComponent from '../FlowNodeComponent';

function makeData(patch: Partial<FlowNodeData> = {}): FlowNodeData {
  return {
    label: '脚本撰写',
    description: '整理脚本',
    actor: 'human',
    locked: false,
    inputs: [{ id: 'in_1', name: '输入' }],
    outputs: [{ id: 'out_1', name: '输出' }],
    ...patch,
  } as unknown as FlowNodeData;
}

/** 组件内使用 React Flow 的 Handle,必须在 ReactFlowProvider 下渲染 */
function renderNode(data: FlowNodeData, selected = false) {
  const props = {
    id: 'n1',
    type: 'flow',
    data,
    selected,
    dragging: false,
    zIndex: 0,
    isConnectable: true,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
  } as unknown as NodeProps<FlowNode>;
  return render(
    <ReactFlowProvider>
      <FlowNodeComponent {...props} />
    </ReactFlowProvider>,
  );
}

describe('FlowNodeComponent', () => {
  it('渲染节点标题 / 描述 / 端口', () => {
    const { container } = renderNode(makeData());
    expect(container.textContent).toContain('脚本撰写');
    expect(container.textContent).toContain('整理脚本');
    expect(container.textContent).toContain('输入');
    expect(container.textContent).toContain('输出');
  });

  it('端口总数 = 输入 + 输出(各渲染一个 Handle)', () => {
    const { container } = renderNode(makeData());
    expect(container.querySelectorAll('.react-flow__handle').length).toBe(2);
  });

  it('选中时根节点带选中样式', () => {
    const { container } = renderNode(makeData(), true);
    expect(container.querySelector('.nf-node')).toBeInTheDocument();
    expect(container.querySelector('.nf-node.selected')).not.toBeNull();
  });

  it('未选中时无选中样式', () => {
    const { container } = renderNode(makeData(), false);
    expect(container.querySelector('.nf-node.selected')).toBeNull();
  });

  it('锁定时不渲染端口删除按钮', () => {
    const lockedData = makeData({
      locked: true,
      inputs: [
        { id: 'in_1', name: '输入' },
        { id: 'in_2', name: '输入2' },
      ],
    });
    const { container } = renderNode(lockedData);
    expect(container.querySelectorAll('.nf-node .port-remove').length).toBe(0);
  });

  it('双击标题进入编辑(节点拖拽由外部处理)', () => {
    const { container } = renderNode(makeData());
    const title = container.querySelector('.node-title')!;
    fireEvent.doubleClick(title);
    expect(title).toHaveAttribute('contenteditable', 'true');
  });

  it('端口数量随数据变化', () => {
    const { container } = renderNode(
      makeData({
        inputs: [
          { id: 'in_1', name: '输入1' },
          { id: 'in_2', name: '输入2' },
        ],
        outputs: [{ id: 'out_1', name: '输出' }],
      }),
    );
    expect(container.querySelectorAll('.react-flow__handle').length).toBe(3);
  });
});

describe('FlowNodeComponent 与 store 联动', () => {
  it('删除端口按钮调用 removePort 移除对应端口', () => {
    const removePort = vi.fn();
    useGraphStore.setState({
      nodes: [
        {
          id: 'n1',
          type: 'flow',
          position: { x: 0, y: 0 },
          data: makeData({
            inputs: [
              { id: 'in_1', name: '输入1' },
              { id: 'in_2', name: '输入2' },
            ],
          }),
        } as unknown as FlowNode,
      ],
      edges: [],
      allLocked: false,
      removePort,
    });
    const { container } = renderNode(
      makeData({
        inputs: [
          { id: 'in_1', name: '输入1' },
          { id: 'in_2', name: '输入2' },
        ],
      }),
    );
    const removes = container.querySelectorAll('.port-remove');
    expect(removes.length).toBeGreaterThan(0);
    fireEvent.click(removes[0]);
    // removePort(节点 id, 方向, 端口 id)
    expect(removePort).toHaveBeenCalledWith('n1', 'input', 'in_1');
  });
});
