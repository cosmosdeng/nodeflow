import type { FlowEdge, FlowNode } from '../types';
import { getNodeSize } from './composite';

export type LayoutDirection = 'horizontal' | 'vertical';

export interface LayoutOptions {
  /** 节点间水平间距 */
  hGap?: number;
  /** 节点间垂直间距 */
  vGap?: number;
}

// 默认间距:主方向(横向布局的列距 / 竖向布局的行距)留足空间给连线 label 与中间产物
const DEFAULTS: Record<LayoutDirection, Required<LayoutOptions>> = {
  horizontal: { hGap: 260, vGap: 120 },
  vertical: { hGap: 120, vGap: 260 },
};

/**
 * 计算每个节点的拓扑层级(最长路径):
 * level[node] = max(依赖该节点的前驱的 level) + 1;无依赖为 0。
 * 环内节点通过 DFS 着色避免死循环,环内视为同一层。
 */
export function computeLevels(
  nodes: FlowNode[],
  edges: FlowEdge[],
): Map<string, number> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  // 邻接:node → 它的前驱(source 连到它)
  const indeg: Record<string, string[]> = {};
  for (const n of nodes) indeg[n.id] = [];
  for (const e of edges) {
    if (byId.has(e.source) && byId.has(e.target)) {
      if (e.source !== e.target) indeg[e.target] = [...(indeg[e.target] ?? []), e.source];
    }
  }
  const level = new Map<string, number>();
  const visiting = new Set<string>();
  const done = new Set<string>();

  const dfs = (id: string): number => {
    if (done.has(id)) return level.get(id) ?? 0;
    if (visiting.has(id)) return level.get(id) ?? 0; // 环:用当前层
    visiting.add(id);
    let max = 0;
    for (const pre of indeg[id] ?? []) {
      max = Math.max(max, dfs(pre) + 1);
    }
    visiting.delete(id);
    done.add(id);
    level.set(id, max);
    return max;
  };
  for (const n of nodes) dfs(n.id);
  return level;
}

/**
 * Barycenter 启发式:对每个拓扑层内的节点排序,使其邻居(相邻层连线两端)尽量对齐,
 * 减少连线交叉与斜穿,从而避免连线压到中间层节点。
 * 返回 id → 层内序号(0 为最靠前)。
 */
function computeBarycenterOrder(
  groups: Map<number, FlowNode[]>,
  levels: Map<string, number>,
  edges: FlowEdge[],
): Map<string, number> {
  const byId = new Map<string, FlowNode>();
  for (const g of groups.values()) for (const n of g) byId.set(n.id, n);

  // 邻接:node → 邻居 id 列表
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (byId.has(e.source) && byId.has(e.target) && e.source !== e.target) {
      if (!adj.has(e.source)) adj.set(e.source, []);
      if (!adj.has(e.target)) adj.set(e.target, []);
      adj.get(e.source)!.push(e.target);
      adj.get(e.target)!.push(e.source);
    }
  }

  const sortedLevels = [...groups.keys()].sort((a, b) => a - b);
  // 初始序号:每层按原 y/x 排序
  const order = new Map<string, number>();
  for (const lv of sortedLevels) {
    const group = groups.get(lv)!;
    [...group]
      .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x)
      .forEach((n, i) => order.set(n.id, i));
  }

  // 迭代:每层按「邻居在相邻层的序号均值」重新排序(稳定,平手保持原序)
  for (let iter = 0; iter < 10; iter++) {
    let changed = false;
    for (const lv of sortedLevels) {
      const group = groups.get(lv)!;
      const scored = group.map((n) => {
        const nbrs = (adj.get(n.id) ?? []).filter((x) => levels.get(x) !== lv);
        const sum = nbrs.reduce((acc, nb) => acc + (order.get(nb) ?? 0), 0);
        const bary = nbrs.length ? sum / nbrs.length : Number.MAX_SAFE_INTEGER;
        return { id: n.id, bary, prev: order.get(n.id) ?? 0 };
      });
      // 稳定排序:按 bary 升序,平手保持原序(prev)
      const stable = scored
        .map((s, idx) => ({ ...s, idx }))
        .sort((a, b) => a.bary - b.bary || a.prev - b.prev || a.idx - b.idx);
      stable.forEach((s, i) => {
        if (order.get(s.id) !== i) {
          order.set(s.id, i);
          changed = true;
        }
      });
    }
    if (!changed) break;
  }
  return order;
}

/**
 * 计算自动布局后的节点坐标。
 * 按拓扑层级分层:横向布局层级为列(从左到右),竖向布局层级为行(从上到下)。
 * 同层节点沿垂直(横向布局) / 水平(竖向布局)方向依次排列;用 barycenter 排序
 * 让相邻层节点尽量对齐,减少连线交叉与压到节点。
 */
export function computeLayout(
  nodes: FlowNode[],
  edges: FlowEdge[],
  direction: LayoutDirection,
  opts?: LayoutOptions,
): Map<string, { x: number; y: number }> {
  const { hGap, vGap } = { ...DEFAULTS[direction], ...opts };
  if (nodes.length === 0) return new Map();

  const levels = computeLevels(nodes, edges);
  // 按层分组
  const groups = new Map<number, FlowNode[]>();
  for (const n of nodes) {
    const lv = levels.get(n.id) ?? 0;
    if (!groups.has(lv)) groups.set(lv, []);
    groups.get(lv)!.push(n);
  }
  const sortedLevels = [...groups.keys()].sort((a, b) => a - b);

  // barycenter 排序确定每层内节点顺序
  const order = computeBarycenterOrder(groups, levels, edges);

  const result = new Map<string, { x: number; y: number }>();

  if (direction === 'horizontal') {
    // 每层为一列,列宽取该层最大节点宽;同层沿 y 依次堆叠
    let cursorX = 0;
    const colWidths = new Map<number, number>();
    for (const lv of sortedLevels) {
      const group = groups.get(lv)!;
      colWidths.set(lv, Math.max(...group.map((n) => getNodeSize(n).w)));
    }
    for (const lv of sortedLevels) {
      const group = groups.get(lv)!;
      const sorted = [...group].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
      let cursorY = 0;
      for (const n of sorted) {
        result.set(n.id, { x: cursorX, y: cursorY });
        cursorY += getNodeSize(n).h + vGap;
      }
      cursorX += colWidths.get(lv)! + hGap;
    }
  } else {
    // 每层为一行,行高取该层最大节点高;同层沿 x 依次排布
    let cursorY = 0;
    const rowHeights = new Map<number, number>();
    for (const lv of sortedLevels) {
      const group = groups.get(lv)!;
      rowHeights.set(lv, Math.max(...group.map((n) => getNodeSize(n).h)));
    }
    for (const lv of sortedLevels) {
      const group = groups.get(lv)!;
      const sorted = [...group].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
      let cursorX = 0;
      for (const n of sorted) {
        result.set(n.id, { x: cursorX, y: cursorY });
        cursorX += getNodeSize(n).w + hGap;
      }
      cursorY += rowHeights.get(lv)! + vGap;
    }
  }
  return result;
}
