import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ACTOR_META,
  ACTOR_KINDS,
  ARTIFACT_KINDS,
  ARTIFACT_META,
  type ActorType,
  type ArtifactKind,
  type FlowNodeData,
  uid,
} from '../types';
import { useGraphStore } from '../store/graphStore';
import { computeCompositePorts } from '../lib/composite';
import ActorIcon from './ActorIcon';

/* ---------------- 基础控件 ---------------- */

interface CommitFieldProps {
  value: string;
  onCommit: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  rows?: number;
  disabled?: boolean;
}

/** 失焦/回车时提交,避免每个按键都产生历史记录 */
function CommitField({ value, onCommit, placeholder, multiline, rows = 2, disabled }: CommitFieldProps) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  if (multiline) {
    return (
      <textarea
        value={draft}
        rows={rows}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
      />
    );
  }
  return (
    <input
      value={draft}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {hint && <span className="helper">{hint}</span>}
    </div>
  );
}

function Section({
  title,
  children,
  hint,
}: {
  title: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <div style={{ marginTop: 14 }}>
      <div
        style={{
          fontSize: 11,
          color: 'var(--text-faint)',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: 0.6,
          marginBottom: 8,
        }}
      >
        {title}
      </div>
      {children}
      {hint && <span className="helper">{hint}</span>}
    </div>
  );
}

/* ---------------- 节点属性 ---------------- */

function NodeProperties({ nodeId }: { nodeId: string }) {
  const node = useGraphStore((s) => s.nodes.find((n) => n.id === nodeId));
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const updateNode = useGraphStore((s) => s.updateNode);
  const deleteNode = useGraphStore((s) => s.deleteNode);
  const duplicateNode = useGraphStore((s) => s.duplicateNode);
  const toggleComposite = useGraphStore((s) => s.toggleComposite);
  const ungroup = useGraphStore((s) => s.ungroup);
  const openCompositeTab = useGraphStore((s) => s.openCompositeTab);
  const allLocked = useGraphStore((s) => s.allLocked);
  const setSelected = useGraphStore((s) => s.setSelected);

  if (!node) return <MissingNotice />;
  const d = node.data;
  const locked = !!d.locked;
  const disabled = locked || allLocked;
  const composite = d.composite;
  const isComposite = !!composite;

  // 组合节点的聚合端口一律实时计算,与画布展示保持一致(单一数据源,不依赖历史快照)
  const aggPorts = useMemo(() => {
    if (!composite) return null;
    const children = nodes.filter((c) => composite.childIds.includes(c.id));
    return computeCompositePorts(children, edges);
  }, [composite, edges, nodes]);

  const setPorts = (inputs: FlowNodeData['inputs'], outputs: FlowNodeData['outputs']) =>
    updateNode(nodeId, { inputs, outputs });

  const addInput = () =>
    setPorts([...d.inputs, { id: uid('in'), name: `输入 ${d.inputs.length + 1}` }], d.outputs);
  const addOutput = () =>
    setPorts(d.inputs, [...d.outputs, { id: uid('out'), name: `输出 ${d.outputs.length + 1}` }]);
  const removeInput = (pid: string) =>
    setPorts(d.inputs.filter((p) => p.id !== pid), d.outputs);
  const removeOutput = (pid: string) =>
    setPorts(d.inputs, d.outputs.filter((p) => p.id !== pid));
  const renameInput = (pid: string, name: string) =>
    setPorts(d.inputs.map((p) => (p.id === pid ? { ...p, name } : p)), d.outputs);
  const renameOutput = (pid: string, name: string) =>
    setPorts(d.inputs, d.outputs.map((p) => (p.id === pid ? { ...p, name } : p)));

  return (
    <div>
      {allLocked && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 10px',
            background: 'rgba(232, 176, 40, 0.1)',
            border: '1px solid rgba(232, 176, 40, 0.35)',
            borderRadius: 8,
            marginBottom: 12,
            fontSize: 11.5,
          }}
        >
          <span>🔒 演示模式已锁定全部内容,此处只读</span>
        </div>
      )}
      {locked && !allLocked && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 10px',
            background: 'rgba(232, 176, 40, 0.1)',
            border: '1px solid rgba(232, 176, 40, 0.35)',
            borderRadius: 8,
            marginBottom: 12,
            fontSize: 11.5,
          }}
        >
          <span>🔒 该节点已锁定,以下内容不可修改</span>
          <button
            className="tb-btn"
            style={{ marginLeft: 'auto', padding: '2px 8px', fontSize: 11.5 }}
            onClick={() => updateNode(nodeId, { locked: false })}
          >
            解锁
          </button>
        </div>
      )}
      <div className="field">
        <label>节点名称</label>
        <CommitField value={d.label} onCommit={(v) => updateNode(nodeId, { label: v })} placeholder="节点名称" disabled={disabled} />
      </div>
      <Field label="动作描述" hint="用简短文字说明该节点要完成的动作">
        <CommitField
          value={d.description}
          onCommit={(v) => updateNode(nodeId, { description: v })}
          placeholder="描述该节点的动作…"
          multiline
          rows={4}
          disabled={disabled}
        />
      </Field>

      <Section title="执行主体">
        <div className="seg">
          {ACTOR_KINDS.map((a: ActorType) => {
            const meta = ACTOR_META[a];
            return (
              <button
                key={a}
                className={d.actor === a ? 'active' : ''}
                disabled={disabled}
                onClick={() => updateNode(nodeId, { actor: a })}
              >
                <ActorIcon actor={a} size={22} />
                {meta.label}
              </button>
            );
          })}
        </div>
      </Section>

      {isComposite && (
        <Section title="组合节点">
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '10px 12px',
              borderRadius: 10,
              background: 'var(--bg)',
              border: '1px solid var(--border)',
              marginBottom: 10,
            }}
          >
            <span style={{ fontSize: 24 }}>⧉</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700 }}>
                {composite!.childIds.length} 个子节点
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>
                {composite!.expanded ? '已展开(虚线框内可编辑内部节点)' : '已塌缩(显示聚合端口)'}
              </div>
            </div>
          </div>
          <div className="field-row" style={{ marginBottom: 6 }}>
            <button
              className="tb-btn"
              style={{ flex: 1, justifyContent: 'center' }}
              disabled={disabled}
              onClick={() => toggleComposite(nodeId)}
            >
              {composite!.expanded ? '◀ 塌缩收起' : '▶ 展开内部'}
            </button>
            <button
              className="tb-btn"
              style={{ flex: 1, justifyContent: 'center' }}
              disabled={disabled}
              onClick={() => openCompositeTab(nodeId)}
            >
              🖼 内部画布
            </button>
          </div>
          <div className="field-row">
            <button
              className="tb-btn"
              style={{ flex: 1, justifyContent: 'center' }}
              disabled={disabled}
              onClick={() => ungroup(nodeId)}
            >
              ⧗ 取消组合
            </button>
          </div>
        </Section>
      )}

      {isComposite ? (
        <>
          <Section
            title={`聚合输入 (${aggPorts?.inputs.length ?? 0})`}
            hint="自动来自内部节点未连入的输入端口(实时计算)"
          >
            {(!aggPorts || aggPorts.inputs.length === 0) && <div className="helper">无输入端口</div>}
            {aggPorts?.inputs.map((p) => (
              <div key={p.id} className="field-row" style={{ marginBottom: 6 }}>
                <span className="port-label static" style={{ flex: 1 }}>
                  {p.name}
                </span>
              </div>
            ))}
          </Section>
          <Section
            title={`聚合输出 (${aggPorts?.outputs.length ?? 0})`}
            hint="自动来自内部节点未连出的输出端口(实时计算)"
          >
            {(!aggPorts || aggPorts.outputs.length === 0) && <div className="helper">无输出端口</div>}
            {aggPorts?.outputs.map((p) => (
              <div key={p.id} className="field-row" style={{ marginBottom: 6 }}>
                <span className="port-label static" style={{ flex: 1, textAlign: 'right' }}>
                  {p.name}
                </span>
              </div>
            ))}
          </Section>
        </>
      ) : (
        <>
          <Section title={`输入端口 (${d.inputs.length})`}>
            {d.inputs.length === 0 && <div className="helper">暂无输入端口</div>}
            {d.inputs.map((p) => (
              <div key={p.id} className="field-row" style={{ marginBottom: 6 }}>
                <CommitField value={p.name} onCommit={(v) => renameInput(p.id, v)} placeholder="端口名" disabled={disabled} />
                <button className="tb-btn" title="删除该端口" disabled={disabled} onClick={() => removeInput(p.id)}>
                  ✕
                </button>
              </div>
            ))}
            <button className="tb-btn" style={{ width: '100%', justifyContent: 'center' }} disabled={disabled} onClick={addInput}>
              + 添加输入
            </button>
          </Section>

          <Section title={`输出端口 (${d.outputs.length})`}>
            {d.outputs.length === 0 && <div className="helper">暂无输出端口</div>}
            {d.outputs.map((p) => (
              <div key={p.id} className="field-row" style={{ marginBottom: 6 }}>
                <CommitField value={p.name} onCommit={(v) => renameOutput(p.id, v)} placeholder="端口名" disabled={disabled} />
                <button className="tb-btn" title="删除该端口" disabled={disabled} onClick={() => removeOutput(p.id)}>
                  ✕
                </button>
              </div>
            ))}
            <button className="tb-btn" style={{ width: '100%', justifyContent: 'center' }} disabled={disabled} onClick={addOutput}>
              + 添加输出
            </button>
          </Section>
        </>
      )}

      <Section title="操作">
        <div className="field-row">
          {!isComposite && (
            <button
              className="tb-btn"
              style={{ flex: 1, justifyContent: 'center' }}
              disabled={disabled}
              onClick={() => duplicateNode(nodeId)}
            >
              ⧉ 复制节点
            </button>
          )}
          <button
            className="tb-btn danger"
            style={{ flex: isComposite ? 1 : undefined, justifyContent: 'center' }}
            disabled={disabled}
            onClick={() => {
              if (confirm(isComposite ? '确定删除该组合节点?其子节点会恢复并保留,连线还原。' : '确定删除该节点?其所有连线也会被删除。')) {
                deleteNode(nodeId);
                setSelected(null);
              }
            }}
          >
            🗑 删除
          </button>
        </div>
      </Section>
    </div>
  );
}

/* ---------------- 中间产物属性 ---------------- */

function ArtifactProperties({ edgeId }: { edgeId: string }) {
  const edge = useGraphStore((s) => s.edges.find((e) => e.id === edgeId));
  const updateArtifact = useGraphStore((s) => s.updateArtifact);
  const setArtifact = useGraphStore((s) => s.setArtifact);
  const allLocked = useGraphStore((s) => s.allLocked);
  const setSelected = useGraphStore((s) => s.setSelected);

  if (!edge?.data?.artifact) return <MissingNotice />;
  const art = edge.data.artifact;
  const meta = ARTIFACT_META[art.kind];

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 12px',
          borderRadius: 10,
          background: 'var(--bg)',
          border: '1px solid var(--border)',
          marginBottom: 14,
        }}
      >
        <span style={{ fontSize: 28 }}>{meta.icon}</span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700 }}>{art.label || '未命名产物'}</div>
          <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>{meta.label}</div>
        </div>
      </div>

      <Field label="产物类型">
        <select
          value={art.kind}
          disabled={allLocked}
          onChange={(e) => updateArtifact(edgeId, { kind: e.target.value as ArtifactKind })}
        >
          {ARTIFACT_KINDS.map((k) => (
            <option key={k} value={k}>
              {ARTIFACT_META[k].icon} {ARTIFACT_META[k].label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="名称">
        <CommitField
          value={art.label}
          onCommit={(v) => updateArtifact(edgeId, { label: v })}
          placeholder="中间产物名称"
          disabled={allLocked}
        />
      </Field>
      <Field label="文字说明">
        <CommitField
          value={art.description}
          onCommit={(v) => updateArtifact(edgeId, { description: v })}
          placeholder="说明该中间产物的内容…"
          multiline
          rows={4}
          disabled={allLocked}
        />
      </Field>

      <Section title="操作">
        <div className="field-row">
          <button
            className="tb-btn"
            style={{ flex: 1, justifyContent: 'center' }}
            onClick={() => setSelected({ kind: 'edge', id: edgeId })}
          >
            ← 查看连线
          </button>
          <button
            className="tb-btn danger"
            style={{ flex: 1, justifyContent: 'center' }}
            disabled={allLocked}
            onClick={() => {
              if (confirm('移除该中间产物?')) {
                setArtifact(edgeId, null);
                setSelected({ kind: 'edge', id: edgeId });
              }
            }}
          >
            🗑 移除产物
          </button>
        </div>
      </Section>
    </div>
  );
}

/* ---------------- 连线属性 ---------------- */

function EdgeProperties({ edgeId }: { edgeId: string }) {
  const edge = useGraphStore((s) => s.edges.find((e) => e.id === edgeId));
  const updateEdge = useGraphStore((s) => s.updateEdge);
  const deleteEdge = useGraphStore((s) => s.deleteEdge);
  const setArtifact = useGraphStore((s) => s.setArtifact);
  const allLocked = useGraphStore((s) => s.allLocked);
  const setSelected = useGraphStore((s) => s.setSelected);
  const nodes = useGraphStore((s) => s.nodes);

  if (!edge) return <MissingNotice />;
  const src = nodes.find((n) => n.id === edge.source);
  const dst = nodes.find((n) => n.id === edge.target);
  const art = edge.data?.artifact ?? null;

  return (
    <div>
      <div
        style={{
          fontSize: 12,
          color: 'var(--text-dim)',
          padding: '8px 10px',
          background: 'var(--bg)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          marginBottom: 14,
          lineHeight: 1.6,
        }}
      >
        <span style={{ fontWeight: 600, color: 'var(--text)' }}>
          {src?.data.label ?? '?'}
        </span>{' '}
        ⟶{' '}
        <span style={{ fontWeight: 600, color: 'var(--text)' }}>
          {dst?.data.label ?? '?'}
        </span>
      </div>

      <Field label="连线说明文字" hint="显示在连线上的说明">
        <CommitField
          value={edge.data?.label ?? ''}
          onCommit={(v) => updateEdge(edgeId, { label: v })}
          placeholder="如:质检通过后移交"
          disabled={allLocked}
        />
      </Field>

      <Section title="中间产物">
        {art ? (
          <button
            className="list-item"
            style={{ marginBottom: 6 }}
            onClick={() => setSelected({ kind: 'artifact', edgeId })}
          >
            <span className="icon-wrap" style={{ background: 'var(--bg-hover)' }}>
              {ARTIFACT_META[art.kind].icon}
            </span>
            <span className="li-main">
              <span className="li-title">{art.label || '未命名产物'}</span>
              <span className="li-sub">{art.description || '点击编辑详情'}</span>
            </span>
            <span style={{ color: 'var(--accent)', fontSize: 11 }}>编辑 ›</span>
          </button>
        ) : (
          <div className="helper" style={{ marginBottom: 8 }}>
            这条连线上还没有中间产物,可添加一个文档、图像、视频等对象。
          </div>
        )}
        {art ? (
          <button
            className="tb-btn danger"
            style={{ width: '100%', justifyContent: 'center' }}
            disabled={allLocked}
            onClick={() => setArtifact(edgeId, null)}
          >
            🗑 移除中间产物
          </button>
        ) : (
          <button
            className="tb-btn primary"
            style={{ width: '100%', justifyContent: 'center' }}
            disabled={allLocked}
            onClick={() => {
              const artifactId = uid('art');
              setArtifact(edgeId, { id: artifactId, kind: 'other', label: '新中间产物', description: '' });
              setSelected({ kind: 'artifact', edgeId });
            }}
          >
            + 添加中间产物
          </button>
        )}
      </Section>

      <Section title="操作">
        <button
          className="tb-btn danger"
          style={{ width: '100%', justifyContent: 'center' }}
          disabled={allLocked}
          onClick={() => {
            if (confirm('确定删除这条连线?')) {
              deleteEdge(edgeId);
              setSelected(null);
            }
          }}
        >
          🗑 删除连线
        </button>
      </Section>
    </div>
  );
}

function MissingNotice() {
  return (
    <div className="empty-tip">
      <div className="big">🫥</div>
      所选对象已不存在
    </div>
  );
}

/* ---------------- 主面板 ---------------- */

export default function PropertiesPanel({ onClose }: { onClose: () => void }) {
  const selected = useGraphStore((s) => s.selected);
  const allLocked = useGraphStore((s) => s.allLocked);
  const setSelected = useGraphStore((s) => s.setSelected);

  let title = '属性';
  let body: ReactNode = (
    <div className="empty-tip">
      <div className="big">🖱️</div>
      在画布中选中一个节点、连线或中间产物,
      <br />
      即可在这里编辑它的属性。
    </div>
  );

  if (selected?.kind === 'node') {
    title = '节点属性';
    body = <NodeProperties nodeId={selected.id} />;
  } else if (selected?.kind === 'edge') {
    title = '连线属性';
    body = <EdgeProperties edgeId={selected.id} />;
  } else if (selected?.kind === 'artifact') {
    title = '中间产物属性';
    body = <ArtifactProperties edgeId={selected.edgeId} />;
  }

  return (
    <aside className="panel right" style={{ width: 300 }}>
      <div className="panel-header">
        <span>{title}</span>
        <button className="panel-close" onClick={onClose} title="关闭属性面板">
          ×
        </button>
      </div>
      <div className="panel-body">
        {allLocked && (
          <div className="lock-all-banner">🔒 演示模式已锁定全部内容,点击工具栏按钮解锁</div>
        )}
        {body}
      </div>
    </aside>
  );
}
