/**
 * Agent Interface — Assertions(Verify)。
 * 返回结构化结果,绝不抛出无结构错误。
 * 语义(assignment / membership)与几何(containment / overlap / band)严格分离。
 */
import { useGraphStore } from '../store/graphStore';
import { getNodesDto, getParticipantsDto, getStagesDto } from './queries';
import { isNodeInsideParticipantBand, isNodeInsideStageBand, nodeRect, rectsOverlap, zonesOf } from './geometry';
import { asOptionalString, asPayloadRecord, asString, asStringArray, asNumber, asOptionalNumber, asBoolean } from './validation';
import type { AgentAssertionResult, AgentAssertionType } from './types';

function fail(
  assertion: AgentAssertionType,
  message: string,
  actual: unknown,
  expected: unknown,
): AgentAssertionResult {
  return { passed: false, assertion, actual, expected, message };
}

function pass(
  assertion: AgentAssertionType,
  actual: unknown,
  expected: unknown,
  message?: string,
): AgentAssertionResult {
  return { passed: true, assertion, actual, expected, message };
}

function requireNode(nodeId: string, assertion: AgentAssertionType): AgentAssertionResult | null {
  const n = getNodesDto().find((x) => x.id === nodeId);
  if (!n) {
    return fail(assertion, `节点不存在: ${nodeId}`, null, nodeId);
  }
  return null;
}

export function assertNodeExists(p: Record<string, unknown>): AgentAssertionResult {
  const nodeId = asString(p.nodeId, 'nodeId');
  return requireNode(nodeId, 'assertNodeExists')
    ?? pass('assertNodeExists', { id: nodeId }, nodeId);
}

export function assertEdgeExists(p: Record<string, unknown>): AgentAssertionResult {
  const edgeId = asString(p.edgeId, 'edgeId');
  const st = useGraphStore.getState();
  const exists = st.edges.some((e) => e.id === edgeId);
  return exists
    ? pass('assertEdgeExists', { id: edgeId }, edgeId)
    : fail('assertEdgeExists', `连线不存在: ${edgeId}`, null, edgeId);
}

export function assertParticipantAssignment(p: Record<string, unknown>): AgentAssertionResult {
  const nodeId = asString(p.nodeId, 'nodeId');
  const expected = asOptionalString(p.participantId, 'participantId') ?? null;
  const missing = requireNode(nodeId, 'assertParticipantAssignment');
  if (missing) return missing;
  const actual = getNodesDto().find((n) => n.id === nodeId)!.participantId;
  return actual === expected
    ? pass('assertParticipantAssignment', { nodeId, participantId: actual }, { participantId: expected })
    : fail('assertParticipantAssignment', '参与方语义不匹配', { participantId: actual }, { participantId: expected });
}

export function assertStageAssignment(p: Record<string, unknown>): AgentAssertionResult {
  const nodeId = asString(p.nodeId, 'nodeId');
  const expected = asOptionalString(p.stageId, 'stageId') ?? null;
  const missing = requireNode(nodeId, 'assertStageAssignment');
  if (missing) return missing;
  const actual = getNodesDto().find((n) => n.id === nodeId)!.stageId;
  return actual === expected
    ? pass('assertStageAssignment', { nodeId, stageId: actual }, { stageId: expected })
    : fail('assertStageAssignment', '阶段归属语义不匹配', { stageId: actual }, { stageId: expected });
}

export function assertNodeInsideParticipant(p: Record<string, unknown>): AgentAssertionResult {
  const nodeId = asString(p.nodeId, 'nodeId');
  const pid = asOptionalString(p.participantId, 'participantId') ?? null;
  const missing = requireNode(nodeId, 'assertNodeInsideParticipant');
  if (missing) return missing;
  const dto = getNodesDto().find((n) => n.id === nodeId)!;
  const targetPid = pid ?? dto.participantId;
  if (!targetPid) {
    return fail('assertNodeInsideParticipant', '节点没有参与方,无法做几何包含断言', dto.participantId, pid);
  }
  const bands = zonesOf().participantBands.filter((b) => b.id === targetPid);
  const rect = nodeRect(nodeId);
  if (!rect) return fail('assertNodeInsideParticipant', '无法读取节点矩形', null, nodeId);
  const inside = bands.some((b) => isNodeInsideParticipantBand(rect, b));
  return inside
    ? pass('assertNodeInsideParticipant', { nodeId, participantId: dto.participantId, inside: true }, { inside: true })
    : fail(
        'assertNodeInsideParticipant',
        '节点矩形未被参与方行带包含',
        {
          nodeId,
          participantId: dto.participantId,
          rect,
          band: bands.map((b) => ({ id: b.id, top: b.top, bottom: b.bottom, isEmpty: b.isEmpty })),
        },
        { inside: true },
      );
}

export function assertNodeInsideStage(p: Record<string, unknown>): AgentAssertionResult {
  const nodeId = asString(p.nodeId, 'nodeId');
  const sid = asOptionalString(p.stageId, 'stageId') ?? null;
  const missing = requireNode(nodeId, 'assertNodeInsideStage');
  if (missing) return missing;
  const dto = getNodesDto().find((n) => n.id === nodeId)!;
  const targetSid = sid ?? dto.stageId;
  if (!targetSid) {
    return fail('assertNodeInsideStage', '节点没有阶段归属,无法做几何包含断言', dto.stageId, sid);
  }
  const bands = zonesOf().stageBands.filter((b) => b.id === targetSid);
  const rect = nodeRect(nodeId);
  if (!rect) return fail('assertNodeInsideStage', '无法读取节点矩形', null, nodeId);
  const inside = bands.some((b) => isNodeInsideStageBand(rect, b));
  return inside
    ? pass('assertNodeInsideStage', { nodeId, stageId: dto.stageId, inside: true }, { inside: true })
    : fail(
        'assertNodeInsideStage',
        '节点矩形未被阶段列带包含',
        {
          nodeId,
          stageId: dto.stageId,
          rect,
          band: bands.map((b) => ({ id: b.id, left: b.left, right: b.right, isEmpty: b.isEmpty })),
        },
        { inside: true },
      );
}

export function assertNoOverlap(p: Record<string, unknown>): AgentAssertionResult {
  const st = useGraphStore.getState();
  const scoped = Array.isArray(p.nodeIds) ? asStringArray(p.nodeIds, 'nodeIds') : null;
  const rects = new Map<string, ReturnType<typeof nodeRect>>();
  for (const n of st.nodes) {
    if (n.hidden) continue;
    if (scoped && !scoped.includes(n.id)) continue;
    const r = nodeRect(n.id);
    if (r) rects.set(n.id, r);
  }
  const pairs = [...rects.entries()];
  for (let i = 0; i < pairs.length; i++) {
    for (let j = i + 1; j < pairs.length; j++) {
      const [aId, ar] = pairs[i];
      const [bId, br] = pairs[j];
      if (ar && br && rectsOverlap(ar, br)) {
        return fail('assertNoOverlap', '节点矩形重叠', { a: aId, b: bId, aRect: ar, bRect: br }, { overlaps: 0 });
      }
    }
  }
  return pass('assertNoOverlap', { overlappingPairs: 0, nodeCount: rects.size }, { overlaps: 0 });
}

export function assertBandVisible(p: Record<string, unknown>): AgentAssertionResult {
  const axis = asString(p.axis, 'axis');
  if (axis !== 'participant' && axis !== 'stage') {
    return fail('assertBandVisible', 'axis 必须是 participant 或 stage', axis, 'participant|stage');
  }
  const st = useGraphStore.getState();
  const expected = asOptionalString(p.expected, 'expected') === undefined ? true : asBoolean(p.expected, 'expected');
  const zones = zonesOf();
  const bandId = asOptionalString(p.bandId, 'bandId') ?? null;
  const list = axis === 'participant' ? zones.participantBands : zones.stageBands;
  const show = axis === 'participant' ? st.showParticipantBands : st.showStageBands;
  const exists = list.length > 0 && (!bandId || list.some((b) => b.id === bandId));
  const visible = show && exists;
  return visible === expected
    ? pass('assertBandVisible', { axis, bandId, visible }, { visible: expected })
    : fail('assertBandVisible', 'band 可见性与预期不符', { axis, bandId, visible, show, exists }, { visible: expected });
}

export function assertBandOrder(p: Record<string, unknown>): AgentAssertionResult {
  const pId = asPayloadRecord(p);
  const axis = asString(p.axis ?? pId.axis, 'axis');
  const key = axis === 'participant' ? 'expectedParticipantIds' : 'expectedStageIds';
  const raw = p[key] ?? p.expectedIds;
  const expected = asStringArray(raw, key);
  const zones = zonesOf();
  const actual = axis === 'participant' ? zones.participantBands.map((b) => b.id) : zones.stageBands.map((b) => b.id);
  const ok = actual.length === expected.length && actual.every((id, i) => id === expected[i]);
  return ok
    ? pass('assertBandOrder', { axis, order: actual }, { order: expected })
    : fail('assertBandOrder', 'band 顺序不匹配', { axis, order: actual }, { order: expected });
}

export function assertNodePosition(p: Record<string, unknown>): AgentAssertionResult {
  const nodeId = asString(p.nodeId, 'nodeId');
  const x = asOptionalNumber(p.x, 'x');
  const y = asOptionalNumber(p.y, 'y');
  const tol = asOptionalNumber(p.tolerance, 'tolerance') ?? 0.5;
  const missing = requireNode(nodeId, 'assertNodePosition');
  if (missing) return missing;
  const dto = getNodesDto().find((n) => n.id === nodeId)!;
  const px = dto.position.x;
  const py = dto.position.y;
  const okX = x === undefined || Math.abs(px - x) <= tol;
  const okY = y === undefined || Math.abs(py - y) <= tol;
  if (okX && okY) {
    return pass('assertNodePosition', { nodeId, position: { x: px, y: py } }, { x, y, tolerance: tol });
  }
  return fail('assertNodePosition', '节点位置不匹配', { nodeId, position: { x: px, y: py } }, { x, y, tolerance: tol });
}

const ASSERTIONS: Record<string, (p: Record<string, unknown>) => AgentAssertionResult> = {
  assertNodeExists,
  assertEdgeExists,
  assertParticipantAssignment,
  assertStageAssignment,
  assertNodeInsideParticipant,
  assertNodeInsideStage,
  assertNoOverlap,
  assertBandVisible,
  assertBandOrder,
  assertNodePosition,
};

export type { AgentAssertionResult };

/** payload 内必须含 type;可选嵌套。校验并执行。 */
export function runAssertion(payload: unknown): AgentAssertionResult {
  const o = asPayloadRecord(payload);
  const type = asString(o.type, 'type') as AgentAssertionType;
  const inner = (o.payload && typeof o.payload === 'object' ? (o.payload as Record<string, unknown>) : o);
  const fn = ASSERTIONS[type];
  if (!fn) {
    return fail(type ?? 'assertNodeExists', `不支持的断言类型: ${type}`, type, Object.keys(ASSERTIONS));
  }
  const participants = getParticipantsDto();
  const stages = getStagesDto();
  void participants;
  void stages;
  return fn(inner);
}
