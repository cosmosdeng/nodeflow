import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { shallow } from 'zustand/shallow';
import {
  applyNodeChanges,
  applyEdgeChanges,
  type Connection,
  type OnNodesChange,
  type OnEdgesChange,
} from '@xyflow/react';
import {
  type FlowNode,
  type FlowEdge,
  type GraphSnapshot,
  type GraphState,
  type ViewportState,
  type Artifact,
  type FlowNodeData,
  type FlowEdgeData,
  type EdgeStyle,
  type ThemeMode,
  createDefaultNode,
  uid,
} from '../types';

const SAVE_KEY = 'nodeflow:graph:v1';
const PREFS_KEY = 'nodeflow:prefs:v1';
const SAVE_DELAY = 600;

export type Selection =
  | { kind: 'node'; id: string }
  | { kind: 'edge'; id: string }
  | { kind: 'artifact'; edgeId: string }
  | null;

interface FlowStore extends GraphState {
  past: GraphSnapshot[];
  future: GraphSnapshot[];
  selected: Selection;
  lastSavedAt: number | null;
  dirty: boolean;

  // ---- 由 React Flow 直接回调 ----
  onNodesChange: OnNodesChange<FlowNode>;
  onEdgesChange: OnEdgesChange<FlowEdge>;
  onConnect: (conn: Connection) => void;
  onViewportChange: (v: ViewportState) => void;

  // ---- 选中 ----
  setSelected: (sel: Selection) => void;

  // ---- 历史 ----
  markHistory: () => void;
  undo: () => void;
  redo: () => void;
  jumpTo: (index: number) => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  // ---- 节点操作 ----
  addNode: (data?: Partial<FlowNodeData>, position?: { x: number; y: number }) => string;
  updateNode: (id: string, patch: Partial<FlowNodeData>) => void;
  deleteNode: (id: string) => void;
  duplicateNode: (id: string) => void;

  // ---- 连线操作 ----
  updateEdge: (id: string, patch: Partial<FlowEdgeData>) => void;
  deleteEdge: (id: string) => void;

  // ---- 中间产物 ----
  setArtifact: (edgeId: string, artifact: Artifact | null) => void;
  updateArtifact: (edgeId: string, patch: Partial<Artifact>) => void;

  // ---- 画布 ----
  fitGraph: () => void;
  clearGraph: () => void;
  loadGraph: (data: GraphSnapshot) => void;
  newDocument: () => void;
  saveNow: () => void;
  exportJson: () => string;

  // ---- 全局偏好 ----
  edgeStyle: EdgeStyle;
  theme: ThemeMode;
  setEdgeStyle: (style: EdgeStyle) => void;
  setTheme: (theme: ThemeMode) => void;
}

/* ------------------------------------------------------------------ */
/* 首次启动时的示例图                                                   */
/* ------------------------------------------------------------------ */
function buildSeedGraph(): GraphSnapshot {
  const n1 = createDefaultNode({ x: 40, y: 160 });
  n1.id = 'seed_1';
  n1.data = {
    label: '需求收集',
    description: '与客户沟通并整理本次内容创作的需求、目标与素材清单',
    actor: 'human',
    inputs: [],
    outputs: [{ id: 'out_1', name: '需求文档' }],
  };

  const n2 = createDefaultNode({ x: 360, y: 40 });
  n2.id = 'seed_2';
  n2.data = {
    label: '脚本撰写',
    description: '根据需求文档由大模型生成初版脚本,人工校对润色',
    actor: 'hybrid',
    inputs: [{ id: 'in_1', name: '需求' }],
    outputs: [{ id: 'out_1', name: '脚本' }, { id: 'out_2', name: '分镜表' }],
  };

  const n3 = createDefaultNode({ x: 720, y: 0 });
  n3.id = 'seed_3';
  n3.data = {
    label: '素材渲染',
    description: '由渲染农场批量生成视频画面,GPU 并行处理',
    actor: 'machine',
    inputs: [{ id: 'in_1', name: '脚本' }],
    outputs: [{ id: 'out_1', name: '成片' }],
  };

  const n4 = createDefaultNode({ x: 720, y: 300 });
  n4.id = 'seed_4';
  n4.data = {
    label: '人工质检',
    description: '逐帧检查画面质量、字幕与音频同步,不合格退回重渲',
    actor: 'human',
    inputs: [{ id: 'in_1', name: '待检成片' }],
    outputs: [{ id: 'out_1', name: '合格成片' }],
  };

  const n5 = createDefaultNode({ x: 1080, y: 160 });
  n5.id = 'seed_5';
  n5.data = {
    label: '发布上架',
    description: '多平台分发,配置封面、简介与定时发布',
    actor: 'hybrid',
    inputs: [{ id: 'in_1', name: '成片' }],
    outputs: [],
  };

  const e1: FlowEdge = {
    id: 'seed_e1',
    source: 'seed_1',
    sourceHandle: 'out_1',
    target: 'seed_2',
    targetHandle: 'in_1',
    type: 'flow',
    data: {
      label: '传递给脚本组',
      artifact: {
        id: 'seed_a1',
        kind: 'document',
        label: '需求说明 v2',
        description: '客户确认后的需求文档,含目标人群与风格参考',
      },
    },
  };

  const e2: FlowEdge = {
    id: 'seed_e2',
    source: 'seed_2',
    sourceHandle: 'out_1',
    target: 'seed_3',
    targetHandle: 'in_1',
    type: 'flow',
    data: {
      label: '送渲染',
      artifact: {
        id: 'seed_a2',
        kind: 'document',
        label: '分镜脚本',
        description: '逐镜头的画面与台词说明',
      },
    },
  };

  const e3: FlowEdge = {
    id: 'seed_e3',
    source: 'seed_3',
    sourceHandle: 'out_1',
    target: 'seed_4',
    targetHandle: 'in_1',
    type: 'flow',
    data: {
      label: '待质检',
      artifact: {
        id: 'seed_a3',
        kind: 'video',
        label: '渲染成片',
        description: '3 分 20 秒,1080P 初版成片',
      },
    },
  };

  const e4: FlowEdge = {
    id: 'seed_e4',
    source: 'seed_4',
    sourceHandle: 'out_1',
    target: 'seed_5',
    targetHandle: 'in_1',
    type: 'flow',
    data: {
      label: '质检通过',
      artifact: {
        id: 'seed_a4',
        kind: 'video',
        label: '终版成片',
        description: '通过质检的最终版本',
      },
    },
  };

  return {
    nodes: [n1, n2, n3, n4, n5],
    edges: [e1, e2, e3, e4],
    viewport: { x: 20, y: 60, zoom: 0.85 },
  };
}

/* ------------------------------------------------------------------ */
/* 持久化                                                              */
/* ------------------------------------------------------------------ */
function loadSaved(): Partial<GraphSnapshot> | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!Array.isArray(data.nodes) || !Array.isArray(data.edges)) return null;
    return data;
  } catch {
    return null;
  }
}

function loadPrefs(): { edgeStyle: EdgeStyle; theme: ThemeMode } | null {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data && (data.edgeStyle === 'smoothstep' || data.edgeStyle === 'bezier')) {
      return {
        edgeStyle: data.edgeStyle as EdgeStyle,
        theme: data.theme === 'light' ? 'light' : 'dark',
      };
    }
    return null;
  } catch {
    return null;
  }
}

function savePrefs() {
  const { edgeStyle, theme } = useGraphStore.getState();
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ edgeStyle, theme }));
  } catch {
    /* 存储失败静默处理 */
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
const stored = loadSaved();
const seedGraph = buildSeedGraph();
const prefs = loadPrefs();

/* ------------------------------------------------------------------ */
/* Store                                                               */
/* ------------------------------------------------------------------ */
export const useGraphStore = create<FlowStore>()(
  subscribeWithSelector((set, get) => ({
    nodes: stored?.nodes ?? seedGraph.nodes,
    edges: stored?.edges ?? seedGraph.edges,
    viewport: stored?.viewport ?? seedGraph.viewport,
    past: [],
    future: [],
    selected: null,
    lastSavedAt: stored ? Date.now() : null,
    dirty: false,
    edgeStyle: prefs?.edgeStyle ?? 'smoothstep',
    theme: prefs?.theme ?? 'dark',

    onNodesChange: (changes) => {
      if (changes.some((c) => c.type === 'remove')) get().markHistory();
      set((s) => ({ nodes: applyNodeChanges(changes, s.nodes) }));
    },
    onEdgesChange: (changes) => {
      // 记录删除连线的历史
      if (changes.some((c) => c.type === 'remove')) get().markHistory();
      set((s) => ({ edges: applyEdgeChanges(changes, s.edges) }));
    },
    onConnect: (conn) => {
      get().markHistory();
      const edge: FlowEdge = {
        id: uid('edge'),
        source: conn.source!,
        sourceHandle: conn.sourceHandle ?? undefined,
        target: conn.target!,
        targetHandle: conn.targetHandle ?? undefined,
        type: 'flow',
        data: { label: '', artifact: null },
      };
      set((s) => ({ edges: [...s.edges, edge] }));
    },
    onViewportChange: (v) => set({ viewport: v }),

    setSelected: (sel) => set({ selected: sel }),

    markHistory: () =>
      set((s) => ({
        past: [
          ...s.past.slice(-99),
          { nodes: s.nodes, edges: s.edges, viewport: s.viewport, at: Date.now() },
        ],
        future: [],
      })),

    undo: () =>
      set((s) => {
        if (!s.past.length) return s;
        const prev = s.past[s.past.length - 1];
        return {
          past: s.past.slice(0, -1),
          future: [
            ...s.future,
            { nodes: s.nodes, edges: s.edges, viewport: s.viewport, at: Date.now() },
          ],
          nodes: prev.nodes,
          edges: prev.edges,
          viewport: prev.viewport,
        };
      }),

    redo: () =>
      set((s) => {
        if (!s.future.length) return s;
        const next = s.future[s.future.length - 1];
        return {
          future: s.future.slice(0, -1),
          past: [
            ...s.past,
            { nodes: s.nodes, edges: s.edges, viewport: s.viewport, at: Date.now() },
          ],
          nodes: next.nodes,
          edges: next.edges,
          viewport: next.viewport,
        };
      }),

    jumpTo: (index) =>
      set((s) => {
        if (index < 0 || index >= s.past.length) return s;
        const target = s.past[index];
        return {
          past: s.past.slice(0, index),
          future: [
            ...s.future,
            { nodes: s.nodes, edges: s.edges, viewport: s.viewport, at: Date.now() },
          ],
          nodes: target.nodes,
          edges: target.edges,
          viewport: target.viewport,
        };
      }),

    canUndo: () => get().past.length > 0,
    canRedo: () => get().future.length > 0,

    addNode: (data, position) => {
      get().markHistory();
      const node = createDefaultNode(position ?? { x: 80, y: 80 });
      if (data) node.data = { ...node.data, ...data };
      set((s) => ({ nodes: [...s.nodes, node] }));
      return node.id;
    },
    updateNode: (id, patch) => {
      get().markHistory();
      set((s) => ({
        nodes: s.nodes.map((n) =>
          n.id === id ? { ...n, data: { ...n.data, ...patch } } : n,
        ),
      }));
    },
    deleteNode: (id) => {
      get().markHistory();
      set((s) => ({
        nodes: s.nodes.filter((n) => n.id !== id),
        edges: s.edges.filter((e) => e.source !== id && e.target !== id),
        selected: s.selected?.kind === 'node' && s.selected.id === id ? null : s.selected,
      }));
    },
    duplicateNode: (id) => {
      get().markHistory();
      const src = get().nodes.find((n) => n.id === id);
      if (!src) return;
      const copy: FlowNode = {
        ...src,
        id: uid('node'),
        position: { x: src.position.x + 40, y: src.position.y + 40 },
        selected: false,
        data: {
          ...src.data,
          inputs: src.data.inputs.map((p) => ({ ...p, id: uid('in') })),
          outputs: src.data.outputs.map((p) => ({ ...p, id: uid('out') })),
        },
      };
      set((s) => ({ nodes: [...s.nodes, copy] }));
    },

    updateEdge: (id, patch) => {
      get().markHistory();
      set((s) => ({
        edges: s.edges.map((e) =>
          e.id === id
            ? {
                ...e,
                data: { ...(e.data ?? { label: '', artifact: null }), ...patch } as FlowEdgeData,
              }
            : e,
        ),
      }));
    },
    deleteEdge: (id) => {
      get().markHistory();
      set((s) => ({
        edges: s.edges.filter((e) => e.id !== id),
        selected: s.selected?.kind === 'edge' && s.selected.id === id ? null : s.selected,
      }));
    },

    setArtifact: (edgeId, artifact) => {
      get().markHistory();
      set((s) => ({
        edges: s.edges.map((e) =>
          e.id === edgeId
            ? {
                ...e,
                data: { ...(e.data ?? { label: '', artifact: null }), artifact } as FlowEdgeData,
              }
            : e,
        ),
      }));
    },
    updateArtifact: (edgeId, patch) => {
      get().markHistory();
      set((s) => ({
        edges: s.edges.map((e) =>
          e.id === edgeId && e.data?.artifact
            ? {
                ...e,
                data: {
                  ...e.data,
                  artifact: { ...e.data.artifact, ...patch },
                } as FlowEdgeData,
              }
            : e,
        ),
      }));
    },

    fitGraph: () => set({ selected: null }),

    clearGraph: () => {
      get().markHistory();
      set({ nodes: [], edges: [] });
    },

    loadGraph: (data) => {
      get().markHistory();
      set({
        nodes: data.nodes,
        edges: data.edges,
        viewport: data.viewport,
        selected: null,
      });
    },

    newDocument: () => {
      get().markHistory();
      set({
        nodes: [],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        selected: null,
      });
    },

    saveNow: () => {
      const { nodes, edges, viewport } = get();
      try {
        localStorage.setItem(SAVE_KEY, JSON.stringify({ nodes, edges, viewport }));
        set({ lastSavedAt: Date.now(), dirty: false });
      } catch {
        /* 存储失败时静默,避免打断操作 */
      }
    },

    exportJson: () => {
      const { nodes, edges, viewport } = get();
      return JSON.stringify(
        { version: 1, exportedAt: new Date().toISOString(), nodes, edges, viewport },
        null,
        2,
      );
    },

    setEdgeStyle: (style) => {
      set({ edgeStyle: style });
      savePrefs();
    },
    setTheme: (theme) => {
      set({ theme });
      savePrefs();
    },
  })),
);

/* ------------------------------------------------------------------ */
/* 自动保存:订阅 nodes/edges/viewport 变化,防抖后写盘                    */
/* ------------------------------------------------------------------ */
useGraphStore.subscribe(
  (s) => ({ nodes: s.nodes, edges: s.edges, viewport: s.viewport }),
  () => {
    useGraphStore.setState({ dirty: true });
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      useGraphStore.getState().saveNow();
    }, SAVE_DELAY);
  },
  { equalityFn: shallow },
);
