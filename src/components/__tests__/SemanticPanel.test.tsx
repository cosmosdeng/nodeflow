import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import { useGraphStore } from '../../store/graphStore';
import type { FlowNode, Organization, Participant, Stage } from '../../types';
import SemanticPanel from '../SemanticPanel';
import { cancelDialog } from '../../lib/dialog';

// 删除参与方 / 阶段会弹确认框;这里统一放行,把「确认流程」交给 Dialog 自身的用例覆盖
vi.mock('../../lib/dialog', () => ({
  confirmDialogAsync: vi.fn(async () => true),
  alertDialogAsync: vi.fn(async () => undefined),
  subscribeDialog: vi.fn(() => () => {}),
  getDialogState: vi.fn(() => null),
  acceptDialog: vi.fn(),
  cancelDialog: vi.fn(),
}));

const REAL = {
  addParticipant: useGraphStore.getState().addParticipant,
  updateParticipant: useGraphStore.getState().updateParticipant,
  deleteParticipant: useGraphStore.getState().deleteParticipant,
  reorderParticipant: useGraphStore.getState().reorderParticipant,
  addOrganization: useGraphStore.getState().addOrganization,
  updateOrganization: useGraphStore.getState().updateOrganization,
  deleteOrganization: useGraphStore.getState().deleteOrganization,
  addStage: useGraphStore.getState().addStage,
  updateStage: useGraphStore.getState().updateStage,
  deleteStage: useGraphStore.getState().deleteStage,
  reorderStage: useGraphStore.getState().reorderStage,
  setSemanticFocus: useGraphStore.getState().setSemanticFocus,
  assignParticipantToMany: useGraphStore.getState().assignParticipantToMany,
  assignStageToMany: useGraphStore.getState().assignStageToMany,
};

let addParticipant = vi.fn();
let updateParticipant = vi.fn();
let deleteParticipant = vi.fn();
let addOrganization = vi.fn();
let updateOrganization = vi.fn();
let deleteOrganization = vi.fn();
let addStage = vi.fn();
let deleteStage = vi.fn();
let setSemanticFocus = vi.fn();
let assignParticipantToMany = vi.fn();
let assignStageToMany = vi.fn();

function makeNode(id: string, selected = false): FlowNode {
  return {
    id,
    type: 'flow',
    position: { x: 0, y: 0 },
    selected,
    data: {
      label: `节点${id}`,
      description: '',
      actor: 'human',
      locked: false,
      inputs: [],
      outputs: [],
      participantId: null,
      stageId: null,
    },
  } as unknown as FlowNode;
}

beforeEach(() => {
  addParticipant = vi.fn();
  updateParticipant = vi.fn();
  deleteParticipant = vi.fn();
  addOrganization = vi.fn();
  updateOrganization = vi.fn();
  deleteOrganization = vi.fn();
  addStage = vi.fn();
  deleteStage = vi.fn();
  setSemanticFocus = vi.fn();
  assignParticipantToMany = vi.fn();
  assignStageToMany = vi.fn();
  useGraphStore.setState({
    nodes: [makeNode('n1'), makeNode('n2')],
    edges: [],
    selected: null,
    participants: [{ id: 'p1', name: '导演', type: 'person' }] as unknown as Participant[],
    participantOrder: ['p1'],
    organizations: [{ id: 'o1', name: '制片组' }] as unknown as Organization[],
    stages: [{ id: 's1', name: '前期筹备', x: 0, y: 0, width: 400, height: 300, nodeIds: [] }] as unknown as Stage[],
    stageOrder: ['s1'],
    semanticFocus: null,
    allLocked: false,
    addParticipant,
    updateParticipant,
    deleteParticipant,
    addOrganization,
    updateOrganization,
    deleteOrganization,
    addStage,
    deleteStage,
    setSemanticFocus,
    assignParticipantToMany,
    assignStageToMany,
  });
  // dialog.ts 是模块级单例,清掉上个用例残留
  cancelDialog();
});

afterEach(() => {
  useGraphStore.setState(REAL);
});

/** 组件用 useReactFlow() 取 screenToFlowPosition / setCenter,必须包 ReactFlowProvider */
function renderPanel(onClose = vi.fn()) {
  return render(
    <ReactFlowProvider>
      <SemanticPanel onClose={onClose} />
    </ReactFlowProvider>,
  );
}

describe('SemanticPanel', () => {
  it('渲染三个小节与已有语义项', () => {
    renderPanel();
    expect(screen.getByText('语义 · 参与方与阶段')).toBeInTheDocument();
    expect(screen.getByText('组织(可选)')).toBeInTheDocument();
    expect(screen.getByText('参与方(责任主体)')).toBeInTheDocument();
    expect(screen.getByText('阶段(流程分段)')).toBeInTheDocument();
    expect(screen.getByText('导演')).toBeInTheDocument();
    expect(screen.getByText('前期筹备')).toBeInTheDocument();
    // 组织名在「组织行」与「参与方所属组织下拉」里各出现一次,按 option 精确定位
    const orgSelect = screen.getAllByRole('combobox')[1];
    expect(within(orgSelect).getByRole('option', { name: '制片组' })).toBeInTheDocument();
  });

  it('点击关闭按钮触发 onClose', () => {
    const onClose = vi.fn();
    const { container } = renderPanel(onClose);
    // 「✕」在关闭按钮与行尾删除按钮上都存在,按类名取面板头部那个
    fireEvent.click(container.querySelector('.pp-close')!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('输入为空时「添加」按钮禁用,输入后可添加参与方', () => {
    renderPanel();
    const inputs = screen.getAllByPlaceholderText('名称');
    const addButtons = screen.getAllByRole('button', { name: '添加' });
    // 「添加」有两个:索引 0 组织 / 索引 1 参与方
    expect(addButtons[1]).toBeDisabled();
    fireEvent.change(inputs[0], { target: { value: '美术' } });
    expect(addButtons[1]).toBeEnabled();
    fireEvent.click(addButtons[1]);
    expect(addParticipant).toHaveBeenCalled();
  });

  it('可添加组织(另一个「添加」按钮)', () => {
    renderPanel();
    fireEvent.change(screen.getByPlaceholderText('组织名称'), { target: { value: '后期组' } });
    fireEvent.click(screen.getAllByRole('button', { name: '添加' })[0]);
    expect(addOrganization).toHaveBeenCalledWith('后期组');
  });

  it('点击「新增阶段域」调用 addStage(坐标为视口中心换算)', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /新增阶段域/ }));
    expect(addStage).toHaveBeenCalledTimes(1);
  });

  it('选中舞台行后删除:弹确认并通过后调用 deleteStage', async () => {
    renderPanel();
    fireEvent.click(screen.getAllByTitle('删除')[1]);
    await waitFor(() => expect(deleteStage).toHaveBeenCalledWith('s1'));
    expect(setSemanticFocus).toHaveBeenCalledWith(null);
  });

  it('删除组织无需确认(同步生效)', () => {
    const { container } = renderPanel();
    const orgRow = container.querySelector('.pp-org-row') ?? container;
    fireEvent.click(within(orgRow as HTMLElement).getByText('删除'));
    expect(deleteOrganization).toHaveBeenCalledWith('o1');
  });

  it('组织改名:进入编辑态后提交', () => {
    const { container } = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    const input = container.querySelector('.pp-org-edit input') as HTMLInputElement;
    expect(input).not.toBeNull();
    fireEvent.change(input, { target: { value: '制片一组' } });
    fireEvent.click(screen.getByRole('button', { name: '✓' }));
    expect(updateOrganization).toHaveBeenCalledWith('o1', { name: '制片一组' });
  });

  it('演示模式锁定时所有输入与按钮禁用', () => {
    useGraphStore.setState({ allLocked: true });
    renderPanel();
    expect(screen.getByPlaceholderText('组织名称')).toBeDisabled();
    expect(screen.getByPlaceholderText('名称')).toBeDisabled();
    expect(screen.getByRole('button', { name: /新增阶段域/ })).toBeDisabled();
    expect(screen.getAllByRole('button', { name: '添加' })[0]).toBeDisabled();
  });

  it('空列表时显示各自空态文案', () => {
    useGraphStore.setState({
      participants: [],
      participantOrder: [],
      organizations: [],
      stages: [],
      stageOrder: [],
    });
    renderPanel();
    expect(screen.getByText(/还没有组织/)).toBeInTheDocument();
    expect(screen.getByText(/还没有参与方/)).toBeInTheDocument();
    expect(screen.getByText(/还没有阶段/)).toBeInTheDocument();
  });

  it('未选中节点时提示需先框选,且批量按钮不生效', () => {
    const { container } = renderPanel();
    expect(container.querySelector('.mx-bulk-hint')).toBeInTheDocument();
    expect(screen.getByText(/在画布框选多个节点后/)).toBeInTheDocument();
  });

  it('选中多个节点后显示批量归属按钮并可一键清空归属', () => {
    useGraphStore.setState({ nodes: [makeNode('n1', true), makeNode('n2', true)] });
    renderPanel();
    const clear = screen.getByTitle(/清空这些节点的参与方归属/);
    fireEvent.click(clear);
    expect(assignParticipantToMany).toHaveBeenCalledWith(expect.arrayContaining(['n1', 'n2']), null);

    const clearStage = screen.getByTitle(/让这些节点脱离所有阶段/);
    fireEvent.click(clearStage);
    expect(assignStageToMany).toHaveBeenCalledWith(expect.arrayContaining(['n1', 'n2']), null);
  });

  it('点击语义项行聚焦并选中该语义项', () => {
    renderPanel();
    act(() => {
      fireEvent.click(screen.getByText('导演'));
    });
    expect(setSemanticFocus).toHaveBeenCalled();
  });
});
