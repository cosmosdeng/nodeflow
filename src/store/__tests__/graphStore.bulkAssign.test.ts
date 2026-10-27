import { describe, expect, it, beforeEach, vi } from 'vitest';
import type { FlowNode, Stage } from '../../types';

// mock localStorage(Node 环境无 localStorage)
const storage = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => storage.set(k, v),
  removeItem: (k: string) => storage.delete(k),
  clear: () => storage.clear(),
  key: (i: number) => [...storage.keys()][i] ?? null,
  get length() {
    return storage.size;
  },
});

import { useGraphStore } from '../graphStore';

function makeNode(id: string, participantId?: string): FlowNode {
  return {
    id,
    type: 'flow',
    position: { x: 0, y: 0 },
    data: { label: id, actor: 'machine', locked: false, inputs: [], outputs: [], participantId },
  } as unknown as FlowNode;
}

function makeStage(id: string, nodeIds: string[]): Stage {
  return { id, name: id, x: 0, y: 0, width: 400, height: 300, nodeIds };
}

/** 基线:A 已在 S1 且归属 P1;B/C 干净。两个参与方、两个阶段。 */
function seed(): void {
  useGraphStore.setState({
    nodes: [makeNode('A', 'P1'), makeNode('B'), makeNode('C')],
    edges: [],
    stages: [makeStage('S1', ['A']), makeStage('S2', [])],
    stageOrder: ['S1', 'S2'],
    participants: [
      { id: 'P1', name: 'P1', type: 'person' },
      { id: 'P2', name: 'P2', type: 'machine' },
    ],
    participantOrder: ['P1', 'P2'],
    past: [],
    future: [],
    allLocked: false,
  });
}

const pidOf = (id: string) => useGraphStore.getState().nodes.find((n) => n.id === id)!.data.participantId;
const stageIdsOf = (sid: string) => useGraphStore.getState().stages.find((s) => s.id === sid)?.nodeIds ?? [];
const pastLen = () => useGraphStore.getState().past.length;
const act = () => useGraphStore.getState();

describe('assignParticipantToMany(批量归属参与方)', () => {
  beforeEach(() => seed());

  it('把选中的多个节点统一归属到同一参与方', () => {
    act().assignParticipantToMany(['A', 'B'], 'P2');
    expect(pidOf('A')).toBe('P2');
    expect(pidOf('B')).toBe('P2');
    expect(pidOf('C')).toBeUndefined(); // 未选中不受影响
  });

  it('整批只记一次历史:撤销一步全部还原', () => {
    act().assignParticipantToMany(['A', 'B'], 'P2');
    expect(pastLen()).toBe(1);
    act().undo();
    expect(pidOf('A')).toBe('P1');
    expect(pidOf('B')).toBeUndefined();
  });

  it('participantId 为 null 时清空批量归属', () => {
    act().assignParticipantToMany(['A', 'B'], null);
    expect(pidOf('A')).toBeUndefined();
    expect(pidOf('B')).toBeUndefined();
  });

  it('不存在的参与方:不改动、不记历史', () => {
    act().assignParticipantToMany(['A', 'B'], 'NOPE');
    expect(pidOf('A')).toBe('P1');
    expect(pastLen()).toBe(0);
  });

  it('空列表 / 演示锁定:静默返回', () => {
    act().assignParticipantToMany([], 'P2');
    expect(pastLen()).toBe(0);
    useGraphStore.setState({ allLocked: true });
    act().assignParticipantToMany(['B'], 'P2');
    expect(pidOf('B')).toBeUndefined();
    expect(pastLen()).toBe(0);
  });

  it('幂等:重复归属同一参与方不产生多余变更', () => {
    act().assignParticipantToMany(['A'], 'P1');
    expect(pidOf('A')).toBe('P1');
    expect(stageIdsOf('S1')).toEqual(['A']); // 阶段归属不受影响
  });

  it('幂等短路:目标状态与现状一致时不写空历史', () => {
    act().assignParticipantToMany(['A'], 'P1'); // A 已是 P1
    expect(pastLen()).toBe(0);
  });

  it('批量取消归属:清空并只记一次历史,撤销可还原', () => {
    act().assignParticipantToMany(['A', 'B'], null);
    expect(pidOf('A')).toBeUndefined();
    expect(pidOf('B')).toBeUndefined();
    expect(pastLen()).toBe(1);
    act().undo();
    expect(pidOf('A')).toBe('P1');
  });

  it('全部未归属时批量取消:不写历史', () => {
    act().assignParticipantToMany(['B', 'C'], null);
    expect(pastLen()).toBe(0);
  });

  it('先归属再取消:两条历史,逐次撤销分别还原', () => {
    act().assignParticipantToMany(['B'], 'P2');
    act().assignParticipantToMany(['B'], null);
    expect(pastLen()).toBe(2);
    act().undo();
    expect(pidOf('B')).toBe('P2'); // 回到「已归属」
    act().undo();
    expect(pidOf('B')).toBeUndefined(); // 回到「未归属」
  });
});

describe('assignStageToMany(批量归属阶段)', () => {
  beforeEach(() => seed());

  it('把选中的多个节点加入同一阶段,并从原阶段移出(单归属)', () => {
    act().assignStageToMany(['A', 'B'], 'S2');
    expect(stageIdsOf('S1')).toEqual([]); // A 已移出
    expect(stageIdsOf('S2')).toEqual(['A', 'B']);
  });

  it('整批只记一次历史:撤销一步全部还原', () => {
    act().assignStageToMany(['A', 'B'], 'S2');
    expect(pastLen()).toBe(1);
    act().undo();
    expect(stageIdsOf('S1')).toEqual(['A']);
    expect(stageIdsOf('S2')).toEqual([]);
  });

  it('stageId 为 null:批量脱离所有阶段', () => {
    act().assignStageToMany(['A', 'B'], null);
    expect(stageIdsOf('S1')).toEqual([]);
    expect(stageIdsOf('S2')).toEqual([]);
  });

  it('不存在的阶段:不改动、不记历史', () => {
    act().assignStageToMany(['A'], 'NOPE');
    expect(stageIdsOf('S1')).toEqual(['A']);
    expect(pastLen()).toBe(0);
  });

  it('重复 id 去重后不会重复入列', () => {
    act().assignStageToMany(['A', 'A', 'B'], 'S2');
    expect(stageIdsOf('S2')).toEqual(['A', 'B']);
  });

  it('批量脱离阶段:单次历史,撤销可还原', () => {
    act().assignStageToMany(['A', 'B'], null);
    expect(stageIdsOf('S1')).toEqual([]);
    expect(pastLen()).toBe(1);
    act().undo();
    expect(stageIdsOf('S1')).toEqual(['A']);
  });

  it('幂等短路:全部已在目标阶段 / 全部不在任何阶段时不写历史', () => {
    act().assignStageToMany(['A'], 'S1'); // A 已在 S1
    expect(pastLen()).toBe(0);
    act().assignStageToMany(['B'], null); // B 不在任何阶段
    expect(pastLen()).toBe(0);
  });

  it('空列表 / 演示锁定:静默返回', () => {
    act().assignStageToMany([], 'S2');
    expect(pastLen()).toBe(0);
    useGraphStore.setState({ allLocked: true });
    act().assignStageToMany(['B'], 'S2');
    expect(stageIdsOf('S2')).toEqual([]);
    expect(pastLen()).toBe(0);
  });
});
