import { beforeEach, describe, expect, it } from 'vitest';
import { useGraphStore } from '../graphStore';
import type { FlowNode, Stage, Participant, Organization } from '../../types';

/**
 * P1(Swimlane/Stage v2):v5 Persistence / Ordering
 *
 * 覆盖:
 * - serializeProject 输出 Project Format v5 且包含 participantOrder / participantOrderMode / stageOrder
 * - v5 round-trip(participants / orders / stages / membership / participantId 值一致)
 * - v4 → v5 load:stageOrder 由旧 x 排序生成;participantOrder=auto + 实体顺序;
 *   node.data.participantId 与 stage.nodeIds 不被改写
 * - future version(version > current)拒绝加载
 */

beforeEach(() => {
  useGraphStore.setState({
    nodes: [],
    edges: [],
    stages: [],
    annotations: [],
    participants: [],
    organizations: [],
    participantOrder: [],
    participantOrderMode: 'auto',
    stageOrder: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    past: [],
    future: [],
    selected: null,
    compositeTabs: [],
    activeTabId: 'main',
    loadError: null,
  });
});

const node = (id: string, participantId?: string): FlowNode => ({
  id,
  type: 'flow',
  position: { x: 0, y: 0 },
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

const stage = (id: string, x: number, nodeIds: string[] = []): Stage => ({
  id,
  name: id,
  x,
  y: 0,
  width: 100,
  height: 100,
  nodeIds,
});

const participants: Participant[] = [
  { id: 'p1', name: 'Artist', type: 'person' },
  { id: 'p2', name: 'Director', type: 'person' },
];

describe('P1 v5 order persistence', () => {
  it('serializeProject 输出 v5,包含 participantOrder/participantOrderMode/stageOrder', () => {
    useGraphStore.setState({
      nodes: [node('n1', 'p1')],
      stages: [stage('s1', 0, ['n1']), stage('s2', 200)],
      participants,
      participantOrder: ['p1', 'p2'],
      participantOrderMode: 'user',
      stageOrder: ['s2', 's1'],
    });
    const raw = useGraphStore.getState().serializeProject();
    const parsed = JSON.parse(raw) as {
      format: string;
      version: number;
      document: {
        participants: unknown[];
        participantOrder: string[];
        participantOrderMode: string;
        graph: { stageOrder: string[]; stages: unknown[]; nodes: { data: { participantId?: string } }[] };
      };
    };
    expect(parsed.format).toBe('nodeflow');
    expect(parsed.version).toBe(5);
    expect(parsed.document.participants).toHaveLength(2);
    expect(parsed.document.participantOrder).toEqual(['p1', 'p2']);
    expect(parsed.document.participantOrderMode).toBe('user');
    expect(parsed.document.graph.stageOrder).toEqual(['s2', 's1']);
    expect(parsed.document.graph.stages).toHaveLength(2);
    expect(parsed.document.graph.nodes[0].data.participantId).toBe('p1');
  });

  it('v5 round-trip:serialize → load 后 participants/order/stageOrder/membership/participantId 值一致', () => {
    useGraphStore.setState({
      nodes: [node('n1', 'p1'), node('n2')],
      stages: [stage('s1', 0, ['n1'])],
      participants,
      organizations: [{ id: 'o1', name: 'Prod' }],
      participantOrder: ['p2', 'p1'],
      participantOrderMode: 'user',
      stageOrder: ['s1'],
    });
    const raw = useGraphStore.getState().serializeProject();
    const ok = useGraphStore.getState().loadProject(raw);
    expect(ok).toBe(true);
    const s = useGraphStore.getState();
    expect(s.participants.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(s.participantOrder).toEqual(['p2', 'p1']);
    expect(s.participantOrderMode).toBe('user');
    expect(s.stageOrder).toEqual(['s1']);
    expect(s.nodes.find((n) => n.id === 'n1')?.data?.participantId).toBe('p1');
    expect(s.stages[0].nodeIds).toEqual(['n1']);
    expect(s.organizations.map((o) => o.id)).toEqual(['o1']);
  });

  it('v4 → v5 load:stageOrder 由旧 x 升序生成(稳定);participantOrder=auto;membership/participantId 不改写', () => {
    const v4 = {
      format: 'nodeflow',
      version: 4,
      exportedAt: '2026-01-01T00:00:00Z',
      document: {
        name: 'V4项目',
        color: '#fff',
        participants,
        organizations: [] as Organization[],
        graph: {
          nodes: [node('n1', 'p1')],
          edges: [],
          annotations: [],
          stages: [stage('sA', 500, ['n1']), stage('sB', 100), stage('sC', 300)],
        },
        editor: { viewport: { x: 0, y: 0, zoom: 1 }, activeTabId: 'main', compositeTabs: [] },
      },
    };
    const ok = useGraphStore.getState().loadProject(JSON.stringify(v4));
    expect(ok).toBe(true);
    const s = useGraphStore.getState();
    // Test A:stage x 升序 → [sB, sC, sA]
    expect(s.stageOrder).toEqual(['sB', 'sC', 'sA']);
    // Test C:participant 默认 auto + 实体顺序
    expect(s.participantOrder).toEqual(['p1', 'p2']);
    expect(s.participantOrderMode).toBe('auto');
    // Test D:participantId 不改写
    expect(s.nodes.find((n) => n.id === 'n1')?.data?.participantId).toBe('p1');
    // Test E:stage membership 不改写
    expect(s.stages.find((st) => st.id === 'sA')?.nodeIds).toEqual(['n1']);
    // v4 几何字段仍保留为 legacy runtime 兼容(不缺失)
    expect(typeof s.stages[0].x).toBe('number');
  });

  it('future version rejection:v6 拒绝加载', () => {
    const v6 = { format: 'nodeflow', version: 6, document: {} };
    const ok = useGraphStore.getState().loadProject(JSON.stringify(v6));
    expect(ok).toBe(false);
    expect(useGraphStore.getState().loadError).toContain('升级 NodeFlow');
  });
});
