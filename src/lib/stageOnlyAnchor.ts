/**
 * Stage-only Y Anchor — 正式纯 layout policy(C Primary + D Narrowed,冻结于
 * docs/architecture/stage-participant-arrange-design.md 与 stageOnlyAnchorSpike 验证)。
 *
 * 只负责「某个 Stage column 内 stageOnly 节点的 Y placement」:
 *   - 不负责 classification(matrixClassification.ts)、Stage/Participant ordering、
 *     free placement、elastic envelope、store/UI;
 *   - 不写 participantId / Stage membership / position(仅计算并返回目标 Y);
 *   - deterministic(纯函数,无随机 / Date / DOM / 对象迭代序依赖)。
 *
 * Primary(After Assigned Envelope):
 *   stageOnly.top = max(同列 assigned.bottom ∪ 已放置 stageOnly.bottom) + GAP
 *   列无 assigned 且无已放置 stageOnly → columnStartY(独立内容起点,不造虚拟 Participant)
 *
 * Topology Adjustment(窄化,只考虑同列 direct predecessor / successor):
 *   - 存在已放置的 direct predecessor → 尝试 P.bottom + GAP
 *   - 否则存在已放置的 direct successor → 尝试 S.top - GAP - h
 *     (须不低于 Primary floor,否则放弃)
 *   - 否则回退 Primary floor
 *
 * Collision:只能向下 push,绝不向上穿越任何已放置节点;
 * Fallback: 若候选区被占满,置于同列内容末端。
 *
 * Topology 仅为 soft preference;语义轴顺序(Stage order / Participant order)永远优先。
 */
export interface AssignedAnchorRect {
  id: string;
  /** 顶部 y(world) */
  top: number;
  /** 高度 */
  h: number;
}

export interface StageOnlyAnchorNode {
  id: string;
  h: number;
}

export interface StageOnlyAnchorColumnInput {
  /** 同列已放置的 assigned(按 row 就位) */
  assigned: readonly AssignedAnchorRect[];
  /** 同列待放置 stageOnly,必须已按 (topology level, id) 升序传入 */
  stageOnly: readonly StageOnlyAnchorNode[];
  /** 同列连边(端点均属于本列 assigned/stageOnly) */
  edges?: readonly { source: string; target: string }[];
  /** 列独立内容起点(无 assigned 时) */
  columnStartY: number;
  /** 与已放置内容的最小纵向间距 */
  gap: number;
}

export interface StageOnlyAnchorDiagnostic {
  id: string;
  /** 实际使用哪种 topo 偏好(pred / succ / none=Primary) */
  preference: 'predecessor' | 'successor' | 'primary';
  /** 因碰撞发生向下 push */
  pushed: boolean;
}

export interface StageOnlyAnchorResult {
  /** stageOnly id → 目标 top(y) */
  y: Map<string, number>;
  diagnostics: StageOnlyAnchorDiagnostic[];
}

interface Occupy {
  top: number;
  bottom: number;
}

function overlaps(a: { top: number; h: number }, o: Occupy): boolean {
  return a.top < o.bottom && a.top + a.h > o.top;
}

export function computeStageOnlyColumnAnchors(
  input: StageOnlyAnchorColumnInput,
): StageOnlyAnchorResult {
  const gap = input.gap;
  const occupied: Occupy[] = input.assigned.map((a) => ({ top: a.top, bottom: a.top + a.h }));
  const byId = new Map<string, { top?: number; h: number; kind: 'assigned' | 'stageOnly' }>();
  for (const a of input.assigned) byId.set(a.id, { top: a.top, h: a.h, kind: 'assigned' });
  for (const s of input.stageOnly) byId.set(s.id, { h: s.h, kind: 'stageOnly' });

  // Primary floor:同列 assigned envelope 底部 + gap(无 assigned 用独立列起点)
  const assignedBottom = input.assigned.reduce((m, a) => Math.max(m, a.top + a.h), -Infinity);
  const floor = input.assigned.length > 0 ? assignedBottom + gap : input.columnStartY;

  const yOut = new Map<string, number>();
  const diagnostics: StageOnlyAnchorDiagnostic[] = [];
  const placedTop = new Map<string, number>();

  const edges = input.edges ?? [];
  const predsOf = new Map<string, string[]>();
  const succsOf = new Map<string, string[]>();
  for (const e of edges) {
    if (!byId.has(e.source) || !byId.has(e.target)) continue;
    predsOf.set(e.target, [...(predsOf.get(e.target) ?? []), e.source]);
    succsOf.set(e.source, [...(succsOf.get(e.source) ?? []), e.target]);
  }
  const settledTop = (id: string): number | undefined => {
    const r = byId.get(id)!;
    if (r.kind === 'assigned') return r.top!;
    return placedTop.get(id);
  };

  for (const s of input.stageOnly) {
    // 1) 候选:direct predecessor(已放置)优先 → P.bottom + gap
    const predBottoms = (predsOf.get(s.id) ?? [])
      .map((id) => {
        const t = settledTop(id);
        return t === undefined ? undefined : t + byId.get(id)!.h;
      })
      .filter((v): v is number => v !== undefined);
    const succTops = (succsOf.get(s.id) ?? [])
      .map(settledTop)
      .filter((v): v is number => v !== undefined);
    let preference: StageOnlyAnchorDiagnostic['preference'] = 'primary';
    let candidate: number;
    if (predBottoms.length > 0) {
      candidate = Math.max(...predBottoms) + gap;
      preference = 'predecessor';
    } else if (succTops.length > 0) {
      // 后继锚点:S.top - gap - h;不得低于 Primary floor(不破坏 assigned envelope 约束)
      const above = Math.min(...succTops) - gap - s.h;
      if (above >= floor) {
        candidate = above;
        preference = 'successor';
      } else {
        candidate = floor;
      }
    } else {
      candidate = floor;
    }
    if (candidate < floor) candidate = floor;

    // 2) 碰撞:只向下 push(绝不向上穿越任何已放置节点)
    let y = candidate;
    let pushed = false;
    for (;;) {
      const hits = occupied.filter((o) => overlaps({ top: y, h: s.h }, o));
      if (hits.length === 0) break;
      y = Math.max(...hits.map((o) => o.bottom + gap));
      pushed = true;
    }

    // 3) 落位并加入占用
    yOut.set(s.id, y);
    placedTop.set(s.id, y);
    occupied.push({ top: y, bottom: y + s.h });
    diagnostics.push({ id: s.id, preference, pushed });
  }

  return { y: yOut, diagnostics };
}
