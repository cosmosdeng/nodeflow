import { describe, expect, it } from 'vitest';
import { computeMatrixLayout } from '../arrange';
import type { FlowNode, Participant, Stage } from '../../types';

/**
 * P3(Swimlane/Stage v2):Unified Matrix Arrange — 纯函数
 *
 * 覆盖:Participant→Y / Stage→X / 2D 矩阵 / 同 cell 堆叠 / empty participant /
 * unassigned participant / unassigned stage / composite child 排除 / determinism / 不改输入。
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

// 矩阵常量与默认节点尺寸(240×150)用于精确断言
const X0 = 80 + 24; // START_X + CELL_PAD_X
const ROW0_Y = 80;
const ROW1_Y = 80 + 150 + 80; // content(150) + ROW_GAP(80)
const STACK_OFFSET = 150 + 40; // h + STACK_GAP

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

describe('P3 computeMatrixLayout', () => {
  it('Participant → Y:按 participantOrder 自上而下', () => {
    const pos = layout({
      participants: [participant('pA', 'A'), participant('pB', 'B')],
      participantOrder: ['pB', 'pA'],
      nodes: [node('nA', 'pA'), node('nB', 'pB')],
    });
    expect(pos.get('nA')!.y).toBe(ROW1_Y); // pA 第二行
    expect(pos.get('nB')!.y).toBe(ROW0_Y); // pB 第一行
    expect(pos.get('nB')!.y).toBeLessThan(pos.get('nA')!.y);
    // X 对齐(单 unassigned 列)
    expect(pos.get('nA')!.x).toBe(X0);
    expect(pos.get('nB')!.x).toBe(X0);
  });

  it('Stage → X:按 stageOrder 自左向右;无归属节点进尾随列', () => {
    const pos = layout({
      participants: [participant('p1')],
      participantOrder: ['p1'],
      stages: [stage('sA', ['nS']), stage('sB', ['nT'])],
      stageOrder: ['sB', 'sA'], // 显式顺序反转验证列顺序按 stageOrder 而非数组
      nodes: [node('nS', 'p1'), node('nT', 'p1'), node('nU', 'p1')], // nU 无 stage
    });
    // 列0=sB,列1=sA,列2=unassigned
    expect(pos.get('nT')!.x).toBeLessThan(pos.get('nS')!.x); // sB 在 sA 左
    expect(pos.get('nS')!.x).toBeLessThan(pos.get('nU')!.x); // staged 在 unassigned 左
    expect(pos.get('nT')!.y).toBe(ROW0_Y);
    expect(pos.get('nS')!.y).toBe(ROW0_Y);
    expect(pos.get('nU')!.y).toBe(ROW0_Y);
  });

  it('2D matrix:participant 行独立于 stage 列;同一 cell 顶部对齐', () => {
    const pos = layout({
      participants: [participant('pA'), participant('pB')],
      participantOrder: ['pA', 'pB'],
      stages: [stage('s1', ['a1', 'b1']), stage('s2', ['b2'])],
      stageOrder: ['s1', 's2'],
      nodes: [node('a1', 'pA'), node('b1', 'pB'), node('b2', 'pB')],
    });
    // pB 行内:s1(b1) 在 s2(b2) 左
    expect(pos.get('b1')!.x).toBeLessThan(pos.get('b2')!.x);
    // pA 的 a1 在 pB 之上(同列 s1)
    expect(pos.get('a1')!.y).toBeLessThan(pos.get('b1')!.y);
    // 两行同列 cell 顶部对齐 → 两行各自顶部即各自行顶
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
    // 排序:y(10,10,400) → x(0,5) → id;故 n2(0,10) < n3(5,10) < n1(400,0?)
    // 次序:n2(10,0) → n3(10,5) → n1(400,0)
    expect(pos.get('n2')!.y).toBe(ROW0_Y);
    expect(pos.get('n3')!.y).toBe(ROW0_Y + STACK_OFFSET);
    expect(pos.get('n1')!.y).toBe(ROW0_Y + STACK_OFFSET * 2);
    // 不重叠:上节点底 ≤ 下节点顶
    expect(ROW0_Y + STACK_OFFSET - 40).toBeGreaterThanOrEqual(ROW0_Y + 150);
  });

  it('Empty Participant 置于 non-empty 之后;不改变 assigned 行 Y', () => {
    const pos = layout({
      participants: [participant('pA'), participant('pEmpty', 'ZEmpty'), participant('pB')],
      participantOrder: ['pA', 'pEmpty', 'pB'],
      nodes: [node('nA', 'pA'), node('nB', 'pB')],
    });
    // assigned 行只有 nA,nB → empty 不占两行之间的节点带
    expect(pos.get('nA')!.y).toBe(ROW0_Y);
    expect(pos.get('nB')!.y).toBe(ROW1_Y);
  });

  it('Unassigned Participant(无 participantId)进入尾随行,位于所有有效行之下', () => {
    const pos = layout({
      participants: [participant('p1')],
      participantOrder: ['p1'],
      stages: [stage('s1', ['n1', 'nu'])],
      stageOrder: ['s1'],
      nodes: [node('n1', 'p1'), node('nu')], // nu 无 participantId
    });
    expect(pos.get('nu')!.y).toBeGreaterThan(pos.get('n1')!.y); // 尾随行在下
    // unassigned 行同按 stage 列对齐(s1 列)
    expect(pos.get('nu')!.x).toBe(pos.get('n1')!.x);
  });

  it('Unassigned × Unassigned cell 正常形成(unassigned participant 且无 stage)', () => {
    const pos = layout({
      participants: [participant('p1')],
      participantOrder: ['p1'],
      stages: [stage('s1', ['n1'])],
      stageOrder: ['s1'],
      nodes: [node('n1', 'p1'), node('nu')],
    });
    const assignedX = pos.get('n1')!.x;
    expect(pos.get('nu')!.x).toBeGreaterThan(assignedX); // unassigned stage 列在最后
    expect(pos.get('nu')!.y).toBeGreaterThan(pos.get('n1')!.y); // unassigned participant 行在最后
  });

  it('Composite:host 参与排列,child 被排除', () => {
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
    const child = node('c1', 'p1');
    const pos = layout({
      participants: [participant('p1')],
      participantOrder: ['p1'],
      nodes: [host, child],
    });
    expect(pos.has('h')).toBe(true);
    expect(pos.has('c1')).toBe(false); // child 不参与矩阵
  });

  it('hidden 节点被排除', () => {
    const hidden = { ...node('hid', 'p1'), hidden: true };
    const pos = layout({
      participants: [participant('p1')],
      participantOrder: ['p1'],
      nodes: [node('vis', 'p1'), hidden],
    });
    expect(pos.has('vis')).toBe(true);
    expect(pos.has('hid')).toBe(false);
  });

  it('deterministic:相同输入两次输出相同;不修改输入', () => {
    const participants = [participant('p1'), participant('p2')];
    const stages = [stage('s1', ['a', 'b'])];
    const nodes = [node('a', 'p1', 10, 5), node('b', 'p2', 3, 200)];
    const input = { nodes, participants, participantOrder: ['p2', 'p1'], stages, stageOrder: ['s1'] };
    const a = computeMatrixLayout(input);
    const b = computeMatrixLayout(input);
    expect(a).toEqual(b);
    // 不改输入
    expect(nodes.map((n) => n.position)).toEqual([
      { x: 10, y: 5 },
      { x: 3, y: 200 },
    ]);
  });
});
