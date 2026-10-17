import { describe, expect, it } from 'vitest';
import type { FlowNode, Participant, Stage } from '../../types';
import { computeMatrixLayout, computeMatrixGridGeometry } from '../arrange';
import { classifyMatrixNode } from '../matrixClassification';
import { fixtures } from '../spikes/stageParticipantFixtures';

/**
 * Phase 3 — Stage-only Y Anchor 正式接入(computeMatrixLayout 内部)。
 * 策略:C Primary(After Assigned Envelope)+ D 窄化(predecessor/successor) + 只向下碰撞 + 回退 Primary。
 */

const part = (id: string): Participant => ({ id, name: id, type: 'person' });
const stg = (id: string, nodeIds: string[]): Stage => ({
  id,
  name: id,
  x: 0,
  y: 0,
  width: 300,
  height: 200,
  nodeIds,
});
const nd = (id: string, pid?: string, h = 150, x = 0, y = 0): FlowNode => ({
  id,
  type: 'flow',
  position: { x, y },
  width: 240,
  height: h,
  data: {
    label: id,
    description: '',
    actor: 'machine',
    locked: false,
    inputs: [],
    outputs: [],
    ...(pid ? { participantId: pid } : {}),
  },
});
const GAP = 40;
const lay = (o: {
  participants?: Participant[];
  participantOrder?: string[];
  stages?: Stage[];
  stageOrder?: string[];
  nodes: FlowNode[];
  edges?: { source: string; target: string }[];
}) =>
  computeMatrixLayout({
    nodes: o.nodes,
    participants: o.participants ?? [],
    participantOrder: o.participantOrder ?? [],
    stages: o.stages ?? [],
    stageOrder: o.stageOrder ?? [],
  });

const sameColNoOverlap = (pos: Map<string, { x: number; y: number }>, ids: string[], hOf: (id: string) => number) => {
  const rects = ids.filter((id) => pos.has(id)).map((id) => ({ id, y: pos.get(id)!.y, h: hOf(id) }));
  rects.sort((a, b) => a.y - b.y);
  for (let i = 1; i < rects.length; i++) {
    expect(rects[i].y, `overlap ${rects[i - 1].id}/${rects[i].id}`).toBeGreaterThanOrEqual(
      rects[i - 1].y + rects[i - 1].h,
    );
  }
};

describe('C Primary + D 窄化(单列矩阵场景)', () => {
  it('Case1 同列 assigned + stageOnly:stageOnly.y >= assigned.bottom + GAP', () => {
    const s1 = stg('s1', ['nA', 'X']);
    const pos = lay({
      participants: [part('p1')],
      participantOrder: ['p1'],
      stages: [s1],
      stageOrder: ['s1'],
      nodes: [nd('nA', 'p1'), nd('X', undefined)],
    });
    const a = pos.get('nA')!;
    expect(pos.get('X')!.y).toBeGreaterThanOrEqual(a.y + 150 + GAP);
    expect(pos.get('X')!.x).toBe(pos.get('nA')!.x); // 同属 s1 列
  });

  it('Case2 多个 assigned(不同 participant 行)+ stageOnly:位于 assigned envelope 底部 + GAP', () => {
    const s1 = stg('s1', ['nA', 'nB', 'X']);
    const pos = lay({
      participants: [part('p1'), part('p2')],
      participantOrder: ['p1', 'p2'],
      stages: [s1],
      stageOrder: ['s1'],
      nodes: [nd('nA', 'p1'), nd('nB', 'p2'), nd('X', undefined)],
    });
    const envBottom = Math.max(pos.get('nA')!.y + 150, pos.get('nB')!.y + 150);
    expect(pos.get('X')!.y).toBeGreaterThanOrEqual(envBottom + GAP);
  });

  it('Case3 多个 stageOnly:相邻间距 >= h[i-1] + GAP,彼此不重叠', () => {
    const s1 = stg('s1', ['X1', 'X2', 'X3']);
    const pos = lay({
      stages: [s1],
      stageOrder: ['s1'],
      nodes: [nd('X1', undefined), nd('X2', undefined), nd('X3', undefined)],
    });
    expect(pos.get('X1')!.y).toBeGreaterThanOrEqual(80); // 列独立起点
    for (const [p, c] of [
      ['X1', 'X2'],
      ['X2', 'X3'],
    ] as const) {
      expect(pos.get(c)!.y).toBeGreaterThanOrEqual(pos.get(p)!.y + 150 + GAP);
    }
    sameColNoOverlap(pos, ['X1', 'X2', 'X3'], () => 150);
  });

  it('Case4 只有 stageOnly:独立放置,不自动创建 participantId', () => {
    const s1 = stg('s1', ['X']);
    const nodeX = nd('X', undefined);
    const pos = lay({
      stages: [s1],
      stageOrder: ['s1'],
      nodes: [nodeX],
    });
    expect(pos.get('X')!.y).toBe(80); // columnStartY
    expect(nodeX.data?.participantId).toBeUndefined();
    expect(classifyMatrixNode(nodeX, { participants: [], stages: [s1] }).classification).toBe('stageOnly');
  });

  it('Case5 A→C:predecessor 偏好 → C.y = A.bottom + GAP', () => {
    const s1 = stg('s1', ['A', 'C']);
    const pos = lay({
      participants: [part('p1')],
      participantOrder: ['p1'],
      stages: [s1],
      stageOrder: ['s1'],
      nodes: [nd('A', 'p1'), nd('C', undefined)],
      edges: [{ source: 'A', target: 'C' }],
    });
    expect(pos.get('C')!.y).toBe(pos.get('A')!.y + 150 + GAP);
    expect(pos.get('C')!.x).toBe(pos.get('A')!.x);
  });

  it('Case6 A→C→B(assigned 行不足以容纳 C):只向下 push,不向上穿越;容忍 Y-reverse 不失败', () => {
    const s1 = stg('s1', ['A', 'B', 'C']);
    const pos = lay({
      participants: [part('p1'), part('p2')],
      participantOrder: ['p1', 'p2'],
      stages: [s1],
      stageOrder: ['s1'],
      nodes: [nd('A', 'p1'), nd('B', 'p2'), nd('C', undefined)],
      edges: [
        { source: 'A', target: 'C' },
        { source: 'C', target: 'B' },
      ],
    });
    // 绝不向上:不在 A 与 B 之间(该间隙不足),只能推到 assigned envelope 之后
    const bBottom = pos.get('B')!.y + 150;
    expect(pos.get('C')!.y).toBeGreaterThanOrEqual(bBottom + GAP);
    sameColNoOverlap(pos, ['A', 'B', 'C'], () => 150);
    // 语义(Participant 行序)不被破坏
    expect(pos.get('A')!.y).toBeLessThan(pos.get('B')!.y);
  });

  it('Case7 无边:回退 Primary(A.bottom + GAP)', () => {
    const s1 = stg('s1', ['A', 'C']);
    const pos = lay({
      participants: [part('p1')],
      participantOrder: ['p1'],
      stages: [s1],
      stageOrder: ['s1'],
      nodes: [nd('A', 'p1'), nd('C', undefined)],
    });
    expect(pos.get('C')!.y).toBe(pos.get('A')!.y + 150 + GAP);
  });

  it('Case8 tall assigned:绝不向上穿过 assigned', () => {
    const s1 = stg('s1', ['A', 'C']);
    const pos = lay({
      participants: [part('p1')],
      participantOrder: ['p1'],
      stages: [s1],
      stageOrder: ['s1'],
      nodes: [nd('A', 'p1', 320), nd('C', undefined)],
    });
    expect(pos.get('C')!.y).toBeGreaterThanOrEqual(pos.get('A')!.y + 320 + GAP);
  });
});

describe('T16 语义保护(矩阵场景,允许 Y-reverse)', () => {
  it('C(P3,S2)→B(P2,S3):Participant/Stage 顺序保持,不做语义交换;仅记录容忍', () => {
    const s1 = stg('s1', ['A']);
    const s2 = stg('s2', ['C']);
    const s3 = stg('s3', ['B']);
    const pos = lay({
      participants: [part('p1'), part('p2'), part('p3')],
      participantOrder: ['p1', 'p2', 'p3'],
      stages: [s1, s2, s3],
      stageOrder: ['s1', 's2', 's3'],
      nodes: [nd('A', 'p1'), nd('B', 'p2'), nd('C', 'p3')],
      edges: [
        { source: 'A', target: 'C' },
        { source: 'C', target: 'B' },
      ],
    });
    expect(pos.get('A')!.x).toBeLessThan(pos.get('C')!.x);
    expect(pos.get('C')!.x).toBeLessThan(pos.get('B')!.x); // Stage X 单调
    expect(pos.get('A')!.y).toBeLessThan(pos.get('B')!.y);
    expect(pos.get('B')!.y).toBeLessThan(pos.get('C')!.y); // Participant Y 单调(P1<P2<P3)
    // C.y > B.y 的 Y-reverse 是本测试允许的拓扑冲突,断言不做失败 —— 这里仅确认不破坏行序
  });
});

describe('real_like 回归(stageOnly 不重叠、不进 free corner、真 free 不变)', () => {
  const input = fixtures.find((f) => f.name === 'real_like')!.input();
  const pos = computeMatrixLayout({
    nodes: input.nodes,
    participants: input.participants,
    participantOrder: input.participantOrder,
    stages: input.stages,
    stageOrder: input.stageOrder,
  });
  const geo = computeMatrixGridGeometry({
    nodes: input.nodes,
    participants: input.participants,
    participantOrder: input.participantOrder,
    stages: input.stages,
    stageOrder: input.stageOrder,
  });
  const cls = (id: string) =>
    classifyMatrixNode(
      input.nodes.find((n) => n.id === id)!,
      {
        participants: input.participants,
        stages: input.stages,
      },
    ).classification;
  const hOf = (id: string) => input.nodes.find((n) => n.id === id)!.height ?? 150;

  it('stageOnly 进入正确 Stage 列,classification !== free', () => {
    const cols = geo.structure.cols;
    for (const [id, expectCol] of [
      ['seed_4', 'qc'],
      ['g60uoi', 'qc'],
      ['chvx9j', 'g1'],
    ] as const) {
      expect(cls(id)).toBe('stageOnly');
      expect(pos.has(id)).toBe(true);
      const c = cols.indexOf(expectCol);
      expect(pos.get(id)!.x).toBe(geo.colXs[c] + 24);
    }
  });

  it('同列 stageOnly 与 assigned 均不重叠', () => {
    sameColNoOverlap(pos, ['composite', 'chvx9j'], hOf); // g1 列
    sameColNoOverlap(pos, ['seed_4', 'g60uoi'], hOf); // qc 列(纯 stageOnly)
    // chvx9j 在 g1 列 assigned(composite)envelope 之后(临时规则已被正式 Anchor 取代)
    expect(pos.get('chvx9j')!.y).toBeGreaterThanOrEqual(pos.get('composite')!.y + hOf('composite') + GAP);
  });

  it('node5dd(真 free)不再被弹到(398,464)角落', () => {
    const p = pos.get('node5dd');
    // 保持原样 或 仅走既有 free handling;绝不复现 stageOnly 时代弹角坐标
    if (p) expect([p.x, p.y]).not.toEqual([398, 464]);
    else expect(cls('node5dd')).toBe('free');
  });

  it('geometric invariants:同一 Stage 列内部节点纵向不重叠;语义不变', () => {
    const idToPos = new Map(pos);
    for (const st of input.stages) {
      const members = st.nodeIds.filter((id) => idToPos.has(id));
      sameColNoOverlap(idToPos, members, hOf);
    }
    expect(input.stageOrder).toEqual(['qc', 'g1']);
    const pIds = input.nodes.map((n) => n.data?.participantId).filter(Boolean);
    expect(new Set(pIds)).toEqual(new Set(['pA']));
  });
});

describe('determinism', () => {
  it('real_like 同输入重复执行得到相同坐标', () => {
    const run = () => {
      const input = fixtures.find((f) => f.name === 'real_like')!.input();
      return computeMatrixLayout({
        nodes: input.nodes,
        participants: input.participants,
        participantOrder: input.participantOrder,
        stages: input.stages,
        stageOrder: input.stageOrder,
      });
    };
    const a = run();
    const b = run();
    expect([...a.entries()]).toEqual([...b.entries()]);
  });
});
