import { describe, expect, it } from 'vitest';
import { Position } from '@xyflow/react';
import { collectEdgeObstacles, computeEdgePath, type ObstacleRect } from '../edgePath';

const base = {
  sourceX: 0,
  sourceY: 0,
  sourcePosition: Position.Right,
  targetX: 400,
  targetY: 0,
  targetPosition: Position.Left,
};

describe('computeEdgePath', () => {
  it('无障碍时返回 React Flow 原生路径', () => {
    const r = computeEdgePath({ ...base, obstacles: [], edgeStyle: 'smoothstep' });
    expect(r.path).toBeTruthy();
    expect(r.path.startsWith('M')).toBe(true);
    expect(typeof r.labelX).toBe('number');
    expect(typeof r.labelY).toBe('number');
  });

  it('bezier 风格无障碍时返回弧线路径', () => {
    const r = computeEdgePath({ ...base, obstacles: [], edgeStyle: 'bezier' });
    expect(r.path).toContain('C');
  });

  it('直线穿过障碍时生成绕障路径', () => {
    // 障碍挡在 source→target 中段
    const obstacle: ObstacleRect = { x: 150, y: -60, width: 100, height: 120 };
    const r = computeEdgePath({ ...base, obstacles: [obstacle], edgeStyle: 'smoothstep', padding: 24 });
    expect(r.path).toBeTruthy();
    // 绕障路径不应完全贴在 y=0 直线上(应有绕行 y 偏移)
    const ys = r.path.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
    // path 坐标是成对 x,y;至少有一个明显偏离 0 的 y
    const hasDetour = ys.some((v, i) => i % 2 === 1 && Math.abs(v) > 24);
    expect(hasDetour).toBe(true);
  });

  it('bezier 风格直线穿障碍时也绕行', () => {
    const obstacle: ObstacleRect = { x: 150, y: -60, width: 100, height: 120 };
    const r = computeEdgePath({ ...base, obstacles: [obstacle], edgeStyle: 'bezier', padding: 24 });
    expect(r.path).toBeTruthy();
    expect(r.path).toContain('C');
  });

  // 回归:绕障 bezier 拼接时用 /M[^L]*L?/ 去第二段开头的 M,而 getBezierPath 输出不含 L,
  // [^L]* 把整段第二段吞光 → 连线终点悬空在半途(画布上表现为「线和端口断开」)。
  it('bezier 绕障路径必须完整连到 target(终点悬空回归用例)', () => {
    const obstacle: ObstacleRect = { x: 150, y: -60, width: 100, height: 120 };
    const r = computeEdgePath({ ...base, obstacles: [obstacle], edgeStyle: 'bezier', padding: 24 });
    const m = r.path.match(/(-?[\d.]+)[,\s]+(-?[\d.]+)\s*$/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeCloseTo(base.targetX);
    expect(Number(m![2])).toBeCloseTo(base.targetY);
  });

  it('smoothstep 绕障路径同样必须连到 target', () => {
    const obstacle: ObstacleRect = { x: 150, y: -60, width: 100, height: 120 };
    const r = computeEdgePath({ ...base, obstacles: [obstacle], edgeStyle: 'smoothstep', padding: 24 });
    const m = r.path.match(/(-?[\d.]+)[,\s]+(-?[\d.]+)\s*$/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeCloseTo(base.targetX);
    expect(Number(m![2])).toBeCloseTo(base.targetY);
  });

  it('障碍不在线上时走原生路径', () => {
    const obstacle: ObstacleRect = { x: 150, y: 200, width: 100, height: 100 };
    const smooth = computeEdgePath({ ...base, obstacles: [obstacle], edgeStyle: 'smoothstep' });
    const none = computeEdgePath({ ...base, obstacles: [], edgeStyle: 'smoothstep' });
    expect(smooth.path).toBe(none.path);
  });

  it('多个障碍命中时绕行并集包围盒,路径不穿任一障碍', () => {
    // 两个上下错开的障碍,原生路径都会命中
    const o1: ObstacleRect = { x: 120, y: -80, width: 80, height: 100 };
    const o2: ObstacleRect = { x: 220, y: -40, width: 80, height: 140 };
    const r = computeEdgePath({ ...base, obstacles: [o1, o2], edgeStyle: 'smoothstep', padding: 24 });
    expect(r.path).toBeTruthy();
    expect(r.path).not.toContain('NaN');
    // 并集: x:120~300, y:-80~100 → 绕行应避开两个障碍
    // 验证绕行 y 偏移足够大(> max bottom + padding)
    const ys = r.path.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
    const hasDetour = ys.some((v, i) => i % 2 === 1 && Math.abs(v) > 100);
    expect(hasDetour).toBe(true);
  });

  it('vertical 连线(source 在上、target 在下)也能绕障', () => {
    const vertical = {
      sourceX: 0,
      sourceY: 0,
      sourcePosition: Position.Bottom,
      targetX: 0,
      targetY: 400,
      targetPosition: Position.Top,
    };
    const obstacle: ObstacleRect = { x: -50, y: 150, width: 100, height: 100 };
    const r = computeEdgePath({ ...vertical, obstacles: [obstacle], edgeStyle: 'smoothstep', padding: 24 });
    expect(r.path).toBeTruthy();
  });

  it('负坐标与大 padding 不产生 NaN', () => {
    const r = computeEdgePath({
      sourceX: -200,
      sourceY: -200,
      sourcePosition: Position.Right,
      targetX: 200,
      targetY: 200,
      targetPosition: Position.Left,
      obstacles: [{ x: -50, y: -50, width: 100, height: 100 }],
      edgeStyle: 'smoothstep',
      padding: 40,
    });
    expect(r.path).not.toContain('NaN');
    expect(Number.isFinite(r.labelX)).toBe(true);
    expect(Number.isFinite(r.labelY)).toBe(true);
  });

  it('bezier 绕障是单段三次贝塞尔(回归:早年两段拼接会在中点留下拐角)', () => {
    const obstacle: ObstacleRect = { x: 150, y: -60, width: 100, height: 120 };
    const r = computeEdgePath({ ...base, obstacles: [obstacle], edgeStyle: 'bezier', padding: 24 });
    expect(r.path.match(/M/g)?.length).toBe(1);
    expect(r.path.match(/C/g)?.length).toBe(1);
  });

  it('bezier 绕障曲线方向连续:相邻切线夹角 < 90°(无折返拐点)', () => {
    const obstacle: ObstacleRect = { x: 150, y: -60, width: 100, height: 120 };
    const r = computeEdgePath({ ...base, obstacles: [obstacle], edgeStyle: 'bezier', padding: 24 });

    const nums = r.path.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
    const [sx, sy, c1x, c1y, c2x, c2y, tx, ty] = nums;
    const pts: Array<{ x: number; y: number }> = [];
    for (let i = 0; i <= 60; i++) {
      const t = i / 60;
      const mt = 1 - t;
      pts.push({
        x: mt ** 3 * sx + 3 * mt ** 2 * t * c1x + 3 * mt * t ** 2 * c2x + t ** 3 * tx,
        y: mt ** 3 * sy + 3 * mt ** 2 * t * c1y + 3 * mt * t ** 2 * c2y + t ** 3 * ty,
      });
    }
    let maxTurn = 0;
    for (let i = 1; i < pts.length - 1; i++) {
      const ax = pts[i].x - pts[i - 1].x;
      const ay = pts[i].y - pts[i - 1].y;
      const bx = pts[i + 1].x - pts[i].x;
      const by = pts[i + 1].y - pts[i].y;
      if (ax === 0 && ay === 0) continue;
      const angle = Math.abs(Math.atan2(ax * by - ay * bx, ax * bx + ay * by)) * (180 / Math.PI);
      maxTurn = Math.max(maxTurn, angle);
    }
    expect(maxTurn).toBeLessThan(90);
  });

  // 集成回归:真实调用链 collectEdgeObstacles → computeEdgePath。
  // 若把 target 自身也算障碍,则线会 100% 走绕障(弧线被拱成大弯),这里锁死「不绕」。
  it('集成:source / target 自身不算障碍,无第三者时走原生路径', () => {
    const nodes = [
      { id: 'A', position: { x: -230, y: -60 } },
      { id: 'B', position: { x: 400, y: -60 } },
    ];
    const obstacles = collectEdgeObstacles(nodes, 'A', 'B');
    expect(obstacles).toEqual([]);
    const r = computeEdgePath({ ...base, obstacles, edgeStyle: 'bezier', padding: 24 });
    const none = computeEdgePath({ ...base, obstacles: [], edgeStyle: 'bezier', padding: 24 });
    expect(r.path).toBe(none.path);
  });

  it('bezier 绕障曲线不压在障碍实体上,且标签落在曲线上', () => {
    const obstacle: ObstacleRect = { x: 150, y: -60, width: 100, height: 120 };
    const r = computeEdgePath({ ...base, obstacles: [obstacle], edgeStyle: 'bezier', padding: 24 });
    const nums = r.path.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
    const [sx, sy, c1x, c1y, c2x, c2y, tx, ty] = nums;
    // 采样:任意点都不应落在障碍矩形内(保守判定,取矩形本体)
    for (let i = 0; i <= 40; i++) {
      const t = i / 40;
      const mt = 1 - t;
      const x = mt ** 3 * sx + 3 * mt ** 2 * t * c1x + 3 * mt * t ** 2 * c2x + t ** 3 * tx;
      const y = mt ** 3 * sy + 3 * mt ** 2 * t * c1y + 3 * mt * t ** 2 * c2y + t ** 3 * ty;
      const inside =
        x >= obstacle.x && x <= obstacle.x + obstacle.width && y >= obstacle.y && y <= obstacle.y + obstacle.height;
      expect(inside).toBe(false);
    }
    // 标签取曲线 t=0.5 处,应明显偏离直线 y=0(确实在绕行段上)
    expect(Math.abs(r.labelY)).toBeGreaterThan(10);
  });

  // 回归:绕障弧线应「贴着」障碍走,而不是一路拱到障碍边缘外几十像素。
  // 早年实现直接用绕行通道坐标估算 bend(障碍边 + padding + 40 margin),曲线拱得太远,视觉「太激进」。
  it('绕障弧线贴近障碍、不过度外扩', () => {
    const obstacle: ObstacleRect = { x: 150, y: -60, width: 100, height: 120 };
    const r = computeEdgePath({ ...base, obstacles: [obstacle], edgeStyle: 'bezier', padding: 24 });
    // 障碍半高 60 + padding 24 + 小余量:曲线中点偏移应控制在此范围内,而不是拱得更高
    expect(Math.abs(r.labelY)).toBeLessThan(120);
    // 同时确实绕开了障碍本体(半高 60):中点应拱过 60
    expect(Math.abs(r.labelY)).toBeGreaterThan(60);
  });
});
