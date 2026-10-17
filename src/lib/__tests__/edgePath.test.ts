import { describe, expect, it } from 'vitest';
import { Position } from '@xyflow/react';
import { computeEdgePath, type ObstacleRect } from '../edgePath';

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
});
