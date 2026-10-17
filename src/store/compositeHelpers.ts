/**
 * 组合节点纯/半纯 helper:塌缩/展开/隐藏刷新/端口重映射。
 * 不直接依赖 store 实例,由 slice 传入 set/get。
 */
import { type FlowNode, type FlowEdge } from '../types';
import {
  COMPOSITE_PAD,
  COMPOSITE_PREFIX,
  computeCompositeBounds,
  computeCompositePorts,
  decodeCompositePortPath,
  encodeCompositePort,
  findParentCompositeId,
  getNodeSize,
  isCompositePort,
} from '../lib/composite';
import { findNodeById } from '../domain/graph/queries';
import { pushNodesAwayFromBox, type Rect } from '../lib/geometry';
import type { FlowNodeData } from '../types';
import type { FlowStore } from './types';

/* ------------------------------------------------------------------ */
/* 组合节点(Composite Node)                                             */
/* ------------------------------------------------------------------ */

/** 构建节点 id → 节点 的 Map */
export function buildNodesById(nodes: FlowNode[]): Map<string, FlowNode> {
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
export function remapHandle(
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

export function collectAllDescendants(nodes: FlowNode[], compId: string): Set<string> {
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
export function wrapRefToOuter(nodes: FlowNode[], targetNodeId: string, handle: string, outerId: string): string {
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
export function unwrapToVisible(
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
export function collapseComposite(get: () => FlowStore, set: (partial: Partial<FlowStore>) => void, id: string) {
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
export function expandComposite(get: () => FlowStore, set: (partial: Partial<FlowStore>) => void, id: string) {
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
export function refreshCompositeHidden(get: () => FlowStore, set: (partial: Partial<FlowStore>) => void) {
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
export function edgeReferencesNode(e: FlowEdge, nodeId: string): boolean {
  if (e.source === nodeId || e.target === nodeId) return true;
  // 嵌套组合时端口引用是链式,需检查路径上是否包含目标节点
  const srcPath = decodeCompositePortPath(e.sourceHandle)?.path ?? [];
  const tgtPath = decodeCompositePortPath(e.targetHandle)?.path ?? [];
  return srcPath.includes(nodeId) || tgtPath.includes(nodeId);
}

/** 子节点被删除后,从所有组合的 childIds 中移除该 id */
export function removeChildFromComposites(
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
