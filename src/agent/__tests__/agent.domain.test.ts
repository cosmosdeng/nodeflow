import { beforeEach, describe, expect, it } from 'vitest';
import { executeAgentRequest } from '../executor';
import { AGENT_PROTOCOL_VERSION, type AgentCommandResult, type AgentGraphState, type AgentRequestType } from '../types';
import { useGraphStore } from '../../store/graphStore';
import { setAgentTestCommandsEnabled } from '../capabilities';

interface Result { success: boolean; data?: unknown; error?: { code?: string } }
async function act(type: AgentRequestType, payload?: unknown): Promise<Result> {
  const r = await executeAgentRequest({
    protocolVersion: AGENT_PROTOCOL_VERSION,
    requestId: `d-${Math.random().toString(36).slice(2, 7)}`,
    type,
    payload,
  });
  return { success: r.success, data: r.data, error: r.error };
}
function cr(r: Result): AgentCommandResult | undefined {
  return r.data as AgentCommandResult | undefined;
}
async function state(): Promise<AgentGraphState> {
  const r = await act('getGraphState');
  return r.data as AgentGraphState;
}

describe('Phase D — Gateway / Artifact / Annotation / Composite observe', () => {
  beforeEach(async () => {
    setAgentTestCommandsEnabled(true);
    useGraphStore.setState({ agentRevision: 0, past: [], future: [], annotations: [] });
    await act('reset');
    await act('seedFixture');
  });

  it('Gateway:createGateway 返回 gatewayId;DTO 表达 gatewayType;change 类型 + undo/redo', async () => {
    const g = await act('createGateway', { type: 'exclusive', x: 20, y: 20 });
    const gatewayId = cr(g)?.result?.gatewayId as string;
    expect(gatewayId).toBeTruthy();

    let s = await state();
    const dto = s.nodes.find((n) => n.id === gatewayId)!;
    expect(dto.isGateway).toBe(true);
    expect(dto.gatewayType).toBe('exclusive');

    const c = await act('changeGatewayType', { nodeId: gatewayId, type: 'parallel' });
    expect(c.success).toBe(true);
    s = await state();
    expect(s.nodes.find((n) => n.id === gatewayId)!.gatewayType).toBe('parallel');

    const a = await act('assert', { type: 'assertGatewayType', nodeId: gatewayId, expectedType: 'parallel' });
    expect((a.data as { passed?: boolean })?.passed).toBe(true);

    await act('undo'); // 类型回 exclusive
    s = await state();
    expect(s.nodes.find((n) => n.id === gatewayId)!.gatewayType).toBe('exclusive');
    await act('redo');
    s = await state();
    expect(s.nodes.find((n) => n.id === gatewayId)!.gatewayType).toBe('parallel');
  });

  it('Artifact:connect_edge → attach/update/remove(edge.data.artifact)+ assert + undo', async () => {
    const s0 = await state();
    const a = s0.nodes.find((x) => x.label === 'Node 01')!;
    const b = s0.nodes.find((x) => x.label === 'Node 06')!;
    const e = await act('connectNodes', { source: a.id, target: b.id });
    const edgeId = cr(e)?.result?.edgeId as string;
    expect(edgeId).toBeTruthy();

    const att = await act('attachArtifact', { edgeId, kind: 'document', label: '脚本.v1', description: '需求文档' });
    const artifactId = cr(att)?.result?.artifactId as string;
    expect(artifactId).toBeTruthy();
    let s = await state();
    const edgeDto = s.edges.find((x) => x.id === edgeId)!;
    expect(edgeDto.artifact).not.toBeNull();
    expect(edgeDto.artifact?.kind).toBe('document');

    const upd = await act('updateArtifact', { edgeId, kind: 'image' });
    expect(upd.success).toBe(true);
    s = await state();
    expect(s.edges.find((x) => x.id === edgeId)!.artifact?.kind).toBe('image');

    const as = await act('assert', { type: 'assertEdgeArtifact', edgeId, kind: 'image' });
    expect((as.data as { passed?: boolean })?.passed).toBe(true);

    await act('undo'); // updateArtifact 撤销 -> 回 document
    s = await state();
    expect(s.edges.find((x) => x.id === edgeId)!.artifact?.kind).toBe('document');
    void artifactId;
  });

  it('Annotation:create/update/move/delete + 观察 + assert + undo/redo', async () => {
    const s0 = await state();
    const n = s0.nodes[0];
    const c = await act('createAnnotation', {
      target: { kind: 'node', nodeId: n.id },
      title: '备注',
      content: '初版',
      position: { x: 30, y: 30 },
    });
    const annotationId = cr(c)?.result?.annotationId as string;
    expect(annotationId).toBeTruthy();
    let s = await state();
    expect(s.annotations.find((x) => x.id === annotationId)).toBeTruthy();

    await act('updateAnnotation', { id: annotationId, content: '更新版' });
    await act('moveAnnotation', { id: annotationId, position: { x: 120, y: 90 } });
    s = await state();
    const ann = s.annotations.find((x) => x.id === annotationId)!;
    expect(ann.content).toBe('更新版');
    expect(ann.position).toEqual({ x: 120, y: 90 });

    const as = await act('assert', { type: 'assertAnnotationExists', id: annotationId, content: '更新版' });
    expect((as.data as { passed?: boolean })?.passed).toBe(true);

    await act('undo'); // 撤销 move
    await act('undo'); // 撤销 update
    await act('undo'); // 撤销 create
    s = await state();
    expect(s.annotations.some((x) => x.id === annotationId)).toBe(false);
    await act('redo');
    await act('redo');
    await act('redo');
    s = await state();
    expect(s.annotations.find((x) => x.id === annotationId)?.content).toBe('更新版');

    const del = await act('deleteAnnotation', { id: annotationId });
    expect(del.success).toBe(true);
  });

  it('Composite:Observe 派生 childIds/parent(host 由现有 GUI 动作创建),assert 成立', async () => {
    // 用现有 store groupSelected 模拟 GUI 创建 composite(两节点都 selected)
    const n1 = await act('createNode', { label: '子A', x: 10, y: 10 });
    const n2 = await act('createNode', { label: '子B', x: 10, y: 10 });
    const id1 = cr(n1)?.result?.nodeId as string;
    const id2 = cr(n2)?.result?.nodeId as string;
    const st = useGraphStore.getState();
    const marked = st.nodes.map((x) => (x.id === id1 || x.id === id2 ? { ...x, selected: true } : x));
    useGraphStore.setState({ nodes: marked });
    const hostId = useGraphStore.getState().groupSelected();
    expect(hostId).toBeTruthy();

    const s = await state();
    const host = s.nodes.find((x) => x.id === hostId)!;
    expect(host.isComposite).toBe(true);
    expect(host.childIds).toEqual(expect.arrayContaining([id1, id2]));
    expect(s.nodes.find((x) => x.id === id1)!.parentCompositeId).toBe(hostId);
    expect(s.nodes.find((x) => x.id === id2)!.parentCompositeId).toBe(hostId);

    const ca = await act('assert', { type: 'assertCompositeContains', compositeId: hostId, childIds: [id1, id2] });
    expect((ca.data as { passed?: boolean })?.passed).toBe(true);
    const pa = await act('assert', { type: 'assertNodeParent', nodeId: id1, compositeId: hostId });
    expect((pa.data as { passed?: boolean })?.passed).toBe(true);
  });
});
