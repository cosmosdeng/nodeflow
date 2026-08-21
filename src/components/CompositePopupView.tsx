import { useMemo } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  type EdgeTypes,
  type NodeTypes,
} from '@xyflow/react';
import type { FlowEdge, FlowNode } from '../types';
import { loadCompositeSnapshot } from '../lib/compositePopup';
import FlowNodeComponent from './FlowNodeComponent';
import FlowEdgeComponent from './FlowEdgeComponent';

const nodeTypes: NodeTypes = { flow: FlowNodeComponent };
const edgeTypes: EdgeTypes = { flow: FlowEdgeComponent };

/**
 * 组合节点内部画布的独立窗口视图。
 * 通过 ?composite=<id> 加载,从 localStorage 读取主窗口写入的快照,只读展示。
 */
export default function CompositePopupView({ id }: { id: string }) {
  const snapshot = useMemo(() => loadCompositeSnapshot(id), [id]);

  if (!snapshot || snapshot.nodes.length === 0) {
    return (
      <div className="app popup-app">
        <div className="popup-header">
          <span className="popup-title">⧉ 内部画布</span>
        </div>
        <div className="popup-empty">
          <div className="big">🗕</div>
          未找到内部画布快照(可能已过期)。
          <br />
          请回到主窗口,在组合节点上重新点击「在新窗口弹出内部画布」。
        </div>
      </div>
    );
  }

  // 内部节点标记为锁定,独立窗口中仅可查看
  const readonlyNodes = snapshot.nodes.map((n) => ({
    ...n,
    data: { ...n.data, locked: true },
  }));

  return (
    <div className="app popup-app">
      <div className="popup-header">
        <span className="popup-title">⧉ {snapshot.label} · 内部画布</span>
        <span className="popup-sub">独立窗口 · 只读查看,编辑请在主窗口进行</span>
      </div>
      <div className="popup-canvas">
        <ReactFlow<FlowNode, FlowEdge>
          nodes={readonlyNodes}
          edges={snapshot.edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          nodesDraggable={false}
          nodesConnectable={false}
          edgesReconnectable={false}
          deleteKeyCode={null}
          elementsSelectable={false}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#2c2f38" />
          <Controls position="bottom-right" />
          <MiniMap
            position="bottom-left"
            pannable
            zoomable
            nodeColor={(n) => (n.hidden ? 'transparent' : '#4ea1ff')}
          />
        </ReactFlow>
      </div>
    </div>
  );
}
