import { memo, useMemo, useRef, useState } from 'react';
import { BaseEdge, EdgeLabelRenderer, type EdgeProps } from '@xyflow/react';
import { useShallow } from 'zustand/react/shallow';
import { ARTIFACT_META, uid, type FlowEdge } from '../types';
import { useGraphStore } from '../store/graphStore';
import { collectEdgeObstacles, computeEdgePath, type ObstacleRect } from '../lib/edgePath';
import { GATEWAY_BRANCH_COLORS } from '../lib/gateway';
import EditableText from './EditableText';
import AnnotationBox from './AnnotationBox';

const EMPTY_OBSTACLES: ObstacleRect[] = [];

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
  const addAnnotation = useGraphStore((s) => s.addAnnotation);
  const updateAnnotation = useGraphStore((s) => s.updateAnnotation);
  const deleteAnnotation = useGraphStore((s) => s.deleteAnnotation);
  const toggleAnnotationCollapsed = useGraphStore((s) => s.toggleAnnotationCollapsed);
  const artifact = data?.artifact ?? null;
  // 只订阅归属该连线/产物的注释
  const edgeAnnots = useGraphStore(
    useShallow((s) => s.annotations.filter((a) => a.target.kind === 'edge' && a.target.edgeId === id)),
  );
  const artifactAnnots = useGraphStore(
    useShallow((s) => s.annotations.filter((a) => a.target.kind === 'artifact' && a.target.edgeId === id)),
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
  // 注意:不能在 selector 里返回「每次新建的对象数组」—— useShallow 只做一层浅比较,
  // 元素引用每次都变,会被判定为「永远不相等」,导致 getSnapshot 不稳定并触发无限重渲染。
  // 因此只订阅稳定的 nodes 引用,再用 useMemo 派生障碍矩形。
  const nodesForObstacles = useGraphStore((s) => s.nodes);
  const obstacles = useMemo(() => collectEdgeObstacles(nodesForObstacles, source), [nodesForObstacles, source]);

  const { path, labelX, labelY } = useMemo(
    () =>
      computeEdgePath({
        sourceX,
        sourceY,
        sourcePosition,
        targetX,
        targetY,
        targetPosition,
        obstacles: obstacles.length ? obstacles : EMPTY_OBSTACLES,
        edgeStyle,
      }),
    [sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, obstacles, edgeStyle],
  );

  const label = data?.label ?? '';
  const isEdgeActive = selected;
  const isArtifactActive = useGraphStore((s) => s.selected?.kind === 'artifact' && s.selected.edgeId === id);

  // 网关分支连线配色:若 source 是网关,按 sourceHandle 的分支序号从调色板取色
  const edgeColor = useGraphStore((s) => {
    const src = s.nodes.find((n) => n.id === source);
    if (!src?.data?.gateway) return undefined;
    const e = s.edges.find((x) => x.id === id);
    const sh = e?.sourceHandle;
    if (!sh) return undefined;
    const idx = src.data.outputs.findIndex((o) => o.id === sh);
    return idx >= 0 ? GATEWAY_BRANCH_COLORS[idx % GATEWAY_BRANCH_COLORS.length] : undefined;
  });

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        onMouseEnter={enterHover}
        onMouseLeave={leaveHover}
        style={edgeColor ? { stroke: edgeColor } : undefined}
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
