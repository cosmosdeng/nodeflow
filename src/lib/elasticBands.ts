/**
 * Elastic Band Arrange — Architecture Spike(纯算法,不接入产品路径)
 *
 * 验证模型:
 *   Node topology layout(先行,node.position 不变)
 *     → Participant / Stage Band 作为 geometry envelope
 *     → 在「Band 顺序不变 + 最小间距」下,把每个 Band 做最小几何移动去完全包含
 *       属于它的 Node(rectangle containment)。
 *
 * 约束:
 *   - Band 不移动 Node;若 Node 布局与 Band 顺序冲突,记录 conflict,不改顺序。
 *   - 不做迭代求解;单次贪心 forward,数学上对「仅下界链」已是最小 L1 位移。
 *   - deterministic / O(n)。
 */

/** 一维 Band 需求(可复用于 Participant 的 Y 轴或 Stage 的 X 轴) */
export interface AxisBandSpec {
  id: string;
  /** 为完全包含 Node,band start 必须 ≤ 该值(如:节点左/上 - pad) */
  maxAllowedStart: number;
  /** 为完全包含 Node,band end 必须 ≥ 该值(如:节点右/下 + pad) */
  minRequiredEnd: number;
  /** Band 的理想 start(不破坏约束时尽量贴近) */
  preferredStart: number;
  /** 最小 extent(如标签/空 band 的最小高度宽度),默认 0 */
  minExtent?: number;
  /** 本 band 与前一带之间的额外最小间距(空带用,让标签之间不贴脸) */
  leadGap?: number;
}

export interface FittedBand {
  id: string;
  start: number;
  end: number;
  preferredStart: number;
  /** 本条 band 是否无法同时满足「顺序+间距」与「完全包含」 */
  conflict?: string;
}

export interface AxisFitResult {
  /** 顺序与输入一致 */
  bands: FittedBand[];
  /** Σ|start − preferredStart| */
  displacement: number;
  /** 顺序保持失败 / 包含失败 / 间距不足 的记录 */
  conflicts: string[];
}

/**
 * 一维有序 Band fitting:forward 单趟。
 *
 * band_i 的解区间为 [lowerBound(i), maxAllowedStart_i],
 *   lowerBound(i) = (band_{i-1}.end + gap)
 * 满足排序约束;同时 end_i = max(minRequiredEnd_i, start_i + minExtent_i)。
 * start_i = clamp(preferred_i, [lowerBound, maxAllowedStart]);若下界已超过
 * 上界(顺序与包含不可兼得),优先保「顺序 + 间距」并把冲突写入 diagnostics。
 */
export function fitOrderedEnvelopes(
  specs: readonly AxisBandSpec[],
  gap: number,
): AxisFitResult {
  const bands: FittedBand[] = [];
  const conflicts: string[] = [];
  let displacement = 0;
  let prevEnd = -Infinity;
  for (const spec of specs) {
    const lower = prevEnd === -Infinity ? -Infinity : prevEnd + (spec.leadGap ?? gap);
    const upper = spec.maxAllowedStart;
    let start: number;
    let conflict: string | undefined;
    if (lower > upper) {
      // 无法同时满足:优先保持顺序与最小间距(不交换 band)
      start = lower;
      conflict = `order-vs-containment:${spec.id}:needStart>=${lower}但完全包含要求<=${upper}`;
      conflicts.push(conflict);
    } else {
      // clamp:在合法区间内取最接近 preferred 的位置 → 最小 L1 移动
      if (spec.preferredStart < lower) start = lower;
      else if (spec.preferredStart > upper) start = upper;
      else start = spec.preferredStart;
    }
    const minEnd = Math.max(spec.minRequiredEnd, start + (spec.minExtent ?? 0));
    // 数值防抖(整数化用于确定性展示,误差仍由冲突/包含校验覆盖)
    const finalStart = Math.round(start * 1e6) / 1e6;
    const finalEnd = Math.round(minEnd * 1e6) / 1e6;
    bands.push({
      id: spec.id,
      start: finalStart,
      end: finalEnd,
      preferredStart: spec.preferredStart,
      conflict,
    });
    displacement += Math.abs(finalStart - spec.preferredStart);
    prevEnd = finalEnd;
  }
  return { bands, displacement, conflicts };
}

/** 从矩形集(节点全部矩形)推导一个 band 的包含需求(四周 pad) */
export function rectsToEnvelope(
  rects: { x: number; y: number; w: number; h: number }[],
  pad: number,
  minExtent?: number,
): { minX: number; maxX: number; minY: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w);
    maxY = Math.max(maxY, r.y + r.h);
  }
  if (rects.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }
  void minExtent;
  return {
    minX: minX - pad,
    maxX: maxX + pad,
    minY: minY - pad,
    maxY: maxY + pad,
  };
}

/* ---------------- 矩阵级 adapter:Arrange 输出 → 两轴 envelope ---------------- */

export interface NodeRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 参与方行 envelope(Participant 顺序不变,沿 Y 弹性贴合) */
export interface ParticipantElasticBand {
  id: string;
  top: number;
  bottom: number;
  /** 参与方自身节点的横向包络(用于渲染 body) */
  l: number;
  r: number;
  isEmpty: boolean;
}

/** Stage 列 envelope(Stage 顺序不变,沿 X 弹性贴合) */
export interface StageElasticBand {
  id: string;
  left: number;
  right: number;
  /** 自身节点的纵向包络(用于渲染 body) */
  t: number;
  b: number;
  isEmpty: boolean;
}

export interface ElasticMatrixDiagnostics {
  participantDisplacement: number;
  stageDisplacement: number;
  conflicts: string[];
}

export interface ElasticMatrixGeometry {
  participantBands: ParticipantElasticBand[];
  stageBands: StageElasticBand[];
  diagnostics: ElasticMatrixDiagnostics;
}

export interface ElasticMatrixInput {
  participants: readonly { id: string; name?: string }[];
  stages: readonly { id: string; name?: string }[];
  participantOrder: readonly string[];
  stageOrder: readonly string[];
  /** Arrange 后的实时 Node 矩形(pid=有效参与方;stage=有效阶段;free 两者皆无) */
  nodeRects: { id: string; pid?: string; stage?: string; rect: NodeRect }[];
  /** 每边 padding(含进 envelope) */
  pad?: number;
  /** Band 最小间距(避免相邻 band 粘连) */
  gap?: number;
  /** 空 band 的最小高度/宽度 */
  emptyExtent?: number;
  /** 空 band 的 fallback 宽度/高度 */
  emptyCross?: number;
}

/**
 * 从 Arrange 输出的 Node 矩形构造「envelope band geometry」。
 * 不修改任何 Node position / semantic;只有 Band 几何跟随 Node 移动。
 */
export function computeElasticMatrixGeometry(
  input: ElasticMatrixInput,
): ElasticMatrixGeometry {
  const pad = input.pad ?? 10;
  const gap = input.gap ?? 8;
  const emptyExtent = input.emptyExtent ?? 60;
  const emptyStageW = (input.emptyExtent ?? 60) * 2; // 空 Stage 列宽至少能容纳标签
  const emptyCross = input.emptyCross ?? 120;

  const participantIds = [...input.participantOrder, ...input.participants.map((p) => p.id)];
  const pids = [...new Set(participantIds)].filter((id) =>
    input.participants.some((p) => p.id === id),
  );
  const stageIds = [...input.stageOrder, ...input.stages.map((s) => s.id)];
  const sids = [...new Set(stageIds)].filter((id) =>
    input.stages.some((s) => s.id === id),
  );

  // 归类:assigned(pid+stage) 同时进两轴;rowOnly(仅 pid)只进 Participant;free 都不进
  const pidRects = new Map<string, NodeRect[]>();
  const stageRects = new Map<string, NodeRect[]>();
  for (const n of input.nodeRects) {
    const hasPid = n.pid !== undefined && input.participants.some((p) => p.id === n.pid);
    const hasStage = n.stage !== undefined && input.stages.some((s) => s.id === n.stage);
    if (!hasPid) continue; // free
    const arr = pidRects.get(n.pid!) ?? [];
    arr.push(n.rect);
    pidRects.set(n.pid!, arr);
    if (hasStage) {
      const sarr = stageRects.get(n.stage!) ?? [];
      sarr.push(n.rect);
      stageRects.set(n.stage!, sarr);
    }
  }

  // ---- Participant(Y) ----
  const pSpecs = pids.map((pid) => {
    const rects = pidRects.get(pid) ?? [];
    if (rects.length === 0) {
      return {
        id: pid,
        maxAllowedStart: Infinity,
        minRequiredEnd: -Infinity,
        preferredStart: 0,
        minExtent: emptyExtent,
        leadGap: 40,
        isEmpty: true,
        xRects: [] as NodeRect[],
      };
    }
    const env = rectsToEnvelope(rects, pad);
    return {
      id: pid,
      maxAllowedStart: env.minY,
      minRequiredEnd: env.maxY,
      preferredStart: env.minY,
      isEmpty: false,
      xRects: rects,
    };
  });
  const pFit = fitOrderedEnvelopes(pSpecs, gap);
  const participantBands: ParticipantElasticBand[] = pFit.bands.map((fb, i) => {
    const spec = pSpecs[i];
    let l = 0;
    let r = 0;
    if (spec.xRects.length > 0) {
      const env = rectsToEnvelope(spec.xRects, pad);
      l = env.minX;
      r = env.maxX;
    } else {
      l = 0;
      r = emptyCross;
    }
    return {
      id: fb.id,
      top: fb.start,
      bottom: fb.end,
      l,
      r,
      isEmpty: spec.isEmpty,
    };
  });

  // ---- Stage(X) ----
  const sSpecs = sids.map((sid) => {
    const rects = stageRects.get(sid) ?? [];
    if (rects.length === 0) {
      return {
        id: sid,
        maxAllowedStart: Infinity,
        minRequiredEnd: -Infinity,
        preferredStart: 0,
        minExtent: emptyStageW,
        leadGap: 40,
        isEmpty: true,
        yRects: [] as NodeRect[],
      };
    }
    const env = rectsToEnvelope(rects, pad);
    return {
      id: sid,
      maxAllowedStart: env.minX,
      minRequiredEnd: env.maxX,
      preferredStart: env.minX,
      isEmpty: false,
      yRects: rects,
    };
  });
  const sFit = fitOrderedEnvelopes(sSpecs, gap);
  const stageBands: StageElasticBand[] = sFit.bands.map((fb, i) => {
    const spec = sSpecs[i];
    let t = 0;
    let b = 0;
    if (spec.yRects.length > 0) {
      const env = rectsToEnvelope(spec.yRects, pad);
      t = env.minY;
      b = env.maxY;
    } else {
      t = 0;
      b = emptyExtent;
    }
    return {
      id: fb.id,
      left: fb.start,
      right: fb.end,
      t,
      b,
      isEmpty: spec.isEmpty,
    };
  });

  return {
    participantBands,
    stageBands,
    diagnostics: {
      participantDisplacement: pFit.displacement,
      stageDisplacement: sFit.displacement,
      conflicts: [...pFit.conflicts, ...sFit.conflicts],
    },
  };
}
