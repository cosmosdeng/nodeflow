import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import SemanticOrderList, { type OrderItem } from '../SemanticOrderList';

const items: OrderItem[] = [
  { id: 'p1', name: '导演', count: 2, tag: '制片组' },
  { id: 'p2', name: 'AI 剪辑', count: 0, empty: true },
];

function renderList(props: Partial<React.ComponentProps<typeof SemanticOrderList>> = {}) {
  const handlers = {
    onReorder: vi.fn(),
    onRename: vi.fn(),
    onSelect: vi.fn(),
    onDelete: vi.fn(),
    onAssign: vi.fn(),
    assignCount: 0,
    activeId: null,
    disabled: false,
    ...props,
  };
  const utils = render(<SemanticOrderList kind="participant" items={items} {...handlers} />);
  return { ...utils, ...handlers };
}

/** jsdom 的 DataTransfer 不可写,拖拽用例需要自建可存取的替身 */
function makeDataTransfer(): DataTransfer {
  const store = new Map<string, string>();
  return {
    setData: (k: string, v: string) => store.set(k, v),
    getData: (k: string) => store.get(k) ?? '',
    dropEffect: 'none',
    effectAllowed: 'all',
  } as unknown as DataTransfer;
}

describe('SemanticOrderList', () => {
  it('items 为空时什么都不渲染(空态文案由 SemanticPanel 负责)', () => {
    const { container } = renderList({ items: [] });
    expect(container.firstChild).toBeNull();
  });

  it('渲染每行名称 / 归属计数 / 组织标签', () => {
    const { container } = renderList();
    expect(screen.getByText('导演')).toBeInTheDocument();
    expect(screen.getByText('AI 剪辑')).toBeInTheDocument();
    expect(container.querySelector('.mx-order-tag')).toHaveTextContent('制片组');
    expect(container.querySelectorAll('.mx-order-count').length).toBe(2);
  });

  it('count 为 0 的行加 empty 置灰样式', () => {
    const { container } = renderList();
    const rows = container.querySelectorAll('.mx-order-row');
    expect(rows[0].classList.contains('empty')).toBe(false);
    expect(rows[1].classList.contains('empty')).toBe(true);
  });

  it('单击行触发 onSelect', () => {
    const { onSelect } = renderList();
    fireEvent.click(screen.getByText('导演'));
    expect(onSelect).toHaveBeenCalledWith('p1');
  });

  it('双击行进入编辑,回车提交改名', () => {
    const { container, onRename } = renderList();
    fireEvent.doubleClick(screen.getByText('导演'));
    const input = container.querySelector('.mx-order-edit-input') as HTMLInputElement;
    expect(input).not.toBeNull();
    fireEvent.change(input, { target: { value: '总导演' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onRename).toHaveBeenCalledWith('p1', '总导演');
  });

  it('改名为空或与原名相同均不提交', () => {
    const { container, onRename } = renderList();
    fireEvent.doubleClick(screen.getByText('导演'));
    const blank = container.querySelector('.mx-order-edit-input') as HTMLInputElement;
    fireEvent.change(blank, { target: { value: '   ' } });
    fireEvent.keyDown(blank, { key: 'Enter' });
    expect(onRename).not.toHaveBeenCalled();

    fireEvent.doubleClick(screen.getByText('导演'));
    const same = container.querySelector('.mx-order-edit-input') as HTMLInputElement;
    fireEvent.change(same, { target: { value: '导演' } });
    fireEvent.keyDown(same, { key: 'Enter' });
    expect(onRename).not.toHaveBeenCalled();
  });

  it('Escape 取消改名并退出编辑态', () => {
    const { container, onRename } = renderList();
    fireEvent.doubleClick(screen.getByText('导演'));
    const input = container.querySelector('.mx-order-edit-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '改坏了' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onRename).not.toHaveBeenCalled();
    expect(container.querySelector('.mx-order-edit-input')).toBeNull();
  });

  it('「未分配」虚拟行不可改名', () => {
    const { container } = renderList({ items: [{ id: 'none', name: '未分配', count: 1 }] });
    fireEvent.doubleClick(screen.getByText('未分配'));
    expect(container.querySelector('.mx-order-edit-input')).toBeNull();
  });

  it('未选中节点时 ⊕ 批量归属按钮禁用', () => {
    renderList({ assignCount: 0 });
    // 每行都有一个 ⊕,标题相同 → 取第一行那个
    const btn = screen.getAllByTitle('先在画布选中节点(可框选多个)')[0];
    expect(btn).toBeDisabled();
  });

  it('选中若干节点后可批量归属,title 带节点数', () => {
    const { onAssign } = renderList({ assignCount: 3 });
    const btns = screen.getAllByTitle(/把选中的 3 个节点归属到/);
    fireEvent.click(btns[0]);
    expect(onAssign).toHaveBeenCalledWith('p1');
  });

  it('行尾删除按钮:传 onDelete 才渲染', () => {
    const without = renderList({ onDelete: undefined });
    expect(without.container.querySelectorAll('[title="删除"]').length).toBe(0);

    const withDelete = renderList();
    fireEvent.click(withDelete.container.querySelectorAll('[title="删除"]')[0]);
    expect(withDelete.onDelete).toHaveBeenCalledWith('p1');
  });

  it('disabled 时不渲染 ⊕ / ✕ 操作按钮', () => {
    const { container } = renderList({ disabled: true, assignCount: 2 });
    expect(container.querySelectorAll('[title="删除"]').length).toBe(0);
    expect(screen.queryByTitle(/把选中的 2 个节点归属到/)).not.toBeInTheDocument();
    // 名称仍要可见
    expect(screen.getByText('导演')).toBeInTheDocument();
  });

  it('拖拽 handle 到另一行可重排,回调 onReorder(from, to)', () => {
    const { container, onReorder } = renderList();
    const rows = container.querySelectorAll('.mx-order-row');
    const dt = makeDataTransfer();
    fireEvent.dragStart(screen.getAllByTitle(/拖动调整顺序/)[0], { dataTransfer: dt });
    fireEvent.drop(rows[1], { dataTransfer: dt });
    expect(onReorder).toHaveBeenCalledWith(0, 1);
  });

  it('拖到自己身上不触发重排', () => {
    const { container, onReorder } = renderList();
    const rows = container.querySelectorAll('.mx-order-row');
    const dt = makeDataTransfer();
    fireEvent.dragStart(screen.getAllByTitle(/拖动调整顺序/)[0], { dataTransfer: dt });
    fireEvent.drop(rows[0], { dataTransfer: dt });
    expect(onReorder).not.toHaveBeenCalled();
  });

  it('activeId 对应的行高亮(属性栏 ↔ 语义面板联动)', () => {
    const { container } = renderList({ activeId: 'p2' });
    const active = container.querySelector('.mx-order-row.active');
    expect(active).not.toBeNull();
    expect(active).toHaveTextContent('AI 剪辑');
  });
});
