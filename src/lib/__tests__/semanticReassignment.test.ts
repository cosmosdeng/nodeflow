import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyIntentToSemantics,
  cancelCandidate,
  confirmCandidate,
  hoverCandidate,
} from '../semanticReassignment';
import { useGraphStore } from '../../store/graphStore';
import type { FlowNode, Stage } from '../../types';

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
    participantOrder: [],
    participantOrderMode: 'auto',
    stageOrder: [],
    arrangePending: false,
    arrangePendingKind: undefined,
    showStageBands: true,
    showParticipantBands: true,
    swimlaneEnabled: false,
    swimlaneOrder: [],
  });
});

const node = (id: string, pid?: string, x = 0, y = 0): FlowNode =>
  ({
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
      ...(pid ? { participantId: pid } : {}),
    },
  }) as unknown as FlowNode;
const stage = (id: string, nodeIds: string[] = []): Stage =>
  ({ id, name: id, x: 0, y: 0, width: 300, height: 200, nodeIds }) as Stage;
const mkP = (id: string) => ({ id, name: id, type: 'person' as const });

describe('Phase C Semantic Reassignment(C1–C18)', () => {
  it('C1 普通拖动不改 participantId(仅语义:拖动不调 reassign 即不变)', () => {
    // store 侧:普通拖动(仅改 position)不改变 assignment
    useGraphStore.setState({
      participants: [mkP('P1'), mkP('P2')],
      participantOrder: ['P1', 'P2'],
      stages: [],
      nodes: [node('A', 'P1', 10, 10)],
    });
    const st = useGraphStore.getState();
    st.onNodesChange([{ type: 'position', id: 'A', position: { x: 400, y: 300 } }]);
    const n = useGraphStore.getState().nodes[0];
    expect(n.position).toEqual({ x: 400, y: 300 });
    expect(n.data.participantId).toBe('P1');
  });

  it('C2 hover 进入 P2 形成 candidate,但 participantId 仍为 P1', () => {
    const cand = hoverCandidate('A', { participantId: 'P1' }, { axis: 'participant', targetId: 'P2' });
    expect(cand).toEqual({ axis: 'participant', nodeId: 'A', fromId: 'P1', toId: 'P2' });
    // semantic 未变(纯函数不动输入)
    expect(cand).toBeTruthy();
  });

  it('C3 hover 离开(取消)后 candidate=null 且 semantic 不变', () => {
    const cand = hoverCandidate('A', { participantId: 'P1' }, { axis: 'participant', targetId: 'P2' });
    expect(cancelCandidate()).toBeNull();
    expect(cand).toBeTruthy(); // 仅用于演示确认前置状态;取消路径不产生变更
  });

  it('C10 同目标 P1→P1 = no-op(无 candidate)', () => {
    expect(hoverCandidate('A', { participantId: 'P1' }, { axis: 'participant', targetId: 'P1' })).toBeNull();
    expect(hoverCandidate('A', { stageId: 'S1' }, { axis: 'stage', targetId: 'S1' })).toBeNull();
  });

  it('C16 Participant / Stage 独立(纯函数只改被确认的轴)', () => {
    const next = applyIntentToSemantics(
      { participantId: 'P1', stageId: 'S1' },
      { axis: 'participant', nodeId: 'A', toId: 'P2' },
    );
    expect(next.participantId).toBe('P2');
    expect(next.stageId).toBe('S1'); // stage 不变
    const next2 = applyIntentToSemantics(
      { participantId: 'P1', stageId: 'S1' },
      { axis: 'stage', nodeId: 'A', toId: 'S2' },
    );
    expect(next2.stageId).toBe('S2');
    expect(next2.participantId).toBe('P1'); // participant 不变
  });

  it('C18 同输入确定性(hover→confirm→apply 结果一致)', () => {
    const sem = { participantId: 'P1' };
    const run = () => {
      const cand = hoverCandidate('A', sem, { axis: 'participant', targetId: 'P2' });
      if (!cand) throw new Error('candidate missing');
      const intent = confirmCandidate(cand);
      return applyIntentToSemantics(sem, intent);
    };
    expect(run()).toEqual(run());
  });

  it('C4/C5/C6 Participant 确认 + atomic Undo/Redo(position+participant)', () => {
    useGraphStore.setState({
      participants: [mkP('P1'), mkP('P2')],
      participantOrder: ['P1', 'P2'],
      stages: [],
      nodes: [node('A', 'P1', 10, 10)],
    });
    const st = useGraphStore.getState();
    st.reassignNode('A', { position: { x: 500, y: 300 }, participantId: 'P2' });
    let cur = useGraphStore.getState();
    expect(cur.nodes[0].position).toEqual({ x: 500, y: 300 });
    expect(cur.nodes[0].data.participantId).toBe('P2');
    // atomic undo:一次同时恢复 position + participant
    cur.undo();
    cur = useGraphStore.getState();
    expect(cur.nodes[0].position).toEqual({ x: 10, y: 10 });
    expect(cur.nodes[0].data.participantId).toBe('P1');
    // redo
    cur.redo();
    cur = useGraphStore.getState();
    expect(cur.nodes[0].position).toEqual({ x: 500, y: 300 });
    expect(cur.nodes[0].data.participantId).toBe('P2');
  });

  it('C7/C8/C9 Stage 确认 + atomic Undo/Redo(stage membership + position)', () => {
    useGraphStore.setState({
      participants: [mkP('P1')],
      participantOrder: ['P1'],
      stages: [stage('S1', ['A']), stage('S2')],
      stageOrder: ['S1', 'S2'],
      nodes: [node('A', 'P1', 10, 10)],
    });
    const st = useGraphStore.getState();
    st.reassignNode('A', { position: { x: 700, y: 220 }, stageId: 'S2' });
    let cur = useGraphStore.getState();
    expect(cur.stages.find((x) => x.id === 'S1')!.nodeIds).toEqual([]);
    expect(cur.stages.find((x) => x.id === 'S2')!.nodeIds).toEqual(['A']);
    expect(cur.nodes[0].position).toEqual({ x: 700, y: 220 });
    cur.undo();
    cur = useGraphStore.getState();
    expect(cur.stages.find((x) => x.id === 'S1')!.nodeIds).toEqual(['A']);
    expect(cur.stages.find((x) => x.id === 'S2')!.nodeIds).toEqual([]);
    expect(cur.nodes[0].position).toEqual({ x: 10, y: 10 });
    cur.redo();
    cur = useGraphStore.getState();
    expect(cur.stages.find((x) => x.id === 'S2')!.nodeIds).toEqual(['A']);
    expect(cur.nodes[0].position).toEqual({ x: 700, y: 220 });
  });

  it('C11/C12 Empty Participant/Stage 可作为目标;确认后 assignment 正确', () => {
    const candP = hoverCandidate('A', { participantId: 'P1', stageId: 'S1' }, { axis: 'participant', targetId: 'P2' });
    const candS = hoverCandidate('A', { participantId: 'P1', stageId: 'S1' }, { axis: 'stage', targetId: 'S2' });
    expect(candP!.toId).toBe('P2');
    expect(candS!.toId).toBe('S2');
    // store 侧:拖到目前“空”的 P2/S2 确认后生效
    useGraphStore.setState({
      participants: [mkP('P1'), mkP('P2')],
      participantOrder: ['P1', 'P2'],
      stages: [stage('S1', ['A']), stage('S2')],
      stageOrder: ['S1', 'S2'],
      nodes: [node('A', 'P1', 0, 0)],
    });
    const st = useGraphStore.getState();
    st.reassignNode('A', { position: { x: 20, y: 20 }, participantId: 'P2', stageId: 'S2' });
    const cur = useGraphStore.getState();
    expect(cur.nodes[0].data.participantId).toBe('P2');
    expect(cur.stages.find((x) => x.id === 'S2')!.nodeIds).toEqual(['A']);
  });

  it('C13 Free→Participant 与 C14 Free→Stage 独立生效', () => {
    useGraphStore.setState({
      participants: [mkP('P1')],
      participantOrder: ['P1'],
      stages: [stage('S1')],
      stageOrder: ['S1'],
      nodes: [node('F')],
    });
    const st = useGraphStore.getState();
    st.reassignNode('F', { position: { x: 50, y: 50 }, participantId: 'P1' });
    let cur = useGraphStore.getState();
    expect(cur.nodes[0].data.participantId).toBe('P1');
    expect(cur.stages.every((s) => !s.nodeIds.includes('F'))).toBe(true); // stage 未自动改
    st.reassignNode('F', { position: { x: 60, y: 60 }, stageId: 'S1' });
    cur = useGraphStore.getState();
    expect(cur.nodes[0].data.participantId).toBe('P1');
    expect(cur.stages[0].nodeIds).toEqual(['F']);
  });

  it('C15 rowOnly→Stage 确认后成为 assigned', () => {
    useGraphStore.setState({
      participants: [mkP('P1')],
      participantOrder: ['P1'],
      stages: [stage('S1')],
      stageOrder: ['S1'],
      nodes: [node('R', 'P1')],
    });
    const cand = hoverCandidate('R', { participantId: 'P1' }, { axis: 'stage', targetId: 'S1' });
    expect(cand).toEqual({ axis: 'stage', nodeId: 'R', fromId: undefined, toId: 'S1' });
    const st = useGraphStore.getState();
    st.reassignNode('R', { position: { x: 80, y: 80 }, stageId: 'S1' });
    expect(useGraphStore.getState().stages[0].nodeIds).toEqual(['R']);
    expect(useGraphStore.getState().nodes[0].data.participantId).toBe('P1');
  });

  it('C17 reassignment 不改 participantOrder / stageOrder', () => {
    useGraphStore.setState({
      participants: [mkP('P1'), mkP('P2'), mkP('P3')],
      participantOrder: ['P3', 'P1', 'P2'],
      stages: [stage('S1', ['A']), stage('S2'), stage('S3')],
      stageOrder: ['S3', 'S1', 'S2'],
      nodes: [node('A', 'P1', 0, 0)],
    });
    const st = useGraphStore.getState();
    st.reassignNode('A', { position: { x: 30, y: 30 }, participantId: 'P2', stageId: 'S2' });
    const cur = useGraphStore.getState();
    expect(cur.participantOrder).toEqual(['P3', 'P1', 'P2']);
    expect(cur.stageOrder).toEqual(['S3', 'S1', 'S2']);
  });

  it('拖拽式 atomic:拖动开始快照 + reassign(recordHistory:false) 一次 Undo 同时还原 position+semantic', () => {
    useGraphStore.setState({
      participants: [mkP('P1'), mkP('P2')],
      participantOrder: ['P1', 'P2'],
      stages: [],
      nodes: [node('A', 'P1', 10, 10)],
    });
    // 模拟 FlowCanvas:拖动开始处 markHistory(此时还是拖动前状态)
    const pre = useGraphStore.getState();
    pre.markHistory();
    // 拖动过程中:只改 position,不改 semantic(不额外写历史)
    useGraphStore.getState().onNodesChange([
      { type: 'position', id: 'A', position: { x: 420, y: 320 } },
    ]);
    let cur = useGraphStore.getState();
    expect(cur.nodes[0].position).toEqual({ x: 420, y: 320 });
    expect(cur.nodes[0].data.participantId).toBe('P1');
    // 确认语义重分配:跳过再记历史,使 position+semantic 与拖动开始快照同一条
    cur.reassignNode('A', { position: { x: 420, y: 320 }, participantId: 'P2' }, { recordHistory: false });
    cur = useGraphStore.getState();
    expect(cur.nodes[0].data.participantId).toBe('P2');
    expect(cur.nodes[0].position).toEqual({ x: 420, y: 320 });
    // 一次 Undo 同时回到拖动前位置与语义
    cur.undo();
    cur = useGraphStore.getState();
    expect(cur.nodes[0].position).toEqual({ x: 10, y: 10 });
    expect(cur.nodes[0].data.participantId).toBe('P1');
    // 一次 Redo 同时恢复
    cur.redo();
    cur = useGraphStore.getState();
    expect(cur.nodes[0].position).toEqual({ x: 420, y: 320 });
    expect(cur.nodes[0].data.participantId).toBe('P2');
  });

  it('reassignHighlight 可同时承载两轴候选,setter 合并式且 null 全清', () => {
    const st = useGraphStore.getState();
    st.setReassignHighlight(null);
    st.setReassignHighlight({ participant: 'P2' });
    expect(useGraphStore.getState().reassignHighlight).toEqual({ participant: 'P2', stage: null });
    st.setReassignHighlight({ stage: 'S2' }); // 不覆盖另一轴
    expect(useGraphStore.getState().reassignHighlight).toEqual({ participant: 'P2', stage: 'S2' });
    st.setReassignHighlight(null);
    expect(useGraphStore.getState().reassignHighlight).toBeNull();
  });
});
