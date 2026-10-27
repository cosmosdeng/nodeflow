import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { Annotation } from '../../types';
import AnnotationBox from '../AnnotationBox';
import ActorIcon from '../ActorIcon';

function makeAnnotation(patch: Partial<Annotation> = {}): Annotation {
  return {
    id: 'a1',
    target: { kind: 'canvas' },
    title: '会议要点',
    content: '下周三前确认分镜',
    collapsed: false,
    ...patch,
  } as Annotation;
}

function renderBox(props: Partial<React.ComponentProps<typeof AnnotationBox>> = {}) {
  const handlers = {
    onUpdate: vi.fn(),
    onDelete: vi.fn(),
    onToggleCollapsed: vi.fn(),
    ...props,
  };
  const utils = render(<AnnotationBox annotation={makeAnnotation()} {...handlers} />);
  return { ...utils, ...handlers };
}

describe('AnnotationBox', () => {
  it('渲染标题与内容', () => {
    const { container } = renderBox();
    expect(container.querySelector('.annot-title')).toHaveTextContent('会议要点');
    expect(container.querySelector('.annot-content')).toHaveTextContent('下周三前确认分镜');
  });

  it('收起态不渲染展开框(由主体上的 pin 体现)', () => {
    const { container } = renderBox({ annotation: makeAnnotation({ collapsed: true }) });
    expect(container.querySelector('.annot-box')).toBeNull();
  });

  it('点击收起按钮回调 onToggleCollapsed', () => {
    renderBox();
    fireEvent.click(screen.getByTitle('收起'));
    expect(screen.getByTitle('收起').closest('.annot-box')).not.toBeNull();
  });

  it('删除需二次确认:首次点出确认按钮,再点才真正删除', () => {
    const { onDelete } = renderBox();
    fireEvent.click(screen.getByTitle('删除注释'));
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTitle('确认删除'));
    expect(onDelete).toHaveBeenCalledWith('a1');
  });

  it('二次确认中点击「取消」可撤销', () => {
    renderBox();
    fireEvent.click(screen.getByTitle('删除注释'));
    fireEvent.click(screen.getByTitle('取消'));
    expect(screen.getByTitle('删除注释')).toBeInTheDocument();
  });

  it('编辑标题后回车提交 onUpdate', () => {
    const { container, onUpdate } = renderBox();
    const titleEl = container.querySelector('.annot-title')!;
    fireEvent.doubleClick(titleEl);
    (titleEl as HTMLElement).innerText = '新标题';
    fireEvent.keyDown(titleEl, { key: 'Enter' });
    expect(onUpdate).toHaveBeenCalledWith('a1', { title: '新标题' });
  });
});

describe('ActorIcon', () => {
  it('按执行主体渲染对应图标与提示', () => {
    const { container } = render(<ActorIcon actor="machine" />);
    const img = container.querySelector('img')!;
    expect(img).toHaveAttribute('alt', '机器');
    expect(container.querySelector('.actor-icon')).toHaveAttribute('title', '执行主体:机器');
  });

  it('传入 size 时设置尺寸样式', () => {
    const { container } = render(<ActorIcon actor="hybrid" size={28} />);
    expect(container.querySelector('.actor-icon')).toHaveStyle({ width: '28px', height: '28px' });
  });
});
