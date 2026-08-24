import { Fragment, memo, useEffect, useMemo, useRef, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { ACTOR_META, GATEWAY_META, uid, type ActorType, type FlowNode, type PortDef } from '../types';
import { computeCompositeActor, computeCompositePorts } from '../lib/composite';
import { openCompositePopup } from '../lib/compositePopup';
import { useGraphStore } from '../store/graphStore';
import ActorIcon from './ActorIcon';
import EditableText from './EditableText';
import AnnotationBox from './AnnotationBox';

/* ------------------------------------------------------------------ */
/* 节点                                                                */
/* ------------------------------------------------------------------ */
function FlowNodeComponent({ id, data, selected }: NodeProps<FlowNode>) {
  const locked = !!data.locked;
  const allLocked = useGraphStore((s) => s.allLocked);
  const disabled = locked || allLocked;
  const setSelected = useGraphStore((s) => s.setSelected);
  const updateNode = useGraphStore((s) => s.updateNode);
  const removePort = useGraphStore((s) => s.removePort);
  const setNodeDraggable = useGraphStore((s) => s.setNodeDraggable);
  const edges = useGraphStore((s) => s.edges);
  const allNodes = useGraphStore((s) => s.nodes);
  const toggleComposite = useGraphStore((s) => s.toggleComposite);
  const openCompositeTab = useGraphStore((s) => s.openCompositeTab);
  const pendingAutoEdit = useGraphStore((s) => s.pendingAutoEdit);
  const requestAutoEdit = useGraphStore((s) => s.requestAutoEdit);
  const annotations = useGraphStore((s) => s.annotations);
  const addAnnotation = useGraphStore((s) => s.addAnnotation);
  const updateAnnotation = useGraphStore((s) => s.updateAnnotation);
  const deleteAnnotation = useGraphStore((s) => s.deleteAnnotation);
  const toggleAnnotationCollapsed = useGraphStore((s) => s.toggleAnnotationCollapsed);

  const composite = data.composite;
  // 归属本节点的注释(节点归属)
  const nodeAnnots = useMemo(
    () => annotations.filter((a) => a.target.kind === 'node' && a.target.nodeId === id),
    [annotations, id],
  );
  // 悬停节点(无注释时悬停显示添加 pin;离开后延迟隐藏,留出移入 pin 的时间)
  const [nodeHovered, setNodeHovered] = useState(false);
  const nodeHoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enterNodeHover = () => {
    if (nodeHoverTimer.current) clearTimeout(nodeHoverTimer.current);
    setNodeHovered(true);
  };
  const leaveNodeHover = () => {
    if (nodeHoverTimer.current) clearTimeout(nodeHoverTimer.current);
    nodeHoverTimer.current = setTimeout(() => setNodeHovered(false), 350);
  };

  // 消费完自动编辑标记后清除(防止残留导致后续误触发)
  const consumeAutoEdit = () => requestAutoEdit(null);

  // 组合节点的子节点(用于计算继承的执行主体)
  const children = useMemo(
    () => (composite ? allNodes.filter((n) => composite.childIds.includes(n.id)) : []),
    [composite, allNodes],
  );

  // 组合节点的执行主体继承自内部节点(全同则同、混杂则人机协同,支持嵌套递归),
  // 不允许用户手动选择;普通节点使用自身的 actor。
  const nodesById = useMemo(
    () => new Map(allNodes.map((n) => [n.id, n])),
    [allNodes],
  );
  const effectiveActor = composite
    ? computeCompositeActor(children, nodesById)
    : (data.actor as ActorType);
  const actor = ACTOR_META[effectiveActor];

  // 执行主体外框颜色类名(用于节点边框按人/机器/人机协同着色)
  const actorClass = `nf-actor-${effectiveActor}`;
  // 组合节点无论展开/塌缩都实时计算聚合端口(嵌套时递归展平内层聚合端口):
  // 展开态用于对外连线,塌缩态用于展示聚合端口
  const aggPorts = useMemo(
    () => (composite ? computeCompositePorts(children, edges, nodesById) : null),
    [composite, children, edges, nodesById],
  );

  // 统计每个端口是否已有连线(用于端口光晕:已连接绿 / 未连接桔)。
  // 按「节点id:端口id」精确匹配,避免不同节点同名端口(如 in_1/out_1)被误判为已连接。
  const connectedHandles = useMemo(() => {
    const set = new Set<string>();
    for (const e of edges) {
      if (e.sourceHandle) set.add(e.source + ':' + e.sourceHandle);
      if (e.targetHandle) set.add(e.target + ':' + e.targetHandle);
    }
    return set;
  }, [edges]);

  const handleClass = (side: 'i' | 'o', portId: string) => {
    const ref = id + ':' + portId;
    return connectedHandles.has(ref) ? 'nf-connected' : 'nf-disconnected';
  };

  const updateInputs = (inputs: PortDef[]) => updateNode(id, { inputs });
  const updateOutputs = (outputs: PortDef[]) => updateNode(id, { outputs });

  const addInput = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (disabled) return;
    const pid = uid('in');
    updateInputs([...data.inputs, { id: pid, name: `输入${data.inputs.length + 1}` }]);
    // 新端点创建后默认进入 label 编辑模式
    requestAutoEdit({ kind: 'port-label', nodeId: id, portId: pid });
  };

  const addOutput = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (disabled) return;
    const pid = uid('out');
    updateOutputs([...data.outputs, { id: pid, name: `输出${data.outputs.length + 1}` }]);
    // 新端点创建后默认进入 label 编辑模式
    requestAutoEdit({ kind: 'port-label', nodeId: id, portId: pid });
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

  /* ---------------- BPMN 网关节点(菱形) ---------------- */
  if (data.gateway) {
    const gw = GATEWAY_META[data.gateway.type];
    return (
      <div
        className={`nf-gateway ${selected ? 'selected' : ''} ${disabled ? 'locked' : ''}`}
        style={{ ['--gw-color' as string]: gw.color }}
        onDoubleClick={stopDoubleClick}
        onMouseEnter={enterNodeHover}
        onMouseLeave={leaveNodeHover}
      >
        {/* 输入 Handle(左,以菱形左顶点为中轴上下对称,离角稍留间距),可继续添加 */}
        <div className="nf-gateway-in">
          {data.inputs.map((p, i) => {
            const nIn = Math.max(data.inputs.length, 1);
            const stepIn = nIn <= 2 ? 40 : 34;
            const top = 105 - ((nIn - 1) / 2) * stepIn + i * stepIn;
            return (
              <Fragment key={p.id}>
                <Handle
                  id={p.id}
                  type="target"
                  position={Position.Left}
                  isConnectable
                  className={handleClass('i', p.id)}
                  style={{ left: 90, top }}
                />
                <div className="nf-gateway-branch left" style={{ top: top - 4 }}>
                  <EditableText
                    className="port-label"
                    value={p.name}
                    placeholder="输入"
                    disabled={disabled}
                    onCommit={(v) => updateNode(id, { inputs: data.inputs.map((o) => (o.id === p.id ? { ...o, name: v } : o)) })}
                    onEditingChange={(editing) => setNodeDraggable(id, !editing)}
                  />
                  {!disabled && data.inputs.length > 1 && (
                    <button
                      className="port-remove"
                      title="删除该输入端口(至少保留 1 个)"
                      onClick={(e) => {
                        e.stopPropagation();
                        removePort(id, 'input', p.id);
                      }}
                    >
                      ×
                    </button>
                  )}
                </div>
              </Fragment>
            );
          })}
        </div>
        {/* 菱形主体 */}
        <div className="nf-gateway-diamond">
          <span className="nf-gateway-mark" title={gw.label}>
            {gw.mark}
          </span>
          <EditableText
            className="nf-gateway-name"
            value={data.label}
            placeholder={gw.label}
            disabled={disabled}
            onCommit={(v) => updateNode(id, { label: v })}
            onEditingChange={(editing) => setNodeDraggable(id, !editing)}
            title={gw.label}
          />
        </div>
        {/* 执行主体图标(人/机器/人机协同,点击轮换) */}
        <button
          className="nf-gateway-actor"
          title={disabled ? '演示模式已锁定' : `执行主体:${ACTOR_META[data.actor as ActorType].label} · 点击轮换`}
          onClick={cycleActor}
          disabled={disabled}
        >
          <ActorIcon actor={data.actor as ActorType} size={20} />
        </button>
        {/* 锁定按钮(左下角) */}
        <button
          className={`nf-gateway-lock ${locked ? 'locked' : ''}`}
          title={allLocked ? '演示模式已锁定全部内容' : locked ? '网关已锁定,点击解锁' : '网关未锁定,点击锁定'}
          onClick={toggleLock}
          disabled={allLocked}
        >
          {locked ? '🔒' : '🔓'}
        </button>
        {/* 输出分支 Handle(右,贴菱形右缘按高度分散),可继续添加 */}
        <div className="nf-gateway-out">
          {data.outputs.map((p, i) => {
            // 分支数 n:第 i 个端点以菱形右顶点(top:110)为中轴上下对称
            const n = Math.max(data.outputs.length, 1);
            const step = n <= 2 ? 40 : 34;
            const top = 110 - ((n - 1) / 2) * step + i * step;
            return (
              <Fragment key={p.id}>
                <Handle
                  id={p.id}
                  type="source"
                  position={Position.Right}
                  isConnectable
                  className={handleClass('o', p.id)}
                  style={{ left: 283, top }}
                />
                <div className="nf-gateway-branch" style={{ top: top - 4 }}>
                  {!disabled && data.outputs.length > 1 && (
                    <button
                      className="port-remove"
                      title="删除该分支(至少保留 1 个)"
                      onClick={(e) => {
                        e.stopPropagation();
                        removePort(id, 'output', p.id);
                      }}
                    >
                      ×
                    </button>
                  )}
                  <EditableText
                    className="port-label"
                    value={p.name}
                    placeholder="分支"
                    disabled={disabled}
                    onCommit={(v) => updateNode(id, { outputs: data.outputs.map((o) => (o.id === p.id ? { ...o, name: v } : o)) })}
                    onEditingChange={(editing) => setNodeDraggable(id, !editing)}
                  />
                </div>
              </Fragment>
            );
          })}
        </div>
        {/* 添加输入/分支 + 按钮:独立顶层容器,放菱形左右外侧,保证可见可点 */}
        <div className="nf-gateway-adds">
          <button
            className="gw-add"
            title={disabled ? '内容已锁定,无法添加输入端口' : '添加输入端口'}
            onClick={addInput}
            disabled={disabled}
            style={{
              left: 96,
              top: 105 + ((Math.max(data.inputs.length, 1) - 1) / 2) * (data.inputs.length <= 2 ? 40 : 34) + 30,
            }}
          >
            +
          </button>
          <button
            className="gw-add"
            title={disabled ? '内容已锁定,无法添加分支' : '添加分支'}
            disabled={disabled}
            style={{
              left: 262,
              top: 110 + ((Math.max(data.outputs.length, 1) - 1) / 2) * (data.outputs.length <= 2 ? 40 : 34) + 30,
            }}
            onClick={(e) => {
              e.stopPropagation();
              if (disabled) return;
              const pid = uid('out');
              updateOutputs([...data.outputs, { id: pid, name: `分支${data.outputs.length + 1}` }]);
            }}
          >
            +
          </button>
        </div>
        {/* 网关注释 pin(悬停在锁定键下方显示;有注释则持续显示) */}
        {nodeAnnots.length === 0 ? (
          nodeHovered && (
            <div className="nf-gateway-annot">
              <button
                className="node-annot-btn pin"
                title="添加注释"
                onMouseEnter={enterNodeHover}
                onMouseLeave={leaveNodeHover}
                onClick={(e) => {
                  e.stopPropagation();
                  addAnnotation({ kind: 'node', nodeId: id });
                }}
              >
                📌
              </button>
            </div>
          )
        ) : !nodeAnnots[0].collapsed ? null : (
          <div className="nf-gateway-annot">
            <button
              className="node-annot-btn pin has"
              title={nodeAnnots[0].title || '注释'}
              onClick={(e) => {
                e.stopPropagation();
                toggleAnnotationCollapsed(nodeAnnots[0].id);
              }}
            >
              📌
            </button>
          </div>
        )}
      </div>
    );
  }

  /* ---------------- 普通节点 ---------------- */
  if (!composite) {
    return (
      <div
        className={`nf-node ${actorClass} ${selected ? 'selected' : ''} ${disabled ? 'locked' : ''}`}
        onDoubleClick={stopDoubleClick}
        onMouseEnter={enterNodeHover}
        onMouseLeave={leaveNodeHover}
      >
        {/* 头部:主体图标 + 可编辑标题 + 右上角主体轮换按钮/锁定按钮 */}
        <div className="node-header">
          <ActorIcon actor={data.actor} size={22} className="node-actor" title={`执行主体:${actor.label}`} />
          <EditableText
            className="node-title"
            value={data.label}
            placeholder="未命名节点"
            disabled={disabled}
            onCommit={(v) => updateNode(id, { label: v })}
            onEditingChange={(editing) => setNodeDraggable(id, !editing)}
            title={data.label || '未命名节点'}
            autoFocus={pendingAutoEdit?.kind === 'node-title' && pendingAutoEdit.id === id}
            onAutoFocusConsumed={consumeAutoEdit}
          />
          <div className="node-actions">
            <button
              className="node-actor-btn"
              style={{ color: actor.color }}
              onClick={cycleActor}
              disabled={disabled}
              title={disabled ? '演示模式已锁定' : `执行主体:${actor.label} · 点击轮换`}
            >
              <ActorIcon actor={data.actor} size={19} />
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

        {/* 描述:双击编辑 */}
        <EditableText
          className="node-desc"
          value={data.description}
          placeholder="暂无描述"
          multiline
          disabled={disabled}
          onCommit={(v) => updateNode(id, { description: v })}
          onEditingChange={(editing) => setNodeDraggable(id, !editing)}
          title={disabled ? undefined : '双击编辑描述'}
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
                  onEditingChange={(editing) => setNodeDraggable(id, !editing)}
                  autoFocus={
                    pendingAutoEdit?.kind === 'port-label' &&
                    pendingAutoEdit.nodeId === id &&
                    pendingAutoEdit.portId === p.id
                  }
                  onAutoFocusConsumed={consumeAutoEdit}
                />
                {!composite && !disabled && data.inputs.length > 1 && (
                  <button
                    className="port-remove"
                    title="删除该输入端口(至少保留 1 个)"
                    onClick={(e) => {
                      e.stopPropagation();
                      removePort(id, 'input', p.id);
                    }}
                  >
                    ×
                  </button>
                )}
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
                {!composite && !disabled && data.outputs.length > 1 && (
                  <button
                    className="port-remove"
                    title="删除该输出端口(至少保留 1 个)"
                    onClick={(e) => {
                      e.stopPropagation();
                      removePort(id, 'output', p.id);
                    }}
                  >
                    ×
                  </button>
                )}
                <EditableText
                  className="port-label"
                  value={p.name}
                  placeholder="输出"
                  disabled={disabled}
                  onCommit={(v) => renameOutput(p.id, v)}
                  onEditingChange={(editing) => setNodeDraggable(id, !editing)}
                  autoFocus={
                    pendingAutoEdit?.kind === 'port-label' &&
                    pendingAutoEdit.nodeId === id &&
                    pendingAutoEdit.portId === p.id
                  }
                  onAutoFocusConsumed={consumeAutoEdit}
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
        {/* 节点注释:红色 pin。无注释时悬停显示;有注释收起时持续显示;展开时不显示 */}
        {nodeAnnots.length === 0 ? (
          nodeHovered && (
            <div className="node-annot-area">
              <button
                className="node-annot-btn pin"
                title="添加注释"
                onMouseEnter={enterNodeHover}
                onMouseLeave={leaveNodeHover}
                onClick={(e) => {
                  e.stopPropagation();
                  addAnnotation({ kind: 'node', nodeId: id });
                }}
              >
                📌
              </button>
            </div>
          )
        ) : !nodeAnnots[0].collapsed ? null : (
          <div className="node-annot-area">
            <button
              className="node-annot-btn pin has"
              title={nodeAnnots[0].title || '注释'}
              onClick={(e) => {
                e.stopPropagation();
                toggleAnnotationCollapsed(nodeAnnots[0].id);
              }}
            >
              📌
            </button>
          </div>
        )}
      </div>
    );
  }

  /* ---------------- 组合节点:展开态(虚线框包裹内部节点) ---------------- */
  if (composite.expanded) {
    return (
      <div
        className={`nf-node nf-composite-frame ${actorClass} ${selected ? 'selected' : ''} ${disabled ? 'locked' : ''}`}
        style={{ width: '100%', height: '100%', ['--nf-frame' as string]: actor.frame }}
        onMouseEnter={enterNodeHover}
        onMouseLeave={leaveNodeHover}
      >
        <div className="composite-frame-bar">
          <ActorIcon
            actor={effectiveActor}
            size={20}
            title={`组合节点 · 执行主体:${actor.label}(自动继承自内部节点)`}
          />
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
        {/* 展开态虚线框仅为逻辑边界,不作为实际节点:无聚合端口,连线直接连到内部节点 */}
        {/* 组合节点注释 pin(操作逻辑与普通节点相同) */}
        {nodeAnnots.length === 0 ? (
        nodeHovered && (
          <div className="node-annot-area">
            <button
              className="node-annot-btn pin"
              title="添加注释"
              onMouseEnter={enterNodeHover}
              onMouseLeave={leaveNodeHover}
              onClick={(e) => {
                e.stopPropagation();
                addAnnotation({ kind: 'node', nodeId: id });
              }}
            >
              📌
            </button>
          </div>
        )
      ) : !nodeAnnots[0].collapsed ? null : (
        <div className="node-annot-area">
          <button
            className="node-annot-btn pin has"
            title={nodeAnnots[0].title || '注释'}
            onMouseEnter={enterNodeHover}
            onMouseLeave={leaveNodeHover}
            onClick={(e) => {
              e.stopPropagation();
              toggleAnnotationCollapsed(nodeAnnots[0].id);
            }}
          >
            📌
          </button>
        </div>
      )}
      </div>
    );
  }

  /* ---------------- 组合节点:塌缩态(粗边框 + 聚合端口) ---------------- */
  return (
    <div
      className={`nf-node nf-composite-node ${actorClass} ${selected ? 'selected' : ''} ${disabled ? 'locked' : ''}`}
      style={{ ['--nf-frame' as string]: actor.frame }}
      onDoubleClick={toggleExpand}
      onMouseEnter={enterNodeHover}
      onMouseLeave={leaveNodeHover}
    >
      <div className="node-header">
        <ActorIcon
          actor={effectiveActor}
          size={24}
          className="node-actor"
          title={`组合节点 · 执行主体:${actor.label}(自动继承自内部节点)`}
        />
        <EditableText
          className="node-title"
          value={data.label}
          placeholder="未命名组合"
          disabled={disabled}
          onCommit={(v) => updateNode(id, { label: v })}
          onEditingChange={(editing) => setNodeDraggable(id, !editing)}
          title={data.label || '未命名组合'}
        />
        <div className="node-actions">
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
        onEditingChange={(editing) => setNodeDraggable(id, !editing)}
        title={disabled ? undefined : '双击编辑描述'}
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
      {/* 组合节点注释 pin(操作逻辑与普通节点相同) */}
      {nodeAnnots.length === 0 ? (
        nodeHovered && (
          <div className="node-annot-area">
            <button
              className="node-annot-btn pin"
              title="添加注释"
              onMouseEnter={enterNodeHover}
              onMouseLeave={leaveNodeHover}
              onClick={(e) => {
                e.stopPropagation();
                addAnnotation({ kind: 'node', nodeId: id });
              }}
            >
              📌
            </button>
          </div>
        )
      ) : !nodeAnnots[0].collapsed ? null : (
        <div className="node-annot-area">
          <button
            className="node-annot-btn pin has"
            title={nodeAnnots[0].title || '注释'}
            onMouseEnter={enterNodeHover}
            onMouseLeave={leaveNodeHover}
            onClick={(e) => {
              e.stopPropagation();
              toggleAnnotationCollapsed(nodeAnnots[0].id);
            }}
          >
            📌
          </button>
        </div>
      )}
    </div>
  );
}

export default memo(FlowNodeComponent);
