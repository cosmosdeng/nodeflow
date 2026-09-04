/**
 * Agent Interface — Commands(Act)。
 *
 * 所有 mutation 必须走现有 store 业务动作 → History → Revision。
 * 严禁直接改 nodes[]/setState;除 reset 场景的运行时 revision 复位外不用裸 setState。
 */
import type { Connection } from '@xyflow/react';
import { useGraphStore } from '../store/graphStore';
import type { FlowNodeData, ParticipantType } from '../types';
import {
  asPayloadRecord,
  asPosition,
  asRecord,
  asString,
  asOptionalString,
  asNullableString,
  asNumber,
  asOptionalNumber,
  invalidPayload,
} from './validation';
import type { AgentCommandResult } from './types';

const PARTICIPANT_TYPES: ReadonlySet<string> = new Set([
  'person', 'role', 'organization', 'department', 'machine', 'software', 'ai-agent',
]);

function snapshot(): { prev: number; run: (fn: () => void) => AgentCommandResult; } {
  const prev = useGraphStore.getState().agentRevision;
  return {
    prev,
    run: (fn) => {
      fn();
      useGraphStore.getState().bumpAgentRevision();
      return { previousRevision: prev, newRevision: useGraphStore.getState().agentRevision };
    },
  };
}

function typeOfParticipant(v: unknown): ParticipantType {
  const t = asOptionalString(v, 'type');
  if (t !== undefined && !PARTICIPANT_TYPES.has(t)) {
    throw invalidPayload(`不支持的参与方类型: ${t}`);
  }
  return (t ?? 'role') as ParticipantType;
}

function nodeDataFrom(payload: Record<string, unknown>): Partial<FlowNodeData> {
  const d: Partial<FlowNodeData> = {};
  if (payload.label !== undefined) d.label = asString(payload.label, 'label');
  if (payload.description !== undefined) d.description = asString(payload.description, 'description');
  return d;
}

export function runCommand(type: string, payload: unknown): AgentCommandResult {
  // 无 payload 的 command(reset/seedFixture 等)视作空对象
  const p: Record<string, unknown> =
    payload === undefined || payload === null ? {} : asPayloadRecord(payload);

  switch (type) {
    // ---- 节点 ----
    case 'createNode': {
      const pos = p.position === undefined ? undefined : asPosition(p.position);
      const data = nodeDataFrom(p);
      const id = useGraphStore.getState().addNode(Object.keys(data).length ? data : undefined, pos);
      return snapshot().run(() => { void id; });
    }
    case 'updateNode': {
      const nodeId = asString(p.nodeId, 'nodeId');
      const patch = asRecord(p.patch ?? {}, 'patch');
      const data = nodeDataFrom(patch);
      return snapshot().run(() => useGraphStore.getState().updateNode(nodeId, data));
    }
    case 'deleteNode': {
      const nodeId = asString(p.nodeId, 'nodeId');
      return snapshot().run(() => useGraphStore.getState().deleteNode(nodeId));
    }
    case 'moveNode': {
      const nodeId = asString(p.nodeId, 'nodeId');
      const position = asPosition(p.position);
      return snapshot().run(() => useGraphStore.getState().reassignNode(nodeId, { position }));
    }
    case 'assignParticipant': {
      const nodeId = asString(p.nodeId, 'nodeId');
      const participantId = asNullableString(p.participantId, 'participantId') ?? null;
      return snapshot().run(() => useGraphStore.getState().assignParticipant(nodeId, participantId));
    }
    case 'assignStage': {
      const nodeId = asString(p.nodeId, 'nodeId');
      const stageId = asNullableString(p.stageId, 'stageId') ?? null;
      return snapshot().run(() => useGraphStore.getState().assignNodeStage(nodeId, stageId));
    }

    // ---- 参与方 ----
    case 'createParticipant': {
      const name = asString(p.name, 'name');
      const type = typeOfParticipant(p.type);
      const organizationId = asOptionalString(p.organizationId, 'organizationId');
      const id = useGraphStore.getState().addParticipant(name, type, organizationId);
      return snapshot().run(() => { void id; });
    }
    case 'updateParticipant': {
      const id = asString(p.id, 'id');
      const patch = asRecord(p.patch ?? {}, 'patch');
      const part: { name?: string; type?: ParticipantType; organizationId?: string } = {};
      if (patch.name !== undefined) part.name = asString(patch.name, 'patch.name');
      if (patch.type !== undefined) part.type = typeOfParticipant(patch.type);
      if (patch.organizationId !== undefined) {
        part.organizationId = asOptionalString(patch.organizationId, 'patch.organizationId') ?? undefined;
      }
      return snapshot().run(() => useGraphStore.getState().updateParticipant(id, part));
    }
    case 'deleteParticipant': {
      const id = asString(p.id, 'id');
      return snapshot().run(() => useGraphStore.getState().deleteParticipant(id));
    }

    // ---- 阶段 ----
    case 'createStage': {
      const name = p.name === undefined ? undefined : asString(p.name, 'name');
      const x = p.x === undefined ? undefined : asNumber(p.x, 'x');
      const y = p.y === undefined ? undefined : asNumber(p.y, 'y');
      const width = asOptionalNumber(p.width, 'width') ?? 500;
      const height = asOptionalNumber(p.height, 'height') ?? 400;
      const id = useGraphStore.getState().addStage(x ?? 0, y ?? 0, width, height, name);
      return snapshot().run(() => { void id; });
    }
    case 'updateStage': {
      const id = asString(p.id, 'id');
      const patch = asRecord(p.patch ?? {}, 'patch');
      const st: { name?: string } = {};
      if (patch.name !== undefined) st.name = asString(patch.name, 'patch.name');
      return snapshot().run(() => useGraphStore.getState().updateStage(id, st));
    }
    case 'deleteStage': {
      const id = asString(p.id, 'id');
      return snapshot().run(() => useGraphStore.getState().deleteStage(id));
    }

    // ---- 连线 ----
    case 'connectNodes': {
      const source = asString(p.source, 'source');
      const target = asString(p.target, 'target');
      const sourceHandle = asOptionalString(p.sourceHandle, 'sourceHandle');
      const targetHandle = asOptionalString(p.targetHandle, 'targetHandle');
      const conn: Connection = {
        source,
        target,
        sourceHandle: sourceHandle ?? 'out_1',
        targetHandle: targetHandle ?? 'in_1',
      };
      return snapshot().run(() => {
        useGraphStore.getState().onConnect(conn);
      });
    }
    case 'deleteEdge': {
      const id = asString(p.id, 'id');
      return snapshot().run(() => useGraphStore.getState().deleteEdge(id));
    }

    // ---- Arrange / History ----
    case 'arrange':
      return snapshot().run(() => useGraphStore.getState().runSmartArrange());
    case 'undo': {
      const s = snapshot();
      const st = useGraphStore.getState();
      const can = st.canUndo();
      if (!can) return { previousRevision: s.prev, newRevision: s.prev };
      return s.run(() => st.undo());
    }
    case 'redo': {
      const s = snapshot();
      const st = useGraphStore.getState();
      const can = st.canRedo();
      if (!can) return { previousRevision: s.prev, newRevision: s.prev };
      return s.run(() => st.redo());
    }

    case 'reset': {
      const prev = useGraphStore.getState().agentRevision;
      useGraphStore.getState().newDocument();
      useGraphStore.setState({ agentRevision: 0 });
      return { previousRevision: prev, newRevision: 0 };
    }

    case 'seedFixture': {
      const prev = useGraphStore.getState().agentRevision;
      seedFixture();
      return { previousRevision: prev, newRevision: useGraphStore.getState().agentRevision };
    }

    default:
      throw invalidPayload(`不支持的 command 类型: ${type}`);
  }
}

/**
 * 确定性测试图:3 Participants × 3 Stages,10 Nodes + 多条边;
 * 含 assigned / rowOnly(仅参与方)/ free(两者皆无)与 split/merge 分支。
 * 全部通过现有 store 动作构建,不直接写图。
 */
function seedFixture(): void {
  const g = useGraphStore.getState();
  g.newDocument();

  const p1 = g.addParticipant('参与方 1', 'role');
  const p2 = g.addParticipant('参与方 2', 'role');
  const p3 = g.addParticipant('参与方 3', 'department');
  const s1 = g.addStage(0, 0, 620, 620, '阶段 1');
  const s2 = g.addStage(0, 0, 620, 620, '阶段 2');
  const s3 = g.addStage(0, 0, 620, 620, '阶段 3');

  const make = (label: string, x: number, y: number) =>
    g.addNode({ label, description: '', actor: 'machine', locked: false }, { x, y });

  const N = 10;
  const ids: string[] = [];
  for (let i = 0; i < N; i++) {
    ids.push(make(`Node ${String(i + 1).padStart(2, '0')}`, 40 + i * 320, 40 + (i % 3) * 300));
  }
  const cur = useGraphStore.getState();
  const set = (i: number, pid: string | null, sid: string | null) => {
    const id = ids[i];
    if (pid) cur.assignParticipant(id, pid);
    if (sid) cur.assignNodeStage(id, sid);
  };
  const edge = (a: number, b: number) => {
    const st = useGraphStore.getState();
    st.onConnect({ source: ids[a], target: ids[b], sourceHandle: 'out_1', targetHandle: 'in_1' });
  };

  // 行主链 assigned: P1→S1, P1→S2, P2→S2, P2→S3, P3→S3
  set(0, p1, s1); set(1, p1, s1); set(2, p1, s2);
  set(3, p2, s2); set(4, p2, s3);
  set(5, p3, s3);
  // rowOnly / free
  set(6, p3, null); // 只有参与方,无阶段
  // ids[7] 保持 free
  // ids[8], ids[9] assigned 用于 split/merge
  set(8, p2, s1); set(9, p2, s2);

  // split:0 → 1 与 0 → 3;merge:4、8 → 5;以及一条跨阶段连线
  edge(0, 1);
  edge(0, 3);
  edge(1, 2);
  edge(3, 4);
  edge(4, 5);
  edge(8, 5);
}
