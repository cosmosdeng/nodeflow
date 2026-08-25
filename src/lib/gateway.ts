import type { FlowNode, GatewayMeta, GatewayType } from '../types';
import { uid } from '../types';

/** 网关头像标签与内部标记 */
export const GATEWAY_META: Record<GatewayType, { label: string; mark: string; color: string }> = {
  exclusive: { label: '排他网关', mark: '×', color: '#f59e0b' },
  parallel: { label: '并行网关', mark: '+', color: '#14b8a6' },
  inclusive: { label: '包容网关', mark: '○', color: '#8b5cf6' },
};

/** 网关类型列表(排他 / 并行 / 包容) */
export const GATEWAY_KINDS: GatewayType[] = ['exclusive', 'parallel', 'inclusive'];

/** 创建一个 BPMN 网关节点(菱形外观):1 输入 + 2 个默认输出分支,可继续添加 */
export function createGatewayNode(type: GatewayType, position: { x: number; y: number }): FlowNode {
  const id = uid('gw');
  return {
    id,
    type: 'flow',
    position,
    width: 380,
    height: 220,
    data: {
      label: GATEWAY_META[type].label,
      description: '',
      actor: 'hybrid',
      locked: false,
      inputs: [{ id: 'in_1', name: '输入' }],
      outputs: [{ id: 'out_1', name: '分支1' }, { id: 'out_2', name: '分支2' }],
      gateway: { type },
    },
  };
}

/** 切换网关类型:保留端口与 defaultBranch,更新类型与默认 label。返回新的 gateway 元数据 */
export function changeGatewayType(
  gw: GatewayMeta,
  type: GatewayType,
  label?: string,
): { gateway: GatewayMeta; label: string } {
  return {
    gateway: { ...gw, type },
    label: label ?? GATEWAY_META[type].label,
  };
}

/** 设置/清除默认分支(兜底分支):gateway.defaultBranch 指向出口连线 id */
export function setDefaultBranch(gw: GatewayMeta, edgeId: string | null): GatewayMeta {
  if (edgeId === null) {
    const { defaultBranch: _omit, ...rest } = gw;
    return rest;
  }
  return { ...gw, defaultBranch: edgeId };
}

/** 网关分支配色(连线上按分支序号取色) */
export const GATEWAY_BRANCH_COLORS = ['#ff6b6b', '#4ecdc4', '#f7d794', '#a29bfe', '#55efc4', '#fd79a8', '#74b9ff', '#ffeaa7'];
