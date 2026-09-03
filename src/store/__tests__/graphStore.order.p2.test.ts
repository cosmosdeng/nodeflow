import { beforeEach, describe, expect, it } from 'vitest';
import { useGraphStore } from '../graphStore';
import type { FlowNode, Stage, Participant } from '../../types';

/**
 * P2(Swimlane/Stage v2):Order + Arrange Pending
 *
 * 覆盖:
 * - reorderParticipant / reorderStage 及其 invariants
 * - Participant Auto → User 转换
 * - Arrange Pending 状态 / no-op / 消费(runArrange 占位)
 * - Order change 不改 node.position / membership(participantId / stage.nodeIds)
 * - Undo / Redo(order + mode + pending 原子恢复)
 * - Persistence(arrangePending 与 order 保存/加载)
 * - Multi-document 切换后 order / pending 保留
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

const stage = (id: string, nodeIds: string[] = [], x = 0): Stage => ({
  id,
  name: id,
  x,
  y: 0,
  width: 100,
  height: 100,
  nodeIds,
});

const participants: Participant[] = [
  { id: 'p1', name: 'A', type: 'person' },
  { id: 'p2', name: 'B', type: 'person' },
  { id: 'p3', name: 'C', type: 'person' },
];

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

const setupParticipantState = () => {
  const st = useGraphStore.setState;
  st({
    participants,
    participantOrder: ['p1', 'p2', 'p3'],
    participantOrderMode: 'auto',
    arrangePending: false,
    nodes: [node('n1', 'p1'), node('n2', 'p2')],
  });
};

const setupStageState = () => {
  useGraphStore.setState({
    stages: [stage('s1', ['n1']), stage('s2'), stage('s3')],
    stageOrder: ['s1', 's2', 's3'],
    arrangePending: false,
    nodes: [node('n1', undefined, 0, 0), node('n2', undefined, 50, 50)],
  });
};

describe('P2 Participant reorder', () => {
  it('reorder 更新 order,不重复/不丢失;entity 不变;节点 position 不变', () => {
    setupParticipantState();
    const nodesBefore = JSON.stringify(useGraphStore.getState().nodes);
    useGraphStore.getState().reorderParticipant(2, 0); // C → first
    const s = useGraphStore.getState();
    expect(s.participantOrder).toEqual(['p3', 'p1', 'p2']);
    expect(new Set(s.participantOrder).size).toBe(3); // no duplicate
    expect(s.participants).toEqual(participants); // entity unchanged
    expect(JSON.stringify(s.nodes)).toBe(nodesBefore); // node positions unchanged
    expect(s.nodes.find((n) => n.id === 'n1')?.data?.participantId).toBe('p1'); // membership unchanged
  });

  it('首次手动 reorder:Auto → User + arrangePending=true', () => {
    setupParticipantState();
    useGraphStore.getState().reorderParticipant(1, 0);
    const s = useGraphStore.getState();
    expect(s.participantOrderMode).toBe('user');
    expect(s.arrangePending).toBe(true);
  });

  it('后续 reorder 保持 user + pending 恒 true(不产生多个 pending event)', () => {
    setupParticipantState();
    const st = useGraphStore.getState();
    st.reorderParticipant(1, 0); // [p2,p1,p3]
    st.reorderParticipant(0, 2); // p2 → 末尾:[p1,p3,p2]
    const s = useGraphStore.getState();
    expect(s.participantOrderMode).toBe('user');
    expect(s.arrangePending).toBe(true);
    expect(s.participantOrder).toEqual(['p1', 'p3', 'p2']);
  });

  it('same index / invalid index 为 no-op:不改数据/不改 pending/不产生 history', () => {
    setupParticipantState();
    const st = useGraphStore.getState();
    const pastLen = st.past.length;
    st.reorderParticipant(1, 1);
    st.reorderParticipant(-1, 2);
    st.reorderParticipant(0, 99);
    const s = useGraphStore.getState();
    expect(s.participantOrder).toEqual(['p1', 'p2', 'p3']);
    expect(s.participantOrderMode).toBe('auto');
    expect(s.arrangePending).toBe(false);
    expect(s.past.length).toBe(pastLen); // 无 history entry
  });
});

describe('P2 Stage reorder', () => {
  it('reorder 更新 stageOrder;entity/nodeIds/position 不变;pending=true', () => {
    setupStageState();
    const stagesBefore = JSON.stringify(useGraphStore.getState().stages);
    const nodesBefore = JSON.stringify(useGraphStore.getState().nodes);
    useGraphStore.getState().reorderStage(2, 0);
    const s = useGraphStore.getState();
    expect(s.stageOrder).toEqual(['s3', 's1', 's2']);
    expect(new Set(s.stageOrder).size).toBe(3);
    expect(JSON.stringify(s.stages)).toBe(stagesBefore);
    expect(JSON.stringify(s.nodes)).toBe(nodesBefore);
    expect(s.stages.find((sg) => sg.id === 's1')?.nodeIds).toEqual(['n1']); // membership unchanged
    expect(s.arrangePending).toBe(true);
  });

  it('same index / invalid index 为 no-op', () => {
    setupStageState();
    const st = useGraphStore.getState();
    const pastLen = st.past.length;
    st.reorderStage(1, 1);
    st.reorderStage(-5, 0);
    st.reorderStage(0, 30);
    const s = useGraphStore.getState();
    expect(s.stageOrder).toEqual(['s1', 's2', 's3']);
    expect(s.arrangePending).toBe(false);
    expect(s.past.length).toBe(pastLen);
  });
});

describe('P2 Arrange Pending history(undo/redo)', () => {
  it('participant reorder → undo 恢复 order/mode/pending → redo 恢复', () => {
    setupParticipantState();
    const st = useGraphStore.getState();
    st.reorderParticipant(2, 0);
    expect(useGraphStore.getState().arrangePending).toBe(true);

    useGraphStore.getState().undo();
    let s = useGraphStore.getState();
    expect(s.participantOrder).toEqual(['p1', 'p2', 'p3']);
    expect(s.participantOrderMode).toBe('auto');
    expect(s.arrangePending).toBe(false);

    useGraphStore.getState().redo();
    s = useGraphStore.getState();
    expect(s.participantOrder).toEqual(['p3', 'p1', 'p2']);
    expect(s.participantOrderMode).toBe('user');
    expect(s.arrangePending).toBe(true);
  });

  it('stage reorder → undo/redo 恢复 stageOrder + pending', () => {
    setupStageState();
    useGraphStore.getState().reorderStage(0, 2);
    expect(useGraphStore.getState().arrangePending).toBe(true);

    useGraphStore.getState().undo();
    let s = useGraphStore.getState();
    expect(s.stageOrder).toEqual(['s1', 's2', 's3']);
    expect(s.arrangePending).toBe(false);

    useGraphStore.getState().redo();
    s = useGraphStore.getState();
    expect(s.stageOrder).toEqual(['s2', 's3', 's1']);
    expect(s.arrangePending).toBe(true);
  });

  it('runArrange 消费 pending(false),不改 position;undo 可回退 pending', () => {
    setupParticipantState();
    const st = useGraphStore.getState();
    st.reorderParticipant(1, 0);
    const nodesBefore = JSON.stringify(useGraphStore.getState().nodes);
    useGraphStore.getState().runArrange();
    let s = useGraphStore.getState();
    expect(s.arrangePending).toBe(false);
    expect(JSON.stringify(s.nodes)).toBe(nodesBefore); // 占位:不改几何

    useGraphStore.getState().undo();
    s = useGraphStore.getState();
    expect(s.arrangePending).toBe(true); // undo 回到 pending
    expect(s.participantOrder).toEqual(['p2', 'p1', 'p3']);

    useGraphStore.getState().redo();
    expect(useGraphStore.getState().arrangePending).toBe(false);
  });

  it('pending=false 时 runArrange 为 no-op(不产生 history)', () => {
    setupParticipantState();
    const pastLen = useGraphStore.getState().past.length;
    useGraphStore.getState().runArrange();
    expect(useGraphStore.getState().past.length).toBe(pastLen);
    expect(useGraphStore.getState().arrangePending).toBe(false);
  });
});

describe('P2 Persistence', () => {
  it('serialize → load 保留 participantOrder/mode + arrangePending', () => {
    useGraphStore.setState({
      participants,
      participantOrder: ['p3', 'p1', 'p2'],
      participantOrderMode: 'user',
      stageOrder: [],
      arrangePending: true,
      stages: [stage('s1')],
    });
    const raw = useGraphStore.getState().serializeProject();
    const ok = useGraphStore.getState().loadProject(raw);
    expect(ok).toBe(true);
    const s = useGraphStore.getState();
    expect(s.participantOrder).toEqual(['p3', 'p1', 'p2']);
    expect(s.participantOrderMode).toBe('user');
    expect(s.arrangePending).toBe(true);
  });

  it('无 arrangePending 字段的 v5 数据加载后默认 false', () => {
    const v5NoPending = {
      format: 'nodeflow',
      version: 5,
      document: {
        name: 'P',
        color: '#fff',
        participants,
        organizations: [],
        graph: { nodes: [], edges: [], annotations: [], stages: [], stageOrder: [] },
        editor: { viewport: { x: 0, y: 0, zoom: 1 }, activeTabId: 'main', compositeTabs: [] },
      },
    };
    const ok = useGraphStore.getState().loadProject(JSON.stringify(v5NoPending));
    expect(ok).toBe(true);
    expect(useGraphStore.getState().arrangePending).toBe(false);
    expect(useGraphStore.getState().participantOrder).toEqual(['p1', 'p2', 'p3']);
  });
});

describe('P2 Multi-document', () => {
  it('doc A reorder 后切换到 B 再切回 A:order/pending 保留;B 为独立干净状态', () => {
    const store = useGraphStore;
    const docA = store.getState().createDocument('A');
    useGraphStore.setState({
      participants,
      participantOrder: ['p1', 'p2', 'p3'],
      participantOrderMode: 'auto',
      arrangePending: false,
    });
    useGraphStore.getState().reorderParticipant(2, 0); // A:pending true,user
    expect(useGraphStore.getState().arrangePending).toBe(true);

    const docB = store.getState().createDocument('B');
    // B 是全新文档:无 order / pending=false
    expect(useGraphStore.getState().arrangePending).toBe(false);
    expect(useGraphStore.getState().participantOrder).toEqual([]);

    store.getState().switchDocument(docA);
    const s = useGraphStore.getState();
    expect(s.arrangePending).toBe(true);
    expect(s.participantOrder).toEqual(['p3', 'p1', 'p2']);
    expect(s.participantOrderMode).toBe('user');

    // 回 B 仍干净
    store.getState().switchDocument(docB);
    expect(useGraphStore.getState().arrangePending).toBe(false);
    expect(useGraphStore.getState().participantOrder).toEqual([]);
  });
});
