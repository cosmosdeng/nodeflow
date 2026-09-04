/**
 * Matrix band 可见性(纯函数)。
 *
 * Participant(Y/Who)与 Stage(X/When)是两个正交、独立的视觉组织轴,
 * 各自只要有视觉结构(对应 band 数组非空)且其 UI 开关开启,就应渲染;
 * 不得用一个「两轴都非空」的联合条件同时门控两个轴。
 *
 * 本模块不产生任何 band 几何 / 不修改任何 Node / semantic;
 * 仅把「某轴是否渲染」这一判定独立化,便于 MatrixVisualLayer 直接消费与回归测试。
 */

export interface MatrixBandVisibilityInput {
  /** Participant band 视觉结构数量(>0 表示该轴有数据) */
  participantBandCount: number;
  /** Stage band 视觉结构数量(>0 表示该轴有数据) */
  stageBandCount: number;
  /** UI:参与方带开关 */
  showParticipantBands: boolean;
  /** UI:阶段带开关 */
  showStageBands: boolean;
}

export interface MatrixBandVisibility {
  /** 是否渲染 Participant 行带(含其 label / 命中表) */
  participantOn: boolean;
  /** 是否渲染 Stage 列带(含其 label / 命中表) */
  stageOn: boolean;
}

export function resolveMatrixBandVisibility(input: MatrixBandVisibilityInput): MatrixBandVisibility {
  return {
    participantOn: input.participantBandCount > 0 && input.showParticipantBands,
    stageOn: input.stageBandCount > 0 && input.showStageBands,
  };
}
