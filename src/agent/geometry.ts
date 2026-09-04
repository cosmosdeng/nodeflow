/**
 * Agent Interface — geometry helpers。
 * 语义归属与几何判定分离;复用渲染层同源弹性带几何(computeMatrixTargetZones)。
 */
import { useGraphStore } from '../store/graphStore';
import { computeMatrixTargetZones, type StageTargetZone, type ParticipantTargetZone } from '../lib/matrixTargets';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function nodeRect(id: string): Rect | null {
  const st = useGraphStore.getState();
  const n = st.nodes.find((x) => x.id === id);
  if (!n) return null;
  const w = n.measured?.width ?? n.width ?? 240;
  const h = n.measured?.height ?? n.height ?? 150;
  return { x: n.position?.x ?? 0, y: n.position?.y ?? 0, w: w || 240, h: h || 150 };
}

export function zoneRect(r: Rect): { l: number; t: number; r: number; b: number } {
  return { l: r.x, t: r.y, r: r.x + r.w, b: r.y + r.h };
}

export interface MatrixZones {
  participantBands: ParticipantTargetZone[];
  stageBands: StageTargetZone[];
}

export function zonesOf(): MatrixZones {
  const st = useGraphStore.getState();
  const zones = computeMatrixTargetZones({
    nodes: st.nodes,
    edges: st.edges,
    participants: st.participants,
    participantOrder: st.participantOrder,
    stages: st.stages,
    stageOrder: st.stageOrder,
  });
  return { participantBands: zones.participants, stageBands: zones.stages };
}

/** 两个世界矩形是否重叠(边贴边不算重叠) */
export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * 几何判定:节点矩形是否落在参与方行带内(行带横向无限,只判定 Y)。
 * 语义(Participant 归属)与本几何判定是两回事,必须分开。
 */
export function isNodeInsideParticipantBand(r: Rect, band: ParticipantTargetZone): boolean {
  return r.y >= band.top && r.y + r.h <= band.bottom;
}

/** 几何判定:节点矩形是否落在 Stage 列带内(列带纵向无限,只判定 X)。 */
export function isNodeInsideStageBand(r: Rect, band: StageTargetZone): boolean {
  return r.x >= band.left && r.x + r.w <= band.right;
}
