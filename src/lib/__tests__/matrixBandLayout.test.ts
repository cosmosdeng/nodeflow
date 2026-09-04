import { describe, expect, it } from 'vitest';
import {
  computeFlowRank,
  computeMatrixLayout,
  computeParticipantBandLayout,
  computeStageBandLayout,
} from '../arrange';
import type { FlowEdge, FlowNode, Participant, Stage } from '../../types';

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
const edge = (source: string, target: string) =>
  ({
    id: `${source}>${target}`,
    source,
    target,
    sourceHandle: null,
    targetHandle: 'in_1',
    type: 'flow',
    data: { label: '', artifact: null },
  }) as const;

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

describe('computeFlowRank(确定性拓扑值)', () => {
  it('DAG:源在前、目标在后,与输入顺序无关地稳定', () => {
    const ns = [node('a'), node('b'), node('c')];
    const r1 = computeFlowRank(ns, [edge('a', 'b'), edge('b', 'c')]);
    expect(r1.get('a')!).toBeLessThan(r1.get('b')!);
    expect(r1.get('b')!).toBeLessThan(r1.get('c')!);
    // 同一输入重复调用结果一致
    const r2 = computeFlowRank(ns, [edge('a', 'b'), edge('b', 'c')]);
    expect([...r2.values()]).toEqual([...r1.values()]);
  });

  it('环:仍给每个节点确定值,不抛错', () => {
    const ns = [node('a'), node('b')];
    const r = computeFlowRank(ns, [edge('a', 'b'), edge('b', 'a')]);
    expect(r.size).toBe(2);
    expect([...r.values()].sort((x, y) => x - y)).toEqual([0, 1]);
  });

  it('跨 stage 的链沿边单调递增(格内排序输入)', () => {
    const ns = [node('a', 'p1'), node('b', 'p1'), node('c', 'p1')];
    const r = computeFlowRank(ns, [edge('a', 'b'), edge('b', 'c')]);
    const seq = [...ns]
      .map((n) => r.get(n.id)!)
      .slice()
      .sort((x, y) => x - y);
    expect(seq).toEqual([0, 1, 2]);
  });
});

describe('computeMatrixLayout + rankOf(格内按流排序堆叠)', () => {
  it('同一 cell:rank 小的在前,不依赖输入 position.y', () => {
    const input = {
      participants: [participant('p1')],
      participantOrder: ['p1'],
      stages: [stage('s1', ['a', 'b'])],
      stageOrder: ['s1'],
      nodes: [node('a', 'p1', 0, 300), node('b', 'p1', 0, 0)],
    };
    // 默认按 position.y:b(a 在下)在上
    const def = computeMatrixLayout(input);
    expect(def.get('a')!.y).toBeGreaterThan(def.get('b')!.y);
    // 提供 rank(a 前 b 后)→ a 排到 b 上方,覆盖 position.y
    const ranked = computeMatrixLayout(input, {
      rankOf: new Map([
        ['a', 0],
        ['b', 1],
      ]),
    });
    expect(ranked.get('a')!.y).toBeLessThan(ranked.get('b')!.y);
    expect(ranked.get('a')!.y).toBe(80);
    expect(ranked.get('b')!.y).toBe(80 + 150 + 40);
  });
});

describe('computeMatrixLayout + edges(同参与方跨 Stage 流等级对齐)', () => {
  it('同一参与方:下游 Stage 节点不高于其行内上游(消除连线回头)', () => {
    const mk = (id: string, sids: string[]) => stage(id, sids);
    const base = {
      participants: [participant('p1')],
      participantOrder: ['p1'],
      stages: [mk('s1', ['A', 'B']), mk('s2', ['C'])],
      stageOrder: ['s1', 's2'],
      nodes: [node('A', 'p1', 0, 0), node('B', 'p1', 0, 0), node('C', 'p1', 0, 0)],
    };
    const mkEdge = (id: string, source: string, target: string): FlowEdge =>
      ({
        id,
        source,
        target,
        sourceHandle: null,
        targetHandle: 'in_1',
        type: 'flow',
        data: { label: '', artifact: null },
      }) as unknown as FlowEdge;
    const edges = [mkEdge('e1', 'A', 'B'), mkEdge('e2', 'B', 'C')];
    // 无连线信息(旧行为):C 回到本列顶部 → 高于上游 B(回头)
    const plain = computeMatrixLayout(base);
    expect(plain.get('C')!.y).toBe(80);
    expect(plain.get('C')!.y).toBeLessThan(plain.get('B')!.y);
    // 提供 edges:C 与上游 B 对齐在同一流等级,不再高于 B
    const aligned = computeMatrixLayout(base, { edges });
    expect(aligned.get('B')!.y).toBeGreaterThan(aligned.get('A')!.y); // 同格:源上目标下
    expect(aligned.get('C')!.y).toBeGreaterThanOrEqual(aligned.get('B')!.y); // 跨格:下游不高于上游
    expect(aligned.get('C')!.y).toBe(aligned.get('B')!.y); // 单链水平对齐
    expect(aligned.get('C')!.x).toBeGreaterThan(aligned.get('B')!.x);
  });
});

describe('computeParticipantBandLayout(单轴:仅 Participant 行带)', () => {
  it('有 participant 的节点(即使无 stage)排入其行:同 participant 横向 slot 递增', () => {
    const pos = computeParticipantBandLayout({
      participants: [participant('p1'), participant('p2')],
      participantOrder: ['p1', 'p2'],
      stages: [], // stage 数据不存在/被忽略
      stageOrder: [],
      nodes: [node('n1', 'p1', 0, 0), node('n2', 'p1', 0, 0), node('n3', 'p2', 0, 0)],
    });
    // p1 第一行(y=80);n1/n2 在同一行 x 递增
    expect(pos.get('n1')!.y).toBe(80);
    expect(pos.get('n2')!.y).toBe(80);
    expect(pos.get('n2')!.x).toBeGreaterThan(pos.get('n1')!.x);
    // p2 第二行(y 大于 p1)
    expect(pos.get('n3')!.y).toBeGreaterThan(pos.get('n1')!.y);
  });

  it('无 participant 节点避让到行带整体之外(y 方向)', () => {
    const pos = computeParticipantBandLayout({
      participants: [participant('p1')],
      participantOrder: ['p1'],
      stages: [],
      stageOrder: [],
      nodes: [node('free', undefined, 0, 90)],
    });
    const y = pos.get('free')!.y;
    expect(y < 80 - 16 || y >= 80 + 60 + 16).toBe(true);
  });
});

describe('computeStageBandLayout(单轴:仅 Stage 列带)', () => {
  it('属于不同 stage 的节点放入各自列(忽略 participant),同列纵向堆叠', () => {
    const pos = computeStageBandLayout({
      participants: [participant('p1')],
      participantOrder: ['p1'],
      stages: [stage('s1', ['nA', 'nB']), stage('s2', ['nC'])],
      stageOrder: ['s1', 's2'],
      nodes: [node('nA', 'p1'), node('nB', undefined), node('nC', 'p1')],
    });
    // s1 列(nA、nB 同列堆叠)
    expect(pos.get('nA')!.x).toBe(pos.get('nB')!.x);
    expect(pos.get('nB')!.y).toBeGreaterThan(pos.get('nA')!.y);
    // s2 列在 s1 右侧
    expect(pos.get('nC')!.x).toBeGreaterThan(pos.get('nA')!.x);
    expect(pos.get('nA')!.y).toBe(80);
  });

  it('不属于任何 stage 的节点避开列带(x 方向)', () => {
    const pos = computeStageBandLayout({
      participants: [participant('p1')],
      participantOrder: ['p1'],
      stages: [stage('s1', ['nA'])],
      stageOrder: ['s1'],
      nodes: [node('nA', 'p1', 0, 0), node('free', 'p1', 200, 500)],
    });
    const x = pos.get('free')!.x;
    const zoneL = 80;
    const zoneR = 80 + 240 + 48;
    expect(x < zoneL - 16 || x >= zoneR + 16).toBe(true);
  });
});
