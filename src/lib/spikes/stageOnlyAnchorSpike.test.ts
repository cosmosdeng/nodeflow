import { describe, expect, it } from 'vitest';
import {
  runAnchorSpike,
  formatOutcome,
  type AnchorInput,
  type AnchorResult,
} from './stageOnlyAnchorSpike';
import { anchorFixtures, realLikeQcColumn, realLikeG1Column } from './stageOnlyAnchorFixtures';

/** Spike:stageOnly × assigned 同列 Y Anchor 策略验证(不修改生产代码)。 */

const run10 = (input: AnchorInput): AnchorResult => {
  const first = runAnchorSpike(input);
  for (let i = 0; i < 9; i++) {
    const again = runAnchorSpike(input);
    for (const o of first.outcomes) {
      expect([...o.y.entries()].sort()).toEqual(
        [...again.outcomes.find((x) => x.strategy === o.strategy)!.y.entries()].sort(),
      );
    }
  }
  return first;
};

const by = (r: AnchorResult, s: string) => r.outcomes.find((o) => o.strategy === s)!;
const yOf = (r: AnchorResult, s: string, id: string) => by(r, s).y.get(id)!;

describe('Strategy 通用不变量', () => {
  it('所有策略均不创建虚拟 Participant / 不改语义(结构层保证)', () => {
    for (const f of [...anchorFixtures, { name: 'qc', input: realLikeQcColumn }, { name: 'g1', input: realLikeG1Column }]) {
      const r = runAnchorSpike(f.input());
      for (const o of r.outcomes) expect(o.virtualParticipantCreated).toBe(false);
    }
  });

  it('determinism:同一输入重复 10 次,四策略结果逐一相等', () => {
    for (const f of anchorFixtures) run10(f.input());
    run10(realLikeQcColumn());
    run10(realLikeG1Column());
  });
});

describe('Collision(目标 0)与碰撞来源', () => {
  it('case1-8:策略 B/C/D 全部零碰撞;A 在存在 assigned 时产生 assigned 碰撞', () => {
    for (const f of anchorFixtures) {
      const r = runAnchorSpike(f.input());
      for (const s of ['B', 'C', 'D'] as const) {
        expect(by(r, s).collisions, `${f.name}/${s}`).toBe(0);
      }
      const hasAssigned = f.input().assigned.length > 0;
      if (hasAssigned) expect(by(r, 'A').collisions, `${f.name}/A`).toBeGreaterThan(0);
      else expect(by(r, 'A').collisions, `${f.name}/A(仅 stageOnly)`).toBe(0);
    }
  });
});

describe('Topology violation(可记录,不作硬约束)', () => {
  it('case6(A→C→B,行间不足):B/C/D 下推后产生 1 个 Y-reverse 并记录;A 以碰撞换拓扑', () => {
    const f = anchorFixtures.find((x) => x.name === 'case6_A_to_C_to_B')!;
    const r = runAnchorSpike(f.input());
    expect(by(r, 'C').topologyViolations).toBe(1);
    expect(by(r, 'D').topologyViolations).toBe(1);
    expect(by(r, 'B').topologyViolations).toBe(1);
    expect(by(r, 'A').collisions).toBeGreaterThan(0); // A 顶部放置 → 与 assigned 碰撞
    expect(by(r, 'A').topologyViolations).toBe(0);
    // C 在 A(底230)+gap 之后、B(顶310)之前放不下 → 推到 assigned envelope 之后
    expect(yOf(r, 'C', 'C')).toBe(500);
    expect(yOf(r, 'D', 'C')).toBe(500);
  });

  it('case5(A→C):D 用拓扑锚定在 A 之后;case7(无边):D 与 C 完全一致', () => {
    const f5 = anchorFixtures.find((x) => x.name === 'case5_A_to_C')!;
    const r5 = runAnchorSpike(f5.input());
    expect(yOf(r5, 'D', 'C')).toBe(270); // A 底 230 + gap 40
    expect(by(r5, 'D').topologyViolations).toBe(0);

    const f7 = anchorFixtures.find((x) => x.name === 'case7_no_edges')!;
    const r7 = runAnchorSpike(f7.input());
    expect([...by(r7, 'D').y.entries()]).toEqual([...by(r7, 'C').y.entries()]);
  });

  it('case4(仅 stageOnly):A=C=D 顶部基准一致;B 使用间隙(带顶部 gap)不同', () => {
    const f = anchorFixtures.find((x) => x.name === 'case4_only_stageOnly')!;
    const r = runAnchorSpike(f.input());
    expect(yOf(r, 'A', 'C1')).toBe(80);
    expect(yOf(r, 'C', 'C1')).toBe(80);
    expect(yOf(r, 'D', 'C1')).toBe(80);
    expect(yOf(r, 'A', 'C2')).toBe(yOf(r, 'C', 'C2'));
    expect(yOf(r, 'B', 'C1')).toBe(120); // 独立基准 + lead gap 40
    expect(by(r, 'B').collisions).toBe(0);
  });
});

describe('Stage containment 与列隔离', () => {
  it('case9 + real_like:单列函数独立处理多列,结果不受其它列影响', () => {
    // 每列独立调用即为隔离(纯函数);此处确认“同列一次跑”与“拆开跑”一致
    const one = runAnchorSpike(anchorFixtures.find((x) => x.name === 'case9_multi_columns')!.input());
    expect(yOf(one, 'D', 'C')).toBe(270);
    const g1 = runAnchorSpike(realLikeG1Column());
    // "1" 列:composite(80..260) + chvx9j → 推荐策略 C/D 落在 260+40=300,无碰撞
    expect(yOf(g1, 'C', 'chvx9j')).toBe(300);
    expect(yOf(g1, 'D', 'chvx9j')).toBe(300);
    expect(by(g1, 'C').collisions).toBe(0);
    expect(by(g1, 'A').collisions).toBeGreaterThan(0); // 顶部堆叠会压到 composite
    // 质检列独立基准不受“1”列影响
    const qc = runAnchorSpike(realLikeQcColumn());
    expect(yOf(qc, 'C', 'seed_4')).toBe(80);
    expect(yOf(qc, 'C', 'g60uoi')).toBe(331);
    expect(by(qc, 'C').collisions).toBe(0);
  });
});

describe('指标报告(实际运行值)', () => {
  it('逐 case 输出四策略指标', () => {
    for (const f of anchorFixtures) {
      const r = runAnchorSpike(f.input());
      console.log(`[${f.name}]${f.note ? ' — ' + f.note : ''}`);
      for (const o of r.outcomes) console.log('  ' + formatOutcome(o));
    }
  });

  it('real_like:质检列与“1”列逐策略 y/位移', () => {
    const report = (name: string, input: () => AnchorInput) => {
      const r = runAnchorSpike(input());
      console.log(`[real_like ${name}]`);
      for (const o of r.outcomes) {
        const detail = [...o.y.entries()]
          .map(([id, y]) => `${id}: origY→${y}(Δ${Math.abs(y - input().stageOnly.find((s) => s.id === id)!.origY)})`)
          .join(' ');
        console.log(`  ${formatOutcome(o)} | ${detail}`);
      }
    };
    report('质检列', realLikeQcColumn);
    report('"1"列', realLikeG1Column);
  });
});
