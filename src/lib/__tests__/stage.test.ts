import { describe, expect, it } from 'vitest';
import type { FlowNode, Stage } from '../../types';
import {
  addNodeToStage,
  boundsToStageBox,
  computeStageBounds,
  computeStageMembership,
  computeStageMinSize,
  detachNodeIdsFromStages,
  stageContainsNode,
} from '../stage';

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

function stage(id: string, x: number, y: number, width: number, height: number, nodeIds: string[] = []): Stage {
  return { id, name: id, x, y, width, height, nodeIds, selected: false };
}

describe('lib/stage 阶段域领域', () => {
  it('stageContainsNode:节点完全位于域内才归属', () => {
    const st = stage('s1', 0, 0, 200, 100);
    expect(stageContainsNode(st, 10, 10, 100, 50)).toBe(true); // 完全包含
    expect(stageContainsNode(st, -5, 10, 100, 50)).toBe(false); // 左越界
    expect(stageContainsNode(st, 10, 60, 100, 50)).toBe(false); // 下越界
  });

  it('computeStageMembership:可见节点按完全包含归属;hidden 跳过;一节点只属首个匹配域', () => {
    const st = stage('s1', 0, 0, 200, 200, []);
    const a = node('a', 10, 10, 100, 50); // 在域内
    const b = node('b', 500, 500, 100, 50); // 域外
    const c = node('c', 10, 10, 100, 50);
    c.hidden = true; // 隐藏不参与
    const owned = computeStageMembership([a, b, c], [st]);
    expect(owned.get('a')).toBe('s1');
    expect(owned.get('b')).toBeUndefined();
    expect(owned.get('c')).toBeUndefined();
  });

  it('detachNodeIdsFromStages:把指定节点从所有域中脱离', () => {
    const s1 = stage('s1', 0, 0, 100, 100, ['a', 'b']);
    const s2 = stage('s2', 0, 0, 100, 100, ['a', 'c']);
    const result = detachNodeIdsFromStages([s1, s2], ['a']);
    expect(result[0].nodeIds).toEqual(['b']);
    expect(result[1].nodeIds).toEqual(['c']);
    // 不修改原数组
    expect(s1.nodeIds).toEqual(['a', 'b']);
  });

  it('addNodeToStage:加入目标域(去重),从其它域移出', () => {
    const s1 = stage('s1', 0, 0, 100, 100, ['a']);
    const s2 = stage('s2', 0, 0, 100, 100, []);
    const result = addNodeToStage([s1, s2], 's2', 'a');
    expect(result[0].nodeIds).toEqual([]); // 从 s1 移出
    expect(result[1].nodeIds).toEqual(['a']); // 加入 s2
    // 已存在不重复添加
    const again = addNodeToStage([s2], 's2', 'a');
    expect(again[0].nodeIds).toEqual(['a']);
  });

  it('computeStageMinSize:最小尺寸覆盖所有归属可见节点(含内边距)', () => {
    const st = stage('s1', 0, 0, 100, 100, ['a', 'b']);
    const a = node('a', 100, 80, 100, 50); // 靠右下,使计算值超过默认最小尺寸
    const b = node('b', 20, 30, 80, 40);
    const { minW, minH } = computeStageMinSize(st, [a, b], 22);
    // a 右缘 100+100=200 +22 =222;b 右缘 20+80=100+22=122 → max=222
    expect(minW).toBe(222);
    // a 下缘 80+50=130+22=152;b 下缘 30+40=70+22=92 → max=152
    expect(minH).toBe(152);
  });

  it('computeStageBounds:计算归属可见节点包围盒;无可见节点返回 null', () => {
    const a = node('a', 10, 20, 100, 50);
    const b = node('b', 30, 40, 60, 30);
    const bounds = computeStageBounds(['a', 'b'], [a, b]);
    expect(bounds).not.toBeNull();
    expect(bounds!.minX).toBe(10);
    expect(bounds!.minY).toBe(20);
    expect(bounds!.maxX).toBe(110);
    expect(bounds!.maxY).toBe(70);
    expect(computeStageBounds(['ghost'], [a, b])).toBeNull();
  });

  it('boundsToStageBox:包围盒 + 内边距 → 域框', () => {
    const box = boundsToStageBox({ minX: 10, minY: 20, maxX: 110, maxY: 90 }, 22);
    expect(box).toEqual({ x: -12, y: -2, width: 100 + 44, height: 70 + 44 });
  });
});
