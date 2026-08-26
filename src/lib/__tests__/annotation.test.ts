import { describe, expect, it } from 'vitest';
import type { Annotation, AnnotationTarget } from '../../types';
import {
  annotationTargetMatches,
  annotationTargetsEdge,
  annotationTargetsNode,
  annotationTargetsStage,
  anyAnnotationExpanded,
  createAnnotation,
  toggleAnnotationCollapsed,
} from '../annotation';

function annot(id: string, target: AnnotationTarget, collapsed = false): Annotation {
  return { id, title: '', content: '', target, collapsed };
}

describe('lib/annotation 注释领域', () => {
  it('annotationTargetMatches:按同类归属主体判定', () => {
    expect(annotationTargetMatches({ kind: 'node', nodeId: 'a' }, { kind: 'node', nodeId: 'a' })).toBe(true);
    expect(annotationTargetMatches({ kind: 'node', nodeId: 'a' }, { kind: 'node', nodeId: 'b' })).toBe(false);
    expect(annotationTargetMatches({ kind: 'edge', edgeId: 'e' }, { kind: 'edge', edgeId: 'e' })).toBe(true);
    expect(annotationTargetMatches({ kind: 'edge', edgeId: 'e' }, { kind: 'artifact', edgeId: 'e' })).toBe(false);
    expect(annotationTargetMatches({ kind: 'canvas', tabId: 'main' }, { kind: 'canvas', tabId: 'main' })).toBe(true);
  });

  it('annotationTargetsNode / annotationTargetsEdge', () => {
    const nodeA = annot('1', { kind: 'node', nodeId: 'a' });
    const edgeE = annot('2', { kind: 'edge', edgeId: 'e' });
    const artE = annot('3', { kind: 'artifact', edgeId: 'e' });
    expect(annotationTargetsNode(nodeA, 'a')).toBe(true);
    expect(annotationTargetsNode(nodeA, 'b')).toBe(false);
    expect(annotationTargetsEdge(edgeE, 'e')).toBe(true);
    expect(annotationTargetsEdge(artE, 'e')).toBe(true);
    expect(annotationTargetsEdge(nodeA, 'e')).toBe(false);
  });

  it('annotationTargetMatches / annotationTargetsStage:阶段域归属', () => {
    expect(annotationTargetMatches({ kind: 'stage', stageId: 's1' }, { kind: 'stage', stageId: 's1' })).toBe(true);
    expect(annotationTargetMatches({ kind: 'stage', stageId: 's1' }, { kind: 'stage', stageId: 's2' })).toBe(false);
    expect(annotationTargetMatches({ kind: 'stage', stageId: 's1' }, { kind: 'node', nodeId: 's1' })).toBe(false);
    const stageA = annot('9', { kind: 'stage', stageId: 's1' });
    expect(annotationTargetsStage(stageA, 's1')).toBe(true);
    expect(annotationTargetsStage(stageA, 's2')).toBe(false);
  });

  it('createAnnotation:创建默认不收起、空标题/内容', () => {
    const a = createAnnotation('id1', { kind: 'node', nodeId: 'a' }, { x: 1, y: 2 });
    expect(a).toEqual({
      id: 'id1',
      title: '',
      content: '',
      target: { kind: 'node', nodeId: 'a' },
      collapsed: false,
      position: { x: 1, y: 2 },
    });
  });

  it('anyAnnotationExpanded:存在任意展开返回 true', () => {
    expect(anyAnnotationExpanded([annot('1', { kind: 'node', nodeId: 'a' }, true)])).toBe(false);
    expect(anyAnnotationExpanded([annot('1', { kind: 'node', nodeId: 'a' }, false)])).toBe(true);
  });

  it('toggleAnnotationCollapsed:只切换目标注释,不修改原数组', () => {
    const list = [annot('1', { kind: 'node', nodeId: 'a' }), annot('2', { kind: 'node', nodeId: 'b' }, true)];
    const result = toggleAnnotationCollapsed(list, '2');
    expect(result[1].collapsed).toBe(false);
    expect(result[0].collapsed).toBe(false); // 1 不受影响
    expect(list[1].collapsed).toBe(true); // 原数组不变
  });
});
