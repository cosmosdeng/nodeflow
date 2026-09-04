import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  SelectionMode,
  useReactFlow,
  type NodeMouseHandler,
  type EdgeMouseHandler,
  type NodeTypes,
  type EdgeTypes,
  type Connection,
  type FinalConnectionState,
} from '@xyflow/react';
import FlowNodeComponent from './FlowNodeComponent';
import FlowEdgeComponent from './FlowEdgeComponent';
import ContextMenu, { type ContextMenuState } from './ContextMenu';
import ConfirmDialog, { type ConfirmDialogState } from './ConfirmDialog';
import AnnotationBox from './AnnotationBox';
import StageComponent from './StageComponent';
import MatrixVisualLayer from './MatrixVisualLayer';
import { findMatrixLabelHit } from './matrixLabelHit';
import { useGraphStore } from '../store/graphStore';
import { changeGatewayType, createGatewayNode, GATEWAY_KINDS, GATEWAY_META } from '../lib/gateway';
import { computeSwimlaneBounds } from '../lib/arrange';
import { computeMatrixTargetZones } from '../lib/matrixTargets';
import { hoverCandidate, type ReassignmentAxis } from '../lib/semanticReassignment';
import { PARTICIPANT_TYPE_LABELS, type FlowNode, type FlowEdge, type EdgeStyle, type Stage, type GatewayType, type Participant } from '../types';

const nodeTypes: NodeTypes = { flow: FlowNodeComponent };
const edgeTypes: EdgeTypes = { flow: FlowEdgeComponent };

export default function FlowCanvas() {
  // 左上角操作提示框:默认展开,可缩小为小胶囊
  const [hintOpen, setHintOpen] = useState(true);

  // mac/触控板与 Windows/鼠标在平移缩放方式及快捷键符号上不同,提示内容按平台区分
  const isMac =
    typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/i.test(navigator.platform || '');

  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const viewport = useGraphStore((s) => s.viewport);
  const onNodesChange = useGraphStore((s) => s.onNodesChange);
  const onEdgesChange = useGraphStore((s) => s.onEdgesChange);
  const onConnect = useGraphStore((s) => s.onConnect);
  const onViewportChange = useGraphStore((s) => s.onViewportChange);
  const setSelected = useGraphStore((s) => s.setSelected);
  const pendingAutoEdit = useGraphStore((s) => s.pendingAutoEdit);
  const addNode = useGraphStore((s) => s.addNode);
  const addNodeToComposite = useGraphStore((s) => s.addNodeToComposite);
  const theme = useGraphStore((s) => s.theme);
  const allLocked = useGraphStore((s) => s.allLocked);
  const activeTabId = useGraphStore((s) => s.activeTabId);
  const toggleLockAll = useGraphStore((s) => s.toggleLockAll);
  const edgeStyle = useGraphStore((s) => s.edgeStyle);
  const setEdgeStyle = useGraphStore((s) => s.setEdgeStyle);
  const saveNow = useGraphStore((s) => s.saveNow);
  const exportJson = useGraphStore((s) => s.exportJson);
  const copySelection = useGraphStore((s) => s.copySelection);
  const pasteClipboard = useGraphStore((s) => s.pasteClipboard);
  const deleteNode = useGraphStore((s) => s.deleteNode);
  const deleteEdge = useGraphStore((s) => s.deleteEdge);
  const groupSelected = useGraphStore((s) => s.groupSelected);
  const ungroup = useGraphStore((s) => s.ungroup);
  const toggleComposite = useGraphStore((s) => s.toggleComposite);
  const insertNodeOnEdge = useGraphStore((s) => s.insertNodeOnEdge);
  const stages = useGraphStore((s) => s.stages);
  const stageFlashId = useGraphStore((s) => s.stageFlashId);
  const addStage = useGraphStore((s) => s.addStage);
  const swimlaneEnabled = useGraphStore((s) => s.swimlaneEnabled);
  const participants = useGraphStore((s) => s.participants);
  const swimlaneOrder = useGraphStore((s) => s.swimlaneOrder);
  const updateStage = useGraphStore((s) => s.updateStage);
  const deleteStage = useGraphStore((s) => s.deleteStage);
  const selectStage = useGraphStore((s) => s.selectStage);
  const setStageNodes = useGraphStore((s) => s.setStageNodes);
  const detachNodeFromStages = useGraphStore((s) => s.detachNodeFromStages);
  const syncStageMembership = useGraphStore((s) => s.syncStageMembership);
  const moveStageNodes = useGraphStore((s) => s.moveStageNodes);
  const resizeStage = useGraphStore((s) => s.resizeStage);
  const enterNodeToStage = useGraphStore((s) => s.enterNodeToStage);
  const detachNodesFromStages = useGraphStore((s) => s.detachNodesFromStages);
  const autoGrowStage = useGraphStore((s) => s.autoGrowStage);
  const annotations = useGraphStore((s) => s.annotations);
  const addAnnotation = useGraphStore((s) => s.addAnnotation);
  const updateAnnotation = useGraphStore((s) => s.updateAnnotation);
  const deleteAnnotation = useGraphStore((s) => s.deleteAnnotation);
  const toggleAnnotationCollapsed = useGraphStore((s) => s.toggleAnnotationCollapsed);
  const setAnnotationPosition = useGraphStore((s) => s.setAnnotationPosition);
  const toggleLock = (id: string) => {
    const n = useGraphStore.getState().nodes.find((x) => x.id === id);
    if (!n) return;
    useGraphStore.getState().updateNode(id, { locked: !n.data.locked });
  };

  // Phase C:拖拽释放在目标带后弹出的重分配确认(仅 runtime)
  const [reassignRequest, setReassignRequest] = useState<{
    nodeId: string;
    dropPos: { x: number; y: number };
    options: { axis: ReassignmentAxis; toId: string; label: string }[];
    nodeLabel: string;
  } | null>(null);

  // 右键菜单状态
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  // 删除确认对话框
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const closeConfirmDialog = useCallback(() => setConfirmDialog(null), []);
  // [B4] Legacy 视觉隔离:旧 Stage 框(StageComponent/stage-layer)与旧 Swimlane 渲染退出 render path。
  // 数据、API、兼容性完全保留;MatrixVisualLayer 是唯一 Stage/Participant 视觉来源。
  const LEGACY_STAGE_VISUAL = false;
  const LEGACY_SWIMLANE_VISUAL = false;

  // 画布容器 ref,用于原生双击检测
  const flowAreaRef = useRef<HTMLDivElement>(null);
  // 拖拽节点中:临时将连线提升到节点之上,便于看清连线关系(方案 C)
  const [isNodeDragging, setIsNodeDragging] = useState(false);

  // Delete / Backspace 删除前确认。
  // React Flow 12 的 onBeforeDelete 对 Promise<boolean> 返回值处理不可靠(多选删除会失效),
  // 因此此处始终返回 false 阻止 React Flow 自动删除,改为确认后手动删除待删除的节点与连线。
  const pendingDeleteRef = useRef<{
    nodes: FlowNode[];
    edges: FlowEdge[];
    stage: Stage | null;
  }>({ nodes: [], edges: [], stage: null });
  const handleBeforeDelete = useCallback(
    ({ nodes, edges }: { nodes: FlowNode[]; edges: FlowEdge[] }) => {
      if (allLocked) return Promise.resolve(false);
      // 若仅选中了阶段域(非节点/连线),则按删除阶段域处理
      const st = useGraphStore.getState();
      const selectedStage = st.stages.find((s) => s.selected) ?? null;
      if (!nodes.length && !edges.length && !selectedStage) return Promise.resolve(false);
      pendingDeleteRef.current = { nodes, edges, stage: selectedStage };
      const parts: string[] = [];
      if (nodes.length) parts.push(`${nodes.length} 个节点`);
      if (edges.length) parts.push(`${edges.length} 条连线`);
      if (selectedStage) parts.push(`阶段域「${selectedStage.name || '未命名'}」`);
      const label = `确定删除选中的 ${parts.join(' 和 ')}?`;
      setConfirmDialog({
        title: '删除确认',
        message: `${label}${
          selectedStage ? '\n删除阶段域后,内部节点 / 组合自动脱离,变为自由节点,连线保持不变。' : ''
        }\n撤销删除(Ctrl+Z)可还原。`,
        confirmLabel: '删除',
        cancelLabel: '取消',
        danger: true,
        onConfirm: () => {
          const { nodes: dn, edges: de, stage: dStage } = pendingDeleteRef.current;
          pendingDeleteRef.current = { nodes: [], edges: [], stage: null };
          const g = useGraphStore.getState();
          // 删除连线(需在删节点前,避免悬空)
          de.forEach((e) => {
            if (g.edges.some((x) => x.id === e.id)) g.deleteEdge(e.id);
          });
          dn.forEach((n) => {
            if (g.nodes.some((x) => x.id === n.id)) g.deleteNode(n.id);
          });
          // 删除阶段域:内部节点 / 组合自动脱离,变为自由节点,连线不变
          if (dStage && g.stages.some((x) => x.id === dStage.id)) g.deleteStage(dStage.id);
        },
        onCancel: () => {
          pendingDeleteRef.current = { nodes: [], edges: [], stage: null };
        },
      });
      return Promise.resolve(false); // 阻止 React Flow 自动删除,由 onConfirm 手动处理
    },
    [allLocked, setConfirmDialog],
  );

  // 记录「右键是否处于拖拽平移中」,用于右键松开时不弹菜单
  const rightDragRef = useRef(false);

  const { screenToFlowPosition, fitView, getViewport, setViewport, getNode, getNodes } = useReactFlow();
  const isDark = theme === 'dark';

  const handlePaneClick = useCallback(() => {
    setSelected(null);
    // 点击画布空白处同时取消所有阶段域的选中态
    useGraphStore.getState().selectStage(null);
  }, [setSelected]);

  /** 根据当前标签页过滤出实际渲染的节点与连线;全部锁定时强制所有节点不可拖(覆盖 per-node draggable) */
  const { displayNodes, displayEdges } = useMemo(() => {
    const applyLock = (ns: FlowNode[]) =>
      allLocked ? ns.map((n) => ({ ...n, draggable: false })) : ns;
    if (activeTabId === 'main') {
      // 展开组合的子节点提升 zIndex,使其渲染在组合虚线框之上,保证可被拖拽 / 连线 / 选中。
      // 不能用 :has() 让组合框 pointer-events:none 穿透(部分环境不生效),改由 z-index 层叠解决。
      const childIds = new Set(
        nodes
          .filter((n) => n.data?.composite?.expanded)
          .flatMap((n) => n.data!.composite!.childIds),
      );
      const lifted = nodes.map((n) =>
        childIds.has(n.id) ? { ...n, zIndex: 1 } : n,
      );
      return { displayNodes: applyLock(lifted), displayEdges: edges };
    }
    const comp = nodes.find((n) => n.id === activeTabId);
    const childSet = new Set(comp?.data?.composite?.childIds ?? []);
    return {
      displayNodes: applyLock(
        nodes.filter((n) => childSet.has(n.id)).map((n) => ({ ...n, hidden: false })),
      ),
      displayEdges: edges
        .filter((e) => childSet.has(e.source) && childSet.has(e.target))
        .map((e) => ({ ...e, hidden: false })),
    };
  }, [activeTabId, nodes, edges, allLocked]);

  // 泳道 derived bounds(仅当 swimlaneEnabled 时计算,不持久化、不改变任何 graph)
  const swimlaneBounds = useMemo(
    () =>
      swimlaneEnabled
        ? computeSwimlaneBounds(displayNodes, participants, swimlaneOrder, viewport)
        : [],
    [swimlaneEnabled, displayNodes, participants, swimlaneOrder, viewport],
  );

  const handleNodeClick: NodeMouseHandler = useCallback(
    (_, node) => {
      // 刚创建连线、正处于连线 label 编辑时,忽略本次节点点击(防止把选中切回节点)
      if (pendingAutoEdit?.kind === 'edge-label') return;
      setSelected({ kind: 'node', id: node.id });
    },
    [setSelected, pendingAutoEdit],
  );

  const handleEdgeClick: EdgeMouseHandler = useCallback(
    (_, edge) => setSelected({ kind: 'edge', id: edge.id }),
    [setSelected],
  );

  // 长按 1 秒进入阶段域:计时器与当前目标
  const stageEnterTimerRef = useRef<number | null>(null);
  const stageEnterTargetRef = useRef<{ stageId: string; nodeId: string } | null>(null);

  const clearStageEnterTimer = useCallback(() => {
    if (stageEnterTimerRef.current != null) {
      window.clearTimeout(stageEnterTimerRef.current);
      stageEnterTimerRef.current = null;
    }
    stageEnterTargetRef.current = null;
  }, []);

  // 节点/域闪烁反馈
  const setStageFlash = useCallback((stageId: string, nodeId: string) => {
    useGraphStore.setState({ stageFlashId: stageId });
    useGraphStore.setState((s) => ({
      nodes: s.nodes.map((n) =>
        n.id === nodeId
          ? { ...n, className: `${n.className ?? ''} nf-flash`.trim() }
          : n,
      ),
    }));
    window.setTimeout(() => {
      useGraphStore.setState({ stageFlashId: null });
      useGraphStore.setState((s) => ({
        nodes: s.nodes.map((n) =>
          n.className?.includes('nf-flash')
            ? { ...n, className: n.className.replace(/\s*nf-flash\s*/g, '').trim() }
            : n,
        ),
      }));
    }, 700);
  }, []);

  // ---- Phase C Semantic Reassignment(drag → hover ≈1s → 反馈 → 确认) ----
  // 运行时状态不持久化、不写历史;确认后唯一权威变更入口 = graphStore.reassignNode。
  const draggingNodeRef = useRef<string | null>(null);
  const multiDragRef = useRef(false);
  const dwellRef = useRef<
    { axis: ReassignmentAxis; timer: number | null; targetId: string | null; nodeId: string | null }[]
  >([
    { axis: 'participant', timer: null, targetId: null, nodeId: null },
    { axis: 'stage', timer: null, targetId: null, nodeId: null },
  ]);

  const clearDwellAxis = useCallback((axis: ReassignmentAxis) => {
    const rec = dwellRef.current.find((r) => r.axis === axis);
    if (!rec) return;
    if (rec.timer != null) {
      window.clearTimeout(rec.timer);
      rec.timer = null;
    }
    rec.targetId = null;
    rec.nodeId = null;
  }, []);
  const clearAllDwell = useCallback(() => {
    clearDwellAxis('participant');
    clearDwellAxis('stage');
  }, [clearDwellAxis]);

  const semanticsOfNode = useCallback((nodeId: string) => {
    const st = useGraphStore.getState();
    const n = st.nodes.find((x) => x.id === nodeId);
    const pid =
      n?.data?.participantId && st.participants.some((p) => p.id === n.data!.participantId)
        ? n.data!.participantId
        : undefined;
    const sid = st.stages.find((s) => s.nodeIds.includes(nodeId))?.id;
    return { participantId: pid, stageId: sid };
  }, []);

  // 命中判定与渲染层同源(横向无限行带只看 Y、纵向无限列带只看 X);同目标不算候选
  const bandHitsOf = useCallback(
    (node: FlowNode) => {
      const st = useGraphStore.getState();
      const zones = computeMatrixTargetZones({
        nodes: st.nodes,
        edges: st.edges,
        participants: st.participants,
        participantOrder: st.participantOrder,
        stages: st.stages,
        stageOrder: st.stageOrder,
      });
      const rf = getNode(node.id) as (FlowNode & { measured?: { width?: number; height?: number } }) | undefined;
      const w = rf?.measured?.width ?? node.width ?? 230;
      const h = rf?.measured?.height ?? node.height ?? 100;
      const nx = node.position.x;
      const ny = node.position.y;
      let pid: string | null = null;
      if (st.showParticipantBands) {
        for (const z of zones.participants) {
          if (ny < z.bottom && ny + h > z.top) {
            pid = z.id;
            break;
          }
        }
      }
      let sid: string | null = null;
      if (st.showStageBands) {
        for (const z of zones.stages) {
          if (nx < z.right && nx + w > z.left) {
            sid = z.id;
            break;
          }
        }
      }
      const sem = semanticsOfNode(node.id);
      const pCand = pid ? hoverCandidate(node.id, sem, { axis: 'participant', targetId: pid }) : null;
      const sCand = sid ? hoverCandidate(node.id, sem, { axis: 'stage', targetId: sid }) : null;
      return {
        participantId: pCand ? pid : null,
        stageId: sCand ? sid : null,
      };
    },
    [getNode, semanticsOfNode],
  );

  const scheduleDwell = useCallback(
    (axis: ReassignmentAxis, node: FlowNode, targetId: string) => {
      const rec = dwellRef.current.find((r) => r.axis === axis)!;
      if (rec.timer != null) {
        window.clearTimeout(rec.timer);
        rec.timer = null;
      }
      rec.targetId = targetId;
      rec.nodeId = node.id;
      const nodeId = node.id;
      rec.timer = window.setTimeout(() => {
        rec.timer = null;
        if (draggingNodeRef.current !== nodeId) return;
        const cur = getNode(nodeId) as (FlowNode & { measured?: unknown }) | undefined;
        if (!cur) return;
        // 触发前复核仍在本带:离开/换带则取消,防止 stale timer
        const hit = bandHitsOf(cur as FlowNode);
        const still = axis === 'participant' ? hit.participantId === targetId : hit.stageId === targetId;
        if (!still) return;
        // 两轴独立写,交叉格内 participant/stage 候选可同时存在
        useGraphStore
          .getState()
          .setReassignHighlight(axis === 'participant' ? { participant: targetId } : { stage: targetId });
      }, 950);
    },
    [bandHitsOf, getNode],
  );

  const handleNodeDragStart = useCallback(
    (_: unknown, node: FlowNode) => {
      setIsNodeDragging(true);
      clearStageEnterTimer();
      clearAllDwell();
      const st = useGraphStore.getState();
      draggingNodeRef.current = node.id;
      multiDragRef.current = getNodes().filter((n) => n.selected).length > 1;
      if (!st.allLocked) st.markHistory(); // 拖动开始即快照,保证 confirm 后一次 Undo 还原 position+semantic
      st.setReassignHighlight(null);
    },
    [clearStageEnterTimer, clearAllDwell, getNodes],
  );

  // 拖拽过程中:对已归属节点实时收拢 legacy 域框;并检测矩阵带停留形成 Phase C 候选
  const handleNodeDrag = useCallback(
    (_: unknown, node: FlowNode) => {
      const st = useGraphStore.getState();
      if (st.allLocked || st.activeTabId !== 'main') return;
      if (multiDragRef.current || node.id !== draggingNodeRef.current) return;
      const ownedStage = st.stages.find((sg) => sg.nodeIds.includes(node.id));
      if (ownedStage) st.autoGrowStage(ownedStage.id);
      const hits = bandHitsOf(node);
      if (hits.participantId) {
        scheduleDwell('participant', node, hits.participantId);
      } else {
        clearDwellAxis('participant');
        if (st.reassignHighlight?.participant != null) st.setReassignHighlight({ participant: null });
      }
      if (hits.stageId) {
        scheduleDwell('stage', node, hits.stageId);
      } else {
        clearDwellAxis('stage');
        if (st.reassignHighlight?.stage != null) st.setReassignHighlight({ stage: null });
      }
    },
    [bandHitsOf, clearDwellAxis, scheduleDwell],
  );

  const handleNodeDragStop = useCallback(
    (_: unknown, node: FlowNode) => {
      setIsNodeDragging(false);
      draggingNodeRef.current = null;
      multiDragRef.current = false;
      clearStageEnterTimer();
      clearAllDwell();
      const st = useGraphStore.getState();
      // 拖拽结束:对归属域节点再收敛一次域框(可能缩小回节点包围盒)
      const owned = st.stages.filter((sg) =>
        sg.nodeIds.some((nid) => st.nodes.find((n) => n.id === nid && !n.hidden)),
      );
      owned.forEach((sg) => st.autoGrowStage(sg.id));
      // 仅在“停留形成候选 + 释放在同一带内”时弹出确认;否则保持语义不变
      // 参与方 / 阶段两轴独立判定:交叉格内可同时出现两个选项,各自确认只改对应轴
      const hl = st.reassignHighlight;
      const hits = bandHitsOf(node);
      const options: { axis: ReassignmentAxis; toId: string; label: string }[] = [];
      if (hl?.participant != null && hits.participantId === hl.participant) {
        const p = st.participants.find((x) => x.id === hl.participant);
        options.push({ axis: 'participant', toId: hl.participant, label: `参与方 → ${p?.name ?? hl.participant}` });
      }
      if (hl?.stage != null && hits.stageId === hl.stage) {
        const s = st.stages.find((x) => x.id === hl.stage);
        options.push({ axis: 'stage', toId: hl.stage, label: `阶段 → ${s?.name ?? hl.stage}` });
      }
      if (options.length) {
        const n = st.nodes.find((x) => x.id === node.id);
        setReassignRequest({
          nodeId: node.id,
          dropPos: { x: node.position.x, y: node.position.y },
          options,
          nodeLabel: n?.data.label || node.id,
        });
      } else {
        st.setReassignHighlight(null);
      }
    },
    [clearStageEnterTimer, clearAllDwell, bandHitsOf],
  );

  // 确认/取消(取消不改变任何 semantic;位置已随普通拖动保留在同一条历史里)
  const applyReassignAxis = useCallback(
    (axis: ReassignmentAxis, toId: string) => {
      const req = reassignRequest;
      if (!req) return;
      const st = useGraphStore.getState();
      st.reassignNode(
        req.nodeId,
        {
          position: req.dropPos,
          participantId: axis === 'participant' ? toId : undefined,
          stageId: axis === 'stage' ? toId : undefined,
        },
        { recordHistory: false },
      );
      st.setReassignHighlight(null);
      setReassignRequest(null);
    },
    [reassignRequest],
  );
  const cancelReassign = useCallback(() => {
    const st = useGraphStore.getState();
    st.setReassignHighlight(null);
    setReassignRequest(null);
  }, []);

  /**
   * 从端口拖出连线到画布空白处(未连接到有效端口)时,自动创建新节点并连接:
   * - 从输出端口拖出 → 新节点作为目标(连到其输入端口)
   * - 从输入端口拖出 → 新节点作为源(从其输出端口连出)
   * 新节点创建在松开鼠标的位置。
   */
  const handleConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, connectionState: FinalConnectionState) => {
      // 已成功连接到目标节点端口,由 onConnect 处理,这里跳过
      if (connectionState.toNode) return;
      if (allLocked) return;
      const fromNode = connectionState.fromNode;
      const fromHandle = connectionState.fromHandle;
      if (!fromNode || !fromHandle) return;
      // 支持鼠标与触摸事件;触摸用 changedTouches 取坐标
      let clientX = 0;
      let clientY = 0;
      if ('clientX' in event) {
        clientX = event.clientX;
        clientY = event.clientY;
      } else {
        const t = event.changedTouches?.[0];
        clientX = t?.clientX ?? 0;
        clientY = t?.clientY ?? 0;
      }
      const pos = screenToFlowPosition({ x: clientX, y: clientY });
      const st = useGraphStore.getState();
      // 内部画布中新建节点时加入所属组合,主画布直接新建
      const comp =
        st.activeTabId !== 'main' ? st.nodes.find((n) => n.id === st.activeTabId) : null;
      const newId = comp?.data?.composite
        ? addNodeToComposite(comp.id, { x: pos.x - 115, y: pos.y - 60 })
        : addNode(undefined, { x: pos.x - 115, y: pos.y - 60 });
      if (!newId) return;
      // 从输出端口(source)拖出 → 连到新节点输入;从输入端口(target)拖出 → 从新节点输出连出
      const conn: Connection =
        fromHandle.type === 'source'
          ? {
              source: fromNode.id,
              sourceHandle: fromHandle.id ?? null,
              target: newId,
              targetHandle: 'in_1',
            }
          : {
              source: newId,
              sourceHandle: 'out_1',
              target: fromNode.id,
              targetHandle: fromHandle.id ?? null,
            };
      st.onConnect(conn);
      setSelected({ kind: 'node', id: newId });
      // onConnect 会触发连线 label 编辑,这里覆盖为编辑新节点标题
      useGraphStore.getState().requestAutoEdit({ kind: 'node-title', id: newId });
    },
    [addNode, addNodeToComposite, allLocked, screenToFlowPosition, setSelected],
  );

  /** 画布空白处右键:弹出画布菜单 */
  const handlePaneContextMenu = useCallback(
    (e: React.MouseEvent | MouseEvent) => {
      e.preventDefault();
      const clientX = 'clientX' in e ? e.clientX : 0;
      const clientY = 'clientY' in e ? e.clientY : 0;
      const nextStyle: EdgeStyle = edgeStyle === 'smoothstep' ? 'bezier' : 'smoothstep';
      setContextMenu({
        x: clientX,
        y: clientY,
        items: [
          {
            label: '添加节点',
            disabled: allLocked,
            onClick: () => {
              const pos = screenToFlowPosition({ x: clientX, y: clientY });
              const st = useGraphStore.getState();
              const comp =
                st.activeTabId !== 'main'
                  ? st.nodes.find((n) => n.id === st.activeTabId)
                  : null;
              const id = comp?.data?.composite
                ? addNodeToComposite(comp.id, pos)
                : addNode(undefined, pos);
              if (id) setSelected({ kind: 'node', id });
            },
          },
          {
            label: '添加网关',
            disabled: true,
            hint: '选择下方网关类型创建',
          },
          ...GATEWAY_KINDS.map((gt) => ({
            label: `▸ ${GATEWAY_META[gt].label} (${GATEWAY_META[gt].mark})`,
            disabled: allLocked,
            onClick: () => {
              const pos = screenToFlowPosition({ x: clientX, y: clientY });
              const st = useGraphStore.getState();
              const comp =
                st.activeTabId !== 'main'
                  ? st.nodes.find((n) => n.id === st.activeTabId)
                  : null;
              const gw = createGatewayNode(gt, { x: pos.x - 65, y: pos.y - 48 });
              const st2 = useGraphStore.getState();
              let id: string;
              if (comp?.data?.composite) {
                id = addNodeToComposite(comp.id, pos);
                if (id) st2.updateNode(id, gw.data);
              } else {
                id = addNode(gw.data, gw.position);
              }
              if (id) setSelected({ kind: 'node', id });
            },
          })),
          {
            label: allLocked ? '解除锁定全部' : '锁定全部',
            onClick: () => toggleLockAll(),
          },
          {
            label: `连线风格:${edgeStyle === 'smoothstep' ? '平滑折线' : '曲线'}`,
            onClick: () => setEdgeStyle(nextStyle),
          },
          {
            label: '显示全部节点',
            onClick: () => fitView({ padding: 0.2, duration: 400 }),
          },
          { label: '---' },
          {
            label: '保存',
            onClick: () => saveNow(),
          },
          {
            label: '另存为(导出 JSON)',
            onClick: () => {
              const blob = new Blob([exportJson()], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `nodeflow-${new Date()
                .toISOString()
                .slice(0, 19)
                .replace(/[:T]/g, '-')}.json`;
              a.click();
              URL.revokeObjectURL(url);
            },
          },
        ],
      });
    },
    [
      addNode,
      addNodeToComposite,
      allLocked,
      edgeStyle,
      exportJson,
      fitView,
      saveNow,
      screenToFlowPosition,
      setEdgeStyle,
      setSelected,
      toggleLockAll,
    ],
  );

  /** 节点上右键:若节点已选中则操作全部选中,否则操作该节点 */
  const handleNodeContextMenu = useCallback(
    (e: React.MouseEvent, node: FlowNode) => {
      e.preventDefault();
      const st = useGraphStore.getState();
      const selectedNodes = st.nodes.filter((n) => n.selected);
      // 右键的节点不在选中集时,临时视为仅该节点
      const targets = selectedNodes.some((n) => n.id === node.id)
        ? selectedNodes
        : [node];
      const isComposite = !!node.data.composite;
      const isGateway = !!node.data.gateway;
      const multi = targets.length > 1;
      // 是否有任一目标节点属于阶段域
      const anyInStage = st.stages.some((sg) =>
        sg.nodeIds.some((nid) => targets.some((t) => t.id === nid)),
      );

      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        items: [
          {
            label: multi ? `复制 (${targets.length})` : '复制',
            disabled: allLocked,
            hint: '复制到剪贴板,可在其它画布/项目粘贴',
            onClick: () => {
              // 确保 targets 被标记为选中后再复制
              const st = useGraphStore.getState();
              if (!selectedNodes.some((n) => n.id === node.id)) {
                st.setSelected({ kind: 'node', id: node.id });
              }
              copySelection();
            },
          },
          {
            label: '粘贴',
            disabled: allLocked || !useGraphStore.getState().clipboard,
            hint: '粘贴剪贴板内容到当前画布',
            onClick: () => {
              // 把右键菜单的屏幕坐标转换为画布流坐标,作为粘贴定位点
              const fp = screenToFlowPosition({ x: e.clientX, y: e.clientY });
              pasteClipboard(fp);
              setContextMenu(null);
            },
          },
          {
            label: multi ? `锁定选中 (${targets.length})` : '锁定节点',
            disabled: allLocked,
            onClick: () => {
              targets.forEach((n) => {
                const cur = st.nodes.find((x) => x.id === n.id);
                if (cur) st.updateNode(n.id, { locked: !cur.data.locked });
              });
            },
          },
          {
            label: multi ? `脱离阶段域 (${targets.length})` : '脱离阶段域',
            disabled: allLocked || !anyInStage,
            hint: !anyInStage ? '选中的节点不在阶段域内' : undefined,
            onClick: () => detachNodesFromStages(targets.map((n) => n.id)),
          },
          {
            label: multi ? `编组为复合节点 (${targets.length})` : '编组为复合节点',
            disabled: allLocked || targets.length < 2,
            hint: targets.length < 2 ? '需至少选中 2 个节点' : undefined,
            onClick: () => {
              const id = groupSelected();
              if (id) setSelected({ kind: 'node', id });
            },
          },
          ...(isComposite
            ? [
                {
                  label: node.data.composite?.expanded ? '收起(塌缩组合)' : '展开(显示内部节点)',
                  disabled: allLocked,
                  onClick: () => {
                    toggleComposite(node.id);
                    setSelected({ kind: 'node', id: node.id });
                  },
                },
                {
                  label: '解除编组',
                  disabled: allLocked,
                  onClick: () => ungroup(node.id),
                },
                { label: '---' as const },
              ]
            : []),
          ...(isGateway
            ? [
                { label: `网关类型:${GATEWAY_META[node.data.gateway!.type].label}`, disabled: true },
                ...GATEWAY_KINDS.filter((t) => t !== node.data.gateway!.type).map((t) => ({
                  label: `切换为${GATEWAY_META[t].label}`,
                  disabled: allLocked,
                  onClick: () => {
                    const cur = useGraphStore.getState().nodes.find((x) => x.id === node.id);
                    if (cur?.data?.gateway) {
                      const updated = changeGatewayType(cur.data.gateway, t, GATEWAY_META[t].label);
                      useGraphStore.getState().updateNode(node.id, updated);
                    }
                  },
                })),
                { label: '---' as const },
              ]
            : []),
          {
            label: '删除',
            danger: true,
            disabled: allLocked,
            onClick: () => {
              const label = multi
                ? `确定删除选中的 ${targets.length} 个节点?`
                : `确定删除节点「${node.data.label || '未命名'}」?`;
              // 弹出确认对话框;确认后删除(store 会一并清理相关连线,撤销可完整还原)
              setConfirmDialog({
                title: '删除确认',
                message: `${label}\n撤销删除(Ctrl+Z)可还原节点及其连线关系。`,
                confirmLabel: '删除',
                cancelLabel: '取消',
                danger: true,
                onConfirm: () => {
                  targets.forEach((n) => deleteNode(n.id));
                  setSelected(null);
                },
              });
            },
          },
        ],
      });
    },
    [deleteNode, groupSelected, setSelected, setConfirmDialog, ungroup, toggleComposite, detachNodesFromStages, allLocked],
  );

  /** 连线上右键:弹出连线菜单(在连线中间插入新节点 / 删除连线) */
  const handleEdgeContextMenu = useCallback(
    (e: React.MouseEvent, edge: FlowEdge) => {
      e.preventDefault();
      e.stopPropagation();
      const fp = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        items: [
          {
            label: '在此添加节点',
            disabled: allLocked,
            hint: '在连线中间插入新节点,原连线拆成两段,说明与产物移至上游',
            onClick: () => {
              const id = insertNodeOnEdge(edge.id, fp);
              if (id) setSelected({ kind: 'node', id });
            },
          },
          {
            label: '删除连线',
            danger: true,
            disabled: allLocked,
            onClick: () => {
              setConfirmDialog({
                title: '删除确认',
                message: '确定删除这条连线?',
                confirmLabel: '删除',
                cancelLabel: '取消',
                danger: true,
                onConfirm: () => {
                  deleteEdge(edge.id);
                  setSelected(null);
                },
              });
            },
          },
        ],
      });
    },
    [
      allLocked,
      screenToFlowPosition,
      setSelected,
      insertNodeOnEdge,
      setConfirmDialog,
      deleteEdge,
    ],
  );

  /** 阶段域上右键:弹出域菜单 */
  const handleStageContextMenu = useCallback(
    (e: React.MouseEvent, stage: Stage) => {
      e.preventDefault();
      e.stopPropagation();
      selectStage(stage.id);
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        items: [
          {
            label: stage.nodeIds.length
              ? `脱离全部节点 (${stage.nodeIds.length})`
              : '脱离全部节点',
            disabled: allLocked || stage.nodeIds.length === 0,
            hint: '把该阶段域内的全部节点移出归属',
            onClick: () => setStageNodes(stage.id, []),
          },
          {
            label: '删除阶段域',
            danger: true,
            disabled: allLocked,
            onClick: () => deleteStage(stage.id),
          },
        ],
      });
    },
    [allLocked, selectStage, setStageNodes, deleteStage],
  );

  /** 拖拽阶段域:移动域矩形,内部节点保持相对关系整体移动;结束记录一次历史 */
  const handleStageDragStart = useCallback(
    (e: React.PointerEvent, stage: Stage) => {
      if (allLocked) return;
      // 用增量位移:每次 pointermove 只算相对上一点的位移,避免绝对位移反复累加
      let lastX = e.clientX;
      let lastY = e.clientY;
      let moved = false;
      const onMove = (me: PointerEvent) => {
        const dx = (me.clientX - lastX) / viewport.zoom;
        const dy = (me.clientY - lastY) / viewport.zoom;
        lastX = me.clientX;
        lastY = me.clientY;
        moveStageNodes(stage.id, dx, dy, true, false);
        moved = true;
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        if (moved) useGraphStore.getState().markHistory();
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    },
    [allLocked, viewport.zoom, moveStageNodes],
  );

  /** 拖拽阶段域右下角手柄:调整域大小,结束记录一次历史 */
  const handleStageResizeStart = useCallback(
    (e: React.PointerEvent, stage: Stage) => {
      if (allLocked) return;
      let lastX = e.clientX;
      let lastY = e.clientY;
      let moved = false;
      const onMove = (me: PointerEvent) => {
        const dw = (me.clientX - lastX) / viewport.zoom;
        const dh = (me.clientY - lastY) / viewport.zoom;
        lastX = me.clientX;
        lastY = me.clientY;
        // 用当前宽高累加增量,避免反复累加
        const cur = useGraphStore.getState().stages.find((x) => x.id === stage.id);
        resizeStage(stage.id, (cur?.width ?? stage.width) + dw, (cur?.height ?? stage.height) + dh, false);
        moved = true;
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        if (moved) useGraphStore.getState().markHistory();
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    },
    [allLocked, viewport.zoom, resizeStage],
  );

  /** 判断事件目标是否在节点/连线上,分别弹出节点菜单或连线菜单,否则弹画布菜单 */
  const openContextMenuAt = useCallback(
    (clientX: number, clientY: number, target: EventTarget | null) => {
      const el = target as HTMLElement | null;
      const nodeEl = el?.closest?.('.react-flow__node');
      if (nodeEl) {
        const nid = nodeEl.getAttribute('data-id');
        const node = useGraphStore.getState().nodes.find((n) => n.id === nid);
        if (node) {
          // 构造一个兼容 handleNodeContextMenu / handlePaneContextMenu 的事件对象
          const ev = {
            clientX,
            clientY,
            preventDefault: () => {},
            stopPropagation: () => {},
          } as unknown as React.MouseEvent;
          handleNodeContextMenu(ev, node);
          return;
        }
      }
      // 连线上右键(edge 元素 / 连线说明 label / 产物 chip):弹连线菜单
      const labelEl = el?.closest?.('[data-edge-id]');
      if (labelEl) {
        const edgeId = labelEl.getAttribute('data-edge-id');
        const edge = useGraphStore.getState().edges.find((n) => n.id === edgeId);
        if (edge) {
          const ev = {
            clientX,
            clientY,
            preventDefault: () => {},
            stopPropagation: () => {},
          } as unknown as React.MouseEvent;
          handleEdgeContextMenu(ev, edge);
          return;
        }
      }
      const edgeEl = el?.closest?.('.react-flow__edge');
      if (edgeEl) {
        const edgeId =
          edgeEl.getAttribute('data-id') ||
          edgeEl.getAttribute('data-edgeid');
        const edge = useGraphStore.getState().edges.find((n) => n.id === edgeId);
        if (edge) {
          const ev = {
            clientX,
            clientY,
            preventDefault: () => {},
            stopPropagation: () => {},
          } as unknown as React.MouseEvent;
          handleEdgeContextMenu(ev, edge);
          return;
        }
      }
      handlePaneContextMenu({ clientX, clientY, preventDefault: () => {} } as React.MouseEvent);
    },
    [handleNodeContextMenu, handlePaneContextMenu, handleEdgeContextMenu],
  );

  /**
   * 统一右键入口:仅阻止浏览器原生右键菜单。
   * 自定义右键菜单不在 contextmenu 中弹出,而是在右键松开(pointerup)时判断:
   * 若未发生拖拽位移则视为右键单击,弹出菜单;正在拖拽平移则不弹。
   * 这样可避免外接三键鼠标/部分平台「右键按下即触发 contextmenu」导致拖拽时误弹菜单。
   */
  const handleFlowContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
  }, []);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  // 全局检测右键拖拽:右键按下并移动超过阈值 → 标记为拖拽平移。
  // 右键松开时:若未发生拖拽位移则视为右键单击,弹出自定义菜单(此时浏览器 contextmenu
  // 已被阻止);若已拖拽平移则不弹菜单。这样可避免三键鼠标/部分平台右键按下即触发
  // contextmenu 导致拖拽时误弹菜单。
  useEffect(() => {
    let downX = 0;
    let downY = 0;
    let tracking = false;
    const onDown = (e: PointerEvent) => {
      if (e.button === 2) {
        tracking = true;
        rightDragRef.current = false;
        downX = e.clientX;
        downY = e.clientY;
      }
    };
    const onMove = (e: PointerEvent) => {
      if (!tracking) return;
      // 右键仍按住且位移超过阈值 → 判定为拖拽平移
      if (e.buttons & 2 && (Math.abs(e.clientX - downX) > 4 || Math.abs(e.clientY - downY) > 4)) {
        rightDragRef.current = true;
      }
    };
    const onUp = (e: PointerEvent) => {
      if (e.button !== 2) return;
      tracking = false;
      const wasDrag = rightDragRef.current;
      // 松开后延迟重置,避免后续 contextmenu(可能在松开时触发)误判
      setTimeout(() => {
        rightDragRef.current = false;
      }, 80);
      // 未拖拽 → 右键单击,弹出自定义菜单
      if (!wasDrag) {
        openContextMenuAt(e.clientX, e.clientY, e.target);
      }
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [openContextMenuAt]);

  // 触控板 / 滚轮交互:用原生捕获阶段监听 wheel,统一控制缩放与平移,
  // 并阻止事件继续传播,确保 React Flow 内部不会重复处理。
  // - 触控板两指捏合(ctrlKey)→ 缩放
  // - 鼠标滚轮(deltaMode===1 或 deltaY 较大)→ 缩放(与 Windows 逻辑一致)
  // - 触控板两指滑动(像素级小 delta)→ 平移画布
  useEffect(() => {
    const el = flowAreaRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      // 排除画布内部可滚动元素(如属性面板 / 历史面板等不在 flow-area 内,无需处理)
      e.preventDefault();
      e.stopPropagation();
      const { x, y, zoom } = getViewport();
      // 判断来源:捏合缩放 / 鼠标滚轮缩放 / 触控板两指滑动平移
      const isPinch = e.ctrlKey;
      const isMouseWheel = e.deltaMode === 1 || Math.abs(e.deltaY) > 20;
      if (isPinch || isMouseWheel) {
        // 以光标为中心缩放:先取光标处的 flow 坐标,再反推相对容器的屏幕坐标,
        // 保证缩放前后光标下的画布点位置不变。
        const flowPoint = screenToFlowPosition({ x: e.clientX, y: e.clientY });
        const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
        const nextZoom = Math.min(3, Math.max(0.1, zoom * factor));
        const screenRelX = flowPoint.x * zoom + x;
        const screenRelY = flowPoint.y * zoom + y;
        const nextX = screenRelX - flowPoint.x * nextZoom;
        const nextY = screenRelY - flowPoint.y * nextZoom;
        setViewport({ x: nextX, y: nextY, zoom: nextZoom }, { duration: 0 });
      } else {
        // 触控板两指滑动 → 平移画布
        setViewport({ x: x - e.deltaX, y: y - e.deltaY, zoom }, { duration: 0 });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false, capture: true });
    return () => el.removeEventListener('wheel', onWheel, { capture: true } as EventListenerOptions);
  }, [getViewport, setViewport, screenToFlowPosition]);

  // 双击画布空白处创建节点:
  // 用原生捕获阶段监听 pointerdown 计数(selectionOnDrag 会拦截 click/dblclick 事件,
  // 导致 onPaneClick detail 与 onDoubleClick 均失效,但捕获阶段的 pointerdown 仍能收到)
  useEffect(() => {
    const el = flowAreaRef.current;
    if (!el) return;
    let last = 0;
    let lastX = 0;
    let lastY = 0;
    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      // 坐标级排除:命中 Matrix label 区域(即使浮层/事件时序导致 target 非 chip)不建节点
      const rect = el.getBoundingClientRect();
      if (findMatrixLabelHit(e.clientX - rect.left, e.clientY - rect.top)) {
        last = 0;
        return;
      }
      const t = e.target as HTMLElement | null;
      // 排除节点内部(节点双击是编辑/选中)
      if (t?.closest?.('.react-flow__node')) {
        last = 0;
        return;
      }
      // 排除连线说明 / 中间产物 / 添加产物等浮层,避免双击它们时误建节点
      if (t?.closest?.('.nf-edge-label, .nf-artifact-chip, .nf-add-artifact')) {
        last = 0;
        return;
      }
      // 排除注释框 / 注释区域,避免双击注释时误建节点(注释双击是编辑)
      if (
        t?.closest?.(
          '.annot-box, .annot-pin, .annotation-layer, .artifact-annot, .edge-annot-area, .node-annot-area, .node-annot-btn, .edge-annot-btn',
        )
      ) {
        last = 0;
        return;
      }
      // 排除阶段域(名称框双击是编辑名称),避免双击名称时误建节点
      if (t?.closest?.('.nf-stage, .nf-stage-name, .nf-stage-head')) {
        last = 0;
        return;
      }
      // 排除 Matrix label 及贴边守卫(双击进入名称编辑),避免误建节点
      if (
        t?.closest?.('.matrix-label, .matrix-label-layer, .matrix-gutter-guard')
      ) {
        last = 0;
        return;
      }
      const now = Date.now();
      const dx = Math.abs(e.clientX - lastX);
      const dy = Math.abs(e.clientY - lastY);
      if (now - last < 350 && dx < 6 && dy < 6) {
        // 判定为双击画布
        last = 0;
        if (allLocked) return;
        const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
        const st = useGraphStore.getState();
        const comp =
          st.activeTabId !== 'main' ? st.nodes.find((n) => n.id === st.activeTabId) : null;
        const id = comp?.data?.composite
          ? addNodeToComposite(comp.id, pos)
          : addNode(undefined, pos);
        if (id) setSelected({ kind: 'node', id });
      } else {
        last = now;
        lastX = e.clientX;
        lastY = e.clientY;
      }
    };
    el.addEventListener('pointerdown', onPointerDown, true);
    return () => el.removeEventListener('pointerdown', onPointerDown, true);
  }, [addNode, addNodeToComposite, allLocked, screenToFlowPosition, setSelected]);

  return (
    <div
      ref={flowAreaRef}
      className={`flow-area ${isNodeDragging ? 'dragging-edge' : ''}`}
      onContextMenu={handleFlowContextMenu}
    >
      <ReactFlow<FlowNode, FlowEdge>
        key={activeTabId}
        nodes={displayNodes}
        edges={displayEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        viewport={activeTabId === 'main' ? viewport : undefined}
        fitView={activeTabId !== 'main'}
        fitViewOptions={{ padding: 0.2 }}
        onViewportChange={(v) => {
          // 仅主画布的视口写入 store,避免内部画布污染主画布视图
          if (activeTabId === 'main') onViewportChange(v);
        }}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectEnd={handleConnectEnd}
        onNodeClick={handleNodeClick}
        onEdgeClick={handleEdgeClick}
        onPaneClick={handlePaneClick}
        onNodeDragStart={handleNodeDragStart}
        onNodeDrag={handleNodeDrag}
        onNodeDragStop={handleNodeDragStop}
        onBeforeDelete={handleBeforeDelete}
        onNodeDoubleClick={(_, node) => setSelected({ kind: 'node', id: node.id })}
        nodesDraggable={!allLocked}
        nodesConnectable={!allLocked}
        edgesReconnectable={!allLocked}
        deleteKeyCode={allLocked ? null : ['Backspace', 'Delete']}
        multiSelectionKeyCode={['Shift', 'Meta']}
        // 仅右键平移画布:左键专用于拖拽节点 / 框选 / 双击编辑文字,不与画布平移冲突
        panOnDrag={[2]}
        selectionOnDrag={!allLocked}
        selectionMode={SelectionMode.Partial}
        // 触控板/滚轮交互由原生捕获阶段 wheel 监听统一处理(见 handleWheelEffect),
        // 因此关闭 React Flow 自身的滚轮缩放与平移,避免抢占事件。
        zoomOnScroll={false}
        panOnScroll={false}
        zoomOnPinch={false}
        connectionRadius={40}
        minZoom={0.1}
        maxZoom={3}
        // 不使用 noDragClassName / noPanClassName 全局配置(会导致节点无法拖拽);
        // 编辑态通过 store 将节点 draggable 置 false + EditableText 原生捕获拦截阻止拖拽。
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={24}
          size={1}
          color={isDark ? '#2c2f38' : '#c9cdd6'}
        />
        <Controls position="bottom-right" />
        <MiniMap
          position="bottom-left"
          pannable
          zoomable
          nodeColor={(n) => {
            // 隐藏节点(塌缩组合的内部节点)不显示在小地图中
            if (n.hidden) return 'transparent';
            const actor = (n.data as { actor?: string } | undefined)?.actor;
            if (actor === 'human') return '#e8b028';
            if (actor === 'hybrid') return '#9d6bff';
            return '#4ea1ff';
          }}
          nodeStrokeColor={isDark ? '#9aa0ad' : '#7d8590'}
          maskColor={isDark ? 'rgba(23,24,28,0.7)' : 'rgba(220,225,235,0.75)'}
        />

        {/* 左上角半透明操作提示框,可缩小 */}
        <Panel position="top-left">
          {hintOpen ? (
            <div className="nf-hint">
              <div className="nf-hint-head">
                <span className="nf-hint-title">基本操作</span>
                <button
                  className="nf-hint-btn"
                  title="缩小"
                  onClick={() => setHintOpen(false)}
                >
                  ―
                </button>
              </div>
              <ul className="nf-hint-list">
                <li><b>拖拽节点</b> · 左键按住节点移动</li>
                <li><b>框选</b> · 左键画布空白拖拽选中多个节点</li>
                <li>
                  <b>平移画布</b>
                  {isMac
                    ? ' · 触控板两指滑动 / 鼠标右键按住拖动'
                    : ' · 鼠标右键按住拖动'}
                </li>
                <li><b>缩放</b> · 鼠标滚轮 / 两指捏合 / 右下角控件</li>
                <li><b>编辑文字</b> · 双击节点标题 / 描述 / 端口名</li>
                <li><b>连线</b> · 从端口拖出到另一节点端口</li>
                <li><b>新建节点</b> · 双击画布空白处</li>
                <li>
                  <b>撤销 / 重做</b> · {isMac ? '⌘Z / ⇧⌘Z' : 'Ctrl+Z / Ctrl+Shift+Z'}
                </li>
                <li>
                  <b>删除</b> · 选中后按 Delete / Backspace
                </li>
              </ul>
            </div>
          ) : (
            <button
              className="nf-hint-trigger"
              title="展开操作提示"
              onClick={() => setHintOpen(true)}
            >
              ?
            </button>
          )}
        </Panel>

        {/* 画布 / 节点归属注释(独立 overlay 层,跟随 viewport 缩放平移) */}
        <div className="annotation-layer">
          {annotations.map((a) => {
            const t = a.target;
            let pos: { x: number; y: number } | null = null;
            if (t.kind === 'canvas' && t.tabId === activeTabId) {
              pos = a.position ?? { x: 80, y: 60 };
            } else if (t.kind === 'node') {
              const n = displayNodes.find((x) => x.id === t.nodeId);
              if (n) {
                if (n.data?.gateway) {
                  // 网关:注释框水平居中,高度对齐原红 pin 图标位置
                  pos = {
                    x: n.position.x + (n.measured?.width ?? 380) / 2,
                    y: n.position.y + (n.measured?.height ?? 220) - 2,
                  };
                } else {
                  // 展开的注释框放在节点正下方(框线外侧)
                  const h = n.measured?.height ?? 120;
                  pos = { x: n.position.x, y: n.position.y + h + 20 };
                }
              }
            } else if (t.kind === 'stage') {
              // 阶段域注释:放在域框正下方(框线外侧)
              const st = stages.find((x) => x.id === t.stageId);
              if (st) {
                pos = { x: st.x, y: st.y + st.height + 18 };
              }
            }
            if (!pos) return null;
            const left = pos.x * viewport.zoom + viewport.x;
            const top = pos.y * viewport.zoom + viewport.y;
            const isGatewayAnnot = t.kind === 'node' && displayNodes.find((x) => x.id === t.nodeId)?.data?.gateway;
            return (
              <div
                key={a.id}
                style={{
                  position: 'absolute',
                  left,
                  top,
                  transform: isGatewayAnnot ? 'translateX(-50%)' : undefined,
                }}
              >
                <AnnotationBox
                  annotation={a}
                  draggable={a.target.kind === 'canvas'}
                  onDrag={(id, sx, sy) => {
                    const fx = (sx - viewport.x) / viewport.zoom;
                    const fy = (sy - viewport.y) / viewport.zoom;
                    setAnnotationPosition(id, { x: fx, y: fy }, false);
                  }}
                  onDragEnd={(id) => {
                    const cur = useGraphStore.getState().annotations.find((x) => x.id === id);
                    if (cur?.position) setAnnotationPosition(id, cur.position, true);
                  }}
                  onUpdate={updateAnnotation}
                  onDelete={deleteAnnotation}
                  onToggleCollapsed={toggleAnnotationCollapsed}
                />
              </div>
            );
          })}
        </div>

        {/* [B4] Legacy 阶段域框视觉已隔离(数据/机制保留,不再渲染)。MatrixVisualLayer 承担 Stage 视觉。 */}
        {LEGACY_STAGE_VISUAL && (
          <div className="stage-layer">
            {stages.map((st) => (
              <StageComponent
                key={st.id}
                stage={st}
                viewport={viewport}
                locked={allLocked}
                flash={stageFlashId === st.id}
                onRename={(name) => updateStage(st.id, { name })}
                onSelect={() => selectStage(st.id)}
                onContextMenu={(e) => handleStageContextMenu(e, st)}
                onDragStart={(e) => handleStageDragStart(e, st)}
                onResizeStart={(e) => handleStageResizeStart(e, st)}
              />
            ))}
          </div>
        )}

        {/* [B4] Legacy 泳道渲染已隔离(数据/函数保留,不再渲染)。MatrixVisualLayer 承担 Swimlane 视觉。 */}
        {LEGACY_SWIMLANE_VISUAL && swimlaneEnabled && (
          <div className="swimlane-layer">
            {swimlaneBounds.map((lane) => {
              const part = participants.find((p) => p.id === lane.participantId);
              const typeLabel = part ? PARTICIPANT_TYPE_LABELS[part.type] ?? part.type : '';
              return (
                <div
                  key={lane.participantId}
                  className="swimlane"
                  style={{
                    left: lane.x * viewport.zoom + viewport.x,
                    top: lane.y * viewport.zoom + viewport.y,
                    width: lane.width * viewport.zoom,
                    height: lane.height * viewport.zoom,
                  }}
                >
                  <span className="swimlane-label">{part?.name ?? '未分配'}{typeLabel ? ` · ${typeLabel}` : ''}</span>
                </div>
              );
            })}
          </div>
        )}

        {/* Phase B B2:Matrix body bands(derived visual layer,pointer-events:none) */}
        <MatrixVisualLayer />
      </ReactFlow>
      <ContextMenu menu={contextMenu} onClose={closeContextMenu} />
      <ConfirmDialog dialog={confirmDialog} onClose={closeConfirmDialog} />

      {/* Phase C:拖放候选后的最小确认(仅 runtime;确认 = reassignNode 原子事务) */}
      {reassignRequest && (
        <div className="nf-modal-mask" onMouseDown={cancelReassign}>
          <div
            className="nf-modal"
            onMouseDown={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="nf-modal-title">语义重分配</div>
            <div className="nf-modal-message">
              将节点「{reassignRequest.nodeLabel}」重新分配?可分别确认参与方或阶段;取消则不改变归属。
            </div>
            <div className="nf-modal-actions" style={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              {reassignRequest.options.map((o) => (
                <button
                  key={`${o.axis}-${o.toId}`}
                  className="nf-btn primary"
                  onClick={() => applyReassignAxis(o.axis, o.toId)}
                >
                  {o.label}
                </button>
              ))}
              <button className="nf-btn" onClick={cancelReassign}>
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
