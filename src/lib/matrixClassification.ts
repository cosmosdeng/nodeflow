/**
 * Matrix Node Classification — 唯一、共享的四类分类 authority。
 *
 * 冻结语义(见 docs/architecture/stage-participant-arrange-design.md,经两个 Spike 验证):
 *   X = Stage / When;Y = Participant / Who;Node = What。
 *   Participant 与 Stage 是两个正交语义轴。
 *
 *   assigned   = participantId 有效 && stage membership 有效
 *   rowOnly    = participantId 有效 && stage membership 无效
 *   stageOnly  = participantId 无效 && stage membership 有效   ← stageOnly !== free
 *   free       = participantId 无效 && stage membership 无效   ← rowOnly   !== free
 *
 * 约束:
 *   - 纯函数,无 store / React / DOM / 随机 / Date 依赖;
 *   - 只回答「Node 属于哪些语义轴 → 哪一类」,不负责布局(x/y/w/h/碰撞/拓扑/排序),
 *    不排除 composite child(scope 是另一个概念),不处理 gateway 分支推导,
 *    不涉及 Edge(Edge 不参与 Node classification)。
 *
 * 计划迁移(Phase 1 只建 authority + 验证等价性,不改几何行为):
 *   - MatrixVisualLayer nodeRects 组装、arrange.ts computeMatrixGrid* 的旧分类后续收敛到本文件;
 *   - 视觉弹性带 elasticBands 按轴独立归带的组合语义已切换为 classificationFromAxes。
 */
import type { FlowNode, Participant, Stage } from '../types';

export type MatrixNodeClassification = 'assigned' | 'rowOnly' | 'stageOnly' | 'free';

/** classifyMatrixNode 所需的 document 级上下文(现有数据结构,不复制类型) */
export interface MatrixClassificationContext {
  participants: readonly Participant[];
  stages: readonly Stage[];
}

export interface MatrixClassificationResult {
  classification: MatrixNodeClassification;
  /** 该节点是否命中 Participant(Who)轴:participantId 存在且指向有效 Participant */
  hasValidParticipant: boolean;
  /** 该节点是否命中 Stage(When)轴:存在于某个有效 Stage.nodeIds */
  hasValidStage: boolean;
}

/** Participant 轴有效性:participantId 存在 且 指向 participants 中的真实 Participant */
export function hasValidParticipant(node: FlowNode, participants: readonly Participant[]): boolean {
  const pid = node.data?.participantId;
  return !!pid && participants.some((p) => p.id === pid);
}

/** Stage 轴有效性:基于 Stage.nodeIds membership(不新增 node.stageId 字段) */
export function hasValidStage(node: FlowNode, stages: readonly Stage[]): boolean {
  return stages.some((st) => st.nodeIds.includes(node.id));
}

/** 由两个正交轴的布尔值推导四类(供已解析轴引用的低层消费者使用) */
export function classificationFromAxes(
  hasValidParticipant: boolean,
  hasValidStage: boolean,
): MatrixNodeClassification {
  if (hasValidParticipant && hasValidStage) return 'assigned';
  if (hasValidParticipant && !hasValidStage) return 'rowOnly';
  if (!hasValidParticipant && hasValidStage) return 'stageOnly';
  return 'free';
}

/** 唯一入口:node + document 上下文 → 分类与轴命中 */
export function classifyMatrixNode(
  node: FlowNode,
  context: MatrixClassificationContext,
): MatrixClassificationResult {
  const hasValidParticipantAxis = hasValidParticipant(node, context.participants);
  const hasValidStageAxis = hasValidStage(node, context.stages);
  return {
    classification: classificationFromAxes(hasValidParticipantAxis, hasValidStageAxis),
    hasValidParticipant: hasValidParticipantAxis,
    hasValidStage: hasValidStageAxis,
  };
}
