/**
 * 跨 action 的运行时标志(不进 store state,不持久化)。
 */
/**
 * 标记「删除连线」是否已由 onEdgesChange 记录历史。
 * React Flow 删除节点时先 triggerEdgeChanges 再 triggerNodeChanges,
 * onEdgesChange 已记录「删除前含连线」快照,onNodesChange 据此跳过重复记录。
 */
export let edgeDeleteHistoryPending = false;

export function setEdgeDeleteHistoryPending(v: boolean): void {
  edgeDeleteHistoryPending = v;
}

export function getEdgeDeleteHistoryPending(): boolean {
  return edgeDeleteHistoryPending;
}

/**
 * 键盘微调(nudge)最近一次移动的时间戳。
 * 连续方向键在合并窗口内只记录一次历史,使「按住微调」可被一次 Undo 完整还原。
 */
export let lastNudgeAt = 0;

export function setLastNudgeAt(v: number): void {
  lastNudgeAt = v;
}

export function getLastNudgeAt(): number {
  return lastNudgeAt;
}
