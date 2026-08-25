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
  type GraphDocument,
  type ViewportState,
  type Artifact,
  type FlowNodeData,
  type FlowEdgeData,
  type EdgeStyle,
  type ThemeMode,
  type ActorType,
  type Annotation,
  type AnnotationTarget,
  type Stage,
  type Participant,
  type Organization,
  type ParticipantType,
  DOCUMENT_COLORS,
  createDefaultNode,
  uid,
} from '../types';
import {
  COMPOSITE_PAD,
  COMPOSITE_PREFIX,
  applyCompositeBoxes,
  computeCompositeActor,
  computeCompositeBounds,
  computeCompositePorts,
  decodeCompositePort,
  decodeCompositePortPath,
  encodeCompositePort,
  findParentCompositeId,
  getNodeSize,
  isCompositePort,
} from '../lib/composite';
import { computeLayout, type LayoutDirection } from '../lib/layout';
import { findNodeById, findEdgeById } from '../domain/graph/queries';
import {
  addNodeToStage,
  boundsToStageBox,
  computeStageBounds,
  computeStageMembership,
  computeStageMinSize,
  detachNodeIdsFromStages,
} from '../lib/stage';
import {
  annotationTargetMatches,
  annotationTargetsEdge,
  annotationTargetsNode,
  anyAnnotationExpanded,
  createAnnotation,
  toggleAnnotationCollapsed as toggleAnnotationCollapsedIn,
} from '../lib/annotation';
import { setEdgeArtifact, updateEdgeArtifact } from '../lib/artifact';
import { createFlowEdge } from '../lib/edge';
import { findStageEmptySpot, pushNodesAwayFromBox, pushOutOfRect, rectOverlaps, type Rect } from '../lib/geometry';
import { detachOrganizationFromParticipants, detachParticipantFromNodes } from '../lib/participant';
import {
  buildProjectDocumentV4,
  detectDocumentFormat,
  extractOrganizations,
  extractParticipants,
  futureVersionMessage,
  importLegacyExportToDocument,
  migrateProjectV2ToDocument,
  migrateProjectV3ToDocument,
  pickGraphNodesEdges,
  validateDocumentData,
  type NormalizedDocument,
} from '../lib/document';

const SAVE_KEY = 'nodeflow:graph:v1';
const PREFS_KEY = 'nodeflow:prefs:v1';
const DOCS_KEY = 'nodeflow:docs:v1';
const SAVE_DELAY = 600;
/** 默认文档 id(迁移旧单文档时使用) */
const LEGACY_DOC_ID = 'doc_default';

/**
 * 标记「删除连线」是否已由 onEdgesChange 记录历史。
 * React Flow 删除节点时先 triggerEdgeChanges 再 triggerNodeChanges,
 * onEdgesChange 已记录「删除前含连线」快照,onNodesChange 据此跳过重复记录。
 */
let edgeDeleteHistoryPending = false;

export type Selection =
  | { kind: 'node'; id: string }
  | { kind: 'edge'; id: string }
  | { kind: 'artifact'; edgeId: string }
  | null;

/**
 * 待自动进入编辑模式的目标(创建新对象后默认直接编辑)。
 * - node-title:新节点的标题
 * - edge-label:新连线的说明文字(在属性面板中编辑)
 * - port-label:新创建的输入/输出端点标签
 */
export type AutoEditTarget =
  | { kind: 'node-title'; id: string }
  | { kind: 'edge-label'; id: string }
  | { kind: 'port-label'; nodeId: string; portId: string }
  | { kind: 'stage-name'; id: string };

interface FlowStore extends GraphState {
  past: GraphSnapshot[];
  future: GraphSnapshot[];
  selected: Selection;
  lastSavedAt: number | null;
  dirty: boolean;
  /** 当前活动文档的注释(顶层镜像,与 nodes/edges 对称) */
  annotations: Annotation[];
  /** 当前活动文档的流程阶段域(Stage) */
  stages: Stage[];
  /** 当前活动文档的参与方 */
  participants: Participant[];
  /** 当前活动文档的组织 */
  organizations: Organization[];
  /** 长按进入域时的闪烁反馈:正在闪烁的阶段域 id(700ms 后自动清除) */
  stageFlashId: string | null;
  /** 最近一次项目加载失败的用户可见错误信息(null 表示无) */
  loadError: string | null;

  // ---- 由 React Flow 直接回调 ----
  onNodesChange: OnNodesChange<FlowNode>;
  onEdgesChange: OnEdgesChange<FlowEdge>;
  onConnect: (conn: Connection) => void;
  onViewportChange: (v: ViewportState) => void;

  // ---- 选中 ----
  setSelected: (sel: Selection) => void;

  // ---- 自动进入编辑模式 ----
  /** 待自动进入编辑的对象(创建节点/连线/端口后设置,组件消费后清除) */
  pendingAutoEdit: AutoEditTarget | null;
  /** 请求在创建后自动进入编辑模式(传入 null 则清除) */
  requestAutoEdit: (t: AutoEditTarget | null) => void;

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
  /** 子图剪贴板(跨画布标签 / 跨项目共享):复制选中节点(含组合递归子图)后暂存 */
  clipboard: { nodes: FlowNode[]; edges: FlowEdge[] } | null;
  /** 复制当前选中节点及其组合子孙,存入剪贴板;返回复制的节点数 */
  copySelection: () => number;
  /** 把剪贴板内容粘贴到当前画布,返回粘贴的节点数 */
  pasteClipboard: (position?: { x: number; y: number }) => number;

  // ---- 注释 ----
  /** 最近创建、待自动进入编辑的注释 id(供注释框自动聚焦编辑) */
  annotAutoEditId: string | null;
  /** 添加注释(可指定归属),返回新注释 id */
  addAnnotation: (target: AnnotationTarget, position?: { x: number; y: number }) => string;
  /** 更新注释标题 / 内容(写历史) */
  updateAnnotation: (id: string, patch: Partial<Pick<Annotation, 'title' | 'content'>>) => void;
  /** 删除注释(写历史) */
  deleteAnnotation: (id: string) => void;
  /** 切换注释展开 / 收起 */
  toggleAnnotationCollapsed: (id: string) => void;
  /** 切换画布归属注释的位置(拖拽,结束时写历史) */
  setAnnotationPosition: (id: string, position: { x: number; y: number }, commitHistory: boolean) => void;
  /** 一键展开 / 收起所有注释,返回是否变为收起(用于按钮状态) */
  toggleAllAnnotations: () => boolean;

  // ---- 流程阶段域(Stage) ----
  /** 添加一个阶段域,返回新域 id */
  addStage: (x: number, y: number, width: number, height: number, name?: string) => string;
  /** 更新阶段域(名称 / 矩形 / 归属节点),写历史 */
  updateStage: (id: string, patch: Partial<Pick<Stage, 'name' | 'x' | 'y' | 'width' | 'height'>>) => void;
  /** 设置阶段域的归属节点列表(写历史) */
  setStageNodes: (id: string, nodeIds: string[]) => void;
  /** 删除阶段域(写历史) */
  deleteStage: (id: string) => void;
  /** 选中阶段域 */
  selectStage: (id: string | null) => void;
  /** 自动把「完全位于某域内的可见节点」归属到该域(合并节点移动后调用) */
  syncStageMembership: () => void;
  /** 把指定节点从所有阶段域中脱离 */
  detachNodeFromStages: (nodeId: string) => void;
  /** 移动阶段域(及其内部节点,保持相对关系);commitHistory=false 用于拖拽过程 */
  moveStageNodes: (id: string, dx: number, dy: number, moveNodes: boolean, commitHistory: boolean) => void;
  /** 调整阶段域大小(右下角拖拽);commitHistory=false 用于拖拽过程 */
  resizeStage: (id: string, width: number, height: number, commitHistory: boolean) => void;
  /** 把节点加入某阶段域(长按进入);若已在其它域先移出,写历史 */
  enterNodeToStage: (stageId: string, nodeId: string) => void;
  /** 把一批节点从所有阶段域中脱离(右键「脱离阶段域」) */
  detachNodesFromStages: (nodeIds: string[]) => void;
  /**
   * 阶段域自动扩大:按归属节点包围盒(含内边距)重算域框;
   * 若扩大后与外部节点/组合/其他阶段域重叠,按最小位移把外部元素推开(保持间距)。
   */
  autoGrowStage: (stageId: string) => void;
  /**
   * 删除节点的某个输入 / 输出端口(该方向至少保留 1 个)。
   * 会同步删除连到该端口的连线,并记录历史(撤销可恢复端口与连线)。
   */
  removePort: (
    id: string,
    kind: 'input' | 'output',
    portId: string,
  ) => void;

  // ---- 参与方 / 组织 ----
  /** 新增参与方 */
  addParticipant: (name: string, type: ParticipantType, organizationId?: string) => string;
  /** 更新参与方 */
  updateParticipant: (id: string, patch: Partial<Pick<Participant, 'name' | 'type' | 'organizationId'>>) => void;
  /** 删除参与方:指向它的节点 participantId 置 undefined(safe detach,不删节点) */
  deleteParticipant: (id: string) => void;
  /** 新增组织 */
  addOrganization: (name: string) => string;
  /** 更新组织 */
  updateOrganization: (id: string, patch: Partial<Pick<Organization, 'name'>>) => void;
  /** 删除组织:属于它的参与方 organizationId 置 undefined(safe detach,不删参与方) */
  deleteOrganization: (id: string) => void;
  /** 给节点显式指定参与方(只改语义,不改 position) */
  assignParticipant: (nodeId: string, participantId: string | null) => void;

  // ---- 连线操作 ----
  updateEdge: (id: string, patch: Partial<FlowEdgeData>) => void;
  deleteEdge: (id: string) => void;
  /**
   * 在连线上插入一个新节点,把原连线拆成两段:
   * 上游(源 → 新节点)继承原连线的说明文字 / 中间产物 / 注释;
   * 下游(新节点 → 目标)为新的空白连线。
   * 返回新节点 id。
   */
  insertNodeOnEdge: (edgeId: string, position?: { x: number; y: number }) => string;

  // ---- 中间产物 ----
  setArtifact: (edgeId: string, artifact: Artifact | null) => void;
  updateArtifact: (edgeId: string, patch: Partial<Artifact>) => void;

  // ---- 画布 ----
  fitGraph: () => void;
  clearGraph: () => void;
  loadGraph: (data: GraphSnapshot) => void;
  newDocument: () => void;
  saveNow: () => void;
  /** 保存指定文档(含其历史)到 localStorage,用于关闭非活动项目前的保存提示 */
  saveDocument: (id: string) => void;
  exportJson: () => string;
  /** 序列化当前活动文档为「项目文件」(含编辑状态与撤销历史,用于保存项目/下次恢复) */
  serializeProject: () => string;
  /** 从项目文件 JSON 恢复完整文档(含历史),作为新文档加入并切换到它 */
  loadProject: (json: string) => boolean;

  // ---- 多文档 ----
  /** 全部项目文档 */
  documents: GraphDocument[];
  /** 当前活动文档 id */
  activeDocumentId: string;
  /** 新建一个空文档并切换过去 */
  createDocument: (name?: string) => string;
  /** 切换到指定文档(保存并同步活动文档视图) */
  switchDocument: (id: string) => void;
  /** 关闭指定文档(删除);若为活动文档则切到相邻文档 */
  closeDocument: (id: string) => void;
  /** 重命名文档 */
  renameDocument: (id: string, name: string) => void;

  // ---- 全局偏好 ----
  edgeStyle: EdgeStyle;
  theme: ThemeMode;
  /** 自动布局方向(横向 / 竖向) */
  layoutDirection: LayoutDirection;
  setLayoutDirection: (dir: LayoutDirection) => void;
  /** 自动布局:对指定范围节点按连线依赖分层排列 */
  autoLayout: (dir: LayoutDirection, scope?: { compositeId?: string }) => void;
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

/* ---------------- 多文档持久化 ---------------- */

interface DocMeta {
  id: string;
  name: string;
  color: string;
  lastSavedAt: number | null;
}
interface DocsIndex {
  docs: DocMeta[];
  activeId: string;
}

function docKey(id: string): string {
  return `nodeflow:doc:${id}:v1`;
}

/** 保存单个文档数据(仅图数据 + 内部画布标签) */
function persistDocument(doc: Pick<GraphDocument, 'id' | 'nodes' | 'edges' | 'viewport' | 'annotations' | 'stages' | 'participants' | 'organizations' | 'compositeTabs' | 'activeTabId'>) {
  try {
    // 普通节点(非组合)的 draggable 是编辑文字的临时态,不持久化;保存时强制可拖,避免编辑态卡住导致刷新后无法拖拽
    const nodes = doc.nodes.map((n) => {
      if (n.data?.composite) return n;
      return n.draggable === false ? { ...n, draggable: true } : n;
    });
    localStorage.setItem(
      docKey(doc.id),
      JSON.stringify({
        version: 1, // localStorage 文档数据版本(向后兼容:旧数据无此字段视为 legacy)
        nodes,
        edges: doc.edges,
        viewport: doc.viewport,
        annotations: doc.annotations,
        stages: doc.stages,
        participants: doc.participants,
        organizations: doc.organizations,
        compositeTabs: doc.compositeTabs,
        activeTabId: doc.activeTabId,
      }),
    );
  } catch {
    /* 静默 */
  }
}

/** 加载单个文档数据,返回不含历史/脏标记的图数据(缺省返回空图) */
function loadPersistedDocument(id: string): Pick<
  GraphDocument,
  'nodes' | 'edges' | 'viewport' | 'annotations' | 'stages' | 'participants' | 'organizations' | 'compositeTabs' | 'activeTabId'
> {
  try {
    const raw = localStorage.getItem(docKey(id));
    if (!raw) {
      return { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, annotations: [], stages: [], participants: [], organizations: [], compositeTabs: [], activeTabId: 'main' };
    }
    const data = JSON.parse(raw);
    const rawNodes: FlowNode[] = Array.isArray(data.nodes) ? data.nodes : [];
    // 普通节点(非组合)的 draggable 是编辑临时态,加载时强制可拖(避免旧持久化里的 false 导致不可拖)
    const nodes = rawNodes.map((n) => (n.data?.composite ? n : n.draggable === false ? { ...n, draggable: true } : n));
    return {
      nodes,
      edges: Array.isArray(data.edges) ? data.edges : [],
      viewport: data.viewport ?? { x: 0, y: 0, zoom: 1 },
      annotations: Array.isArray(data.annotations) ? data.annotations : [],
      stages: Array.isArray(data.stages) ? data.stages : [],
      participants: Array.isArray(data.participants) ? data.participants : [],
      organizations: Array.isArray(data.organizations) ? data.organizations : [],
      compositeTabs: Array.isArray(data.compositeTabs) ? data.compositeTabs : [],
      activeTabId: data.activeTabId ?? 'main',
    };
  } catch {
    return { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, annotations: [], stages: [], participants: [], organizations: [], compositeTabs: [], activeTabId: 'main' };
  }
}

/** 加载文档注册表 */
function loadDocsIndex(): DocsIndex | null {
  try {
    const raw = localStorage.getItem(DOCS_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!Array.isArray(data.docs)) return null;
    return {
      docs: data.docs as DocMeta[],
      activeId: typeof data.activeId === 'string' ? data.activeId : data.docs[0]?.id ?? '',
    };
  } catch {
    return null;
  }
}

/** 保存文档注册表 */
function persistDocsIndex(index: DocsIndex) {
  try {
    localStorage.setItem(DOCS_KEY, JSON.stringify(index));
  } catch {
    /* 静默 */
  }
}

/**
 * 启动时构建文档列表:
 * - 有注册表 → 按注册表加载各文档数据
 * - 无注册表 → 迁移旧单文档(SAVE_KEY),作为默认文档
 */
function buildInitialDocuments(): { docs: GraphDocument[]; activeId: string } {
  const legacy = loadSaved();
  const index = loadDocsIndex();
  if (index && index.docs.length) {
    const docs = index.docs.map((meta) => {
      const data = loadPersistedDocument(meta.id);
      return {
        id: meta.id,
        name: meta.name,
        color: meta.color,
        nodes: data.nodes,
        edges: data.edges,
        viewport: data.viewport,
        annotations: data.annotations,
        stages: data.stages,
        participants: Array.isArray(data.participants) ? data.participants : [],
        organizations: Array.isArray(data.organizations) ? data.organizations : [],
        compositeTabs: data.compositeTabs,
        activeTabId: data.activeTabId,
        past: [],
        future: [],
        lastSavedAt: meta.lastSavedAt,
        dirty: false,
      } satisfies GraphDocument;
    });
    const activeId = index.docs.some((d) => d.id === index.activeId)
      ? index.activeId
      : index.docs[0].id;
    return { docs, activeId };
  }
  // 迁移旧单文档
  const legacyDoc: GraphDocument = {
    id: LEGACY_DOC_ID,
    name: '我的流程',
    color: DOCUMENT_COLORS[0],
    nodes: legacy?.nodes ?? seedGraph.nodes,
    edges: legacy?.edges ?? seedGraph.edges,
    viewport: legacy?.viewport ?? seedGraph.viewport,
    annotations: Array.isArray(legacy?.annotations) ? legacy.annotations : [],
    stages: [],
    participants: [],
    organizations: [],
    compositeTabs: [],
    activeTabId: 'main',
    past: [],
    future: [],
    lastSavedAt: legacy ? Date.now() : null,
    dirty: false,
  };
  persistDocument(legacyDoc);
  persistDocsIndex({ docs: [{ id: legacyDoc.id, name: legacyDoc.name, color: legacyDoc.color, lastSavedAt: legacyDoc.lastSavedAt }], activeId: legacyDoc.id });
  return { docs: [legacyDoc], activeId: legacyDoc.id };
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
const seedGraph = buildSeedGraph();
const prefs = loadPrefs();
// 启动时构建文档列表(迁移旧单文档或按注册表加载)
const initialDocs = buildInitialDocuments();
const initialActiveDoc = initialDocs.docs.find((d) => d.id === initialDocs.activeId) ?? initialDocs.docs[0];

/* ------------------------------------------------------------------ */
/* 组合节点(Composite Node)                                             */
/* ------------------------------------------------------------------ */

/** 构建节点 id → 节点 的 Map */
function buildNodesById(nodes: FlowNode[]): Map<string, FlowNode> {
  return new Map(nodes.map((n) => [n.id, n]));
}

/**
 * 递归收集一个组合的所有子孙节点 id(含直接子节点与嵌套组合的深层子孙)。
 */
/**
 * 重映射一个端口引用(handle):
 * - 普通端口:按「ownerNodeId:端口id」查端口映射表换成新 id
 * - 组合聚合端口(cid: 链):递归重映射链中每个节点 id 与最内层端口 id
 */
function remapHandle(
  handle: string | null | undefined,
  ownerNodeId: string,
  nodeMap: Map<string, string>,
  portMap: Map<string, string>,
): string | null | undefined {
  if (!handle) return handle;
  if (isCompositePort(handle)) {
    const p = decodeCompositePortPath(handle);
    if (!p) return handle;
    const newPath = p.path.map((nid) => nodeMap.get(nid) ?? nid);
    const last = p.path[p.path.length - 1];
    const inner = p.portId;
    const finalPort = isCompositePort(inner)
      ? (remapHandle(inner, last, nodeMap, portMap) as string)
      : (portMap.get(`${last}:${inner}`) ?? inner);
    let ref = finalPort;
    for (let i = newPath.length - 1; i >= 0; i--) {
      ref = encodeCompositePort(newPath[i], ref);
    }
    return ref;
  }
  return portMap.get(`${ownerNodeId}:${handle}`) ?? handle;
}

function collectAllDescendants(nodes: FlowNode[], compId: string): Set<string> {
  const byId = buildNodesById(nodes);
  const out = new Set<string>();
  const walk = (cid: string) => {
    const n = byId.get(cid);
    if (!n?.data?.composite) return;
    for (const sub of n.data.composite.childIds) {
      if (out.has(sub)) continue;
      out.add(sub);
      if (byId.get(sub)?.data?.composite) walk(sub);
    }
  };
  walk(compId);
  return out;
}

/**
 * 把指向某子孙节点的端口引用,包装成「外层组合聚合端口」的完整引用,
 * 使其与 computeCompositePorts 生成的聚合端口 id 保持一致。
 * 例:外层 B,直接子节点 A(组合,聚合端口 id 为 'cid:aSub:in1'),则
 * 指向 A 的线 handle='cid:aSub:in1' → 'cid:A:cid:aSub:in1'(即 B 的聚合端口 id)。
 */
function wrapRefToOuter(
  nodes: FlowNode[],
  targetNodeId: string,
  handle: string,
  outerId: string,
): string {
  // 1. 先编码 targetNodeId 自身,再向上逐层包装祖先组合,直到 outerId 的直接子节点为止(不含 outerId)
  let ref = encodeCompositePort(targetNodeId, handle);
  let cur = targetNodeId;
  const visited = new Set<string>();
  for (;;) {
    if (visited.has(cur)) break;
    visited.add(cur);
    // 找到包含 cur 的父组合
    const parentId = findParentCompositeId(nodes, cur) ?? null;
    if (!parentId || parentId === outerId) break;
    ref = encodeCompositePort(parentId, ref);
    cur = parentId;
  }
  return ref;
}

/**
 * 展开组合节点时,把聚合端口上的引用还原为指向「当前可见」的节点/端口。
 * 例:'cid:B:cid:A:in1'(B 展开):
 * - A 塌缩 → 指向 A 的聚合端口 { nodeId:'A', handle:'cid:A:in1' }
 * - A 展开 → 继续下钻到 { nodeId:'sub', handle:'in1' }
 */
function unwrapToVisible(
  nodesById: Map<string, FlowNode>,
  ref: string,
): { nodeId: string; handle: string } | null {
  // 逐层解析最外层节点与「剩余引用」,保留中间路径(聚合端口 ref 需完整保留)
  let current = ref;
  for (;;) {
    if (!current.startsWith(COMPOSITE_PREFIX)) break;
    const rest = current.slice(COMPOSITE_PREFIX.length);
    const idx = rest.indexOf(':');
    if (idx < 0) break;
    const nodeId = rest.slice(0, idx);
    const remaining = rest.slice(idx + 1);
    const node = nodesById.get(nodeId);
    if (!node) return null;
    if (node.data?.composite && !node.data.composite.expanded) {
      // 该节点是塌缩组合:线指向其聚合端口,handle 为「去掉本层后的完整剩余引用」
      return { nodeId, handle: remaining };
    }
    if (isCompositePort(remaining)) {
      current = remaining;
      continue;
    }
    // 普通端口 → 指向该节点
    return { nodeId, handle: remaining };
  }
  return null;
}

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
  const comp = findNodeById(s.nodes, id);
  if (!comp?.data?.composite) return;
  const directChildIds = comp.data.composite.childIds;
  const childSet = new Set(directChildIds);
  // 嵌套时收集全部子孙节点(含内层组合的深层子节点)
  const descendantSet = collectAllDescendants(s.nodes, id);
  const directChildren = s.nodes.filter((n) => childSet.has(n.id));

  // 聚合输入/输出端口(嵌套时递归展平内层聚合端口)
  const { inputs, outputs } = computeCompositePorts(directChildren, s.edges, buildNodesById(s.nodes));

  // 组合节点定位到子节点群中心
  const bounds = computeCompositeBounds(directChildren, 0);
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
    // 隐藏全部子孙节点(嵌套时递归)
    if (descendantSet.has(n.id)) return { ...n, hidden: true, selected: false };
    return n;
  });

  // 内部连线(两端都在子孙内)仅隐藏、不改写端口;
  // 外部连线指向任一子孙 → 改写到外层组合聚合端口(端口 ref 递归包装,可逆)
  const edges = s.edges.map((e) => {
    const inside = descendantSet.has(e.source) && descendantSet.has(e.target);
    if (inside) return { ...e, hidden: true };
    let { source, sourceHandle, target, targetHandle } = e;
    if (descendantSet.has(e.source)) {
      source = id;
      sourceHandle = wrapRefToOuter(s.nodes, e.source, e.sourceHandle ?? '', id);
    }
    if (descendantSet.has(e.target)) {
      target = id;
      targetHandle = wrapRefToOuter(s.nodes, e.target, e.targetHandle ?? '', id);
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
  const comp = findNodeById(s.nodes, id);
  if (!comp?.data?.composite) return;
  const directChildIds = comp.data.composite.childIds;
  const childSet = new Set(directChildIds);
  const byId = buildNodesById(s.nodes);

  const nodes = s.nodes.map((n) => {
    // 恢复直接子节点显示;更深的子孙隐藏状态由 refreshCompositeHidden 递归兜底
    if (childSet.has(n.id)) return { ...n, hidden: false };
    return n;
  });

  const edges = s.edges.map((e) => {
    let { source, sourceHandle, target, targetHandle } = e;
    let touched = false;
    if (source === id && sourceHandle) {
      const r = unwrapToVisible(byId, sourceHandle);
      if (r) {
        source = r.nodeId;
        sourceHandle = r.handle;
        touched = true;
      }
    }
    if (target === id && targetHandle) {
      const r = unwrapToVisible(byId, targetHandle);
      if (r) {
        target = r.nodeId;
        targetHandle = r.handle;
        touched = true;
      }
    }
    if (touched) return { ...e, source, sourceHandle, target, targetHandle };
    return e;
  });

  // 组合节点变为包裹子节点的虚线框
  const directChildren = nodes.filter((n) => childSet.has(n.id));
  const bounds = computeCompositeBounds(directChildren, COMPOSITE_PAD);
  const updated = nodes.map((n) => {
    if (n.id !== id) return n;
    const base: FlowNode = {
      ...n,
      draggable: false,
      // 标记展开态:React Flow 会把 node.className 挂到 .react-flow__node 上,
      // 用于精确 CSS 穿透(不依赖 :has() 兼容性)
      className: 'nf-expanded-frame',
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

  // 展开后把与虚线框重叠的相邻节点推开,避免重叠
  let finalNodes = updated;
  if (bounds) {
    const compNode = updated.find((n) => n.id === id);
    const w = compNode?.width ?? bounds.width;
    const h = compNode?.height ?? bounds.height;
    // 外部连线的产物矩形(用于推挤时给产物留出左右间距)
    const nodeById = buildNodesById(updated);
    const artifactRects: Rect[] = [];
    for (const e of edges) {
      if (!e.data?.artifact) continue;
      const src = nodeById.get(e.source);
      const tgt = nodeById.get(e.target);
      if (!src || !tgt) continue;
      const sw = getNodeSize(src).w;
      const sh = getNodeSize(src).h;
      const tw = getNodeSize(tgt).w;
      const th = getNodeSize(tgt).h;
      // 产物近似在连线中点(两端节点中心的中点),chip 约 140×40,
      // 保护区:左右各 70 + 40,上下各 30,确保被推开的节点彻底不与产物重叠
      const cx = (src.position.x + sw / 2 + tgt.position.x + tw / 2) / 2;
      const cy = (src.position.y + sh / 2 + tgt.position.y + th / 2) / 2;
      artifactRects.push({ x: cx - 110, y: cy - 20, width: 220, height: 100 });
    }
    finalNodes = pushNodesAwayFromBox(
      updated,
      id,
      childSet,
      { x: bounds.x, y: bounds.y, width: w, height: h },
      COMPOSITE_PAD,
      artifactRects,
    );
  }

  set({ nodes: finalNodes, edges });
  // 展开后统一重算嵌套隐藏状态(内层仍塌缩的组合其子节点保持隐藏)
  refreshCompositeHidden(get, set);
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
  const byId = buildNodesById(s.nodes);

  // 判断节点是否被任一塌缩的组合祖先包裹(不含自身为塌缩组合的情况,由上层处理)
  const isUnderCollapsedComposite = (nid: string): boolean => {
    const visited = new Set<string>();
    let cur = nid;
    while (cur) {
      if (visited.has(cur)) break;
      visited.add(cur);
      const parentId = findParentCompositeId(comps, cur) ?? null;
      if (!parentId) break;
      const pnode = byId.get(parentId);
      if (pnode?.data?.composite && !pnode.data.composite.expanded) return true;
      cur = parentId;
    }
    return false;
  };

  let changed = false;
  const nodes = s.nodes.map((n) => {
    const composite = n.data?.composite;
    if (composite && !composite.expanded) {
      // 塌缩组合:重新计算聚合端口(嵌套时递归展平)
      const children = s.nodes.filter((c) => composite.childIds.includes(c.id));
      const { inputs, outputs } = computeCompositePorts(children, s.edges, byId);
      if (
        JSON.stringify(inputs) !== JSON.stringify(n.data.inputs) ||
        JSON.stringify(outputs) !== JSON.stringify(n.data.outputs)
      ) {
        changed = true;
        return { ...n, data: { ...n.data, inputs, outputs } };
      }
      return n;
    }
    // 普通节点 / 展开组合:是否被塌缩祖先组合包裹
    const targetHidden = isUnderCollapsedComposite(n.id);
    if (!!n.hidden !== targetHidden) {
      changed = true;
      return { ...n, hidden: targetHidden };
    }
    return n;
  });
  const edges = s.edges.map((e) => {
    // 内部连线是否被塌缩祖先包裹 → 隐藏
    const srcHidden = isUnderCollapsedComposite(e.source);
    const tgtHidden = isUnderCollapsedComposite(e.target);
    const targetHidden = srcHidden || tgtHidden;
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
  // 嵌套组合时端口引用是链式,需检查路径上是否包含目标节点
  const srcPath = decodeCompositePortPath(e.sourceHandle)?.path ?? [];
  const tgtPath = decodeCompositePortPath(e.targetHandle)?.path ?? [];
  return srcPath.includes(nodeId) || tgtPath.includes(nodeId);
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

/** 把活动文档镜像字段(nodes/edges/...)同步回 documents 中的活动文档 */
function syncActiveDoc(get: () => FlowStore, rawSet: (p: unknown) => void) {
  const s = get();
  const docId = s.activeDocumentId;
  (rawSet as (fn: (state: FlowStore) => Partial<FlowStore>) => void)((state: FlowStore) => ({
    documents: state.documents.map((d) =>
      d.id === docId
        ? {
            ...d,
            nodes: state.nodes,
            edges: state.edges,
            viewport: state.viewport,
            annotations: state.annotations,
            stages: state.stages,
            participants: state.participants,
            organizations: state.organizations,
            compositeTabs: state.compositeTabs,
            activeTabId: state.activeTabId,
            past: state.past,
            future: state.future,
            lastSavedAt: state.lastSavedAt,
            dirty: state.dirty,
          }
        : d,
    ),
  }));
}

export const useGraphStore = create<FlowStore>()(
  subscribeWithSelector((rawSet, get) => {
    // 包装 set:每次修改活动文档镜像字段后,同步回 documents。
    // 所有 action 继续使用「set」变量,即会自动同步文档,无需改动现有 action。
    const set: typeof rawSet = (partial) => {
      rawSet(partial as never);
      syncActiveDoc(get, rawSet as unknown as (p: unknown) => void);
    };
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
    stageFlashId: null,
    loadError: null,
    annotAutoEditId: null,
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
          const node = findNodeById(get().nodes, rid);
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
          // 被删节点从阶段域的归属中移除
          stages: s.stages.map((st) =>
            st.nodeIds.some((nid) => removedIds.has(nid))
              ? { ...st, nodeIds: st.nodeIds.filter((nid) => !removedIds.has(nid)) }
              : st,
          ),
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
      set((s) => {
        const removedIds = new Set(removes.map((c) => c.id));
        return {
          edges: applyEdgeChanges(changes, s.edges),
          // 删除连线时清理指向该连线的注释(含中间产物归属)
          annotations:
            removedIds.size > 0
              ? s.annotations.filter((a) => {
                  if (a.target.kind !== 'edge' && a.target.kind !== 'artifact') return true;
                  return !removedIds.has(a.target.edgeId);
                })
              : s.annotations,
        };
      });
    },
    onConnect: (conn) => {
      if (get().allLocked) return;
      get().markHistory();
      const edge = createFlowEdge(
        conn.source!,
        conn.sourceHandle ?? undefined,
        conn.target!,
        conn.targetHandle ?? undefined,
      );
      set((s) => ({ edges: [...s.edges, edge] }));
      // 若在塌缩组合内部画布中新增内部连线,同步隐藏状态
      refreshCompositeHidden(get, set);
      // 新连线创建后默认进入连线说明(label)编辑模式,并选中该连线以便属性面板显示
      set({ selected: { kind: 'edge', id: edge.id }, pendingAutoEdit: { kind: 'edge-label', id: edge.id } });
    },
    onViewportChange: (v) => set({ viewport: v }),

    setSelected: (sel) => set({ selected: sel }),

    requestAutoEdit: (t) => set({ pendingAutoEdit: t }),

    markHistory: () =>
      set((s) => ({
        past: [
          ...s.past.slice(-99),
          {
            nodes: s.nodes,
            edges: s.edges,
            viewport: s.viewport,
            annotations: s.annotations,
            stages: s.stages,
            participants: s.participants,
            organizations: s.organizations,
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
              annotations: s.annotations,
              stages: s.stages,
              participants: s.participants,
              organizations: s.organizations,
              compositeTabs: s.compositeTabs,
              activeTabId: s.activeTabId,
              at: Date.now(),
            },
          ],
          nodes: prev.nodes,
          edges: prev.edges,
          viewport: prev.viewport,
          annotations: prev.annotations ?? [],
          stages: prev.stages ?? [],
          participants: prev.participants ?? [],
          organizations: prev.organizations ?? [],
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
              annotations: s.annotations,
              stages: s.stages,
              participants: s.participants,
              organizations: s.organizations,
              compositeTabs: s.compositeTabs,
              activeTabId: s.activeTabId,
              at: Date.now(),
            },
          ],
          nodes: next.nodes,
          edges: next.edges,
          viewport: next.viewport,
          annotations: next.annotations ?? [],
          stages: next.stages ?? [],
          participants: next.participants ?? [],
          organizations: next.organizations ?? [],
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
              annotations: s.annotations,
              stages: s.stages,
              compositeTabs: s.compositeTabs,
              activeTabId: s.activeTabId,
              at: Date.now(),
            },
          ],
          nodes: target.nodes,
          edges: target.edges,
          viewport: target.viewport,
          annotations: target.annotations ?? [],
          stages: target.stages ?? [],
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
      const comp = findNodeById(get().nodes, compositeId);
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
      const target = findNodeById(get().nodes, id);
      get().markHistory();
      if (target?.data?.composite) {
        // 删除组合节点:先展开恢复子节点,再删除组合节点自身
        expandComposite(get, set, id);
        set((s) => ({
          nodes: s.nodes.filter((n) => n.id !== id),
          selected: s.selected?.kind === 'node' && s.selected.id === id ? null : s.selected,
          // 清理指向该节点/连线的注释
          annotations: s.annotations.filter((a) => !annotationTargetsNode(a, id)),
        }));
        set((s) => closeCompositeTabInState(s, id));
        refreshCompositeHidden(get, set);
        return;
      }
      set((s) => {
        // 删除节点会连带删除其参与的连线,这些连线上的注释也要清理
        const removedEdges = s.edges.filter((e) => edgeReferencesNode(e, id));
        const removedEdgeIds = new Set(removedEdges.map((e) => e.id));
        return {
          nodes: s.nodes.filter((n) => n.id !== id),
          edges: s.edges.filter((e) => !edgeReferencesNode(e, id)),
          selected: s.selected?.kind === 'node' && s.selected.id === id ? null : s.selected,
          annotations: s.annotations.filter(
            (a) =>
              !annotationTargetsNode(a, id) &&
              !(a.target.kind === 'edge' && removedEdgeIds.has(a.target.edgeId)) &&
              !(a.target.kind === 'artifact' && removedEdgeIds.has(a.target.edgeId)),
          ),
        };
      });
      // 若删除的是某组合的子节点,从组合中移除
      removeChildFromComposites(get, set, id);
      // 刷新剩余塌缩组合的聚合端口与隐藏状态
      refreshCompositeHidden(get, set);
    },
    duplicateNode: (id) => {
      if (get().allLocked) return;
      get().markHistory();
      const src = findNodeById(get().nodes, id);
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
    copySelection: () => {
      if (get().allLocked) return 0;
      const s = get();
      // 选中来源:优先 React Flow 节点的 .selected,补充自定义 selected 指向的节点
      const selNodes = s.nodes.filter((n) => n.selected);
      const selNodeId = s.selected?.kind === 'node' ? s.selected.id : null;
      if (selNodes.length === 0 && selNodeId) {
        const n = findNodeById(s.nodes, selNodeId);
        if (n) selNodes.push(n);
      }
      const selected = selNodes;
      if (selected.length === 0) return 0;
      // 收集选中节点 + 所有组合子孙(递归)
      const ids = new Set<string>();
      for (const n of selected) {
        ids.add(n.id);
        for (const d of collectAllDescendants(s.nodes, n.id)) ids.add(d);
      }
      const subNodes = s.nodes
        .filter((n) => ids.has(n.id))
        .map((n) => JSON.parse(JSON.stringify(n)) as FlowNode);
      const subEdges = s.edges
        .filter((e) => ids.has(e.source) && ids.has(e.target))
        .map((e) => JSON.parse(JSON.stringify(e)) as FlowEdge);
      set({ clipboard: { nodes: subNodes, edges: subEdges } });
      return subNodes.length;
    },
    pasteClipboard: (position) => {
      if (get().allLocked) return 0;
      const clip = get().clipboard;
      if (!clip || clip.nodes.length === 0) return 0;
      get().markHistory();

      // 1. 深拷贝快照(避免污染剪贴板)
      const srcNodes = JSON.parse(JSON.stringify(clip.nodes)) as FlowNode[];
      const srcEdges = JSON.parse(JSON.stringify(clip.edges)) as FlowEdge[];

      // 2. 节点 id 重映射
      const nodeMap = new Map<string, string>();
      for (const n of srcNodes) nodeMap.set(n.id, uid('node'));

      // 3. 普通节点端口 id 重映射
      const portMap = new Map<string, string>(); // `${oldNodeId}:${oldPortId}` -> newPortId
      for (const n of srcNodes) {
        if (n.data?.composite) continue;
        const newInputs = (n.data.inputs ?? []).map((p) => {
          const np = uid('in');
          portMap.set(`${n.id}:${p.id}`, np);
          return { ...p, id: np };
        });
        const newOutputs = (n.data.outputs ?? []).map((p) => {
          const np = uid('out');
          portMap.set(`${n.id}:${p.id}`, np);
          return { ...p, id: np };
        });
        n.data = { ...n.data, inputs: newInputs, outputs: newOutputs };
      }

      // 4. 组合节点 childIds 重映射 + 节点自身 id 替换
      for (const n of srcNodes) {
        const newId = nodeMap.get(n.id)!;
        if (n.data?.composite) {
          n.data.composite = {
            ...n.data.composite,
            childIds: n.data.composite.childIds.map((cid) => nodeMap.get(cid) ?? cid),
          };
        }
        n.id = newId;
        n.selected = false;
        n.hidden = false;
        n.draggable = true;
      }

      // 5. 位置偏移:让复制内容的包围盒中心对齐到粘贴点;未指定时定位到当前视口中心(保证可见)
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const n of srcNodes) {
        const { w, h } = getNodeSize(n);
        minX = Math.min(minX, n.position.x);
        minY = Math.min(minY, n.position.y);
        maxX = Math.max(maxX, n.position.x + w);
        maxY = Math.max(maxY, n.position.y + h);
      }
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      let offset: { x: number; y: number };
      if (position) {
        offset = { x: position.x - cx, y: position.y - cy };
      } else if (get().activeTabId === 'main') {
        // 主画布:取当前视口中心对应的流坐标作为粘贴点
        const vp = get().viewport;
        const container = typeof document !== 'undefined'
          ? document.querySelector('.react-flow')
          : null;
        const cw = container?.clientWidth ?? 800;
        const ch = container?.clientHeight ?? 600;
        const cx_screen = cw / 2;
        const cy_screen = ch / 2;
        const fx = (cx_screen - vp.x) / vp.zoom;
        const fy = (cy_screen - vp.y) / vp.zoom;
        offset = { x: fx - cx, y: fy - cy };
      } else {
        offset = { x: 40, y: 40 };
      }
      for (const n of srcNodes) {
        n.position = { x: n.position.x + offset.x, y: n.position.y + offset.y };
      }

      // 6. 连线重映射(source/target 与 handle)
      const newEdges: FlowEdge[] = srcEdges.map((e) => ({
        ...e,
        id: uid('edge'),
        source: nodeMap.get(e.source) ?? e.source,
        target: nodeMap.get(e.target) ?? e.target,
        sourceHandle: remapHandle(e.sourceHandle, e.source, nodeMap, portMap) ?? e.sourceHandle,
        targetHandle: remapHandle(e.targetHandle, e.target, nodeMap, portMap) ?? e.targetHandle,
        hidden: false,
        selected: false,
      }));

      // 7. 插入当前活动文档
      set((st) => ({ nodes: [...st.nodes, ...srcNodes], edges: [...st.edges, ...newEdges] }));

      // 8. 重算塌缩组合聚合端口与隐藏状态
      refreshCompositeHidden(get, set);

      // 9. 选中粘贴出的节点(便于看到并继续操作)
      if (srcNodes.length) {
        const firstNewId = srcNodes[0].id;
        set({ selected: { kind: 'node', id: firstNewId } });
      }
      return srcNodes.length;
    },

    addAnnotation: (target, position) => {
      if (get().allLocked) return '';
      // 一个主体最多只能有一个注释
      const s = get();
      const already = s.annotations.some((a) =>
        annotationTargetMatches(a.target, target),
      );
      if (already) return '';
      get().markHistory();
      const id = uid('annot');
      const annot = createAnnotation(id, target, position);
      set((st) => ({
        annotations: [...st.annotations, annot],
        annotAutoEditId: id,
      }));
      return id;
    },
    updateAnnotation: (id, patch) => {
      if (get().allLocked) return;
      get().markHistory();
      set((s) => ({
        annotations: s.annotations.map((a) => (a.id === id ? { ...a, ...patch } : a)),
      }));
    },
    deleteAnnotation: (id) => {
      if (get().allLocked) return;
      get().markHistory();
      set((s) => ({ annotations: s.annotations.filter((a) => a.id !== id) }));
    },
    toggleAnnotationCollapsed: (id) => {
      set((s) => ({ annotations: toggleAnnotationCollapsedIn(s.annotations, id) }));
    },
    setAnnotationPosition: (id, position, commitHistory) => {
      // 拖拽过程不写历史,结束时(commitHistory=true)记录一次
      if (commitHistory) get().markHistory();
      set((s) => ({
        annotations: s.annotations.map((a) =>
          a.id === id ? { ...a, position } : a,
        ),
      }));
    },
    toggleAllAnnotations: () => {
      const s = get();
      // 若存在任意展开的注释 → 全部收起;否则全部展开
      const nextCollapsed = anyAnnotationExpanded(s.annotations);
      set((s2) => ({
        annotations: s2.annotations.map((a) => ({ ...a, collapsed: nextCollapsed })),
      }));
      return nextCollapsed;
    },

    // ---- 流程阶段域(Stage) ----
    addStage: (x, y, width, height, name) => {
      if (get().allLocked) return '';
      get().markHistory();
      const id = uid('stage');
      const w = Math.round(width);
      const h = Math.round(height);
      // 在目标位置附近找一个不与任何可见节点 / 其他阶段域重合的空位
      const s = get();
      const empty = findStageEmptySpot(x, y, w, h, s.nodes, s.stages);
      const stage: Stage = {
        id,
        name: name ?? '未命名阶段',
        x: Math.round(empty.x),
        y: Math.round(empty.y),
        width: w,
        height: h,
        nodeIds: [],
        selected: true,
      };
      set((st) => ({ stages: [...st.stages, stage] }));
      return id;
    },
    updateStage: (id, patch) => {
      if (get().allLocked) return;
      get().markHistory();
      set((s) => ({
        stages: s.stages.map((st) =>
          st.id === id ? { ...st, ...patch, id } : st,
        ),
      }));
    },
    setStageNodes: (id, nodeIds) => {
      if (get().allLocked) return;
      get().markHistory();
      set((s) => ({
        stages: s.stages.map((st) => (st.id === id ? { ...st, nodeIds } : st)),
      }));
    },
    deleteStage: (id) => {
      if (get().allLocked) return;
      get().markHistory();
      set((s) => ({
        stages: s.stages.filter((st) => st.id !== id),
      }));
    },
    selectStage: (id) => {
      set((s) => ({
        stages: s.stages.map((st) => ({ ...st, selected: st.id === id })),
      }));
    },
    detachNodeFromStages: (nodeId) => {
      set((s) => ({
        stages: s.stages.map((st) =>
          st.nodeIds.includes(nodeId)
            ? { ...st, nodeIds: st.nodeIds.filter((n) => n !== nodeId) }
            : st,
        ),
      }));
    },
    syncStageMembership: () => {
      const s = get();
      if (!s.stages.length) return;
      // 重新判定每个可见节点归属的域(完全包含判定)
      const owned = computeStageMembership(s.nodes, s.stages);
      // 重建每个域的 nodeIds:保留仍在域内的,补入新归属的
      const newStages = s.stages.map((st) => ({
        ...st,
        nodeIds: st.nodeIds.filter((nid) => owned.get(nid) === st.id),
      }));
      for (const [nid, sid] of owned) {
        const stage = newStages.find((st) => st.id === sid);
        if (stage && !stage.nodeIds.includes(nid)) stage.nodeIds.push(nid);
      }
      set({ stages: newStages });
    },
    moveStageNodes: (id, dx, dy, moveNodes, commitHistory) => {
      const s = get();
      const stage = s.stages.find((st) => st.id === id);
      if (!stage) return;
      if (commitHistory) get().markHistory();
      const rx = Math.round(dx);
      const ry = Math.round(dy);
      set((st) => ({
        stages: st.stages.map((stg) =>
          stg.id === id ? { ...stg, x: stg.x + rx, y: stg.y + ry } : stg,
        ),
        nodes: moveNodes
          ? st.nodes.map((n) =>
              stage.nodeIds.includes(n.id)
                ? { ...n, position: { x: n.position.x + rx, y: n.position.y + ry } }
                : n,
            )
          : st.nodes,
      }));
    },
    resizeStage: (id, width, height, commitHistory) => {
      if (commitHistory) get().markHistory();
      const s = get();
      const stage = s.stages.find((st) => st.id === id);
      if (!stage) return;
      const PAD = 22;
      // 计算最小覆盖尺寸:缩小后仍须完全包住所有归属可见节点(含内边距),否则 clamp 回最小
      const { minW, minH } = computeStageMinSize(stage, s.nodes, PAD);
      const w = Math.max(minW, Math.round(width));
      const h = Math.max(minH, Math.round(height));
      set((s2) => ({
        stages: s2.stages.map((st) => (st.id === id ? { ...st, width: w, height: h } : st)),
      }));
    },
    enterNodeToStage: (stageId, nodeId) => {
      if (get().allLocked) return;
      get().markHistory();
      set((s) => ({ stages: addNodeToStage(s.stages, stageId, nodeId) }));
    },
    detachNodesFromStages: (nodeIds) => {
      if (get().allLocked || nodeIds.length === 0) return;
      get().markHistory();
      set((s) => ({ stages: detachNodeIdsFromStages(s.stages, nodeIds) }));
    },
    addParticipant: (name, type, organizationId) => {
      if (get().allLocked) return '';
      const id = uid('participant');
      get().markHistory();
      set((s) => ({ participants: [...s.participants, { id, name, type, organizationId }] }));
      return id;
    },
    updateParticipant: (id, patch) => {
      if (get().allLocked) return;
      get().markHistory();
      set((s) => ({
        participants: s.participants.map((p) => (p.id === id ? { ...p, ...patch } : p)),
      }));
    },
    deleteParticipant: (id) => {
      if (get().allLocked) return;
      get().markHistory();
      set((s) => ({
        participants: s.participants.filter((p) => p.id !== id),
        // safe detach:指向该参与方的节点 participantId 置 undefined(不删除节点)
        nodes: detachParticipantFromNodes(s.nodes, id),
      }));
    },
    addOrganization: (name) => {
      if (get().allLocked) return '';
      const id = uid('org');
      get().markHistory();
      set((s) => ({ organizations: [...s.organizations, { id, name }] }));
      return id;
    },
    updateOrganization: (id, patch) => {
      if (get().allLocked) return;
      get().markHistory();
      set((s) => ({
        organizations: s.organizations.map((o) => (o.id === id ? { ...o, ...patch } : o)),
      }));
    },
    deleteOrganization: (id) => {
      if (get().allLocked) return;
      get().markHistory();
      set((s) => ({
        organizations: s.organizations.filter((o) => o.id !== id),
        // safe detach:属于该组织的参与方 organizationId 置 undefined(不删除参与方)
        participants: detachOrganizationFromParticipants(s.participants, id),
      }));
    },
    assignParticipant: (nodeId, participantId) => {
      if (get().allLocked) return;
      get().markHistory();
      set((s) => ({
        nodes: s.nodes.map((n) =>
          n.id === nodeId
            ? { ...n, data: { ...n.data, participantId: participantId ?? undefined } }
            : n,
        ),
      }));
    },
    autoGrowStage: (stageId) => {
      const s = get();
      const stage = s.stages.find((st) => st.id === stageId);
      if (!stage || !stage.nodeIds.length) return;
      const PAD = 22; // 域框内边距(节点与框边间距,遵循合理间距)
      const GAP = 14; // 外部推挤间距
      // 计算所有归属可见节点的包围盒
      const bounds = computeStageBounds(stage.nodeIds, s.nodes);
      if (!bounds) return;
      // 目标域框
      const growBox = boundsToStageBox(bounds, PAD);
      const tx = growBox.x;
      const ty = growBox.y;
      const tw = growBox.width;
      const th = growBox.height;
      // 若目标框已被当前框完全包裹,无需扩大
      if (
        tx >= stage.x &&
        ty >= stage.y &&
        tx + tw <= stage.x + stage.width &&
        ty + th <= stage.y + stage.height
      ) {
        return;
      }
      // 需要推挤的外部元素:其他可见节点(非本域归属,含组合节点)与其他阶段域框体
      const outsideNodes = s.nodes.filter((n) => !n.hidden && !stage.nodeIds.includes(n.id));
      const otherStages = s.stages.filter((st2) => st2.id !== stageId);
      const nodePos = new Map(outsideNodes.map((n) => [n.id, { ...n.position }]));
      const stagePos = new Map(otherStages.map((st) => [st.id, { x: st.x, y: st.y }]));
      const box: Rect = { x: tx, y: ty, width: tw, height: th };
      // 迭代把与扩大的域框重叠的外部元素推开(保持间距)
      const MAX = 6;
      let changed = true;
      for (let iter = 0; iter < MAX && changed; iter++) {
        changed = false;
        for (const n of outsideNodes) {
          const p = nodePos.get(n.id)!;
          const { w, h } = getNodeSize(n);
          if (rectOverlaps(p.x, p.y, w, h, box, GAP)) {
            nodePos.set(n.id, pushOutOfRect(p.x, p.y, w, h, box, GAP));
            changed = true;
          }
        }
        for (const st2 of otherStages) {
          const p = stagePos.get(st2.id)!;
          if (rectOverlaps(p.x, p.y, st2.width, st2.height, box, GAP)) {
            stagePos.set(st2.id, pushOutOfRect(p.x, p.y, st2.width, st2.height, box, GAP));
            changed = true;
          }
        }
      }
      set((st) => ({
        stages: st.stages.map((stg) => {
          if (stg.id === stageId) {
            return { ...stg, x: Math.round(tx), y: Math.round(ty), width: Math.round(tw), height: Math.round(th) };
          }
          const p = stagePos.get(stg.id);
          return p && (p.x !== stg.x || p.y !== stg.y)
            ? { ...stg, x: Math.round(p.x), y: Math.round(p.y) }
            : stg;
        }),
        nodes: st.nodes.map((n) => {
          const p = nodePos.get(n.id);
          return p && (p.x !== n.position.x || p.y !== n.position.y)
            ? { ...n, position: { x: Math.round(p.x), y: Math.round(p.y) } }
            : n;
        }),
      }));
    },

    removePort: (id, kind, portId) => {
      if (get().allLocked) return;
      const s = get();
      const node = findNodeById(s.nodes, id);
      if (!node) return;
      const list = kind === 'input' ? node.data.inputs : node.data.outputs;
      // 每个方向至少保留 1 个端口
      if (list.length <= 1) return;
      if (!list.some((p) => p.id === portId)) return;
      get().markHistory();
      const patch =
        kind === 'input'
          ? { inputs: list.filter((p) => p.id !== portId) }
          : { outputs: list.filter((p) => p.id !== portId) };
      set((s2) => ({
        nodes: s2.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)),
        // 删除连到该端口的连线(普通端口或塌缩聚合端口的 cid: 引用)
        edges: s2.edges.filter(
          (e) =>
            !(
              e.target === id &&
              (e.targetHandle === portId ||
                e.targetHandle === encodeCompositePort(id, portId) ||
                decodeCompositePortPath(e.targetHandle)?.portId === portId)
            ) &&
            !(
              e.source === id &&
              (e.sourceHandle === portId ||
                e.sourceHandle === encodeCompositePort(id, portId) ||
                decodeCompositePortPath(e.sourceHandle)?.portId === portId)
            ),
        ),
      }));
      refreshCompositeHidden(get, set);
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
        annotations: s.annotations.filter((a) => !annotationTargetsEdge(a, id)),
      }));
    },
    insertNodeOnEdge: (edgeId, position) => {
      if (get().allLocked) return '';
      const s = get();
      const edge = findEdgeById(s.edges, edgeId);
      if (!edge) return '';
      const src = findNodeById(s.nodes, edge.source);
      const tgt = findNodeById(s.nodes, edge.target);
      get().markHistory();
      // 默认位置:两端节点中心连线的中点
      let pos = position;
      if (!pos && src && tgt) {
        const sw = getNodeSize(src).w;
        const sh = getNodeSize(src).h;
        const tw = getNodeSize(tgt).w;
        const th = getNodeSize(tgt).h;
        pos = {
          x: Math.round((src.position.x + sw / 2 + tgt.position.x + tw / 2) / 2 - 115),
          y: Math.round((src.position.y + sh / 2 + tgt.position.y + th / 2) / 2 - 60),
        };
      }
      const node = createDefaultNode(pos ?? { x: 80, y: 80 });
      // 内部画布 → 新节点加入所属组合
      let newNode = node;
      let compId: string | null = null;
      if (s.activeTabId !== 'main') {
        compId = s.activeTabId;
        const comp = findNodeById(s.nodes, compId);
        if (comp?.data?.composite) {
          newNode = !comp.data.composite.expanded ? { ...node, hidden: true } : node;
        }
      }
      // 原连线的说明 / 产物转移到上游连线
      const { label = '', artifact = null } = edge.data ?? {};
      const upstreamId = uid('edge');
      const downstreamId = uid('edge');
      const upstream = createFlowEdge(edge.source, edge.sourceHandle, newNode.id, 'in_1', { label, artifact }, upstreamId);
      const downstream = createFlowEdge(newNode.id, 'out_1', edge.target, edge.targetHandle, undefined, downstreamId);
      set((st) => ({
        edges: st.edges.filter((e) => e.id !== edgeId).concat(upstream, downstream),
        nodes: compId
          ? st.nodes
              .map((n) =>
                n.id === compId
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
              .concat(newNode)
          : st.nodes.concat(newNode),
        // 原连线的注释(连线 / 产物归属)一并转移到上游连线
        annotations: st.annotations.map((a) =>
          annotationTargetsEdge(a, edgeId)
            ? { ...a, target: { ...a.target, edgeId: upstreamId } }
            : a,
        ),
      }));
      if (compId) refreshCompositeHidden(get, set);
      // 选中新节点并进入标题编辑
      set({
        selected: { kind: 'node', id: newNode.id },
        pendingAutoEdit: { kind: 'node-title', id: newNode.id },
      });
      return newNode.id;
    },

    setArtifact: (edgeId, artifact) => {
      if (get().allLocked) return;
      get().markHistory();
      set((s) => ({
        edges: s.edges.map((e) => (e.id === edgeId ? setEdgeArtifact(e, artifact) : e)),
      }));
    },
    updateArtifact: (edgeId, patch) => {
      if (get().allLocked) return;
      get().markHistory();
      set((s) => ({
        edges: s.edges.map((e) => (e.id === edgeId ? updateEdgeArtifact(e, patch) : e)),
      }));
    },

    fitGraph: () => set({ selected: null }),

    clearGraph: () => {
      if (get().allLocked) return;
      get().markHistory();
      set({ nodes: [], edges: [], annotations: [], stages: [], participants: [], organizations: [], compositeTabs: [], activeTabId: 'main' });
    },

    loadGraph: (data) => {
      if (get().allLocked) return;
      get().markHistory();
      set({
        nodes: data.nodes,
        edges: data.edges,
        viewport: data.viewport,
        annotations: data.annotations ?? [],
        stages: data.stages ?? [],
        participants: data.participants ?? [],
        organizations: data.organizations ?? [],
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
        docs: idx.docs.map((m) =>
          m.id === s.activeDocumentId
            ? { ...m, lastSavedAt: Date.now() }
            : m,
        ),
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
        documents: state.documents.map((d) =>
          d.id === id ? { ...d, dirty: false, lastSavedAt: Date.now() } : d,
        ),
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
      // 正式 Project Format v4:剥离历史/脏标记/React Flow 运行时字段;含 participants/organizations
      const document = buildProjectDocumentV4({
        name,
        color,
        nodes: s.nodes,
        edges: s.edges,
        viewport: s.viewport,
        annotations: s.annotations,
        stages: s.stages,
        participants: s.participants,
        organizations: s.organizations,
        compositeTabs: s.compositeTabs,
        activeTabId: s.activeTabId,
      });
      return JSON.stringify(
        { format: 'nodeflow', version: 4, exportedAt: new Date().toISOString(), document },
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
          color = typeof d.color === 'string' ? d.color : DOCUMENT_COLORS[get().documents.length % DOCUMENT_COLORS.length];
        } else if (info.legacy) {
          // Legacy Project v2
          norm = migrateProjectV2ToDocument(data);
          const project = (data as Record<string, unknown> | undefined)?.project ?? {};
          const p = project as Record<string, unknown>;
          name = typeof p.name === 'string' ? p.name : '未命名项目';
          color = typeof p.color === 'string' ? p.color : DOCUMENT_COLORS[get().documents.length % DOCUMENT_COLORS.length];
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
          color = typeof d.color === 'string' ? d.color : DOCUMENT_COLORS[get().documents.length % DOCUMENT_COLORS.length];
        }
        // Current Validation:标准化后确保结构可安全进入 Runtime
        const issues = validateDocumentData(norm);
        if (issues.length > 0) {
          set({ loadError: `项目文件结构无效:${issues.map((i) => i.field).join(', ')}。` });
          return false;
        }
        doc = {
          id: uid('doc'),
          name,
          color,
          nodes: norm.nodes,
          edges: norm.edges,
          viewport: norm.viewport,
          annotations: norm.annotations,
          stages: norm.stages,
          participants: extractParticipants(data) as Participant[],
          organizations: extractOrganizations(data) as Organization[],
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
      const color =
        DOCUMENT_COLORS[get().documents.length % DOCUMENT_COLORS.length];
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
        const color =
          DOCUMENT_COLORS[get().documents.length % DOCUMENT_COLORS.length];
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
          activeId: remaining.some((d) => d.id === idx.activeId)
            ? idx.activeId
            : remaining[0].id,
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

    // ---- 组合节点操作 ----
    groupSelected: () => {
      if (get().allLocked) return null;
      const s = get();
      const selectedNodes = s.nodes.filter((n) => n.selected);
      if (selectedNodes.length < 2) return null;
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
      // 组合节点执行主体继承自内部节点(全同则同、混杂则人机协同,支持嵌套),并据此推断标题
      const actor = computeCompositeActor(selectedNodes, buildNodesById(s.nodes));
      const actorLabel = actor === 'human' ? '人工' : actor === 'machine' ? '机器' : '人机协同';
      const nodes = s.nodes.map((n) => (n.selected ? { ...n, selected: false } : n));
      const compNode: FlowNode = {
        id,
        type: 'flow',
        position: pos,
        selected: true,
        data: {
          label: `${actorLabel}协作流程(${selectedNodes.length})`,
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
      const node = findNodeById(get().nodes, id);
      if (!node?.data?.composite) return;
      const firstChildId = node.data.composite.childIds[0];
      // 组合节点的注释:解除编组后合并到第一个子节点
      const compAnnot = get().annotations.find(
        (a) => a.target.kind === 'node' && a.target.nodeId === id,
      );
      get().markHistory();
      expandComposite(get, set, id);
      set((s) => {
        let annotations = s.annotations;
        if (compAnnot && firstChildId) {
          const existing = s.annotations.find(
            (a) => a.target.kind === 'node' && a.target.nodeId === firstChildId,
          );
          // 先移除组合节点自身的注释
          annotations = annotations.filter((a) => a.id !== compAnnot.id);
          if (existing) {
            // 第一个子节点已有注释 → 合并内容
            const merged: Partial<Pick<Annotation, 'title' | 'content'>> = {};
            if (compAnnot.title && !existing.title) merged.title = compAnnot.title;
            const combinedContent = [existing.content, compAnnot.content].filter(Boolean).join('\n');
            if (combinedContent) merged.content = combinedContent;
            annotations = annotations.map((a) =>
              a.id === existing.id ? { ...a, ...merged } : a,
            );
          } else {
            // 第一个子节点无注释 → 把组合注释转移给它
            annotations = [
              ...annotations,
              { ...compAnnot, target: { kind: 'node', nodeId: firstChildId } },
            ];
          }
        }
        return {
          nodes: s.nodes.filter((n) => n.id !== id),
          selected: s.selected?.kind === 'node' && s.selected.id === id ? null : s.selected,
          annotations,
        };
      });
      set((s) => closeCompositeTabInState(s, id));
    },
    toggleComposite: (id) => {
      if (get().allLocked) return;
      const node = findNodeById(get().nodes, id);
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
    setLayoutDirection: (dir) => set({ layoutDirection: dir }),
    autoLayout: (dir, scope) => {
      if (get().allLocked) return;
      const s = get();
      // 确定布局范围:全画布可见节点 或 组合的直接子节点
      let targetIds: Set<string>;
      if (scope?.compositeId) {
        const comp = findNodeById(s.nodes, scope.compositeId);
        if (!comp?.data?.composite) return;
        targetIds = new Set(comp.data.composite.childIds);
      } else {
        targetIds = new Set(s.nodes.filter((n) => !n.hidden).map((n) => n.id));
      }
      const targets = s.nodes.filter((n) => targetIds.has(n.id));
      if (targets.length === 0) return;
      const layoutEdges = s.edges.filter(
        (e) => targetIds.has(e.source) && targetIds.has(e.target),
      );
      get().markHistory();

      // 组合内部布局:不做阶段域处理,直接排列
      if (scope?.compositeId) {
        const positions = computeLayout(targets, layoutEdges, dir);
        const withPositions = s.nodes.map((n) => {
          const pos = positions.get(n.id);
          return pos ? { ...n, position: { x: Math.round(pos.x), y: Math.round(pos.y) } } : n;
        });
        set({ nodes: applyCompositeBoxes(withPositions) });
        return;
      }

      // === 全画布布局:集成阶段域 ===
      const STAGE_PAD = 22; // 域内边距
      // 1) 每个域:内部节点横向拓扑排列,域框收敛包裹
      const stageMeta = new Map<
        string,
        { w: number; h: number; x: number; y: number; inner: FlowNode[] }
      >();
      let finalNodes = s.nodes;
      for (const st of s.stages) {
        const inner = targets.filter((n) => st.nodeIds.includes(n.id));
        if (!inner.length) continue;
        const innerIds = new Set(inner.map((n) => n.id));
        const innerEdges = layoutEdges.filter(
          (e) => innerIds.has(e.source) && innerIds.has(e.target),
        );
        const positions = computeLayout(inner, innerEdges, dir);
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (const n of inner) {
          const p = positions.get(n.id) ?? { x: 0, y: 0 };
          const { w, h } = getNodeSize(n);
          minX = Math.min(minX, p.x);
          minY = Math.min(minY, p.y);
          maxX = Math.max(maxX, p.x + w);
          maxY = Math.max(maxY, p.y + h);
        }
        const W = maxX - minX;
        const H = maxY - minY;
        // 平移内部节点到域内(以域当前左上角 + PAD 为起点)
        const baseX = st.x + STAGE_PAD - minX;
        const baseY = st.y + STAGE_PAD - minY;
        finalNodes = finalNodes.map((n) => {
          if (!innerIds.has(n.id)) return n;
          const p = positions.get(n.id) ?? { x: 0, y: 0 };
          return {
            ...n,
            position: { x: Math.round(p.x + baseX), y: Math.round(p.y + baseY) },
          };
        });
        stageMeta.set(st.id, { w: W + STAGE_PAD * 2, h: H + STAGE_PAD * 2, x: st.x, y: st.y, inner });
      }

      // 2) ② 单节点域框大小对齐「除自身外最大的域」(即倒数第二大的域框体)
      if (stageMeta.size >= 2) {
        for (const [sid, meta] of stageMeta) {
          if (meta.inner.length !== 1) continue;
          let target: { w: number; h: number } | null = null;
          for (const [oid, om] of stageMeta) {
            if (oid === sid) continue;
            if (!target || om.w * om.h > target.w * target.h) target = om;
          }
          if (target) stageMeta.set(sid, { ...meta, w: target.w, h: target.h });
        }
      }

      // 3) 整体布局:每个域作为一个「块」+ 游离节点,横向拓扑排列
      const inStage = new Set<string>();
      for (const [, meta] of stageMeta) for (const n of meta.inner) inStage.add(n.id);
      const freeNodes = targets.filter((n) => !inStage.has(n.id));
      // 构造块节点集合:域块(带自定义宽高)+ 游离节点
      const blockNodes: FlowNode[] = [
        ...[...stageMeta.entries()].map(([sid, meta]) => ({
          id: `STAGE:${sid}`,
          type: 'flow' as const,
          position: { x: meta.x, y: meta.y },
          width: meta.w,
          height: meta.h,
          data: {
            label: '',
            description: '',
            actor: 'machine' as const,
            locked: false,
            inputs: [] as FlowNode['data']['inputs'],
            outputs: [] as FlowNode['data']['outputs'],
          },
        })),
        ...freeNodes,
      ];
      // 块边:把域内节点映射到所属域块,游离节点保持自身
      const idToBlock = new Map<string, string>();
      for (const [sid, meta] of stageMeta) for (const n of meta.inner) idToBlock.set(n.id, `STAGE:${sid}`);
      for (const n of freeNodes) idToBlock.set(n.id, n.id);
      const blockEdges: FlowEdge[] = [];
      const seen = new Set<string>();
      for (const e of layoutEdges) {
        const bs = idToBlock.get(e.source);
        const bt = idToBlock.get(e.target);
        if (!bs || !bt || bs === bt) continue;
        const key = `${bs}|${bt}`;
        if (seen.has(key)) continue;
        seen.add(key);
        blockEdges.push({
          id: key,
          source: bs,
          sourceHandle: e.sourceHandle,
          target: bt,
          targetHandle: e.targetHandle,
          type: 'flow',
          data: { label: '', artifact: null },
        });
      }
      const blockPositions = computeLayout(blockNodes, blockEdges, dir);

      // 4) 应用整体布局位置:游离节点直接更新
      finalNodes = finalNodes.map((n) => {
        if (inStage.has(n.id)) return n;
        const pos = blockPositions.get(n.id);
        return pos
          ? { ...n, position: { x: Math.round(pos.x), y: Math.round(pos.y) } }
          : n;
      });
      // 5) 更新域框到整体布局位置,内部节点随域平移
      let newStages = s.stages.map((st) => {
        const meta = stageMeta.get(st.id);
        if (!meta) return st;
        const pos = blockPositions.get(`STAGE:${st.id}`) ?? { x: st.x, y: st.y };
        const dx = pos.x - meta.x;
        const dy = pos.y - meta.y;
        if (dx || dy) {
          finalNodes = finalNodes.map((n) =>
            meta.inner.some((x) => x.id === n.id)
              ? {
                  ...n,
                  position: {
                    x: Math.round(n.position.x + dx),
                    y: Math.round(n.position.y + dy),
                  },
                }
              : n,
          );
        }
        return { ...st, x: Math.round(pos.x), y: Math.round(pos.y), width: Math.round(meta.w), height: Math.round(meta.h) };
      });
      // ③ 所有阶段域中央水平对齐:垂直中心 y 统一
      const stageList = newStages.filter((st) => stageMeta.has(st.id));
      if (stageList.length) {
        const centerY = stageList[0].y + stageList[0].height / 2;
        newStages = stageList.map((st) => {
          const newY = centerY - st.height / 2;
          const dy = newY - st.y;
          if (dy) {
            finalNodes = finalNodes.map((n) =>
              stageMeta.get(st.id)!.inner.some((x) => x.id === n.id)
                ? { ...n, position: { x: n.position.x, y: Math.round(n.position.y + dy) } }
                : n,
            );
          }
          return { ...st, y: Math.round(newY) };
        });
      }
      set({ nodes: applyCompositeBoxes(finalNodes), stages: newStages });
    },
    };
  }),
);

/* ------------------------------------------------------------------ */
/* 自动保存:订阅 nodes/edges/viewport 变化,防抖后写盘                    */
/* ------------------------------------------------------------------ */
useGraphStore.subscribe(
  (s) => ({ nodes: s.nodes, edges: s.edges, viewport: s.viewport, annotations: s.annotations }),
  () => {
    useGraphStore.setState((s) => ({
      dirty: true,
      documents: s.documents.map((d) =>
        d.id === s.activeDocumentId ? { ...d, dirty: true } : d,
      ),
    }));
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      useGraphStore.getState().saveNow();
    }, SAVE_DELAY);
  },
  { equalityFn: shallow },
);
