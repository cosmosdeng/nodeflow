import { beforeEach, describe, expect, it } from 'vitest';
import { useGraphStore } from '../graphStore';
import type { FlowNode, FlowEdge, Stage, Annotation } from '../../types';

/**
 * P4-04 Serialization Round Trip
 *
 * 验证 Graph → Serialize → Deserialize → Graph 前后语义一致。
 * 覆盖 Node / Edge / Composite / Nested Composite / Gateway / Stage / Annotation / Artifact / viewport。
 *
 * 约束(按 P4 规范):不修改 .nodeflow 格式、不增加 migration、不重写 persistence。
 */

beforeEach(() => {
  // 重置到干净的初始状态
  useGraphStore.setState({
    nodes: [],
    edges: [],
    stages: [],
    annotations: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    past: [],
    future: [],
    selected: null,
    compositeTabs: [],
    activeTabId: 'main',
  });
});

function buildRichGraph() {
  const A: FlowNode = {
    id: 'A', type: 'flow', position: { x: 0, y: 0 }, width: 240, height: 150,
    data: { label: '节点A', description: '描述', actor: 'human', locked: false, inputs: [], outputs: [{ id: 'out1', name: '输出' }] },
  };
  const B: FlowNode = {
    id: 'B', type: 'flow', position: { x: 400, y: 0 }, width: 240, height: 150,
    data: { label: '节点B', description: '', actor: 'machine', locked: false, inputs: [{ id: 'in1', name: '输入' }], outputs: [] },
  };
  const G: FlowNode = {
    id: 'G', type: 'flow', position: { x: 0, y: 300 }, width: 240, height: 150,
    data: { label: '组合', description: '', actor: 'hybrid', locked: false, inputs: [], outputs: [], composite: { expanded: false, childIds: ['A', 'B'] } },
  };
  const GE: FlowNode = {
    id: 'GE', type: 'flow', position: { x: 400, y: 300 }, width: 240, height: 150,
    data: { label: '嵌套', description: '', actor: 'human', locked: false, inputs: [], outputs: [], composite: { expanded: false, childIds: ['G'] } },
  };
  const GW: FlowNode = {
    id: 'GW', type: 'flow', position: { x: 0, y: 600 }, width: 380, height: 220,
    data: { label: '排他网关', description: '', actor: 'hybrid', locked: false, inputs: [{ id: 'in_1', name: '输入' }], outputs: [{ id: 'out_1', name: '分支1' }, { id: 'out_2', name: '分支2' }], gateway: { type: 'exclusive' } },
  };
  const e1: FlowEdge = {
    id: 'e1', source: 'A', sourceHandle: 'out1', target: 'B', targetHandle: 'in1', type: 'flow',
    data: { label: '连线说明', artifact: { id: 'art1', kind: 'document', label: '对账单', description: '' } },
  };
  const stage: Stage = { id: 's1', name: '阶段一', x: -20, y: -20, width: 700, height: 200, nodeIds: ['A', 'B'] };
  const annot: Annotation = { id: 'an1', title: '注释标题', content: '注释内容', collapsed: false, target: { kind: 'node', nodeId: 'A' } };
  return { A, B, G, GE, GW, e1, stage, annot };
}

describe('P4-04 Serialization Round Trip', () => {
  it('project round-trip:节点 / 连线 / 组合 / 嵌套 / 网关 / 阶段域 / 注释 / 产物 / viewport 语义一致', () => {
    const { A, B, G, GE, GW, e1, stage, annot } = buildRichGraph();
    // 设置原始图 + viewport
    useGraphStore.setState({
      nodes: [A, B, G, GE, GW],
      edges: [e1],
      stages: [stage],
      annotations: [annot],
      viewport: { x: 120, y: 80, zoom: 1.25 },
    });
    const json = useGraphStore.getState().serializeProject();
    expect(JSON.parse(json).type).toBe('nodeflow-project');

    // 清空后加载
    useGraphStore.setState({ nodes: [], edges: [], stages: [], annotations: [] });
    const loaded = useGraphStore.getState().loadProject(json);
    expect(loaded).toBe(true);

    const s = useGraphStore.getState();
    // 节点数量与 id 一致
    expect(s.nodes.map((n) => n.id).sort()).toEqual(['A', 'B', 'G', 'GE', 'GW']);
    // 连线数量与 id 一致
    expect(s.edges.map((e) => e.id)).toEqual(['e1']);
    // 阶段域
    expect(s.stages).toHaveLength(1);
    expect(s.stages[0].id).toBe('s1');
    expect(s.stages[0].nodeIds).toEqual(['A', 'B']);
    // 注释
    expect(s.annotations).toHaveLength(1);
    expect(s.annotations[0].target).toEqual({ kind: 'node', nodeId: 'A' });
    // viewport
    expect(s.viewport).toEqual({ x: 120, y: 80, zoom: 1.25 });
  });

  it('网关类型与分支在 round-trip 后保留', () => {
    const { GW } = buildRichGraph();
    useGraphStore.setState({ nodes: [GW], edges: [] });
    const json = useGraphStore.getState().serializeProject();
    useGraphStore.setState({ nodes: [] });
    useGraphStore.getState().loadProject(json);
    const s = useGraphStore.getState();
    const gw = s.nodes.find((n) => n.id === 'GW')!;
    expect(gw.data.gateway?.type).toBe('exclusive');
    expect(gw.data.outputs).toHaveLength(2);
  });

  it('组合结构(嵌套 + child)在 round-trip 后保留', () => {
    const { G, GE } = buildRichGraph();
    useGraphStore.setState({ nodes: [G, GE], edges: [] });
    const json = useGraphStore.getState().serializeProject();
    useGraphStore.setState({ nodes: [] });
    useGraphStore.getState().loadProject(json);
    const s = useGraphStore.getState();
    const g = s.nodes.find((n) => n.id === 'G')!;
    const ge = s.nodes.find((n) => n.id === 'GE')!;
    expect(g.data.composite?.childIds).toEqual(['A', 'B']);
    expect(ge.data.composite?.childIds).toEqual(['G']);
  });

  it('连线 label 与产物(artifact)在 round-trip 后保留', () => {
    const { A, B, e1 } = buildRichGraph();
    useGraphStore.setState({ nodes: [A, B], edges: [e1] });
    const json = useGraphStore.getState().serializeProject();
    useGraphStore.setState({ nodes: [], edges: [] });
    useGraphStore.getState().loadProject(json);
    const s = useGraphStore.getState();
    const e = s.edges.find((x) => x.id === 'e1')!;
    expect(e.data?.label).toBe('连线说明');
    expect(e.data?.artifact?.id).toBe('art1');
    expect(e.data?.artifact?.kind).toBe('document');
  });

  it('exportJson 静态导出可被加载(round-trip 语义一致)', () => {
    const { A, B, e1, stage, annot } = buildRichGraph();
    useGraphStore.setState({
      nodes: [A, B], edges: [e1], stages: [stage], annotations: [annot],
    });
    const json = useGraphStore.getState().exportJson();
    useGraphStore.setState({ nodes: [], edges: [], stages: [], annotations: [] });
    useGraphStore.getState().loadProject(json);
    const s = useGraphStore.getState();
    expect(s.nodes.map((n) => n.id).sort()).toEqual(['A', 'B']);
    expect(s.edges).toHaveLength(1);
    expect(s.stages).toHaveLength(1);
    expect(s.annotations).toHaveLength(1);
  });

  it('损坏的 JSON 加载失败,不破坏当前状态', () => {
    useGraphStore.setState({ nodes: [], edges: [] });
    const ok = useGraphStore.getState().loadProject('{invalid json');
    expect(ok).toBe(false);
    // 状态未被破坏
    expect(useGraphStore.getState().nodes).toHaveLength(0);
  });
});
