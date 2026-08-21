import { useCallback, useMemo } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  useReactFlow,
  type NodeMouseHandler,
  type EdgeMouseHandler,
  type NodeTypes,
  type EdgeTypes,
} from '@xyflow/react';
import FlowNodeComponent from './FlowNodeComponent';
import FlowEdgeComponent from './FlowEdgeComponent';
import { useGraphStore } from '../store/graphStore';
import type { FlowNode, FlowEdge } from '../types';

const nodeTypes: NodeTypes = { flow: FlowNodeComponent };
const edgeTypes: EdgeTypes = { flow: FlowEdgeComponent };

export default function FlowCanvas() {
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

  const { screenToFlowPosition } = useReactFlow();
  const isDark = theme === 'dark';

  const handlePaneClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.detail === 2) {
        // 演示锁定时禁止双击新建节点
        if (allLocked) return;
        const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
        const st = useGraphStore.getState();
        // 内部画布中新建节点时,原子地加入所属组合(创建 + childIds + 塌缩隐藏,
        // 一次性记录历史,避免 addNode 后 setState 直改 hidden 绕过撤销栈)
        const comp =
          st.activeTabId !== 'main' ? st.nodes.find((n) => n.id === st.activeTabId) : null;
        const id = comp?.data?.composite
          ? addNodeToComposite(comp.id, pos)
          : addNode(undefined, pos);
        if (id) setSelected({ kind: 'node', id });
      } else {
        setSelected(null);
      }
    },
    [addNode, addNodeToComposite, allLocked, setSelected, screenToFlowPosition],
  );

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

  return (
    <div className="flow-area">
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
        onNodeClick={handleNodeClick}
        onEdgeClick={handleEdgeClick}
        onPaneClick={handlePaneClick}
        onNodeDragStop={handleNodeDragStop}
        onNodeDoubleClick={(_, node) => setSelected({ kind: 'node', id: node.id })}
        nodesDraggable={!allLocked}
        nodesConnectable={!allLocked}
        edgesReconnectable={!allLocked}
        deleteKeyCode={allLocked ? null : ['Backspace', 'Delete']}
        multiSelectionKeyCode={['Shift', 'Meta']}
        connectionRadius={28}
        minZoom={0.1}
        maxZoom={3}
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
      </ReactFlow>
    </div>
  );
}
