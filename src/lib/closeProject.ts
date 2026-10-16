import type { GraphDocument } from '../types';
import { alertDialogAsync, confirmDialogAsync } from './dialog';

/**
 * 关闭项目前的确认:若项目有未保存修改(dirty),提示用户保存,得到确认后执行关闭。
 * - 想要保存:保存后再关闭
 * - 不保存:再次确认放弃修改,然后关闭
 * - 取消:不关闭
 * - 若未 dirty:直接关闭
 */
export async function confirmAndCloseDocument(
  doc: Pick<GraphDocument, 'id' | 'name' | 'dirty'>,
  closeDocument: (id: string) => void,
  saveDocument: (id: string) => void,
): Promise<void> {
  if (doc.dirty) {
    const wantSave = await confirmDialogAsync(`项目「${doc.name}」有未保存的修改,是否先保存?`, {
      title: '未保存的修改',
      confirmLabel: '保存并关闭',
      cancelLabel: '取消',
    });
    if (wantSave) {
      saveDocument(doc.id);
      closeDocument(doc.id);
      return;
    }
    const discard = await confirmDialogAsync(`确定放弃未保存的修改并关闭项目「${doc.name}」?`, {
      title: '放弃修改',
      confirmLabel: '放弃并关闭',
      danger: true,
    });
    if (!discard) return;
  }
  closeDocument(doc.id);
}

export { alertDialogAsync, confirmDialogAsync };
