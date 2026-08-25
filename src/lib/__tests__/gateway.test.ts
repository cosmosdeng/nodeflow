import { describe, expect, it } from 'vitest';
import { changeGatewayType, createGatewayNode, GATEWAY_KINDS, GATEWAY_META, setDefaultBranch } from '../gateway';

describe('lib/gateway 网关领域', () => {
  it('createGatewayNode 创建三种网关:1 输入 + 2 分支,类型正确', () => {
    for (const t of GATEWAY_KINDS) {
      const gw = createGatewayNode(t, { x: 0, y: 0 });
      expect(gw.data.gateway?.type).toBe(t);
      expect(gw.data.label).toBe(GATEWAY_META[t].label);
      expect(gw.data.inputs).toHaveLength(1);
      expect(gw.data.outputs).toHaveLength(2);
      expect(gw.data.gateway?.defaultBranch).toBeUndefined();
    }
  });

  it('createGatewayNode 分支名依次为 分支1 / 分支2', () => {
    const gw = createGatewayNode('exclusive', { x: 0, y: 0 });
    expect(gw.data.outputs.map((o) => o.name)).toEqual(['分支1', '分支2']);
  });

  it('changeGatewayType 保留端口与 defaultBranch,更新类型与 label', () => {
    const gw = createGatewayNode('exclusive', { x: 0, y: 0 });
    const withBranch = setDefaultBranch(gw.data.gateway!, 'e_1');
    const updated = changeGatewayType(withBranch, 'parallel');
    expect(updated.gateway.type).toBe('parallel');
    expect(updated.gateway.defaultBranch).toBe('e_1'); // 保留兜底分支
    expect(updated.label).toBe(GATEWAY_META.parallel.label);
  });

  it('changeGatewayType 可显式指定 label', () => {
    const gw = createGatewayNode('inclusive', { x: 0, y: 0 });
    const updated = changeGatewayType(gw.data.gateway!, 'exclusive', '自定义');
    expect(updated.gateway.type).toBe('exclusive');
    expect(updated.label).toBe('自定义');
  });

  it('setDefaultBranch 设置与清除兜底分支', () => {
    const gw = createGatewayNode('exclusive', { x: 0, y: 0 });
    const set = setDefaultBranch(gw.data.gateway!, 'e_1');
    expect(set.defaultBranch).toBe('e_1');
    const cleared = setDefaultBranch(set, null);
    expect(cleared.defaultBranch).toBeUndefined();
  });
});
