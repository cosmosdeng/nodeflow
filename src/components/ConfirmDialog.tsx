import { useEffect } from 'react';

export interface ConfirmDialogState {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  /** 取消 / 遮罩点击 / Esc 时调用(用于 Promise 确认等场景) */
  onCancel?: () => void;
}

interface Props {
  dialog: ConfirmDialogState | null;
  onClose: () => void;
}

/**
 * 通用确认对话框(模态遮罩 + 确认/取消)。
 * 确认后执行 onConfirm 并关闭;取消 / 遮罩点击 / Esc 关闭。
 */
export default function ConfirmDialog({ dialog, onClose }: Props) {
  const cancel = () => {
    dialog?.onCancel?.();
    onClose();
  };

  useEffect(() => {
    if (!dialog) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialog]);

  if (!dialog) return null;

  return (
    <div className="nf-modal-mask" onMouseDown={cancel}>
      <div
        className="nf-modal"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {dialog.title && <div className="nf-modal-title">{dialog.title}</div>}
        <div className="nf-modal-message">{dialog.message}</div>
        <div className="nf-modal-actions">
          <button className="nf-btn" onClick={cancel}>
            {dialog.cancelLabel ?? '取消'}
          </button>
          <button
            className={`nf-btn primary ${dialog.danger ? 'danger' : ''}`}
            onClick={() => {
              onClose();
              dialog.onConfirm();
            }}
          >
            {dialog.confirmLabel ?? '确定'}
          </button>
        </div>
      </div>
    </div>
  );
}