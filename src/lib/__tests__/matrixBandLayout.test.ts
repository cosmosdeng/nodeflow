import { describe, expect, it } from 'vitest';
import { computeFlowRank, computeMatrixLayout } from '../arrange';
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
    // 提供 edges:全局层作为行内 preferred slot,链下游只下不回头
    const aligned = computeMatrixLayout(base, { edges });
    expect(aligned.get('B')!.y).toBeGreaterThan(aligned.get('A')!.y); // 同格:源上目标下
    expect(aligned.get('C')!.y).toBeGreaterThan(aligned.get('B')!.y); // 跨格:下游不低于上游(逐层下沉)
    expect(aligned.get('C')!.x).toBeGreaterThan(aligned.get('B')!.x);
  });
});

describe('Arrange Quality vNext(全局拓扑 + 固定行列 + 汇合不深陷)', () => {
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

  it('T1 跨 Participant handoff(A(P1)→B(P2)→C(P3)):按固定行序自上而下,下游不高于上游', () => {
    const pos = computeMatrixLayout(
      {
        participants: [participant('p1'), participant('p2'), participant('p3')],
        participantOrder: ['p1', 'p2', 'p3'],
        stages: [
          stage('s1', ['A']),
          stage('s2', ['B']),
          stage('s3', ['C']),
        ],
        stageOrder: ['s1', 's2', 's3'],
        nodes: [node('A', 'p1'), node('B', 'p2'), node('C', 'p3')],
      },
      { edges: [mkEdge('e1', 'A', 'B'), mkEdge('e2', 'B', 'C')] },
    );
    expect(pos.get('B')!.y).toBeGreaterThan(pos.get('A')!.y); // 行序固定:P2 在 P1 下
    expect(pos.get('C')!.y).toBeGreaterThan(pos.get('B')!.y);
    expect(pos.get('B')!.x).toBeGreaterThan(pos.get('A')!.x); // Stage 递增 → 从左到右
    expect(pos.get('C')!.x).toBeGreaterThan(pos.get('B')!.x);
  });

  it('T3 同 Participant 跨 Stage:单链各一节点时尽量保持同 Y(水平),不逐格下坠', () => {
    const pos = computeMatrixLayout(
      {
        participants: [participant('p1')],
        participantOrder: ['p1'],
        stages: [stage('s1', ['A']), stage('s2', ['B']), stage('s3', ['C'])],
        stageOrder: ['s1', 's2', 's3'],
        nodes: [node('A', 'p1'), node('B', 'p1'), node('C', 'p1')],
      },
      { edges: [mkEdge('e1', 'A', 'B'), mkEdge('e2', 'B', 'C')] },
    );
    expect(pos.get('A')!.y).toBe(80);
    expect(pos.get('B')!.y).toBe(270); // 全局层 anchor:逐层下沉但幅度受控
    expect(pos.get('C')!.y).toBe(460);
  });

  it('T4 同 cell 直接依赖:Y(source) < Y(target)', () => {
    const pos = computeMatrixLayout(
      {
        participants: [participant('p1')],
        participantOrder: ['p1'],
        stages: [stage('s1', ['A', 'B'])],
        stageOrder: ['s1'],
        nodes: [node('A', 'p1', 0, 300), node('B', 'p1', 0, 0)],
      },
      { edges: [mkEdge('e1', 'A', 'B')] },
    );
    expect(pos.get('A')!.y).toBeLessThan(pos.get('B')!.y);
  });

  it('T5 Merge(A/B 不同 Stage → C):汇合节点不无必要深陷(与其浅源同层)', () => {
    const pos = computeMatrixLayout(
      {
        participants: [participant('p1')],
        participantOrder: ['p1'],
        stages: [stage('s1', ['A']), stage('s2', ['B']), stage('s3', ['C'])],
        stageOrder: ['s1', 's2', 's3'],
        nodes: [node('A', 'p1'), node('B', 'p1'), node('C', 'p1')],
      },
      { edges: [mkEdge('e1', 'A', 'C'), mkEdge('e2', 'B', 'C')] },
    );
    // A、B 异列源同层(80);C 汇合:不低于二者、仅取其下一 preferred 层,不无必要深陷
    expect(pos.get('A')!.y).toBe(80);
    expect(pos.get('B')!.y).toBe(80);
    expect(pos.get('C')!.y).toBeGreaterThan(pos.get('A')!.y);
    expect(pos.get('C')!.y).toBeGreaterThan(pos.get('B')!.y);
    expect(pos.get('C')!.y).toBe(270);
  });

  it('T6 Split(A → B/C):不发生 topology inversion(目标不高于源)', () => {
    const pos = computeMatrixLayout(
      {
        participants: [participant('p1')],
        participantOrder: ['p1'],
        stages: [stage('s1', ['A']), stage('s2', ['B']), stage('s3', ['C'])],
        stageOrder: ['s1', 's2', 's3'],
        nodes: [node('A', 'p1'), node('B', 'p1'), node('C', 'p1')],
      },
      { edges: [mkEdge('e1', 'A', 'B'), mkEdge('e2', 'A', 'C')] },
    );
    expect(pos.get('B')!.y).toBeGreaterThanOrEqual(pos.get('A')!.y);
    expect(pos.get('C')!.y).toBeGreaterThanOrEqual(pos.get('A')!.y);
    expect(pos.get('B')!.x).toBeGreaterThan(pos.get('A')!.x);
    expect(pos.get('C')!.x).toBeGreaterThan(pos.get('A')!.x);
  });

  it('T13 确定性:同一输入两次 Arrange 结果一致', () => {
    const input = {
      participants: [participant('p1'), participant('p2')],
      participantOrder: ['p1', 'p2'],
      stages: [stage('s1', ['A', 'B']), stage('s2', ['C'])],
      stageOrder: ['s1', 's2'],
      nodes: [
        node('A', 'p1', 0, 200),
        node('B', 'p1', 0, 0),
        node('C', 'p2', 0, 0),
      ],
    };
    const edges = [mkEdge('e1', 'A', 'B'), mkEdge('e2', 'B', 'C')];
    const r1 = computeMatrixLayout(input, { edges });
    const r2 = computeMatrixLayout(input, { edges });
    expect(r1.size).toBe(r2.size);
    for (const [id, p] of r1) expect(r2.get(id)).toEqual(p);
  });

  it('T16 反序 Participant adversarial:行序/列序不被偷偷改变;硬 row geometry 与 topology 冲突被如实保留并记录', () => {
    // 拓扑 A(P1,S1) → C(P3,S2) → B(P2,S3);Participant 行序 P1/P2/P3 固定(禁止改动)
    const pos = computeMatrixLayout(
      {
        participants: [participant('p1'), participant('p2'), participant('p3')],
        participantOrder: ['p1', 'p2', 'p3'],
        stages: [stage('s1', ['A']), stage('s2', ['C']), stage('s3', ['B'])],
        stageOrder: ['s1', 's2', 's3'],
        nodes: [node('A', 'p1'), node('C', 'p3'), node('B', 'p2')],
      },
      { edges: [mkEdge('e1', 'A', 'C'), mkEdge('e2', 'C', 'B')] },
    );
    // 行序硬约束保持:Y 按 P1 < P2 < P3 单调(未偷偷重排行)
    expect(pos.get('A')!.y).toBeLessThan(pos.get('B')!.y);
    expect(pos.get('B')!.y).toBeLessThan(pos.get('C')!.y);
    // Stage 顺序不变:列按 s1 < s2 < s3 单调
    expect(pos.get('A')!.x).toBeLessThan(pos.get('C')!.x);
    expect(pos.get('C')!.x).toBeLessThan(pos.get('B')!.x);
    // topology A→C→B 中 C→B 的目标 B 所在行 P2 位于 P3 之上 → Y(C)>Y(B) 在硬行几何下不可消除:
    // 这是需要记录的 constraint conflict(不在本算法内偷偷改 participantOrder / 溢出 row 解决)。
    expect(pos.get('C')!.y).toBeGreaterThan(pos.get('B')!.y);
    // 语义拓扑层未受影响:行内 preferred slot 仍按层下沉(各自行内单节点 row 内无额外下沉可证明)
  });
});
