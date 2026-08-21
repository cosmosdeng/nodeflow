import type { FlowEdge, FlowNode, PortDef } from '../types';

/** 组合端口引用编码前缀 */
export const COMPOSITE_PREFIX = 'cid:';
/** 展开态虚线框的内边距 */
export const COMPOSITE_PAD = 36;

/** 将子节点端口编码为组合节点上的端口引用 */
export function encodeCompositePort(childNodeId: string, portId: string): string {
  return `${COMPOSITE_PREFIX}${childNodeId}:${portId}`;
}

/** 解码组合端口引用,还原出子节点与端口 */
export function decodeCompositePort(
  ref: string | null | undefined,
): { nodeId: string; portId: string } | null {
  if (!ref || !ref.startsWith(COMPOSITE_PREFIX)) return null;
  const rest = ref.slice(COMPOSITE_PREFIX.length);
  const idx = rest.indexOf(':');
  if (idx < 0) return null;
  return { nodeId: rest.slice(0, idx), portId: rest.slice(idx + 1) };
}

/** 是否为组合端口引用 */
export function isCompositePort(ref: string | null | undefined): boolean {
  return !!ref && ref.startsWith(COMPOSITE_PREFIX);
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
export function computeCompositePorts(
  children: FlowNode[],
  edges: FlowEdge[],
): { inputs: PortDef[]; outputs: PortDef[] } {
  const ids = new Set(children.map((c) => c.id));
  const innerEdges = edges.filter((e) => ids.has(e.source) && ids.has(e.target));
  const inTargets = new Set(innerEdges.map((e) => `${e.target}:${e.targetHandle}`));
  const outSources = new Set(innerEdges.map((e) => `${e.source}:${e.sourceHandle}`));

  const inputs: PortDef[] = [];
  const outputs: PortDef[] = [];
  for (const child of children) {
    for (const p of child.data.inputs ?? []) {
      if (!inTargets.has(`${child.id}:${p.id}`)) {
        inputs.push({ id: encodeCompositePort(child.id, p.id), name: p.name });
      }
    }
    for (const p of child.data.outputs ?? []) {
      if (!outSources.has(`${child.id}:${p.id}`)) {
        outputs.push({ id: encodeCompositePort(child.id, p.id), name: p.name });
      }
    }
  }
  return { inputs, outputs };
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
