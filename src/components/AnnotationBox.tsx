import { useRef, useState } from 'react';
import type { Annotation } from '../types';
import { useGraphStore } from '../store/graphStore';
import EditableText from './EditableText';

interface AnnotationBoxProps {
  annotation: Annotation;
  /** 是否为画布归属(可拖拽,处于绝对定位的 overlay 中) */
  draggable?: boolean;
  /** 拖拽时的位置回调 */
  onDrag?: (id: string, screenX: number, screenY: number) => void;
  onDragEnd?: (id: string) => void;
  onUpdate: (id: string, patch: Partial<Pick<Annotation, 'title' | 'content'>>) => void;
  onDelete: (id: string) => void;
  onToggleCollapsed: (id: string) => void;
}

/** 注释框:标题 + 内容,半透明,可收起/展开,新建时默认进入编辑 */
export default function AnnotationBox({
  annotation,
  draggable,
  onDrag,
  onDragEnd,
  onUpdate,
  onDelete,
  onToggleCollapsed,
}: AnnotationBoxProps) {
  const { id, title, content, collapsed } = annotation;
  const [editingTitle, setEditingTitle] = useState(false);
  const [editingContent, setEditingContent] = useState(false);
  const [contentFocus, setContentFocus] = useState(false);
  const [titleFocus, setTitleFocus] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null);

  // 新建注释时默认进入标题编辑
  const annotAutoEditId = useGraphStore((s) => s.annotAutoEditId);
  const isNew = annotAutoEditId === id;
  const consumeAutoEdit = () => useGraphStore.setState({ annotAutoEditId: null });

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleCollapsed(id);
  };

  // 删除需二次确认(内联确认,避免依赖原生 confirm)
  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDelete(true);
  };
  const confirmDel = (e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDelete(false);
    onDelete(id);
  };
  const cancelDel = (e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDelete(false);
  };

  // 画布归属注释的拖拽
  const onPointerDown = (e: React.PointerEvent) => {
    if (!draggable || !boxRef.current) return;
    if (editingTitle || editingContent) return;
    const rect = boxRef.current.getBoundingClientRect();
    dragState.current = { startX: e.clientX, startY: e.clientY, baseX: rect.left, baseY: rect.top };
    const move = (ev: PointerEvent) => {
      if (!dragState.current) return;
      const dx = ev.clientX - dragState.current.startX;
      const dy = ev.clientY - dragState.current.startY;
      onDrag?.(id, dragState.current.baseX + dx, dragState.current.baseY + dy);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      onDragEnd?.(id);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  if (collapsed) {
    // 收起态:不渲染展开框(由主体上的 pin 图标体现)
    return null;
  }

  return (
    <div
      ref={boxRef}
      className="annot-box"
      style={draggable ? { cursor: 'grab' } : undefined}
      onPointerDown={onPointerDown}
      onDoubleClick={(e) => {
        // 双击注释框进入标题编辑(标题/内容文字的双击由 EditableText 自己处理并阻止冒泡)
        e.stopPropagation();
        setTitleFocus(true);
      }}
    >
      <div className="annot-head">
        <EditableText
          className="annot-title"
          value={title}
          placeholder="注释标题"
          onCommit={(v) => onUpdate(id, { title: v })}
          onEditingChange={setEditingTitle}
          autoFocus={isNew || titleFocus}
          onAutoFocusConsumed={() => {
            consumeAutoEdit();
            setTitleFocus(false);
          }}
        />
        <div className="annot-actions">
          <button className="annot-btn" title="收起" onClick={handleToggle}>
            –
          </button>
          {confirmDelete ? (
            <>
              <button className="annot-btn danger" title="确认删除" onClick={confirmDel}>
                删
              </button>
              <button className="annot-btn" title="取消" onClick={cancelDel}>
                否
              </button>
            </>
          ) : (
            <button className="annot-btn" title="删除注释" onClick={handleDeleteClick}>
              ×
            </button>
          )}
        </div>
      </div>
      <EditableText
        className="annot-content"
        value={content}
        placeholder="注释内容"
        multiline
        onCommit={(v) => onUpdate(id, { content: v })}
        onEditingChange={setEditingContent}
        // 单击内容即进入编辑(新建时编辑完标题后,点内容直接编辑)
        onClick={() => setContentFocus(true)}
        autoFocus={contentFocus}
        onAutoFocusConsumed={() => setContentFocus(false)}
      />
    </div>
  );
}
