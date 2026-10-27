import { describe, expect, it } from 'vitest';
import { collectEdgeObstacles, type ObstacleCandidate } from '../edgePath';

function node(id: string, x = 0, y = 0, extra: Partial<ObstacleCandidate> = {}): ObstacleCandidate {
  return { id, position: { x, y }, ...extra };
}

describe('collectEdgeObstacles(连线绕障障碍收集)', () => {
  it('排除 source 自身,保留 target 与其它节点', () => {
    const rects = collectEdgeObstacles([node('A'), node('B'), node('C')], 'A');
    expect(rects).toHaveLength(2);
    expect(rects[0]).toEqual({ x: 0, y: 0, width: 230, height: 120 });
  });

  it('排除 hidden 节点', () => {
    const rects = collectEdgeObstacles([node('A'), node('B', 0, 0, { hidden: true }), node('C')], 'A');
    expect(rects).toHaveLength(1);
  });

  it('已测量尺寸时用实测值,未测量用 fallback', () => {
    const rects = collectEdgeObstacles(
      [node('A'), node('B', 10, 20, { measured: { width: 300, height: 180 } }), node('C', 5, 6)],
      'A',
    );
    expect(rects[0]).toEqual({ x: 10, y: 20, width: 300, height: 180 });
    // 只测到宽 / 只测到高时,缺的维度回落到 fallback
    expect(rects[1]).toEqual({ x: 5, y: 6, width: 230, height: 120 });
  });

  it('自定义 fallback 生效', () => {
    const rects = collectEdgeObstacles([node('B')], 'A', { width: 100, height: 50 });
    expect(rects[0]).toEqual({ x: 0, y: 0, width: 100, height: 50 });
  });

  it('只有 source 时返回空数组(调用方据此回落到 EMPTY_OBSTACLES)', () => {
    expect(collectEdgeObstacles([node('A')], 'A')).toEqual([]);
    expect(collectEdgeObstacles([], 'A')).toEqual([]);
  });
});
