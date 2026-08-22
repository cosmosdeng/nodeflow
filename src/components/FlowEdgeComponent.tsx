import { memo, useMemo, useState } from 'react';
import { BaseEdge, EdgeLabelRenderer, type EdgeProps } from '@xyflow/react';
import { ARTIFACT_META, uid, type FlowEdge } from '../types';
import { useGraphStore } from '../store/graphStore';
import { computeEdgePath } from '../lib/edgePath';
import EditableText from './EditableText';

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
  const artifact = data?.artifact ?? null;
  // 画布上连线说明是否处于内联编辑态(用于编辑时允许换行/扩展)
  const [labelEditing, setLabelEditing] = useState(false);

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
      <BaseEdge id={id} path={path} />
      <EdgeLabelRenderer>
        {/* 连线说明文字:双击或新建连线时在画布上内联编辑 */}
        <div
          className={`nf-edge-label ${isEdgeActive ? 'active' : ''} ${labelEditing ? 'editing' : ''}`}
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY - 20}px)`,
            pointerEvents: 'all',
          }}
          onClick={(e) => {
            e.stopPropagation();
            setSelected({ kind: 'edge', id });
          }}
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
      </EdgeLabelRenderer>
    </>
  );
}

export default memo(FlowEdgeComponent);
