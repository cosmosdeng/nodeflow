import { useEffect, useRef, useState } from 'react';

/* ------------------------------------------------------------------ */
/* 可内联编辑的文本:双击进入编辑(显示外框),光标可定位,失焦/回车提交       */
/* ------------------------------------------------------------------ */
export interface EditableTextProps {
  value: string;
  onCommit: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  disabled?: boolean;
  className?: string;
  title?: string;
  /** 进入/退出编辑态时回调(供节点临时禁用拖拽,避免编辑时拖动选择文字误拖节点) */
  onEditingChange?: (editing: boolean) => void;
  /** 为 true 时挂载后自动进入编辑态并聚焦(用于新建节点/端口/连线说明后直接输入) */
  autoFocus?: boolean;
  /** autoFocus 生效并进入编辑态后回调(供外部消费并清除自动编辑标记) */
  onAutoFocusConsumed?: () => void;
  /** 根元素点击回调 */
  onClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
}

export default function EditableText({
  value,
  onCommit,
  placeholder,
  multiline,
  disabled,
  className,
  title,
  onEditingChange,
  autoFocus,
  onAutoFocusConsumed,
  onClick,
}: EditableTextProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);
  // 记录是否需要自动聚焦(避免与双击编辑冲突,且保证 contentEditable 应用到 DOM 后再 focus)
  const autoFocusPending = useRef(false);
  // 用 ref 保存回调,避免 effect 依赖每次渲染都变化的内联函数导致循环触发
  const onEditingChangeRef = useRef(onEditingChange);
  const onAutoFocusConsumedRef = useRef(onAutoFocusConsumed);
  onEditingChangeRef.current = onEditingChange;
  onAutoFocusConsumedRef.current = onAutoFocusConsumed;

  // autoFocus 为 true 时请求进入编辑态(contentEditable 由 editing state 驱动)
  useEffect(() => {
    if (!autoFocus) return;
    autoFocusPending.current = true;
    setEditing(true);
    onEditingChangeRef.current?.(true);
    // 依赖仅 autoFocus,不依赖内联回调,避免 setNodeDraggable 触发重渲染后回调变化造成循环
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFocus]);

  // 编辑态已应用到 DOM(contentEditable=true)后再聚焦,此时元素才可聚焦
  useEffect(() => {
    if (editing && autoFocusPending.current) {
      autoFocusPending.current = false;
      ref.current?.focus();
      onAutoFocusConsumedRef.current?.();
    }
  }, [editing]);

  // 外部值变化且当前不在编辑时,把最新值同步进 DOM(contentEditable 不受控)
  useEffect(() => {
    if (ref.current && !editing && ref.current.innerText !== value) {
      ref.current.innerText = value;
    }
  }, [value, editing]);

  const exitEditing = () => {
    setEditing(false);
    onEditingChangeRef.current?.(false);
  };

  const commit = () => {
    exitEditing();
    const el = ref.current;
    if (!el) return;
    let next = el.innerText;
    if (!multiline) {
      next = next.replace(/\s+/g, ' ').trim();
    } else {
      next = next.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trimEnd();
    }
    if (next !== value) onCommit(next);
    // 无论是否提交,把 DOM 重置为最终值,清掉编辑留下的多余空行/占位符
    el.innerText = next;
    el.blur();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && !multiline) {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      const el = e.currentTarget;
      el.innerText = value;
      exitEditing();
      el.blur();
    }
  };

  /**
   * 双击进入编辑:切换 contentEditable 并聚焦,把光标定位到点击处。
   * 未进入编辑(单击)时不做任何阻止,让 pointerdown 正常冒泡给节点以便拖拽。
   */
  const handleDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (disabled) return;
    e.stopPropagation();
    const el = ref.current;
    if (!el) return;
    setEditing(true);
    onEditingChangeRef.current?.(true);
    // contentEditable 变为 true 后聚焦并保留双击选择
    el.focus();
  };

  // 原生捕获阶段拦截 pointerdown,阻止 React Flow 的 d3 节点拖拽启动
  // (React 合成事件的 stopPropagation 无法阻止 d3 原生监听,捕获阶段可以):
  // - 单击:第一次 pointerdown 放行,节点可拖拽
  // - 双击第二下:检测到 300ms 内的快速连点,拦截该 pointerdown,阻止 d3 启动节点拖拽,
  //   从而双击进入编辑后按住拖动只选择文字,不会拖节点
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let lastDown = 0;
    const onDown = (e: PointerEvent) => {
      const now = Date.now();
      if (now - lastDown < 300) {
        e.stopPropagation();
      }
      lastDown = now;
    };
    el.addEventListener('pointerdown', onDown, true);
    return () => el.removeEventListener('pointerdown', onDown, true);
  }, []);

  return (
    <div
      ref={ref}
      className={[className, 'nf-editable'].filter(Boolean).join(' ')}
      contentEditable={editing && !disabled}
      suppressContentEditableWarning
      data-placeholder={placeholder}
      title={title}
      spellCheck={false}
      onDoubleClick={handleDoubleClick}
      onBlur={commit}
      onKeyDown={handleKeyDown}
      onClick={onClick}
    />
  );
}
