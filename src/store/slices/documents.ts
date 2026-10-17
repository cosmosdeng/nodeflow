import type {
  FlowNode,
  FlowEdge,
  GraphSnapshot,
  GraphDocument,
  ViewportState,
  Artifact,
  FlowNodeData,
  FlowEdgeData,
  Annotation,
  Stage,
  Participant,
  Organization,
  ParticipantOrderMode,
} from '../../types';
import type { FlowStore } from '../types';
import type { SliceDeps } from './deps';
import {
  buildProjectDocumentV5,
  detectDocumentFormat,
  extractOrganizations,
  extractParticipants,
  futureVersionMessage,
  importLegacyExportToDocument,
  migrateProjectV2ToDocument,
  migrateProjectV3ToDocument,
  migrateProjectV4ToDocument,
  pickGraphNodesEdges,
  resolveArrangePending,
  resolveParticipantOrder,
  resolveStageOrder,
  validateDocumentData,
  type NormalizedDocument,
} from '../../lib/document';
import { validateGraph } from '../../lib/graphValidation';
import { DOCUMENT_COLORS, createDefaultNode, uid } from '../../types';
import {
  loadSaved,
  persistDocument,
  loadPersistedDocument,
  loadDocsIndex,
  persistDocsIndex,
  docKey,
  seedGraph,
} from '../persistence';
import { collapseComposite, expandComposite, refreshCompositeHidden, buildNodesById } from '../compositeHelpers';
import { closeCompositeTabInState } from '../historyHelpers';
import {
  applyCompositeBoxes,
  computeCompositeBounds,
  computeCompositeActor,
  computeCompositePorts,
  encodeCompositePort,
  decodeCompositePort,
  decodeCompositePortPath,
  findParentCompositeId,
  getNodeSize,
  isCompositePort,
  COMPOSITE_PAD,
  COMPOSITE_PREFIX,
} from '../../lib/composite';
import { findNodeById, findEdgeById } from '../../domain/graph/queries';

export function createDocumentsSlice({ set, get }: SliceDeps): Partial<FlowStore> {
  return {
    fitGraph: () => set({ selected: null }),

    clearGraph: () => {
      if (get().allLocked) return;
      get().markHistory();
      set({
        nodes: [],
        edges: [],
        annotations: [],
        stages: [],
        participants: [],
        organizations: [],
        participantOrder: [],
        participantOrderMode: 'auto',
        stageOrder: [],
        arrangePending: false,
        compositeTabs: [],
        activeTabId: 'main',
      });
    },

    loadGraph: (data) => {
      if (get().allLocked) return;
      get().markHistory();
      const semantic = validateGraph({
        nodes: data.nodes,
        edges: data.edges,
        stages: data.stages,
        annotations: data.annotations,
      });
      if (!semantic.valid) {
        console.warn(
          '[loadGraph] 图语义校验未通过:',
          semantic.issues.filter((i) => i.severity === 'error').map((i) => i.message),
        );
      }
      set({
        nodes: data.nodes,
        edges: data.edges,
        viewport: data.viewport,
        annotations: data.annotations ?? [],
        stages: data.stages ?? [],
        participants: data.participants ?? [],
        organizations: data.organizations ?? [],
        participantOrder: [],
        participantOrderMode: 'auto',
        stageOrder: [],
        arrangePending: false,
        selected: null,
        compositeTabs: [],
        activeTabId: 'main',
      });
    },

    newDocument: () => {
      if (get().allLocked) return;
      get().markHistory();
      set({
        nodes: [],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        annotations: [],
        stages: [],
        participants: [],
        organizations: [],
        selected: null,
        compositeTabs: [],
        activeTabId: 'main',
      });
    },

    saveNow: () => {
      const s = get();
      const doc = s.documents.find((d) => d.id === s.activeDocumentId);
      if (!doc) return;
      persistDocument(doc);
      const idx = loadDocsIndex() ?? { docs: [], activeId: s.activeDocumentId };
      persistDocsIndex({
        docs: idx.docs.map((m) => (m.id === s.activeDocumentId ? { ...m, lastSavedAt: Date.now() } : m)),
        activeId: s.activeDocumentId,
      });
      set({ lastSavedAt: Date.now(), dirty: false });
    },

    saveDocument: (id) => {
      const s = get();
      const doc = s.documents.find((d) => d.id === id);
      if (!doc) return;
      persistDocument(doc);
      const idx = loadDocsIndex() ?? { docs: [], activeId: id };
      persistDocsIndex({
        docs: idx.docs.map((m) => (m.id === id ? { ...m, lastSavedAt: Date.now() } : m)),
        activeId: idx.activeId,
      });
      // 同步更新内存中该文档的 dirty/lastSavedAt
      set((state) => ({
        documents: state.documents.map((d) => (d.id === id ? { ...d, dirty: false, lastSavedAt: Date.now() } : d)),
        // 如果是当前活动文档,同步顶层镜像
        ...(state.activeDocumentId === id ? { dirty: false, lastSavedAt: Date.now() } : {}),
      }));
    },

    exportJson: () => {
      const { nodes, edges, viewport, annotations, stages } = get();
      return JSON.stringify(
        { version: 1, exportedAt: new Date().toISOString(), nodes, edges, viewport, annotations, stages },
        null,
        2,
      );
    },

    serializeProject: () => {
      const s = get();
      const name = s.documents.find((d) => d.id === s.activeDocumentId)?.name ?? '未命名项目';
      const color = s.documents.find((d) => d.id === s.activeDocumentId)?.color ?? '#4ea1ff';
      // 正式 Project Format v5:剥离历史/脏标记/React Flow 运行时字段;含 participants/organizations 与
      // participantOrder / participantOrderMode / stageOrder(顺序持久化单一事实来源)
      const document = buildProjectDocumentV5({
        name,
        color,
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
      });
      return JSON.stringify(
        { format: 'nodeflow', version: 5, exportedAt: new Date().toISOString(), document },
        null,
        2,
      );
    },

    loadProject: (json) => {
      if (get().allLocked) return false;
      let doc: GraphDocument;
      try {
        const data = JSON.parse(json) as unknown;
        const info = detectDocumentFormat(data);
        // Future Version Gate:安全拒绝
        if (info.future) {
          set({ loadError: futureVersionMessage(info) });
          return false;
        }
        // Unknown 格式:安全拒绝
        if (info.family === 'unknown') {
          set({ loadError: '无法识别的文件格式,请确认是 NodeFlow 保存的项目文件。' });
          return false;
        }
        // 按格式族 + 版本分流,得到标准化文档图数据
        let norm: NormalizedDocument;
        let name: string;
        let color: string;
        if (info.family === 'export') {
          norm = importLegacyExportToDocument(data);
          name = '导入项目';
          color = DOCUMENT_COLORS[get().documents.length % DOCUMENT_COLORS.length];
        } else if (info.legacy && info.version === 3) {
          // Legacy Project v3:迁移到 v4(v3 无 participants/organizations)
          norm = migrateProjectV3ToDocument(data);
          const document = (data as Record<string, unknown> | undefined)?.document ?? {};
          const d = document as Record<string, unknown>;
          name = typeof d.name === 'string' ? d.name : '未命名项目';
          color =
            typeof d.color === 'string' ? d.color : DOCUMENT_COLORS[get().documents.length % DOCUMENT_COLORS.length];
        } else if (info.legacy && info.version === 4) {
          // Legacy Project v4:迁移到 v5(仅 schema 转换,不改写 membership/participantId;
          // participant/stage order 由下方 resolveParticipantOrder/resolveStageOrder 补默认)
          norm = migrateProjectV4ToDocument(data);
          const document = (data as Record<string, unknown> | undefined)?.document ?? {};
          const d = document as Record<string, unknown>;
          name = typeof d.name === 'string' ? d.name : '未命名项目';
          color =
            typeof d.color === 'string' ? d.color : DOCUMENT_COLORS[get().documents.length % DOCUMENT_COLORS.length];
        } else if (info.legacy) {
          // Legacy Project v2
          norm = migrateProjectV2ToDocument(data);
          const project = (data as Record<string, unknown> | undefined)?.project ?? {};
          const p = project as Record<string, unknown>;
          name = typeof p.name === 'string' ? p.name : '未命名项目';
          color =
            typeof p.color === 'string' ? p.color : DOCUMENT_COLORS[get().documents.length % DOCUMENT_COLORS.length];
        } else {
          // Current Project v3
          const document = (data as Record<string, unknown> | undefined)?.document ?? {};
          const d = document as Record<string, unknown>;
          const graph = (d.graph ?? {}) as Record<string, unknown>;
          const editor = (d.editor ?? {}) as Record<string, unknown>;
          const { nodes, edges } = pickGraphNodesEdges(graph);
          norm = {
            nodes,
            edges,
            viewport: (editor.viewport as ViewportState) ?? { x: 0, y: 0, zoom: 1 },
            annotations: Array.isArray(graph.annotations) ? graph.annotations : [],
            stages: Array.isArray(graph.stages) ? graph.stages : [],
            compositeTabs: Array.isArray(editor.compositeTabs) ? editor.compositeTabs : [],
            activeTabId: typeof editor.activeTabId === 'string' ? editor.activeTabId : 'main',
          };
          name = typeof d.name === 'string' ? d.name : '未命名项目';
          color =
            typeof d.color === 'string' ? d.color : DOCUMENT_COLORS[get().documents.length % DOCUMENT_COLORS.length];
        }
        // Current Validation:标准化后确保结构可安全进入 Runtime
        const issues = validateDocumentData(norm);
        if (issues.length > 0) {
          set({ loadError: `项目文件结构无效:${issues.map((i) => i.field).join(', ')}。` });
          return false;
        }
        // 语义校验:只告警不阻断(重复 ID / 悬空连线 / 组合端口异常等)
        const semantic = validateGraph({
          nodes: norm.nodes,
          edges: norm.edges,
          stages: norm.stages,
          annotations: norm.annotations,
        });
        if (!semantic.valid) {
          console.warn(
            '[loadProject] 图语义校验未通过:',
            semantic.issues.filter((i) => i.severity === 'error').map((i) => i.message),
          );
        }
        const participantsArr = extractParticipants(data) as Participant[];
        const organizationsArr = extractOrganizations(data) as Organization[];
        // Participant/Stage Order:解析 v5 字段或按旧格式补默认(participant=实体顺序 auto;stage=旧 x 排序)
        const { order: participantOrder, mode: participantOrderMode } = resolveParticipantOrder(data, participantsArr);
        const stageOrder = resolveStageOrder(data, norm.stages);
        const arrangePending = resolveArrangePending(data);
        doc = {
          id: uid('doc'),
          name,
          color,
          nodes: norm.nodes,
          edges: norm.edges,
          viewport: norm.viewport,
          annotations: norm.annotations,
          stages: norm.stages,
          participants: participantsArr,
          organizations: organizationsArr,
          participantOrder,
          participantOrderMode,
          stageOrder,
          arrangePending,
          compositeTabs: norm.compositeTabs,
          activeTabId: norm.activeTabId,
          past: [],
          future: [],
          lastSavedAt: null,
          dirty: false,
        };
      } catch {
        set({ loadError: '无法解析项目文件,请确认是有效的 NodeFlow 项目文件。' });
        return false;
      }
      set({ loadError: null });
      set((s) => ({
        documents: [...s.documents, doc],
        activeDocumentId: doc.id,
        nodes: doc.nodes,
        edges: doc.edges,
        viewport: doc.viewport,
        annotations: doc.annotations,
        stages: doc.stages,
        participants: doc.participants,
        organizations: doc.organizations,
        participantOrder: doc.participantOrder,
        participantOrderMode: doc.participantOrderMode,
        stageOrder: doc.stageOrder,
        arrangePending: doc.arrangePending,
        compositeTabs: doc.compositeTabs,
        activeTabId: doc.activeTabId,
        past: doc.past,
        future: doc.future,
        lastSavedAt: doc.lastSavedAt,
        dirty: false,
        selected: null,
      }));
      const idx = loadDocsIndex() ?? { docs: [], activeId: doc.id };
      persistDocsIndex({
        docs: [...idx.docs, { id: doc.id, name: doc.name, color: doc.color, lastSavedAt: null }],
        activeId: doc.id,
      });
      return true;
    },

    // ---- 多文档管理 ----
    createDocument: (name) => {
      const id = uid('doc');
      const color = DOCUMENT_COLORS[get().documents.length % DOCUMENT_COLORS.length];
      const doc: GraphDocument = {
        id,
        name: name ?? `未命名项目 ${get().documents.length + 1}`,
        color,
        nodes: [],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        annotations: [],
        stages: [],
        participants: [],
        organizations: [],
        participantOrder: [],
        participantOrderMode: 'auto',
        stageOrder: [],
        arrangePending: false,
        compositeTabs: [],
        activeTabId: 'main',
        past: [],
        future: [],
        lastSavedAt: null,
        dirty: false,
      };
      set((s) => ({
        documents: [...s.documents, doc],
        activeDocumentId: id,
        nodes: [],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        annotations: [],
        stages: [],
        participants: [],
        organizations: [],
        participantOrder: [],
        participantOrderMode: 'auto',
        stageOrder: [],
        arrangePending: false,
        compositeTabs: [],
        activeTabId: 'main',
        past: [],
        future: [],
        lastSavedAt: null,
        dirty: false,
        selected: null,
      }));
      const idx = loadDocsIndex() ?? { docs: [], activeId: id };
      persistDocsIndex({
        docs: [...idx.docs, { id, name: doc.name, color: doc.color, lastSavedAt: null }],
        activeId: id,
      });
      return id;
    },
    switchDocument: (id) => {
      const target = get().documents.find((d) => d.id === id);
      if (!target) return;
      // 先把当前活动文档写入 localStorage(同步镜像已由 set 自动完成)
      get().saveNow();
      set({
        activeDocumentId: id,
        nodes: target.nodes,
        edges: target.edges,
        viewport: target.viewport,
        annotations: target.annotations,
        stages: target.stages,
        participants: target.participants ?? [],
        organizations: target.organizations ?? [],
        participantOrder: target.participantOrder ?? [],
        participantOrderMode: target.participantOrderMode ?? 'auto',
        stageOrder: target.stageOrder ?? [],
        arrangePending: target.arrangePending ?? false,
        compositeTabs: target.compositeTabs,
        activeTabId: target.activeTabId,
        past: target.past,
        future: target.future,
        lastSavedAt: target.lastSavedAt,
        dirty: target.dirty,
        selected: null,
      });
      const idx = loadDocsIndex();
      if (idx) persistDocsIndex({ ...idx, activeId: id });
    },
    closeDocument: (id) => {
      const docs = get().documents;
      const targetIdx = docs.findIndex((d) => d.id === id);
      if (targetIdx < 0) return;
      // 删除文档存储
      try {
        localStorage.removeItem(docKey(id));
      } catch {
        /* 静默 */
      }

      // 唯一项目:关闭后新建一个空项目替换,保证始终至少有一个项目
      if (docs.length <= 1) {
        const newId = uid('doc');
        const color = DOCUMENT_COLORS[get().documents.length % DOCUMENT_COLORS.length];
        const emptyDoc: GraphDocument = {
          id: newId,
          name: `未命名项目 ${get().documents.length + 1}`,
          color,
          nodes: [],
          edges: [],
          viewport: { x: 0, y: 0, zoom: 1 },
          annotations: [],
          stages: [],
          participants: [],
          organizations: [],
          participantOrder: [],
          participantOrderMode: 'auto',
          stageOrder: [],
          arrangePending: false,
          compositeTabs: [],
          activeTabId: 'main',
          past: [],
          future: [],
          lastSavedAt: null,
          dirty: false,
        };
        set({
          documents: [emptyDoc],
          activeDocumentId: newId,
          nodes: [],
          edges: [],
          viewport: { x: 0, y: 0, zoom: 1 },
          annotations: [],
          stages: [],
          participants: [],
          organizations: [],
          participantOrder: [],
          participantOrderMode: 'auto',
          stageOrder: [],
          compositeTabs: [],
          activeTabId: 'main',
          past: [],
          future: [],
          lastSavedAt: null,
          dirty: false,
          selected: null,
        });
        const idx = loadDocsIndex() ?? { docs: [], activeId: newId };
        persistDocsIndex({
          docs: [{ id: newId, name: emptyDoc.name, color: emptyDoc.color, lastSavedAt: null }],
          activeId: newId,
        });
        return;
      }

      const remaining = docs.filter((d) => d.id !== id);
      // 若关闭的是活动文档,切换到相邻文档
      if (get().activeDocumentId === id) {
        const next = remaining[Math.min(targetIdx, remaining.length - 1)];
        set({
          documents: remaining,
          activeDocumentId: next.id,
          nodes: next.nodes,
          edges: next.edges,
          viewport: next.viewport,
          annotations: next.annotations,
          stages: next.stages,
          compositeTabs: next.compositeTabs,
          activeTabId: next.activeTabId,
          past: next.past,
          future: next.future,
          lastSavedAt: next.lastSavedAt,
          dirty: next.dirty,
          selected: null,
        });
      } else {
        set({ documents: remaining });
      }
      const idx = loadDocsIndex();
      if (idx) {
        persistDocsIndex({
          docs: idx.docs.filter((d) => d.id !== id),
          activeId: remaining.some((d) => d.id === idx.activeId) ? idx.activeId : remaining[0].id,
        });
      }
    },
    renameDocument: (id, name) => {
      set((s) => ({
        documents: s.documents.map((d) => (d.id === id ? { ...d, name } : d)),
      }));
      const idx = loadDocsIndex();
      if (idx) {
        persistDocsIndex({
          ...idx,
          docs: idx.docs.map((d) => (d.id === id ? { ...d, name } : d)),
        });
      }
    },
  };
}
