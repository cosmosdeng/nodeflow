import { describe, expect, it } from 'vitest';
import type { FlowNode, Participant, Stage } from '../../types';
import { computeMatrixLayout, computeMatrixGridGeometry } from '../arrange';
import { computeFreeNodePlacements, type FreeNodePlacementInput } from '../freePlacement';
import { runFreePlacement } from '../spikes/freePlacementSpike';
import { fixtures } from '../spikes/stageParticipantFixtures';

/**
 * Phase 4B — Free Placement 正式接入回归(computeMatrixLayout 内部调用 computeFreeNodePlacements)。
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

const layoutOf = (o: {
  participants?: Participant[];
  participantOrder?: string[];
  stages?: Stage[];
  stageOrder?: string[];
  nodes: FlowNode[];
}) =>
  computeMatrixLayout({
    nodes: o.nodes,
    participants: o.participants ?? [],
    participantOrder: o.participantOrder ?? [],
    stages: o.stages ?? [],
    stageOrder: o.stageOrder ?? [],
  });

const overlap = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

describe('Case 1/2/3:原位、local 最小位移、矩阵级 free 不穿越', () => {
  it('free 原位无碰撞 → 位置不变', () => {
    const s1 = stg('s1', ['A']);
    const free = nd('F', undefined, 150, 5000, 5000);
    const pos = layoutOf({
      participants: [part('p1')],
      participantOrder: ['p1'],
      stages: [s1],
      stageOrder: ['s1'],
      nodes: [nd('A', 'p1'), free],
    });
    expect(pos.get('F')).toEqual({ x: 5000, y: 5000 });
  });

  it('free 与 assigned 落位矩形碰撞 → 避让且不与其重叠(矩阵级)', () => {
    const s1 = stg('s1', ['A']);
    const pos = layoutOf({
      participants: [part('p1')],
      participantOrder: ['p1'],
      stages: [s1],
      stageOrder: ['s1'],
      nodes: [nd('A', 'p1'), nd('F', undefined, 150, 104, 80)], // 恰与 A 落位重叠
    });
    const a = pos.get('A')!;
    const f = pos.get('F')!;
    expect(f).not.toEqual({ x: 104, y: 80 });
    expect(overlap({ x: f.x, y: f.y, w: 240, h: 150 }, { x: a.x, y: a.y, w: 240, h: 150 })).toBe(false);
    expect(f.y).toBeGreaterThanOrEqual(a.y + 150); // 在 A 矩形之外(下方)
  });

  it('最小位移(module 直接):选择最近合法候选', () => {
    const input: FreeNodePlacementInput = {
      occupied: [{ id: 'O', rect: { x: 0, y: -30, w: 200, h: 50 } }],
      free: [{ id: 'F', rect: { x: 0, y: 0, w: 200, h: 100 } }],
      gap: 10,
      maxSteps: 4,
    };
    const r = computeFreeNodePlacements(input);
    expect(r.positions.get('F')).toEqual({ x: 0, y: 20 }); // 向下 2×gap=20(最小)
    expect(r.diagnostics[0].level).toBe('local');
  });
});

describe('Case 4/5:component / global peripheral(production module)', () => {
  it('component:local 失败且有分量成员 → 分量外围最近合法位', () => {
    const input: FreeNodePlacementInput = {
      occupied: [{ id: 'P', rect: { x: 0, y: 0, w: 2000, h: 2000 } }],
      free: [{ id: 'F', rect: { x: 100, y: 100, w: 100, h: 80 } }],
      edges: [{ source: 'P', target: 'F' }],
      gap: 16,
      maxSteps: 4,
    };
    const r = computeFreeNodePlacements(input);
    expect(r.diagnostics[0].level).toBe('component');
    expect(r.positions.get('F')).toEqual({ x: 100, y: -96 });
  });

  it('global peripheral:孤立 free local 失败 → 最近外围', () => {
    const input: FreeNodePlacementInput = {
      occupied: [{ id: 'P', rect: { x: 0, y: 0, w: 2000, h: 2000 } }],
      free: [{ id: 'F', rect: { x: 100, y: 100, w: 100, h: 80 } }],
      gap: 16,
      maxSteps: 4,
    };
    const r = computeFreeNodePlacements(input);
    expect(r.diagnostics[0].level).toBe('peripheral');
    expect(r.positions.get('F')).toEqual({ x: 100, y: -96 });
  });
});

describe('Case 6:多 free(矩阵级)彼此避让', () => {
  it('多个 free 与矩阵重叠时逐个 settle、互不重叠', () => {
    const s1 = stg('s1', ['A']);
    const pos = layoutOf({
      participants: [part('p1')],
      participantOrder: ['p1'],
      stages: [s1],
      stageOrder: ['s1'],
      nodes: [nd('A', 'p1'), nd('F1', undefined, 150, 104, 80), nd('F2', undefined, 150, 104, 260)],
    });
    for (const id of ['F1', 'F2']) expect(pos.get(id)).toBeDefined();
    const [f1, f2] = [pos.get('F1')!, pos.get('F2')!];
    expect(
      overlap({ x: f1.x, y: f1.y, w: 240, h: 150 }, { x: f2.x, y: f2.y, w: 240, h: 150 }),
    ).toBe(false);
  });
});

describe('Case 7/8:stageOnly / rowOnly obstacle(矩阵级不穿越)', () => {
  it('stageOnly obstacle:free 不与 stageOnly 落位重叠,也不改变 stageOnly', () => {
    const s1 = stg('s1', ['A', 'X']);
    const nodes = [nd('A', 'p1'), nd('X', undefined), nd('F', undefined, 150, 104, 0)];
    const pos = layoutOf({
      participants: [part('p1')],
      participantOrder: ['p1'],
      stages: [s1],
      stageOrder: ['s1'],
      nodes,
    });
    const x = pos.get('X')!;
    const f = pos.get('F')!;
    expect(overlap({ x: f.x, y: f.y, w: 240, h: 150 }, { x: x.x, y: x.y, w: 240, h: 150 })).toBe(false);
    // stageOnly 仍在其列(Anchor 未被 free 影响)
    expect(pos.get('X')!.x).toBe(pos.get('A')!.x);
  });

  it('rowOnly obstacle:free 不重叠 rowOnly 延伸矩形', () => {
    const s1 = stg('s1', ['A']);
    const nodes = [nd('A', 'p1'), nd('R', 'p1', 150, 0, 400), nd('F', undefined, 150, 5000, 5000)];
    const pos = layoutOf({
      participants: [part('p1')],
      participantOrder: ['p1'],
      stages: [s1],
      stageOrder: ['s1'],
      nodes,
    });
    const r = pos.get('R')!;
    expect(pos.get('R')).toBeDefined();
    const f = pos.get('F')!;
    expect(
      overlap({ x: f.x, y: f.y, w: 240, h: 150 }, { x: r.x, y: r.y, w: 240, h: 150 }),
    ).toBe(false);
  });
});

describe('Case 9/10:composite scope / gateway', () => {
  it('composite child 不作为顶层 Arrange/free 候选;child 不被移动', () => {
    const s1 = stg('s1', ['host']);
    const child = nd('child', undefined, 150, 30, 30);
    const host = nd('host', 'p1', 180, 0, 0);
    host.data = {
      ...host.data,
      composite: { childIds: ['child'], expanded: false },
    };
    const pos = layoutOf({
      participants: [part('p1')],
      participantOrder: ['p1'],
      stages: [s1],
      stageOrder: ['s1'],
      nodes: [host, child],
    });
    expect(pos.has('child')).toBe(false); // 不在 scope
    expect(child.position).toEqual({ x: 30, y: 30 }); // 未被移动
  });

  it('gateway 按普通 Node obstacle 参与 free 避让', () => {
    const s1 = stg('s1', ['A']);
    const g = nd('gw', undefined, 180, 104, 80);
    const pos = layoutOf({
      participants: [part('p1')],
      participantOrder: ['p1'],
      stages: [s1],
      stageOrder: ['s1'],
      nodes: [nd('A', 'p1'), g],
    });
    const a = pos.get('A')!;
    const f = pos.get('gw')!;
    expect(overlap({ x: f.x, y: f.y, w: 240, h: 180 }, { x: a.x, y: a.y, w: 240, h: 150 })).toBe(false);
  });
});

describe('Case 11/12:determinism 与 semantic immutability(矩阵级)', () => {
  const mk = () => {
    const s1 = stg('s1', ['A', 'X']);
    return {
      participants: [part('p1')],
      participantOrder: ['p1'],
      stages: [s1],
      stageOrder: ['s1'],
      nodes: [nd('A', 'p1'), nd('X', undefined), nd('F', undefined, 150, 104, 80)],
    };
  };
  it('重复 20 次结果一致', () => {
    const first = layoutOf(mk());
    for (let i = 0; i < 19; i++) {
      expect([...layoutOf(mk()).entries()]).toEqual([...first.entries()]);
    }
  });

  it('semantic 不变:participantId / Stage.nodeIds / participantOrder / stageOrder', () => {
    const doc = mk();
    const pidBefore = doc.nodes.map((n) => n.data?.participantId);
    const stageIdsBefore = doc.stages.map((s) => s.nodeIds.join(','));
    layoutOf(doc);
    expect(doc.nodes.map((n) => n.data?.participantId)).toEqual(pidBefore);
    expect(doc.stages.map((s) => s.nodeIds.join(','))).toEqual(stageIdsBefore);
    expect(doc.participantOrder).toEqual(['p1']);
    expect(doc.stageOrder).toEqual(['s1']);
  });
});

describe('Production 与 Spike 一致性(behavior reference)', () => {
  const cases: FreeNodePlacementInput[] = [
    {
      occupied: [{ id: 'O', rect: { x: 0, y: 0, w: 240, h: 150 } }],
      free: [{ id: 'F', rect: { x: 0, y: 0, w: 240, h: 150 } }],
      gap: 50,
      maxSteps: 4,
    },
    {
      occupied: [{ id: 'P', rect: { x: 0, y: 0, w: 2000, h: 2000 } }],
      free: [{ id: 'F', rect: { x: 100, y: 100, w: 100, h: 80 } }],
      edges: [{ source: 'P', target: 'F' }],
      gap: 16,
      maxSteps: 4,
    },
    {
      occupied: [
        { id: 'A', rect: { x: 0, y: 0, w: 240, h: 150 } },
        { id: 'S', rect: { x: 0, y: 400, w: 240, h: 150 } },
      ],
      free: [
        { id: 'F1', rect: { x: 0, y: 0, w: 240, h: 150 } },
        { id: 'F2', rect: { x: 0, y: 400, w: 240, h: 150 } },
        { id: 'F3', rect: { x: 3000, y: 3000, w: 200, h: 100 } },
      ],
      gap: 16,
      maxSteps: 4,
    },
  ];
  it('相同纯输入:production 与 spike 位置完全一致', () => {
    for (const input of cases) {
      const prod = computeFreeNodePlacements(input);
      const spike = runFreePlacement(input);
      expect([...prod.positions.entries()].sort()).toEqual([...spike.positions.entries()].sort());
    }
  });
});

describe('real_like:新策略 vs 旧四角策略指标', () => {
  it('node5dd 不再大跳;free overlap=0;新旧位移对比', () => {
    const input = fixtures.find((f) => f.name === 'real_like')!.input();
    const placed = computeMatrixLayout({
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
    const childIds = new Set<string>();
    for (const n of input.nodes) for (const c of n.data?.composite?.childIds ?? []) childIds.add(c);
    const frees = input.nodes.filter(
      (n) =>
        !childIds.has(n.id) &&
        !(input.stages.some((s) => s.nodeIds.includes(n.id))) &&
        !(!!n.data?.participantId && input.participants.some((p) => p.id === n.data!.participantId)),
    );
    // 旧四角策略(replica,基于行列带投影)
    const zone = {
      l: geo.colXs[0],
      r: geo.colRights[geo.colRights.length - 1],
      t: geo.rowYs.get(0) ?? 80,
      b: geo.rowBottoms.get(geo.structure.rows.length - 1) ?? 0,
    };
    const oldMoves = frees.map((n) => {
      const { w, h } = { w: n.width ?? 240, h: n.height ?? 150 };
      const { x, y } = n.position;
      const yHit = y < zone.b && y + h > zone.t;
      const xHit = x < zone.r && x + w > zone.l;
      if (!yHit && !xHit) return { id: n.id, d: 0 };
      const corners = [
        { dx: zone.l - 16 - w - x, dy: zone.t - 16 - h - y },
        { dx: zone.l - 16 - w - x, dy: zone.b + 16 - y },
        { dx: zone.r + 16 - x, dy: zone.t - 16 - h - y },
        { dx: zone.r + 16 - x, dy: zone.b + 16 - y },
      ];
      const pick = corners.sort(
        (a, b) =>
          Math.abs(a.dx) + Math.abs(a.dy) - (Math.abs(b.dx) + Math.abs(b.dy)),
      )[0];
      return { id: n.id, d: Math.abs(pick.dx) + Math.abs(pick.dy) };
    });
    const newMoves = frees.map((n) => {
      const p = placed.get(n.id);
      return { id: n.id, d: p ? Math.abs(p.x - n.position.x) + Math.abs(p.y - n.position.y) : 0 };
    });
    const sum = (arr: { d: number }[]) => arr.reduce((a, b) => a + b.d, 0);
    const max = (arr: { d: number }[]) => Math.max(0, ...arr.map((x) => x.d));
    // free 之间及与矩阵内容 zero overlap
    const occupiedRects = input.nodes
      .filter((n) => placed.has(n.id) && !frees.some((f) => f.id === n.id))
      .map((n) => ({
        x: placed.get(n.id)!.x,
        y: placed.get(n.id)!.y,
        w: n.width ?? 240,
        h: n.height ?? 150,
      }));
    let overlapCount = 0;
    for (const f of frees) {
      const p = placed.get(f.id);
      if (!p) continue;
      for (const o of occupiedRects) {
        if (overlap({ x: p.x, y: p.y, w: f.width ?? 240, h: f.height ?? 150 }, o)) overlapCount += 1;
      }
    }
    expect(overlapCount).toBe(0);
    expect(sum(newMoves)).toBeLessThanOrEqual(sum(oldMoves));
    expect(max(newMoves)).toBeLessThanOrEqual(max(oldMoves));
    // node5dd 不应再是旧 corner(398,464)
    const node5dd = placed.get('node5dd');
    if (node5dd) expect([node5dd.x, node5dd.y]).not.toEqual([398, 464]);
    console.log(
      '[free old-vs-new]',
      JSON.stringify({
        freeCount: frees.length,
        oldTotal: sum(oldMoves),
        newTotal: sum(newMoves),
        oldMax: max(oldMoves),
        newMax: max(newMoves),
        overlap: overlapCount,
      }),
    );
  });
});
