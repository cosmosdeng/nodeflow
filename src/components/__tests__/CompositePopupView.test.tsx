import { beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render } from '@testing-library/react';
import type { FlowNode } from '../../types';
import CompositePopupView from '../CompositePopupView';

const KEY_PREFIX = 'nodeflow:composite:snapshot:';

function makeNode(id: string, x: number): FlowNode {
  return {
    id,
    type: 'flow',
    position: { x, y: 0 },
    data: { label: `内部节点${id}`, description: '', actor: 'human', locked: false, inputs: [], outputs: [] },
  } as unknown as FlowNode;
}

function writeSnapshot(id: string, nodes: FlowNode[], label = '组合 A'): void {
  localStorage.setItem(`${KEY_PREFIX}${id}`, JSON.stringify({ label, nodes, edges: [], savedAt: Date.now() }));
}

beforeEach(() => {
  localStorage.clear();
});

describe('CompositePopupView', () => {
  it('没有快照时显示空态提示', () => {
    const { container } = render(<CompositePopupView id="c1" />);
    expect(container.querySelector('.popup-empty')).not.toBeNull();
    expect(container.querySelector('.popup-title')).toHaveTextContent('内部画布');
  });

  it('快照存在但内部没有节点时同样显示空态', () => {
    writeSnapshot('c1', []);
    const { container } = render(<CompositePopupView id="c1" />);
    expect(container.querySelector('.popup-empty')).not.toBeNull();
  });

  it('快照损坏(非法 JSON)时不崩溃,回落到空态', () => {
    localStorage.setItem(`${KEY_PREFIX}c1`, '{不是合法 JSON');
    const { container } = render(<CompositePopupView id="c1" />);
    expect(container.querySelector('.popup-empty')).not.toBeNull();
  });

  it('快照结构非法(nodes 不是数组)时回落到空态', () => {
    localStorage.setItem(`${KEY_PREFIX}c1`, JSON.stringify({ label: 'x', nodes: {}, edges: [] }));
    const { container } = render(<CompositePopupView id="c1" />);
    expect(container.querySelector('.popup-empty')).not.toBeNull();
  });

  it('正常渲染内部画布:标题含组合名 + 只读子标题 + 节点数量正确', () => {
    writeSnapshot('c1', [makeNode('n1', 0), makeNode('n2', 300)]);
    const { container } = render(<CompositePopupView id="c1" />);
    expect(container.querySelector('.popup-empty')).toBeNull();
    expect(container.querySelector('.popup-title')).toHaveTextContent('组合 A · 内部画布');
    expect(container.querySelector('.popup-sub')).toHaveTextContent('只读查看');
    expect(container.querySelectorAll('.react-flow__node').length).toBe(2);
  });

  it('监听到 storage 变更会刷新快照内容', () => {
    writeSnapshot('c1', [makeNode('n1', 0)]);
    const { container } = render(<CompositePopupView id="c1" />);
    expect(container.querySelectorAll('.react-flow__node').length).toBe(1);

    writeSnapshot('c1', [makeNode('n1', 0), makeNode('n2', 300), makeNode('n3', 600)], '改过名的组合');
    act(() => {
      fireEvent(window, new StorageEvent('storage', { key: `${KEY_PREFIX}c1` }));
    });
    expect(container.querySelectorAll('.react-flow__node').length).toBe(3);
    expect(container.querySelector('.popup-title')).toHaveTextContent('改过名的组合');
  });

  it('不同 id 读取各自独立的快照', () => {
    writeSnapshot('c1', [makeNode('n1', 0)], '组合一');
    writeSnapshot('c2', [makeNode('n1', 0), makeNode('n2', 300)], '组合二');
    const second = render(<CompositePopupView id="c2" />);
    expect(second.container.querySelector('.popup-title')).toHaveTextContent('组合二');
    expect(second.container.querySelectorAll('.react-flow__node').length).toBe(2);
  });
});
