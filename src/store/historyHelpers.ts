/**
 * 历史快照 helper:makeSnapshot / restoreSnapshotFields / 组合标签恢复。
 */
import type { GraphSnapshot } from '../types';
import type { FlowStore } from './types';

export function restoreTabsFromSnapshot(
  s: FlowStore,
  snapshot: Pick<GraphSnapshot, 'nodes' | 'compositeTabs' | 'activeTabId'>,
) {
  const nodeIds = new Set(snapshot.nodes.map((n) => n.id));
  const snapTabs = snapshot.compositeTabs ?? s.compositeTabs;
  // 仅保留仍存在的组合节点标签;对无标签字段的旧快照回退到当前标签并按节点过滤
  const compositeTabs = snapTabs.filter((t) => nodeIds.has(t));
  const snapActive = snapshot.activeTabId ?? s.activeTabId;
  const activeTabId = snapActive === 'main' || compositeTabs.includes(snapActive) ? snapActive : 'main';
  return { compositeTabs, activeTabId };
}

export type SnapshotFields = Pick<
  GraphSnapshot,
  | 'nodes'
  | 'edges'
  | 'viewport'
  | 'annotations'
  | 'stages'
  | 'participants'
  | 'organizations'
  | 'participantOrder'
  | 'participantOrderMode'
  | 'stageOrder'
  | 'arrangePending'
  | 'compositeTabs'
  | 'activeTabId'
  | 'at'
>;

/** 从 store 当前状态提取完整历史快照（单一来源，禁止再手写字段列表） */
export function makeSnapshot(s: SnapshotFields): GraphSnapshot {
  return {
    nodes: s.nodes,
    edges: s.edges,
    viewport: s.viewport,
    annotations: s.annotations,
    stages: s.stages,
    participants: s.participants,
    organizations: s.organizations,
    participantOrder: s.participantOrder,
    participantOrderMode: s.participantOrderMode,
    stageOrder: s.stageOrder,
    arrangePending: s.arrangePending,
    compositeTabs: s.compositeTabs,
    activeTabId: s.activeTabId,
    at: s.at ?? Date.now(),
  };
}

/** 从历史快照恢复字段到 store 切片（与 makeSnapshot 对称） */
export function restoreSnapshotFields(
  s: FlowStore,
  target: GraphSnapshot,
): Pick<
  FlowStore,
  | 'nodes'
  | 'edges'
  | 'viewport'
  | 'annotations'
  | 'stages'
  | 'participants'
  | 'organizations'
  | 'participantOrder'
  | 'participantOrderMode'
  | 'stageOrder'
  | 'arrangePending'
  | 'compositeTabs'
  | 'activeTabId'
> {
  return {
    nodes: target.nodes,
    edges: target.edges,
    viewport: target.viewport,
    annotations: target.annotations ?? [],
    stages: target.stages ?? [],
    participants: target.participants ?? [],
    organizations: target.organizations ?? [],
    participantOrder: target.participantOrder ?? [],
    participantOrderMode: target.participantOrderMode ?? 'auto',
    stageOrder: target.stageOrder ?? [],
    arrangePending: target.arrangePending ?? false,
    ...restoreTabsFromSnapshot(s, target),
  };
}

/** 关闭组合内部画布标签(纯函数),返回需要合并的状态片段 */
export function closeCompositeTabInState(s: FlowStore, id: string) {
  const compositeTabs = s.compositeTabs.filter((t) => t !== id);
  return {
    compositeTabs,
    activeTabId:
      s.activeTabId === id ? (compositeTabs.length ? compositeTabs[compositeTabs.length - 1] : 'main') : s.activeTabId,
  };
}
