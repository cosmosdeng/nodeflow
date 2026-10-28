import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import ConfirmDialog, { type ConfirmDialogState } from '../ConfirmDialog';
import DialogHost from '../DialogHost';
import { alertDialogAsync, cancelDialog, confirmDialogAsync, getDialogState } from '../../lib/dialog';

describe('ConfirmDialog', () => {
  it('dialog 为 null 时不渲染', () => {
    const { container } = render(<ConfirmDialog dialog={null} onClose={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('渲染标题 / 消息 / 默认按钮文案', () => {
    const dialog: ConfirmDialogState = {
      title: '删除确认',
      message: '确定删除该节点?',
      onConfirm: vi.fn(),
    };
    render(<ConfirmDialog dialog={dialog} onClose={vi.fn()} />);
    expect(screen.getByText('删除确认')).toBeInTheDocument();
    expect(screen.getByText('确定删除该节点?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '取消' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '确定' })).toBeInTheDocument();
  });

  it('无 title 时不渲染标题元素', () => {
    const dialog: ConfirmDialogState = { message: 'msg', onConfirm: vi.fn() };
    const { container } = render(<ConfirmDialog dialog={dialog} onClose={vi.fn()} />);
    expect(container.querySelector('.nf-modal-title')).toBeNull();
  });

  it('自定义按钮文案与 danger 样式', () => {
    const dialog: ConfirmDialogState = {
      message: 'msg',
      confirmLabel: '删除',
      cancelLabel: '再想想',
      danger: true,
      onConfirm: vi.fn(),
    };
    render(<ConfirmDialog dialog={dialog} onClose={vi.fn()} />);
    const ok = screen.getByRole('button', { name: '删除' });
    expect(ok).toHaveClass('danger');
    expect(screen.getByRole('button', { name: '再想想' })).toBeInTheDocument();
  });

  it('点击确认:先关闭对话框再执行 onConfirm', () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    const dialog: ConfirmDialogState = { message: 'msg', onConfirm };
    render(<ConfirmDialog dialog={dialog} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: '确定' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onClose.mock.invocationCallOrder[0]).toBeLessThan(onConfirm.mock.invocationCallOrder[0]);
  });

  it('点击取消:先执行 onCancel 再关闭', () => {
    const onClose = vi.fn();
    const onCancel = vi.fn();
    const dialog: ConfirmDialogState = { message: 'msg', onConfirm: vi.fn(), onCancel };
    render(<ConfirmDialog dialog={dialog} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onCancel.mock.invocationCallOrder[0]).toBeLessThan(onClose.mock.invocationCallOrder[0]);
  });

  it('点击遮罩视为取消', () => {
    const onCancel = vi.fn();
    const dialog: ConfirmDialogState = { message: 'msg', onConfirm: vi.fn(), onCancel };
    const { container } = render(<ConfirmDialog dialog={dialog} onClose={vi.fn()} />);
    fireEvent.mouseDown(container.querySelector('.nf-modal-mask')!);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('按 Escape 视为取消', () => {
    const onCancel = vi.fn();
    const dialog: ConfirmDialogState = { message: 'msg', onConfirm: vi.fn(), onCancel };
    render(<ConfirmDialog dialog={dialog} onClose={vi.fn()} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe('DialogHost + dialog.ts', () => {
  // dialog.ts 是模块级单例:用例之间必须清干净,否则上一个未 settle 的 Promise 会被覆盖卡住
  beforeEach(() => {
    cancelDialog();
  });

  it('confirmDialogAsync 弹出对话框,点确认后 Promise resolve 为 true', async () => {
    render(<DialogHost />);
    expect(getDialogState()).toBeNull();

    const p = confirmDialogAsync('确定删除?', { title: '删除确认', confirmLabel: '删除' });
    await screen.findByText('确定删除?');
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '删除' }));
    });
    await expect(p).resolves.toBe(true);
    expect(getDialogState()).toBeNull();
  });

  it('点取消后 Promise resolve 为 false', async () => {
    render(<DialogHost />);
    const p = confirmDialogAsync('确定删除?');
    await screen.findByText('确定删除?');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '取消' }));
    });
    await expect(p).resolves.toBe(false);
  });

  it('alert 对话框不渲染取消按钮', async () => {
    render(<DialogHost />);
    act(() => {
      void alertDialogAsync('这是一条提示', { title: '提示' });
    });
    await screen.findByText('这是一条提示');
    expect(screen.queryByRole('button', { name: '取消' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '知道了' })).toBeInTheDocument();
  });

  it('alert 对话框确认后 Promise 完成', async () => {
    render(<DialogHost />);
    const p = alertDialogAsync('操作完成');
    await screen.findByText('操作完成');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '知道了' }));
    });
    await expect(p).resolves.toBeUndefined();
  });

  it('danger 确认框带 danger 样式', async () => {
    render(<DialogHost />);
    void confirmDialogAsync('清空画布?', { danger: true, confirmLabel: '清空' });
    await screen.findByText('清空画布?');
    expect(screen.getByRole('button', { name: '清空' })).toHaveClass('danger');
  });
});
