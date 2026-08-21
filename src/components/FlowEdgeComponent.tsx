import { memo } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type EdgeProps,
} from '@xyflow/react';
import { ARTIFACT_META, uid, type FlowEdge } from '../types';
import { useGraphStore } from '../store/graphStore';

function FlowEdgeComponent({
  id,
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
  const setArtifact = useGraphStore((s) => s.setArtifact);
  const artifact = data?.artifact ?? null;

  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 12,
  });

  const label = data?.label ?? '';
  const isEdgeActive = selected;
  const isArtifactActive = useGraphStore(
    (s) => s.selected?.kind === 'artifact' && s.selected.edgeId === id,
  );

  return (
    <>
      <BaseEdge id={id} path={path} />
      <EdgeLabelRenderer>
        {/* 连线说明文字 */}
        <div
          className={`nf-edge-label ${isEdgeActive ? 'active' : ''}`}
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY - 20}px)`,
            pointerEvents: 'all',
          }}
          onClick={(e) => {
            e.stopPropagation();
            setSelected({ kind: 'edge', id });
          }}
          title={label || '点击编辑连线说明'}
        >
          {label || '连线说明'}
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
          </div>
        ) : (
          <button
            className="nf-add-artifact"
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY + 20}px)`,
            }}
            title="添加中间产物"
            onClick={(e) => {
              e.stopPropagation();
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
