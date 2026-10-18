/**
 * Zustand 全局 Store composer。
 * 状态初始值 + 各领域 action 切片组合;syncActiveDoc 保证活动文档镜像一致。
 * 业务实现见 types / persistence / compositeHelpers / historyHelpers / slices/*。
 */
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { shallow } from 'zustand/shallow';

import type { FlowStore, Selection, AutoEditTarget } from './types';
import { seedGraph, prefs, initialDocs, initialActiveDoc } from './persistence';
import { graphObservableFingerprint } from './agentRevision';
import { createFlowSlice } from './slices/flow';
import { createHistorySlice } from './slices/history';
import { createNodesSlice } from './slices/nodes';
import { createStructureSlice } from './slices/structure';
import { createEdgesSlice } from './slices/edges';
import { createDocumentsSlice } from './slices/documents';
import { createCompositeSlice } from './slices/composite';

export type { Selection, AutoEditTarget, FlowStore };

const SAVE_DELAY = 600;

/** 活动文档镜像字段:这些顶层字段始终与 documents[activeDocumentId] 保持一致 */
const MIRROR_FIELDS = [
  'nodes',
  'edges',
  'viewport',
  'annotations',
  'stages',
  'participants',
  'organizations',
  'participantOrder',
  'participantOrderMode',
  'stageOrder',
  'arrangePending',
  'compositeTabs',
  'activeTabId',
  'past',
  'future',
  'lastSavedAt',
  'dirty',
] as const;

/**
 * 把活动文档镜像字段同步回 documents 中的活动文档。
 * 仅在字段引用实际变化时写入,避免每次 set 全量重写 documents。
 */
function syncActiveDoc(get: () => FlowStore, rawSet: (p: unknown) => void) {
  const s = get();
  const docId = s.activeDocumentId;
  const doc = s.documents.find((d) => d.id === docId);
  if (!doc) return;

  // 仅收集引用变化的字段
  const updates: Record<string, unknown> = {};
  let changed = false;
  for (const field of MIRROR_FIELDS) {
    if (doc[field] !== s[field]) {
      updates[field] = s[field];
      changed = true;
    }
  }
  if (!changed) return;

  (rawSet as (fn: (state: FlowStore) => Partial<FlowStore>) => void)((state: FlowStore) => ({
    documents: state.documents.map((d) => (d.id === docId ? { ...d, ...updates } : d)),
  }));
}

export const useGraphStore = create<FlowStore>()(
  subscribeWithSelector((rawSet, get) => {
    // 包装 set:每次修改活动文档镜像字段后,同步回 documents。
    const set: typeof rawSet = (partial) => {
      rawSet(partial as never);
      syncActiveDoc(get, rawSet as unknown as (p: unknown) => void);
    };
    const deps = { set, get };
    return {
      documents: initialDocs.docs,
      activeDocumentId: initialDocs.activeId,
      nodes: initialActiveDoc?.nodes ?? seedGraph.nodes,
      edges: initialActiveDoc?.edges ?? seedGraph.edges,
      viewport: initialActiveDoc?.viewport ?? seedGraph.viewport,
      annotations: initialActiveDoc?.annotations ?? [],
      stages: initialActiveDoc?.stages ?? [],
      participants: initialActiveDoc?.participants ?? [],
      organizations: initialActiveDoc?.organizations ?? [],
      participantOrder:
        initialActiveDoc?.participantOrder ??
        (initialActiveDoc?.participants ? initialActiveDoc.participants.map((p) => p.id) : []),
      participantOrderMode: initialActiveDoc?.participantOrderMode ?? 'auto',
      stageOrder:
        initialActiveDoc?.stageOrder ?? (initialActiveDoc?.stages ? initialActiveDoc.stages.map((st) => st.id) : []),
      arrangePending: initialActiveDoc?.arrangePending ?? false,
      arrangePendingKind: undefined,
      showStageBands: true,
      showParticipantBands: true,
      reassignHighlight: null,
      agentRevision: 0,
      swimlaneEnabled: false,
      swimlaneOrder: [],
      stageFlashId: null,
      loadError: null,
      annotAutoEditId: null,
      semanticFocus: null,
      past: initialActiveDoc?.past ?? [],
      future: initialActiveDoc?.future ?? [],
      selected: null,
      pendingAutoEdit: null,
      clipboard: null,
      lastSavedAt: initialActiveDoc?.lastSavedAt ?? null,
      dirty: false,
      edgeStyle: prefs?.edgeStyle ?? 'smoothstep',
      theme: prefs?.theme ?? 'dark',
      layoutDirection: 'horizontal',
      compositeTabs: initialActiveDoc?.compositeTabs ?? [],
      activeTabId: initialActiveDoc?.activeTabId ?? 'main',
      allLocked: false,

      ...createFlowSlice(deps),
      ...createHistorySlice(deps),
      ...createNodesSlice(deps),
      ...createStructureSlice(deps),
      ...createEdgesSlice(deps),
      ...createDocumentsSlice(deps),
      ...createCompositeSlice(deps),
    } as FlowStore;
  }),
);

/* ------------------------------------------------------------------ */
/* 自动保存:订阅 nodes/edges/viewport 变化,防抖后写盘                    */
/* ------------------------------------------------------------------ */
let saveTimer: ReturnType<typeof setTimeout> | undefined;
useGraphStore.subscribe(
  (s) => ({ nodes: s.nodes, edges: s.edges, viewport: s.viewport, annotations: s.annotations }),
  () => {
    useGraphStore.setState((s) => ({
      dirty: true,
      documents: s.documents.map((d) => (d.id === s.activeDocumentId ? { ...d, dirty: true } : d)),
    }));
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      useGraphStore.getState().saveNow();
    }, SAVE_DELAY);
  },
  { equalityFn: shallow },
);

/* ------------------------------------------------------------------ */
/* agentRevision 指纹订阅                                               */
/* ------------------------------------------------------------------ */
let graphFpPrev: string | null = null;
useGraphStore.subscribe(
  (s) => graphObservableFingerprint(s),
  (fp: string) => {
    if (graphFpPrev === null) {
      graphFpPrev = fp;
      return;
    }
    if (fp !== graphFpPrev) {
      graphFpPrev = fp;
      useGraphStore.getState().bumpAgentRevision();
    }
  },
);
