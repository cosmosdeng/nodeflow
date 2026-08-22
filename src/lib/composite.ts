import type { ActorType, FlowEdge, FlowNode, PortDef } from '../types';

/** 组合端口引用编码前缀 */
export const COMPOSITE_PREFIX = 'cid:';
/** 展开态虚线框的内边距 */
export const COMPOSITE_PAD = 36;

/** 将子节点端口编码为组合节点上的端口引用 */
export function encodeCompositePort(childNodeId: string, portId: string): string {
  return `${COMPOSITE_PREFIX}${childNodeId}:${portId}`;
}

/**
 * 解码组合端口引用的嵌套路径,返回端口引用链上的节点 id 序列与最终端口 id。
 * 例:"cid:A:cid:B:in1" → { path: ['A','B'], portId: 'in1' }
 * 嵌套组合时,端口引用会逐层前缀 cid,路径表示「从最外层到最深层」的节点链。
 */
export function decodeCompositePortPath(
  ref: string | null | undefined,
): { path: string[]; portId: string } | null {
  if (!ref || !ref.startsWith(COMPOSITE_PREFIX)) return null;
  let rest = ref.slice(COMPOSITE_PREFIX.length);
  const path: string[] = [];
  // 逐段拆出 nodeId:,每段可能以 cid: 开头表示还有嵌套层
  for (;;) {
    if (rest.startsWith(COMPOSITE_PREFIX)) {
      rest = rest.slice(COMPOSITE_PREFIX.length);
    }
    const idx = rest.indexOf(':');
    if (idx < 0) break;
    path.push(rest.slice(0, idx));
    rest = rest.slice(idx + 1);
    // 剩余部分若不再以 cid: 开头,即为最终端口 id
    if (!rest.startsWith(COMPOSITE_PREFIX)) break;
  }
  if (path.length === 0) return null;
  return { path, portId: rest };
}

/**
 * 解码组合端口引用,还原出「最外层」子节点与剩余端口引用。
 * 兼容单层组合(最常见);嵌套时 nodeId 为最外层节点,portId 可能仍为 cid: 链。
 */
export function decodeCompositePort(
  ref: string | null | undefined,
): { nodeId: string; portId: string } | null {
  const p = decodeCompositePortPath(ref);
  if (!p) return null;
  return { nodeId: p.path[0], portId: p.portId };
}

/** 是否为组合端口引用 */
export function isCompositePort(ref: string | null | undefined): boolean {
  return !!ref && ref.startsWith(COMPOSITE_PREFIX);
}

/**
 * 计算组合节点的执行主体(继承自内部节点,支持嵌套递归):
 * - 全部为同一主体(全 human 或全 machine)→ 显示该主体
 * - 混杂(含 human+machine 混合,或含 hybrid)→ 人机协同(hybrid)
 * - 组合子节点取其自身继承的执行主体(递归);无子节点 → 兜底 human
 */
export function computeCompositeActor(
  children: FlowNode[],
  nodesById?: Map<string, FlowNode>,
): ActorType {
  if (children.length === 0) return 'human';
  let hasHuman = false;
  let hasMachine = false;
  for (const n of children) {
    let a: ActorType | undefined;
    if (n.data?.composite) {
      const subChildren = (n.data.composite.childIds ?? [])
        .map((cid) => nodesById?.get(cid))
        .filter((x): x is FlowNode => !!x);
      a = computeCompositeActor(subChildren, nodesById);
    } else {
      a = n.data?.actor as ActorType | undefined;
    }
    if (a === 'human') hasHuman = true;
    else if (a === 'machine') hasMachine = true;
    else return 'hybrid'; // 含 hybrid 或无法推断 → 人机协同
  }
  // 既有 human 又有 machine → 混杂 → 人机协同
  if (hasHuman && hasMachine) return 'hybrid';
  return hasMachine ? 'machine' : 'human';
}

/** 节点测量尺寸(优先 measured,其次显式 width/height,最后默认值) */
export function getNodeSize(n: FlowNode): { w: number; h: number } {
  const w = n.measured?.width ?? n.width ?? 240;
  const h = n.measured?.height ?? n.height ?? 150;
  return { w, h };
}

/**
 * 计算塌缩态组合节点的聚合端口:
 * 输入端口 = 内部节点中没有内部连线连入的输入端口
 * 输出端口 = 内部节点中没有内部连线连出的输出端口
 */
/**
 * 计算塌缩态组合节点的聚合端口:
 * 输入端口 = 内部节点中没有内部连线连入的输入端口
 * 输出端口 = 内部节点中没有内部连线连出的输出端口
 *
 * 重名端口按「节点名.端口名」降级命名,避免聚合后无法区分来源。
 */
export function computeCompositePorts(
  children: FlowNode[],
  edges: FlowEdge[],
  nodesById?: Map<string, FlowNode>,
): { inputs: PortDef[]; outputs: PortDef[] } {
  const ids = new Set(children.map((c) => c.id));
  const innerEdges = edges.filter((e) => ids.has(e.source) && ids.has(e.target));
  const inTargets = new Set(innerEdges.map((e) => `${e.target}:${e.targetHandle}`));
  const outSources = new Set(innerEdges.map((e) => `${e.source}:${e.sourceHandle}`));

  // 收集候选端口(嵌套组合时递归展平内层组合的聚合端口),先算出原始展示名,再处理重名
  const candidates: { kind: 'input' | 'output'; ref: string; name: string; node: FlowNode }[] = [];
  const collectChildPorts = (
    child: FlowNode,
    kind: 'input' | 'output',
    used: Set<string>,
  ) => {
    if (child.data?.composite && nodesById) {
      // 子节点是组合节点:递归计算其聚合端口,再前缀当前层 cid
      const subChildren = (child.data.composite.childIds ?? [])
        .map((cid) => nodesById.get(cid))
        .filter((x): x is FlowNode => !!x);
      const subPorts = computeCompositePorts(subChildren, edges, nodesById);
      const list = kind === 'input' ? subPorts.inputs : subPorts.outputs;
      for (const p of list) {
        const fullRef = encodeCompositePort(child.id, p.id);
        if (!used.has(`${child.id}:${p.id}`)) {
          candidates.push({ kind, ref: fullRef, name: p.name, node: child });
        }
      }
      return;
    }
    const list = kind === 'input' ? child.data.inputs : child.data.outputs;
    for (const p of list ?? []) {
      if (!used.has(`${child.id}:${p.id}`)) {
        candidates.push({
          kind,
          ref: encodeCompositePort(child.id, p.id),
          name: p.name,
          node: child,
        });
      }
    }
  };

  for (const child of children) {
    collectChildPorts(child, 'input', inTargets);
    collectChildPorts(child, 'output', outSources);
  }

  // 对每个方向内统计重名,重名的端口用「节点名.端口名」区分
  const disambiguate = (kind: 'input' | 'output'): PortDef[] => {
    const group = candidates.filter((c) => c.kind === kind);
    const nameCount = new Map<string, number>();
    for (const c of group) nameCount.set(c.name, (nameCount.get(c.name) ?? 0) + 1);
    return group.map((c) => {
      const dup = (nameCount.get(c.name) ?? 0) > 1;
      const name = dup && c.node.data.label ? `${c.node.data.label}.${c.name}` : c.name;
      return { id: c.ref, name };
    });
  };

  return { inputs: disambiguate('input'), outputs: disambiguate('output') };
}

/** 计算一组子节点的包围盒(用于展开态虚线框的定位与尺寸) */
export function computeCompositeBounds(
  children: FlowNode[],
  pad: number,
): { x: number; y: number; width: number; height: number } | null {
  if (!children.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of children) {
    const { w, h } = getNodeSize(c);
    minX = Math.min(minX, c.position.x);
    minY = Math.min(minY, c.position.y);
    maxX = Math.max(maxX, c.position.x + w);
    maxY = Math.max(maxY, c.position.y + h);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  return {
    x: minX - pad,
    y: minY - pad,
    width: maxX - minX + pad * 2,
    height: maxY - minY + pad * 2,
  };
}
