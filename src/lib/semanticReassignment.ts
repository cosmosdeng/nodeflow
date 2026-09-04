/**
 * Phase C Semantic Reassignment — Architecture Spike(纯状态机/纯函数)
 *
 * 交互模型:
 *   DRAGGING(普通拖动,semantic 不变)
 *     → HOVER_CANDIDATE(指针悬停目标带 → 仅产生“被悬停的那个轴”的候选)
 *     → CANCELLED / TARGET_CONFIRMED
 *     → REASSIGNED(一次 atomic 事务:position + semantic)
 *
 * 语义不变量:
 * - 普通拖动 ≠ semantic reassignment;
 * - Participant / Stage 独立,不允许根据几何交叉自动同时推断两个轴;
 * - 拖回自身目标 = no-op(不产生 candidate);
 * - 不引入 laneId / spatial parent / schema / persistence。
 *
 * 本模块不包含 React / DOM / viewport 依赖。
 */

export type ReassignmentAxis = 'participant' | 'stage';
export type ReassignmentPhase =
  | 'idle'
  | 'dragging'
  | 'hover_candidate'
  | 'target_confirmed'
  | 'cancelled'
  | 'reassigned';

export interface ReassignmentCandidate {
  axis: ReassignmentAxis;
  nodeId: string;
  /** 当前语义(id;无则 undefined 表示 free/rowOnly 侧为空) */
  fromId?: string;
  /** 悬停目标 band 的 id */
  toId: string;
}

export interface ReassignmentIntent {
  axis: ReassignmentAxis;
  nodeId: string;
  toId: string | null; // null = 清空该轴(如解除参与方归属)
}

/** Node 当前语义(只读输入) */
export interface NodeSemantics {
  participantId?: string;
  /** 所属 stage id;无阶段用 undefined 表示 rowOnly/free 的一侧 */
  stageId?: string;
}

/**
 * Hover 命中某个带时形成候选:
 * - 只在被悬停的那一个轴上比较;同目标(P1→P1)不产生 candidate(no-op);
 * - 不因“同时位于两个带的几何交叉区”而自动推断另一轴(ambiguity 交给确认交互)。
 */
export function hoverCandidate(
  nodeId: string,
  semantics: NodeSemantics,
  hover: { axis: ReassignmentAxis; targetId: string },
): ReassignmentCandidate | null {
  if (!hover.targetId) return null;
  if (hover.axis === 'participant') {
    if (semantics.participantId === hover.targetId) return null;
    return { axis: 'participant', nodeId, fromId: semantics.participantId, toId: hover.targetId };
  }
  if (semantics.stageId === hover.targetId) return null;
  return { axis: 'stage', nodeId, fromId: semantics.stageId, toId: hover.targetId };
}

/** 离开目标带:取消候选(不变更 semantic) */
export function cancelCandidate(): null {
  return null;
}

/** 确认候选 → 提交意图(纯 intent;真正写库由 store 原子事务完成) */
export function confirmCandidate(candidate: ReassignmentCandidate): ReassignmentIntent {
  return { axis: candidate.axis, nodeId: candidate.nodeId, toId: candidate.toId };
}

/**
 * 计算「确认后」的语义(不修改输入)。
 * participant 轴不会碰 stage;stage 轴不会碰 participant(两者独立)。
 */
export function applyIntentToSemantics(
  semantics: NodeSemantics,
  intent: ReassignmentIntent,
): NodeSemantics {
  if (intent.axis === 'participant') {
    return { ...semantics, participantId: intent.toId ?? undefined };
  }
  return { ...semantics, stageId: intent.toId ?? undefined };
}
