import { useMemo, useState } from 'react';
import { useReactFlow } from '@xyflow/react';
import { ACTOR_META, ACTOR_KINDS, type ActorType } from '../types';
import { useGraphStore } from '../store/graphStore';

interface Props {
  onClose: () => void;
}

export default function OutlinePanel({ onClose }: Props) {
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const selected = useGraphStore((s) => s.selected);
  const setSelected = useGraphStore((s) => s.setSelected);
  const { setCenter } = useReactFlow();

  const [keyword, setKeyword] = useState('');
  const [groupBy, setGroupBy] = useState<'actor' | 'flat'>('flat');

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return nodes;
    return nodes.filter(
      (n) =>
        n.data.label.toLowerCase().includes(kw) ||
        n.data.description.toLowerCase().includes(kw),
    );
  }, [nodes, keyword]);

  const groups = useMemo(() => {
    if (groupBy === 'flat') return [{ key: 'all', title: '全部节点', items: filtered }];
    return ACTOR_KINDS.map((a: ActorType) => ({
      key: a,
      title: `${ACTOR_META[a].icon} ${ACTOR_META[a].label}节点`,
      items: filtered.filter((n) => n.data.actor === a),
    })).filter((g) => g.items.length > 0);
  }, [filtered, groupBy]);

  const edgeCountOf = (nodeId: string) =>
    edges.filter((e) => e.source === nodeId || e.target === nodeId).length;

  const handleSelect = (nodeId: string) => {
    const node = nodes.find((n) => n.id === nodeId);
    setSelected({ kind: 'node', id: nodeId });
    if (node) {
      setCenter(node.position.x + 115, node.position.y + 60, { zoom: 1.1, duration: 450 });
    }
  };

  return (
    <aside className="panel" style={{ width: 260 }}>
      <div className="panel-header">
        <span>大纲 · {nodes.length} 个节点</span>
        <button className="panel-close" onClick={onClose} title="关闭大纲">
          ×
        </button>
      </div>
      <div className="panel-body">
        <div className="field">
          <input
            placeholder="搜索节点…"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
        </div>
        <div className="field" style={{ marginTop: -4 }}>
          <select
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value as 'actor' | 'flat')}
          >
            <option value="flat">平铺显示</option>
            <option value="actor">按执行主体分组</option>
          </select>
        </div>

        {filtered.length === 0 && (
          <div className="empty-tip">
            <div className="big">🗂️</div>
            {nodes.length === 0 ? '画布上还没有节点\n双击画布空白处即可创建' : '没有匹配的节点'}
          </div>
        )}

        {groups.map((g) => (
          <div key={g.key} style={{ marginBottom: 10 }}>
            {groupBy === 'actor' && (
              <div
                style={{
                  fontSize: 11,
                  color: 'var(--text-faint)',
                  fontWeight: 600,
                  margin: '6px 2px',
                }}
              >
                {g.title}
              </div>
            )}
            {g.items.map((n) => {
              const actor = ACTOR_META[n.data.actor];
              const isSel = selected?.kind === 'node' && selected.id === n.id;
              return (
                <button
                  key={n.id}
                  className={`list-item ${isSel ? 'selected' : ''}`}
                  onClick={() => handleSelect(n.id)}
                >
                  <span
                    className="icon-wrap"
                    style={{ background: actor.bg, color: actor.color }}
                  >
                    {actor.icon}
                  </span>
                  <span className="li-main">
                    <span className="li-title">{n.data.label || '未命名节点'}</span>
                    <span className="li-sub">
                      {n.data.inputs.length} 入 · {n.data.outputs.length} 出 · {edgeCountOf(n.id)}{' '}
                      连线
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </aside>
  );
}
