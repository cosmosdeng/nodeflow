import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import ContextMenu, { type ContextMenuItem, type ContextMenuState } from '../ContextMenu';

function renderMenu(items: ContextMenuItem[], onClose = vi.fn()) {
  const menu: ContextMenuState = { x: 100, y: 80, items };
  return render(<ContextMenu menu={menu} onClose={onClose} />);
}

describe('ContextMenu', () => {
  it('menu 为 null 时不渲染', () => {
    const { container } = render(<ContextMenu menu={null} onClose={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('渲染菜单项文本,并把 hint 作为 title', () => {
    renderMenu([{ label: '复制', hint: 'Ctrl+C' }, { label: '删除节点' }]);
    expect(screen.getByText('复制')).toHaveAttribute('title', 'Ctrl+C');
    expect(screen.getByText('删除节点')).toBeInTheDocument();
  });

  it('label 为 --- 渲染成分隔符(不是按钮)', () => {
    const { container } = renderMenu([{ label: '复制' }, { label: '---' }, { label: '删除节点' }]);
    expect(container.querySelector('.nf-context-divider')).not.toBeNull();
    expect(screen.getAllByRole('button').length).toBe(2);
  });

  it('点击菜单项:先关闭菜单再执行 onClick', () => {
    const onClose = vi.fn();
    const onClick = vi.fn();
    renderMenu([{ label: '删除节点', onClick }], onClose);
    fireEvent.click(screen.getByText('删除节点'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClick).toHaveBeenCalledTimes(1);
    // 关闭必须发生在动作之前
    expect(onClose.mock.invocationCallOrder[0]).toBeLessThan(onClick.mock.invocationCallOrder[0]);
  });

  it('disabled 菜单项不可点击', () => {
    const onClick = vi.fn();
    renderMenu([{ label: '组合节点', disabled: true, onClick }]);
    const btn = screen.getByText('组合节点');
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('danger 菜单项追加 danger 样式', () => {
    renderMenu([{ label: '清空画布', danger: true }]);
    expect(screen.getByText('清空画布')).toHaveClass('danger');
  });

  it('按 Escape 关闭菜单', () => {
    const onClose = vi.fn();
    renderMenu([{ label: '复制' }], onClose);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('点击画布别处(pointerdown)关闭菜单', () => {
    const onClose = vi.fn();
    renderMenu([{ label: '复制' }], onClose);
    fireEvent.pointerDown(window);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('点击菜单自身内部不会被误判为「点击别处」', () => {
    const onClose = vi.fn();
    const { container } = renderMenu([{ label: '复制' }], onClose);
    // 菜单根的 pointerdown 会 stopPropagation,不应触发 window 上的关闭监听
    fireEvent.pointerDown(container.querySelector('.nf-context-menu')!);
    expect(onClose).not.toHaveBeenCalled();
  });
});
