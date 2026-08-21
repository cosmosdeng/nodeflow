import type { ActorType } from '../types';
import { ACTOR_META } from '../types';
import humanIcon from '../../assets/actors/human.png';
import machineIcon from '../../assets/actors/machine.png';
import hybridIcon from '../../assets/actors/hybrid.png';

/** 各执行主体对应的图标资源 URL(由 Vite 打包处理) */
const ACTOR_ICONS: Record<ActorType, string> = {
  human: humanIcon,
  machine: machineIcon,
  hybrid: hybridIcon,
};

interface Props {
  actor: ActorType;
  size?: number;
  className?: string;
  title?: string;
}

/**
 * 渲染执行主体图标(基于 assets/actors/ 下的 PNG 角色图)。
 * 以圆形裁剪 object-fit: cover 呈现,适配 26/28px 等小尺寸容器。
 */
export default function ActorIcon({ actor, size, className, title }: Props) {
  const meta = ACTOR_META[actor];
  return (
    <span
      className={['actor-icon', className].filter(Boolean).join(' ')}
      style={size ? { width: size, height: size } : undefined}
      title={title ?? `执行主体:${meta.label}`}
    >
      <img src={ACTOR_ICONS[actor]} alt={meta.label} draggable={false} />
    </span>
  );
}