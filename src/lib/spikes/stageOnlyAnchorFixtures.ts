/**
 * Stage-only Y Anchor Spike fixtures。
 * 每个 fixture 描述**单个 Stage column** 内 assigned(已按 participant 行就位)
 * 与 stageOnly(待定位)的纵向模型;real_like 拆成真实图的两个列场景。
 * 仅供 spike 验证,不进入生产路径。
 */
import type { AnchorInput } from './stageOnlyAnchorSpike';

const asg = (id: string, y: number, h = 150): AnchorInput['assigned'][number] => ({ id, y, h });
const so = (id: string, h: number, origY: number, level?: number): AnchorInput['stageOnly'][number] => ({
  id,
  h,
  origY,
  level,
});

export interface AnchorFixture {
  name: string;
  input: () => AnchorInput;
  /** 该 fixture 期望:stageOnly 无 assigned 列(仅用于可读注释) */
  note?: string;
}

export const anchorFixtures: AnchorFixture[] = [
  {
    // Case 1:1 assigned + 1 stageOnly
    name: 'case1_1assigned_1stageOnly',
    input: () => ({ assigned: [asg('A', 80)], stageOnly: [so('C', 150, 700, 1)] }),
    note: 'assigned A(80..230);stageOnly C 高 150',
  },
  {
    // Case 2:2 assigned + 1 stageOnly
    name: 'case2_2assigned_1stageOnly',
    input: () => ({ assigned: [asg('A', 80), asg('B', 310)], stageOnly: [so('C', 150, 900, 1)] }),
    note: 'A(80..230),B(310..460) 行间仅 80px,容纳不下高 150 的 C',
  },
  {
    // Case 3:多个 assigned + 多个 stageOnly
    name: 'case3_multi_multi',
    input: () => ({
      assigned: [asg('A', 80), asg('B', 310)],
      stageOnly: [so('C1', 150, 900, 1), so('C2', 150, 1200, 2)],
    }),
  },
  {
    // Case 4:只有 stageOnly(该列无 assigned)
    name: 'case4_only_stageOnly',
    input: () => ({ assigned: [], stageOnly: [so('C1', 150, 500, 1), so('C2', 150, 900, 2)] }),
  },
  {
    // Case 5:A → C(拓扑相连,同一列)
    name: 'case5_A_to_C',
    input: () => ({
      assigned: [asg('A', 80)],
      stageOnly: [so('C', 150, 800, 1)],
      edges: [{ source: 'A', target: 'C' }],
    }),
  },
  {
    // Case 6:A → C → B(行间隙不足的固有冲突)
    name: 'case6_A_to_C_to_B',
    input: () => ({
      assigned: [asg('A', 80), asg('B', 310)],
      stageOnly: [so('C', 150, 900, 1)],
      edges: [
        { source: 'A', target: 'C' },
        { source: 'C', target: 'B' },
      ],
    }),
    note: 'C 高 150 放不进 A(底230)与 B(顶310)之间 → 下推后 C→B 成 Y-reverse,应记录',
  },
  {
    // Case 7:C 无任何边
    name: 'case7_no_edges',
    input: () => ({ assigned: [asg('A', 80)], stageOnly: [so('C', 150, 640, 1)] }),
  },
  {
    // Case 8:assigned 高大(stage column 视觉更“拥挤”)
    name: 'case8_tall_assigned',
    input: () => ({ assigned: [asg('A', 80, 320)], stageOnly: [so('C', 150, 760, 1)] }),
    note: 'A 占 80..400',
  },
  {
    // Case 9:多列(每列独立调用;断言互不污染)
    name: 'case9_multi_columns',
    input: () => ({
      assigned: [asg('A', 80)],
      stageOnly: [so('C', 150, 700, 1)],
    }),
  },
];

/** real_like 中“质检”列:无 assigned,两个 stageOnly(seed_4→g60uoi) */
export const realLikeQcColumn = (): AnchorInput => ({
  assigned: [],
  stageOnly: [so('seed_4', 211, 580, 1), so('g60uoi', 168, 798, 2)],
  edges: [{ source: 'seed_4', target: 'g60uoi' }],
});

/** real_like 中 “1” 列:assigned composite + stageOnly chvx9j(composite→chvx9j) */
export const realLikeG1Column = (): AnchorInput => ({
  assigned: [asg('composite', 80, 180)],
  stageOnly: [so('chvx9j', 168, 722, 1)],
  edges: [{ source: 'composite', target: 'chvx9j' }],
});
