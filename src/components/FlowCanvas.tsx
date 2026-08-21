import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  SelectionMode,
  useReactFlow,
  type NodeMouseHandler,
  type EdgeMouseHandler,
  type NodeTypes,
  type EdgeTypes,
  type Connection,
  type FinalConnectionState,
} from '@xyflow/react';
import FlowNodeComponent from './FlowNodeComponent';
import FlowEdgeComponent from './FlowEdgeComponent';
import ContextMenu, { type ContextMenuState } from './ContextMenu';
import ConfirmDialog, { type ConfirmDialogState } from './ConfirmDialog';
import { useGraphStore } from '../store/graphStore';
import type { FlowNode, FlowEdge, EdgeStyle } from '../types';

const nodeTypes: NodeTypes = { flow: FlowNodeComponent };
const edgeTypes: EdgeTypes = { flow: FlowEdgeComponent };

export default function FlowCanvas() {
  // 左上角操作提示框:默认展开,可缩小为小胶囊
  const [hintOpen, setHintOpen] = useState(true);

  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const viewport = useGraphStore((s) => s.viewport);
  const onNodesChange = useGraphStore((s) => s.onNodesChange);
  const onEdgesChange = useGraphStore((s) => s.onEdgesChange);
  const onConnect = useGraphStore((s) => s.onConnect);
  const onViewportChange = useGraphStore((s) => s.onViewportChange);
  const setSelected = useGraphStore((s) => s.setSelected);
  const addNode = useGraphStore((s) => s.addNode);
  const addNodeToComposite = useGraphStore((s) => s.addNodeToComposite);
  const markHistory = useGraphStore((s) => s.markHistory);
  const theme = useGraphStore((s) => s.theme);
  const allLocked = useGraphStore((s) => s.allLocked);
  const activeTabId = useGraphStore((s) => s.activeTabId);
  const toggleLockAll = useGraphStore((s) => s.toggleLockAll);
  const edgeStyle = useGraphStore((s) => s.edgeStyle);
  const setEdgeStyle = useGraphStore((s) => s.setEdgeStyle);
  const saveNow = useGraphStore((s) => s.saveNow);
  const exportJson = useGraphStore((s) => s.exportJson);
  const duplicateNode = useGraphStore((s) => s.duplicateNode);
  const deleteNode = useGraphStore((s) => s.deleteNode);
  const groupSelected = useGraphStore((s) => s.groupSelected);
  const ungroup = useGraphStore((s) => s.ungroup);
  const toggleLock = (id: string) => {
    const n = useGraphStore.getState().nodes.find((x) => x.id === id);
    if (!n) return;
    useGraphStore.getState().updateNode(id, { locked: !n.data.locked });
  };

  // 右键菜单状态
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  // 删除确认对话框
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const closeConfirmDialog = useCallback(() => setConfirmDialog(null), []);
  // 画布容器 ref,用于原生双击检测
  const flowAreaRef = useRef<HTMLDivElement>(null);

  // Delete / Backspace 删除前确认。
  // React Flow 12 的 onBeforeDelete 对 Promise<boolean> 返回值处理不可靠(多选删除会失效),
  // 因此此处始终返回 false 阻止 React Flow 自动删除,改为确认后手动删除待删除节点。
  const pendingDeleteRef = useRef<FlowNode[]>([]);
  const handleBeforeDelete = useCallback(
    ({ nodes }: { nodes: FlowNode[] }) => {
      if (allLocked) return Promise.resolve(false);
      if (!nodes.length) return Promise.resolve(false);
      pendingDeleteRef.current = nodes;
      const label =
        nodes.length > 1
          ? `确定删除选中的 ${nodes.length} 个节点?`
          : `确定删除节点「${nodes[0].data.label || '未命名'}」?`;
      setConfirmDialog({
        title: '删除确认',
        message: `${label}\n撤销删除(Ctrl+Z)可还原节点及其连线关系。`,
        confirmLabel: '删除',
        cancelLabel: '取消',
        danger: true,
        onConfirm: () => {
          // 确认后手动删除(store 会清理关联连线,撤销可完整还原)
          const toDelete = pendingDeleteRef.current;
          pendingDeleteRef.current = [];
          toDelete.forEach((n) => {
            const st = useGraphStore.getState();
            if (st.nodes.some((x) => x.id === n.id)) st.deleteNode(n.id);
          });
        },
        onCancel: () => {
          pendingDeleteRef.current = [];
        },
      });
      return Promise.resolve(false); // 阻止 React Flow 自动删除,由 onConfirm 手动处理
    },
    [allLocked, setConfirmDialog],
  );

  // 记录「右键是否处于拖拽平移中」,用于右键松开时不弹菜单
  const rightDragRef = useRef(false);

  const { screenToFlowPosition, fitView } = useReactFlow();
  const isDark = theme === 'dark';

  const handlePaneClick = useCallback(() => setSelected(null), [setSelected]);

  /** 根据当前标签页过滤出实际渲染的节点与连线 */
  const { displayNodes, displayEdges } = useMemo(() => {
    if (activeTabId === 'main') return { displayNodes: nodes, displayEdges: edges };
    const comp = nodes.find((n) => n.id === activeTabId);
    const childSet = new Set(comp?.data?.composite?.childIds ?? []);
    return {
      displayNodes: nodes
        .filter((n) => childSet.has(n.id))
        .map((n) => ({ ...n, hidden: false })),
      displayEdges: edges
        .filter((e) => childSet.has(e.source) && childSet.has(e.target))
        .map((e) => ({ ...e, hidden: false })),
    };
  }, [activeTabId, nodes, edges]);

  const handleNodeClick: NodeMouseHandler = useCallback(
    (_, node) => setSelected({ kind: 'node', id: node.id }),
    [setSelected],
  );

  const handleEdgeClick: EdgeMouseHandler = useCallback(
    (_, edge) => setSelected({ kind: 'edge', id: edge.id }),
    [setSelected],
  );

  const handleNodeDragStop = useCallback(() => markHistory(), [markHistory]);

  /**
   * 从端口拖出连线到画布空白处(未连接到有效端口)时,自动创建新节点并连接:
   * - 从输出端口拖出 → 新节点作为目标(连到其输入端口)
   * - 从输入端口拖出 → 新节点作为源(从其输出端口连出)
   * 新节点创建在松开鼠标的位置。
   */
  const handleConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, connectionState: FinalConnectionState) => {
      // 已成功连接到目标节点端口,由 onConnect 处理,这里跳过
      if (connectionState.toNode) return;
      if (allLocked) return;
      const fromNode = connectionState.fromNode;
      const fromHandle = connectionState.fromHandle;
      if (!fromNode || !fromHandle) return;
      // 支持鼠标与触摸事件;触摸用 changedTouches 取坐标
      let clientX = 0;
      let clientY = 0;
      if ('clientX' in event) {
        clientX = event.clientX;
        clientY = event.clientY;
      } else {
        const t = event.changedTouches?.[0];
        clientX = t?.clientX ?? 0;
        clientY = t?.clientY ?? 0;
      }
      const pos = screenToFlowPosition({ x: clientX, y: clientY });
      const st = useGraphStore.getState();
      // 内部画布中新建节点时加入所属组合,主画布直接新建
      const comp =
        st.activeTabId !== 'main' ? st.nodes.find((n) => n.id === st.activeTabId) : null;
      const newId = comp?.data?.composite
        ? addNodeToComposite(comp.id, { x: pos.x - 115, y: pos.y - 60 })
        : addNode(undefined, { x: pos.x - 115, y: pos.y - 60 });
      if (!newId) return;
      // 从输出端口(source)拖出 → 连到新节点输入;从输入端口(target)拖出 → 从新节点输出连出
      const conn: Connection =
        fromHandle.type === 'source'
          ? {
              source: fromNode.id,
              sourceHandle: fromHandle.id ?? null,
              target: newId,
              targetHandle: 'in_1',
            }
          : {
              source: newId,
              sourceHandle: 'out_1',
              target: fromNode.id,
              targetHandle: fromHandle.id ?? null,
            };
      st.onConnect(conn);
      setSelected({ kind: 'node', id: newId });
    },
    [addNode, addNodeToComposite, allLocked, screenToFlowPosition, setSelected],
  );

  /** 画布空白处右键:弹出画布菜单 */
  const handlePaneContextMenu = useCallback(
    (e: React.MouseEvent | MouseEvent) => {
      e.preventDefault();
      const clientX = 'clientX' in e ? e.clientX : 0;
      const clientY = 'clientY' in e ? e.clientY : 0;
      const nextStyle: EdgeStyle = edgeStyle === 'smoothstep' ? 'bezier' : 'smoothstep';
      setContextMenu({
        x: clientX,
        y: clientY,
        items: [
          {
            label: '添加节点',
            disabled: allLocked,
            onClick: () => {
              const pos = screenToFlowPosition({ x: clientX, y: clientY });
              const st = useGraphStore.getState();
              const comp =
                st.activeTabId !== 'main'
                  ? st.nodes.find((n) => n.id === st.activeTabId)
                  : null;
              const id = comp?.data?.composite
                ? addNodeToComposite(comp.id, pos)
                : addNode(undefined, pos);
              if (id) setSelected({ kind: 'node', id });
            },
          },
          {
            label: allLocked ? '解除锁定全部' : '锁定全部',
            onClick: () => toggleLockAll(),
          },
          {
            label: `连线风格:${edgeStyle === 'smoothstep' ? '平滑折线' : '曲线'}`,
            onClick: () => setEdgeStyle(nextStyle),
          },
          {
            label: '显示全部节点',
            onClick: () => fitView({ padding: 0.2, duration: 400 }),
          },
          { label: '---' },
          {
            label: '保存',
            onClick: () => saveNow(),
          },
          {
            label: '另存为(导出 JSON)',
            onClick: () => {
              const blob = new Blob([exportJson()], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `nodeflow-${new Date()
                .toISOString()
                .slice(0, 19)
                .replace(/[:T]/g, '-')}.json`;
              a.click();
              URL.revokeObjectURL(url);
            },
          },
        ],
      });
    },
    [
      addNode,
      addNodeToComposite,
      allLocked,
      edgeStyle,
      exportJson,
      fitView,
      saveNow,
      screenToFlowPosition,
      setEdgeStyle,
      setSelected,
      toggleLockAll,
    ],
  );

  /** 节点上右键:若节点已选中则操作全部选中,否则操作该节点 */
  const handleNodeContextMenu = useCallback(
    (e: React.MouseEvent, node: FlowNode) => {
      e.preventDefault();
      const st = useGraphStore.getState();
      const selectedNodes = st.nodes.filter((n) => n.selected);
      // 右键的节点不在选中集时,临时视为仅该节点
      const targets = selectedNodes.some((n) => n.id === node.id)
        ? selectedNodes
        : [node];
      const isComposite = !!node.data.composite;
      const multi = targets.length > 1;

      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        items: [
          {
            label: multi ? `复制 (${targets.length})` : '复制',
            disabled: isComposite || targets.some((n) => !!n.data.composite),
            hint: isComposite ? '组合节点不支持复制' : undefined,
            onClick: () => targets.forEach((n) => !n.data.composite && duplicateNode(n.id)),
          },
          {
            label: multi ? `锁定选中 (${targets.length})` : '锁定节点',
            disabled: allLocked,
            onClick: () => {
              targets.forEach((n) => {
                const cur = st.nodes.find((x) => x.id === n.id);
                if (cur) st.updateNode(n.id, { locked: !cur.data.locked });
              });
            },
          },
          {
            label: multi ? `编组为复合节点 (${targets.length})` : '编组为复合节点',
            disabled:
              allLocked ||
              targets.length < 2 ||
              targets.some((n) => !!n.data.composite),
            hint:
              targets.length < 2
                ? '需至少选中 2 个节点'
                : targets.some((n) => !!n.data.composite)
                  ? '组合节点不能再次编组'
                  : undefined,
            onClick: () => {
              const id = groupSelected();
              if (id) setSelected({ kind: 'node', id });
            },
          },
          ...(isComposite
            ? [
                {
                  label: '解除编组',
                  disabled: allLocked,
                  onClick: () => ungroup(node.id),
                },
                { label: '---' as const },
              ]
            : []),
          {
            label: '删除',
            danger: true,
            disabled: allLocked,
            onClick: () => {
              const label = multi
                ? `确定删除选中的 ${targets.length} 个节点?`
                : `确定删除节点「${node.data.label || '未命名'}」?`;
              // 弹出确认对话框;确认后删除(store 会一并清理相关连线,撤销可完整还原)
              setConfirmDialog({
                title: '删除确认',
                message: `${label}\n撤销删除(Ctrl+Z)可还原节点及其连线关系。`,
                confirmLabel: '删除',
                cancelLabel: '取消',
                danger: true,
                onConfirm: () => {
                  targets.forEach((n) => deleteNode(n.id));
                  setSelected(null);
                },
              });
            },
          },
        ],
      });
    },
    [deleteNode, duplicateNode, groupSelected, setSelected, setConfirmDialog, ungroup, allLocked],
  );

  /**
   * 统一右键入口:通过事件目标判断在节点上还是画布空白处。
   * 用 .flow-area 原生 contextmenu(React Flow 的 onPaneContextMenu 在 panOnDrag 含右键时会被拦截)。
   * 若正在右键拖拽平移画布,则右键单击弹菜单;拖拽平移时不弹。
   */
  const handleFlowContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      // 右键拖拽平移中,不弹菜单
      if (rightDragRef.current) return;
      const nodeEl = (e.target as HTMLElement | null)?.closest?.('.react-flow__node');
      if (nodeEl) {
        const nid = nodeEl.getAttribute('data-id');
        const node = useGraphStore.getState().nodes.find((n) => n.id === nid);
        if (node) {
          handleNodeContextMenu(e, node);
          return;
        }
      }
      handlePaneContextMenu(e);
    },
    [handleNodeContextMenu, handlePaneContextMenu],
  );

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  // 全局检测右键拖拽:右键按下并移动超过阈值 → 标记为拖拽平移,松开后不再弹菜单
  useEffect(() => {
    let downX = 0;
    let downY = 0;
    let tracking = false;
    const onDown = (e: PointerEvent) => {
      if (e.button === 2) {
        tracking = true;
        rightDragRef.current = false;
        downX = e.clientX;
        downY = e.clientY;
      }
    };
    const onMove = (e: PointerEvent) => {
      if (!tracking) return;
      // 右键仍按住且位移超过阈值 → 判定为拖拽平移
      if (e.buttons & 2 && (Math.abs(e.clientX - downX) > 4 || Math.abs(e.clientY - downY) > 4)) {
        rightDragRef.current = true;
      }
    };
    const onUp = (e: PointerEvent) => {
      if (e.button !== 2) return;
      tracking = false;
      // 松开后延迟重置,避免 contextmenu(可能在松开时触发)误判为单击
      setTimeout(() => {
        rightDragRef.current = false;
      }, 80);
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, []);

  // 双击画布空白处创建节点:
  // 用原生捕获阶段监听 pointerdown 计数(selectionOnDrag 会拦截 click/dblclick 事件,
  // 导致 onPaneClick detail 与 onDoubleClick 均失效,但捕获阶段的 pointerdown 仍能收到)
  useEffect(() => {
    const el = flowAreaRef.current;
    if (!el) return;
    let last = 0;
    let lastX = 0;
    let lastY = 0;
    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      // 排除节点内部(节点双击是编辑/选中)
      if ((e.target as HTMLElement | null)?.closest?.('.react-flow__node')) {
        last = 0;
        return;
      }
      const now = Date.now();
      const dx = Math.abs(e.clientX - lastX);
      const dy = Math.abs(e.clientY - lastY);
      if (now - last < 350 && dx < 6 && dy < 6) {
        // 判定为双击画布
        last = 0;
        if (allLocked) return;
        const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
        const st = useGraphStore.getState();
        const comp =
          st.activeTabId !== 'main' ? st.nodes.find((n) => n.id === st.activeTabId) : null;
        const id = comp?.data?.composite
          ? addNodeToComposite(comp.id, pos)
          : addNode(undefined, pos);
        if (id) setSelected({ kind: 'node', id });
      } else {
        last = now;
        lastX = e.clientX;
        lastY = e.clientY;
      }
    };
    el.addEventListener('pointerdown', onPointerDown, true);
    return () => el.removeEventListener('pointerdown', onPointerDown, true);
  }, [addNode, addNodeToComposite, allLocked, screenToFlowPosition, setSelected]);

  return (
    <div ref={flowAreaRef} className="flow-area" onContextMenu={handleFlowContextMenu}>
      <ReactFlow<FlowNode, FlowEdge>
        key={activeTabId}
        nodes={displayNodes}
        edges={displayEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        viewport={activeTabId === 'main' ? viewport : undefined}
        fitView={activeTabId !== 'main'}
        fitViewOptions={{ padding: 0.2 }}
        onViewportChange={(v) => {
          // 仅主画布的视口写入 store,避免内部画布污染主画布视图
          if (activeTabId === 'main') onViewportChange(v);
        }}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectEnd={handleConnectEnd}
        onNodeClick={handleNodeClick}
        onEdgeClick={handleEdgeClick}
        onPaneClick={handlePaneClick}
        onNodeDragStop={handleNodeDragStop}
        onBeforeDelete={handleBeforeDelete}
        onNodeDoubleClick={(_, node) => setSelected({ kind: 'node', id: node.id })}
        nodesDraggable={!allLocked}
        nodesConnectable={!allLocked}
        edgesReconnectable={!allLocked}
        deleteKeyCode={allLocked ? null : ['Backspace', 'Delete']}
        multiSelectionKeyCode={['Shift', 'Meta']}
        // 仅右键平移画布:左键专用于拖拽节点 / 框选 / 双击编辑文字,不与画布平移冲突
        panOnDrag={[2]}
        selectionOnDrag={!allLocked}
        selectionMode={SelectionMode.Partial}
        connectionRadius={28}
        minZoom={0.1}
        maxZoom={3}
        // 不使用 noDragClassName / noPanClassName 全局配置(会导致节点无法拖拽);
        // 编辑态通过 store 将节点 draggable 置 false + EditableText 原生捕获拦截阻止拖拽。
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={24}
          size={1}
          color={isDark ? '#2c2f38' : '#c9cdd6'}
        />
        <Controls position="bottom-right" />
        <MiniMap
          position="bottom-left"
          pannable
          zoomable
          nodeColor={(n) => {
            // 隐藏节点(塌缩组合的内部节点)不显示在小地图中
            if (n.hidden) return 'transparent';
            const actor = (n.data as { actor?: string } | undefined)?.actor;
            if (actor === 'human') return '#e8b028';
            if (actor === 'hybrid') return '#9d6bff';
            return '#4ea1ff';
          }}
          nodeStrokeColor={isDark ? '#9aa0ad' : '#7d8590'}
          maskColor={isDark ? 'rgba(23,24,28,0.7)' : 'rgba(220,225,235,0.75)'}
        />

        {/* 左上角半透明操作提示框,可缩小 */}
        <Panel position="top-left">
          {hintOpen ? (
            <div className="nf-hint">
              <div className="nf-hint-head">
                <span className="nf-hint-title">基本操作</span>
                <button
                  className="nf-hint-btn"
                  title="缩小"
                  onClick={() => setHintOpen(false)}
                >
                  ―
                </button>
              </div>
              <ul className="nf-hint-list">
                <li><b>拖拽节点</b> · 左键按住节点移动</li>
                <li><b>框选</b> · 左键画布空白拖拽选中多个节点</li>
                <li><b>平移画布</b> · 右键按住拖动</li>
                <li><b>缩放</b> · 滚轮 / 右下角控件</li>
                <li><b>编辑文字</b> · 双击节点标题 / 描述 / 端口名</li>
                <li><b>连线</b> · 从端口拖出到另一节点端口</li>
                <li><b>新建节点</b> · 双击画布空白处</li>
                <li><b>删除</b> · 选中后按 Delete / Backspace</li>
              </ul>
            </div>
          ) : (
            <button
              className="nf-hint-trigger"
              title="展开操作提示"
              onClick={() => setHintOpen(true)}
            >
              ?
            </button>
          )}
        </Panel>
      </ReactFlow>
      <ContextMenu menu={contextMenu} onClose={closeContextMenu} />
      <ConfirmDialog dialog={confirmDialog} onClose={closeConfirmDialog} />
    </div>
  );
}
