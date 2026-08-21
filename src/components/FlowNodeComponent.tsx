import { memo, useEffect, useMemo, useRef } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { ACTOR_META, uid, type ActorType, type FlowNode, type PortDef } from '../types';
import { computeCompositePorts } from '../lib/composite';
import { openCompositePopup } from '../lib/compositePopup';
import { useGraphStore } from '../store/graphStore';

/* ------------------------------------------------------------------ */
/* 可内联编辑的文本:单击进入编辑(显示外框),光标可定位,失焦/回车提交       */
/* ------------------------------------------------------------------ */
interface EditableTextProps {
  value: string;
  onCommit: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  disabled?: boolean;
  className?: string;
  title?: string;
}

function EditableText({
  value,
  onCommit,
  placeholder,
  multiline,
  disabled,
  className,
  title,
}: EditableTextProps) {
  const ref = useRef<HTMLDivElement>(null);
  const editingRef = useRef(false);

  // 外部值变化且当前不在编辑时,把最新值同步进 DOM(contentEditable 不受控)
  useEffect(() => {
    if (ref.current && !editingRef.current && ref.current.innerText !== value) {
      ref.current.innerText = value;
    }
  }, [value]);

  const commit = () => {
    editingRef.current = false;
    const el = ref.current;
    if (!el) return;
    let next = el.innerText;
    if (!multiline) {
      next = next.replace(/\s+/g, ' ').trim();
    } else {
      next = next.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trimEnd();
    }
    if (next !== value) onCommit(next);
    // 无论是否提交,把 DOM 重置为最终值,清掉编辑留下的多余空行/占位符
    el.innerText = next;
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && !multiline) {
      e.preventDefault();
      e.currentTarget.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      const el = e.currentTarget;
      el.innerText = value;
      el.blur();
    }
  };

  return (
    <div
      ref={ref}
      className={[className, 'nf-editable'].filter(Boolean).join(' ')}
      contentEditable={!disabled}
      suppressContentEditableWarning
      data-placeholder={placeholder}
      title={title}
      spellCheck={false}
      onFocus={() => {
        editingRef.current = true;
      }}
      onBlur={commit}
      onKeyDown={handleKeyDown}
    />
  );
}

/* ------------------------------------------------------------------ */
/* 节点                                                                */
/* ------------------------------------------------------------------ */
function FlowNodeComponent({ id, data, selected }: NodeProps<FlowNode>) {
  const actor = ACTOR_META[data.actor];
  const locked = !!data.locked;
  const allLocked = useGraphStore((s) => s.allLocked);
  const disabled = locked || allLocked;
  const setSelected = useGraphStore((s) => s.setSelected);
  const updateNode = useGraphStore((s) => s.updateNode);
  const edges = useGraphStore((s) => s.edges);
  const allNodes = useGraphStore((s) => s.nodes);
  const toggleComposite = useGraphStore((s) => s.toggleComposite);
  const openCompositeTab = useGraphStore((s) => s.openCompositeTab);

  const composite = data.composite;

  // 组合节点的子节点与聚合端口(仅塌缩态需要)
  const children = useMemo(
    () => (composite ? allNodes.filter((n) => composite.childIds.includes(n.id)) : []),
    [composite, allNodes],
  );
  // 组合节点无论展开/塌缩都实时计算聚合端口:展开态用于对外连线,塌缩态用于展示聚合端口
  const aggPorts = useMemo(
    () => (composite ? computeCompositePorts(children, edges) : null),
    [composite, children, edges],
  );

  // 统计每个端口是否已有连线(用于端口光晕:已连接绿 / 未连接桔)
  const connectedHandles = useMemo(() => {
    const set = new Set<string>();
    for (const e of edges) {
      if (e.sourceHandle) set.add('o:' + e.sourceHandle);
      if (e.targetHandle) set.add('i:' + e.targetHandle);
    }
    return set;
  }, [edges]);

  const handleClass = (side: 'i' | 'o', portId: string) =>
    connectedHandles.has(side + ':' + portId) ? 'nf-connected' : 'nf-disconnected';

  const updateInputs = (inputs: PortDef[]) => updateNode(id, { inputs });
  const updateOutputs = (outputs: PortDef[]) => updateNode(id, { outputs });

  const addInput = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (disabled) return;
    updateInputs([...data.inputs, { id: uid('in'), name: `输入${data.inputs.length + 1}` }]);
  };

  const addOutput = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (disabled) return;
    updateOutputs([...data.outputs, { id: uid('out'), name: `输出${data.outputs.length + 1}` }]);
  };

  const renameInput = (pid: string, name: string) =>
    updateInputs(data.inputs.map((p) => (p.id === pid ? { ...p, name } : p)));
  const renameOutput = (pid: string, name: string) =>
    updateOutputs(data.outputs.map((p) => (p.id === pid ? { ...p, name } : p)));

  /** 人工 → 人机协同 → 机器 → 人工 轮换 */
  const cycleActor = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (disabled) return;
    const order: ActorType[] = ['human', 'hybrid', 'machine'];
    const next = order[(order.indexOf(data.actor) + 1) % order.length];
    updateNode(id, { actor: next });
  };

  const toggleLock = (e: React.MouseEvent) => {
    e.stopPropagation();
    // 全局锁定时不允许单独解锁
    if (allLocked) return;
    updateNode(id, { locked: !locked });
  };

  const toggleExpand = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleComposite(id);
  };

  const openTab = (e: React.MouseEvent) => {
    e.stopPropagation();
    openCompositeTab(id);
  };

  const lockTitle = allLocked
    ? '演示模式已锁定全部内容'
    : locked
      ? '节点已锁定,点击解锁'
      : '节点未锁定,点击锁定';

  const stopDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setSelected({ kind: 'node', id });
  };

  /* ---------------- 普通节点 ---------------- */
  if (!composite) {
    return (
      <div
        className={`nf-node ${selected ? 'selected' : ''} ${disabled ? 'locked' : ''}`}
        onDoubleClick={stopDoubleClick}
      >
        {/* 头部:主体图标 + 可编辑标题 + 右上角主体轮换按钮/锁定按钮 */}
        <div className="node-header">
          <span
            className="node-actor"
            style={{ background: actor.bg, color: actor.color }}
            title={`执行主体:${actor.label}`}
          >
            {actor.icon}
          </span>
          <EditableText
            className="node-title"
            value={data.label}
            placeholder="未命名节点"
            disabled={disabled}
            onCommit={(v) => updateNode(id, { label: v })}
            title={data.label || '未命名节点'}
          />
          <div className="node-actions">
            <button
              className="node-actor-btn"
              style={{ background: actor.bg, color: actor.color }}
              onClick={cycleActor}
              disabled={disabled}
              title={disabled ? '演示模式已锁定' : `执行主体:${actor.label} · 点击轮换`}
            >
              {actor.icon}
            </button>
            <button
              className={`node-lock-btn ${locked ? 'locked' : ''}`}
              onClick={toggleLock}
              disabled={allLocked}
              title={lockTitle}
            >
              {locked ? '🔒' : '🔓'}
            </button>
          </div>
        </div>

        {/* 描述:单击直接编辑 */}
        <EditableText
          className="node-desc"
          value={data.description}
          placeholder="暂无描述"
          multiline
          disabled={disabled}
          onCommit={(v) => updateNode(id, { description: v })}
          title={disabled ? undefined : '单击编辑描述'}
        />

        {/* 端口区:输入在左,输出在右 */}
        <div className="node-body">
          <div className="node-ports">
            {data.inputs.length > 0 && <div className="port-group-title">输入</div>}
            {data.inputs.map((p) => (
              <div key={p.id} className="port in">
                <Handle
                  id={p.id}
                  type="target"
                  position={Position.Left}
                  isConnectable
                  className={handleClass('i', p.id)}
                />
                <EditableText
                  className="port-label"
                  value={p.name}
                  placeholder="输入"
                  disabled={disabled}
                  onCommit={(v) => renameInput(p.id, v)}
                />
              </div>
            ))}
            <button
              className="port-add in"
              title={disabled ? '内容已锁定,无法添加端口' : '添加输入端口'}
              onClick={addInput}
              disabled={disabled}
            >
              +
            </button>
          </div>
          <div className="node-ports">
            {data.outputs.length > 0 && (
              <div className="port-group-title" style={{ textAlign: 'right' }}>
                输出
              </div>
            )}
            {data.outputs.map((p) => (
              <div key={p.id} className="port out" style={{ justifyContent: 'flex-end' }}>
                <EditableText
                  className="port-label"
                  value={p.name}
                  placeholder="输出"
                  disabled={disabled}
                  onCommit={(v) => renameOutput(p.id, v)}
                />
                <Handle
                  id={p.id}
                  type="source"
                  position={Position.Right}
                  isConnectable
                  className={handleClass('o', p.id)}
                />
              </div>
            ))}
            <button
              className="port-add out"
              title={disabled ? '内容已锁定,无法添加端口' : '添加输出端口'}
              onClick={addOutput}
              disabled={disabled}
            >
              +
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ---------------- 组合节点:展开态(虚线框包裹内部节点) ---------------- */
  if (composite.expanded) {
    return (
      <div
        className={`nf-node nf-composite-frame ${selected ? 'selected' : ''} ${disabled ? 'locked' : ''}`}
        style={{ width: '100%', height: '100%' }}
      >
        <div className="composite-frame-bar">
          <span className="composite-frame-icon">⧉</span>
          <EditableText
            className="node-title"
            value={data.label}
            placeholder="未命名组合"
            disabled={disabled}
            onCommit={(v) => updateNode(id, { label: v })}
            title={data.label || '未命名组合'}
          />
          <div className="node-actions">
            <button
              className="node-ctl-btn"
              onClick={toggleExpand}
              disabled={disabled}
              title={disabled ? '演示模式已锁定' : '塌缩组合节点,收起内部节点'}
            >
              ◀
            </button>
            <button
              className="node-ctl-btn"
              onClick={openTab}
              disabled={disabled}
              title="在标签页中打开内部画布"
            >
              🖼
            </button>
            <button
              className="node-ctl-btn"
              onClick={(e) => {
                e.stopPropagation();
                openCompositePopup(id);
              }}
              disabled={disabled}
              title="在新窗口弹出内部画布"
            >
              ⇱
            </button>
            <button
              className={`node-lock-btn ${locked ? 'locked' : ''}`}
              onClick={toggleLock}
              disabled={allLocked}
              title={lockTitle}
            >
              {locked ? '🔒' : '🔓'}
            </button>
          </div>
        </div>
        <div className="composite-frame-hint">{children.length} 个内部节点</div>
        {/* 展开态也提供聚合端口,便于直接对外连线(端口 id 为 cid: 编码,与塌缩态一致) */}
        <div className="composite-frame-ports">
          <div className="nf-ports-in">
            {(aggPorts?.inputs ?? []).map((p) => (
              <Handle
                key={p.id}
                id={p.id}
                type="target"
                position={Position.Left}
                isConnectable
                className={handleClass('i', p.id)}
                title={`${p.name} · 来自内部节点`}
              />
            ))}
          </div>
          <div className="nf-ports-out">
            {(aggPorts?.outputs ?? []).map((p) => (
              <Handle
                key={p.id}
                id={p.id}
                type="source"
                position={Position.Right}
                isConnectable
                className={handleClass('o', p.id)}
                title={`${p.name} · 来自内部节点`}
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  /* ---------------- 组合节点:塌缩态(粗边框 + 聚合端口) ---------------- */
  return (
    <div
      className={`nf-node nf-composite-node ${selected ? 'selected' : ''} ${disabled ? 'locked' : ''}`}
      onDoubleClick={toggleExpand}
    >
      <div className="node-header">
        <span
          className="node-actor"
          style={{ background: actor.bg, color: actor.color }}
          title={`组合节点 · 执行主体:${actor.label}`}
        >
          ⧉
        </span>
        <EditableText
          className="node-title"
          value={data.label}
          placeholder="未命名组合"
          disabled={disabled}
          onCommit={(v) => updateNode(id, { label: v })}
          title={data.label || '未命名组合'}
        />
        <div className="node-actions">
          <button
            className="node-actor-btn"
            style={{ background: actor.bg, color: actor.color }}
            onClick={cycleActor}
            disabled={disabled}
            title={disabled ? '演示模式已锁定' : `执行主体:${actor.label} · 点击轮换`}
          >
            {actor.icon}
          </button>
          <button
            className="node-ctl-btn"
            onClick={toggleExpand}
            disabled={disabled}
            title={disabled ? '演示模式已锁定' : '展开组合节点,显示内部节点(虚线框)'}
          >
            ▶
          </button>
          <button
            className="node-ctl-btn"
            onClick={openTab}
            disabled={disabled}
            title="在标签页中打开内部画布"
          >
            🖼
          </button>
          <button
            className={`node-lock-btn ${locked ? 'locked' : ''}`}
            onClick={toggleLock}
            disabled={allLocked}
            title={lockTitle}
          >
            {locked ? '🔒' : '🔓'}
          </button>
        </div>
      </div>

      <EditableText
        className="node-desc"
        value={data.description}
        placeholder="暂无描述"
        multiline
        disabled={disabled}
        onCommit={(v) => updateNode(id, { description: v })}
        title={disabled ? undefined : '单击编辑描述'}
      />

      {/* 聚合端口:自动来自内部节点,只读显示 */}
      <div className="node-body">
        <div className="node-ports">
          <div className="port-group-title">输入</div>
          {(!aggPorts || aggPorts.inputs.length === 0) && (
            <div className="port-empty">无输入</div>
          )}
          {(aggPorts?.inputs ?? []).map((p) => (
            <div key={p.id} className="port in">
              <Handle
                id={p.id}
                type="target"
                position={Position.Left}
                isConnectable
                className={handleClass('i', p.id)}
              />
              <span className="port-label static" title={`${p.name} · 来自内部节点`}>
                {p.name}
              </span>
            </div>
          ))}
        </div>
        <div className="node-ports">
          <div className="port-group-title" style={{ textAlign: 'right' }}>
            输出
          </div>
          {(!aggPorts || aggPorts.outputs.length === 0) && (
            <div className="port-empty" style={{ textAlign: 'right' }}>
              无输出
            </div>
          )}
          {(aggPorts?.outputs ?? []).map((p) => (
            <div key={p.id} className="port out" style={{ justifyContent: 'flex-end' }}>
              <span className="port-label static" title={`${p.name} · 来自内部节点`}>
                {p.name}
              </span>
              <Handle
                id={p.id}
                type="source"
                position={Position.Right}
                isConnectable
                className={handleClass('o', p.id)}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default memo(FlowNodeComponent);
