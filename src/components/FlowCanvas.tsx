import { useCallback } from 'react';
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
  const markHistory = useGraphStore((s) => s.markHistory);
  const theme = useGraphStore((s) => s.theme);

  const { screenToFlowPosition } = useReactFlow();
  const isDark = theme === 'dark';

  const handlePaneClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.detail === 2) {
        const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
        const id = addNode(undefined, pos);
        setSelected({ kind: 'node', id });
      } else {
        setSelected(null);
      }
    },
    [addNode, setSelected, screenToFlowPosition],
  );

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
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        viewport={viewport}
        onViewportChange={onViewportChange}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={handleNodeClick}
        onEdgeClick={handleEdgeClick}
        onPaneClick={handlePaneClick}
        onNodeDragStop={handleNodeDragStop}
        onNodeDoubleClick={(_, node) => setSelected({ kind: 'node', id: node.id })}
        deleteKeyCode={['Backspace', 'Delete']}
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
