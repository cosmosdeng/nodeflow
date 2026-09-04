import { describe, expect, it } from 'vitest';
import {
  computeMatrixGridGeometry,
  computeMatrixGridStructure,
  computeMatrixLayout,
} from '../arrange';
import type { FlowNode, Participant, Stage } from '../../types';

/**
 * Shared Matrix 语义序/几何契约(2026-09:无「未分配」尾行/尾列)
 *
 * 覆盖:participantOrder / stageOrder / unlisted append / empty / 游离节点分类
 * (无有效 participant 或无 stage membership)/ deterministic / 不改输入 /
 * 与 arrange 输出位置单调一致。
 */

const node = (id: string, participantId?: string, x = 0, y = 0): FlowNode => ({
  id,
  type: 'flow',
  position: { x, y },
  data: {
    label: id,
    description: '',
    actor: 'machine',
    locked: false,
    inputs: [],
    outputs: [],
    ...(participantId ? { participantId } : {}),
  },
});

const participant = (id: string, name = id): Participant => ({ id, name, type: 'person' });
const stage = (id: string, nodeIds: string[] = []): Stage => ({
  id,
  name: id,
  x: 0,
  y: 0,
  width: 300,
  height: 200,
  nodeIds,
});

const structure = (o: {
  nodes?: FlowNode[];
  participants?: Participant[];
  participantOrder?: string[];
  stages?: Stage[];
  stageOrder?: string[];
}) =>
  computeMatrixGridStructure({
    nodes: o.nodes ?? [],
    participants: o.participants ?? [],
    participantOrder: o.participantOrder ?? [],
    stages: o.stages ?? [],
    stageOrder: o.stageOrder ?? [],
  });

const geometry = (o: {
  nodes?: FlowNode[];
  participants?: Participant[];
  participantOrder?: string[];
  stages?: Stage[];
  stageOrder?: string[];
}) =>
  computeMatrixGridGeometry({
    nodes: o.nodes ?? [],
    participants: o.participants ?? [],
    participantOrder: o.participantOrder ?? [],
    stages: o.stages ?? [],
    stageOrder: o.stageOrder ?? [],
  });

describe('shared matrix grid structure', () => {
  it('Stage 列序 = stageOrder(有效)+ 未列出者追加;悬空 id 被过滤', () => {
    const s = structure({
      stages: [stage('sA', ['nA']), stage('sB')],
      stageOrder: ['sB', 'ghost', 'sA'],
      nodes: [node('nA', 'p1')],
      participants: [participant('p1')],
      participantOrder: ['p1'],
    });
    expect(s.cols).toEqual(['sB', 'sA']);
    expect(s.colIndexOf.get('sA')).toBe(1);
    expect(s.colIndexOf.get('sB')).toBe(0);
  });

  it('未列出 Stage 追加在 stageOrder 之后', () => {
    const s = structure({
      stages: [stage('sX'), stage('sY')],
      stageOrder: ['sY'],
      participants: [participant('p1')],
      participantOrder: ['p1'],
      nodes: [node('n1', 'p1')],
    });
    expect(s.cols).toEqual(['sY', 'sX']);
  });

  it('Participant 行序:order 有效 + 追加未列出;non-empty 在前,empty 按名排序在后;无重复且覆盖全部', () => {
    const s = structure({
      participants: [
        participant('pEmpty', 'ZEmpty'),
        participant('pA', 'Alpha'),
        participant('pB', 'Beta'),
        participant('pUnlisted', 'Delta'),
      ],
      participantOrder: ['pEmpty', 'pA'],
      stages: [stage('s1')],
      stageOrder: ['s1'],
      nodes: [node('nA', 'pA'), node('nB', 'pB'), node('nU', 'pUnlisted')],
    });
    const ids = s.rows.map((r) => r.participantId);
    expect(ids).toEqual(['pA', 'pB', 'pUnlisted', 'pEmpty']);
    expect(new Set(ids).size).toBe(4);
    expect(s.rows.find((r) => r.participantId === 'pEmpty')?.isEmpty).toBe(true);
    expect(s.rows.find((r) => r.participantId === 'pA')?.isEmpty).toBe(false);
  });

  it('节点分类:assigned(pid+stage)/ rowOnly(有 pid 无 stage)/ free(无有效 pid);不入 cells 无虚拟实体', () => {
    const g = geometry({
      participants: [participant('p1')],
      participantOrder: ['p1'],
      stages: [stage('s1', ['nA', 'nNull'])],
      stageOrder: ['s1'],
      nodes: [
        node('nA', 'p1', 0, 0),
        node('nNull', undefined, 0, 0), // 无 pid,即便在 s1
        node('nGhost', 'gone', 0, 0), // 悬空 pid
        node('nNoStage', 'p1', 0, 0), // 有 pid,无 stage
      ],
    });
    expect(g.assignedNodes.map((n) => n.id)).toEqual(['nA']);
    expect(g.rowOnlyNodes.map((n) => n.id)).toEqual(['nNoStage']);
    expect(g.freeNodes.map((n) => n.id).sort()).toEqual(['nGhost', 'nNull']);
    expect(g.cells.size).toBe(1);
    // 无任何「unassigned」实体
    expect(g.structure.rows.some((r) => r.participantId === 'unassigned')).toBe(false);
    expect(g.structure.cols.some((sid) => sid === 'unassigned')).toBe(false);
  });

  it('arrange 位置与共享序单调一致(Participant→Y、Stage→X)', () => {
    const participants = [participant('pA', 'A'), participant('pB', 'B')];
    const stages = [stage('s1', ['a1', 'b1']), stage('s2', ['a2', 'b2'])];
    const nodes = [
      node('a1', 'pA', 0, 0),
      node('a2', 'pA', 0, 0),
      node('b1', 'pB', 0, 0),
      node('b2', 'pB', 0, 0),
    ];
    const s = structure({ participants, participantOrder: ['pB', 'pA'], stages, stageOrder: ['s2', 's1'], nodes });
    expect(s.rows.map((r) => r.participantId)).toEqual(['pB', 'pA']);
    expect(s.cols).toEqual(['s2', 's1']);
    const pos = computeMatrixLayout({ nodes, participants, participantOrder: ['pB', 'pA'], stages, stageOrder: ['s2', 's1'] });
    expect(pos.get('a2')!.x).toBeLessThan(pos.get('a1')!.x);
    expect(pos.get('b2')!.x).toBeLessThan(pos.get('b1')!.x);
    expect(pos.get('b1')!.y).toBeLessThan(pos.get('a1')!.y);
    expect(pos.get('b2')!.y).toBeLessThan(pos.get('a2')!.y);
  });
});

describe('shared matrix grid geometry(2026-09:无尾行/尾列)', () => {
  it('colXs 只覆盖实际 Stage 列;rowYs 覆盖全部 Participant 行;zone 在存在 assigned 时给出', () => {
    const g = geometry({
      participants: [participant('pA', 'A'), participant('pB', 'B')],
      participantOrder: ['pA', 'pB'],
      stages: [stage('s1', ['a1']), stage('s2', ['b1'])],
      stageOrder: ['s1', 's2'],
      nodes: [node('a1', 'pA', 0, 0), node('b1', 'pB', 0, 0), node('u1', undefined, 1000, 1000)],
    });
    expect(g.colXs.length).toBe(2); // 无 unassigned 尾列
    expect(g.rowYs.has(0)).toBe(true);
    expect(g.rowYs.has(1)).toBe(true);
    expect(g.rowYs.size).toBe(2);
    expect(g.avoidanceZone).toBeDefined();
    for (let i = 1; i < g.colXs.length; i++) expect(g.colXs[i]).toBeGreaterThan(g.colXs[i - 1]);
    expect(g.rowYs.get(1)!).toBeGreaterThan(g.rowYs.get(0)!);
    // 游离节点在远处 → 不避让(zone 外)
    const pos = computeMatrixLayout({
      nodes: [node('a1', 'pA', 0, 0), node('b1', 'pB', 0, 0), node('u1', undefined, 1000, 1000)],
      participants: [participant('pA', 'A'), participant('pB', 'B')],
      participantOrder: ['pA', 'pB'],
      stages: [stage('s1', ['a1']), stage('s2', ['b1'])],
      stageOrder: ['s1', 's2'],
    });
    expect(pos.has('u1')).toBe(false);
  });

  it('participant 行顺序来自当前 participantOrder:交换后 rows 与节点行位置互换', () => {
    const participants = [participant('pA', 'A'), participant('pB', 'B')];
    const stages = [stage('s1', ['na', 'nb'])];
    const nodes = [node('na', 'pA'), node('nb', 'pB')];
    const mk = (order: string[]) => ({ nodes, participants, participantOrder: order, stages, stageOrder: ['s1'] });
    const g1 = computeMatrixGridStructure(mk(['pA', 'pB']));
    const g2 = computeMatrixGridStructure(mk(['pB', 'pA']));
    expect(g1.rows.map((r) => r.participantId)).toEqual(['pA', 'pB']);
    expect(g2.rows.map((r) => r.participantId)).toEqual(['pB', 'pA']);
    const p1 = computeMatrixLayout(mk(['pA', 'pB']));
    const p2 = computeMatrixLayout(mk(['pB', 'pA']));
    expect(p1.get('na')!.y).toBeLessThan(p1.get('nb')!.y);
    expect(p2.get('nb')!.y).toBeLessThan(p2.get('na')!.y);
  });

  it('游离节点与矩阵带重叠时就近避让到区域外(仍在原附近)', () => {
    const participants = [participant('pA', 'A')];
    const stages = [stage('s1', ['a1'])];
    // 游离节点初始在矩阵区内 (a1 将排在 col0/row0 附近,矩阵区 ≈ [80, 392] × [80, 230])
    const free = node('free', undefined, 200, 120);
    const pos = computeMatrixLayout({
      nodes: [node('a1', 'pA', 0, 0), free],
      participants,
      participantOrder: ['pA'],
      stages,
      stageOrder: ['s1'],
    });
    const moved = pos.get('free');
    expect(moved).toBeDefined();
    // 避让后在矩阵区域之外
    const zone = { l: 80, t: 80, r: 80 + 240 + 48, b: 80 + 150 };
    const inside =
      moved!.x < zone.r &&
      moved!.x + 240 > zone.l &&
      moved!.y < zone.b &&
      moved!.y + 150 > zone.t;
    expect(inside).toBe(false);
    // 与所有 participant 行带(y)及所有 stage 列带(x)都无重叠(四角带外)
    const noRowOverlap = moved!.y >= zone.b + 16 || moved!.y + 150 <= zone.t - 16;
    const noColOverlap = moved!.x >= zone.r + 16 || moved!.x + 240 <= zone.l - 16;
    expect(noRowOverlap).toBe(true);
    expect(noColOverlap).toBe(true);
  });

  it('deterministic:相同输入两次输出一致;不改输入', () => {
    const participants = [participant('pA', 'A'), participant('pEmpty', 'Z')];
    const stages = [stage('s1', ['nA'])];
    const nodes = [node('nA', 'pA', 10, 5)];
    const input = { nodes, participants, participantOrder: ['pA'], stages, stageOrder: ['s1'] };
    const a = computeMatrixGridStructure(input);
    const b = computeMatrixGridStructure(input);
    expect(a).toEqual(b);
    expect(nodes.map((n) => n.position)).toEqual([{ x: 10, y: 5 }]);
    expect(input.participantOrder).toEqual(['pA']);
  });
});
