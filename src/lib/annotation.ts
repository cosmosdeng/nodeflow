import type { Annotation, AnnotationTarget } from '../types';

/** 判断两个注释归属是否指向同一主体 */
export function annotationTargetMatches(a: AnnotationTarget, b: AnnotationTarget): boolean {
  if (a.kind === 'canvas' && b.kind === 'canvas') return a.tabId === b.tabId;
  if (a.kind === 'node' && b.kind === 'node') return a.nodeId === b.nodeId;
  if (a.kind === 'edge' && b.kind === 'edge') return a.edgeId === b.edgeId;
  if (a.kind === 'artifact' && b.kind === 'artifact') return a.edgeId === b.edgeId;
  return false;
}

/** 判断注释的归属是否引用了某节点 */
export function annotationTargetsNode(a: Annotation, nodeId: string): boolean {
  return a.target.kind === 'node' && a.target.nodeId === nodeId;
}

/** 判断注释的归属是否引用了某条边(连线归属或产物归属都定位到边) */
export function annotationTargetsEdge(a: Annotation, edgeId: string): boolean {
  if (a.target.kind === 'edge' || a.target.kind === 'artifact') {
    return a.target.edgeId === edgeId;
  }
  return false;
}

/** 是否存在任意展开的注释(用于「一键收起 / 展开」判定) */
export function anyAnnotationExpanded(annotations: readonly Annotation[]): boolean {
  return annotations.some((a) => !a.collapsed);
}

/**
 * 创建一条注释(默认不收起)。
 * 不负责去重判定(由调用方用 annotationTargetMatches 校验)。
 */
export function createAnnotation(
  id: string,
  target: AnnotationTarget,
  position?: { x: number; y: number },
): Annotation {
  return { id, title: '', content: '', target, collapsed: false, position };
}

/** 切换单条注释的收起状态 */
export function toggleAnnotationCollapsed(annotations: readonly Annotation[], id: string): Annotation[] {
  return annotations.map((a) => (a.id === id ? { ...a, collapsed: !a.collapsed } : a));
}
