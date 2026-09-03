import { useMemo, useState } from 'react';
import { useReactFlow } from '@xyflow/react';
import { ACTOR_META, ACTOR_KINDS, type ActorType } from '../types';
import { useGraphStore } from '../store/graphStore';
import ActorIcon from './ActorIcon';

interface Props {
  onClose: () => void;
}

/** 排序段内一行的展示模型 */
interface OrderItem {
  id: string;
  name: string;
  count?: number;
  empty?: boolean;
}

/**
 * 参与方 / 阶段 通用排序行列表(仅 UI 排序):
 * - drag handle 触发 HTML5 drag,drop 后调用 store 的 reorder action;
 * - 不引入第三方 DnD 库;整行看起来不可拖(只有 handle 可拖)。
 */
function OrderRowList({
  kind,
  items,
  onReorder,
}: {
  kind: string;
  items: OrderItem[];
  onReorder: (from: number, to: number) => void;
}) {
  const [dragOver, setDragOver] = useState<number | null>(null);
  if (items.length === 0) return null;
  return (
    <div className="mx-order-list">
      {items.map((it, i) => (
        <div
          key={it.id}
          className={`mx-order-row${it.empty ? ' empty' : ''}${dragOver === i ? ' drop' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            setDragOver(i);
          }}
          onDragLeave={() => setDragOver((cur) => (cur === i ? null : cur))}
          onDrop={(e) => {
            e.preventDefault();
            const from = Number(e.dataTransfer.getData(`text/mx-${kind}`));
            if (Number.isInteger(from) && from >= 0 && from < items.length && from !== i) {
              onReorder(from, i);
            }
            setDragOver(null);
          }}
        >
          <span
            className="mx-order-handle"
            title="拖动调整顺序"
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(`text/mx-${kind}`, String(i));
              e.dataTransfer.effectAllowed = 'move';
            }}
          >
            ☰
          </span>
          <span className="mx-order-name" title={it.name}>
            {it.name}
          </span>
          {typeof it.count === 'number' && <span className="mx-order-count">{it.count}</span>}
        </div>
      ))}
    </div>
  );
}

export default function OutlinePanel({ onClose }: Props) {
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const selected = useGraphStore((s) => s.selected);
  const setSelected = useGraphStore((s) => s.setSelected);
  const participants = useGraphStore((s) => s.participants);
  const participantOrder = useGraphStore((s) => s.participantOrder);
  const reorderParticipant = useGraphStore((s) => s.reorderParticipant);
  const stages = useGraphStore((s) => s.stages);
  const stageOrder = useGraphStore((s) => s.stageOrder);
  const reorderStage = useGraphStore((s) => s.reorderStage);
  const arrangePending = useGraphStore((s) => s.arrangePending);
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

  // 参与方显示顺序 = participantOrder(仅有效)+ 未列出者追加,与 P3 computeMatrixLayout 同规则;不改 store。
  const orderedParticipantIds = useMemo(() => {
    const valid = participantOrder.filter((id) => participants.some((p) => p.id === id));
    const seen = new Set(valid);
    return [...valid, ...participants.filter((p) => !seen.has(p.id)).map((p) => p.id)];
  }, [participants, participantOrder]);

  // 阶段显示顺序 = stageOrder(仅有效)+ 未列出者追加,同规则;不改 store。
  const orderedStageIds = useMemo(() => {
    const valid = stageOrder.filter((id) => stages.some((st) => st.id === id));
    const seen = new Set(valid);
    return [...valid, ...stages.filter((st) => !seen.has(st.id)).map((st) => st.id)];
  }, [stages, stageOrder]);

  const visibleCountOf = (participantId: string) =>
    nodes.filter((n) => !n.hidden && n.data?.participantId === participantId).length;

  const participantItems: OrderItem[] = useMemo(
    () =>
      orderedParticipantIds.map((pid) => {
        const p = participants.find((x) => x.id === pid);
        const count = visibleCountOf(pid);
        return { id: pid, name: p?.name ?? '未命名参与方', count, empty: count === 0 };
      }),
    [orderedParticipantIds, participants, nodes],
  );

  const stageItems: OrderItem[] = useMemo(
    () =>
      orderedStageIds.map((sid) => {
        const st = stages.find((x) => x.id === sid);
        return { id: sid, name: st?.name ?? '未命名阶段' };
      }),
    [orderedStageIds, stages],
  );

  return (
    <aside className={`panel${arrangePending ? ' pending' : ''}`} style={{ width: 260 }}>
      {arrangePending && <div className="mx-pending-note">顺序已改变</div>}
      <div className="panel-header">
        <span>大纲 · {nodes.length} 个节点</span>
        <button className="panel-close" onClick={onClose} title="关闭大纲">
          ×
        </button>
      </div>
      <div className="panel-body">
        {/* 参与方顺序(拖动 handle 排序 → reorderParticipant,不改节点位置) */}
        {participantItems.length > 0 && (
          <div className="mx-section">
            <div className="mx-sec-title">参与方</div>
            <OrderRowList
              kind="participant"
              items={participantItems}
              onReorder={(from, to) => reorderParticipant(from, to)}
            />
          </div>
        )}

        {/* 阶段顺序(拖动 handle 排序 → reorderStage,不改节点位置) */}
        {stageItems.length > 0 && (
          <div className="mx-section">
            <div className="mx-sec-title">阶段</div>
            <OrderRowList
              kind="stage"
              items={stageItems}
              onReorder={(from, to) => reorderStage(from, to)}
            />
          </div>
        )}

        {(participantItems.length > 0 || stageItems.length > 0) && (
          <div className="mx-sec-divider" />
        )}

        <div className="mx-sec-title">节点</div>
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
