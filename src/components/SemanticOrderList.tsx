import { useState } from 'react';

/** 排序段内一行的展示模型 */
export interface OrderItem {
  id: string;
  name: string;
  /** 归属节点数(参与方);0 时置灰 */
  count?: number;
  /** 右侧次级标签(如所属组织名) */
  tag?: string;
  empty?: boolean;
}

interface Props {
  kind: 'participant' | 'stage';
  items: OrderItem[];
  /** 拖动 handle 落位后回调(仅调整顺序,不改节点位置) */
  onReorder: (from: number, to: number) => void;
  /** 双击行改名提交 */
  onRename: (id: string, name: string) => void;
  /** 当前聚焦项(属性栏联动 / 选中节点推导),行高亮 */
  activeId?: string | null;
  /** 单击行:定位到该语义下的节点 */
  onSelect?: (id: string) => void;
  /** 传了该回调则在行尾显示删除按钮 */
  onDelete?: (id: string) => void;
  disabled?: boolean;
}

/**
 * 参与方 / 阶段 通用排序行列表(UI 排序 + 双击改名 + 单击定位 + 可选删除):
 * - drag handle 触发 HTML5 drag,drop 后调用 onReorder;
 * - 双击行进入就地名称编辑,提交后调用 onRename;
 * - 单击行调用 onSelect(画布定位),与双击改名共存(先定位再改名,无副作用);
 * - 不引入第三方 DnD 库;整行看着不可拖,只有 handle 可拖。
 */
export default function SemanticOrderList({
  kind,
  items,
  onReorder,
  onRename,
  activeId,
  onSelect,
  onDelete,
  disabled,
}: Props) {
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null);
  if (items.length === 0) return null;

  const commitEdit = () => {
    if (!editing) return;
    const v = editing.value.trim();
    if (v && v !== items.find((x) => x.id === editing.id)?.name) onRename(editing.id, v);
    setEditing(null);
  };

  return (
    <div className="mx-order-list">
      {items.map((it, i) => {
        const isEditing = editing?.id === it.id;
        return (
          <div
            key={it.id}
            className={[
              'mx-order-row',
              it.empty ? 'empty' : '',
              dragOver === i ? 'drop' : '',
              activeId === it.id ? 'active' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            onClick={() => {
              if (!isEditing) onSelect?.(it.id);
            }}
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
            onDoubleClick={(e) => {
              e.stopPropagation();
              if (it.name === '未分配') return; // 虚拟行不可改名
              setEditing({ id: it.id, value: it.name });
            }}
          >
            <span
              className="mx-order-handle"
              title="拖动调整顺序;双击行可改名"
              draggable={!disabled}
              onDragStart={(e) => {
                e.dataTransfer.setData(`text/mx-${kind}`, String(i));
                e.dataTransfer.effectAllowed = 'move';
              }}
            >
              ☰
            </span>
            {isEditing ? (
              <input
                className="mx-order-edit-input"
                autoFocus
                value={editing!.value}
                onChange={(e) => setEditing((cur) => (cur ? { ...cur, value: e.target.value } : cur))}
                onFocus={(e) => e.target.select()}
                onBlur={commitEdit}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter') commitEdit();
                  else if (e.key === 'Escape') setEditing(null);
                }}
              />
            ) : (
              <span className="mx-order-name" title={it.name}>
                {it.name}
              </span>
            )}
            {!isEditing && it.tag && <span className="mx-order-tag">{it.tag}</span>}
            {!isEditing && typeof it.count === 'number' && <span className="mx-order-count">{it.count}</span>}
            {onDelete && !isEditing && !disabled && (
              <button
                className="mx-order-del"
                title="删除"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(it.id);
                }}
              >
                ✕
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
