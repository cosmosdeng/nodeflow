import { getBezierPath, getSmoothStepPath, Position } from '@xyflow/react';

/** 障碍节点包围盒(世界坐标) */
export interface ObstacleRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** collectEdgeObstacles 需要的最小节点形状(便于测试与解耦 React Flow 类型) */
export interface ObstacleCandidate {
  id: string;
  hidden?: boolean;
  position: { x: number; y: number };
  measured?: { width?: number; height?: number };
}

/**
 * 收集连线绕障用的障碍矩形:排除 hidden 节点与 source 自身,target 及其它节点保留。
 * 未测量到尺寸时用 fallback(与节点默认宽高一致)。
 *
 * 抽成纯函数是为了能在组件外单测 —— 组件里若把「每次新建对象数组」直接塞进
 * zustand selector(哪怕套 useShallow),元素引用每次都变会导致快照不稳定,
 * 引发无限重渲染(白屏)。派生逻辑应放在组件外,用稳定引用 + useMemo 调用。
 */
export function collectEdgeObstacles(
  nodes: readonly ObstacleCandidate[],
  sourceId: string,
  fallback: { width: number; height: number } = { width: 230, height: 120 },
): ObstacleRect[] {
  const rects: ObstacleRect[] = [];
  for (const n of nodes) {
    if (n.id === sourceId || n.hidden) continue;
    rects.push({
      x: n.position.x,
      y: n.position.y,
      width: n.measured?.width ?? fallback.width,
      height: n.measured?.height ?? fallback.height,
    });
  }
  return rects;
}

export type EdgeStyleKind = 'smoothstep' | 'bezier';

interface ComputePathParams {
  sourceX: number;
  sourceY: number;
  sourcePosition: Position;
  targetX: number;
  targetY: number;
  targetPosition: Position;
  obstacles: ObstacleRect[];
  edgeStyle: EdgeStyleKind;
  /** 绕行时与障碍边缘保持的最小距离 */
  padding?: number;
}

interface PathResult {
  path: string;
  labelX: number;
  labelY: number;
}

/** 点是否落在矩形 r(外扩 padding)内 */
function pointInRectPadded(x: number, y: number, r: ObstacleRect, padding: number): boolean {
  return x >= r.x - padding && x <= r.x + r.width + padding && y >= r.y - padding && y <= r.y + r.height + padding;
}

/** 解析 SVG path 字符串,在每条子路径段上采样若干点。支持 M/L/C(直线与三次贝塞尔)。
 *  兼容 RF 输出的紧凑格式(M0 0L20 0)、逗号分隔与科学计数法。 */
function sampleSvgPath(path: string, perSegment = 8): Array<{ x: number; y: number }> {
  const samples: Array<{ x: number; y: number }> = [];
  const tokens = path.match(/[MLC]|-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/gi) ?? [];
  let i = 0;
  let cursor: { x: number; y: number } | null = null;
  const nextNum = (): number => {
    const n = Number(tokens[i++]);
    return Number.isFinite(n) ? n : NaN;
  };
  while (i < tokens.length) {
    const cmd = tokens[i++].toUpperCase();
    if (cmd === 'M') {
      const x = nextNum();
      const y = nextNum();
      if (!Number.isFinite(x) || !Number.isFinite(y)) break;
      cursor = { x, y };
      samples.push(cursor);
    } else if (cmd === 'L') {
      const x = nextNum();
      const y = nextNum();
      if (!cursor || !Number.isFinite(x) || !Number.isFinite(y)) break;
      const end = { x, y };
      for (let s = 1; s <= perSegment; s++) {
        const t = s / perSegment;
        samples.push({
          x: cursor.x + (end.x - cursor.x) * t,
          y: cursor.y + (end.y - cursor.y) * t,
        });
      }
      cursor = end;
    } else if (cmd === 'C') {
      const c1x = nextNum();
      const c1y = nextNum();
      const c2x = nextNum();
      const c2y = nextNum();
      const ex = nextNum();
      const ey = nextNum();
      if (!cursor || ![c1x, c1y, c2x, c2y, ex, ey].every(Number.isFinite)) break;
      for (let s = 1; s <= perSegment * 2; s++) {
        const t = s / (perSegment * 2);
        const mt = 1 - t;
        samples.push({
          x: mt * mt * mt * cursor.x + 3 * mt * mt * t * c1x + 3 * mt * t * t * c2x + t * t * t * ex,
          y: mt * mt * mt * cursor.y + 3 * mt * mt * t * c1y + 3 * mt * t * t * c2y + t * t * t * ey,
        });
      }
      cursor = { x: ex, y: ey };
    } else {
      // 未知命令:停止解析,避免错位
      break;
    }
  }
  return samples;
}

/**
 * 计算一条连线的 SVG 路径。
 *
 * 优先使用 React Flow 原生路径;若从 source 端口到 target 端口的路径会穿过
 * 任一中间障碍节点,则生成绕障路径:
 * - 多个障碍命中时,取其并集包围盒统一绕行,避免顾此失彼。
 * - smoothstep(直角线):折线绕到障碍一侧,与节点边缘保持最小距离(padding)。
 * - bezier(弧线):在障碍一侧插入中间绕行点,拐一个大一点的弯避开节点。
 */
export function computeEdgePath(params: ComputePathParams): PathResult {
  const { sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, obstacles, edgeStyle } = params;
  const padding = params.padding ?? 24;

  // 1. 先计算 React Flow 原生路径,再采样检测其是否穿过障碍(含 target 节点)。
  let nativePath: string;
  let nativeLabelX: number;
  let nativeLabelY: number;
  if (edgeStyle === 'bezier') {
    const [path, lx, ly] = getBezierPath({
      sourceX,
      sourceY,
      sourcePosition,
      targetX,
      targetY,
      targetPosition,
      curvature: 0.45,
    });
    nativePath = path;
    nativeLabelX = lx;
    nativeLabelY = ly;
  } else {
    const [path, lx, ly] = getSmoothStepPath({
      sourceX,
      sourceY,
      sourcePosition,
      targetX,
      targetY,
      targetPosition,
      borderRadius: 12,
    });
    nativePath = path;
    nativeLabelX = lx;
    nativeLabelY = ly;
  }

  // 采样原生路径上的点,找出所有被命中的障碍(带 padding)。
  const samples = sampleSvgPath(nativePath);
  const hits = obstacles.filter((r) => samples.some((p) => pointInRectPadded(p.x, p.y, r, padding)));

  // 无障碍遮挡:直接用原生路径
  if (hits.length === 0) {
    return { path: nativePath, labelX: nativeLabelX, labelY: nativeLabelY };
  }

  // 多个命中障碍取并集包围盒,统一绕行
  const union = unionRects(hits);

  // 有障碍:生成绕障路径
  return edgeStyle === 'bezier'
    ? buildBezierAvoiding(sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, union, padding)
    : buildSmoothAvoiding(sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, union, padding);
}

/** 计算一组矩形的并集包围盒 */
function unionRects(rects: ObstacleRect[]): ObstacleRect {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * 直角线绕障:smoothstep 风格,折线绕到障碍节点一侧,保持最小距离。
 *
 * 绕行侧选择:以 source→target 主方向为基准,把绕行通道放在障碍「远离 source」的外侧,
 * 使路径中段(及标签/产物所在处)不落在障碍(含 target 节点)上。
 */
function buildSmoothAvoiding(
  sourceX: number,
  sourceY: number,
  sourcePosition: Position,
  targetX: number,
  targetY: number,
  targetPosition: Position,
  r: ObstacleRect,
  padding: number,
): PathResult {
  const top = r.y;
  const bottom = r.y + r.height;
  const left = r.x;
  const right = r.x + r.width;

  // 根据 target 端口朝向决定绕行通道,并保证最后一段从端口侧进入而不横穿节点:
  // - 端口在左/右 → 绕到节点上方或下方,最后从端口侧水平进入
  // - 端口在上/下 → 绕到节点左侧或右侧,最后从端口侧垂直进入
  const passTop = sourceY < top - padding ? top - padding : bottom + padding;

  if (targetPosition === Position.Left || targetPosition === Position.Right) {
    const passY = passTop;
    const enterX = targetPosition === Position.Left ? targetX - padding : targetX + padding;
    const points: Array<[number, number]> = [
      [sourceX, sourceY],
      [sourceX, passY],
      [enterX, passY],
      [enterX, targetY],
      [targetX, targetY],
    ];
    return { path: smoothPathString(points), labelX: (sourceX + targetX) / 2, labelY: passY };
  }

  // 端口在上/下:绕到节点左侧或右侧
  const passLeft = sourceX < left - padding ? left - padding : right + padding;
  const passX = passLeft;
  const enterY = targetPosition === Position.Top ? targetY - padding : targetY + padding;
  const points: Array<[number, number]> = [
    [sourceX, sourceY],
    [passX, sourceY],
    [passX, enterY],
    [targetX, enterY],
    [targetX, targetY],
  ];
  return { path: smoothPathString(points), labelX: passX, labelY: (sourceY + targetY) / 2 };
}

/**
 * 弧线绕障:在障碍一侧插入中间绕行点,用两段贝塞尔拼接,拐大弯避开。
 */
function buildBezierAvoiding(
  sourceX: number,
  sourceY: number,
  sourcePosition: Position,
  targetX: number,
  targetY: number,
  targetPosition: Position,
  r: ObstacleRect,
  padding: number,
): PathResult {
  const midX = (sourceX + targetX) / 2;
  const midY = (sourceY + targetY) / 2;
  const cy = r.y + r.height / 2;
  const cx = r.x + r.width / 2;
  const dx = targetX - sourceX;
  const dy = targetY - sourceY;
  const horizontal = Math.abs(dx) >= Math.abs(dy);

  // 绕行点放到障碍「远离 source」的外侧,距离障碍较远以确保不遮
  let mid: { x: number; y: number };
  if (horizontal) {
    const passY = sourceY >= cy ? r.y - padding - 40 : r.y + r.height + padding + 40;
    mid = { x: midX, y: passY };
  } else {
    const passX = sourceX >= cx ? r.x - padding - 40 : r.x + r.width + padding + 40;
    mid = { x: passX, y: midY };
  }

  // 中间绕行点处,曲线的进出方向与 S→T 主方向垂直(让曲线「往外拐」)
  const midIn = horizontal
    ? mid.y < midY
      ? Position.Bottom
      : Position.Top
    : mid.x < midX
      ? Position.Right
      : Position.Left;
  const midOut = horizontal
    ? mid.y < midY
      ? Position.Top
      : Position.Bottom
    : mid.x < midX
      ? Position.Left
      : Position.Right;

  const [p1] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX: mid.x,
    targetY: mid.y,
    targetPosition: midIn,
    curvature: 0.35,
  });
  const [p2] = getBezierPath({
    sourceX: mid.x,
    sourceY: mid.y,
    sourcePosition: midOut,
    targetX,
    targetY,
    targetPosition,
    curvature: 0.35,
  });
  // 拼接两段 path:去掉第二段开头的「M + 坐标」,保留其后的曲线命令。
  // 不能用 /M[^L]*L?/ 一类写法 —— getBezierPath 输出形如「M0,0 C150,0 150,200 300,200」,
  // 不含 L 命令,[^L]* 会把整段第二段吞光,连线只剩前半截,视觉上「终点悬空」。
  const path = `${p1} ${p2.replace(/^M[-\d.,\s]+/, '')}`;
  return { path, labelX: mid.x, labelY: mid.y };
}

/** 把折线点数组转成 smoothstep 风格的直角折线 SVG path */
function smoothPathString(points: Array<[number, number]>): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0]},${p[1]}`).join(' ');
}
