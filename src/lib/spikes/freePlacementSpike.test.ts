import { describe, expect, it } from 'vitest';
import { runFreePlacement, summarize, type PlacementInput, type PlacementResult } from './freePlacementSpike';
import { computeMatrixLayout } from '../arrange';
import { fixtures } from './stageParticipantFixtures';

/**
 * Phase 4A — Free Node Placement Spike(纯策略验证,不接入生产 Arrange)。
 * Level 0 original → Level 1 local → Level 2 component → Level 3 peripheral。
 * 注意:local 步长为 gap 的整数倍(≤ maxSteps×gap);fixture 几何按此对齐设计。
 */

const R = (id: string, x: number, y: number, w: number, h: number) => ({ id, rect: { x, y, w, h } });
const edge = (s: string, t: string) => ({ source: s, target: t });

const run = (o: {
  occupied?: { id: string; rect: { x: number; y: number; w: number; h: number } }[];
  free: { id: string; rect: { x: number; y: number; w: number; h: number } }[];
  edges?: { source: string; target: string }[];
  gap?: number;
  maxSteps?: number;
}) =>
  runFreePlacement({
    occupied: o.occupied ?? [],
    free: o.free,
    edges: o.edges ?? [],
    gap: o.gap ?? 16,
    maxSteps: o.maxSteps ?? 4,
  });

const diagOf = (r: PlacementResult, id: string) => r.diagnostics.find((d) => d.nodeId === id)!;

describe('Level 0:原位无碰撞 → 不移动', () => {
  it('孤立 free、无 occupied → original(displacement 0)', () => {
    const r = run({ free: [R('F', 1000, 1000, 200, 100)] });
    expect(diagOf(r, 'F').level).toBe('original');
    expect(r.positions.get('F')).toEqual({ x: 1000, y: 1000 });
  });

  it('free 远离 occupied → original', () => {
    const r = run({ occupied: [R('A', 0, 0, 200, 150)], free: [R('F', 5000, 5000, 200, 100)] });
    expect(diagOf(r, 'F').level).toBe('original');
  });
});

describe('Level 1:local 最小位移', () => {
  it('原位重叠 → 选最小 local(向下 2×gap 越过障碍),而非更远方向', () => {
    // gap=10;F(0,0,200,100),障碍 O(0,-30,200,50) 底=20 → 需下移 20(=2×gap)才清除
    const r = run({
      gap: 10,
      occupied: [R('O', 0, -30, 200, 50)],
      free: [R('F', 0, 0, 200, 100)],
    });
    expect(diagOf(r, 'F').level).toBe('local');
    expect(r.positions.get('F')).toEqual({ x: 0, y: 20 });
    expect(diagOf(r, 'F').displacement).toBe(20);
  });

  it('对称方向冲突时:等距候选按固定方向序(先 right)', () => {
    // gap=50;F(200,0,50,50) 被竖直 slab 完全罩住(y 0..600 无法上下逃离),
    // 左右清除距离均为 50 → 固定方向序选 right(x+50)。
    const slabY = R('S', 200, 0, 50, 600);
    const r = run({
      gap: 50,
      occupied: [slabY],
      free: [R('F', 200, 0, 50, 50)],
    });
    expect(diagOf(r, 'F').level).toBe('local');
    expect(r.positions.get('F')).toEqual({ x: 250, y: 0 });
    expect(diagOf(r, 'F').displacement).toBe(50);
  });

  it('候选选择最小位移而非候选顺序(向上 10 优先于向下更远)', () => {
    // gap=10;F(0,0,200,100),障碍在 F 下方交叠 10px(90..110)→ 向上 10 即可清除(最小)
    const r = run({
      gap: 10,
      occupied: [R('D', 0, 90, 200, 20)],
      free: [R('F', 0, 0, 200, 100)],
      maxSteps: 4,
    });
    expect(diagOf(r, 'F').level).toBe('local');
    expect(r.positions.get('F')).toEqual({ x: 0, y: -10 });
    expect(diagOf(r, 'F').displacement).toBe(10);
  });
});

describe('Level escalation 到 component / peripheral', () => {
  it('local 全部失败 + 分量成员存在 → component(P bbox 外围最近合法位)', () => {
    // gap=16,F(100,100,100,80) 完全在巨大 P 内部;local 最多 4×16=64 无法逃离
    // → component;P bbox 最近外围 = 顶部(-196,位移最小,非固定角落)
    const r = run({
      occupied: [R('P', 0, 0, 2000, 2000)],
      free: [R('F', 100, 100, 100, 80)],
      edges: [edge('P', 'F')],
      maxSteps: 4,
    });
    expect(diagOf(r, 'F').level).toBe('component');
    expect(r.positions.get('F')).toEqual({ x: 100, y: -96 });
    expect(diagOf(r, 'F').displacement).toBe(196);
  });

  it('孤立 free(无分量成员)local 失败 → global peripheral(最近外围位,非固定角落)', () => {
    const r = run({
      occupied: [R('P', 0, 0, 2000, 2000)],
      free: [R('F', 100, 100, 100, 80)],
      maxSteps: 4,
    });
    expect(diagOf(r, 'F').level).toBe('peripheral');
    expect(r.positions.get('F')).toEqual({ x: 100, y: -96 });
  });
});

describe('多 free / obstacle 类型', () => {
  it('assigned/rowOnly/stageOnly 障碍 → free 各自 local 消除、互不重叠', () => {
    const gap = 50;
    const input = {
      occupied: [R('assigned', 0, 0, 240, 150), R('rowOnly', 0, 400, 240, 150), R('stageOnly', 600, 0, 240, 150)],
      free: [R('F1', 0, 0, 240, 150), R('F2', 0, 400, 240, 150), R('F3', 600, 0, 240, 150)],
    };
    const r = runFreePlacement({ ...input, gap, maxSteps: 4 });
    const m = summarize({ ...input, gap, maxSteps: 4 }, r);
    expect(m.overlapCount).toBe(0);
    for (const id of ['F1', 'F2', 'F3']) expect(diagOf(r, id).level).toBe('local');
    const key = new Set(['F1', 'F2', 'F3'].map((id) => `${r.positions.get(id)!.x},${r.positions.get(id)!.y}`));
    expect(key.size).toBe(3); // 各自就位,不集中同角
  });

  it('多个孤立 free:仅与矩阵重叠者 local 微移,远离者保持 original', () => {
    const gap = 50;
    const input = {
      occupied: [R('M', 0, 0, 240, 300)],
      free: [
        R('F1', 40, 200, 200, 100), // 与 M 重叠 → 下移 100(=2×gap)清出
        R('F2', 400, 200, 200, 100), // 远离 → original
      ],
    };
    const r = runFreePlacement({ ...input, gap, maxSteps: 4 });
    expect(diagOf(r, 'F1').level).toBe('local');
    expect(r.positions.get('F1')).toEqual({ x: 40, y: 300 });
    expect(diagOf(r, 'F2').level).toBe('original');
  });
});

describe('Component + 多 free', () => {
  it('同一分量两个 free(local 均失败):各自落在分量外围且不重叠', () => {
    // P(0,0,600,800):F1(300,300,200,100) 与 F2(300,600,200,100) 都在 P 内部。
    // gap=50,local 最多 200 → 上(-400)/下(+500)/左(-500)/右(+300)均无法退出 → component。
    // F1 最近外围 = P 右侧(+350);F2 处理时分量 bbox 含 F1 → 最近 = 下方(+250)。
    const gap = 50;
    const input = {
      occupied: [R('P', 0, 0, 600, 800)],
      free: [R('F1', 300, 300, 200, 100), R('F2', 300, 600, 200, 100)],
      edges: [edge('P', 'F1'), edge('F1', 'F2')],
    };
    const r = runFreePlacement({ ...input, gap, maxSteps: 4 });
    const m = summarize({ ...input, gap, maxSteps: 4 }, r);
    expect(m.overlapCount).toBe(0);
    // F1(local 四方向均超出 200)→ component:最近外围 = P 右侧外
    expect(diagOf(r, 'F1').level).toBe('component');
    expect(r.positions.get('F1')).toEqual({ x: 600 + gap, y: 300 });
    // F2 恰可在 max local(向下 200)贴 P 底清出 → 仍按 local 处理(最小位移优先)
    expect(diagOf(r, 'F2').level).toBe('local');
    expect(r.positions.get('F2')).toEqual({ x: 300, y: 800 });
    // F1 与 F2 不重叠
    expect(r.positions.get('F2')!.y).toBeGreaterThanOrEqual(r.positions.get('F1')!.y + 100);
  });
});

describe('determinism / minimal / semantic', () => {
  it('同一 fixture 运行 20 次结果完全一致(x/y/level)', () => {
    const input: PlacementInput = {
      occupied: [R('A', 0, 0, 240, 150), R('B', 0, 400, 240, 150)],
      free: [R('F1', 0, 0, 240, 150), R('F2', 0, 400, 240, 150), R('F3', 3000, 3000, 200, 100)],
      edges: [edge('A', 'F1')],
      gap: 16,
      maxSteps: 4,
    };
    const first = runFreePlacement(input);
    for (let i = 0; i < 19; i++) {
      const again = runFreePlacement(input);
      expect([...again.positions.entries()]).toEqual([...first.positions.entries()]);
      expect(again.diagnostics.map((d) => [d.nodeId, d.level])).toEqual(
        first.diagnostics.map((d) => [d.nodeId, d.level]),
      );
    }
  });

  it('semantic immutability:输出仅 id→position + level;无 participantId/stageId', () => {
    const r = run({
      gap: 50,
      occupied: [R('O', 0, 0, 240, 150)],
      free: [R('F', 0, 0, 240, 150)],
    });
    for (const [id, p] of r.positions) {
      expect(typeof id).toBe('string');
      expect(Object.keys(p)).toEqual(['x', 'y']);
    }
    const d = r.diagnostics[0];
    expect(d.nodeId).toBe('F');
    expect(['original', 'local', 'component', 'peripheral']).toContain(d.level);
  });
});

describe('real_like(复用 Spike fixture;occupied 取矩阵落位)', () => {
  it('真 free 用新策略:无重叠、保持 original/local 为主,无大距离弹角', () => {
    const input = fixtures.find((f) => f.name === 'real_like')!.input();
    const placed = computeMatrixLayout({
      nodes: input.nodes,
      participants: input.participants,
      participantOrder: input.participantOrder,
      stages: input.stages,
      stageOrder: input.stageOrder,
    });
    const childIds = new Set<string>();
    for (const n of input.nodes) for (const c of n.data?.composite?.childIds ?? []) childIds.add(c);
    const occupied = input.nodes
      .filter((n) => placed.has(n.id) && !childIds.has(n.id))
      .filter(
        (n) =>
          input.stages.some((s) => s.nodeIds.includes(n.id)) ||
          (!!n.data?.participantId && input.participants.some((p) => p.id === n.data!.participantId)),
      )
      .map((n) => ({
        id: n.id,
        rect: { x: placed.get(n.id)!.x, y: placed.get(n.id)!.y, w: n.width ?? 240, h: n.height ?? 150 },
      }));
    const free = input.nodes
      .filter((n) => !childIds.has(n.id) && !occupied.some((o) => o.id === n.id))
      .map((n) => ({
        id: n.id,
        rect: { x: n.position.x, y: n.position.y, w: n.width ?? 240, h: n.height ?? 150 },
      }));
    const all = { occupied, free, gap: 16, maxSteps: 4 };
    const sp = runFreePlacement(all);
    const m = summarize(all, sp);
    expect(m.overlapCount).toBe(0);
    // 原则性观察:几乎都保持 original/local(无大跳跃),极端才 component/peripheral
    const levels = sp.diagnostics.map((d) => d.level);
    expect(levels.every((l) => l === 'original' || l === 'local')).toBe(true);
    console.log('[real_like free]', JSON.stringify({ m, levels }));
  });
});
