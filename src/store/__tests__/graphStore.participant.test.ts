import { beforeEach, describe, expect, it } from 'vitest';
import { useGraphStore } from '../graphStore';
import type { FlowNode, FlowEdge, Participant, Stage } from '../../types';

/**
 * F1-02 Participant & Swimlane 行为 Invariants
 *
 * 验证(基于 F1-01 v3 冻结):
 * - Assign 只改 participantId,不改 position
 * - Assign 是 atomic undo
 * - Manual drag 不改 participantId
 * - Arrange 只改 position,不改 participantId / stage membership
 * - Arrange 不改 edge semantics
 * - Arrange 是 atomic undo
 * - Arrange 不触发 autoGrowStage / 不改 stage bounds
 * - Composite 不自动继承 participant
 * - Gateway participant 保留
 */

beforeEach(() => {
  useGraphStore.setState({
    nodes: [],
    edges: [],
    stages: [],
    annotations: [],
    participants: [],
    organizations: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    past: [],
    future: [],
    selected: null,
    compositeTabs: [],
    activeTabId: 'main',
    swimlaneEnabled: false,
    swimlaneOrder: [],
  });
});

function node(id: string, x: number, y: number, data?: Partial<FlowNode['data']>): FlowNode {
  return {
    id,
    type: 'flow',
    position: { x, y },
    width: 100,
    height: 50,
    data: { label: id, description: '', actor: 'human', locked: false, inputs: [], outputs: [], ...data },
  } as FlowNode;
}

function edge(id: string, source: string, target: string, label = ''): FlowEdge {
  return { id, source, target, type: 'flow', data: { label, artifact: null } } as FlowEdge;
}

describe('F1-02 Participant & Swimlane 行为', () => {
  it('Assign:改 participantId,不改 position;atomic undo', () => {
    const s = useGraphStore.getState();
    const pid = s.addParticipant('Artist', 'person');
    useGraphStore.setState({ nodes: [node('A', 10, 20)] });
    s.assignParticipant('A', pid);
    let st = useGraphStore.getState();
    expect(st.nodes[0].data.participantId).toBe(pid);
    expect(st.nodes[0].position).toEqual({ x: 10, y: 20 }); // position 不变
    // atomic undo
    st.undo();
    st = useGraphStore.getState();
    expect(st.nodes[0].data.participantId).toBeUndefined();
  });

  it('Delete Participant:safe detach(节点 participantId 清空,不删节点)', () => {
    const s = useGraphStore.getState();
    const pid = s.addParticipant('Artist', 'person');
    useGraphStore.setState({ nodes: [node('A', 0, 0, { participantId: pid })] });
    s.deleteParticipant(pid);
    const st = useGraphStore.getState();
    expect(st.nodes).toHaveLength(1); // 节点保留
    expect(st.nodes[0].data.participantId).toBeUndefined(); // participantId 清空
    expect(st.participants).toHaveLength(0);
  });

  it('Manual node drag(onNodesChange position)不改 participantId', () => {
    const s = useGraphStore.getState();
    const pid = s.addParticipant('Artist', 'person');
    useGraphStore.setState({ nodes: [node('A', 10, 10, { participantId: pid })] });
    s.onNodesChange([{ type: 'position', id: 'A', position: { x: 99, y: 99 } }]);
    const st = useGraphStore.getState();
    expect(st.nodes[0].position).toEqual({ x: 99, y: 99 }); // position 变
    expect(st.nodes[0].data.participantId).toBe(pid); // participantId 不变
  });

  it('Arrange:改 position,不改 participantId / stage membership / edge semantics;atomic undo', () => {
    const s = useGraphStore.getState();
    const pid1 = s.addParticipant('Artist', 'person');
    const pid2 = s.addParticipant('AI', 'ai-agent');
    useGraphStore.setState({
      nodes: [node('A', 0, 0, { participantId: pid1 }), node('B', 200, 0, { participantId: pid2 })],
      edges: [edge('e1', 'A', 'B', '说明')],
    });
    const before = useGraphStore.getState().nodes.map((n) => ({ ...n.position }));
    s.arrangeAllSwimlanes();
    let st = useGraphStore.getState();
    // position 改变(至少一个)
    const moved = st.nodes.some((n, i) => n.position.x !== before[i].x || n.position.y !== before[i].y);
    expect(moved).toBe(true);
    // participantId 不变
    expect(st.nodes[0].data.participantId).toBe(pid1);
    expect(st.nodes[1].data.participantId).toBe(pid2);
    // edge semantics 不变
    const edge0 = st.edges[0] as FlowEdge | undefined;
    expect(edge0).toMatchObject({ id: 'e1', source: 'A', target: 'B' });
    expect(edge0?.data?.label).toBe('说明');
    // atomic undo:全部恢复
    st.undo();
    st = useGraphStore.getState();
    expect(st.nodes[0].position).toEqual(before[0]);
    expect(st.nodes[1].position).toEqual(before[1]);
  });

  it('Arrange:不改 stage membership / stage bounds', () => {
    const s = useGraphStore.getState();
    const pid = s.addParticipant('Artist', 'person');
    useGraphStore.setState({ nodes: [node('A', 100, 100, { participantId: pid })] });
    const stage: Stage = { id: 's1', name: '域', x: 0, y: 0, width: 400, height: 200, nodeIds: ['A'] };
    useGraphStore.setState({ stages: [stage] });
    const stageBefore = { ...useGraphStore.getState().stages[0]! };
    s.arrangeAllSwimlanes();
    const st = useGraphStore.getState();
    expect(st.stages[0]!.nodeIds).toEqual(['A']); // membership 不变
    expect(st.stages[0]!.x).toBe(stageBefore.x); // stage bounds 不变(不 autoGrow)
    expect(st.stages[0]!.width).toBe(stageBefore.width);
  });

  it('Composite:不自动继承 participant 到 children', () => {
    const s = useGraphStore.getState();
    const pid = s.addParticipant('Dept', 'department');
    const childA = node('childA', 0, 0);
    useGraphStore.setState({ nodes: [childA] });
    // 给 childA 分配 participant(语义独立)
    s.assignParticipant('childA', pid);
    const st = useGraphStore.getState();
    expect(st.nodes[0].data.participantId).toBe(pid);
    // 组合节点自身分配 participant,不自动下推 children(children 无 composite 场景,验证独立引用)
    expect(st.nodes[0].data.participantId).toBe(pid);
  });

  it('Gateway:participant assignment 保留,不改 gateway 语义', () => {
    const s = useGraphStore.getState();
    const pid = s.addParticipant('Producer', 'role');
    const gw = node('G1', 0, 0, { gateway: { type: 'exclusive' } });
    useGraphStore.setState({ nodes: [gw] });
    s.assignParticipant('G1', pid);
    let st = useGraphStore.getState();
    expect(st.nodes[0].data.participantId).toBe(pid);
    expect(st.nodes[0].data.gateway?.type).toBe('exclusive'); // gateway 语义不变
    s.arrangeAllSwimlanes();
    st = useGraphStore.getState();
    expect(st.nodes[0].data.gateway?.type).toBe('exclusive');
  });
});

function stage(id: string, name = id, nodeIds: string[] = []): Stage {
  return { id, name, x: 0, y: 0, width: 300, height: 200, nodeIds };
}

describe('F1-03 节点所属阶段(assignNodeStage)', () => {
  it('Assign:只改 stage membership,不改 position;单归属(换阶段即移出旧阶段);undo 还原', () => {
    const s = useGraphStore.getState();
    useGraphStore.setState({
      nodes: [node('A', 10, 20)],
      stages: [stage('s1'), stage('s2')],
    });
    s.assignNodeStage('A', 's1');
    let st = useGraphStore.getState();
    expect(st.stages.find((x) => x.id === 's1')!.nodeIds).toEqual(['A']);
    expect(st.stages.find((x) => x.id === 's2')!.nodeIds).toEqual([]);
    expect(st.nodes[0].position).toEqual({ x: 10, y: 20 }); // position 不变
    // 换到 s2 → 自动从 s1 移出(单归属)
    s.assignNodeStage('A', 's2');
    st = useGraphStore.getState();
    expect(st.stages.find((x) => x.id === 's1')!.nodeIds).toEqual([]);
    expect(st.stages.find((x) => x.id === 's2')!.nodeIds).toEqual(['A']);
    // atomic undo:回到「A 在 s1」
    st.undo();
    st = useGraphStore.getState();
    expect(st.stages.find((x) => x.id === 's1')!.nodeIds).toEqual(['A']);
    expect(st.stages.find((x) => x.id === 's2')!.nodeIds).toEqual([]);
    // 脱离(null)→ 从所有阶段移除
    st.assignNodeStage('A', null);
    st = useGraphStore.getState();
    expect(st.stages.every((x) => !x.nodeIds.includes('A'))).toBe(true);
    expect(st.nodes).toHaveLength(1);
  });
});

describe('runSmartArrange(语义轴存在 → unified matrix core,与 band visibility 无关)', () => {
  it('participants+stages 存在但两带隐藏时,仍走矩阵核心(X=Stage order、Y=Participant order)', () => {
    const mkP = (id: string, name = id): Participant => ({ id, name, type: 'person' });
    useGraphStore.setState({
      participants: [mkP('p1'), mkP('p2')],
      participantOrder: ['p1', 'p2'],
      stages: [stage('s1', 's1', ['A', 'B']), stage('s2', 's2', ['C'])],
      stageOrder: ['s1', 's2'],
      nodes: [
        node('A', 700, 300, { participantId: 'p1' }),
        node('B', 120, 40, { participantId: 'p1' }),
        node('C', 500, 260, { participantId: 'p2' }),
      ],
      edges: [edge('e1', 'A', 'B'), edge('e2', 'B', 'C')],
      showStageBands: false,
      showParticipantBands: false,
      past: [],
      future: [],
    });
    const before = new Map(useGraphStore.getState().nodes.map((n) => [n.id, { ...n.position }]));
    useGraphStore.getState().runSmartArrange();
    const st = useGraphStore.getState();
    // 确实发生了位置变化,而不是 no-op
    const anyMoved = st.nodes.some((n) => {
      const p = before.get(n.id)!;
      return p.x !== n.position.x || p.y !== n.position.y;
    });
    expect(anyMoved).toBe(true);
    const p = (id: string) => st.nodes.find((n) => n.id === id)!.position;
    // Phase 5B:语义轴存在(即便带隐藏)→ 统一矩阵核心
    // A、B 同 (p1, s1) cell,但有依赖 A→B → 列内按拓扑层:源 A 在左、目标 B 在右
    expect(p('A').x).toBeLessThan(p('B').x);
    expect(p('B').x).toBeLessThan(p('C').x); // Stage s2(C) 在右
    // Y=Participant order:同一行带内拉平;p2(C) 行在 p1 行下方
    expect(p('B').y).toBe(p('A').y);
    expect(p('C').y).toBeGreaterThan(p('A').y);
  });
});
