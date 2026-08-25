import type { Annotation, FlowEdge, FlowNode, Stage, ViewportState } from '../types';

// ---- Format / Version 常量 ----

/** 项目文件格式标识(Project Format) */
export const PROJECT_FORMAT = 'nodeflow';
/** 静态导出格式标识(Export Format) */
export const EXPORT_FORMAT = 'nodeflow-export';
/** 当前 Project 版本(v3 起为正式 Project Format;v2 为 legacy project;v1 仅存在于 Export namespace) */
export const CURRENT_PROJECT_VERSION = 3;
/** 当前 Export 版本 */
export const CURRENT_EXPORT_VERSION = 1;

// ---- Format 识别结果 ----

export type DocumentFamily = 'project' | 'export' | 'unknown';

export interface FormatInfo {
  family: DocumentFamily;
  /** 已解析的 version;无法解析时为 null */
  version: number | null;
  /** 是否为已知的 legacy 格式(需要 migrate/import) */
  legacy: boolean;
  /** 是否为 future version(version > current supported) */
  future: boolean;
}

/**
 * 检测输入 JSON 的格式族与版本(不修改输入)。
 *
 * 识别规则(Format + Version 共同决定,禁止仅凭 version 判断):
 * - 有 format: "nodeflow"(Project) / "nodeflow-export"(Export) / 其它 → unknown
 * - 无 format: type === "nodeflow-project" → legacy Project v2;否则按平铺结构识别 legacy Export v1
 */
export function detectDocumentFormat(input: unknown): FormatInfo {
  if (typeof input !== 'object' || input === null) {
    return { family: 'unknown', version: null, legacy: false, future: false };
  }
  const obj = input as Record<string, unknown>;

  // 1) 有 format 字段
  if (typeof obj.format === 'string') {
    if (obj.format === PROJECT_FORMAT) {
      return projectFormatInfo(obj.version);
    }
    if (obj.format === EXPORT_FORMAT) {
      return exportFormatInfo(obj.version);
    }
    return { family: 'unknown', version: null, legacy: false, future: false };
  }

  // 2) 无 format:legacy 兼容识别
  if (obj.type === 'nodeflow-project') {
    // Legacy Project v2(带 version 2,但按结构识别)
    return { family: 'project', version: 2, legacy: true, future: false };
  }
  // 无 type 且无 format:平铺结构,按 legacy Export v1 识别(须有 nodes/edges 数组结构特征)
  if (typeof obj.version === 'number' || Array.isArray(obj.nodes) || Array.isArray(obj.edges)) {
    return { family: 'export', version: 1, legacy: true, future: false };
  }
  return { family: 'unknown', version: null, legacy: false, future: false };
}

function projectFormatInfo(version: unknown): FormatInfo {
  if (typeof version !== 'number') {
    return { family: 'project', version: null, legacy: false, future: false };
  }
  if (version < CURRENT_PROJECT_VERSION) {
    return { family: 'project', version, legacy: true, future: false };
  }
  if (version === CURRENT_PROJECT_VERSION) {
    return { family: 'project', version, legacy: false, future: false };
  }
  return { family: 'project', version, legacy: false, future: true };
}

function exportFormatInfo(version: unknown): FormatInfo {
  if (typeof version !== 'number') {
    return { family: 'export', version: null, legacy: false, future: false };
  }
  if (version <= CURRENT_EXPORT_VERSION) {
    return { family: 'export', version, legacy: version < CURRENT_EXPORT_VERSION, future: false };
  }
  return { family: 'export', version, legacy: false, future: true };
}

// ---- Future Version Gate ----

/** 判断是否为需要安全拒绝的 future version */
export function isFutureVersion(info: FormatInfo): boolean {
  return info.future;
}

/** Future version 的用户可见错误提示 */
export function futureVersionMessage(info: FormatInfo): string {
  if (info.family === 'project') {
    return `此 NodeFlow 项目由更新版本的 NodeFlow 创建(格式 v${info.version})。请升级 NodeFlow 后再打开。`;
  }
  return `此 NodeFlow 导出数据由更新版本的 NodeFlow 创建(导出 v${info.version})。请升级 NodeFlow 后再导入。`;
}

// ---- Document 最小结构 ----

/** 兼容层产出:标准化后的文档图数据(不含历史/脏标记;id 由 Runtime Hydration 生成) */
export interface NormalizedDocument {
  nodes: FlowNode[];
  edges: FlowEdge[];
  viewport: ViewportState;
  annotations: Annotation[];
  stages: Stage[];
  compositeTabs: string[];
  activeTabId: string;
}

const defaultViewport: ViewportState = { x: 0, y: 0, zoom: 1 };

/** 只保留存在的 Node 内部 Document 字段,剥离 React Flow / Derived 字段(selected/measured/hidden/draggable) */
function normalizeNode(n: unknown): FlowNode {
  if (typeof n !== 'object' || n === null) return n as FlowNode;
  const node = n as Record<string, unknown>;
  const clone = { ...node };
  delete clone.selected;
  delete clone.measured;
  delete clone.hidden;
  // 普通节点(非组合)的 draggable 是编辑临时态,剥离;组合节点保留
  if (!(node.data as Record<string, unknown> | undefined)?.composite) {
    delete clone.draggable;
  }
  return clone as FlowNode;
}

/** 只保留存在的 Edge 内部 Document 字段,剥离 React Flow / Derived 字段 */
function normalizeEdge(e: unknown): FlowEdge {
  if (typeof e !== 'object' || e === null) return e as FlowEdge;
  const clone = { ...(e as Record<string, unknown>) };
  delete clone.selected;
  delete clone.hidden;
  return clone as FlowEdge;
}

/** 从平铺/外层数据中提取 nodes/edges(仅保留数组,否则空) */
function pickNodesEdges(obj: unknown): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const o = (obj ?? {}) as Record<string, unknown>;
  return {
    nodes: Array.isArray(o.nodes) ? (o.nodes as FlowNode[]).map(normalizeNode) : [],
    edges: Array.isArray(o.edges) ? (o.edges as FlowEdge[]).map(normalizeEdge) : [],
  };
}

/** 从 v3 document.graph 中提取 nodes/edges 并清洗(纯函数) */
export function pickGraphNodesEdges(graph: unknown): { nodes: FlowNode[]; edges: FlowEdge[] } {
  return pickNodesEdges(graph);
}

// ---- Migration: Legacy Project v2 → 当前 Document ----

/**
 * 把 Legacy Project v2(旧 serializeProject 输出)标准化为当前 Document 图数据。
 * 纯函数 / deterministic / 不修改输入 / 不依赖 Runtime。
 *
 * v2 字段: { type, version, project:{ id,name,color,nodes,edges,viewport,annotations,stages,compositeTabs,activeTabId,past,future,lastSavedAt,dirty } }
 * 处理: nodes/edges 保留并剥离 UI/Derived;past/future/dirty 丢弃(Runtime);lastSavedAt 丢弃。
 */
export function migrateProjectV2ToDocument(v2: unknown): NormalizedDocument {
  const p = ((v2 as Record<string, unknown> | undefined)?.project ?? v2 ?? {}) as Record<string, unknown>;
  const { nodes, edges } = pickNodesEdges(p);
  return {
    nodes,
    edges,
    viewport: normalizeViewport(p.viewport),
    annotations: (Array.isArray(p.annotations) ? p.annotations : []) as Annotation[],
    stages: (Array.isArray(p.stages) ? p.stages : []) as Stage[],
    compositeTabs: Array.isArray(p.compositeTabs) ? (p.compositeTabs as string[]) : [],
    activeTabId: typeof p.activeTabId === 'string' ? p.activeTabId : 'main',
  };
}

// ---- Import / Conversion: Legacy Export v1 → 当前 Document ----

/**
 * 把 Legacy Export v1(旧 exportJson 输出)导入为当前 Document 图数据。
 * 纯函数 / deterministic / 不修改输入。
 * 概念上是 Export Import / Conversion,不是 Project Migration。
 */
export function importLegacyExportToDocument(v1: unknown): NormalizedDocument {
  const o = (v1 ?? {}) as Record<string, unknown>;
  const { nodes, edges } = pickNodesEdges(o);
  return {
    nodes,
    edges,
    viewport: normalizeViewport(o.viewport),
    annotations: (Array.isArray(o.annotations) ? o.annotations : []) as Annotation[],
    stages: (Array.isArray(o.stages) ? o.stages : []) as Stage[],
    compositeTabs: [],
    activeTabId: 'main',
  };
}

// ---- 保存侧序列化(Current Project v3) ----

/** 保存侧清洗单个节点:剥离 React Flow / Derived 字段(selected/measured/hidden;普通节点 draggable) */
function cleanNodeForSave(n: FlowNode): FlowNode {
  const clone: Record<string, unknown> = { ...n };
  delete clone.selected;
  delete clone.measured;
  delete clone.hidden;
  if (!n.data?.composite) delete clone.draggable;
  return clone as FlowNode;
}

/** 保存侧清洗单条边:剥离 selected/hidden */
function cleanEdgeForSave(e: FlowEdge): FlowEdge {
  const clone: Record<string, unknown> = { ...e };
  delete clone.selected;
  delete clone.hidden;
  return clone as FlowEdge;
}

/** 保存侧构建 v3 Project 的 document 图数据(不含历史/dirty;id 在 Runtime 决定) */
export function buildProjectDocumentV3(input: {
  name: string;
  color: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
  viewport: ViewportState;
  annotations: Annotation[];
  stages: Stage[];
  compositeTabs: string[];
  activeTabId: string;
}): Record<string, unknown> {
  return {
    name: input.name,
    color: input.color,
    graph: {
      nodes: input.nodes.map(cleanNodeForSave),
      edges: input.edges.map(cleanEdgeForSave),
      annotations: input.annotations,
      stages: input.stages,
    },
    editor: {
      viewport: input.viewport,
      activeTabId: input.activeTabId,
      compositeTabs: input.compositeTabs,
    },
  };
}

// ---- Validation(最小必要) ----

export interface DocumentIssue {
  field: string;
  reason: string;
}

/**
 * 最小 validation:确保进入 Runtime 的数据不会因格式错误导致不可预测状态。
 * 返回问题列表;空数组表示可安全加载。
 * 只检查:类型错误 / 关键结构 / 非法引用。不检查字段数量/顺序/排版。
 */
export function validateDocumentData(doc: NormalizedDocument): DocumentIssue[] {
  const issues: DocumentIssue[] = [];
  if (!Array.isArray(doc.nodes)) issues.push({ field: 'nodes', reason: 'must be an array' });
  if (!Array.isArray(doc.edges)) issues.push({ field: 'edges', reason: 'must be an array' });
  if (!doc.viewport || typeof doc.viewport.zoom !== 'number') {
    issues.push({ field: 'viewport', reason: 'must be an object with zoom' });
  }
  if (!Array.isArray(doc.annotations)) issues.push({ field: 'annotations', reason: 'must be an array' });
  if (!Array.isArray(doc.stages)) issues.push({ field: 'stages', reason: 'must be an array' });
  return issues;
}

// ---- 内部工具 ----

function normalizeViewport(v: unknown): ViewportState {
  const vp = (v ?? {}) as Record<string, unknown>;
  const x = typeof vp.x === 'number' ? vp.x : 0;
  const y = typeof vp.y === 'number' ? vp.y : 0;
  const zoom = typeof vp.zoom === 'number' ? vp.zoom : 1;
  return { x, y, zoom };
}

/** 检查 Document 引用完整性(Edge→Node 等孤立引用丢弃)。返回清洗后的 edges。 */
export function dropDanglingEdgeRefs(edges: FlowEdge[], nodeIds: Set<string>): FlowEdge[] {
  return edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));
}
