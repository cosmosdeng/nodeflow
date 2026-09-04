import { describe, expect, it } from 'vitest';
import { resolveMatrixBandVisibility } from '../matrixBandVisibility';
import { computeElasticMatrixGeometry } from '../elasticBands';

/**
 * P1 fix 回归:Participant(Y/Who)与 Stage(X/When)是两个独立视觉轴,
 * Participant-only / Stage-only / 混合 / Free / Empty 与两个显示开关都必须独立生效。
 */

function geo(
  participantIds: string[],
  stageIds: string[],
  rects: { id: string; pid?: string; stage?: string; x: number; y: number }[],
) {
  return computeElasticMatrixGeometry({
    participants: participantIds.map((id) => ({ id })),
    stages: stageIds.map((id) => ({ id })),
    participantOrder: participantIds,
    stageOrder: stageIds,
    nodeRects: rects.map((r) => ({ id: r.id, pid: r.pid, stage: r.stage, rect: { x: r.x, y: r.y, w: 120, h: 60 } })),
  });
}

describe('Band 几何数据侧:两轴独立产生 band 结构', () => {
  it('Participant-only 节点 → 只有 Participant band,无 Stage band', () => {
    const g = geo(['P1'], [], [{ id: 'A', pid: 'P1', x: 100, y: 100 }]);
    expect(g.participantBands.map((b) => b.id)).toEqual(['P1']);
    expect(g.stageBands).toEqual([]);
  });

  it('Stage-only 节点 → 只有 Stage band,无 Participant band', () => {
    const g = geo([], ['S1'], [{ id: 'A', stage: 'S1', x: 100, y: 100 }]);
    expect(g.stageBands.map((b) => b.id)).toEqual(['S1']);
    expect(g.participantBands).toEqual([]);
  });

  it('P-only 与 S-only 节点混合 → 两轴 band 同时存在', () => {
    const g = geo(
      ['P1'],
      ['S1'],
      [
        { id: 'A', pid: 'P1', x: 100, y: 100 },
        { id: 'B', stage: 'S1', x: 500, y: 100 },
      ],
    );
    expect(g.participantBands.map((b) => b.id)).toEqual(['P1']);
    expect(g.stageBands.map((b) => b.id)).toEqual(['S1']);
  });

  it('Free-only 节点 → 两轴都无 band', () => {
    const g = geo([], [], [{ id: 'A', x: 100, y: 100 }]);
    expect(g.participantBands).toEqual([]);
    expect(g.stageBands).toEqual([]);
  });

  it('P1 修复现场:存在空参与方 A + stage-only 节点 → Stage band 必须非空产生', () => {
    // 复现 v0.4.0-next.1 人工场景:参与方 A 存在但无成员,节点只设了 Stage S1
    const g = geo(['A'], ['S1'], [{ id: 'n1', stage: 'S1', x: 400, y: 400 }]);
    const s1 = g.stageBands.find((b) => b.id === 'S1');
    expect(s1).toBeDefined();
    expect(s1!.isEmpty).toBe(false); // 有节点 => 应渲染竖带 body,而非只有 label
    const a = g.participantBands.find((b) => b.id === 'A');
    expect(a).toBeDefined();
    expect(a!.isEmpty).toBe(true); // 空参与方仅保留空行带
  });

  it('Empty Participant → 仍产生 empty Participant band', () => {
    const g = geo(['P1'], [], []);
    expect(g.participantBands).toHaveLength(1);
    expect(g.participantBands[0].isEmpty).toBe(true);
  });

  it('Empty Stage → 仍产生 empty Stage band', () => {
    const g = geo([], ['S1'], []);
    expect(g.stageBands).toHaveLength(1);
    expect(g.stageBands[0].isEmpty).toBe(true);
  });
});

describe('可见性判定:各开关组合独立生效(不得两轴联合门控)', () => {
  const vis = (participantBandCount: number, stageBandCount: number, sp: boolean, ss: boolean) =>
    resolveMatrixBandVisibility({
      participantBandCount,
      stageBandCount,
      showParticipantBands: sp,
      showStageBands: ss,
    });

  it('只有 Participant 数据:参与方带显示,Stage 带不因此出现', () => {
    // Stage 开关即便开启,无 Stage 数据也不产生 Stage 带
    expect(vis(1, 0, true, true)).toEqual({ participantOn: true, stageOn: false });
    expect(vis(1, 0, true, false)).toEqual({ participantOn: true, stageOn: false });
  });

  it('只有 Stage 数据:Stage 带显示,Participant 带不因此出现', () => {
    expect(vis(0, 1, true, true)).toEqual({ participantOn: false, stageOn: true });
    expect(vis(0, 1, false, true)).toEqual({ participantOn: false, stageOn: true });
  });

  it('P-only + S-only 混合(两轴各自有数据)→ 两轴同时显示', () => {
    expect(vis(1, 1, true, true)).toEqual({ participantOn: true, stageOn: true });
  });

  it('两轴都有数据:开关各自独立(全开/单开/全关)', () => {
    expect(vis(1, 1, false, false)).toEqual({ participantOn: false, stageOn: false });
    expect(vis(1, 1, true, false)).toEqual({ participantOn: true, stageOn: false });
    expect(vis(1, 1, false, true)).toEqual({ participantOn: false, stageOn: true });
  });

  it('Empty Participant / Empty Stage:band 结构存在即可显示(无需同时有另一轴)', () => {
    expect(vis(1, 0, true, true)).toEqual({ participantOn: true, stageOn: false });
    expect(vis(0, 1, true, true)).toEqual({ participantOn: false, stageOn: true });
  });
});
