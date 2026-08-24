import type { Stage, ViewportState } from '../types';
import EditableText from './EditableText';

interface Props {
  stage: Stage;
  viewport: ViewportState;
  locked: boolean;
  /** 是否闪烁反馈(节点长按进入域时) */
  flash?: boolean;
  onRename: (name: string) => void;
  onSelect: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onDragStart: (e: React.PointerEvent) => void;
  onResizeStart: (e: React.PointerEvent) => void;
}

/**
 * 流程阶段域(Stage):矩形虚线框区域,带可编辑名称,按水平位置低饱和光谱配色。
 * 框体可拖拽移动(内部节点跟随),右下角手柄可调整大小。
 * 使用 pointer 事件 + setPointerCapture 保证拖拽可靠(绕开 React Flow 的 mouse 兼容问题)。
 */
export default function StageComponent({
  stage,
  viewport,
  locked,
  flash = false,
  onRename,
  onSelect,
  onContextMenu,
  onDragStart,
  onResizeStart,
}: Props) {
  const left = stage.x * viewport.zoom + viewport.x;
  const top = stage.y * viewport.zoom + viewport.y;
  const width = stage.width * viewport.zoom;
  const height = stage.height * viewport.zoom;

  // 低饱和低明度光谱配色:按域水平位置从左到右映射 红(0°) → 蓝紫(300°)
  const hue = ((Math.round(stage.x / 6) % 300) + 300) % 300;
  const color = `hsl(${hue}, 32%, 42%)`;

  return (
    <div
      className={`nf-stage ${stage.selected ? 'selected' : ''} ${flash ? 'flash' : ''}`}
      style={{
        position: 'absolute',
        left,
        top,
        width,
        height,
        ['--stage-color' as string]: color,
        cursor: 'default',
        touchAction: 'none',
      }}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      onContextMenu={onContextMenu}
      onPointerDown={(e) => {
        // 名称编辑 / resize 手柄 / 右键不触发框体拖拽
        const t = e.target as HTMLElement;
        if (t.closest('.nf-stage-name') || t.closest('.nf-stage-resize')) return;
        if (e.button === 2) return;
        e.preventDefault();
        e.stopPropagation();
        onSelect();
        onDragStart(e);
      }}
    >
      {/* 内部填充层(穿透,不挡内部节点) */}
      <div className="nf-stage-body" />
      {/* 四边拖拽条:只覆盖边框,pointer-events:auto,用于拖拽移动域框(内部镂空不挡节点) */}
      {(['top', 'bottom', 'left', 'right'] as const).map((pos) => (
        <div
          key={pos}
          className={`nf-stage-edge nf-edge-${pos}`}
          onPointerDown={(e) => {
            if (e.button === 2) return;
            e.preventDefault();
            e.stopPropagation();
            onSelect();
            onDragStart(e);
          }}
        />
      ))}
      {/* 顶部名称栏 */}
      <div className="nf-stage-head">
        <EditableText
          className="nf-stage-name"
          value={stage.name}
          placeholder="未命名阶段"
          disabled={locked}
          onCommit={onRename}
          title="阶段名称(双击编辑)"
        />
        <span className="nf-stage-count">{stage.nodeIds.length}</span>
      </div>

      {/* 右下角调整大小手柄 */}
      <div
        className="nf-stage-resize"
        onPointerDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onResizeStart(e);
        }}
        title="拖动调整阶段域大小"
      />
    </div>
  );
}
