/**
 * FlowStore 领域类型:选中、自动编辑目标、完整 Store 接口。
 * 由 graphStore 实现;切片只依赖本文件的类型。
 */
import type {
  FlowNode,
  FlowEdge,
  GraphSnapshot,
  GraphState,
  GraphDocument,
  ViewportState,
  Artifact,
  FlowNodeData,
  FlowEdgeData,
  EdgeStyle,
  ThemeMode,
  Annotation,
  AnnotationTarget,
  Stage,
  Participant,
  Organization,
  ParticipantOrderMode,
  ParticipantType,
} from '../types';
import type { Connection, OnNodesChange, OnEdgesChange } from '@xyflow/react';
import type { LayoutDirection } from '../lib/layout';

export type Selection =
  { kind: 'node'; id: string } | { kind: 'edge'; id: string } | { kind: 'artifact'; edgeId: string } | null;

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

export interface FlowStore extends GraphState {
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
  /** 当前活动文档的参与方顺序(唯一权威,与 participants 保持联动) */
  participantOrder: string[];
  /** 当前活动文档的参与方排序模式 */
  participantOrderMode: ParticipantOrderMode;
  /** 当前活动文档的 Stage 线性顺序(唯一权威,与 stages 保持联动) */
  stageOrder: string[];
  /** Arrange Pending:语义顺序已改但 Canvas 几何未按新顺序组织(跨保存/切文档保留) */
  arrangePending: boolean;
  /** Arrange Pending 由哪类顺序变更引起(participant/stage/both;会话态,加载旧文档时为 undefined≈both) */
  arrangePendingKind?: 'participant' | 'stage' | 'both';
  /** Stage 列带显示开关(当前视图;同时参与 Arrange/避让行为判定,不持久化) */
  showStageBands: boolean;
  /** Participant 行带显示开关(当前视图;同时参与 Arrange/避让行为判定,不持久化) */
  showParticipantBands: boolean;
  /**
   * Phase C:拖拽悬停时的高亮候选(runtime-only,不持久化)。
   * 可同时承载参与方 / 阶段两个轴(交叉格内两轴独立停留互不覆盖)。
   */
  reassignHighlight: { participant: string | null; stage: string | null } | null;
  /** 设置 Phase C 候选高亮(合并式;传 null 全清;不写历史) */
  setReassignHighlight: (h: Partial<{ participant: string | null; stage: string | null }> | null) => void;
  /**
   * 语义面板聚焦项(runtime-only,不持久化、不进文档镜像):
   * 属性栏「管理…」或语义面板行点击时设置,用于在语义面板高亮对应参与方 / 阶段行,
   * 实现「属性栏 ↔ 语义面板」双向联动。id 为 null 表示只打开面板、不聚焦具体项。
   */
  semanticFocus: { kind: 'participant' | 'stage'; id: string | null } | null;
  setSemanticFocus: (focus: { kind: 'participant' | 'stage'; id: string | null } | null) => void;
  /**
   * Agent Interface 状态修订号(runtime-only,不持久化、不进 history snapshot)。
   * 仅由 Agent 层在成功 mutation / undo / redo 后推进;GUI 不受影响。
   */
  agentRevision: number;
  /** 推进一次 Agent state revision(+1) */
  bumpAgentRevision: () => void;
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

  /**
   * 键盘微调:整体平移所有选中节点。
   * 连续按键在 mergeWindowMs(默认 500ms)内合并为一条历史记录,一次 Undo 回到移动前。
   */
  nudgeSelectedNodes: (dx: number, dy: number, mergeWindowMs?: number) => void;

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
  removePort: (id: string, kind: 'input' | 'output', portId: string) => void;

  // ---- 泳道 (可选视觉组织,不改 geometry/语义) ----
  /** 泳道是否开启(纯展示开关,不改任何 graph/position/participant) */
  swimlaneEnabled: boolean;
  /** 泳道顺序(参与方 id 数组,用户可调整) */
  swimlaneOrder: string[];
  /** 切换泳道 ON/OFF(不改变 node position / participantId / stage) */
  toggleSwimlane: () => void;
  /** 调整泳道顺序 */
  setSwimlaneOrder: (order: string[]) => void;
  /** Arrange into Swimlanes(显式:按 participantId 重排 node.position,不改语义,单 undo) */
  arrangeAllSwimlanes: () => void;

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
  /** 给节点显式指定所属阶段(单归属:会自动从其它阶段移出;null=脱离所有阶段;只改语义,不改 position) */
  assignNodeStage: (nodeId: string, stageId: string | null) => void;
  /**
   * 批量归属(语义面板行尾「⊕」):把一组节点统一指定到同一参与方。
   * 整体只记录**一次**历史快照,Undo 一步还原全部节点;只改语义,不改 position。
   * participantId 为 null 表示全部清空归属。
   */
  assignParticipantToMany: (nodeIds: string[], participantId: string | null) => void;
  /**
   * 批量归属(语义面板行尾「⊕」):把一组节点统一加入同一阶段
   * (单归属:已在其它的会先移出;null = 全部脱离所有阶段)。整体只记录一次历史快照。
   */
  assignStageToMany: (nodeIds: string[], stageId: string | null) => void;
  /**
   * Phase C:确认后的 semantic reassignment —— 一次原子事务同时写入
   * position + (可选)participantId + (可选)stageId;Undo/Redo 一步恢复。
   */
  reassignNode: (
    nodeId: string,
    patch: {
      position: { x: number; y: number };
      participantId?: string | null;
      stageId?: string | null;
    },
    opts?: { recordHistory?: boolean },
  ) => void;

  // ---- Order / Arrange Pending (P2:语义顺序管理;真正的 Arrange 布局在后续阶段) ----
  /** 移动参与方到新位置(更新 participantOrder;首次手动排序 Auto→User;置 arrangePending;不动 position/membership) */
  reorderParticipant: (fromIndex: number, toIndex: number) => void;
  /** 移动阶段到新位置(更新 stageOrder;置 arrangePending;不动 position/membership) */
  reorderStage: (fromIndex: number, toIndex: number) => void;
  /** 消费 Arrange Pending(占位:仅 arrangePending→false;本阶段不执行真实几何布局,不改 node.position) */
  runArrange: () => void;
  /** 切换 Stage 列带显示(当前视图;不持久化) */
  toggleStageBands: () => void;
  /** 切换 Participant 行带显示(当前视图;不持久化) */
  toggleParticipantBands: () => void;
  /**
   * 合并按钮核心逻辑(替代旧「自动排列」+「Arrange」):
   * - 选中的组合 → 组合内部自动排列(不进入 band 模式);
   * - 有 Stage 列带 且 有 Participant 行带(均显示)→ 矩阵 Arrange + 流排序;
   * - 仅其一显示 → 对应单轴排列(隐藏轴忽略,其变更的 Arrange Pending 保留);
   * - 两者都隐藏 → 原自动排列(legacy autoLayout)。
   */
  runSmartArrange: () => void;

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
