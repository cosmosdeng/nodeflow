import { describe, expect, it } from 'vitest';
import { computeMatrixLayout } from '../arrange';
import type { FlowNode, Participant, Stage } from '../../types';

/**
 * P3+2026-09 语义:Unified Matrix Arrange(已入矩阵节点)
 *
 * 覆盖:Participant→Y / Stage→X / 2D 矩阵 / 同 cell 堆叠 / empty participant /
 * 游离节点(无有效 participant 或无 stage membership)保持原位 / composite child 排除 /
 * determinism / 不改输入。
 * 入矩阵条件:可见顶层节点 且 participantId 有效 且 存在于某 stage.nodeIds。
 */

const node = (id: string, participantId?: string, x = 0, y = 0, extra: Partial<FlowNode> = {}): FlowNode => ({
  id,
  type: 'flow',
  position: { x, y },
  ...extra,
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

// 矩阵常量与默认节点尺寸(240×150)
const X0 = 80 + 24; // START_X + CELL_PAD_X
const ROW0_Y = 80;
const ROW1_Y = 80 + 150 + 80;
const STACK_OFFSET = 150 + 40;

const layout = (o: {
  nodes?: FlowNode[];
  participants?: Participant[];
  participantOrder?: string[];
  stages?: Stage[];
  stageOrder?: string[];
}) =>
  computeMatrixLayout({
    nodes: o.nodes ?? [],
    participants: o.participants ?? [],
    participantOrder: o.participantOrder ?? [],
    stages: o.stages ?? [],
    stageOrder: o.stageOrder ?? [],
  });

describe('P3+ computeMatrixLayout(入矩阵节点)', () => {
  it('Participant → Y:按 participantOrder 自上而下', () => {
    const pos = layout({
      participants: [participant('pA', 'A'), participant('pB', 'B')],
      participantOrder: ['pB', 'pA'],
      stages: [stage('s1', ['nA', 'nB'])],
      stageOrder: ['s1'],
      nodes: [node('nA', 'pA'), node('nB', 'pB')],
    });
    expect(pos.get('nA')!.y).toBe(ROW1_Y); // pA 第二行
    expect(pos.get('nB')!.y).toBe(ROW0_Y); // pB 第一行
    expect(pos.get('nB')!.y).toBeLessThan(pos.get('nA')!.y);
    expect(pos.get('nA')!.x).toBe(X0);
    expect(pos.get('nB')!.x).toBe(X0);
  });

  it('Stage → X:按 stageOrder 自左向右;无入矩阵节点进不了矩阵列', () => {
    const pos = layout({
      participants: [participant('p1')],
      participantOrder: ['p1'],
      stages: [stage('sA', ['nS']), stage('sB', ['nT'])],
      stageOrder: ['sB', 'sA'],
      nodes: [node('nS', 'p1'), node('nT', 'p1'), node('nFree', 'p1', 2000, 2000)], // nFree 无 stage → 行内延伸
    });
    expect(pos.get('nT')!.x).toBeLessThan(pos.get('nS')!.x); // sB 在 sA 左
    expect(pos.get('nT')!.y).toBe(ROW0_Y);
    expect(pos.get('nS')!.y).toBe(ROW0_Y);
    // nFree 有 participant(p1)但无 stage:不入 stage 列,排到 p1 行的带内延伸区(stage 列右缘外)
    expect(pos.get('nFree')!.x).toBeGreaterThan(pos.get('nS')!.x);
    expect(pos.get('nFree')!.y).toBe(ROW0_Y);
  });

  it('2D matrix:participant 行独立于 stage 列;同一 cell 顶部对齐', () => {
    const pos = layout({
      participants: [participant('pA'), participant('pB')],
      participantOrder: ['pA', 'pB'],
      stages: [stage('s1', ['a1', 'b1']), stage('s2', ['b2'])],
      stageOrder: ['s1', 's2'],
      nodes: [node('a1', 'pA'), node('b1', 'pB'), node('b2', 'pB')],
    });
    expect(pos.get('b1')!.x).toBeLessThan(pos.get('b2')!.x);
    expect(pos.get('a1')!.y).toBeLessThan(pos.get('b1')!.y);
    expect(pos.get('b1')!.x).toBe(pos.get('a1')!.x);
  });

  it('Same Cell:同 participant+stage 纵向堆叠,不重叠,确定性排序', () => {
    const nodes = [node('n1', 'p1', 0, 400), node('n2', 'p1', 0, 10), node('n3', 'p1', 5, 10)];
    const pos = layout({
      participants: [participant('p1')],
      participantOrder: ['p1'],
      stages: [stage('s1', ['n1', 'n2', 'n3'])],
      stageOrder: ['s1'],
      nodes,
    });
    expect(pos.get('n2')!.y).toBe(ROW0_Y);
    expect(pos.get('n3')!.y).toBe(ROW0_Y + STACK_OFFSET);
    expect(pos.get('n1')!.y).toBe(ROW0_Y + STACK_OFFSET * 2);
  });

  it('Empty Participant 置于 non-empty 之后;不改变 assigned 行 Y', () => {
    const pos = layout({
      participants: [participant('pA'), participant('pEmpty', 'ZEmpty'), participant('pB')],
      participantOrder: ['pA', 'pEmpty', 'pB'],
      stages: [stage('s1', ['nA', 'nB'])],
      stageOrder: ['s1'],
      nodes: [node('nA', 'pA'), node('nB', 'pB')],
    });
    expect(pos.get('nA')!.y).toBe(ROW0_Y);
    expect(pos.get('nB')!.y).toBe(ROW1_Y);
  });

  it('游离(无有效 participant 或悬空 pid)节点:不进入矩阵,保持原位(无尾行)', () => {
    const pos = layout({
      participants: [participant('p1')],
      participantOrder: ['p1'],
      stages: [stage('s1', ['n1', 'nuNull', 'nuGhost'])],
      stageOrder: ['s1'],
      nodes: [
        node('n1', 'p1', 0, 0),
        node('nuNull', undefined, 500, 500), // 无 pid(即便有 stage membership)
        node('nuGhost', 'gone', 900, 900), // pid 悬空
      ],
    });
    expect(pos.get('n1')!.x).toBe(X0); // 入矩阵节点正常排布
    expect(pos.has('nuNull')).toBe(false);
    expect(pos.has('nuGhost')).toBe(false);
  });

  it('行内节点(有 participant、无 stage):排入其 participant 行的带内延伸区(列带右缘外)', () => {
    const pos = layout({
      participants: [participant('p1')],
      participantOrder: ['p1'],
      stages: [stage('s1', ['n1'])],
      stageOrder: ['s1'],
      nodes: [node('n1', 'p1', 0, 0), node('nFree', 'p1', 900, 900)],
    });
    expect(pos.get('n1')!.x).toBe(X0);
    expect(pos.get('n1')!.y).toBe(ROW0_Y);
    // nFree 属 p1 行:排在 stage 列带右缘(colRights=368)之外的同一行带(ROW0_Y)
    expect(pos.get('nFree')).toEqual({ x: 368 + 16, y: ROW0_Y });
    // 无 stage membership 节点绝不进入列内(无尾列)
    expect(pos.get('nFree')!.x).toBeGreaterThan(pos.get('n1')!.x);
  });

  it('Composite:host 参与排列(需 pid+stage),child 被排除(不排列也不避让)', () => {
    const host: FlowNode = {
      id: 'h',
      type: 'flow',
      position: { x: 0, y: 0 },
      data: {
        label: 'H',
        description: '',
        actor: 'machine',
        locked: false,
        inputs: [],
        outputs: [],
        participantId: 'p1',
        composite: { expanded: false, childIds: ['c1'] },
      },
    };
    const child = node('c1', 'p1', 0, 0);
    const pos = layout({
      participants: [participant('p1')],
      participantOrder: ['p1'],
      stages: [stage('s1', ['h'])],
      stageOrder: ['s1'],
      nodes: [host, child],
    });
    expect(pos.has('h')).toBe(true);
    expect(pos.has('c1')).toBe(false); // child 不参与矩阵、也不避让(不属于 scope)
  });

  it('hidden 节点被排除(不排列)', () => {
    const hidden = { ...node('hid', 'p1', 0, 0), hidden: true };
    const pos = layout({
      participants: [participant('p1')],
      participantOrder: ['p1'],
      stages: [stage('s1', ['vis', 'hid'])],
      stageOrder: ['s1'],
      nodes: [node('vis', 'p1', 0, 0), hidden],
    });
    expect(pos.has('vis')).toBe(true);
    expect(pos.has('hid')).toBe(false);
  });

  it('deterministic:相同输入两次输出相同;不修改输入', () => {
    const participants = [participant('p1'), participant('p2')];
    const stages = [stage('s1', ['a', 'b'])];
    const nodes = [node('a', 'p1', 10, 5), node('b', 'p2', 3, 200)];
    const input = {
      nodes,
      participants,
      participantOrder: ['p2', 'p1'],
      stages,
      stageOrder: ['s1'],
    };
    const a = computeMatrixLayout(input);
    const b = computeMatrixLayout(input);
    expect(a).toEqual(b);
    expect(nodes.map((n) => n.position)).toEqual([
      { x: 10, y: 5 },
      { x: 3, y: 200 },
    ]);
  });
});
