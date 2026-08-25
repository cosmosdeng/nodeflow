import { describe, expect, it } from 'vitest';
import type { FlowEdge, FlowNode } from '../../types';
import {
  COMPOSITE_PREFIX,
  encodeCompositePort,
  decodeCompositePort,
  decodeCompositePortPath,
  isCompositePort,
  computeCompositeActor,
  computeCompositePorts,
  computeCompositeBounds,
  getNodeSize,
  applyCompositeBoxes,
} from '../composite';

function node(id: string, data: Partial<FlowNode['data']>, extra?: Partial<FlowNode>): FlowNode {
  return {
    id,
    type: 'flow',
    position: { x: 0, y: 0 },
    data: {
      label: id,
      actor: 'machine',
      locked: false,
      inputs: [],
      outputs: [],
      ...data,
    },
    ...extra,
  } as FlowNode;
}

function edge(id: string, source: string, sourceHandle: string, target: string, targetHandle: string): FlowEdge {
  return { id, source, sourceHandle, target, targetHandle, type: 'flow', data: { label: '', artifact: null } } as FlowEdge;
}

describe('端口引用编码 / 解码', () => {
  it('encodeCompositePort 生成 cid: 前缀引用', () => {
    expect(encodeCompositePort('A', 'in1')).toBe('cid:A:in1');
  });

  it('isCompositePort 识别组合端口', () => {
    expect(isCompositePort('cid:A:in1')).toBe(true);
    expect(isCompositePort('in1')).toBe(false);
    expect(isCompositePort(null)).toBe(false);
    expect(isCompositePort('')).toBe(false);
  });

  it('decodeCompositePort 解析单层引用', () => {
    const d = decodeCompositePort('cid:A:in1');
    expect(d).toEqual({ nodeId: 'A', portId: 'in1' });
  });

  it('decodeCompositePort 对非法输入返回 null', () => {
    expect(decodeCompositePort(null)).toBeNull();
    expect(decodeCompositePort('in1')).toBeNull();
    expect(decodeCompositePort('')).toBeNull();
  });

  it('decodeCompositePortPath 解析单层', () => {
    expect(decodeCompositePortPath('cid:A:in1')).toEqual({ path: ['A'], portId: 'in1' });
  });

  it('decodeCompositePortPath 解析多层嵌套链式', () => {
    expect(decodeCompositePortPath('cid:A:cid:B:in1')).toEqual({ path: ['A', 'B'], portId: 'in1' });
    expect(decodeCompositePortPath('cid:A:cid:B:cid:C:out2')).toEqual({
      path: ['A', 'B', 'C'],
      portId: 'out2',
    });
  });

  it('decodeCompositePortPath 对非法输入返回 null', () => {
    expect(decodeCompositePortPath(null)).toBeNull();
    expect(decodeCompositePortPath('in1')).toBeNull();
  });
});

describe('computeCompositeActor 执行主体继承', () => {
  it('全部 human → human', () => {
    const children = [
      node('1', { actor: 'human' }),
      node('2', { actor: 'human' }),
    ];
    expect(computeCompositeActor(children)).toBe('human');
  });

  it('全部 machine → machine', () => {
    const children = [
      node('1', { actor: 'machine' }),
      node('2', { actor: 'machine' }),
    ];
    expect(computeCompositeActor(children)).toBe('machine');
  });

  it('human 与 machine 混杂 → hybrid', () => {
    const children = [
      node('1', { actor: 'human' }),
      node('2', { actor: 'machine' }),
    ];
    expect(computeCompositeActor(children)).toBe('hybrid');
  });

  it('含 hybrid → hybrid', () => {
    const children = [
      node('1', { actor: 'human' }),
      node('2', { actor: 'hybrid' }),
    ];
    expect(computeCompositeActor(children)).toBe('hybrid');
  });

  it('无子节点 → human(兜底)', () => {
    expect(computeCompositeActor([])).toBe('human');
  });

  it('嵌套组合:递归取内层组合的继承结果', () => {
    // 内层组合 comp_in: 内部全 machine → machine
    const innerChild1 = node('c1', { actor: 'machine' });
    const innerChild2 = node('c2', { actor: 'machine' });
    const compIn = node('comp_in', {
      actor: 'machine',
      composite: { expanded: false, childIds: ['c1', 'c2'] },
    });
    const byId = new Map([
      [innerChild1.id, innerChild1],
      [innerChild2.id, innerChild2],
      [compIn.id, compIn],
    ]);
    // comp_in(→machine) + 普通 human → 混杂 → hybrid
    const outerChild = node('c3', { actor: 'human' });
    expect(computeCompositeActor([compIn, outerChild], byId)).toBe('hybrid');
    // comp_in(→machine) + 普通 machine → machine
    const outerMachine = node('c4', { actor: 'machine' });
    expect(computeCompositeActor([compIn, outerMachine], byId)).toBe('machine');
  });
});

describe('computeCompositePorts 聚合端口', () => {
  it('普通子节点:聚合未被内部连线消耗的端口', () => {
    const a = node('A', {
      inputs: [{ id: 'in1', name: '输入1' }],
      outputs: [{ id: 'out1', name: '输出1' }],
    });
    const b = node('B', {
      inputs: [{ id: 'in1', name: '输入1' }],
      outputs: [{ id: 'out1', name: '输出1' }],
    });
    // A.out1 → B.in1 内部连线:消耗 A 的输出与 B 的输入
    const edges = [edge('e1', 'A', 'out1', 'B', 'in1')];
    const { inputs, outputs } = computeCompositePorts([a, b], edges);
    // 输入:A.in1,B.in1(B.in1 被内部连线消耗,应排除)→ 只剩 A.in1
    expect(inputs.map((p) => p.id)).toEqual([encodeCompositePort('A', 'in1')]);
    // 输出:A.out1(A 输出被内部连线消耗),B.out1 → 只剩 B.out1
    expect(outputs.map((p) => p.id)).toEqual([encodeCompositePort('B', 'out1')]);
  });

  it('重名端口按「节点名.端口名」降级命名', () => {
    const a = node('A', { outputs: [{ id: 'out1', name: '结果' }] });
    const b = node('B', { outputs: [{ id: 'out2', name: '结果' }] });
    const { outputs } = computeCompositePorts([a, b], []);
    const names = outputs.map((p) => p.name);
    expect(names).toEqual(['A.结果', 'B.结果']);
  });

  it('嵌套组合:递归展平内层聚合端口', () => {
    const deep = node('deep', { inputs: [{ id: 'din', name: '深层输入' }] });
    // 内层组合 comp_in 含 deep
    const compIn = node('comp_in', {
      inputs: [],
      outputs: [],
      composite: { expanded: false, childIds: ['deep'] },
    });
    const byId = new Map([
      [deep.id, deep],
      [compIn.id, compIn],
    ]);
    // 外层聚合 comp_in + 普通节点 outer
    const outer = node('outer', { inputs: [{ id: 'oin', name: '外层输入' }] });
    const { inputs } = computeCompositePorts([compIn, outer], [], byId);
    // 输入应包含:comp_in 内 deep 的输入(递归展平,ref 带 comp_in 前缀) + outer 的输入
    const refs = inputs.map((p) => p.id);
    expect(refs).toContain(encodeCompositePort('comp_in', encodeCompositePort('deep', 'din')));
    expect(refs).toContain(encodeCompositePort('outer', 'oin'));
  });
});

describe('computeCompositeBounds 边界计算', () => {
  it('计算一组子节点的包围盒', () => {
    const a = node('A', {}, { position: { x: 10, y: 20 }, measured: { width: 100, height: 60 } });
    const b = node('B', {}, { position: { x: 200, y: 100 }, measured: { width: 120, height: 80 } });
    const bounds = computeCompositeBounds([a, b], 16);
    expect(bounds).toEqual({
      x: 10 - 16,
      y: 20 - 16,
      width: 200 + 120 - 10 + 16 * 2,
      height: 100 + 80 - 20 + 16 * 2,
    });
  });

  it('空子节点返回 null', () => {
    expect(computeCompositeBounds([], 16)).toBeNull();
  });
});

describe('getNodeSize 节点尺寸', () => {
  it('优先取 measured', () => {
    const n = node('A', {}, { measured: { width: 240, height: 180 } });
    expect(getNodeSize(n)).toEqual({ w: 240, h: 180 });
  });

  it('无 measured 时回退默认值', () => {
    const n = node('A', {});
    expect(getNodeSize(n)).toEqual({ w: 240, h: 150 });
  });

  it('无 measured 但有显式 width/height', () => {
    const n = node('A', {}, { width: 300, height: 200 });
    expect(getNodeSize(n)).toEqual({ w: 300, h: 200 });
  });
});

describe('applyCompositeBoxes 展开组合虚线框重算', () => {
  const childA = node('A', {}, { position: { x: 100, y: 100 }, width: 200, height: 100 });
  const childB = node('B', {}, { position: { x: 350, y: 100 }, width: 200, height: 100 });

  it('展开态组合节点虚线框包裹子节点(含内边距)', () => {
    // 组合初始位置错误,应被重算为包裹 A、B
    const comp = node('G', { composite: { expanded: true, childIds: ['A', 'B'] } }, { position: { x: 0, y: 0 }, width: 100, height: 100 });
    const result = applyCompositeBoxes([childA, childB, comp]);
    const g = result.find((n) => n.id === 'G')!;
    // 包裹 A(100,100) 和 B(350,100),宽高含 COMPOSITE_PAD=36
    expect(g.position.x).toBeLessThanOrEqual(100 - 36);
    expect(g.position.y).toBeLessThanOrEqual(100 - 36);
    expect(g.position.x + (g.width ?? 0)).toBeGreaterThanOrEqual(350 + 200 + 36);
    expect(g.position.y + (g.height ?? 0)).toBeGreaterThanOrEqual(100 + 100 + 36);
  });

  it('塌缩态组合节点不重算', () => {
    const comp = node('G', { composite: { expanded: false, childIds: ['A', 'B'] } }, { position: { x: 0, y: 0 } });
    const result = applyCompositeBoxes([childA, childB, comp]);
    const g = result.find((n) => n.id === 'G')!;
    expect(g.position.x).toBe(0); // 未被改动
  });

  it('无展开组合时返回原数组引用', () => {
    const a = node('A', {});
    const input = [a];
    const result = applyCompositeBoxes(input);
    expect(result).toBe(input); // 无变化返回原引用
  });
});
