import type { FlowEdge, FlowEdgeData } from '../types';
import { uid } from '../types';

/**
 * 创建一条流程连线。
 * 默认空说明、无产物;可通过 data 覆盖;可显式指定 id(如需要在 set 前引用)。
 */
export function createFlowEdge(
  source: string,
  sourceHandle: string | null | undefined,
  target: string,
  targetHandle: string | null | undefined,
  data?: Partial<FlowEdgeData>,
  id?: string,
): FlowEdge {
  return {
    id: id ?? uid('edge'),
    source,
    sourceHandle: sourceHandle ?? undefined,
    target,
    targetHandle: targetHandle ?? undefined,
    type: 'flow',
    data: { label: '', artifact: null, ...data } as FlowEdgeData,
  };
}

/** 判断两端口是否可直接连线(不同节点) */
export function canConnect(source: string, target: string): boolean {
  return source !== target;
}
