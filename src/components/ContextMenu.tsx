import { useEffect } from 'react';

export interface ContextMenuItem {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  danger?: boolean;
  hint?: string;
}

export interface ContextMenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
}

interface Props {
  menu: ContextMenuState | null;
  onClose: () => void;
}

/**
 * 通用右键上下文菜单。
 * 点击菜单项后执行对应操作并关闭;点击菜单外部 / Esc 关闭。
 */
export default function ContextMenu({ menu, onClose }: Props) {
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    // 点击菜单外部关闭(延迟一拍,避免触发菜单自身的点击)
    const onPointerDown = () => onClose();
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointerDown);
    };
  }, [menu, onClose]);

  if (!menu) return null;

  // 视口边缘限制,避免菜单溢出
  const style: React.CSSProperties = {
    left: Math.min(menu.x, window.innerWidth - 190),
    top: Math.min(menu.y, window.innerHeight - menu.items.length * 34 - 16),
  };

  return (
    <div className="nf-context-menu" style={style} onPointerDown={(e) => e.stopPropagation()}>
      {menu.items.map((item, i) =>
        item.label === '---' ? (
          <div key={i} className="nf-context-divider" />
        ) : (
          <button
            key={i}
            className={`nf-context-item ${item.danger ? 'danger' : ''}`}
            disabled={item.disabled}
            title={item.hint}
            onClick={() => {
              onClose();
              item.onClick?.();
            }}
          >
            {item.label}
          </button>
        ),
      )}
    </div>
  );
}