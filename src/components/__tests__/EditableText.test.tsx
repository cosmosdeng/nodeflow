import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import EditableText from '../EditableText';

describe('EditableText', () => {
  it('渲染出当前值', () => {
    render(<EditableText value="节点标题" onCommit={() => {}} />);
    expect(screen.getByRole('textbox')).toHaveTextContent('节点标题');
  });

  it('双击进入编辑态(可编辑),单击不进入', () => {
    render(<EditableText value="标题" onCommit={() => {}} />);
    const el = screen.getByRole('textbox');
    // 初始只读(不可编辑)
    expect(el).not.toHaveAttribute('contenteditable', 'true');
    fireEvent.doubleClick(el);
    expect(el).toHaveAttribute('contenteditable', 'true');
  });

  it('编辑后回车提交新值', () => {
    const onCommit = vi.fn();
    render(<EditableText value="旧值" onCommit={onCommit} />);
    const el = screen.getByRole('textbox');
    fireEvent.doubleClick(el);
    el.innerText = '新值';
    fireEvent.keyDown(el, { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledWith('新值');
  });

  it('Esc 取消编辑:不提交并还原原值', () => {
    const onCommit = vi.fn();
    render(<EditableText value="原值" onCommit={onCommit} />);
    const el = screen.getByRole('textbox');
    fireEvent.doubleClick(el);
    el.innerText = '临时改动';
    fireEvent.keyDown(el, { key: 'Escape' });
    expect(onCommit).not.toHaveBeenCalled();
    expect(el).toHaveTextContent('原值');
  });

  it('值未变化时回车不触发提交', () => {
    const onCommit = vi.fn();
    render(<EditableText value="相同" onCommit={onCommit} />);
    const el = screen.getByRole('textbox');
    fireEvent.doubleClick(el);
    el.innerText = '相同';
    fireEvent.keyDown(el, { key: 'Enter' });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('disabled 时不可编辑,双击也不进入编辑态', () => {
    render(<EditableText value="锁定" onCommit={() => {}} disabled />);
    const el = screen.getByRole('textbox');
    fireEvent.doubleClick(el);
    expect(el).not.toHaveAttribute('contenteditable', 'true');
  });

  it('autoFocus 挂载后自动进入编辑态并回调消耗标记', () => {
    const onAutoFocusConsumed = vi.fn();
    render(<EditableText value="" onCommit={() => {}} autoFocus onAutoFocusConsumed={onAutoFocusConsumed} />);
    expect(screen.getByRole('textbox')).toHaveAttribute('contenteditable', 'true');
    expect(onAutoFocusConsumed).toHaveBeenCalledTimes(1);
  });

  it('进入/退出编辑态通知外部(供节点临时禁用拖拽)', () => {
    const onEditingChange = vi.fn();
    render(<EditableText value="标题" onCommit={() => {}} onEditingChange={onEditingChange} />);
    const el = screen.getByRole('textbox');
    fireEvent.doubleClick(el);
    expect(onEditingChange).toHaveBeenLastCalledWith(true);
    fireEvent.blur(el);
    expect(onEditingChange).toHaveBeenLastCalledWith(false);
  });

  it('外部值变化时同步到 DOM(不受控 contentEditable 需手动同步)', () => {
    const { rerender } = render(<EditableText value="A" onCommit={() => {}} />);
    rerender(<EditableText value="B" onCommit={() => {}} />);
    expect(screen.getByRole('textbox')).toHaveTextContent('B');
  });
});
