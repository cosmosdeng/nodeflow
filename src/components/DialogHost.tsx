import { useEffect, useState } from 'react';
import { acceptDialog, cancelDialog, getDialogState, subscribeDialog, type DialogRequest } from '../lib/dialog';

/**
 * 全局对话框宿主:挂在 App 根节点,替代原生 alert/confirm。
 * confirm = 确认/取消;alert = 仅「知道了」。
 */
export default function DialogHost() {
  const [req, setReq] = useState<DialogRequest | null>(() => getDialogState()?.request ?? null);

  useEffect(() => subscribeDialog((s) => setReq(s?.request ?? null)), []);

  useEffect(() => {
    if (!req) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancelDialog();
      // 简易 focus trap:Tab 在对话框内循环
      if (e.key === 'Tab') {
        const modal = document.querySelector('.nf-modal');
        if (!modal) return;
        const focusables = modal.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    // 打开后聚焦第一个按钮
    const t = window.setTimeout(() => {
      document.querySelector<HTMLElement>('.nf-modal button')?.focus();
    }, 0);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.clearTimeout(t);
    };
  }, [req]);

  if (!req) return null;
  const isAlert = req.kind === 'alert';

  return (
    <div className="nf-modal-mask" onMouseDown={() => cancelDialog()}>
      <div className="nf-modal" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        {req.title && <div className="nf-modal-title">{req.title}</div>}
        <div className="nf-modal-message">{req.message}</div>
        <div className="nf-modal-actions">
          {!isAlert && (
            <button className="nf-btn" onClick={() => cancelDialog()}>
              {req.cancelLabel ?? '取消'}
            </button>
          )}
          <button className={`nf-btn primary ${req.danger ? 'danger' : ''}`} onClick={() => acceptDialog()}>
            {req.confirmLabel ?? (isAlert ? '知道了' : '确定')}
          </button>
        </div>
      </div>
    </div>
  );
}
