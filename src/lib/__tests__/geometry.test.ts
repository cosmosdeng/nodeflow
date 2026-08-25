import { describe, expect, it } from 'vitest';
import type { FlowNode, Stage } from '../../types';
import { findStageEmptySpot, pushOutOfRect, rectOverlaps } from '../geometry';

function node(id: string, x: number, y: number, w = 100, h = 50): FlowNode {
  return {
    id,
    type: 'flow',
    position: { x, y },
    width: w,
    height: h,
    data: { label: id, description: '', actor: 'machine', locked: false, inputs: [], outputs: [] },
  } as FlowNode;
}

function stage(id: string, x: number, y: number, width: number, height: number): Stage {
  return { id, name: id, x, y, width, height, nodeIds: [] };
}

describe('lib/geometry 几何工具', () => {
  it('rectOverlaps:带间距重叠判定', () => {
    const rect = { x: 0, y: 0, width: 100, height: 50 };
    expect(rectOverlaps(10, 10, 50, 30, rect, 0)).toBe(true); // 内部
    expect(rectOverlaps(110, 10, 50, 30, rect, 0)).toBe(false); // 右侧外
    expect(rectOverlaps(110, 10, 50, 30, rect, 20)).toBe(true); // 间距 20 内仍重叠
  });

  it('pushOutOfRect:沿最小位移推出', () => {
    const rect = { x: 0, y: 0, width: 100, height: 50 };
    // 节点在 -10..40,部分在矩形左侧;最小位移是向左推到 x=-50(避开矩形右缘需 110,左推只需 40)
    const p = pushOutOfRect(-10, 10, 50, 30, rect, 0);
    expect(p.x).toBe(-50);
    expect(p.y).toBe(10);
  });

  it('findStageEmptySpot:避开已有节点与阶段域', () => {
    const n = node('a', 0, 0, 100, 50);
    const st = stage('s1', 200, 0, 100, 100);
    const spot = findStageEmptySpot(0, 0, 100, 50, [n], [st]);
    // 原位置 (0,0) 被节点 a 占据 → 向下找
    expect(spot.x).toBe(0);
    expect(spot.y).toBeGreaterThan(0);
  });

  it('findStageEmptySpot:空画布返回原位', () => {
    const spot = findStageEmptySpot(50, 50, 100, 50, [], []);
    expect(spot).toEqual({ x: 50, y: 50 });
  });
});
