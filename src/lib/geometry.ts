import type { FlowNode, Stage } from '../types';
import { getNodeSize } from './composite';

/** 矩形(流坐标) */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 判断矩形(在 nx,ny 处,尺寸 w×h)是否与矩形 rect(带间距 gap)重叠 */
export function rectOverlaps(nx: number, ny: number, w: number, h: number, rect: Rect, gap: number): boolean {
  const ox = nx < rect.x + rect.width + gap && nx + w > rect.x - gap;
  const oy = ny < rect.y + rect.height + gap && ny + h > rect.y - gap;
  return ox && oy;
}

/** 把一个矩形从矩形 rect 中沿最小位移方向推出(带间距 gap),返回新坐标 */
export function pushOutOfRect(nx: number, ny: number, w: number, h: number, rect: Rect, gap: number): { x: number; y: number } {
  const candidates = [
    { dx: rect.x + rect.width + gap - nx, dy: 0 },
    { dx: -(nx + w + gap - rect.x), dy: 0 },
    { dx: 0, dy: rect.y + rect.height + gap - ny },
    { dx: 0, dy: -(ny + h + gap - rect.y) },
  ];
  let best = candidates[0];
  let bestDist = Infinity;
  for (const c of candidates) {
    const dist = Math.abs(c.dx) + Math.abs(c.dy);
    if (dist < bestDist) {
      best = c;
      bestDist = dist;
    }
  }
  return { x: nx + best.dx, y: ny + best.dy };
}

/**
 * 在目标位置附近找一个不与任何可见节点 / 其他阶段域重合的空位(带间距),
 * 用于新建阶段域时避免覆盖已有内容。向下逐行寻找,超出行则向右移一列。
 */
export function findStageEmptySpot(
  x: number,
  y: number,
  w: number,
  h: number,
  nodes: readonly FlowNode[],
  stages: readonly Stage[],
): { x: number; y: number } {
  const GAP = 24;
  const obstacles: Rect[] = [
    ...nodes
      .filter((n) => !n.hidden)
      .map((n) => {
        const { w: nw, h: nh } = getNodeSize(n);
        return { x: n.position.x, y: n.position.y, width: nw, height: nh };
      }),
    ...stages.map((st) => ({ x: st.x, y: st.y, width: st.width, height: st.height })),
  ];
  let px = x;
  let py = y;
  for (let i = 0; i < 200; i++) {
    const hit = obstacles.some((o) => rectOverlaps(px, py, w, h, o, GAP));
    if (!hit) return { x: px, y: py };
    if (py < y + h * 4) {
      py += h + GAP; // 向下移一行
    } else {
      py = y; // 换到下一列
      px += w + GAP;
    }
  }
  return { x, y }; // 兜底:原位置
}

/**
 * 展开组合节点时,把与虚线框重叠的节点彻底推开:
 * 依次避让组合虚线框、其他节点 / 展开组合的矩形、以及外部连线产物(含保护区),
 * 迭代直到不再与任何障碍重叠(带迭代上限)。
 */
export function pushNodesAwayFromBox(
  nodes: readonly FlowNode[],
  compId: string,
  childSet: ReadonlySet<string>,
  box: Rect,
  pad: number,
  artifactRects: Rect[] = [],
): FlowNode[] {
  // 预计算每个节点(排除组合自身与内部子节点)的矩形,以及产物保护区
  const nodeRects = nodes
    .filter((n) => n.id !== compId && !childSet.has(n.id))
    .map((n) => ({ id: n.id, x: n.position.x, y: n.position.y, w: getNodeSize(n).w, h: getNodeSize(n).h }));

  const MAX = 8;
  const out = nodes.map((n) => {
    if (n.id === compId || childSet.has(n.id)) return n;
    const { w, h } = getNodeSize(n);
    let px = n.position.x;
    let py = n.position.y;
    for (let iter = 0; iter < MAX; iter++) {
      let moved = false;
      // 1) 避让组合虚线框(用 pad 间距)
      if (rectOverlaps(px, py, w, h, box, pad)) {
        const p = pushOutOfRect(px, py, w, h, box, pad);
        px = p.x;
        py = p.y;
        moved = true;
      }
      // 2) 避让其他节点 / 展开组合(排除自身),用 pad 一半作为安全间距
      for (const r of nodeRects) {
        if (r.id === n.id) continue;
        const g = Math.round(pad / 2);
        if (rectOverlaps(px, py, w, h, { x: r.x, y: r.y, width: r.w, height: r.h }, g)) {
          const p = pushOutOfRect(px, py, w, h, { x: r.x, y: r.y, width: r.w, height: r.h }, g);
          px = p.x;
          py = p.y;
          moved = true;
        }
      }
      // 3) 避让外部连线产物(含保护区)
      for (const r of artifactRects) {
        if (rectOverlaps(px, py, w, h, r, 0)) {
          const p = pushOutOfRect(px, py, w, h, r, 0);
          px = p.x;
          py = p.y;
          moved = true;
        }
      }
      if (!moved) break;
    }
    if (px === n.position.x && py === n.position.y) return n;
    return { ...n, position: { x: Math.round(px), y: Math.round(py) } };
  });
  return out;
}
