import { useState, type ReactNode } from 'react';
import { PARTICIPANT_TYPE_LABELS, type ParticipantType } from '../types';
import { useGraphStore } from '../store/graphStore';

interface Props {
  onClose: () => void;
}

const TYPE_ORDER: ParticipantType[] = ['person', 'role', 'organization', 'department', 'machine', 'software', 'ai-agent'];

/** 组织树 + 参与方管理 Outliner(语义管理入口,不直接等于画布泳道) */
export default function ParticipantsPanel({ onClose }: Props) {
  const participants = useGraphStore((s) => s.participants);
  const organizations = useGraphStore((s) => s.organizations);
  const addParticipant = useGraphStore((s) => s.addParticipant);
  const updateParticipant = useGraphStore((s) => s.updateParticipant);
  const deleteParticipant = useGraphStore((s) => s.deleteParticipant);
  const addOrganization = useGraphStore((s) => s.addOrganization);
  const updateOrganization = useGraphStore((s) => s.updateOrganization);
  const deleteOrganization = useGraphStore((s) => s.deleteOrganization);

  const [newPartName, setNewPartName] = useState('');
  const [newPartType, setNewPartType] = useState<ParticipantType>('person');
  const [newPartOrg, setNewPartOrg] = useState('');
  const [newOrgName, setNewOrgName] = useState('');
  const [editingPart, setEditingPart] = useState<string | null>(null);
  const [editingPartName, setEditingPartName] = useState('');
  const [editingPartType, setEditingPartType] = useState<ParticipantType>('person');
  const [editingPartOrg, setEditingPartOrg] = useState('');
  const [editingOrg, setEditingOrg] = useState<string | null>(null);
  const [editingOrgName, setEditingOrgName] = useState('');

  const unassigned = participants.filter((p) => !p.organizationId);

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

  function startEditPart(p: { id: string; name: string; type: ParticipantType; organizationId?: string }) {
    setEditingPart(p.id);
    setEditingPartName(p.name);
    setEditingPartType(p.type);
    setEditingPartOrg(p.organizationId ?? '');
  }

  function commitEditPart(id: string) {
    const name = editingPartName.trim();
    if (!name) return;
    updateParticipant(id, { name, type: editingPartType, organizationId: editingPartOrg || undefined });
    setEditingPart(null);
  }

  function startEditOrg(o: { id: string; name: string }) {
    setEditingOrg(o.id);
    setEditingOrgName(o.name);
  }

  function commitEditOrg(id: string) {
    const name = editingOrgName.trim();
    if (!name) return;
    updateOrganization(id, { name });
    setEditingOrg(null);
  }

  function renderParticipant(p: { id: string; name: string; type: ParticipantType; organizationId?: string }): ReactNode {
    const typeLabel = PARTICIPANT_TYPE_LABELS[p.type] ?? p.type;
    if (editingPart === p.id) {
      return (
        <div key={p.id} className="pp-edit-row">
          <input className="pp-input" value={editingPartName} onChange={(e) => setEditingPartName(e.target.value)} autoFocus />
          <select className="pp-input" value={editingPartType} onChange={(e) => setEditingPartType(e.target.value as ParticipantType)}>
            {TYPE_ORDER.map((t) => (
              <option key={t} value={t}>{PARTICIPANT_TYPE_LABELS[t]}</option>
            ))}
          </select>
          <select className="pp-input" value={editingPartOrg} onChange={(e) => setEditingPartOrg(e.target.value)}>
            <option value="">（无组织）</option>
            {organizations.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
          <button className="pp-btn" onClick={() => commitEditPart(p.id)}>✓</button>
          <button className="pp-btn" onClick={() => setEditingPart(null)}>✕</button>
        </div>
      );
    }
    return (
      <div key={p.id} className="pp-participant">
        <span className="pp-participant-name">{p.name}</span>
        <span className="pp-participant-type">{typeLabel}</span>
        <span className="pp-row-actions">
          <button className="pp-link" onClick={() => startEditPart(p)}>编辑</button>
          <button className="pp-link pp-danger" onClick={() => deleteParticipant(p.id)}>删除</button>
        </span>
      </div>
    );
  }

  return (
    <div className="panel participants-panel">
      <div className="panel-header">
        <span>参与方与组织</span>
        <button className="pp-close" onClick={onClose}>✕</button>
      </div>
      <div className="panel-body">
        <div className="pp-section">
          <div className="pp-section-title">新增组织</div>
          <div className="pp-add-row">
            <input className="pp-input" placeholder="组织名称" value={newOrgName} onChange={(e) => setNewOrgName(e.target.value)} />
            <button className="pp-btn" onClick={handleAddOrganization} disabled={!newOrgName.trim()}>添加</button>
          </div>
        </div>

        <div className="pp-section">
          <div className="pp-section-title">新增参与方</div>
          <div className="pp-add-row">
            <input className="pp-input" placeholder="名称" value={newPartName} onChange={(e) => setNewPartName(e.target.value)} />
            <select className="pp-input pp-type" value={newPartType} onChange={(e) => setNewPartType(e.target.value as ParticipantType)}>
              {TYPE_ORDER.map((t) => (
                <option key={t} value={t}>{PARTICIPANT_TYPE_LABELS[t]}</option>
              ))}
            </select>
            <select className="pp-input" value={newPartOrg} onChange={(e) => setNewPartOrg(e.target.value)}>
              <option value="">（无组织）</option>
              {organizations.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
            <button className="pp-btn" onClick={handleAddParticipant} disabled={!newPartName.trim()}>添加</button>
          </div>
        </div>

        <div className="pp-section">
          <div className="pp-section-title">参与方列表</div>
          {organizations.map((org) => {
            const members = participants.filter((p) => p.organizationId === org.id);
            return (
              <div key={org.id} className="pp-org-group">
                {editingOrg === org.id ? (
                  <div className="pp-edit-row pp-org-edit">
                    <input className="pp-input" value={editingOrgName} onChange={(e) => setEditingOrgName(e.target.value)} autoFocus />
                    <button className="pp-btn" onClick={() => commitEditOrg(org.id)}>✓</button>
                    <button className="pp-btn" onClick={() => setEditingOrg(null)}>✕</button>
                  </div>
                ) : (
                  <div className="pp-org-header">
                    <span className="pp-org-name">{org.name}</span>
                    <span className="pp-row-actions">
                      <button className="pp-link" onClick={() => startEditOrg(org)}>编辑</button>
                      <button className="pp-link pp-danger" onClick={() => deleteOrganization(org.id)}>删除</button>
                    </span>
                  </div>
                )}
                {members.length === 0 && <div className="pp-empty">（无参与方）</div>}
                {members.map(renderParticipant)}
              </div>
            );
          })}
          {unassigned.length > 0 && (
            <div className="pp-org-group">
              <div className="pp-org-header"><span className="pp-org-name">未分配</span></div>
              {unassigned.map(renderParticipant)}
            </div>
          )}
          {participants.length === 0 && <div className="pp-empty">还没有参与方。在上方添加一个参与方,表示流程中的责任主体。</div>}
        </div>
      </div>
    </div>
  );
}
