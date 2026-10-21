import { useMemo, useState, type ReactNode } from 'react';
import { useReactFlow } from '@xyflow/react';
import { PARTICIPANT_TYPE_LABELS, type ParticipantType } from '../types';
import { useGraphStore } from '../store/graphStore';
import { confirmDialogAsync } from '../lib/dialog';
import SemanticOrderList, { type OrderItem } from './SemanticOrderList';

interface Props {
  onClose: () => void;
}

const TYPE_ORDER: ParticipantType[] = [
  'person',
  'role',
  'organization',
  'department',
  'machine',
  'software',
  'ai-agent',
];

/**
 * 语义面板 —— 参与方(责任主体)与阶段(流程分段)**唯一的语义管理入口**。
 *
 * 分工(与大纲栏 / 属性栏的边界):
 * - 本面板:参与方与阶段的**定义、顺序、命名、删除**;
 * - 大纲栏:按节点维度的**浏览与定位**(可按执行主体 / 阶段 / 参与方分组);
 * - 属性栏:单个节点的**归属赋值**,并通过「管理…」跳回本面板聚焦对应语义项。
 */
export default function SemanticPanel({ onClose }: Props) {
  const participants = useGraphStore((s) => s.participants);
  const organizations = useGraphStore((s) => s.organizations);
  const participantOrder = useGraphStore((s) => s.participantOrder);
  const stages = useGraphStore((s) => s.stages);
  const stageOrder = useGraphStore((s) => s.stageOrder);
  const nodes = useGraphStore((s) => s.nodes);
  const selected = useGraphStore((s) => s.selected);
  const allLocked = useGraphStore((s) => s.allLocked);
  const semanticFocus = useGraphStore((s) => s.semanticFocus);

  const addParticipant = useGraphStore((s) => s.addParticipant);
  const updateParticipant = useGraphStore((s) => s.updateParticipant);
  const deleteParticipant = useGraphStore((s) => s.deleteParticipant);
  const reorderParticipant = useGraphStore((s) => s.reorderParticipant);
  const addOrganization = useGraphStore((s) => s.addOrganization);
  const updateOrganization = useGraphStore((s) => s.updateOrganization);
  const deleteOrganization = useGraphStore((s) => s.deleteOrganization);
  const addStage = useGraphStore((s) => s.addStage);
  const updateStage = useGraphStore((s) => s.updateStage);
  const deleteStage = useGraphStore((s) => s.deleteStage);
  const reorderStage = useGraphStore((s) => s.reorderStage);
  const assignParticipantToMany = useGraphStore((s) => s.assignParticipantToMany);
  const assignStageToMany = useGraphStore((s) => s.assignStageToMany);
  const selectStage = useGraphStore((s) => s.selectStage);
  const setSelected = useGraphStore((s) => s.setSelected);
  const setSemanticFocus = useGraphStore((s) => s.setSemanticFocus);

  const { screenToFlowPosition, setCenter } = useReactFlow();

  const [newPartName, setNewPartName] = useState('');
  const [newPartType, setNewPartType] = useState<ParticipantType>('person');
  const [newPartOrg, setNewPartOrg] = useState('');
  const [newOrgName, setNewOrgName] = useState('');
  const [editingOrg, setEditingOrg] = useState<string | null>(null);
  const [editingOrgName, setEditingOrgName] = useState('');

  const unassigned = participants.filter((p) => !p.organizationId);

  // 参与方显示顺序 = participantOrder(仅有效)+ 未列出者追加,与矩阵布局同规则;不改 store
  const orderedParticipantIds = useMemo(() => {
    const valid = participantOrder.filter((id) => participants.some((p) => p.id === id));
    const seen = new Set(valid);
    return [...valid, ...participants.filter((p) => !seen.has(p.id)).map((p) => p.id)];
  }, [participants, participantOrder]);

  const orderedStageIds = useMemo(() => {
    const valid = stageOrder.filter((id) => stages.some((st) => st.id === id));
    const seen = new Set(valid);
    return [...valid, ...stages.filter((st) => !seen.has(st.id)).map((st) => st.id)];
  }, [stages, stageOrder]);

  const participantItems: OrderItem[] = useMemo(
    () =>
      orderedParticipantIds.map((pid) => {
        const p = participants.find((x) => x.id === pid);
        const count = nodes.filter((n) => !n.hidden && n.data?.participantId === pid).length;
        const org = organizations.find((o) => o.id === p?.organizationId);
        return {
          id: pid,
          name: p?.name ?? '未命名参与方',
          count,
          tag: org?.name,
          empty: count === 0,
        };
      }),
    [orderedParticipantIds, participants, organizations, nodes],
  );

  const stageItems: OrderItem[] = useMemo(
    () =>
      orderedStageIds.map((sid) => {
        const st = stages.find((x) => x.id === sid);
        const count = st?.nodeIds.filter((nid) => nodes.some((n) => n.id === nid && !n.hidden)).length ?? 0;
        return { id: sid, name: st?.name || '未命名阶段', count, empty: count === 0 };
      }),
    [orderedStageIds, stages, nodes],
  );

  // 画布选中且可批量归属的节点:优先 React Flow 多选(node.selected),回退 store 单选
  const assignableNodeIds = useMemo(() => {
    const multi = nodes.filter((n) => n.selected && !n.hidden).map((n) => n.id);
    if (multi.length > 0) return multi;
    if (selected?.kind === 'node') {
      const n = nodes.find((x) => x.id === selected.id);
      if (n && !n.hidden) return [n.id];
    }
    return [];
  }, [nodes, selected]);

  function handleAssignParticipant(pid: string) {
    const ids = assignableNodeIds;
    if (ids.length === 0) return;
    assignParticipantToMany(ids, pid);
    setSemanticFocus({ kind: 'participant', id: pid });
  }

  function handleAssignStage(sid: string) {
    const ids = assignableNodeIds;
    if (ids.length === 0) return;
    assignStageToMany(ids, sid);
    setSemanticFocus({ kind: 'stage', id: sid });
  }

  // 选中节点所属语义(属性栏联动的兜底高亮:未显式聚焦时跟随当前选中节点)
  const selectedNode = selected?.kind === 'node' ? nodes.find((n) => n.id === selected.id) : undefined;
  const selectedParticipantId = selectedNode?.data.participantId ?? null;
  const selectedStageId = selectedNode ? (stages.find((st) => st.nodeIds.includes(selectedNode.id))?.id ?? null) : null;

  const activeParticipantId =
    semanticFocus?.kind === 'participant' ? semanticFocus.id : (selectedParticipantId ?? null);
  const activeStageId = semanticFocus?.kind === 'stage' ? semanticFocus.id : (selectedStageId ?? null);

  function handleAddParticipant() {
    const name = newPartName.trim();
    if (!name) return;
    addParticipant(name, newPartType, newPartOrg || undefined);
    setNewPartName('');
  }

  function handleAddOrganization() {
    const name = newOrgName.trim();
    if (!name) return;
    addOrganization(name);
    setNewOrgName('');
  }

  function commitEditOrg(id: string) {
    const name = editingOrgName.trim();
    if (!name) return;
    updateOrganization(id, { name });
    setEditingOrg(null);
  }

  /** 单击参与方行:聚焦 + 定位并选中该参与方下的第一个节点 */
  function focusParticipant(pid: string) {
    setSemanticFocus({ kind: 'participant', id: pid });
    const target = nodes.find((n) => !n.hidden && n.data?.participantId === pid);
    if (!target) return;
    setSelected({ kind: 'node', id: target.id });
    setCenter(target.position.x + 115, target.position.y + 60, { zoom: 1.1, duration: 450 });
  }

  /** 单击阶段行:聚焦 + 定位到阶段域中心,并选中域内第一个节点(如有) */
  function focusStage(sid: string) {
    setSemanticFocus({ kind: 'stage', id: sid });
    const st = stages.find((x) => x.id === sid);
    if (!st) return;
    setCenter(st.x + st.width / 2, st.y + st.height / 2, { zoom: 0.9, duration: 450 });
    const first = st.nodeIds.map((nid) => nodes.find((n) => n.id === nid)).find((n) => n && !n.hidden);
    if (first) setSelected({ kind: 'node', id: first.id });
  }

  function handleAddStage() {
    const pos = screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    const id = addStage(pos.x - 250, pos.y - 150, 500, 300);
    if (id) {
      selectStage(id);
      setSemanticFocus({ kind: 'stage', id });
    }
  }

  function handleDeleteParticipant(pid: string) {
    const p = participants.find((x) => x.id === pid);
    void confirmDialogAsync(`删除参与方「${p?.name ?? pid}」?其关联节点会变为未分配。`, {
      title: '删除参与方',
      confirmLabel: '删除',
      danger: true,
    }).then((ok) => {
      if (ok) {
        deleteParticipant(pid);
        setSemanticFocus(null);
      }
    });
  }

  function handleDeleteStage(sid: string) {
    const st = stages.find((x) => x.id === sid);
    void confirmDialogAsync(`删除阶段「${st?.name || sid}」?域内节点会脱离该阶段(节点保留)。`, {
      title: '删除阶段',
      confirmLabel: '删除',
      danger: true,
    }).then((ok) => {
      if (ok) {
        deleteStage(sid);
        setSemanticFocus(null);
      }
    });
  }

  function renderOrg(o: { id: string; name: string }): ReactNode {
    if (editingOrg === o.id) {
      return (
        <div key={o.id} className="pp-edit-row pp-org-edit">
          <input
            className="pp-input"
            value={editingOrgName}
            onChange={(e) => setEditingOrgName(e.target.value)}
            autoFocus
          />
          <button className="pp-btn" onClick={() => commitEditOrg(o.id)}>
            ✓
          </button>
          <button className="pp-btn" onClick={() => setEditingOrg(null)}>
            ✕
          </button>
        </div>
      );
    }
    return (
      <div key={o.id} className="pp-org-header">
        <span className="pp-org-name">{o.name}</span>
        <span className="pp-row-actions">
          <button
            className="pp-link"
            disabled={allLocked}
            onClick={() => {
              setEditingOrg(o.id);
              setEditingOrgName(o.name);
            }}
          >
            编辑
          </button>
          <button className="pp-link pp-danger" disabled={allLocked} onClick={() => deleteOrganization(o.id)}>
            删除
          </button>
        </span>
      </div>
    );
  }

  return (
    <div className="panel participants-panel">
      <div className="panel-header">
        <span>语义 · 参与方与阶段</span>
        <button className="pp-close" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="panel-body">
        <div className={`mx-bulk-hint${assignableNodeIds.length > 0 ? ' active' : ''}`}>
          {assignableNodeIds.length > 0 ? (
            <>
              已选 <b>{assignableNodeIds.length}</b> 个节点 · 点行尾 ⊕ 批量归属(一次撤销可还原)
            </>
          ) : (
            <>在画布框选多个节点后,可点行尾 ⊕ 批量归属</>
          )}
        </div>
        <div className="pp-section">
          <div className="pp-section-title">组织(可选)</div>
          <div className="pp-add-row">
            <input
              className="pp-input"
              placeholder="组织名称"
              value={newOrgName}
              onChange={(e) => setNewOrgName(e.target.value)}
              disabled={allLocked}
            />
            <button className="pp-btn" onClick={handleAddOrganization} disabled={allLocked || !newOrgName.trim()}>
              添加
            </button>
          </div>
          {organizations.length === 0 ? (
            <div className="pp-empty">还没有组织。组织用于把参与方归类,可留空。</div>
          ) : (
            organizations.map(renderOrg)
          )}
        </div>

        <div className="pp-section">
          <div className="pp-section-title">参与方(责任主体)</div>
          <div className="pp-add-row">
            <input
              className="pp-input"
              placeholder="名称"
              value={newPartName}
              onChange={(e) => setNewPartName(e.target.value)}
              disabled={allLocked}
            />
            <select
              className="pp-input pp-type"
              value={newPartType}
              onChange={(e) => setNewPartType(e.target.value as ParticipantType)}
              disabled={allLocked}
            >
              {TYPE_ORDER.map((t) => (
                <option key={t} value={t}>
                  {PARTICIPANT_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
            <select
              className="pp-input"
              value={newPartOrg}
              onChange={(e) => setNewPartOrg(e.target.value)}
              disabled={allLocked}
            >
              <option value="">（无组织）</option>
              {organizations.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
            <button className="pp-btn" onClick={handleAddParticipant} disabled={allLocked || !newPartName.trim()}>
              添加
            </button>
          </div>
          {participants.length === 0 ? (
            <div className="pp-empty">还没有参与方。添加一个参与方,表示流程中的责任主体。</div>
          ) : (
            <SemanticOrderList
              kind="participant"
              items={participantItems}
              activeId={activeParticipantId}
              disabled={allLocked}
              onReorder={(from, to) => reorderParticipant(from, to)}
              onRename={(id, name) => updateParticipant(id, { name })}
              onSelect={focusParticipant}
              onDelete={handleDeleteParticipant}
              onAssign={handleAssignParticipant}
              assignCount={assignableNodeIds.length}
            />
          )}
          {unassigned.length > 0 && (
            <div className="pp-empty">提示:未归入组织的参与方 {unassigned.length} 个,在上方添加组织后可归类。</div>
          )}
        </div>

        <div className="pp-section">
          <div className="pp-section-title">阶段(流程分段)</div>
          <div className="pp-add-row">
            <button className="pp-btn" onClick={handleAddStage} disabled={allLocked}>
              ＋ 新增阶段域
            </button>
            <span className="helper">在画布中央创建一个阶段域,随后可拖动 / 改名 / 排序。</span>
          </div>
          {stages.length === 0 ? (
            <div className="pp-empty">还没有阶段。新增阶段域后,可在属性栏把节点归属到某个阶段。</div>
          ) : (
            <SemanticOrderList
              kind="stage"
              items={stageItems}
              activeId={activeStageId}
              disabled={allLocked}
              onReorder={(from, to) => reorderStage(from, to)}
              onRename={(id, name) => updateStage(id, { name })}
              onSelect={focusStage}
              onDelete={handleDeleteStage}
              onAssign={handleAssignStage}
              assignCount={assignableNodeIds.length}
            />
          )}
        </div>
      </div>
    </div>
  );
}
