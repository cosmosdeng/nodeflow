import type { GraphDocument } from '../types';

/**
 * 关闭项目前的确认:若项目有未保存修改(dirty),提示用户保存,得到确认后执行关闭。
 * - 想要保存:保存后再关闭
 * - 不保存:再次确认放弃修改,然后关闭
 * - 取消:不关闭
 * - 若未 dirty:直接关闭
 */
export function confirmAndCloseDocument(
  doc: Pick<GraphDocument, 'id' | 'name' | 'dirty'>,
  closeDocument: (id: string) => void,
  saveDocument: (id: string) => void,
) {
  if (doc.dirty) {
    const wantSave = confirm(`项目「${doc.name}」有未保存的修改,是否先保存?`);
    if (wantSave) {
      saveDocument(doc.id);
      closeDocument(doc.id);
      return;
    }
    if (!confirm(`确定放弃未保存的修改并关闭项目「${doc.name}」?`)) {
      return;
    }
  }
  closeDocument(doc.id);
}
