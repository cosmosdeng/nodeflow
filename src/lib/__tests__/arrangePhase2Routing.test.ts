import { describe, expect, it } from 'vitest';
import type { FlowNode, Participant, Stage } from '../../types';
import { computeMatrixGridGeometry, computeMatrixLayout, computeMatrixGridStructure } from '../arrange';
import { classifyMatrixNode, type MatrixNodeClassification } from '../matrixClassification';
import { fixtures } from '../spikes/stageParticipantFixtures';

/**
 * Phase 2 — Arrange 消费统一 Matrix Node Classification 后的四类 routing。
 * 重点:stageOnly 不再折叠进 free,而是路由进其 Stage 列(临时 Y,正式 Anchor 属后续 Phase)。
 * 以及 assigned / rowOnly 几何保持、free 沿用现有处理、语义顺序不变。
 */

const part = (id: string): Participant => ({ id, name: id, type: 'person' });
const stg = (id: string, nodeIds: string[], name = id): Stage => ({
  id,
  name,
  x: 0,
  y: 0,
  width: 300,
  height: 200,
  nodeIds,
});
const nd = (id: string, pid?: string, x = 0, y = 0, w = 240, h = 150): FlowNode => ({
  id,
  type: 'flow',
  position: { x, y },
  width: w,
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

const MATRIX_CELL_PAD_X = 24;

describe('四类 routing(computeMatrixLayout)', () => {
  const input = {
    participants: [part('p1'), part('p2')],
    participantOrder: ['p1', 'p2'],
    stages: [stg('s1', ['nAssigned', 'nStageOnly']), stg('s2', [])],
    stageOrder: ['s1', 's2'],
    nodes: [
      nd('nAssigned', 'p1', 0, 0), // assigned
      nd('nRowOnly', 'p1', 60, 400), // rowOnly(同 p1 但无 stage)
      nd('nStageOnly', undefined, 120, 500), // stageOnly(s1)
      nd('nFree', undefined, 3000, 3000), // free
    ],
  };

  it('assigned → Matrix cell;rowOnly → participant 行延伸;stageOnly → 其 Stage 列;free → 现处理', () => {
    const pos = computeMatrixLayout(input);
    expect(
      classifyMatrixNode(input.nodes[0], { participants: input.participants, stages: input.stages }).classification,
    ).toBe('assigned');
    expect(
      classifyMatrixNode(input.nodes[1], { participants: input.participants, stages: input.stages }).classification,
    ).toBe('rowOnly');
    expect(
      classifyMatrixNode(input.nodes[2], { participants: input.participants, stages: input.stages }).classification,
    ).toBe('stageOnly');
    expect(
      classifyMatrixNode(input.nodes[3], { participants: input.participants, stages: input.stages }).classification,
    ).toBe('free');

    const geo = computeMatrixGridGeometry(input);
    const colXs = geo.colXs; // s1 列宽含 assigned/stageOnly
    // assigned:cell (p1 行首,s1 列)
    expect(pos.get('nAssigned')!.x).toBe(colXs[0] + MATRIX_CELL_PAD_X);
    expect(pos.get('nAssigned')!.y).toBe(80);
    // rowOnly:该 participant 行带内、Stage 列区右缘之外(不折叠 free)
    expect(pos.get('nRowOnly')!.x).toBeGreaterThan(geo.colRights[geo.colRights.length - 1]);
    expect(pos.get('nRowOnly')!.y).toBe(80); // p1 行顶
    // stageOnly:进入 s1 列,临时 Y 在该列 assigned 内容底之后
    expect(pos.get('nStageOnly')!.x).toBe(colXs[0] + MATRIX_CELL_PAD_X);
    expect(pos.get('nStageOnly')!.y).toBeGreaterThan(80 + 150);
    // free:两轴皆无、远离矩阵 → 保持原位(Phase 4B 起结果物化为原坐标)
    expect(pos.get('nFree')).toEqual({ x: 3000, y: 3000 });
  });

  it('participantOrder / stageOrder 语义不被几何反向修改', () => {
    const beforeP = [...input.participantOrder];
    const beforeS = [...input.stageOrder];
    const beforeNodes = JSON.stringify(input.nodes.map((n) => ({ pid: n.data?.participantId, id: n.id })));
    computeMatrixLayout(input);
    computeMatrixGridStructure(input);
    expect(input.participantOrder).toEqual(beforeP);
    expect(input.stageOrder).toEqual(beforeS);
    expect(JSON.stringify(input.nodes.map((n) => ({ pid: n.data?.participantId, id: n.id })))).toBe(beforeNodes);
  });
});

describe('real_like:stageOnly 进入其 Stage 列(classification!==free)', () => {
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

  it('seed_4 / chvx9j / g60uoi:分类为 stageOnly 且已被放入其 Stage 列', () => {
    const cols = geo.structure.cols; // [qc, g1]
    const colOf = new Map(
      input.nodes.map((n) => {
        const cls = classifyMatrixNode(n, { participants: input.participants, stages: input.stages });
        return [n.id, cls] as const;
      }),
    );
    // 确认语义:三者皆为 stageOnly
    for (const id of ['seed_4', 'chvx9j', 'g60uoi']) {
      expect(colOf.get(id)!.classification, id).toBe('stageOnly');
    }
    // 布局 map 中存在(进入 Stage 列,不再折叠进 free)
    for (const id of ['seed_4', 'chvx9j', 'g60uoi']) expect(pos.has(id), id).toBe(true);

    // seed_4 / g60uoi 属于 qc 列(idx0)
    const qcIdx = cols.indexOf('qc');
    const g1Idx = cols.indexOf('g1');
    expect(pos.get('seed_4')!.x).toBe(geo.colXs[qcIdx] + MATRIX_CELL_PAD_X);
    expect(pos.get('g60uoi')!.x).toBe(geo.colXs[qcIdx] + MATRIX_CELL_PAD_X);
    // 同列内 seed_4(上游)在 g60uoi 之上
    expect(pos.get('seed_4')!.y).toBeLessThan(pos.get('g60uoi')!.y);
    // chvx9j 属于 g1 列(idx1),与 composite 同列
    expect(pos.get('chvx9j')!.x).toBe(geo.colXs[g1Idx] + MATRIX_CELL_PAD_X);
    // 临时 Y:g1 列 assigned(composite)内容底之后
    expect(pos.get('chvx9j')!.y).toBeGreaterThan(pos.get('composite')!.y + 180);
  });

  it('non-stageOnly 节点语义不变;free 仍走现有处理', () => {
    const clsMap = new Map<string, MatrixNodeClassification>();
    for (const n of input.nodes) {
      clsMap.set(
        n.id,
        classifyMatrixNode(n, { participants: input.participants, stages: input.stages }).classification,
      );
    }
    // composite assigned 仍在其 cell;seed_1/seed_5 等真 free 不误入列
    expect(clsMap.get('composite')).toBe('assigned');
    expect(clsMap.get('seed_1')).toBe('free');
    expect(clsMap.get('para')).toBe('free');
    // semantic membership / order 保持不变(纯函数不修改输入)
    expect(input.stageOrder).toEqual(['qc', 'g1']);
    const stageIds = input.stages.map((s) => s.id);
    expect(stageIds).toEqual(['qc', 'g1']);
  });
});

describe('Arrange 分类与 matrixClassification authority 一致(no orphan rule)', () => {
  it('computeMatrixGridGeometry 暴露 stageOnlyNodes 且不与 freeNodes 重叠', () => {
    const input = fixtures.find((f) => f.name === 'real_like')!.input();
    const geo = computeMatrixGridGeometry({
      nodes: input.nodes,
      participants: input.participants,
      participantOrder: input.participantOrder,
      stages: input.stages,
      stageOrder: input.stageOrder,
    });
    const so = new Set(geo.stageOnlyNodes.map((n) => n.id));
    const free = new Set(geo.freeNodes.map((n) => n.id));
    expect(so.has('seed_4')).toBe(true);
    expect(free.has('seed_4')).toBe(false); // stageOnly 不再进入 free
    for (const id of so) expect(free.has(id)).toBe(false);
    expect(so.has('composite')).toBe(false);
    expect(so.has('seed_1')).toBe(false);
  });
});
