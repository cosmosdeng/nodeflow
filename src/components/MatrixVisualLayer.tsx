import { useEffect, useMemo, useRef, useState } from 'react';
import { useGraphStore } from '../store/graphStore';
import { computeMatrixGridGeometry } from '../lib/arrange';
import { computeElasticMatrixGeometry } from '../lib/elasticBands';
import { findMatrixLabelHit, setMatrixLabelHits, type MatrixLabelHit } from './matrixLabelHit';

/**
 * Phase B — MatrixVisualLayer(Elastic Band Integration Spike)
 *
 * 本组件是 **renderer,不是第二套 arranger**:
 *   Store 实时 node.position(Arrange 的唯一输出)
 *     → computeElasticMatrixGeometry(participant/stage envelope + 最小移动)
 *     → 本层只负责渲染 band body 与固定 label。
 *
 * 语义与既有规则保持:
 *   - 不修改任何 Node position / participantId / stage membership / order;
 *   - Participant / Stage band 顺序不变;band 可弹性移动去包含 Node;
 *   - assigned 同时进入两轴 envelope;rowOnly 只进 Participant;free 不进任何 band;
 *   - 空 Participant 保持最小高度;不创建虚拟 band;
 *   - Stage 列带/参与方行带的显示仍分别由 showStageBands / showParticipantBands 控制。
 *
 * Labels / 命中表 / 双击改名等交互与既有实现一致。
 */

const STAGE_LABEL_H = 28;
const LANE_LABEL_W = 120;
const MIN_STAGE_LABEL_W = 96;
const MIN_LANE_LABEL_H = 24;
/** 空 band 的最小视觉范围(world) */
const DEFAULT_EMPTY_H = 60;
const DEFAULT_BAND_W = 600;
/** 空 Stage 列宽下限,保证标签可读 */
const DEFAULT_EMPTY_STAGE_W = 120;

interface Rect { l: number; t: number; r: number; b: number }
interface LabelItem { key: string; text: string; id: string }

export default function MatrixVisualLayer() {
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const participants = useGraphStore((s) => s.participants);
  const participantOrder = useGraphStore((s) => s.participantOrder);
  const stages = useGraphStore((s) => s.stages);
  const stageOrder = useGraphStore((s) => s.stageOrder);
  const viewport = useGraphStore((s) => s.viewport);
  const showStageBands = useGraphStore((s) => s.showStageBands);
  const showParticipantBands = useGraphStore((s) => s.showParticipantBands);
  const updateStage = useGraphStore((s) => s.updateStage);
  const updateParticipant = useGraphStore((s) => s.updateParticipant);
  // Phase C:拖拽悬停形成的候选带高亮(仅 runtime 视觉;高亮≠语义变更)
  const reassignHighlight = useGraphStore((s) => s.reassignHighlight);

  const rootRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [labelEdit, setLabelEdit] = useState<{
    kind: 'stage' | 'lane';
    id: string;
    key: string;
    value: string;
  } | null>(null);
  const ready = size.w > 0 && size.h > 0;

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setSize({ w: r.width, h: r.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // React Flow 会吞 dblclick,故在 window 捕获阶段用坐标命中表识别 label 双击
  useEffect(() => {
    if (!ready) return;
    const onDbl = (e: MouseEvent) => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      const hit = findMatrixLabelHit(e.clientX - rect.left, e.clientY - rect.top);
      if (!hit) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setLabelEdit({ kind: hit.kind, id: hit.id, key: hit.key, value: hit.text });
    };
    window.addEventListener('dblclick', onDbl, true);
    return () => window.removeEventListener('dblclick', onDbl, true);
  }, [ready]);

  const { structure } = useMemo(
    () => computeMatrixGridGeometry({ nodes, participants, participantOrder, stages, stageOrder }, { edges }),
    [nodes, edges, participants, participantOrder, stages, stageOrder],
  );

  const stageNameOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const st of stages) m.set(st.id, st.name || '未命名阶段');
    return m;
  }, [stages]);
  const participantNameOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of participants) m.set(p.id, p.name || '未命名参与方');
    return m;
  }, [participants]);

  // Node 实时矩形(Arrange 唯一几何输出;row/col 顺序来自语义 structure)
  const elastic = useMemo(() => {
    const pidSet = new Set(participants.map((p) => p.id));
    const stageIdSet = new Set(stages.map((s) => s.id));
    const nodeRects = structure.topNodes.map((n) => {
      const w = n.measured?.width ?? n.width ?? 240;
      const h = n.measured?.height ?? n.height ?? 150;
      const pid = n.data?.participantId && pidSet.has(n.data.participantId) ? n.data.participantId : undefined;
      const sid = stages.find((s) => s.nodeIds.includes(n.id) && stageIdSet.has(s.id))?.id;
      return { id: n.id, pid, stage: sid, rect: { x: n.position.x, y: n.position.y, w, h } };
    });
    const rowOrder = structure.rows.map((r) => r.participantId);
    return computeElasticMatrixGeometry({
      participants,
      stages,
      participantOrder: rowOrder,
      stageOrder: structure.cols,
      nodeRects,
      pad: 12,
      gap: 2,
      emptyExtent: DEFAULT_EMPTY_H,
      emptyCross: DEFAULT_BAND_W,
    });
  }, [structure, participants, stages]);

  const commitLabelEdit = () => {
    if (!labelEdit) return;
    const v = labelEdit.value.trim();
    if (v) {
      if (labelEdit.kind === 'stage') updateStage(labelEdit.id, { name: v });
      else updateParticipant(labelEdit.id, { name: v });
    }
    setLabelEdit(null);
  };

  if (size.w <= 0 || size.h <= 0) {
    return <div ref={rootRef} className="matrix-visual-layer" />;
  }

  const { participantBands, stageBands } = elastic;
  const { zoom, x: vx, y: vy } = viewport;

  const sx = (worldX: number) => worldX * zoom + vx;
  const sy = (worldY: number) => worldY * zoom + vy;
  const toScreen = (w: Rect) => ({
    left: sx(w.l),
    top: sy(w.t),
    width: (w.r - w.l) * zoom,
    height: (w.b - w.t) * zoom,
  });

  const vis = {
    l: -vx / zoom,
    t: -vy / zoom,
    r: (size.w - vx) / zoom,
    b: (size.h - vy) / zoom,
  };

  // 数据存在(同时有参与方与阶段)时,行/列带才各自按显示开关渲染;两者都关 → 不渲染矩阵层
  const hasData = participantBands.length > 0 && stageBands.length > 0;
  const stageOn = hasData && showStageBands;
  const partOn = hasData && showParticipantBands;
  if (!stageOn && !partOn) {
    return <div ref={rootRef} className="matrix-visual-layer" />;
  }

  // ---- 世界区间(条带视觉,渲染层不修改 Node) ----
  // Stage 列带:从顶部 label 向下无限延伸(贯穿视口纵向),宽度 = 该列 envelope 的 left..right;
  // Participant 行带:从左侧 label 向右无限延伸(贯穿视口横向),高度 = 该行 envelope 的 top..bottom。
  // 弹性只改变起始位置(start),保序;不改变“无限延伸”视觉。
  const colWorld: (Rect & { isEmpty?: boolean })[] = [];
  if (stageOn) {
    for (const b of stageBands) {
      colWorld.push({
        l: b.left,
        r: b.right,
        t: vis.t,
        b: vis.b,
        isEmpty: b.isEmpty,
      });
    }
  }
  const rowWorld: (Rect & { isEmpty?: boolean })[] = [];
  if (partOn) {
    for (const b of participantBands) {
      rowWorld.push({
        l: vis.l,
        r: vis.r,
        t: b.top,
        b: b.bottom,
        isEmpty: b.isEmpty,
      });
    }
  }

  // ---- Labels + 命中表(仅渲染打开的那一类带) ----
  const stageItems: (LabelItem & { rect: Rect; isEmpty?: boolean })[] = [];
  if (stageOn) {
    stageBands.forEach((b, i) => {
      const w = colWorld[i];
      const l = sx(w.l);
      const cw = Math.max((w.r - w.l) * zoom, MIN_STAGE_LABEL_W);
      if (l + cw <= 0 || l >= size.w) return;
      stageItems.push({
        key: `stage-${i}`,
        text: stageNameOf.get(b.id) ?? '未命名阶段',
        id: b.id,
        rect: { l: b.left, t: 0, r: b.right, b: DEFAULT_EMPTY_H },
        isEmpty: b.isEmpty,
      });
    });
  }
  const laneItems: (LabelItem & { rect: Rect; isEmpty?: boolean })[] = [];
  if (partOn) {
    participantBands.forEach((b, i) => {
      const w = rowWorld[i];
      const y = sy(w.t);
      const h = Math.max((w.b - w.t) * zoom, MIN_LANE_LABEL_H);
      if (y + h <= 0 || y >= size.h) return;
      laneItems.push({
        key: `lane-${i}`,
        text: participantNameOf.get(b.id) ?? '未命名参与方',
        id: b.id,
        rect: { l: 0, t: b.top, r: DEFAULT_BAND_W, b: b.bottom },
        isEmpty: b.isEmpty,
      });
    });
  }

  // 同步命中表(label 屏幕矩形,容器局部坐标)
  const hits: MatrixLabelHit[] = [];
  for (const it of stageItems) {
    hits.push({
      kind: 'stage',
      id: it.id,
      key: it.key,
      text: it.text,
      l: sx(it.rect.l),
      t: 0,
      r: Math.max(sx(it.rect.l) + (it.rect.r - it.rect.l) * zoom, sx(it.rect.l) + MIN_STAGE_LABEL_W),
      b: STAGE_LABEL_H,
    });
  }
  for (const it of laneItems) {
    const y = sy(it.rect.t);
    const h = Math.max((it.rect.b - it.rect.t) * zoom, MIN_LANE_LABEL_H);
    hits.push({ kind: 'lane', id: it.id, key: it.key, text: it.text, l: 0, t: y, r: LANE_LABEL_W, b: y + h });
  }
  setMatrixLabelHits(hits);

  const isEditingLabel = (key: string) => labelEdit?.key === key;
  const editInput = (key: string) => (
    <input
      className="matrix-label-input"
      autoFocus
      value={labelEdit!.value}
      onChange={(e) => setLabelEdit((cur) => (cur ? { ...cur, value: e.target.value } : cur))}
      onFocus={(e) => e.target.select()}
      onBlur={commitLabelEdit}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') commitLabelEdit();
        else if (e.key === 'Escape') setLabelEdit(null);
      }}
    />
  );

  return (
    <div ref={rootRef} className="matrix-visual-layer">
      <div className="matrix-body-layer">
        {stageOn &&
          colWorld.map((w, i) => {
            // 空带只有标签,不渲染无限延伸的带主体,避免细窄误导
            if (w.isEmpty) return null;
            const s = toScreen(w);
            const hl = reassignHighlight?.stage != null && stageBands[i]?.id === reassignHighlight.stage;
            return (
              <div
                key={`col-${i}`}
                className={`matrix-band matrix-col${hl ? ' reassign-target' : ''}`}
                style={s}
              />
            );
          })}
        {partOn &&
          rowWorld.map((w, i) => {
            // 空带只有标签,不渲染带主体
            if (w.isEmpty) return null;
            const s = toScreen(w);
            const hl = reassignHighlight?.participant != null && participantBands[i]?.id === reassignHighlight.participant;
            return (
              <div
                key={`row-${i}`}
                className={`matrix-band matrix-row${hl ? ' reassign-target' : ''}`}
                style={s}
              />
            );
          })}
      </div>

      <div className="matrix-label-layer">
        {/* 贴边守卫:顶部条/左缘条可命中,防止双击 label 误触发空白建节点 */}
        {stageOn && (
          <div className="matrix-gutter-guard" style={{ left: 0, top: 0, width: size.w, height: STAGE_LABEL_H }} />
        )}
        {partOn && (
          <div className="matrix-gutter-guard" style={{ left: 0, top: 0, width: LANE_LABEL_W, height: size.h }} />
        )}

        {stageItems.map((it) => {
          const editing = isEditingLabel(it.key);
          const s = toScreen(it.rect);
          const width = Math.max((it.rect.r - it.rect.l) * zoom, MIN_STAGE_LABEL_W);
          return (
            <div
              key={it.key}
              className={`matrix-label stage${it.isEmpty ? ' empty' : ''}${editing ? ' editing' : ''}${
                reassignHighlight?.stage === it.id ? ' reassign-target-label' : ''
              }`}
              style={{ top: 0, left: s.left, width, height: STAGE_LABEL_H, lineHeight: `${STAGE_LABEL_H}px` }}
              title={it.text}
            >
              {editing ? editInput(it.key) : it.text}
            </div>
          );
        })}
        {laneItems.map((it) => {
          const editing = isEditingLabel(it.key);
          const y = sy(it.rect.t);
          const h = Math.max((it.rect.b - it.rect.t) * zoom, MIN_LANE_LABEL_H);
          return (
            <div
              key={it.key}
              className={`matrix-label lane${it.isEmpty ? ' empty' : ''}${editing ? ' editing' : ''}${
                reassignHighlight?.participant === it.id ? ' reassign-target-label' : ''
              }`}
              style={{ left: 0, top: y, width: LANE_LABEL_W, height: h, lineHeight: `${h}px` }}
              title={it.text}
            >
              {editing ? editInput(it.key) : it.text}
            </div>
          );
        })}
      </div>
    </div>
  );
}
