import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useGraphStore } from '../../store/graphStore';
import type { FlowNode, Participant, Stage } from '../../types';
import MatrixVisualLayer from '../MatrixVisualLayer';

const REAL = {
  updateStage: useGraphStore.getState().updateStage,
  updateParticipant: useGraphStore.getState().updateParticipant,
};

let updateStage = vi.fn();
let updateParticipant = vi.fn();

function makeNode(id: string, patch: { participantId?: string; stageId?: string } = {}): FlowNode {
  return {
    id,
    type: 'flow',
    position: { x: 0, y: 0 },
    data: {
      label: `节点${id}`,
      description: '',
      actor: 'human',
      locked: false,
      inputs: [],
      outputs: [],
      participantId: patch.participantId ?? null,
      stageId: patch.stageId ?? null,
    },
  } as unknown as FlowNode;
}

beforeEach(() => {
  updateStage = vi.fn();
  updateParticipant = vi.fn();
  useGraphStore.setState({
    nodes: [makeNode('n1', { participantId: 'p1', stageId: 's1' })],
    edges: [],
    participants: [{ id: 'p1', name: '导演', type: 'person' }] as unknown as Participant[],
    participantOrder: ['p1'],
    stages: [
      { id: 's1', name: '前期筹备', x: 0, y: 0, width: 400, height: 300, nodeIds: ['n1'] },
    ] as unknown as Stage[],
    stageOrder: ['s1'],
    viewport: { x: 0, y: 0, zoom: 1 },
    showStageBands: true,
    showParticipantBands: true,
    reassignHighlight: null,
    allLocked: false,
    updateStage,
    updateParticipant,
  });
});

afterEach(() => {
  useGraphStore.setState(REAL);
});

describe('MatrixVisualLayer', () => {
  it('两个显示开关都关闭时只渲染空壳容器', () => {
    useGraphStore.setState({ showStageBands: false, showParticipantBands: false });
    const { container } = render(<MatrixVisualLayer />);
    expect(container.querySelector('.matrix-visual-layer')).not.toBeNull();
    expect(container.querySelectorAll('.matrix-band').length).toBe(0);
  });

  it('容器尺寸为 0 时不渲染任何带', () => {
    const spy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
      toJSON: () => ({}),
    } as DOMRect);
    const { container } = render(<MatrixVisualLayer />);
    expect(container.querySelector('.matrix-visual-layer')).not.toBeNull();
    expect(container.querySelectorAll('.matrix-band').length).toBe(0);
    spy.mockRestore();
  });

  it('开启后渲染阶段列带与参与方行带,并带上名称标签', () => {
    const { container } = render(<MatrixVisualLayer />);
    expect(container.querySelectorAll('.matrix-band.matrix-col').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('.matrix-band.matrix-row').length).toBeGreaterThan(0);
    expect(screen.getByText('前期筹备')).toBeInTheDocument();
    expect(screen.getByText('导演')).toBeInTheDocument();
  });

  it('两轴独立:只开阶段带时不渲染行带', () => {
    useGraphStore.setState({ showParticipantBands: false });
    const { container } = render(<MatrixVisualLayer />);
    expect(container.querySelectorAll('.matrix-band.matrix-col').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('.matrix-band.matrix-row').length).toBe(0);
    expect(screen.getByText('前期筹备')).toBeInTheDocument();
  });

  it('只开参与方带时不渲染列带', () => {
    useGraphStore.setState({ showStageBands: false });
    const { container } = render(<MatrixVisualLayer />);
    expect(container.querySelectorAll('.matrix-band.matrix-row').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('.matrix-band.matrix-col').length).toBe(0);
    expect(screen.getByText('导演')).toBeInTheDocument();
  });

  it('语义再指派悬停时给目标带加高亮标记', () => {
    useGraphStore.setState({ reassignHighlight: { participant: 'p1', stage: 's1' } });
    const { container } = render(<MatrixVisualLayer />);
    expect(container.querySelectorAll('.reassign-target').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('.reassign-target-label').length).toBeGreaterThan(0);
  });

  it('无阶段语义时列带整条隐藏(空带不画无限延伸)', () => {
    useGraphStore.setState({ stages: [], stageOrder: [] });
    const { container } = render(<MatrixVisualLayer />);
    expect(container.querySelectorAll('.matrix-band.matrix-col').length).toBe(0);
    expect(container.querySelectorAll('.matrix-band.matrix-row').length).toBeGreaterThan(0);
  });

  it('标签缺失名称时回落为「未命名阶段 / 未命名参与方」', () => {
    useGraphStore.setState({
      stages: [{ id: 's1', name: '', x: 0, y: 0, width: 400, height: 300, nodeIds: ['n1'] }] as unknown as Stage[],
      participants: [{ id: 'p1', name: '', type: 'person' }] as unknown as Participant[],
    });
    render(<MatrixVisualLayer />);
    expect(screen.getByText('未命名阶段')).toBeInTheDocument();
    expect(screen.getByText('未命名参与方')).toBeInTheDocument();
  });

  it('渲染后切换显示开关立即生效(渲染后 setState 需 act 包裹)', () => {
    const { container } = render(<MatrixVisualLayer />);
    expect(container.querySelectorAll('.matrix-band').length).toBeGreaterThan(0);
    act(() => {
      useGraphStore.setState({ showStageBands: false, showParticipantBands: false });
    });
    expect(container.querySelectorAll('.matrix-band').length).toBe(0);
  });

  it('双击阶段标签可改名,回车提交到 updateStage', () => {
    const { container } = render(<MatrixVisualLayer />);
    // React Flow 会吞掉 dblclick,故组件在 window 捕获阶段用「标签命中表」识别
    fireEvent.dblClick(window, { clientX: 50, clientY: 10 });
    const input = container.querySelector('input.matrix-label-input') as HTMLInputElement;
    expect(input).not.toBeNull();
    fireEvent.change(input, { target: { value: '前期' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(updateStage).toHaveBeenCalledWith('s1', { name: '前期' });
  });

  it('双击参与方标签可改名,回车提交到 updateParticipant', () => {
    const { container } = render(<MatrixVisualLayer />);
    fireEvent.dblClick(window, { clientX: 10, clientY: 30 });
    const input = container.querySelector('input.matrix-label-input') as HTMLInputElement;
    expect(input).not.toBeNull();
    fireEvent.change(input, { target: { value: '总导演' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(updateParticipant).toHaveBeenCalledWith('p1', { name: '总导演' });
  });

  it('标签改名为空不提交,Escape 退出编辑', () => {
    const { container } = render(<MatrixVisualLayer />);
    fireEvent.dblClick(window, { clientX: 50, clientY: 10 });
    const input = container.querySelector('input.matrix-label-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(updateStage).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(container.querySelector('input.matrix-label-input')).toBeNull();
  });
});
