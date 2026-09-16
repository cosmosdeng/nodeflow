import { beforeEach, describe, expect, it } from 'vitest';
import { useGraphStore } from '../graphStore';
import type { FlowNode, Participant, Stage } from '../../types';

/**
 * Phase 5B — runArrange 与 runSmartArrange 收敛(Store 入口层)。
 * 目的:两个入口在存在语义轴时必须共享同一 unified matrix geometry core,产出相同 position。
 * runArrange 需 arrangePending=true;runSmartArrange 直接执行。语义数据不得被修改。
 */

const node = (id: string, pid?: string, x = 0, y = 0): FlowNode => ({
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
    ...(pid ? { participantId: pid } : {}),
  },
});
const stg = (id: string, nodeIds: string[] = []): Stage => ({
  id,
  name: id,
  x: 0,
  y: 0,
  width: 300,
  height: 200,
  nodeIds,
});
const P = (id: string): Participant => ({ id, name: id, type: 'person' });

const EDGE = (id: string, source: string, target: string) => ({
  id,
  source,
  target,
  type: 'flow' as const,
  data: { label: '', artifact: null as never },
});

function reset() {
  useGraphStore.setState({
    documents: [],
    activeDocumentId: '',
    nodes: [],
    edges: [],
    stages: [],
    annotations: [],
    participants: [],
    organizations: [],
    participantOrder: [],
    participantOrderMode: 'auto',
    stageOrder: [],
    arrangePending: false,
    viewport: { x: 0, y: 0, zoom: 1 },
    past: [],
    future: [],
    selected: null,
    compositeTabs: [],
    activeTabId: 'main',
    loadError: null,
  });
}
beforeEach(reset);

interface Scene {
  nodes: FlowNode[];
  edges: ReturnType<typeof EDGE>[];
  participants: Participant[];
  participantOrder: string[];
  stages: Stage[];
  stageOrder: string[];
}

function apply(scene: Scene) {
  useGraphStore.setState({
    nodes: scene.nodes,
    edges: scene.edges,
    participants: scene.participants,
    participantOrder: scene.participantOrder,
    participantOrderMode: 'user',
    stages: scene.stages,
    stageOrder: scene.stageOrder,
    arrangePending: true,
    arrangePendingKind: 'both',
  });
}

function positions(): Map<string, { x: number; y: number }> {
  const s = useGraphStore.getState();
  return new Map(s.nodes.map((n) => [n.id, { ...n.position }]));
}

/** 分别通过两个入口各跑一次(独立场景),返回按 id 对齐的坐标与语义快照 */
function runBoth(scene: Scene) {
  reset();
  apply(scene);
  useGraphStore.getState().runArrange();
  const arr = positions();
  reset();
  apply(scene);
  useGraphStore.getState().runSmartArrange();
  const smart = positions();
  return { arr, smart };
}

const semanticOf = () => {
  const s = useGraphStore.getState();
  return {
    pids: s.nodes.map((n) => n.data?.participantId ?? null),
    members: s.stages.map((st) => st.nodeIds.join(',')),
    participantOrder: [...s.participantOrder],
    stageOrder: [...s.stageOrder],
  };
};

describe('C1 — dual axis convergence', () => {
  const scene: Scene = {
    participants: [P('p1'), P('p2')],
    participantOrder: ['p1', 'p2'],
    stages: [stg('s1', ['a']), stg('s2', ['x', 'b'])],
    stageOrder: ['s1', 's2'],
    nodes: [
      node('a', 'p1'), // assigned (p1,s1)
      node('b', 'p2'), // assigned (p2,s2)
      node('x'), // stageOnly s2(无 pid)
      node('r', 'p1'), // rowOnly p1(无 stage)
      node('f', undefined, 9000, 9000), // free
    ],
    edges: [EDGE('e1', 'a', 'b')],
  };

  it('runArrange 与 runSmartArrange 几何一致', () => {
    const { arr, smart } = runBoth(scene);
    expect([...arr.entries()]).toEqual([...smart.entries()]);
    // X=Stage Order(Y 行序由 Participant Order)基本性质
    const s = smart;
    expect(s.get('a')!.x).toBeLessThan(s.get('x')!.x); // s1 列 < s2 列
    expect(s.get('x')!.x).toBe(s.get('b')!.x); // stageOnly 与 assigned 同列
    expect(s.get('a')!.y).toBeLessThan(s.get('b')!.y); // p1 行 < p2 行
    expect(s.get('r')!.y).toBe(s.get('a')!.y); // rowOnly 在 p1 行
    expect(s.get('f')).toEqual({ x: 9000, y: 9000 }); // free 原位(无碰撞)
  });
});

describe('C2 — participant-only convergence(无 Stage 语义)', () => {
  const scene: Scene = {
    participants: [P('p1'), P('p2')],
    participantOrder: ['p1', 'p2'],
    stages: [],
    stageOrder: [],
    nodes: [node('a', 'p1'), node('b', 'p2'), node('r1', 'p1', 0, 400)],
    edges: [EDGE('e1', 'a', 'b')],
  };

  it('两个入口使用同一核心(participant row 布局;无虚拟 Stage 列)', () => {
    const { arr, smart } = runBoth(scene);
    expect([...arr.entries()]).toEqual([...smart.entries()]);
    expect(smart.get('a')!.y).toBeLessThan(smart.get('b')!.y); // Y=Participant Order
    // 无 Stage 语义轴:每行都从左起横向排布(X 无列约束),不制造虚拟列
    expect(smart.get('a')!.x).toBe(80);
    expect(smart.get('b')!.x).toBe(80);
    expect(smart.get('r1')!.x).toBeGreaterThan(80); // 同 p1 行的后续 slot
  });
});

describe('C3 — stage-only convergence(无 Participant 语义)', () => {
  const scene: Scene = {
    participants: [],
    participantOrder: [],
    stages: [stg('s1', ['x1']), stg('s2', ['x2'])],
    stageOrder: ['s1', 's2'],
    nodes: [node('x1', undefined, 0, 0), node('x2', undefined, 600, 0)],
    edges: [],
  };

  it('stageOnly 进入各自 Stage 列(Anchor),两个入口一致', () => {
    const { arr, smart } = runBoth(scene);
    expect([...arr.entries()]).toEqual([...smart.entries()]);
    expect(smart.get('x1')!.x).toBeLessThan(smart.get('x2')!.x); // X=Stage Order
    expect(smart.get('x1')!.y).toBeGreaterThanOrEqual(80); // 列内 Anchor(独立列起点)
  });
});

describe('C4/C5 — free 与 stageOnly 在 Smart Arrange 中走统一策略', () => {
  const scene: Scene = {
    participants: [P('p1')],
    participantOrder: ['p1'],
    stages: [stg('s1', ['a', 'x'])],
    stageOrder: ['s1'],
    nodes: [
      node('a', 'p1'),
      node('x'), // stageOnly s1:应被 Anchor 至其列,而非“保持原位置”
      node('f', undefined, 9000, 9000), // free
    ],
    edges: [],
  };

  it('stageOnly 不保持原位(进入列 Anchor),free 不落入旧四角', () => {
    const { arr, smart } = runBoth(scene);
    expect([...arr.entries()]).toEqual([...smart.entries()]);
    const x = smart.get('x')!;
    const a = smart.get('a')!;
    expect(x.x).toBe(a.x); // stageOnly 与 assigned 同属 s1 列
    expect(x.y).toBeGreaterThanOrEqual(a.y + 150); // C+D Anchor:位于列内容之后
    // free 保持原位置(新策略 L0),而非弹到旧四角(如 col 左上的角坐标)
    expect(smart.get('f')).toEqual({ x: 9000, y: 9000 });
  });
});

describe('C6 — semantic immutability', () => {
  const scene: Scene = {
    participants: [P('p1'), P('p2')],
    participantOrder: ['p1', 'p2'],
    stages: [stg('s1', ['a', 'x'])],
    stageOrder: ['s1'],
    nodes: [node('a', 'p1'), node('b', 'p2'), node('x')],
    edges: [EDGE('e1', 'a', 'b')],
  };

  it('runArrange / runSmartArrange 后 semantic 全不变', () => {
    for (const fn of ['runArrange', 'runSmartArrange'] as const) {
      reset();
      apply(scene);
      const before = JSON.stringify(semanticOf());
      useGraphStore.getState()[fn]();
      const after = JSON.stringify(semanticOf());
      expect(after, fn).toBe(before);
    }
  });
});

describe('C7 — T16(Store 级)', () => {
  const scene: Scene = {
    participants: [P('p1'), P('p2'), P('p3')],
    participantOrder: ['p1', 'p2', 'p3'],
    stages: [stg('s1', ['A']), stg('s2', ['C']), stg('s3', ['B'])],
    stageOrder: ['s1', 's2', 's3'],
    nodes: [node('A', 'p1'), node('C', 'p3'), node('B', 'p2')],
    edges: [EDGE('e1', 'A', 'C'), EDGE('e2', 'C', 'B')],
  };

  it('X/Y 顺序保持;不交换 Participant/Stage;允许 topology Y-conflict', () => {
    for (const fn of ['runArrange', 'runSmartArrange'] as const) {
      reset();
      apply(scene);
      useGraphStore.getState()[fn]();
      const pos = positions();
      expect(pos.get('A')!.x).toBeLessThan(pos.get('C')!.x);
      expect(pos.get('C')!.x).toBeLessThan(pos.get('B')!.x); // S1<S2<S3
      expect(pos.get('A')!.y).toBeLessThan(pos.get('B')!.y);
      expect(pos.get('B')!.y).toBeLessThan(pos.get('C')!.y); // P1<P2<P3
      const s = useGraphStore.getState();
      expect(s.participantOrder).toEqual(['p1', 'p2', 'p3']);
      expect(s.stageOrder).toEqual(['s1', 's2', 's3']);
      // C(P3)→B(P2) 的 Y-reverse 属允许的 topology conflict —— 不断言顺序被修好
    }
  });
});

describe('C8 — both hidden / 无语义轴仍走 legacy', () => {
  const scene: Scene = {
    participants: [],
    participantOrder: [],
    stages: [],
    stageOrder: [],
    nodes: [node('a', undefined, 0, 0), node('b', undefined, 300, 0), node('c', undefined, 0, 300)],
    edges: [EDGE('e1', 'a', 'b'), EDGE('e2', 'a', 'c')],
  };

  it('无语义轴时 runSmartArrange 仍执行 legacy 纯拓扑横排(可重复且确定性)', () => {
    reset();
    apply(scene);
    useGraphStore.getState().runSmartArrange();
    const first = positions();
    reset();
    apply(scene);
    useGraphStore.getState().runSmartArrange();
    const second = positions();
    expect([...first.entries()]).toEqual([...second.entries()]);
    // 拓扑横排:a 最左
    expect(first.get('a')!.x).toBeLessThan(first.get('b')!.x);
    expect(first.get('a')!.x).toBeLessThan(first.get('c')!.x);
  });
});
