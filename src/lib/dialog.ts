/**
 * 全局对话框服务:Promise 化 confirm/alert,UI 由 DialogHost 渲染。
 * 可在非 React 模块(closeProject 等)直接调用,统一视觉与主题。
 */
export interface DialogRequest {
  kind: 'confirm' | 'alert';
  message: string;
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

type Resolver = (ok: boolean) => void;

interface DialogState {
  request: DialogRequest;
  resolve: Resolver;
}

let current: DialogState | null = null;
const listeners = new Set<(s: DialogState | null) => void>();

function emit(): void {
  for (const fn of listeners) fn(current);
}

export function subscribeDialog(fn: (s: DialogState | null) => void): () => void {
  listeners.add(fn);
  fn(current);
  return () => listeners.delete(fn);
}

export function getDialogState(): DialogState | null {
  return current;
}

/** 用户点确认 */
export function acceptDialog(): void {
  if (!current) return;
  const { resolve } = current;
  current = null;
  emit();
  resolve(true);
}

/** 用户点取消 / 遮罩 / Esc */
export function cancelDialog(): void {
  if (!current) return;
  const { resolve, request } = current;
  current = null;
  emit();
  resolve(request.kind === 'alert');
}

export function confirmDialogAsync(
  message: string,
  opts: Omit<DialogRequest, 'kind' | 'message'> = {},
): Promise<boolean> {
  return new Promise((resolve) => {
    current = { request: { kind: 'confirm', message, ...opts }, resolve };
    emit();
  });
}

export function alertDialogAsync(message: string, opts: Omit<DialogRequest, 'kind' | 'message'> = {}): Promise<void> {
  return new Promise((resolve) => {
    current = {
      request: { kind: 'alert', message, confirmLabel: opts.confirmLabel ?? '知道了', ...opts },
      resolve: () => resolve(),
    };
    emit();
  });
}
