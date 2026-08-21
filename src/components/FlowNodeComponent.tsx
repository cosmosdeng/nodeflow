import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { ACTOR_META, uid, type FlowNode } from '../types';
import { useGraphStore } from '../store/graphStore';

function FlowNodeComponent({ id, data, selected }: NodeProps<FlowNode>) {
  const actor = ACTOR_META[data.actor];
  const setSelected = useGraphStore((s) => s.setSelected);
  const updateNode = useGraphStore((s) => s.updateNode);

  const addInput = (e: React.MouseEvent) => {
    e.stopPropagation();
    updateNode(id, {
      inputs: [...data.inputs, { id: uid('in'), name: `输入${data.inputs.length + 1}` }],
    });
  };

  const addOutput = (e: React.MouseEvent) => {
    e.stopPropagation();
    updateNode(id, {
      outputs: [...data.outputs, { id: uid('out'), name: `输出${data.outputs.length + 1}` }],
    });
  };

  return (
    <div
      className={`nf-node ${selected ? 'selected' : ''}`}
      onDoubleClick={(e) => {
        e.stopPropagation();
        setSelected({ kind: 'node', id });
      }}
    >
      {/* 头部:图标标签 + 名称 + 主体类型徽标 */}
      <div className="node-header">
        <span
          className="node-actor"
          style={{ background: actor.bg, color: actor.color }}
          title={`执行主体:${actor.label}`}
        >
          {actor.icon}
        </span>
        <span className="node-title" title={data.label}>
          {data.label || '未命名节点'}
        </span>
        <span
          className="node-actor-tag"
          style={{ background: actor.bg, color: actor.color }}
        >
          {actor.label}
        </span>
      </div>

      {/* 描述 */}
      <div className="node-desc">{data.description}</div>

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
              />
              <span className="port-label">{p.name || '输入'}</span>
            </div>
          ))}
          <button
            className="port-add"
            title="添加输入端口"
            onClick={addInput}
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
              <span className="port-label">{p.name || '输出'}</span>
              <Handle
                id={p.id}
                type="source"
                position={Position.Right}
                isConnectable
              />
            </div>
          ))}
          <button
            className="port-add"
            title="添加输出端口"
            onClick={addOutput}
          >
            +
          </button>
        </div>
      </div>
    </div>
  );
}

export default memo(FlowNodeComponent);
