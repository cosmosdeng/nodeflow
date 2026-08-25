import { describe, expect, it, beforeEach, vi } from 'vitest';
import { createGatewayNode, GATEWAY_META } from '../../lib/gateway';
import type { FlowNode, GatewayType } from '../../types';

// mock localStorage(Node 环境无 localStorage)
const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => store.set(k, v),
  removeItem: (k: string) => store.delete(k),
  clear: () => store.clear(),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() {
    return store.size;
  },
});

import { useGraphStore } from '../graphStore';

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

// 构造一条链:A.out → B.in, B.out → C.in
function buildChain() {
  const A = node('A', { actor: 'human', outputs: [{ id: 'out1', name: '出' }] }, { position: { x: 0, y: 0 } });
  const B = node('B', { actor: 'machine', inputs: [{ id: 'in1', name: '入' }], outputs: [{ id: 'out1', name: '出' }] }, { position: { x: 300, y: 0 } });
  const C = node('C', { actor: 'human', inputs: [{ id: 'in1', name: '入' }] }, { position: { x: 600, y: 0 } });
  const edges = [
    { id: 'e1', source: 'A', sourceHandle: 'out1', target: 'B', targetHandle: 'in1', type: 'flow' as const, data: { label: '', artifact: null } },
    { id: 'e2', source: 'B', sourceHandle: 'out1', target: 'C', targetHandle: 'in1', type: 'flow' as const, data: { label: '', artifact: null } },
  ];
  return { A, B, C, edges };
}

beforeEach(() => {
  store.clear();
  useGraphStore.setState({
    nodes: [],
    edges: [],
    past: [],
    future: [],
    selected: null,
    allLocked: false,
  });
});

describe('组合节点塌缩 / 展开(状态机)', () => {
  it('编组 A,B 后塌缩:隐藏子孙,外部连线改写到组合聚合端口', () => {
    const { A, B, C, edges } = buildChain();
    useGraphStore.setState({
      nodes: [
        { ...A, selected: true },
        { ...B, selected: true },
        { ...C, selected: false },
      ],
      edges,
      selected: null,
    });

    const groupId = useGraphStore.getState().groupSelected();
    expect(groupId).toBeTruthy();

    const s = useGraphStore.getState();
    const comp = s.nodes.find((n) => n.id === groupId);
    expect(comp).toBeTruthy();
    // A、B 被隐藏,组合节点塌缩
    expect(s.nodes.find((n) => n.id === 'A')?.hidden).toBe(true);
    expect(s.nodes.find((n) => n.id === 'B')?.hidden).toBe(true);
    expect(comp?.data?.composite?.expanded).toBe(false);
    // e1(A→B) 为内部连线 → hidden;e2(B→C) 改写为指向组合
    const e1 = s.edges.find((e) => e.id === 'e1');
    const e2 = s.edges.find((e) => e.id === 'e2');
    expect(e1?.hidden).toBe(true);
    expect(e2?.source).toBe(groupId);
    expect(e2?.sourceHandle).toContain('cid:');
  });

  it('展开(切换)后恢复子节点显示,外部连线还原到子节点', () => {
    const { A, B, C, edges } = buildChain();
    useGraphStore.setState({
      nodes: [
        { ...A, selected: true },
        { ...B, selected: true },
        { ...C, selected: false },
      ],
      edges,
      selected: null,
    });
    const groupId = useGraphStore.getState().groupSelected();
    expect(groupId).toBeTruthy();

    // 展开组合
    useGraphStore.getState().toggleComposite(groupId!);
    const s = useGraphStore.getState();
    const comp = s.nodes.find((n) => n.id === groupId);
    expect(comp?.data?.composite?.expanded).toBe(true);
    expect(s.nodes.find((n) => n.id === 'A')?.hidden).toBe(false);
    // e2 还原:source 应为 B
    const e2 = s.edges.find((e) => e.id === 'e2');
    expect(e2?.source).toBe('B');
    expect(e2?.sourceHandle).toBe('out1');
  });

  it('解除编组后连线正确还原(删除组合节点)', () => {
    const { A, B, C, edges } = buildChain();
    useGraphStore.setState({
      nodes: [
        { ...A, selected: true },
        { ...B, selected: true },
        { ...C, selected: false },
      ],
      edges,
      selected: null,
    });
    const groupId = useGraphStore.getState().groupSelected();
    expect(groupId).toBeTruthy();

    useGraphStore.getState().ungroup(groupId!);
    const s = useGraphStore.getState();
    // 组合节点被删除,A、B 恢复可见
    expect(s.nodes.find((n) => n.id === groupId)).toBeUndefined();
    expect(s.nodes.find((n) => n.id === 'A')?.hidden).toBe(false);
    expect(s.nodes.find((n) => n.id === 'B')?.hidden).toBe(false);
    // e1 内部连线恢复显示,e2 还原到 B
    const e1 = s.edges.find((e) => e.id === 'e1');
    const e2 = s.edges.find((e) => e.id === 'e2');
    expect(e1?.hidden).toBe(false);
    expect(e2?.source).toBe('B');
    expect(e2?.sourceHandle).toBe('out1');
  });
});

describe('连线插入节点(insertNodeOnEdge)', () => {
  it('在连线上插入节点:原连线拆成两段,新节点连接正确', () => {
    const { A, B, edges } = buildChain();
    useGraphStore.setState({
      nodes: [A, B],
      edges: [edges[0]],
      selected: null,
    });
    const newId = useGraphStore.getState().insertNodeOnEdge('e1');
    expect(newId).toBeTruthy();
    const s = useGraphStore.getState();
    // 原连线 e1 被移除
    expect(s.edges.find((e) => e.id === 'e1')).toBeUndefined();
    expect(s.edges).toHaveLength(2);
    // 上游:A → 新节点(in_1)
    const up = s.edges.find((e) => e.source === 'A');
    expect(up?.target).toBe(newId);
    expect(up?.targetHandle).toBe('in_1');
    // 下游:新节点(out_1) → B
    const down = s.edges.find((e) => e.target === 'B');
    expect(down?.source).toBe(newId);
    expect(down?.sourceHandle).toBe('out_1');
  });

  it('原连线的说明与产物转移到上游连线,下游为空白', () => {
    const { A, B, edges } = buildChain();
    useGraphStore.setState({
      nodes: [A, B],
      edges: [
        {
          ...edges[0],
          data: {
            label: '转账说明',
            artifact: { id: 'art1', kind: 'document' as const, label: '对账单', description: '' },
          },
        },
      ],
      selected: null,
    });
    const newId = useGraphStore.getState().insertNodeOnEdge('e1');
    const s = useGraphStore.getState();
    const up = s.edges.find((e) => e.source === 'A');
    const down = s.edges.find((e) => e.target === 'B');
    expect(up?.data?.label).toBe('转账说明');
    expect(up?.data?.artifact?.id).toBe('art1');
    expect(down?.data?.label).toBe('');
    expect(down?.data?.artifact).toBeNull();
    // 新节点 id 与上游/下游不冲突
    expect(newId).toBeTruthy();
  });

  it('原连线的注释(连线与产物归属)转移到上游连线', () => {
    const { A, B, edges } = buildChain();
    useGraphStore.setState({
      nodes: [A, B],
      edges: [edges[0]],
      annotations: [
        { id: 'an1', title: '连线注', content: '', target: { kind: 'edge', edgeId: 'e1' }, collapsed: false },
        { id: 'an2', title: '产物注', content: '', target: { kind: 'artifact', edgeId: 'e1' }, collapsed: true },
      ],
      selected: null,
    });
    useGraphStore.getState().insertNodeOnEdge('e1');
    const s = useGraphStore.getState();
    const up = s.edges.find((e) => e.source === 'A');
    const down = s.edges.find((e) => e.target === 'B');
    const an1 = s.annotations.find((a) => a.id === 'an1');
    const an2 = s.annotations.find((a) => a.id === 'an2');
    // 注释转移到上游连线 id
    expect(an1?.target).toEqual({ kind: 'edge', edgeId: up!.id });
    expect(an2?.target).toEqual({ kind: 'artifact', edgeId: up!.id });
    // 不指向下游
    expect(an1?.target.kind === 'edge' && an1.target.edgeId).not.toBe(down!.id);
  });
});

describe('流程阶段域(resizeStage / autoGrowStage)', () => {
  const defaultStage = {
    id: 's1',
    name: '阶段一',
    x: 0,
    y: 0,
    width: 500,
    height: 300,
    nodeIds: ['A'],
  };

  it('resizeStage 缩小到不能小于覆盖所有域内节点', () => {
    // 节点 A 在 (0,0),默认尺寸 240×150;域内边距 PAD=22
    useGraphStore.setState({
      nodes: [node('A', {}, { position: { x: 0, y: 0 } })],
      edges: [],
      stages: [defaultStage],
      selected: null,
    });
    useGraphStore.getState().resizeStage('s1', 100, 100, true);
    const s = useGraphStore.getState();
    const st = s.stages.find((x) => x.id === 's1')!;
    // 最小覆盖:width >= 0+240-0+22 = 262, height >= 0+150-0+22 = 172
    expect(st.width).toBeGreaterThanOrEqual(262);
    expect(st.height).toBeGreaterThanOrEqual(172);
  });

  it('autoGrowStage 自动扩大域框以包裹移出节点', () => {
    // 节点 A 移到 (600,0),超出域 (0,0,500,300)
    useGraphStore.setState({
      nodes: [node('A', {}, { position: { x: 600, y: 0 } })],
      edges: [],
      stages: [defaultStage],
      selected: null,
    });
    useGraphStore.getState().autoGrowStage('s1');
    const s = useGraphStore.getState();
    const st = s.stages.find((x) => x.id === 's1')!;
    // 域 x 左移包裹节点:PAD=22,节点左边界 600 → tx=578
    expect(st.x).toBeLessThanOrEqual(578);
    // 域右边界 >= 节点右边界 + PAD:600+240+22 = 862
    expect(st.x + st.width).toBeGreaterThanOrEqual(862);
  });

  it('autoGrowStage 扩大时把外部重叠节点推开(保持间距)', () => {
    // 节点 A 在域内 (0,0);外部节点 B 紧贴域右边界
    useGraphStore.setState({
      nodes: [
        node('A', {}, { position: { x: 0, y: 0 } }),
        node('B', {}, { position: { x: 500, y: 0 } }),
      ],
      edges: [],
      stages: [defaultStage],
      selected: null,
    });
    useGraphStore.getState().autoGrowStage('s1');
    const s = useGraphStore.getState();
    const st = s.stages.find((x) => x.id === 's1')!;
    const B = s.nodes.find((n) => n.id === 'B')!;
    // B 不应与扩大后的域重叠(B 左边界 >= 域右边界 + 间距)
    expect(B.position.x).toBeGreaterThanOrEqual(st.x + st.width + 14);
  });
});

describe('自动排列集成阶段域(autoLayout)', () => {
  it('全画布排列:域框收敛包裹内部节点,内部节点被域包含', () => {
    // 域 s1 含节点 A、B(连线 A→B),游离节点 C(连线 B→C)
    const A = node('A', { actor: 'human', outputs: [{ id: 'out1', name: '出' }] }, { position: { x: 0, y: 0 } });
    const B = node('B', { actor: 'machine', inputs: [{ id: 'in1', name: '入' }], outputs: [{ id: 'out1', name: '出' }] }, { position: { x: 300, y: 0 } });
    const C = node('C', { actor: 'human', inputs: [{ id: 'in1', name: '入' }] }, { position: { x: 600, y: 0 } });
    const edges = [
      { id: 'e1', source: 'A', sourceHandle: 'out1', target: 'B', targetHandle: 'in1', type: 'flow' as const, data: { label: '', artifact: null } },
      { id: 'e2', source: 'B', sourceHandle: 'out1', target: 'C', targetHandle: 'in1', type: 'flow' as const, data: { label: '', artifact: null } },
    ];
    useGraphStore.setState({
      nodes: [A, B, C],
      edges,
      stages: [{ id: 's1', name: '阶段一', x: 0, y: 0, width: 500, height: 300, nodeIds: ['A', 'B'], selected: false }],
      selected: null,
    });
    useGraphStore.getState().autoLayout('horizontal', undefined);
    const s = useGraphStore.getState();
    const st = s.stages.find((x) => x.id === 's1')!;
    const a = s.nodes.find((n) => n.id === 'A')!;
    const b = s.nodes.find((n) => n.id === 'B')!;
    // 域框收敛:不再保持初始 500 宽;内部 A、B 横向拓扑排列(A 在 B 左侧),域框包裹两者
    expect(a.position.x).toBeLessThan(b.position.x);
    // A、B 都被域框包含(含内边距 22)
    expect(a.position.x).toBeGreaterThanOrEqual(st.x - 1);
    expect(a.position.y).toBeGreaterThanOrEqual(st.y - 1);
    expect(a.position.y + 150).toBeLessThanOrEqual(st.y + st.height + 1);
    expect(b.position.x + 240).toBeLessThanOrEqual(st.x + st.width + 1);
  });

  it('单节点域框大小对齐倒数第二大的域', () => {
    // 域 s1 含 A、B 两个节点(较大),域 s2 仅含 C 一个节点(单节点)
    const A = node('A', {}, { position: { x: 0, y: 0 } });
    const B = node('B', {}, { position: { x: 0, y: 300 } });
    const C = node('C', {}, { position: { x: 0, y: 0 } });
    useGraphStore.setState({
      nodes: [A, B, C],
      edges: [],
      stages: [
        { id: 's1', name: '大', x: 0, y: 0, width: 300, height: 200, nodeIds: ['A', 'B'], selected: false },
        { id: 's2', name: '小', x: 600, y: 0, width: 300, height: 200, nodeIds: ['C'], selected: false },
      ],
      selected: null,
    });
    useGraphStore.getState().autoLayout('horizontal', undefined);
    const s = useGraphStore.getState();
    const s1 = s.stages.find((x) => x.id === 's1')!;
    const s2 = s.stages.find((x) => x.id === 's2')!;
    // 单节点域 s2 的大小应对齐「倒数第二大的域」(此处唯一其它域为 s1)
    expect(s2.width).toBe(s1.width);
    expect(s2.height).toBe(s1.height);
  });
});

describe('BPMN 网关节点(createGatewayNode)', () => {
  it('创建三种网关:data.gateway 类型正确,端口结构为 1 输入 + 2 输出', () => {
    const types: GatewayType[] = ['exclusive', 'parallel', 'inclusive'];
    for (const t of types) {
      const gw = createGatewayNode(t, { x: 0, y: 0 });
      expect(gw.data.gateway?.type).toBe(t);
      expect(gw.data.gateway?.defaultBranch).toBeUndefined();
      expect(gw.data.inputs).toHaveLength(1);
      expect(gw.data.outputs).toHaveLength(2);
      expect(gw.data.label).toBe(GATEWAY_META[t].label);
      // 尺寸接近普通节点但稍小
      expect(gw.width).toBeGreaterThan(100);
    }
  });

  it('网关节点可加入阶段域(作为普通节点处理)且可被序列化', () => {
    const gw = createGatewayNode('exclusive', { x: 0, y: 0 });
    useGraphStore.setState({
      nodes: [gw],
      edges: [],
      stages: [{ id: 's1', name: '阶段', x: 0, y: 0, width: 500, height: 300, nodeIds: [gw.id], selected: false }],
      selected: null,
    });
    const s = useGraphStore.getState();
    // 网关属于阶段域
    expect(s.stages[0].nodeIds).toContain(gw.id);
    // 导出 JSON 包含网关类型
    const json = JSON.parse(s.exportJson());
    expect(json.nodes[0].data.gateway.type).toBe('exclusive');
  });

  it('网关可编组成组合节点,解除编组后还原', () => {
    const gw = createGatewayNode('parallel', { x: 0, y: 0 });
    const n = node('A', {}, { position: { x: 400, y: 0 } });
    useGraphStore.setState({
      nodes: [gw, { ...n, selected: true }, { ...gw, selected: true }],
      edges: [],
      selected: null,
    });
    const groupId = useGraphStore.getState().groupSelected();
    expect(groupId).toBeTruthy();
    const s = useGraphStore.getState();
    // 组合节点包含网关 id
    expect(s.nodes.find((x) => x.id === groupId)?.data.composite?.childIds).toContain(gw.id);
    // 解除编组后网关还原为自由节点,gateway 保留
    useGraphStore.getState().ungroup(groupId!);
    const after = useGraphStore.getState();
    const gw2 = after.nodes.find((x) => x.id === gw.id);
    expect(gw2).toBeTruthy();
    expect(gw2?.data.gateway?.type).toBe('parallel');
  });

  it('复制粘贴网关:gateway 类型保留', () => {
    const gw = createGatewayNode('inclusive', { x: 0, y: 0 });
    useGraphStore.setState({
      nodes: [gw],
      edges: [],
      selected: { kind: 'node', id: gw.id },
    });
    const copied = useGraphStore.getState().copySelection();
    expect(copied).toBe(1);
    const pasted = useGraphStore.getState().pasteClipboard();
    expect(pasted).toBe(1);
    const s = useGraphStore.getState();
    const pastedGw = s.nodes.find((x) => x.id !== gw.id && x.data?.gateway);
    expect(pastedGw).toBeTruthy();
    expect(pastedGw?.data.gateway?.type).toBe('inclusive');
  });

  it('增加网关分支端点:已有连线保持连到原端点(端点 id 不变)', () => {
    const gw = createGatewayNode('exclusive', { x: 0, y: 0 });
    // 下游节点 B 连到网关 out_1 分支
    const B = node('B', { inputs: [{ id: 'in1', name: '入' }] }, { position: { x: 400, y: 0 } });
    const edges = [
      { id: 'e1', source: gw.id, sourceHandle: 'out_1', target: 'B', targetHandle: 'in1', type: 'flow' as const, data: { label: '', artifact: null } },
    ];
    useGraphStore.setState({
      nodes: [gw, B],
      edges,
      selected: null,
    });
    // 增加一个分支端点
    const g = useGraphStore.getState();
    g.updateNode(gw.id, {
      outputs: [...g.nodes.find((n) => n.id === gw.id)!.data.outputs, { id: 'out_3', name: '分支3' }],
    });
    const s = useGraphStore.getState();
    // 原连线 e1 仍连到 out_1(端点 id 不变),未断开
    expect(s.edges.find((e) => e.id === 'e1')?.sourceHandle).toBe('out_1');
    expect(s.edges.find((e) => e.id === 'e1')).toBeTruthy();
  });

  it('删除网关分支端点:只删除连到该端点的连线,其他分支连线保持', () => {
    const gw = createGatewayNode('exclusive', { x: 0, y: 0 });
    const B = node('B', { inputs: [{ id: 'in1', name: '入' }] }, { position: { x: 400, y: 0 } });
    const C = node('C', { inputs: [{ id: 'in1', name: '入' }] }, { position: { x: 600, y: 0 } });
    const edges = [
      { id: 'e1', source: gw.id, sourceHandle: 'out_1', target: 'B', targetHandle: 'in1', type: 'flow' as const, data: { label: '', artifact: null } },
      { id: 'e2', source: gw.id, sourceHandle: 'out_2', target: 'C', targetHandle: 'in1', type: 'flow' as const, data: { label: '', artifact: null } },
    ];
    useGraphStore.setState({
      nodes: [gw, B, C],
      edges,
      selected: null,
    });
    // 删除 out_1 分支
    useGraphStore.getState().removePort(gw.id, 'output', 'out_1');
    const s = useGraphStore.getState();
    // 连到 out_1 的 e1 被删除
    expect(s.edges.find((e) => e.id === 'e1')).toBeUndefined();
    // 连到 out_2 的 e2 保持
    expect(s.edges.find((e) => e.id === 'e2')?.sourceHandle).toBe('out_2');
  });
});
