import { beforeEach, describe, expect, it } from 'vitest';
import { useGraphStore } from '../graphStore';
import type { FlowNode, Participant, Stage } from '../../types';

/**
 * P3(Swimlane/Stage v2):Unified Arrange — graphStore 集成
 *
 * 覆盖:runArrange 真排列(矩阵)/ 原子历史 / undo/redo 几何+pending /
 * invariants(不改 semantic / stage 几何 / edge)/ arrange 后再 serialize-reload /
 * multi-document 隔离 / 已排列重复 arrange 仅消费 pending。
 */

const node = (id: string, participantId?: string, x = 0, y = 0): FlowNode => ({
  id,
  type: 'flow',
  position: { x, y },
  data: {
    label: id,
    description: '',
    actor: 'machine',
    locked: false,
    inputs: [],
    outputs: [],
    ...(participantId ? { participantId } : {}),
  },
});

const stage = (id: string, nodeIds: string[] = []): Stage => ({
  id,
  name: id,
  x: 50,
  y: 50,
  width: 300,
  height: 200,
  nodeIds,
});

const participants: Participant[] = [
  { id: 'p1', name: 'Alpha', type: 'person' },
  { id: 'p2', name: 'Beta', type: 'person' },
  { id: 'p3', name: 'Gamma', type: 'person' },
];

// 与 matrix 常量一致的默认节点尺寸 240×150
const X_COL0 = 80 + 24;
const Y_ROW0 = 80;
const Y_ROW1 = 80 + 150 + 80;

function resetStore() {
  useGraphStore.setState({
    documents: [],
    activeDocumentId: '',
    nodes: [],
    edges: [],
    stages: [],
    annotations: [],
    participants: [],
    organizations: [],
    participantOrder: [],
    participantOrderMode: 'auto',
    stageOrder: [],
    arrangePending: false,
    viewport: { x: 0, y: 0, zoom: 1 },
    past: [],
    future: [],
    selected: null,
    compositeTabs: [],
    activeTabId: 'main',
    loadError: null,
  });
}

beforeEach(resetStore);

function setupScene() {
  useGraphStore.setState({
    participants,
    participantOrder: ['p1', 'p2', 'p3'],
    participantOrderMode: 'auto',
    arrangePending: false,
    stages: [stage('s1', ['n1']), stage('s2', ['n2', 'n3'])],
    stageOrder: ['s1', 's2'],
    nodes: [
      node('n1', 'p1', 0, 0),
      node('n2', 'p2', 500, 0),
      node('n3', 'p2', 500, 400), // n2/n3 同 (p2,s2) cell
      node('nx', undefined, 900, 900), // unassigned participant + unassigned stage
    ],
    edges: [{ id: 'e1', source: 'n1', target: 'n2', type: 'flow', data: { label: '', artifact: null } }],
  });
}

describe('P3 runArrange 集成', () => {
  it('矩阵排列:Participant→Y、Stage→X、unassigned 尾随;消费 pending;单次 history', () => {
    setupScene();
    useGraphStore.setState({ arrangePending: true });
    const pastLen = useGraphStore.getState().past.length;
    useGraphStore.getState().runArrange();

    const s = useGraphStore.getState();
    expect(s.arrangePending).toBe(false);
    expect(s.past.length).toBe(pastLen + 1); // 单原子历史
    const pos = (id: string) => s.nodes.find((n) => n.id === id)!.position;
    // Y 行:p1 < p2 < unassigned
    expect(pos('n1').y).toBe(Y_ROW0);
    expect(pos('n2').y).toBe(Y_ROW1);
    expect(pos('n3').y).toBeGreaterThan(pos('n2').y); // 同 cell 堆叠
    expect(pos('nx').y).toBeGreaterThan(pos('n3').y); // unassigned 行在最后
    // X 列:s1 < s2 < unassigned(同 cell 的 n2/n3 x 相等)
    expect(pos('n1').x).toBe(X_COL0);
    expect(pos('n2').x).toBe(pos('n3').x);
    expect(pos('n2').x).toBeGreaterThan(pos('n1').x);
    expect(pos('nx').x).toBeGreaterThan(pos('n2').x);
    // 非重叠:s1(s2 cell) 堆叠
    expect(pos('n3').y - pos('n2').y).toBeGreaterThanOrEqual(150);
  });

  it('invariants:runArrange 不改 semantic / stage 几何 / edge / entity', () => {
    setupScene();
    useGraphStore.setState({ arrangePending: true });
    const before = {
      orders: JSON.stringify(useGraphStore.getState().participantOrder),
      mode: useGraphStore.getState().participantOrderMode,
      stageOrder: JSON.stringify(useGraphStore.getState().stageOrder),
      stageNodeIds: JSON.stringify(useGraphStore.getState().stages.map((st) => st.nodeIds)),
      participants: JSON.stringify(useGraphStore.getState().participants),
      edges: JSON.stringify(useGraphStore.getState().edges),
      stageGeom: JSON.stringify(useGraphStore.getState().stages.map((st) => [st.x, st.y, st.width, st.height])),
      pid: JSON.stringify(useGraphStore.getState().nodes.map((n) => n.data?.participantId)),
    };
    useGraphStore.getState().runArrange();
    const s = useGraphStore.getState();
    expect(JSON.stringify(s.participantOrder)).toBe(before.orders);
    expect(s.participantOrderMode).toBe(before.mode);
    expect(JSON.stringify(s.stageOrder)).toBe(before.stageOrder);
    expect(JSON.stringify(s.stages.map((st) => st.nodeIds))).toBe(before.stageNodeIds);
    expect(JSON.stringify(s.participants)).toBe(before.participants);
    expect(JSON.stringify(s.edges)).toBe(before.edges); // edge source/target/data 不变
    expect(JSON.stringify(s.stages.map((st) => [st.x, st.y, st.width, st.height]))).toBe(before.stageGeom);
    expect(JSON.stringify(s.nodes.map((n) => n.data?.participantId))).toBe(before.pid);
  });

  it('undo/redo:Arrange 几何 + pending 原子恢复;semantic 始终不变', () => {
    setupScene();
    const st = useGraphStore.getState();
    st.reorderParticipant(2, 0); // order:[p3,p1,p2] → pending true
    const orderAfterReorder = JSON.stringify(useGraphStore.getState().participantOrder);
    const beforePos = JSON.stringify(useGraphStore.getState().nodes.map((n) => n.position));

    useGraphStore.getState().runArrange();
    let s = useGraphStore.getState();
    expect(s.arrangePending).toBe(false);
    const arrangedPos = JSON.stringify(s.nodes.map((n) => n.position));
    expect(arrangedPos).not.toBe(beforePos);

    useGraphStore.getState().undo();
    s = useGraphStore.getState();
    expect(s.arrangePending).toBe(true); // undo → pending true
    expect(JSON.stringify(s.nodes.map((n) => n.position))).toBe(beforePos); // 几何 P0
    expect(JSON.stringify(s.participantOrder)).toBe(orderAfterReorder); // semantic 不变

    useGraphStore.getState().redo();
    s = useGraphStore.getState();
    expect(s.arrangePending).toBe(false);
    expect(JSON.stringify(s.nodes.map((n) => n.position))).toBe(arrangedPos);
  });

  it('已处于 Arrange 目标位时再次 runArrange:仅消费 pending,不产生 history', () => {
    setupScene();
    useGraphStore.setState({ arrangePending: true });
    const st = useGraphStore.getState();
    st.runArrange();
    const pastLen = useGraphStore.getState().past.length;
    useGraphStore.setState({ arrangePending: true }); // 再次标记 pending(位置已在目标)
    useGraphStore.getState().runArrange();
    const s = useGraphStore.getState();
    expect(s.arrangePending).toBe(false);
    expect(s.past.length).toBe(pastLen); // 无几何变化 → 无新历史
  });

  it('arrange → serialize → reload:positions 与 pending=false 保持一致', () => {
    setupScene();
    useGraphStore.setState({ arrangePending: true });
    const st = useGraphStore.getState();
    st.runArrange();
    const raw = useGraphStore.getState().serializeProject();

    resetStore();
    const ok = useGraphStore.getState().loadProject(raw);
    expect(ok).toBe(true);
    const s = useGraphStore.getState();
    expect(s.arrangePending).toBe(false);
    expect(s.nodes.find((n) => n.id === 'n1')?.position).toEqual({ x: X_COL0, y: Y_ROW0 });
    expect(s.nodes.find((n) => n.id === 'n2')?.position.y).toBe(Y_ROW1);
  });

  it('multi-document:A arrange 后切 B 再切回 A,几何/order/pending 保留;B 独立', () => {
    const store = useGraphStore;
    const docA = store.getState().createDocument('A');
    useGraphStore.setState({
      participants,
      participantOrder: ['p1', 'p2', 'p3'],
      participantOrderMode: 'auto',
      arrangePending: false,
      stages: [stage('s1', ['n1'])],
      stageOrder: ['s1'],
      nodes: [node('n1', 'p1', 0, 0)],
    });
    useGraphStore.getState().reorderParticipant(2, 0);
    useGraphStore.getState().runArrange();
    const aPos = useGraphStore.getState().nodes.find((n) => n.id === 'n1')!.position;

    const docB = store.getState().createDocument('B');
    expect(useGraphStore.getState().arrangePending).toBe(false);
    expect(useGraphStore.getState().nodes).toEqual([]);

    store.getState().switchDocument(docA);
    let s = useGraphStore.getState();
    expect(s.nodes.find((n) => n.id === 'n1')?.position).toEqual(aPos);
    expect(s.arrangePending).toBe(false);
    expect(s.participantOrder).toEqual(['p3', 'p1', 'p2']);

    store.getState().switchDocument(docB);
    s = useGraphStore.getState();
    expect(s.nodes).toEqual([]);
    expect(s.arrangePending).toBe(false);
    expect(s.participantOrder).toEqual([]);
  });
});
