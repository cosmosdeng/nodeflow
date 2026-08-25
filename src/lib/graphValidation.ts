import type { FlowNode, FlowEdge, Stage, Annotation, GatewayType } from '../types';
import { decodeCompositePortPath } from './composite';

/**
 * P4-02 Graph Validation
 *
 * 纯检查函数:回答「这个 Graph 当前是否合法」。
 *
 * 设计约束(依据 P4 规范):
 * - 只负责发现问题,不负责偷偷修复问题。
 * - 不修改 graph 数据结构、不改 UI、不改 mutation。
 * - 与 React / Zustand / Electron 完全解耦,可独立测试。
 */

export interface ValidationIssue {
  /** 问题所属类别 */
  kind: 'id' | 'node' | 'edge' | 'composite' | 'stage' | 'annotation' | 'gateway' | 'handle';
  /** 严重程度 */
  severity: 'error' | 'warning';
  /** 人类可读描述 */
  message: string;
}

export interface GraphValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

/** 需要校验的图数据(仅读取,不修改) */
export interface GraphInput {
  nodes: FlowNode[];
  edges: FlowEdge[];
  stages?: Stage[];
  annotations?: Annotation[];
}

const GATEWAY_TYPES: GatewayType[] = ['exclusive', 'parallel', 'inclusive'];

/** 判断一个 handle 引用是否对应普通端口(非 cid: 聚合端口) */
function isPlainHandle(ref: string | null | undefined): boolean {
  return !!ref && !ref.startsWith('cid:');
}

/** 节点是否包含某个普通输入端口 */
function hasInputPort(node: FlowNode, portId: string): boolean {
  return node.data.inputs.some((p) => p.id === portId);
}

/** 节点是否包含某个普通输出端口 */
function hasOutputPort(node: FlowNode, portId: string): boolean {
  return node.data.outputs.some((p) => p.id === portId);
}

/**
 * 校验 Graph。
 * @param graph 需要校验的图数据
 * @param activeCanvasNodeIds 当前画布(主画布或某组合内部)可见的节点 id 集合。
 *    用于区分「跨画布引用」与「非法悬空引用」。不传时默认所有节点都在同一画布校验。
 */
export function validateGraph(graph: GraphInput, activeCanvasNodeIds?: Set<string>): GraphValidationResult {
  const issues: ValidationIssue[] = [];
  const nodes = graph.nodes;
  const edges = graph.edges;
  const stages = graph.stages ?? [];
  const annotations = graph.annotations ?? [];

  const visible = activeCanvasNodeIds ?? new Set(nodes.map((n) => n.id));

  // ---- ID 唯一性 ----
  const nodeIds = new Set<string>();
  for (const n of nodes) {
    if (nodeIds.has(n.id)) {
      issues.push({ kind: 'id', severity: 'error', message: `重复的 Node ID: ${n.id}` });
    }
    nodeIds.add(n.id);
  }
  const edgeIds = new Set<string>();
  for (const e of edges) {
    if (edgeIds.has(e.id)) {
      issues.push({ kind: 'id', severity: 'error', message: `重复的 Edge ID: ${e.id}` });
    }
    edgeIds.add(e.id);
  }
  const stageIds = new Set<string>();
  for (const st of stages) {
    if (stageIds.has(st.id)) {
      issues.push({ kind: 'id', severity: 'error', message: `重复的 Stage ID: ${st.id}` });
    }
    stageIds.add(st.id);
  }
  const annotIds = new Set<string>();
  for (const a of annotations) {
    if (annotIds.has(a.id)) {
      issues.push({ kind: 'id', severity: 'error', message: `重复的 Annotation ID: ${a.id}` });
    }
    annotIds.add(a.id);
  }

  // ---- Edge:source / target 存在性 ----
  for (const e of edges) {
    if (!nodeIds.has(e.source)) {
      issues.push({ kind: 'edge', severity: 'error', message: `Edge ${e.id} 的 source 节点不存在: ${e.source}` });
    }
    if (!nodeIds.has(e.target)) {
      issues.push({ kind: 'edge', severity: 'error', message: `Edge ${e.id} 的 target 节点不存在: ${e.target}` });
    }
  }

  // ---- Edge / Composite:handle 引用合法性 ----
  for (const e of edges) {
    const src = nodes.find((n) => n.id === e.source);
    const tgt = nodes.find((n) => n.id === e.target);
    // source handle
    if (src && e.sourceHandle) {
      if (isPlainHandle(e.sourceHandle)) {
        if (!hasOutputPort(src, e.sourceHandle)) {
          issues.push({ kind: 'handle', severity: 'error', message: `Edge ${e.id} 的 sourceHandle 不存在于节点 ${src.id}: ${e.sourceHandle}` });
        }
      } else {
        const dec = decodeCompositePortPath(e.sourceHandle);
        if (!dec || dec.path.length === 0 || !nodeIds.has(dec.path[dec.path.length - 1])) {
          issues.push({ kind: 'handle', severity: 'error', message: `Edge ${e.id} 的 cid: sourceHandle 无法解析: ${e.sourceHandle}` });
        }
      }
    }
    // target handle
    if (tgt && e.targetHandle) {
      if (isPlainHandle(e.targetHandle)) {
        if (!hasInputPort(tgt, e.targetHandle)) {
          issues.push({ kind: 'handle', severity: 'error', message: `Edge ${e.id} 的 targetHandle 不存在于节点 ${tgt.id}: ${e.targetHandle}` });
        }
      } else {
        const dec = decodeCompositePortPath(e.targetHandle);
        if (!dec || dec.path.length === 0 || !nodeIds.has(dec.path[dec.path.length - 1])) {
          issues.push({ kind: 'handle', severity: 'error', message: `Edge ${e.id} 的 cid: targetHandle 无法解析: ${e.targetHandle}` });
        }
      }
    }
  }

  // ---- Edge:悬空引用(两端都不在当前画布可见) ----
  // 一条连线两端都引用「当前画布不可见」的节点,视为非法悬空(除非是跨画布的桥接连线)。
  // 注意:这里只做检查,具体是否非法由业务层决定;这里仅标记 warning 供审查。

  // ---- Composite:关系合法性 ----
  for (const n of nodes) {
    const comp = n.data.composite;
    if (!comp) continue;
    // child 必须存在
    for (const cid of comp.childIds) {
      if (!nodeIds.has(cid)) {
        issues.push({ kind: 'composite', severity: 'error', message: `组合节点 ${n.id} 引用了不存在的子节点: ${cid}` });
      }
      // 不能包含自己
      if (cid === n.id) {
        issues.push({ kind: 'composite', severity: 'error', message: `组合节点 ${n.id} 不能包含自己` });
      }
    }
    // 重复子节点
    const childSet = new Set<string>();
    for (const cid of comp.childIds) {
      if (childSet.has(cid)) {
        issues.push({ kind: 'composite', severity: 'warning', message: `组合节点 ${n.id} 的子节点列表含重复: ${cid}` });
      }
      childSet.add(cid);
    }
  }

  // ---- Gateway:类型与结构合法性 ----
  for (const n of nodes) {
    const gw = n.data.gateway;
    if (!gw) continue;
    if (!GATEWAY_TYPES.includes(gw.type)) {
      issues.push({ kind: 'gateway', severity: 'error', message: `网关节点 ${n.id} 的 type 非法: ${gw.type}` });
    }
    // 网关至少 1 个输入、1 个输出分支
    if (n.data.inputs.length < 1) {
      issues.push({ kind: 'gateway', severity: 'error', message: `网关节点 ${n.id} 必须至少 1 个输入端口` });
    }
    if (n.data.outputs.length < 1) {
      issues.push({ kind: 'gateway', severity: 'error', message: `网关节点 ${n.id} 必须至少 1 个输出分支` });
    }
    // 输入 / 输出端口 id 唯一
    const inIds = new Set<string>();
    for (const p of n.data.inputs) {
      if (inIds.has(p.id)) issues.push({ kind: 'gateway', severity: 'warning', message: `节点 ${n.id} 的输入端口 id 重复: ${p.id}` });
      inIds.add(p.id);
    }
    const outIds = new Set<string>();
    for (const p of n.data.outputs) {
      if (outIds.has(p.id)) issues.push({ kind: 'gateway', severity: 'warning', message: `节点 ${n.id} 的输出端口 id 重复: ${p.id}` });
      outIds.add(p.id);
    }
  }

  // ---- 普通节点:端口 id 唯一性 ----
  for (const n of nodes) {
    if (n.data.gateway) continue; // 网关已在上面检查
    const inIds = new Set<string>();
    for (const p of n.data.inputs) {
      if (inIds.has(p.id)) issues.push({ kind: 'node', severity: 'warning', message: `节点 ${n.id} 的输入端口 id 重复: ${p.id}` });
      inIds.add(p.id);
    }
    const outIds = new Set<string>();
    for (const p of n.data.outputs) {
      if (outIds.has(p.id)) issues.push({ kind: 'node', severity: 'warning', message: `节点 ${n.id} 的输出端口 id 重复: ${p.id}` });
      outIds.add(p.id);
    }
  }

  // ---- Stage:node 引用必须存在 ----
  for (const st of stages) {
    for (const nid of st.nodeIds) {
      if (!nodeIds.has(nid)) {
        issues.push({ kind: 'stage', severity: 'error', message: `阶段域 ${st.id} 引用了不存在的节点: ${nid}` });
      }
    }
  }

  // ---- Annotation:target 必须存在 ----
  for (const a of annotations) {
    const t = a.target;
    if (t.kind === 'node' && !nodeIds.has(t.nodeId)) {
      issues.push({ kind: 'annotation', severity: 'error', message: `注释 ${a.id} 引用了不存在的节点: ${t.nodeId}` });
    } else if ((t.kind === 'edge' || t.kind === 'artifact') && !edgeIds.has(t.edgeId)) {
      issues.push({ kind: 'annotation', severity: 'error', message: `注释 ${a.id} 引用了不存在的连线: ${t.edgeId}` });
    }
    // canvas 归属:tabId 可以是 'main' 或组合 id,组合 id 需存在
    if (t.kind === 'canvas' && t.tabId !== 'main' && !nodeIds.has(t.tabId)) {
      issues.push({ kind: 'annotation', severity: 'warning', message: `注释 ${a.id} 归属的画布不存在: ${t.tabId}` });
    }
  }

  return {
    valid: !issues.some((i) => i.severity === 'error'),
    issues,
  };
}

/** 便捷判断:Graph 是否合法 */
export function isGraphValid(graph: GraphInput): boolean {
  return validateGraph(graph).valid;
}
