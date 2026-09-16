import { describe, expect, it, beforeAll } from 'vitest';
import { fixtures } from './stageParticipantFixtures';
import { runSpike, spikeConstants, classifyNodes, type SpikeResult } from './stageParticipantArrangeSpike';

/**
 * Spike 验证(不修改生产算法):
 *   策略 = 统一 X=Stage 列 / Y=Participant 行 + 四类按轴独立分类 + topology 次级排序 + free 局部避让。
 * 断言聚焦策略成立性,数值断言语义化、不追求优化器式精确值。
 */

const START_Y = spikeConstants.START_Y;

const results = new Map<string, SpikeResult>();
beforeAll(() => {
  for (const f of fixtures) results.set(f.name, runSpike(f.input()));
});

const pos = (id: string) => results.get('real_like')!.spike.get(id)!;

function clsOf(name: string) {
  return (id: string) => results.get(name)!.classified.get(id);
}

describe('Spike:统一分类(按轴独立)', () => {
  it('01_basic:nA/nB=assigned,nFree=free', () => {
    expect(clsOf('01_basic')('nA')).toBe('assigned');
    expect(clsOf('01_basic')('nB')).toBe('assigned');
    expect(clsOf('01_basic')('nFree')).toBe('free');
  });

  it('04_stage_only:qc*/host 全部按轴分类,stageOnly 不进 free', () => {
    expect(clsOf('04_stage_only')('qc1')).toBe('stageOnly');
    expect(clsOf('04_stage_only')('qc2')).toBe('stageOnly');
    expect(clsOf('04_stage_only')('qc3')).toBe('stageOnly');
    expect(clsOf('04_stage_only')('host')).toBe('assigned');
    const m = results.get('04_stage_only')!.metrics;
    expect(m.stageOnlyMisclassified).toEqual([]);
  });

  it('05_row_only:nR/nB 有 pid 无 stage → rowOnly(不是 free)', () => {
    expect(clsOf('05_row_only')('nA')).toBe('assigned');
    expect(clsOf('05_row_only')('nR')).toBe('rowOnly');
    expect(clsOf('05_row_only')('nB')).toBe('rowOnly');
  });

  it('09_gateway:gIn(有 stage)→stageOnly,gOut(两者皆无)→free', () => {
    expect(clsOf('09_gateway')('gIn')).toBe('stageOnly');
    expect(clsOf('09_gateway')('gOut')).toBe('free');
  });

  it('real_like:seed_4/chvx9j/g60uoi = stageOnly,composite = assigned;composite child 排除', () => {
    const cls = results.get('real_like')!.classified;
    expect(cls.get('seed_4')).toBe('stageOnly');
    expect(cls.get('chvx9j')).toBe('stageOnly');
    expect(cls.get('g60uoi')).toBe('stageOnly');
    expect(cls.get('composite')).toBe('assigned');
    expect(cls.has('seed_2')).toBe(false); // child 不在 arrange scope
    expect(cls.has('seed_3')).toBe(false);
  });
});

describe('Spike:X = Stage 列 / Y = Participant 行', () => {
  it('03_cross_participant:handoff 链 x/y 均随语义序', () => {
    const s = results.get('03_cross_participant')!.spike;
    expect(s.get('A')!.x).toBeLessThan(s.get('B')!.x);
    expect(s.get('B')!.x).toBeLessThan(s.get('C')!.x);
    expect(s.get('A')!.y).toBeLessThan(s.get('B')!.y); // p1→p2→p3
    expect(s.get('B')!.y).toBeLessThan(s.get('C')!.y);
    expect(results.get('03_cross_participant')!.metrics.stageAxisAligned).toBe(true);
    expect(results.get('03_cross_participant')!.metrics.participantAxisAligned).toBe(true);
  });

  it('07_split:分支同 cell 纵向堆叠不反向,汇点列更靠右', () => {
    const s = results.get('07_split')!.spike;
    // b1/b2 同 (p2,s2)
    expect(s.get('b1')!.x).toBe(s.get('b2')!.x);
    expect(s.get('b1')!.y).toBeLessThan(s.get('b2')!.y);
    expect(s.get('GW')!.x).toBeLessThan(s.get('b1')!.x);
    expect(s.get('M')!.x).toBeGreaterThan(s.get('b2')!.x);
    expect(results.get('07_split')!.metrics.xOrderSatisfied).toBe(1);
  });

  it('08_merge:两分支同 cell、M 在其参与方行的下游列', () => {
    const s = results.get('08_merge')!.spike;
    expect(s.get('b1')!.x).toBe(s.get('b2')!.x);
    expect(s.get('b1')!.y).toBeLessThan(s.get('b2')!.y);
    expect(s.get('M')!.x).toBeGreaterThan(s.get('b1')!.x);
    expect(s.get('M')!.y).toBeGreaterThan(s.get('b1')!.y); // p2 在 p1 下方
  });

  it('02_same_cell:同 cell 内按拓扑层不反向', () => {
    const s = results.get('02_same_cell')!.spike;
    expect(s.get('nIn1')!.x).toBe(s.get('nOut')!.x);
    expect(s.get('nIn1')!.y).toBeLessThan(s.get('nMid')!.y);
    expect(s.get('nMid')!.y).toBeLessThan(s.get('nOut')!.y);
  });

  it('05_row_only:rowOnly 留在其 participant 行内', () => {
    const s = results.get('05_row_only')!.spike;
    expect(clsOf('05_row_only')('nR')).toBe('rowOnly');
    expect(s.get('nR')!.y).toBeGreaterThanOrEqual(START_Y);
    expect(s.get('nR')!.y).toBeLessThan(s.get('nB')!.y); // p1 行在 p2 行上方
  });
});

describe('Spike:stageOnly 进其 Stage 列并被列带包住', () => {
  it('04_stage_only:qc1/qc2 在 s1 列、qc3 在 s2 列;host 也在 s2', () => {
    const s = results.get('04_stage_only')!.spike;
    const m = results.get('04_stage_only')!.metrics;
    // s1 列左缘 = START_X;s2 列必然更靠右
    expect(s.get('qc1')!.x).toBe(s.get('qc2')!.x);
    expect(s.get('qc3')!.x).toBe(s.get('host')!.x);
    expect(s.get('qc3')!.x).toBeGreaterThan(s.get('qc1')!.x);
    expect(m.stageOnlyInColumns.sort()).toEqual(['qc1', 'qc2', 'qc3']);
    expect(m.stageAxisAligned).toBe(true);
  });

  it('real_like:seed_4/chvx9j/g60uoi 全部进入对应 stage 列(不再 free)', () => {
    const m = results.get('real_like')!.metrics;
    expect(m.stageOnlyMisclassified).toEqual([]);
    expect(m.stageOnlyInColumns.sort()).toEqual(['chvx9j', 'g60uoi', 'seed_4']);
    // 质检列内:seed_4 在上、其下游 g60uoi 在下(同列拓扑序)
    expect(pos('seed_4').x).toBe(pos('g60uoi').x);
    expect(pos('seed_4').y).toBeLessThan(pos('g60uoi').y);
    expect(m.stageAxisAligned).toBe(true);
    expect(m.participantAxisAligned).toBe(true);
  });
});

describe('Spike:free 局部避让(不无理由弹矩阵角落)', () => {
  it('06_free:远端 free 保持原样;近处仅小幅避让', () => {
    const m = results.get('06_free')!.metrics;
    expect(m.freeKept).toContain('far');
    const mv = m.freeMoves.find((x) => x.id === 'edgeFree');
    expect(mv).toBeDefined();
    expect(mv!.dist).toBeLessThan(300); // 局部小幅,而非弹到上千像素外
  });

  it('real_like:轻微压行带的 node5dd 只做小幅避让、不逆流弹到上游', () => {
    const m = results.get('real_like')!.metrics;
    const mv = m.freeMoves.find((x) => x.id === 'node5dd');
    expect(mv).toBeDefined();
    expect(mv!.dist).toBeLessThan(120);
    // 保持 x(不逆流弹到上游侧);只作纵向小幅离带
    expect(Math.abs(mv!.to.x - mv!.from.x)).toBeLessThan(10);
  });

  it('real_like:其它远离行列带的 free 全部保持原位', () => {
    const m = results.get('real_like')!.metrics;
    for (const kept of m.freeKept) expect(clsOf('real_like')(kept)).toBe('free');
  });
});

describe('Spike:T16 硬约束冲突显式报告', () => {
  it('10_T16_conflict:X 单调保持(列序),行语义不偷换;y 反向显式记录为 EXPECTED CONFLICT', () => {
    const s = results.get('10_T16_conflict')!.spike;
    const m = results.get('10_T16_conflict')!.metrics;
    // A(P1,S1) < C(P3,S2) < B(P2,S3):列序 x 单调
    expect(s.get('A')!.x).toBeLessThan(s.get('C')!.x);
    expect(s.get('C')!.x).toBeLessThan(s.get('B')!.x);
    // participantOrder P1<P2<P3 仍是 Y 硬约束(A 在 B 上,B 在 C 上)
    expect(s.get('A')!.y).toBeLessThan(s.get('B')!.y);
    expect(s.get('B')!.y).toBeLessThan(s.get('C')!.y);
    expect(m.xConflicts).toEqual([]);
    // C(P3)→B(P2) 是回上游行的 handoff:必产生一个 y-reverse —— 显式记录而非偷偷改行序
    const cy = m.yConflicts.filter((c) => c.kind === 'y-reverse');
    expect(cy.length).toBe(1);
    expect(cy[0].source).toBe('C');
    expect(cy[0].target).toBe('B');
    // 语义未被修改:participant/stage 名单与顺序保持
    const input = fixtures.find((f) => f.name === '10_T16_conflict')!.input();
    expect(input.participantOrder).toEqual(['p1', 'p2', 'p3']);
    expect(input.stageOrder).toEqual(['s1', 's2', 's3']);
  });
});

describe('Spike:确定性与输出概览', () => {
  it('同输入重复执行结果一致(纯函数)', () => {
    for (const name of ['04_stage_only', 'real_like']) {
      const a = runSpike(fixtures.find((f) => f.name === name)!.input());
      const b = runSpike(fixtures.find((f) => f.name === name)!.input());
      expect([...a.spike.entries()]).toEqual([...b.spike.entries()]);
    }
  });

  it('report:输出每个 fixture 的分类统计与方向满足率', () => {
    for (const f of fixtures) {
      const r = results.get(f.name)!;
      const c = { assigned: 0, rowOnly: 0, stageOnly: 0, free: 0 } as Record<string, number>;
      for (const k of r.classified.values()) c[k] += 1;
      const m = r.metrics;
      console.log(
        `[${f.name}] ${JSON.stringify(c)} | xOrder=${(m.xOrderSatisfied * 100).toFixed(0)}% | xReverse=${m.xConflicts.length} yReverse=${m.yConflicts.length} | stageOnlyInCol=${m.stageOnlyInColumns.length} mis=${m.stageOnlyMisclassified.length} | freeMoved=${m.freeMoves.length} kept=${m.freeKept.length}`,
      );
    }
  });
});

describe('Spike:入口安全', () => {
  it('classifyNodes 顶层导出可独立使用且不改输入', () => {
    const input = fixtures.find((f) => f.name === 'real_like')!.input();
    const before = JSON.stringify(input.nodes);
    const cls = classifyNodes(input);
    expect(cls.size).toBeGreaterThan(0);
    expect(JSON.stringify(input.nodes)).toBe(before);
    expect([...cls.values()].every((v) => ['assigned', 'rowOnly', 'stageOnly', 'free'].includes(v))).toBe(true);
  });
});
