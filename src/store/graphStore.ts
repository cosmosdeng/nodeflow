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
  type ActorType,
  createDefaultNode,
  uid,
} from '../types';
import {
  COMPOSITE_PAD,
  computeCompositeBounds,
  computeCompositePorts,
  decodeCompositePort,
  encodeCompositePort,
} from '../lib/composite';

const SAVE_KEY = 'nodeflow:graph:v1';
const PREFS_KEY = 'nodeflow:prefs:v1';
const SAVE_DELAY = 600;

/**
 * 标记「删除连线」是否已由 onEdgesChange 记录历史。
 * React Flow 删除节点时先 triggerEdgeChanges 再 triggerNodeChanges,
 * onEdgesChange 已记录「删除前含连线」快照,onNodesChange 据此跳过重复记录。
 */
let edgeDeleteHistoryPending = false;

/**
 * 按多数派推断一组节点的执行主体。
 * 统计 human / machine / hybrid 出现次数,返回出现最多的;平手时按
 * human → machine → hybrid 优先级取靠前者;全为空时默认 human。
 */
function majorityActor(nodes: FlowNode[]): ActorType {
  const order: ActorType[] = ['human', 'machine', 'hybrid'];
  const counts: Record<ActorType, number> = { human: 0, machine: 0, hybrid: 0 };
  for (const n of nodes) {
    const a = n.data?.actor;
    if (a === 'human' || a === 'machine' || a === 'hybrid') counts[a] += 1;
  }
  let best: ActorType = 'human';
  let bestCount = -1;
  for (const a of order) {
    if (counts[a] > bestCount) {
      best = a;
      bestCount = counts[a];
    }
  }
  return best;
}

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
  /** 设置节点是否可拖拽(用于内联编辑态临时禁用拖拽,不写历史) */
  setNodeDraggable: (id: string, draggable: boolean) => void;
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

  // ---- 组合节点(Composite Node) ----
  /** 已打开的"内部画布"标签(组合节点 id 列表) */
  compositeTabs: string[];
  /** 当前激活的标签页:'main' 表示主画布,否则为组合节点 id */
  activeTabId: string;
  /** 将当前选中的 ≥2 个节点组合为一个组合节点 */
  groupSelected: () => string | null;
  /** 取消组合,恢复全部子节点 */
  ungroup: (id: string) => void;
  /** 展开/塌缩组合节点 */
  toggleComposite: (id: string) => void;
  /** 打开组合节点的内部画布标签 */
  openCompositeTab: (id: string) => void;
  /** 关闭内部画布标签 */
  closeCompositeTab: (id: string) => void;
  /** 切换当前激活的标签页 */
  setActiveTab: (id: string) => void;
  /** 在组合节点的内部画布中新建节点(创建 + 加入 childIds + 塌缩态隐藏,原子记录历史) */
  addNodeToComposite: (compositeId: string, position?: { x: number; y: number }) => string;

  // ---- 全局锁定(演示模式) ----
  /** 一键锁定所有节点与连线,锁定后禁止任何编辑操作 */
  allLocked: boolean;
  toggleLockAll: () => void;
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
    locked: false,
    inputs: [],
    outputs: [{ id: 'out_1', name: '需求文档' }],
  };

  const n2 = createDefaultNode({ x: 360, y: 40 });
  n2.id = 'seed_2';
  n2.data = {
    label: '脚本撰写',
    description: '根据需求文档由大模型生成初版脚本,人工校对润色',
    actor: 'hybrid',
    locked: false,
    inputs: [{ id: 'in_1', name: '需求' }],
    outputs: [{ id: 'out_1', name: '脚本' }, { id: 'out_2', name: '分镜表' }],
  };

  const n3 = createDefaultNode({ x: 720, y: 0 });
  n3.id = 'seed_3';
  n3.data = {
    label: '素材渲染',
    description: '由渲染农场批量生成视频画面,GPU 并行处理',
    actor: 'machine',
    locked: false,
    inputs: [{ id: 'in_1', name: '脚本' }],
    outputs: [{ id: 'out_1', name: '成片' }],
  };

  const n4 = createDefaultNode({ x: 720, y: 300 });
  n4.id = 'seed_4';
  n4.data = {
    label: '人工质检',
    description: '逐帧检查画面质量、字幕与音频同步,不合格退回重渲',
    actor: 'human',
    locked: false,
    inputs: [{ id: 'in_1', name: '待检成片' }],
    outputs: [{ id: 'out_1', name: '合格成片' }],
  };

  const n5 = createDefaultNode({ x: 1080, y: 160 });
  n5.id = 'seed_5';
  n5.data = {
    label: '发布上架',
    description: '多平台分发,配置封面、简介与定时发布',
    actor: 'hybrid',
    locked: false,
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
/* 组合节点(Composite Node)                                             */
/* ------------------------------------------------------------------ */

/**
 * 塌缩组合节点:
 * - 组合节点移动到子节点群的中心
 * - 子节点与内部连线隐藏
 * - 外部连线改写为指向组合节点(端口引用 cid: 编码,可逆)
 * - 组合节点端口更新为聚合端口
 */
function collapseComposite(
  get: () => FlowStore,
  set: (partial: Partial<FlowStore>) => void,
  id: string,
) {
  const s = get();
  const comp = s.nodes.find((n) => n.id === id);
  if (!comp?.data?.composite) return;
  const childSet = new Set(comp.data.composite.childIds);
  const children = s.nodes.filter((n) => childSet.has(n.id));

  // 聚合输入/输出端口
  const { inputs, outputs } = computeCompositePorts(children, s.edges);

  // 组合节点定位到子节点群中心
  const bounds = computeCompositeBounds(children, 0);
  const pos = bounds
    ? {
        x: Math.round(bounds.x + bounds.width / 2 - 170),
        y: Math.round(bounds.y + bounds.height / 2 - 120),
      }
    : comp.position;

  const nodes = s.nodes.map((n) => {
    if (n.id === id) {
      return {
        ...n,
        position: pos,
        width: undefined,
        height: undefined,
        style: undefined,
        draggable: undefined,
        data: {
          ...n.data,
          composite: { ...(n.data.composite as NonNullable<FlowNodeData['composite']>), expanded: false },
          inputs,
          outputs,
        },
      };
    }
    if (childSet.has(n.id)) return { ...n, hidden: true, selected: false };
    return n;
  });

  // 内部连线(两端都在组合内)仅隐藏、不改写端口,保证内部画布仍可显示;
  // 外部连线改写为指向组合节点(端口 cid: 编码,可逆)
  const edges = s.edges.map((e) => {
    const inside = childSet.has(e.source) && childSet.has(e.target);
    if (inside) return { ...e, hidden: true };
    let { source, sourceHandle, target, targetHandle } = e;
    if (childSet.has(e.source)) {
      source = id;
      sourceHandle = encodeCompositePort(e.source, e.sourceHandle ?? '');
    }
    if (childSet.has(e.target)) {
      target = id;
      targetHandle = encodeCompositePort(e.target, e.targetHandle ?? '');
    }
    return { ...e, source, sourceHandle, target, targetHandle, hidden: false };
  });

  set({ nodes, edges });
}

/**
 * 展开组合节点:
 * - 恢复子节点与内部连线显示
 * - 外部连线从组合端口还原回子节点端口
 * - 组合节点变为虚线框,包裹全部子节点
 */
function expandComposite(
  get: () => FlowStore,
  set: (partial: Partial<FlowStore>) => void,
  id: string,
) {
  const s = get();
  const comp = s.nodes.find((n) => n.id === id);
  if (!comp?.data?.composite) return;
  const childSet = new Set(comp.data.composite.childIds);

  const nodes = s.nodes.map((n) => {
    if (childSet.has(n.id)) return { ...n, hidden: false };
    return n;
  });

  const edges = s.edges.map((e) => {
    // 属于其他塌缩组合的连线保持原样,不因本组合展开而改变隐藏状态
    const inside = childSet.has(e.source) && childSet.has(e.target);
    let { source, sourceHandle, target, targetHandle } = e;
    let touched = false;
    if (source === id && sourceHandle) {
      const ref = decodeCompositePort(sourceHandle);
      if (ref) {
        source = ref.nodeId;
        sourceHandle = ref.portId;
        touched = true;
      }
    }
    if (target === id && targetHandle) {
      const ref = decodeCompositePort(targetHandle);
      if (ref) {
        target = ref.nodeId;
        targetHandle = ref.portId;
        touched = true;
      }
    }
    // 与本组合相关的边:展开后全部显示(内部连线与外部连线都恢复到子节点端口)
    if (touched || inside) return { ...e, source, sourceHandle, target, targetHandle, hidden: false };
    return e;
  });

  // 组合节点变为包裹子节点的虚线框
  const children = nodes.filter((n) => childSet.has(n.id));
  const bounds = computeCompositeBounds(children, COMPOSITE_PAD);
  const updated = nodes.map((n) => {
    if (n.id !== id) return n;
    const base: FlowNode = {
      ...n,
      draggable: false,
      data: {
        ...n.data,
        composite: { ...(n.data.composite as NonNullable<FlowNodeData['composite']>), expanded: true },
      },
    };
    if (bounds) {
      base.position = { x: Math.round(bounds.x), y: Math.round(bounds.y) };
      base.width = Math.round(bounds.width);
      base.height = Math.round(bounds.height);
      base.style = { ...(base.style ?? {}), width: Math.round(bounds.width), height: Math.round(bounds.height) };
    }
    return base;
  });

  set({ nodes: updated, edges });
}

/** 基于当前节点数组,重算所有展开态组合节点的虚线框包围盒(纯函数) */
function applyCompositeBoxes(nodes: FlowNode[]): FlowNode[] {
  let changed = false;
  const out = nodes.map((n) => {
    if (!n.data?.composite || !n.data.composite.expanded) return n;
    const children = nodes.filter((c) => n.data!.composite!.childIds.includes(c.id));
    const bounds = computeCompositeBounds(children, COMPOSITE_PAD);
    if (!bounds) return n;
    if (
      Math.abs(n.position.x - bounds.x) < 0.5 &&
      Math.abs(n.position.y - bounds.y) < 0.5 &&
      Math.abs((n.width ?? 0) - bounds.width) < 0.5 &&
      Math.abs((n.height ?? 0) - bounds.height) < 0.5
    ) {
      return n;
    }
    changed = true;
    return {
      ...n,
      position: { x: Math.round(bounds.x), y: Math.round(bounds.y) },
      width: Math.round(bounds.width),
      height: Math.round(bounds.height),
      style: {
        ...(n.style ?? {}),
        width: Math.round(bounds.width),
        height: Math.round(bounds.height),
      },
    };
  });
  return changed ? out : nodes;
}

/**
 * 同步塌缩组合的子节点/内部连线隐藏状态。
 * 用于内部画布中新增内部连线、或编辑子节点后,保证主画布展示一致。
 */
function refreshCompositeHidden(
  get: () => FlowStore,
  set: (partial: Partial<FlowStore>) => void,
) {
  const s = get();
  const comps = s.nodes.filter((n) => n.data?.composite);
  if (!comps.length) return;

  let changed = false;
  const nodes = s.nodes.map((n) => {
    // 塌缩组合:重新计算聚合端口,保证属性面板与画布展示一致
    const composite = n.data?.composite;
    if (composite && !composite.expanded) {
      const children = s.nodes.filter((c) => composite.childIds.includes(c.id));
      const { inputs, outputs } = computeCompositePorts(children, s.edges);
      if (
        JSON.stringify(inputs) !== JSON.stringify(n.data.inputs) ||
        JSON.stringify(outputs) !== JSON.stringify(n.data.outputs)
      ) {
        changed = true;
        return { ...n, data: { ...n.data, inputs, outputs } };
      }
      return n;
    }
    const owner = comps.find((c) => c.data!.composite!.childIds.includes(n.id));
    if (!owner) return n;
    const targetHidden = !owner.data!.composite!.expanded;
    if (!!n.hidden !== targetHidden) {
      changed = true;
      return { ...n, hidden: targetHidden };
    }
    return n;
  });
  const edges = s.edges.map((e) => {
    const owner = comps.find((c) => {
      const ids = c.data!.composite!.childIds;
      return ids.includes(e.source) && ids.includes(e.target);
    });
    if (!owner) return e;
    const targetHidden = !owner.data!.composite!.expanded;
    if (!!e.hidden !== targetHidden) {
      changed = true;
      return { ...e, hidden: targetHidden };
    }
    return e;
  });
  if (changed) set({ nodes, edges });
}

/**
 * 判断一条边是否直接或通过 cid: 端口引用指定节点。
 * 塌缩状态下,外部连线会被改写为指向组合节点且端口编码为 cid:<childId>:<portId>,
 * 因此删除子节点时必须解码端口引用,否则会遗留指向该子节点的悬空连线。
 */
function edgeReferencesNode(e: FlowEdge, nodeId: string): boolean {
  if (e.source === nodeId || e.target === nodeId) return true;
  return (
    decodeCompositePort(e.sourceHandle)?.nodeId === nodeId ||
    decodeCompositePort(e.targetHandle)?.nodeId === nodeId
  );
}

/** 子节点被删除后,从所有组合的 childIds 中移除该 id */
function removeChildFromComposites(
  get: () => FlowStore,
  set: (partial: Partial<FlowStore>) => void,
  childId: string,
) {
  const s = get();
  let changed = false;
  const nodes = s.nodes.map((n) => {
    if (n.data?.composite && n.data.composite.childIds.includes(childId)) {
      changed = true;
      const childIds = n.data.composite.childIds.filter((c) => c !== childId);
      return { ...n, data: { ...n.data, composite: { ...n.data.composite, childIds } } };
    }
    return n;
  });
  if (changed) set({ nodes });
}

/**
 * 历史恢复后同步标签页:
 * - 优先使用快照中记录的 compositeTabs / activeTabId(撤销/重做时完整恢复打开过的内部画布标签)
 * - 旧快照无标签字段时,回退为仅保留节点数组中仍存在的组合标签
 * - 无论何种来源,最终都剔除指向已不存在组合节点的标签,并保证 activeTabId 合法
 */
function restoreTabsFromSnapshot(
  s: FlowStore,
  snapshot: Pick<GraphSnapshot, 'nodes' | 'compositeTabs' | 'activeTabId'>,
) {
  const nodeIds = new Set(snapshot.nodes.map((n) => n.id));
  const snapTabs = snapshot.compositeTabs ?? s.compositeTabs;
  // 仅保留仍存在的组合节点标签;对无标签字段的旧快照回退到当前标签并按节点过滤
  const compositeTabs = snapTabs.filter((t) => nodeIds.has(t));
  const snapActive = snapshot.activeTabId ?? s.activeTabId;
  const activeTabId =
    snapActive === 'main' || compositeTabs.includes(snapActive) ? snapActive : 'main';
  return { compositeTabs, activeTabId };
}

/** 关闭组合内部画布标签(纯函数),返回需要合并的状态片段 */
function closeCompositeTabInState(s: FlowStore, id: string) {
  const compositeTabs = s.compositeTabs.filter((t) => t !== id);
  return {
    compositeTabs,
    activeTabId:
      s.activeTabId === id
        ? compositeTabs.length
          ? compositeTabs[compositeTabs.length - 1]
          : 'main'
        : s.activeTabId,
  };
}

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
    compositeTabs: [],
    activeTabId: 'main',
    allLocked: false,
    toggleLockAll: () => set((s) => ({ allLocked: !s.allLocked })),

    onNodesChange: (changes) => {
      // 全局锁定时不允许删除/移动等结构变更(仍允许选中查看)
      if (get().allLocked) {
        changes = changes.filter((c) => c.type !== 'remove');
        if (!changes.length) return;
      }
      const removes = changes.filter((c) => c.type === 'remove');
      if (removes.length) {
        // 若删除伴随连线(onEdgesChange 已记录「删除前含连线」快照),则不重复记历史,
        // 否则(仅删节点无关联边)在此记录,保证删除可撤销还原。
        if (edgeDeleteHistoryPending) {
          edgeDeleteHistoryPending = false;
        } else {
          get().markHistory();
        }
        const removedIds = new Set(removes.map((c) => c.id));
        const removedCompositeIds = new Set<string>();
        // 删除组合节点前先展开,恢复其子节点
        for (const rid of removedIds) {
          const node = get().nodes.find((n) => n.id === rid);
          if (node?.data?.composite) {
            removedCompositeIds.add(rid);
            expandComposite(get, set, rid);
          }
        }
        const applied = applyNodeChanges(changes, get().nodes);
        set((s) => ({
          nodes: applied,
          // 同时清理直接引用与通过 cid: 端口(塌缩聚合端口)引用被删节点的连线
          edges: s.edges.filter(
            (e) =>
              !removedIds.has(e.source) &&
              !removedIds.has(e.target) &&
              ![...removedIds].some(
                (rid) =>
                  decodeCompositePort(e.sourceHandle)?.nodeId === rid ||
                  decodeCompositePort(e.targetHandle)?.nodeId === rid,
              ),
          ),
          selected:
            s.selected?.kind === 'node' && removedIds.has(s.selected.id) ? null : s.selected,
        }));
        // 若删除的是组合的子节点,从组合中移除;若删除的是组合节点,关闭其标签
        for (const rid of removedIds) {
          if (removedCompositeIds.has(rid)) {
            set((s) => closeCompositeTabInState(s, rid));
          } else {
            removeChildFromComposites(get, set, rid);
          }
        }
        // 统一刷新剩余塌缩组合的聚合端口与隐藏状态
        refreshCompositeHidden(get, set);
        return;
      }
      const applied = applyNodeChanges(changes, get().nodes);
      const needRecompute = changes.some((c) => c.type === 'position' || c.type === 'dimensions');
      set({ nodes: needRecompute ? applyCompositeBoxes(applied) : applied });
    },
    onEdgesChange: (changes) => {
      // 全局锁定时不允许删除连线(仍允许选中查看)
      if (get().allLocked) {
        changes = changes.filter((c) => c.type !== 'remove');
        if (!changes.length) return;
      }
      const removes = changes.filter((c) => c.type === 'remove');
      if (removes.length) {
        // React Flow 删除节点时先 triggerEdgeChanges 再 triggerNodeChanges。
        // 此处记录「删除前含连线」快照,并置标志,使随后的 onNodesChange 不再重复记历史,
        // 从而撤销删除时能完整还原节点与连线。
        edgeDeleteHistoryPending = true;
        // 若本次只删边(无伴随节点删除),下一宏任务自动清理标志,避免影响后续删除
        setTimeout(() => {
          edgeDeleteHistoryPending = false;
        }, 0);
        get().markHistory();
      }
      set((s) => ({ edges: applyEdgeChanges(changes, s.edges) }));
    },
    onConnect: (conn) => {
      if (get().allLocked) return;
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
      // 若在塌缩组合内部画布中新增内部连线,同步隐藏状态
      refreshCompositeHidden(get, set);
    },
    onViewportChange: (v) => set({ viewport: v }),

    setSelected: (sel) => set({ selected: sel }),

    markHistory: () =>
      set((s) => ({
        past: [
          ...s.past.slice(-99),
          {
            nodes: s.nodes,
            edges: s.edges,
            viewport: s.viewport,
            compositeTabs: s.compositeTabs,
            activeTabId: s.activeTabId,
            at: Date.now(),
          },
        ],
        future: [],
      })),

    undo: () => {
      if (get().allLocked) return;
      set((s) => {
        if (!s.past.length) return s;
        const prev = s.past[s.past.length - 1];
        return {
          past: s.past.slice(0, -1),
          future: [
            ...s.future,
            {
              nodes: s.nodes,
              edges: s.edges,
              viewport: s.viewport,
              compositeTabs: s.compositeTabs,
              activeTabId: s.activeTabId,
              at: Date.now(),
            },
          ],
          nodes: prev.nodes,
          edges: prev.edges,
          viewport: prev.viewport,
          ...restoreTabsFromSnapshot(s, prev),
        };
      });
    },

    redo: () => {
      if (get().allLocked) return;
      set((s) => {
        if (!s.future.length) return s;
        const next = s.future[s.future.length - 1];
        return {
          future: s.future.slice(0, -1),
          past: [
            ...s.past,
            {
              nodes: s.nodes,
              edges: s.edges,
              viewport: s.viewport,
              compositeTabs: s.compositeTabs,
              activeTabId: s.activeTabId,
              at: Date.now(),
            },
          ],
          nodes: next.nodes,
          edges: next.edges,
          viewport: next.viewport,
          ...restoreTabsFromSnapshot(s, next),
        };
      });
    },

    jumpTo: (index) => {
      if (get().allLocked) return;
      set((s) => {
        if (index < 0 || index >= s.past.length) return s;
        const target = s.past[index];
        return {
          past: s.past.slice(0, index),
          future: [
            ...s.future,
            {
              nodes: s.nodes,
              edges: s.edges,
              viewport: s.viewport,
              compositeTabs: s.compositeTabs,
              activeTabId: s.activeTabId,
              at: Date.now(),
            },
          ],
          nodes: target.nodes,
          edges: target.edges,
          viewport: target.viewport,
          ...restoreTabsFromSnapshot(s, target),
        };
      });
    },

    canUndo: () => get().past.length > 0,
    canRedo: () => get().future.length > 0,

    addNode: (data, position) => {
      if (get().allLocked) return '';
      get().markHistory();
      const node = createDefaultNode(position ?? { x: 80, y: 80 });
      if (data) node.data = { ...node.data, ...data };
      set((s) => ({ nodes: [...s.nodes, node] }));
      return node.id;
    },
    addNodeToComposite: (compositeId, position) => {
      if (get().allLocked) return '';
      const comp = get().nodes.find((n) => n.id === compositeId);
      if (!comp?.data?.composite) return '';
      // 与 addNode 一致:新建节点作为一次原子历史记录
      get().markHistory();
      const node = createDefaultNode(position ?? { x: 80, y: 80 });
      // 塌缩态下新节点在主画布隐藏(内部画布渲染时强制显示)
      const collapsed = !comp.data.composite.expanded;
      const newNode: FlowNode = collapsed ? { ...node, hidden: true } : node;
      set((s) => ({
        nodes: s.nodes
          .map((n) =>
            n.id === compositeId
              ? {
                  ...n,
                  data: {
                    ...n.data,
                    composite: {
                      ...(n.data.composite as NonNullable<FlowNodeData['composite']>),
                      childIds: [...n.data.composite!.childIds, newNode.id],
                    },
                  },
                }
              : n,
          )
          .concat(newNode),
      }));
      // 塌缩态下同步聚合端口快照与主画布隐藏状态
      refreshCompositeHidden(get, set);
      return newNode.id;
    },
    updateNode: (id, patch) => {
      if (get().allLocked) return;
      get().markHistory();
      set((s) => ({
        nodes: s.nodes.map((n) =>
          n.id === id ? { ...n, data: { ...n.data, ...patch } } : n,
        ),
      }));
    },
    setNodeDraggable: (id, draggable) => {
      // 编辑临时态,不写历史、不检查锁定(锁定态本就不可拖)
      set((s) => ({
        nodes: s.nodes.map((n) => (n.id === id ? { ...n, draggable } : n)),
      }));
    },
    deleteNode: (id) => {
      if (get().allLocked) return;
      const target = get().nodes.find((n) => n.id === id);
      get().markHistory();
      if (target?.data?.composite) {
        // 删除组合节点:先展开恢复子节点,再删除组合节点自身
        expandComposite(get, set, id);
        set((s) => ({
          nodes: s.nodes.filter((n) => n.id !== id),
          selected: s.selected?.kind === 'node' && s.selected.id === id ? null : s.selected,
        }));
        set((s) => closeCompositeTabInState(s, id));
        refreshCompositeHidden(get, set);
        return;
      }
      set((s) => ({
        nodes: s.nodes.filter((n) => n.id !== id),
        // 同时清理直接引用与通过 cid: 端口(塌缩聚合端口)引用该节点的连线
        edges: s.edges.filter((e) => !edgeReferencesNode(e, id)),
        selected: s.selected?.kind === 'node' && s.selected.id === id ? null : s.selected,
      }));
      // 若删除的是某组合的子节点,从组合中移除
      removeChildFromComposites(get, set, id);
      // 刷新剩余塌缩组合的聚合端口与隐藏状态
      refreshCompositeHidden(get, set);
    },
    duplicateNode: (id) => {
      if (get().allLocked) return;
      get().markHistory();
      const src = get().nodes.find((n) => n.id === id);
      if (!src) return;
      // 组合节点共享 childIds,不能直接复制,否则复制品会与原组合互相干扰
      if (src.data.composite) return;
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
      if (get().allLocked) return;
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
      if (get().allLocked) return;
      get().markHistory();
      set((s) => ({
        edges: s.edges.filter((e) => e.id !== id),
        selected: s.selected?.kind === 'edge' && s.selected.id === id ? null : s.selected,
      }));
    },

    setArtifact: (edgeId, artifact) => {
      if (get().allLocked) return;
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
      if (get().allLocked) return;
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
      if (get().allLocked) return;
      get().markHistory();
      set({ nodes: [], edges: [], compositeTabs: [], activeTabId: 'main' });
    },

    loadGraph: (data) => {
      if (get().allLocked) return;
      get().markHistory();
      set({
        nodes: data.nodes,
        edges: data.edges,
        viewport: data.viewport,
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
        selected: null,
        compositeTabs: [],
        activeTabId: 'main',
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

    // ---- 组合节点操作 ----
    groupSelected: () => {
      if (get().allLocked) return null;
      const s = get();
      const selectedNodes = s.nodes.filter((n) => n.selected);
      if (selectedNodes.length < 2) return null;
      if (selectedNodes.some((n) => n.data.composite)) return null;
      get().markHistory();
      const childIds = selectedNodes.map((n) => n.id);
      const id = uid('composite');
      const bounds = computeCompositeBounds(selectedNodes, 0);
      const pos = bounds
        ? {
            x: Math.round(bounds.x + bounds.width / 2 - 170),
            y: Math.round(bounds.y + bounds.height / 2 - 120),
          }
        : { x: 100, y: 100 };
      // 按子节点多数派推断组合节点的执行主体与标题
      const actor = majorityActor(selectedNodes);
      const majority = actor === 'human' ? '人工' : actor === 'machine' ? '机器' : '人机协同';
      const nodes = s.nodes.map((n) => (n.selected ? { ...n, selected: false } : n));
      const compNode: FlowNode = {
        id,
        type: 'flow',
        position: pos,
        selected: true,
        data: {
          label: `${majority}协作流程(${selectedNodes.length})`,
          description: `${selectedNodes.length} 个节点组合而成,可展开编辑内部流程`,
          actor,
          locked: false,
          inputs: [],
          outputs: [],
          composite: { expanded: false, childIds },
        },
      };
      set({ nodes: [...nodes, compNode], selected: { kind: 'node', id } });
      collapseComposite(get, set, id);
      return id;
    },
    ungroup: (id) => {
      if (get().allLocked) return;
      const node = get().nodes.find((n) => n.id === id);
      if (!node?.data?.composite) return;
      get().markHistory();
      expandComposite(get, set, id);
      set((s) => ({
        nodes: s.nodes.filter((n) => n.id !== id),
        selected: s.selected?.kind === 'node' && s.selected.id === id ? null : s.selected,
      }));
      set((s) => closeCompositeTabInState(s, id));
    },
    toggleComposite: (id) => {
      if (get().allLocked) return;
      const node = get().nodes.find((n) => n.id === id);
      if (!node?.data?.composite) return;
      get().markHistory();
      if (node.data.composite.expanded) {
        collapseComposite(get, set, id);
      } else {
        expandComposite(get, set, id);
      }
    },
    openCompositeTab: (id) =>
      set((s) =>
        s.compositeTabs.includes(id)
          ? { activeTabId: id }
          : { compositeTabs: [...s.compositeTabs, id], activeTabId: id },
      ),
    closeCompositeTab: (id) => set((s) => closeCompositeTabInState(s, id)),
    setActiveTab: (id) => set({ activeTabId: id }),

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
