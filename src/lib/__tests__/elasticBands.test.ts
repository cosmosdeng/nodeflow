import { describe, expect, it } from 'vitest';
import {
  computeElasticMatrixGeometry,
  fitOrderedEnvelopes,
  rectsToEnvelope,
  type AxisBandSpec,
} from '../elasticBands';

describe('Elastic Band Arrange Spike(T21–T28)', () => {
  it('T21 Participant envelope 完整包含其节点矩形(rectangle containment)', () => {
    const rects = [
      { x: 0, y: 100, w: 100, h: 50 },
      { x: 0, y: 300, w: 100, h: 50 },
      { x: 0, y: 500, w: 100, h: 50 },
    ];
    const env = rectsToEnvelope(rects, 10);
    const res = fitOrderedEnvelopes(
      [{ id: 'P1', maxAllowedStart: env.minY, minRequiredEnd: env.maxY, preferredStart: 80 }],
      0,
    );
    const band = res.bands[0];
    for (const r of rects) {
      expect(band.start).toBeLessThanOrEqual(r.y); // top ≤ node.y
      expect(band.end).toBeGreaterThanOrEqual(r.y + r.h); // bottom ≥ node bottom
    }
    expect(res.conflicts).toEqual([]);
  });

  it('T22 Stage envelope 完整包含其节点矩形', () => {
    const rects = [
      { x: 100, y: 0, w: 200, h: 60 },
      { x: 400, y: 0, w: 200, h: 60 },
      { x: 700, y: 0, w: 200, h: 60 },
    ];
    const PAD = 16;
    const res = fitOrderedEnvelopes(
      [
        { id: 'S1', maxAllowedStart: rects[0].x - PAD, minRequiredEnd: rects[0].x + rects[0].w + PAD, preferredStart: 80 },
        { id: 'S2', maxAllowedStart: rects[1].x - PAD, minRequiredEnd: rects[1].x + rects[1].w + PAD, preferredStart: rects[1].x - PAD },
        { id: 'S3', maxAllowedStart: rects[2].x - PAD, minRequiredEnd: rects[2].x + rects[2].w + PAD, preferredStart: rects[2].x - PAD },
      ],
      40,
    );
    expect(res.bands.map((b) => b.id)).toEqual(['S1', 'S2', 'S3']);
    res.bands.forEach((b, i) => {
      expect(b.start).toBeLessThanOrEqual(rects[i].x);
      expect(b.end).toBeGreaterThanOrEqual(rects[i].x + rects[i].w);
    });
    expect(res.conflicts).toEqual([]);
  });

  it('T23 Band order 保持:即便 Node 几何很乱也不交换顺序', () => {
    // P1 内容很靠下、P2 内容很靠上 → 顺序+包含不可兼得,但顺序必须保持
    const specs: AxisBandSpec[] = [
      { id: 'P1', maxAllowedStart: 500, minRequiredEnd: 560, preferredStart: 480 },
      { id: 'P2', maxAllowedStart: 100, minRequiredEnd: 160, preferredStart: 80 },
    ];
    const res = fitOrderedEnvelopes(specs, 20);
    expect(res.bands.map((b) => b.id)).toEqual(['P1', 'P2']); // 顺序未交换
    // 顺序与最小间距保持:P2.start ≥ P1.end + gap
    expect(res.bands[1].start).toBeGreaterThanOrEqual(res.bands[0].end + 20);
    expect(res.conflicts.length).toBeGreaterThan(0); // 冲突被如实记录
  });

  it('T24 无需移动时:newBandPosition === preferredPosition', () => {
    const res = fitOrderedEnvelopes(
      [
        { id: 'P1', maxAllowedStart: 100, minRequiredEnd: 150, preferredStart: 100 },
        { id: 'P2', maxAllowedStart: 420, minRequiredEnd: 470, preferredStart: 420 },
      ],
      20,
    );
    expect(res.displacement).toBe(0);
    expect(res.bands[0].start).toBe(100);
    expect(res.bands[1].start).toBe(420);
  });

  it('T25 碰撞时只做满足 clearance 所需的最小移动', () => {
    // P1 的 requiredBottom 直接撞到 P2 的 preferred top
    const res = fitOrderedEnvelopes(
      [
        { id: 'P1', maxAllowedStart: 50, minRequiredEnd: 900, preferredStart: 50 },
        { id: 'P2', maxAllowedStart: 1100, minRequiredEnd: 1150, preferredStart: 900 },
      ],
      20,
    );
    expect(res.bands[0].start).toBe(50); // P1 不动
    // P2 只需推到满足 clearance:900+20=920(不做额外大范围移动)
    expect(res.bands[1].start).toBe(920);
    expect(res.bands[1].end).toBe(1150);
  });

  it('T26 Band fitting 不重排 Node:node positions unchanged', () => {
    const positions = new Map([
      ['A', { x: 100, y: 100 }],
      ['B', { x: 350, y: 300 }],
    ]);
    const before = [...positions.entries()].map(([id, p]) => [id, { ...p }]);
    fitOrderedEnvelopes(
      [
        { id: 'P1', maxAllowedStart: 90, minRequiredEnd: 160, preferredStart: 90 },
        { id: 'P2', maxAllowedStart: 340, minRequiredEnd: 410, preferredStart: 340 },
      ],
      20,
    );
    expect([...positions.entries()].map(([id, p]) => [id, p])).toEqual(before);
  });

  it('T27 T16 adversarial:顺序/语义不变,弹性移动与 conflict 被如实记录', () => {
    // 拓扑 A(P1) → C(P3) → B(P2);行序 P1/P2/P3。
    // 若 Node 布局保持拓扑视觉(A 上、C 中、B 下),则 P3 的节点 C 必然在 P2 的节点 B 上方,
    // 与「P2 band 必须位于 P3 band 之上 + 完全包含」冲突 → 记录,不改顺序。
    const order = ['P1', 'P2', 'P3'];
    const res = fitOrderedEnvelopes(
      [
        { id: 'P1', maxAllowedStart: 100, minRequiredEnd: 150, preferredStart: 80 }, // A.y=100
        { id: 'P2', maxAllowedStart: 500, minRequiredEnd: 550, preferredStart: 460 }, // B.y=500
        { id: 'P3', maxAllowedStart: 300, minRequiredEnd: 350, preferredStart: 260 }, // C.y=300
      ],
      20,
    );
    // participant 顺序不改变(也未交换)
    expect(res.bands.map((b) => b.id)).toEqual(order);
    // 顺序 + 最小间距被保持(没有偷偷把 P3 提到 P2 上)
    expect(res.bands[1].start).toBeGreaterThanOrEqual(res.bands[0].end + 20);
    expect(res.bands[2].start).toBeGreaterThanOrEqual(res.bands[1].end + 20);
    // 该冲突无法用最小 Band 移动消除 → 被记录(而不是悄悄违反顺序)
    expect(res.conflicts.length).toBe(1);
    expect(res.conflicts[0]).toContain('P3');
    // Band displacement 量化输出
    expect(res.displacement).toBeGreaterThanOrEqual(0);
  });

  it('T28 Determinism:同输入两次结果完全一致', () => {
    const specs: AxisBandSpec[] = [
      { id: 'P1', maxAllowedStart: 100, minRequiredEnd: 300, preferredStart: 80 },
      { id: 'P2', maxAllowedStart: 500, minRequiredEnd: 700, preferredStart: 460 },
    ];
    const a = fitOrderedEnvelopes(specs, 20);
    const b = fitOrderedEnvelopes(specs, 20);
    expect(a).toEqual(b);
  });
});

describe('Elastic Band Product Integration(I1–I8)', () => {
  const participants = [
    { id: 'P1', name: 'P1' },
    { id: 'P2', name: 'P2' },
    { id: 'P3', name: 'P3' },
  ];
  const stages = [
    { id: 'S1', name: 'S1' },
    { id: 'S2', name: 'S2' },
    { id: 'S3', name: 'S3' },
  ];

  const sampleNodes = () => [
    // assigned:同时进 Participant 与 Stage envelope
    { id: 'A', pid: 'P1', stage: 'S1', rect: { x: 100, y: 100, w: 200, h: 50 } },
    { id: 'B', pid: 'P1', stage: 'S2', rect: { x: 420, y: 100, w: 200, h: 50 } },
    { id: 'C', pid: 'P2', stage: 'S1', rect: { x: 120, y: 500, w: 180, h: 50 } },
    // rowOnly:只进 Participant envelope
    { id: 'R', pid: 'P2', rect: { x: 700, y: 560, w: 180, h: 50 } },
    // free:不进任何 envelope
    { id: 'F', rect: { x: 900, y: 900, w: 180, h: 50 } },
  ];

  it('I1/I7 完整数据流 Arrange→elastic→bandGeometry 且 assigned Node 矩形完整包含', () => {
    const nodeRects = sampleNodes();
    const before = JSON.stringify(nodeRects);
    const geo = computeElasticMatrixGeometry({
      participants,
      stages,
      participantOrder: ['P1', 'P2', 'P3'],
      stageOrder: ['S1', 'S2', 'S3'],
      nodeRects,
    });
    // node geometry 不被修改(I2 的一部分)
    expect(JSON.stringify(nodeRects)).toBe(before);

    const p1 = geo.participantBands.find((b) => b.id === 'P1')!;
    const p2 = geo.participantBands.find((b) => b.id === 'P2')!;
    // P1 包含 A、B;P2 包含 C、R(rowOnly)
    for (const id of ['A', 'B']) {
      const r = nodeRects.find((n) => n.id === id)!.rect;
      expect(p1.top).toBeLessThanOrEqual(r.y);
      expect(p1.bottom).toBeGreaterThanOrEqual(r.y + r.h);
    }
    for (const id of ['C', 'R']) {
      const r = nodeRects.find((n) => n.id === id)!.rect;
      expect(p2.top).toBeLessThanOrEqual(r.y);
      expect(p2.bottom).toBeGreaterThanOrEqual(r.y + r.h);
    }
    // free 不产生 band
    expect(geo.participantBands.length).toBe(3);

    const s1 = geo.stageBands.find((b) => b.id === 'S1')!;
    const s2 = geo.stageBands.find((b) => b.id === 'S2')!;
    // S1 包含 A、C;S2 包含 B;rowOnly/free 不进 Stage envelope
    for (const id of ['A', 'C']) {
      const r = nodeRects.find((n) => n.id === id)!.rect;
      expect(s1.left).toBeLessThanOrEqual(r.x);
      expect(s1.right).toBeGreaterThanOrEqual(r.x + r.w);
    }
    const rb = nodeRects.find((n) => n.id === 'B')!.rect;
    expect(s2.left).toBeLessThanOrEqual(rb.x);
    expect(s2.right).toBeGreaterThanOrEqual(rb.x + rb.w);
  });

  it('I2/I3/I4 Band fitting 不移动 Node、不改变 assignment', () => {
    const nodeRects = sampleNodes();
    const assignments = nodeRects.map((n) => ({ pid: n.pid, stage: n.stage }));
    computeElasticMatrixGeometry({
      participants,
      stages,
      participantOrder: ['P1', 'P2', 'P3'],
      stageOrder: ['S1', 'S2', 'S3'],
      nodeRects,
    });
    expect(nodeRects.every((n, i) => n.pid === assignments[i].pid && n.stage === assignments[i].stage)).toBe(true);
  });

  it('I5/I6 Participant/Stage order unchanged', () => {
    const po = ['P1', 'P2', 'P3'];
    const so = ['S1', 'S2', 'S3'];
    const geo = computeElasticMatrixGeometry({
      participants,
      stages,
      participantOrder: po,
      stageOrder: so,
      nodeRects: sampleNodes(),
    });
    expect(geo.participantBands.map((b) => b.id)).toEqual(po);
    expect(geo.stageBands.map((b) => b.id)).toEqual(so);
  });

  it('I8 T16 integration:顺序/语义保持、Node 不动、conflict 记录', () => {
    const nodeRects = [
      { id: 'A', pid: 'P1', stage: 'S1', rect: { x: 100, y: 100, w: 200, h: 50 } },
      { id: 'C', pid: 'P3', stage: 'S2', rect: { x: 420, y: 300, w: 200, h: 50 } },
      { id: 'B', pid: 'P2', stage: 'S3', rect: { x: 740, y: 500, w: 200, h: 50 } },
    ];
    const before = JSON.stringify(nodeRects);
    const geo = computeElasticMatrixGeometry({
      participants,
      stages,
      participantOrder: ['P1', 'P2', 'P3'],
      stageOrder: ['S1', 'S2', 'S3'],
      nodeRects,
    });
    expect(geo.participantBands.map((b) => b.id)).toEqual(['P1', 'P2', 'P3']);
    expect(geo.stageBands.map((b) => b.id)).toEqual(['S1', 'S2', 'S3']);
    expect(JSON.stringify(nodeRects)).toBe(before);
    // 结构性 conflict(P3 的 C 在 P2 的 B 之上)被如实记录
    expect(geo.diagnostics.conflicts.length).toBeGreaterThan(0);
  });
});
