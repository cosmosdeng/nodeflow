/**
 * Phase C — Matrix Semantic Targets(hit-test 辅助,纯函数)
 *
 * 复用与 MatrixVisualLayer 完全相同的 geometry 推导(structure + elastic bands),
 * 为拖拽命中提供目标带 world-space 区域。判定规则与视觉一致:
 *   - Participant 行带:横向无限,只按 Y 判定(y ∈ [top, bottom]);
 *   - Stage 列带:纵向无限,只按 X 判定(x ∈ [left, right]);
 *   - 空带只有 label/最小范围:empty band 仍有最小 envelope,可作为语义目标。
 *
 * 纯函数 / 无 React / DOM 依赖。
 */
import type { FlowEdge, FlowNode, Participant, Stage } from '../types';
import { computeMatrixGridGeometry } from './arrange';
import { computeElasticMatrixGeometry } from './elasticBands';

export interface ParticipantTargetZone {
  axis: 'participant';
  id: string;
  isEmpty: boolean;
  top: number;
  bottom: number;
}

export interface StageTargetZone {
  axis: 'stage';
  id: string;
  isEmpty: boolean;
  left: number;
  right: number;
}

export interface MatrixTargetZones {
  participants: ParticipantTargetZone[];
  stages: StageTargetZone[];
}

/** 与 MatrixVisualLayer 渲染几何保持同源(参数必须一致) */
const PAD = 12;
const GAP = 2;
const EMPTY_EXTENT = 60;
const EMPTY_CROSS = 600;

export function computeMatrixTargetZones(input: {
  nodes: readonly FlowNode[];
  edges: readonly FlowEdge[];
  participants: readonly Participant[];
  participantOrder: readonly string[];
  stages: readonly Stage[];
  stageOrder: readonly string[];
}): MatrixTargetZones {
  const { nodes, edges, participants, participantOrder, stages, stageOrder } = input;
  const geo = computeMatrixGridGeometry(
    { nodes, participants, participantOrder, stages, stageOrder },
    { edges },
  );
  const { structure } = geo;
  const stageIdSet = new Set(stages.map((s) => s.id));
  const nodeRects = structure.topNodes.map((n) => {
    const w = n.measured?.width ?? n.width ?? 240;
    const h = n.measured?.height ?? n.height ?? 150;
    const pid =
      n.data?.participantId && participants.some((p) => p.id === n.data.participantId)
        ? n.data.participantId
        : undefined;
    const sid = stages.find((s) => s.nodeIds.includes(n.id) && stageIdSet.has(s.id))?.id;
    return { id: n.id, pid, stage: sid, rect: { x: n.position.x, y: n.position.y, w, h } };
  });
  const rowOrder = structure.rows.map((r) => r.participantId);
  const elastic = computeElasticMatrixGeometry({
    participants,
    stages,
    participantOrder: rowOrder,
    stageOrder: structure.cols,
    nodeRects,
    pad: PAD,
    gap: GAP,
    emptyExtent: EMPTY_EXTENT,
    emptyCross: EMPTY_CROSS,
  });
  return {
    participants: elastic.participantBands.map((b) => ({
      axis: 'participant' as const,
      id: b.id,
      isEmpty: b.isEmpty,
      top: b.top,
      bottom: b.bottom,
    })),
    stages: elastic.stageBands.map((b) => ({
      axis: 'stage' as const,
      id: b.id,
      isEmpty: b.isEmpty,
      left: b.left,
      right: b.right,
    })),
  };
}
