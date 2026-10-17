import { describe, expect, it } from 'vitest';
import type { FlowNode, Participant, Stage } from '../../types';
import {
  classifyMatrixNode,
  classificationFromAxes,
  hasValidParticipant,
  hasValidStage,
  type MatrixClassificationContext,
} from '../matrixClassification';
import { computeMatrixGridStructure } from '../arrange';
import { fixtures } from '../spikes/stageParticipantFixtures';

/**
 * Phase 1 — matrixClassification 唯一 authority 验证。
 * 覆盖:基本四类 / invalid 引用 / real_like / composite scope 分离 / gateway / determinism ×10 /
 * 与 elastic(MatrixVisualLayer 轴解析)及 arrange(computeMatrixGridStructure)旧分类的等价性。
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

const node = (
  id: string,
  opts: { pid?: string; x?: number; y?: number; extra?: Record<string, unknown> } = {},
): FlowNode => ({
  id,
  type: 'flow',
  position: { x: opts.x ?? 0, y: opts.y ?? 0 },
  width: 240,
  height: 150,
  data: {
    label: id,
    description: '',
    actor: 'machine',
    locked: false,
    inputs: [],
    outputs: [],
    ...(opts.pid ? { participantId: opts.pid } : {}),
    ...(opts.extra ?? {}),
  },
});

const ctx = (participants: Participant[], stages: Stage[]): MatrixClassificationContext => ({ participants, stages });
const P1 = part('p1');
const S1 = stg('s1', ['nBoth', 'nStageOnly']);

describe('Basic 四类', () => {
  it('assigned = pid 有效 && stage 有效', () => {
    const r = classifyMatrixNode(node('nBoth', { pid: 'p1' }), ctx([P1], [S1]));
    expect(r.classification).toBe('assigned');
    expect(r.hasValidParticipant).toBe(true);
    expect(r.hasValidStage).toBe(true);
  });

  it('rowOnly = pid 有效 && stage 无效(不进 free)', () => {
    const r = classifyMatrixNode(node('nRow', { pid: 'p1' }), ctx([P1], [S1]));
    expect(r.classification).toBe('rowOnly');
    expect(r.hasValidParticipant).toBe(true);
    expect(r.hasValidStage).toBe(false);
  });

  it('stageOnly = pid 无效 && stage 有效(不进 free)', () => {
    const r = classifyMatrixNode(node('nStageOnly'), ctx([P1], [S1]));
    expect(r.classification).toBe('stageOnly');
    expect(r.hasValidParticipant).toBe(false);
    expect(r.hasValidStage).toBe(true);
  });

  it('free = 两轴皆无效', () => {
    const r = classifyMatrixNode(node('nFree'), ctx([P1], [S1]));
    expect(r.classification).toBe('free');
    expect(r.hasValidParticipant).toBe(false);
    expect(r.hasValidStage).toBe(false);
  });
});

describe('Invalid references(stale semantic 不纳入错误带)', () => {
  const P = [part('p1')];
  const S = [stg('s1', ['target'])];
  it('pid="does-not-exist" + stage 有效 → stageOnly(不是 free)', () => {
    const r = classifyMatrixNode(node('target', { pid: 'does-not-exist' }), ctx(P, S));
    expect(r.hasValidParticipant).toBe(false);
    expect(r.hasValidStage).toBe(true);
    expect(r.classification).toBe('stageOnly');
  });

  it('pid 有效 + stage 无效(不在任何 nodeIds)→ rowOnly', () => {
    const r = classifyMatrixNode(node('ghost', { pid: 'p1' }), ctx(P, S));
    expect(r.classification).toBe('rowOnly');
  });

  it('pid="does-not-exist" + stage 无效 → free', () => {
    const r = classifyMatrixNode(node('ghost2', { pid: 'does-not-exist' }), ctx(P, S));
    expect(r.classification).toBe('free');
  });

  it('pid 指向已被删除的 participant 视为 invalid(辅助谓词)', () => {
    expect(hasValidParticipant(node('x', { pid: 'gone' }), [P1])).toBe(false);
    expect(hasValidStage(node('target'), S)).toBe(true);
    expect(hasValidStage(node('nope'), S)).toBe(false);
  });
});

describe('real_like(复用 Spike fixture)', () => {
  const input = fixtures.find((f) => f.name === 'real_like')!.input();
  const c = ctx(input.participants, input.stages);

  it('seed_4 / chvx9j / g60uoi = stageOnly(缺 pid 不变 free)', () => {
    for (const id of ['seed_4', 'chvx9j', 'g60uoi']) {
      const n = input.nodes.find((x) => x.id === id)!;
      const r = classifyMatrixNode(n, c);
      expect(r.classification, id).toBe('stageOnly');
      expect(r.hasValidStage).toBe(true);
      expect(r.hasValidParticipant).toBe(false);
    }
  });

  it('composite(pid+stage)= assigned', () => {
    const r = classifyMatrixNode(
      input.nodes.find((x) => x.id === 'composite')!,
      c,
    );
    expect(r.classification).toBe('assigned');
  });

  it('真实主链无归属节点(seed_1/seed_5/网关等)= free', () => {
    for (const id of ['seed_1', 'seed_5', 'para', 'incl', 'node5dd']) {
      expect(
        classifyMatrixNode(
          input.nodes.find((x) => x.id === id)!,
          c,
        ).classification,
      ).toBe('free');
    }
  });
});

describe('Composite host/child:classification 与 scope 分离', () => {
  it('helper 只按节点自身 assignment 分类,不自行排除 composite child', () => {
    const P = [part('p1')];
    const S = [stg('s1', ['host', 'child', 'plain'])];
    // host 与 child 都有 pid+stage → 各自 assigned(scope 排除属 arrange,不属 classification)
    const host = node('host', { pid: 'p1', extra: { composite: { childIds: ['child'], expanded: false } } });
    const child = node('child', { pid: 'p1' });
    const plain = node('plain');
    expect(classifyMatrixNode(host, ctx(P, S)).classification).toBe('assigned');
    expect(classifyMatrixNode(child, ctx(P, S)).classification).toBe('assigned');
    expect(classifyMatrixNode(plain, ctx(P, S)).classification).toBe('stageOnly');
    // child 有无 childIds 字段不影响分类(不把 childIds 混入 classification)
    expect(hasValidStage(child, S)).toBe(true);
  });
});

describe('Gateway:按普通 Node 处理', () => {
  it('gateway 不因 branch 推导 participant/stage', () => {
    const P = [part('p1')];
    const S = [stg('s1', ['gwIn'])];
    const gwAssigned = node('gwIn', { pid: 'p1', extra: { gateway: { type: 'parallel' as const } } });
    const gwStageOnly = node('gwOnly', { extra: { gateway: { type: 'inclusive' as const } } });
    expect(classifyMatrixNode(gwAssigned, ctx(P, S)).classification).toBe('assigned');
    expect(classifyMatrixNode(gwStageOnly, ctx(P, S)).classification).toBe('free'); // 无 stage 无 pid
    expect(classifyMatrixNode(node('gwIn2', { pid: 'p1' }), ctx(P, [stg('s2', ['gwIn2'])])).classification).toBe(
      'assigned',
    );
  });
});

describe('低层组合 classificationFromAxes', () => {
  it('四组合正确', () => {
    expect(classificationFromAxes(true, true)).toBe('assigned');
    expect(classificationFromAxes(true, false)).toBe('rowOnly');
    expect(classificationFromAxes(false, true)).toBe('stageOnly');
    expect(classificationFromAxes(false, false)).toBe('free');
  });
});

describe('与既有消费者语义的等价性', () => {
  it('与 MatrixVisualLayer / elasticBands 的轴解析一致(real_like topNodes)', () => {
    const input = fixtures.find((f) => f.name === 'real_like')!.input();
    const pidSet = new Set(input.participants.map((p) => p.id));
    const stageIdSet = new Set(input.stages.map((s) => s.id));
    // 复刻 MatrixVisualLayer 的 nodeRects 轴解析(唯一差异点:node.hidden 不存在于该 fixture)
    const childIds = new Set<string>();
    for (const n of input.nodes) for (const cid of n.data?.composite?.childIds ?? []) childIds.add(cid);
    const tops = input.nodes.filter((n) => !childIds.has(n.id));
    for (const n of tops) {
      const refHasPid = !!n.data?.participantId && pidSet.has(n.data.participantId);
      const refStage = input.stages.find((s) => s.nodeIds.includes(n.id) && stageIdSet.has(s.id));
      const refHasStage = refStage !== undefined;
      const got = classifyMatrixNode(n, ctx(input.participants, input.stages));
      expect(got.hasValidParticipant, n.id).toBe(refHasPid);
      expect(got.hasValidStage, n.id).toBe(refHasStage);
    }
  });

  it('与 arrange.computeMatrixGridStructure 旧分类集合一致(assigned 精确;stageOnly∪free = 旧 free)', () => {
    const input = fixtures.find((f) => f.name === 'real_like')!.input();
    const c = ctx(input.participants, input.stages);
    const { topNodes } = computeMatrixGridStructure(input);
    const pidValid = (n: FlowNode) =>
      !!n.data?.participantId && input.participants.some((p) => p.id === n.data!.participantId);
    const stageMember = (n: FlowNode) => input.stages.some((s) => s.nodeIds.includes(n.id));

    const helperAssigned = new Set(
      topNodes.filter((n) => classifyMatrixNode(n, c).classification === 'assigned').map((n) => n.id),
    );
    const oldAssigned = new Set(topNodes.filter((n) => pidValid(n) && stageMember(n)).map((n) => n.id));
    expect(helperAssigned).toEqual(oldAssigned);

    // 旧 arrange 把「无有效 pid」全部视为 free(含 stageOnly)——新语义拆成 stageOnly ∪ free
    const helperSOorFree = new Set(
      topNodes
        .filter((n) => {
          const cl = classifyMatrixNode(n, c).classification;
          return cl === 'stageOnly' || cl === 'free';
        })
        .map((n) => n.id),
    );
    const oldNoPid = new Set(topNodes.filter((n) => !pidValid(n)).map((n) => n.id));
    expect(helperSOorFree).toEqual(oldNoPid);
    // 关键差异点:旧 free 中应分离出 stageOnly(seed_4/chvx9j/g60uoi)
    const stageOnlyIds = topNodes
      .filter((n) => classifyMatrixNode(n, c).classification === 'stageOnly')
      .map((n) => n.id)
      .sort();
    expect(stageOnlyIds).toEqual(['chvx9j', 'g60uoi', 'seed_4']);
  });
});

describe('Determinism ×10(纯函数)', () => {
  it('相同输入重复 10 次结果一致(含 real_like 与 invalid 场景)', () => {
    const input = fixtures.find((f) => f.name === 'real_like')!.input();
    const c = ctx(input.participants, input.stages);
    const cases: [FlowNode, MatrixClassificationContext][] = [
      [input.nodes.find((x) => x.id === 'seed_4')!, c],
      [input.nodes.find((x) => x.id === 'composite')!, c],
      [node('a', { pid: 'nope' }), ctx([P1], [S1])],
    ];
    for (let i = 0; i < 10; i++) {
      for (const [n, k] of cases) {
        expect(classifyMatrixNode(n, k)).toEqual(classifyMatrixNode(n, k));
      }
    }
  });
});
