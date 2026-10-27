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
 * 收集连线绕障用的障碍矩形:排除 hidden 节点,以及连线的 **source 与 target 自身**。
 * 未测量到尺寸时用 fallback(与节点默认宽高一致)。
 *
 * 为什么必须同时排除 target:连线的原生路径终点必然落在 target 节点(外扩 padding)内,
 * 若把 target 也算障碍,命中判定就**恒成立** —— 每条线都会被送去绕障,弧线全被拱成大弯,
 * 看起来「线很奇怪」。绕障只该为「穿过第三者节点」而触发。
 *
 * 抽成纯函数是为了能在组件外单测 —— 组件里若把「每次新建对象数组」直接塞进
 * zustand selector(哪怕套 useShallow),元素引用每次都变会导致快照不稳定,
 * 引发无限重渲染(白屏)。派生逻辑应放在组件外,用稳定引用 + useMemo 调用。
 */
export function collectEdgeObstacles(
  nodes: readonly ObstacleCandidate[],
  sourceId: string,
  targetId?: string,
  fallback: { width: number; height: number } = { width: 230, height: 120 },
): ObstacleRect[] {
  const rects: ObstacleRect[] = [];
  for (const n of nodes) {
    if (n.id === sourceId || n.id === targetId || n.hidden) continue;
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

/**
 * 端口出口方向是否符合「节点外 0°~180° 扇形」约束。
 *
 * 连线从端点出来,必须朝节点**外部**的方向走,不能直接扭进节点内部。
 * 以端口所在边中点为顶点、节点外法线为中心,覆盖 180° 的扇形即「合法出发方向」:
 * - Right 端口:初段必须往右(vx ≥ -ε),不得往左钻进节点;
 * - Left  端口:初段必须往左(vx ≤ ε);
 * - Top   端口:初段必须往上(vy ≤ ε);
 * - Bottom端口:初段必须往下(vy ≥ -ε)。
 *
 * 通过采样路径首点相对端点的位移近似初始切向。
 *
 * 注意:sampleSvgPath 的 samples[0] 恒等于端口起点本身(位移为 0),因此取**首个真正离开端口**
 * 的采样点(index 1);判断 target 端出口方向则取**终点前一个**采样点(index len-2),避免取到终点
 * 自身(位移为 0)导致误判。
 */
function portExitOk(
  fromX: number,
  fromY: number,
  fromPos: Position,
  path: string,
  fromEnd = false,
  perSegment = 8,
): boolean {
  const samples = sampleSvgPath(path, perSegment);
  if (samples.length < 2) return true;
  const p = fromEnd ? samples[samples.length - 2] : samples[1];
  const vx = p.x - fromX;
  const vy = p.y - fromY;
  switch (fromPos) {
    case Position.Right:
      return vx >= -1e-6;
    case Position.Left:
      return vx <= 1e-6;
    case Position.Top:
      return vy <= 1e-6;
    default:
      return vy >= -1e-6;
  }
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

  // 有障碍:生成绕障路径。
  // bezier 采用「温和避让」:若某条障碍就在端口近旁、必须从法线方向硬拱成巨弧才能避开,
  // 就**放弃绕障**回退原生路径(让线盖过节点) —— 否则弧线会激进出一个大弯。
  // 无论哪种绕障,都必须满足**端口出口扇形约束**(从端点往外走、不得扭进节点内部),
  // 若不满足也一律回退原生路径 —— 原生路径由 React Flow 生成,端口沿节点外法线出发,天然合规。
  let avoiding: PathResult | null;
  if (edgeStyle === 'bezier') {
    avoiding = buildBezierAvoiding(sourceX, sourceY, targetX, targetY, union, padding);
  } else {
    avoiding = buildSmoothAvoiding(sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, union, padding);
  }
  if (
    avoiding &&
    portExitOk(sourceX, sourceY, sourcePosition, avoiding.path) &&
    portExitOk(targetX, targetY, targetPosition, avoiding.path, true)
  ) {
    return avoiding;
  }
  return { path: nativePath, labelX: nativeLabelX, labelY: nativeLabelY };
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
 * 弧线绕障:用**单段**三次贝塞尔,把控制点拉到障碍一侧,使整条曲线拱出去绕开障碍。
 *
 * 早先的实现是「source→绕行中点」+「绕行中点→target」两段贝塞尔拼接:两段曲线在拼接点的
 * 切线方向由各自的 handle 朝向(midIn / midOut)决定,无法保证一致,拼接处必然出现可见的
 * 拐角 / 折返 —— 而标签与产物正好放在这个中点上,所以拐弯看起来就贴在连线说明旁边。
 * 单段三次贝塞尔整体 C1 连续,不存在拼接点,中点天然平滑。
 *
 * 外推量采用**采样驱动的最小搜索**:从很小的 bend 起步,采样生成曲线,只要仍压到障碍(带
 * padding)就逐步加大,直到「刚好」避开为止。这样曲线贴着障碍走,不会一路拱到障碍边缘外
 * 几十像素 —— 早年实现直接用绕行通道坐标估算 bend,把曲线拱得太远,视觉上「太激进」。
 *
 * 温和避让边界:若 bend 涨到「最大拱出量」仍无法避开(说明障碍就贴着端口,必须从法线方向
 * 硬拱成巨弧),返回 **null**,由调用方回退到原生路径 —— 让线盖过节点,而不是激进出大弯。
 */
function buildBezierAvoiding(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
  r: ObstacleRect,
  padding: number,
): PathResult | null {
  const dx = targetX - sourceX;
  const dy = targetY - sourceY;
  const horizontal = Math.abs(dx) >= Math.abs(dy);

  // 绕行方向:绕到障碍「远离 source」的一侧(障碍中心在 source 上方则向下绕,反之向上)
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  const dirY = sourceY >= cy ? -1 : 1;
  const dirX = sourceX >= cx ? -1 : 1;

  // 端口间距的一半,作为「允许的最大拱出量」:绕行不该超过这一半,
  // 否则弧线从法线方向硬拱出去,视觉上过于激进。
  const span = (Math.abs(dx) + Math.abs(dy)) / 2;
  const maxBend = Math.max(40, span);

  let bend = 24;
  let c1 = { x: sourceX, y: sourceY };
  let c2 = { x: targetX, y: targetY };
  let path = '';
  for (let i = 0; i < 32; i++) {
    if (horizontal) {
      c1 = { x: sourceX + dx * 0.35, y: sourceY + dirY * bend };
      c2 = { x: targetX - dx * 0.35, y: targetY + dirY * bend };
    } else {
      c1 = { x: sourceX + dirX * bend, y: sourceY + dy * 0.35 };
      c2 = { x: targetX + dirX * bend, y: targetY - dy * 0.35 };
    }
    // 温和避让:再拱就超过允许的巨弧 → 放弃绕障,让线盖过节点
    if (bend > maxBend) return null;
    path = `M ${sourceX},${sourceY} C ${c1.x},${c1.y} ${c2.x},${c2.y} ${targetX},${targetY}`;
    // 曲线避开障碍(带 padding)即停:找到最小的外推量,贴着障碍走
    if (!sampleSvgPath(path).some((p) => pointInRectPadded(p.x, p.y, r, padding))) break;
    bend *= 1.3;
  }

  // 标签放在曲线参数中点(t=0.5),即曲线真正走过的地方,而不是几何中点
  const labelX = (sourceX + 3 * c1.x + 3 * c2.x + targetX) / 8;
  const labelY = (sourceY + 3 * c1.y + 3 * c2.y + targetY) / 8;
  return { path, labelX, labelY };
}

/** 把折线点数组转成 smoothstep 风格的直角折线 SVG path */
function smoothPathString(points: Array<[number, number]>): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0]},${p[1]}`).join(' ');
}
