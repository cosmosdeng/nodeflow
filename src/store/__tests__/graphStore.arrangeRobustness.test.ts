import { beforeEach, describe, expect, it } from 'vitest';
import { useGraphStore } from '../graphStore';
import type { FlowEdge, FlowNode, Participant, Stage } from '../../types';

/**
 * 自动排列的鲁棒性回归:
 * 覆盖「语义轴存在但语义稀薄 / 顺序数组陈旧 / 顺序数组与语义不同步」这类
 * 真实文档容易出现的形态 —— 排列结果必须仍然:不重叠、无 NaN、不被推到极远处。
 *
 * 背景:用户反馈「自动排列乱套」时的排查基线。src/lib/arrange.ts 与 layout.ts
 * 自 v0.4.0-next.4 起零改动,81 个布局测试全绿,所以这里锁的是**数据形态**层面的
 * 边缘行为,防止将来改动让这些形态产出重叠或飞出画布的结果。
 */

function node(id: string, x: number, y: number, data: Partial<FlowNode['data']> = {}): FlowNode {
  return {
    id,
    type: 'flow',
    position: { x, y },
    width: 230,
    height: 120,
    data: { label: id, description: '', actor: 'human', locked: false, inputs: [], outputs: [], ...data },
  } as FlowNode;
}

function edge(id: string, source: string, target: string): FlowEdge {
  return { id, source, target, type: 'flow', data: { label: '', artifact: null } } as FlowEdge;
}

interface Box {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

function boxes(nodes: FlowNode[]): Box[] {
  return nodes.map((n) => ({
    id: n.id,
    x: n.position.x,
    y: n.position.y,
    w: n.measured?.width ?? n.width ?? 240,
    h: n.measured?.height ?? n.height ?? 150,
  }));
}

/** 两矩形是否实质相交(留 8px 紧贴容差) */
function overlaps(a: Box, b: Box, gap = 8): boolean {
  return a.x < b.x + b.w - gap && b.x < a.x + a.w - gap && a.y < b.y + b.h - gap && b.y < a.y + a.h - gap;
}

function overlappingPairs(bs: Box[]): string[] {
  const bad: string[] = [];
  for (let i = 0; i < bs.length; i++) {
    for (let j = i + 1; j < bs.length; j++) {
      if (overlaps(bs[i], bs[j])) bad.push(`${bs[i].id}×${bs[j].id}`);
    }
  }
  return bad;
}

const PARTICIPANTS: Participant[] = [
  { id: 'P1', name: '脚本', type: 'person' },
  { id: 'P2', name: '导演', type: 'person' },
  { id: 'P3', name: '后期', type: 'person' },
];

function chain(count: number): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const nodes = Array.from({ length: count }, (_, i) => node(`N${i}`, i * 300, 100));
  const edges = nodes.slice(1).map((n, i) => edge(`e${i}`, nodes[i].id, n.id));
  return { nodes, edges };
}

function stagesOf(spec: Array<[string, string[], number]>): Stage[] {
  return spec.map(([id, nodeIds, x]) => ({ id, name: id, x, y: 0, width: 400, height: 400, nodeIds }));
}

function setup(input: {
  nodes: FlowNode[];
  edges: FlowEdge[];
  stages: Stage[];
  stageOrder?: string[];
  participantOrder?: string[];
}) {
  useGraphStore.setState({
    nodes: input.nodes,
    edges: input.edges,
    participants: PARTICIPANTS,
    participantOrder: input.participantOrder ?? PARTICIPANTS.map((p) => p.id),
    stages: input.stages,
    stageOrder: input.stageOrder ?? input.stages.map((s) => s.id),
    annotations: [],
    organizations: [],
    past: [],
    future: [],
    selected: null,
    compositeTabs: [],
    activeTabId: 'main',
    allLocked: false,
    arrangePending: false,
    arrangePendingKind: undefined,
    viewport: { x: 0, y: 0, zoom: 1 },
  });
}

beforeEach(() => {
  useGraphStore.setState({
    nodes: [],
    edges: [],
    stages: [],
    annotations: [],
    participants: [],
    organizations: [],
    past: [],
    future: [],
    selected: null,
    compositeTabs: [],
    activeTabId: 'main',
    allLocked: false,
    arrangePending: false,
    arrangePendingKind: undefined,
    viewport: { x: 0, y: 0, zoom: 1 },
  });
});

describe('runSmartArrange 鲁棒性(真实文档形态)', () => {
  it('语义稀薄:只有少数节点挂语义,排列后不重叠、无 NaN', () => {
    const { nodes, edges } = chain(12);
    nodes[0].data = { ...nodes[0].data, participantId: 'P1' };
    nodes[1].data = { ...nodes[1].data, participantId: 'P2' };
    setup({
      nodes,
      edges,
      stages: stagesOf([
        ['S1', ['N0', 'N1', 'N2'], 0],
        ['S2', ['N3', 'N4'], 500],
        ['S3', [], 1000], // 空阶段:真实文档常见(「未命名阶段」)
      ]),
    });

    useGraphStore.getState().runSmartArrange();
    const bs = boxes(useGraphStore.getState().nodes);

    expect(overlappingPairs(bs)).toEqual([]);
    for (const b of bs) {
      expect(Number.isFinite(b.x)).toBe(true);
      expect(Number.isFinite(b.y)).toBe(true);
    }
  });

  it('语义完整:节点按矩阵落位且不重叠', () => {
    const { nodes, edges } = chain(12);
    nodes.forEach((n, i) => {
      n.data = { ...n.data, participantId: PARTICIPANTS[i % 3].id };
    });
    setup({
      nodes,
      edges,
      stages: stagesOf([
        ['S1', ['N0', 'N1', 'N2', 'N3'], 0],
        ['S2', ['N4', 'N5', 'N6', 'N7'], 500],
        ['S3', ['N8', 'N9', 'N10', 'N11'], 1000],
      ]),
    });

    useGraphStore.getState().runSmartArrange();
    const bs = boxes(useGraphStore.getState().nodes);
    expect(overlappingPairs(bs)).toEqual([]);
  });

  it('stageOrder 含陈旧 id / 缺项:结果仍确定且等于正常顺序', () => {
    const mk = () => {
      const { nodes, edges } = chain(12);
      nodes.forEach((n, i) => {
        n.data = { ...n.data, participantId: PARTICIPANTS[i % 3].id };
      });
      return { nodes, edges };
    };
    const stages = stagesOf([
      ['S1', ['N0', 'N1', 'N2', 'N3'], 0],
      ['S2', ['N4', 'N5', 'N6', 'N7'], 500],
      ['S3', ['N8', 'N9', 'N10', 'N11'], 1000],
    ]);

    const a = mk();
    setup({ ...a, stages });
    useGraphStore.getState().runSmartArrange();
    const normal = useGraphStore.getState().nodes.map((n) => ({ ...n.position }));

    const b = mk();
    setup({ ...b, stages, stageOrder: ['S1', 'GHOST', 'S2'] }); // 陈旧 id + 缺 S3
    useGraphStore.getState().runSmartArrange();
    const stale = useGraphStore.getState().nodes.map((n) => ({ ...n.position }));

    expect(stale).toEqual(normal);
  });

  it('排列后节点不会被推到极远处(包围盒可控)', () => {
    const { nodes, edges } = chain(12);
    nodes[0].data = { ...nodes[0].data, participantId: 'P1' };
    setup({ nodes, edges, stages: stagesOf([['S1', ['N0'], 0]]) });

    useGraphStore.getState().runSmartArrange();
    const bs = boxes(useGraphStore.getState().nodes);
    for (const b of bs) {
      expect(Math.abs(b.x)).toBeLessThan(20000);
      expect(Math.abs(b.y)).toBeLessThan(20000);
    }
    expect(overlappingPairs(bs)).toEqual([]);
  });

  it('排列是单次历史:一次 undo 完全还原', () => {
    const { nodes, edges } = chain(6);
    nodes.forEach((n, i) => {
      n.data = { ...n.data, participantId: PARTICIPANTS[i % 3].id };
    });
    setup({
      nodes,
      edges,
      stages: stagesOf([
        ['S1', ['N0', 'N1'], 0],
        ['S2', ['N2', 'N3'], 500],
      ]),
    });
    const before = useGraphStore.getState().nodes.map((n) => ({ ...n.position }));

    useGraphStore.getState().runSmartArrange();
    expect(useGraphStore.getState().past).toHaveLength(1);
    useGraphStore.getState().undo();
    expect(useGraphStore.getState().nodes.map((n) => ({ ...n.position }))).toEqual(before);
  });

  // 回归:排列链路(structure/arrange/freePlacement)原本完全没有 locked 处理 —— 锁定语义
  // 是「不可拖动」(FlowCanvas 以 draggable=false 拦截),排列却把锁定节点搬到矩阵/拓扑位置,
  // 用户看到的排列结果「乱套」(散落的锁定节点 + 长弧线)。
  it('矩阵路径:锁定节点保持原位,其余照常排列', () => {
    const { nodes, edges } = chain(9);
    nodes.forEach((n, i) => {
      n.data = { ...n.data, participantId: PARTICIPANTS[i % 3].id };
    });
    nodes[4].data = { ...nodes[4].data, locked: true };
    const lockedPos = { ...nodes[4].position };
    setup({ nodes, edges, stages: stagesOf([['S1', ['N0', 'N1', 'N2', 'N3', 'N4'], 0]]) });

    useGraphStore.getState().runSmartArrange();
    const after = useGraphStore.getState().nodes;
    expect(after.find((n) => n.id === 'N4')!.position).toEqual(lockedPos);
    // 未锁定的同列节点仍被移动(确实排了)
    expect(after.find((n) => n.id === 'N0')!.position).not.toEqual(nodes[0].position);
  });

  it('legacy 拓扑路径(无语义轴):锁定节点保持原位', () => {
    const { nodes, edges } = chain(6);
    nodes[2].data = { ...nodes[2].data, locked: true };
    const lockedPos = { ...nodes[2].position };
    setup({ nodes, edges, stages: [] });
    // 清空语义轴 → 走 legacy 纯拓扑路径
    useGraphStore.setState({ participants: [], participantOrder: [] });

    useGraphStore.getState().runSmartArrange();
    const after = useGraphStore.getState().nodes;
    expect(after.find((n) => n.id === 'N2')!.position).toEqual(lockedPos);
    expect(after.find((n) => n.id === 'N0')!.position).not.toEqual(nodes[0].position);
  });
});
