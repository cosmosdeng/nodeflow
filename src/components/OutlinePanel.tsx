import { useMemo, useState } from 'react';
import { useReactFlow } from '@xyflow/react';
import { ACTOR_META, ACTOR_KINDS, type ActorType } from '../types';
import { useGraphStore } from '../store/graphStore';
import ActorIcon from './ActorIcon';

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

  // 子节点 → 所属组合(塌缩态时定位到组合)
  const ownerOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const n of nodes) {
      const c = n.data.composite;
      if (c) for (const cid of c.childIds) map.set(cid, n.id);
    }
    return map;
  }, [nodes]);

  const groups = useMemo(() => {
    if (groupBy === 'flat') return [{ key: 'all', title: '全部节点', items: filtered }];
    const comps = filtered.filter((n) => n.data.composite);
    const actorGroups = ACTOR_KINDS.map((a: ActorType) => ({
      key: a as string,
      title: `${ACTOR_META[a].label}节点`,
      items: filtered.filter((n) => n.data.actor === a && !n.data.composite),
    })).filter((g) => g.items.length > 0);
    if (comps.length)
      actorGroups.unshift({ key: 'composite', title: '⧉ 组合节点', items: comps });
    return actorGroups;
  }, [filtered, groupBy]);

  const edgeCountOf = (nodeId: string) =>
    edges.filter((e) => e.source === nodeId || e.target === nodeId).length;

  const handleSelect = (nodeId: string) => {
    const node = nodes.find((n) => n.id === nodeId);
    // 塌缩组合内被隐藏的子节点:定位到所属组合节点
    const ownerId = ownerOf.get(nodeId);
    const owner = ownerId ? nodes.find((n) => n.id === ownerId) : undefined;
    const target = node?.hidden && owner ? owner : node;
    setSelected({ kind: 'node', id: target?.id ?? nodeId });
    if (target) {
      setCenter(target.position.x + 115, target.position.y + 60, { zoom: 1.1, duration: 450 });
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
              const composite = n.data.composite;
              const isSel = selected?.kind === 'node' && selected.id === n.id;
              const ownerId = ownerOf.get(n.id);
              const owner = ownerId ? nodes.find((x) => x.id === ownerId) : undefined;
              const foldedChild = !!(owner && !owner.data.composite?.expanded);
              return (
                <button
                  key={n.id}
                  className={`list-item ${isSel ? 'selected' : ''}`}
                  onClick={() => handleSelect(n.id)}
                >
                  <span
                    className="icon-wrap"
                    style={
                      composite
                        ? { background: 'color-mix(in srgb, var(--accent) 20%, transparent)', color: 'var(--accent)' }
                        : undefined
                    }
                  >
                    {composite ? '⧉' : <ActorIcon actor={n.data.actor} size={22} />}
                  </span>
                  <span className="li-main">
                    <span className="li-title">{n.data.label || '未命名节点'}</span>
                    <span className="li-sub">
                      {composite ? (
                        <>
                          {composite.childIds.length} 个子节点 ·{' '}
                          {composite.expanded ? '已展开' : '已塌缩'} · {edgeCountOf(n.id)} 连线
                        </>
                      ) : foldedChild ? (
                        <>
                          ⧉ {owner?.data.label} 内 · 已塌缩
                        </>
                      ) : (
                        <>
                          {n.data.inputs.length} 入 · {n.data.outputs.length} 出 · {edgeCountOf(n.id)}{' '}
                          连线
                        </>
                      )}
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
