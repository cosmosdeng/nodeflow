import { memo, useMemo, useRef, useState } from 'react';
import { BaseEdge, EdgeLabelRenderer, type EdgeProps } from '@xyflow/react';
import { ARTIFACT_META, uid, type FlowEdge } from '../types';
import { useGraphStore } from '../store/graphStore';
import { computeEdgePath } from '../lib/edgePath';
import EditableText from './EditableText';
import AnnotationBox from './AnnotationBox';

function FlowEdgeComponent({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps<FlowEdge>) {
  const setSelected = useGraphStore((s) => s.setSelected);
  const requestAutoEdit = useGraphStore((s) => s.requestAutoEdit);
  const pendingAutoEdit = useGraphStore((s) => s.pendingAutoEdit);
  const setArtifact = useGraphStore((s) => s.setArtifact);
  const updateEdge = useGraphStore((s) => s.updateEdge);
  const edgeStyle = useGraphStore((s) => s.edgeStyle);
  const allLocked = useGraphStore((s) => s.allLocked);
  const allNodes = useGraphStore((s) => s.nodes);
  const annotations = useGraphStore((s) => s.annotations);
  const addAnnotation = useGraphStore((s) => s.addAnnotation);
  const updateAnnotation = useGraphStore((s) => s.updateAnnotation);
  const deleteAnnotation = useGraphStore((s) => s.deleteAnnotation);
  const toggleAnnotationCollapsed = useGraphStore((s) => s.toggleAnnotationCollapsed);
  const artifact = data?.artifact ?? null;
  // 归属该连线的注释(连线归属)
  const edgeAnnots = useMemo(
    () => annotations.filter((a) => a.target.kind === 'edge' && a.target.edgeId === id),
    [annotations, id],
  );
  // 归属该产物(连线中间产物)的注释
  const artifactAnnots = useMemo(
    () => annotations.filter((a) => a.target.kind === 'artifact' && a.target.edgeId === id),
    [annotations, id],
  );
  // 画布上连线说明是否处于内联编辑态(用于编辑时允许换行/扩展)
  const [labelEditing, setLabelEditing] = useState(false);
  // 是否悬停(用于控制无注释时的添加 pin 显示;离开后延迟隐藏,留出移入 pin 的时间)
  const [hovered, setHovered] = useState(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enterHover = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    setHovered(true);
  };
  const leaveHover = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setHovered(false), 350);
  };

  // 连线是否被锁定(全局锁定,或任一端节点锁定) → 锁定时不显示任何删除图标
  const srcLocked = useGraphStore((s) => s.nodes.find((n) => n.id === source)?.data?.locked);
  const tgtLocked = useGraphStore((s) => s.nodes.find((n) => n.id === target)?.data?.locked);
  const edgeLocked = !!allLocked || !!srcLocked || !!tgtLocked;

  // 收集所有可见节点作为障碍物用于连线绕障。
  // 排除 source 节点本身(路径从 source 端口出发即离开,无需绕);保留 target 节点
  // (连线中段/标签可能落在 target 节点头部,需要绕开)以及其它中间节点。
  const obstacles = useMemo(
    () =>
      allNodes
        .filter((n) => n.id !== source && !n.hidden)
        .map((n) => ({
          x: n.position.x,
          y: n.position.y,
          width: n.measured?.width ?? 230,
          height: n.measured?.height ?? 120,
        })),
    [allNodes, source],
  );

  const { path, labelX, labelY } = useMemo(
    () =>
      computeEdgePath({
        sourceX,
        sourceY,
        sourcePosition,
        targetX,
        targetY,
        targetPosition,
        obstacles,
        edgeStyle,
      }),
    [
      sourceX,
      sourceY,
      sourcePosition,
      targetX,
      targetY,
      targetPosition,
      obstacles,
      edgeStyle,
    ],
  );

  const label = data?.label ?? '';
  const isEdgeActive = selected;
  const isArtifactActive = useGraphStore(
    (s) => s.selected?.kind === 'artifact' && s.selected.edgeId === id,
  );

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        onMouseEnter={enterHover}
        onMouseLeave={leaveHover}
      />
      <EdgeLabelRenderer>
        {/* 连线说明文字:双击或新建连线时在画布上内联编辑 */}
        <div
          className={`nf-edge-label ${isEdgeActive ? 'active' : ''} ${labelEditing ? 'editing' : ''}`}
          data-edge-id={id}
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY - 20}px)`,
            pointerEvents: 'all',
          }}
          onClick={(e) => {
            e.stopPropagation();
            setSelected({ kind: 'edge', id });
          }}
          onMouseEnter={enterHover}
          onMouseLeave={leaveHover}
          title={label || '双击编辑连线说明'}
        >
          <EditableText
            className="nf-edge-label-text"
            value={label}
            placeholder="连线说明"
            disabled={edgeLocked}
            onCommit={(v) => updateEdge(id, { label: v })}
            onEditingChange={setLabelEditing}
            autoFocus={pendingAutoEdit?.kind === 'edge-label' && pendingAutoEdit.id === id}
            onAutoFocusConsumed={() => requestAutoEdit(null)}
          />
          {!edgeLocked && label && (
            <button
              className="edge-chip-remove"
              title="清除连线说明"
              onClick={(e) => {
                e.stopPropagation();
                updateEdge(id, { label: '' });
              }}
            >
              ×
            </button>
          )}
        </div>

        {/* 中间产物或添加按钮 */}
        {artifact ? (
          <div
            className={`nf-artifact-chip ${isArtifactActive ? 'active' : ''}`}
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY + 20}px)`,
            }}
            onMouseEnter={enterHover}
            onMouseLeave={leaveHover}
            onClick={(e) => {
              e.stopPropagation();
              setSelected({ kind: 'artifact', edgeId: id });
            }}
          >
            <span className="a-icon">{ARTIFACT_META[artifact.kind].icon}</span>
            <span className="a-info">
              <span className="a-label">{artifact.label || '未命名产物'}</span>
              <span className="a-kind">{ARTIFACT_META[artifact.kind].label}</span>
            </span>
            {!edgeLocked && (
              <button
                className="edge-chip-remove"
                title="移除中间产物"
                onClick={(e) => {
                  e.stopPropagation();
                  setArtifact(id, null);
                }}
              >
                ×
              </button>
            )}
          </div>
        ) : (
          <button
            className="nf-add-artifact"
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY + 20}px)`,
            }}
            title={allLocked ? '演示模式已锁定' : '添加中间产物'}
            disabled={allLocked}
            onClick={(e) => {
              e.stopPropagation();
              if (allLocked) return;
              const artifactId = uid('art');
              setArtifact(id, {
                id: artifactId,
                kind: 'other',
                label: '新中间产物',
                description: '',
              });
              setSelected({ kind: 'artifact', edgeId: id });
            }}
          >
            +
          </button>
        )}

        {/* 产物注释:pin 与展开框放在产物正下方(居中),拉开间距避免重叠 */}
        {artifact && (
          <div
            className="artifact-annot"
            style={{
              position: 'absolute',
              transform: `translate(-50%, 0) translate(${labelX}px, ${labelY + 52}px)`,
            }}
          >
            {artifactAnnots.length === 0 ? (
              !edgeLocked &&
              hovered && (
                <button
                  className="edge-annot-btn pin"
                  title="添加注释"
                  onMouseEnter={enterHover}
                  onMouseLeave={leaveHover}
                  onClick={(e) => {
                    e.stopPropagation();
                    addAnnotation({ kind: 'artifact', edgeId: id });
                  }}
                >
                  📌
                </button>
              )
            ) : artifactAnnots[0].collapsed ? (
              <button
                className="edge-annot-btn pin has"
                title={artifactAnnots[0].title || '注释'}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleAnnotationCollapsed(artifactAnnots[0].id);
                }}
              >
                📌
              </button>
            ) : (
              <AnnotationBox
                annotation={artifactAnnots[0]}
                onUpdate={updateAnnotation}
                onDelete={deleteAnnotation}
                onToggleCollapsed={toggleAnnotationCollapsed}
              />
            )}
          </div>
        )}

        {/* 连线注释:放在连线说明上方,底部对齐向上展开,与说明保持间距 */}
        {!edgeLocked && (
          <div
            className="edge-annot-area"
            style={{
              position: 'absolute',
              transform: `translate(-50%, -100%) translate(${labelX}px, ${labelY - 42}px)`,
            }}
          >
            {/* 连线注释 pin:无注释时仅悬停显示添加 pin;有注释收起时持续显示;展开时不显示 */}
            {edgeAnnots.length === 0 ? (
              hovered && (
                <button
                  className="edge-annot-btn pin"
                  title="添加注释"
                  onMouseEnter={enterHover}
                  onMouseLeave={leaveHover}
                  onClick={(e) => {
                    e.stopPropagation();
                    addAnnotation({ kind: 'edge', edgeId: id });
                  }}
                >
                  📌
                </button>
              )
            ) : !edgeAnnots[0].collapsed ? null : (
              <button
                className="edge-annot-btn pin has"
                title={edgeAnnots[0].title || '注释'}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleAnnotationCollapsed(edgeAnnots[0].id);
                }}
              >
                📌
              </button>
            )}
            {/* 展开的连线注释框 */}
            {edgeAnnots
              .filter((a) => !a.collapsed)
              .map((a) => (
                <AnnotationBox
                  key={a.id}
                  annotation={a}
                  onUpdate={updateAnnotation}
                  onDelete={deleteAnnotation}
                  onToggleCollapsed={toggleAnnotationCollapsed}
                />
              ))}
          </div>
        )}
      </EdgeLabelRenderer>
    </>
  );
}

export default memo(FlowEdgeComponent);
