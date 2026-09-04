import { useEffect, useMemo, useRef, useState } from 'react';
import { useGraphStore } from '../store/graphStore';
import { computeMatrixGridGeometry } from '../lib/arrange';
import { findMatrixLabelHit, setMatrixLabelHits, type MatrixLabelHit } from './matrixLabelHit';

/**
 * Phase B — MatrixVisualLayer(B2 body + B3 labels + B4 收口;2026-09 无「未分配」尾带)
 *
 * 纯 derived visual layer:
 *   Store semantic → computeMatrixGridGeometry(与 P3 Arrange 同源)→ body 行/列带 + 固定 label。
 *
 * 产品语义(2026-09 修正):
 *   - 不生成/不渲染「未分配」尾行、尾列与文案;
 *   - Stage 列带纵向向下无限(上贴视口上边),宽度 = 列自身;
 *   - Swimlane 行带横向向右无限(左贴视口左),高度 = 行自身;
 *   - 行/列带几乎连续,相邻仅 ~1 屏像素发丝间隙;
 *   - 仅当同时存在 Participant 行与 Stage 列数据才渲染矩阵;行/列两类带分别由
 *     showParticipantBands / showStageBands 开关控制是否在当前视图显示(两者都关则不渲染)。
 *
 * Labels:双击进入就地名称编辑(updateStage/updateParticipant),水平、ellipsis、title。
 * 坐标命中表供建节点排除与双击编辑使用。
 */

const MATRIX_VISIBLE_EXT = 40;
const STAGE_LABEL_H = 28;
const LANE_LABEL_W = 120;
const MIN_STAGE_LABEL_W = 96;
const MIN_LANE_LABEL_H = 24;

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

  const geo = useMemo(
    () =>
      computeMatrixGridGeometry(
        { nodes, participants, participantOrder, stages, stageOrder },
        { edges },
      ),
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

  const { structure, colXs, colRights, rowYs, rowBottoms } = geo;
  const { rows, cols } = structure;
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
    l: -vx / zoom - MATRIX_VISIBLE_EXT,
    t: -vy / zoom - MATRIX_VISIBLE_EXT,
    r: (size.w - vx) / zoom + MATRIX_VISIBLE_EXT,
    b: (size.h - vy) / zoom + MATRIX_VISIBLE_EXT,
  };
  const sepW = 1 / zoom;

  // 数据存在(同时有行与列)时,行/列带才各自按显示开关渲染;两者都关 → 不渲染矩阵层
  const hasData = rows.length > 0 && cols.length > 0;
  const stageOn = hasData && showStageBands;
  const partOn = hasData && showParticipantBands;
  if (!stageOn && !partOn) {
    return <div ref={rootRef} className="matrix-visual-layer" />;
  }

  // ---- 世界区间(带,行/列几乎连续,间隙≈一条线;无未分配尾带) ----
  const colWorld: Rect[] = [];
  if (stageOn) {
    for (let c = 0; c < cols.length; c++) {
      const right = c + 1 < cols.length ? colXs[c + 1] - sepW : colRights[c];
      colWorld.push({ l: colXs[c], t: vis.t, r: right, b: vis.b });
    }
  }
  const rowWorld: (Rect & { isEmpty?: boolean })[] = [];
  if (partOn) {
    for (let i = 0; i < rows.length; i++) {
      const top = rowYs.get(i);
      if (top === undefined) continue;
      const nextTop = rowYs.get(i + 1);
      const ownBottom = rowBottoms.get(i);
      const bottom = nextTop !== undefined ? nextTop - sepW : ownBottom;
      if (bottom === undefined) continue;
      rowWorld.push({ isEmpty: rows[i].isEmpty, l: vis.l, t: top, r: vis.r, b: bottom });
    }
  }

  // ---- Labels + 命中表(仅渲染打开的那一类带) ----
  const stageItems: (LabelItem & { rect: Rect })[] = [];
  if (stageOn) {
    for (let c = 0; c < cols.length; c++) {
      const w = colWorld[c];
      const l = sx(w.l);
      const cw = Math.max((w.r - w.l) * zoom, MIN_STAGE_LABEL_W);
      if (l + cw <= 0 || l >= size.w) continue;
      stageItems.push({ key: `stage-${c}`, text: stageNameOf.get(cols[c]) ?? '未命名阶段', id: cols[c], rect: w });
    }
  }
  const laneItems: (LabelItem & { rect: Rect; isEmpty?: boolean })[] = [];
  if (partOn) {
    for (let i = 0; i < rows.length; i++) {
      const w = rowWorld[i];
      const y = sy(w.t);
      const h = Math.max((w.b - w.t) * zoom, MIN_LANE_LABEL_H);
      if (y + h <= 0 || y >= size.h) continue;
      laneItems.push({
        key: `lane-${i}`,
        text: participantNameOf.get(rows[i].participantId) ?? '未命名参与方',
        id: rows[i].participantId,
        rect: w,
        isEmpty: rows[i].isEmpty,
      });
    }
  }

  // 同步命中表(label 屏幕矩形,容器局部坐标)
  const hits: MatrixLabelHit[] = [];
  for (const it of stageItems) {
    const s = toScreen(it.rect);
    const w = Math.max((it.rect.r - it.rect.l) * zoom, MIN_STAGE_LABEL_W);
    hits.push({ kind: 'stage', id: it.id, key: it.key, text: it.text, l: s.left, t: 0, r: s.left + w, b: STAGE_LABEL_H });
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
            const s = toScreen(w);
            return <div key={`col-${i}`} className="matrix-band matrix-col" style={s} />;
          })}
        {partOn &&
          rowWorld.map((w, i) => {
            const s = toScreen(w);
            return (
              <div
                key={`row-${i}`}
                className={`matrix-band matrix-row${w.isEmpty ? ' empty' : ''}`}
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
              className={`matrix-label stage${editing ? ' editing' : ''}`}
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
              className={`matrix-label lane${it.isEmpty ? ' empty' : ''}${editing ? ' editing' : ''}`}
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
